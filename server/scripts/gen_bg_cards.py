#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""按口播内容生成信息卡背景（B-roll 主画面）

输入: words.json  {"words":[{"w":"..","s":0.1,"e":0.3}], "duration":31.4}
输出: <out>/cards/card_000.png ... + <out>/cards/timeline.json

版式：深色渐变 + 左上大标题 + 装饰，右下留空给人物画中画
"""
import json
import math
import os
import random
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1920, 1080
FONT_BOLD = "/System/Library/Fonts/PingFang.ttc"

# 每张卡片配色（top, bottom, 主光, 强调色）
PALETTES = [
    ((26, 30, 56), (10, 12, 28), (96, 148, 255), (255, 196, 110)),
    ((34, 24, 54), (12, 9, 26), (176, 128, 255), (255, 170, 210)),
    ((18, 34, 52), (8, 14, 24), (86, 200, 210), (255, 214, 130)),
    ((38, 26, 34), (14, 10, 16), (255, 138, 120), (255, 206, 150)),
    ((22, 26, 44), (9, 11, 22), (120, 160, 255), (170, 240, 210)),
]

PUNCT = "。！？!?；;，,、：:"


def load_font(size, bold=True):
    try:
        return ImageFont.truetype(FONT_BOLD, size, index=1 if bold else 0)
    except Exception:
        return ImageFont.truetype(FONT_BOLD, size)


def v_gradient(size, top, bottom):
    w, h = size
    strip = Image.new("RGB", (1, h))
    px = strip.load()
    for y in range(h):
        t = y / max(1, h - 1)
        t = t * t * (3 - 2 * t)
        px[0, y] = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
    return strip.resize((w, h), Image.BILINEAR)


def glow(size, center, radius, color, peak=150):
    w, h = size
    m = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(m)
    steps = 40
    for i in range(steps, 0, -1):
        t = i / steps
        r = radius * t
        d.ellipse([center[0] - r, center[1] - r * 0.9, center[0] + r, center[1] + r * 0.9], fill=int(peak * (1 - t) ** 2.2))
    m = m.filter(ImageFilter.GaussianBlur(radius * 0.1))
    return Image.new("RGB", size, color), m


def split_phrases(words, max_chars=26, max_gap=0.55):
    """按标点/停顿断句，再合并成卡片分组（每卡 1-2 句）"""
    lines, cur = [], []
    for i, w in enumerate(words):
        cur.append(w)
        nxt = words[i + 1] if i + 1 < len(words) else None
        gap = (nxt["s"] - w["e"]) if nxt else 99
        ln = sum(len(x["w"]) for x in cur)
        if (w["w"] and w["w"][-1] in PUNCT) or gap > max_gap or ln >= max_chars:
            lines.append(cur)
            cur = []
    if cur:
        lines.append(cur)

    # 每张卡片放 1 句（长句单独一张），短句两两合并
    cards = []
    i = 0
    while i < len(lines):
        a = lines[i]
        text_a = "".join(x["w"] for x in a).rstrip(PUNCT)
        if len(text_a) <= 9 and i + 1 < len(lines):
            b = lines[i + 1]
            text_b = "".join(x["w"] for x in b).rstrip(PUNCT)
            cards.append(
                {
                    "start": a[0]["s"],
                    "end": b[-1]["e"],
                    "text": text_a + "\n" + text_b,
                }
            )
            i += 2
        else:
            cards.append({"start": a[0]["s"], "end": a[-1]["e"], "text": text_a})
            i += 1
    return cards


def wrap(text, font, draw, max_w):
    """中文按字符宽度换行"""
    out = []
    for para in text.split("\n"):
        line = ""
        for ch in para:
            if draw.textlength(line + ch, font=font) > max_w and line:
                out.append(line)
                line = ch
            else:
                line += ch
        if line:
            out.append(line)
    return out[:3]


def make_card(text, idx, rnd, total=1):
    top, bottom, glow_c, accent = PALETTES[idx % len(PALETTES)]
    img = v_gradient((W, H), top, bottom).convert("RGBA")

    # 主光斑：右上（避开右下人物区）
    for center, radius, color, peak in (
        ((int(W * 0.62), int(H * 0.26)), int(W * 0.42), glow_c, 150),
        ((int(W * 0.18), int(H * 0.82)), int(W * 0.34), glow_c, 70),
    ):
        tint, mask = glow((W, H), center, radius, color, peak)
        img = Image.composite(tint.convert("RGBA"), img, mask)

    d = ImageDraw.Draw(img)

    # 章节序号（小字，在标题上方）
    f_num = load_font(34, bold=False)
    d.text((152, 236), f"{idx + 1:02d} / {total:02d}", font=f_num, fill=(*accent, 190))

    # 左侧竖强调条
    d.rounded_rectangle([96, 300, 108, 404], radius=6, fill=(*accent, 230))

    # 关键词大标题（最多 2 行）
    f_title = load_font(104)
    lines = wrap(text, f_title, d, 1240)
    y = 300
    for ln in lines:
        d.text((150, y), ln, font=f_title, fill=(255, 255, 255, 246))
        y += 132

    # 底部细线
    d.line(
        [(150, y + 26), (150 + 380, y + 26)],
        fill=(*accent, 110),
        width=2,
    )

    # 轻微暗角
    vig = Image.new("L", (W, H), 0)
    vd = ImageDraw.Draw(vig)
    vd.ellipse([-W * 0.2, -H * 0.3, W * 1.2, H * 1.3], fill=255)
    vig = vig.filter(ImageFilter.GaussianBlur(220))
    inv = vig.point(lambda v: int((255 - v) * 0.5))
    dark = Image.new("RGBA", (W, H), (0, 0, 0, 255))
    dark.putalpha(inv)
    img = Image.alpha_composite(img, dark)

    # 噪点
    noise = Image.effect_noise((W, H), 12).convert("L").point(lambda v: int(v * 0.1))
    img = Image.alpha_composite(img, Image.merge("RGBA", (noise, noise, noise, noise)))

    return img.convert("RGB")


def keyword(text, limit=8):
    """从句子取一个短关键词做章节标题"""
    t = text.replace("\n", "").strip()
    for ch in PUNCT:
        t = t.replace(ch, " ")
    parts = [p for p in t.split() if p]
    if not parts:
        return t[:limit] if t else "…"
    # 取最长的一段（信息量最大），再截断
    seg = max(parts, key=len)
    return seg[:limit]


def main():
    words_path = sys.argv[1]
    out_dir = sys.argv[2]

    with open(words_path, encoding="utf-8") as f:
        data = json.load(f)
    words = data.get("words", [])
    duration = data.get("duration", 0)

    cards_dir = os.path.join(out_dir, "cards")
    os.makedirs(cards_dir, exist_ok=True)

    groups = split_phrases(words)
    if not groups:
        print(json.dumps({"ok": False, "error": "没有可用文案段落"}))
        return

    # 首尾补齐到整片时长
    groups[0]["start"] = 0.0
    groups[-1]["end"] = duration or groups[-1]["end"]

    rnd = random.Random(7)
    timeline = []
    total = len(groups)
    for i, g in enumerate(groups):
        kw = keyword(g["text"]) or "…"
        img = make_card(kw, i, rnd, total)
        name = f"card_{i:03d}.png"
        img.save(os.path.join(cards_dir, name))
        timeline.append(
            {
                "img": name,
                "start": round(g["start"], 3),
                "end": round(g["end"], 3),
                "text": g["text"],
                "keyword": kw,
            }
        )

    with open(os.path.join(cards_dir, "timeline.json"), "w", encoding="utf-8") as f:
        json.dump(timeline, f, ensure_ascii=False, indent=2)

    print(json.dumps({"ok": True, "data": {"count": len(timeline), "dir": cards_dir}}, ensure_ascii=False))


if __name__ == "__main__":
    main()
