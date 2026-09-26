"""片场场景业务逻辑：剧情推进与结算回写。

路由（scenes.py / candidates.py）只做参数校验与响应组装，推进/结算规则集中在此，
避免 `/scenes/{id}/choices` 与 `/plays/{id}/choices`、两个 settlement 端点各写一份。
"""
from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.graphs import theater
from app.models.memory import MemoryItem
from app.models.scene import Scene
from app.services.memory.memory_store import MemoryStore
from app.services.scene import stage
from app.services.scene.scene_turn_images import schedule_bg_regen


def advance(db: Session, scene: Scene, label: str, *, response_source: str = "choice") -> dict[str, Any]:
    """按用户回应 label 推进一幕并落库。返回 theater.advance 的原始结果。

    beats 追加而非替换（保住完整对白史供结算取材）；dynamic_image 场景推进后
    异步刷新背景图。场景只由用户主动结算。调用方需先校验 scene 归属与未结算状态。
    """
    res = theater.advance(
        {"setting": scene.setting, "beats": scene.beats,
         "history": scene.history, "turn": scene.turn},
        label,
    )
    scene.turn = scene.turn + 1
    scene.beats = (scene.beats or []) + res["beats"]
    scene.choices = res["choices"]
    scene.history = (scene.history or []) + [{
        "turn": scene.turn,
        "choice": label,
        "source": "custom" if response_source == "custom" else "choice",
    }]
    db.commit()
    db.refresh(scene)
    if not res.get("ended") and scene.render_kind == "dynamic_image":
        schedule_bg_regen(scene.id)
    return res


def settle(
    db: Session,
    scene: Scene,
    user_id: int,
    *,
    action_text: str | None = None,
    insight_text: str | None = None,
    related_memory_ids: list[int] | None = None,
    role_id: int | None = None,
    keep: bool = True,
    card_text: str | None = None,
) -> dict[str, Any]:
    """结算场景：复用 stage.settle 回写产出，并把场景标记为 settled。返回结算结果。"""
    result = stage.settle(
        db, user_id,
        action_text=action_text,
        insight_text=insight_text,
        related_memory_ids=related_memory_ids,
        role_id=role_id,
        keep=keep,
        card_text=card_text,
        scene_id=scene.id,
    )
    scene.status = "settled"
    scene.choices = []
    db.commit()

    # 用户明确选择什么都不留时，不留余温（尊重退出权）
    if keep or card_text or insight_text or action_text:
        result["afterglow_memory_id"] = leave_afterglow(db, scene, user_id)
    return result


# 「片场余温」标记：晚间来信据此认出「主人刚在片场演完一幕」
AFTERGLOW_TAG = "片场余温"


def leave_afterglow(db: Session, scene: Scene, user_id: int) -> int:
    """演完之后回到米露身边：留一条表层记忆，让第二天的问候能轻轻提起。

    晚间来信只读 depth=surface 的记忆（隐私底座），领悟与结算卡是 personal 深度、进不去，
    所以单独留这一条。只有来源片段本身是表层时才带剧场标题；否则只说「一件放不下的事」，
    不把深层片段的内容降级外发。
    """
    frag = db.get(MemoryItem, scene.source_fragment_id) if scene.source_fragment_id else None
    if frag is not None and frag.user_id == user_id and frag.depth == "surface" and scene.title:
        content = f"在片场里走完了「{scene.title}」这一幕"
    else:
        content = "在片场里把一件放不下的事演完了"
    item = MemoryStore(db).create(
        user_id=user_id, layer="episodic", kind="小结", depth="surface",
        content=content, surface_text=content, confidence=1.0,
        entities=[AFTERGLOW_TAG],
        provenance=[frag.id] if frag is not None and frag.user_id == user_id else None,
        actor="scene_afterglow",
    )
    return item.id
