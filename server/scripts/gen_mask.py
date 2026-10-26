#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成圆角遮罩（白=不透明）"""
import sys

from PIL import Image, ImageDraw

w = int(sys.argv[1])
h = int(sys.argv[2])
r = int(sys.argv[3]) if len(sys.argv) > 3 else 26
out = sys.argv[4]

img = Image.new("L", (w, h), 0)
d = ImageDraw.Draw(img)
d.rounded_rectangle([0, 0, w - 1, h - 1], radius=r, fill=255)
img.save(out)
print("ok")
