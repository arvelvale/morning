"""晚间来信用户设置：调度挑人 + 偏好接口校验。免启动服务、不调真实 LLM。

运行：cd backend && PYTHONUTF8=1 PYTHONPATH=. .venv/Scripts/python.exe scripts/test_evening_letter_settings.py
（自带临时 SQLite，不碰本机 morning.db；函数同样是 pytest 可收集的 test_*，环境装了 pytest 也能直接跑）

覆盖：
1. 时间匹配：设定时间当分钟命中；前一分钟不命中；窗口末端 +60 分钟命中、+61 不命中；不跨午夜
2. 关闭 → 一封都不生成（generate 根本不被调用）
3. 没有 preference 行 → 默认开启、21:30
4. 补发窗口：重启错过时间点，+30 分钟补发；超过 60 分钟不补
5. 幂等：今天已生成过的不再进入生成流程
6. 沉睡用户仍被 reachable_users 挡掉
7. 每个用户按自己的时间发（21:30 与 22:00 两人，各在各的分钟）
8. 偏好接口：默认值、PATCH 开关/时间、非法时间 422（含 24:00、21:60、非 HH:MM）
9. run_evening_letters_all（手动补跑）跳过已关闭的用户
10. 迁移 022：老用户行升级后 = 开启 + 21:30；downgrade 干净
"""
import os
import sqlite3
import subprocess
import sys
import tempfile
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

TMP = Path(tempfile.mkdtemp(prefix="evening-settings-"))
os.environ["DATABASE_URL"] = f"sqlite:///{(TMP / 't.db').as_posix()}"
os.environ.setdefault("JWT_SECRET", "test-secret-for-evening-0123456789")
sys.path.insert(0, ".")

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import update  # noqa: E402

from app.core.security import create_access_token  # noqa: E402
from app.db import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models.preference import UserPreference  # noqa: E402
from app.models.user import User  # noqa: E402
import app.services.mailbox.evening_letter as ev  # noqa: E402
from app.services.mailbox.letter_store import (  # noqa: E402
    LetterStore, daily_generation_key, local_delivery_date,
)

CST = timezone(timedelta(hours=8))
Base.metadata.create_all(bind=engine)
client = TestClient(app)  # 不进 with → 不跑 lifespan，不启动调度器

DAY = (2026, 10, 21)


def cst(h, m=0, day=DAY):
    return datetime(*day, h, m, tzinfo=CST)


def mk_user(enabled=None, at=None, last_active=None, active=True) -> int:
    """enabled/at 都为 None = 不建 preference 行。"""
    db = SessionLocal()
    u = User(username=f"ev_{uuid.uuid4().hex[:8]}", password_hash="x", is_active=active)
    db.add(u)
    db.commit()
    db.execute(update(User).where(User.id == u.id).values(
        last_active_at=last_active or datetime.now(timezone.utc)))
    if enabled is not None or at is not None:
        kw = {}
        if enabled is not None:
            kw["evening_letter_enabled"] = enabled
        if at is not None:
            kw["evening_letter_time"] = at
        db.add(UserPreference(user_id=u.id, **kw))
    db.commit()
    uid = u.id
    db.close()
    return uid


def isolate():
    """每个用例前停用此前建的所有用户，互不干扰。"""
    db = SessionLocal()
    db.execute(update(User).values(is_active=False))
    db.commit()
    db.close()


def due_ids(now) -> set[int]:
    db = SessionLocal()
    try:
        return {u.id for u in ev.pick_due_evening_users(db, now)}
    finally:
        db.close()


def run_with_fake_generate(fn):
    """把 generate_evening_letter 换成记录调用的假函数，返回 (fn 的结果, 被调用的 user_id 列表)。"""
    calls = []
    orig = ev.generate_evening_letter
    ev.generate_evening_letter = lambda db, user_id: calls.append(user_id)
    try:
        db = SessionLocal()
        try:
            result = fn(db)
        finally:
            db.close()
    finally:
        ev.generate_evening_letter = orig
    return result, calls


def test_time_match_and_window():
    isolate()
    uid = mk_user(True, "21:30", last_active=cst(20))
    assert due_ids(cst(21, 29)) == set(), "前一分钟不命中"
    assert due_ids(cst(21, 30)) == {uid}, "设定时间当分钟命中"
    assert due_ids(cst(22, 30)) == {uid}, "+60 分钟是窗口末端，含端点"
    assert due_ids(cst(22, 31)) == set(), "+61 分钟超出窗口"
    # 秒数不影响：HH:MM 精确到分钟
    assert due_ids(datetime(*DAY, 21, 30, 59, tzinfo=CST)) == {uid}
    # 传 UTC 时间也按东八区换算：21:30 CST = 13:30 UTC
    assert due_ids(datetime(*DAY, 13, 30, tzinfo=timezone.utc)) == {uid}


def test_window_does_not_cross_midnight():
    isolate()
    uid = mk_user(True, "23:30", last_active=cst(20))
    assert due_ids(cst(23, 59)) == {uid}
    next_day = (DAY[0], DAY[1], DAY[2] + 1)
    assert due_ids(cst(0, 10, next_day)) == set(), "跨午夜不补（否则深夜 0 点来信，还会记到新的一天）"


def test_disabled_generates_nothing():
    isolate()
    uid = mk_user(False, "21:30", last_active=cst(20))
    assert due_ids(cst(21, 30)) == set()
    res, calls = run_with_fake_generate(lambda db: ev.run_due_evening_letters(db, cst(21, 30)))
    assert res == []
    assert calls == [], "关闭的用户不能触发任何生成（也就不花模型调用）"
    assert uid not in due_ids(cst(21, 45))


def test_no_preference_row_uses_defaults():
    isolate()
    uid = mk_user(last_active=cst(20))  # 没有 preference 行
    db = SessionLocal()
    assert db.query(UserPreference).filter_by(user_id=uid).count() == 0
    db.close()
    assert due_ids(cst(21, 29)) == set()
    assert due_ids(cst(21, 30)) == {uid}, "无 preference 行 = 开启 + 21:30"
    assert due_ids(cst(21, 31)) == {uid}


def test_catchup_after_restart():
    isolate()
    uid = mk_user(True, "21:30", last_active=cst(20))
    assert due_ids(cst(22, 0)) == {uid}, "重启错过 21:30，22:00 起来仍补发"
    assert due_ids(cst(22, 45)) == set(), "晚了 75 分钟不补"
    late = mk_user(True, "20:00", last_active=cst(19))
    assert late not in due_ids(cst(22, 0)), "两小时前的设定时间不补"


def test_idempotent_after_generated():
    isolate()
    uid = mk_user(True, "21:30", last_active=cst(20))
    now = cst(21, 40)
    assert due_ids(now) == {uid}
    db = SessionLocal()
    LetterStore(db).create_generated(
        user_id=uid,
        generation_key=daily_generation_key("evening_letter", local_delivery_date(now)),
        delivery_date=local_delivery_date(now),
        type="greeting", title="t", body="b", pet_id=None,
    )
    db.close()
    assert due_ids(now) == set(), "今天已生成过 → 不再进入生成流程"
    assert due_ids(cst(21, 41)) == set()


def test_dormant_users_still_skipped():
    isolate()
    asleep = mk_user(True, "21:30", last_active=cst(20) - timedelta(days=30))
    awake = mk_user(True, "21:30", last_active=cst(20))
    assert due_ids(cst(21, 30)) == {awake}
    assert asleep not in due_ids(cst(21, 30))


def test_each_user_has_own_time():
    isolate()
    a = mk_user(True, "21:30", last_active=cst(20))
    b = mk_user(True, "22:00", last_active=cst(20))
    c = mk_user(True, "08:15", last_active=cst(7))
    assert due_ids(cst(21, 30)) == {a}
    assert due_ids(cst(22, 0)) == {a, b}, "a 仍在补发窗口内（30 分钟），b 到点"
    assert due_ids(cst(8, 15)) == {c}


def test_run_due_calls_generate_only_for_due():
    isolate()
    on = mk_user(True, "21:30", last_active=cst(20))
    off = mk_user(False, "21:30", last_active=cst(20))
    later = mk_user(True, "23:00", last_active=cst(20))
    res, calls = run_with_fake_generate(lambda db: ev.run_due_evening_letters(db, cst(21, 30)))
    assert calls == [on] and [r["user_id"] for r in res] == [on]
    assert off not in calls and later not in calls


def test_run_all_skips_disabled():
    isolate()
    # run_all 使用真实当前时间：活跃时间也用当前时间，避免固定日期过去后被误判沉睡。
    on = mk_user(True, "21:30")
    default = mk_user()
    off = mk_user(False, "21:30")
    _, calls = run_with_fake_generate(lambda db: ev.run_evening_letters_all(db))
    assert set(calls) == {on, default} and off not in calls


def test_is_evening_due_bad_time_falls_back_to_default():
    assert ev.is_evening_due("garbage", cst(21, 30))
    assert ev.is_evening_due(None, cst(21, 30))
    assert not ev.is_evening_due("garbage", cst(21, 29))
    assert ev.is_evening_due("00:00", cst(0, 0)) and not ev.is_evening_due("00:00", cst(1, 1))


# ─── 偏好接口 ────────────────────────────────────────────────────────────────
def _auth():
    isolate()
    uid = mk_user(last_active=cst(20))
    return uid, {"Authorization": f"Bearer {create_access_token(uid)}"}


def test_prefs_defaults():
    _, H = _auth()
    r = client.get("/api/v1/preferences", headers=H)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["evening_letter_enabled"] is True and j["evening_letter_time"] == "21:30"


def test_prefs_patch_and_persist():
    _, H = _auth()
    r = client.patch("/api/v1/preferences", headers=H, json={"evening_letter_time": "22:15"})
    assert r.status_code == 200, r.text
    assert r.json()["evening_letter_time"] == "22:15" and r.json()["evening_letter_enabled"] is True
    r = client.patch("/api/v1/preferences", headers=H, json={"evening_letter_enabled": False})
    assert r.status_code == 200 and r.json()["evening_letter_enabled"] is False
    assert r.json()["evening_letter_time"] == "22:15", "关开关不改时间"
    j = client.get("/api/v1/preferences", headers=H).json()
    assert j["evening_letter_enabled"] is False and j["evening_letter_time"] == "22:15"
    # 边界值合法
    for t in ("00:00", "23:59"):
        assert client.patch("/api/v1/preferences", headers=H, json={"evening_letter_time": t}).status_code == 200


def test_prefs_invalid_time_422():
    _, H = _auth()
    for bad in ("24:00", "21:60", "9:30", "21:5", "2130", "21:30:00", "", "ab:cd", "-1:00"):
        r = client.patch("/api/v1/preferences", headers=H, json={"evening_letter_time": bad})
        assert r.status_code == 422, (bad, r.status_code, r.text)
    j = client.get("/api/v1/preferences", headers=H).json()
    assert j["evening_letter_time"] == "21:30", "非法值不落库"


def test_prefs_switch_controls_scheduler():
    uid, H = _auth()
    r = client.patch("/api/v1/preferences", headers=H, json={"evening_letter_enabled": False})
    assert r.status_code == 200 and r.json()["evening_letter_enabled"] is False
    _, calls = run_with_fake_generate(lambda db: ev.run_due_evening_letters(db, cst(21, 30)))
    assert calls == [], "从偏好接口关闭后，调度不调用模型生成"
    r = client.patch("/api/v1/preferences", headers=H, json={"evening_letter_enabled": True})
    assert r.status_code == 200 and r.json()["evening_letter_time"] == "21:30"
    _, calls = run_with_fake_generate(lambda db: ev.run_due_evening_letters(db, cst(21, 30)))
    assert calls == [uid], "重新开启后按原时间恢复调度"


# ─── 迁移 022 ────────────────────────────────────────────────────────────────
def test_migration_022_old_rows_keep_behavior():
    mig_db = (TMP / "mig.db").as_posix()
    env = {**os.environ, "DATABASE_URL": f"sqlite:///{mig_db}", "PYTHONUTF8": "1", "PYTHONPATH": "."}
    alembic = [sys.executable, "-m", "alembic"]
    subprocess.run(alembic + ["upgrade", "021_letter_hidden"], env=env, check=True, capture_output=True)
    con = sqlite3.connect(mig_db)
    cols = {r[1] for r in con.execute("PRAGMA table_info(user_preferences)")}
    assert "evening_letter_enabled" not in cols and "evening_letter_time" not in cols
    con.execute("INSERT INTO users (id, username, password_hash, is_active, created_at, updated_at) "
                "VALUES (1,'old','x',1,'2026-01-01 00:00:00','2026-01-01 00:00:00')")
    # 老用户的偏好行：只填 021 时 NOT NULL 且无默认的列（其余列走 server_default）
    need = {r[1]: r[2] for r in con.execute("PRAGMA table_info(user_preferences)")
            if r[3] and r[4] is None and r[1] != "id"}
    vals = {k: (1 if "INT" in t.upper() or "BOOL" in t.upper() else "2026-01-01 00:00:00" if "DATE" in t.upper() else "x")
            for k, t in need.items()}
    vals["user_id"] = 1
    con.execute(f"INSERT INTO user_preferences ({','.join(vals)}) VALUES ({','.join('?' * len(vals))})",
                list(vals.values()))
    con.commit()
    con.close()
    subprocess.run(alembic + ["upgrade", "head"], env=env, check=True, capture_output=True)
    con = sqlite3.connect(mig_db)
    row = con.execute("SELECT evening_letter_enabled, evening_letter_time FROM user_preferences WHERE user_id=1").fetchone()
    con.close()
    assert row == (1, "21:30"), f"老用户升级后必须仍是 开启 + 21:30，实际 {row}"
    subprocess.run(alembic + ["downgrade", "021_letter_hidden"], env=env, check=True, capture_output=True)
    con = sqlite3.connect(mig_db)
    cols = {r[1] for r in con.execute("PRAGMA table_info(user_preferences)")}
    con.close()
    assert "evening_letter_enabled" not in cols and "evening_letter_time" not in cols


if __name__ == "__main__":
    n = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            n += 1
            print(f"{n:02d}. {name} PASS")
    print(f"ALL PASS ({n})")
