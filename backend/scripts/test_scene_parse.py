"""片场「场景整理 / 角色整理」冒烟：确认走 LLM、不编造缺失字段、不贴人格标签。

用法：cd backend && set PYTHONUTF8=1 && uv run python scripts/test_scene_parse.py
默认打线上（223.109.142.152:8000），本地测改 BASE。
"""
import json
import os
import uuid

import httpx

BASE = os.environ.get("MORNING_API_BASE", "http://223.109.142.152:8000") + "/api/v1"
T = 180

user = {"username": "sc_" + uuid.uuid4().hex[:8], "password": "pass1234"}
tok = httpx.post(f"{BASE}/auth/register", json=user, timeout=60).json()["access_token"]
H = {"Authorization": f"Bearer {tok}"}
print(f"user={user['username']}\n")

CASES = [
    ("A 完整描述（吵架后）",
     "我想回到上周和朋友吵架之后。地点在学校门口，她准备打车离开。"
     "她平时比较敏感，生气后会假装不在意，但其实很希望我先道歉。我想试着把她叫住。"),
    ("B 换个场景（医院）",
     "昨天在医院走廊，我爸刚做完检查坐在长椅上等报告。他一向不肯说自己难受，"
     "怕我担心就一直说没事。我想跟他说我可以陪着他，不用硬撑。"),
    ("C 信息很少", "我想重新说一次那天的话。"),
]

results = []
for name, text in CASES:
    r = httpx.post(f"{BASE}/scenes/parse", headers=H, json={"text": text}, timeout=T)
    d = r.json()
    results.append(d)
    print(f"--- {name}  HTTP {r.status_code}  parsed={d.get('parsed')}  missing={d.get('missing')}")
    print(f"    title={d.get('title')}  relation={d.get('relation') or '(空)'}")
    for it in d.get("items", []):
        print(f"    {it['label']:<8}= {it['value'] or '(空)'}")
    print()

# 断言：不同输入必须给出不同结果（证明真的过了 LLM，不是默认数据）
a, b, c = results
assert a["place"] != b["place"], "两段不同描述解析出同一个地点，说明没走 LLM"
assert a["place"] and b["place"], "完整描述应能抽到地点"
assert "学校" in a["place"], f"A 的地点应来自原文，实际 {a['place']}"
assert "医院" in b["place"] or "走廊" in b["place"], f"B 的地点应来自原文，实际 {b['place']}"
print("[OK] 不同描述 → 不同解析结果，确认走了 LLM")

# 断言：信息不足时留空而不是编造
assert not c["place"], f"C 没提地点，不该编造出 {c['place']}"
assert "place" in c["missing"], "C 应把 place 标进 missing"
print("[OK] 信息不足时留空并标 missing，没有编造")

# 断言：不出现人格标签（AGENTS.md 伦理红线）
LABELS = ["回避型", "讨好型", "自恋", "焦虑型", "边缘型", "抑郁症", "焦虑症", "人格障碍"]
r = httpx.post(f"{BASE}/scenes/parse-role", headers=H, timeout=T, json={
    "name": "妈妈", "relation": "父母",
    "desc": "她说话很直，不太会表达关心，我一提工作压力她就说别人都能扛你怎么不行，"
            "但每次我回家她都提前买好我爱吃的菜。",
})
role = r.json()
print(f"\n--- parse-role  HTTP {r.status_code}  parsed={role.get('parsed')}")
for t in role.get("traits", []):
    print(f"    · {t}")
assert role["traits"], "应能整理出行为倾向"
blob = "".join(role["traits"]) + json.dumps(results, ensure_ascii=False)
hit = [w for w in LABELS if w in blob]
assert not hit, f"输出里出现了人格标签/诊断词：{hit}"
print("[OK] 无人格标签、无诊断表达")

print("\n=== scene parse ALL PASS ===")
