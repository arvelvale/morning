"""片场 SSE 流式冒烟：需先启动服务。
    MORNING_PORT=8050 PYTHONPATH=. PYTHONUTF8=1 uv run python scripts/theater_sse_smoke.py
断言：create?stream 收到 beat/choices/done(scene_id)；choices?stream 逐句 beat +
done(ended=false/closure_ready)。
"""
import json
import os
import uuid

import httpx

BASE = f"http://127.0.0.1:{os.environ.get('MORNING_PORT', '8000')}/api/v1"


def read_sse(resp) -> list[tuple[str, dict]]:
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
        u = f"sse_{uuid.uuid4().hex[:8]}"
        r = c.post(f"{BASE}/auth/register", json={"username": u, "password": "secret123"})
        assert r.status_code == 201, r.text
        auth = {"Authorization": f"Bearer {r.json()['access_token']}"}

        # 开场流式（逐字 token）
        with c.stream("POST", f"{BASE}/scenes?stream=true", headers=auth,
                      json={"title": "错过的道歉", "plot": "和室友闹别扭一直没开口", "intent": "想好好道个歉"}) as r:
            assert r.status_code == 200
            evs = read_sse(r)
        tokens = [d["delta"] for k, d in evs if k == "token"]
        narrative = "".join(tokens)
        done = next((d for k, d in evs if k == "done"), None)
        choices_ev = next((d for k, d in evs if k == "choices"), None)
        print(f"[create stream] {len(tokens)} 个 token 增量, 叙事长度={len(narrative)}")
        print("  叙事:", narrative[:60].replace(chr(10), " "))
        assert len(tokens) >= 3, "应有多段 token 增量（打字机）"
        assert narrative.strip(), "叙事非空"
        assert choices_ev and choices_ev["choices"], "应有 choices 事件"
        assert done and done.get("scene_id"), "应有 done+scene_id"
        sid = done["scene_id"]

        # 推进流式（逐字 token）
        cur = c.get(f"{BASE}/scenes/{sid}", headers=auth).json()
        cid = cur["choices"][0]["id"]
        with c.stream("POST", f"{BASE}/scenes/{sid}/choices?stream=true", headers=auth,
                      json={"choice_id": cid}) as r:
            assert r.status_code == 200
            evs2 = read_sse(r)
        tokens2 = [d["delta"] for k, d in evs2 if k == "token"]
        done2 = next((d for k, d in evs2 if k == "done"), None)
        print(f"[choices stream] {len(tokens2)} 个 token, 叙事:", "".join(tokens2)[:60].replace(chr(10), " "))
        print("  done:", done2)
        assert len(tokens2) >= 3 and "".join(tokens2).strip(), "推进应有多段 token"
        assert done2 and done2.get("ended") is False, "场景不应自动结束"
        assert "closure_ready" in done2, "应有可选收束提示"

        # 持久化确认
        after = c.get(f"{BASE}/scenes/{sid}", headers=auth).json()
        assert after["turn"] == 1 and after["beats"], "推进结果应已落库"

    print("\nTHEATER SSE SMOKE PASSED ✅")


if __name__ == "__main__":
    main()
