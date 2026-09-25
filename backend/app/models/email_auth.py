"""已验证邮箱与短期验证码状态；不把历史 users.email 当作已验证身份。"""
from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class EmailIdentity(Base):
    __tablename__ = "email_identities"
    email: Mapped[str] = mapped_column(String(255), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True, nullable=False)


class EmailChallenge(Base):
    __tablename__ = "email_challenges"
    email_key: Mapped[str] = mapped_column(String(64), primary_key=True)
    challenge_id: Mapped[str] = mapped_column(String(32), nullable=False)
    purpose: Mapped[str] = mapped_column(String(10), nullable=False)
    digest: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    ready: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class EmailRate(Base):
    __tablename__ = "email_auth_rates"
    key: Mapped[str] = mapped_column(String(120), primary_key=True)
    expires_at: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    count: Mapped[int] = mapped_column(Integer, nullable=False)
