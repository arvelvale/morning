"""片场端到端冒烟：候选→confirm→场景→choices推进→settlement。需先启动服务。
    MORNING_PORT=8040 PYTHONPATH=. PYTHONUTF8=1 uv run python scripts/theater_smoke.py
LLM 内容不精确断言，只断结构非空与状态流转。
"""
import os
import uuid

import httpx

from app.db import SessionLocal
from app.services.memory.memory_store import MemoryStore

BASE = f"http://127.0.0.1:{os.environ.get('MORNING_PORT', '8000')}/api/v1"


def main() -> None:
    with httpx.Client(timeout=90) as c:
        u = f"th_{uuid.uuid4().hex[:8]}"
        r = c.post(f"{BASE}/auth/register", json={"username": u, "password": "secret123"})
        assert r.status_code == 201, r.text
        auth = {"Authorization": f"Bearer {r.json()['access_token']}"}
        uid = c.get(f"{BASE}/users/me", headers=auth).json()["id"]

        # 造一个候选片段
        db = SessionLocal()
        try:
            frag = MemoryStore(db).create(
                user_id=uid, layer="episodic", kind="片段", depth="personal",
                content="毕业那天想跟最好的朋友好好告别，却只挥了挥手",
                surface_text="毕业那天没能好好和好朋友告别", entities=["好朋友"], actor="test",
            )
            fid = frag.id
        finally:
            db.close()

        assert any(i["id"] == fid for i in c.get(f"{BASE}/candidates", headers=auth).json())

        # confirm → 生成场景
        r = c.post(f"{BASE}/candidates/{fid}/confirm", headers=auth)
        body = r.json()
        print("[confirm]", r.status_code, "scene:", bool(body.get("scene")))
        assert r.status_code == 200 and body["status"] == "confirmed"
        scene = body["scene"]
        assert scene and scene["beats"] and scene["choices"], "开场应含对白+选项"
        sid = scene["id"]
        print("  title:", scene["title"], "| choices:", [ch["label"] for ch in scene["choices"]])

        # 连续推进四轮；场景不因固定轮数自动结束
        for _ in range(4):
            cur = c.get(f"{BASE}/scenes/{sid}", headers=auth).json()
            if not cur["choices"]:
                break
            cid = cur["choices"][0]["id"]
            r = c.post(f"{BASE}/scenes/{sid}/choices", headers=auth, json={"choice_id": cid})
            assert r.status_code == 200, r.text
            nxt = r.json()
            print(f"  turn {nxt['turn']}: beats={len(nxt['beats'])} choices={len(nxt['choices'])}")

        # 结算
        r = c.post(f"{BASE}/scenes/{sid}/settlement", headers=auth,
                   json={"action_text": "下次好好告别", "card_text": "这一次，我把话说完了", "keep": True})
        print("[settlement]", r.status_code, r.json().get("status"))
        assert r.status_code == 200 and r.json()["status"] == "settled"
        assert r.json()["settlement"]["action_memory_id"] and r.json()["settlement"]["card_memory_id"]

        # 结算后不能再推进
        cur = c.get(f"{BASE}/scenes/{sid}", headers=auth).json()
        assert cur["status"] == "settled"

        # 手动创建场景
        r = c.post(f"{BASE}/scenes", headers=auth,
                   json={"title": "面试前夜", "plot": "明天要面试很紧张", "intent": "想练习自我介绍"})
        print("[manual create]", r.status_code, "beats:", len(r.json()["beats"]))
        assert r.status_code == 201 and r.json()["beats"]

    print("\nTHEATER SMOKE PASSED ✅")


if __name__ == "__main__":
    main()
