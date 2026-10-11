"""SMTP 验证码。SQLite 短写事务串行化额度/消费；网络发送不持有数据库锁。"""
import hashlib
import hmac
import logging
import secrets
import smtplib
import ssl
import time
from email.message import EmailMessage
from email.utils import formataddr

from fastapi import HTTPException
from sqlalchemy import delete, select, text, update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.security import verify_password
from app.models.email_auth import EmailChallenge, EmailIdentity, EmailRate
from app.models.user import User

logger = logging.getLogger(__name__)


def check_enabled():
    s = get_settings()
    if not s.email_login_enabled or not all((s.smtp_host, s.smtp_email, s.smtp_password)):
        raise HTTPException(503, "邮箱登录暂未开放，请使用密码登录")


def keyed(value: str) -> str:
    return hmac.new(get_settings().jwt_secret.encode(), value.encode(), hashlib.sha256).hexdigest()


def _begin(db: Session):
    # SQLite 用写事务；PG 用事务级 advisory lock，同一时刻仅一个验证码事务调整额度/消费。
    if db.bind.dialect.name == "sqlite":
        db.execute(text("BEGIN IMMEDIATE"))
    else:
        db.execute(text("SELECT pg_advisory_xact_lock(287464873)"))


def _rate(db: Session, key: str, limit: int, window: int, now: int):
    row = db.get(EmailRate, key)
    if row and row.expires_at > now:
        if row.count >= limit:
            raise HTTPException(429, "操作太频繁，请稍后再试", headers={"Retry-After": str(row.expires_at - now)})
        row.count += 1
    elif row:
        row.expires_at, row.count = now + window, 1
    else:
        db.add(EmailRate(key=key, expires_at=now + window, count=1))


def send_smtp(email: str, code: str, purpose: str):
    s = get_settings()
    action = "绑定邮箱" if purpose == "bind" else "登录"
    message = EmailMessage()
    message["From"] = formataddr((s.smtp_sender_name, s.smtp_email))
    message["To"] = email
    message["Subject"] = f"喵灵 · {action}验证码"
    message.set_content(f"你的{action}验证码是：{code}\n\n5 分钟内有效，请勿向他人泄露。\n如果不是你本人操作，请忽略这封邮件。\n\n喵灵")
    context = ssl.create_default_context()
    if s.smtp_secure:
        server = smtplib.SMTP_SSL(s.smtp_host, s.smtp_port, timeout=10, context=context)
    else:
        server = smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=10)
    with server:
        if not s.smtp_secure:
            server.starttls(context=context)
        server.login(s.smtp_email, s.smtp_password)
        if server.send_message(message):
            raise RuntimeError("recipient refused")


def send_code(db: Session, email: str, purpose: str, ip: str):
    check_enabled()
    now = int(time.time())
    email_key, ip_key = keyed("email:" + email), keyed("ip:" + ip)
    code = f"{secrets.randbelow(1_000_000):06d}"
    challenge_id = secrets.token_hex(16)
    try:
        _begin(db)
        db.execute(delete(EmailRate).where(EmailRate.expires_at <= now))
        db.execute(delete(EmailChallenge).where(EmailChallenge.expires_at <= now))
        for key, limit, window in (
            ("cooldown:" + email_key, 1, 60), ("email:" + email_key, 5, 3600),
            ("ip:" + ip_key, 20, 3600), ("global", 200, 86400),
        ):
            _rate(db, key, limit, window, now)
        db.merge(EmailChallenge(email_key=email_key, challenge_id=challenge_id, purpose=purpose,
            digest=keyed(challenge_id + ":" + code), expires_at=now + 300, attempts=0, ready=0))
        db.commit()
    except Exception:
        db.rollback()
        raise
    try:
        send_smtp(email, code, purpose)
    except Exception as exc:
        # 不记录邮箱、验证码、SMTP 响应或异常正文，防止凭证/收件人泄漏。
        logger.warning("SMTP verification delivery failed: %s", type(exc).__name__)
        raise HTTPException(503, "邮件暂时没能发出，请稍后重试或使用密码登录") from None
    # 只激活当前发送；慢请求不能覆盖后来的重发。发送失败也保留额度防刷。
    db.execute(update(EmailChallenge).where(EmailChallenge.email_key == email_key,
        EmailChallenge.challenge_id == challenge_id).values(ready=1))
    db.commit()
    return {"message": "验证码已发送，请检查收件箱或垃圾邮件", "retry_after": 60, "expires_in": 300}


def verify_code(db: Session, email: str, code: str, purpose: str, ip: str,
                username: str | None = None, password: str | None = None) -> int:
    check_enabled()
    now = int(time.time())
    try:
        _begin(db)
        _rate(db, "verify:" + keyed("ip:" + ip), 60, 3600, now)
        row = db.get(EmailChallenge, keyed("email:" + email))
        if not row or row.expires_at <= now or not row.ready or row.attempts >= 5:
            db.commit()
            raise HTTPException(400, "验证码无效或已过期，请重新获取")
        row.attempts += 1
        if row.purpose != purpose or not hmac.compare_digest(row.digest, keyed(row.challenge_id + ":" + code)):
            db.commit()
            raise HTTPException(400, "验证码不正确或已失效")
        # 即使密码/绑定校验失败也消费本次验证码，避免用它无限尝试账号密码。
        row.ready = 0
        db.flush()
        identity = db.get(EmailIdentity, email)
        if purpose == "bind":
            user = db.scalar(select(User).where(User.username == username))
            if not user or not verify_password(password or "", user.password_hash) or not user.is_active:
                db.commit()
                raise HTTPException(400, "绑定失败，请核对原账号密码并重新获取验证码")
            old = db.scalar(select(EmailIdentity).where(EmailIdentity.user_id == user.id))
            if (identity and identity.user_id != user.id) or (old and old.email != email):
                db.commit()
                raise HTTPException(409, "邮箱或账号已有其他绑定，请使用原登录方式")
            if not identity:
                db.add(EmailIdentity(email=email, user_id=user.id))
        else:
            user = db.get(User, identity.user_id) if identity else None
            if not user or not user.is_active:
                db.commit()
                raise HTTPException(400, "无法使用此邮箱登录；首次使用请绑定原账号，或使用密码登录")
        user_id = user.id
        db.commit()
        return user_id
    except Exception:
        db.rollback()
        raise
