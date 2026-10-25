#!/usr/bin/env python3
"""Make the phone-sized derivatives of the 2027 brand art: assets/brand/derived/*.webp.

The originals in assets/brand/ stay exactly as exported (AGENTS.md rule 2: never redraw, trace or recolor). A derivative is
the same pixels, only cropped to the art's own alpha bounds or to one state of a sheet, then resampled and re-encoded as
WebP so a judge's phone downloads kilobytes, not megabytes. Nothing is repainted, tinted or retouched.

    python3 scripts/make_brand_derived.py            # write assets/brand/derived/ (idempotent)
    python3 scripts/make_brand_derived.py --check    # the same, and exit 1 if any derivative is over the budget

Budget: no image on a judge screen is over ~300 KB (BUDGET below; the test suite measures the bytes the phone really gets).
Requires Pillow with WebP support.
"""
import json
import os
import sys

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets", "brand")
OUT = os.path.join(SRC, "derived")
BUDGET = 300 * 1024  # bytes, per image, on a judge screen
Q = {"quality": 86, "method": 6, "alpha_quality": 100}


def open_rgba(name):
    return Image.open(os.path.join(SRC, name)).convert("RGBA")


def alpha_bbox(im, floor=8):
    a = im.getchannel("A").point(lambda v: 255 if v > floor else 0)
    return a.getbbox()


def to_height(im, h):
    return im.resize((round(im.width * h / im.height), h), Image.LANCZOS)


def to_width(im, w):
    return im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)


SIZES = {}


def save(im, name, **kw):
    path = os.path.join(OUT, name)
    opts = dict(Q)
    opts.update(kw)
    im.save(path, "WEBP", **opts)
    SIZES[name] = [im.width, im.height]
    return path


def plank_caps(im):
    """The end caps of a plank (px of the derived image) where its chamfer or arrow ends and the plain grain starts.
    A button draws the two caps at their natural shape and stretches only the grain between them (border-image)."""
    a = im.getchannel("A")
    w, h = im.size
    cols = [0] * w
    for x in range(w):
        col = a.crop((x, 0, x + 1, h)).tobytes()
        cols[x] = sum(1 for v in col if v > 200)
    full = int(h * 0.97)
    left = next((x for x in range(w) if cols[x] >= full), 0)
    right = next((w - x for x in range(w - 1, -1, -1) if cols[x] >= full), 0)
    return left, right


def star_crops():
    """The three sheriff-star states of progress-stars.png (filled, half, outline), each a round medallion of the exact
    exported pixels (the sheet's dark tile is part of the art, so the star is cropped with it, never cut out of it)."""
    im = open_rgba("progress-stars.png").convert("RGB")
    px = im.load()
    W, H = im.size
    gold = [[False] * W for _ in range(H)]
    for y in range(0, H, 1):
        for x in range(0, W, 1):
            r, g, b = px[x, y]
            gold[y][x] = r > 200 and 140 < g < 215 and b < 110
    # one search window per state, left to right (the sheet is: x, filled, x, half, x, outline, x)
    wins = [(180, 640), (1060, 1420), (1900, 2250)]
    out = []
    for x0, x1 in wins:
        xs, ys = [], []
        for y in range(H):
            row = gold[y]
            for x in range(x0, x1):
                if row[x]:
                    xs.append(x)
                    ys.append(y)
        bx = (min(xs), min(ys), max(xs) + 1, max(ys) + 1)
        cx, cy = (bx[0] + bx[2]) / 2, (bx[1] + bx[3]) / 2
        r = max(bx[2] - bx[0], bx[3] - bx[1]) / 2 + 4
        out.append((cx, cy, r))
    return im, out


def main():
    check = "--check" in sys.argv[1:]
    os.makedirs(OUT, exist_ok=True)
    made = {}
    geometry = {}

    # Painted grounds: the whole canyon at its native 1280 px width (cover-fit by CSS), just re-encoded.
    for n in ("sunset", "night"):
        im = Image.open(os.path.join(SRC, "bg-%s.png" % n)).convert("RGB")
        made["bg-%s.webp" % n] = save(im, "bg-%s.webp" % n, quality=84)

    # Planks. The files are named for the notch side, not the arrow: wood-plank-left points RIGHT and wood-plank-right
    # points LEFT (checked on the pixels). The derivatives are named for where the tip points.
    for src, name in (("wood-plank-default.png", "plank-flat"), ("wood-plank-left.png", "plank-point-right"), ("wood-plank-right.png", "plank-point-left")):
        im = open_rgba(src)
        im = im.crop(alpha_bbox(im))
        im = to_height(im, 192)
        made[name + ".webp"] = save(im, name + ".webp", quality=90)
        l, r = plank_caps(im)
        geometry[name] = {"width": im.width, "height": im.height, "capLeft": l, "capRight": r}

    # The hero signpost (2x already: 718 x 1135).
    im = open_rgba("signpost-nav@2x.png")
    made["signpost.webp"] = save(im, "signpost.webp", quality=88)

    # Sheriff stars, 96 px medallions.
    sheet, circles = star_crops()
    for name, (cx, cy, r) in zip(("star-filled", "star-half", "star-outline"), circles):
        box = (round(cx - r), round(cy - r), round(cx + r), round(cy + r))
        crop = sheet.crop(box).resize((192, 192), Image.LANCZOS).convert("RGBA")
        mask = Image.new("L", (192 * 4, 192 * 4), 0)
        ImageDraw.Draw(mask).ellipse((0, 0, 192 * 4 - 1, 192 * 4 - 1), fill=255)
        crop.putalpha(mask.resize((192, 192), Image.LANCZOS))
        made[name + ".webp"] = save(crop, name + ".webp", quality=90)

    # Garlands (2740 px wide originals) at 2x of a phone column.
    for src, name in (("divider-horses-cream.png", "garland-cream"), ("divider-horses-brown.png", "garland-brown")):
        im = open_rgba(src)
        made[name + ".webp"] = save(to_width(im, 780), name + ".webp", quality=88)

    # Props, trimmed to their alpha bounds and sized for a 96-160 px display at 2x.
    for src, name, h in (("wagon.png", "wagon", 320), ("horseshoe-gold.png", "horseshoe", 256), ("cactus-tall.png", "cactus-tall", 320), ("cactus-round.png", "cactus-round", 256), ("cactus-bushes.png", "cactus-bushes", 220)):
        im = open_rgba(src)
        made[name + ".webp"] = save(to_height(im, h), name + ".webp", quality=88)

    # Neon sign (Cover only): half size.
    for src, name in (("neon-sign-board.png", "neon-board"), ("neon-sign-arrow.png", "neon-arrow")):
        im = open_rgba(src)
        made[name + ".webp"] = save(to_width(im, 560), name + ".webp", quality=86)

    # geometry.json: the plank end caps (they become the --plank-* tokens) and every derivative's pixel size (the width and
    # height attributes GavIL.art gives its <img>, so a page never shifts when an image arrives).
    with open(os.path.join(OUT, "geometry.json"), "w") as f:
        json.dump({"planks": geometry, "sizes": SIZES}, f, indent=1)
        f.write("\n")

    bad = 0
    for name in sorted(made):
        size = os.path.getsize(made[name])
        flag = "" if size <= BUDGET else "  OVER BUDGET"
        if size > BUDGET:
            bad += 1
        print("%-28s %6d KB%s" % (name, round(size / 1024), flag))
    print("geometry.json: " + json.dumps(geometry))
    print("sizes: " + json.dumps(SIZES))
    if check and bad:
        sys.exit(1)


if __name__ == "__main__":
    main()
