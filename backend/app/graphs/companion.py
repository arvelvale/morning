"""桌宠回应 LangGraph 图。见 docs/api-design.md §4、§11。

输入：会话 mode + 历史消息（含刚落库的用户最新一句）+ 可选片段上下文。
输出：桌宠的一句回应。

产品口径（文档 §7 桌宠人设）：温柔、不催促、不评判、不诊断。四种 mode 只调语气侧重，
底色一致。非流式走 StateGraph（对齐 extractor.py 的 LangGraph 惯例）；流式直接用
model.stream 逐 token 吐（供 SSE），两条路复用同一套消息组装。
"""
from __future__ import annotations

import logging
from typing import Any, Generator, TypedDict

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langgraph.graph import END, StateGraph

from app.llm import get_chat_model

logger = logging.getLogger(__name__)


# ─── 人设底色 + 分 mode 侧重 ──────────────────────────────────────────────────

BASE_PERSONA = """\
你是喵灵的桌宠，用户此刻愿意对你说话。守则：
- 温柔、不催促、不评判、不说教；不做心理诊断，不把推测当事实。
- 说人话，短句，像朋友而非客服；可以有一点点俏皮，但不喧宾夺主。
- 先回应对方明确表达的感受，再聊事情本身；用户没问就不要给一堆建议或待办清单。
- 用第二人称"你"，中文口语。
"""

MODE_HINTS: dict[str, str] = {
    "free_chat": "现在是「自由聊聊」：轻松陪着聊，跟着用户的节奏走，不预设话题。",
    "brain_dump": "现在是「一股脑倒」：只承接、不整理、不追问细节，让用户尽管往外倒；"
                  "偶尔用一句轻轻的回应示意你在听。",
    "hard_thing": "现在是「说件放不下的事」：放慢，多倾听少建议，先陪伴情绪，"
                  "承认它的重量，不急着解决。",
    "review_fragment": "现在是「回看片段」：陪用户一起回看下面这段过去的记忆，"
                       "温柔地带他重新看看当时，而不是复盘对错。",
}

DEFAULT_HINT = MODE_HINTS["free_chat"]


def _build_messages(
    mode: str,
    history: list[dict],
    fragment_context: str | None = None,
    memory_context: str | None = None,
    pet_prompt: str | None = None,
    env_context: str | None = None,
) -> list:
    """组装 system + 历史消息（复用于流式与非流式）。

    提示词分层：BASE_PERSONA（红线，最外层不可覆盖） → 桌宠人格层（pet_prompt）
    → mode 侧重 → 记忆/片段上下文。
    """
    system = BASE_PERSONA
    if pet_prompt:
        system += "\n\n## 你的人格与角色\n" + pet_prompt
    system += "\n" + MODE_HINTS.get(mode, DEFAULT_HINT)
    if memory_context:
        system += (
            "\n\n下面是你对这位用户的一些记忆，只作背景参考、自然地融入对话，"
            "不要机械复述、更不要提及「记忆」「系统」「上下文」这类字眼。"
            "其中的长期理解可能不完整或已经过时，只能当作待验证线索；"
            "除非用户当下明确确认，否则用试探语气，绝不能断言用户是什么样的人：\n"
            + memory_context
        )
    if env_context:
        system += "\n\n## 此刻的环境（自然融入对话即可，别生硬报时报天气）\n" + env_context
    if mode == "review_fragment" and fragment_context:
        system += f"\n\n要一起回看的片段：\n{fragment_context}"
    system += (
        "\n\n真实操作由应用执行，并单独展示保存回执。你的回复只负责对话，"
        "请别说已经帮对方记下、存好、托着这件事或会提醒对方，也别复述保存回执。"
    )

    if any(m.get("images") for m in history):
        system += (
            "\n\n用户这次发了图片。先自然地说说你在图里看到了什么，再回应对方的心情或问题；"
            "看不清、拿不准的地方就直说，不要编造图里没有的细节，也不要对图里的人做评判。"
        )

    msgs: list = [SystemMessage(content=system)]
    for m in history:
        role = m.get("role")
        content = m.get("content", "")
        if role == "assistant":
            msgs.append(AIMessage(content=content))
            continue
        # user 及其它一律当作用户输入。images：要发给模型看的图片（data URL），由调用方挑好放进来。
        images = m.get("images") or []
        if images:
            parts: list[dict] = [{"type": "text", "text": content}] if content else []
            parts += [{"type": "image_url", "image_url": {"url": url}} for url in images]
            msgs.append(HumanMessage(content=parts))
        else:
            msgs.append(HumanMessage(content=content))
    return msgs


# ─── State / Node（非流式，走 StateGraph）────────────────────────────────────

class ReplyState(TypedDict):
    mode: str
    history: list[dict[str, str]]
    fragment_context: str | None
    memory_context: str | None
    pet_prompt: str | None
    env_context: str | None
    reply: str
    error: str


def call_llm(state: ReplyState) -> dict:
    model = get_chat_model(temperature=0.7)
    messages = _build_messages(
        state["mode"], state["history"], state.get("fragment_context"),
        state.get("memory_context"), state.get("pet_prompt"), state.get("env_context"),
    )
    try:
        resp = model.invoke(messages)
        return {"reply": resp.content, "error": ""}
    except Exception as e:  # noqa: BLE001
        logger.error("Companion LLM call failed: %s", e)
        return {"reply": "", "error": str(e)}


def _build_graph():
    graph = StateGraph(ReplyState)
    graph.add_node("call_llm", call_llm)
    graph.set_entry_point("call_llm")
    graph.add_edge("call_llm", END)
    return graph.compile()


_reply_graph = _build_graph()


# ─── Public API ────────────────────────────────────────────────────────────

# 兜底：LLM 失败时的温和回应，不暴露技术错误（对齐 dump 的失败兜底原则）。
_FALLBACK = "这次没能回你，等会儿再试试吧。"


def run_companion(
    mode: str,
    history: list[dict[str, str]],
    fragment_context: str | None = None,
    memory_context: str | None = None,
    pet_prompt: str | None = None,
    env_context: str | None = None,
) -> str:
    """非流式：返回完整回应。LLM 失败返回温和兜底句。"""
    result = _reply_graph.invoke({
        "mode": mode,
        "history": history,
        "fragment_context": fragment_context,
        "memory_context": memory_context,
        "pet_prompt": pet_prompt,
        "env_context": env_context,
        "reply": "",
        "error": "",
    })
    if result.get("error") or not result.get("reply"):
        logger.warning("Companion fell back: %s", result.get("error"))
        return _FALLBACK
    return result["reply"]


def stream_companion(
    mode: str,
    history: list[dict[str, str]],
    fragment_context: str | None = None,
    memory_context: str | None = None,
    pet_prompt: str | None = None,
    env_context: str | None = None,
) -> Generator[str, None, None]:
    """流式：逐 token yield 文本增量（供 SSE）。失败时 yield 兜底句。"""
    model = get_chat_model(temperature=0.7)
    messages = _build_messages(mode, history, fragment_context, memory_context, pet_prompt, env_context)
    try:
        for chunk in model.stream(messages):
            delta = chunk.content
            if delta:
                yield delta
    except Exception as e:  # noqa: BLE001
        logger.error("Companion stream failed: %s", e)
        yield _FALLBACK
