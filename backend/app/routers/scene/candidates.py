"""片场候选片段 Candidates：待确认候选的读 + 确认/忽略。见 docs/api-design.md §7.1。

候选 = memory_items 里 kind=片段、由倾倒提取产生（raw_ref 为空，排除原始倾倒 root 记录）、
尚未确认（status 空/pending/candidate）的条目。产品 §4.4：候选当晚静默入草稿箱、次日提醒确认。

确认后生成正式片场场景：供给包（stage.supply，用户确认即显式授权深层记忆入剧本）
+ LLM 开场（theater）；生成成功后才置 confirmed，失败保持待确认可重试。
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.db import SessionLocal, get_db
from app.deps import get_current_user
from app.graphs import theater
from app.models.memory import HistoryEvent, MemoryHistory, MemoryItem
from app.models.scene import Scene
from app.models.user import User
from app.routers.system._common import sse as _sse
from app.services.scene import stage
from app.services.memory.memory_store import MemoryStore
from app.services.memory.temporal import has_specific_time

router = APIRouter(prefix="/api/v1/candidates", tags=["candidates"])

# 视为"待确认"的 status 值（None 表示提取时未显式赋状态）
_PENDING = ("pending", "candidate")


class CandidateOut(BaseModel):
    id: int
    content: str
    surface_text: str
    status: str | None
    created_at: datetime
    # 用户当时说的原话：优先抽取时留下的原话片段；老数据取不到时退回整段倾诉原文（截断）；
    # 用户选了「原文即焚」或原文已焚则为 None
    evidence: str | None = None
    due_date: datetime | None = None
    has_time: bool = False

    model_config = {"from_attributes": True}


def _aware(dt: datetime | None) -> datetime | None:
    # SQLite 取回的时间不带时区，补成 UTC，前端解析才不会偏
    return dt.replace(tzinfo=timezone.utc) if dt is not None and dt.tzinfo is None else dt


def _evidence_of(db: Session, item: MemoryItem) -> str | None:
    """只读：从 ADD 历史的 meta 取原话片段；没有则退回来源倾诉的整段原文（≤300 字）。"""
    hist = db.scalar(
        select(MemoryHistory).where(
            MemoryHistory.memory_id == item.id,
            MemoryHistory.event == HistoryEvent.ADD.value,
        ).order_by(MemoryHistory.id)
    )
    if hist is not None and isinstance(hist.meta, dict) and hist.meta.get("evidence"):
        return str(hist.meta["evidence"])
    prov = item.provenance if isinstance(item.provenance, list) else []
    if prov and isinstance(prov[0], int):
        root = db.get(MemoryItem, prov[0])
        if root is not None and root.user_id == item.user_id and root.raw_ref:
            return root.raw_ref[:300]
    return None


def _out(db: Session, item: MemoryItem) -> CandidateOut:
    due = _aware(item.due_date)
    return CandidateOut(
        id=item.id, content=item.content, surface_text=item.surface_text, status=item.status,
        created_at=_aware(item.created_at), evidence=_evidence_of(db, item),
        due_date=due, has_time=due is not None and has_specific_time(due),
    )


def _pending_stmt(user_id: int):
    return select(MemoryItem).where(
        MemoryItem.user_id == user_id,
        MemoryItem.kind == "片段",
        MemoryItem.raw_ref.is_(None),  # 排除原始倾倒 root（那条 kind 也是片段但带 raw_ref）
        MemoryItem.is_latest == True,  # noqa: E712
        MemoryItem.is_forgotten == False,  # noqa: E712
        or_(MemoryItem.status.is_(None), MemoryItem.status.in_(_PENDING)),
    )


def _get_owned(db: Session, user_id: int, candidate_id: int) -> MemoryItem:
    item = db.scalar(_pending_stmt(user_id).where(MemoryItem.id == candidate_id))
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "候选片段不存在或已处理")
    return item


@router.get("", response_model=list[CandidateOut])
def list_candidates(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """待确认候选（草稿箱）。"""
    items = db.scalars(_pending_stmt(user.id).order_by(MemoryItem.created_at.desc())).all()
    return [_out(db, it) for it in items]


@router.get("/{candidate_id}", response_model=CandidateOut)
def get_candidate(
    candidate_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """单个候选片段详情。"""
    return _out(db, _get_owned(db, user.id, candidate_id))


@router.post("/{candidate_id}/confirm")
def confirm_candidate(
    candidate_id: int,
    stream: bool = Query(False, description="true 走 SSE 逐字揭幕开场"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """确认候选 → 标记 confirmed，并生成正式片场场景（供给包 + LLM 开场）。

    `?stream=true` 时逐 token 揭幕开场（SSE：confirmed → token… → choices → done）。
    """
    frag = _get_owned(db, user.id, candidate_id)
    # 用户点确认 = 显式授权相关深层记忆进入剧本生成（隐私闸门放行依据）
    pkg = stage.supply(db, user.id, candidate_id, explicit_consent=True)

    if not stream:
        if pkg is None:
            return {"id": candidate_id, "status": frag.status or "pending", "scene": None,
                    "note": "供给包组装失败，未生成场景；候选保持待确认可重试"}
        # 先生成开场，成功后才置 confirmed：失败时候选不会卡在「已确认无场景」
        opening = theater.generate_opening(pkg)
        MemoryStore(db).set_status(candidate_id, "confirmed", actor="user")
        scene = Scene(
            user_id=user.id, title=opening["title"], status="active",
            source_fragment_id=candidate_id, setting=opening["setting"],
            beats=opening["beats"], choices=opening["choices"], history=[], turn=0,
        )
        db.add(scene)
        db.commit()
        db.refresh(scene)
        return {
            "id": candidate_id, "status": "confirmed",
            "scene": {"id": scene.id, "title": scene.title, "setting": scene.setting,
                      "beats": scene.beats, "choices": scene.choices},
        }

    # 流式揭幕
    uid = user.id
    title = ((frag.surface_text or frag.content or "重演片刻").strip())[:30]
    desc = theater.pkg_desc(pkg) if pkg else None

    def gen():
        yield _sse("confirmed", {"candidate_id": candidate_id})
        if desc is None:
            yield _sse("done", {"scene_id": None, "note": "供给失败，未生成场景；候选保持待确认"})
            return
        db2 = SessionLocal()
        try:
            narrative, choices = "", []
            for kind, val in theater.stream_opening_tokens(desc):
                if kind == "token":
                    narrative += val
                    yield _sse("token", {"delta": val})
                elif kind == "choices":
                    choices = val
                    yield _sse("choices", {"choices": val})
            scene = Scene(
                user_id=uid, title=title, status="active",
                source_fragment_id=candidate_id, setting="",
                beats=[{"speaker": "旁白", "text": narrative.strip()}],
                choices=choices, history=[], turn=0,
            )
            db2.add(scene)
            db2.commit()
            db2.refresh(scene)
            # 场景落库成功才置 confirmed；中途失败候选仍可重试
            MemoryStore(db2).set_status(candidate_id, "confirmed", actor="user")
            yield _sse("done", {"scene_id": scene.id})
        finally:
            db2.close()

    return StreamingResponse(gen(), media_type="text/event-stream")


@router.delete("/{candidate_id}", status_code=status.HTTP_204_NO_CONTENT)
def dismiss_candidate(
    candidate_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """忽略候选 → 遗忘（写 FORGET 历史，不再召回）。"""
    _get_owned(db, user.id, candidate_id)
    MemoryStore(db).forget(candidate_id, reason="candidate_dismissed", actor="user")
    return None
