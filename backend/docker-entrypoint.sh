#!/usr/bin/env bash
# 容器入口：先把数据库弄对，再起 uvicorn。
#
# 空库建基线；已有版本库升级；无版本的历史 SQLite 补标记。
# 已有表但无版本的 PostgreSQL 拒绝启动，避免把迁移中断误判为完成。
#
# 与 AGENTS.md「dev 库由 create_all 建、模型变更必须同步写迁移」口径一致：
# 线上首次用 create_all 落基线，之后的字段变更全部靠 alembic。
set -euo pipefail

DB_STATE=$(python - <<'PY'
from sqlalchemy import inspect
from app.db import engine
names = set(inspect(engine).get_table_names())
if "alembic_version" in names:
    print("versioned")
elif not names:
    print("empty")
elif engine.dialect.name == "sqlite":
    print("legacy-sqlite")
else:
    print("unversioned-postgres")
PY
)

if [ "$DB_STATE" = "empty" ]; then
  echo "[entrypoint] 空库：create_all 建表"
  python - <<'PY'
from app.db import Base, engine
import app.models  # noqa: F401  注册全部模型
Base.metadata.create_all(bind=engine)
print("[entrypoint] create_all done")
PY
  alembic stamp head
  echo "[entrypoint] stamped head"
elif [ "$DB_STATE" = "legacy-sqlite" ]; then
    echo "[entrypoint] 库已存在但无 alembic_version：补建缺失表 + stamp head"
    python - <<'PY'
from app.db import Base, engine
import app.models  # noqa: F401
Base.metadata.create_all(bind=engine)   # checkfirst=True，已存在的表不动
print("[entrypoint] create_all (idempotent) done")
PY
    alembic stamp head
elif [ "$DB_STATE" = "versioned" ]; then
  echo "[entrypoint] alembic upgrade head"
  alembic upgrade head
else
  echo "[entrypoint] PostgreSQL 已有表但无版本记录，停止启动" >&2
  exit 1
fi

exec "$@"
