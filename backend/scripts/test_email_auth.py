"""隔离 SQLite + SMTP 替身验收，不读取/发送真实邮件，不修改开发库。

运行：backend/.venv/Scripts/python.exe scripts/test_email_auth.py（PYTHONPATH=.）
"""
import os
import importlib.util
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

os.environ["DATABASE_URL"] = "sqlite://"
os.environ["JWT_SECRET"] = "isolated-email-test-secret-not-for-production"

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy import inspect
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.security import hash_password
from app.db import Base, get_db
from app.models.email_auth import EmailChallenge, EmailIdentity, EmailRate
from app.models.user import User
from app.routers.system.auth import router
from app.services.infra import email_auth as service


class EmailAuthTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.engine = create_engine("sqlite:///" + str(Path(self.temp.name) / "test.db"), connect_args={"check_same_thread": False})
        Base.metadata.create_all(self.engine, tables=[User.__table__, EmailIdentity.__table__, EmailChallenge.__table__, EmailRate.__table__])
        self.settings = get_settings()
        self.overrides = patch.multiple(self.settings, email_login_enabled=True, smtp_host="smtp.invalid",
            smtp_email="test@example.com", smtp_password="test-only", smtp_secure=True, smtp_port=465)
        self.overrides.start()
        self.sender = patch.object(service, "send_smtp")
        self.mock_send = self.sender.start()
        with Session(self.engine) as db:
            user = User(username="original", password_hash=hash_password("secret123"), email="legacy@example.com")
            db.add(user)
            db.commit()
            self.user_id = user.id
        app = FastAPI()
        app.include_router(router)
        def database():
            with Session(self.engine) as db:
                yield db
        app.dependency_overrides[get_db] = database
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        self.sender.stop()
        self.overrides.stop()
        self.engine.dispose()
        self.temp.cleanup()

    def send(self, email="person@example.com", purpose="login", ip="ip1"):
        with Session(self.engine) as db:
            service.send_code(db, email, purpose, ip)
        return self.mock_send.call_args.args[1]

    def verify(self, code, purpose="login", **kwargs):
        with Session(self.engine) as db:
            return service.verify_code(db, "person@example.com", code, purpose, "ip1", **kwargs)

    def identity(self):
        with Session(self.engine) as db:
            db.add(EmailIdentity(email="person@example.com", user_id=self.user_id))
            db.commit()

    def test_bind_keeps_user_and_returns_tokens(self):
        response = self.client.post("/api/v1/auth/email/send-code", json={"email": " Person@Example.com ", "purpose": "bind"})
        self.assertEqual(response.status_code, 200)
        code = self.mock_send.call_args.args[1]
        response = self.client.post("/api/v1/auth/email/login", json={"email": "PERSON@example.com", "purpose": "bind",
            "code": code, "username": "original", "password": "secret123"})
        self.assertEqual(response.status_code, 200, response.text)
        me = self.client.get("/api/v1/users/me", headers={"Authorization": "Bearer " + response.json()["access_token"]})
        self.assertEqual(me.json()["id"], self.user_id)
        with Session(self.engine) as db:
            self.assertEqual(len(db.scalars(select(User)).all()), 1)
            self.assertEqual(db.get(EmailIdentity, "person@example.com").user_id, self.user_id)

    def test_login_replay_and_hash_storage(self):
        self.identity()
        code = self.send()
        with Session(self.engine) as db:
            row = db.scalar(select(EmailChallenge))
            self.assertNotEqual(row.digest, code)
            self.assertEqual(len(row.digest), 64)
        self.assertEqual(self.verify(code), self.user_id)
        with self.assertRaises(HTTPException):
            self.verify(code)

    def test_five_errors_lock_code(self):
        self.identity()
        code = self.send()
        wrong = "000000" if code != "000000" else "111111"
        for _ in range(5):
            with self.assertRaises(HTTPException):
                self.verify(wrong)
        with self.assertRaises(HTTPException):
            self.verify(code)

    def test_expiry(self):
        self.identity()
        with patch.object(service.time, "time", return_value=1000):
            code = self.send()
        with patch.object(service.time, "time", return_value=1300):
            with self.assertRaises(HTTPException):
                self.verify(code)

    def test_cooldown_resend_invalidates_old(self):
        self.identity()
        with patch.object(service.time, "time", return_value=1000):
            old = self.send()
            with self.assertRaises(HTTPException) as error:
                self.send()
            self.assertEqual(error.exception.status_code, 429)
        with patch.object(service.time, "time", return_value=1061), patch.object(service.secrets, "randbelow", return_value=(int(old) + 1) % 1000000):
            new = self.send()
            with self.assertRaises(HTTPException):
                self.verify(old)
            self.assertEqual(self.verify(new), self.user_id)

    def test_unverified_legacy_email_not_login_identity(self):
        code = self.send("legacy@example.com")
        with Session(self.engine) as db, self.assertRaises(HTTPException):
            service.verify_code(db, "legacy@example.com", code, "login", "ip1")

    def test_wrong_binding_password_consumes_code(self):
        code = self.send(purpose="bind")
        with self.assertRaises(HTTPException):
            self.verify(code, "bind", username="original", password="wrongpw")
        with self.assertRaises(HTTPException):
            self.verify(code, "bind", username="original", password="secret123")

    def test_purpose_isolated(self):
        code = self.send(purpose="bind")
        with self.assertRaises(HTTPException):
            self.verify(code)

    def test_failed_delivery_never_activates_code(self):
        self.mock_send.side_effect = OSError("secret provider error")
        with self.assertRaises(HTTPException) as error:
            self.send()
        self.assertNotIn("secret", error.exception.detail)
        with Session(self.engine) as db:
            self.assertEqual(db.scalar(select(EmailChallenge)).ready, 0)
        self.assertEqual(self.client.post("/api/v1/auth/login", json={"username": "original", "password": "secret123"}).status_code, 200)

    def test_disabled_and_input_validation(self):
        self.settings.email_login_enabled = False
        response = self.client.post("/api/v1/auth/email/send-code", json={"email": "person@example.com"})
        self.assertEqual(response.status_code, 503)
        for email in ("a\r\nBcc: bad@example.com", "a@bad", "a..b@example.com", "a@-bad.com"):
            response = self.client.post("/api/v1/auth/email/send-code", json={"email": email})
            self.assertEqual(response.status_code, 422)
        self.mock_send.assert_not_called()

    def test_ip_limit(self):
        for i in range(20):
            self.send(f"p{i}@example.com")
        with self.assertRaises(HTTPException) as error:
            self.send("overflow@example.com")
        self.assertEqual(error.exception.status_code, 429)

    def test_concurrent_consumption_only_once(self):
        self.identity()
        code = self.send()
        def consume(_):
            try:
                return self.verify(code)
            except HTTPException:
                return None
        with ThreadPoolExecutor(max_workers=2) as workers:
            results = list(workers.map(consume, range(2)))
        self.assertEqual(results.count(self.user_id), 1)

    def test_smtp_tls_and_starttls(self):
        self.sender.stop()
        try:
            with patch.object(service.smtplib, "SMTP_SSL") as secure:
                secure.return_value.__enter__.return_value = secure.return_value
                secure.return_value.send_message.return_value = {}
                service.send_smtp("person@example.com", "123456", "login")
                self.assertEqual(secure.call_args.kwargs["timeout"], 10)
                self.assertIsNotNone(secure.call_args.kwargs["context"])
                message = secure.return_value.send_message.call_args.args[0]
                self.assertIn("喵灵", str(message["Subject"]))
            self.settings.smtp_secure = False
            with patch.object(service.smtplib, "SMTP") as smtp:
                smtp.return_value.__enter__.return_value = smtp.return_value
                smtp.return_value.send_message.return_value = {}
                service.send_smtp("person@example.com", "123456", "bind")
                smtp.return_value.starttls.assert_called_once()
        finally:
            self.mock_send = self.sender.start()

    def test_binding_conflict_and_inactive_user(self):
        self.identity()
        with Session(self.engine) as db:
            db.add(User(username="other", password_hash=hash_password("secret456")))
            db.commit()
        code = self.send(purpose="bind")
        with self.assertRaises(HTTPException) as error:
            self.verify(code, "bind", username="other", password="secret456")
        self.assertEqual(error.exception.status_code, 409)
        with Session(self.engine) as db:
            self.assertEqual(db.get(EmailIdentity, "person@example.com").user_id, self.user_id)
            db.get(User, self.user_id).is_active = False
            db.query(EmailRate).delete()
            db.commit()
        code = self.send()
        with self.assertRaises(HTTPException):
            self.verify(code)

    def test_hourly_email_and_global_limits(self):
        for i in range(5):
            with patch.object(service.time, "time", return_value=1000 + i * 61):
                self.send()
        with patch.object(service.time, "time", return_value=1400):
            with self.assertRaises(HTTPException) as error:
                self.send()
            self.assertEqual(error.exception.status_code, 429)
        with Session(self.engine) as db:
            db.get(EmailRate, "global").count = 200
            db.commit()
        with patch.object(service.time, "time", return_value=1401):
            with self.assertRaises(HTTPException) as error:
                self.send("new@example.com", ip="different")
            self.assertEqual(error.exception.status_code, 429)

    def test_migration_roundtrip_preserves_users(self):
        module_spec = importlib.util.spec_from_file_location("email_migration", Path(__file__).parents[1] / "alembic/versions/019_email_auth.py")
        migration = importlib.util.module_from_spec(module_spec)
        module_spec.loader.exec_module(migration)
        with self.engine.begin() as conn:
            migration.op = Operations(MigrationContext.configure(conn))
            migration.downgrade()
            self.assertIn("users", inspect(conn).get_table_names())
            migration.upgrade()
            for model in (EmailIdentity, EmailChallenge, EmailRate):
                actual = {column["name"] for column in inspect(conn).get_columns(model.__tablename__)}
                self.assertEqual(actual, set(model.__table__.columns.keys()))
        with Session(self.engine) as db:
            self.assertEqual(db.get(User, self.user_id).username, "original")


if __name__ == "__main__":
    unittest.main(verbosity=2)
