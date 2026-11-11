"""深度隐私策略（spec phase 6, task 22）。

Property 9：vulnerable/core 记忆默认 privacy=local（创建时由 DEPTH_DEFAULTS 落），
不进入任何跨设备同步或外部 Provider，除非用户显式授权。
本模块是"外发前"的唯一判定点：任何要把记忆内容发往外部（云端模型以外的
同步、第三方 Provider、导出）的路径都应先过 can_send_external / filter_for_external。

云端模型 prompt 的口径（2026-10 产品拍板）：脆弱记忆（vulnerable/core）
**只在用户自己提起时用，米露绝不主动翻出**——
- 米露主动发起的路径（晚间来信、周报、问候/信号融合、自动推荐片场、做梦 Agent 等）
  一律用 filter_for_cloud_prompt：剔除 vulnerable/core 与 burn_after_read；
- 用户发起的对话（当前只有聊天 conversations 路由）可用 select_user_raised_sensitive：
  仅当用户**当前这条消息**与某条 vulnerable/core 相关时放进本次 prompt，有条数/字符预算；
- burn_after_read 任何路径都不放；
- 同步/导出（can_send_external）不受此放宽影响，口径不变。
"""
from __future__ import annotations

import re

from sqlalchemy.orm import Session

from app.models.memory import MemoryItem
from app.services.memory.memory_store import MemoryStore

# 默认禁止外发的深度（requirements 7.5）
EXTERNAL_FORBIDDEN_DEPTHS = {"vulnerable", "core"}


def can_send_external(item: MemoryItem, *, explicit_consent: bool = False) -> bool:
    """这条记忆能否离开本机（同步/外部 Provider/导出）。

    - vulnerable/core：默认禁止，显式授权才放行（Property 9）
    - privacy=local：默认禁止，显式授权才放行
    - privacy=burn_after_read：永不外发
    """
    if item.privacy == "burn_after_read":
        return False
    if item.depth in EXTERNAL_FORBIDDEN_DEPTHS and not explicit_consent:
        return False
    if item.privacy == "local" and not explicit_consent:
        return False
    return True


def filter_for_external(
    items: list[MemoryItem], *, explicit_consent: bool = False
) -> list[MemoryItem]:
    """外发前过滤：剔除不该离开本机的记忆。"""
    return [i for i in items if can_send_external(i, explicit_consent=explicit_consent)]


def filter_for_cloud_prompt(items: list[MemoryItem]) -> list[MemoryItem]:
    """云端模型 prompt 前过滤（米露**主动**路径的默认口径）：剔除 vulnerable/core 与即焚记忆。

    脆弱记忆只在用户自己提起时才可用（见 select_user_raised_sensitive），
    米露主动发起的路径（晚间来信、周报、问候/信号、自动推荐片场、做梦等）一律只走这里。

    与 can_send_external 的区别：同步/导出连 privacy=local（含 personal）都默认拦；
    云端模型 prompt 是产品既定链路（桌宠对话/晚间来信），只拦脆弱深度与
    burn_after_read。任何拼记忆进外部 LLM prompt 的路径都应先过这里。
    """
    return [
        i for i in items
        if i.depth not in EXTERNAL_FORBIDDEN_DEPTHS and i.privacy != "burn_after_read"
    ]


# ─── 用户发起时的脆弱记忆放行（默认关闭，仅 chat 路径显式打开）───────────────────

# 相关度打分：实体命中 3 分（与 context_builder 召回口径一致），不含停用字的二字组命中 1 分/个
USER_RAISED_MIN_SCORE = 3
# 预算：最多 2 条、合计 300 字符（比普通 episodic 的 5 条/600 字更紧）
USER_RAISED_MAX_ITEMS = 2
USER_RAISED_MAX_CHARS = 300

# 含这些字的二字组不算「有区分度」的命中（避免「今天」「我们」这类词把脆弱记忆放出来）
_STOP_CHARS = frozenset(
    "的了是我你他她它们在有就也都和与及或吗呢吧啊呀嘛哦嗯这那个一不么什很还又要会能说想做去来到把被让给对从"
    "今明昨天日月年点时候些最更太真好没别再已经因为所以但是如果可以觉得感觉现在"
)

# 用户在回指「之前提过的那件事」：词面上可能没有任何实体/关键词重合，
# 此时（且仅此时）允许放最近的 1 条脆弱记忆，让米露接得上。
_BACKREF_RE = re.compile(
    r"那件事|那件事情|那次的事|那段(?:事|经历|时间)|又想起|想起(?:来)?了那|"
    r"(?:之前|上次|那天|以前)(?:跟你|和你|对你)?(?:说|提|讲)过|跟你(?:说|提|讲)过的"
)


def _bigrams(text: str) -> set[str]:
    """文本里「有区分度」的相邻二字组（含 ASCII 词的整词，长度>=2）。"""
    out: set[str] = set()
    for word in re.findall(r"[A-Za-z0-9]{2,}", text):
        out.add(word.lower())
    for seg in re.findall(r"[一-鿿]+", text):
        for a, b in zip(seg, seg[1:]):
            if a not in _STOP_CHARS and b not in _STOP_CHARS:
                out.add(a + b)
    return out


def user_raised_relevance(item: MemoryItem, cue_text: str) -> int:
    """这条记忆与用户当前消息的相关度（确定性、纯本地，不调模型）。

    实体（entities，跳过 signal-key: 这类内部键与单字）出现在消息里 +3/个；
    content+surface_text 与消息的有区分度二字组交集 +1/个。
    """
    if not cue_text:
        return 0
    score = 0
    for e in (item.entities or []):
        if isinstance(e, str) and len(e) >= 2 and not e.startswith("signal-key:") and e in cue_text:
            score += 3
    target = f"{item.content or ''}\n{item.surface_text or ''}"
    score += len(_bigrams(cue_text) & _bigrams(target))
    return score


def has_backref_cue(cue_text: str | None) -> bool:
    """用户是否在回指「之前说过的那件事」（「我又想起那件事了」）。"""
    return bool(cue_text and _BACKREF_RE.search(cue_text))


def select_user_raised_sensitive(
    items: list[MemoryItem],
    cue_text: str | None,
    *,
    max_items: int = USER_RAISED_MAX_ITEMS,
    max_chars: int = USER_RAISED_MAX_CHARS,
    min_score: int = USER_RAISED_MIN_SCORE,
) -> list[MemoryItem]:
    """用户发起的对话里，挑出与**用户当前这条消息**相关的 vulnerable/core 记忆。

    只返回脆弱深度的相关条目（其余深度走 filter_for_cloud_prompt），burn_after_read 永不返回。
    cue_text 为空（不是用户发起 / 没有当前消息）→ 返回空，所以不显式传入就等于关闭。
    相关度 >= min_score 才入选，按相关度降序；若消息是回指（「又想起那件事」）且没有任何词面命中，
    退化为放最近（id 最大）的 1 条。条数/字符预算见 max_items / max_chars（字符按 surface_text 优先的展示文本算）。
    """
    if not cue_text or not cue_text.strip():
        return []
    sensitive = [
        i for i in items
        if i.depth in EXTERNAL_FORBIDDEN_DEPTHS and i.privacy != "burn_after_read"
        and not getattr(i, "is_forgotten", False)
    ]
    scored = [(user_raised_relevance(i, cue_text), i) for i in sensitive]
    hits = [(s, i) for s, i in scored if s >= min_score]
    hits.sort(key=lambda x: (-x[0], -(x[1].id or 0)))
    picked = [i for _, i in hits]
    if not picked and has_backref_cue(cue_text) and sensitive:
        picked = [max(sensitive, key=lambda i: i.id or 0)]  # id 自增，最大即最近

    out: list[MemoryItem] = []
    used = 0
    for i in picked[:max_items]:
        n = len(i.surface_text or i.content or "")
        if used + n > max_chars:
            break
        out.append(i)
        used += n
    return out


def burn_after_read(db: Session, memory_id: int, *, actor: str = "system") -> None:
    """阈后即焚：记忆被读取/交还后按策略遗忘（requirements 7.3）。"""
    MemoryStore(db).forget(memory_id, reason="burn_after_read", actor=actor)


def burn_raw_ref(db: Session, memory_id: int, *, actor: str = "system") -> bool:
    """原始倾诉即焚：清空 raw_ref，仅保留整理后的 surface_text（requirements 7.4）。

    raw_ref 属原文快照、非版本链内容，原地清空并写一条 UPDATE 历史。
    """
    store = MemoryStore(db)
    item = store.get(memory_id)
    if item is None or not item.raw_ref:
        return False
    old = item.raw_ref
    item.raw_ref = None
    store._write_history(  # noqa: SLF001  复用 store 的历史写入，保证 Property 4
        memory_id, "UPDATE", actor=actor,
        meta={"field": "raw_ref", "action": "burn", "old_len": len(old)},
    )
    db.commit()
    return True
