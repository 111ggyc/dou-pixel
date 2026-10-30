# -*- coding: utf-8 -*-
"""
去掉素材上「豆包AI生成」的水印。

    python tools/clean-watermark.py <素材目录> --preview   # 出前后对比，肉眼看
    python tools/clean-watermark.py <素材目录>             # 正式跑，写 tools/work/clean/

── 怎么定位水印 ──
半透明白字，固定在右下角。单张图上找不出来 —— 用顶帽找「比周围亮一截的细笔画」，
会把画面里所有的高光纹理一起挑出来（草地、水面反光、动物眼睛），
涂完比有水印还难看。

能用的性质是：**水印在这批图里位置和字形完全一样**。
逐张做高通（原图减去高斯模糊），再逐像素取中位数 ——
各图内容互不相同会被抹掉，只有水印是共有的，于是被留下来。

── 填回去 ──
被遮的像素先抄「离它最近的那个没被遮的像素」，再在遮罩内反复取四邻平均磨平。
区域小、周围连续的话，补完看不出。

**注意**：风景那几张的水印是压在画面上的（不是压在空白处），
填出来会是一小块糊的地方。反正后面要降到 40×40 的格子，先看降采样之后还明不明显。

── 环境 ──
只用 numpy + scipy + Pillow。这台机器上**没有 OpenCV**，填充是手写的。
"""

import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = os.path.join(ROOT, 'tools', 'work')
CLEAN = os.path.join(WORK, 'clean')
PREVIEW = os.path.join(os.path.dirname(ROOT), '..', 'shots')

# 水印在 384×384 上的位置。左上角定在这，右下角到底、到边
BOX_X0, BOX_Y0 = 300, 345

# 高通中位数超过这个值就算水印像素。这批水印是亮字（和城市海报那批相反，
# 那批是亮字压在浅底上、中位数出来是负的），取绝对值就都覆盖了
MASK_THR = 2.0
CLOSE_ITERS = 2
DILATE_ITERS = 2
DIFFUSE = 80


def largest_blob(mask):
    lab, n = ndimage.label(mask, structure=np.ones((3, 3)))
    if n <= 1:
        return mask
    sizes = ndimage.sum(mask, lab, range(1, n + 1))
    return lab == (int(np.argmax(sizes)) + 1)


def derive_mask(gray_stack):
    n, h, w = gray_stack.shape
    hp = np.empty_like(gray_stack)
    for i in range(n):
        hp[i] = gray_stack[i] - ndimage.gaussian_filter(gray_stack[i], 2.5)
    med = np.median(hp, axis=0)

    box = med[BOX_Y0:, BOX_X0:]
    m = np.abs(box) > MASK_THR
    if not m.any():
        return None, 0
    m = ndimage.binary_closing(m, iterations=CLOSE_ITERS)
    m = largest_blob(m)
    m = ndimage.binary_dilation(m, iterations=DILATE_ITERS)

    full = np.zeros((h, w), bool)
    full[BOX_Y0:, BOX_X0:] = m
    return full, int(m.sum())


def fill(rgb, mask, iters=DIFFUSE):
    if not mask.any():
        return rgb
    out = rgb.astype(np.float32)
    idx = ndimage.distance_transform_edt(mask, return_distances=False, return_indices=True)
    out[mask] = out[idx[0][mask], idx[1][mask]]
    for _ in range(iters):
        up = np.roll(out, 1, axis=0)
        dn = np.roll(out, -1, axis=0)
        lf = np.roll(out, 1, axis=1)
        rt = np.roll(out, -1, axis=1)
        out[mask] = (up[mask] + dn[mask] + lf[mask] + rt[mask]) / 4.0
    return np.clip(out, 0, 255).astype(np.uint8)


def load_gray(p):
    return np.asarray(Image.open(p).convert('L'), np.float32)


def load_rgb(p):
    return np.asarray(Image.open(p).convert('RGB'))


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    src = sys.argv[1]
    files = sorted(f for f in os.listdir(src) if f.lower().endswith('.png'))
    paths = [os.path.join(src, f) for f in files]

    print('素材 %d 张，提取共用水印形状…' % len(paths))
    mask, n = derive_mask(np.stack([load_gray(p) for p in paths]))
    if mask is None:
        print('  没提出水印，检查 BOX / MASK_THR')
        sys.exit(1)
    print('  水印区域 %d 像素' % n)

    if '--preview' in sys.argv:
        if not os.path.isdir(PREVIEW):
            os.makedirs(PREVIEW)
        h, w = mask.shape
        x0, y0 = 250, 320
        tiles = []
        # 默认看风景那几张 —— 水印压在实际画面上，比压在空白处难处理得多
        idx = [int(x) for x in sys.argv[sys.argv.index('--preview') + 1].split(',')] \
            if sys.argv.index('--preview') + 1 < len(sys.argv) and sys.argv[-1] != '--preview' \
            else [1, 6, 16]
        for p in [paths[i] for i in idx]:
            rgb = load_rgb(p)
            fixed = fill(rgb, mask)
            gap = np.full((h - y0, 6, 3), 128, np.uint8)
            tiles.append(np.hstack([rgb[y0:h, x0:w], gap, fixed[y0:h, x0:w]]))
        row = np.vstack([np.vstack([t, np.full((6, t.shape[1], 3), 200, np.uint8)]) for t in tiles])
        img = Image.fromarray(row)
        img = img.resize((img.size[0] * 3, img.size[1] * 3), Image.NEAREST)
        img.save(os.path.join(PREVIEW, 'perler_wm.png'))
        print('  对比图 → shots/perler_wm.png')
        return

    if not os.path.isdir(CLEAN):
        os.makedirs(CLEAN)
    for p in paths:
        fixed = fill(load_rgb(p), mask)
        Image.fromarray(fixed).save(os.path.join(CLEAN, os.path.basename(p)))
    print('  已写入 %d 张 → tools/work/clean/' % len(paths))


if __name__ == '__main__':
    main()
