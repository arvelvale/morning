"""时间口径工具：东八区日期文案 + 抽取出的 due_at 换算。

产品面向国内用户，时间一律按东八区（CST，UTC+8）理解；库里 datetime 存 UTC。

约定（前后端共用）：
- 记忆的 due_date 为「带时区的 UTC 时刻」。
- 只有日期没有具体时刻的截止，存当天东八区 00:00（即前一天 16:00Z）；
  东八区本地时间恰为 00:00 视为「没有具体时刻」（has_time=False）。
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

CST = timezone(timedelta(hours=8))

_WEEKDAYS = "一二三四五六日"


def now_cst() -> datetime:
    return datetime.now(CST)


def to_cst(dt: datetime) -> datetime:
    """任意 datetime → 东八区。naive 视为 UTC（SQLite 取回的时间不带时区）。"""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(CST)


def cn_date(dt: datetime) -> str:
    """「10月13日」（东八区）。"""
    d = to_cst(dt)
    return f"{d.month}月{d.day}日"


def cn_date_weekday(dt: datetime) -> str:
    """「10月19日周一」（东八区）。"""
    d = to_cst(dt)
    return f"{d.month}月{d.day}日周{_WEEKDAYS[d.weekday()]}"


def now_context_text(now: datetime | None = None) -> str:
    """喂给模型的「现在」：现在是 2026-10-19 周一 08:30（东八区）。"""
    d = to_cst(now) if now is not None else now_cst()
    return f"现在是 {d:%Y-%m-%d} 周{_WEEKDAYS[d.weekday()]} {d:%H:%M}（东八区）"


def has_specific_time(due: datetime) -> bool:
    """东八区本地时刻不是 00:00 → 有具体时刻。"""
    d = to_cst(due)
    return not (d.hour == 0 and d.minute == 0)


def parse_due_at(value: Any, has_time: Any = True) -> datetime | None:
    """把抽取结果里的 due_at 换算成可入库的 UTC 时刻；非法返回 None（调用方不写，绝不丢记忆）。

    换算示例（设计值 → 代码）：
      "2026-10-19T10:15:00+08:00"（今天10点15，东八区）→ 2026-10-19T02:15:00Z
      "2026-10-20"（明天，只有日期）或 has_time=False   → 2026-10-19T16:00:00Z（20 日东八区 00:00）
    无时区的 ISO 串按东八区解释（模型说的是本地时间）。
    """
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    if text.endswith(("Z", "z")):
        text = text[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=CST)
    local = dt.astimezone(CST)
    if not (2000 <= local.year <= 2100):
        return None
    # has_time 只认明确的 false（模型漏写时按有时刻处理，由 00:00 约定兜底）
    if has_time is False or (isinstance(has_time, str) and has_time.strip().lower() == "false"):
        local = local.replace(hour=0, minute=0, second=0, microsecond=0)
    return local.astimezone(timezone.utc)
