"""账号 Auth：注册/登录/刷新/注销 + 当前用户。见 docs/api-design.md §A。

Token 采用标准 OAuth2 风格字段（access_token / refresh_token / token_type=bearer）。
除 register/login/refresh 外均需 Authorization: Bearer <access_token>。
"""
from datetime import datetime
import re
from typing import Literal

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.db import get_db
from app.deps import get_current_user
from app.models.user import User
from app.services.infra.email_auth import send_code, verify_code

router = APIRouter(prefix="/api/v1", tags=["auth"])


# ─── Schemas ─────────────────────────────────────────────────────────────────

class RegisterIn(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    password: str = Field(min_length=6, max_length=128)
    email: str | None = None
    display_name: str | None = None


class LoginIn(BaseModel):
    username: str
    password: str


class RefreshIn(BaseModel):
    refresh_token: str


class EmailCodeIn(BaseModel):
    email: str = Field(max_length=254)
    purpose: Literal["login", "bind"] = "login"

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        value = value.strip().lower()
        local, separator, domain = value.partition("@")
        if (not separator or len(local) > 64 or local.startswith(".") or local.endswith(".")
                or ".." in local or not re.fullmatch(r"[a-z0-9.!#$%&'*+/=?^_`{|}~-]+", local)
                or not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+", domain)):
            raise ValueError("请输入有效的邮箱地址")
        return value


class EmailLoginIn(EmailCodeIn):
    code: str = Field(pattern=r"^[0-9]{6}$")
    username: str | None = Field(default=None, min_length=3, max_length=50)
    password: str | None = Field(default=None, min_length=6, max_length=128)


class TokenOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    id: int
    username: str
    email: str | None
    display_name: str | None
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class UserUpdate(BaseModel):
    display_name: str | None = None
    email: str | None = None


def _issue_tokens(user_id: int) -> TokenOut:
    return TokenOut(
        access_token=create_access_token(user_id),
        refresh_token=create_refresh_token(user_id),
    )


# ─── Endpoints ───────────────────────────────────────────────────────────────

@router.post("/auth/email/send-code")
def send_email_code(body: EmailCodeIn, request: Request, db: Session = Depends(get_db)):
    # 仅使用服务端识别的 client IP，不自行信任任意 X-Forwarded-For。
    return send_code(db, body.email, body.purpose, request.client.host if request.client else "unknown")


@router.post("/auth/email/login", response_model=TokenOut)
def email_login(body: EmailLoginIn, request: Request, db: Session = Depends(get_db)):
    if body.purpose == "bind" and (not body.username or not body.password):
        raise HTTPException(422, "首次绑定需要原账号用户名和密码")
    user_id = verify_code(db, body.email, body.code, body.purpose,
        request.client.host if request.client else "unknown", body.username, body.password)
    return _issue_tokens(user_id)

@router.post("/auth/register", response_model=TokenOut, status_code=status.HTTP_201_CREATED)
def register(body: RegisterIn, db: Session = Depends(get_db)):
    if db.scalar(select(User).where(User.username == body.username)):
        raise HTTPException(status.HTTP_409_CONFLICT, "用户名已被占用")
    if body.email and db.scalar(select(User).where(User.email == body.email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "邮箱已被注册")

    user = User(
        username=body.username,
        email=body.email,
        display_name=body.display_name or body.username,
        password_hash=hash_password(body.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _issue_tokens(user.id)


@router.post("/auth/login", response_model=TokenOut)
def login(body: LoginIn, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.username == body.username))
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "用户名或密码错误")
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "账号已停用")
    return _issue_tokens(user.id)


@router.post("/auth/refresh", response_model=TokenOut)
def refresh(body: RefreshIn, db: Session = Depends(get_db)):
    try:
        payload = decode_token(body.refresh_token)
        if payload.get("type") != "refresh":
            raise ValueError
        user_id = int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "无效的 refresh token")

    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "用户不存在或已停用")
    return _issue_tokens(user.id)


@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(_: User = Depends(get_current_user)):
    # JWT 无状态：注销由前端丢弃 token 完成。此端点仅校验鉴权、作语义占位。
    return None


@router.get("/users/me", response_model=UserOut)
def read_me(current: User = Depends(get_current_user)):
    return current


@router.patch("/users/me", response_model=UserOut)
def update_me(
    body: UserUpdate,
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if body.display_name is not None:
        current.display_name = body.display_name
    if body.email is not None and body.email != current.email:
        # 邮箱有唯一约束：先查重，避免 IntegrityError 直接 500
        if db.scalar(select(User).where(User.email == body.email)):
            raise HTTPException(status.HTTP_409_CONFLICT, "邮箱已被注册")
        current.email = body.email
    db.commit()
    db.refresh(current)
    return current
