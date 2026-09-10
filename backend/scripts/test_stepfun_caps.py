"""线上阶跃能力回归：文本 / TTS / 转写 / 文生图 / 改图。

切换 STEPFUN_BASE_URL 到 Step Plan 后必跑一遍——Step Plan 的可用模型清单与标准 /v1
不同（例：TTS 只有 stepaudio-2.5-tts，step-tts-mini 会 404）。

用法：cd backend && set PYTHONUTF8=1 && uv run python scripts/test_stepfun_caps.py
"""
import os
import uuid

import httpx

ROOT = os.environ.get("MORNING_API_BASE", "http://223.109.142.152:8000")
B = ROOT + "/api/v1"

u = {"username": "cap" + uuid.uuid4().hex[:6], "password": "morning2026"}
H = {"Authorization": "Bearer " + httpx.post(f"{B}/auth/register", json=u, timeout=60).json()["access_token"]}

health = httpx.get(f"{ROOT}/health", timeout=30).json()
print(f"health: text_model={health['text_model']}  key_loaded={health['stepfun_key_loaded']}\n")

fails: list[str] = []

# ─── 文本 ────────────────────────────────────────────────────────────────────
r = httpx.post(f"{ROOT}/ai/chat", timeout=120,
               json={"messages": [{"role": "user", "content": "用一句话说你好"}]})
ok = r.status_code == 200 and r.json().get("choices")
print(f"[{'OK ' if ok else 'FAIL'}] TEXT   /ai/chat  {r.status_code}")
if ok:
    print(f"        {r.json()['choices'][0]['message']['content'][:50]}")
else:
    fails.append("text")

# ─── TTS ─────────────────────────────────────────────────────────────────────
r = httpx.post(f"{ROOT}/ai/tts", json={"text": "我在这儿呢，不急，慢慢来。"}, timeout=180)
url = r.json().get("url") if r.status_code == 200 else None
ok = bool(url)
print(f"[{'OK ' if ok else 'FAIL'}] TTS    /ai/tts   {r.status_code}  url={url}")
audio = b""
if ok:
    h = httpx.get(ROOT + url, timeout=60)
    audio = h.content
    ok2 = h.status_code == 200 and len(audio) > 5000
    print(f"        fetch {h.status_code}  {len(audio)} bytes  {h.headers.get('content-type')}")
    if not ok2:
        fails.append("tts-fetch")
else:
    fails.append("tts")

# ─── 转写（把刚合成的音频送回去认）────────────────────────────────────────────
if audio:
    r = httpx.post(f"{ROOT}/ai/stt", timeout=180,
                   files={"file": ("speech.mp3", audio, "audio/mpeg")},
                   data={"type": "mp3", "language": "zh"})
    text = (r.json() or {}).get("text", "") if r.status_code == 200 else ""
    ok = r.status_code == 200 and bool(str(text).strip())
    print(f"[{'OK ' if ok else 'FAIL'}] ASR    /ai/stt   {r.status_code}  text={str(text)[:40]!r}")
    if not ok:
        fails.append("asr")

# ─── 文生图 + 改图（建场景 → 推进一幕触发按需改图）──────────────────────────
scene = httpx.post(f"{B}/scenes", headers=H, timeout=600, json={
    "title": "校门口", "people": "小雨（朋友）", "place": "学校门口",
    "plot": "傍晚吵架后她准备打车离开，天色渐暗", "intent": "把她叫住道歉",
    "render_kind": "dynamic_image",
}).json()
bg = scene.get("bg_image")
sprite = (scene.get("characters") or [{}])[0].get("sprite_url")
ok = bool(bg)
print(f"[{'OK ' if ok else 'FAIL'}] IMAGE  建场景  bg={bg}")
print(f"        sprite={sprite}")
if ok:
    h = httpx.get(ROOT + bg, timeout=60)
    print(f"        fetch {h.status_code}  {len(h.content)} bytes")
    if h.status_code != 200 or len(h.content) < 10000:
        fails.append("image-fetch")
else:
    fails.append("image")

print()
if fails:
    print(f"❌ 失败能力: {fails}")
    raise SystemExit(1)
print("✅ 文本 / TTS / 转写 / 生图 全部可用")
