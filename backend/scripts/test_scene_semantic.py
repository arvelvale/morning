"""语义 SceneSpec 清洗（_sanitize_semantic / _select_props / _find_cycle_members）纯函数测试。

免启动服务、不调 LLM。运行：
  cd backend && set PYTHONUTF8=1 && set PYTHONPATH=. && uv run python scripts/test_scene_semantic.py

覆盖：
1. 合法语义 spec 全量透传（env/关系/at/facing）
2. 未知零件 type 丢弃；id 缺省补 prop{i}
3. 悬空引用剥除（sitOn 指向不存在 id）
4. id 冲突自动改名
5. 承载环剥除降级为自由件
6. 人物 on/in 拒绝，sitOn 通过
7. facing：camera/away/toward:id 保留，未知目标丢弃
8. at 非法 zone/side 丢弃；bias 越界数值钳制透传
9. scale/rotY 数值钳制
10. MAX_PROPS 截断
11. 地点关键词裁剪下发清单（乡村含 oldHouse 不含 train；未命中发全集）
"""
import sys

sys.path.insert(0, ".")

from app.services.scene.scene_spec import (  # noqa: E402
    MAX_PROPS,
    ALLOWED_PROPS,
    PROP_CATEGORIES,
    _find_cycle_members,
    _sanitize_semantic,
    _select_props,
)

PASS = 0


def ok(name: str) -> None:
    global PASS
    PASS += 1
    print(f"{PASS:02d}. {name} PASS")


# ─── 1. 合法 spec 全量透传 ────────────────────────────────────────────────────
raw = {
    "env": {"mode": "outdoor", "time": "dusk", "stars": True, "ground": {"color": "#6a5a4c"}},
    "props": [
        {"id": "bench1", "type": "bench", "at": {"zone": "midground", "side": "center"}, "params": {"color": "#aabbcc"}},
        {"id": "cup1", "type": "teacup", "on": "table1"},
        {"id": "table1", "type": "table", "nextTo": "bench1"},
    ],
    "characters": [
        {"id": "s1", "pose": "waving", "sitOn": "bench1", "facing": "toward:a1", "type": "student",
         "outfit": "uniform", "backpack": True, "bodyColor": "#4a6a9a", "at": {"zone": "midground", "side": "left"}},
        {"id": "a1", "pose": "lookingBack", "behind": "s1", "facing": "camera"},
    ],
}
spec = _sanitize_semantic(raw)
assert spec is not None and spec["kind"] == "semantic"
assert spec["env"]["mode"] == "outdoor" and spec["env"]["time"] == "dusk" and spec["env"]["stars"] is True
by_id = {p["id"]: p for p in spec["props"]}
assert by_id["bench1"]["at"]["zone"] == "midground"
assert by_id["cup1"]["on"] == "table1" and by_id["table1"]["nextTo"] == "bench1"
chars = {c["id"]: c for c in spec["characters"]}
assert chars["s1"]["sitOn"] == "bench1" and chars["s1"]["backpack"] is True
assert chars["a1"]["behind"] == "s1" and chars["a1"]["facing"] == "camera"
ok("合法语义 spec 全量透传")

# ─── 2. 未知 type 丢弃 + id 缺省 ─────────────────────────────────────────────
spec = _sanitize_semantic({
    "env": {"mode": "outdoor", "time": "day"},
    "props": [{"type": "dragon"}, {"type": "rock"}],
})
assert spec is not None and len(spec["props"]) == 1
assert spec["props"][0]["type"] == "rock" and spec["props"][0]["id"] == "prop0"
ok("未知 type 丢弃 + id 缺省补齐")

# ─── 3. 悬空引用剥除 ────────────────────────────────────────────────────────
spec = _sanitize_semantic({
    "env": {"mode": "outdoor", "time": "day"},
    "props": [{"id": "r1", "type": "rock"}],
    "characters": [{"id": "c1", "pose": "standing", "sitOn": "ghost", "nextTo": "gone"}],
})
assert spec is not None
assert all(k not in spec["characters"][0] for k in ("sitOn", "nextTo"))
ok("悬空引用剥除")

# ─── 4. id 冲突改名 ─────────────────────────────────────────────────────────
spec = _sanitize_semantic({
    "env": {"mode": "outdoor", "time": "day"},
    "props": [{"id": "x", "type": "rock"}, {"id": "x", "type": "bush"}],
})
ids = [p["id"] for p in spec["props"]]
assert ids[0] == "x" and ids[1] != "x" and ids[0] != ids[1], ids
ok("id 冲突自动改名")

# ─── 5. 承载环剥除 ──────────────────────────────────────────────────────────
spec = _sanitize_semantic({
    "env": {"mode": "outdoor", "time": "day"},
    "props": [
        {"id": "a", "type": "crate", "on": "b"},
        {"id": "b", "type": "crate", "on": "a"},
        {"id": "t", "type": "table"},
        {"id": "c", "type": "teacup", "on": "t"},
    ],
})
by_id = {p["id"]: p for p in spec["props"]}
assert all("on" not in by_id[k] for k in ("a", "b")), by_id
assert by_id["c"]["on"] == "t", "正常链条不应被误伤"
ok("承载环剥除且不误伤正常链")

assert _find_cycle_members({"x": "y"}) == set()
assert _find_cycle_members({"x": "y", "y": "x"}) == {"x", "y"}
assert _find_cycle_members({"p": "q", "q": "r", "r": "p", "z": "p"}) == {"p", "q", "r"}
ok("_find_cycle_members 环检测三例")

# ─── 6. 人物 on/in 拒绝，sitOn 放行 ─────────────────────────────────────────
spec = _sanitize_semantic({
    "env": {"mode": "indoor", "time": "day"},
    "props": [{"id": "box1", "type": "crate"}],
    "characters": [{"id": "c1", "pose": "standing", "on": "box1", "in": "box1", "sitOn": "box1"}],
})
char = spec["characters"][0]
assert "on" not in char and "in" not in char and char.get("sitOn") == "box1"
ok("人物 on/in 拒绝、sitOn 放行")

# ─── 7. facing 清洗（注意 MAX_CHARACTERS=3，只放三人）───────────────────────
spec = _sanitize_semantic({
    "env": {"mode": "outdoor", "time": "day"},
    "props": [{"id": "g", "type": "schoolGate"}],
    "characters": [
        {"id": "k1", "facing": "camera"},
        {"id": "k2", "facing": "toward:none"},
        {"id": "k3", "facing": "g"},
    ],
})
fc = {c["id"]: c.get("facing") for c in spec["characters"]}
assert fc["k1"] == "camera" and fc["k2"] is None and fc["k3"] == "toward:g"
ok("facing：camera 放行、悬空目标丢弃、裸 id 规范化")

# ─── 8. at 校验与 bias ──────────────────────────────────────────────────────
spec = _sanitize_semantic({
    "env": {"mode": "outdoor", "time": "day"},
    "props": [
        {"id": "p1", "type": "rock", "at": {"zone": "sky", "side": "left"}},
        {"id": "p2", "type": "bush", "at": {"zone": "background", "side": "right", "bias": [1.234, -99]}},
    ],
})
assert "at" not in spec["props"][0]
bias = spec["props"][1]["at"]["bias"]
assert bias == [1.23, -99.0], bias  # 保留原值交前端钳制（sqrt 场景边界处理在前端）
ok("非法 zone 丢弃、bias 原样透传")

# ─── 9. scale 剥离（P2 起 LLM 不再决定大小）+ rotY 保角 ─────────────────────
spec = _sanitize_semantic({
    "env": {"mode": "outdoor", "time": "day"},
    "props": [{"id": "p", "type": "rock", "scale": 99, "rotY": 123}],
    "characters": [{"scale": 50, "pose": "standing"}],
})
assert "scale" not in spec["props"][0], "零件 scale 应被剥离"
assert spec["props"][0]["rotY"] == 123.0
assert "scale" not in spec["characters"][0], "人物 scale 应被剥离"
ok("LLM 的 scale 全部剥离、rotY 保角")

# ─── 9b. P2 新词：inside/near/heldBy ────────────────────────────────────────
spec = _sanitize_semantic({
    "env": {"mode": "outdoor", "time": "night"},
    "props": [
        {"id": "booth", "type": "phoneBooth"},
        {"id": "letter", "type": "photoFrame", "inside": "booth", "heldBy": "me1"},
        {"id": "tree9", "type": "pineTree", "near": "booth"},
    ],
    "characters": [{"id": "me1", "pose": "standing"}],
})
b2 = {p["id"]: p for p in spec["props"]}
assert b2["letter"]["inside"] == "booth" and b2["letter"]["heldBy"] == "me1"
assert b2["tree9"]["near"] == "booth"
# 人物不能 heldBy/inside
spec3 = _sanitize_semantic({
    "env": {"mode": "outdoor", "time": "day"},
    "props": [{"id": "box1", "type": "crate"}],
    "characters": [{"id": "c1", "pose": "standing", "heldBy": "c1", "inside": "box1"}],
})
ch = spec3["characters"][0]
assert "heldBy" not in ch and "inside" not in ch
ok("inside/near/heldBy 三新词引用清洗")

# ─── 10. MAX_PROPS 截断 ─────────────────────────────────────────────────────
props = [{"id": f"k{i}", "type": "rock"} for i in range(MAX_PROPS + 5)]
spec = _sanitize_semantic({"env": {"mode": "outdoor", "time": "day"}, "props": props})
assert spec is not None and len(spec["props"]) == MAX_PROPS
ok(f"超出 {MAX_PROPS} 个的零件被截断")

# ─── 11. 地点裁剪 ───────────────────────────────────────────────────────────
rustic = _select_props("乡下奶奶家的小院")
assert "oldHouse" in rustic and "train" not in rustic
transit = _select_props("高铁站送别")
assert "platform" in transit and "train" in transit
everything = _select_props("某个说不清的地方")
assert everything == ALLOWED_PROPS
for cat in PROP_CATEGORIES.values():
    assert cat <= ALLOWED_PROPS, f"分类表出现白名单外零件: {cat - ALLOWED_PROPS}"
ok("place 关键词路由三类 + 分类表白名单一致性")

print(f"\nALL {PASS} PASS")
