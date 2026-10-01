# -*- coding: utf-8 -*-
"""生成 PWA 图标(192/512 + apple-touch 180):深渊之门风格 —— 深色渐变底 + 剑形符号。

用法: py scripts/make_icons.py
输出: src/web/public/icons/
"""
from PIL import Image, ImageDraw
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "src" / "web" / "public" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

BG_TOP = (26, 26, 43)      # 深渊夜色
BG_BOTTOM = (10, 10, 18)
BLADE = (255, 107, 107)    # 剑刃:标题红
GUARD = (154, 209, 255)    # 护手:冷蓝
GLOW = (255, 107, 107, 60)


def draw_icon(size: int) -> Image.Image:
    img = Image.new("RGB", (size, size))
    d = ImageDraw.Draw(img)
    # 垂直渐变底
    for y in range(size):
        t = y / size
        c = tuple(int(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * t) for i in range(3))
        d.line([(0, y), (size, y)], fill=c)
    s = size / 100.0
    cx, cy = size / 2, size / 2
    # 光晕(简单同心圆)
    for r, alpha in ((34 * s, 14), (28 * s, 22), (22 * s, 30)):
        d.ellipse([cx - r, cy - r, cx + r, cy + r],
                  fill=(40, 30, 40) if alpha < 20 else (55, 32, 40))
    # 剑刃(垂直菱形长条)
    blade = [(cx, 18 * s), (cx + 7 * s, 32 * s), (cx + 5 * s, 62 * s), (cx, 72 * s),
             (cx - 5 * s, 62 * s), (cx - 7 * s, 32 * s)]
    d.polygon(blade, fill=BLADE)
    # 护手横梁
    d.rounded_rectangle([cx - 26 * s, 62 * s, cx + 26 * s, 69 * s],
                        radius=3 * s, fill=GUARD)
    # 柄
    d.rounded_rectangle([cx - 3 * s, 69 * s, cx + 3 * s, 84 * s], radius=2 * s,
                        fill=(90, 90, 110))
    # 柄尾圆
    d.ellipse([cx - 6 * s, 84 * s, cx + 6 * s, 96 * s], fill=GUARD)
    return img


def main():
    for size, name in ((512, "icon-512.png"), (192, "icon-192.png"),
                       (180, "apple-touch-icon.png"), (96, "favicon-96.png")):
        draw_icon(size).save(OUT / name)
        print("OK", name)


if __name__ == "__main__":
    main()
