"""探测服务器状态：登录、发行版、CPU 架构、是否已装 docker。

用法（本地）：
    uv run --with paramiko python deploy/probe.py
密码从环境变量 MORNING_SSH_PASSWORD 读取，不写进仓库。
"""
import os
import sys

import paramiko

HOST = os.environ.get("MORNING_SSH_HOST", "223.109.142.152")
USER = os.environ.get("MORNING_SSH_USER", "root")
PASSWORD = os.environ.get("MORNING_SSH_PASSWORD")

if not PASSWORD:
    sys.exit("缺少环境变量 MORNING_SSH_PASSWORD")

CMDS = [
    "cat /etc/os-release | head -3",
    "uname -m",
    "nproc; free -m | head -2",
    "df -h / | tail -1",
    "(docker --version 2>/dev/null || echo 'docker: MISSING')",
    "(docker compose version 2>/dev/null || echo 'compose: MISSING')",
    "(command -v ufw >/dev/null && ufw status || echo 'ufw: MISSING')",
    "(command -v firewall-cmd >/dev/null && firewall-cmd --state || echo 'firewalld: MISSING')",
    "ss -lntp | head -20",
]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, port=22, username=USER, password=PASSWORD, timeout=20)
print(f"=== connected {USER}@{HOST} ===")
for cmd in CMDS:
    _in, out, err = client.exec_command(cmd, timeout=60)
    stdout = out.read().decode("utf-8", "replace").strip()
    stderr = err.read().decode("utf-8", "replace").strip()
    print(f"\n$ {cmd}\n{stdout or stderr}")
client.close()
