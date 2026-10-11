"""片场 Scenes：创建/详情/推进/结算。见 docs/api-design.md §7.2、§7.3。

MVP：单场景单次体验（Scene 自带当前剧情状态），非流式。剧情生成/推进走 app/graphs/theater.py，
结算回写复用 app/services/stage.py 的 settle。均按登录用户隔离。
"""
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import SessionLocal, get_db
from app.deps import get_current_user
from app.graphs import theater
from app.models.scene import Scene
from app.models.user import User
from app.routers.system._common import get_owned_scene as _get_owned, sse as _sse
from app.services.scene import scene_service
from app.services.scene.scene_images import gen_scene_images
from app.services.scene.scene_recommend import PRESET_THEATERS, detect_scene_intent
from app.services.scene.scene_turn_images import schedule_bg_regen
from app.services.memory.content_signals import capture_best_effort, source_hash

router = APIRouter(prefix="/api/v1/scenes", tags=["scenes"])


# ─── Schemas ─────────────────────────────────────────────────────────────────

class SceneCreate(BaseModel):
    title: str | None = None
    people: str | None = None
    place: str | None = None
    plot: str | None = None
    intent: str | None = None
    # 方案B-2：即时建场景可指定预置 3D 剧场；合法则落 preset_3d + theater_id
    theater_id: str | None = None
    render_kind: str | None = None


class ChoiceIn(BaseModel):
    choice_id: str | None = None
    custom_text: str | None = None  # 「自己说」：用户自由输入的回应，优先于 choice_id


class SettlementIn(BaseModel):
    action_text: str | None = None
    insight_text: str | None = None
    related_memory_ids: list[int] | None = None
    role_id: int | None = None
    keep: bool = True
    card_text: str | None = None


class SceneIntentIn(BaseModel):
    text: str  # 用户在通话中刚说的一句（或最近几句）转写


class SceneOut(BaseModel):
    id: int
    title: str
    status: str
    setting: str
    beats: list | None
    choices: list | None
    history: list | None
    turn: int
    source_fragment_id: int | None
    created_at: datetime

    # 渲染层（DAY-209）：旧数据缺字段时按 preset_3d 兼容
    render_kind: str = "preset_3d"
    theater_id: str | None = None
    bg_image: str | None = None
    characters: list | None = None
    scene_spec: dict | None = None  # generated_3d 的 SceneSpec（前端 assembleScene 拼装）

    model_config = {"from_attributes": True}


# ─── 内部 ────────────────────────────────────────────────────────────────────

def _resolve_theater(theater_id: str | None) -> tuple[str, str | None]:
    """把入参 theater_id 归一化为 (render_kind, theater_id)。

    合法预置舞台 → ("preset_3d", tid)；否则退回默认 ("preset_3d", None)，绝不报错。
    """
    if theater_id and theater_id in PRESET_THEATERS:
        return "preset_3d", theater_id
    return "preset_3d", None


def _persist_opening(
    db: Session,
    user_id: int,
    opening: dict,
    fragment_id: int | None,
    theater_id: str | None = None,
    render_kind: str | None = None,
    bg_image: str | None = None,
    characters: list | None = None,
    scene_spec: dict | None = None,
) -> Scene:
    # render_kind="dynamic_image" 走 galgame（背景图+立绘）；generated_3d 走生成式 3D（存 scene_spec）；
    # 否则按预置舞台归一化为 preset_3d。
    if render_kind == "dynamic_image":
        rk, tid = "dynamic_image", None
    elif render_kind == "generated_3d" and scene_spec:
        rk, tid = "generated_3d", None
    else:
        rk, tid = _resolve_theater(theater_id)
    s = Scene(
        user_id=user_id,
        title=opening["title"],
        status="active",
        source_fragment_id=fragment_id,
        setting=opening["setting"],
        beats=opening["beats"],
        choices=opening["choices"],
        history=[],
        turn=0,
        render_kind=rk,
        theater_id=tid,
        bg_image=bg_image,
        characters=characters,
        scene_spec=scene_spec,
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return s


def _node(s: Scene) -> dict:
    """把 Scene 当前状态转成视觉小说节点（背景/角色/对话/可选回应）。"""
    speakers = set()
    for b in (s.beats or []):
        if isinstance(b, dict):
            sp = b.get("speaker")
            if sp and sp != "旁白":
                speakers.add(sp)
    return {
        "background": s.setting or "",
        "characters": [{"name": name, "sprite": None} for name in speakers],
        "dialogue": s.beats or [],
        "choices": s.choices or [],
    }


def _play_id_match(s: Scene, play_id: str) -> bool:
    return play_id in (str(s.id), f"play-{s.id}")


def _advance_stream_gen(scene_id: int, label: str, turn: int, response_source: str = "choice"):
    """流式推进的 SSE 生成器（被 /choices 与 /plays/{play_id}/choices 复用）。"""
    db2 = SessionLocal()
    try:
        sc = db2.get(Scene, scene_id)
        if sc is None:
            yield _sse("error", {"message": "场景不存在"})
            return
        narrative, choices = "", []
        closure_ready = False
        for kind, val in theater.stream_advance_tokens(
            {"setting": sc.setting, "beats": sc.beats, "history": sc.history, "turn": sc.turn},
            label,
        ):
            if kind == "token":
                narrative += val
                yield _sse("token", {"delta": val})
            elif kind == "choices":
                choices = val
                yield _sse("choices", {"choices": val})
            elif kind == "closure":
                closure_ready = bool(val)
        sc.turn = turn
        # DAY-228：beats 追加而非整体替换，保住完整对白史，供结算摘要取材
        sc.beats = (sc.beats or []) + [{"speaker": "旁白", "text": narrative.strip() or "……"}]
        sc.choices = choices
        sc.history = (sc.history or []) + [{
            "turn": turn,
            "choice": label,
            "source": "custom" if response_source == "custom" else "choice",
        }]
        db2.commit()
        # DAY-229：galgame 场景推进后异步刷新背景图（不阻塞 SSE，旧图保留到新图就绪）
        if sc.render_kind == "dynamic_image":
            schedule_bg_regen(sc.id)
        yield _sse("done", {
            "scene_id": sc.id,
            "turn": turn,
            "ended": False,
            # 第一次回应不主动建议收束；从第二次起只给建议，场景是否结束仍由用户决定。
            "closure_ready": closure_ready and turn >= 2,
        })
    finally:
        db2.close()


class PlayOut(BaseModel):
    play_id: str
    scene_id: int
    status: str
    turn: int
    node: dict

    model_config = {"from_attributes": True}


# ─── Endpoints ───────────────────────────────────────────────────────────────

@router.get("", response_model=list[SceneOut])
def list_scenes(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """当前用户的全部场景，按 id 倒序（最新在前）。夜里预搭、尚未被接受的邀请场景不展示。"""
    from app.services.scene.invite_stage import INVITED

    return list(db.scalars(
        select(Scene).where(Scene.user_id == user.id, Scene.status != INVITED).order_by(Scene.id.desc())
    ).all())


@router.post("/detect-intent", response_model=None)
def scene_detect_intent(
    body: SceneIntentIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """通话中·单句实时场景意图识别（方案B-1）。

    纯判定：不写库、不发信。命中时返回 {worth:true, seed, render_kind, theater_id, confidence}，
    否则 {worth:false}。供前端在语音通话里逐句调用，触发「场景邀请提示条」。
    """
    rec = detect_scene_intent(body.text)
    if rec is None:
        return {"worth": False}
    return {
        "worth": True,
        "seed": rec.get("seed"),
        "render_kind": rec.get("render_kind"),
        "theater_id": rec.get("theater_id"),
        "confidence": rec.get("confidence"),
    }


@router.post("", response_model=None, status_code=status.HTTP_201_CREATED)
def create_scene(
    body: SceneCreate,
    background_tasks: BackgroundTasks,
    stream: bool = Query(False, description="true 走 SSE 逐句浮现"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """主动创建场景：用提供的人物/地点/经过/表达生成开场。`?stream=true` 逐句 SSE。"""
    desc = theater.manual_desc(
        title=body.title, people=body.people, place=body.place, plot=body.plot, intent=body.intent
    )
    if not stream:
        opening = theater.generate_manual(
            title=body.title, people=body.people, place=body.place, plot=body.plot, intent=body.intent)
        # 手动路径也支持 galgame：render_kind=dynamic_image 时并发生成背景图+立绘
        # （失败降级为无图，前端兜底渐变背景，绝不阻断建场景）。
        bg_image: str | None = None
        characters: list | None = None
        scene_spec: dict | None = None
        if body.render_kind == "dynamic_image":
            bg_image, characters = gen_scene_images(
                title=body.title, people=body.people, place=body.place,
                plot=body.plot, intent=body.intent, setting=opening.get("setting"),
            )
        elif body.render_kind == "generated_3d":
            # 生成式 3D：LLM 产 SceneSpec；失败则降级为 galgame 图（绝不阻断建场景）
            from app.services.scene.scene_spec import generate_scene_spec
            scene_spec = generate_scene_spec({
                "title": body.title, "people": [body.people] if body.people else [],
                "place": body.place, "plot": body.plot, "intent": body.intent,
            })
            if scene_spec is None:
                bg_image, characters = gen_scene_images(
                    title=body.title, people=body.people, place=body.place,
                    plot=body.plot, intent=body.intent, setting=opening.get("setting"),
                )
        effective_kind = body.render_kind
        if body.render_kind == "generated_3d" and scene_spec is None:
            effective_kind = "dynamic_image"
        scene = _persist_opening(
            db, user.id, opening, None,
            theater_id=body.theater_id, render_kind=effective_kind,
            bg_image=bg_image, characters=characters, scene_spec=scene_spec,
        )
        background_tasks.add_task(
            capture_best_effort, user_id=user.id, source_type="scene",
            source_id=f"scene:{scene.id}:opening", text=desc,
        )
        return scene

    uid = user.id
    title = body.title or "重演片刻"
    render_kind, tid = _resolve_theater(body.theater_id)

    def gen():
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
            scene = Scene(user_id=uid, title=title, status="active", source_fragment_id=None,
                          setting="", beats=[{"speaker": "旁白", "text": narrative.strip()}],
                          choices=choices, history=[], turn=0,
                          render_kind=render_kind, theater_id=tid)
            db2.add(scene)
            db2.commit()
            db2.refresh(scene)
            yield _sse("done", {"scene_id": scene.id, "status": scene.status, "turn": scene.turn})
        finally:
            db2.close()

    return StreamingResponse(
        gen(), media_type="text/event-stream",
        background=BackgroundTask(
            capture_best_effort, user_id=user.id, source_type="scene",
            source_id=f"scene:create:{source_hash(desc)[:16]}", text=desc,
        ),
    )


# ─── Plays 子资源（MVP 下每场 Scene 对应单次体验，play_id 复用 scene_id）────────

@router.post("/{scene_id}/plays", response_model=PlayOut)
def start_play(
    scene_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """开始一次场景体验，返回首个视觉小说节点。"""
    s = _get_owned(db, user.id, scene_id)
    if s.status == "settled":
        raise HTTPException(status.HTTP_409_CONFLICT, "场景已结算")
    return PlayOut(
        play_id=str(s.id), scene_id=s.id, status=s.status,
        turn=s.turn, node=_node(s),
    )


@router.get("/{scene_id}/plays/{play_id}", response_model=PlayOut)
def get_play(
    scene_id: int,
    play_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """获取某次体验的当前节点。"""
    s = _get_owned(db, user.id, scene_id)
    if not _play_id_match(s, play_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "体验不存在")
    return PlayOut(
        play_id=play_id, scene_id=s.id, status=s.status,
        turn=s.turn, node=_node(s),
    )


@router.post("/{scene_id}/plays/{play_id}/choices", response_model=None)
def play_choose(
    scene_id: int,
    play_id: str,
    body: ChoiceIn,
    background_tasks: BackgroundTasks,
    stream: bool = Query(False, description="true 走 SSE 逐句浮现"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """在指定体验中提交一次回应，推进剧情。"""
    s = _get_owned(db, user.id, scene_id)
    if not _play_id_match(s, play_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "体验不存在")
    if s.status == "settled":
        raise HTTPException(status.HTTP_409_CONFLICT, "场景已结算")

    chosen = next((c for c in (s.choices or []) if str(c.get("id")) == body.choice_id), None)
    if chosen is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "无效的选项")

    if not stream:
        # 推进逻辑集中在 scene_service.advance（与 /scenes/{id}/choices 复用）
        scene_service.advance(db, s, chosen["label"], response_source="choice")
        background_tasks.add_task(
            capture_best_effort, user_id=user.id, source_type="scene",
            source_id=f"scene:{s.id}:turn:{s.turn}", text=chosen["label"],
        )
        return PlayOut(
            play_id=play_id, scene_id=s.id, status=s.status,
            turn=s.turn, node=_node(s),
        )

    turn = s.turn + 1
    return StreamingResponse(
        _advance_stream_gen(scene_id, chosen["label"], turn),
        media_type="text/event-stream",
        background=BackgroundTask(
            capture_best_effort, user_id=user.id, source_type="scene",
            source_id=f"scene:{s.id}:turn:{turn}", text=chosen["label"],
        ),
    )


@router.post("/{scene_id}/plays/{play_id}/settlement")
def play_settle(
    scene_id: int,
    play_id: str,
    body: SettlementIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """结束本次体验 → 结算卡。"""
    s = _get_owned(db, user.id, scene_id)
    if not _play_id_match(s, play_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "体验不存在")
    if s.status == "settled":
        raise HTTPException(status.HTTP_409_CONFLICT, "场景已结算")
    result = scene_service.settle(
        db, s, user.id,
        action_text=body.action_text,
        insight_text=body.insight_text,
        related_memory_ids=body.related_memory_ids,
        role_id=body.role_id,
        keep=body.keep,
        card_text=body.card_text,
    )
    return {"play_id": play_id, "scene_id": s.id, "status": "settled", "settlement": result}


@router.get("/{scene_id}", response_model=SceneOut)
def get_scene(scene_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """单个场景详情（含渲染字段）。非本人或不存在时 404。"""
    return _get_owned(db, user.id, scene_id)


class SpecIssueIn(BaseModel):
    """端上校验器报出的一条问题；code 必须在 REVISE_HINTS 白名单里，id 必须是规格里真实存在的。"""
    code: str
    ids: list[str] = []
    expected: str | None = None
    actual: str | None = None


class SpecReviseIn(BaseModel):
    spec: dict                    # 端上当前这一版（第 2 轮时是第 1 轮被采纳的稿，不一定已入库）
    issues: list[SpecIssueIn]


class SpecSaveIn(BaseModel):
    spec: dict


def _semantic_3d_or_409(s: Scene) -> dict:
    if s.render_kind != "generated_3d" or not isinstance(s.scene_spec, dict) or s.scene_spec.get("kind") != "semantic":
        raise HTTPException(status.HTTP_409_CONFLICT, "只有关系式的生成式 3D 场景可以让导演改稿")
    return s.scene_spec


@router.post("/{scene_id}/spec/revise", response_model=None)
def revise_spec(
    scene_id: int, body: SpecReviseIn,
    user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    """校验回传环：端上把布局校验报出的问题发来，让导演（LLM）改一轮规格。

    只返回候选稿，**不入库**——是否更好由端上重新解算、比分后决定，采纳了再 POST /spec 存回。
    成本防护：每个场景一辈子最多 MAX_REVISE_ATTEMPTS 次，先记账再调模型（失败也算一次）。
    """
    from app.services.scene.scene_spec import MAX_REVISE_ATTEMPTS, revise_scene_spec

    s = _get_owned(db, user.id, scene_id)
    stored = _semantic_3d_or_409(s)
    review = dict(stored.get("review") or {})
    attempts = int(review.get("attempts", 0))
    if attempts >= MAX_REVISE_ATTEMPTS:
        return {"spec": None, "reason": "limit"}
    review["attempts"] = attempts + 1
    s.scene_spec = {**stored, "review": review}
    db.commit()
    revised = revise_scene_spec(body.spec, [i.model_dump() for i in body.issues], place=s.setting or "")
    return {"spec": revised, "reason": None if revised else "unusable"}


@router.post("/{scene_id}/spec", response_model=None)
def save_spec(
    scene_id: int, body: SpecSaveIn,
    user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    """存回端上采纳的改稿（或只是"已改过几轮"的记录，避免下次打开重复烧模型）。"""
    from app.services.scene.scene_spec import prepare_saved_spec

    s = _get_owned(db, user.id, scene_id)
    stored = _semantic_3d_or_409(s)
    clean = prepare_saved_spec(stored, body.spec)
    if clean is None:
        raise HTTPException(422, "规格不合法，或删掉了人物、改了室内外/时段")
    s.scene_spec = clean
    db.commit()
    return {"ok": True, "review": clean.get("review")}


@router.post("/{scene_id}/choices", response_model=None)
def choose(
    scene_id: int,
    body: ChoiceIn,
    background_tasks: BackgroundTasks,
    stream: bool = Query(False, description="true 走 SSE 逐句浮现"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """提交一次回应选择，推进剧情。`?stream=true` 逐句 SSE。"""
    s = _get_owned(db, user.id, scene_id)
    if s.status == "settled":
        raise HTTPException(status.HTTP_409_CONFLICT, "场景已结算")

    # 「自己说」：自由输入优先；否则按预设选项 id 校验。
    if body.custom_text and body.custom_text.strip():
        label = body.custom_text.strip()[:200]
    else:
        chosen = next((c for c in (s.choices or []) if str(c.get("id")) == body.choice_id), None)
        if chosen is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "无效的选项")
        label = chosen["label"]

    if not stream:
        # 推进逻辑集中在 scene_service.advance（与 /plays/{id}/choices 复用）
        scene_service.advance(
            db,
            s,
            label,
            response_source="custom" if body.custom_text and body.custom_text.strip() else "choice",
        )
        background_tasks.add_task(
            capture_best_effort, user_id=user.id, source_type="scene",
            source_id=f"scene:{s.id}:turn:{s.turn}", text=label,
        )
        return SceneOut.model_validate(s)

    turn = s.turn + 1
    return StreamingResponse(
        _advance_stream_gen(
            scene_id,
            label,
            turn,
            "custom" if body.custom_text and body.custom_text.strip() else "choice",
        ),
        media_type="text/event-stream",
        background=BackgroundTask(
            capture_best_effort, user_id=user.id, source_type="scene",
            source_id=f"scene:{s.id}:turn:{turn}", text=label,
        ),
    )


@router.post("/{scene_id}/settlement")
def settle_scene(scene_id: int, body: SettlementIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """结束体验 → 结算卡。复用 scene_service.settle 回写（行动→待办、领悟→记忆、卡→珍藏/即焚）。"""
    s = _get_owned(db, user.id, scene_id)
    if s.status == "settled":
        raise HTTPException(status.HTTP_409_CONFLICT, "场景已结算")
    result = scene_service.settle(
        db, s, user.id,
        action_text=body.action_text,
        insight_text=body.insight_text,
        related_memory_ids=body.related_memory_ids,
        role_id=body.role_id,
        keep=body.keep,
        card_text=body.card_text,
    )
    return {"scene_id": s.id, "status": "settled", "settlement": result}


@router.post("/{scene_id}/summary")
def scene_summary(scene_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """生成「走出片场」回看数据：事实统计由服务端确定，LLM 只给可否定的视角候选。"""
    s = _get_owned(db, user.id, scene_id)
    summary = theater.summarize({
        "setting": s.setting,
        "beats": s.beats,
        "history": s.history,
    })
    # LLM 失败/返空时必须优先回到用户真实提交的选择/自由输入；旁白只能作为旧数据兜底。
    kq = str(summary.get("key_quote") or "").strip()
    if not kq or kq == "……":
        summary["key_quote"] = _fallback_key_quote(s)
    history = [h for h in (s.history or []) if isinstance(h, dict) and str(h.get("choice") or "").strip()]
    summary.update({
        "response_count": len(history),
        "custom_response_count": sum(1 for h in history if h.get("source") == "custom"),
        "setting_label": str(s.setting or s.title or "这一幕")[:60],
    })
    return summary


def _fallback_key_quote(s: Scene) -> str:
    for h in reversed(s.history or []):
        if isinstance(h, dict) and (h.get("choice") or "").strip():
            return str(h["choice"]).strip()[:30]
    for b in reversed(s.beats or []):
        if isinstance(b, dict) and (b.get("text") or "").strip():
            return str(b["text"]).strip()[:30]
    return ""


@router.delete("/{scene_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_scene(scene_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """删除场景（仅属主）。"""
    s = _get_owned(db, user.id, scene_id)
    db.delete(s)
    db.commit()
    return None
