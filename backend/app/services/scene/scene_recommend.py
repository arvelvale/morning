"""夜间场景推荐引擎（DAY-205；2026-09-26 接入核心闭环）。

产品口径（倒出来 → 被接住 → 明天还在，剧场是「放不下的那件事」的深水区）：
- 分析源：过去 24 小时的睡前倾倒「片段」（优先，用户亲口说的放不下的事）+ 语音通话转写。
  夜间任务在北京时间早上 8 点前后跑，只看「今天 0 点后」会漏掉前一晚的内容，所以用滚动 24 小时。
- 隐私：vulnerable/core 片段不自动拿去搭剧场（filter_for_cloud_prompt），用户仍可在草稿箱手动确认；
  已被邀请过的片段不再重复邀请。
- LLM 一次性产出结构化推荐 JSON：是否值得、来源片段 id、场景种子（人物/地点/剧情/意图）、
  与 6 个预置 three.js 场景的语义匹配。
- confidence >= 0.6 且 theater_id 合法 → render_kind=preset_3d；否则 generated_3d（生成式 3D）。
- 无素材 / LLM 判定不值得 / LLM 调用失败 → 不推荐（返回 None）。
- 邀请信写好后立刻预搭剧场（invite_stage），用户第二天接受时直接进场。
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.llm import get_chat_model
from app.models.conversation import Conversation, Message
from app.models.letter import Letter
from app.models.memory import MemoryItem
from app.services.memory.privacy import filter_for_cloud_prompt
from app.services.mailbox.letter_store import (
    LetterStore,
    daily_generation_key,
    local_delivery_date,
)
from app.services.pet.pet_store import PetStore
from app.services.memory.context_builder import build as build_memory_context

logger = logging.getLogger(__name__)

CST = timezone(timedelta(hours=8))

# 6 个预置 three.js 场景（与 frontend-demo/src/theater/index.ts 对齐）
PRESET_THEATERS: dict[str, str] = {
    "campsite": "野外露营地，夜晚篝火，帐篷与星空",
    "bedroom": "卧室窗边，安静的夜晚房间，窗外夜色",
    "seaside": "海边沙滩，海浪与晚风，散步谈心",
    "dining": "餐厅餐桌，一起吃饭聊天的温馨场合",
    "airport": "机场航站楼，出发、旅行、送别与重逢",
    "station": "火车站站台，离别、等待与重逢",
}

# 预置匹配置信度阈值
CONFIDENCE_THRESHOLD = 0.6

# 送进 prompt 的转写字数上限（控制 token）
MAX_TRANSCRIPT_CHARS = 4000

# 送进 prompt 的倾倒片段条数上限
MAX_FRAGMENTS = 8

# 素材回看窗口（滚动 24 小时，见模块说明）
LOOKBACK = timedelta(hours=24)

RECOMMEND_SYSTEM_PROMPT = """\
你是喵灵的场景导演。下面是用户最近一天留下的素材：睡前倾倒里整理出的「片段」
（每条带编号），以及与桌宠的语音通话转写（可能没有）。
你的任务：判断其中是否藏着一件用户放不下、值得「演出来」的事（一段有人物、有地点、
有情绪张力或温情的小事），如果有，把它提炼成一个可演出的场景种子。
片段是用户亲口说出、整理后仍放不下的事，优先从片段里选；选中片段时填它的编号。

同时给出与预置舞台的匹配：预置舞台列表（id: 描述）：
{theaters}

只输出 JSON，不要额外解释：
{{
  "worth": true/false,            // 是否值得推荐一个场景
  "fragment_id": 片段编号或 null,  // 选中的是哪条片段；来自通话则填 null
  "title": "场景标题（10字内）",
  "people": ["涉及人物"],
  "place": "发生地点",
  "plot": "一句话剧情概要",
  "intent": "用户想在场景里获得什么（如：把没说的话说完/重温/预演）",
  "theater_id": "最匹配的预置舞台id，都不匹配填 null",
  "confidence": 0.0               // 对 theater_id 匹配的置信度 0~1
}}

判定标准：
- 只有闲聊寒暄、任务指令、无具体人事物 → worth=false。
- 有具体的人、事、情绪（遗憾/期待/思念/紧张）→ worth=true。
- theater_id 必须严格从预置列表 id 中选，语义不贴合就填 null 且 confidence 给低分。
- 既有长期理解只可帮助消歧，不可替素材补写人物、事件或意图；冲突时以素材为准。
- fragment_id 只能填素材里出现过的编号，不要编造。
"""


def _since_lookback() -> datetime:
    """滚动回看窗口起点（UTC，理由见模块说明）。"""
    return datetime.now(timezone.utc) - LOOKBACK


def _invited_fragment_ids(db: Session, user_id: int) -> set[int]:
    """已经发过邀请的片段：同一件事不反复邀请。"""
    letters = db.scalars(
        select(Letter).where(Letter.user_id == user_id, Letter.type == "scene_invite")
    ).all()
    ids: set[int] = set()
    for letter in letters:
        fid = (letter.attachment or {}).get("fragment_id")
        if isinstance(fid, int):
            ids.add(fid)
    return ids


def _gather_dump_fragments(db: Session, user_id: int) -> list[MemoryItem]:
    """回看窗口内、仍在草稿箱（待确认）的倾倒片段；隐私闸外的与已邀请过的剔除。

    口径与 candidates 路由一致：kind=片段、非原始倾倒 root（raw_ref 为空）、未确认。
    """
    items = list(db.scalars(
        select(MemoryItem).where(
            MemoryItem.user_id == user_id,
            MemoryItem.kind == "片段",
            MemoryItem.raw_ref.is_(None),
            MemoryItem.is_latest == True,  # noqa: E712
            MemoryItem.is_forgotten == False,  # noqa: E712
            or_(MemoryItem.status.is_(None), MemoryItem.status.in_(("pending", "candidate"))),
            MemoryItem.created_at >= _since_lookback(),
        ).order_by(MemoryItem.created_at.desc()).limit(MAX_FRAGMENTS * 2)
    ).all())
    invited = _invited_fragment_ids(db, user_id)
    items = [m for m in items if m.id not in invited]
    # 伦理红线：vulnerable/core 与即焚记忆不进外部 LLM，也就不会被自动搭成剧场
    return filter_for_cloud_prompt(items)[:MAX_FRAGMENTS]


def _gather_voice_transcript(db: Session, user_id: int) -> str:
    """收集回看窗口内 voice_call 会话的全部消息，拼成对话文本。

    没有任何语音通话 → 返回空串。
    """
    start = _since_lookback()
    convs = list(
        db.scalars(
            select(Conversation)
            .where(
                Conversation.user_id == user_id,
                Conversation.mode == "voice_call",
                Conversation.created_at >= start,
            )
            .order_by(Conversation.id.asc())
        ).all()
    )
    if not convs:
        return ""

    lines: list[str] = []
    role_label = {"user": "主人", "assistant": "桌宠"}
    for conv in convs:
        msgs = list(
            db.scalars(
                select(Message)
                .where(Message.conversation_id == conv.id)
                .order_by(Message.id.asc())
            ).all()
        )
        for m in msgs:
            lines.append(f"{role_label.get(m.role, m.role)}：{m.content}")

    text = "\n".join(lines)
    return text[:MAX_TRANSCRIPT_CHARS]


def _parse_recommend(raw: str, fragment_ids: set[int] | None = None) -> dict[str, Any] | None:
    """解析 LLM 输出为推荐 dict；解析失败或 worth=false 返回 None。

    fragment_ids：本次送进 prompt 的片段编号；LLM 填的编号不在其中时视为未选片段。
    """
    text = (raw or "").strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    try:
        parsed = json.loads(text)
    except (json.JSONDecodeError, ValueError):
        logger.warning("[scene-recommend] LLM output not JSON: %.200s", text)
        return None
    if not isinstance(parsed, dict) or not parsed.get("worth"):
        return None

    theater_id = parsed.get("theater_id")
    if theater_id not in PRESET_THEATERS:
        theater_id = None
    try:
        confidence = float(parsed.get("confidence") or 0.0)
    except (TypeError, ValueError):
        confidence = 0.0
    confidence = max(0.0, min(1.0, confidence))

    if theater_id is not None and confidence >= CONFIDENCE_THRESHOLD:
        render_kind = "preset_3d"
    else:
        # 不命中 6 个预置舞台时，走生成式 3D（LLM 产 SceneSpec）；接受邀请/建场景时若 spec 失败再降级 galgame
        render_kind = "generated_3d"
        theater_id = None

    people = parsed.get("people")
    if not isinstance(people, list):
        people = [str(people)] if people else []

    fragment_id = parsed.get("fragment_id")
    try:
        fragment_id = int(fragment_id) if fragment_id is not None else None
    except (TypeError, ValueError):
        fragment_id = None
    if fragment_id is not None and fragment_id not in (fragment_ids or set()):
        fragment_id = None

    return {
        "render_kind": render_kind,
        "theater_id": theater_id,
        "confidence": confidence,
        "fragment_id": fragment_id,
        "seed": {
            "title": str(parsed.get("title") or "").strip()[:20] or "一个小场景",
            "people": [str(p).strip() for p in people if str(p).strip()],
            "place": str(parsed.get("place") or "").strip(),
            "plot": str(parsed.get("plot") or "").strip(),
            "intent": str(parsed.get("intent") or "").strip(),
        },
    }


def analyze_for_user(db: Session, user_id: int) -> dict[str, Any] | None:
    """分析单个用户最近一天的倾倒片段与语音通话，产出场景推荐。

    返回 {render_kind, theater_id, confidence, fragment_id, seed{title,people,place,plot,intent}}；
    无素材 / 不值得 / LLM 失败 → None。
    """
    fragments = _gather_dump_fragments(db, user_id)
    transcript = _gather_voice_transcript(db, user_id)
    if not fragments and not transcript:
        logger.info("[scene-recommend] user %d no fragments or voice_call in lookback, skip", user_id)
        return None

    fragment_text = "\n".join(
        f"[片段#{m.id}] {(m.surface_text or m.content).strip()}" for m in fragments
    ) or "（没有）"

    theaters_text = "\n".join(f"- {tid}: {desc}" for tid, desc in PRESET_THEATERS.items())
    profile_context = build_memory_context(db, user_id, mode="profile")
    try:
        llm = get_chat_model()
        resp = llm.invoke([
            {"role": "system", "content": RECOMMEND_SYSTEM_PROMPT.format(theaters=theaters_text)},
            {"role": "user", "content": (
                f"睡前倾倒里的片段：\n{fragment_text}\n\n"
                f"语音通话转写：\n{transcript or '（没有）'}\n\n"
                f"可纠正的长期理解（仅供消歧）：\n{profile_context}"
            )},
        ])
    except Exception as e:  # noqa: BLE001
        logger.error("[scene-recommend] LLM call failed for user %d: %s", user_id, e)
        return None

    rec = _parse_recommend(resp.content, {m.id for m in fragments})
    if rec is None:
        logger.info("[scene-recommend] user %d nothing worth recommending", user_id)
    return rec


# ─── 通话中·单句实时意图识别（方案B-1 / DAY-211）────────────────────────────

# 少于该字数的输入直接判 None，不调用 LLM（省钱、防抖）
MIN_INTENT_CHARS = 6

INTENT_SYSTEM_PROMPT = """\
你是喵灵的场景导演。下面是用户在语音通话中刚说的一句话（或最近几句）。
你要判断：用户是否**明确表达了想「重演 / 走进 / 再经历一次 / 预演」一个具体场景**的意愿。

只有满足下面全部条件才算 worth=true：
- 用户在表达一种「想进入 / 重回 / 再体验 / 想演一遍」某个具体情境的愿望（而非单纯陈述或闲聊）；
- 这个情境有可辨认的人物 / 地点 / 事件之一，能提炼成一个可演出的场景。

以下一律 worth=false：普通闲聊寒暄、只是提到某人某事却没有想进入的意愿、
情绪宣泄但无具体场景、对桌宠的提问或指令。宁可漏判也不要误判（通话中会据此弹窗，误判很打扰）。

预置舞台列表（id: 描述）：
{theaters}

只输出 JSON，不要额外解释：
{{
  "worth": true/false,
  "title": "场景标题（10字内）",
  "people": ["涉及人物"],
  "place": "发生地点",
  "plot": "一句话剧情概要",
  "intent": "用户想在场景里获得什么",
  "theater_id": "最匹配的预置舞台id，都不匹配填 null",
  "confidence": 0.0
}}
"""


def detect_scene_intent(text: str) -> dict[str, Any] | None:
    """通话中·单句实时场景意图识别（低延迟、无副作用）。

    - 空串 / 过短 → 直接 None，不调用 LLM。
    - 仅当用户明确表达想进入/重演一个具体场景时 worth=true。
    返回 {render_kind, theater_id, confidence, seed{...}}；否则 None。
    """
    clean = (text or "").strip()
    if len(clean) < MIN_INTENT_CHARS:
        return None

    theaters_text = "\n".join(f"- {tid}: {desc}" for tid, desc in PRESET_THEATERS.items())
    try:
        llm = get_chat_model()
        resp = llm.invoke([
            {"role": "system", "content": INTENT_SYSTEM_PROMPT.format(theaters=theaters_text)},
            {"role": "user", "content": f"用户刚说：\n{clean}"},
        ])
    except Exception as e:  # noqa: BLE001
        logger.warning("[scene-intent] LLM call failed: %s", e)
        return None

    return _parse_recommend(resp.content)


def run_scene_recommend_all(db: Session) -> list[dict[str, Any]]:
    """对所有活跃用户跑一遍场景推荐（定时任务入口，随夜间做梦触发）。

    推荐产出后落库 scene_invite 来信（信箱可见），accept 接口见 letters 路由。
    """
    from app.models.user import User

    users = list(db.scalars(select(User).where(User.is_active == True)).all())  # noqa: E712
    results: list[dict[str, Any]] = []
    for user in users:
        try:
            rec = analyze_for_user(db, user.id)
            letter = generate_scene_invite(db, user.id, rec) if rec is not None else None
            results.append({
                "user_id": user.id,
                "recommended": rec is not None,
                "recommend": rec,
                "letter_id": letter.id if letter is not None else None,
            })
        except Exception as e:  # noqa: BLE001
            logger.error("[scene-recommend] user %d failed entirely: %s", user.id, e)
            results.append({"user_id": user.id, "recommended": False, "error": str(e)})
    return results


# ─── scene_invite 来信生成（DAY-206）──────────────────────────────────────────

INVITE_SYSTEM_PROMPT = """\
你是喵灵的桌宠，正在给主人写一封「场景邀请信」。
你从主人最近说起的事里，发现了一件主人放不下、值得重新走进去的事，
已经连夜把它搭成了一个小剧场，想邀请主人来演一演。

写信要求：
- 温柔、不催促、不评判；像老朋友轻轻递来一张戏票。
- 自然地提到那件事（人物/地点/心情），说明为什么想邀请主人去演这一幕。
- 不要剧透剧情走向，只描述入口；结尾轻轻邀请（如"想去看看吗"）。
- 语气口语、简短，全文 50–100 字，最多一个 emoji。

只输出 JSON，不要额外解释：
{"title": "不超过10字的信题", "body": "信的正文"}
"""


def _fallback_invite(seed: dict[str, Any]) -> tuple[str, str]:
    """LLM 不可用/解析失败时的模板兜底：推荐已产出，信一定要送到。"""
    title = (seed.get("title") or "一张戏票").strip()[:10] or "一张戏票"
    people = "、".join(seed.get("people") or [])
    place = (seed.get("place") or "").strip()
    pieces = ["听你说起"]
    if people:
        pieces.append(f"和{people}的事")
    if place:
        pieces.append(f"，还有{place}")
    body = (
        "".join(pieces)
        + "。我把它搭成了一个小小的场景，想不想进去走一遍？"
        + "有些话，在戏里说出口会容易一点。"
    )
    return title, body


def _parse_invite(raw: str, seed: dict[str, Any]) -> tuple[str, str]:
    text = (raw or "").strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            title = str(parsed.get("title") or "").strip()
            body = str(parsed.get("body") or "").strip()
            if body:
                return (title[:20] or "一张戏票"), body
    except (json.JSONDecodeError, ValueError):
        pass
    return _fallback_invite(seed)


def generate_scene_invite(
    db: Session, user_id: int, rec: dict[str, Any]
) -> Letter | None:
    """把推荐结果落库为 scene_invite 来信。

    幂等：每用户每天（东八区）至多 1 封 scene_invite；已有则直接返回已存在的信。
    LLM 写信失败走模板兜底；当日统一额度已满时不再写入信箱。
    """
    store = LetterStore(db)
    date_key = local_delivery_date()
    generation_key = daily_generation_key("scene_invite", date_key)
    existing = store.get_generated(user_id, generation_key)
    if existing is not None:
        logger.info("[scene-recommend] user %d already has today's invite, skip", user_id)
        return existing
    if not store.has_daily_capacity(user_id, date_key):
        logger.info("[scene-recommend] user %d reached daily mailbox limit, skip", user_id)
        return None

    seed = rec.get("seed") or {}
    seed_text = json.dumps(seed, ensure_ascii=False)
    try:
        llm = get_chat_model()
        resp = llm.invoke([
            {"role": "system", "content": INVITE_SYSTEM_PROMPT},
            {"role": "user", "content": f"场景种子：\n{seed_text}"},
        ])
        title, body = _parse_invite(resp.content, seed)
    except Exception as e:  # noqa: BLE001
        logger.warning("[scene-recommend] invite LLM failed for user %d: %s", user_id, e)
        title, body = _fallback_invite(seed)

    pet = PetStore(db).get_active(user_id)
    letter = store.create_generated(
        user_id=user_id,
        generation_key=generation_key,
        delivery_date=date_key,
        type="scene_invite",
        title=title,
        body=body,
        pet_id=pet.id if pet is not None else None,
        ref_memory_id=rec.get("fragment_id"),
        attachment={
            "kind": "scene_invite",
            "render_kind": rec.get("render_kind"),
            "theater_id": rec.get("theater_id"),
            "fragment_id": rec.get("fragment_id"),
            "seed": seed,
            "confidence": rec.get("confidence"),
        },
    )
    if letter is None:
        logger.info("[scene-recommend] user %d lost daily-slot race, skip", user_id)
        return None
    logger.info("[scene-recommend] invite letter id=%d created for user %d", letter.id, user_id)

    # 连夜搭台：用户第二天接受时直接进场；失败不影响信件，接受时会按需现搭
    from app.services.scene.invite_stage import prestage_invite_scene
    prestage_invite_scene(db, user_id, letter)
    return letter
