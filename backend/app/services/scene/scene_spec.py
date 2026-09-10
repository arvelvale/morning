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
  "props": [ {{ "id": "唯一短id", "type": "零件type", "params": {{ 外观参数 }},
               可选关系: "on"/"inside"/"nextTo"/"near"/"inFrontOf"/"behind"=另一件的id,
                         "heldBy"=某人物id(把信物放到TA手上),
               可选区位: "at": {{ "zone":"foreground|midground|background",
                                "side":"left|center|right", "bias":[dx,dz] }} }} ],
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
                 if isinstance(p, dict) and p.get("type") in ALLOWED_PROPS]
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
        at_in = inst.get("at")
        if isinstance(at_in, dict) and at_in.get("zone") in ALLOWED_ZONES \
                and at_in.get("side") in ALLOWED_SIDES:
            at: dict[str, Any] = {"zone": at_in["zone"], "side": at_in["side"]}
            bias = at_in.get("bias")
            if isinstance(bias, (list, tuple)) and len(bias) == 2 and \
                    all(isinstance(b, (int, float)) for b in bias):
                at["bias"] = [round(float(bias[0]), 2), round(float(bias[1]), 2)]
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
    mood = _clean_str(parsed.get("mood"), 24)
    if mood in ALLOWED_MOODS:
        out["mood"] = mood
    return out


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
