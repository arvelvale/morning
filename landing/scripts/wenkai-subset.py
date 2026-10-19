# -*- coding: utf-8 -*-
"""官网楷体（LXGW WenKai Screen）自托管切片：检查覆盖 / 补齐切片。

原作者 @rainRise（arvelvale/morning-site#2，selfhost_fonts.py + extract_charset.py），
移植进源码时改为读构建产物 landing/dist，而不是写死某个打包文件名。

为什么要检查：切片只覆盖官网「现在」用到的字。改文案冒出新字时，那几个字会悄悄回落成系统楷体，
所以 deploy/publish_site.py 构建后会先跑 --check，缺字就拦下发布。

用法（先 npm run build）：
  python landing/scripts/wenkai-subset.py --check   # 只检查，缺字退出码 1 并列出缺的字
  python landing/scripts/wenkai-subset.py           # 从 jsdelivr 补下缺的切片并重写本地 CSS
"""
from __future__ import annotations

import re
import sys
import time
import urllib.request
from pathlib import Path

LANDING = Path(__file__).resolve().parent.parent
DIST = LANDING / "dist"
FONT_DIR = LANDING / "public" / "assets" / "fonts"
FILES_DIR = FONT_DIR / "files"
LOCAL_CSS = FONT_DIR / "lxgw-wenkai-screen.css"
CDN = "https://cdn.jsdelivr.net/npm/lxgw-wenkai-screen-webfont@1.7.0/"
# CDN 的完整切片索引（97 个 @font-face 的 unicode-range），入库：检查时不用联网
CDN_CSS_CACHE = Path(__file__).resolve().parent / "lxgwwenkaiscreen.cdn.css"

# ASCII 与常用中文标点兜底（这些字出现在动态文案里，不一定是字面量）
EXTRA = {chr(c) for c in range(0x20, 0x7F)} | set(
    "，。、；：？！“”‘’（）《》〈〉【】—…·～￥%＋－×÷＝°℃①②③④⑤⑥⑦⑧⑨⑩★☆→←↑↓"
)


def _literals(text: str) -> str:
    """JS / HTML 里的字符串字面量与可见文本（粗粒度，宁多勿缺）。"""
    parts = re.findall(r'"((?:[^"\\\n]|\\.)*)"', text)
    parts += re.findall(r"'((?:[^'\\\n]|\\.)*)'", text)
    parts += re.findall(r"`((?:[^`\\]|\\.)*)`", text)
    return " ".join(parts)


def used_chars() -> set[int]:
    if not DIST.is_dir():
        sys.exit("找不到 landing/dist，先 npm run build")
    chars: set[str] = set(EXTRA)
    for js in list(DIST.glob("assets/*.js")) + [DIST / "pet-rig.js"]:
        if js.is_file():
            chars |= set(_literals(js.read_text(encoding="utf-8", errors="ignore")))
    html = (DIST / "index.html").read_text(encoding="utf-8", errors="ignore")
    chars |= set(re.sub(r"<[^>]+>", " ", html))
    return {ord(c) for c in chars if c.isprintable() and ord(c) >= 0x20 and not 0xD800 <= ord(c) <= 0xDFFF}


def parse_ranges(ur: str) -> set[int]:
    """'U+1f1e9-1f1f5, U+1f21a' → {码位}"""
    out: set[int] = set()
    for tok in ur.split(","):
        tok = tok.strip().upper().replace("U+", "")
        if not tok:
            continue
        if "-" in tok:
            a, b = tok.split("-")
            out.update(range(int(a, 16), int(b, 16) + 1))
        else:
            out.add(int(tok, 16))
    return out


def faces(css: str) -> list[dict]:
    out = []
    for block in re.findall(r"@font-face\s*\{([^}]+)\}", css):
        out.append({
            "family": re.search(r"font-family:\s*'([^']+)'", block).group(1),
            "weight": re.search(r"font-weight:\s*(\d+)", block).group(1),
            "file": re.search(r"url\('\./files/([^']+\.woff2)'\)", block).group(1),
            "range": re.search(r"unicode-range:\s*([^;}\n]+)", block).group(1).strip(),
        })
    return out


def fetch(url: str, tries: int = 6) -> bytes:
    last: Exception | None = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            return urllib.request.urlopen(req, timeout=60).read()
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(1.5 * (i + 1))
    raise RuntimeError(f"下载失败: {url} -> {last}")


def _cjk(cps: set[int]) -> str:
    return "".join(sorted(chr(c) for c in cps if c > 0x2E7F))


def _cdn_css() -> str:
    if CDN_CSS_CACHE.is_file():
        return CDN_CSS_CACHE.read_text(encoding="utf-8")
    css = fetch(CDN + "lxgwwenkaiscreen.css").decode()
    CDN_CSS_CACHE.write_text(css, encoding="utf-8", newline="\n")
    return css


def check() -> int:
    """只拦「楷体有、本地切片没带」的字；楷体字库本身就没有的字（如部分符号）不算缺。"""
    cps = used_chars()
    in_font: set[int] = set()
    for f in faces(_cdn_css()):
        in_font |= parse_ranges(f["range"])
    covered: set[int] = set()
    for f in faces(LOCAL_CSS.read_text(encoding="utf-8")):
        covered |= parse_ranges(f["range"])
    missing = _cjk((cps & in_font) - covered)
    if missing:
        print(f"[字体] 有 {len(missing)} 个字不在本地楷体切片里（会回落成系统字体）：{missing}")
        print("        运行：python landing/scripts/wenkai-subset.py   补齐切片后再发布")
        return 1
    print(f"[字体] 本地楷体切片覆盖了官网全部 {len(cps)} 个字符")
    return 0


def regenerate() -> int:
    cps = used_chars()
    css = _cdn_css()
    need, covered = [], set()
    for f in faces(css):
        hit = cps & parse_ranges(f["range"])
        if hit:
            need.append(f)
            covered |= hit
    FILES_DIR.mkdir(parents=True, exist_ok=True)
    for f in need:
        dest = FILES_DIR / f["file"]
        if not dest.is_file():
            dest.write_bytes(fetch(CDN + "files/" + f["file"]))
    lines = ["/* LXGW WenKai Screen 自托管切片（仅含官网用字覆盖的切片，源 v1.7.0；由 landing/scripts/wenkai-subset.py 生成） */"]
    for f in need:
        lines.append(
            "@font-face {\n"
            f"  font-family: '{f['family']}';\n"
            "  font-style: normal;\n"
            f"  font-weight: {f['weight']};\n"
            "  font-display: swap;\n"
            f"  src: url('./files/{f['file']}') format('woff2');\n"
            f"  unicode-range: {f['range']}\n"
            "}\n"
        )
    LOCAL_CSS.write_text("\n".join(lines), encoding="utf-8", newline="\n")
    keep = {f["file"] for f in need}
    stale = [p for p in FILES_DIR.glob("*.woff2") if p.name not in keep]
    print(f"[字体] 用到 {len(need)} 个切片，覆盖 {len(covered)}/{len(cps)} 个字符；"
          f"另有 {len(stale)} 个切片已不再需要（未自动删除）")
    rest = _cjk(cps - covered)
    if rest:
        print(f"[字体] 楷体本身不含这些字，会用系统字体：{rest}")
    return 0


if __name__ == "__main__":
    sys.exit(check() if "--check" in sys.argv[1:] else regenerate())
