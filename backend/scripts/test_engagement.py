"""沉睡用户停发：活跃度记录 + 六个定时任务的用户筛选 + 迁移回填。免启动服务、不调真实 LLM。

运行：cd backend && PYTHONUTF8=1 PYTHONPATH=. .venv/Scripts/python.exe scripts/test_engagement.py
（自带临时 SQLite，不碰本机 morning.db）

覆盖：
1. 后台请求（来信轮询/位置/信号样本）不算打开，其它请求算；GET /letters/{id} 算
2. 边界：N=3，周一打开过 → 周四照发、周五停；周二 00:00 打开 → 周五照发
3. 节流：10 分钟内只写一次库
4. reachable_users：沉睡/停用账号排除，last_active_at 为空保留，N<=0 关闭规则
5. HTTP：轮询不刷新活跃时间；/users/me 与 POST /users/me/active 刷新
6. 六个定时任务都只对未沉睡用户调生成函数
7. 迁移 020：回填 = 最后一条用户消息，没聊过用注册时间
"""
import os
import subprocess
import sys
import tempfile
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

TMP = Path(tempfile.mkdtemp(prefix="engagement-"))
os.environ["DATABASE_URL"] = f"sqlite:///{(TMP / 't.db').as_posix()}"
os.environ.setdefault("JWT_SECRET", "test-secret-for-engagement-0123456789")
sys.path.insert(0, ".")

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import update  # noqa: E402

from app.core.security import create_access_token  # noqa: E402
from app.db import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services.infra import engagement as eg  # noqa: E402

CST = timezone(timedelta(hours=8))
PASS = 0


def ok(name: str) -> None:
    global PASS
    PASS += 1
    print(f"{PASS:02d}. {name} PASS")


def cst(y, mo, d, h=0, mi=0):
    return datetime(y, mo, d, h, mi, tzinfo=CST)


Base.metadata.create_all(bind=engine)


def mk_user(last_active: datetime | None, active: bool = True) -> int:
    db = SessionLocal()
    u = User(username=f"eg_{uuid.uuid4().hex[:8]}", password_hash="x", is_active=active)
    db.add(u)
    db.commit()
    db.execute(update(User).where(User.id == u.id).values(last_active_at=last_active))
    db.commit()
    uid = u.id
    db.close()
    return uid


def last_active(uid: int):
    db = SessionLocal()
    try:
        v = db.get(User, uid).last_active_at
        return eg._as_utc(v) if v else None
    finally:
        db.close()


# ─── 1. 什么算打开 ────────────────────────────────────────────────────────────
assert not eg.counts_as_open("GET", "/api/v1/letters")
assert not eg.counts_as_open("get", "/api/v1/letters/")
assert not eg.counts_as_open("POST", "/api/v1/preferences/location")
assert not eg.counts_as_open("POST", "/api/v1/signals/motion")
assert eg.counts_as_open("GET", "/api/v1/letters/42"), "点开某封信是用户动作"
assert eg.counts_as_open("GET", "/api/v1/pets/active")
assert eg.counts_as_open("POST", "/api/v1/users/me/active")
ok("后台请求不算打开，其它请求算")

# ─── 2. 边界（2026-10-12 是周一）────────────────────────────────────────────
mon_late = cst(2026, 10, 12, 23, 59)
tue_0000 = cst(2026, 10, 13, 0, 0)
thu = cst(2026, 10, 15, 21, 30)
fri = cst(2026, 10, 16, 21, 30)
U = lambda t: SimpleUser(t)  # noqa: E731


class SimpleUser:
    def __init__(self, t):
        self.last_active_at = t


assert not eg.is_dormant(U(mon_late), now=thu, days=3), "周一打开 → 周四（第 3 个没打开的日子）照发"
assert eg.is_dormant(U(mon_late), now=fri, days=3), "周一打开 → 周五停"
assert not eg.is_dormant(U(tue_0000), now=fri, days=3), "周二 00:00 打开 → 周五照发"
assert not eg.is_dormant(U(None), now=fri, days=3), "空值按活跃"
# naive（SQLite 读回）按 UTC 解读：周一 23:59 CST = 周一 15:59 UTC
assert eg.is_dormant(U(mon_late.astimezone(timezone.utc).replace(tzinfo=None)), now=fri, days=3)
ok("N=3：连续 3 天没打开，第 4 天起停发；naive 时间按 UTC")

# ─── 3. 节流 ─────────────────────────────────────────────────────────────────
t0 = datetime(2026, 10, 14, 2, 0, tzinfo=timezone.utc)
uid = mk_user(t0 - timedelta(days=5))
db = SessionLocal()
u = db.get(User, uid)
assert eg.touch_last_active(u, now=t0) is True and last_active(uid) == t0
db.refresh(u)
assert eg.touch_last_active(u, now=t0 + timedelta(minutes=9)) is False
assert last_active(uid) == t0
db.refresh(u)
assert eg.touch_last_active(u, now=t0 + timedelta(minutes=11)) is True
assert last_active(uid) == t0 + timedelta(minutes=11)
db.close()
ok("节流：10 分钟内只写一次")

# ─── 4. reachable_users ─────────────────────────────────────────────────────
db = SessionLocal()
db.execute(update(User).values(is_active=False))  # 隔离前面建的用户
db.commit()
db.close()
now = fri
fresh = mk_user(cst(2026, 10, 15, 8))
asleep = mk_user(cst(2026, 10, 1, 8))
unknown = mk_user(None)
disabled = mk_user(cst(2026, 10, 16, 8), active=False)
db = SessionLocal()
ids = {u.id for u in eg.reachable_users(db, "test", now=now)}
assert ids == {fresh, unknown}, ids
settings = eg.get_settings()
orig_days = settings.dormant_after_days
settings.dormant_after_days = 0
assert {u.id for u in eg.reachable_users(db, "test", now=now)} == {fresh, unknown, asleep}
settings.dormant_after_days = orig_days
db.close()
ok("reachable_users：排除沉睡与停用，空值保留，N<=0 关闭")

# ─── 5. HTTP ─────────────────────────────────────────────────────────────────
client = TestClient(app)  # 不进 with → 不跑 lifespan，不启动调度器
long_ago = datetime.now(timezone.utc) - timedelta(days=30)
uid = mk_user(long_ago)
db = SessionLocal()
db.execute(update(User).where(User.id == uid).values(is_active=True))
db.commit()
db.close()
H = {"Authorization": f"Bearer {create_access_token(uid)}"}
r = client.get("/api/v1/letters?unread=true&limit=20", headers=H)
assert r.status_code == 200, r.text
assert abs((last_active(uid) - long_ago).total_seconds()) < 1, "轮询不能刷新活跃时间"
r = client.post("/api/v1/users/me/active", headers=H)
assert r.status_code == 204, r.text
assert (datetime.now(timezone.utc) - last_active(uid)).total_seconds() < 60
assert client.post("/api/v1/users/me/active").status_code in (401, 403), "必须带凭证"
ok("HTTP：轮询不算，POST /users/me/active 刷新")

uid2 = mk_user(long_ago)
H2 = {"Authorization": f"Bearer {create_access_token(uid2)}"}
assert client.get("/api/v1/users/me", headers=H2).status_code == 200
assert (datetime.now(timezone.utc) - last_active(uid2)).total_seconds() < 60
ok("旧客户端：任一业务请求（/users/me）即算打开")

# ─── 6. 六个定时任务 ──────────────────────────────────────────────────────────
db = SessionLocal()
db.execute(update(User).values(is_active=False))
db.commit()
db.close()
real_now = datetime.now(timezone.utc)
awake = mk_user(real_now - timedelta(hours=2))
sleeping = mk_user(real_now - timedelta(days=10))

import app.graphs.dreaming as dreaming  # noqa: E402
import app.services.mailbox.bedtime_reminder as bedtime  # noqa: E402
import app.services.mailbox.evening_letter as evening  # noqa: E402
import app.services.mailbox.weekly_report as weekly  # noqa: E402
import app.services.scene.scene_recommend as scene_rec  # noqa: E402
import app.services.signals.runner as runner  # noqa: E402

called: dict[str, set[int]] = {}


def rec(job):
    def f(_db, user_id, *a, **k):
        called.setdefault(job, set()).add(user_id)
        return None
    return f


evening.generate_evening_letter = rec("evening")
weekly.generate_weekly_report = rec("weekly")
scene_rec.analyze_for_user = rec("scene")
dreaming.run_dreaming = lambda _db, user_id: called.setdefault("dream", set()).add(user_id) or {}
runner.run_tick_for_user = lambda _db, user_id, **k: called.setdefault("tick", set()).add(user_id) or {}

db = SessionLocal()
evening.run_evening_letters_all(db)
weekly.run_weekly_reports_all(db)
scene_rec.run_scene_recommend_all(db)
dreaming.run_dreaming_all(db)
runner.run_tick_all(db)
db.close()
for job in ("evening", "weekly", "scene", "dream", "tick"):
    assert called.get(job) == {awake}, (job, called.get(job))

# 睡前提醒：两人都设了 00:00（今天一定已到点），只有醒着的人进入生成
from app.models.preference import UserPreference  # noqa: E402

db = SessionLocal()
for u_ in (awake, sleeping):
    db.add(UserPreference(user_id=u_, sleep_reminder_time="00:00"))
db.commit()
seen: list[int] = []
bedtime.generate_bedtime_reminder = lambda _db, user_id, *a, **k: seen.append(user_id)
bedtime.run_due_bedtime_reminders(db)
db.close()
assert seen == [awake], seen
ok("六个定时任务只对未沉睡用户生成")

# ─── 7. 迁移 020 回填 ─────────────────────────────────────────────────────────
mig_db = (TMP / "mig.db").as_posix()
env = {**os.environ, "DATABASE_URL": f"sqlite:///{mig_db}", "PYTHONUTF8": "1", "PYTHONPATH": "."}
alembic = [sys.executable, "-m", "alembic"]
subprocess.run(alembic + ["upgrade", "019_email_auth"], env=env, check=True, capture_output=True)
import sqlite3  # noqa: E402

con = sqlite3.connect(mig_db)
con.execute("INSERT INTO users (id, username, password_hash, is_active, created_at, updated_at) "
            "VALUES (1,'a','x',1,'2026-01-01 00:00:00','2026-01-01 00:00:00'),"
            "(2,'b','x',1,'2026-02-01 00:00:00','2026-02-01 00:00:00')")
con.execute("INSERT INTO conversations (id, user_id, mode, created_at, updated_at) VALUES (1, 1, 'free_chat', '2026-03-01 00:00:00', '2026-03-01 00:00:00')")
cols = {r[1] for r in con.execute("PRAGMA table_info(conversation_messages)")}
base = {"conversation_id": 1, "content": "hi"}
for role, ts in (("user", "2026-09-01 10:00:00"), ("assistant", "2026-09-05 10:00:00"), ("user", "2026-08-01 10:00:00")):
    row = {**base, "role": role, "created_at": ts}
    row = {k: v for k, v in row.items() if k in cols}
    con.execute(f"INSERT INTO conversation_messages ({','.join(row)}) VALUES ({','.join('?' * len(row))})", list(row.values()))
con.commit()
con.close()
subprocess.run(alembic + ["upgrade", "head"], env=env, check=True, capture_output=True)
con = sqlite3.connect(mig_db)
got = dict(con.execute("SELECT id, last_active_at FROM users").fetchall())
con.close()
assert str(got[1]).startswith("2026-09-01 10:00"), got   # 取用户自己的最后一条，不取模型回复
assert str(got[2]).startswith("2026-02-01"), got         # 没聊过 → 注册时间
ok("迁移 020：回填最后一条用户消息，没聊过用注册时间")

print(f"\n全部 {PASS} 项通过")
