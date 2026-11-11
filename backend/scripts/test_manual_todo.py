"""手动待办接口回归：仅内存 SQLite，不连接本地/线上业务库，不调用模型。"""
from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.deps import get_current_user
from app.models.user import User
from app.routers.memory.stores import todos_router


def main():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    Base.metadata.create_all(engine)
    with sessions() as db:
        user = User(username="manual_todo_owner", password_hash="unused", is_active=True)
        other = User(username="manual_todo_other", password_hash="unused", is_active=True)
        db.add_all([user, other])
        db.commit()
        owner_id, other_id = user.id, other.id

    def test_db():
        with sessions() as db:
            yield db

    app = FastAPI()
    app.include_router(todos_router)
    app.dependency_overrides[get_db] = test_db
    app.dependency_overrides[get_current_user] = lambda: user
    with TestClient(app) as client:
        response = client.post("/api/v1/todos", json={
            "content": "打印申请表", "surface_text": "打印申请表", "due_date": "2026-11-05T09:30:00+08:00",
        })
        assert response.status_code == 201, response.text
        todo = response.json()
        assert todo["status"] == "pending" and todo["kind"] == "待办"
        assert todo["surface_text"] == "打印申请表" and todo["has_time"] is True
        assert datetime.fromisoformat(todo["due_date"].replace("Z", "+00:00")) == datetime(2026, 11, 5, 1, 30, tzinfo=timezone.utc)
        todo_id = todo["id"]
        assert any(item["id"] == todo_id for item in client.get("/api/v1/todos").json())
        # 切换用户：手动添加不绕开现有隔离与记忆管理。
        app.dependency_overrides[get_current_user] = lambda: other
        assert client.get("/api/v1/todos").json() == []
        assert client.get(f"/api/v1/todos/{todo_id}").status_code == 404
        assert client.patch(f"/api/v1/todos/{todo_id}", json={"status": "done"}).status_code == 404
        app.dependency_overrides[get_current_user] = lambda: user
        date_only = client.post("/api/v1/todos", json={"content": "整理材料", "surface_text": "整理材料", "due_date": "2026-11-05T00:00:00+08:00"}).json()
        assert date_only["has_time"] is False
        undated = client.post("/api/v1/todos", json={"content": "想个点子", "surface_text": "想个点子"}).json()
        assert undated["due_date"] is None and undated["has_time"] is False
        done = client.patch(f"/api/v1/todos/{todo_id}", json={"status": "done"})
        assert done.status_code == 200 and done.json()["status"] == "done"
        assert done.json()["id"] != todo_id, "保留现有版本链行为"
    engine.dispose()
    print(f"PASS manual todo HTTP: create/list/timezone/date-only/undated/version-chain/user-isolation ({owner_id}/{other_id})")


if __name__ == "__main__":
    main()
