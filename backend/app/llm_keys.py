"""用户自带的模型密钥（BYOK）：只随请求进来，用完即弃，服务端不落库、不写日志。

口径（2026-11 产品决定）：
- 密钥存在用户手机上；每次请求用请求头带给后端，后端只在这一次请求里转交给模型服务商。
- 文字走路由：默认阶跃（step-3.7-flash），失败时退到 DeepSeek（见 app/llm.py）。
- 用户带了任何一把自己的 key，这次请求就**只用用户的 key**，不再碰服务端的 key
  （否则「自带 key」的人还是在花服务端的额度）。
- 没带 key 时用服务端 key（BYOK_REQUIRED=true 时不给用，直接报 LLMKeyMissing）。

为什么用 ContextVar：调模型的地方有 16 处、层层嵌套，逐层传参改动面太大。
密钥由最外层的纯 ASGI 中间件放进 ContextVar；Starlette 的线程池、流式生成器、
BackgroundTask 都在这次请求的上下文里跑，读到的是同一份。定时任务不在请求里，读到的是空。

密钥必须走加密连接：客户端只在 https（或本机调试地址）下才会带这两个请求头。
"""
from __future__ import annotations

from contextvars import ContextVar
from dataclasses import dataclass

HEADER_STEPFUN = b"x-stepfun-key"
HEADER_DEEPSEEK = b"x-deepseek-key"
MAX_KEY_LEN = 256
MIN_KEY_LEN = 8


class LLMKeyMissing(RuntimeError):
    """这次调用没有可用的密钥（用户没带，服务端也不提供）。provider: stepfun / deepseek / any。"""

    def __init__(self, provider: str = "any"):
        super().__init__(f"no api key available for {provider}")
        self.provider = provider


@dataclass(frozen=True)
class RequestKeys:
    stepfun: str | None = None
    deepseek: str | None = None

    @property
    def any(self) -> bool:
        return bool(self.stepfun or self.deepseek)

    def __repr__(self) -> str:  # 绝不把密钥打进日志 / 异常栈
        return f"RequestKeys(stepfun={'set' if self.stepfun else 'none'}, deepseek={'set' if self.deepseek else 'none'})"


_EMPTY = RequestKeys()
_request_keys: ContextVar[RequestKeys] = ContextVar("morning_request_keys", default=_EMPTY)


def clean_key(raw: str | bytes | None) -> str | None:
    """请求头里的 key：去空白；长度或字符不对的一律当作没带（不报错，免得把格式信息回显给调用方）。"""
    if raw is None:
        return None
    if isinstance(raw, bytes):
        try:
            raw = raw.decode("ascii")
        except UnicodeDecodeError:
            return None
    key = raw.strip()
    if not (MIN_KEY_LEN <= len(key) <= MAX_KEY_LEN):
        return None
    if not all(33 <= ord(ch) <= 126 for ch in key):  # 可见 ASCII，不含空格与控制字符
        return None
    return key


def current_keys() -> RequestKeys:
    return _request_keys.get()


def set_request_keys(keys: RequestKeys):
    """放进当前上下文，返回 token（用 reset_request_keys 还原）。测试与中间件用。"""
    return _request_keys.set(keys)


def reset_request_keys(token) -> None:
    _request_keys.reset(token)


def resolve_stepfun_key() -> str:
    """这次调用该用哪把阶跃 key；没有就抛 LLMKeyMissing。"""
    from app.config import get_settings

    keys = current_keys()
    if keys.any:
        if keys.stepfun:
            return keys.stepfun
        raise LLMKeyMissing("stepfun")  # 用户只带了 DeepSeek：语音、生图这些阶跃专属能力用不了
    s = get_settings()
    if s.byok_required or not s.stepfun_api_key:
        raise LLMKeyMissing("stepfun")
    return s.stepfun_api_key


def resolve_deepseek_key() -> str | None:
    """这次调用可用的 DeepSeek key（备用路由）；没有返回 None，不算错。"""
    from app.config import get_settings

    keys = current_keys()
    if keys.any:
        return keys.deepseek
    s = get_settings()
    if s.byok_required:
        return None
    return s.deepseek_api_key or None


class RequestKeysMiddleware:
    """纯 ASGI 中间件：把请求头里的密钥放进 ContextVar，请求结束后还原。http 与 websocket 都处理。"""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return
        stepfun = deepseek = None
        for name, value in scope.get("headers") or ():
            if name == HEADER_STEPFUN:
                stepfun = clean_key(value)
            elif name == HEADER_DEEPSEEK:
                deepseek = clean_key(value)
        if not (stepfun or deepseek):
            await self.app(scope, receive, send)
            return
        token = _request_keys.set(RequestKeys(stepfun=stepfun, deepseek=deepseek))
        try:
            await self.app(scope, receive, send)
        finally:
            _request_keys.reset(token)
