"""用户活跃度：记录「最近一次真正打开 App」，并给所有会调 LLM 的定时任务筛掉沉睡用户。

为什么需要：晚间来信 / 周报 / 睡前提醒 / 主动信号 / 做梦 / 场景推荐每天对全部用户跑一遍，
很久不打开 App 的用户回来时只会看到一堆积压来信，每封都烧过一次模型调用。

规则（设计值 → 代码换算，改之前先改这里）：
- 设计值：连续 DORMANT_AFTER_DAYS 天（东八区自然日）没打开 → 第 DORMANT_AFTER_DAYS+1 天起停发。
- 换算：今天是 D，截止点 = (D − N) 当天 00:00 东八区；last_active_at 早于截止点即沉睡。
  例 N=3：周一打开过，周二/三/四都没打开 → 周四还照常发，周五起停；任何一天再打开立即恢复。
- last_active_at 为空（迁移前的异常行）一律按活跃处理：宁可多发，不误伤。

什么算「打开」：带登录凭证的业务请求都算，但排除 App 在后台也会自动发出的请求
（60s 来信轮询、位置上报、信号样本上报），否则常驻前台服务会让所有人永远「活跃」。
新客户端回到前台时另外调一次 POST /api/v1/users/me/active，作为精确信号。
"""
from __future__ import annotations

import logging
from datetime import datetime, time, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.user import User

logger = logging.getLogger(__name__)

CST = timezone(timedelta(hours=8))

# 同一用户 10 分钟内只写一次库：活跃度精度到「天」，没必要每个请求都写。
TOUCH_THROTTLE = timedelta(minutes=10)

# App 在后台也会自动发出的请求（method, path）。精确匹配：GET /letters/{id} 是用户点开信，照样算。
BACKGROUND_REQUESTS: frozenset[tuple[str, str]] = frozenset({
    ("GET", "/api/v1/letters"),                 # notifications.ts 每 60s 轮询未读来信
    ("POST", "/api/v1/preferences/location"),   # 启动时 best-effort 上报位置
    ("POST", "/api/v1/signals/motion"),         # 速度样本（后台采集）
    ("POST", "/api/v1/signals/usage"),          # 手机使用统计（后台采集）
})


def _as_utc(dt: datetime) -> datetime:
    # SQLite 读回来是 naive（存的就是 UTC），PostgreSQL 是 aware
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def counts_as_open(method: str, path: str) -> bool:
    return (method.upper(), path.rstrip("/") or "/") not in BACKGROUND_REQUESTS


def touch_last_active(user: User, now: datetime | None = None) -> bool:
    """按节流把 users.last_active_at 更新为当前时间。返回是否真的写了库。

    用独立会话写：调用方是鉴权依赖，主会话属于请求本身，不能被这里提前 commit。
    写失败只记日志——活跃度是省钱用的辅助信息，绝不能让业务请求因此失败。
    """
    now = now or datetime.now(timezone.utc)
    last = user.last_active_at
    if last is not None and now - _as_utc(last) < TOUCH_THROTTLE:
        return False
    from app.db import SessionLocal

    db = SessionLocal()
    try:
        db.execute(update(User).where(User.id == user.id).values(last_active_at=now))
        db.commit()
    except Exception as e:  # noqa: BLE001
        db.rollback()
        logger.warning("[engagement] touch user=%s failed: %s", user.id, e)
        return False
    finally:
        db.close()
    return True


def dormant_cutoff(now: datetime | None = None, days: int | None = None) -> datetime:
    """沉睡截止点（UTC）：last_active_at 早于它的用户不再收自动生成的消息。"""
    days = get_settings().dormant_after_days if days is None else days
    today = (now or datetime.now(timezone.utc)).astimezone(CST).date()
    return datetime.combine(today - timedelta(days=days), time.min, tzinfo=CST).astimezone(timezone.utc)


def is_dormant(user: User, now: datetime | None = None, days: int | None = None) -> bool:
    if user.last_active_at is None:
        return False
    return _as_utc(user.last_active_at) < dormant_cutoff(now, days)


def reachable_users(db: Session, job: str, now: datetime | None = None) -> list[User]:
    """定时任务的用户来源：已启用账号里，排除连续多天没打开 App 的人。

    dormant_after_days <= 0 表示关闭这条规则（全部照发）。
    """
    users = list(db.scalars(select(User).where(User.is_active == True)).all())  # noqa: E712
    days = get_settings().dormant_after_days
    if days <= 0:
        return users
    cutoff = dormant_cutoff(now, days)
    kept = [u for u in users if u.last_active_at is None or _as_utc(u.last_active_at) >= cutoff]
    skipped = len(users) - len(kept)
    if skipped:
        logger.info("[engagement] %s: skip %d dormant users (no open for %d+ days), keep %d",
                    job, skipped, days, len(kept))
    return kept


__all__ = [
    "BACKGROUND_REQUESTS", "counts_as_open", "dormant_cutoff", "is_dormant",
    "reachable_users", "touch_last_active",
]
