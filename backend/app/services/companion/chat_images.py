"""聊天里的图片：校验、落盘、读回、删除。

口径（2026-11）：
- 用户在文字聊天里可以发图片，米露看图回应（step-3.7-flash 文字与图片理解共用）。
- **图片不进记忆**：记忆抽取只看用户打的字；图片内容不抽取、不写入记忆、不用于来信。
- 图片文件放在 settings.chat_image_dir/<user_id>/ 下，不挂到 /static：读取要登录，且只能读自己的。
- 删除会话时一并删掉它的图片文件。

限制（设计值 → 代码）：每条消息最多 3 张；单张解码后不超过 1.5 MB（客户端发之前会压到长边 1280）。
只收 JPEG / PNG / WebP，并核对文件头，声明的类型与实际内容对不上就拒收。
"""
from __future__ import annotations

import base64
import binascii
import logging
import re
import uuid
from pathlib import Path

from app.config import get_settings

logger = logging.getLogger(__name__)

MAX_IMAGES_PER_MESSAGE = 3
MAX_IMAGE_BYTES = 1_500_000
# base64 比原始数据长约 1/3；先按字符数挡一道，免得为超大输入白白解码
MAX_IMAGE_BASE64_CHARS = MAX_IMAGE_BYTES * 4 // 3 + 16

_EXT = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
_FILE_RE = re.compile(r"^[0-9a-f]{32}\.(jpg|png|webp)$")


class ImageRejected(ValueError):
    """图片不合要求；message 是可以直接给用户看的中文。"""


def sniff_mime(data: bytes) -> str | None:
    """按文件头认类型；认不出返回 None。"""
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def decode_images(items: list[tuple[str, str | None]]) -> list[tuple[bytes, str]]:
    """[(base64, 声明的 mime)] → [(原始字节, 实际 mime)]。任何一张不合要求就整体拒收。"""
    if len(items) > MAX_IMAGES_PER_MESSAGE:
        raise ImageRejected(f"一次最多发 {MAX_IMAGES_PER_MESSAGE} 张图片")
    out: list[tuple[bytes, str]] = []
    for raw, declared in items:
        text = (raw or "").strip()
        if text.startswith("data:"):  # 容忍客户端带了 data URL 前缀
            text = text.split(",", 1)[-1]
        if not text:
            raise ImageRejected("图片是空的，重新选一张试试")
        if len(text) > MAX_IMAGE_BASE64_CHARS:
            raise ImageRejected("图片太大了，换一张小一点的")
        try:
            data = base64.b64decode(text, validate=True)
        except (binascii.Error, ValueError):
            raise ImageRejected("图片没传完整，重新发一次试试") from None
        if len(data) > MAX_IMAGE_BYTES:
            raise ImageRejected("图片太大了，换一张小一点的")
        mime = sniff_mime(data)
        if mime is None:
            raise ImageRejected("只支持 JPG、PNG、WebP 图片")
        if declared and declared.lower() in _EXT and declared.lower() != mime:
            raise ImageRejected("图片格式有点问题，换一张试试")
        out.append((data, mime))
    return out


def _user_dir(user_id: int) -> Path:
    return Path(get_settings().chat_image_dir) / str(int(user_id))


def save_images(user_id: int, images: list[tuple[bytes, str]]) -> list[dict]:
    """落盘，返回写进 conversation_messages.attachments 的清单。"""
    if not images:
        return []
    folder = _user_dir(user_id)
    folder.mkdir(parents=True, exist_ok=True)
    saved: list[dict] = []
    try:
        for data, mime in images:
            name = f"{uuid.uuid4().hex}.{_EXT[mime]}"
            (folder / name).write_bytes(data)
            saved.append({"file": name, "mime": mime, "bytes": len(data)})
    except OSError:
        delete_images(user_id, saved)  # 写到一半失败：不留半截
        raise
    return saved


def image_path(user_id: int, file: str) -> Path | None:
    """附件文件名 → 磁盘路径。文件名不合规（防目录穿越）或文件不在了返回 None。"""
    if not isinstance(file, str) or not _FILE_RE.match(file):
        return None
    path = _user_dir(user_id) / file
    return path if path.is_file() else None


def as_data_url(user_id: int, attachment: dict) -> str | None:
    """读回成 data URL，给模型看。文件不在了返回 None（那张图就当没有）。"""
    path = image_path(user_id, str(attachment.get("file") or ""))
    if path is None:
        return None
    mime = attachment.get("mime") if attachment.get("mime") in _EXT else sniff_mime(path.read_bytes()[:16])
    if mime is None:
        return None
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode('ascii')}"


def delete_images(user_id: int, attachments: list[dict] | None) -> None:
    for a in attachments or []:
        path = image_path(user_id, str((a or {}).get("file") or ""))
        if path is None:
            continue
        try:
            path.unlink()
        except OSError as e:
            logger.warning("[chat-images] delete failed user=%s: %s", user_id, type(e).__name__)
