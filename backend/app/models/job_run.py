"""「这个用户的这件定时活，这个周期做过了」的登记表。

用在由手机触发的定时活上（POST /api/v1/tick）：做梦、场景推荐本身不防重复，
手机每分钟都可能来触发一次，所以先在这里占一个 (user, job, period) 的位置，占到了才做。
晚间信 / 周报 / 睡前提醒有自己的幂等键（letters.generation_key），不用这张表。
"""
from datetime import datetime, timezone

from sqlalchemy import DateTime, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class JobRun(Base):
    __tablename__ = "job_runs"
    __table_args__ = (UniqueConstraint("user_id", "job", "period", name="uq_job_runs_user_job_period"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    job: Mapped[str] = mapped_column(String(40), nullable=False)
    # 周期键：按天的写 YYYY-MM-DD（东八区）
    period: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
