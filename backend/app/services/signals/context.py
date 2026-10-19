"""主动触达决策上下文。

把「此刻用户的处境」组装成一份纯值字典，送进 AI 决策网关：
本地时间 / 日期与节假日 / 天气与城市 / 运动状态 / 手机使用摘要 / 桌宠人格 /
表层记忆素材。

隐私底座（AGENTS.md 伦理红线 + Property 9）：素材只取 depth=surface 记忆，
vulnerable / core / personal 深层记忆绝不进入 prompt。
"""
from __future__ import annotations

import logging
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.memory import MemoryItem
from app.models.preference import UserPreference
from app.models.signal import DeviceUsageSignal, MotionSample
from app.services.signals.date_context import DateContext, get_date_context
from app.services.memory.context_builder import build as build_memory_context
from app.services.memory.temporal import cn_date

logger = logging.getLogger(__name__)

# 产品面向国内用户，固定东八区（与 evening_letter / weekly_report 口径一致）
CST = timezone(timedelta(hours=8))

MOTION_FRESHNESS_MINUTES = 15
MAX_SURFACE_MATERIAL = 8


@dataclass(frozen=True)
class DecisionContext:
    user_id: int
    timezone: str
    local_time: str
    local_hour: int
    date_context: dict[str, Any]
    weather: dict[str, Any] | None
    city: str | None
    motion_state: dict[str, Any] | None
    usage_summary: dict[str, Any] | None
    pet: dict[str, Any] | None
    surface_material: list[str]
    profile_context: str | None
    signal: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def now_local() -> datetime:
    return datetime.now(CST)


def latest_usage_summary(db: Session, user_id: int) -> dict[str, Any] | None:
    row = db.scalar(
        select(DeviceUsageSignal)
        .where(DeviceUsageSignal.user_id == user_id)
        .order_by(DeviceUsageSignal.stat_date.desc())
        .limit(1)
    )
    return (row.value or {}) if row is not None else None


def latest_motion_state(db: Session, user_id: int) -> dict[str, Any] | None:
    """最近一条速度样本 + 是否新鲜（让决策知道用户此刻是否在开车/走路）。"""
    row = db.scalar(
        select(MotionSample)
        .where(MotionSample.user_id == user_id)
        .order_by(MotionSample.occurred_at.desc())
        .limit(1)
    )
    if row is None:
        return None
    occurred = row.occurred_at
    if occurred.tzinfo is None:
        occurred = occurred.replace(tzinfo=timezone.utc)
    is_fresh = datetime.now(timezone.utc) - occurred <= timedelta(minutes=MOTION_FRESHNESS_MINUTES)
    return {
        "occurred_at": occurred.isoformat(),
        "is_fresh": is_fresh,
        "activity_type": row.activity_type,
        "is_driving": bool(row.is_driving) and is_fresh,
        "current_speed_kmh": row.current_speed_kmh,
        "max_speed_kmh": row.max_speed_kmh,
    }


def _weather_snapshot(pref: UserPreference) -> dict[str, Any] | None:
    """从缓存/彩云取一次当前天气；未授权定位或服务不可用时返回 None。"""
    if pref.last_lat is None or pref.last_lon is None:
        return None
    try:
        from app.services.infra.weather import weather_service

        return weather_service.get_current_weather(float(pref.last_lat), float(pref.last_lon))
    except Exception as e:  # noqa: BLE001
        logger.info("[signals] 上下文天气获取失败 user=%s err=%s", pref.user_id, e)
        return None


def _pet_snapshot(db: Session, user_id: int) -> dict[str, Any] | None:
    try:
        from app.services.pet.pet_store import PetStore

        pet = PetStore(db).get_active(user_id)
    except Exception as e:  # noqa: BLE001
        logger.info("[signals] 桌宠读取失败 user=%s err=%s", user_id, e)
        return None
    if pet is None:
        return None
    return {
        "id": pet.id,
        "name": getattr(pet, "name", None),
        "species": getattr(pet, "species", None),
        "persona": getattr(pet, "persona", None),
    }


def _surface_material(db: Session, user_id: int) -> list[str]:
    """近 48 小时的表层记忆，作为主动消息可引用的素材（深层记忆不外发）。"""
    since = datetime.now(timezone.utc) - timedelta(hours=48)
    items = list(
        db.scalars(
            select(MemoryItem)
            .where(
                MemoryItem.user_id == user_id,
                MemoryItem.depth == "surface",
                MemoryItem.is_latest == True,  # noqa: E712
                MemoryItem.is_forgotten == False,  # noqa: E712
                MemoryItem.created_at >= since,
            )
            .order_by(MemoryItem.created_at.desc())
            .limit(MAX_SURFACE_MATERIAL)
        ).all()
    )
    # 每条前带记下的日期：记忆里只有「明天」之类相对说法，不标日期模型会把旧事说成明天
    return [
        f"{cn_date(m.created_at)}记下：{(m.surface_text or m.content or '').strip()}"
        for m in items if (m.surface_text or m.content)
    ]


def build_decision_context(
    db: Session,
    *,
    user_id: int,
    pref: UserPreference,
    signal: dict[str, Any],
    local_dt: datetime | None = None,
    date_context: DateContext | None = None,
) -> DecisionContext:
    """组装一次主动触达决策所需的全部上下文。"""
    local = local_dt or now_local()
    ctx = date_context or get_date_context(local)
    return DecisionContext(
        user_id=user_id,
        timezone="Asia/Shanghai",
        local_time=local.isoformat(),
        local_hour=local.hour,
        date_context=ctx.to_dict(),
        weather=_weather_snapshot(pref),
        city=pref.last_city,
        motion_state=latest_motion_state(db, user_id),
        usage_summary=latest_usage_summary(db, user_id),
        pet=_pet_snapshot(db, user_id),
        surface_material=_surface_material(db, user_id),
        profile_context=build_memory_context(db, user_id, mode="profile"),
        signal=signal,
    )
