"""给 LangGraph 用的聊天模型工厂：文字模型走一个小路由，默认阶跃，备用 DeepSeek。

用法不变：
    from app.llm import get_chat_model
    model = get_chat_model(temperature=0.7)
    resp = model.invoke(messages)          # 或 for chunk in model.stream(messages)

路由规则（2026-11）：
- 第一条路：阶跃 step-3.7-flash（文字与图片理解共用）。
- 第二条路：DeepSeek（只有文字）。只在第一条路**失败**时才走：限流、服务端错误、超时、连不上、
  key 无效或欠费。请求本身有问题（400）不换路，换了也一样错。
- 流式回复只在「一个字都还没吐出来」时换路；吐到一半断了就照常抛错，不会接一段别的模型的话。
- DeepSeek 看不了图：换路时把图片换成一句「（用户发来了一张图片，现在看不了）」，不把图片数据发过去。
- 用哪把 key 见 app/llm_keys.py：用户带了自己的 key 就只用用户的。

限流说明：阶跃当前账号是阶梯限速（实测 RPM=10）。一次用户操作常会连打好几次
LLM（例：建场景 = 剧本 + 两段图 prompt + 视觉判定；推进 = 剧情 + 视觉判定），
加上每 5 分钟的主动信号扫描，很容易瞬时撞到 429。没有备用路由时把重试次数调高，
让 SDK 自己按指数退避重试；有备用路由时只重试 1 次就换路，别让用户干等。
调用方仍需保留兜底——两条路都失败还是会抛错。
"""
from __future__ import annotations

import logging
from typing import Any, Iterator, Optional

import openai
from langchain_openai import ChatOpenAI

from app.config import get_settings
from app.llm_keys import LLMKeyMissing, current_keys, resolve_deepseek_key

logger = logging.getLogger(__name__)

# openai SDK 对 429/5xx 会自动指数退避重试；默认 2 次对 RPM=10 的账号不够
DEFAULT_MAX_RETRIES = 5
# 有备用路由时第一条路的重试次数：失败了尽快换路
RETRIES_WITH_FALLBACK = 1
# 单次请求超时（秒）。留足退避空间，又不至于把 SSE 流挂死
DEFAULT_TIMEOUT = 60

# 这些状态码换一家可能就好了：key 无效 / 欠费 / 没权限 / 模型不存在 / 超时 / 冲突 / 限流
_FALLBACK_STATUS = frozenset({401, 402, 403, 404, 408, 409, 429})
# DeepSeek 不认的参数（阶跃 / OpenAI 专有），换路时去掉，免得被当成非法请求
_DEEPSEEK_UNSUPPORTED = frozenset({"reasoning_effort"})
IMAGE_PLACEHOLDER = "（用户发来了一张图片，现在看不了）"


def should_fallback(error: BaseException) -> bool:
    """这个错误值不值得换一条路再试。"""
    if isinstance(error, LLMKeyMissing):
        return True
    if isinstance(error, (openai.APIConnectionError, openai.APITimeoutError)):
        return True
    if isinstance(error, openai.APIStatusError):
        return error.status_code in _FALLBACK_STATUS or error.status_code >= 500
    return False


def _strip_images_from_content(content: Any) -> Any:
    """多模态 content（list）→ 纯文字；本来就是字符串的原样返回。"""
    if not isinstance(content, list):
        return content
    texts: list[str] = []
    had_image = False
    for part in content:
        if isinstance(part, dict):
            if part.get("type") == "text":
                texts.append(str(part.get("text") or ""))
            elif part.get("type") in ("image_url", "image"):
                had_image = True
        elif isinstance(part, str):
            texts.append(part)
    if had_image:
        texts.append(IMAGE_PLACEHOLDER)
    return "\n".join(t for t in texts if t)


def strip_images(messages: Any) -> Any:
    """把消息列表里的图片去掉（给不能看图的模型用）。不改原对象。"""
    if not isinstance(messages, (list, tuple)):
        return messages
    out = []
    for m in messages:
        if isinstance(m, dict):
            content = m.get("content")
            out.append({**m, "content": _strip_images_from_content(content)} if isinstance(content, list) else m)
        elif isinstance(getattr(m, "content", None), list):
            out.append(m.model_copy(update={"content": _strip_images_from_content(m.content)}))
        else:
            out.append(m)
    return out


class RoutedChatModel:
    """按顺序试几条路的聊天模型。只提供项目里用到的 invoke / stream 两个方法。"""

    def __init__(self, routes: list[tuple[str, Any]]):
        if not routes:
            raise LLMKeyMissing("any")
        self.routes = routes

    @property
    def providers(self) -> list[str]:
        return [name for name, _ in self.routes]

    @property
    def model_name(self) -> str:
        """第一条路（默认模型）的模型名；诊断脚本与测试用。"""
        return getattr(self.routes[0][1], "model_name", "")

    @staticmethod
    def _adapt(messages: Any, provider: str) -> Any:
        return strip_images(messages) if provider == "deepseek" else messages

    def invoke(self, messages: Any, **kwargs: Any) -> Any:
        last = len(self.routes) - 1
        for i, (name, model) in enumerate(self.routes):
            try:
                return model.invoke(self._adapt(messages, name), **kwargs)
            except Exception as e:  # noqa: BLE001
                if i == last or not should_fallback(e):
                    raise
                logger.warning("[llm-router] %s failed (%s), falling back to %s",
                               name, type(e).__name__, self.routes[i + 1][0])
        raise LLMKeyMissing("any")  # 走不到：routes 非空

    def stream(self, messages: Any, **kwargs: Any) -> Iterator[Any]:
        last = len(self.routes) - 1
        for i, (name, model) in enumerate(self.routes):
            started = False
            try:
                for chunk in model.stream(self._adapt(messages, name), **kwargs):
                    started = True
                    yield chunk
                return
            except Exception as e:  # noqa: BLE001
                if started or i == last or not should_fallback(e):
                    raise
                logger.warning("[llm-router] %s stream failed before first token (%s), falling back to %s",
                               name, type(e).__name__, self.routes[i + 1][0])


def get_chat_model(model: Optional[str] = None, **kwargs) -> RoutedChatModel:
    """返回按当前请求的密钥配好的路由模型。一把可用的 key 都没有时抛 LLMKeyMissing。"""
    s = get_settings()
    keys = current_keys()
    if keys.any:
        stepfun_key = keys.stepfun
    else:
        stepfun_key = None if s.byok_required else (s.stepfun_api_key or None)
    deepseek_key = resolve_deepseek_key()

    timeout = kwargs.pop("timeout", DEFAULT_TIMEOUT)
    explicit_retries = kwargs.pop("max_retries", None)
    has_fallback = bool(stepfun_key and deepseek_key)

    routes: list[tuple[str, Any]] = []
    if stepfun_key:
        retries = explicit_retries if explicit_retries is not None else (
            RETRIES_WITH_FALLBACK if has_fallback else DEFAULT_MAX_RETRIES)
        routes.append(("stepfun", ChatOpenAI(
            model=model or s.step_text_model,
            api_key=stepfun_key,
            base_url=s.stepfun_base_url,
            timeout=timeout,
            max_retries=retries,
            **kwargs,
        )))
    if deepseek_key:
        ds_kwargs = {k: v for k, v in kwargs.items() if k not in _DEEPSEEK_UNSUPPORTED}
        routes.append(("deepseek", ChatOpenAI(
            model=s.deepseek_model,
            api_key=deepseek_key,
            base_url=s.deepseek_base_url,
            timeout=timeout,
            max_retries=explicit_retries if explicit_retries is not None else 2,
            **ds_kwargs,
        )))
    return RoutedChatModel(routes)
