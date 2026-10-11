#!/usr/bin/env python3
"""Détoure la mascotte et le logo « octopus energy » depuis les photos de l'ancien présentoir.

Usage : python3 prepare_assets.py <photo-recto.jpg> <photo-verso.jpg>
Écrit dans assets/ : mascot_front.png, mascot_back.png, wordmark.png (fonds transparents),
et colors.json (couleurs mesurées sur les photos). Nécessite Pillow et numpy.
Les images Octopus ne sont pas versionnées (assets/ est ignoré par git).
"""
import json, sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

OUT = Path(__file__).parent / 'assets'


def fill_holes(mask):
    """Tout ce qui n'est pas relié au bord de l'image fait partie de la mascotte (yeux, bouche, reflets)."""
    h, w = mask.shape
    outside = np.zeros_like(mask, dtype=bool)
    queue = deque([(0, 0), (0, w - 1), (h - 1, 0), (h - 1, w - 1)])
    for pt in queue:
        outside[pt] = True
    while queue:
        y, x = queue.popleft()
        for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
            if 0 <= ny < h and 0 <= nx < w and not outside[ny, nx] and not mask[ny, nx]:
                outside[ny, nx] = True
                queue.append((ny, nx))
    return ~outside


def mascot(photo, box, name, pink):
    crop = photo.crop(box).convert('RGB')
    a = np.asarray(crop).astype(int)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mask = (r > 170) & (g < 140) & (r - g > 70) & (b > 60)
    # retire les poussières isolées : on garde la plus grande zone connexe
    labels = np.zeros(mask.shape, dtype=int)
    best, best_size, current = 0, 0, 0
    for sy, sx in zip(*np.nonzero(mask)):
        if labels[sy, sx]:
            continue
        current += 1
        labels[sy, sx] = current
        size, queue = 0, deque([(sy, sx)])
        while queue:
            y, x = queue.popleft()
            size += 1
            for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= ny < mask.shape[0] and 0 <= nx < mask.shape[1] and mask[ny, nx] and not labels[ny, nx]:
                    labels[ny, nx] = current
                    queue.append((ny, nx))
        if size > best_size:
            best, best_size = current, size
    body = fill_holes(labels == best)
    # lissage du contour, puis recadrage ; la couleur rose est unifiée (flat), les yeux gardent la photo
    alpha_img = Image.fromarray((body * 255).astype('uint8')).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1.1))
    rgb = np.asarray(crop).copy()
    pink_px = mask & body
    rgb[pink_px] = pink
    img = Image.fromarray(rgb).convert('RGBA')
    img.putalpha(alpha_img)
    bbox = alpha_img.point(lambda v: 255 if v > 20 else 0).getbbox()
    img = img.crop(bbox)
    img = img.resize((img.width * 2, img.height * 2), Image.LANCZOS)
    img.save(OUT / name)
    return img.size


def wordmark(photo, box, name):
    crop = photo.crop(box).convert('RGB')
    a = np.asarray(crop).astype(float)
    lum = a.mean(axis=2)
    lo, hi = np.percentile(lum, 40), np.percentile(lum, 99.5)
    alpha = np.clip((lum - (lo + 0.25 * (hi - lo))) / (0.45 * (hi - lo)), 0, 1)
    img = Image.new('RGBA', crop.size, (255, 255, 255, 0))
    img.putalpha(Image.fromarray((alpha * 255).astype('uint8')))
    bbox = img.getchannel('A').point(lambda v: 255 if v > 40 else 0).getbbox()
    img = img.crop(bbox)
    img = img.resize((img.width * 2, img.height * 2), Image.LANCZOS)
    img.save(OUT / name)
    return img.size


def sample_colors(front):
    arr = np.asarray(front.convert('RGB')).astype(int)

    def med(x0, y0, x1, y1, cond=None):
        block = arr[y0:y1, x0:x1].reshape(-1, 3)
        if cond is not None:
            block = block[cond(block)]
        return '#%02x%02x%02x' % tuple(int(v) for v in np.median(block, axis=0))
    return {
        'border': med(215, 1100, 245, 2000),
        'panel_top': med(380, 480, 520, 560),
        'panel_bottom': med(380, 1560, 520, 1640),
        'title_blue': med(500, 1030, 1300, 1120, lambda p: (p[:, 2] > 190) & (p[:, 0] < 170)),
    }


def main():
    OUT.mkdir(exist_ok=True)
    front, back = Image.open(sys.argv[1]), Image.open(sys.argv[2])
    pink_front = tuple(int(v) for v in np.median(np.asarray(front.crop((820, 400, 1000, 480)).convert('RGB')).reshape(-1, 3), axis=0))
    pink_back = tuple(int(v) for v in np.median(np.asarray(back.crop((780, 650, 1060, 740)).convert('RGB')).reshape(-1, 3), axis=0))
    print('rose recto', pink_front, 'verso', pink_back)
    print('mascot_front', mascot(front, (700, 340, 1140, 780), 'mascot_front.png', pink_front))
    print('mascot_back', mascot(back, (680, 600, 1180, 1140), 'mascot_back.png', pink_back))
    print('wordmark', wordmark(front, (400, 790, 1450, 970), 'wordmark.png'))
    colors = sample_colors(front)
    colors['pink'] = '#%02x%02x%02x' % pink_front
    (OUT / 'colors.json').write_text(json.dumps(colors, indent=2))
    print(colors)


if __name__ == '__main__':
    main()
