"""ConversationStore：对话读写的唯一入口，面向单个 DB session。

对齐 HandoffStore/MemoryStore：commit+refresh 在 store 内完成，读接口按 user 隔离。
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.conversation import Conversation, ConversationMode, Message


class ConversationStore:
    def __init__(self, db: Session):
        self._db = db

    # ─── 会话 ──────────────────────────────────────────────────────────────

    def create(
        self,
        *,
        user_id: int,
        mode: str = "free_chat",
        pet_id: int | None = None,
        fragment_id: int | None = None,
        title: str | None = None,
    ) -> Conversation:
        conv = Conversation(
            user_id=user_id,
            mode=mode,
            pet_id=pet_id,
            fragment_id=fragment_id,
            title=title,
        )
        self._db.add(conv)
        self._db.commit()
        self._db.refresh(conv)
        return conv

    def get(self, user_id: int, conv_id: int) -> Conversation | None:
        """按 user 隔离取会话。"""
        return self._db.scalar(
            select(Conversation).where(
                Conversation.id == conv_id, Conversation.user_id == user_id
            )
        )

    def list_for_user(
        self, user_id: int, *, limit: int = 20, cursor: int | None = None
    ) -> Sequence[Conversation]:
        """按 id 倒序（最新在前）；cursor 为上一页最小 id，取更早的。"""
        stmt = select(Conversation).where(Conversation.user_id == user_id)
        if cursor is not None:
            stmt = stmt.where(Conversation.id < cursor)
        stmt = stmt.order_by(Conversation.id.desc()).limit(limit)
        return self._db.scalars(stmt).all()

    def delete(self, user_id: int, conv_id: int) -> bool:
        """删除用户自己的会话；关联消息由 ORM delete-orphan 级联清理。"""
        conv = self.get(user_id, conv_id)
        if conv is None:
            return False
        self._db.delete(conv)
        self._db.commit()
        return True

    def latest_free_chat(self, user_id: int) -> Conversation | None:
        """Pick the last chat with a user message, including conversations made by old clients."""
        last_user_message = (
            select(Message.id).where(Message.conversation_id == Conversation.id, Message.role == "user")
            .order_by(Message.id.desc()).limit(1).correlate(Conversation).scalar_subquery()
        )
        return self._db.scalar(select(Conversation).where(
            Conversation.user_id == user_id,
            Conversation.mode == ConversationMode.free_chat.value,
            last_user_message.is_not(None),
        ).order_by(last_user_message.desc()).limit(1))

    # ─── 消息 ──────────────────────────────────────────────────────────────

    def add_message(self, conv_id: int, *, role: str, content: str,
                    attachments: list[dict] | None = None) -> Message:
        """追加一条消息，并顺带刷新会话 updated_at。attachments 是这条消息带的图片清单（可空）。"""
        msg = Message(conversation_id=conv_id, role=role, content=content, attachments=attachments or None)
        self._db.add(msg)
        # 用户续聊时也更新活动时间，标题只取第一条。
        conv = self._db.get(Conversation, conv_id)
        if conv is not None and role == "user":
            conv.updated_at = datetime.now(timezone.utc)
            if conv.title is None:
                conv.title = content[:40] or ("[图片]" if attachments else None)
        self._db.commit()
        self._db.refresh(msg)
        return msg

    def list_messages(
        self, conv_id: int, *, limit: int = 50, cursor: int | None = None
    ) -> Sequence[Message]:
        """按 id 正序（时间顺序）；cursor 为上一页最大 id，取之后的。"""
        stmt = select(Message).where(Message.conversation_id == conv_id)
        if cursor is not None:
            stmt = stmt.where(Message.id > cursor)
        stmt = stmt.order_by(Message.id.asc()).limit(limit)
        return self._db.scalars(stmt).all()

    def history_as_dicts(self, conv_id: int, *, limit: int | None = None,
                         through: int | None = None) -> list[dict]:
        """取全部消息，转成 [{role, content}]，供 LangGraph 组装上下文。

        带图片的消息多一个 attachments 键（图片清单）；要不要把图片读出来发给模型由调用方决定。
        """
        stmt = select(Message).where(Message.conversation_id == conv_id)
        if through is not None:
            stmt = stmt.where(Message.id <= through)
        if limit is not None:
            rows = reversed(self._db.scalars(stmt.order_by(Message.id.desc()).limit(limit)).all())
        else:
            rows = self._db.scalars(stmt.order_by(Message.id.asc())).all()
        out: list[dict] = []
        for m in rows:
            item: dict = {"role": m.role, "content": m.content}
            if m.attachments:
                item["attachments"] = list(m.attachments)
            out.append(item)
        return out

    def attachments_of(self, conv_id: int) -> list[dict]:
        """这个会话里所有消息的图片清单（删会话前用来清文件）。"""
        rows = self._db.scalars(
            select(Message.attachments).where(
                Message.conversation_id == conv_id, Message.attachments.is_not(None))
        ).all()
        return [a for row in rows for a in (row or [])]

    def get_message(self, conv_id: int, message_id: int) -> Message | None:
        return self._db.scalar(select(Message).where(
            Message.id == message_id, Message.conversation_id == conv_id))
