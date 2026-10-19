"""AI 决策网关。

输入：信号 + 决策上下文；输出：allow / suppress、文案、投递方式。

设计要点：
- 允许 AI 主动 suppress——「不打扰」也是一种正确结果；
- 按信号类型注入不同的写作约束（驾车 ≤40 字且禁止任何需要操作手机的指令）；
- LLM 调用失败一律 suppress，宁可不发也不误打扰；
- 伦理红线：不诊断、不贴标签、不把推测当事实、不说教、不催促。
"""
from __future__ import annotations

import json
import logging
from typing import Any

from app.llm import get_chat_model
from app.services.signals.detectors import (
    SIGNAL_DRIVING,
    SIGNAL_HOLIDAY,
    SIGNAL_LOCATION_CHANGE,
    SIGNAL_SCHEDULED,
    SIGNAL_USAGE_ANOMALY,
    SIGNAL_WEATHER,
)

logger = logging.getLogger(__name__)

DELIVERY_MODES = {"bubble", "letter", "voice", "silent"}

SYSTEM_PROMPT = """\
你是喵灵桌宠的「主动触达决策器」。你要判断此刻是否值得主动对主人说一句话，
以及说什么。

产品性格：温柔、克制、不催促、不评判、不说教。像一个记得你点滴的老朋友。

硬约束（违反即视为错误输出）：
- 不做任何心理/医学诊断，不给人贴人格标签（如"你是回避型"）。
- 不把推测当事实。证据不足就用"好像/也许"，或者干脆 suppress。
- 不追问细节、不布置任务、不列建议清单。
- 只能引用「素材」里出现过的内容，不许编造主人的经历。
- 素材每条前标着记下它的日期，对照「本地时间」判断：已经过去的事不能说成「明天」「待会」，拿不准就不提。
- 「长期理解」只是用户可纠正的待验证线索；使用时必须用"好像/也许"，不可断言。
- 如果没有明显必要，就 suppress。少打扰永远比多打扰安全。

只输出 JSON，不要额外解释：
{"decision": "allow" 或 "suppress",
 "reason": "一句话说明为什么这样判断（给开发看的）",
 "message": "要对主人说的话，suppress 时为空字符串",
 "title": "不超过 10 字的短标题",
 "delivery_mode": "bubble | letter | voice | silent"}

delivery_mode 选择规则：
- bubble：桌宠气泡，日常轻量的一句话，默认选它
- letter：写进信箱的一封短信，适合节日祝福、周期性问候这类值得留存的内容
- voice：气泡 + 语音播报，适合主人不方便看屏幕时（如驾车）
- silent：不投递，suppress 时用它
"""

# 各信号类型的写作指令
INSTRUCTIONS: dict[str, str] = {
    SIGNAL_SCHEDULED: (
        "这是主人自己设定的陪伴时刻。写一句自然的问候，可以顺口提一件素材里的小事，"
        "不超过 40 字。没有素材就写一句轻轻的招呼，不要提「你没有记录」这类话。"
        "delivery_mode 用 bubble。"
    ),
    SIGNAL_HOLIDAY: (
        "今天是法定节假日（或假期前最后一个工作日）。写一句温暖克制的节日问候，"
        "不超过 40 字，不要喊口号、不要群发感。delivery_mode 用 letter。"
    ),
    SIGNAL_DRIVING: (
        "主人正在驾车。文案必须简短、温暖、不分散注意力，不超过 40 个字。"
        "严格禁止任何需要主人操作手机、查看屏幕、回复的内容。"
        "方向：安全提醒、路上的陪伴感。delivery_mode 必须用 voice。"
    ),
    SIGNAL_WEATHER: (
        "当地天气不太友好。写一句具体到天气的关心（带伞/加衣/少出门都可以），"
        "不超过 40 字。不要把主人的情绪归因于天气。delivery_mode 用 bubble。"
    ),
    SIGNAL_LOCATION_CHANGE: (
        "主人似乎换了城市。写一句不打探的问候（到了新地方、路上辛苦这类），"
        "不超过 40 字。绝对不要猜测主人为什么去那里。delivery_mode 用 bubble。"
    ),
    SIGNAL_USAGE_ANOMALY: (
        "主人的手机使用出现了异常模式（见证据）。这是最容易让人反感的场景："
        "绝不能说教、不能评判、不能提「你玩手机太久了」这类指责。"
        "只能是一句轻轻的、给出退路的关心，不超过 40 字。若证据薄弱就 suppress。"
        "delivery_mode 用 bubble。"
    ),
}

# 兜底文案（LLM 不可用时也不至于什么都发不出，仅用于 scheduled/holiday 这类低风险场景）
FALLBACK_MESSAGES: dict[str, tuple[str, str]] = {
    SIGNAL_SCHEDULED: ("在这儿", "我在这儿呢，不急，慢慢来。"),
    SIGNAL_HOLIDAY: ("节日好", "今天是个该松一松的日子，替你高兴。"),
}


def _safe_json_object(raw: str) -> dict[str, Any]:
    text = (raw or "").strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
        if text.lower().startswith("json"):
            text = text[4:].strip()
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else {}
    except (json.JSONDecodeError, ValueError):
        return {}


def _normalize(result: dict[str, Any], *, signal_type: str) -> dict[str, Any]:
    decision = str(result.get("decision") or "").strip().lower()
    if decision not in {"allow", "suppress"}:
        return {
            "decision": "suppress",
            "reason": "AI 未返回可解析的决策，按不打扰处理。",
            "message": "",
            "title": "",
            "delivery_mode": "silent",
        }

    message = str(result.get("message") or "").strip()
    if decision == "allow" and not message:
        return {
            "decision": "suppress",
            "reason": "AI 返回 allow 但文案为空。",
            "message": "",
            "title": "",
            "delivery_mode": "silent",
        }

    mode = str(result.get("delivery_mode") or "").strip().lower()
    if mode not in DELIVERY_MODES:
        mode = "voice" if signal_type == SIGNAL_DRIVING else "bubble"
    if decision == "suppress":
        mode = "silent"
    # 驾车场景强制语音 + 40 字硬截断（安全约束，不信任模型自觉）
    if signal_type == SIGNAL_DRIVING and decision == "allow":
        mode = "voice"
        message = message[:40]

    return {
        "decision": decision,
        "reason": str(result.get("reason") or "").strip() or "主动触达决策完成。",
        "message": message,
        "title": (str(result.get("title") or "").strip() or "桌宠")[:20],
        "delivery_mode": mode,
    }


def decide(context: dict[str, Any], *, signal_type: str, scenario: str) -> dict[str, Any]:
    """调 LLM 判定是否主动触达。失败 → suppress（宁可不发）。"""
    instruction = INSTRUCTIONS.get(signal_type, INSTRUCTIONS[SIGNAL_SCHEDULED])
    payload = {
        "场景": scenario,
        "信号": context.get("signal"),
        "本地时间": context.get("local_time"),
        "日期上下文": context.get("date_context"),
        "天气": context.get("weather"),
        "城市": context.get("city"),
        "运动状态": context.get("motion_state"),
        "手机使用摘要": context.get("usage_summary"),
        "桌宠": context.get("pet"),
        "素材": context.get("surface_material"),
        "长期理解": context.get("profile_context"),
        "写作要求": instruction,
    }
    try:
        llm = get_chat_model()
        resp = llm.invoke(
            [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
            ]
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("[signals] AI 决策失败 signal=%s err=%s", signal_type, e)
        return {
            "decision": "suppress",
            "reason": f"AI 决策失败，避免误打扰：{e}",
            "message": "",
            "title": "",
            "delivery_mode": "silent",
            "ai_failed": True,
        }

    normalized = _normalize(_safe_json_object(resp.content), signal_type=signal_type)
    normalized["raw"] = (resp.content or "")[:500]
    return normalized
