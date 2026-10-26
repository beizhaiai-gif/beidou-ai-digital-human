#!/usr/bin/env python3
"""画图标：深色圆角底 + 人形 + 声波条（口播 / 数字人）。

    python3 electron/icons/make_icons.py

产出 icon.png(1024) / icon.icns / icon.ico，给 electron-builder 用。
手写一个 SVG 再转太绕，直接 PIL 画更可控。
"""
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).parent
SIZE = 1024
R = 224           # 底板圆角
BG_A = (28, 28, 48)     # #1c1c30
BG_B = (79, 125, 243)   # #4f7df3
FG = (255, 255, 255)
ACCENT = (224, 69, 44)  # #e0452c


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def gradient(size, c1, c2):
    """左上 → 右下 线性渐变"""
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x / (size - 1) + y / (size - 1)) / 2
            px[x, y] = lerp(c1, c2, t)
    return img


def make(size):
    s = size
    k = s / SIZE
    img = gradient(s, BG_A, BG_B).convert("RGBA")

    # 圆角遮罩：把四角裁掉，得到圆角方形
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, s - 1, s - 1], radius=R * k, fill=255)
    out = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)

    d = ImageDraw.Draw(out)
    cx = 424 * k

    # 头
    hr = 112 * k
    hcy = 392 * k
    d.ellipse([cx - hr, hcy - hr, cx + hr, hcy + hr], fill=FG)

    # 肩（横向椭圆，和头底相接）
    d.ellipse([cx - 208 * k, 520 * k, cx + 208 * k, 800 * k], fill=FG)

    # 声波：三条竖条，中心对齐画面中线
    bar_w = 34 * k
    mid = s / 2
    heights = (184 * k, 304 * k, 216 * k)
    xs = (618 * k, 676 * k, 734 * k)
    for x, h in zip(xs, heights):
        d.rounded_rectangle([x, mid - h / 2, x + bar_w, mid + h / 2], radius=17 * k, fill=ACCENT)

    return out


def main():
    base = make(SIZE)
    base.save(HERE / "icon.png")

    icon_dir = HERE / "icon.iconset"
    icon_dir.mkdir(exist_ok=True)
    sizes = {
        "16x16": 16, "32x32": 32, "64x64": 64, "128x128": 128,
        "256x256": 256, "512x512": 512,
    }
    for name, px in sizes.items():
        make(px).save(icon_dir / f"icon_{name}.png")
        if px <= 128:
            make(px * 2).save(icon_dir / f"icon_{name}@2x.png")

    subprocess.run(["iconutil", "-c", "icns", str(icon_dir), "-o", str(HERE / "icon.icns")], check=True)

    ico_sizes = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    base.save(HERE / "icon.ico", sizes=ico_sizes)
    print("图标生成完毕：", "icon.png icon.icns icon.ico")


if __name__ == "__main__":
    main()
