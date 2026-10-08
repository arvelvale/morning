"""把官网和安装包发布到公开仓库 arvelvale/morning-site（GitHub Pages + Release）。

为什么要分仓库：morning 是私有仓库，GitHub Pages 只能从公开仓库发布，而公开仓库的源码也就公开了。
所以这里只把「构建产物」推到公开的 morning-site：
- 官网：landing/dist（不含 dl/ 下的安装包）→ morning-site 的 main 分支 → https://arvelvale.github.io/morning-site/
- 安装包：作为 Release 附件挂在 morning-site 上，匿名可下载（私有仓库的附件匿名下载会 404）

依赖：本机已登录 gh（`gh auth status`），且账号对 arvelvale/morning-site 有写权限。
用法（在 AdventureX 根目录）：
  python deploy/publish_site.py            # 构建 + 推送 + 发 Release + 校验
  python deploy/publish_site.py --skip-build   # 复用已有的 landing/dist（不重新构建）

脚本不读取、不打印任何密码或 token。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LANDING = ROOT / "landing"
DIST = LANDING / "dist"
DL = LANDING / "public" / "dl"
SITE_REPO = "arvelvale/morning-site"
SITE_BASE = "/morning-site/"
PAGES_URL = f"https://arvelvale.github.io{SITE_BASE}"
NODE_DIR = r"D:\deps\nodejs"


def run(cmd: list[str], cwd: Path | None = None, check: bool = True, capture: bool = False) -> str:
    env = os.environ.copy()
    env["PATH"] = NODE_DIR + os.pathsep + env.get("PATH", "")
    env["PATHEXT"] = ".COM;.EXE;.BAT;.CMD"
    # 不允许任何子进程停下来等输入（git 的密码框、gh 的交互提示都会让脚本永远挂住）
    env["GIT_TERMINAL_PROMPT"] = "0"
    env["GH_PROMPT_DISABLED"] = "1"
    print("$", " ".join(cmd), flush=True)
    res = subprocess.run(cmd, cwd=cwd, env=env, capture_output=capture, text=True, encoding="utf-8",
                         errors="replace", stdin=subprocess.DEVNULL, timeout=900)
    if check and res.returncode != 0:
        out = (res.stdout or "") + (res.stderr or "")
        sys.exit(f"命令失败（exit {res.returncode}）：{' '.join(cmd)}\n{out[-2000:]}")
    return (res.stdout or "").strip() if capture else ""


def package_version() -> str:
    return json.loads((ROOT / "frontend-demo" / "package.json").read_text(encoding="utf-8"))["version"]


def build_site() -> None:
    env = os.environ.copy()
    env["VITE_SITE_BASE"] = SITE_BASE
    env["PATH"] = NODE_DIR + os.pathsep + env.get("PATH", "")
    print("$ npm run build  (VITE_SITE_BASE=%s)" % SITE_BASE, flush=True)
    res = subprocess.run(["npm.cmd", "run", "build"], cwd=LANDING, env=env, capture_output=True, text=True,
                         encoding="utf-8", errors="replace", stdin=subprocess.DEVNULL, timeout=600)
    if res.returncode != 0:
        sys.exit("官网构建失败:\n" + (res.stdout + res.stderr)[-2000:])


def ensure_repo() -> None:
    for _ in range(3):
        res = subprocess.run(["gh", "repo", "view", SITE_REPO, "--json", "visibility", "--jq", ".visibility"],
                             capture_output=True, text=True, encoding="utf-8", errors="replace", stdin=subprocess.DEVNULL)
        if res.returncode == 0:
            break
        time.sleep(5)
    if res.returncode != 0:
        sys.exit(f"找不到仓库 {SITE_REPO}，先执行 gh repo create {SITE_REPO} --public")
    if res.stdout.strip() != "PUBLIC":
        sys.exit(f"{SITE_REPO} 不是公开仓库（{res.stdout.strip()}），GitHub Pages 无法发布")


def stage_site(workdir: Path) -> None:
    """把 dist 复制进 morning-site 的工作目录，但不带安装包（安装包走 Release）。"""
    for child in workdir.iterdir():
        if child.name == ".git":
            continue
        shutil.rmtree(child) if child.is_dir() else child.unlink()
    shutil.copytree(DIST, workdir, dirs_exist_ok=True)
    shutil.rmtree(workdir / "dl", ignore_errors=True)
    # 站点自己的说明文件，告诉来访者源码在哪里（不暴露私有仓库的内容）
    (workdir / "README.md").write_text(
        "# 喵灵官网\n\n"
        "这是喵灵官网的发布仓库，只包含构建好的网页与安装包（Release）。源码不在这里。\n\n"
        f"- 官网：{PAGES_URL}\n"
        f"- 安装包：见 https://github.com/{SITE_REPO}/releases\n",
        encoding="utf-8",
    )


def push_site(version: str) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp) / "site"
        # 网络偶发断开（GraphQL EOF）时重试；仓库是空的时克隆也会给出 warning，不算失败
        for attempt in range(3):
            res = subprocess.run(["gh", "repo", "clone", SITE_REPO, str(work), "--", "--depth", "1"],
                                 capture_output=True, text=True, encoding="utf-8", errors="replace", stdin=subprocess.DEVNULL)
            if res.returncode == 0 and (work / ".git").exists():
                break
            print(f"克隆失败，第 {attempt + 1} 次重试…")
            shutil.rmtree(work, ignore_errors=True)
            time.sleep(5)
        else:
            sys.exit("多次克隆 morning-site 失败，检查网络与 gh 登录状态")
        stage_site(work)
        # 关掉换行转换：这里是构建产物，不能被 Windows 的 autocrlf 改动
        run(["git", "-c", "core.autocrlf=false", "add", "-A"], cwd=work)
        status = run(["git", "status", "--porcelain"], cwd=work, capture=True)
        if not status:
            print("官网内容没有变化，跳过提交")
            return
        run(["git", "-c", "core.autocrlf=false", "-c", "user.name=arvelvale",
             "-c", "user.email=arvelvale@users.noreply.github.com",
             "commit", "-q", "-m", f"publish: 官网 {version}"], cwd=work)
        run(["git", "push", "-q", "origin", "HEAD:main"], cwd=work)


def ensure_pages() -> None:
    """开启 GitHub Pages：main 分支根目录。已开启则不重复创建。"""
    res = subprocess.run(["gh", "api", f"repos/{SITE_REPO}/pages"], capture_output=True, text=True, encoding="utf-8", errors="replace", stdin=subprocess.DEVNULL)
    if res.returncode == 0:
        print("GitHub Pages 已开启")
        return
    run(["gh", "api", "-X", "POST", f"repos/{SITE_REPO}/pages",
         "-f", "source[branch]=main", "-f", "source[path]=/"])
    print("已开启 GitHub Pages")


def publish_release(version: str) -> None:
    tag = f"v{version}"
    assets = [DL / f"morning-android-{version}.apk", DL / "morning-harmony.hap"]
    for path in assets:
        if not path.exists():
            sys.exit(f"缺少安装包：{path}")
    res = subprocess.run(["gh", "release", "view", tag, "--repo", SITE_REPO], capture_output=True, text=True, encoding="utf-8", errors="replace", stdin=subprocess.DEVNULL)
    if res.returncode != 0:
        run(["gh", "release", "create", tag, "--repo", SITE_REPO,
             "--title", f"喵灵 {tag}", "--notes", f"喵灵 {tag} 安装包。Android APK 与 HarmonyOS 包。"]
            + [str(a) for a in assets])
    else:
        run(["gh", "release", "upload", tag, "--repo", SITE_REPO, "--clobber"] + [str(a) for a in assets])
    # 鸿蒙包的 tag 固定为 v0.1-beta（官网链接里写的是这个），与 Android 的版本 tag 分开
    harmony = DL / "morning-harmony.hap"
    res = subprocess.run(["gh", "release", "view", "v0.1-beta", "--repo", SITE_REPO], capture_output=True, text=True, encoding="utf-8", errors="replace", stdin=subprocess.DEVNULL)
    if res.returncode != 0:
        run(["gh", "release", "create", "v0.1-beta", "--repo", SITE_REPO, "--prerelease",
             "--title", "喵灵 HarmonyOS 0.1 Beta", "--notes", "喵灵 HarmonyOS NEXT 测试版安装包。", str(harmony)])


def verify(version: str) -> None:
    apk = DL / f"morning-android-{version}.apk"
    expect = hashlib.sha256(apk.read_bytes()).hexdigest()
    # 等 Pages 构建完（最多约 3 分钟）
    # 下载地址编译进了 JS 包，所以要读页面引用的 JS，而不是 HTML
    deadline = time.time() + 180
    found = False
    while time.time() < deadline and not found:
        try:
            with urllib.request.urlopen(PAGES_URL, timeout=20) as r:
                html = r.read().decode("utf-8", "replace")
            for src in set(re.findall(r'src="(/morning-site/assets/[^"]+\.js)"', html)):
                with urllib.request.urlopen("https://arvelvale.github.io" + src, timeout=30) as r:
                    if f"morning-android-{version}.apk".encode() in r.read():
                        found = True
        except Exception as e:  # noqa: BLE001
            print("等待 Pages:", e)
        if not found:
            time.sleep(10)
    if not found:
        sys.exit("官网的脚本里还没有新安装包的地址，Pages 可能还在构建，稍后再查")
    print("官网：OK", PAGES_URL)
    url = f"https://github.com/{SITE_REPO}/releases/download/v{version}/morning-android-{version}.apk"
    # 匿名下载（不带 token）校验哈希，证明别人真的能下
    got = hashlib.sha256()
    with urllib.request.urlopen(url, timeout=120) as r:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            got.update(chunk)
    if got.hexdigest() != expect:
        sys.exit(f"匿名下载的 APK 哈希不一致：{got.hexdigest()} != {expect}")
    print("安装包匿名下载：OK", url, expect[:16])


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-build", action="store_true")
    args = ap.parse_args()
    version = package_version()
    if not args.skip_build:
        build_site()
    if not DIST.exists():
        sys.exit("landing/dist 不存在，先构建")
    ensure_repo()
    push_site(version)
    ensure_pages()
    publish_release(version)
    verify(version)


if __name__ == "__main__":
    main()
