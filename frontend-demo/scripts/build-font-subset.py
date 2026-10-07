"""生成 App 标题字体：霞鹜文楷 Screen 的常用字子集。

只用在标题和米露说的话上，正文、按钮仍用系统字体。
字集 = GB2312 一级 + 二级汉字（7445 个）+ 全角标点 + ASCII + App 源码里出现过的所有字符，
约 3.7MB。不在子集里的生僻字由系统字体逐字兜底。

授权：霞鹜文楷为 SIL OFL 1.1。子集属于「修改版」，按 OFL 的保留字体名条款改名为
「Miaoling Kai」后随 App 分发，原版权声明与 OFL 全文见 assets/fonts/OFL.txt。

运行（需要 fontTools）：
  python scripts/build-font-subset.py <LXGWWenKaiScreen.ttf 完整版路径>
完整版下载：https://github.com/lxgw/LxgwWenKai-Screen/releases/latest/download/LXGWWenKaiScreen.ttf
"""
from __future__ import annotations

import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "fonts" / "MiaolingKai.ttf"
FAMILY = "Miaoling Kai"
POSTSCRIPT = "MiaolingKai"


def gb2312(rows: range) -> set[str]:
    out = set()
    for hi in rows:
        for lo in range(0xA1, 0xFF):
            try:
                out.add(bytes([hi, lo]).decode("gb2312"))
            except UnicodeDecodeError:
                pass
    return out


def source_chars() -> set[str]:
    out = set()
    files = list((ROOT / "src").rglob("*.ts")) + list((ROOT / "src").rglob("*.tsx")) + [ROOT / "App.tsx"]
    for p in files:
        if "generated" in p.name:
            continue
        out |= {c for c in p.read_text(encoding="utf-8", errors="ignore") if ord(c) > 0x2000}
    return out


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    chars = gb2312(range(0xA1, 0xAA)) | gb2312(range(0xB0, 0xF8)) | source_chars()
    chars |= {chr(i) for i in range(0x20, 0x7F)}
    font = TTFont(sys.argv[1])
    opts = subset.Options()
    opts.hinting = False
    opts.layout_features = ["*"]
    opts.notdef_outline = True
    sub = subset.Subsetter(opts)
    sub.populate(text="".join(chars))
    sub.subset(font)
    # 保留字体名条款：修改版不能沿用「霞鹜 / LXGW」名字
    for rec in font["name"].names:
        if rec.nameID in (1, 4, 16, 18):
            rec.string = FAMILY
        elif rec.nameID == 3:
            rec.string = f"{POSTSCRIPT}-Regular;subset"
        elif rec.nameID == 6:
            rec.string = POSTSCRIPT
    OUT.parent.mkdir(parents=True, exist_ok=True)
    font.save(OUT)
    print(f"{len(chars)} chars → {OUT} ({OUT.stat().st_size / 1024 / 1024:.1f} MB)")


if __name__ == "__main__":
    main()
