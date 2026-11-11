"""自带密钥（BYOK）+ 文字路由 + 手机触发定时活 + 聊天图片 + 聊天里的场景邀请粗筛。
免启动服务、不调真实模型、不联网。

运行：cd backend && PYTHONUTF8=1 PYTHONPATH=. .venv/Scripts/python.exe scripts/test_byok_and_chat_images.py
（自带临时 SQLite 和临时图片目录，不碰本机 morning.db）
"""
import base64
import os
import sqlite3
import subprocess
import sys
import tempfile
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

TMP = Path(tempfile.mkdtemp(prefix="byok-"))
os.environ["DATABASE_URL"] = f"sqlite:///{(TMP / 't.db').as_posix()}"
os.environ.setdefault("JWT_SECRET", "test-secret-for-byok-0123456789abcdef")
os.environ["CHAT_IMAGE_DIR"] = (TMP / "chat_images").as_posix()
os.environ["STEPFUN_API_KEY"] = "server-stepfun-key-000"
os.environ["DEEPSEEK_API_KEY"] = ""
os.environ["BYOK_REQUIRED"] = "false"
sys.path.insert(0, ".")

import httpx  # noqa: E402
import openai  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from langchain_core.messages import HumanMessage  # noqa: E402
from sqlalchemy import select, update  # noqa: E402

import app.llm as llm  # noqa: E402
import app.routers.companion.conversations as conv_router  # noqa: E402
import app.routers.system.byok as byok  # noqa: E402
import app.services.infra.user_jobs as user_jobs  # noqa: E402
import app.services.scene.scene_recommend as scene_recommend  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.core.security import create_access_token  # noqa: E402
from app.db import Base, SessionLocal, engine  # noqa: E402
from app.graphs import companion  # noqa: E402
from app.llm_keys import (  # noqa: E402
    LLMKeyMissing, RequestKeys, clean_key, current_keys, reset_request_keys, set_request_keys,
)
from app.main import app  # noqa: E402
from app.models.conversation import Message  # noqa: E402
from app.models.job_run import JobRun  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services.companion import chat_images  # noqa: E402
from app.services.infra import engagement  # noqa: E402
from app.services.mailbox import evening_letter as ev  # noqa: E402

CST = timezone(timedelta(hours=8))
Base.metadata.create_all(bind=engine)
client = TestClient(app)  # 不进 with → 不跑 lifespan，不启动调度器
S = get_settings()

USER_STEP = "user-stepfun-key-abcdef"
USER_DS = "user-deepseek-key-abcdef"
# 1×1 像素的 PNG / 最小 JPEG 文件头
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def mk_user(own_key=False, last_active=None, active=True) -> int:
    db = SessionLocal()
    u = User(username=f"byok_{uuid.uuid4().hex[:8]}", password_hash="x", is_active=active)
    db.add(u)
    db.commit()
    db.execute(update(User).where(User.id == u.id).values(
        last_active_at=last_active or datetime.now(timezone.utc), uses_own_key=own_key))
    db.commit()
    uid = u.id
    db.close()
    return uid


def auth(uid: int, **extra) -> dict:
    return {"Authorization": f"Bearer {create_access_token(uid)}", **extra}


class keys:
    """with keys(stepfun=..., deepseek=...): 模拟一次带密钥的请求上下文。"""

    def __init__(self, stepfun=None, deepseek=None):
        self.k = RequestKeys(stepfun=stepfun, deepseek=deepseek)

    def __enter__(self):
        self.token = set_request_keys(self.k)

    def __exit__(self, *a):
        reset_request_keys(self.token)


class settings:
    """with settings(byok_required=True): 临时改配置。"""

    def __init__(self, **kw):
        self.kw = kw

    def __enter__(self):
        self.old = {k: getattr(S, k) for k in self.kw}
        for k, v in self.kw.items():
            setattr(S, k, v)

    def __exit__(self, *a):
        for k, v in self.old.items():
            setattr(S, k, v)


def api_error(status: int):
    req = httpx.Request("POST", "http://upstream.test/v1/chat/completions")
    cls = {429: openai.RateLimitError, 401: openai.AuthenticationError, 400: openai.BadRequestError,
           500: openai.InternalServerError}[status]
    return cls("boom", response=httpx.Response(status, request=req), body=None)


class FakeModel:
    def __init__(self, reply=None, error=None, chunks=None, fail_after=None):
        self.reply, self.error, self.chunks, self.fail_after = reply, error, chunks, fail_after
        self.seen = []

    def invoke(self, messages, **kw):
        self.seen.append(messages)
        if self.error:
            raise self.error
        return self.reply

    def stream(self, messages, **kw):
        self.seen.append(messages)
        if self.error and self.fail_after is None:
            raise self.error
        for i, c in enumerate(self.chunks or []):
            if self.fail_after is not None and i == self.fail_after:
                raise self.error
            yield c


# ─── A. 密钥与路由 ────────────────────────────────────────────────────────────

def test_a01_clean_key():
    assert clean_key("  sk-abcdefgh  ") == "sk-abcdefgh"
    assert clean_key(b"sk-abcdefgh") == "sk-abcdefgh"
    assert clean_key("short") is None, "太短的不算"
    assert clean_key("a" * 257) is None, "太长的不算"
    assert clean_key("sk-abc def-ghi") is None, "含空格的不算"
    assert clean_key("密钥密钥密钥密钥密钥") is None, "非 ASCII 的不算"
    assert clean_key(None) is None
    assert "user-stepfun" not in repr(RequestKeys(stepfun=USER_STEP)), "repr 不能带出密钥"


def test_a02_routes_follow_keys():
    # 没带 key：用服务端的阶跃 key；服务端没配 DeepSeek 就只有一条路
    m = llm.get_chat_model()
    assert m.providers == ["stepfun"]
    assert m.routes[0][1].openai_api_key.get_secret_value() == "server-stepfun-key-000"
    assert m.routes[0][1].max_retries == llm.DEFAULT_MAX_RETRIES, "没有备用路由时多重试"

    with settings(deepseek_api_key="server-ds-key-000"):
        m = llm.get_chat_model()
        assert m.providers == ["stepfun", "deepseek"]
        assert m.routes[0][1].max_retries == llm.RETRIES_WITH_FALLBACK, "有备用路由时尽快换路"
        assert m.routes[1][1].model_name == S.deepseek_model
        # 用户带了自己的阶跃 key：只用用户的，服务端的 DeepSeek 不能被顺手用上
        with keys(stepfun=USER_STEP):
            m = llm.get_chat_model()
            assert m.providers == ["stepfun"]
            assert m.routes[0][1].openai_api_key.get_secret_value() == USER_STEP

    with keys(stepfun=USER_STEP, deepseek=USER_DS):
        m = llm.get_chat_model()
        assert m.providers == ["stepfun", "deepseek"]
        assert m.routes[1][1].openai_api_key.get_secret_value() == USER_DS
    with keys(deepseek=USER_DS):
        assert llm.get_chat_model().providers == ["deepseek"], "只带 DeepSeek 时文字走 DeepSeek"


def test_a03_byok_required_refuses_server_key():
    with settings(byok_required=True):
        try:
            llm.get_chat_model()
            raise AssertionError("必须自带时，没带 key 不能用服务端的")
        except LLMKeyMissing:
            pass
        with keys(stepfun=USER_STEP):
            assert llm.get_chat_model().providers == ["stepfun"]


def test_a04_deepseek_drops_unsupported_params():
    with keys(stepfun=USER_STEP, deepseek=USER_DS):
        m = llm.get_chat_model(temperature=0.1, timeout=8, max_retries=0, reasoning_effort="low")
    step, ds = m.routes[0][1], m.routes[1][1]
    assert step.reasoning_effort == "low" and ds.reasoning_effort is None
    assert step.max_retries == 0 and ds.max_retries == 0, "调用方显式给的重试次数两条路都照办"
    assert step.temperature == 0.1 and ds.temperature == 0.1


def test_a05_invoke_fallback_rules():
    ok = FakeModel(reply="from-deepseek")
    for status in (429, 401, 500):
        primary = FakeModel(error=api_error(status))
        assert llm.RoutedChatModel([("stepfun", primary), ("deepseek", ok)]).invoke(["hi"]) == "from-deepseek"
    conn = FakeModel(error=openai.APIConnectionError(request=httpx.Request("POST", "http://x")))
    assert llm.RoutedChatModel([("stepfun", conn), ("deepseek", ok)]).invoke(["hi"]) == "from-deepseek"

    # 请求本身有问题（400）：不换路
    bad = FakeModel(error=api_error(400))
    spare = FakeModel(reply="x")
    try:
        llm.RoutedChatModel([("stepfun", bad), ("deepseek", spare)]).invoke(["hi"])
        raise AssertionError("400 不该换路")
    except openai.BadRequestError:
        assert spare.seen == []
    # 只有一条路：原样抛
    try:
        llm.RoutedChatModel([("stepfun", FakeModel(error=api_error(429)))]).invoke(["hi"])
        raise AssertionError
    except openai.RateLimitError:
        pass
    # 两条路都失败：抛最后一条路的错
    try:
        llm.RoutedChatModel([("stepfun", FakeModel(error=api_error(429))),
                             ("deepseek", FakeModel(error=api_error(500)))]).invoke(["hi"])
        raise AssertionError
    except openai.InternalServerError:
        pass


def test_a06_stream_fallback_only_before_first_token():
    ok = FakeModel(chunks=["d1", "d2"])
    first_fail = FakeModel(error=api_error(429))
    assert list(llm.RoutedChatModel([("stepfun", first_fail), ("deepseek", ok)]).stream(["hi"])) == ["d1", "d2"]

    # 吐了一个字之后才断：不能接上另一个模型的话
    mid_fail = FakeModel(chunks=["s1", "s2"], error=api_error(500), fail_after=1)
    spare = FakeModel(chunks=["d1"])
    got = []
    try:
        for c in llm.RoutedChatModel([("stepfun", mid_fail), ("deepseek", spare)]).stream(["hi"]):
            got.append(c)
        raise AssertionError("中途断了应该抛错")
    except openai.InternalServerError:
        assert got == ["s1"] and spare.seen == []


def test_a07_images_stripped_for_deepseek():
    img = {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAAA"}}
    msgs = [HumanMessage(content=[{"type": "text", "text": "看这张"}, img]),
            {"role": "user", "content": [img]},
            HumanMessage(content="纯文字")]
    ds = FakeModel(reply="ok")
    llm.RoutedChatModel([("stepfun", FakeModel(error=api_error(429))), ("deepseek", ds)]).invoke(msgs)
    sent = ds.seen[0]
    assert sent[0].content == "看这张\n" + llm.IMAGE_PLACEHOLDER
    assert sent[1]["content"] == llm.IMAGE_PLACEHOLDER
    assert sent[2].content == "纯文字"
    assert "AAAA" not in str(sent), "图片数据不能发给看不了图的模型"
    assert isinstance(msgs[0].content, list), "不能改调用方手里的原消息"
    # 阶跃那条路拿到的是原样（带图片）
    step = FakeModel(reply="ok")
    llm.RoutedChatModel([("stepfun", step)]).invoke(msgs)
    assert step.seen[0] is msgs


def test_a08_auth_header_uses_request_key():
    assert S.auth_header == {"Authorization": "Bearer server-stepfun-key-000"}
    with keys(stepfun=USER_STEP):
        assert S.auth_header == {"Authorization": f"Bearer {USER_STEP}"}
    with keys(deepseek=USER_DS):  # 只带了 DeepSeek：语音 / 生图这些阶跃专属能力不能偷用服务端的 key
        try:
            S.auth_header
            raise AssertionError
        except LLMKeyMissing as e:
            assert e.provider == "stepfun"
    with settings(byok_required=True):
        try:
            S.auth_header
            raise AssertionError
        except LLMKeyMissing:
            pass


def test_a09_middleware_and_key_test_endpoint():
    uid = mk_user()
    seen = []
    old = byok._probe
    byok._probe = lambda base, key: (seen.append((base, key)) or {"ok": True, "reason": None})
    try:
        r = client.post("/api/v1/ai/keys/test", headers=auth(uid))
        assert r.status_code == 200
        assert r.json() == {"stepfun": {"provided": False, "ok": False, "reason": None},
                            "deepseek": {"provided": False, "ok": False, "reason": None}}
        assert seen == [], "没带 key 就不去探测，更不能拿服务端的 key 去探"

        r = client.post("/api/v1/ai/keys/test",
                        headers=auth(uid, **{"X-Stepfun-Key": USER_STEP, "X-Deepseek-Key": USER_DS}))
        body = r.json()
        assert body["stepfun"] == {"provided": True, "ok": True, "reason": None}
        assert body["deepseek"]["provided"] is True
        assert seen == [(S.stepfun_base_url, USER_STEP), (S.deepseek_base_url, USER_DS)]
        assert USER_STEP not in r.text and USER_DS not in r.text, "响应里不能回显密钥"
    finally:
        byok._probe = old
    assert not current_keys().any, "请求结束后上下文里的密钥要清掉"
    assert client.post("/api/v1/ai/keys/test").status_code == 401, "要登录"


def test_a10_policy_and_missing_key_response():
    uid = mk_user()
    r = client.get("/api/v1/ai/keys/policy", headers=auth(uid)).json()
    assert r["byok_required"] is False and r["server_key_available"] is True
    with settings(byok_required=True):
        r = client.get("/api/v1/ai/keys/policy", headers=auth(uid)).json()
        assert r["byok_required"] is True and r["server_key_available"] is False


# ─── B. 定时活：服务端跑谁、手机触发跑谁 ─────────────────────────────────────

def test_b01_reachable_users_scope():
    normal, own = mk_user(), mk_user(own_key=True)
    stale = mk_user(own_key=True, last_active=datetime.now(timezone.utc) - timedelta(days=30))
    db = SessionLocal()
    try:
        ids = {u.id for u in engagement.reachable_users(db, "t")}
        assert normal in ids and own not in ids, "服务端定时器不为自带密钥的人跑"
        with engagement.user_job_scope(own):
            assert [u.id for u in engagement.reachable_users(db, "t")] == [own]
        with engagement.user_job_scope(stale):
            assert engagement.reachable_users(db, "t") == [], "手机触发也受沉睡规则约束"
        with settings(byok_required=True):
            assert engagement.reachable_users(db, "t") == [], "必须自带时服务端定时器不为任何人跑"
            with engagement.user_job_scope(own):
                assert [u.id for u in engagement.reachable_users(db, "t")] == [own]
        assert engagement.scoped_user_id() is None
    finally:
        db.close()
    assert engagement.counts_as_open("POST", "/api/v1/tick") is False, "手机后台触发不算「打开了 App」"


def test_b02_evening_window_until_midnight_for_phone():
    at = "21:30"
    late = datetime(2026, 10, 21, 23, 40, tzinfo=CST)
    assert ev.is_evening_due(at, late) is False, "服务端：超过 60 分钟不补"
    assert ev.is_evening_due(at, late, until_midnight=True) is True, "手机触发：当天之内都补"
    assert ev.is_evening_due(at, datetime(2026, 10, 21, 21, 29, tzinfo=CST), until_midnight=True) is False
    assert ev.is_evening_due(at, datetime(2026, 10, 22, 0, 5, tzinfo=CST), until_midnight=True) is False, "不跨午夜"


def test_b03_due_jobs_by_time():
    wed_morning = datetime(2026, 10, 21, 7, 0, tzinfo=CST)
    assert user_jobs.due_jobs(wed_morning) == ["evening_letter", "bedtime_reminder", "signal_tick"]
    wed_noon = datetime(2026, 10, 21, 12, 0, tzinfo=CST)
    assert user_jobs.due_jobs(wed_noon) == [
        "evening_letter", "bedtime_reminder", "signal_tick", "dreaming", "scene_recommend"]
    assert "signal_tick" not in user_jobs.due_jobs(wed_noon, signal_ok=False)
    sun_evening = datetime(2026, 10, 25, 20, 5, tzinfo=CST)
    assert "weekly_report" in user_jobs.due_jobs(sun_evening)
    assert "weekly_report" not in user_jobs.due_jobs(datetime(2026, 10, 25, 19, 59, tzinfo=CST))
    with settings(dreaming_enabled=False, proactive_enabled=False):
        assert user_jobs.due_jobs(wed_noon) == ["evening_letter", "bedtime_reminder", "scene_recommend"]


def test_b04_run_user_jobs_scoped_once_per_day_and_cooldown():
    import app.graphs.dreaming as dreaming
    import app.services.mailbox.bedtime_reminder as bedtime
    import app.services.mailbox.weekly_report as weekly
    import app.services.signals.runner as runner

    uid = mk_user(own_key=True)
    calls = []

    def rec(name, result=None):
        def fn(db, *a):
            calls.append((name, engagement.scoped_user_id(), current_keys().stepfun))
            return [] if result is None else result
        return fn

    saved = (ev.run_due_evening_letters, bedtime.run_due_bedtime_reminders, weekly.run_weekly_reports_all,
             runner.run_tick_all, dreaming.run_dreaming_all, scene_recommend.run_scene_recommend_all)
    ev.run_due_evening_letters = rec("evening")
    bedtime.run_due_bedtime_reminders = rec("bedtime")
    weekly.run_weekly_reports_all = rec("weekly")
    runner.run_tick_all = rec("signals")
    dreaming.run_dreaming_all = rec("dream", [{"status": "ok"}])
    scene_recommend.run_scene_recommend_all = rec("scene", [{"recommended": False}])
    noon = datetime(2026, 10, 21, 12, 0, tzinfo=CST)
    try:
        with keys(stepfun=USER_STEP):
            out = user_jobs.run_user_jobs(uid, noon)
        assert [c[0] for c in calls] == ["evening", "bedtime", "signals", "dream", "scene"], calls
        assert all(c[1] == uid and c[2] == USER_STEP for c in calls), "每个任务都只为这个人跑、用他带来的 key"
        assert out["dreaming"] == "ran"

        # 同一天再触发：做梦、场景推荐不重复；主动问候 5 分钟内不重复
        calls.clear()
        with keys(stepfun=USER_STEP):
            out = user_jobs.run_user_jobs(uid, noon + timedelta(minutes=1))
        assert [c[0] for c in calls] == ["evening", "bedtime"], calls
        assert "dreaming" not in out and "signal_tick" not in out

        # 第二天做梦整体失败 → 让出位置并进入冷却；冷却内不重试，冷却过了再试
        dreaming.run_dreaming_all = rec("dream", [{"status": "error", "error": "x"}])
        ev.run_due_evening_letters = rec("evening", [{"sent": False}])
        calls.clear()
        next_day = noon + timedelta(days=1)
        with keys(stepfun=USER_STEP):
            out = user_jobs.run_user_jobs(uid, next_day)
        assert out["dreaming"] == "failed" and out["evening_letter"] == "failed"
        db = SessionLocal()
        left = db.scalars(select(JobRun.period).where(JobRun.user_id == uid, JobRun.job == "dreaming")).all()
        db.close()
        assert left == ["2026-10-21"], f"失败的那天不能占着位置：{left}"
        calls.clear()
        with keys(stepfun=USER_STEP):
            out = user_jobs.run_user_jobs(uid, next_day + timedelta(minutes=1))
        assert out["dreaming"] == "cooldown" and out["evening_letter"] == "cooldown"
        assert "dream" not in [c[0] for c in calls] and "evening" not in [c[0] for c in calls]
        for k in list(user_jobs._cooldown_until):
            user_jobs._cooldown_until[k] = 0.0
        dreaming.run_dreaming_all = rec("dream", [{"status": "ok"}])
        with keys(stepfun=USER_STEP):
            out = user_jobs.run_user_jobs(uid, next_day + timedelta(minutes=20))
        assert out["dreaming"] == "ran"
    finally:
        (ev.run_due_evening_letters, bedtime.run_due_bedtime_reminders, weekly.run_weekly_reports_all,
         runner.run_tick_all, dreaming.run_dreaming_all, scene_recommend.run_scene_recommend_all) = saved
        user_jobs._cooldown_until.clear()
        user_jobs._last_signal_tick.clear()
    assert uid not in user_jobs._running


def test_b05_tick_endpoint_needs_key_and_marks_user():
    uid = mk_user()
    ran = []
    old = byok.run_user_jobs
    byok.run_user_jobs = lambda user_id: ran.append((user_id, current_keys().stepfun, current_keys().deepseek))
    try:
        r = client.post("/api/v1/tick", headers=auth(uid))
        assert r.json() == {"accepted": False, "reason": "no_key"} and ran == [], "没带 key 绝不替他跑"
        db = SessionLocal()
        assert db.get(User, uid).uses_own_key is False
        db.close()

        r = client.post("/api/v1/tick", headers=auth(uid, **{"X-Stepfun-Key": USER_STEP}))
        assert r.json() == {"accepted": True}
        assert ran == [(uid, USER_STEP, None)], "响应之后的后台任务里也要读得到这次请求带的 key"
        db = SessionLocal()
        assert db.get(User, uid).uses_own_key is True, "带着 key 来触发，标记自动补上"
        db.close()

        assert client.put("/api/v1/users/me/own-key", json={"enabled": False}, headers=auth(uid)).json() == {
            "uses_own_key": False}
        db = SessionLocal()
        assert db.get(User, uid).uses_own_key is False
        db.close()
        assert client.post("/api/v1/tick").status_code == 401
    finally:
        byok.run_user_jobs = old


# ─── C. 聊天里的场景邀请：关键词粗筛 ─────────────────────────────────────────

def test_c01_scene_intent_gate():
    for yes in ("如果当时我没有摔门就好了", "我想对他说声对不起", "想把那天的事重演一遍", "有句话一直没说出口",
                "帮我预演一下明天的面试"):
        assert scene_recommend.has_chat_intent_cue(yes), yes
    for no in ("今天午饭吃了红烧肉", "明天下午三点要交报告", "最近有点累，不想说话"):
        assert not scene_recommend.has_chat_intent_cue(no), no

    called = []
    old = scene_recommend.get_chat_model

    class M:
        def invoke(self, messages):
            called.append(1)

            class R:
                content = '{"worth": false}'
            return R()

    scene_recommend.get_chat_model = lambda *a, **k: M()
    try:
        assert scene_recommend.detect_scene_intent("今天午饭吃了红烧肉，味道不错", gated=True) is None
        assert called == [], "没有线索的聊天消息不能花一次模型调用"
        scene_recommend.detect_scene_intent("如果当时我没有摔门就好了", gated=True)
        assert called == [1]
        scene_recommend.detect_scene_intent("今天午饭吃了红烧肉，味道不错")  # 通话：照旧每句都判
        assert called == [1, 1]

        uid = mk_user()
        r = client.post("/api/v1/scenes/detect-intent", headers=auth(uid),
                        json={"text": "今天午饭吃了红烧肉，味道不错", "source": "chat"})
        assert r.status_code == 200 and r.json() == {"worth": False} and called == [1, 1]
        assert client.post("/api/v1/scenes/detect-intent", headers=auth(uid),
                           json={"text": "x", "source": "nope"}).status_code == 422
    finally:
        scene_recommend.get_chat_model = old


# ─── D. 聊天图片 ─────────────────────────────────────────────────────────────

def test_d01_decode_images_rules():
    ok = chat_images.decode_images([(b64(PNG), "image/png"), ("data:image/jpeg;base64," + b64(JPEG), None)])
    assert [m for _, m in ok] == ["image/png", "image/jpeg"]
    for items, why in (
        ([(b64(PNG), None)] * 4, "超过 3 张"),
        ([(b64(b"GIF89a" + b"\x00" * 32), "image/gif")], "不支持的格式"),
        ([("not-base64!!", None)], "不是合法 base64"),
        ([("", None)], "空图片"),
        ([(b64(PNG), "image/jpeg")], "声明的类型和内容对不上"),
        ([(b64(b"\xff\xd8\xff" + b"\x00" * (chat_images.MAX_IMAGE_BYTES + 1)), None)], "太大"),
    ):
        try:
            chat_images.decode_images(items)
            raise AssertionError(f"应该拒收：{why}")
        except chat_images.ImageRejected:
            pass
    assert chat_images.image_path(1, "../../etc/passwd") is None, "文件名不合规一律不读"
    assert chat_images.image_path(1, "a" * 32 + ".jpg") is None, "文件不存在"


def _conv(uid: int, mode="free_chat") -> int:
    r = client.post("/api/v1/conversations", json={"mode": mode}, headers=auth(uid))
    assert r.status_code == 201, r.text
    return r.json()["id"]


class patched_chat:
    """把聊天依赖的模型调用、记忆抽取、待办识别换成记录用的假实现。"""

    def __enter__(self):
        self.histories, self.captured = [], []
        self.saved = (conv_router.run_companion, conv_router.stream_companion,
                      conv_router.capture_best_effort, conv_router.capture_chat_todos)
        conv_router.run_companion = lambda mode, history, frag, **ctx: (self.histories.append(history) or "看到啦")
        conv_router.stream_companion = lambda mode, history, frag, **ctx: (
            self.histories.append(history) or iter(["看", "到啦"]))
        conv_router.capture_best_effort = lambda **kw: self.captured.append(kw)
        conv_router.capture_chat_todos = lambda user_id, text: []
        return self

    def __exit__(self, *a):
        (conv_router.run_companion, conv_router.stream_companion,
         conv_router.capture_best_effort, conv_router.capture_chat_todos) = self.saved


def test_d02_send_image_message_and_read_back():
    uid, other = mk_user(), mk_user()
    cid = _conv(uid)
    with patched_chat() as p:
        r = client.post(f"/api/v1/conversations/{cid}/messages", headers=auth(uid),
                        json={"text": "", "images": [{"data": b64(PNG), "mime": "image/png"}]})
        assert r.status_code == 200, r.text
        last = p.histories[-1][-1]
        assert last["role"] == "user" and last["images"] == ["data:image/png;base64," + b64(PNG)]
        assert "attachments" not in last
        assert p.captured == [], "只发图片：没有文字可抽取，图片内容不进记忆"

        r = client.post(f"/api/v1/conversations/{cid}/messages", headers=auth(uid),
                        json={"text": "这是我家的猫", "images": [{"data": b64(JPEG)}]})
        assert r.status_code == 200
        assert len(p.captured) == 1 and p.captured[0]["text"] == "这是我家的猫"
        assert b64(JPEG) not in str(p.captured), "交给记忆抽取的只有文字，不能带图片数据"

    detail = client.get(f"/api/v1/conversations/{cid}", headers=auth(uid)).json()
    users = [m for m in detail["messages"] if m["role"] == "user"]
    assert detail["title"] == "[图片]", detail["title"]
    assert len(users[0]["images"]) == 1 and len(users[1]["images"]) == 1
    assert [m["images"] for m in detail["messages"] if m["role"] == "assistant"] == [[], []]

    url = users[0]["images"][0]
    r = client.get(url, headers=auth(uid))
    assert r.status_code == 200 and r.content == PNG and r.headers["content-type"] == "image/png"
    assert "private" in r.headers["cache-control"]
    assert client.get(url).status_code == 401, "读图要登录"
    assert client.get(url, headers=auth(other)).status_code == 404, "别人的图读不到"
    assert client.get(url.rsplit("/", 1)[0] + "/9", headers=auth(uid)).status_code == 404

    files = list((TMP / "chat_images" / str(uid)).iterdir())
    assert len(files) == 2
    assert client.delete(f"/api/v1/conversations/{cid}", headers=auth(uid)).status_code == 204
    assert list((TMP / "chat_images" / str(uid)).iterdir()) == [], "删会话要把图片文件一起删掉"


def test_d03_stream_with_image():
    uid = mk_user()
    cid = _conv(uid)
    with patched_chat() as p:
        r = client.post(f"/api/v1/conversations/{cid}/messages?stream=true", headers=auth(uid),
                        json={"text": "看看这个", "images": [{"data": b64(PNG)}]})
        assert r.status_code == 200 and "event: done" in r.text and "看到啦" in r.text
        assert p.histories[-1][-1]["images"], "流式路径同样把图片交给模型"
        assert p.histories[-1][-1]["content"] == "看看这个"
        assert len(p.captured) == 1 and p.captured[0]["text"] == "看看这个"


def test_d04_rejections():
    uid = mk_user()
    cid = _conv(uid)
    call = _conv(uid, mode="voice_call")
    with patched_chat() as p:
        post = lambda c, body: client.post(f"/api/v1/conversations/{c}/messages", headers=auth(uid), json=body)  # noqa: E731
        assert post(cid, {"text": "  "}).status_code == 422, "没字也没图"
        r = post(cid, {"text": "x", "images": [{"data": b64(b"GIF89a" + b"\x00" * 32)}]})
        assert r.status_code == 422 and "JPG" in r.json()["detail"]
        assert post(cid, {"text": "x", "images": [{"data": b64(PNG)}] * 4}).status_code == 422
        assert post(call, {"text": "x", "images": [{"data": b64(PNG)}]}).status_code == 422, "通话里不能发图"
        assert p.histories == [], "被拒的请求不能走到模型"
    db = SessionLocal()
    assert db.scalars(select(Message).where(Message.conversation_id.in_([cid, call]))).all() == [], "被拒的不落库"
    db.close()
    assert not (TMP / "chat_images" / str(uid)).exists() or not list((TMP / "chat_images" / str(uid)).iterdir())
    # 老客户端：只发文字，行为不变
    with patched_chat() as p:
        r = client.post(f"/api/v1/conversations/{cid}/messages", headers=auth(uid), json={"text": "你好"})
        assert r.status_code == 200 and r.json()["reply"]["images"] == []
        assert "images" not in p.histories[-1][-1]


def test_d05_only_recent_images_resent():
    uid = mk_user()
    saved = chat_images.save_images(uid, [(PNG, "image/png")] * 3)
    history = [
        {"role": "user", "content": "第一张", "attachments": [saved[0]]},
        {"role": "assistant", "content": "嗯"},
        {"role": "user", "content": "", "attachments": [saved[1]]},
        {"role": "user", "content": "第三张", "attachments": [saved[2]]},
    ]
    conv_router._attach_images_for_model(uid, history)
    assert "images" not in history[0] and history[0]["content"] == "第一张\n" + conv_router.OLD_IMAGE_NOTE
    assert len(history[2]["images"]) == 1 and len(history[3]["images"]) == 1
    assert all("attachments" not in m for m in history)
    # 文件已经不在了的图片：当作没有，不报错
    chat_images.delete_images(uid, saved)
    gone = [{"role": "user", "content": "x", "attachments": [saved[2]]}]
    conv_router._attach_images_for_model(uid, gone)
    assert "images" not in gone[0] and conv_router.OLD_IMAGE_NOTE in gone[0]["content"]


def test_d06_build_messages_multimodal():
    url = "data:image/png;base64," + b64(PNG)
    msgs = companion._build_messages("free_chat", [
        {"role": "user", "content": "看这张", "images": [url]},
        {"role": "assistant", "content": "好看"},
        {"role": "user", "content": "", "images": [url]},
    ])
    assert "用户这次发了图片" in msgs[0].content
    assert msgs[1].content == [{"type": "text", "text": "看这张"},
                               {"type": "image_url", "image_url": {"url": url}}]
    assert msgs[3].content == [{"type": "image_url", "image_url": {"url": url}}], "没有文字时不塞空文字块"
    plain = companion._build_messages("free_chat", [{"role": "user", "content": "你好"}])
    assert "发了图片" not in plain[0].content and plain[1].content == "你好"


# ─── E. 迁移 023 ─────────────────────────────────────────────────────────────

def test_e01_migration_023():
    mig_db = (TMP / "mig.db").as_posix()
    env = {**os.environ, "DATABASE_URL": f"sqlite:///{mig_db}", "PYTHONUTF8": "1", "PYTHONPATH": "."}
    alembic = [sys.executable, "-m", "alembic"]
    subprocess.run(alembic + ["upgrade", "022_evening_letter_pref"], env=env, check=True, capture_output=True)
    con = sqlite3.connect(mig_db)
    con.execute("INSERT INTO users (id, username, password_hash, is_active, created_at, updated_at) "
                "VALUES (1,'old','x',1,'2026-01-01 00:00:00','2026-01-01 00:00:00')")
    con.execute("INSERT INTO conversations (id, user_id, mode, created_at, updated_at) "
                "VALUES (1,1,'free_chat','2026-01-01 00:00:00','2026-01-01 00:00:00')")
    con.execute("INSERT INTO conversation_messages (id, conversation_id, role, content, created_at) "
                "VALUES (1,1,'user','老消息','2026-01-01 00:00:00')")
    con.commit()
    con.close()
    subprocess.run(alembic + ["upgrade", "head"], env=env, check=True, capture_output=True)
    con = sqlite3.connect(mig_db)
    assert con.execute("SELECT uses_own_key FROM users WHERE id=1").fetchone() == (0,), "老用户默认不是自带密钥"
    assert con.execute("SELECT attachments FROM conversation_messages WHERE id=1").fetchone() == (None,)
    assert "job_runs" in {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    con.close()
    head = subprocess.run(alembic + ["heads"], env=env, check=True, capture_output=True, text=True).stdout
    assert head.count("(head)") == 1, head
    subprocess.run(alembic + ["downgrade", "022_evening_letter_pref"], env=env, check=True, capture_output=True)
    con = sqlite3.connect(mig_db)
    assert "uses_own_key" not in {r[1] for r in con.execute("PRAGMA table_info(users)")}
    assert "attachments" not in {r[1] for r in con.execute("PRAGMA table_info(conversation_messages)")}
    assert "job_runs" not in {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    con.close()


if __name__ == "__main__":
    n = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            n += 1
            print(f"{n:02d}. {name} PASS")
    print(f"ALL PASS ({n})")
