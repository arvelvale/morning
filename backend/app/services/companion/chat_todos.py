"""Identify and save concrete plans from the current chat turn."""
import logging
import re

from sqlalchemy import select, text

from app.db import SessionLocal
from app.graphs.extractor import run_extractor
from app.models.memory import Kind, MemoryItem
from app.models.user import User
from app.services.memory.memory_store import MemoryStore
from app.services.memory.temporal import has_specific_time, now_cst, parse_due_at, to_cst

logger = logging.getLogger(__name__)

# Skip small talk without a time or action cue to avoid a second model call on every turn.
_CUE = re.compile(
    r"今天|明早|明晚|明天|后天|今晚|今早|今夜|这[周星期]|本[周月]|下[周星期月个]|"
    r"周[一二三四五六日天末]|星期[一二三四五六日天]|[\d一二三四五六七八九十两][年月号点时]|\d[:：]\d|"
    r"等会|待会|过几天|月底|要去|要交|要做|得去|必须|约了|有个?面试|预约|提醒|待办|"
    r"帮我记|记一下|记下来|记下这|别忘|记得"
)


def capture_chat_todos(user_id: int, message: str) -> list[str]:
    """Return descriptions only for tasks confirmed in the todo store."""
    if message.startswith("（我在回复你刚写给我的信：") or not _CUE.search(message):
        return []

    now = now_cst()
    saved = []
    try:
        facts = run_extractor(message, now=now, todo_only=True)
        for fact in facts[:3]:
            title = fact["content"]
            evidence = fact["evidence"]
            if (fact["kind"] != Kind.todo.value or fact["layer"] != "episodic"
                    or fact["confidence"] < 0.85 or not isinstance(title, str)
                    or not isinstance(evidence, str) or not evidence.strip()
                    or evidence.strip() not in message):
                continue
            title = " ".join(title.split()).strip("。！! ")
            if not title or len(title) > 120:
                continue
            due = parse_due_at(fact["due_at"], fact["has_time"])
            if fact["due_at"] and due is None:
                continue
            if due is not None:
                local_due = to_cst(due)
                if local_due.date() < now.date() or (has_specific_time(due) and local_due < now):
                    continue

            with SessionLocal() as db:
                # Serialize auto-capture per user across workers. SQLite uses its writer lock.
                if db.get_bind().dialect.name == "sqlite":
                    db.execute(text("BEGIN IMMEDIATE"))
                elif db.scalar(select(User.id).where(User.id == user_id).with_for_update()) is None:
                    break
                pending = db.scalar(select(MemoryItem.id).where(
                    MemoryItem.user_id == user_id,
                    MemoryItem.kind == Kind.todo.value,
                    MemoryItem.is_latest.is_(True),
                    MemoryItem.is_forgotten.is_(False),
                    MemoryItem.content == title,
                    MemoryItem.due_date == due,
                    (MemoryItem.status == "pending") | MemoryItem.status.is_(None),
                ).limit(1))
                if pending is None:
                    MemoryStore(db).create(
                        user_id=user_id, layer="episodic", kind=Kind.todo.value,
                        depth=fact["depth"], content=title, status="pending", due_date=due,
                        confidence=fact["confidence"], actor="chat_todo",
                    )

            label = title
            if due is not None:
                label += f"（{local_due.month}月{local_due.day}日"
                if has_specific_time(due):
                    label += f" {local_due:%H:%M}"
                label += "）"
            if label not in saved:
                saved.append(label)
    except Exception:
        logger.warning("Chat todo capture failed for user %s", user_id, exc_info=True)
    return saved
