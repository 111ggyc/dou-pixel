# -*- coding: utf-8 -*-
"""
预处理：判断哪些图是「主体 + 纯色背景」，裁到主体，导出原始像素给 node 量化。

    python tools/prep-images.py [去水印后的目录]

输出 tools/work/prep/<序号>.bin（裁剪后的 RGBA）和 meta.json。

── 为什么要裁 ──
动物那几张，主体只占画面中间六成左右。整幅降到 32×32 的话，
主体只剩不到 20 格，细节全糊。裁到主体外接框（留一点边）再降，
格子才都用在主体上。

── 怎么判断「有纯色背景」 ──
看四条边：如果边上的颜色很一致（中位偏差小），就是「主体 + 纯色底」；
不一致（风景那种画面铺满到边）就整幅保留，不裁也不抠底。
判据用**中位偏差**而不是标准差 —— 边上偶尔有个草叶伸过来不该影响判断。

裁成方形是为了和库里现有图纸一致（都是正方形，缩略图也按方形画）。

背景本身不在这里抠掉，交给 node 那边在网格上做（见 build-patterns.js 的说明）——
在像素级抠会留下一圈半透明的边，降采样之后反而更脏。
"""

import glob
import io
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = os.path.join(ROOT, 'tools', 'work')
PREP = os.path.join(WORK, 'prep')

# 边长取 4%，边上偶尔伸过来一片叶子不该影响判断
BORDER_FRAC = 0.04
# 边上颜色有多一致才认为是纯色背景。越小越严
PLAIN_SPREAD = 22
# 主体判定：和背景色的距离超过它就算主体
SUBJECT_DIST = 60
# 裁完留多少边（相对主体外接框）
MARGIN = 1.12

# 背景掩膜：和背景色的差小于它就**算**背景候选
#
# 这个阈值必须比「主体判定」严得多。白猫那张是白毛压在米色底上，
# 两者只差 45 —— 用宽阈值的话整只猫都会被当成背景。
# 抠的是「颜色贴着底色」**并且**「和画布边连通」的那一片，
# 所以猫身上被底色包围的部分不会被误伤。
PIX_BG_DIST = 40


def border_stats(rgb):
    h, w = rgb.shape[:2]
    b = max(2, int(min(h, w) * BORDER_FRAC))
    strips = np.concatenate([
        rgb[:b].reshape(-1, 3), rgb[-b:].reshape(-1, 3),
        rgb[:, :b].reshape(-1, 3), rgb[:, -b:].reshape(-1, 3)
    ])
    med = np.median(strips, axis=0)
    spread = float(np.median(np.abs(strips - med).sum(axis=1)))
    return med, spread


def subject_box(rgb, bg):
    """和背景色差得够远的像素的外接框"""
    d = np.abs(rgb.astype(np.float32) - bg).sum(axis=2)
    m = d > SUBJECT_DIST
    ys, xs = np.nonzero(m)
    if not len(ys):
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def background_mask(rgb, bg):
    """
    和背景色接近、**并且和画布边连通**的像素。

    为什么非要连通：白猫那张，猫毛和米色底只差 45，光看颜色分不开；
    但猫是被底色围在中间的，不和画布边连着，一连通就把它排除了。

    为什么要在像素级做、不能等到量化完在网格上做：
    量化会把颜色相近的区域并成同一个色号，白毛和米底并完之后
    在网格上就**再也分不开**了（这个坑踩过）。
    """
    d = np.abs(rgb.astype(np.float32) - bg).sum(axis=2)
    cand = d < PIX_BG_DIST

    lab, n = ndimage.label(cand, structure=np.ones((3, 3), int))
    if n == 0:
        return np.zeros(rgb.shape[:2], np.uint8)

    edge = set(lab[0].tolist()) | set(lab[-1].tolist())
    edge |= set(lab[:, 0].tolist()) | set(lab[:, -1].tolist())
    edge.discard(0)
    if not edge:
        return np.zeros(rgb.shape[:2], np.uint8)

    return np.isin(lab, list(edge)).astype(np.uint8)


def square_crop(box, w, h):
    """把外接框扩成方形（居中），并留出边距；越界就往里收"""
    x0, y0, x1, y1 = box
    cx = (x0 + x1) / 2.0
    cy = (y0 + y1) / 2.0
    side = max(x1 - x0, y1 - y0) * MARGIN
    side = min(side, w, h)

    left = int(round(cx - side / 2))
    top = int(round(cy - side / 2))
    left = max(0, min(left, w - int(side)))
    top = max(0, min(top, h - int(side)))
    s = int(side)
    return left, top, left + s, top + s


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(WORK, 'clean')
    files = sorted(f for f in os.listdir(src) if f.lower().endswith('.png'))

    if not os.path.isdir(PREP):
        os.makedirs(PREP)

    meta = []
    for i, f in enumerate(files):
        rgb = np.asarray(Image.open(os.path.join(src, f)).convert('RGB'))
        h, w = rgb.shape[:2]

        bg, spread = border_stats(rgb)
        plain = spread < PLAIN_SPREAD

        if plain:
            box = subject_box(rgb, bg)
            crop = square_crop(box, w, h) if box else (0, 0, w, h)
        else:
            crop = (0, 0, w, h)

        x0, y0, x1, y1 = crop
        piece = np.asarray(Image.open(os.path.join(src, f)).convert('RGBA'))[y0:y1, x0:x1]

        out = os.path.join(PREP, '%02d.bin' % i)
        with open(out, 'wb') as fp:
            fp.write(piece.astype(np.uint8).tobytes())

        # 背景掩膜，和图片同样裁剪。风景那类不抠底，直接给全 0
        msk = background_mask(rgb, bg) if plain else np.zeros((h, w), np.uint8)
        msk = msk[y0:y1, x0:x1]
        with open(os.path.join(PREP, '%02d.msk' % i), 'wb') as fp:
            fp.write(msk.tobytes())

        meta.append({
            'index': i,
            'file': f,
            'w': int(x1 - x0),
            'h': int(y1 - y0),
            'plain': bool(plain),
            'spread': round(spread, 1),
            'bg': '#%02x%02x%02x' % tuple(int(v) for v in bg),
            'bgPct': round(float(msk.mean()) * 100, 1)
        })
        print('  %2d  %s  %dx%d → %dx%d  纯色底=%s(%.1f)' %
              (i, f[:12], w, h, x1 - x0, y1 - y0, plain, spread))

    with io.open(os.path.join(PREP, 'meta.json'), 'w', encoding='utf-8') as fp:
        json.dump(meta, fp, ensure_ascii=False, indent=1)

    print('共 %d 张 → tools/work/prep/' % len(meta))


if __name__ == '__main__':
    main()
