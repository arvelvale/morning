"""睡前做梦 Agent：有界顺序执行图。

每日凌晨定时触发，按固定阶段运行：
  recall → cluster → descend → reconcile → forget → prepare

Property 7: 做梦不阻塞、不僭越。
- 下沉产物 confidence ≤ 来源均值、depth 更深、relation_type=derives、措辞不确定。
- 任一阶段失败仅记日志并跳过，不影响主链路。
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, TypedDict

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.llm import get_chat_model
from app.models.memory import DEPTH_DEFAULTS, MemoryItem
from app.services.memory.memory_store import MemoryStore

logger = logging.getLogger(__name__)

# 下沉阈值：同主题至少 N 条相关记忆才触发
DESCENT_THRESHOLD = 2

# depth 顺序（用于判断"更深"）
DEPTH_ORDER = ["surface", "personal", "vulnerable", "core"]


# ─── State ─────────────────────────────────────────────────────────────────────

class DreamState(TypedDict):
    user_id: int
    # recall
    recent_memories: list[dict[str, Any]]
    # cluster
    clusters: list[dict[str, Any]]  # [{theme, memory_ids, avg_confidence}]
    # descend
    descent_results: list[dict[str, Any]]
    # reconcile
    reconcile_count: int
    # forget
    forget_count: int
    # prepare
    candidates: list[dict[str, Any]]
    # meta
    errors: list[str]


# ─── 下沉提示词 ────────────────────────────────────────────────────────────────

DESCEND_SYSTEM_PROMPT = """\
你是喵灵的「做梦」整理模块。下面是用户近期多条相关记忆（同一主题）。
请你从中提炼出一个更深层的假设——用户可能真正在意/渴望/害怕的东西。

规则：
1) 假设的 depth 必须比所有来源记忆都深（来源最深为 {max_depth}，你应输出更深的层级）。
2) confidence 不得超过来源记忆的平均置信度 {avg_confidence:.2f}。
3) surface_text 必须用不确定措辞（"可能""好像""是不是""也许"），绝不把推测当事实。
4) content 用第三人称客观描述这个假设。
5) 只输出一个 JSON 对象，字段: depth, content, surface_text, confidence。
6) 如果这些记忆不足以支撑更深的假设，输出: {"skip": true}
"""


# ─── Nodes ─────────────────────────────────────────────────────────────────────

def recall(state: DreamState, db: Session) -> dict[str, Any]:
    """召回近 24h 的记忆。"""
    since = datetime.now(timezone.utc) - timedelta(hours=24)
    stmt = select(MemoryItem).where(
        MemoryItem.user_id == state["user_id"],
        MemoryItem.created_at >= since,
        MemoryItem.is_forgotten == False,  # noqa: E712
        MemoryItem.is_latest == True,  # noqa: E712
    )
    items = list(db.scalars(stmt).all())
    memories = [
        {
            "id": m.id,
            "layer": m.layer,
            "kind": m.kind,
            "depth": m.depth,
            "privacy": m.privacy,
            "content": m.content,
            "confidence": m.confidence,
            "entities": m.entities or [],
        }
        for m in items
    ]
    logger.info("[dream] recall: %d memories for user %d", len(memories), state["user_id"])
    return {"recent_memories": memories}


def cluster(state: DreamState) -> dict[str, Any]:
    """按主题聚类 personal/vulnerable 信号。

    二级分组策略：
    1. 先按 kind 粗分（待办/情绪/灵感等交还方式不同的不混聚）
    2. 同 kind 内按 entities 交集连通分量细分（共享至少一个 entity 视为同主题）
    3. 无 entities 的记忆按 content 关键词兜底归组
    只有 ≥ DESCENT_THRESHOLD 条的聚类才触发下沉。
    """
    memories = state.get("recent_memories", [])
    # 只聚类 personal/vulnerable 层（surface 不需要下沉）
    deepish = [m for m in memories if m["depth"] in ("personal", "vulnerable")]

    if len(deepish) < DESCENT_THRESHOLD:
        return {"clusters": []}

    # 第一级：按 kind 分组
    by_kind: dict[str, list[dict]] = {}
    for m in deepish:
        by_kind.setdefault(m["kind"], []).append(m)

    clusters = []
    for kind, items in by_kind.items():
        # 第二级：entities 交集连通分量（纯本地，无外部 embedding）
        sub_groups = _entity_connected_components(items)
        for group in sub_groups:
            if len(group) >= DESCENT_THRESHOLD:
                # 主题标签：取出现频率最高的 entity，否则用 kind
                theme = _pick_theme(group, kind)
                avg_conf = sum(i["confidence"] for i in group) / len(group)
                clusters.append({
                    "theme": theme,
                    "memory_ids": [i["id"] for i in group],
                    "memories": group,
                    "avg_confidence": avg_conf,
                    "max_depth": max((i["depth"] for i in group), key=lambda d: DEPTH_ORDER.index(d)),
                })

    logger.info("[dream] cluster: %d clusters from %d deepish memories", len(clusters), len(deepish))
    return {"clusters": clusters}


def _entity_connected_components(items: list[dict]) -> list[list[dict]]:
    """连通分量：entities 有交集（共享至少一个）则归为同组。纯本地，无外部 embedding。"""
    n = len(items)
    parent = list(range(n))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    # 两两比较：entities 交集
    for i in range(n):
        ents_i = set(items[i].get("entities") or [])
        for j in range(i + 1, n):
            ents_j = set(items[j].get("entities") or [])
            if ents_i and (ents_i & ents_j):
                union(i, j)

    # 收集连通分量
    groups: dict[int, list[dict]] = {}
    for idx in range(n):
        root = find(idx)
        groups.setdefault(root, []).append(items[idx])

    return list(groups.values())


def _pick_theme(group: list[dict], fallback_kind: str) -> str:
    """从聚类中选出主题标签：频率最高的 entity > kind。"""
    from collections import Counter
    ent_counter: Counter = Counter()
    for m in group:
        for e in (m.get("entities") or []):
            if e:
                ent_counter[e] += 1
    if ent_counter:
        return ent_counter.most_common(1)[0][0]
    return fallback_kind


def descend(state: DreamState, db: Session) -> dict[str, Any]:
    """对超阈值聚类调用 LLM 生成更深 depth 假设。"""
    clusters = state.get("clusters", [])
    if not clusters:
        return {"descent_results": []}

    llm = get_chat_model()
    store = MemoryStore(db)
    results = []

    for cl in clusters:
      try:
        max_depth = cl["max_depth"]
        avg_conf = cl["avg_confidence"]

        # 如果已经是最深 core，无法再下沉
        if max_depth not in DEPTH_ORDER or DEPTH_ORDER.index(max_depth) >= len(DEPTH_ORDER) - 1:
            continue

        # 构建 LLM 输入
        mem_text = "\n".join(
            f"- [{m['depth']}] {m['content']} (confidence={m['confidence']:.2f})"
            for m in cl["memories"]
        )
        system = DESCEND_SYSTEM_PROMPT.format(
            max_depth=max_depth, avg_confidence=avg_conf
        )
        user_msg = f"主题：{cl['theme']}\n相关记忆：\n{mem_text}"

        resp = llm.invoke([
            {"role": "system", "content": system},
            {"role": "user", "content": user_msg},
        ])
        import json
        # 容错：LLM 可能返回 markdown 包裹的 JSON
        raw = resp.content.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
        parsed = json.loads(raw)

        if not isinstance(parsed, dict) or parsed.get("skip"):
            continue

        # 验证约束
        new_depth = parsed.get("depth", "")
        new_conf = float(parsed.get("confidence", 0))

        # depth 必须比来源更深
        if new_depth not in DEPTH_ORDER or DEPTH_ORDER.index(new_depth) <= DEPTH_ORDER.index(max_depth):
            logger.warning("[dream] descend rejected: depth %s not deeper than %s", new_depth, max_depth)
            continue

        # confidence 不超过来源均值
        new_conf = min(new_conf, avg_conf)

        # 写入记忆
        item = store.create(
            user_id=state["user_id"],
            layer="profile",
            kind="情绪",
            depth=new_depth,
            content=parsed.get("content", ""),
            surface_text=parsed.get("surface_text", ""),
            confidence=new_conf,
            relation_type="derives",
            provenance=cl["memory_ids"],
        )
        results.append({
            "memory_id": item.id,
            "depth": new_depth,
            "confidence": new_conf,
            "source_ids": cl["memory_ids"],
        })
        logger.info("[dream] descend: created id=%d depth=%s conf=%.2f", item.id, new_depth, new_conf)

      except Exception as e:
        logger.warning("[dream] descend failed for cluster '%s': %s", cl.get("theme", "?"), e)
        continue

    return {"descent_results": results}


def reconcile(state: DreamState, db: Session) -> dict[str, Any]:
    """profile/state 去重：高置信覆盖低置信（保版本链）。"""
    memories = state.get("recent_memories", [])
    profile_state = [m for m in memories if m["layer"] in ("profile", "state")]

    if len(profile_state) < 2:
        return {"reconcile_count": 0}

    # 简单去重：同 kind + 相似 content 视为重复，保留高置信
    by_kind: dict[str, list[dict]] = {}
    for m in profile_state:
        by_kind.setdefault(m["kind"], []).append(m)

    store = MemoryStore(db)
    count = 0

    for kind, items in by_kind.items():
        if len(items) < 2:
            continue
        # 按 confidence 降序，第一条保留，其余遗忘
        items_sorted = sorted(items, key=lambda x: x["confidence"], reverse=True)
        for dup in items_sorted[1:]:
            try:
                store.forget(dup["id"], reason=f"reconcile_dup_of_{items_sorted[0]['id']}", actor="dream")
                count += 1
            except Exception as e:
                logger.warning("[dream] reconcile forget failed id=%d: %s", dup["id"], e)

    logger.info("[dream] reconcile: %d duplicates resolved", count)
    return {"reconcile_count": count}


def forget(state: DreamState, db: Session) -> dict[str, Any]:
    """过期遗忘（复用 inbox.expire_ephemeral 逻辑）。"""
    from app.services.mailbox.inbox import expire_ephemeral
    count = expire_ephemeral(db)
    logger.info("[dream] forget: %d expired", count)
    return {"forget_count": count}


def prepare(state: DreamState) -> dict[str, Any]:
    """生成主动陪伴候选（深层 + 有 provenance 的下沉产物）。"""
    descents = state.get("descent_results", [])
    candidates = [
        {
            "memory_id": d["memory_id"],
            "depth": d["depth"],
            "confidence": d["confidence"],
            "source_ids": d["source_ids"],
        }
        for d in descents
    ]
    logger.info("[dream] prepare: %d proactive candidates", len(candidates))
    return {"candidates": candidates}


# ─── Graph Builder ─────────────────────────────────────────────────────────────

def run_dreaming(db: Session, user_id: int) -> dict[str, Any]:
    """执行一次做梦流程（有界，固定阶段）。

    每阶段 try/except 隔离，失败记日志并跳过。
    返回执行摘要。
    """
    settings = get_settings()
    if not settings.dreaming_enabled:
        logger.info("[dream] disabled by settings, skipping user %d", user_id)
        return {"status": "disabled", "user_id": user_id}

    state: DreamState = {
        "user_id": user_id,
        "recent_memories": [],
        "clusters": [],
        "descent_results": [],
        "reconcile_count": 0,
        "forget_count": 0,
        "candidates": [],
        "errors": [],
    }

    # 阶段 1: recall
    try:
        state.update(recall(state, db))
    except Exception as e:
        logger.error("[dream] recall failed: %s", e)
        state["errors"].append(f"recall: {e}")

    # 阶段 2: cluster
    try:
        state.update(cluster(state))
    except Exception as e:
        logger.error("[dream] cluster failed: %s", e)
        state["errors"].append(f"cluster: {e}")

    # 阶段 3: descend
    try:
        state.update(descend(state, db))
    except Exception as e:
        logger.error("[dream] descend failed: %s", e)
        state["errors"].append(f"descend: {e}")

    # 阶段 4: reconcile
    try:
        state.update(reconcile(state, db))
    except Exception as e:
        logger.error("[dream] reconcile failed: %s", e)
        state["errors"].append(f"reconcile: {e}")

    # 阶段 5: forget
    try:
        state.update(forget(state, db))
    except Exception as e:
        logger.error("[dream] forget failed: %s", e)
        state["errors"].append(f"forget: {e}")

    # 阶段 6: prepare
    try:
        state.update(prepare(state))
    except Exception as e:
        logger.error("[dream] prepare failed: %s", e)
        state["errors"].append(f"prepare: {e}")

    summary = {
        "status": "done",
        "user_id": user_id,
        "recalled": len(state["recent_memories"]),
        "clusters": len(state["clusters"]),
        "descents": len(state["descent_results"]),
        "reconciled": state["reconcile_count"],
        "forgotten": state["forget_count"],
        "candidates": len(state["candidates"]),
        "errors": state["errors"],
    }
    logger.info("[dream] summary: %s", summary)
    return summary


def run_dreaming_all(db: Session) -> list[dict[str, Any]]:
    """对所有活跃用户执行做梦（定时任务入口）。"""
    from app.services.infra.engagement import reachable_users

    users = reachable_users(db, "dreaming")  # 跳过连续多天没打开 App 的用户，见 engagement.py
    results = []
    for user in users:
        try:
            result = run_dreaming(db, user.id)
            results.append(result)
        except Exception as e:
            logger.error("[dream] user %d failed entirely: %s", user.id, e)
            results.append({"status": "error", "user_id": user.id, "error": str(e)})
    return results
