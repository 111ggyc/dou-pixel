# -*- coding: utf-8 -*-
"""
把 data/patterns-img.js 里的图纸画成 PNG，肉眼验收。

    python tools/preview-patterns.py [筛选关键字]

量化出来的数字看着都对，不代表看着像 —— 图形走了样、背景没抠干净、
颜色糊成一团，这些都只有画出来才知道。改完 build-patterns.js 先跑这个。
"""

import io
import json
import os
import re
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(os.path.dirname(ROOT), '..', 'shots', 'perler_patterns.png')
FONT = 'C:/Windows/Fonts/msyh.ttc'

CELL = 7           # 每格画多少像素
COLS = 5           # 一行放几个图案
PAD = 14

key = sys.argv[1] if len(sys.argv) > 1 else ''

# 数据是 JS，直接用 node 导成 JSON —— 不在 python 里解析 JS
r = subprocess.run(
    ['node', '-e',
     "console.log(JSON.stringify(require('./data/patterns-img.js')))"],
    cwd=ROOT, capture_output=True, encoding='utf-8')
if r.returncode != 0:
    sys.stderr.write(r.stderr or '读 data/patterns-img.js 失败\n')
    sys.exit(1)

data = json.loads(r.stdout)
chars = data['CHAR_SET']
items = [it for it in data['ITEMS'] if key in it['id'] or key in it['name']]
print('画 %d 个图案' % len(items))

tiles = []
fnt = ImageFont.truetype(FONT, 20)
for it in items:
    w, h = it['w'], it['h']
    img = Image.new('RGB', (w * CELL, h * CELL), (255, 255, 255))
    d = ImageDraw.Draw(img)
    for y, row in enumerate(it['grid']):
        for x, ch in enumerate(row):
            if ch == '.':
                # 空格画成浅棋盘格。**不能画成白的** —— 白色会把
                # 「抠掉的背景」和「原图自带的白边」混成一样，看不出抠没抠干净
                d.rectangle([x * CELL, y * CELL, (x + 1) * CELL - 1, (y + 1) * CELL - 1],
                            fill=(238, 241, 245) if (x + y) % 2 else (228, 232, 238))
                continue
            i = chars.index(ch)
            hexc = it['colors'][i].lstrip('#')
            d.rectangle([x * CELL, y * CELL, (x + 1) * CELL - 1, (y + 1) * CELL - 1],
                        fill=tuple(int(hexc[k:k + 2], 16) for k in (0, 2, 4)))
    tiles.append((it['name'], it['id'], img))

TW = max(t[2].size[0] for t in tiles) + PAD * 2
TH = max(t[2].size[1] for t in tiles) + PAD * 2 + 34
rows = (len(tiles) + COLS - 1) // COLS

sheet = Image.new('RGB', (COLS * TW, rows * TH), (244, 246, 249))
d = ImageDraw.Draw(sheet)
for k, (name, pid, img) in enumerate(tiles):
    cx, cy = (k % COLS) * TW, (k // COLS) * TH
    sheet.paste(img, (cx + PAD, cy + PAD))
    d.text((cx + PAD, cy + PAD + img.size[1] + 6), '%s %s' % (name, pid),
           font=fnt, fill=(60, 70, 85))

if not os.path.isdir(os.path.dirname(OUT)):
    os.makedirs(os.path.dirname(OUT))
sheet.save(OUT)
print(OUT, sheet.size)
