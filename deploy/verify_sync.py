"""比对本地 backend 与线上 /opt/morning/backend 的运行期文件是否一致。

用法：$env:MORNING_SSH_PASSWORD='...'; uv run --with paramiko python deploy/verify_sync.py
只比对 deploy.py 实际会同步的那些文件（app/ + alembic/ + 少量根文件）。
一致返回 0，有差异返回 1 并列出具体文件——适合挂在部署前当检查。
"""
from __future__ import annotations

import hashlib
import os
import sys

import paramiko

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from deploy import (  # noqa: E402
    HOST, PASSWORD, PORT, REMOTE_BACKEND, USER, _iter_local_files,
)


def main() -> None:
    if not PASSWORD:
        sys.exit("缺少环境变量 MORNING_SSH_PASSWORD")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, port=PORT, username=USER, password=PASSWORD, timeout=25)

    # 远端一次性算出所有文件的 md5
    _in, out, _err = client.exec_command(
        f"cd {REMOTE_BACKEND} && find . -type f "
        r"\( -name '*.py' -o -name '*.txt' -o -name '*.ini' -o -name '*.sh' "
        r"-o -name '*.mako' -o -name 'Dockerfile' -o -name 'README' \) "
        "-not -path './__pycache__/*' -not -path '*/__pycache__/*' -exec md5sum {} + | sort",
        timeout=120,
    )
    remote: dict[str, str] = {}
    for line in out.read().decode("utf-8", "replace").splitlines():
        parts = line.split(None, 1)
        if len(parts) == 2:
            remote[parts[1].lstrip("./")] = parts[0]

    local = {
        rel: hashlib.md5(path.read_bytes()).hexdigest()
        for path, rel in _iter_local_files()
    }

    changed = sorted(r for r in local if remote.get(r) != local[r])
    only_local = {r for r in local if r not in remote}
    extra_remote = sorted(r for r in remote if r not in local)

    print(f"本地待同步文件: {len(local)}   线上匹配类型文件: {len(remote)}\n")
    if changed:
        print(f"⚠️  需要同步 {len(changed)} 个：")
        for r in changed:
            print(f"    [{'线上缺失' if r in only_local else '内容不同'}] {r}")
    else:
        print("✅ 所有待同步文件与线上完全一致（md5 相同）")
    if extra_remote:
        print(f"\nℹ️  线上多出 {len(extra_remote)} 个文件（本地已删除？）：")
        for r in extra_remote[:20]:
            print(f"    {r}")

    client.close()
    sys.exit(1 if changed else 0)


if __name__ == "__main__":
    main()
