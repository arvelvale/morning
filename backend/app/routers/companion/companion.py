"""陪伴首页聚合（api-design §1）。

GET /api/v1/companion/home — 当前主桌宠、它此刻在做什么（behavior）、轻量邀请。
behavior 由服务端按时间计算（前端只读，保证"每日新鲜感"一致）。
"""
from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user
from app.models.user import User
from app.services.mailbox.inbox import build_today
from app.services.mailbox.letter_store import LetterStore
from app.services.pet.pet_store import PetStore

router = APIRouter(prefix="/api/v1/companion", tags=["companion"])

# 时段 → 桌宠行为（小时为本地时间）
_BEHAVIORS = [
    (range(0, 6), "打盹"),
    (range(6, 9), "伸懒腰"),
    (range(9, 12), "听歌"),
    (range(12, 14), "午睡"),
    (range(14, 18), "歪头看你"),
    (range(18, 22), "发呆"),
    (range(22, 24), "等你说话"),
]


def _behavior_for(now: datetime) -> str:
    h = now.hour
    for r, b in _BEHAVIORS:
        if h in r:
            return b
    return "待着"


@router.get("/home")
def companion_home(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    pet = PetStore(db).get_active(user.id)
    now = datetime.now().astimezone()

    # 轻量邀请（最多一个，低干扰）：未读来信 > 今日待启
    invitation = None
    store = LetterStore(db)
    unread = store.unread_count(user.id)
    if unread > 0:
        # 用最新一封未读信的信题作为邀请预览（内容由晚间来信等 LLM 生成）
        latest = store.list_for_user(user.id, unread=True, limit=1)
        preview = latest[0].title if latest else "有一封信在等你拆开"
        invitation = {"type": "letter", "count": unread, "text": preview}
    else:
        today = build_today(db, user.id)
        n = len(today["actionable"])
        if n > 0:
            invitation = {"type": "todo", "count": n,
                          "text": f"今天还有 {n} 件待办"}

    return {
        "pet": None if pet is None else {
            "id": pet.id,
            "name": pet.name,
            "personality": pet.personality,
            "preset_id": pet.preset_id,
        },
        "behavior": _behavior_for(now),
        "status_text": "在等你",
        "invitation": invitation,
        "server_time": now.isoformat(),
    }
