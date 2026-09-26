"""场景邀请的「搭台」：把邀请信里的场景种子生成为 Scene（剧本开场 + 渲染素材）。

夜间写邀请信时就预先搭好（status=invited：不进片场列表，只等用户接受），
用户点「接受」只需翻成 active，不再现场连调两次 LLM 干等；
预搭失败时，接受接口按需现搭，行为与旧版一致。
"""
from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from app.models.letter import Letter
from app.models.scene import Scene

logger = logging.getLogger(__name__)

# 预搭好、尚未被接受的场景状态（片场列表不展示）
INVITED = "invited"

_RENDER_KINDS = ("preset_3d", "dynamic_image", "generated_3d")


def stage_invite_scene(db: Session, user_id: int, letter: Letter, *, status: str = "active") -> Scene:
    """按邀请信 attachment 里的种子生成 Scene，并把 scene_id 回写进 attachment。

    渲染分流：preset_3d 用预置舞台；generated_3d 产 SceneSpec（失败降级 dynamic_image）；
    dynamic_image 生成背景 + 立绘。调用方负责校验信件归属与类型。
    """
    from app.graphs import theater
    from app.services.scene.scene_images import gen_scene_images
    from app.services.scene.scene_spec import generate_scene_spec

    att = dict(letter.attachment or {})
    seed = dict(att.get("seed") or {})
    render_kind = att.get("render_kind") or "dynamic_image"
    theater_id = att.get("theater_id")

    people = seed.get("people")
    people_text = "、".join(people) if isinstance(people, list) else (people or None)
    title = seed.get("title") or letter.title
    opening = theater.generate_manual(
        title=title,
        people=people_text,
        place=seed.get("place") or None,
        plot=seed.get("plot") or None,
        intent=seed.get("intent") or None,
    )

    bg_image: str | None = None
    characters: list | None = None
    scene_spec: dict | None = None
    if render_kind == "generated_3d":
        scene_spec = generate_scene_spec(seed)
        if scene_spec is None:
            render_kind = "dynamic_image"  # 降级：spec 生成失败
    if render_kind == "dynamic_image":
        bg_image, characters = gen_scene_images(
            title=title,
            people=people_text,
            place=seed.get("place") or None,
            plot=seed.get("plot") or None,
            intent=seed.get("intent") or None,
            setting=opening.get("setting"),
        )

    scene = Scene(
        user_id=user_id,
        title=opening["title"],
        status=status,
        source_fragment_id=att.get("fragment_id"),
        setting=opening["setting"],
        beats=opening["beats"],
        choices=opening["choices"],
        history=[],
        turn=0,
        render_kind=render_kind if render_kind in _RENDER_KINDS else "dynamic_image",
        theater_id=theater_id,
        bg_image=bg_image,
        characters=characters,
        scene_spec=scene_spec,
    )
    db.add(scene)
    db.commit()
    db.refresh(scene)

    # JSON 列需整体重新赋值才会脏检查
    att["scene_id"] = scene.id
    letter.attachment = att
    db.commit()
    return scene


def prestage_invite_scene(db: Session, user_id: int, letter: Letter) -> Scene | None:
    """夜间预搭：失败只记日志，不影响邀请信送达（接受时会按需现搭）。"""
    if (letter.attachment or {}).get("scene_id") is not None:
        return None
    try:
        scene = stage_invite_scene(db, user_id, letter, status=INVITED)
        logger.info("[scene-invite] prestaged scene id=%d (%s) for letter %d", scene.id, scene.render_kind, letter.id)
        return scene
    except Exception as e:  # noqa: BLE001
        db.rollback()
        logger.warning("[scene-invite] prestage failed for letter %d, will stage on accept: %s", letter.id, e)
        return None
