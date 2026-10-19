"""桌宠来信：服务端主动陪伴的落库产物（api-design §8.1）。

生成是服务端主动行为（proactive / 定时触发），不开放公开写接口；
用户侧只做查看、已读、删除。type ∈ music/movie/book/greeting/relationship/scene_invite。
"""
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Letter(Base):
    __tablename__ = "letters"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)

    type: Mapped[str] = mapped_column(String(30), nullable=False, default="greeting")
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)

    # 关联引用（裸 Integer + 不设 FK，与 handoff/pet 一致的先例）
    pet_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ref_memory_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # 附件卡（"信里夹了一首歌"：{label, title, artist, reason, ...}，可空）
    attachment: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    is_read: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # 自动来信投递控制：type 仅表达展示类别，generation_key 才是来源幂等键。
    # delivery_date 使用产品时区（东八区）的 YYYY-MM-DD；delivery_slot 只是当天
    # 内的序号（唯一约束防并发重复占位），不再有每日数量上限。
    generation_key: Mapped[str | None] = mapped_column(String(120), nullable=True)
    delivery_date: Mapped[str | None] = mapped_column(String(10), nullable=True)
    delivery_slot: Mapped[int | None] = mapped_column(Integer, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )

    # 「对用户隐藏」而非物理删除：用户在信箱里删信 = 写入 hidden_at。
    # 为什么不真删、也暂不做定期物理清理：很多防重复逻辑靠信件行本身——
    # 睡前提醒的「今天发过没」、generation_key / delivery_date 当日幂等、
    # 晚间信的 material_ids / afterglow 防复读、「有句话」每 7 天最多 2 封。
    # 行没了这些都会失效（删掉今晚的提醒，下一分钟又来一封）。
    # 所以：面向用户的读取一律过滤 hidden_at IS NULL，内部防重复逻辑一律不过滤。
    hidden_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        Index("ix_letters_user_hidden", "user_id", "hidden_at"),
        UniqueConstraint(
            "user_id", "generation_key", name="uq_letters_user_generation_key"
        ),
        UniqueConstraint(
            "user_id", "delivery_date", "delivery_slot",
            name="uq_letters_user_date_slot",
        ),
    )

    def __repr__(self) -> str:
        return f"<Letter id={self.id} user={self.user_id} type={self.type} read={self.is_read}>"
