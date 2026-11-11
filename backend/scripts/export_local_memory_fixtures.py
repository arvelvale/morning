"""导出「本地优先运行时·记忆与待办」要逐字/逐行为对齐的后端内容。

用法（backend 目录）：uv run python scripts/export_local_memory_fixtures.py
产物：
- frontend-demo/src/local/generated/memoryPrompts.ts   提取/待办提示词、正则源码、隐私停用字
- frontend-demo/scripts/fixtures/memory-golden.json    黄金用例：
    temporal   时间换算与中文日期文案
    extractor  提取提示词的消息组装 + 输出解析校验
    context    记忆上下文构建（真实数据库里的真实记忆 → 真实输出）
    dump       睡前倾倒编排：模型输出 → 事件流 + 落库的记忆行 + 历史行
    chat_todo  聊天里记待办：消息 + 模型输出 → 回执文案 + 落库的待办

时间一律冻结在 2026-11-11 14:30（东八区），保证每次导出结果一致。
后端提示词/规则改了就重跑本脚本，再跑 `npm run test:local`：对不上说明本地版需要同步。
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
os.environ.setdefault("DATABASE_URL", "sqlite:///" + str(Path(tempfile.gettempdir()) / "export_local_unused.db"))

from sqlalchemy import create_engine, select, text, update  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

import app.models  # noqa: E402,F401  注册全部模型
from app.db import Base  # noqa: E402
from app.graphs import extractor  # noqa: E402
from app.models import memory as memory_models  # noqa: E402
from app.models.memory import MemoryHistory, MemoryItem  # noqa: E402
from app.models.preference import UserPreference  # noqa: E402
from app.services.companion import chat_todos  # noqa: E402
from app.services.memory import context_builder, dump_ingest, privacy, temporal  # noqa: E402
from app.services.memory.memory_store import MemoryStore  # noqa: E402

FRONT = ROOT / "frontend-demo"
CST = temporal.CST
FIXED_UTC = datetime(2026, 11, 11, 6, 30, tzinfo=timezone.utc)  # = 14:30 东八区
FIXED_CST = FIXED_UTC.astimezone(CST)


class FrozenDT(datetime):
    @classmethod
    def now(cls, tz=None):  # noqa: D401
        return FIXED_UTC if tz is None else FIXED_UTC.astimezone(tz)


# ── 冻结时间：所有用到「现在」的地方 ──
temporal.now_cst = lambda: FIXED_CST
chat_todos.now_cst = lambda: FIXED_CST
for module in (extractor, dump_ingest, context_builder, memory_models):
    module.datetime = FrozenDT


def write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8", newline="\n")
    print("wrote", path.relative_to(ROOT))


def iso(value):
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


# ── 生成 TS 常量 ──
write(
    FRONT / "src/local/generated/memoryPrompts.ts",
    "// 由 backend/scripts/export_local_memory_fixtures.py 生成，不要手改。\n"
    "export const EXTRACTOR_SYSTEM_PROMPT = " + json.dumps(extractor.SYSTEM_PROMPT, ensure_ascii=False) + ";\n"
    "export const EXTRACTOR_FEW_SHOT_TEMPLATE = " + json.dumps(extractor.FEW_SHOT_TEMPLATE, ensure_ascii=False) + ";\n"
    "export const CHAT_TODO_PROMPT = " + json.dumps(extractor.CHAT_TODO_PROMPT, ensure_ascii=False) + ";\n"
    "export const CHAT_TODO_CUE_SOURCE = " + json.dumps(chat_todos._CUE.pattern, ensure_ascii=False) + ";\n"
    "export const USER_RAISED_NOTE = " + json.dumps(context_builder.USER_RAISED_NOTE, ensure_ascii=False) + ";\n"
    "export const STOP_CHARS = " + json.dumps("".join(sorted(privacy._STOP_CHARS)), ensure_ascii=False) + ";\n"
    "export const BACKREF_SOURCE = " + json.dumps(privacy._BACKREF_RE.pattern, ensure_ascii=False) + ";\n",
)

golden: dict = {"now_utc": iso(FIXED_UTC)}

# ═══ temporal ═══
due_inputs = [
    ("2026-10-19T10:15:00+08:00", True), ("2026-10-20", True), ("2026-10-20", False),
    ("2026-10-20T08:00:00", True), ("2026-10-20T08:00:00Z", True), ("2026-10-20T08:00:00z", True),
    ("2026-10-20T08:00:00+00:00", False), ("2026-10-20 09:30", True), ("2026-10-20T09:30:00.123+08:00", True),
    ("1999-01-01", True), ("2101-01-01", True), ("not a date", True), ("", True), ("   ", True), (None, True), (123, True),
    ("2026-10-20T10:00:00+08:00", "false"), ("2026-10-20T10:00:00+08:00", "FALSE"), ("2026-10-20T10:00:00+08:00", "true"),
    ("2026-13-01", True), ("2026-02-30", True),
]
golden["temporal"] = {
    "parse_due_at": [
        {"value": v, "has_time": h, "out": iso(temporal.parse_due_at(v, h))} for v, h in due_inputs
    ],
    "now_context_text": temporal.now_context_text(),
    "now_context_text_given": temporal.now_context_text(datetime(2026, 10, 19, 8, 30, tzinfo=CST)),
    "cn_date": [
        {"at": a, "out": temporal.cn_date(datetime.fromisoformat(a)), "wd": temporal.cn_date_weekday(datetime.fromisoformat(a))}
        for a in ("2026-11-11T06:30:00+00:00", "2026-12-31T20:00:00+00:00", "2026-01-01T00:00:00+00:00")
    ],
    "has_specific_time": [
        {"at": a, "out": temporal.has_specific_time(datetime.fromisoformat(a))}
        for a in ("2026-11-11T16:00:00+00:00", "2026-11-11T16:01:00+00:00", "2026-11-11T02:15:00+00:00")
    ],
}

# ═══ extractor：提示词组装 ═══
captured: list = []


class FakeModel:
    def __init__(self, output: str):
        self.output = output

    def invoke(self, messages, **kwargs):
        captured.append([{"role": type(m).__name__, "content": m.content} for m in messages])
        return SimpleNamespace(content=self.output)


def with_fake_model(output: str, kwargs_log: list | None = None):
    def factory(**kwargs):
        if kwargs_log is not None:
            kwargs_log.append(kwargs)
        return FakeModel(output)
    extractor.get_chat_model = factory


ROLE = {"SystemMessage": "system", "HumanMessage": "user"}
prompt_cases = []
for name, args in [
    ("倾倒·无画像", {"dump_text": "今天10点15要开会，明天交材料。", "profile_context": None, "todo_only": False}),
    ("倾倒·带画像", {"dump_text": "有点焦虑", "profile_context": "<memory-context>\n- [情绪] 容易紧张\n</memory-context>", "todo_only": False}),
    ("聊天待办", {"dump_text": "我明天上午11点有面试哈", "profile_context": None, "todo_only": True}),
]:
    captured.clear()
    kwargs_log: list = []
    with_fake_model("[]", kwargs_log)
    facts = extractor.run_extractor(args["dump_text"], args["profile_context"], now=FIXED_CST, todo_only=args["todo_only"])
    prompt_cases.append({
        "name": name, "input": args,
        "messages": [{"role": ROLE[m["role"]], "content": m["content"]} for m in captured[0]],
        "model_kwargs": kwargs_log[0], "facts": facts,
    })

# ═══ extractor：输出解析校验 ═══
good = {"layer": "episodic", "kind": "待办", "depth": "surface", "content": "开会", "surface_text": "你要开会",
        "confidence": 0.9, "evidence": "要开会", "entities": ["会"], "emotion": None, "due_at": "2026-11-12T10:00:00+08:00", "has_time": True}
parse_inputs = {
    "正常": json.dumps([good], ensure_ascii=False),
    "代码围栏": "```json\n" + json.dumps([good], ensure_ascii=False) + "\n```",
    "core 被丢": json.dumps([{**good, "depth": "core"}]),
    "非法 layer": json.dumps([{**good, "layer": "x"}]),
    "非法 kind": json.dumps([{**good, "kind": "x"}]),
    "非字典": json.dumps([1, "a", None, good]),
    "不是数组": json.dumps({"a": 1}),
    "坏 JSON": "[{",
    "空输出": "",
    "置信度越界": json.dumps([{**good, "confidence": 3}, {**good, "confidence": -1}, {**good, "confidence": "high"}, {**good, "confidence": True}]),
    "缺省字段": json.dumps([{"layer": "state", "kind": "灵感", "depth": "personal"}]),
    "due_at 非字符串": json.dumps([{**good, "due_at": 5}, {**good, "due_at": "  "}, {**good, "due_at": " 2026-11-12 "}]),
    "has_time false": json.dumps([{**good, "has_time": False}, {**good, "has_time": None}, {**good, "has_time": "false"}]),
    "entities null": json.dumps([{**good, "entities": None}]),
}
golden["extractor"] = {
    "prompts": prompt_cases,
    "few_shot": extractor.build_few_shot(FIXED_CST),
    "parse": [
        {"name": n, "raw": raw, "out": extractor.parse_output({"llm_output": raw, "error": ""})}
        for n, raw in parse_inputs.items()
    ],
}

# ═══ 数据库工具 ═══
def new_session_factory():
    path = Path(tempfile.mkdtemp()) / "golden.db"
    engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, expire_on_commit=False)


def rows_of(db, user_id=1):
    items = db.scalars(select(MemoryItem).where(MemoryItem.user_id == user_id).order_by(MemoryItem.id)).all()
    return [{
        "id": m.id, "layer": m.layer, "kind": m.kind, "depth": m.depth, "content": m.content, "surface_text": m.surface_text,
        "confidence": m.confidence, "status": m.status, "due_date": iso(m.due_date), "version": m.version,
        "parent_id": m.parent_id, "root_id": m.root_id, "is_latest": m.is_latest, "is_forgotten": m.is_forgotten,
        "forget_reason": m.forget_reason, "expires_at": iso(m.expires_at), "relation_type": m.relation_type,
        "relation_to_id": m.relation_to_id, "entities": m.entities, "emotion": m.emotion, "provenance": m.provenance,
        "visibility_gate": m.visibility_gate, "privacy": m.privacy, "raw_ref": m.raw_ref,
        "created_at": iso(m.created_at), "updated_at": iso(m.updated_at),
    } for m in items]


def history_of(db):
    return [{
        "memory_id": h.memory_id, "event": h.event, "actor": h.actor, "old_content": h.old_content,
        "new_content": h.new_content, "meta": h.meta,
    } for h in db.scalars(select(MemoryHistory).order_by(MemoryHistory.id)).all()]


def seed(db, **kwargs):
    store = MemoryStore(db)
    created = kwargs.pop("created", None)
    item = store.create(user_id=1, **kwargs)
    if created:
        db.execute(update(MemoryItem).where(MemoryItem.id == item.id).values(created_at=created, updated_at=created))
        db.commit()
    return item


# ═══ context：记忆上下文构建 ═══
Session = new_session_factory()
with Session() as db:
    d = lambda day, hour=0: datetime(2026, 11, day, hour, tzinfo=timezone.utc)
    seed(db, layer="profile", kind="片段", depth="surface", content="用户喜欢喝拿铁", surface_text="你喜欢喝拿铁", entities=["拿铁"], created=d(3))
    seed(db, layer="profile", kind="情绪", depth="personal", content="容易在周日晚上焦虑", surface_text="周日晚上你容易焦虑", created=d(4))
    seed(db, layer="profile", kind="情绪", depth="vulnerable", content="担心自己不配现在的职位", surface_text="你有时担心自己不够格", entities=["职位"], created=d(5))
    seed(db, layer="profile", kind="情绪", depth="core", content="渴望被认可", surface_text="你很想被认可", entities=["认可"], created=d(6))
    seed(db, layer="state", kind="灵感", depth="surface", content="想做睡前语音日记", surface_text="你想做睡前语音日记", entities=["语音日记"], created=d(7))
    seed(db, layer="state", kind="情绪", depth="personal", content="最近睡得不好", surface_text="你最近睡得不好", created=d(8))
    seed(db, layer="episodic", kind="待办", depth="surface", content="周五交实训报告", surface_text="你周五要交实训报告", status="pending",
         due_date=datetime(2026, 11, 14, 16, tzinfo=timezone.utc), entities=["实训报告"], created=d(9))
    seed(db, layer="episodic", kind="待办", depth="surface", content="昨天的会议纪要", surface_text="整理会议纪要", status="pending",
         due_date=datetime(2026, 11, 10, 2, 15, tzinfo=timezone.utc), entities=["会议纪要"], created=d(9))
    seed(db, layer="episodic", kind="待办", depth="surface", content="已经交掉的作业", surface_text="作业", status="done",
         due_date=datetime(2026, 11, 1, 16, tzinfo=timezone.utc), entities=["作业"], created=d(2))
    seed(db, layer="episodic", kind="小结", depth="surface", content="今天和同学聊了毕业设计", surface_text="今天和同学聊了毕业设计的选题", entities=["毕业设计"], created=d(10))
    seed(db, layer="episodic", kind="片段", depth="vulnerable", content="和妈妈吵架后一直很难受", surface_text="那次和妈妈吵架让你难受", entities=["妈妈"], created=d(1))
    burned = seed(db, layer="episodic", kind="片段", depth="surface", content="即焚内容拿铁", surface_text="即焚内容拿铁", entities=["拿铁"], created=d(2))
    db.execute(update(MemoryItem).where(MemoryItem.id == burned.id).values(privacy="burn_after_read"))
    db.commit()
    forgotten = seed(db, layer="episodic", kind="片段", depth="surface", content="已遗忘的拿铁", surface_text="已遗忘的拿铁", entities=["拿铁"], created=d(2))
    MemoryStore(db).forget(forgotten.id, "x", event="DELETE", actor="user")

    context_cases = []
    for name, kw in [
        ("profile 模式", dict(mode="profile")),
        ("full 无 query", dict(mode="full")),
        ("query 命中实体", dict(mode="query", query="今天想喝拿铁")),
        ("query bigram 命中", dict(mode="query", query="实训报告什么时候交")),
        ("query 无命中", dict(mode="query", query="zzzz")),
        ("full + query", dict(mode="full", query="实训报告和语音日记")),
        ("用户提起脆弱记忆·实体命中", dict(mode="full", query="我又在想职位的事", user_initiated=True, user_text="我又在想职位的事")),
        ("用户提起·回指", dict(mode="full", query="我又想起那件事了", user_initiated=True, user_text="我又想起那件事了")),
        ("用户提起·无关", dict(mode="full", query="今天天气不错", user_initiated=True, user_text="今天天气不错")),
        ("未声明 user_initiated 不放脆弱", dict(mode="full", query="我又在想职位的事", user_text="我又在想职位的事")),
        ("过期待办标注", dict(mode="query", query="会议纪要")),
        ("预算裁剪", dict(mode="full", query="拿铁 实训报告 语音日记 毕业设计 会议纪要 作业")),
    ]:
        context_cases.append({"name": name, "args": kw, "out": context_builder.build(db, 1, **kw)})
    context_fixture = {"items": rows_of(db), "cases": context_cases}
golden["context"] = context_fixture

# ═══ dump：睡前倾倒编排 ═══
fact_a = {"layer": "episodic", "kind": "待办", "depth": "surface", "content": "11月12日10:15要参加线上宣讲会",
          "surface_text": "你11月12日上午10:15要参加线上宣讲会", "confidence": 0.98, "evidence": "明天10点15要参加线上宣讲会",
          "entities": ["线上宣讲会"], "emotion": None, "due_at": "2026-11-12T10:15:00+08:00", "has_time": True}
fact_b = {"layer": "episodic", "kind": "待办", "depth": "surface", "content": "11月12日要提交实训材料",
          "surface_text": "你11月12日要交实训材料", "confidence": 0.9, "evidence": "明天要交实训材料", "entities": ["实训材料"],
          "emotion": {"label": "焦虑", "intensity": 0.6}, "due_at": "2026-11-12T00:00:00+08:00", "has_time": False}
fact_c = {"layer": "profile", "kind": "情绪", "depth": "vulnerable", "content": "存在自我怀疑", "surface_text": "你有时担心自己不够格",
          "confidence": 0.85, "evidence": "觉得自己不配", "entities": [], "emotion": {"label": "自我怀疑", "intensity": 0.8}, "due_at": None, "has_time": False}
fact_d = {"layer": "state", "kind": "灵感", "depth": "personal", "content": "想法：睡前语音日记", "surface_text": "你冒出一个点子",
          "confidence": 0.9, "evidence": "做个睡前语音日记", "entities": ["语音日记"], "emotion": None, "due_at": None, "has_time": False}
fact_e = {"layer": "episodic", "kind": "片段", "depth": "surface", "content": "和朋友在海边看日落", "surface_text": "那天在海边看日落",
          "confidence": 0.8, "evidence": "海边看日落", "entities": ["海边"], "emotion": None, "due_at": "坏日期", "has_time": True}
fact_f = {"layer": "episodic", "kind": "小结", "depth": "surface", "content": "今天过得还行", "surface_text": "今天过得还行",
          "confidence": 0.7, "evidence": "", "entities": [], "emotion": None, "due_at": None, "has_time": False}
DUMP_TEXT = "明天10点15要参加线上宣讲会。明天要交实训材料。觉得自己不配。做个睡前语音日记。海边看日落。"
dump_cases = []
for name, raw, keep_raw, ttl, audio_ref in [
    ("全 kind 正常", json.dumps([fact_a, fact_b, fact_c, fact_d, fact_e, fact_f], ensure_ascii=False), True, 7, None),
    ("原文即焚", json.dumps([fact_a, fact_c], ensure_ascii=False), False, 3, "audio://x"),
    ("提取为空 → 兜底", "[]", True, 7, None),
    ("模型输出坏掉 → 兜底", "not json", True, 7, None),
    ("全部越界被丢 → 兜底", json.dumps([{**fact_a, "depth": "core"}]), True, 7, None),
]:
    Session = new_session_factory()
    captured.clear()
    with_fake_model(raw)
    with Session() as db:
        pref = UserPreference(user_id=1, keep_raw_dump=keep_raw, ephemeral_ttl_days=ttl)
        db.add(pref)
        db.commit()
        # 画像里已有一条，验证它会进提取提示词
        seed(db, layer="profile", kind="片段", depth="surface", content="喜欢拿铁", surface_text="你喜欢拿铁", created=datetime(2026, 11, 3, tzinfo=timezone.utc))
        gen = dump_ingest.ingest_dump(db, user_id=1, dump_text=DUMP_TEXT, raw_ref=audio_ref)
        events = list(gen)
        dump_cases.append({
            "name": name, "llm_output": raw, "keep_raw": keep_raw, "ttl_days": ttl, "raw_ref": audio_ref, "text": DUMP_TEXT,
            "messages": [{"role": ROLE[m["role"]], "content": m["content"]} for m in captured[0]] if captured else None,
            "events": events, "rows": rows_of(db), "history": history_of(db),
        })
golden["dump"] = dump_cases

# ═══ chat_todo：聊天里记待办 ═══
def todo_fact(**over):
    base = {"layer": "episodic", "kind": "待办", "depth": "surface", "content": "参加面试", "surface_text": "参加面试",
            "confidence": 0.95, "evidence": "我明天上午11点有面试", "entities": [], "emotion": None,
            "due_at": "2026-11-12T11:00:00+08:00", "has_time": True}
    base.update(over)
    return base


chat_cases = []
MSG = "我明天上午11点有面试哈"
for name, message, outputs, preexisting in [
    ("正常记一条", MSG, [todo_fact()], False),
    ("没有线索词不调模型", "今天心情不错呀", [todo_fact()], False),
    ("回信引用不记", "（我在回复你刚写给我的信：xxx）明天要考试", [todo_fact()], False),
    ("置信度不够", MSG, [todo_fact(confidence=0.8)], False),
    ("证据不在原文里", MSG, [todo_fact(evidence="瞎编的证据")], False),
    ("证据为空", MSG, [todo_fact(evidence="  ")], False),
    ("kind 不是待办", MSG, [todo_fact(kind="灵感", layer="state")], False),
    ("日期早于今天", MSG, [todo_fact(due_at="2026-11-10T11:00:00+08:00")], False),
    ("今天但已过去的时刻", "我今天上午9点有面试", [todo_fact(evidence="我今天上午9点有面试", due_at="2026-11-11T09:00:00+08:00")], False),
    ("今天只有日期（可记）", "今天要交报告", [todo_fact(content="交报告", evidence="今天要交报告", due_at="2026-11-11T00:00:00+08:00", has_time=False)], False),
    ("due_at 非法被跳过", MSG, [todo_fact(due_at="明天上午")], False),
    ("没有日期也可记", "记得买牛奶", [todo_fact(content="买牛奶", evidence="记得买牛奶", due_at=None, has_time=False)], False),
    ("标题过长", MSG, [todo_fact(content="很" * 121)], False),
    ("标题空白整理", MSG, [todo_fact(content="  参加  面试。 ")], False),
    ("重复的待办不再记", MSG, [todo_fact()], True),
    ("一次最多三条", "明天上午11点有面试，后天要交报告，周五约了牙医，下周要去旅行", [
        todo_fact(content="面试", evidence="明天上午11点有面试"),
        todo_fact(content="交报告", evidence="后天要交报告", due_at="2026-11-13T00:00:00+08:00", has_time=False),
        todo_fact(content="看牙医", evidence="周五约了牙医", due_at="2026-11-13T15:00:00+08:00"),
        todo_fact(content="旅行", evidence="下周要去旅行", due_at="2026-11-16T00:00:00+08:00", has_time=False),
    ], False),
    ("模型输出坏掉", MSG, "BAD", False),
]:
    Session = new_session_factory()
    chat_todos.SessionLocal = Session
    captured.clear()
    calls: list = []
    with_fake_model("not json" if outputs == "BAD" else json.dumps(outputs, ensure_ascii=False), calls)
    with Session() as db:
        db.add(UserPreference(user_id=1))
        db.commit()
        if preexisting:
            seed(db, layer="episodic", kind="待办", depth="surface", content="参加面试", surface_text="参加面试", status="pending",
                 due_date=temporal.parse_due_at("2026-11-12T11:00:00+08:00", True))
    labels = chat_todos.capture_chat_todos(1, message)
    with Session() as db:
        chat_cases.append({
            "name": name, "message": message, "llm_output": None if outputs == "BAD" else outputs, "raw": "not json" if outputs == "BAD" else None,
            "preexisting": preexisting, "model_called": bool(calls), "model_kwargs": calls[0] if calls else None,
            "labels": labels, "rows": rows_of(db), "history": history_of(db),
        })
golden["chat_todo"] = chat_cases

write(FRONT / "scripts/fixtures/memory-golden.json", json.dumps(golden, ensure_ascii=False, indent=1))
