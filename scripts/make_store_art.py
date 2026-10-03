# -*- coding: utf-8 -*-
"""生成 TapTap 商店美术素材:图标 512 + 横版宣传图 1920×1080 + 竖版 1080×1920。
深渊风:暗色渐变 + 径向辉光 + DCSS 像素怪物(CC0)+ 游戏名。
用法: py scripts/make_store_art.py   → 输出 store-assets/
规范注意:宣传图仅含游戏名,不拼图不平铺不截屏;图标内容留圆角裁剪安全区。
"""
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MON = ROOT / "dist-taptap" / "mon"
OUT = ROOT / "store-assets"
OUT.mkdir(exist_ok=True)

FZH = "C:/Windows/Fonts/msyhbd.ttc"   # 微软雅黑 Bold
FZH_R = "C:/Windows/Fonts/msyh.ttc"
GOLD = (255, 217, 74)
RED = (255, 107, 107)


def font(path, size):
    return ImageFont.truetype(path, size, index=0)


def sprite(name: str) -> Image.Image:
    return Image.open(MON / f"{name}.png").convert("RGBA")


def vgrad(w, h, top, bottom):
    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / max(1, h - 1)
        d.line([(0, y), (w, y)],
               fill=tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    return img


def glow_layer(size, cx, cy, radius, color, steps=26):
    """以 (cx,cy) 为中心的柔光。"""
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for i in range(steps, 0, -1):
        r = radius * i / steps
        a = int(46 * (1 - i / steps) ** 1.6) + 2
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color + (a,))
    return layer.filter(ImageFilter.GaussianBlur(radius * 0.08))


def paste_px(base, name, scale, cx, cy, fade=1.0, outline=False):
    """近邻放大像素画并贴到 base(cx,cy=中心),fade<1 压暗作景深;
    outline=True 时先垫 2px 亮色剪影,提亮主体轮廓。"""
    sp = sprite(name)
    s = sp.resize((sp.width * scale, sp.height * scale), Image.NEAREST)
    if fade < 1.0:
        r, g, b, a = s.split()
        r = r.point(lambda v: int(v * fade))
        g = g.point(lambda v: int(v * fade))
        b = b.point(lambda v: int(v * fade))
        s = Image.merge("RGBA", (r, g, b, a))
    pos = (int(cx - s.width / 2), int(cy - s.height / 2))
    if outline:
        dil = s.split()[3].filter(ImageFilter.MaxFilter(5))
        sil = Image.new("RGBA", s.size, (185, 195, 235, 255))
        sil.putalpha(dil.point(lambda a: int(a * 0.85)))
        base.alpha_composite(sil, pos)
    base.alpha_composite(s, pos)
    return s.size


def ground_shadow(base, cx, cy, w, h, alpha=90):
    sh = Image.new("RGBA", base.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).ellipse([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2],
                               fill=(0, 0, 0, alpha))
    base.alpha_composite(sh.filter(ImageFilter.GaussianBlur(6)))


def title_text(d, xy, text, f, fill=GOLD, stroke=8, stroke_fill=(8, 8, 14)):
    d.text(xy, text, font=f, fill=fill, anchor="mm",
           stroke_width=stroke, stroke_fill=stroke_fill)


# ---------------------------------------------------------------- 图标 512
def make_icon():
    S = 512
    img = vgrad(S, S, (26, 26, 43), (8, 8, 16)).convert("RGBA")
    img.alpha_composite(glow_layer((S, S), S / 2, S * 0.44, S * 0.46, (120, 60, 160)))
    img.alpha_composite(glow_layer((S, S), S / 2, S * 0.44, S * 0.22, RED))
    ground_shadow(img, S / 2, S * 0.60, S * 0.42, S * 0.065)
    paste_px(img, "drake-boss", 7, S / 2, S * 0.42, outline=True)
    d = ImageDraw.Draw(img)
    title_text(d, (S / 2, S * 0.80), "深渊", font(FZH, 112))
    img.convert("RGB").save(OUT / "icon-512-new.png")
    print("OK icon-512-new.png")


# ---------------------------------------------------------------- 横版 1920×1080
def make_banner_h():
    W, H = 1920, 1080
    img = vgrad(W, H, (16, 16, 30), (7, 7, 14)).convert("RGBA")
    img.alpha_composite(glow_layer((W, H), W * 0.68, H * 0.52, 620, (110, 55, 160)))
    img.alpha_composite(glow_layer((W, H), W * 0.68, H * 0.52, 300, RED))
    # 构图:近景双头犬(左) + 主体大龙(右),留足纵深不叠主体
    ground_shadow(img, W * 0.66, H * 0.78, 700, 88)
    paste_px(img, "wolf-boss", 10, W * 0.40, H * 0.72, fade=0.85, outline=True)
    paste_px(img, "drake-boss", 20, W * 0.66, H * 0.52, outline=True)
    d = ImageDraw.Draw(img)
    title_text(d, (W * 0.25, H * 0.38), "深渊挂机", font(FZH, 224), stroke=12)
    d.text((W * 0.25, H * 0.55), "A B Y S S   I D L E", font=font(FZH_R, 52),
           fill=(150, 150, 175), anchor="mm")
    # 标题下强调条:与四字标题等宽,金→暗红
    bar = Image.new("RGBA", (900, 12), (0, 0, 0, 0))
    bd = ImageDraw.Draw(bar)
    for x in range(900):
        t = x / 900
        c = (255, 217, 74) if t < 0.55 else (150, 45, 45)
        bd.line([(x, 0), (x, 12)], fill=c + (230,))
    img.alpha_composite(bar.filter(ImageFilter.GaussianBlur(1)),
                        (int(W * 0.25 - 450), int(H * 0.475)))
    img.convert("RGB").save(OUT / "banner-1920x1080.jpg", quality=90)
    print("OK banner-1920x1080.jpg")


# ---------------------------------------------------------------- 竖版 1080×1920
def make_banner_v():
    W, H = 1080, 1920
    img = vgrad(W, H, (16, 16, 30), (7, 7, 14)).convert("RGBA")
    img.alpha_composite(glow_layer((W, H), W * 0.5, H * 0.52, 560, (110, 55, 160)))
    img.alpha_composite(glow_layer((W, H), W * 0.5, H * 0.52, 280, RED))
    ground_shadow(img, W * 0.5, H * 0.72, 700, 84)
    paste_px(img, "skeleton-boss", 8, W * 0.78, H * 0.40, fade=0.7)
    paste_px(img, "drake-boss", 22, W * 0.55, H * 0.53, outline=True)
    d = ImageDraw.Draw(img)
    title_text(d, (W * 0.5, H * 0.155), "深渊挂机", font(FZH, 200), stroke=12)
    d.text((W * 0.5, H * 0.24), "A B Y S S   I D L E", font=font(FZH_R, 46),
           fill=(150, 150, 175), anchor="mm")
    img.convert("RGB").save(OUT / "banner-1080x1920.jpg", quality=90)
    print("OK banner-1080x1920.jpg")


if __name__ == "__main__":
    make_icon()
    make_banner_h()
    make_banner_v()
