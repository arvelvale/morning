"""晚间来信：由桌宠按用户设定的时间（东八区，默认 21:30）主动写给用户的一封信。

产品口径：
- 结合信箱——生成物落库为 Letter（type=greeting），用户在信箱查看。
- 用户可在设置里关闭晚间来信，或改来信时间（user_preferences.evening_letter_enabled /
  evening_letter_time）。关闭的用户一封都不生成（也就不花模型调用）；没有偏好行的老用户按默认
  （开启、21:30）处理，升级后行为不变。
- 独立于 proactive 开关；开启的用户每晚到点都尝试发。
- 调度：main.py 每分钟 tick 一次，调 run_due_evening_letters 挑人——设定时间到了、今天还没生成过的
  可达用户（沉睡用户规则不变，见 engagement.reachable_users）。进程重启错过时间点的，
  在设定时间之后 CATCHUP_WINDOW_MINUTES 分钟内补发，超过就不补（避免深夜突然来信）。
- 无素材/首次无记忆也发通用问候；LLM 失败或当日两封额度已满时不发。

隐私底座（Property 9）：送进外部 LLM 的素材只取 depth=surface 记忆，
vulnerable/core/personal 深层记忆绝不进入 prompt、不外流。
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.llm import get_chat_model
from app.models.letter import Letter
from app.models.memory import MemoryItem
from app.models.preference import UserPreference
from app.services.memory.context_builder import _due_note
from app.services.memory.temporal import cn_date, cn_date_weekday
from app.services.mailbox.letter_store import (
    LetterStore,
    daily_generation_key,
    local_delivery_date,
)
from app.services.pet.pet_store import PetStore

logger = logging.getLogger(__name__)

# 东八区（产品面向国内用户，固定时区）
CST = timezone(timedelta(hours=8))

# 送进 prompt 的表层记忆上限（控制 token）
MAX_MATERIAL = 20

# 片场余温的回看窗口：傍晚前演完的当晚提，深夜演完的第二晚提
AFTERGLOW_WINDOW = timedelta(hours=36)

EVENING_SYSTEM_PROMPT = """\
你是喵灵的桌宠，正在夜里给主人写一封短短的晚间来信。
性格：温柔、不催促、不评判、不说教。像一个记得你今天点滴的老朋友。

要求：
- 结合下面「今天的碎片」自然地提一两件事，像顺口关心，不要罗列清单。
- 每条碎片前面标着主人记下它的日期，用户消息里写明了今天是几月几日周几。已经过去的事绝不能说成「明天」「待会」；
  碎片里写的具体日期若早于今天，就按已经发生/已过期来对待，宁可不提。
- 如果没有碎片（第一次见面或今天没记什么），就写一封轻轻的问候，说说夜晚、让主人放松，不要提"没有记录"这类话，
  也不要凭空提到任何具体的旧事、待办或截止日期。
- 语气口语、简短，全文 40–80 字，最多一个 emoji。
- 绝不催促主人做事、不评价对错、不给建议清单。
- 如果有「刚在片场演完的一幕」，那是主人放不下的一件事，刚刚在片场里走了一遍：
  这封信就围绕它，用一两句轻轻问问主人演完之后心里怎么样；不追问细节、不评价、不总结道理。

只输出 JSON，不要额外解释：
{"title": "不超过10字的信题", "body": "信的正文"}
"""


def _start_of_today_cst() -> datetime:
    """东八区今天 00:00，转 UTC 后返回。

    created_at 以 UTC 存储，SQLite 对带时区 ISO 字符串是字典序比较、
    不认偏移量，必须统一到 UTC 再比，否则跨日时段会多发/漏发。
    """
    now_cst = datetime.now(CST)
    start_cst = now_cst.replace(hour=0, minute=0, second=0, microsecond=0)
    return start_cst.astimezone(timezone.utc)


def _used_material_ids(db: Session, user_id: int) -> set[int]:
    """近两周自动来信里已经提过的记忆 id（attachment.material_ids）。同一条记忆最多提一次。"""
    since = datetime.now(timezone.utc) - timedelta(days=14)
    used: set[int] = set()
    for letter in db.scalars(
        select(Letter).where(Letter.user_id == user_id, Letter.created_at >= since)
    ).all():
        ids = (letter.attachment or {}).get("material_ids")
        if isinstance(ids, list):
            used.update(i for i in ids if isinstance(i, int))
    return used


def _material_items(db: Session, user_id: int) -> list[MemoryItem]:
    """收集晚间来信素材（记忆条目）：只取 depth=surface、东八区今天记下、且没被之前的来信提过的。

    当天没有新素材就返回空——**不再回落到全部旧记忆**：旧记忆里只有「明天」这类相对说法，
    天天复用会让模型每天都把一件旧事说成「明天」（实训材料事件）。
    """
    base = select(MemoryItem).where(
        MemoryItem.user_id == user_id,
        MemoryItem.depth == "surface",  # 隐私底座：深层不外流
        MemoryItem.is_latest == True,  # noqa: E712
        MemoryItem.is_forgotten == False,  # noqa: E712
    )

    # 只取当天（东八区）
    start = _start_of_today_cst()
    today_stmt = base.where(MemoryItem.created_at >= start).order_by(
        MemoryItem.created_at.desc()
    )
    used = _used_material_ids(db, user_id)
    items = [m for m in db.scalars(today_stmt).all() if m.id not in used]

    # 片场余温单独处理（见 _pending_afterglow），不混进普通碎片
    return [m for m in items if m.content and not _is_afterglow(m)][:MAX_MATERIAL]


def _format_material(m: MemoryItem) -> str:
    """素材一行：前面带记下的日期，待办另带截止/过期标注。"""
    return f"{cn_date(m.created_at)}记下：{m.content}{_due_note(m)}"


def _gather_material(db: Session, user_id: int) -> list[str]:
    """晚间来信素材文本（每条前带记下日期）；空列表 = 今天没有新素材。"""
    return [_format_material(m) for m in _material_items(db, user_id)]


def _is_afterglow(m: MemoryItem) -> bool:
    from app.services.scene.scene_service import AFTERGLOW_TAG
    return isinstance(m.entities, list) and AFTERGLOW_TAG in m.entities


def _pending_afterglow(db: Session, user_id: int) -> list[MemoryItem]:
    """最近演完、还没在晚间来信里提过的片场余温（表层记忆）。"""
    since = datetime.now(timezone.utc) - AFTERGLOW_WINDOW
    items = [
        m for m in db.scalars(
            select(MemoryItem).where(
                MemoryItem.user_id == user_id,
                MemoryItem.depth == "surface",
                MemoryItem.kind == "小结",
                MemoryItem.is_latest == True,  # noqa: E712
                MemoryItem.is_forgotten == False,  # noqa: E712
                MemoryItem.created_at >= since,
            ).order_by(MemoryItem.created_at.desc())
        ).all()
        if _is_afterglow(m)
    ]
    if not items:
        return []
    mentioned: set[int] = set()
    for letter in db.scalars(
        select(Letter).where(Letter.user_id == user_id, Letter.created_at >= since - AFTERGLOW_WINDOW)
    ).all():
        ids = (letter.attachment or {}).get("afterglow_ids")
        if isinstance(ids, list):
            mentioned.update(i for i in ids if isinstance(i, int))
    return [m for m in items if m.id not in mentioned]


def generate_evening_letter(db: Session, user_id: int) -> Letter | None:
    """为单个用户生成并落库一封晚间来信。

    返回落库的 Letter；LLM 失败或当日统一额度已满时返回 None（不发）。
    """
    # type 只表达展示类别；晚间信使用独立来源键，不再和早安 greeting 冲突。
    store = LetterStore(db)
    date_key = local_delivery_date()
    generation_key = daily_generation_key("evening_letter", date_key)
    existing = store.get_generated(user_id, generation_key)
    if existing is not None:
        logger.info("[evening] user %d already has today's letter, skip", user_id)
        return existing
    if not store.has_daily_capacity(user_id, date_key):
        logger.info("[evening] user %d reached daily mailbox limit, skip", user_id)
        return None

    material_items = _material_items(db, user_id)
    if material_items:
        material_text = "\n".join(f"- {_format_material(m)}" for m in material_items)
    else:
        material_text = "（今天没有碎片）"
    afterglow = _pending_afterglow(db, user_id)
    if afterglow:
        material_text = (
            "刚在片场演完的一幕：\n" + "\n".join(f"- {m.content}" for m in afterglow[:2])
            + "\n\n" + material_text
        )

    try:
        llm = get_chat_model()
        resp = llm.invoke([
            {"role": "system", "content": EVENING_SYSTEM_PROMPT},
            {"role": "user", "content": (
                f"今天是{cn_date_weekday(datetime.now(CST))}（东八区）。\n今天的碎片：\n{material_text}"
            )},
        ])
    except Exception as e:
        # LLM 调用失败时不发
        logger.error("[evening] LLM call failed for user %d: %s", user_id, e)
        return None

    title, body = _parse_letter(resp.content)

    pet = PetStore(db).get_active(user_id)
    letter = store.create_generated(
        user_id=user_id,
        generation_key=generation_key,
        delivery_date=date_key,
        type="greeting",
        title=title,
        body=body,
        pet_id=pet.id if pet is not None else None,
        # 记下这封信提过哪几条余温 / 普通素材，之后不再重复提（整体新建 dict，JSON 列无需脏检查）
        attachment=_letter_attachment(afterglow[:2], material_items),
    )
    if letter is None:
        logger.info("[evening] user %d lost daily-slot race, skip", user_id)
        return None
    logger.info("[evening] letter id=%d created for user %d", letter.id, user_id)
    return letter


def _letter_attachment(afterglow: list[MemoryItem], material: list[MemoryItem]) -> dict[str, Any] | None:
    att: dict[str, Any] = {}
    if afterglow:
        att["afterglow_ids"] = [m.id for m in afterglow]
    if material:
        att["material_ids"] = [m.id for m in material]
    return att or None


def _parse_letter(raw: str) -> tuple[str, str]:
    """解析 LLM 输出为 (title, body)。

    LLM 调用已成功（有内容），故解析失败时用原文兜底，不放弃发送。
    """
    text = (raw or "").strip()
    # 容错：markdown 包裹的 JSON
    if text.startswith("```"):
        text = text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            title = str(parsed.get("title") or "").strip() or "晚安 🌙"
            body = str(parsed.get("body") or "").strip()
            if body:
                return title[:20], body
    except (json.JSONDecodeError, ValueError):
        pass
    # 解析失败：用原文当正文
    return "晚安 🌙", (raw or "").strip() or "今晚也辛苦了，早点休息。"


# 设定时间之后多少分钟内还允许补发（进程重启/调度器卡顿错过时间点时）。
# 设计值：设定时间 T → 可发窗口 [T, T+60] 分钟（含端点）；超出窗口当晚不再补，次日照常。
CATCHUP_WINDOW_MINUTES = 60

# 没有偏好行（老用户/新用户尚未打开设置）时的默认：开启、21:30，与上线前全员固定 21:30 一致
DEFAULT_EVENING_ENABLED = True
DEFAULT_EVENING_TIME = "21:30"


def _hhmm_to_minutes(value: str | None) -> int | None:
    """'HH:MM' → 当天第几分钟；格式不对返回 None。"""
    try:
        hh, mm = (value or "").split(":")
        h, m = int(hh), int(mm)
    except (ValueError, AttributeError):
        return None
    if not (0 <= h <= 23 and 0 <= m <= 59):
        return None
    return h * 60 + m


def is_evening_due(target_hhmm: str | None, now: datetime, *, until_midnight: bool = False) -> bool:
    """now（东八区）是否落在 [设定时间, 设定时间+CATCHUP_WINDOW_MINUTES] 内（只在同一天内算，不跨午夜）。

    设定时间非法时按默认 21:30 处理。
    until_midnight=True：补发窗口放宽到当天结束。给「手机触发」用——手机息屏时系统会限制联网，
    可能过了一小时才来触发；这时用户正拿着手机，来信不算深夜突然打扰。
    """
    target = _hhmm_to_minutes(target_hhmm)
    if target is None:
        target = _hhmm_to_minutes(DEFAULT_EVENING_TIME)
    now_c = now.astimezone(CST)
    delta = now_c.hour * 60 + now_c.minute - target
    if until_midnight:
        return delta >= 0
    return 0 <= delta <= CATCHUP_WINDOW_MINUTES


def _evening_settings(db: Session, user_ids: list[int]) -> dict[int, tuple[bool, str]]:
    """批量读 user_id → (是否开启, 来信时间)；没有偏好行的不在结果里（调用方按默认处理）。"""
    if not user_ids:
        return {}
    rows = db.execute(
        select(
            UserPreference.user_id,
            UserPreference.evening_letter_enabled,
            UserPreference.evening_letter_time,
        ).where(UserPreference.user_id.in_(user_ids))
    ).all()
    return {r[0]: (bool(r[1]), r[2]) for r in rows}


def _letter_job_results(db: Session, users: list[Any]) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for user in users:
        try:
            letter = generate_evening_letter(db, user.id)
            results.append({
                "user_id": user.id,
                "sent": letter is not None,
                "letter_id": letter.id if letter is not None else None,
            })
        except Exception as e:
            logger.error("[evening] user %d failed entirely: %s", user.id, e)
            results.append({"user_id": user.id, "sent": False, "error": str(e)})
    return results


def pick_due_evening_users(db: Session, now: datetime | None = None) -> list[Any]:
    """挑出此刻该收晚间来信的用户（纯挑人，不生成）。

    条件（全部满足）：
    1. 可达用户（reachable_users：账号启用、未沉睡）；
    2. 开启晚间来信（没有偏好行 = 默认开启）；
    3. now 落在 [来信时间, 来信时间+CATCHUP_WINDOW_MINUTES] 内（没有偏好行 = 21:30）；
    4. 今天（东八区）还没生成过晚间信（幂等键预检，避免窗口内每分钟重复进入生成流程）。
    """
    from app.services.infra.engagement import reachable_users, scoped_user_id

    now = now or datetime.now(timezone.utc)
    phone_triggered = scoped_user_id() is not None  # 自带密钥的用户由手机触发，补发窗口到当天结束
    users = reachable_users(db, "evening_letter", now)  # 跳过连续多天没打开 App 的用户，见 engagement.py
    settings = _evening_settings(db, [u.id for u in users])
    store = LetterStore(db)
    key = daily_generation_key("evening_letter", local_delivery_date(now))
    due = []
    for user in users:
        enabled, at = settings.get(user.id, (DEFAULT_EVENING_ENABLED, DEFAULT_EVENING_TIME))
        if not enabled:
            continue
        if not is_evening_due(at, now, until_midnight=phone_triggered):
            continue
        if store.get_generated(user.id, key) is not None:
            continue
        due.append(user)
    return due


def run_due_evening_letters(db: Session, now: datetime | None = None) -> list[dict[str, Any]]:
    """定时任务入口（每分钟调用）：给「来信时间到了、今天还没收到」的用户写晚间来信。"""
    return _letter_job_results(db, pick_due_evening_users(db, now))


def run_evening_letters_all(db: Session) -> list[dict[str, Any]]:
    """手动补跑：忽略来信时间，对所有可达且未关闭晚间来信的用户生成（运维用，调度器不走这里）。"""
    from app.services.infra.engagement import reachable_users

    users = reachable_users(db, "evening_letter")
    settings = _evening_settings(db, [u.id for u in users])
    users = [u for u in users if settings.get(u.id, (DEFAULT_EVENING_ENABLED, ""))[0]]
    return _letter_job_results(db, users)
