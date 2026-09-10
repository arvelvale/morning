"""把 APK 传到服务器并生成现场扫码下载的二维码。

APK 落在后端容器的 static 卷里（/app/static/download/），由 FastAPI 的 /static 直接托管，
不用另起 web 服务。二维码存到本地 deploy/ 下。

用法：
    $env:MORNING_SSH_PASSWORD='...'
    uv run --with paramiko --with "qrcode[pil]" python deploy/publish_apk.py
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

import paramiko
import qrcode

APK = Path(os.environ.get(
    "MORNING_APK",
    r"D:\bigproject\AdventureX\frontend-demo\android\app\build\outputs\apk\release\app-release.apk",
))
HOST = os.environ.get("MORNING_SSH_HOST", "223.109.142.152")
USER = os.environ.get("MORNING_SSH_USER", "root")
PASSWORD = os.environ.get("MORNING_SSH_PASSWORD")
VERIFY_ONLY = os.environ.get("MORNING_APK_VERIFY_ONLY", "").strip().lower() in {"1", "true", "yes"}
PUBLIC_BASE = os.environ.get("MORNING_PUBLIC_BASE", f"http://{HOST}:8000").rstrip("/")
REPO = Path(__file__).resolve().parent.parent
VERSION_TEMPLATE = REPO / "backend" / "app" / "app_version.json"
APP_JSON = REPO / "frontend-demo" / "app.json"
PACKAGE_JSON = REPO / "frontend-demo" / "package.json"
APP_GRADLE = REPO / "frontend-demo" / "android" / "app" / "build.gradle"

# 容器名 + 卷内路径（/app/static 是 morning-static 卷，由 /static 路由托管）
CONTAINER = "morning-backend"
REMOTE_TMP_ROOT = "/opt/morning"
IN_CONTAINER_DIR = "/app/static/download"
QR_PATH = Path(__file__).resolve().parent / "apk-download-qr.png"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _build_metadata() -> tuple[str, int]:
    text = APP_GRADLE.read_text(encoding="utf-8")
    code_match = re.search(r"\bversionCode\s+(\d+)", text)
    name_match = re.search(r'\bversionName\s+"([^"]+)"', text)
    if not code_match or not name_match:
        sys.exit("无法从 android/app/build.gradle 读取 versionCode/versionName")
    version = name_match.group(1)
    version_code = int(code_match.group(1))
    if not re.fullmatch(r"[0-9A-Za-z._-]+", version):
        sys.exit(f"versionName 含不安全字符，拒绝用于远端文件名：{version!r}")

    app_version = json.loads(APP_JSON.read_text(encoding="utf-8"))["expo"]["version"]
    package_version = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))["version"]
    if app_version != version or package_version != version:
        sys.exit(
            "版本号不一致："
            f"build.gradle={version}, app.json={app_version}, package.json={package_version}"
        )
    newest_source = max(APP_GRADLE.stat().st_mtime, APP_JSON.stat().st_mtime, PACKAGE_JSON.stat().st_mtime)
    if APK.stat().st_mtime < newest_source:
        sys.exit("APK 比版本配置旧，请先重新构建 release APK")
    return version, version_code


def _release_manifest() -> dict:
    version, version_code = _build_metadata()
    base = json.loads(VERSION_TEMPLATE.read_text(encoding="utf-8"))
    sha256 = _sha256(APK)
    size_bytes = APK.stat().st_size
    filename = f"morning-{version}.apk"
    return {
        **base,
        "latest": version,
        "version_code": version_code,
        "apk_url": f"{PUBLIC_BASE}/static/download/{filename}",
        "apk_sha256": sha256,
        "size_bytes": size_bytes,
        "size_mb": round(size_bytes / 1024 / 1024, 1),
    }


def main() -> None:
    if not APK.is_file():
        sys.exit(f"找不到 APK: {APK}")
    manifest = _release_manifest()
    version = manifest["latest"]
    filename = f"morning-{version}.apk"
    download_url = manifest["apk_url"]
    remote_apk_tmp = f"{REMOTE_TMP_ROOT}/.{filename}.tmp"
    remote_manifest_tmp = f"{REMOTE_TMP_ROOT}/.app_version.json.tmp"
    in_container_apk = f"{IN_CONTAINER_DIR}/{filename}"
    in_container_manifest = f"{IN_CONTAINER_DIR}/app_version.json"
    if not PASSWORD and not VERIFY_ONLY:
        sys.exit("缺少环境变量 MORNING_SSH_PASSWORD")
    print(
        f"[apk] {APK.name}  v{version}({manifest['version_code']})  "
        f"{manifest['size_mb']:.1f}MB  sha256={manifest['apk_sha256'][:12]}…"
    )

    client = None
    if not VERIFY_ONLY:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(HOST, 22, USER, PASSWORD, timeout=25)

    def run(cmd: str) -> str:
        assert client is not None
        _in, out, err = client.exec_command(cmd, timeout=600)
        text = out.read().decode("utf-8", "replace")
        code = out.channel.recv_exit_status()
        if code != 0:
            stderr = err.read().decode("utf-8", "replace")
            raise RuntimeError(f"远端命令失败({code}): {cmd}\n{stderr}")
        return text

    if not VERIFY_ONLY:
        print("[upload] 上传到服务器…")
        assert client is not None
        sftp = client.open_sftp()
        transferred = {"n": 0}

        def progress(sent: int, total: int) -> None:
            pct = int(sent * 100 / total) if total else 0
            if pct >= transferred["n"] + 20:
                transferred["n"] = pct
                print(f"    {pct}%  ({sent/1024/1024:.1f}/{total/1024/1024:.1f}MB)")

        sftp.put(str(APK), remote_apk_tmp, callback=progress)
        with sftp.file(remote_manifest_tmp, "w") as f:
            f.write(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
        sftp.close()

        print("[copy] 原子发布版本化 APK 与运行时清单…")
        run(f"docker exec {CONTAINER} mkdir -p {IN_CONTAINER_DIR}")
        run(f"docker cp {remote_apk_tmp} {CONTAINER}:{in_container_apk}.tmp")
        run(f"docker exec {CONTAINER} mv {in_container_apk}.tmp {in_container_apk}")
        # 保留固定文件名，兼容旧二维码；新版客户端使用版本化 URL，避免缓存拿到旧 APK。
        run(f"docker exec {CONTAINER} cp {in_container_apk} {IN_CONTAINER_DIR}/morning.apk.tmp")
        run(f"docker exec {CONTAINER} mv {IN_CONTAINER_DIR}/morning.apk.tmp {IN_CONTAINER_DIR}/morning.apk")
        remote_hash = run(f"docker exec {CONTAINER} sha256sum {in_container_apk}").split()[0]
        if remote_hash.lower() != manifest["apk_sha256"]:
            raise RuntimeError("服务器 APK SHA-256 与本地产物不一致，拒绝切换版本清单")
        run(f"docker cp {remote_manifest_tmp} {CONTAINER}:{in_container_manifest}.tmp")
        # 清单最后切换：客户端永远不会先看到尚未上传完成的新版本。
        run(f"docker exec {CONTAINER} mv {in_container_manifest}.tmp {in_container_manifest}")
        run(f"rm -f {remote_apk_tmp} {remote_manifest_tmp}")
        listing = run(f"docker exec {CONTAINER} ls -l {in_container_apk} {in_container_manifest}")
        print("    " + listing.strip())
        client.close()
    else:
        print("[upload] 仅校验模式，跳过重复上传")

    print("[check] 校验公网可下载…")
    request = urllib.request.Request(download_url, method="HEAD")
    with urllib.request.urlopen(request, timeout=30) as response:
        status = response.status
        length = int(response.headers.get("content-length") or 0)
        content_type = response.headers.get("content-type")
    print(f"    HEAD {status}  content-length={length/1024/1024:.1f}MB  type={content_type}")
    if status != 200 or length != manifest["size_bytes"]:
        sys.exit("公网下载校验失败")

    with urllib.request.urlopen(f"{PUBLIC_BASE}/api/v1/app/version", timeout=30) as response:
        published = json.loads(response.read().decode("utf-8"))
    for key in ("latest", "version_code", "apk_url", "apk_sha256", "size_bytes"):
        if published.get(key) != manifest.get(key):
            sys.exit(f"版本接口校验失败：{key} 未切换到本次发布值")

    print("[qr] 生成二维码…")
    qr = qrcode.QRCode(box_size=10, border=3, error_correction=qrcode.constants.ERROR_CORRECT_M)
    qr.add_data(download_url)
    qr.make(fit=True)
    qr.make_image(fill_color="black", back_color="white").save(QR_PATH)
    print(f"\n下载地址: {download_url}")
    print(f"二维码:   {QR_PATH}")


if __name__ == "__main__":
    main()
