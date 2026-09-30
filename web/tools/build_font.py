# -*- coding: utf-8 -*-
"""构建网页版等宽 CJK 字体子集。

来源:Windows 自带 simsun.ttc 中的 NSimSun(新宋体)——真正的 2:1 双宽等宽字体,
半角 latin 恰好为全宽 CJK 的一半,是 xterm.js 网格对齐的关键。
字符集 = 游戏源码中出现的全部字符 + ASCII 可打印 + 少量备用。

用法:  py web/tools/build_font.py
输出:  web/legacy/fonts/abyss-mono.woff2

想换更现代的字体(如 Sarasa Mono SC):下载 TTF 后改 SOURCE_FONT 指向它重跑即可,
但必须保证"全角=2×半角"的等宽字体,否则 100 列网格会错位。
"""
import string
import sys
from pathlib import Path

from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent.parent   # abyss-idle/
SOURCE_FONT = Path(r"C:\Windows\Fonts\simsun.ttc")
FACE_INDEX = 1                                        # 0=SimSun 1=NSimSun(等宽)
OUT = ROOT / "web" / "legacy" / "fonts" / "abyss-mono.woff2"

EXTRA_CHARS = "“”‘’…—·〈〉《》〔〕"


def collect_charset():
    chars = set(string.printable)
    for py in (ROOT / "abyss").glob("*.py"):
        chars.update(py.read_text(encoding="utf-8"))
    for py in (ROOT / "web" / "legacy").glob("*.py"):
        chars.update(py.read_text(encoding="utf-8"))
    for html in (ROOT / "web" / "legacy").glob("*.html"):
        chars.update(html.read_text(encoding="utf-8"))
    chars.update(EXTRA_CHARS)
    # 去掉控制字符与空格(空格默认在)
    return {c for c in chars if ord(c) >= 32}


def main():
    if not SOURCE_FONT.exists():
        print("未找到系统字体 %s(仅 Windows 可用)" % SOURCE_FONT)
        return 1
    font = TTFont(str(SOURCE_FONT), fontNumber=FACE_INDEX)
    name = font["name"].getDebugName(4)
    print("源字体:%s" % name)

    opts = Options()
    opts.flavor = "woff2"
    opts.layout_features = ["*"]
    opts.hinting = True
    opts.desubroutinize = False
    opts.name_IDs = [1, 2, 3, 4, 6]
    opts.notdef_outline = True

    subsetter = Subsetter(options=opts)
    subsetter.populate(unicodes=[ord(c) for c in collect_charset()])
    subsetter.subset(font)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    font.save(str(OUT))
    size_kb = OUT.stat().st_size / 1024
    print("输出 %s (%.0f KB)" % (OUT, size_kb))
    return 0


if __name__ == "__main__":
    sys.exit(main())
