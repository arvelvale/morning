"""【已停用】把 landing/dist 同步到 yingjiapp.com（107.155.55.76）。

2026-10-08 起停用：yingjiapp.com 是映记 / 栖光的域名（大创结题与竞赛演示要用），
/var/www/yinji-smart-diary 是它的网站根目录。喵灵官网改由 GitHub Pages 提供，
发布用 deploy/publish_site.py（https://arvelvale.github.io/morning-site/）。
这里保留代码只为留档；直接运行会退出，避免再次覆盖栖光的网站。
恢复栖光网站见 deploy/yingjiapp_site.py。
"""
from __future__ import annotations

import os
import sys
import tarfile
import tempfile
from pathlib import Path

import paramiko

HOST = os.environ.get("MORNING_SITE_HOST", "107.155.55.76")
USER = os.environ.get("MORNING_SITE_USER", "ubuntu")
PASSWORD = os.environ.get("MORNING_SSH_PASSWORD")
REPO = Path(__file__).resolve().parent.parent
DIST = REPO / "landing" / "dist"
WEB_ROOT = "/var/www/yinji-smart-diary"


def main() -> None:
    sys.exit("已停用：yingjiapp.com 归映记 / 栖光使用，喵灵官网请用 deploy/publish_site.py 发布到 GitHub Pages")
    if not PASSWORD:
        sys.exit("缺少 MORNING_SSH_PASSWORD")
    if not DIST.is_dir():
        sys.exit(f"找不到 dist: {DIST}")
    apks = sorted((DIST / "dl").glob("morning-android-*.apk"))
    if not apks:
        sys.exit("dist/dl 下没有 morning-android-*.apk")
    apk = apks[-1]
    print(f"[local] dist files={sum(1 for _ in DIST.rglob('*') if _.is_file())} apk={apk.name} {apk.stat().st_size}")

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, 22, USER, PASSWORD, timeout=30)

    def run(cmd: str, sudo: bool = False) -> str:
        if sudo:
            cmd = f"sudo {cmd}"
        _in, out, err = client.exec_command(cmd, timeout=600)
        text = out.read().decode("utf-8", "replace")
        code = out.channel.recv_exit_status()
        if code != 0:
            stderr = err.read().decode("utf-8", "replace")
            raise RuntimeError(f"远端失败({code}): {cmd}\n{stderr}")
        return text

    # discover writable web root
    listing = run("ls -ld /var/www/yinji-smart-diary /var/www/html 2>/dev/null; id; ls /var/www/yinji-smart-diary 2>/dev/null | head")
    print("[remote] context:\n" + listing)

    stamp = run("date +%Y%m%d-%H%M%S").strip()
    backup = f"/var/www/yinji-smart-diary-backups/yingjiapp-{stamp}.tar.gz"
    run(f"mkdir -p /var/www/yinji-smart-diary-backups")
    run(f"tar -czf {backup} -C {WEB_ROOT} .", sudo=True)
    print(f"[backup] {backup}")

    print("[upload] packing dist…")
    with tempfile.TemporaryDirectory() as td:
        tar_path = Path(td) / "landing-dist.tar.gz"
        with tarfile.open(tar_path, "w:gz") as tar:
            for p in sorted(DIST.rglob("*")):
                if p.is_file():
                    tar.add(p, arcname=str(p.relative_to(DIST)).replace("\\", "/"))
        sftp = client.open_sftp()
        remote_tar = f"/tmp/landing-dist-{stamp}.tar.gz"
        sftp.put(str(tar_path), remote_tar)
        sftp.close()
        print(f"    uploaded {tar_path.stat().st_size} bytes -> {remote_tar}")

    run(f"rm -rf /tmp/landing-extract-{stamp} && mkdir -p /tmp/landing-extract-{stamp}")
    run(f"tar -xzf {remote_tar} -C /tmp/landing-extract-{stamp}")
    run(
        f"rsync -a --delete /tmp/landing-extract-{stamp}/ {WEB_ROOT}/ && "
        f"chown -R www-data:www-data {WEB_ROOT} 2>/dev/null || chown -R ubuntu:ubuntu {WEB_ROOT}; "
        f"rm -rf /tmp/landing-extract-{stamp} {remote_tar}",
        sudo=True,
    )
    print(run(f"ls -l {WEB_ROOT} {WEB_ROOT}/dl", sudo=False))
    client.close()
    print("[done] landing synced to", HOST, WEB_ROOT)


if __name__ == "__main__":
    main()
