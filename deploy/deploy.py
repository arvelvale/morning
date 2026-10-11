"""把 Morning 后端部署到服务器并用 Docker 跑起来。

用法（本地仓库根目录）：
    set MORNING_SSH_PASSWORD=...      # 或 $env:MORNING_SSH_PASSWORD=...
    uv run --with paramiko python deploy/deploy.py [--step all|docker|sync|up|status]

做的事：
1. docker —— 装 Docker Engine + compose 插件（Ubuntu 22.04，走阿里云 apt 镜像）
2. backup —— 为当前镜像打回滚 tag，并生成 SQLite 一致性备份或 PostgreSQL pg_dump
3. sync   —— 上传 backend/ 源码 + docker-compose.yml，并生成线上 /opt/morning/.env
4. up     —— docker compose up -d --build
5. status —— 打印容器状态 + /health 探测

密钥处理：
- SSH 密码只从环境变量读，不写进仓库、不打日志。
- 线上 .env 的 STEPFUN_API_KEY / CAIYUN_* 从本地 backend/.env 透传；
  JWT_SECRET 每次首部署随机生成（已存在则复用，避免让已发出的 token 失效）。
- 脚本任何输出都不回显密钥内容，只打长度。
"""
from __future__ import annotations

import argparse
import os
import posixpath
import secrets
import stat
import sys
from pathlib import Path

import paramiko

HOST = os.environ.get("MORNING_SSH_HOST", "223.109.142.152")
PORT = int(os.environ.get("MORNING_SSH_PORT", "22"))
USER = os.environ.get("MORNING_SSH_USER", "root")
PASSWORD = os.environ.get("MORNING_SSH_PASSWORD") or ""

REPO = Path(__file__).resolve().parent.parent
BACKEND = REPO / "backend"
REMOTE_ROOT = "/opt/morning"
REMOTE_BACKEND = posixpath.join(REMOTE_ROOT, "backend")

# 只同步运行期需要的文件；.venv / db / 日志 / 本地 .env 一律不传
SYNC_DIRS = ["app", "alembic"]
SYNC_FILES = [
    "requirements.txt", "Dockerfile", ".dockerignore", "docker-entrypoint.sh", "alembic.ini",
    "scripts/migrate_sqlite_to_postgres.py",
]
SKIP_DIR_NAMES = {"__pycache__", ".venv", "static", "node_modules", ".pytest_cache"}
SKIP_SUFFIXES = {".pyc", ".pyo", ".log", ".err", ".db", ".db-wal", ".db-shm"}

# 从本地 backend/.env 透传到线上的键（其余用镜像内默认值）
PASSTHROUGH_KEYS = [
    "STEPFUN_API_KEY", "STEPFUN_BASE_URL", "STEPFUN_WS_BASE",
    "STEP_TEXT_MODEL", "STEP_IMAGE_MODEL",
    "STEP_ASR_FILE_MODEL", "STEP_ASR_STREAM_MODEL",
    "STEP_REALTIME_MODEL", "STEP_REALTIME_VOICE", "STEP_REALTIME_INSTRUCTIONS",
    "STEP_TTS_MODEL", "STEP_TTS_VOICE",
    "CAIYUN_APP_KEY", "CAIYUN_APP_SECRET", "CAIYUN_CACHE_MINUTES",
    "DREAMING_ENABLED", "PROACTIVE_ENABLED",
]

DOCKER_INSTALL = r"""
set -e
export DEBIAN_FRONTEND=noninteractive
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  echo "docker already installed: $(docker --version)"
  exit 0
fi
apt-get update -y
apt-get install -y --no-install-recommends ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
# 阿里云 Docker CE 镜像（国内服务器直连 download.docker.com 常超时）
curl -fsSL https://mirrors.aliyun.com/docker-ce/linux/ubuntu/gpg \
  | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://mirrors.aliyun.com/docker-ce/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'JSON'
{
  "registry-mirrors": [
    "https://docker.m.daocloud.io",
    "https://dockerproxy.com",
    "https://mirror.ccs.tencentyun.com"
  ],
  "log-driver": "json-file",
  "log-opts": {"max-size": "10m", "max-file": "3"}
}
JSON
systemctl enable docker
systemctl restart docker
docker --version && docker compose version
"""


def log(msg: str) -> None:
    print(f"[deploy] {msg}", flush=True)


def connect() -> paramiko.SSHClient:
    if not PASSWORD:
        sys.exit("缺少环境变量 MORNING_SSH_PASSWORD")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, port=PORT, username=USER, password=PASSWORD, timeout=25)
    return client


def run(client: paramiko.SSHClient, cmd: str, *, check: bool = True, quiet: bool = False) -> str:
    _in, out, err = client.exec_command(cmd, timeout=1800, get_pty=False)
    chunks: list[str] = []
    for line in iter(out.readline, ""):
        chunks.append(line)
        if not quiet:
            print("  " + line.rstrip(), flush=True)
    code = out.channel.recv_exit_status()
    stderr = err.read().decode("utf-8", "replace").strip()
    if stderr and not quiet:
        for line in stderr.splitlines():
            print("  ! " + line, flush=True)
    if check and code != 0:
        raise RuntimeError(f"远端命令失败({code}): {cmd}\n{stderr}")
    return "".join(chunks)


# ─── 步骤 1：安装 Docker ─────────────────────────────────────────────────────
def step_docker(client: paramiko.SSHClient) -> None:
    log("安装 / 校验 Docker Engine")
    sftp = client.open_sftp()
    with sftp.file("/tmp/install_docker.sh", "w") as f:
        f.write(DOCKER_INSTALL)
    sftp.close()
    run(client, "bash /tmp/install_docker.sh")


# ─── 步骤 2：发布前回滚点 ───────────────────────────────────────────────────
def step_backup(client: paramiko.SSHClient) -> None:
    """备份当前运行镜像和当前数据库；只写入 /opt/morning/backups。"""
    log("创建发布前回滚点")
    command = f"""set -eu
stamp=$(date +%Y%m%d-%H%M%S)
mkdir -p {REMOTE_ROOT}/backups
if ! docker inspect morning-backend >/dev/null 2>&1; then
  echo '当前容器不存在，跳过回滚镜像和数据库备份'
  exit 0
fi
database_kind=$(docker exec morning-backend python -c 'from app.db import engine; print(engine.dialect.name)')
if [ "$database_kind" != sqlite ] && [ "$database_kind" != postgresql ]; then
  echo '未知数据库类型，停止备份' >&2
  exit 1
fi
image=$(docker inspect -f '{{{{.Image}}}}' morning-backend)
tag=morning-backend:rollback-$stamp
docker tag "$image" "$tag"
echo "rollback_image=$tag"
if [ "$database_kind" = postgresql ]; then
  docker inspect morning-postgres >/dev/null 2>&1
  archive={REMOTE_ROOT}/backups/morning-$stamp.dump
  docker exec morning-postgres pg_dump -U morning -d morning -Fc > "$archive"
  chmod 600 "$archive"
  test -s "$archive"
  docker exec -i morning-postgres pg_restore -l < "$archive" >/dev/null
  echo "database_backup=$archive"
elif docker exec morning-backend test -f /data/morning.db; then
  inside=/data/morning-$stamp.db
  docker exec morning-backend python -c "import sqlite3; s=sqlite3.connect('/data/morning.db'); d=sqlite3.connect('$inside'); s.backup(d); d.close(); s.close()"
  docker cp morning-backend:$inside {REMOTE_ROOT}/backups/morning-$stamp.db >/dev/null
  docker exec morning-backend rm -f "$inside"
  chmod 600 {REMOTE_ROOT}/backups/morning-$stamp.db
  echo "database_backup={REMOTE_ROOT}/backups/morning-$stamp.db"
else
  echo '线上数据库不存在，跳过数据库备份'
fi
"""
    run(client, command)


# ─── 步骤 2：同步源码 + 生成线上 .env ────────────────────────────────────────
def _iter_local_files() -> list[tuple[Path, str]]:
    items: list[tuple[Path, str]] = []
    for name in SYNC_FILES:
        p = BACKEND / name
        if p.is_file():
            items.append((p, name))
    for d in SYNC_DIRS:
        root = BACKEND / d
        if not root.is_dir():
            continue
        for p in root.rglob("*"):
            if any(part in SKIP_DIR_NAMES for part in p.parts):
                continue
            if p.is_dir():
                continue
            if p.suffix in SKIP_SUFFIXES:
                continue
            items.append((p, p.relative_to(BACKEND).as_posix()))
    return items


def _mkdirs(sftp: paramiko.SFTPClient, remote_dir: str) -> None:
    parts = remote_dir.strip("/").split("/")
    cur = ""
    for part in parts:
        cur = f"{cur}/{part}"
        try:
            sftp.stat(cur)
        except FileNotFoundError:
            sftp.mkdir(cur)


def _local_env() -> dict[str, str]:
    env_path = BACKEND / ".env"
    values: dict[str, str] = {}
    if not env_path.is_file():
        return values
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        values[k.strip()] = v.strip().strip('"').strip("'")
    return values


def _remote_env(client: paramiko.SSHClient) -> dict[str, str]:
    raw = run(
        client,
        f"test -f {REMOTE_ROOT}/.env && cat {REMOTE_ROOT}/.env || true",
        check=False, quiet=True,
    )
    values: dict[str, str] = {}
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        values[k.strip()] = v.strip()
    return values


def step_sync(client: paramiko.SSHClient) -> None:
    log(f"同步源码到 {REMOTE_BACKEND}")
    run(client, f"mkdir -p {REMOTE_BACKEND}")
    # 清掉旧的 app/alembic，避免删除过的文件残留在线上
    run(client, f"rm -rf {REMOTE_BACKEND}/app {REMOTE_BACKEND}/alembic")

    sftp = client.open_sftp()
    files = _iter_local_files()
    made: set[str] = set()
    for local, rel in files:
        remote = posixpath.join(REMOTE_BACKEND, rel)
        parent = posixpath.dirname(remote)
        if parent not in made:
            _mkdirs(sftp, parent)
            made.add(parent)
        sftp.put(str(local), remote)
        if rel.endswith(".sh"):
            sftp.chmod(remote, stat.S_IRWXU | stat.S_IRGRP | stat.S_IXGRP | stat.S_IROTH | stat.S_IXOTH)
    log(f"已上传 {len(files)} 个文件")

    compose_local = REPO / "deploy" / "docker-compose.yml"
    sftp.put(str(compose_local), posixpath.join(REMOTE_ROOT, "docker-compose.yml"))
    log("已上传 docker-compose.yml")

    # ── 线上 .env ──
    local_env = _local_env()
    remote_env = _remote_env(client)
    jwt_secret = remote_env.get("JWT_SECRET") or secrets.token_urlsafe(48)
    reused = "复用线上已有" if remote_env.get("JWT_SECRET") else "新生成"

    lines = [
        "# Morning 线上环境变量（由 deploy/deploy.py 生成，请勿手改后又重跑同步）",
        # 切库后保持线上 PostgreSQL URL；默认部署仍沿用 SQLite。
        f"DATABASE_URL={remote_env.get('DATABASE_URL') or 'sqlite:////data/morning.db'}",
        *([f"MORNING_PG_PASSWORD={remote_env['MORNING_PG_PASSWORD']}"] if remote_env.get('MORNING_PG_PASSWORD') else []),
        f"JWT_SECRET={jwt_secret}",
        "CORS_ORIGINS=*",
    ]
    missing: list[str] = []
    for key in PASSTHROUGH_KEYS:
        # 本地未配置的线上密钥/开关沿用原值，避免一次同步意外清空现网配置。
        val = local_env.get(key) or remote_env.get(key)
        if val:
            lines.append(f"{key}={val}")
        elif key in ("STEPFUN_API_KEY",):
            missing.append(key)
    content = "\n".join(lines) + "\n"

    with sftp.file(posixpath.join(REMOTE_ROOT, ".env"), "w") as f:
        f.write(content)
    sftp.chmod(posixpath.join(REMOTE_ROOT, ".env"), stat.S_IRUSR | stat.S_IWUSR)
    sftp.close()
    log(f"已写入线上 .env（{len(lines)} 项，JWT_SECRET {reused}，权限 600）")
    if missing:
        log(f"警告：本地 backend/.env 缺少 {missing}，线上相关能力会不可用")


# ─── 步骤 3：起容器 ─────────────────────────────────────────────────────────
def step_up(client: paramiko.SSHClient) -> None:
    log("构建并启动容器（首次拉基础镜像可能要几分钟）")
    run(client, f"cd {REMOTE_ROOT} && docker compose up -d --build")


# ─── 步骤 4：状态 ───────────────────────────────────────────────────────────
def step_status(client: paramiko.SSHClient) -> None:
    log("容器状态")
    run(client, f"cd {REMOTE_ROOT} && docker compose ps", check=False)
    log("最近日志")
    run(client, f"cd {REMOTE_ROOT} && docker compose logs --tail 40 backend", check=False)
    log("本机 /health 探测")
    run(client, "curl -sS -m 10 http://127.0.0.1:8000/health; echo", check=False)
    log("监听端口")
    run(client, "ss -lntp | grep 8000 || echo '8000 未监听'", check=False)


def step_verify(client: paramiko.SSHClient) -> None:
    """发布验收：只输出非敏感状态、迁移版本和公开接口。"""
    log("发布后容器与迁移验收")
    run(client, "docker inspect -f 'status={{.State.Status}} health={{.State.Health.Status}} started={{.State.StartedAt}} image={{.Image}}' morning-backend")
    run(client, "docker exec morning-backend alembic current")
    run(client, "docker exec morning-backend python -c \"import importlib.metadata as m; print('jieba='+m.version('jieba'))\"")
    log("公开健康与版本接口")
    run(client, "curl -fsS -m 15 http://127.0.0.1:8000/health; echo")
    run(client, "curl -fsS -m 15 http://127.0.0.1:8000/api/v1/app/version; echo")
    log("线上 APK 文件")
    run(client, "docker exec morning-backend ls -ln /app/static/download/morning.apk")


STEPS = {
    "docker": step_docker,
    "backup": step_backup,
    "sync": step_sync,
    "up": step_up,
    "status": step_status,
    "verify": step_verify,
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--step", default="all",
        choices=["all", *STEPS.keys()],
    )
    args = parser.parse_args()

    client = connect()
    log(f"已连接 {USER}@{HOST}:{PORT}")
    try:
        names = list(STEPS) if args.step == "all" else [args.step]
        for name in names:
            STEPS[name](client)
    finally:
        client.close()
    log("完成")


if __name__ == "__main__":
    main()
