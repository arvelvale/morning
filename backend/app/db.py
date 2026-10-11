"""SQLAlchemy 同步引擎；通过 DATABASE_URL 选择 SQLite 或 PostgreSQL。"""
from sqlalchemy import create_engine, event
from sqlalchemy.engine import make_url
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings

_settings = get_settings()

_db_url = make_url(_settings.database_url)
if _db_url.get_backend_name() not in {"sqlite", "postgresql"}:
    raise ValueError("DATABASE_URL 仅支持 SQLite 或 PostgreSQL")
_engine_options = {"pool_pre_ping": True}
if _db_url.get_backend_name() == "sqlite":
    _engine_options["connect_args"] = {"check_same_thread": False}
engine = create_engine(_db_url, **_engine_options)


# SQLite 启用 WAL + 外键约束
if engine.dialect.name == "sqlite":
    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_conn, _connection_record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    """FastAPI 依赖：yield 一个 session，请求结束自动关闭。"""
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()
