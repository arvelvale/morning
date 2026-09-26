"""晚间来信：每晚 21:30（东八区）由桌宠主动写给用户的一封信。

产品口径：
- 结合信箱——生成物落库为 Letter（type=greeting），用户在信箱查看。
- 独立于 proactive 开关，每晚都尝试发。
- 无素材/首次无记忆也发通用问候；LLM 失败或当日两封额度已满时不发。

隐私底座（Property 9）：送进外部 LLM 的素材只取 depth=surface 记忆，
vulnerable/core/personal 深层记忆绝不进入 prompt、不外流。
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.llm import get_chat_model
from app.models.letter import Letter
from app.models.memory import MemoryItem
from app.services.mailbox.letter_store import (
    LetterStore,
    daily_generation_key,
    local_delivery_date,
)
from app.services.pet.pet_store import PetStore

logger = logging.getLogger(__name__)

# 东八区（产品面向国内用户，固定时区）
CST = timezone(timedelta(hours=8))

# 送进 prompt 的表层记忆上限（控制 token）
MAX_MATERIAL = 20

# 片场余温的回看窗口：傍晚前演完的当晚提，深夜演完的第二晚提
AFTERGLOW_WINDOW = timedelta(hours=36)

EVENING_SYSTEM_PROMPT = """\
你是喵灵的桌宠，正在夜里给主人写一封短短的晚间来信。
性格：温柔、不催促、不评判、不说教。像一个记得你今天点滴的老朋友。

要求：
- 结合下面「今天的碎片」自然地提一两件事，像顺口关心，不要罗列清单。
- 如果没有碎片（第一次见面或今天没记什么），就写一封轻轻的问候，欢迎主人、说说夜晚，不要提"没有记录"这类话。
- 语气口语、简短，全文 40–80 字，最多一个 emoji。
- 绝不催促主人做事、不评价对错、不给建议清单。
- 如果有「刚在片场演完的一幕」，那是主人放不下的一件事，刚刚在片场里走了一遍：
  这封信就围绕它，用一两句轻轻问问主人演完之后心里怎么样；不追问细节、不评价、不总结道理。

只输出 JSON，不要额外解释：
{"title": "不超过10字的信题", "body": "信的正文"}
"""


def _start_of_today_cst() -> datetime:
    """东八区今天 00:00，转 UTC 后返回。

    created_at 以 UTC 存储，SQLite 对带时区 ISO 字符串是字典序比较、
    不认偏移量，必须统一到 UTC 再比，否则跨日时段会多发/漏发。
    """
    now_cst = datetime.now(CST)
    start_cst = now_cst.replace(hour=0, minute=0, second=0, microsecond=0)
    return start_cst.astimezone(timezone.utc)


def _gather_material(db: Session, user_id: int) -> list[str]:
    """收集晚间来信素材：只取 depth=surface。

    优先当天记忆；当天没有则回落到全部表层记忆（最近 MAX_MATERIAL 条）。
    返回 content 文本列表（可能为空 = 首次/无素材）。
    """
    base = select(MemoryItem).where(
        MemoryItem.user_id == user_id,
        MemoryItem.depth == "surface",  # 隐私底座：深层不外流
        MemoryItem.is_latest == True,  # noqa: E712
        MemoryItem.is_forgotten == False,  # noqa: E712
    )

    # 先试当天（东八区）
    start = _start_of_today_cst()
    today_stmt = base.where(MemoryItem.created_at >= start).order_by(
        MemoryItem.created_at.desc()
    )
    items = list(db.scalars(today_stmt).all())

    # 当天没有 → 回落到全部表层记忆
    if not items:
        all_stmt = base.order_by(MemoryItem.created_at.desc()).limit(MAX_MATERIAL)
        items = list(db.scalars(all_stmt).all())

    # 片场余温单独处理（见 _pending_afterglow），不混进普通碎片
    return [m.content for m in items[:MAX_MATERIAL] if m.content and not _is_afterglow(m)]


def _is_afterglow(m: MemoryItem) -> bool:
    from app.services.scene.scene_service import AFTERGLOW_TAG
    return isinstance(m.entities, list) and AFTERGLOW_TAG in m.entities


def _pending_afterglow(db: Session, user_id: int) -> list[MemoryItem]:
    """最近演完、还没在晚间来信里提过的片场余温（表层记忆）。"""
    since = datetime.now(timezone.utc) - AFTERGLOW_WINDOW
    items = [
        m for m in db.scalars(
            select(MemoryItem).where(
                MemoryItem.user_id == user_id,
                MemoryItem.depth == "surface",
                MemoryItem.kind == "小结",
                MemoryItem.is_latest == True,  # noqa: E712
                MemoryItem.is_forgotten == False,  # noqa: E712
                MemoryItem.created_at >= since,
            ).order_by(MemoryItem.created_at.desc())
        ).all()
        if _is_afterglow(m)
    ]
    if not items:
        return []
    mentioned: set[int] = set()
    for letter in db.scalars(
        select(Letter).where(Letter.user_id == user_id, Letter.created_at >= since - AFTERGLOW_WINDOW)
    ).all():
        ids = (letter.attachment or {}).get("afterglow_ids")
        if isinstance(ids, list):
            mentioned.update(i for i in ids if isinstance(i, int))
    return [m for m in items if m.id not in mentioned]


def generate_evening_letter(db: Session, user_id: int) -> Letter | None:
    """为单个用户生成并落库一封晚间来信。

    返回落库的 Letter；LLM 失败或当日统一额度已满时返回 None（不发）。
    """
    # type 只表达展示类别；晚间信使用独立来源键，不再和早安 greeting 冲突。
    store = LetterStore(db)
    date_key = local_delivery_date()
    generation_key = daily_generation_key("evening_letter", date_key)
    existing = store.get_generated(user_id, generation_key)
    if existing is not None:
        logger.info("[evening] user %d already has today's letter, skip", user_id)
        return existing
    if not store.has_daily_capacity(user_id, date_key):
        logger.info("[evening] user %d reached daily mailbox limit, skip", user_id)
        return None

    material = _gather_material(db, user_id)
    if material:
        material_text = "\n".join(f"- {m}" for m in material)
    else:
        material_text = "（今天没有碎片）"
    afterglow = _pending_afterglow(db, user_id)
    if afterglow:
        material_text = (
            "刚在片场演完的一幕：\n" + "\n".join(f"- {m.content}" for m in afterglow[:2])
            + "\n\n" + material_text
        )

    try:
        llm = get_chat_model()
        resp = llm.invoke([
            {"role": "system", "content": EVENING_SYSTEM_PROMPT},
            {"role": "user", "content": f"今天的碎片：\n{material_text}"},
        ])
    except Exception as e:
        # LLM 调用失败时不发
        logger.error("[evening] LLM call failed for user %d: %s", user_id, e)
        return None

    title, body = _parse_letter(resp.content)

    pet = PetStore(db).get_active(user_id)
    letter = store.create_generated(
        user_id=user_id,
        generation_key=generation_key,
        delivery_date=date_key,
        type="greeting",
        title=title,
        body=body,
        pet_id=pet.id if pet is not None else None,
        # 记下这封信提过哪几条余温，之后不再重复提
        attachment={"afterglow_ids": [m.id for m in afterglow[:2]]} if afterglow else None,
    )
    if letter is None:
        logger.info("[evening] user %d lost daily-slot race, skip", user_id)
        return None
    logger.info("[evening] letter id=%d created for user %d", letter.id, user_id)
    return letter


def _parse_letter(raw: str) -> tuple[str, str]:
    """解析 LLM 输出为 (title, body)。

    LLM 调用已成功（有内容），故解析失败时用原文兜底，不放弃发送。
    """
    text = (raw or "").strip()
    # 容错：markdown 包裹的 JSON
    if text.startswith("```"):
        text = text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            title = str(parsed.get("title") or "").strip() or "晚安 🌙"
            body = str(parsed.get("body") or "").strip()
            if body:
                return title[:20], body
    except (json.JSONDecodeError, ValueError):
        pass
    # 解析失败：用原文当正文
    return "晚安 🌙", (raw or "").strip() or "今晚也辛苦了，早点休息。"


def run_evening_letters_all(db: Session) -> list[dict[str, Any]]:
    """对所有活跃用户生成晚间来信（定时任务入口）。"""
    from app.models.user import User

    users = list(db.scalars(select(User).where(User.is_active == True)).all())  # noqa: E712
    results: list[dict[str, Any]] = []
    for user in users:
        try:
            letter = generate_evening_letter(db, user.id)
            results.append({
                "user_id": user.id,
                "sent": letter is not None,
                "letter_id": letter.id if letter is not None else None,
            })
        except Exception as e:
            logger.error("[evening] user %d failed entirely: %s", user.id, e)
            results.append({"user_id": user.id, "sent": False, "error": str(e)})
    return results
