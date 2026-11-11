"""对话数据模型。见 docs/api-design.md §4。

Conversation：一次会话（携带 mode 与可选桌宠/片段引用）。
Message：会话内的一条消息（user / assistant）。

桌宠引用暂用裸 Integer（Pets 表落地后可加外键），与 memory.user_id、handoff.pet_id
一致的先不设 FK 策略。fragment_id 指向一条 MemoryItem（回看片段模式），同样先不设 FK。
"""
import enum
from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class ConversationMode(str, enum.Enum):
    free_chat = "free_chat"          # 自由聊聊
    brain_dump = "brain_dump"        # 一股脑倒
    hard_thing = "hard_thing"        # 说件放不下的事
    review_fragment = "review_fragment"  # 回看片段（带 fragment_id）
    voice_call = "voice_call"        # 实时语音通话（网关旁路落库）


class MessageRole(str, enum.Enum):
    user = "user"
    assistant = "assistant"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)

    mode: Mapped[str] = mapped_column(String(30), nullable=False, default="free_chat")
    pet_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 回看片段模式下指向一条 MemoryItem
    fragment_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    title: Mapped[str | None] = mapped_column(String(200), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow
    )

    messages: Mapped[list["Message"]] = relationship(
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="Message.id",
    )

    __table_args__ = (
        Index("ix_conv_user_updated", "user_id", "updated_at"),
    )

    def __repr__(self) -> str:
        return f"<Conversation id={self.id} user={self.user_id} mode={self.mode}>"


class Message(Base):
    __tablename__ = "conversation_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    conversation_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("conversations.id"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # 这条消息带的图片：[{"file": "<uuid>.jpg", "mime": "image/jpeg", "bytes": 12345}]；没有图片为 None。
    # 文件在 settings.chat_image_dir/<user_id>/ 下，不公开，读取见 conversations 路由。
    attachments: Mapped[list | None] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )

    conversation: Mapped["Conversation"] = relationship(back_populates="messages")

    def __repr__(self) -> str:
        return f"<Message id={self.id} conv={self.conversation_id} role={self.role}>"
