"""Chat regression through HTTP using isolated SQLite and deterministic model results."""
from datetime import datetime, timezone
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.deps import get_current_user
from app.models.user import User
from app.routers.companion import conversations
from app.routers.memory.stores import todos_router
from app.services.companion import chat_todos
from app.services.memory.temporal import CST


def main():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    Base.metadata.create_all(engine)
    owner = User(id=1, username="owner", password_hash="unused")
    other = User(id=2, username="other", password_hash="unused")

    def test_db():
        with sessions() as db:
            yield db

    app = FastAPI()
    app.include_router(conversations.router)
    app.include_router(todos_router)
    app.dependency_overrides[get_db] = test_db
    app.dependency_overrides[get_current_user] = lambda: owner
    prefix = "/api/v1/conversations"
    sentence = "我明天上午11点有面试哈"
    fact = {"layer": "episodic", "kind": "待办", "depth": "personal", "content": "参加面试",
            "confidence": 1.0, "evidence": sentence, "due_at": "2026-11-06T11:00:00+08:00", "has_time": True}

    with (patch.object(conversations, "SessionLocal", sessions),
          patch.object(chat_todos, "SessionLocal", sessions),
          patch.object(conversations, "capture_best_effort"),
          patch.object(chat_todos, "now_cst", return_value=datetime(2026, 11, 5, 23, tzinfo=CST)),
          patch.object(chat_todos, "run_extractor", side_effect=lambda message, **_: [fact] if message == sentence else [] ) as extract,
          patch.object(conversations, "stream_companion", return_value=iter(["面试加油。"])),
          patch.object(conversations, "run_companion", return_value="面试加油。"),
          TestClient(app) as client):
        assert client.get(f"{prefix}/latest").json() is None
        chat_id = client.post(prefix, json={"mode": "free_chat"}).json()["id"]
        assert client.get(f"{prefix}/latest").json() is None, "Empty shells must not shadow chat history"

        reply = client.post(f"{prefix}/{chat_id}/messages?stream=true", json={"text": sentence})
        assert reply.status_code == 200 and "event: todo.saved" in reply.text and "event: done" in reply.text
        assert "已记到待办：参加面试（11月6日 11:00）" in reply.text and "面试加油" in reply.text
        todos = client.get("/api/v1/todos").json()
        assert len(todos) == 1 and todos[0]["has_time"] is True and todos[0]["status"] == "pending"
        assert datetime.fromisoformat(todos[0]["due_date"]) == datetime(2026, 11, 6, 3, tzinfo=timezone.utc)

        latest = client.get(f"{prefix}/latest").json()
        assert latest["id"] == chat_id and [m["role"] for m in latest["messages"]] == ["user", "assistant"]
        another = client.post(prefix, json={"mode": "free_chat"}).json()["id"]
        client.post(f"{prefix}/{another}/messages", json={"text": "你好"}).raise_for_status()
        assert extract.call_count == 1, "Small talk should not trigger a second model call"
        assert client.get(f"{prefix}/latest").json()["id"] == another
        repeated = client.post(f"{prefix}/{chat_id}/messages", json={"text": sentence}).json()
        assert repeated["reply"]["content"].startswith("已记到待办：")
        assert len(client.get("/api/v1/todos").json()) == 1
        assert client.get(f"{prefix}/latest").json()["id"] == chat_id, "Resume by latest message, not creation order"

        vague = client.post(f"{prefix}/{chat_id}/messages", json={"text": "明天如果有面试我会紧张"}).json()
        assert "已记到待办" not in vague["reply"]["content"]
        with patch.object(chat_todos, "run_extractor", side_effect=TimeoutError):
            failed = client.post(f"{prefix}/{chat_id}/messages", json={"text": sentence})
            assert failed.status_code == 200 and "已记到待办" not in failed.json()["reply"]["content"]
        app.dependency_overrides[get_current_user] = lambda: other
        assert client.get(f"{prefix}/latest").json() is None
        assert client.get(f"{prefix}/{chat_id}").status_code == 404
        assert client.get("/api/v1/todos").json() == []
    engine.dispose()
    print("PASS chat todo and resume HTTP: streamed receipt, due time, deduplication, history, isolation, and failure")


if __name__ == "__main__":
    main()
