"""信箱「删除」= 对用户隐藏（letters.hidden_at），不物理删除。免启动服务、不调真实 LLM。

运行：cd backend && DATABASE_URL="sqlite:///$(cygpath -m $(mktemp -d))/t.db" PYTHONUTF8=1 PYTHONPATH=. .venv/Scripts/python.exe scripts/test_letter_hide.py

覆盖：
1. 单封隐藏：204、幂等、别人的信 / 不存在 404、行仍在库里
2. 隐藏后：列表 / 详情(404) / 未读数 / 信箱概览 / 首页气泡都看不到；ack、reply 同样 404
3. 批量 ids：只动自己的，返回实际数量；空 ids / ids+all 同给 -> 422
4. all 模式（含 before）；read-all 只动可见未读
5. 「我留下的」(treasures) 不受影响
6. 隐藏今天的睡前提醒后，run_due_bedtime_reminders 不会重新生成
7. 隐藏的信仍计入防重复：generation_key 幂等 / 晚间信 material_ids / afterglow_ids / 「有句话」周上限与片段去重
8. 迁移 021：SQLite 上从 020 升级成功，列与索引在，旧信 hidden_at 为空
"""
import os
import sqlite3
import subprocess
import sys
import tempfile
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

TMP = Path(tempfile.mkdtemp(prefix="letter-hide-"))
os.environ["DATABASE_URL"] = f"sqlite:///{(TMP / 't.db').as_posix()}"
os.environ.setdefault("JWT_SECRET", "test-secret-for-letter-hide-0123456789")
sys.path.insert(0, ".")

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import select  # noqa: E402

from app.core.security import create_access_token  # noqa: E402
from app.db import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models.letter import Letter  # noqa: E402
from app.models.memory import MemoryItem  # noqa: E402
from app.models.preference import UserPreference  # noqa: E402
from app.models.treasure import Treasure  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services.mailbox import bedtime_reminder as br  # noqa: E402
from app.services.mailbox import evening_letter as ev  # noqa: E402
from app.services.mailbox.letter_store import LetterStore, daily_generation_key, local_delivery_date  # noqa: E402
from app.services.pet.pet_presets import get_preset  # noqa: E402
from app.services.pet.pet_store import PetStore  # noqa: E402
from app.services.scene import scene_recommend as sr  # noqa: E402

CST = timezone(timedelta(hours=8))
PASS = 0


def ok(name: str) -> None:
    global PASS
    PASS += 1
    print(f"{PASS:02d}. {name} PASS")


Base.metadata.create_all(bind=engine)
client = TestClient(app)  # 不进 with → 不跑 lifespan


def mk_user() -> int:
    db = SessionLocal()
    u = User(username=f"lh_{uuid.uuid4().hex[:8]}", password_hash="x", is_active=True)
    db.add(u)
    db.commit()
    uid = u.id
    db.close()
    return uid


def hdr(uid: int) -> dict:
    return {"Authorization": f"Bearer {create_access_token(uid)}"}


def mk_letter(uid: int, title="t", type="greeting", read=False, days_ago=0, **kw) -> int:
    db = SessionLocal()
    l = Letter(user_id=uid, type=type, title=title, body="body", is_read=read,
               created_at=datetime.now(timezone.utc) - timedelta(days=days_ago), **kw)
    db.add(l)
    db.commit()
    lid = l.id
    db.close()
    return lid


def visible_ids(uid: int) -> set[int]:
    r = client.get("/api/v1/letters?limit=100", headers=hdr(uid))
    assert r.status_code == 200, r.text
    return {x["id"] for x in r.json()}


def row(lid: int):
    db = SessionLocal()
    l = db.get(Letter, lid)
    db.expunge(l)
    db.close()
    return l


a, b = mk_user(), mk_user()
A, B = hdr(a), hdr(b)

# ─── 1. 单封隐藏 ─────────────────────────────────────────────────────────────
l1 = mk_letter(a, "一")
lb = mk_letter(b, "别人的")
assert client.delete(f"/api/v1/letters/{l1}", headers=A).status_code == 204
assert client.delete(f"/api/v1/letters/{l1}", headers=A).status_code == 204, "幂等"
assert client.delete(f"/api/v1/letters/{lb}", headers=A).status_code == 404, "别人的信"
assert client.delete("/api/v1/letters/999999", headers=A).status_code == 404
assert row(l1) is not None and row(l1).hidden_at is not None, "行必须还在，只是打上 hidden_at"
assert row(lb).hidden_at is None
first_ts = row(l1).hidden_at
client.delete(f"/api/v1/letters/{l1}", headers=A)
assert row(l1).hidden_at == first_ts, "重复删除不改时间"
ok("单封隐藏：204、幂等、越权 404、行仍在库")

# ─── 2. 隐藏后用户侧读不到 ───────────────────────────────────────────────────
assert l1 not in visible_ids(a)
assert client.get(f"/api/v1/letters/{l1}", headers=A).status_code == 404
assert client.patch(f"/api/v1/letters/{l1}", json={"read": True}, headers=A).status_code == 404
assert client.post(f"/api/v1/letters/{l1}/ack", headers=A).status_code == 404
assert client.post(f"/api/v1/letters/{l1}/reply", json={"text": "hi"}, headers=A).status_code == 404
assert client.post(f"/api/v1/letters/{l1}/accept-scene", headers=A).status_code == 404
# 未读数 / 首页气泡 / 概览：造一封今天的未读 + 一封隐藏的未读
today = local_delivery_date()
vis = mk_letter(a, "可见未读", delivery_date=today, delivery_slot=1, generation_key=f"x:{today}")
hid = mk_letter(a, "隐藏未读", delivery_date=today, delivery_slot=2, generation_key=f"y:{today}")
assert client.delete(f"/api/v1/letters/{hid}", headers=A).status_code == 204
db = SessionLocal()
assert LetterStore(db).unread_count(a) == 1
db.close()
ov = client.get("/api/v1/mailbox", headers=A).json()
assert ov["unread_letters_count"] == 1, ov["unread_letters_count"]
ids_in_overview = {x["id"] for x in ov["letters"]}
assert hid not in ids_in_overview and l1 not in ids_in_overview and vis in ids_in_overview
home = client.get("/api/v1/companion/home", headers=A).json()
inv = home["invitation"]
assert inv["type"] == "letter" and inv["count"] == 1 and inv["text"] == "可见未读", inv
mb = client.get("/api/v1/mailbox/letters", headers=A).json()["letters"]
assert hid not in {x["id"] for x in mb}
ok("隐藏后：列表/详情/ack/reply/未读数/概览/首页气泡都看不到")

# ─── 3. 批量 ids ─────────────────────────────────────────────────────────────
c1, c2, c3 = (mk_letter(a, f"批{i}") for i in range(3))
lb2 = mk_letter(b, "b的另一封")
r = client.post("/api/v1/letters/hide", json={"ids": [c1, c2, lb2, 987654, l1]}, headers=A)
assert r.status_code == 200 and r.json() == {"hidden": 2}, r.text  # 只 c1、c2；l1 已隐藏不重复数
assert row(lb2).hidden_at is None, "不能动别人的"
assert c3 in visible_ids(a) and c1 not in visible_ids(a)
assert client.post("/api/v1/letters/hide", json={"ids": []}, headers=A).status_code == 422
assert client.post("/api/v1/letters/hide", json={}, headers=A).status_code == 422
assert client.post("/api/v1/letters/hide", json={"ids": [c3], "all": True}, headers=A).status_code == 422
assert client.post("/api/v1/letters/hide", json={"ids": [c3]}).status_code in (401, 403)
ok("批量 ids：只动自己的、返回实际数量；空 ids / 同给 ids+all -> 422")

# ─── 4. all 模式 / before / read-all ─────────────────────────────────────────
uc = mk_user()
C = hdr(uc)
old1 = mk_letter(uc, "旧1", days_ago=10)
old2 = mk_letter(uc, "旧2", days_ago=5)
new1 = mk_letter(uc, "新1", days_ago=0)
cut = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
r = client.post("/api/v1/letters/hide", json={"all": True, "before": cut}, headers=C)
assert r.json() == {"hidden": 2}, r.text
assert visible_ids(uc) == {new1}
r = client.post("/api/v1/letters/read-all", headers=C)
assert r.json() == {"updated": 1}
assert row(new1).is_read and not row(old1).is_read, "read-all 不碰已隐藏的"
r = client.post("/api/v1/letters/hide", json={"all": True}, headers=C)
assert r.json() == {"hidden": 1}
assert visible_ids(uc) == set()
assert client.post("/api/v1/letters/hide", json={"all": True}, headers=C).json() == {"hidden": 0}
assert visible_ids(b) >= {lb, lb2}, "别人的信不受影响"
# before 带非 UTC 偏移（东八区）也要按同一时刻比
ucz = mk_user()
z_old = mk_letter(ucz, "旧", days_ago=5)
z_new = mk_letter(ucz, "新", days_ago=1)
cut_cst = (datetime.now(timezone.utc) - timedelta(days=2)).astimezone(CST).isoformat()
assert client.post("/api/v1/letters/hide", json={"all": True, "before": cut_cst}, headers=hdr(ucz)).json() == {"hidden": 1}
assert visible_ids(ucz) == {z_new}
ok("all 模式（含 before）、read-all 只动可见未读、不波及他人")

# ─── 5. 「我留下的」不受影响 ─────────────────────────────────────────────────
db = SessionLocal()
src = mk_letter(uc, "被珍藏的信")
t = Treasure(user_id=uc, source_type="letter", source_id=src, title="被珍藏的信", content="body")
db.add(t)
db.commit()
tid = t.id
db.close()
client.post("/api/v1/letters/hide", json={"all": True}, headers=C)
assert row(src).hidden_at is not None
assert client.get(f"/api/v1/treasures/{tid}", headers=C).status_code == 200
assert client.get("/api/v1/mailbox", headers=C).json()["treasures_count"] == 1
ok("treasures 是独立副本：隐藏来源信后仍在")

# ─── 6. 隐藏今天的睡前提醒后不会重新生成 ─────────────────────────────────────
calls = []
br.run_companion = lambda *a_, **k: (calls.append(1) or "夜深了，早点歇息呀。")
ud = mk_user()
db = SessionLocal()
ps = PetStore(db)
ps.set_active(ud, ps.create_from_preset(user_id=ud, preset=get_preset("miro")))
now_cst = datetime.now(CST)
if now_cst.hour * 60 + now_cst.minute < 5:
    print("（跨零点边界，跳过睡前提醒段）")
else:
    past = (now_cst - timedelta(minutes=5)).strftime("%H:%M")
    db.add(UserPreference(user_id=ud, sleep_reminder_time=past))
    db.commit()
    res = br.run_due_bedtime_reminders(db)
    assert [x for x in res if x.get("user_id") == ud and x.get("sent")], res
    rem = db.scalars(select(Letter).where(Letter.user_id == ud, Letter.type == "reminder")).all()
    assert len(rem) == 1
    rid = rem[0].id
    assert client.delete(f"/api/v1/letters/{rid}", headers=hdr(ud)).status_code == 204
    db.expire_all()
    n_calls = len(calls)
    for _ in range(3):  # 模拟之后几分钟的调度
        br.run_due_bedtime_reminders(db)
    db.expire_all()
    allrem = db.scalars(select(Letter).where(Letter.user_id == ud, Letter.type == "reminder")).all()
    assert len(allrem) == 1 and allrem[0].hidden_at is not None, "不能新生成第二封"
    assert len(calls) == n_calls, "连模型都不该再调"
    assert br._already_sent_today(db, ud) is True
    assert visible_ids(ud) == set(), "用户侧仍看不到"
    ok("隐藏今天的睡前提醒后，run_due_bedtime_reminders 不再生成、不再调模型")
db.close()

# ─── 7. 其它防重复仍看得见隐藏的信 ───────────────────────────────────────────
ue = mk_user()
db = SessionLocal()
store = LetterStore(db)
# 7a generation_key 当日幂等
key = daily_generation_key("evening_letter", today)
first = store.create_generated(user_id=ue, generation_key=key, type="greeting", title="晚", body="b",
                               attachment={"material_ids": [11, 12]})
fid = first.id
assert client.delete(f"/api/v1/letters/{fid}", headers=hdr(ue)).status_code == 204
db.expire_all()  # 删除是另一个会话（HTTP 请求）做的
again = store.create_generated(user_id=ue, generation_key=key, type="greeting", title="晚2", body="b2")
assert again.id == fid and again.hidden_at is not None, "同 key 仍返回那封（已隐藏）的行，不会新建"
assert db.scalar(select(Letter.id).where(Letter.user_id == ue, Letter.title == "晚2")) is None
# 7b 晚间信 material_ids 防复读
assert ev._used_material_ids(db, ue) == {11, 12}
# 7c afterglow_ids 防复读：一条刚演完的余温，已被（现已隐藏的）信提过 -> 不再待提
from app.services.scene.scene_service import AFTERGLOW_TAG  # noqa: E402

m = MemoryItem(user_id=ue, layer="working", kind="小结", depth="surface", content="余温", surface_text="余温",
               entities=[AFTERGLOW_TAG], status=None)
db.add(m)
db.commit()
db.refresh(m)
assert [x.id for x in ev._pending_afterglow(db, ue)] == [m.id], "对照组：没被提过时应待提"
lg = store.create_generated(user_id=ue, generation_key="evening_letter:x2", type="greeting", title="n", body="b",
                            attachment={"afterglow_ids": [m.id]})
assert client.delete(f"/api/v1/letters/{lg.id}", headers=hdr(ue)).status_code == 204
db.expire_all()
assert [x.id for x in ev._pending_afterglow(db, ue)] == [], "提过它的信被隐藏后仍算提过"
ok("generation_key 幂等、material_ids、afterglow_ids 仍计入已隐藏的信")
# 7d 「有句话」每 7 天最多 2 封 / 片段去重
for i, frag in enumerate((501, 502)):
    l = store.create_generated(user_id=ue, generation_key=f"scene_invite:2026-01-0{i+1}", type="scene_invite",
                               title="有句话", body="b", attachment={"fragment_id": frag})
    assert client.delete(f"/api/v1/letters/{l.id}", headers=hdr(ue)).status_code == 204
db.expire_all()
assert sr._recent_invite_count(db, ue) == 2, "隐藏的邀请仍占周上限"
assert sr._invited_fragment_ids(db, ue) == {501, 502}
db.close()
ok("「有句话」周上限与已邀请片段仍计入已隐藏的信")

# ─── 8. 迁移 021 ─────────────────────────────────────────────────────────────
mig_db = (TMP / "mig.db").as_posix()
env = {**os.environ, "DATABASE_URL": f"sqlite:///{mig_db}", "PYTHONUTF8": "1", "PYTHONPATH": "."}
alembic = [sys.executable, "-m", "alembic"]
subprocess.run(alembic + ["upgrade", "020_user_last_active"], env=env, check=True, capture_output=True)
con = sqlite3.connect(mig_db)
assert "hidden_at" not in {r_[1] for r_ in con.execute("PRAGMA table_info(letters)")}
con.execute("INSERT INTO users (id, username, password_hash, is_active, created_at, updated_at) "
            "VALUES (1,'a','x',1,'2026-01-01 00:00:00','2026-01-01 00:00:00')")
con.execute("INSERT INTO letters (user_id, type, title, body, is_read, created_at) "
            "VALUES (1,'greeting','旧信','b',0,'2026-03-01 00:00:00')")
con.commit()
con.close()
subprocess.run(alembic + ["upgrade", "head"], env=env, check=True, capture_output=True)
con = sqlite3.connect(mig_db)
cols = {r_[1] for r_ in con.execute("PRAGMA table_info(letters)")}
idx = {r_[1] for r_ in con.execute("PRAGMA index_list(letters)")}
old = con.execute("SELECT hidden_at FROM letters").fetchone()
con.close()
assert "hidden_at" in cols and "ix_letters_user_hidden" in idx and old == (None,), (cols, idx, old)
head = subprocess.run(alembic + ["heads"], env=env, check=True, capture_output=True, text=True).stdout
assert "021_letter_hidden" in head, head
ok("迁移 021：从 020 升级成功，列与索引在，旧信 hidden_at 为空")

print(f"\n全部 {PASS} 项通过")
