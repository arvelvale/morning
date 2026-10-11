"""生成式 3D 场景规格（关系式布局 · P1）：LLM 只当「导演」。

与旧方案（LLM 直接输出绝对坐标）的差异：
- LLM 输出 **SemanticSceneSpec**：只描述这一幕有什么、东西之间什么关系
  （sitOn / nextTo / inFrontOf / behind / on / in / facing / at 区位），不写任何坐标；
- 坐标由前端 Layout Engine 解算：`frontend-demo/src/theater/generated/layout/`
  （solve.ts 拓扑排序+锚点吸附+撒布，validator.ts 五项校验；锚点表在 propMeta.ts）；
- 入库 `scenes.scene_spec` 的就是这份语义版（kind="semantic"），旧绝对坐标数据共存兼容，
  渲染入口 assembleAnySpec 自动识别两种格式。

清洗哲学沿用旧版：白名单外的 type / 关系词一律丢弃、异常返回 None 由调用方降级；
区别是多了一层**引用完整性**（宿主 id 必须存在、承载环会剥除降级为自由件）。
"""
from __future__ import annotations

import json
import logging
from typing import Any

from app.llm import get_chat_model

logger = logging.getLogger(__name__)

# 与前端 src/theater/generated/props.ts 的 PROP_TYPES 保持一致（改动需两端同步）。
ALLOWED_PROPS = {
    # 基础件
    "pineTree", "rock", "bush", "chair", "table", "bench", "crate", "rug",
    "wall", "window", "lamp", "streetlight", "tent", "campfire", "luggage",
    # 抽自现有场景的大件（背景/地标）
    "water", "bed", "cityscape", "platform", "train", "airportSeats", "departureBoard",
    # 氛围动画
    "rain", "stringLights", "fireflies",
    # 情感锚点小物
    "emptyChair", "photoFrame", "teacup",
    # 街道 / 校门
    "road", "crosswalk", "schoolGate", "railing", "building",
    # 乡村
    "oldHouse",
    # 城市设施
    "busStop", "car", "phoneBooth", "vendingMachine", "cafeTable", "parasol",
    # 室内生活与结构
    "sofa", "desk", "door", "curtain",
    # 人手互动道具
    "umbrella", "phone", "book", "backpack",
    # 地表微环境
    "puddle", "fallenLeaves",
    # 公共街区与建筑积木
    "trashBin", "sidewalk", "signBoard", "doorway",
    # 室内收纳与进阶
    "bedsideTable", "bookshelf", "cabinet", "mirror", "stairs",
    # 地面微环境 / 植被点缀
    "pavement", "wildgrass", "steppingStones", "firewood",
}
ALLOWED_TIME = {"day", "dusk", "night"}
ALLOWED_MODE = {"indoor", "outdoor"}
# 与前端 src/theater/figure/presets.ts 保持一致（改动需两端同步）。
ALLOWED_POSE = {
    "standing", "sitting", "phone", "lookingBack", "headDown", "sittingGround",
    "handsFolded",
    "walking", "waving", "arguing", "comforting", "hugging", "handingItem", "crying",
}
ALLOWED_CHAR_TYPE = {"child", "student", "adult", "elderly"}
ALLOWED_BUILD = {"slim", "average", "stout"}
ALLOWED_OUTFIT = {"casual", "uniform", "coat", "skirt"}
ALLOWED_HAIR = {"short", "long", "ponytail", "bun"}

# 关系词表（与前端 layout/types.ts 的 SemanticRelation 保持一致）。
CARRIER_RELS = ("on", "in", "inside", "sitOn")   # 承载类：进拓扑序（inside 是 in 的别名）
DIR_RELS = ("nextTo", "near", "inFrontOf", "behind")  # 方向类
PROP_ONLY_RELS = ("on", "in", "inside", "heldBy")     # 仅零件可用（heldBy 指向人物）
ALLOWED_ZONES = {"foreground", "midground", "background"}
ALLOWED_SIDES = {"left", "center", "right"}

# 情绪基调白名单（与前端 vision/mood.ts 的 ALLOWED_MOODS 同步；越权词前端自动回落推断）。
ALLOWED_MOODS = {
    "warm_day", "sunset", "night_calm", "rainy", "rainy_night",
    "cozy_indoor_day", "cozy_indoor_night", "campfire_night",
}

MAX_PROPS = 16
MAX_CHARACTERS = 3

# 单房间骨架（与前端 layout/room.ts 保持一致，改动需两端同步）。
# 房间由前端展开成墙/地/门窗洞口；LLM 只给大小与洞口，不写坐标，也不直接选 "room" 这个 type。
ROOM_LIMITS = {"width": (3.0, 9.0), "depth": (3.0, 8.0), "height": (2.4, 3.4)}
ALLOWED_OPENING_KINDS = {"window", "door"}
ALLOWED_OPENING_WALLS = {"back", "left", "right", "front"}   # right/front 不画，前端会就近改到 back/left
ALLOWED_EDGES = {"back", "left", "right"}                    # at.edge：靠墙
MAX_OPENINGS = 6
# 有 room 时这些件由房间自己带，LLM 另放会和墙洞叠在一起
ROOM_OWNED_PROPS = {"wall", "window", "door", "doorway"}

# 零件分类 tag 表：prompt 按 seed 场景类型裁剪下发（P1 按 place 关键词路由，
# 未命中发全集）。裁剪映射只在这张表维护；新零件记得顺手归类。
PROP_CATEGORIES: dict[str, set[str]] = {
    "nature":   {"pineTree", "rock", "bush", "campfire", "tent", "fireflies", "wildgrass",
                 "steppingStones", "firewood"},
    "home":     {"table", "chair", "bench", "rug", "wall", "window", "lamp",
                 "bed", "crate", "teacup", "photoFrame",
                 "sofa", "desk", "door", "curtain",
                 "bedsideTable", "bookshelf", "cabinet", "mirror", "stairs"},
    # 手持/随身道具：随任意场景下发
    "carry":    {"umbrella", "phone", "book", "backpack", "luggage"},
    "street":   {"road", "crosswalk", "pavement", "schoolGate", "railing", "building",
                 "streetlight", "busStop", "car", "phoneBooth", "vendingMachine",
                 "trashBin", "sidewalk", "signBoard", "doorway"},
    "transit":  {"platform", "train", "airportSeats", "departureBoard", "luggage"},
    "waterside": {"water", "cityscape", "emptyChair", "parasol", "cafeTable", "puddle"},
    "rustic":   {"oldHouse", "pineTree", "rock", "bush"},
    "ambient":  {"rain", "stringLights", "fireflies"},
}

# place 关键词 → 启用的类别（ambient 类永远附带）。
PLACE_ROUTING: list[tuple[tuple[str, ...], tuple[str, ...]]] = [
    (("乡", "村", "老家", "奶奶", "外婆", "爷爷"), ("nature", "rustic")),
    (("校", "学", "门"), ("street",)),
    (("车", "站", "机", "旅", "行"), ("street", "transit")),
    (("海", "河", "湖", "桥", "码头"), ("waterside", "street")),
    (("家", "房", "屋", "卧", "室"), ("home",)),
]

FEW_SHOT = """\
【例·黄昏长椅道别】
{"env":{"mode":"outdoor","time":"dusk"},"props":[
 {"id":"bench1","type":"bench","at":{"zone":"midground","side":"center"}},
 {"id":"lamp1","type":"streetlight","nextTo":"bench1"},
 {"id":"bag1","type":"luggage","nextTo":"adult1"}],
"characters":[
 {"id":"student1","pose":"waving","sitOn":"bench1","type":"student","outfit":"uniform","backpack":true},
 {"id":"adult1","pose":"lookingBack","behind":"student1","facing":"toward:student1","type":"adult","outfit":"coat"}]}

【例·深夜书房（先定房间，再靠墙放家具）】
{"env":{"mode":"indoor","time":"night"},"mood":"cozy_indoor_night",
"room":{"width":5.4,"depth":4.6,"openings":[
 {"kind":"window","wall":"back","offset":0.15,"width":1.3},{"kind":"door","wall":"left","offset":-0.6}]},
"props":[
 {"id":"desk1","type":"desk","at":{"zone":"background","side":"center","edge":"back"}},
 {"id":"shelf1","type":"bookshelf","at":{"zone":"background","side":"right","edge":"back"}},
 {"id":"bed1","type":"bed","at":{"zone":"midground","side":"right","edge":"left"}},
 {"id":"chair1","type":"chair","inFrontOf":"desk1","rotY":3.14},
 {"id":"lamp1","type":"lamp","on":"desk1"}],
"characters":[
 {"id":"me","pose":"sitting","sitOn":"chair1","facing":"toward:desk1","type":"student"}]}

【例·家中桌边喝茶（注意：人只坐椅子，不坐桌子）】
{"env":{"mode":"indoor","time":"day"},"props":[
 {"id":"table1","type":"table","at":{"zone":"midground","side":"center"}},
 {"id":"chair1","type":"chair","nextTo":"table1"},
 {"id":"cupA","type":"teacup","on":"table1"}],
"characters":[
 {"id":"mom","pose":"sitting","sitOn":"chair1","facing":"toward:table1","type":"elderly"},
 {"id":"kid","pose":"standing","nextTo":"chair1","facing":"toward:mom","type":"child"}]}
"""

SPEC_SYSTEM_PROMPT = """\
你是喵灵的「场景导演」。用户想把没说完的话在一个安全的低多边形 3D 小场景里重演。
你**不写任何坐标**：只描述这一幕有什么东西、它们之间是什么关系；
位置由代码里的布局引擎根据尺寸和锚点自动摆放。

可用零件 type（本次场景限定为下面这些，其余一律不要用）：
{props}

输出一个 JSON 对象（不要 markdown 代码块、不要解释），结构如下：
{{
  "kind": "semantic",
  "env": {{ "mode": "indoor"|"outdoor", "time": "day"|"dusk"|"night",
            "stars"/"moon"/"sun"/"mountains": 可省布尔,
            "ground": {{ "color": "#RRGGBB" }} 可省 }},
  可选 "mood": "warm_day|sunset|night_calm|rainy|rainy_night|
cozy_indoor_day|cozy_indoor_night|campfire_night"（贴合情绪就给一个）,
  室内场景可选 "room": {{ "width": 3~9, "depth": 3~8, "height": 2.4~3.4,
            "wallColor": "#RRGGBB", "floorColor": "#RRGGBB",
            "openings": [ {{ "kind": "window"|"door", "wall": "back"|"left",
                            "offset": -1~1（站在镜头一侧看这面墙：-1 最左、0 居中、1 最右）,
                            "width": 米 }} ] }},
  "props": [ {{ "id": "唯一短id", "type": "零件type", "params": {{ 外观参数 }},
               可选关系: "on"/"inside"/"nextTo"/"near"/"inFrontOf"/"behind"=另一件的id,
                         "heldBy"=某人物id(把信物放到TA手上),
               可选区位: "at": {{ "zone":"foreground|midground|background",
                                "side":"left|center|right", "bias":[dx,dz],
                                "edge":"back|left|right"（靠墙，仅室内有 room 时） }} }} ],
  "characters": [ {{ "id": "唯一短id", "pose": "standing|sitting|phone|walking|waving|
lookingBack|headDown|arguing|comforting|hugging|handingItem|crying|sittingGround",
              可选形象: "type":"child|student|adult|elderly","build","outfit","hairstyle",
"backpack","bodyColor";
              可选关系: "sitOn"="坐具id"、"nextTo"/"near"/"inFrontOf"/"behind"="某id"、
"facing":"toward:id 或 camera 或 away"；同样支持 at 区位 }} ]
}}

规则：
- 人物和物件必须给 id；关系的值必须是别的 id（指向存在的东西）。人物不能 on/inside/heldBy；
- 不要输出 scale——大小由代码按零件几何自动决定；
- 「杯子在桌上」「相框在桌上」用 on；「包里/帐篷里」用 inside；坐下的真人一律 sitOn
  椅/凳/长椅这类有座位的件；剧情信物在谁手里就用 heldBy 指向那个人；
- 大结构（路面 road、校门 schoolGate、站台 platform、老屋 oldHouse、海面 water）
  用 at.background 定基调；人物默认 midground.center，近景特写才 foreground；
- nextTo 紧邻，near 是松散的"在那附近"（约两个身位），按构图意图选；
- 室内场景先给 room（单间：卧室/书房/客厅/厨房，一般 4~6 米见方），再往里放家具：
  床、书桌、书架、柜子、沙发这类大件在 at 里写 "edge" 贴墙（后墙 back / 左墙 left；右墙 right
  镜头看不到正面，尽量少用），side 决定贴在墙的哪一段，窗帘/镜子这类挂墙件也要写 edge；小件放在这些大件上（on）或旁边（nextTo）；
- 有 room 时不要再单独放 wall / window / door，门窗写进 room.openings；窗前别摆比窗台高的柜子，
  门前留出通道，别让家具比房间还大；
- 宁少勿多：道具 4~8 个，只有剧情里的人上场；对视说话的两人给互相 facing；
- 颜色低饱和柔和；信息不足就选贴合情绪的合理默认。

{few_shot}
"""


def _select_props(place: str) -> set[str]:
    """按地点关键词裁剪下发到 prompt 的零件清单；未命中则发全集。"""
    chosen: set[str] = set()
    for kws, cats in PLACE_ROUTING:
        if any(k in place for k in kws):
            for c in cats:
                chosen |= PROP_CATEGORIES.get(c, set())
    if not chosen:
        return set(ALLOWED_PROPS)
    chosen |= PROP_CATEGORIES.get("ambient", set())
    chosen |= PROP_CATEGORIES.get("carry", set())
    # 基础人物道具永远可配
    chosen |= {"emptyChair"}
    unknown = chosen - ALLOWED_PROPS
    if unknown:
        logger.warning("[scene-spec] 分类表含未知零件: %s", sorted(unknown))
        chosen -= unknown
    return chosen


def _clean_str(v: Any, cap: int = 32) -> str | None:
    return v[:cap] if isinstance(v, str) and v.strip() else None


def _num(v: Any, lo: float, hi: float) -> float | None:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    return round(min(hi, max(lo, float(v))), 2)


def _hex_color(v: Any) -> str | None:
    import re
    return v if isinstance(v, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", v) else None


def _sanitize_room(raw: Any) -> dict[str, Any] | None:
    """房间骨架清洗：尺寸钳进范围、颜色只收 #RRGGBB、洞口最多 MAX_OPENINGS 个。

    不在这里判断洞口放不放得下/会不会重叠——那需要几何，由前端 normalizeRoom 如实记入校验报告。
    """
    if not isinstance(raw, dict):
        return None
    room: dict[str, Any] = {}
    for key, (lo, hi) in ROOM_LIMITS.items():
        v = _num(raw.get(key), lo, hi)
        if v is not None:
            room[key] = v
    for key in ("wallColor", "floorColor"):
        c = _hex_color(raw.get(key))
        if c:
            room[key] = c
    openings: list[dict[str, Any]] = []
    for o in (raw.get("openings") or [])[:MAX_OPENINGS]:
        if not isinstance(o, dict) or o.get("kind") not in ALLOWED_OPENING_KINDS:
            continue
        item: dict[str, Any] = {"kind": o["kind"]}
        if o.get("wall") in ALLOWED_OPENING_WALLS:
            item["wall"] = o["wall"]
        for key, lo, hi in (("offset", -1.0, 1.0), ("width", 0.5, 2.6), ("sill", 0.4, 2.0), ("height", 0.5, 2.2)):
            v = _num(o.get(key), lo, hi)
            if v is not None:
                item[key] = v
        openings.append(item)
    if openings:
        room["openings"] = openings
    return room


def _clean_at(at_in: Any, allow_edge: bool = False) -> dict[str, Any] | None:
    """零件的区位：zone/side 合法才收；allow_edge（规格里有 room）时多收 edge 靠墙，缺 zone/side 补默认。"""
    if not isinstance(at_in, dict):
        return None
    edge = at_in.get("edge") if allow_edge and at_in.get("edge") in ALLOWED_EDGES else None
    zone, side = at_in.get("zone"), at_in.get("side")
    if zone not in ALLOWED_ZONES or side not in ALLOWED_SIDES:
        if not edge:
            return None
        zone = zone if zone in ALLOWED_ZONES else "midground"
        side = side if side in ALLOWED_SIDES else "center"
    at: dict[str, Any] = {"zone": zone, "side": side}
    if edge:
        at["edge"] = edge
    bias = at_in.get("bias")
    if isinstance(bias, (list, tuple)) and len(bias) == 2 and all(isinstance(b, (int, float)) for b in bias):
        at["bias"] = [round(float(bias[0]), 2), round(float(bias[1]), 2)]
    return at


def _sanitize_semantic(parsed: Any) -> dict[str, Any] | None:
    """把 LLM 文本产物清洗成可信的 SemanticSceneSpec；结构性失败返回 None。

    步骤：env 透传 → 收集 id（缺省补 prop{i}/char{i}，冲突改名）→ 零件清洗
    （type 白名单、参数透传）→ 人物清洗 → 引用完整性（悬空引用剥除、承载环降级）。
    """
    if not isinstance(parsed, dict):
        return None
    env_in = parsed.get("env")
    if not isinstance(env_in, dict):
        return None
    mode = env_in.get("mode") if env_in.get("mode") in ALLOWED_MODE else "outdoor"
    time = env_in.get("time") if env_in.get("time") in ALLOWED_TIME else "night"
    env: dict[str, Any] = {"mode": mode, "time": time}
    for key in ("stars", "moon", "sun", "mountains"):
        if isinstance(env_in.get(key), bool):
            env[key] = env_in[key]
    if isinstance(env_in.get("ground"), dict) and isinstance(env_in["ground"].get("color"), str):
        env["ground"] = {"color": env_in["ground"]["color"][:9]}

    # 房间骨架：先于家具；有 room 时门窗由房间自带，LLM 另放的 wall/window/door 会和墙洞叠在一起，丢弃
    room = _sanitize_room(parsed.get("room")) if mode == "indoor" else None

    # ── 第一遍：收集全部 id ──
    used_ids: set[str] = set()

    def unique(raw: Any, fallback: str) -> str:
        base = _clean_str(raw, 24) or fallback
        cand, k = base, 2
        while cand in used_ids:
            cand, k = f"{base}-{k}", k + 1
        used_ids.add(cand)
        return cand

    raw_props = [p for p in (parsed.get("props") or [])[:MAX_PROPS]
                 if isinstance(p, dict) and p.get("type") in ALLOWED_PROPS
                 and not (room is not None and p.get("type") in ROOM_OWNED_PROPS)]
    raw_chars = [c for c in (parsed.get("characters") or [])[:MAX_CHARACTERS] if isinstance(c, dict)]
    all_ids = {_clean_str(p.get("id"), 24) or "" for p in raw_props}
    all_ids |= {_clean_str(c.get("id"), 24) or "" for c in raw_chars}

    def ref_ok(v: Any) -> str | None:
        s = _clean_str(v, 24)
        return s if s and s in all_ids else None

    # ── 第二遍：产出干净实例 ──
    props_out: list[dict[str, Any]] = []
    for i, inst in enumerate(raw_props):
        p: dict[str, Any] = {"id": unique(inst.get("id"), f"prop{i}"), "type": inst["type"]}
        # P2 起 scale 由前端 metadata 视觉基准接管，LLM 的猜测值一律剥离不透传
        if isinstance(inst.get("rotY"), (int, float)):
            p["rotY"] = round(float(inst["rotY"]), 3)
        if isinstance(inst.get("params"), dict):
            p["params"] = {k: v for k, v in inst["params"].items()
                           if isinstance(v, (str, int, float, bool))}
        # 承载引用（第二遍时 id 已全部生成，这里直接查表）
        for rel in CARRIER_RELS:
            hid = ref_ok(inst.get(rel))
            if hid:
                p[rel] = hid
        for rel in DIR_RELS:
            hid = ref_ok(inst.get(rel))
            if hid:
                p[rel] = hid
        hb = ref_ok(inst.get("heldBy"))
        if hb:
            p["heldBy"] = hb
        at = _clean_at(inst.get("at"), allow_edge=room is not None)
        if at:
            p["at"] = at
        props_out.append(p)

    chars_out: list[dict[str, Any]] = []
    for i, c in enumerate(raw_chars):
        cc: dict[str, Any] = {"id": unique(c.get("id"), f"char{i}")}
        for key, allowed in (
            ("pose", ALLOWED_POSE), ("type", ALLOWED_CHAR_TYPE),
            ("build", ALLOWED_BUILD), ("outfit", ALLOWED_OUTFIT), ("hairstyle", ALLOWED_HAIR),
        ):
            if c.get(key) in allowed:
                cc[key] = c[key]
        if isinstance(c.get("backpack"), bool):
            cc["backpack"] = c["backpack"]
        for key in ("bodyColor", "skinColor", "hairColor"):
            if isinstance(c.get(key), str):
                cc[key] = c[key][:9]
        # P2 起人物身高由 type 预设决定，不再接受 LLM 的 scale
        for rel in ("sitOn", *DIR_RELS):
            hid = ref_ok(c.get(rel))
            if hid:
                cc[rel] = hid
        f = _clean_str(c.get("facing"), 40)
        if f in ("camera", "away"):
            cc["facing"] = f
        elif f:
            # toward:<id> 或直接给 id；统一规范化成 toward:<id>，悬空目标丢弃
            t = f[len("toward:"):] if f.startswith("toward:") else f
            if t in all_ids:
                cc["facing"] = f"toward:{t}"
        at_in = c.get("at")
        if isinstance(at_in, dict) and at_in.get("zone") in ALLOWED_ZONES \
                and at_in.get("side") in ALLOWED_SIDES:
            cc["at"] = {"zone": at_in["zone"], "side": at_in["side"]}
        chars_out.append(cc)

    if not props_out and not chars_out:
        return None

    # ── 第三遍：承载环剥除（成环成员全部降级为自由件，保留区位提示）──
    carrier_graph: dict[str, str] = {}
    for it in [*props_out, *chars_out]:
        for rel in ("on", "in", "inside", "sitOn"):
            if rel in it:
                carrier_graph[it["id"]] = it[rel]
    ring_members = _find_cycle_members(carrier_graph)
    if ring_members:
        for it in [*props_out, *chars_out]:
            if it["id"] in ring_members:
                for rel in ("on", "in", "inside", "sitOn"):
                    it.pop(rel, None)
        logger.warning("[scene-sem] 承载关系成环 %s，已剥除降级", sorted(ring_members))

    out: dict[str, Any] = {"kind": "semantic", "env": env, "props": props_out, "characters": chars_out}
    if room is not None:
        out["room"] = room
    mood = _clean_str(parsed.get("mood"), 24)
    if mood in ALLOWED_MOODS:
        out["mood"] = mood
    review = _clean_review(parsed.get("review"))
    if review:
        out["review"] = review
    return out


def _clean_review(raw: Any) -> dict[str, int] | None:
    """校验回传环留下的记录（改过几轮、前后分数、请求次数）：只收有界整数。"""
    if not isinstance(raw, dict):
        return None
    out = {k: int(raw[k]) for k in ("rounds", "before", "after", "attempts")
           if isinstance(raw.get(k), (int, float)) and not isinstance(raw.get(k), bool) and 0 <= raw[k] <= 99}
    return out or None


def _find_cycle_members(graph: dict[str, str]) -> set[str]:
    """返回所有处于承载环上的节点 id（环上路径检测；无环返回空集）。"""
    members: set[str] = set()
    for start in graph:
        seen: dict[str, int] = {}
        path: list[str] = []
        cur: str | None = start
        while cur is not None and cur in graph and cur not in seen:
            seen[cur] = len(path)
            path.append(cur)
            cur = graph[cur]
        if cur is not None and cur in seen:
            members.update(path[seen[cur]:])
    return members


def _parse(raw: str) -> dict[str, Any] | None:
    text = (raw or "").strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    try:
        parsed = json.loads(text)
    except (json.JSONDecodeError, ValueError):
        logger.warning("[scene-sem] LLM output not JSON: %.200s", text)
        return None
    return _sanitize_semantic(parsed)


def generate_scene_spec(seed: dict[str, Any]) -> dict[str, Any] | None:
    """由场景 seed（title/people/place/plot/intent）生成校验后的语义 SceneSpec。

    返回 kind="semantic" 的字典存入 scenes.scene_spec；前端 solveLayout 解算后渲染。
    失败返回 None，调用方降级到 dynamic_image / 预置 3D。函数签名与旧版一致。
    """
    place = str(seed.get("place") or "").strip()
    plot = str(seed.get("plot") or "").strip()
    people = seed.get("people") or []
    if not (place or plot):
        return None

    desc = "\n".join(filter(None, [
        f"标题：{seed.get('title')}" if seed.get("title") else "",
        f"地点：{place}" if place else "",
        f"在场的人：{'、'.join(str(p) for p in people)}" if people else "",
        f"经过：{plot}" if plot else "",
        f"想达成：{seed.get('intent')}" if seed.get("intent") else "",
    ]))

    allowed = sorted(_select_props(place))
    try:
        llm = get_chat_model()
        resp = llm.invoke([
            {"role": "system", "content": SPEC_SYSTEM_PROMPT.format(
                props="、".join(allowed), few_shot=FEW_SHOT)},
            {"role": "user", "content": f"场景信息：\n{desc}"},
        ])
    except Exception as e:  # noqa: BLE001
        logger.warning("[scene-sem] LLM call failed: %s", e)
        return None

    return _parse(resp.content)


# ─── 校验回传：让导演按布局校验报告再改一轮 ────────────────────────────────────
#
# 求解器和校验器在前端跑（frontend-demo/src/theater/generated/layout/，TypeScript），
# 后端没有第二份。所以流程是：端上解算 → 挑出"改规格能解决"的问题（review.ts 的 CODE_WEIGHT）
# → POST /scenes/{id}/spec/revise → 这里让模型改稿 → 端上重新解算、比分、只收更好的 → POST /scenes/{id}/spec 存回。
# 这张 code 表与前端 review.ts 的 CODE_WEIGHT 同步；不在表里的 code 一律丢弃（也挡住客户端塞进 prompt 的任意文字）。

REVISE_HINTS: dict[str, str] = {
    "RESIDUAL_OVERLAP": "两件东西叠在一起：给其中一件换 at 的 zone/side，或改成靠墙 edge，或换更小的零件",
    "RELATION_DEGRADED": "关系没生效（引用的 id 不存在、坐具没有座位、小物不能手持、贴片不能当参照）：改成存在的 id，坐着的人只 sitOn 椅/凳/长椅/沙发，或改用 at 区位",
    "SUPPORT_FOOTPRINT_OVERFLOW": "物件比承载它的台面还大：换成更小的物件，或换更大的承载件",
    "CONTAINER_HEIGHT_OVERFLOW": "容器装不下这件东西：换矮一点的物件或换更大的容器",
    "DOOR_BLOCKED": "家具堵在门前：给它换一面墙（edge）或换 side，或把 room.openings 里那扇门的 offset 挪开",
    "WINDOW_BLOCKED": "高家具挡住了窗：把它换到别的墙/别的 side，或换成比窗台矮的家具，或把窗的 offset 挪开",
    "ROOM_OBJECT_TOO_BIG": "物件比房间还大：减小它的 params.width/depth，或加大 room.width/depth（上限 9×8）",
    "ROOM_OBJECT_OUTSIDE": "物件超出墙面：换 side 或换 zone",
    "OUT_OF_BOUNDS": "物件超出场景范围：换 zone/side",
    "FACING_TARGET_INVALID": "facing 的目标不存在或指向自己：改成存在的 id，或 camera / away",
    "ROOM_OPENING_DROPPED": "门窗放不进墙或与别的洞口重叠：缩小 width，或换墙 / 换 offset",
    "EDGE_WITHOUT_ROOM": "写了 at.edge 但规格里没有 room：先补 room，或去掉 edge",
    "SOFT_RELATION_RESIDUAL": "位置与关系词有偏差：换成更松的关系（near），或改用 at 区位",
    "FACING_RESIDUAL": "朝向没转到位：检查 facing 的目标，或换 at 位置",
}
_RELATION_NOT_APPLIED_HINT = "写的关系没生效（引用无效、冲突、成环或宿主没有对应锚点）：改成存在的 id，或去掉这条关系改用 at 区位"
MAX_REVISE_ISSUES = 8
MAX_REVISE_ATTEMPTS = 4          # 同一个场景一辈子最多向模型要几次改稿（防止客户端反复触发烧钱）

# 改稿时人物外观以原稿为准（外观是用户的故事设定，不是布局问题）
_APPEARANCE_KEYS = ("type", "build", "outfit", "hairstyle", "backpack", "bodyColor", "skinColor", "hairColor")

REVISE_SYSTEM_PROMPT = """\
你是喵灵的「场景导演」。你之前写的场景规格已经过布局引擎解算和校验，下面这些问题需要你改。
只改规格里和问题相关的地方，输出**修改后的完整 JSON**（格式与规则同上一版，不要 markdown、不要解释）。

硬性要求：
- 所有人物和他们的 id、外观（type/build/outfit/hairstyle/backpack/颜色）保持不变；不要新增人物；
- 不要改 env（室内外、时段）、mood；不要新增超过 3 个零件，不要删掉与剧情有关的零件；
- 优先用最小的改动解决问题：换 at 的 zone/side/edge、换关系词的宿主、缩小 params 尺寸、挪门窗 offset；
- 没提到的部分原样保留。

可用零件 type：{props}

【当前规格】
{spec}

【布局校验发现的问题】（按严重程度排序）
{issues}
"""


def _flat(v: Any) -> str:
    """客户端报上来的说明文字：压成一行、去掉花括号、截断，免得往 prompt 里带进格式字符。"""
    import re
    return re.sub(r"[\r\n{}]+", " ", str(v))[:80]


def _issue_lines(issues: list[dict[str, Any]], known_ids: set[str]) -> list[str]:
    """把客户端报上来的问题整理成 prompt 行：code 必须在白名单，id 必须真实存在，文字截断。"""
    import re
    lines: list[str] = []
    for it in issues[:MAX_REVISE_ISSUES]:
        code = str(it.get("code") or "")
        hint = REVISE_HINTS.get(code) or (_RELATION_NOT_APPLIED_HINT if code.startswith("RELATION_NOT_APPLIED_") else None)
        if not hint:
            continue
        ids = [i for i in (it.get("ids") or []) if isinstance(i, str)
               and (i in known_ids or re.fullmatch(r"(door|window)@(back|left)#\d", i))][:3]
        detail = " ".join(k + "：" + _flat(it[k]) for k in ("expected", "actual") if it.get(k))
        lines.append(f"- [{code}] 涉及 {'、'.join(ids) or '（未指明）'}。{hint}" + (f"（{detail}）" if detail else ""))
    return lines


def _check_revision(original: dict[str, Any], revised: dict[str, Any]) -> dict[str, Any] | None:
    """改稿的最后一道保险：人物一个不少、外观/环境/情绪以原稿为准。不合格返回 None。"""
    orig_chars = {c["id"]: c for c in original.get("characters", [])}
    new_chars = {c["id"]: c for c in revised.get("characters", [])}
    if not set(orig_chars) <= set(new_chars):
        logger.warning("[scene-revise] 改稿删了人物 %s，弃稿", sorted(set(orig_chars) - set(new_chars)))
        return None
    for cid, oc in orig_chars.items():
        nc = new_chars[cid]
        for k in _APPEARANCE_KEYS:
            nc.pop(k, None)
            if k in oc:
                nc[k] = oc[k]
    revised["characters"] = [new_chars[c["id"]] for c in revised.get("characters", []) if c["id"] in orig_chars]
    revised["env"] = original["env"]
    if original.get("mood"):
        revised["mood"] = original["mood"]
    else:
        revised.pop("mood", None)
    revised.pop("review", None)   # 回传环的记录由前端/存档接口写，不信模型的
    return revised


def revise_scene_spec(spec: dict[str, Any], issues: list[dict[str, Any]], place: str = "") -> dict[str, Any] | None:
    """按校验问题让模型改一轮规格；失败/不合格返回 None（调用方保留原稿）。"""
    original = _sanitize_semantic(spec)
    if original is None:
        return None
    known_ids = {p["id"] for p in original.get("props", [])} | {c["id"] for c in original.get("characters", [])}
    lines = _issue_lines(issues, known_ids)
    if not lines:
        return None
    clean = {k: v for k, v in original.items() if k != "review"}
    try:
        llm = get_chat_model()
        resp = llm.invoke([
            {"role": "system", "content": REVISE_SYSTEM_PROMPT.format(
                props="、".join(sorted(_select_props(place))),
                spec=json.dumps(clean, ensure_ascii=False, separators=(",", ":")),
                issues="\n".join(lines))},
            {"role": "user", "content": "请输出修改后的完整规格 JSON。"},
        ])
    except Exception as e:  # noqa: BLE001
        logger.warning("[scene-revise] LLM call failed: %s", e)
        return None
    revised = _parse(resp.content)
    if revised is None:
        return None
    return _check_revision(clean, revised)


def prepare_saved_spec(previous: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any] | None:
    """前端把"改稿被采纳"的规格存回时的校验：重新清洗、人物一个不少、室内外/时段不变。

    attempts（向模型要过几次稿）是服务端记账，以库里的为准，不信客户端。不合格返回 None（调用方回 422）。
    """
    clean = _sanitize_semantic(incoming)
    prev = _sanitize_semantic(previous)
    if clean is None or prev is None:
        return None
    if not {c["id"] for c in prev.get("characters", [])} <= {c["id"] for c in clean.get("characters", [])}:
        return None
    if clean["env"].get("mode") != prev["env"].get("mode") or clean["env"].get("time") != prev["env"].get("time"):
        return None
    attempts = int((previous.get("review") or {}).get("attempts", 0))
    review = dict(clean.get("review") or {})
    review["attempts"] = attempts
    clean["review"] = review
    return clean
