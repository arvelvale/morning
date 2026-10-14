"""主动信号调度入口。

每 5 分钟一轮：对每个活跃用户跑一遍「轮询类」检测器（时间窗口 / 节假日 /
天气 / 城市变化 / 使用异常 / 驾车兜底），入队后立刻处理该用户的 pending 信号。

事件驱动的信号（客户端上报速度样本）由 /api/v1/signals/motion 即时触发，
本调度器只作为兜底——客户端没能即时触发时由这里接管。
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.preference import UserPreference
from app.services.infra.engagement import reachable_users
from app.services.signals import fusion
from app.services.signals.context import now_local
from app.services.signals.date_context import get_date_context
from app.services.signals.detectors import (
    DetectedSignal,
    driving_detector,
    holiday_greeting_detector,
    location_change_detector,
    scheduled_window_detector,
    usage_anomaly_detector,
    weather_alert_detector,
)

logger = logging.getLogger(__name__)


def _get_or_create_pref(db: Session, user_id: int) -> UserPreference:
    pref = db.scalar(select(UserPreference).where(UserPreference.user_id == user_id))
    if pref is None:
        pref = UserPreference(user_id=user_id)
        db.add(pref)
        db.commit()
        db.refresh(pref)
    return pref


def detect_for_user(
    db: Session,
    *,
    user_id: int,
    local_dt: datetime | None = None,
    include_driving: bool = True,
) -> list[DetectedSignal]:
    """跑一遍轮询类检测器，返回候选信号（尚未入库）。

    单个检测器抛异常只丢该信号，不影响其它检测器。
    """
    local = local_dt or now_local()
    date_ctx = get_date_context(local)
    pref = _get_or_create_pref(db, user_id)
    detected: list[DetectedSignal] = []

    def _try(name: str, fn) -> None:
        try:
            result = fn()
        except Exception as e:  # noqa: BLE001
            logger.warning("[signals] 检测器 %s 失败 user=%s err=%s", name, user_id, e)
            return
        if result is None:
            return
        detected.extend(result if isinstance(result, list) else [result])

    if pref.scheduled_checkin_enabled:
        _try("scheduled", lambda: scheduled_window_detector.detect(
            user_id=user_id,
            local_dt=local,
            schedule_times=pref.proactive_schedule_times,
        ))
    if pref.holiday_greeting_enabled:
        _try("holiday", lambda: holiday_greeting_detector.detect(
            user_id=user_id, local_dt=local, date_context=date_ctx
        ))
    if pref.weather_alert_enabled:
        _try("weather", lambda: weather_alert_detector.detect(
            db, user_id=user_id, pref=pref, local_dt=local
        ))
    _try("location_change", lambda: location_change_detector.detect(
        db, user_id=user_id, pref=pref, local_dt=local
    ))
    if pref.usage_anomaly_enabled:
        _try("usage_anomaly", lambda: usage_anomaly_detector.detect(db, user_id=user_id))
    if include_driving and pref.motion_detection_enabled and pref.driving_alert_enabled:
        _try("driving", lambda: driving_detector.detect(db, user_id=user_id))

    return detected


def run_tick_for_user(
    db: Session, *, user_id: int, local_dt: datetime | None = None
) -> dict[str, Any]:
    """单用户一轮：检测 → 入队 → 融合决策 → 投递。"""
    local = local_dt or now_local()
    detected = detect_for_user(db, user_id=user_id, local_dt=local)
    persisted = fusion.ingest(db, user_id=user_id, detected=detected) if detected else []
    result = fusion.process_pending(
        db, user_id=user_id, now_utc=datetime.now(timezone.utc), local_dt=local
    )
    result["detected"] = len(detected)
    result["ingested"] = len(persisted)
    return result


def run_tick_all(db: Session) -> dict[str, Any]:
    """全量用户一轮（5 分钟调度器入口）。"""
    settings = get_settings()
    if not settings.proactive_enabled:
        return {"skipped": "proactive_disabled"}

    local = now_local()
    users = reachable_users(db, "signal_tick")  # 跳过连续多天没打开 App 的用户，见 engagement.py
    summary = {
        "users": len(users), "detected": 0, "ingested": 0,
        "allowed": 0, "suppressed": 0, "expired": 0, "local_time": local.isoformat(),
    }
    for user in users:
        try:
            result = run_tick_for_user(db, user_id=user.id, local_dt=local)
        except Exception as e:  # noqa: BLE001  单用户失败不影响其它人
            logger.error("[signals] tick 失败 user=%s err=%s", user.id, e)
            db.rollback()
            continue
        for key in ("detected", "ingested", "allowed", "suppressed", "expired"):
            summary[key] += int(result.get(key) or 0)
    logger.info(
        "[signals] tick done users=%d detected=%d allowed=%d suppressed=%d expired=%d",
        summary["users"], summary["detected"], summary["allowed"],
        summary["suppressed"], summary["expired"],
    )
    return summary


def cleanup_motion_samples(db: Session, *, retention_days: int = 30) -> int:
    """清理超过保留期的速度样本（默认 30 天）。"""
    from datetime import timedelta

    from sqlalchemy import delete

    from app.models.signal import MotionSample

    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
    result = db.execute(delete(MotionSample).where(MotionSample.created_at < cutoff))
    db.commit()
    return int(result.rowcount or 0)
