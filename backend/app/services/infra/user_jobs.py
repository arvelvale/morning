"""由手机触发的定时活：自带密钥的用户，手机带着 key 调 POST /api/v1/tick，这里替他跑「此刻该做的」。

为什么需要：晚间信、睡前提醒、周报、主动问候、做梦、场景推荐原来都由服务端定时器跑，用的是服务端的 key。
自带密钥的用户密钥只在手机上，服务端定时器既没有他的 key，也不该花服务端的额度（engagement.reachable_users
已把他们从服务端定时器里排除）。所以由手机定时来触发，密钥随这次请求进来（app/llm_keys.py）。

做法：在 user_job_scope(user_id) 里调用和服务端定时器**同一批**任务入口，它们取用户时只会取到这一个人。
各任务什么时候算「到点」：
- 晚间信：到了用户设的时间、今天还没写过（补发窗口放宽到当天结束，见 evening_letter.is_evening_due）。
- 睡前提醒：到了设定时间、今天还没发过（任务自带判断）。
- 周报：周日 20:00 以后（东八区），本周还没写过（任务自带幂等键）。
- 主动问候（信号融合）：同一用户至少间隔 5 分钟。
- 做梦、场景推荐：每天 8:00 以后（东八区，对应服务端的 0:00 UTC），每天一次（job_runs 占位防重复）。

代价（要如实告诉用户）：手机不联网、App 被系统彻底杀掉时，这些就不会发生；等手机下次来触发时，
当天还在窗口内的会补上。
"""
from __future__ import annotations

import logging
import threading
import time as _time
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from sqlalchemy import delete
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.job_run import JobRun
from app.services.infra.engagement import user_job_scope

logger = logging.getLogger(__name__)

CST = timezone(timedelta(hours=8))
# 与 main.py 的服务端定时器保持一致：周日 20:00 发周报；做梦在 0:00 UTC = 东八区 8:00
WEEKLY_WEEKDAY = 6
WEEKLY_HOUR = 20
DREAM_LOCAL_HOUR = 8
SIGNAL_MIN_INTERVAL_SECONDS = 5 * 60
# 某个任务这次没做成（模型调用失败、key 不对）：这么久之内不再试。
# 手机每分钟都可能来触发，不加这个会每分钟打一次失败的模型调用，一直打到半夜。
FAILURE_COOLDOWN_SECONDS = 10 * 60

_lock = threading.Lock()
_running: set[int] = set()
_last_signal_tick: dict[int, float] = {}
_cooldown_until: dict[tuple[int, str], float] = {}


def claim_job(db: Session, user_id: int, job: str, period: str) -> bool:
    """占一个 (用户, 任务, 周期) 的位置；已经有人占了返回 False。"""
    try:
        db.add(JobRun(user_id=user_id, job=job, period=period))
        db.commit()
        return True
    except IntegrityError:
        db.rollback()
        return False


def release_job(db: Session, user_id: int, job: str, period: str) -> None:
    """任务整体失败时把位置让出来，下次触发还能再试。"""
    try:
        db.execute(delete(JobRun).where(
            JobRun.user_id == user_id, JobRun.job == job, JobRun.period == period))
        db.commit()
    except Exception:  # noqa: BLE001
        db.rollback()


def due_jobs(now: datetime, *, signal_ok: bool = True) -> list[str]:
    """此刻要去「看一眼」的任务（纯时间判断，不查库）。晚间信、睡前提醒每次都看，是否真的发由任务自己定。"""
    s = get_settings()
    local = now.astimezone(CST)
    jobs = ["evening_letter", "bedtime_reminder"]
    if local.weekday() == WEEKLY_WEEKDAY and local.hour >= WEEKLY_HOUR:
        jobs.append("weekly_report")
    if s.proactive_enabled and signal_ok:
        jobs.append("signal_tick")
    if local.hour >= DREAM_LOCAL_HOUR:
        if s.dreaming_enabled:
            jobs.append("dreaming")
        jobs.append("scene_recommend")
    return jobs


def _failed(results: Any) -> bool:
    """任务入口返回的结果里，这个人是不是没做成（报错，或该写的信没写出来）。"""
    if not isinstance(results, list) or not results:
        return False
    return all(
        isinstance(r, dict) and (r.get("error") or r.get("status") == "error" or r.get("sent") is False)
        for r in results
    )


def run_user_jobs(user_id: int, now: datetime | None = None) -> dict[str, Any]:
    """为一个自带密钥的用户跑此刻该做的定时活。要在带着密钥的请求上下文里调用。

    同一用户同一时刻只跑一轮（上一轮还在等模型时，新的触发直接跳过）。
    """
    with _lock:
        if user_id in _running:
            return {"skipped": "running"}
        _running.add(user_id)
    try:
        now = now or datetime.now(timezone.utc)
        mono = _time.monotonic()
        last_signal = _last_signal_tick.get(user_id)
        signal_ok = last_signal is None or mono - last_signal >= SIGNAL_MIN_INTERVAL_SECONDS
        jobs = due_jobs(now, signal_ok=signal_ok)
        day = now.astimezone(CST).date().isoformat()
        summary: dict[str, Any] = {}

        from app.db import SessionLocal

        db = SessionLocal()

        def step(name: str, fn: Callable[[], Any], *, once_per_day: bool = False) -> None:
            if name not in jobs:
                return
            if _cooldown_until.get((user_id, name), 0.0) > mono:
                summary[name] = "cooldown"
                return
            if once_per_day and not claim_job(db, user_id, name, day):
                return
            failed = False
            try:
                failed = _failed(fn())
            except Exception as e:  # noqa: BLE001  单个任务失败不影响其它任务
                logger.error("[user-jobs] %s failed for user %s: %s", name, user_id, type(e).__name__)
                db.rollback()
                failed = True
            if failed:
                _cooldown_until[(user_id, name)] = mono + FAILURE_COOLDOWN_SECONDS
                if once_per_day:
                    release_job(db, user_id, name, day)
            summary[name] = "failed" if failed else "ran"

        try:
            with user_job_scope(user_id):
                from app.services.mailbox.bedtime_reminder import run_due_bedtime_reminders
                from app.services.mailbox.evening_letter import run_due_evening_letters
                from app.services.mailbox.weekly_report import run_weekly_reports_all

                step("evening_letter", lambda: run_due_evening_letters(db, now))
                step("bedtime_reminder", lambda: run_due_bedtime_reminders(db))
                step("weekly_report", lambda: run_weekly_reports_all(db))
                if "signal_tick" in jobs:
                    from app.services.signals.runner import run_tick_all

                    _last_signal_tick[user_id] = mono
                    step("signal_tick", lambda: run_tick_all(db))
                if "dreaming" in jobs:
                    from app.graphs.dreaming import run_dreaming_all

                    step("dreaming", lambda: run_dreaming_all(db), once_per_day=True)
                if "scene_recommend" in jobs:
                    from app.services.scene.scene_recommend import run_scene_recommend_all

                    step("scene_recommend", lambda: run_scene_recommend_all(db), once_per_day=True)
        finally:
            db.close()
        return summary
    finally:
        with _lock:
            _running.discard(user_id)
