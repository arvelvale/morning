"""自带密钥（BYOK）相关接口。密钥本身从不落库：只从请求头进来（见 app/llm_keys.py）。

- GET  /api/v1/ai/keys/policy     服务端的口径：是不是必须自带、服务端有没有备用模型
- POST /api/v1/ai/keys/test       用请求头里带的 key 各打一次最便宜的请求，告诉用户 key 能不能用
- PUT  /api/v1/users/me/own-key   手机上填好 / 清掉密钥时调用，只记「是不是自带」这一位
- POST /api/v1/tick               自带密钥的手机定时来触发「此刻该做的定时活」（晚间信、睡前提醒、周报…）
"""
from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends
from pydantic import BaseModel
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.deps import get_current_user
from app.llm_keys import current_keys
from app.models.user import User
from app.services.infra.user_jobs import run_user_jobs

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["byok"])

TEST_TIMEOUT_SECONDS = 12


class OwnKeyIn(BaseModel):
    enabled: bool


def _set_own_key(db: Session, user: User, enabled: bool) -> None:
    if bool(user.uses_own_key) == enabled:
        return
    db.execute(update(User).where(User.id == user.id).values(uses_own_key=enabled))
    db.commit()


@router.get("/ai/keys/policy")
def keys_policy(_: User = Depends(get_current_user)):
    s = get_settings()
    return {
        # true：不填自己的 key 就用不了需要模型的功能
        "byok_required": bool(s.byok_required),
        # 用户不带 key 时，服务端还有没有 key 可用
        "server_key_available": bool(s.stepfun_api_key) and not s.byok_required,
        "text_model": s.step_text_model,
        "fallback_model": s.deepseek_model,
    }


def _probe(base_url: str, key: str) -> dict:
    """列一次模型（不花 token）。只回报结论，不回显 key 和上游的原始报错。"""
    try:
        res = httpx.get(
            base_url.rstrip("/") + "/models",
            headers={"Authorization": f"Bearer {key}"},
            timeout=TEST_TIMEOUT_SECONDS,
        )
    except httpx.TimeoutException:
        return {"ok": False, "reason": "timeout"}
    except httpx.HTTPError:
        return {"ok": False, "reason": "network"}
    if res.status_code == 200:
        return {"ok": True, "reason": None}
    if res.status_code in (401, 403):
        return {"ok": False, "reason": "invalid_key"}
    if res.status_code == 402:
        return {"ok": False, "reason": "no_balance"}
    if res.status_code == 429:
        # 限流说明 key 是被认的，只是此刻太频繁
        return {"ok": True, "reason": "rate_limited"}
    return {"ok": False, "reason": f"http_{res.status_code}"}


@router.post("/ai/keys/test")
def test_keys(_: User = Depends(get_current_user)):
    """测试这次请求头里带的 key。没带的那一家返回 provided=false。"""
    s = get_settings()
    keys = current_keys()
    out: dict[str, dict] = {}
    for name, key, base in (
        ("stepfun", keys.stepfun, s.stepfun_base_url),
        ("deepseek", keys.deepseek, s.deepseek_base_url),
    ):
        out[name] = {"provided": True, **_probe(base, key)} if key else {"provided": False, "ok": False, "reason": None}
    return out


@router.put("/users/me/own-key")
def set_own_key(body: OwnKeyIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """手机上填好密钥后调 enabled=true：之后服务端定时任务不再用服务端的 key 为这个用户生成内容，
    改由手机带着 key 调 /tick 触发。清掉密钥后调 enabled=false，恢复由服务端生成（服务端允许的话）。
    """
    _set_own_key(db, user, body.enabled)
    return {"uses_own_key": body.enabled}


@router.post("/tick")
def tick(
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """手机定时触发。立刻返回，真正的活放到响应之后做（一封信要等模型十几秒，不能让手机的后台任务干等）。

    没带密钥就什么都不做：这个接口只为自带密钥的用户存在，绝不用服务端的 key。
    """
    if not current_keys().any:
        return {"accepted": False, "reason": "no_key"}
    # 带着密钥来触发，说明这台手机是自带密钥的：把标记补上（防止标记接口那次没调成）
    _set_own_key(db, user, True)
    # BackgroundTasks 在这次请求的上下文里执行，读得到请求头带来的密钥
    background_tasks.add_task(run_user_jobs, user.id)
    return {"accepted": True}
