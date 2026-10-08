"""把 yingjiapp.com（107.155.55.76）还给栖光 / 映记，并修好证书续期。

背景：2026-09-02 喵灵官网借用了这个域名（sync_landing_site.py 把 landing/dist 镜像到
/var/www/yinji-smart-diary，带 --delete），原来的栖光展示页和 qiguang-mobile-latest.apk 都被覆盖。
喵灵官网现在改由 GitHub Pages 提供（https://arvelvale.github.io/morning-site/），这台服务器的网站根目录
要恢复成栖光（映记的迭代版本），供大创结题与竞赛演示使用。栖光后端（/api、/uploads 反代）一直在跑，不受影响。

用法（在 AdventureX 根目录，由本人在终端里运行；密码运行时输入，不落盘、不打印）：
  python deploy/yingjiapp_site.py inspect                 # 只读：备份清单、备份内容、nginx 站点、证书与续期状态
  python deploy/yingjiapp_site.py restore <备份路径>       # 先把当前（喵灵）网站根目录另存一份，再用该备份恢复
  python deploy/yingjiapp_site.py renew-cert              # 续期证书并重载 nginx

每一步都打印执行结果，恢复前会自动备份当前内容，可随时再用 restore 换回。
"""
from __future__ import annotations

import argparse
import getpass
import os
import shlex
import sys

import paramiko

HOST = os.environ.get("YINGJI_SITE_HOST", "107.155.55.76")
USER = os.environ.get("YINGJI_SITE_USER", "ubuntu")
WEB_ROOT = "/var/www/yinji-smart-diary"
BACKUP_DIRS = ["/home/ubuntu/site-backups", "/var/www/yinji-smart-diary-backups"]
DOMAIN = "yingjiapp.com"


class Remote:
    def __init__(self) -> None:
        self.password = getpass.getpass(f"{USER}@{HOST} 的密码（输入时不显示）: ")
        self.client = paramiko.SSHClient()
        self.client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        self.client.connect(HOST, username=USER, password=self.password, timeout=20,
                            allow_agent=False, look_for_keys=False)
        # sudo 免密就直接用；需要密码时经 stdin 交给 sudo -S（不出现在命令行里）
        self.sudo_needs_pw = self.run("sudo -n true", check=False)[0] != 0

    def run(self, cmd: str, sudo: bool = False, check: bool = True, timeout: int = 600) -> tuple[int, str]:
        if sudo:
            cmd = f"sudo -S -p '' bash -c {shlex.quote(cmd)}" if self.sudo_needs_pw else f"sudo bash -c {shlex.quote(cmd)}"
        stdin, out, err = self.client.exec_command(cmd, timeout=timeout)
        if sudo and self.sudo_needs_pw:
            stdin.write(self.password + "\n")
            stdin.flush()
        text = out.read().decode("utf-8", "replace") + err.read().decode("utf-8", "replace")
        code = out.channel.recv_exit_status()
        if check and code != 0:
            sys.exit(f"[失败 exit {code}] {cmd}\n{text}")
        return code, text

    def show(self, title: str, cmd: str, sudo: bool = False) -> str:
        code, text = self.run(cmd, sudo=sudo, check=False)
        print(f"\n===== {title}  (exit {code})\n{text.rstrip()}")
        return text


def inspect(r: Remote) -> None:
    r.show("当前网站根目录（应为喵灵官网）", f"ls -la {WEB_ROOT} | head -30; grep -o '<title>[^<]*</title>' {WEB_ROOT}/index.html")
    r.show("备份清单", "ls -la --time-style=long-iso " + " ".join(BACKUP_DIRS) + " 2>&1")
    # 每个备份：文件数、首页标题、是否含栖光安装包
    script = r"""
for f in $(ls -1 %s 2>/dev/null | grep -E '\.tar\.gz$'); do
  for d in %s; do [ -f "$d/$f" ] && p="$d/$f"; done
  n=$(tar -tzf "$p" 2>/dev/null | wc -l)
  t=$(tar -xzOf "$p" ./index.html 2>/dev/null | grep -o '<title>[^<]*</title>' | head -1)
  [ -z "$t" ] && t=$(tar -xzOf "$p" index.html 2>/dev/null | grep -o '<title>[^<]*</title>' | head -1)
  apk=$(tar -tzvf "$p" 2>/dev/null | grep -E 'qiguang.*\.apk' | awk '{print $3, $6}' | tr '\n' ' ')
  echo "$p | 文件 $n | $t | 栖光安装包: ${apk:-无}"
done
""" % (" ".join(BACKUP_DIRS), " ".join(BACKUP_DIRS))
    r.show("各备份的内容概况", script, sudo=True)
    r.show("nginx 站点配置（server_name / root / location / 证书）",
           "grep -nE 'server_name|root |location|ssl_certificate|proxy_pass|return 30' /etc/nginx/sites-enabled/* 2>&1", sudo=True)
    r.show("证书", "certbot certificates 2>&1 | sed -n 1,40p", sudo=True)
    r.show("自动续期定时器", "systemctl list-timers --all 2>/dev/null | grep -i -E 'certbot|snap' ; ls /etc/cron.d 2>/dev/null; "
           "tail -n 40 /var/log/letsencrypt/letsencrypt.log 2>/dev/null | grep -iE 'error|fail|renew|challenge' | tail -15", sudo=True)
    r.show("续期演练（dry-run，不改动证书）", "certbot renew --dry-run 2>&1 | tail -25", sudo=True)
    r.show("栖光后端", "curl -s -m 10 -o /dev/null -w 'api/docs %{http_code}\\n' http://127.0.0.1/api/docs -H 'Host: yingjiapp.com'; "
           "systemctl list-units --type=service --state=running 2>/dev/null | grep -iE 'uvicorn|gunicorn|qiguang|bansheng|yinji|docker' ")


def restore(r: Remote, backup: str) -> None:
    code, _ = r.run(f"test -f {shlex.quote(backup)}", sudo=True, check=False)
    if code != 0:
        sys.exit(f"找不到备份：{backup}（先运行 inspect 看清单）")
    _, stamp = r.run("date +%Y%m%d-%H%M%S")
    stamp = stamp.strip()
    keep = f"/var/www/yinji-smart-diary-backups/miaoling-before-restore-{stamp}.tar.gz"
    r.run(f"mkdir -p /var/www/yinji-smart-diary-backups && tar -czf {keep} -C {WEB_ROOT} .", sudo=True)
    print(f"[备份] 当前内容已另存：{keep}")
    tmp = f"/tmp/yingjiapp-restore-{stamp}"
    r.run(f"rm -rf {tmp} && mkdir -p {tmp} && tar -xzf {shlex.quote(backup)} -C {tmp}", sudo=True)
    # 有的备份打包时多了一层目录：若解出来只有一个目录且其中有 index.html，就以它为根
    _, inner = r.run(f"cd {tmp} && if [ ! -f index.html ] && [ $(ls -1 | wc -l) = 1 ] && [ -f \"$(ls -1)/index.html\" ]; then echo \"$(ls -1)\"; fi", sudo=True)
    src = f"{tmp}/{inner.strip()}" if inner.strip() else tmp
    r.run(f"test -f {src}/index.html", sudo=True)
    r.run(f"rsync -a --delete {src}/ {WEB_ROOT}/ && (chown -R www-data:www-data {WEB_ROOT} || true) && rm -rf {tmp}", sudo=True)
    print(f"[恢复] {backup} -> {WEB_ROOT}")
    r.show("恢复后的网站根目录", f"ls -la {WEB_ROOT} | head -30; grep -o '<title>[^<]*</title>' {WEB_ROOT}/index.html")
    r.show("线上自检", f"curl -s -m 15 https://{DOMAIN}/ | grep -o '<title>[^<]*</title>'; "
           f"curl -s -m 15 -o /dev/null -w 'apk %{{http_code}} %{{content_type}} %{{size_download}}B\\n' -r 0-0 https://{DOMAIN}/qiguang-mobile-latest.apk; "
           f"curl -s -m 15 -o /dev/null -w 'api/docs %{{http_code}}\\n' https://{DOMAIN}/api/docs")


def renew_cert(r: Remote) -> None:
    r.show("续期", "certbot renew 2>&1 | tail -25", sudo=True)
    r.show("重载 nginx", "nginx -t 2>&1 && systemctl reload nginx && echo reloaded", sudo=True)
    r.show("线上证书", f"echo | openssl s_client -connect 127.0.0.1:443 -servername {DOMAIN} 2>/dev/null | openssl x509 -noout -subject -dates")


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("inspect")
    p = sub.add_parser("restore")
    p.add_argument("backup")
    sub.add_parser("renew-cert")
    args = ap.parse_args()
    r = Remote()
    try:
        if args.cmd == "inspect":
            inspect(r)
        elif args.cmd == "restore":
            restore(r, args.backup)
        else:
            renew_cert(r)
    finally:
        r.client.close()


if __name__ == "__main__":
    main()
