"""睡前提醒：到用户设定的 sleep_reminder_time，由当前桌宠 agent 写一条提醒投进信箱。

产品口径：
- 消息经**当前激活桌宠的 agent** 生成——走 `run_companion`（BASE_PERSONA 红线 +
  激活桌宠 `system_prompt` 人格层），与聊天用同一套人格，不是通用文案。
- 落库为 Letter（type=reminder），用户在信箱查看。
- 每天至多一条（独立来源键幂等），并受信箱每日两封统一额度约束。
- 到点触发由 main.py 的每分钟调度器驱动（扫描到点且今日未发的用户）。

时区：sleep_reminder_time 按东八区（产品面向国内用户，固定时区）解释。
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.graphs.companion import run_companion
from app.models.letter import Letter
from app.models.preference import UserPreference
from app.services.mailbox.letter_store import (
    LetterStore,
    daily_generation_key,
    local_delivery_date,
)
from app.services.memory.temporal import now_context_text
from app.services.pet.pet_store import PetStore

logger = logging.getLogger(__name__)

CST = timezone(timedelta(hours=8))

# 触发语：作为一次「用户侧」上下文喂给桌宠 agent，让它以自己的人格写提醒。
REMINDER_TRIGGER = (
    "（现在到了我给你设定的睡前提醒时间）用你自己的方式，轻轻提醒我该收收心、"
    "准备休息了。一两句就好，别说教也别列清单，可以顺口关心我一句。"
)
DEFAULT_TITLE = "该歇一歇了 🌙"

# 睡前提醒不读记忆（run_companion 没传 memory_context），只给「现在」并堵住编造旧事：
# 曾出现过每晚把一件旧待办说成「明天要交」，这里明确禁止提具体待办/截止日期。
ENV_CONTEXT_TEMPLATE = "{now}。你手上没有可靠的待办信息，不要提起或编造任何具体的待办、截止日期、明天的安排。"


def _already_sent_today(db: Session, user_id: int) -> bool:
    """当天（东八区）是否已发过睡前提醒。"""
    date_key = local_delivery_date()
    key = daily_generation_key("bedtime_reminder", date_key)
    return LetterStore(db).get_generated(user_id, key) is not None


def generate_bedtime_reminder(db: Session, user_id: int) -> Letter | None:
    """由当前激活桌宠 agent 生成一条睡前提醒并落库为信箱来信。

    返回落库的 Letter；当天已发过或统一额度已满时返回 None。
    """
    store = LetterStore(db)
    date_key = local_delivery_date()
    generation_key = daily_generation_key("bedtime_reminder", date_key)
    if store.get_generated(user_id, generation_key) is not None:
        logger.info("[bedtime] user %d already reminded today, skip", user_id)
        return None
    if not store.has_daily_capacity(user_id, date_key):
        logger.info("[bedtime] user %d reached daily mailbox limit, skip", user_id)
        return None

    pet = PetStore(db).get_active(user_id)
    pet_prompt = pet.system_prompt if pet is not None else None

    # 经当前桌宠 agent 生成正文（run_companion 内部含 BASE_PERSONA + 桌宠人格层）
    body = run_companion(
        "free_chat",
        [{"role": "user", "content": REMINDER_TRIGGER}],
        pet_prompt=pet_prompt,
        env_context=ENV_CONTEXT_TEMPLATE.format(now=now_context_text()),
    )
    if not body or not body.strip():
        return None

    letter = store.create_generated(
        user_id=user_id,
        generation_key=generation_key,
        delivery_date=date_key,
        type="reminder",
        title=DEFAULT_TITLE,
        body=body.strip(),
        pet_id=pet.id if pet is not None else None,
    )
    if letter is None:
        logger.info("[bedtime] user %d lost daily-slot race, skip", user_id)
        return None
    logger.info("[bedtime] reminder letter id=%d for user %d (pet=%s)",
                letter.id, user_id, pet.id if pet else None)
    return letter


def run_due_bedtime_reminders(db: Session) -> list[dict[str, Any]]:
    """调度入口（每分钟调用）：对到点且今日未发的活跃用户发睡前提醒。

    触发规则：当天东八区当前时刻 >= 用户设定时间，且今日尚未发过。
    （到点即发、晚开机则当日补发一次；幂等保证每天至多一条。）
    """
    from app.services.infra.engagement import reachable_users

    now = datetime.now(CST)
    now_minutes = now.hour * 60 + now.minute

    users = reachable_users(db, "bedtime_reminder")  # 跳过连续多天没打开 App 的用户，见 engagement.py
    results: list[dict[str, Any]] = []
    for user in users:
        pref = db.scalar(
            select(UserPreference).where(UserPreference.user_id == user.id)
        )
        if pref is None or not pref.sleep_reminder_time:
            continue
        try:
            hh, mm = pref.sleep_reminder_time.split(":")
            target = int(hh) * 60 + int(mm)
        except (ValueError, AttributeError):
            continue

        if now_minutes < target:
            continue  # 还没到点
        if _already_sent_today(db, user.id):
            continue

        try:
            letter = generate_bedtime_reminder(db, user.id)
            if letter is not None:
                results.append({"user_id": user.id, "sent": True, "letter_id": letter.id})
        except Exception as e:  # noqa: BLE001
            logger.error("[bedtime] user %d failed: %s", user.id, e)
            results.append({"user_id": user.id, "sent": False, "error": str(e)})
    return results
