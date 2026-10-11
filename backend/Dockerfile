# Morning 后端镜像。SQLite 数据卷保留供迁移/回滚；PostgreSQL 由 DATABASE_URL 连接。
FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    # alembic 的 console script 不会把 cwd 放进 sys.path，env.py 需要 import app
    PYTHONPATH=/app \
    TZ=Asia/Shanghai

WORKDIR /app

# 只装运行期需要的系统包（tzdata 用于东八区定时任务；curl 供健康检查）
RUN apt-get update \
    && apt-get install -y --no-install-recommends tzdata curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY alembic ./alembic
COPY alembic.ini ./
COPY scripts/migrate_sqlite_to_postgres.py ./scripts/migrate_sqlite_to_postgres.py
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# /data 存 SQLite；/app/static 存 TTS 音频与生图。两者都由 compose 挂成命名卷，
# 容器重建不丢数据。
RUN mkdir -p /data /app/static/scene_images /app/static/tts_audio

ENV DATABASE_URL="sqlite:////data/morning.db"

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8000/health || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
# ⚠️ 保持单 worker（uvicorn 默认）：main.py 的定时调度器挂在进程内，
# 多 worker / 多副本会重复发晚间来信与周报。
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
