"""用户账号模型。

id 用 Integer，对齐 memory 等资源里的 user_id（那边目前是 Integer 占位）。
"""
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Integer, String, false
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    email: Mapped[str | None] = mapped_column(String(255), unique=True, index=True, nullable=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # 最近一次真正打开 App（后台轮询不算）。定时任务据此跳过沉睡用户，见 services/infra/engagement.py
    last_active_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, default=_utcnow
    )

    # 用户在手机上填了自己的模型密钥（密钥本身不存服务端，这里只记「是不是自带」）。
    # 为 True 时服务端定时任务不再用服务端的 key 为他生成内容，改由手机带着 key 调 /api/v1/tick 触发。
    uses_own_key: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow
    )

    def __repr__(self) -> str:
        return f"<User id={self.id} username={self.username!r}>"
