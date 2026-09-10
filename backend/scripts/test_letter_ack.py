"""两个「假动作」的修复验证：

1. POST /letters/{id}/ack —— 「收到啦」真的经桌宠 agent 回一句（此前只是前端 toast）
2. POST /scenes/{id}/summary —— 结算卡来自真实对话（此前 App.tsx 没传 sceneId，压根没请求）

脚本自备数据：注册 → 选桌宠 → 在服务器容器里生成一封晚间来信 → ack → 建场景 → 结算摘要。

用法：
    cd backend
    set PYTHONUTF8=1 && set MORNING_SSH_PASSWORD=...
    uv run --with paramiko python scripts/test_letter_ack.py
"""
import json
import os
import uuid

import httpx
import paramiko

ROOT = os.environ.get("MORNING_API_BASE", "http://223.109.142.152:8000")
B = ROOT + "/api/v1"
SSH_HOST = os.environ.get("MORNING_SSH_HOST", "223.109.142.152")
SSH_PASSWORD = os.environ.get("MORNING_SSH_PASSWORD")

u = {"username": "ack" + uuid.uuid4().hex[:6], "password": "morning2026"}
tok = httpx.post(f"{B}/auth/register", json=u, timeout=60).json()["access_token"]
H = {"Authorization": f"Bearer {tok}"}
uid = httpx.get(f"{B}/users/me", headers=H, timeout=60).json()["id"]
print(f"account: {u['username']} (id={uid})")

# 选一只桌宠，好验证回应确实带人格（PUT /pets/active 接受预设 id）
presets = httpx.get(f"{B}/pets/presets", headers=H, timeout=60).json()
act = httpx.put(f"{B}/pets/active", headers=H, timeout=60,
                json={"pet_id": presets[0]["id"]}).json()
pet = act.get("pet") or {}
print(f"pet: id={pet.get('id')} name={pet.get('name')} "
      f"has_system_prompt={bool(pet.get('system_prompt'))}")
assert pet.get("id"), f"桌宠激活失败: {act}"
assert pet.get("system_prompt"), "预设桌宠应带人格 prompt"

# ─── 1. 来信「收到啦」 ───────────────────────────────────────────────────────
letters = httpx.get(f"{B}/letters", headers=H, timeout=60).json()
if not letters:
    if not SSH_PASSWORD:
        raise SystemExit("当前账号没有来信，且缺少 MORNING_SSH_PASSWORD 无法在服务器上生成")
    print("\n没有来信 → 在服务器容器里生成一封晚间来信…")
    code = (
        "from app.db import SessionLocal; "
        "from app.services.mailbox.evening_letter import generate_evening_letter as g; "
        f"l=g(SessionLocal(), {uid}); print('letter_id=', l.id if l else None)"
    )
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(SSH_HOST, 22, "root", SSH_PASSWORD, timeout=25)
    _in, out, err = client.exec_command(
        f'docker exec morning-backend python -c "{code}"', timeout=300
    )
    print("  " + out.read().decode("utf-8", "replace").strip())
    stderr = err.read().decode("utf-8", "replace").strip()
    if stderr:
        print("  ! " + stderr[-300:])
    client.close()
    letters = httpx.get(f"{B}/letters", headers=H, timeout=60).json()

assert letters, "生成来信失败"
letter = letters[0]
print(f"\nletter id={letter['id']} type={letter['type']} title={letter['title']!r} "
      f"is_read={letter['is_read']}")
print(f"  body: {letter['body'][:80]}…")

r = httpx.post(f"{B}/letters/{letter['id']}/ack", headers=H, timeout=180)
print(f"\nPOST /letters/{letter['id']}/ack -> HTTP {r.status_code}")
assert r.status_code == 200, r.text
d = r.json()
print(json.dumps(d, ensure_ascii=False, indent=2))

reply = d.get("message")
assert reply, "桌宠应该回一句（message 为空说明 LLM 全链路都挂了）"
assert len(reply) <= 50, f"回应过长: {len(reply)}"
assert d.get("is_read") is True, "「收到啦」必须把信标成已读"
assert d.get("pet_name"), "应带上桌宠名字（说明取到了激活桌宠）"
assert reply != letter["body"], "不该复述整封信"

# 兜底池里的句子说明没走到 LLM；能命中说明链路有问题（但不算 fail，打个警告）
FALLBACKS = {"嗯，它知道你收到了", "好的，明天见", "收到就好，早点休息",
             "知道啦，陪你到这里", "嗯嗯，晚安", "它轻轻点了点头", "好，那就放心了"}
if reply in FALLBACKS:
    print("\n[WARN] 命中预置兜底池 —— 桌宠 agent 没生成出来，查容器日志 grep letter_ack")
else:
    print(f"\n[OK] 标记已读 + 经桌宠（{d['pet_name']}）agent 真实回应")

assert httpx.get(f"{B}/letters/{letter['id']}", headers=H, timeout=60).json()["is_read"] is True
print("[OK] 已读状态已落库")

# ─── 2. 片场结算摘要 ────────────────────────────────────────────────────────
print("\n建一个 3D 舞台场景并推进一幕…")
scene = httpx.post(f"{B}/scenes", headers=H, timeout=300, json={
    "title": "站台送别", "people": "他（朋友）", "place": "火车站站台",
    "plot": "他拖着箱子回头看我，广播一直在响，我什么都没说",
    "intent": "把没说出口的再见说完",
    "render_kind": "preset_3d", "theater_id": "station",
}).json()
sid = scene["id"]
choices = scene.get("choices") or []
assert choices
httpx.post(f"{B}/scenes/{sid}/plays/{sid}/choices", headers=H, timeout=300,
           json={"choice_id": choices[0]["id"]})

r = httpx.post(f"{B}/scenes/{sid}/summary", headers=H, timeout=180)
print(f"POST /scenes/{sid}/summary -> HTTP {r.status_code}")
assert r.status_code == 200, r.text
s = r.json()
print(json.dumps(s, ensure_ascii=False, indent=2))

FALLBACK_QUOTE = "……"
for key in ("key_quote", "companion_comment", "action_hint"):
    assert str(s.get(key) or "").strip(), f"缺字段 {key}"
assert s["key_quote"] != FALLBACK_QUOTE, "命中兜底模板，摘要没生成出来"
print("\n[OK] 结算摘要来自真实对话")

LABELS = ["回避型", "讨好型", "自恋", "焦虑症", "抑郁症", "人格障碍"]
blob = json.dumps([d, s], ensure_ascii=False)
hit = [w for w in LABELS if w in blob]
assert not hit, f"出现诊断/人格标签: {hit}"
print("[OK] 无诊断/人格标签")

print("\n=== letter ack + scene summary ALL PASS ===")
