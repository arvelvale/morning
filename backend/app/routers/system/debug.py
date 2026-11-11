"""Debug / 调度端点。

POST /api/v1/debug/dream → 手动触发做梦 Agent（演示用，无需等凌晨）。
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user
from app.models.user import User

router = APIRouter(prefix="/api/v1/debug", tags=["debug"])


@router.post("/dream")
def trigger_dream(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """手动触发当前用户的做梦 Agent（黑客松演示用）。"""
    from app.graphs.dreaming import run_dreaming

    result = run_dreaming(db, user.id)
    return result


@router.post("/dream-all")
def trigger_dream_all(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """手动触发所有活跃用户的做梦（定时任务模拟）。需登录：避免匿名触发全量 LLM 作业。"""
    from app.graphs.dreaming import run_dreaming_all

    results = run_dreaming_all(db)
    return {"results": results}


@router.post("/evening-letter")
def trigger_evening_letter(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """手动触发当前用户的晚间来信（无需等设定的来信时间）。"""
    from app.services.mailbox.evening_letter import generate_evening_letter

    letter = generate_evening_letter(db, user.id)
    if letter is None:
        return {"sent": False, "reason": "llm_failed"}
    return {
        "sent": True,
        "letter_id": letter.id,
        "title": letter.title,
        "body": letter.body,
    }


@router.post("/scene-recommend")
def trigger_scene_recommend(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """手动触发当前用户的场景推荐分析（无需等夜间调度）。"""
    from app.services.scene.scene_recommend import analyze_for_user

    rec = analyze_for_user(db, user.id)
    if rec is None:
        return {"recommended": False}
    return {"recommended": True, "recommend": rec}
