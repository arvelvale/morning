"""FastAPI 鉴权依赖。

其他路由做 user 隔离时：
    from app.deps import get_current_user
    def list_todos(user: User = Depends(get_current_user)): ...
把之前的 `user_id=1` 占位替换成 `user.id` 即可。
"""
import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.security import decode_token
from app.db import get_db
from app.models.user import User
from app.services.infra.engagement import counts_as_open, touch_last_active

_bearer = HTTPBearer(auto_error=True)


def user_id_from_token(token: str | None) -> int | None:
    """从裸 token（或 "Bearer xxx"）解析用户 id；无效返回 None。

    WebSocket 无法用 HTTPBearer 依赖，网关 WS 端点用它做强制鉴权。
    """
    if not token:
        return None
    if token.lower().startswith("bearer "):
        token = token[7:]
    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            return None
        return int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        return None


def get_current_user(
    request: Request,
    creds: HTTPAuthorizationCredentials = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    cred_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="无效或过期的凭证",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_token(creds.credentials)
        if payload.get("type") != "access":
            raise cred_exc
        user_id = int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise cred_exc

    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise cred_exc
    if counts_as_open(request.method, request.url.path):
        touch_last_active(user)
    return user
