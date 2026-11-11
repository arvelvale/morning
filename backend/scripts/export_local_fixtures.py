"""导出「本地优先运行时」要逐字对齐的后端内容（提示词、消息组装、换路判定）。

用法（backend 目录）：uv run python scripts/export_local_fixtures.py
产物：
- frontend-demo/src/local/generated/petPresets.ts   预设桌宠（含人格提示词），TS 里直接 import
- frontend-demo/scripts/fixtures/companion-messages.json   _build_messages 的黄金输入输出
- frontend-demo/scripts/fixtures/llm-fallback.json          should_fallback 的判定表

后端提示词/规则改了就重跑本脚本，再跑 `npm run test:local`：对不上说明本地版需要同步。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

import httpx  # noqa: E402
import openai  # noqa: E402

from app.graphs.companion import BASE_PERSONA, MODE_HINTS, _FALLBACK, _build_messages  # noqa: E402
from app.llm import IMAGE_PLACEHOLDER, _FALLBACK_STATUS, should_fallback  # noqa: E402
from app.llm_keys import LLMKeyMissing  # noqa: E402
from app.services.pet.pet_presets import PET_PRESETS  # noqa: E402

FRONT = ROOT / "frontend-demo"


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8", newline="\n")
    print("wrote", path.relative_to(ROOT))


# ── 预设桌宠 ──
write(
    FRONT / "src/local/generated/petPresets.ts",
    "// 由 backend/scripts/export_local_fixtures.py 生成，不要手改。\n"
    "export interface PetPreset {\n  id: string;\n  name: string;\n  personality: string;\n  tone: string;\n"
    "  actions: string[];\n  system_prompt: string | null;\n}\n\n"
    "export const PET_PRESETS: PetPreset[] = "
    + json.dumps(PET_PRESETS, ensure_ascii=False, indent=2) + ";\n\n"
    "export const BASE_PERSONA = " + json.dumps(BASE_PERSONA, ensure_ascii=False) + ";\n\n"
    "export const MODE_HINTS: Record<string, string> = "
    + json.dumps(MODE_HINTS, ensure_ascii=False, indent=2) + ";\n\n"
    "export const COMPANION_FALLBACK = " + json.dumps(_FALLBACK, ensure_ascii=False) + ";\n"
    "export const IMAGE_PLACEHOLDER = " + json.dumps(IMAGE_PLACEHOLDER, ensure_ascii=False) + ";\n",
)

# ── 消息组装黄金用例 ──
pet_prompt = PET_PRESETS[0]["system_prompt"]
cases = [
    {"name": "free_chat 最简", "mode": "free_chat", "history": [{"role": "user", "content": "今天有点累"}]},
    {"name": "带桌宠人格", "mode": "free_chat", "pet_prompt": pet_prompt,
     "history": [{"role": "user", "content": "你好"}, {"role": "assistant", "content": "嗨"},
                 {"role": "user", "content": "在吗"}]},
    {"name": "hard_thing + 记忆 + 环境", "mode": "hard_thing", "pet_prompt": PET_PRESETS[1]["system_prompt"],
     "memory_context": "- [待办] 周五交报告\n- [情绪] 最近睡得不好",
     "env_context": "现在是 11 月 11 日晚上 22 点左右，用户在杭州，天气多云、气温 12°C。",
     "history": [{"role": "user", "content": "放不下一件事"}]},
    {"name": "review_fragment", "mode": "review_fragment", "fragment_context": "那天在海边看日落",
     "history": [{"role": "user", "content": "想回看一下"}]},
    {"name": "未知 mode 回落到自由聊聊", "mode": "voice_call", "history": [{"role": "user", "content": "喂"}]},
    {"name": "带图片", "mode": "free_chat", "history": [
        {"role": "user", "content": "看看这个", "images": ["data:image/jpeg;base64,AAAA"]}]},
    {"name": "只有图片没有文字", "mode": "free_chat", "history": [
        {"role": "user", "content": "", "images": ["data:image/png;base64,BBBB", "data:image/png;base64,CCCC"]}]},
]
ROLE = {"SystemMessage": "system", "AIMessage": "assistant", "HumanMessage": "user"}
golden = []
for c in cases:
    msgs = _build_messages(
        c["mode"], c["history"], c.get("fragment_context"), c.get("memory_context"),
        c.get("pet_prompt"), c.get("env_context"),
    )
    golden.append({
        "name": c["name"],
        "input": {k: c.get(k) for k in ("mode", "history", "fragment_context", "memory_context", "pet_prompt", "env_context")},
        "output": [{"role": ROLE[type(m).__name__], "content": m.content} for m in msgs],
    })
write(FRONT / "scripts/fixtures/companion-messages.json", json.dumps(golden, ensure_ascii=False, indent=1))

# ── 换路判定表 ──
req = httpx.Request("POST", "https://x.test")


def status_error(code: int) -> openai.APIStatusError:
    return openai.APIStatusError("x", response=httpx.Response(code, request=req), body=None)


table = [{"kind": "status", "status": code, "fallback": should_fallback(status_error(code))}
         for code in (200, 400, 401, 402, 403, 404, 408, 409, 422, 429, 500, 502, 503, 529)]
table += [
    {"kind": "connection", "fallback": should_fallback(openai.APIConnectionError(request=req))},
    {"kind": "timeout", "fallback": should_fallback(openai.APITimeoutError(request=req))},
    {"kind": "key_missing", "fallback": should_fallback(LLMKeyMissing("stepfun"))},
    {"kind": "other", "fallback": should_fallback(ValueError("x"))},
]
write(FRONT / "scripts/fixtures/llm-fallback.json",
      json.dumps({"fallback_status": sorted(_FALLBACK_STATUS), "cases": table}, ensure_ascii=False, indent=1))
