"""候选片段冒烟：需先启动服务。
    MORNING_PORT=8020 PYTHONPATH=. PYTHONUTF8=1 uv run python scripts/candidate_smoke.py
覆盖：列表(排除原始倾倒root) / 次日提醒(只取往日) / confirm / dismiss。
"""
import datetime as dt
import os
import uuid

import httpx

from app.db import SessionLocal
from app.models.memory import MemoryItem
from app.services.memory.memory_store import MemoryStore

BASE = f"http://127.0.0.1:{os.environ.get('MORNING_PORT', '8000')}/api/v1"


def main() -> None:
    with httpx.Client(timeout=30) as c:
        u = f"cand_{uuid.uuid4().hex[:8]}"
        r = c.post(f"{BASE}/auth/register", json={"username": u, "password": "secret123"})
        assert r.status_code == 201, r.text
        auth = {"Authorization": f"Bearer {r.json()['access_token']}"}
        uid = c.get(f"{BASE}/users/me", headers=auth).json()["id"]

        db = SessionLocal()
        try:
            store = MemoryStore(db)
            today = store.create(user_id=uid, layer="episodic", kind="片段", depth="surface",
                                 content="今天想起高中那次演讲", surface_text="今天想起高中那次演讲",
                                 raw_ref=None, actor="test")
            yday = store.create(user_id=uid, layer="episodic", kind="片段", depth="surface",
                                content="昨晚梦到和老友重逢", surface_text="昨晚梦到和老友重逢",
                                raw_ref=None, actor="test")
            # backdate 到昨天，触发"次日提醒"
            db.get(MemoryItem, yday.id).created_at = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=1)
            db.commit()
            # 原始倾倒 root（带 raw_ref）→ 必须被候选列表排除
            store.create(user_id=uid, layer="episodic", kind="片段", depth="surface",
                         content="[原始倾倒] ...", surface_text="一段倾诉", raw_ref="raw text", actor="test")
            tid, yid = today.id, yday.id
        finally:
            db.close()

        items = c.get(f"{BASE}/candidates", headers=auth).json()
        print("[list] count =", len(items), "(应为2，排除原始倾倒root)")
        assert len(items) == 2 and {tid, yid} <= {i["id"] for i in items}

        detail = c.get(f"{BASE}/candidates/{tid}", headers=auth).json()
        print("[detail] id =", detail["id"], "content =", detail["content"][:20])
        assert detail["id"] == tid

        rem = c.get(f"{BASE}/reminders", headers=auth).json()
        print("[reminders] candidate_count =", rem["candidate_count"], "(应为1，只昨天那条)")
        assert rem["candidate_count"] == 1 and rem["candidates"][0]["memory_id"] == yid

        r = c.post(f"{BASE}/candidates/{tid}/confirm", headers=auth)
        print("[confirm]", r.status_code, r.json().get("status"))
        assert r.status_code == 200 and r.json()["status"] == "confirmed"
        assert len(c.get(f"{BASE}/candidates", headers=auth).json()) == 1

        r = c.delete(f"{BASE}/candidates/{yid}", headers=auth)
        print("[dismiss]", r.status_code)
        assert r.status_code == 204
        assert len(c.get(f"{BASE}/candidates", headers=auth).json()) == 0

    print("\nCANDIDATE SMOKE PASSED ✅")


if __name__ == "__main__":
    main()
