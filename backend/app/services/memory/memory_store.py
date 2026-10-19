"""MemoryStore：所有记忆读写的唯一入口。

封装版本链与历史落库，保证：
- 任何写操作必伴随一条 memory_history（Property 4）
- UPDATE 走版本链（Property 5）
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.memory import (
    DEPTH_DEFAULTS,
    Depth,
    HistoryEvent,
    MemoryHistory,
    MemoryItem,
)


class MemoryStore:
    """面向单个 DB session 的记忆存储操作集。"""

    def __init__(self, db: Session):
        self._db = db

    # ─── 新建 ──────────────────────────────────────────────────────────────

    def create(self, *, user_id: int, layer: str, kind: str, depth: str,
               content: str, surface_text: str = "", confidence: float = 1.0,
               entities: list | None = None, emotion: dict | None = None,
               provenance: list | None = None, raw_ref: str | None = None,
               expires_at: datetime | None = None,
               status: str | None = None, due_date: datetime | None = None,
               relation_type: str | None = None, relation_to_id: int | None = None,
               actor: str = "system", history_meta: dict | None = None) -> MemoryItem:
        """创建一条记忆，同步写 ADD 历史。自动按 depth 填充默认门控/隐私。"""
        defaults = DEPTH_DEFAULTS.get(Depth(depth), {})
        item = MemoryItem(
            user_id=user_id,
            layer=layer,
            kind=kind,
            depth=depth,
            content=content,
            surface_text=surface_text or content,
            confidence=confidence,
            status=status,
            due_date=due_date,
            entities=entities,
            emotion=emotion,
            provenance=provenance,
            raw_ref=raw_ref,
            expires_at=expires_at,
            relation_type=relation_type,
            relation_to_id=relation_to_id,
            visibility_gate=defaults.get("visibility_gate", 0.0),
            privacy=defaults.get("privacy", "cloud"),
            version=1,
            is_latest=True,
        )
        self._db.add(item)
        self._db.flush()  # 拿到 id

        # root_id 指向自身
        item.root_id = item.id

        # 写历史
        self._write_history(item.id, HistoryEvent.ADD, actor=actor,
                            new_content=content, meta=history_meta)
        self._db.commit()
        self._db.refresh(item)
        return item

    # ─── 读取 ──────────────────────────────────────────────────────────────

    def get(self, id: int) -> MemoryItem | None:
        """按 id 取一条记忆（不过滤遗忘/版本）；不存在返回 None。"""
        return self._db.get(MemoryItem, id)

    # ─── 更新（版本链）────────────────────────────────────────────────────

    def update(self, id: int, patch: dict[str, Any], *, actor: str = "system") -> MemoryItem:
        """更新一条记忆：旧版本 is_latest=False，创建 version+1 新版本。"""
        old = self._db.get(MemoryItem, id)
        if old is None:
            raise ValueError(f"MemoryItem {id} not found")
        if not old.is_latest:
            raise ValueError(f"MemoryItem {id} is not the latest version")

        old_content = old.content

        # 旧版本标记
        old.is_latest = False

        # 新版本
        new = MemoryItem(
            user_id=old.user_id,
            layer=patch.get("layer", old.layer),
            kind=patch.get("kind", old.kind),
            depth=patch.get("depth", old.depth),
            content=patch.get("content", old.content),
            surface_text=patch.get("surface_text", old.surface_text),
            confidence=patch.get("confidence", old.confidence),
            status=patch.get("status", old.status),
            due_date=patch.get("due_date", old.due_date),
            entities=patch.get("entities", old.entities),
            emotion=patch.get("emotion", old.emotion),
            provenance=patch.get("provenance", old.provenance),
            raw_ref=old.raw_ref,
            expires_at=patch.get("expires_at", old.expires_at),
            relation_type=patch.get("relation_type", old.relation_type),
            relation_to_id=patch.get("relation_to_id", old.relation_to_id),
            visibility_gate=patch.get("visibility_gate", old.visibility_gate),
            privacy=patch.get("privacy", old.privacy),
            version=old.version + 1,
            parent_id=old.id,
            root_id=old.root_id,
            is_latest=True,
        )
        self._db.add(new)
        self._db.flush()

        self._write_history(new.id, HistoryEvent.UPDATE, actor=actor,
                            old_content=old_content, new_content=new.content,
                            meta={"parent_id": old.id, "version": new.version})
        self._db.commit()
        self._db.refresh(new)
        return new

    # ─── 状态标记（原地更新，不走版本链）───────────────────────────────────

    def set_status(self, id: int, status: str, *, actor: str = "system") -> None:
        """原地更新状态标记（如倾倒处理进度 processing→done）。

        内容未变，id 必须保持稳定（dump_id 即 root id），故不走版本链，
        但仍写一条 UPDATE 历史（Property 4）。
        """
        item = self._db.get(MemoryItem, id)
        if item is None:
            raise ValueError(f"MemoryItem {id} not found")
        old = item.status
        item.status = status
        self._write_history(id, HistoryEvent.UPDATE, actor=actor,
                            meta={"field": "status", "old": old, "new": status})
        self._db.commit()

    # ─── 遗忘 / 删除 ──────────────────────────────────────────────────────

    def forget(self, id: int, reason: str = "", *,
               event: str = HistoryEvent.FORGET, actor: str = "system") -> None:
        """置 is_forgotten 并写历史。用户删除复用此路径（event=DELETE）。"""
        item = self._db.get(MemoryItem, id)
        if item is None:
            raise ValueError(f"MemoryItem {id} not found")
        old_content = item.content
        item.is_forgotten = True
        item.forget_reason = reason
        item.is_latest = False

        self._write_history(id, HistoryEvent(event), actor=actor,
                            old_content=old_content, meta={"reason": reason})
        self._db.commit()

    # ─── 查询 ──────────────────────────────────────────────────────────────

    def list_by_layer(self, user_id: int, layer: str, *, latest: bool = True) -> list[MemoryItem]:
        """取用户某 layer（profile/state/episodic…）的未遗忘记忆；latest=True 只取最新版。"""
        stmt = select(MemoryItem).where(
            MemoryItem.user_id == user_id,
            MemoryItem.layer == layer,
            MemoryItem.is_forgotten == False,  # noqa: E712
        )
        if latest:
            stmt = stmt.where(MemoryItem.is_latest == True)  # noqa: E712
        return list(self._db.scalars(stmt).all())

    def list_by_kind(self, user_id: int, kind: str, *, latest: bool = True) -> list[MemoryItem]:
        """取用户某 kind（待办/小结/片段…）的未遗忘记忆；latest=True 只取最新版。"""
        stmt = select(MemoryItem).where(
            MemoryItem.user_id == user_id,
            MemoryItem.kind == kind,
            MemoryItem.is_forgotten == False,  # noqa: E712
        )
        if latest:
            stmt = stmt.where(MemoryItem.is_latest == True)  # noqa: E712
        return list(self._db.scalars(stmt).all())

    def list_by_depth(self, user_id: int, depth: str, *, latest: bool = True) -> list[MemoryItem]:
        """取用户某 depth（surface/personal/vulnerable/core）的未遗忘记忆；latest=True 只取最新版。"""
        stmt = select(MemoryItem).where(
            MemoryItem.user_id == user_id,
            MemoryItem.depth == depth,
            MemoryItem.is_forgotten == False,  # noqa: E712
        )
        if latest:
            stmt = stmt.where(MemoryItem.is_latest == True)  # noqa: E712
        return list(self._db.scalars(stmt).all())

    def list_by_root(self, root_id: int) -> list[MemoryItem]:
        """取一条记忆的完整版本链。"""
        stmt = select(MemoryItem).where(MemoryItem.root_id == root_id).order_by(MemoryItem.version)
        return list(self._db.scalars(stmt).all())

    def list_all_latest(self, user_id: int) -> list[MemoryItem]:
        """取用户全部最新、未遗忘的记忆（供记忆审阅/清空使用）。"""
        stmt = select(MemoryItem).where(
            MemoryItem.user_id == user_id,
            MemoryItem.is_latest == True,  # noqa: E712
            MemoryItem.is_forgotten == False,  # noqa: E712
        ).order_by(MemoryItem.id.desc())
        return list(self._db.scalars(stmt).all())

    def clear_all(self, user_id: int, *, actor: str = "user") -> int:
        """清空用户全部记忆（走 forget，保留 history）。返回清空条数。"""
        items = self.list_all_latest(user_id)
        for item in items:
            self.forget(item.id, reason="user_clear_all", event="DELETE", actor=actor)
        return len(items)


    # ─── 内部 ──────────────────────────────────────────────────────────────

    def _write_history(self, memory_id: int, event: HistoryEvent, *,
                       actor: str = "system", old_content: str | None = None,
                       new_content: str | None = None, meta: dict | None = None) -> None:
        h = MemoryHistory(
            memory_id=memory_id,
            event=event.value if isinstance(event, HistoryEvent) else event,
            actor=actor,
            old_content=old_content,
            new_content=new_content,
            meta=meta,
        )
        self._db.add(h)
