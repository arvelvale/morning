"""候选 confirm 流式揭幕冒烟：需先启动服务。
    MORNING_PORT=8070 PYTHONPATH=. PYTHONUTF8=1 uv run python scripts/confirm_sse_smoke.py
断言：confirm?stream 收到 confirmed → 多个 token → choices → done(scene_id)，且场景落库。
"""
import json
import os
import uuid

import httpx

from app.db import SessionLocal
from app.services.memory.memory_store import MemoryStore

BASE = f"http://127.0.0.1:{os.environ.get('MORNING_PORT', '8000')}/api/v1"


def read_sse(resp):
    events, cur = [], None
    for line in resp.iter_lines():
        if not line:
            continue
        if line.startswith("event:"):
            cur = line[len("event:"):].strip()
        elif line.startswith("data:"):
            events.append((cur, json.loads(line[len("data:"):].strip())))
    return events


def main() -> None:
    with httpx.Client(timeout=90) as c:
        u = f"cfm_{uuid.uuid4().hex[:8]}"
        r = c.post(f"{BASE}/auth/register", json={"username": u, "password": "secret123"})
        assert r.status_code == 201, r.text
        auth = {"Authorization": f"Bearer {r.json()['access_token']}"}
        uid = c.get(f"{BASE}/users/me", headers=auth).json()["id"]

        db = SessionLocal()
        try:
            frag = MemoryStore(db).create(
                user_id=uid, layer="episodic", kind="片段", depth="personal",
                content="那次和爸爸大吵后摔门而出，其实心里很后悔",
                surface_text="和爸爸大吵后摔门而出，心里很后悔", entities=["爸爸"], actor="test",
            )
            fid = frag.id
        finally:
            db.close()

        with c.stream("POST", f"{BASE}/candidates/{fid}/confirm?stream=true", headers=auth) as r:
            assert r.status_code == 200, r.text
            evs = read_sse(r)

        kinds = [k for k, _ in evs]
        tokens = [d["delta"] for k, d in evs if k == "token"]
        confirmed = next((d for k, d in evs if k == "confirmed"), None)
        choices_ev = next((d for k, d in evs if k == "choices"), None)
        done = next((d for k, d in evs if k == "done"), None)
        print("[confirm stream] 事件序:", kinds[:3], "...", kinds[-2:])
        print(f"  {len(tokens)} 个 token, 开场:", "".join(tokens)[:56].replace(chr(10), " "))
        assert confirmed and confirmed["candidate_id"] == fid, "应先发 confirmed"
        assert len(tokens) >= 3 and "".join(tokens).strip(), "应逐字揭幕开场"
        assert choices_ev and choices_ev["choices"], "应有 choices"
        assert done and done.get("scene_id"), "应有 done+scene_id"

        # 场景已落库
        sc = c.get(f"{BASE}/scenes/{done['scene_id']}", headers=auth).json()
        assert sc["beats"] and sc["choices"], "场景应已落库"
        print("  scene:", sc["title"], "| beats:", len(sc["beats"]), "| choices:", len(sc["choices"]))

    print("\nCONFIRM SSE SMOKE PASSED ✅")


if __name__ == "__main__":
    main()
