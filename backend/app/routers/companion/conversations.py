"""对话 Conversations REST 接口。见 docs/api-design.md §4。

文本对话 + 历史持久化。桌宠回应内部走 LangGraph（app/graphs/companion.py）。
- POST /conversations                开启对话
- GET  /conversations                历史列表
- GET  /conversations/{id}           详情 + 消息
- DELETE /conversations/{id}         删除会话 + 消息
- POST /conversations/{id}/messages  发消息（可带图片）→ 桌宠回应；?stream=true 走 SSE
- GET  /conversations/{id}/messages  消息分页
- GET  /conversations/{id}/messages/{mid}/images/{n}  读这条消息的第 n 张图片（要登录，只能读自己的）

图片只用于这次对话里让桌宠看图回应，不进记忆（见 services/companion/chat_images.py）。

实时语音：客户端走 WS /ai/stt/stream 转写后，以 mode=voice_call 建会话并在此发消息；
/ai/realtime 中继链路则由网关旁路落库，不经过本路由。
"""
import json
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response, status
from fastapi.responses import FileResponse, StreamingResponse
from starlette.background import BackgroundTask
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.orm import Session

from app.db import SessionLocal, get_db
from app.deps import get_current_user
from app.graphs.companion import run_companion, stream_companion
from app.models.conversation import ConversationMode, Message
from app.models.user import User
from app.services.companion.chat_images import (
    ImageRejected, as_data_url, decode_images, delete_images, image_path, save_images,
)
from app.services.companion.chat_todos import capture_chat_todos
from app.services.memory.context_builder import build as build_memory_context
from app.services.memory.content_signals import capture_best_effort, source_hash
from app.services.companion.conversation_store import ConversationStore
from app.services.memory.memory_store import MemoryStore
from app.services.pet.pet_store import PetStore

router = APIRouter(prefix="/api/v1/conversations", tags=["conversations"])


# ─── Schemas ─────────────────────────────────────────────────────────────────

class ConversationCreate(BaseModel):
    pet_id: int | None = None
    mode: ConversationMode = ConversationMode.free_chat
    fragment_id: int | None = None  # review_fragment 模式携带


class MessageOut(BaseModel):
    id: int
    role: str
    content: str
    created_at: datetime
    # 这条消息带的图片（相对地址）。读取要带登录凭证，见 get_message_image。
    images: list[str] = []

    model_config = {"from_attributes": True}

    @model_validator(mode="before")
    @classmethod
    def _from_orm_with_images(cls, value):
        if isinstance(value, Message):
            count = len(value.attachments or [])
            base = f"/api/v1/conversations/{value.conversation_id}/messages/{value.id}/images"
            return {
                "id": value.id, "role": value.role, "content": value.content,
                "created_at": value.created_at,
                "images": [f"{base}/{i}" for i in range(count)],
            }
        return value


class ConversationOut(BaseModel):
    id: int
    mode: str
    pet_id: int | None
    fragment_id: int | None
    title: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ConversationDetail(ConversationOut):
    messages: list[MessageOut] = []


class ImageIn(BaseModel):
    data: str                 # base64（不带 data: 前缀；带了也认）
    mime: str | None = None   # image/jpeg | image/png | image/webp；以文件头为准


class SendMessageRequest(BaseModel):
    text: str = ""
    # 可选：这条消息带的图片（最多 3 张，单张 1.5 MB 以内）。图片不进记忆。
    images: list[ImageIn] = Field(default_factory=list)


# 发给模型时，最近几条带图片的用户消息把图片一起附上（这样能接着问「左边那个呢」）；
# 更早的只留一句说明，不再重复上传，省 token。
RESEND_IMAGE_MESSAGES = 2
OLD_IMAGE_NOTE = "（这里发过图片，现在不再附上）"


def _attach_images_for_model(user_id: int, history: list[dict]) -> None:
    """把历史里的 attachments 换成给模型看的 images（data URL）；就地修改。"""
    kept = 0
    for m in reversed(history):
        attachments = m.pop("attachments", None)
        if not attachments or m.get("role") != "user":
            continue
        if kept < RESEND_IMAGE_MESSAGES:
            urls = [u for u in (as_data_url(user_id, a) for a in attachments) if u]
            if urls:
                m["images"] = urls
                kept += 1
                continue
        m["content"] = (m.get("content") + "\n" if m.get("content") else "") + OLD_IMAGE_NOTE


# ─── 内部工具 ────────────────────────────────────────────────────────────────

def _load_fragment_context(db: Session, conv) -> str | None:
    """review_fragment 模式下取片段文本，注入桌宠上下文。"""
    if conv.mode != ConversationMode.review_fragment.value or conv.fragment_id is None:
        return None
    frag = MemoryStore(db).get(conv.fragment_id)
    # 只在片段属于同一用户时才带入（隐私隔离）
    if frag is None or frag.user_id != conv.user_id or frag.is_forgotten:
        return None
    return frag.surface_text or frag.content


def _require_conversation(db: Session, user: User, conv_id: int):
    conv = ConversationStore(db).get(user.id, conv_id)
    if conv is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "会话不存在")
    return conv


def _memory_context(db: Session, user_id: int, query: str) -> str | None:
    """按当前输入召回记忆上下文（关键词/实体匹配）。best-effort，无实际记忆则返回 None。

    这是**用户发起**的对话（用户刚发来这条消息），所以是唯一打开 user_initiated 的入口：
    与这条消息相关的 vulnerable/core 记忆可以带进 prompt，米露才接得上用户自己提起的事。
    """
    try:
        ctx = build_memory_context(
            db, user_id, mode="full", query=query, user_initiated=True, user_text=query,
        )
    except Exception:  # noqa: BLE001  记忆上下文失败绝不阻断对话
        return None
    return ctx if "- [" in ctx else None  # 无记忆行时不注入空围栏


def _pet_prompt(db: Session, user_id: int, pet_id: int | None) -> str | None:
    """取对话关联桌宠（或当前主桌宠）的系统提示词作为人格层。"""
    pet = None
    if pet_id is not None:
        pet = PetStore(db).get(user_id, pet_id)
    if pet is None:
        pet = PetStore(db).get_active(user_id)
    return pet.system_prompt if pet else None


def _env_context(db: Session, user_id: int) -> str | None:
    """组装「此刻的环境」：时间段 + 城市 + 天气。best-effort，失败/无位置返回 None，绝不阻断对话。"""
    try:
        from datetime import timezone as _tz, timedelta as _td
        now = datetime.now(_tz(_td(hours=8)))
        h = now.hour
        period = "凌晨" if h < 6 else "早上" if h < 11 else "中午" if h < 13 else "下午" if h < 18 else "晚上"
        parts = [f"现在是 {now.month} 月 {now.day} 日{period} {h} 点左右"]
        from sqlalchemy import select
        from app.models.preference import UserPreference
        pref = db.scalar(select(UserPreference).where(UserPreference.user_id == user_id))
        if pref and pref.last_city:
            parts.append(f"用户在{pref.last_city}")
        if pref and pref.last_lat is not None and pref.last_lon is not None:
            try:
                from app.services.infra.weather import weather_service
                w = weather_service.get_current_weather(pref.last_lat, pref.last_lon)
                cond, temp = w.get("condition"), w.get("temperature")
                if cond:
                    parts.append(f"天气{cond}" + (f"、气温 {temp}°C" if temp is not None else ""))
            except Exception:  # noqa: BLE001  天气失败不阻断
                pass
        return "，".join(parts) + "。"
    except Exception:  # noqa: BLE001
        return None


# ─── 会话 ────────────────────────────────────────────────────────────────────

@router.post("", response_model=ConversationOut, status_code=status.HTTP_201_CREATED)
def create_conversation(
    body: ConversationCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """开启对话。review_fragment 模式需带 fragment_id。"""
    if body.mode == ConversationMode.review_fragment and body.fragment_id is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "回看片段模式需要 fragment_id")
    return ConversationStore(db).create(
        user_id=user.id,
        mode=body.mode.value,
        pet_id=body.pet_id,
        fragment_id=body.fragment_id,
    )


@router.get("", response_model=list[ConversationOut])
def list_conversations(
    limit: int = Query(20, ge=1, le=100),
    cursor: int | None = Query(None, description="上一页最小 id，用于向更早翻页"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return ConversationStore(db).list_for_user(user.id, limit=limit, cursor=cursor)


@router.get("/latest", response_model=ConversationDetail | None)
def latest_conversation(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Resume the most recently used free chat; null means this user has none."""
    return ConversationStore(db).latest_free_chat(user.id)


@router.get("/{conv_id}", response_model=ConversationDetail)
def get_conversation(
    conv_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """详情 + 全部消息（按时间正序）。"""
    conv = _require_conversation(db, user, conv_id)
    return conv


@router.delete("/{conv_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_conversation(
    conv_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """删除当前用户的一段往日会话及其全部消息（连同消息里的图片文件）。"""
    store = ConversationStore(db)
    if store.get(user.id, conv_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "会话不存在")
    attachments = store.attachments_of(conv_id)
    if not store.delete(user.id, conv_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "会话不存在")
    delete_images(user.id, attachments)  # 库里删成了再删文件
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ─── 消息 ────────────────────────────────────────────────────────────────────

@router.get("/{conv_id}/messages", response_model=list[MessageOut])
def list_messages(
    conv_id: int,
    limit: int = Query(50, ge=1, le=200),
    cursor: int | None = Query(None, description="上一页最大 id，取之后的消息"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_conversation(db, user, conv_id)
    return ConversationStore(db).list_messages(conv_id, limit=limit, cursor=cursor)


@router.post("/{conv_id}/messages")
def send_message(
    conv_id: int,
    body: SendMessageRequest,
    background_tasks: BackgroundTasks,
    stream: bool = Query(False, description="true 走 SSE 逐 token 流式"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """发消息 → 桌宠回应。默认返回整条；?stream=true 返回 text/event-stream。

    可带图片（images）：桌宠看图回应。图片只参与这次对话，不进记忆——下面的记忆抽取、待办识别都只看文字。
    """
    conv = _require_conversation(db, user, conv_id)
    fragment_context = _load_fragment_context(db, conv)
    mode = conv.mode
    pet_id = conv.pet_id
    user_id = user.id
    source_type = "voice_call" if mode == ConversationMode.voice_call.value else "conversation"

    # 图片在开始回应之前就校验完：不合要求直接 422，不会出现「流到一半才报错」
    if body.images and mode == ConversationMode.voice_call.value:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "通话里暂时不能发图片")
    try:
        decoded_images = decode_images([(i.data, i.mime) for i in body.images])
    except ImageRejected as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e)) from None
    if not body.text.strip() and not decoded_images:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "说点什么，或者发张图片吧")
    has_text = bool(body.text.strip())

    def prepare_reply(session: Session, store: ConversationStore):
        attachments = save_images(user_id, decoded_images)
        try:
            message_id = store.add_message(
                conv_id, role="user", content=body.text, attachments=attachments).id
        except Exception:
            delete_images(user_id, attachments)  # 消息没存上：不留没人认领的图片文件
            raise
        history = store.history_as_dicts(conv_id, limit=24, through=message_id)
        _attach_images_for_model(user_id, history)
        # Do not hold a read transaction while the intent model is running.
        session.rollback()
        todos = capture_chat_todos(user_id, body.text) if mode == ConversationMode.free_chat.value else []
        receipt = "已记到待办：" + "、".join(todos) + "。" if todos else ""
        context = {
            "memory_context": _memory_context(session, user_id, body.text),
            "pet_prompt": _pet_prompt(session, user_id, pet_id),
            "env_context": _env_context(session, user_id),
        }
        return message_id, history, receipt, context

    if not stream:
        store = ConversationStore(db)
        message_id, history, receipt, context = prepare_reply(db, store)
        if has_text:  # 只发图片时没有文字可抽取；图片内容不进记忆
            background_tasks.add_task(
                capture_best_effort, user_id=user_id, source_type=source_type,
                source_id=f"message:{message_id}", text=body.text,
            )
        reply_text = run_companion(mode, history, fragment_context, **context)
        if receipt:
            reply_text = receipt + "\n\n" + reply_text
        reply = store.add_message(conv_id, role="assistant", content=reply_text)
        return {
            "conversation_id": conv_id,
            "reply": MessageOut.model_validate(reply).model_dump(mode="json"),
        }

    # 流式：生成器自持一个 session（请求 session 会在响应开始后关闭）
    def event_stream():
        db2: Session = SessionLocal()
        try:
            store = ConversationStore(db2)
            _, history, receipt, context = prepare_reply(db2, store)

            parts: list[str] = []
            if receipt:
                yield "event: todo.saved\ndata: {}\n\n"
                parts.append(receipt + "\n\n")
                data = json.dumps({"delta": parts[0]}, ensure_ascii=False)
                yield f"event: token\ndata: {data}\n\n"
            for delta in stream_companion(mode, history, fragment_context, **context):
                parts.append(delta)
                data = json.dumps({"delta": delta}, ensure_ascii=False)
                yield f"event: token\ndata: {data}\n\n"

            reply_text = "".join(parts)
            reply = store.add_message(conv_id, role="assistant", content=reply_text)
            done = json.dumps(
                {"message_id": reply.id, "content": reply_text}, ensure_ascii=False
            )
            yield f"event: done\ndata: {done}\n\n"
        finally:
            db2.close()

    return StreamingResponse(
        event_stream(), media_type="text/event-stream",
        background=BackgroundTask(
            capture_best_effort, user_id=user_id, source_type=source_type,
            source_id=f"conversation:{conv_id}:{source_hash(body.text)[:16]}", text=body.text,
        ) if has_text else None,  # 只发图片时没有文字可抽取；图片内容不进记忆
    )


@router.get("/{conv_id}/messages/{message_id}/images/{index}")
def get_message_image(
    conv_id: int,
    message_id: int,
    index: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """读一张聊天图片。要登录，且会话必须是自己的（图片不走公开的 /static）。"""
    _require_conversation(db, user, conv_id)
    message = ConversationStore(db).get_message(conv_id, message_id)
    attachments = (message.attachments or []) if message is not None else []
    if not 0 <= index < len(attachments):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "图片不存在")
    path = image_path(user.id, str(attachments[index].get("file") or ""))
    if path is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "图片不存在")
    return FileResponse(
        path, media_type=attachments[index].get("mime") or "image/jpeg",
        headers={"Cache-Control": "private, max-age=86400"},
    )
