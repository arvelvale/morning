"""通用双向 WebSocket 中继——本层复用核心。

RN 端 <-> 本网关 <-> 阶跃 WS。连接阶跃时注入 Authorization（key 只在服务端，
前端永远拿不到）。`/ai/realtime` 与 `/ai/stt/stream` 都用它，只是上游 URL 和
连接时的首帧配置不同。
"""
import asyncio
import json
import logging
from typing import Any, Callable, Optional

from websockets.asyncio.client import connect
from websockets.exceptions import InvalidStatus, WebSocketException

from app.config import get_settings

logger = logging.getLogger(__name__)

# 上游转写事件 -> 角色映射（用于语音通话旁路落库）
_TRANSCRIPT_EVENT_ROLES: dict[str, str] = {
    "conversation.item.input_audio_transcription.completed": "user",
    "response.audio_transcript.done": "assistant",
    "response.text.done": "assistant",
}


async def close_with_error(
    client_ws,
    *,
    code: str,
    message: str,
    close_code: int = 1013,
    retryable: bool = True,
    retry_after_ms: int | None = None,
) -> None:
    """向已接受的下游连接发送稳定错误协议，然后尽力关闭连接。"""
    error: dict[str, Any] = {
        "code": code,
        "message": message,
        "retryable": retryable,
    }
    if retry_after_ms is not None:
        error["retry_after_ms"] = retry_after_ms
    try:
        await client_ws.send_text(json.dumps({"type": "error", "error": error}))
    except Exception:  # noqa: BLE001
        pass
    try:
        await client_ws.close(code=close_code)
    except Exception:  # noqa: BLE001
        pass


def extract_transcript(msg: str) -> tuple[str, str] | None:
    """从上游文本帧中提取转写内容。

    返回 (role, text)；非转写事件或内容为空返回 None。
    解析失败静默返回 None，绝不影响转发链路。

    兼容两类协议形态：
    - 显式转写事件（见 _TRANSCRIPT_EVENT_ROLES）；
    - conversation.item.created 中 role=user 且 content 携带 transcript/text。
    """
    try:
        data = json.loads(msg)
    except Exception:  # noqa: BLE001
        return None
    if not isinstance(data, dict):
        return None
    etype = data.get("type", "")

    role = _TRANSCRIPT_EVENT_ROLES.get(etype)
    if role is not None:
        text = data.get("transcript") or data.get("text") or ""
        if isinstance(text, str) and text.strip():
            return role, text.strip()
        return None

    if etype == "conversation.item.created":
        item = data.get("item")
        if isinstance(item, dict) and item.get("role") == "user":
            parts = item.get("content")
            if isinstance(parts, list):
                for part in parts:
                    if not isinstance(part, dict):
                        continue
                    text = part.get("transcript") or part.get("text") or ""
                    if isinstance(text, str) and text.strip():
                        return "user", text.strip()
    return None


async def relay(
    client_ws,
    upstream_url: str,
    on_open: Optional[dict[str, Any]] = None,
    on_upstream_text: Optional[Callable[[str], None]] = None,
) -> None:
    """双向泵消息，直到任一端断开。

    - client_ws: 已 accept 的 FastAPI WebSocket。
    - upstream_url: 阶跃 WS 完整地址（含必要 query）。
    - on_open: 连上上游后先发的一帧（如默认 session.update），可为空。
    - on_upstream_text: 旁路回调，每收到一条上游文本帧调用一次（同步、
      不得抛出影响转发；内部已兜底捕获）。用于转写落库等观察者场景。
    """
    # 用户这次连接带了自己的 key 就用用户的（WebSocket 握手头由 RequestKeysMiddleware 读进上下文）
    headers = get_settings().auth_header

    try:
        async with connect(upstream_url, additional_headers=headers, max_size=None) as up:
            if on_open is not None:
                await up.send(json.dumps(on_open))

            async def client_to_up() -> None:
                try:
                    while True:
                        msg = await client_ws.receive_text()
                        await up.send(msg)
                except Exception:
                    pass

            async def up_to_client() -> None:
                try:
                    async for msg in up:
                        if isinstance(msg, bytes):
                            await client_ws.send_bytes(msg)
                        else:
                            if on_upstream_text is not None:
                                try:
                                    on_upstream_text(msg)
                                except Exception:  # noqa: BLE001
                                    pass  # 旁路观察者绝不影响转发
                            await client_ws.send_text(msg)
                except Exception:
                    pass

            tasks = {asyncio.create_task(client_to_up()), asyncio.create_task(up_to_client())}
            try:
                _, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            finally:
                pending = {task for task in tasks if not task.done()}
                for task in pending:
                    task.cancel()
                if pending:
                    await asyncio.gather(*pending, return_exceptions=True)
    except InvalidStatus as exc:
        status = exc.response.status_code
        if status == 429:
            logger.warning("Upstream WebSocket rate limited the request (HTTP 429)")
            await close_with_error(
                client_ws,
                code="upstream_rate_limited",
                message="语音服务正在忙，请稍等几秒再试",
                retry_after_ms=3000,
            )
            return
        logger.warning("Upstream WebSocket rejected the request (HTTP %s)", status)
        await close_with_error(
            client_ws,
            code="upstream_rejected",
            message="语音服务暂时无法连接，请稍后重试",
        )
    except (OSError, TimeoutError) as exc:
        logger.warning("Upstream WebSocket connection failed: %s", type(exc).__name__)
        await close_with_error(
            client_ws,
            code="upstream_unavailable",
            message="语音服务暂时无法连接，请稍后重试",
        )
    except WebSocketException as exc:
        logger.warning("Upstream WebSocket protocol failed: %s", type(exc).__name__)
        await close_with_error(
            client_ws,
            code="upstream_unavailable",
            message="语音服务暂时无法连接，请稍后重试",
        )
