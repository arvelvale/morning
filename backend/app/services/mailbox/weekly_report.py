"""每周周报：每周日（东八区）由桌宠写给用户的一封「本周小结」信。

产品口径：
- 落库为 Letter（type=weekly），用户在信箱查看，与晚安信同一入口。
- 聚合本周素材：情绪走向、完成的待办、被珍藏的片刻——像老朋友帮你回望这一周。
- 独立于 proactive 开关，每周日都尝试发；LLM 失败或当日两封额度已满时不发。
- 幂等：本周已有周报则跳过（防重启/重复触发）。

隐私底座（Property 9）：送进外部 LLM 的素材只取 depth=surface 记忆；
被焚的原始倾诉（raw_ref）本就不在素材里，周报绝不含原话。
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
from app.services.mailbox.letter_store import LetterStore, local_delivery_date
from app.services.pet.pet_store import PetStore

logger = logging.getLogger(__name__)

CST = timezone(timedelta(hours=8))
WINDOW_DAYS = 7
MAX_MATERIAL = 30

WEEKLY_SYSTEM_PROMPT = """\
你是喵灵的桌宠，正在周末给主人写一封「本周小结」的信，陪 ta 回望这一周。
性格：温柔、不催促、不评判、不说教。像一个记得你这一周点滴的老朋友。

要求：
- 结合下面「这周的碎片」自然地回顾，像聊天一样点到一两处情绪的起落、几件完成的事。
- 如果这周几乎没有碎片，就写一封轻轻的问候，说说周末、欢迎主人随时回来，不要提"没有记录"这类话。
- 语气口语、温暖，全文 80–140 字，最多一个 emoji。
- 绝不催促主人做事、不评价对错、不给建议清单、不打分。

只输出 JSON，不要额外解释：
{"title": "不超过12字的信题", "body": "信的正文"}
"""


def _week_start_cst() -> datetime:
    """本周窗口起点：当前时刻往前 WINDOW_DAYS 天（带时区，用于比较 created_at）。"""
    return datetime.now(CST) - timedelta(days=WINDOW_DAYS)


def _gather_material(db: Session, user_id: int) -> dict[str, Any]:
    """收集本周素材：只取 depth=surface（隐私底座：深层不外流）。

    返回 {"fragments": [...], "done_todos": [...], "emotion_count": n}。
    """
    since = _week_start_cst()
    base = select(MemoryItem).where(
        MemoryItem.user_id == user_id,
        MemoryItem.depth == "surface",
        MemoryItem.is_latest == True,  # noqa: E712
        MemoryItem.is_forgotten == False,  # noqa: E712
        MemoryItem.created_at >= since,
    )

    week_items = list(
        db.scalars(base.order_by(MemoryItem.created_at.desc())).all()
    )
    fragments = [m.content for m in week_items if m.content][:MAX_MATERIAL]
    done_todos = [
        m.content for m in week_items if m.kind == "待办" and m.status == "done" and m.content
    ]
    emotion_count = sum(1 for m in week_items if m.kind == "情绪")
    return {
        "fragments": fragments,
        "done_todos": done_todos,
        "emotion_count": emotion_count,
    }


def generate_weekly_report(db: Session, user_id: int) -> Letter | None:
    """为单个用户生成并落库一封周报。

    返回落库的 Letter；LLM 失败或当日统一额度已满时返回 None（不发）。
    """
    # 周报按自然周使用独立幂等键；每日额度仍由统一 store 约束。
    now_cst = datetime.now(CST)
    iso_year, iso_week, _ = now_cst.isocalendar()
    generation_key = f"weekly_report:{iso_year}-W{iso_week:02d}"
    date_key = local_delivery_date(now_cst)
    store = LetterStore(db)
    existing = store.get_generated(user_id, generation_key)
    if existing is not None:
        logger.info("[weekly] user %d already has this week's report, skip", user_id)
        return existing
    if not store.has_daily_capacity(user_id, date_key):
        logger.info("[weekly] user %d reached daily mailbox limit, skip", user_id)
        return None

    material = _gather_material(db, user_id)
    parts: list[str] = []
    if material["fragments"]:
        parts.append("碎片：\n" + "\n".join(f"- {m}" for m in material["fragments"]))
    if material["done_todos"]:
        parts.append("完成的事：\n" + "\n".join(f"- {m}" for m in material["done_todos"]))
    if material["emotion_count"]:
        parts.append(f"这周记录了 {material['emotion_count']} 次情绪。")
    material_text = "\n\n".join(parts) if parts else "（这周几乎没有碎片）"

    try:
        llm = get_chat_model()
        resp = llm.invoke([
            {"role": "system", "content": WEEKLY_SYSTEM_PROMPT},
            {"role": "user", "content": f"这周的碎片：\n{material_text}"},
        ])
    except Exception as e:
        logger.error("[weekly] LLM call failed for user %d: %s", user_id, e)
        return None

    title, body = _parse_letter(resp.content)

    pet = PetStore(db).get_active(user_id)
    letter = store.create_generated(
        user_id=user_id,
        generation_key=generation_key,
        delivery_date=date_key,
        type="weekly",
        title=title,
        body=body,
        pet_id=pet.id if pet is not None else None,
    )
    if letter is None:
        logger.info("[weekly] user %d lost daily-slot race, skip", user_id)
        return None
    logger.info("[weekly] report id=%d created for user %d", letter.id, user_id)
    return letter


def _parse_letter(raw: str) -> tuple[str, str]:
    """解析 LLM 输出为 (title, body)；解析失败用原文兜底，不放弃发送。"""
    text = (raw or "").strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            title = str(parsed.get("title") or "").strip() or "这一周 🌱"
            body = str(parsed.get("body") or "").strip()
            if body:
                return title[:20], body
    except (json.JSONDecodeError, ValueError):
        pass
    return "这一周 🌱", (raw or "").strip() or "这一周也辛苦了，周末好好歇歇。"


def run_weekly_reports_all(db: Session) -> list[dict[str, Any]]:
    """对所有活跃用户生成周报（定时任务入口）。"""
    from app.services.infra.engagement import reachable_users

    users = reachable_users(db, "weekly_report")  # 跳过连续多天没打开 App 的用户，见 engagement.py
    results: list[dict[str, Any]] = []
    for user in users:
        try:
            letter = generate_weekly_report(db, user.id)
            results.append({
                "user_id": user.id,
                "sent": letter is not None,
                "letter_id": letter.id if letter is not None else None,
            })
        except Exception as e:
            logger.error("[weekly] user %d failed entirely: %s", user.id, e)
            results.append({"user_id": user.id, "sent": False, "error": str(e)})
    return results
