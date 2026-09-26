"""把设计稿打包成单文件：内联角色运行时，并只内嵌页面用到的霞鹜文楷字体分片。

霞鹜文楷 Screen 的 webfont 按 unicode-range 切成 97 片；这里先收集页面（含运行时里短片纸条的文字）
实际出现的字符，只下载覆盖这些字符的分片，转成 data URI 写进 @font-face，页面不再依赖外部字体服务。

运行：python design-demos/app-redesign/build.py   →  生成 index.html
"""
from __future__ import annotations

import base64
import re
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
RIG = HERE.parent.parent / "frontend-demo" / "src" / "pets" / "rig" / "pet-rig.js"
CDN = "https://cdn.jsdelivr.net/npm/lxgw-wenkai-screen-webfont@1.7.0/"
CSS = "lxgwwenkaiscreen.css"
CACHE = HERE / ".font-cache"


def fetch(url: str) -> bytes:
    name = CACHE / re.sub(r"[^\w.-]", "_", url.rsplit("/", 1)[-1])
    if name.exists():
        return name.read_bytes()
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=40) as r:
                data = r.read()
            CACHE.mkdir(exist_ok=True)
            name.write_bytes(data)
            return data
        except Exception as e:  # noqa: BLE001
            if attempt == 3:
                raise
            print(f"  retry {url}: {e}")
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(url)


def parse_ranges(spec: str) -> list[tuple[int, int]]:
    out = []
    for part in spec.split(","):
        part = part.strip().upper().removeprefix("U+")
        if "-" in part:
            a, b = part.split("-")
            out.append((int(a, 16), int(b, 16)))
        elif part:
            out.append((int(part, 16), int(part, 16)))
    return out


def main() -> None:
    src = (HERE / "index.src.html").read_text(encoding="utf-8")
    rig = RIG.read_text(encoding="utf-8")
    page = src.replace("/* __RIG__ */", rig.replace("</script", "<\\/script"))

    used = {ord(c) for c in page if ord(c) > 0x2000}
    used |= set(range(0x20, 0x7F))  # 标题里偶尔夹带的拉丁字符
    css = fetch(CDN + CSS).decode("utf-8")
    faces = []
    total = 0
    for block in re.findall(r"@font-face\s*{[^}]*}", css):
        url = re.search(r"url\('\./([^']+)'\)", block).group(1)
        range_spec = re.search(r"unicode-range:\s*([^;}]+)", block).group(1).strip()
        ranges = parse_ranges(range_spec)
        if not any(a <= c <= b for c in used for a, b in ranges):
            continue
        data = fetch(CDN + url)
        total += len(data)
        uri = "data:font/woff2;base64," + base64.b64encode(data).decode("ascii")
        faces.append(
            "@font-face{font-family:'LXGW WenKai Screen';font-style:normal;font-weight:400;font-display:swap;"
            f"src:url({uri}) format('woff2');unicode-range:{range_spec}}}"
        )
    page = page.replace("/* __FONTFACES__ */", "\n".join(faces))
    (HERE / "index.html").write_text(page, encoding="utf-8", newline="\n")
    print(f"faces={len(faces)} font={total / 1024:.0f}KB page={len(page.encode('utf-8')) / 1024:.0f}KB")


if __name__ == "__main__":
    main()
