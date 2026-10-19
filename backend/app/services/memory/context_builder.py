"""统一上下文构建器（spec phase 6, task 23）。

供桌宠对话、睡前倾倒、片场重演复用。三模式：
- profile：稳定画像 + 近期动态
- query：按当前输入召回相关 episodic（黑客松用关键词/实体匹配，非向量）
- full：综合

各 layer 分设条数/字符预算并去重；输出用 <memory-context> 围栏包裹
（流式输出中应剔除该围栏段，防止污染 UI）；
任一检索源异常时该段退化为空，绝不阻断主流程（Property 11）。
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.config import get_settings
from app.services.memory.memory_store import MemoryStore
from app.services.memory.privacy import filter_for_cloud_prompt
from app.services.memory.temporal import cn_date, has_specific_time, now_context_text, to_cst

logger = logging.getLogger(__name__)

FENCE_OPEN = "<memory-context>"
FENCE_CLOSE = "</memory-context>"

# layer → (条数上限, 字符预算)
DEFAULT_BUDGETS: dict[str, tuple[int, int]] = {
    "profile": (5, 600),
    "state": (5, 400),
    "episodic": (5, 600),
}


def _due_note(m) -> str:
    """待办的截止提示。已过期且还没完成的待办标「已过期」而不是丢掉：
    用户可能正问「那个材料交了吗」，丢掉会答非所问；标注后模型知道它是过去的事，
    不会再说成「明天」。
    """
    due = getattr(m, "due_date", None)
    if due is None or m.kind != "待办":
        return ""
    aware = due if due.tzinfo is not None else due.replace(tzinfo=timezone.utc)
    when = cn_date(aware) + (to_cst(aware).strftime(" %H:%M") if has_specific_time(aware) else "")
    if (m.status or "pending") == "pending" and aware < datetime.now(timezone.utc):
        return f"（已过期，原定{when}，不要当作还没到的事）"
    return f"（截止{when}）"


def _render(items, budget: tuple[int, int]) -> list[str]:
    """按预算裁剪一组记忆为文本行。每条标上记下的日期（东八区），避免旧事被当成「刚说的」。"""
    max_items, max_chars = budget
    lines: list[str] = []
    used = 0
    for m in items[:max_items]:
        noted = f" · {cn_date(m.created_at)}记下" if getattr(m, "created_at", None) else ""
        line = f"- [{m.kind}{noted}] {m.surface_text or m.content}{_due_note(m)}"
        if used + len(line) > max_chars:
            break
        lines.append(line)
        used += len(line)
    return lines


def _tokenize(text: str) -> list[str]:
    """中英文混合分词：英文按空格，中文按字符 bigram。"""
    tokens: list[str] = []
    # 英文/数字按空格切
    for word in text.split():
        if word.isascii():
            if len(word) >= 2:
                tokens.append(word.lower())
        else:
            # 中文：字符 bigram（滑动窗口 2）
            chars = [c for c in word if not c.isspace()]
            for i in range(len(chars) - 1):
                tokens.append(chars[i] + chars[i + 1])
            # 单字也保留（短查询兜底）
            if len(chars) == 1:
                tokens.append(chars[0])
    return tokens


def _keyword_score(query: str, item) -> int:
    """召回打分：entities 命中权重高，bigram 命中权重低。"""
    score = 0
    for e in (item.entities or []):
        if e and e in query:
            score += 3
    target = item.content + item.surface_text
    for tok in _tokenize(query):
        if tok in target:
            score += 1
    return score


def build(
    db: Session,
    user_id: int,
    *,
    mode: str = "full",
    query: str | None = None,
    budgets: dict[str, tuple[int, int]] | None = None,
) -> str:
    """组装记忆上下文（围栏包裹的字符串）。

    mode ∈ profile | query | full。任何一段检索失败都只丢该段。
    """
    if mode in ("profile", "full") and not get_settings().user_profile_enabled:
        # 全局灰度/回滚开关：画像不可用时保持调用方原有行为。
        mode = "query" if mode == "full" else "disabled"
    budgets = budgets or DEFAULT_BUDGETS
    store = MemoryStore(db)
    sections: list[str] = []
    seen_ids: set[int] = set()

    def _take(layer: str, items) -> None:
        # 隐私红线：上下文最终进入外部 LLM prompt，vulnerable/core 与即焚记忆不外发
        safe = filter_for_cloud_prompt(list(items))
        fresh = [m for m in safe if m.id not in seen_ids]
        seen_ids.update(m.id for m in fresh)
        sections.extend(_render(fresh, budgets.get(layer, (5, 400))))

    # profile 段：稳定画像 + 近期动态
    if mode in ("profile", "full"):
        try:
            _take("profile", store.list_by_layer(user_id, "profile"))
        except Exception as e:  # noqa: BLE001  Property 11：退化为空段
            logger.warning("context profile section failed: %s", e)
        try:
            _take("state", store.list_by_layer(user_id, "state"))
        except Exception as e:  # noqa: BLE001
            logger.warning("context state section failed: %s", e)

    # query 段：按输入召回 episodic（关键词/实体匹配，纯本地）
    if mode in ("query", "full") and query:
        try:
            episodic = store.list_by_layer(user_id, "episodic")
            scored = [( _keyword_score(query, m), m) for m in episodic]
            hits = [m for s, m in sorted(scored, key=lambda x: -x[0]) if s > 0]
            _take("episodic", hits)
        except Exception as e:  # noqa: BLE001
            logger.warning("context query section failed: %s", e)

    body = "\n".join(sections)
    if sections:
        # 告诉模型「今天」，记忆里的相对说法（明天/下周）才能对着记下日期推算
        body = f"（{now_context_text()}；下列条目标注的是记下的日期，已过去的事不要说成明天）\n{body}"
    return f"{FENCE_OPEN}\n{body}\n{FENCE_CLOSE}"
