"""偏好设置 REST 接口（api-design §10）。

GET   /api/v1/preferences  读取（不存在时按默认创建）
PATCH /api/v1/preferences  部分修改（频率档位/开关/睡前提醒时间/隐私）

`proactive_enabled` 同步写入 TrustState（信任门控从那边读，requirements 6.5）。
"""
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user
from app.models.preference import UserPreference
from app.models.user import User
from app.services.pet import trust as trust_service
from app.services.signals.detectors import DEFAULT_SCHEDULE_TIMES

router = APIRouter(prefix="/api/v1/preferences", tags=["preferences"])

FREQUENCIES = ("安静", "温和", "活跃")
_TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def _get_or_create(db: Session, user_id: int) -> UserPreference:
    pref = db.scalar(select(UserPreference).where(UserPreference.user_id == user_id))
    if pref is None:
        pref = UserPreference(user_id=user_id)
        db.add(pref)
        db.commit()
        db.refresh(pref)
    # 定时窗口默认值：老数据/新建行都补齐，前端不必处理 null
    if pref.proactive_schedule_times is None:
        pref.proactive_schedule_times = list(DEFAULT_SCHEDULE_TIMES)
        db.commit()
        db.refresh(pref)
    return pref


class PreferenceOut(BaseModel):
    proactive_enabled: bool
    proactive_frequency: str
    sleep_reminder_time: str
    evening_letter_enabled: bool
    evening_letter_time: str
    keep_raw_dump: bool
    profile_learning_enabled: bool
    ephemeral_ttl_days: int
    font_size: str
    companion_tone: str
    reduce_transparency: bool

    # 主动触发（信号融合引擎）
    proactive_schedule_times: list[str] | None
    quiet_hours_start: str
    quiet_hours_end: str
    is_muted: bool
    scheduled_checkin_enabled: bool
    holiday_greeting_enabled: bool
    motion_detection_enabled: bool
    driving_alert_enabled: bool
    weather_alert_enabled: bool
    usage_anomaly_enabled: bool
    max_daily_triggers: int
    driving_mode_active: bool
    last_motion_signal_at: datetime | None

    model_config = {"from_attributes": True}


class PreferencePatch(BaseModel):
    proactive_enabled: bool | None = None
    proactive_frequency: str | None = Field(default=None)
    sleep_reminder_time: str | None = None
    evening_letter_enabled: bool | None = None
    evening_letter_time: str | None = None
    keep_raw_dump: bool | None = None
    profile_learning_enabled: bool | None = None
    ephemeral_ttl_days: int | None = None
    font_size: str | None = None
    companion_tone: str | None = None
    reduce_transparency: bool | None = None

    # 主动触发（driving_mode_active / last_motion_signal_at 为服务端写入，不可改）
    proactive_schedule_times: list[str] | None = None
    quiet_hours_start: str | None = None
    quiet_hours_end: str | None = None
    is_muted: bool | None = None
    scheduled_checkin_enabled: bool | None = None
    holiday_greeting_enabled: bool | None = None
    motion_detection_enabled: bool | None = None
    driving_alert_enabled: bool | None = None
    weather_alert_enabled: bool | None = None
    usage_anomaly_enabled: bool | None = None
    max_daily_triggers: int | None = None


@router.get("", response_model=PreferenceOut)
def get_preferences(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return _get_or_create(db, user.id)


@router.patch("", response_model=PreferenceOut)
def patch_preferences(
    body: PreferencePatch,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    pref = _get_or_create(db, user.id)
    patch = body.model_dump(exclude_none=True)
    if not patch:
        raise HTTPException(400, "No fields to update")

    if "proactive_frequency" in patch:
        if patch["proactive_frequency"] not in FREQUENCIES:
            raise HTTPException(422, f"频率档位须为 {'/'.join(FREQUENCIES)}")
    if "sleep_reminder_time" in patch:
        if not _TIME_RE.match(patch["sleep_reminder_time"]):
            raise HTTPException(422, "时间格式须为 HH:MM")
    if "evening_letter_time" in patch:
        if not _TIME_RE.match(patch["evening_letter_time"]):
            raise HTTPException(422, "来信时间格式须为 HH:MM（00:00–23:59）")
    if "ephemeral_ttl_days" in patch:
        if not 1 <= patch["ephemeral_ttl_days"] <= 30:
            raise HTTPException(422, "寄存天数须在 1–30 天之间")
    if "font_size" in patch:
        if patch["font_size"] not in ("小", "标准", "大"):
            raise HTTPException(422, "字体须为 小/标准/大")
    for key in ("quiet_hours_start", "quiet_hours_end"):
        if key in patch and not _TIME_RE.match(patch[key]):
            raise HTTPException(422, f"{key} 格式须为 HH:MM")
    if "proactive_schedule_times" in patch:
        times = patch["proactive_schedule_times"]
        if not isinstance(times, list) or not 1 <= len(times) <= 6:
            raise HTTPException(422, "定时窗口须为 1–6 个时刻")
        for t in times:
            if not isinstance(t, str) or not _TIME_RE.match(t):
                raise HTTPException(422, "定时窗口格式须为 HH:MM")
        patch["proactive_schedule_times"] = sorted(set(times))
    if "max_daily_triggers" in patch:
        if not 1 <= patch["max_daily_triggers"] <= 12:
            raise HTTPException(422, "每日主动触达上限须在 1–12 次之间")

    for k, v in patch.items():
        setattr(pref, k, v)
    db.commit()
    db.refresh(pref)

    # 主动陪伴总开关同步到信任状态（门控读 TrustState）
    if "proactive_enabled" in patch:
        trust_service.set_proactive_enabled(db, user.id, patch["proactive_enabled"])

    return pref


class LocationIn(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    city: str | None = None


@router.post("/location")
def report_location(
    body: LocationIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """前端上报最近一次模糊位置（供天气/环境上下文）。只存最近一次，不存轨迹。"""
    pref = _get_or_create(db, user.id)
    pref.last_lat = body.lat
    pref.last_lon = body.lon
    if body.city:
        pref.last_city = body.city
    pref.location_updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"ok": True, "city": pref.last_city}
