"""在部署服务器上执行单条命令（基于 deploy.py 的连接约定）。

用法：
    set MORNING_SSH_PASSWORD=...      # 或 $env:MORNING_SSH_PASSWORD=...
    uv run --with paramiko python deploy/ssh_exec.py "docker ps"
"""
from __future__ import annotations

import os
import sys

import paramiko

HOST = os.environ.get("MORNING_SSH_HOST", "223.109.142.152")
PORT = int(os.environ.get("MORNING_SSH_PORT", "22"))
USER = os.environ.get("MORNING_SSH_USER", "root")
PASSWORD = os.environ.get("MORNING_SSH_PASSWORD") or ""


def main() -> None:
    if not PASSWORD:
        sys.exit("缺少环境变量 MORNING_SSH_PASSWORD")
    if len(sys.argv) < 2:
        sys.exit("用法: ssh_exec.py <远程命令>")
    cmd = " ".join(sys.argv[1:])
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, port=PORT, username=USER, password=PASSWORD, timeout=25)
    _, stdout, stderr = client.exec_command(cmd, timeout=600)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()
    if out:
        print(out, end="")
    if err:
        print(err, end="", file=sys.stderr)
    client.close()
    sys.exit(code)


if __name__ == "__main__":
    main()
