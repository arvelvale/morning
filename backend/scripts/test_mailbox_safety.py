"""P1-1～P1-4 回归：来信幂等/每日额度、expire 鉴权、遗忘 TTL 真删。

运行：cd backend && PYTHONUTF8=1 PYTHONPATH=. uv run python scripts/test_mailbox_safety.py
"""
from __future__ import annotations

import tempfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi.routing import APIRoute
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

import app.models  # noqa: F401  注册全部模型
from app.db import Base
from app.deps import get_current_user
from app.models.letter import Letter
from app.models.memory import MemoryHistory, MemoryItem
from app.models.signal import SignalEvent
from app.routers.mailbox.mailbox import router as mailbox_router
from app.services.mailbox.inbox import expire_ephemeral
from app.services.mailbox.letter_store import LetterStore, local_delivery_date
from app.services.memory.memory_store import MemoryStore
from app.services.signals.fusion import _deliver


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="morning-mailbox-") as tmp:
        db_path = Path(tmp) / "mailbox.db"
        engine = create_engine(
            f"sqlite:///{db_path}",
            connect_args={"check_same_thread": False, "timeout": 10},
        )
        Base.metadata.create_all(engine)
        Session = sessionmaker(bind=engine, expire_on_commit=False)

        # P1-1：相同展示 type、不同来源键不会互相吞掉；同一来源仍幂等。
        with Session() as db:
            store = LetterStore(db)
            morning = store.create_generated(
                user_id=1, generation_key="morning_greeting:2026-08-01",
                delivery_date="2026-08-01", type="greeting", title="早安", body="早。",
            )
            evening = store.create_generated(
                user_id=1, generation_key="evening_letter:2026-08-01",
                delivery_date="2026-08-01", type="greeting", title="晚安", body="晚。",
            )
            again = store.create_generated(
                user_id=1, generation_key="evening_letter:2026-08-01",
                delivery_date="2026-08-01", type="greeting", title="重复", body="重复。",
            )
            assert morning is not None and evening is not None
            assert again is not None and again.id == evening.id

            morning_todo = store.create_generated(
                user_id=2, generation_key="morning_reminder:2026-08-01",
                delivery_date="2026-08-01", type="reminder", title="待办", body="记得。",
            )
            bedtime = store.create_generated(
                user_id=2, generation_key="bedtime_reminder:2026-08-01",
                delivery_date="2026-08-01", type="reminder", title="睡前", body="休息。",
            )
            assert morning_todo is not None and bedtime is not None

        # P1-2：三个并发来源争用两个数据库槽位，最终不超过两封。
        def create_concurrently(index: int) -> int | None:
            with Session() as db:
                letter = LetterStore(db).create_generated(
                    user_id=3,
                    generation_key=f"parallel:{index}",
                    delivery_date="2026-08-01",
                    type="proactive",
                    title=f"并发 {index}",
                    body="测试",
                )
                return letter.id if letter is not None else None

        with ThreadPoolExecutor(max_workers=3) as pool:
            results = list(pool.map(create_concurrently, range(3)))
        with Session() as db:
            rows = list(db.scalars(select(Letter).where(Letter.user_id == 3)).all())
            assert len(rows) == 2, (results, rows)
            assert {row.delivery_slot for row in rows} == {1, 2}

        def create_same_key(_index: int) -> int | None:
            with Session() as db:
                letter = LetterStore(db).create_generated(
                    user_id=5,
                    generation_key="same-source:2026-08-01",
                    delivery_date="2026-08-01",
                    type="greeting",
                    title="同一来源",
                    body="测试",
                )
                return letter.id if letter is not None else None

        with ThreadPoolExecutor(max_workers=3) as pool:
            same_key_results = list(pool.map(create_same_key, range(3)))
        with Session() as db:
            same_key_rows = list(
                db.scalars(select(Letter).where(Letter.user_id == 5)).all()
            )
            assert len(same_key_rows) == 1, (same_key_results, same_key_rows)
            assert len(set(same_key_results)) == 1

        # proactive 的信箱投递也走统一额度；满额后降级气泡而不是丢消息。
        with Session() as db:
            store = LetterStore(db)
            today = local_delivery_date()
            for slot in range(2):
                assert store.create_generated(
                    user_id=6,
                    generation_key=f"seed:{slot}",
                    delivery_date=today,
                    type="greeting",
                    title="占位",
                    body="测试",
                ) is not None
            event = SignalEvent(
                user_id=6, signal_type="scheduled", score=1.0,
                evidence={"scenario": "morning_checkin"},
            )
            db.add(event)
            db.commit()
            db.refresh(event)
            delivery = _deliver(
                db,
                user_id=6,
                event=event,
                scenario="morning_checkin",
                ai={
                    "delivery_mode": "letter", "message": "早上好",
                    "title": "早安", "decision": "allow", "reason": "test",
                },
                decision_log_id=0,
            )
            assert delivery.channel == "bubble" and delivery.letter_id is None

        # P1-3：全库清理端点必须经过登录用户依赖。
        expire_route = next(
            route for route in mailbox_router.routes
            if isinstance(route, APIRoute) and route.path == "/api/v1/mailbox/expire"
        )
        assert any(dep.call is get_current_user for dep in expire_route.dependant.dependencies)

        # P1-4：已软删除的 TTL 记忆到期后，记忆行与历史行都被物理删除。
        with Session() as db:
            item = MemoryStore(db).create(
                user_id=4, layer="episodic", kind="情绪", depth="surface",
                content="含原始细节", surface_text="一段寄存内容", raw_ref="逐字原文",
                expires_at=datetime.now(timezone.utc) - timedelta(minutes=1), actor="test",
            )
            item_id = item.id
            MemoryStore(db).forget(item_id, reason="用户删除", actor="test")
            assert db.get(MemoryItem, item_id).is_forgotten
            assert expire_ephemeral(db) == 1
            assert db.get(MemoryItem, item_id) is None
            assert not db.scalars(
                select(MemoryHistory).where(MemoryHistory.memory_id == item_id)
            ).all()

        engine.dispose()

    print("P1-1～P1-4 mailbox safety: ALL PASS")


if __name__ == "__main__":
    main()
