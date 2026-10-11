"""单房间骨架清洗 + 校验回传（改稿）的后端部分。免启动服务、不调真实 LLM。

运行：cd backend && set PYTHONUTF8=1 && set PYTHONPATH=. && uv run python scripts/test_scene_spec_revise.py

覆盖：
1. room：尺寸钳进范围、非 #RRGGBB 颜色丢弃、坏洞口丢弃、室外忽略 room
2. at.edge：只在有 room 时保留；缺 zone/side 补默认；有 room 时 wall/window/door 零件被丢弃
3. review 记录只收有界整数
4. 问题清单：未知 code 丢弃、不存在的 id 丢弃、说明文字去花括号换行
5. 改稿：模型输出被清洗；人物外观/env/mood 以原稿为准；删人物、乱码、异常、无可用问题都返回 None
6. 存回：人物不能少、室内外/时段不能变、attempts 以库里为准
7. 接口：revise 先记账再调模型，超过 MAX_REVISE_ATTEMPTS 不再调；save 不合格回 422
"""
import json
from types import SimpleNamespace

from fastapi import HTTPException

import app.routers.scene.scenes as scene_router
import app.services.scene.scene_spec as sp

PASS = 0


def ok(name: str) -> None:
    global PASS
    PASS += 1
    print(f"{PASS:02d}. {name} PASS")


ROOM_RAW = {
    "width": 99, "depth": 1, "height": 3.0, "wallColor": "red", "floorColor": "#a9855d",
    "openings": [
        {"kind": "window", "wall": "back", "offset": 7, "width": 1.3},
        {"kind": "door", "wall": "ceiling"},                  # 墙名非法：保留洞口但不带 wall
        {"kind": "sofa", "wall": "back"},                      # 不是洞口
        "garbage",
    ],
}

# ─── 1. room ────────────────────────────────────────────────────────────────
room = sp._sanitize_room(ROOM_RAW)
assert room["width"] == 9.0 and room["depth"] == 3.0 and room["height"] == 3.0
assert "wallColor" not in room and room["floorColor"] == "#a9855d"
assert [o["kind"] for o in room["openings"]] == ["window", "door"]
assert room["openings"][0]["offset"] == 1.0, "offset 钳到 [-1,1]"
assert "wall" not in room["openings"][1]
assert sp._sanitize_room("x") is None
spec = sp._sanitize_semantic({"env": {"mode": "outdoor", "time": "day"}, "room": ROOM_RAW, "props": [{"id": "r", "type": "rock"}]})
assert "room" not in spec, "室外场景不收 room"
spec = sp._sanitize_semantic({"env": {"mode": "indoor", "time": "day"}, "room": ROOM_RAW, "props": [{"id": "r", "type": "rock"}]})
assert spec["room"]["width"] == 9.0
ok("room 清洗：钳尺寸、丢坏颜色/坏洞口、室外忽略")

# ─── 2. at.edge + 房间自带的门窗 ─────────────────────────────────────────────
indoor = {
    "env": {"mode": "indoor", "time": "night"},
    "props": [
        {"id": "desk1", "type": "desk", "at": {"zone": "background", "side": "right", "edge": "back", "bias": [0.3, 9]}},
        {"id": "bed1", "type": "bed", "at": {"edge": "left"}},                       # 缺 zone/side
        {"id": "bad", "type": "cabinet", "at": {"zone": "midground", "side": "left", "edge": "ceiling"}},
        {"id": "w1", "type": "window"}, {"id": "d1", "type": "door"}, {"id": "wl", "type": "wall"},
        {"id": "lamp", "type": "lamp", "on": "w1"},                                  # 宿主被丢弃 → 引用剥除
    ],
}
withroom = sp._sanitize_semantic({**indoor, "room": {"width": 5}})
by = {p["id"]: p for p in withroom["props"]}
assert by["desk1"]["at"] == {"zone": "background", "side": "right", "edge": "back", "bias": [0.3, 9.0]}
assert by["bed1"]["at"] == {"zone": "midground", "side": "center", "edge": "left"}
assert by["bad"]["at"] == {"zone": "midground", "side": "left"}, "非法 edge 去掉、zone/side 保留"
assert set(by) == {"desk1", "bed1", "bad", "lamp"}, "有 room 时 wall/window/door 零件被丢弃"
assert "on" not in by["lamp"]
noroom = sp._sanitize_semantic(indoor)
by = {p["id"]: p for p in noroom["props"]}
assert "edge" not in (by["desk1"].get("at") or {}), "没有 room 就不收 edge"
assert "bed1" in by and "at" not in by["bed1"]
assert {"w1", "d1", "wl"} <= set(by), "没有 room 时窗/门/墙照常保留"
ok("at.edge 只在有 room 时保留；房间自带门窗，零件版被丢弃")

# ─── 3. review ──────────────────────────────────────────────────────────────
assert sp._clean_review({"rounds": 2, "before": 9, "after": 3, "attempts": 4, "x": 1}) == {"rounds": 2, "before": 9, "after": 3, "attempts": 4}
assert sp._clean_review({"rounds": 999, "before": -1, "after": True}) is None
assert sp._clean_review("x") is None
ok("review 记录只收有界整数")

# ─── 4. 问题清单 ────────────────────────────────────────────────────────────
lines = sp._issue_lines([
    {"code": "DOOR_BLOCKED", "ids": ["bed1", "door@left#2", "ghost", 7], "expected": "门前\n无家具{x}", "actual": "bed1 挡门"},
    {"code": "DROP TABLE", "ids": ["bed1"]},
    {"code": "RELATION_NOT_APPLIED_sitOn", "ids": ["me"]},
    {"code": "CAMERA_FRAMING_REVIEW", "ids": ["me"]},
], {"bed1", "me"})
assert len(lines) == 2, lines
assert "bed1、door@left#2" in lines[0] and "ghost" not in lines[0]
assert "{" not in lines[0] and "\n" not in lines[0]
assert lines[1].startswith("- [RELATION_NOT_APPLIED_sitOn]")
assert sp._issue_lines([{"code": "NOPE"}], set()) == []
ok("问题清单：未知 code/不存在的 id 丢弃，文字被压平")

# ─── 5. 改稿 ────────────────────────────────────────────────────────────────
ORIGINAL = {
    "kind": "semantic", "env": {"mode": "indoor", "time": "night", "stars": False}, "mood": "cozy_indoor_night",
    "room": {"width": 5.4, "depth": 4.6, "openings": [{"kind": "door", "wall": "left", "offset": -0.6}]},
    "props": [{"id": "bed1", "type": "bed", "at": {"zone": "midground", "side": "center", "edge": "left"}}],
    "characters": [{"id": "me", "pose": "standing", "type": "student", "outfit": "uniform", "bodyColor": "#8a97ad"}],
}
ISSUES = [{"code": "DOOR_BLOCKED", "ids": ["bed1", "door@left#1"], "expected": "门前无家具", "actual": "bed1 挡门"}]


class FakeLLM:
    def __init__(self, reply=None, boom=False):
        self.reply, self.boom, self.calls = reply, boom, []

    def invoke(self, messages):
        self.calls.append(messages)
        if self.boom:
            raise RuntimeError("llm down")
        return SimpleNamespace(content=self.reply if isinstance(self.reply, str) else json.dumps(self.reply, ensure_ascii=False))


def with_llm(llm, fn):
    old = sp.get_chat_model
    sp.get_chat_model = lambda *a, **k: llm
    try:
        return fn()
    finally:
        sp.get_chat_model = old


good = json.loads(json.dumps(ORIGINAL))
good["props"][0]["at"] = {"zone": "background", "side": "right", "edge": "back"}
good["env"] = {"mode": "indoor", "time": "day"}                                  # 模型擅自改了时段
good["mood"] = "sunset"                                                          # …和情绪
good["characters"][0].update({"outfit": "coat", "bodyColor": "#ff0000", "pose": "sitting"})   # …和外观；pose 可改
llm = FakeLLM(good)
out = with_llm(llm, lambda: sp.revise_scene_spec(ORIGINAL, ISSUES))
assert out["props"][0]["at"]["edge"] == "back", "布局改动被采纳"
assert out["env"] == {"mode": "indoor", "time": "night", "stars": False} and out["mood"] == "cozy_indoor_night"
c = out["characters"][0]
assert c["outfit"] == "uniform" and c["bodyColor"] == "#8a97ad" and c["pose"] == "sitting"
assert "review" not in out
prompt = llm.calls[0][0]["content"]
assert "DOOR_BLOCKED" in prompt and "bed1、door@left#1" in prompt and '"id":"me"' in prompt
ok("改稿：布局改动被采纳，人物外观/env/mood 以原稿为准，问题与当前规格进了 prompt")

killer = json.loads(json.dumps(ORIGINAL)); killer["characters"] = []
assert with_llm(FakeLLM(killer), lambda: sp.revise_scene_spec(ORIGINAL, ISSUES)) is None
assert with_llm(FakeLLM("不是 JSON"), lambda: sp.revise_scene_spec(ORIGINAL, ISSUES)) is None
assert with_llm(FakeLLM(boom=True), lambda: sp.revise_scene_spec(ORIGINAL, ISSUES)) is None
silent = FakeLLM(good)
assert with_llm(silent, lambda: sp.revise_scene_spec(ORIGINAL, [{"code": "CAMERA_FRAMING_REVIEW", "ids": ["me"]}])) is None
assert silent.calls == [], "没有可改的问题就不该调模型"
assert sp.revise_scene_spec("x", ISSUES) is None
ok("改稿：删人物/乱码/异常/无可用问题都返回 None，且无可用问题时不调模型")

# ─── 6. 存回 ────────────────────────────────────────────────────────────────
prev = {**ORIGINAL, "review": {"attempts": 2}}
saved = sp.prepare_saved_spec(prev, {**good, "env": ORIGINAL["env"], "mood": ORIGINAL["mood"], "review": {"rounds": 1, "before": 6, "after": 0, "attempts": 0}})
assert saved["review"] == {"rounds": 1, "before": 6, "after": 0, "attempts": 2}, saved["review"]
assert sp.prepare_saved_spec(prev, {**ORIGINAL, "characters": []}) is None
assert sp.prepare_saved_spec(prev, {**ORIGINAL, "env": {"mode": "indoor", "time": "day"}}) is None
assert sp.prepare_saved_spec(prev, {"env": "bad"}) is None
ok("存回：人物不能少、室内外/时段不能变、attempts 以库里为准")

# ─── 7. 接口 ────────────────────────────────────────────────────────────────
class FakeDB:
    commits = 0

    def commit(self):
        FakeDB.commits += 1


scene = SimpleNamespace(id=5, user_id=3, render_kind="generated_3d", scene_spec=json.loads(json.dumps(ORIGINAL)), setting="深夜的书房")
orig_owned = scene_router._get_owned
scene_router._get_owned = lambda db, uid, sid: scene
user = SimpleNamespace(id=3)
body = scene_router.SpecReviseIn(spec=ORIGINAL, issues=[scene_router.SpecIssueIn(**i) for i in ISSUES])
try:
    counting = FakeLLM(good)
    results = with_llm(counting, lambda: [scene_router.revise_spec(5, body, user=user, db=FakeDB()) for _ in range(sp.MAX_REVISE_ATTEMPTS + 2)])
    assert results[0]["spec"] is not None
    assert [r["reason"] for r in results[sp.MAX_REVISE_ATTEMPTS:]] == ["limit", "limit"], results
    assert len(counting.calls) == sp.MAX_REVISE_ATTEMPTS, "超过上限后不再调模型"
    assert scene.scene_spec["review"]["attempts"] == sp.MAX_REVISE_ATTEMPTS, "记账写进了库里的规格"
    assert scene.scene_spec["props"] == ORIGINAL["props"], "revise 只返回候选稿，不改库里的布局"

    bad_body = scene_router.SpecSaveIn(spec={**ORIGINAL, "characters": []})
    try:
        scene_router.save_spec(5, bad_body, user=user, db=FakeDB())
        raise AssertionError("删人物的稿子应该被拒绝")
    except HTTPException as e:
        assert e.status_code == 422
    res = scene_router.save_spec(5, scene_router.SpecSaveIn(spec={**good, "env": ORIGINAL["env"], "mood": ORIGINAL["mood"], "review": {"rounds": 1, "before": 6, "after": 0}}), user=user, db=FakeDB())
    assert res["ok"] and scene.scene_spec["props"][0]["at"]["edge"] == "back"
    assert scene.scene_spec["review"]["attempts"] == sp.MAX_REVISE_ATTEMPTS, "存回不会清零请求次数"

    scene.render_kind = "preset_3d"
    try:
        scene_router.revise_spec(5, body, user=user, db=FakeDB())
        raise AssertionError("非生成式 3D 场景应该 409")
    except HTTPException as e:
        assert e.status_code == 409
finally:
    scene_router._get_owned = orig_owned
ok("接口：先记账再调模型、超限不再调、revise 不入库、save 不合格 422、非 3D 场景 409")

print(f"\nALL {PASS} PASS")
