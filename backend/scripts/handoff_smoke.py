"""交接信冒烟：需先启动服务（用 MORNING_PORT 指定端口）。

    MORNING_PORT=8010 uv run python scripts/handoff_smoke.py
覆盖：直接落库两封（模拟切换桌宠生成）→ 列表(倒序) / 详情 / 404 / 无token / 用户隔离。
"""
import os
import uuid

import httpx

from app.db import SessionLocal
from app.services.pet.handoff_store import HandoffStore

BASE = f"http://127.0.0.1:{os.environ.get('MORNING_PORT', '8000')}/api/v1"


def main() -> None:
    with httpx.Client(timeout=30) as c:
        u = f"petowner_{uuid.uuid4().hex[:8]}"
        r = c.post(f"{BASE}/auth/register", json={"username": u, "password": "secret123"})
        assert r.status_code == 201, r.text
        auth = {"Authorization": f"Bearer {r.json()['access_token']}"}
        uid = c.get(f"{BASE}/users/me", headers=auth).json()["id"]

        # 直接落库两封交接信（模拟 PUT /pets/active 切换桌宠时生成）
        db = SessionLocal()
        try:
            store = HandoffStore(db)
            store.create(user_id=uid, from_pet_name="团子", to_pet_name="麻薯",
                         summary="最近计划偏多、睡得晚，别催他，先陪着就好。")
            h2 = store.create(user_id=uid, from_pet_name="麻薯", to_pet_name="布丁",
                              summary="这周情绪平稳了些，有个写作灵感在酝酿。")
        finally:
            db.close()

        r = c.get(f"{BASE}/handoffs", headers=auth)
        print("[list]", r.status_code, "count =", len(r.json()))
        assert r.status_code == 200 and len(r.json()) == 2
        assert r.json()[0]["id"] == h2.id, "应按时间倒序，最新在前"

        r = c.get(f"{BASE}/handoffs/{h2.id}", headers=auth)
        print("[detail]", r.status_code, "->", r.json()["summary"])
        assert r.status_code == 200 and r.json()["to_pet_name"] == "布丁"

        r = c.get(f"{BASE}/handoffs/999999", headers=auth)
        print("[404]", r.status_code)
        assert r.status_code == 404

        r = c.get(f"{BASE}/handoffs")
        print("[no-token]", r.status_code)
        assert r.status_code in (401, 403)

        u2 = f"petowner_{uuid.uuid4().hex[:8]}"
        r = c.post(f"{BASE}/auth/register", json={"username": u2, "password": "secret123"})
        auth2 = {"Authorization": f"Bearer {r.json()['access_token']}"}
        r = c.get(f"{BASE}/handoffs", headers=auth2)
        print("[isolation]", r.status_code, "count =", len(r.json()))
        assert r.status_code == 200 and len(r.json()) == 0

    print("\nALL HANDOFF SMOKE PASSED ✅")


if __name__ == "__main__":
    main()
