#!/usr/bin/env python3
"""不用 docker pull，直接从镜像源 HTTP API 下载 OCI 镜像并导入 docker。

用法: python3 pull_oci.py [registry] [repo] [tag]
默认: docker.1panel.live easysoft/zentao 21.7
"""
import json
import os
import subprocess
import sys
import tarfile
import time
import urllib.request

REG = sys.argv[1] if len(sys.argv) > 1 else "docker.1panel.live"
REPO = sys.argv[2] if len(sys.argv) > 2 else "easysoft/zentao"
TAG = sys.argv[3] if len(sys.argv) > 3 else "21.7"
WORK = "/root/oci-image"
BLOBS = os.path.join(WORK, "blobs", "sha256")

ACCEPT = ", ".join([
    "application/vnd.oci.image.index.v1+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
    "application/vnd.oci.image.manifest.v1+json",
    "application/vnd.docker.distribution.manifest.v2+json",
])


def http_get(url, accept=None, retries=5):
    for i in range(retries):
        try:
            req = urllib.request.Request(url)
            req.add_header("User-Agent", "curl/8.5.0")
            if accept:
                req.add_header("Accept", accept)
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read(), r.headers.get("Content-Type", "")
        except Exception as e:
            print(f"  retry {i + 1}/{retries} {url}: {e}", flush=True)
            time.sleep(3 * (i + 1))
    raise SystemExit(f"FAILED: {url}")


CHUNK = 8 * 1024 * 1024


def download_blob(digest):
    hexid = digest.split(":", 1)[1]
    dest = os.path.join(BLOBS, hexid)
    url = f"https://{REG}/v2/{REPO}/blobs/{digest}"
    if os.path.exists(dest):
        print(f"  blob {hexid[:12]} cached", flush=True)
        return
    tmp = dest + ".part"
    got = os.path.getsize(tmp) if os.path.exists(tmp) else 0
    total = None
    print(f"  blob {hexid[:12]} downloading (resume at {got // 1024}KB)...", flush=True)
    while total is None or got < total:
        # 每个分片用全新连接：镜像站按单连接累计流量掐断，分段可绕过
        want = CHUNK if total is None else min(CHUNK, total - got)
        req = urllib.request.Request(url)
        req.add_header("User-Agent", "curl/8.5.0")
        req.add_header("Range", f"bytes={got}-{got + want - 1}")
        req.add_header("Connection", "close")
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                if total is None:
                    cr = r.headers.get("Content-Range", "")
                    total = int(cr.split("/")[-1]) if "/" in cr else int(r.headers.get("Content-Length", "0")) + got
                data = r.read()
            if not data:
                raise ConnectionError("empty chunk")
            with open(tmp, "ab") as f:
                f.write(data)
            got += len(data)
        except Exception as e:
            print(f"  chunk retry at {got // 1024}KB: {e}", flush=True)
            time.sleep(3)
    os.replace(tmp, dest)
    print(f"  blob {hexid[:12]} ok ({got // 1024}KB)", flush=True)


def main():
    os.makedirs(BLOBS, exist_ok=True)
    murl = f"https://{REG}/v2/{REPO}/manifests/{TAG}"
    raw, ctype = http_get(murl, ACCEPT)
    doc = json.loads(raw)
    # 若是 index/list，取 amd64 的 manifest
    if "manifests" in doc:
        pick = None
        for m in doc["manifests"]:
            p = m.get("platform", {})
            if p.get("architecture") == "amd64" and p.get("os") == "linux":
                pick = m["digest"]
                break
        if not pick:
            raise SystemExit("no amd64 manifest in index")
        raw, ctype = http_get(f"https://{REG}/v2/{REPO}/manifests/{pick}", ACCEPT)
        doc = json.loads(raw)
    manifest = doc
    download_blob(manifest["config"]["digest"])
    for layer in manifest["layers"]:
        download_blob(layer["digest"])
    # OCI layout
    mhex = hashlib_hex(raw)
    with open(os.path.join(BLOBS, mhex), "wb") as f:
        f.write(raw)
    index = {
        "schemaVersion": 2,
        "mediaType": "application/vnd.oci.image.index.v1+json",
        "manifests": [{
            "mediaType": manifest.get("mediaType", "application/vnd.oci.image.manifest.v1+json"),
            "digest": f"sha256:{mhex}",
            "size": len(raw),
            "annotations": {"org.opencontainers.image.ref.name": TAG},
        }],
    }
    with open(os.path.join(WORK, "index.json"), "w") as f:
        json.dump(index, f)
    with open(os.path.join(WORK, "oci-layout"), "w") as f:
        json.dump({"imageLayoutVersion": "1.0.0"}, f)
    tarpath = "/root/oci-image.tar"
    with tarfile.open(tarpath, "w") as tar:
        tar.add(WORK, arcname=".")
    print("importing...", flush=True)
    ns = subprocess.run(["ctr", "-n", "moby", "images", "import", tarpath],
                        capture_output=True, text=True)
    print(ns.stdout, ns.stderr, flush=True)
    if ns.returncode != 0:
        raise SystemExit("ctr import failed")
    ref = f"docker.io/{REG}/{REPO}:{TAG}"
    subprocess.run(["ctr", "-n", "moby", "images", "tag", ref, f"docker.io/easysoft/zentao:{TAG}"],
                   capture_output=True)
    out = subprocess.run(["docker", "images"], capture_output=True, text=True).stdout
    print(out, flush=True)
    print("DONE_OK", flush=True)


def hashlib_hex(data):
    import hashlib
    return hashlib.sha256(data).hexdigest()


if __name__ == "__main__":
    main()
