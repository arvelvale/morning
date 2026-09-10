"""片场 Plays 子资源冒烟：验证 /scenes/{id}/plays 全套接口。

需先启动服务：
    MORNING_PORT=8060 PYTHONPATH=. PYTHONUTF8=1 uv run python scripts/test_theater_plays.py
覆盖：开始体验 / 当前节点 / 提交选择推进 / 结算 / 越权与状态冲突。
"""
import os
import uuid

import httpx

BASE = f"http://127.0.0.1:{os.environ.get('MORNING_PORT', '8000')}/api/v1"


def assert_node_shape(node: dict) -> None:
    assert "background" in node
    assert "characters" in node and isinstance(node["characters"], list)
    assert "dialogue" in node and isinstance(node["dialogue"], list)
    assert "choices" in node and isinstance(node["choices"], list)


def main() -> None:
    with httpx.Client(timeout=90) as c:
        u = f"pl_{uuid.uuid4().hex[:8]}"
        r = c.post(f"{BASE}/auth/register", json={"username": u, "password": "secret123"})
        assert r.status_code == 201, r.text
        auth = {"Authorization": f"Bearer {r.json()['access_token']}"}

        # 主动创建场景（非流式，走 LLM 失败会兜底）
        r = c.post(f"{BASE}/scenes", headers=auth,
                   json={"title": "面试前夜", "people": "面试官", "place": "会议室",
                         "plot": "明天要面试很紧张", "intent": "想练习自我介绍"})
        assert r.status_code == 201, r.text
        scene = r.json()
        sid = scene["id"]
        print(f"[create scene] id={sid} choices={len(scene.get('choices') or [])}")
        assert scene["beats"] and scene.get("choices"), "开场应含对白与选项"

        # ─── POST /plays：开始体验 ──────────────────────────────────────────────
        r = c.post(f"{BASE}/scenes/{sid}/plays", headers=auth)
        assert r.status_code == 200, r.text
        play = r.json()
        pid = play["play_id"]
        print(f"[start play] play_id={pid} turn={play['turn']}")
        assert play["scene_id"] == sid
        assert play["status"] == "active"
        assert pid == str(sid)
        assert_node_shape(play["node"])
        assert play["node"]["choices"], "首节点应带可选回应"

        # ─── GET /plays/{playId}：当前节点 ──────────────────────────────────────
        r = c.get(f"{BASE}/scenes/{sid}/plays/{pid}", headers=auth)
        assert r.status_code == 200, r.text
        cur = r.json()
        assert cur["play_id"] == pid
        assert_node_shape(cur["node"])

        # 错误 play_id → 404
        r = c.get(f"{BASE}/scenes/{sid}/plays/nope", headers=auth)
        assert r.status_code == 404

        # ─── POST /plays/{playId}/choices：推进剧情 ─────────────────────────────
        choice_id = cur["node"]["choices"][0]["id"]
        r = c.post(f"{BASE}/scenes/{sid}/plays/{pid}/choices", headers=auth,
                   json={"choice_id": choice_id})
        assert r.status_code == 200, r.text
        nxt = r.json()
        print(f"[choice] turn {nxt['turn']} choices={len(nxt['node']['choices'])}")
        assert nxt["turn"] == 1
        assert_node_shape(nxt["node"])

        # 无效选项 → 422
        r = c.post(f"{BASE}/scenes/{sid}/plays/{pid}/choices", headers=auth,
                   json={"choice_id": "not_exist"})
        assert r.status_code == 422

        # ─── POST /plays/{playId}/settlement：结算 ──────────────────────────────
        r = c.post(f"{BASE}/scenes/{sid}/plays/{pid}/settlement", headers=auth,
                   json={"action_text": "睡前再练一遍自我介绍", "card_text": "我可以说得很清楚", "keep": True})
        assert r.status_code == 200, r.text
        body = r.json()
        print(f"[settlement] status={body['status']} action_id={body['settlement']['action_memory_id']}")
        assert body["status"] == "settled"
        assert body["play_id"] == pid
        assert body["settlement"]["action_memory_id"]
        assert body["settlement"]["card_memory_id"]

        # 结算后原场景状态同步 settled
        r = c.get(f"{BASE}/scenes/{sid}", headers=auth)
        assert r.json()["status"] == "settled"

        # 结算后不能再开始/选择
        r = c.post(f"{BASE}/scenes/{sid}/plays", headers=auth)
        assert r.status_code == 409
        r = c.post(f"{BASE}/scenes/{sid}/plays/{pid}/choices", headers=auth,
                   json={"choice_id": choice_id})
        assert r.status_code == 409

        # 越权访问
        tok2 = c.post(f"{BASE}/auth/register",
                      json={"username": f"pl_{uuid.uuid4().hex[:8]}", "password": "secret123"}).json()["access_token"]
        h2 = {"Authorization": f"Bearer {tok2}"}
        r = c.get(f"{BASE}/scenes/{sid}/plays/{pid}", headers=h2)
        assert r.status_code == 404
        r = c.post(f"{BASE}/scenes/{sid}/plays/{pid}/settlement", headers=h2,
                   json={"card_text": "x"})
        assert r.status_code == 404

    print("\nTHEATER PLAYS SMOKE PASSED ✅")


if __name__ == "__main__":
    main()
