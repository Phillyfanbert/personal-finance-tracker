#!/usr/bin/env python3
"""Generate the app's launcher and favicon PNGs.

The icon is the same three ascending bars as the in-app mark (.brand-mark in
app/index.html), so the two must be changed together.

Why a generator rather than a checked-in drawing: the sizes have to stay in
step with each other, and the small ones need supersampling to look right. The
bars are drawn at 8x and downsampled with LANCZOS, which antialiases far better
at 32px than drawing at 32px does.

Colours are the app's own tokens, pre-composited onto the dark ground so the
PNGs need no transparency:
    --bg        #0f172a
    --series-8  #44BB99   (the two shorter bars, at 50% and 78%)
    --accent    #38bdf8   (the tallest bar)

The geometry sits inside the maskable safe zone (the middle 80% of the canvas),
so a platform that crops the icon to a circle does not clip the bars.

    python3 tools/make-icons.py
"""

from PIL import Image, ImageDraw

BG = (15, 23, 42)
TEAL = (68, 187, 153)
BLUE = (56, 189, 248)

# x, top, height, colour
BARS = [(114, 276, 120, 0.50), (218, 208, 188, 0.78), (322, 140, 256, None)]
BAR_W, BAR_R = 76, 38
CANVAS = 512
SUPERSAMPLE = 8

SIZES = {
    512: "app/icons/icon-512.png",   # manifest, "any" and "maskable"
    192: "app/icons/icon-192.png",   # manifest
    180: "app/icons/icon-180.png",   # apple-touch-icon wants exactly 180
    32:  "app/icons/icon-32.png",    # the browser tab
}


def over(fg, alpha, bg=BG):
    """Flatten an alpha onto the ground, so no PNG carries transparency."""
    return tuple(round(b + (f - b) * alpha) for f, b in zip(fg, bg))


def render():
    w = CANVAS * SUPERSAMPLE
    img = Image.new("RGB", (w, w), BG)
    draw = ImageDraw.Draw(img)
    for x, top, height, alpha in BARS:
        colour = BLUE if alpha is None else over(TEAL, alpha)
        draw.rounded_rectangle(
            [x * SUPERSAMPLE, top * SUPERSAMPLE,
             (x + BAR_W) * SUPERSAMPLE, (top + height) * SUPERSAMPLE],
            radius=BAR_R * SUPERSAMPLE, fill=colour,
        )
    return img


if __name__ == "__main__":
    master = render()
    for size, path in SIZES.items():
        master.resize((size, size), Image.LANCZOS).save(path, optimize=True)
        print(f"wrote {path} ({size}x{size})")
    print("\nRemember to bump CACHE in app/sw.js so returning users refetch them.")
