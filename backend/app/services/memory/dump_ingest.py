"""睡前倾倒编排服务。

流程：raw_ref 落库 → 调 extractor 图 → 逐条 store.create → 构建回执。
失败兜底：提取失败仍保留 raw_ref，返回「已收到」回执（Property 1）。
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Generator

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.graphs.extractor import run_extractor
from app.models.preference import UserPreference
from app.services.memory import privacy
from app.services.memory.memory_store import MemoryStore
from app.services.memory.context_builder import build as build_memory_context
from app.services.memory.temporal import parse_due_at
from app.services.infra.preferences import ttl_days_for

logger = logging.getLogger(__name__)

# 入「寄存」并落 TTL 的 kind：情绪、未确认片段（候选）。
# 待办/小结/灵感是可行动产出，进各自存储、不过期。
EPHEMERAL_KINDS = {"情绪", "片段"}


def _should_keep_raw(db: Session, user_id: int) -> bool:
    """读用户「保留原始倾诉」开关；无偏好行时默认保留（不焚）。"""
    pref = db.scalar(select(UserPreference).where(UserPreference.user_id == user_id))
    return pref.keep_raw_dump if pref else True


@dataclass
class ReceiptItem:
    kind: str
    content: str
    memory_id: int


@dataclass
class DumpReceipt:
    dump_id: int
    total: int
    items: list[ReceiptItem] = field(default_factory=list)
    kind_counts: dict[str, int] = field(default_factory=dict)
    outputs: dict[str, list[int]] = field(default_factory=dict)  # 产出项引用（§5）
    fallback: bool = False  # True = 提取失败，走兜底
    error: str = ""


# kind → 产出引用键（§5/§6/§7.1）：片段即片场候选片段
KIND_TO_OUTPUT = {
    "待办": "todos",
    "小结": "summary",
    "灵感": "ideas",
    "情绪": "emotions",
    "片段": "candidates",
}

OUTPUT_KEYS = ("todos", "summary", "ideas", "emotions", "candidates")


def ingest_dump(db: Session, *, user_id: int, dump_text: str,
                raw_ref: str | None = None) -> Generator[dict[str, Any], None, DumpReceipt]:
    """生成器：边处理边 yield SSE 事件，最终返回 DumpReceipt。

    Yields:
        {"event": "item.classified", "data": {...}}  每分类成功一条
        {"event": "receipt", "data": {...}}          最终回执
        {"event": "done", "data": {}}                结束标记
    """
    store = MemoryStore(db)
    ttl_days = ttl_days_for(db, user_id)  # 用户偏好的寄存天数（默认 7）

    # 1. raw_ref 落库（创建一条 root 记忆作为倾倒原始记录）
    raw_item = store.create(
        user_id=user_id,
        layer="episodic",
        kind="片段",
        depth="surface",
        content=f"[原始倾倒] {dump_text[:200]}...",
        surface_text="你昨晚的一段倾诉",
        confidence=1.0,
        raw_ref=raw_ref or dump_text,
        status="processing",  # 处理中；收尾置 done（GET 回执的 status 语义）
        actor="dump_ingest",
    )
    dump_id = raw_item.id

    # 2. 调 LangGraph extractor
    try:
        profile_context = build_memory_context(db, user_id, mode="profile")
        facts = run_extractor(dump_text, profile_context=profile_context)
    except Exception as e:
        logger.error("Extractor crashed: %s", e)
        facts = []

    # 3. 提取失败 → 兜底回执（处理流程已结束，状态仍为 done）
    if not facts:
        store.set_status(dump_id, "done", actor="dump_ingest")
        receipt = DumpReceipt(
            dump_id=dump_id, total=0, fallback=True,
            outputs={k: [] for k in OUTPUT_KEYS},
            error="提取为空或失败，原始倾诉已安全保留",
        )
        yield {"event": "receipt", "data": _receipt_dict(receipt)}
        yield {"event": "done", "data": {}}
        return receipt

    # 4. 逐条写入 + 流式推送
    items: list[ReceiptItem] = []
    kind_counts: dict[str, int] = {}

    # 用户选了「原文即焚」时，逐字原话片段也不留（evidence 是原文摘录）
    keep_raw = _should_keep_raw(db, user_id)
    for fact in facts:
        # 情绪 / 未确认片段入寄存并落 TTL（按用户偏好天数，到期由 inbox.expire_ephemeral 真删）
        ttl = (
            datetime.now(timezone.utc) + timedelta(days=ttl_days)
            if fact["kind"] in EPHEMERAL_KINDS
            else None
        )
        # 截止时间：模型给的 due_at（东八区 ISO）→ UTC 入库。
        # 设计值 → 代码换算：「今天10点15」→ 2026-10-19T10:15+08:00 → 存 2026-10-19T02:15Z；
        # 只有日期（has_time=false）→ 当天东八区 00:00（= 前一天 16:00Z）。
        # 非法/解析失败 → due_date=None，只丢截止时间，绝不丢这条记忆。
        due_date = _safe_due_date(fact)
        mem = store.create(
            user_id=user_id,
            layer=fact["layer"],
            kind=fact["kind"],
            depth=fact["depth"],
            content=fact["content"],
            surface_text=fact.get("surface_text", ""),
            confidence=fact.get("confidence", 0.8),
            entities=fact.get("entities"),
            emotion=fact.get("emotion"),
            provenance=[dump_id],
            raw_ref=None,  # 子条目不重复存 raw
            expires_at=ttl,
            due_date=due_date,
            actor="extractor",
            # 抽取到的原话片段随 ADD 历史留存（候选/片段详情可读；不改表）
            history_meta=_history_meta(fact, keep_evidence=keep_raw),
        )
        ri = ReceiptItem(kind=fact["kind"], content=fact["content"], memory_id=mem.id)
        items.append(ri)
        kind_counts[fact["kind"]] = kind_counts.get(fact["kind"], 0) + 1

        # 流式推送每条分类结果
        yield {
            "event": "item.classified",
            "data": {
                "memory_id": mem.id,
                "layer": fact["layer"],
                "kind": fact["kind"],
                "depth": fact["depth"],
                "content": fact["content"],
                "surface_text": fact.get("surface_text", ""),
            },
        }

    # 5. 构建回执（含产出项引用：todos/summary/ideas/emotions/candidates 的 id）
    outputs: dict[str, list[int]] = {k: [] for k in OUTPUT_KEYS}
    for ri in items:
        key = KIND_TO_OUTPUT.get(ri.kind)
        if key:
            outputs[key].append(ri.memory_id)

    store.set_status(dump_id, "done", actor="dump_ingest")

    # 6. 原文即焚（requirements 7.4）：提取成功、已有整理后 surface 可替代原话时，
    #    按用户开关抹掉逐字原文 / 原始语音引用。失败兜底分支不焚（见上：原话须留住）。
    if not _should_keep_raw(db, user_id):
        privacy.burn_raw_ref(db, dump_id, actor="dump_ingest")

    receipt = DumpReceipt(
        dump_id=dump_id, total=len(items),
        items=items, kind_counts=kind_counts, outputs=outputs,
    )
    yield {"event": "receipt", "data": _receipt_dict(receipt)}
    yield {"event": "done", "data": {}}
    return receipt


def _safe_due_date(fact: dict[str, Any]) -> datetime | None:
    """解析 fact 的 due_at；任何异常都当没有截止时间。"""
    try:
        return parse_due_at(fact.get("due_at"), fact.get("has_time", True))
    except Exception as e:  # noqa: BLE001
        logger.warning("due_at 解析失败，忽略截止时间: %r (%s)", fact.get("due_at"), e)
        return None


def _history_meta(fact: dict[str, Any], *, keep_evidence: bool = True) -> dict[str, Any] | None:
    """抽取元信息，写进 ADD 历史：evidence=原话片段，due_at=模型原始截止串。"""
    meta = {}
    if keep_evidence and fact.get("evidence"):
        meta["evidence"] = str(fact["evidence"])[:500]
    if fact.get("due_at"):
        meta["due_at"] = fact["due_at"]
        meta["has_time"] = bool(fact.get("has_time", True))
    return meta or None


def _receipt_dict(r: DumpReceipt) -> dict:
    return {
        "dump_id": r.dump_id,
        "total": r.total,
        "kind_counts": r.kind_counts,
        "outputs": r.outputs,
        "fallback": r.fallback,
        "error": r.error,
        "items": [{"kind": i.kind, "content": i.content, "memory_id": i.memory_id} for i in r.items],
    }
