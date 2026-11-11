"""用户偏好设置（api-design §10）。

主动陪伴总开关/频率、睡前提醒时间、隐私相关开关。
`proactive_enabled` 与 TrustState.proactive_enabled 同步写（信任门控读那边），
其余字段为本表自有。

另含主动触发（信号融合引擎）偏好：定时窗口、安静时段、分信号开关、每日上限。
"""
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class UserPreference(Base):
    __tablename__ = "user_preferences"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, unique=True, index=True)

    # 主动陪伴
    proactive_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    proactive_frequency: Mapped[str] = mapped_column(String(20), nullable=False, default="温和")
    # 睡前提醒（HH:MM）
    sleep_reminder_time: Mapped[str] = mapped_column(String(5), nullable=False, default="22:30")
    # 晚间来信：开关 + 送达时间（HH:MM，东八区）。默认开启、21:30，与上线前全员固定 21:30 一致
    evening_letter_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    evening_letter_time: Mapped[str] = mapped_column(String(5), nullable=False, default="21:30")
    # 隐私：是否保留原始倾诉（关闭则 raw_ref 即焚）
    keep_raw_dump: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # 用户画像学习开关：关闭后停止新增观察；已有画像仍可查看、纠正和删除。
    profile_learning_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # 三日寄存 TTL 天数（影响到期清理，默认 7 天对齐现行为）
    ephemeral_ttl_days: Mapped[int] = mapped_column(Integer, nullable=False, default=7)
    # 界面与陪伴偏好
    font_size: Mapped[str] = mapped_column(String(10), nullable=False, default="标准")
    companion_tone: Mapped[str] = mapped_column(String(20), nullable=False, default="温和")
    reduce_transparency: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # 环境上下文：最近一次上报的模糊位置（供天气查询/环境感知，不存轨迹）
    last_lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_lon: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_city: Mapped[str | None] = mapped_column(String(60), nullable=True)
    location_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # ─── 主动触发（信号融合引擎）偏好 ──────────────────────────────────────
    # 定时陪伴窗口（本地 HH:MM 列表，±6 分钟容差命中）
    proactive_schedule_times: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # 安静时段：非定时类信号在此区间内不打扰
    quiet_hours_start: Mapped[str] = mapped_column(String(5), nullable=False, default="23:00")
    quiet_hours_end: Mapped[str] = mapped_column(String(5), nullable=False, default="07:00")
    # 临时静音（所有主动触达一律不发）
    is_muted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # 分信号类型开关
    scheduled_checkin_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    holiday_greeting_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    motion_detection_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    driving_alert_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    weather_alert_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    usage_anomaly_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # 每日主动触达硬上限（所有信号类型合计）
    max_daily_triggers: Mapped[int] = mapped_column(Integer, nullable=False, default=6)

    # 运行时状态（由信号上报接口写入，前端可读做 UI 提示）
    driving_mode_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    last_motion_signal_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow
    )

    def __repr__(self) -> str:
        return f"<UserPreference user={self.user_id} proactive={self.proactive_enabled}>"
