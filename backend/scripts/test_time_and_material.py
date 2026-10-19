"""时间识别 + 晚间信不复读旧事：隔离 SQLite + 大模型替身，不打真 LLM、不碰开发库。

覆盖：
  A 抽取：提示词注入「现在」；due_at → due_date 换算（今天带时刻 / 明天只有日期 / has_time=false）；
          非法 due_at 不写 due_date 也不丢记忆；原文即焚时不留 evidence；待办 API 返回 has_time。
  B 晚间信：当天没有素材不回落旧记忆；素材带记下日期 + 提示词写明今天；用过的 id 不再取用；
          上下文构建器每条带日期、过期待办标注；主动触达素材带日期；睡前提醒注入「现在」。
  C 片段：GET /candidates 返回 evidence / created_at。

运行：cd backend && DATABASE_URL="sqlite:///$(cygpath -m $(mktemp -d))/t.db" PYTHONUTF8=1 PYTHONPATH=. .venv/Scripts/python.exe scripts/test_time_and_material.py
"""
import json
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

os.environ["DATABASE_URL"] = "sqlite://"
os.environ.setdefault("JWT_SECRET", "isolated-time-material-test-secret")

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

import app.models  # noqa: F401  注册全部表
from app.core.security import hash_password
from app.db import Base
from app.graphs import extractor
from app.models.letter import Letter
from app.models.memory import MemoryHistory, MemoryItem
from app.models.preference import UserPreference
from app.models.user import User
from app.routers.memory import stores
from app.routers.scene import candidates
from app.services.mailbox import bedtime_reminder, evening_letter
from app.services.memory import dump_ingest
from app.services.memory.context_builder import build as build_context
from app.services.memory.memory_store import MemoryStore
from app.services.memory.temporal import CST, cn_date, now_context_text, parse_due_at
from app.services.signals import context as signal_context

# 固定的「现在」：2026-10-19 周一 08:30（东八区）
NOW = datetime(2026, 10, 19, 8, 30, tzinfo=CST)


class FakeChatModel:
    """记下收到的消息，吐出预设 content。"""

    def __init__(self, reply):
        self.reply = reply
        self.messages = None

    def invoke(self, messages):
        self.messages = messages
        return SimpleNamespace(content=self.reply)

    def text(self):
        return "\n".join(m.content if hasattr(m, "content") else m["content"] for m in self.messages)


class FakeLLM:
    def __init__(self, reply):
        self.reply = reply
        self.prompts = []

    def invoke(self, messages):
        self.prompts.append("\n".join(m["content"] for m in messages))
        return SimpleNamespace(content=self.reply)


def facts(*items):
    base = {"layer": "episodic", "kind": "待办", "depth": "surface", "confidence": 0.9,
            "surface_text": "", "evidence": "", "entities": [], "emotion": None,
            "due_at": None, "has_time": True}
    return [{**base, **it} for it in items]


def utc(*a):
    return datetime(*a, tzinfo=timezone.utc)


def as_utc(dt):
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


class Base_(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.engine = create_engine("sqlite:///" + str(Path(self.temp.name) / "t.db"),
                                    connect_args={"check_same_thread": False})
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine, expire_on_commit=False)
        self.user = User(username="tm", password_hash=hash_password("secret123"))
        self.db.add(self.user)
        self.db.commit()
        self.store = MemoryStore(self.db)

    def tearDown(self):
        self.db.close()
        self.engine.dispose()
        self.temp.cleanup()

    def mem(self, content, *, days_ago=0, kind="待办", depth="surface", layer="episodic", **kw):
        m = self.store.create(user_id=self.user.id, layer=layer, kind=kind, depth=depth,
                              content=content, surface_text=content, actor="test", **kw)
        if days_ago:
            m.created_at = datetime.now(timezone.utc) - timedelta(days=days_ago)
            self.db.commit()
        return m

    def ingest(self, fact_list, text="今天10点15要参加线上宣讲会"):
        with patch.object(dump_ingest, "run_extractor", return_value=fact_list), \
                patch.object(dump_ingest, "build_memory_context", return_value=""):
            gen = dump_ingest.ingest_dump(self.db, user_id=self.user.id, dump_text=text)
            for _ in gen:
                pass


class ExtractorTests(Base_):
    def run_with(self, reply, now=NOW):
        model = FakeChatModel(reply)
        with patch.object(extractor, "get_chat_model", return_value=model):
            out = extractor.run_extractor("今天10点15要参加线上宣讲会", now=now)
        return model, out

    def test_prompt_injects_now(self):
        model, _ = self.run_with("[]")
        text = model.text()
        self.assertIn("现在是 2026-10-19 周一 08:30（东八区）", text)
        # 示例日期随「现在」生成：今天 10:15、明天只有日期
        self.assertIn("2026-10-19T10:15:00+08:00", text)
        self.assertIn("2026-10-20T00:00:00+08:00", text)
        self.assertIn("10月19日10:15要参加线上宣讲会", text)
        # 换一个「现在」，示例跟着变，说明没有写死
        model2, _ = self.run_with("[]", now=datetime(2027, 3, 5, 22, 0, tzinfo=CST))
        self.assertIn("现在是 2027-03-05 周五 22:00（东八区）", model2.text())
        self.assertIn("2027-03-06T00:00:00+08:00", model2.text())
        self.assertNotIn("2026-10-19T10:15", model2.text())

    def test_prompt_rules(self):
        model, _ = self.run_with("[]")
        text = model.text()
        self.assertIn("due_at", text)
        self.assertIn("has_time", text)
        self.assertIn("米露", text, "只提桌宠名字不单独成片段的规则")

    def test_due_at_passthrough_and_defaults(self):
        reply = json.dumps(facts(
            {"content": "10月19日10:15要参加线上宣讲会", "due_at": "2026-10-19T10:15:00+08:00", "has_time": True},
            {"content": "无时间", "kind": "灵感"},
            {"content": "坏类型", "due_at": 123},
        ), ensure_ascii=False)
        # 去掉第二条的 due_at/has_time 键，模拟模型漏写
        arr = json.loads(reply)
        del arr[1]["due_at"], arr[1]["has_time"]
        _, out = self.run_with(json.dumps(arr, ensure_ascii=False))
        self.assertEqual(out[0]["due_at"], "2026-10-19T10:15:00+08:00")
        self.assertTrue(out[0]["has_time"])
        self.assertIsNone(out[1]["due_at"])
        self.assertIsNone(out[2]["due_at"], "非字符串的 due_at 当没有")


class ParseDueTests(unittest.TestCase):
    def test_conversion(self):
        # 设计值：今天10点15（东八区）→ 2026-10-19T02:15:00Z
        self.assertEqual(parse_due_at("2026-10-19T10:15:00+08:00"), utc(2026, 10, 19, 2, 15))
        # 明天，只有日期 → 20 日东八区 00:00 = 19 日 16:00Z
        self.assertEqual(parse_due_at("2026-10-20", False), utc(2026, 10, 19, 16, 0))
        self.assertEqual(parse_due_at("2026-10-20T00:00:00+08:00", False), utc(2026, 10, 19, 16, 0))
        # has_time=false 时即使模型带了钟点也压到当天 00:00
        self.assertEqual(parse_due_at("2026-10-20T15:00:00+08:00", False), utc(2026, 10, 19, 16, 0))
        # 无时区按东八区；Z 结尾按 UTC
        self.assertEqual(parse_due_at("2026-10-19T10:15:00"), utc(2026, 10, 19, 2, 15))
        self.assertEqual(parse_due_at("2026-10-19T02:15:00Z"), utc(2026, 10, 19, 2, 15))

    def test_invalid(self):
        for bad in (None, "", "   ", "明天", "2026-13-40", "not a date", 123, "1999-01-01T00:00:00+08:00"):
            self.assertIsNone(parse_due_at(bad), bad)


class IngestTests(Base_):
    def test_due_date_written(self):
        self.ingest(facts(
            {"content": "10月19日10:15要参加线上宣讲会", "due_at": "2026-10-19T10:15:00+08:00",
             "has_time": True, "evidence": "今天10点15要参加线上宣讲会"},
            {"content": "10月20日要提交实训材料", "due_at": "2026-10-20T00:00:00+08:00", "has_time": False},
            {"content": "没有时间的待办"},
        ))
        todos = {m.content: m for m in self.store.list_by_kind(self.user.id, "待办")}
        a = todos["10月19日10:15要参加线上宣讲会"]
        b = todos["10月20日要提交实训材料"]
        self.assertEqual(as_utc(a.due_date), utc(2026, 10, 19, 2, 15))
        self.assertEqual(as_utc(b.due_date), utc(2026, 10, 19, 16, 0))
        self.assertIsNone(todos["没有时间的待办"].due_date)

    def test_invalid_due_at_keeps_memory(self):
        self.ingest(facts(
            {"content": "坏时间的待办", "due_at": "明天下午"},
            {"content": "更坏", "due_at": "2026-99-99T00:00:00+08:00"},
        ))
        todos = {m.content: m for m in self.store.list_by_kind(self.user.id, "待办")}
        self.assertIn("坏时间的待办", todos, "解析失败只丢截止时间，不丢记忆")
        self.assertIn("更坏", todos)
        self.assertIsNone(todos["坏时间的待办"].due_date)
        self.assertIsNone(todos["更坏"].due_date)

    def test_non_todo_can_carry_due(self):
        self.ingest(facts({"kind": "片段", "content": "10月20日交材料的压力", "due_at": "2026-10-20", "has_time": False}))
        frag = [m for m in self.store.list_by_kind(self.user.id, "片段") if not m.raw_ref][0]
        self.assertEqual(as_utc(frag.due_date), utc(2026, 10, 19, 16, 0))

    def test_todo_api_has_time(self):
        self.ingest(facts(
            {"content": "宣讲会", "due_at": "2026-10-19T10:15:00+08:00"},
            {"content": "交材料", "due_at": "2026-10-20", "has_time": False},
            {"content": "无截止"},
        ))
        out = {t.content: t for t in stores.list_todos(status=None, due=None, user=self.user, db=self.db)}
        self.assertTrue(out["宣讲会"].has_time)
        self.assertFalse(out["交材料"].has_time, "00:00（东八区）视为只有日期")
        self.assertFalse(out["无截止"].has_time)
        self.assertIsNone(out["无截止"].due_date)
        # 返回给前端的 due_date 一定带时区（SQLite 取回是 naive，序列化前补 UTC）
        self.assertIsNotNone(out["宣讲会"].due_date.tzinfo)
        self.assertEqual(out["宣讲会"].due_date.astimezone(timezone.utc), utc(2026, 10, 19, 2, 15))
        self.assertIn('"has_time":true', out["宣讲会"].model_dump_json())

    def test_candidates_return_evidence(self):
        self.ingest(facts({"kind": "片段", "content": "和小林吵架", "surface_text": "你和小林吵了一架",
                           "evidence": "今天和小林吵了一架，一直放不下"}))
        lst = candidates.list_candidates(user=self.user, db=self.db)
        self.assertEqual(len(lst), 1)
        c = lst[0]
        self.assertEqual(c.evidence, "今天和小林吵了一架，一直放不下")
        self.assertEqual((c.content, c.surface_text), ("和小林吵架", "你和小林吵了一架"))
        self.assertIsNotNone(c.created_at)
        one = candidates.get_candidate(c.id, user=self.user, db=self.db)
        self.assertEqual(one.evidence, c.evidence)

    def test_candidate_evidence_falls_back_to_dump_text(self):
        # 老数据：ADD 历史没有 evidence → 退回来源倾诉原文
        self.ingest(facts({"kind": "片段", "content": "老片段"}), text="整段倾诉原文")
        c = candidates.list_candidates(user=self.user, db=self.db)[0]
        self.assertEqual(c.evidence, "整段倾诉原文")

    def test_burn_mode_keeps_no_evidence(self):
        self.db.add(UserPreference(user_id=self.user.id, keep_raw_dump=False))
        self.db.commit()
        self.ingest(facts({"kind": "片段", "content": "要焚的", "evidence": "逐字原话"}))
        c = candidates.list_candidates(user=self.user, db=self.db)[0]
        self.assertIsNone(c.evidence, "原文即焚：原话摘录也不留")
        metas = [h.meta for h in self.db.scalars(select(MemoryHistory)).all() if h.meta]
        self.assertFalse(any("evidence" in m for m in metas))


class MaterialTests(Base_):
    def evening(self, reply=None):
        llm = FakeLLM(reply or json.dumps({"title": "晚安", "body": "今晚好好歇着。"}, ensure_ascii=False))
        with patch.object(evening_letter, "get_chat_model", return_value=llm):
            letter = evening_letter.generate_evening_letter(self.db, self.user.id)
        return llm, letter

    def test_no_fallback_to_old_memories(self):
        old = self.mem("明天要交实训材料", days_ago=6)
        self.assertEqual(evening_letter._gather_material(self.db, self.user.id), [])
        llm, letter = self.evening()
        self.assertIsNotNone(letter)
        self.assertNotIn("实训材料", llm.prompts[0], "当天没有新素材时不能复读旧事")
        self.assertIn("今天没有碎片", llm.prompts[0])
        self.assertIsNone(letter.attachment)
        self.assertIn("不要凭空提到任何具体的旧事", evening_letter.EVENING_SYSTEM_PROMPT)
        self.assertTrue(old.id)

    def test_material_has_date_prefix_and_today(self):
        self.mem("今天新记的事")
        self.mem("昨天以前的旧事", days_ago=3)
        llm, _ = self.evening()
        p = llm.prompts[0]
        today = datetime.now(CST)
        self.assertIn(f"{cn_date(today)}记下：今天新记的事", p)
        self.assertNotIn("昨天以前的旧事", p)
        self.assertIn(f"今天是{today.month}月{today.day}日周", p)
        self.assertIn("已经过去的事绝不能说成「明天」", evening_letter.EVENING_SYSTEM_PROMPT)

    def test_used_ids_not_taken_again(self):
        a = self.mem("今天的甲")
        b = self.mem("今天的乙")
        self.assertEqual({m.id for m in evening_letter._material_items(self.db, self.user.id)}, {a.id, b.id})
        _, letter = self.evening()
        self.assertEqual(set(letter.attachment["material_ids"]), {a.id, b.id})
        self.assertEqual(evening_letter._material_items(self.db, self.user.id), [], "提过的不再取")
        c = self.mem("今天的丙")
        self.assertEqual([m.id for m in evening_letter._material_items(self.db, self.user.id)], [c.id])

    def test_expired_todo_flagged_in_material(self):
        self.mem("提交实训材料", due_date=datetime.now(timezone.utc) - timedelta(days=1))
        line = evening_letter._gather_material(self.db, self.user.id)[0]
        self.assertIn("已过期", line)

    def test_context_builder_dates_and_expired(self):
        self.mem("实训材料要交", days_ago=6, due_date=datetime.now(timezone.utc) - timedelta(days=5), status="pending")
        self.mem("最近在学吉他", days_ago=2, kind="灵感", layer="state")
        ctx = build_context(self.db, self.user.id, mode="full", query="实训材料")
        today = datetime.now(CST)
        self.assertIn(now_context_text(today)[:14], ctx)  # 「现在是 YYYY-MM-DD」
        self.assertIn(f"{cn_date(datetime.now(timezone.utc) - timedelta(days=6))}记下", ctx)
        self.assertIn("已过期", ctx)
        self.assertIn(f"{cn_date(datetime.now(timezone.utc) - timedelta(days=2))}记下", ctx)
        self.assertIn("- [", ctx)
        # 没有记忆时不加说明头
        empty = build_context(self.db, 99999, mode="full", query="x")
        self.assertNotIn("现在是", empty)

    def test_signal_material_has_date(self):
        self.mem("昨天写了半页", days_ago=1)
        lines = signal_context._surface_material(self.db, self.user.id)
        self.assertTrue(lines[0].startswith(f"{cn_date(datetime.now(timezone.utc) - timedelta(days=1))}记下："))

    def test_bedtime_gets_now_and_no_invented_todos(self):
        seen = {}

        def fake(mode, history, *a, pet_prompt=None, env_context=None, **k):
            seen["env"] = env_context
            return "夜深了，早点歇息。"

        with patch.object(bedtime_reminder, "run_companion", side_effect=fake):
            letter = bedtime_reminder.generate_bedtime_reminder(self.db, self.user.id)
        self.assertIsNotNone(letter)
        self.assertIn("现在是", seen["env"])
        self.assertIn("不要提起或编造任何具体的待办", seen["env"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
