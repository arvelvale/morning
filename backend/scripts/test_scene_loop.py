"""剧场接入核心闭环：隔离 SQLite + 大模型替身，不调用真实模型、不碰开发库。

链路：倾倒片段 → 夜间邀请（连夜搭台）→ 接受 → 结算 → 片场余温 → 晚间来信轻轻提起。
另验：隐私闸（vulnerable 片段不自动搭台）、滚动 24 小时窗口、预搭失败时接受可现搭、
「什么都不留」不留余温、同一片段不重复邀请。

运行：cd backend && PYTHONUTF8=1 PYTHONPATH=. .venv/Scripts/python.exe scripts/test_scene_loop.py
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
os.environ.setdefault("JWT_SECRET", "isolated-scene-loop-test-secret")

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

import app.models  # noqa: F401  注册全部表
from app.core.security import hash_password
from app.db import Base
from app.models.conversation import Conversation, Message
from app.models.letter import Letter
from app.models.memory import MemoryItem
from app.models.scene import Scene
from app.models.user import User
from app.routers.mailbox.letters import accept_scene_invite
from app.routers.scene.scenes import list_scenes
from app.services.mailbox import evening_letter
from app.services.memory.memory_store import MemoryStore
from app.services.scene import scene_recommend, scene_service

OPENING = {"title": "那句话", "setting": "傍晚的客厅", "beats": [{"speaker": "旁白", "text": "灯亮着。"}],
           "choices": [{"id": "1", "label": "开口"}]}
SPEC = {"env": "room", "props": [], "characters": [], "lighting": "warm", "camera": "mid"}


class FakeLLM:
    """按顺序吐出预设回复，并记下每次收到的 prompt。"""

    def __init__(self, replies):
        self.replies = list(replies)
        self.prompts = []

    def invoke(self, messages):
        self.prompts.append("\n".join(m["content"] for m in messages))
        return SimpleNamespace(content=self.replies.pop(0))


def recommend_reply(fragment_id, quote="和小林吵架那句话，一直放不下"):
    return json.dumps({"worth": True, "fragment_id": fragment_id, "title": "那句话", "people": ["小林"],
                       "place": "客厅", "plot": "想把那句话重新说一遍", "intent": "把没说的话说完",
                       "quote": quote, "counterpart": "小林",
                       "theater_id": None, "confidence": 0.2}, ensure_ascii=False)


INVITE_REPLY = json.dumps({
    "title": "想跟小林说的那句话", "lead": "你说那次吵架后，那句话一直卡着。",
    "openers": ["小林，那天我说重了，想跟你说声对不起。", "我们能聊聊那天的事吗？"],
    "replies": [{"they": "算了，都过去了。", "you": "我知道，但我还是想说出来。"}, {"they": "缺", "you": ""}],
    "closing": "说出口就已经很勇敢了。",
}, ensure_ascii=False)
EVENING_REPLY = json.dumps({"title": "晚安", "body": "演完之后，心里轻一点了吗？"}, ensure_ascii=False)


class SceneLoopTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.engine = create_engine("sqlite:///" + str(Path(self.temp.name) / "loop.db"),
                                    connect_args={"check_same_thread": False})
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine, expire_on_commit=False)
        self.user = User(username="loop", password_hash=hash_password("secret123"))
        self.db.add(self.user)
        self.db.commit()
        self.patches = [
            patch.object(scene_recommend, "build_memory_context", return_value=""),
            patch("app.graphs.theater.generate_manual", return_value=dict(OPENING)),
            patch("app.services.scene.scene_spec.generate_scene_spec", return_value=dict(SPEC)),
            patch("app.services.scene.scene_images.gen_scene_images", return_value=(None, None)),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.db.close()
        self.engine.dispose()
        self.temp.cleanup()

    def fragment(self, text, depth="surface", hours_ago=2):
        mem = MemoryStore(self.db).create(
            user_id=self.user.id, layer="episodic", kind="片段", depth=depth,
            content=text, surface_text=text, actor="test",
        )
        mem.created_at = datetime.now(timezone.utc) - timedelta(hours=hours_ago)
        self.db.commit()
        return mem

    def run_nightly(self, fragment_id):
        llm = FakeLLM([recommend_reply(fragment_id), INVITE_REPLY])
        with patch.object(scene_recommend, "get_chat_model", return_value=llm):
            results = scene_recommend.run_scene_recommend_all(self.db)
        return llm, results

    # ─── 主链路 ────────────────────────────────────────────────────────────
    def test_full_loop(self):
        surface = self.fragment("和小林吵架那句话，一直放不下")
        secret = self.fragment("非常私密的自我否定", depth="vulnerable")

        llm, results = self.run_nightly(surface.id)
        prompt = llm.prompts[0]
        self.assertIn(f"片段#{surface.id}", prompt)
        self.assertNotIn("非常私密的自我否定", prompt, "vulnerable 片段不能进外部模型")
        self.assertNotIn(f"片段#{secret.id}", prompt)

        letter = self.db.scalar(select(Letter).where(Letter.type == "scene_invite"))
        self.assertIsNotNone(letter)
        self.assertEqual(letter.attachment["fragment_id"], surface.id)
        self.assertEqual(letter.ref_memory_id, surface.id)
        # 「有句话」：结构化内容 + 纯文本正文（旧版 App 只读 body）
        r = letter.attachment["rehearsal"]
        self.assertEqual(r["quote"], "和小林吵架那句话，一直放不下")
        self.assertEqual(r["counterpart"], "小林")
        self.assertEqual(len(r["openers"]), 2)
        self.assertEqual(r["replies"], [{"they": "算了，都过去了。", "you": "我知道，但我还是想说出来。"}], "不完整的回应被丢弃")
        self.assertIn("可以这样开口", letter.body)
        self.assertIn("小林可能会说：算了，都过去了。", letter.body)
        # 不再连夜预搭：没人点就不花模型调用
        self.assertNotIn("scene_id", letter.attachment)
        self.assertEqual(self.db.scalars(select(Scene)).all(), [], "夜里不建场景")
        self.assertEqual(len(llm.prompts), 2, "夜里只有判断 + 写信两次调用")

        res = accept_scene_invite(letter.id, user=self.user, db=self.db)
        self.assertFalse(res["already_accepted"])
        scene = self.db.get(Scene, res["scene_id"])
        self.assertEqual(scene.status, "active", "点「进去说说看」时现搭")
        self.assertEqual(scene.render_kind, "generated_3d")
        self.assertEqual(scene.scene_spec, SPEC)
        self.assertEqual(scene.source_fragment_id, surface.id)
        self.db.refresh(surface)
        self.assertEqual(surface.status, "confirmed", "接受 = 确认片段，离开草稿箱")
        self.assertTrue(accept_scene_invite(letter.id, user=self.user, db=self.db)["already_accepted"])
        self.assertEqual([s.id for s in list_scenes(user=self.user, db=self.db)], [scene.id])

        result = scene_service.settle(self.db, scene, self.user.id, card_text="说出口就好了", keep=True)
        glow = self.db.get(MemoryItem, result["afterglow_memory_id"])
        self.assertEqual(glow.depth, "surface")
        self.assertIn("那句话", glow.content, "表层片段带剧场标题")
        self.assertIn(scene_service.AFTERGLOW_TAG, glow.entities)

        ev = FakeLLM([EVENING_REPLY])
        with patch.object(evening_letter, "get_chat_model", return_value=ev):
            greeting = evening_letter.generate_evening_letter(self.db, self.user.id)
        self.assertIn("刚在片场演完的一幕", ev.prompts[0])
        self.assertIn("那句话", ev.prompts[0])
        self.assertEqual(greeting.attachment["afterglow_ids"], [glow.id])
        self.assertEqual(evening_letter._pending_afterglow(self.db, self.user.id), [], "提过一次就不再重复")
        # 余温不混进普通碎片（避免同一件事在信里出现两次）
        self.assertNotIn(glow.content, evening_letter._gather_material(self.db, self.user.id))

    # ─── 边界 ──────────────────────────────────────────────────────────────
    def test_personal_fragment_gives_generic_afterglow(self):
        frag = self.fragment("和爸爸的那次争执", depth="personal")
        self.run_nightly(frag.id)
        letter = self.db.scalar(select(Letter).where(Letter.type == "scene_invite"))
        accept_scene_invite(letter.id, user=self.user, db=self.db)
        scene = self.db.get(Scene, letter.attachment["scene_id"])
        result = scene_service.settle(self.db, scene, self.user.id, card_text="卡", keep=True)
        glow = self.db.get(MemoryItem, result["afterglow_memory_id"])
        self.assertNotIn("那句话", glow.content, "personal 片段不把标题降级成表层")
        self.assertIn("一件放不下的事", glow.content)

    def test_keep_nothing_leaves_no_afterglow(self):
        scene = Scene(user_id=self.user.id, title="t", status="active", setting="", beats=[], choices=[], history=[])
        self.db.add(scene)
        self.db.commit()
        result = scene_service.settle(self.db, scene, self.user.id, keep=False)
        self.assertNotIn("afterglow_memory_id", result)

    def test_lookback_window_includes_last_night(self):
        last_night = self.fragment("昨晚睡前说的事", hours_ago=20)
        too_old = self.fragment("两天前的事", hours_ago=30)
        ids = {m.id for m in scene_recommend._gather_dump_fragments(self.db, self.user.id)}
        self.assertIn(last_night.id, ids, "早上 8 点跑任务时要看到前一晚的倾倒")
        self.assertNotIn(too_old.id, ids)

    def test_invited_fragment_not_invited_again(self):
        frag = self.fragment("同一件事")
        self.run_nightly(frag.id)
        ids = {m.id for m in scene_recommend._gather_dump_fragments(self.db, self.user.id)}
        self.assertNotIn(frag.id, ids)

    def test_chat_lines_are_material(self):
        conv = Conversation(user_id=self.user.id, mode="free_chat")
        self.db.add(conv)
        self.db.commit()
        self.db.add_all([Message(conversation_id=conv.id, role="user", content="想跟我妈说实习想去杭州，但开不了口"),
                         Message(conversation_id=conv.id, role="assistant", content="桌宠的回复不该进素材")])
        self.db.commit()
        llm = FakeLLM([recommend_reply(None, quote="想跟我妈说实习想去杭州"), INVITE_REPLY])
        with patch.object(scene_recommend, "get_chat_model", return_value=llm):
            scene_recommend.run_scene_recommend_all(self.db)
        self.assertIn("想跟我妈说实习想去杭州", llm.prompts[0])
        self.assertNotIn("桌宠的回复不该进素材", llm.prompts[0])
        letter = self.db.scalar(select(Letter).where(Letter.type == "scene_invite"))
        self.assertEqual(letter.attachment["rehearsal"]["quote"], "想跟我妈说实习想去杭州")

    def test_invented_quote_is_dropped(self):
        frag = self.fragment("和室友的事")
        llm = FakeLLM([recommend_reply(frag.id, quote="我真的很讨厌他"), INVITE_REPLY])
        with patch.object(scene_recommend, "get_chat_model", return_value=llm):
            scene_recommend.run_scene_recommend_all(self.db)
        letter = self.db.scalar(select(Letter).where(Letter.type == "scene_invite"))
        self.assertEqual(letter.attachment["rehearsal"]["quote"], "", "素材里没有的话不能印成「你说过」")
        self.assertNotIn("你说过", letter.body)

    def test_weekly_cap_skips_model_call(self):
        for i in range(scene_recommend.WEEKLY_INVITE_CAP):
            self.db.add(Letter(user_id=self.user.id, type="scene_invite", title="t", body="b",
                               generation_key=f"old-{i}", created_at=datetime.now(timezone.utc) - timedelta(days=i + 1)))
        self.db.commit()
        self.fragment("又一件事")
        llm = FakeLLM([])
        with patch.object(scene_recommend, "get_chat_model", return_value=llm):
            self.assertIsNone(scene_recommend.analyze_for_user(self.db, self.user.id))
        self.assertEqual(llm.prompts, [], "到上限连判断都不调模型")

    def test_old_invite_format_still_sends(self):
        title, body, r = scene_recommend._parse_invite('{"title": "一张戏票", "body": "想去看看吗"}', {})
        self.assertEqual((title, body, r), ("一张戏票", "想去看看吗", None))
        title, body, r = scene_recommend._parse_invite("不是 JSON", {"title": "那句话", "people": ["小林"]})
        self.assertIsNone(r)
        self.assertIn("小林", body)

    def test_accept_without_prestage(self):
        frag = self.fragment("现搭会失败的一件事")
        self.run_nightly(frag.id)
        letter = self.db.scalar(select(Letter).where(Letter.type == "scene_invite"))
        self.assertIsNotNone(letter)
        self.assertNotIn("scene_id", letter.attachment)
        res = accept_scene_invite(letter.id, user=self.user, db=self.db)
        self.assertEqual(self.db.get(Scene, res["scene_id"]).status, "active")

    def test_llm_cannot_invent_fragment_id(self):
        frag = self.fragment("真实片段")
        rec = scene_recommend._parse_recommend(recommend_reply(99999), {frag.id})
        self.assertIsNone(rec["fragment_id"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
