"""Packs the four cinema posters into one 2 x 2 atlas (public/assets/posters/cinema-posters.webp).

Usage: python3 scripts/build-cinema-posters.py <dir with 1_*.jpg .. 4_*.jpg>
Slot order is poster-1 .. poster-4 on the model (left to right): top-left, top-right, bottom-left,
bottom-right of the atlas. Each poster is centre-cropped to 3:4 and resized to CELL.
"""
import sys
from pathlib import Path

from PIL import Image

CELL = (384, 512)
OUT = Path(__file__).resolve().parent.parent / 'public/assets/posters/cinema-posters.webp'


def fit(image):
    w, h = image.size
    want = CELL[0] / CELL[1]
    if w / h > want:
        nw = round(h * want)
        image = image.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
    else:
        nh = round(w / want)
        image = image.crop((0, (h - nh) // 2, w, (h - nh) // 2 + nh))
    return image.resize(CELL, Image.LANCZOS)


def main():
    src = Path(sys.argv[1])
    files = [sorted(f for f in src.glob(f'{i}_*.jpg') if 'Small' not in f.name)[0] for i in range(1, 5)]
    atlas = Image.new('RGB', (CELL[0] * 2, CELL[1] * 2))
    for i, f in enumerate(files):
        atlas.paste(fit(Image.open(f).convert('RGB')), ((i % 2) * CELL[0], (i // 2) * CELL[1]))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    atlas.save(OUT, 'WEBP', quality=82, method=6)
    print(OUT, OUT.stat().st_size, 'bytes')


main()
