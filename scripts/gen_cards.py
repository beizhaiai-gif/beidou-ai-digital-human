#!/usr/bin/env python3
"""
生成 4 张深色玻璃质感卡片底图（原创素材，规避第三方版权）。
输出: public/cards/{image,video,create,agent}.jpg
"""
import math
import random
from PIL import Image, ImageDraw, ImageFilter, ImageChops

W, H = 2048, 1280
OUT = "/Users/mac/WorkBuddy/数字人/beizhai-workbench/public/cards"

# (底色起, 底色止, 主光, 副光, 玻璃主色)
PALETTES = {
    "image": ((24, 30, 62), (7, 8, 20), (255, 186, 96), (96, 186, 255), (150, 196, 255)),
    "video": ((30, 24, 46), (8, 7, 16), (255, 158, 96), (128, 226, 224), (206, 190, 255)),
    "create": ((38, 24, 62), (11, 8, 24), (255, 142, 204), (166, 146, 255), (228, 196, 255)),
    "agent": ((18, 30, 58), (6, 9, 20), (108, 202, 255), (255, 208, 138), (172, 222, 255)),
}


def v_gradient(size, top, bottom):
    w, h = size
    strip = Image.new("RGB", (1, h))
    px = strip.load()
    for y in range(h):
        t = y / max(1, h - 1)
        t = t * t * (3 - 2 * t)
        px[0, y] = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
    return strip.resize((w, h), Image.BILINEAR)


def glow_layer(size, center, radius, color, peak=180, power=2.2, blur_ratio=0.10):
    """径向光斑 -> (RGB tint, L mask)"""
    w, h = size
    m = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(m)
    steps = 56
    for i in range(steps, 0, -1):
        t = i / steps
        r = radius * t
        a = int(peak * (1 - t) ** power)
        d.ellipse([center[0] - r, center[1] - r * 0.92, center[0] + r, center[1] + r * 0.92], fill=a)
    m = m.filter(ImageFilter.GaussianBlur(radius * blur_ratio))
    return Image.new("RGB", (w, h), color), m


def poly_mask(size, poly, blur=0):
    m = Image.new("L", size, 0)
    d = ImageDraw.Draw(m)
    d.polygon(poly, fill=255)
    if blur:
        m = m.filter(ImageFilter.GaussianBlur(blur))
    return m


def linear_fill(size, c1, c2, angle_deg=90):
    """沿指定角度生成线性渐变 RGB 图"""
    w, h = size
    grad = Image.new("L", (w, h))
    px = grad.load()
    ang = math.radians(angle_deg)
    dx, dy = math.cos(ang), math.sin(ang)
    for y in range(h):
        for x in range(0, w, 4):
            t = ((x / w) * dx + (y / h) * dy + 1) / 2
            t = max(0.0, min(1.0, t))
            v = int(255 * t)
            for k in range(4):
                if x + k < w:
                    px[x + k, y] = v
    grad = grad.filter(ImageFilter.GaussianBlur(1))
    a = Image.new("RGB", (w, h), c1)
    b = Image.new("RGB", (w, h), c2)
    return Image.composite(b, a, grad)


def make_shards(key, rnd):
    """生成一组有机的不规则玻璃片"""
    shards = []
    base_x = W * 0.24
    for i in range(4):
        cx = base_x + W * 0.16 * i + rnd.uniform(-40, 40)
        cy = H * (0.50 + rnd.uniform(-0.14, 0.14))
        s = rnd.uniform(0.10, 0.155) * W
        n = rnd.choice([3, 4, 4, 5])
        rot = rnd.uniform(0, math.pi)
        squash = rnd.uniform(0.62, 0.92)
        poly = []
        for k in range(n):
            ang = rot + k * 2 * math.pi / n + rnd.uniform(-0.18, 0.18)
            rr = s * rnd.uniform(0.82, 1.18)
            poly.append((cx + math.cos(ang) * rr, cy + math.sin(ang) * rr * squash))
        shards.append(poly)
    return shards


def draw_glass(img, shards, glass_color, light_color):
    size = img.size

    for idx, poly in enumerate(shards):
        # 1) 折射光晕（玻璃背后的漫射亮区）
        halo = poly_mask(size, poly, blur=58)
        halo = halo.point(lambda v: int(v * 0.72))
        tint = Image.new("RGB", size, light_color if idx % 2 == 0 else glass_color)
        img = Image.composite(tint.convert("RGBA"), img, halo)

        # 2) 玻璃本体：渐变填充（左上亮 -> 右下暗）
        body_mask = poly_mask(size, poly, blur=1)
        fill = linear_fill(size, tuple(min(255, int(c * 1.15)) for c in glass_color), (26, 30, 52), 118)
        body_mask_f = body_mask.point(lambda v: int(v * 0.46))
        img = Image.composite(fill.convert("RGBA"), img, body_mask_f)

        # 3) 边缘高光（清晰 + 微糊双层）
        for blur, alpha, width in ((3.5, 70, 5), (0.6, 165, 2)):
            edge = Image.new("L", size, 0)
            ed = ImageDraw.Draw(edge)
            ed.line(poly + [poly[0]], fill=alpha, width=width, joint="curve")
            edge = edge.filter(ImageFilter.GaussianBlur(blur))
            white = Image.new("RGB", size, (255, 255, 255))
            img = Image.composite(white.convert("RGBA"), img, edge)

        # 4) 内部斜向高光条
        xs = [p[0] for p in poly]
        ys = [p[1] for p in poly]
        x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
        streak = Image.new("L", size, 0)
        sd = ImageDraw.Draw(streak)
        sx = x0 + (x1 - x0) * rnd_random(0.15, 0.4)
        sd.polygon(
            [
                (sx, y0),
                (sx + (x1 - x0) * 0.16, y0),
                (sx + (x1 - x0) * 0.36, y1),
                (sx + (x1 - x0) * 0.2, y1),
            ],
            fill=95,
        )
        streak = ImageChops.multiply(streak, body_mask).filter(ImageFilter.GaussianBlur(9))
        img = Image.composite(Image.new("RGB", size, (255, 255, 255)).convert("RGBA"), img, streak)

    return img


_rnd = random.Random(3)


def rnd_random(a, b):
    return _rnd.uniform(a, b)


def add_dust(img, count=420, seed=11):
    rnd = random.Random(seed)
    w, h = img.size
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for _ in range(count):
        x, y = rnd.uniform(0, w), rnd.uniform(0, h)
        r = rnd.uniform(0.5, 2.4)
        a = int(rnd.uniform(14, 92))
        d.ellipse([x - r, y - r, x + r, y + r], fill=(255, 255, 255, a))
    return Image.alpha_composite(img, layer.filter(ImageFilter.GaussianBlur(0.6)))


def add_beam(img, color):
    """斜向体积光"""
    w, h = img.size
    layer = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(layer)
    d.polygon(
        [(w * 0.05, h * 1.05), (w * 0.42, -h * 0.1), (w * 0.62, -h * 0.1), (w * 0.22, h * 1.05)],
        fill=26,
    )
    layer = layer.filter(ImageFilter.GaussianBlur(90))
    tint = Image.new("RGB", (w, h), color)
    return Image.composite(tint.convert("RGBA"), img, layer)


def add_vignette(img, strength=0.62):
    w, h = img.size
    mask = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(mask)
    d.ellipse([-w * 0.2, -h * 0.3, w * 1.2, h * 1.3], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(200))
    inv = mask.point(lambda v: 255 - v).point(lambda v: int(v * strength))
    dark = Image.new("RGBA", (w, h), (0, 0, 0, 255))
    dark.putalpha(inv)
    return Image.alpha_composite(img, dark)


def build(key):
    top, bottom, g1, g2, glass = PALETTES[key]
    img = v_gradient((W, H), top, bottom).convert("RGBA")

    for center, radius, color, peak in (
        ((int(W * 0.30), int(H * 0.40)), int(W * 0.46), g1, 205),
        ((int(W * 0.72), int(H * 0.66)), int(W * 0.40), g2, 150),
        ((int(W * 0.52), int(H * 0.30)), int(W * 0.22), (255, 255, 255), 62),
    ):
        tint, mask = glow_layer((W, H), center, radius, color, peak)
        img = Image.composite(tint.convert("RGBA"), img, mask)

    img = add_beam(img, g1)

    rnd = random.Random(abs(hash(key)) % 9999)
    shards = make_shards(key, rnd)
    img = draw_glass(img, shards, glass, g2)

    img = add_dust(img, seed=abs(hash(key)) % 777)
    img = add_vignette(img, 0.58)

    out = img.convert("RGB")
    path = f"{OUT}/{key}.jpg"
    out.save(path, quality=93, optimize=True)
    print(f"saved {path}")


if __name__ == "__main__":
    for k in PALETTES:
        build(k)
