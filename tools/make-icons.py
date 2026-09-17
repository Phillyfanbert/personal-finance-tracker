#!/usr/bin/env python3
"""Generate the app's launcher and favicon PNGs.

Three gold coins caught mid-fall: the same shape as the in-app mark
(.brand-mark in app/index.html), so the two must be changed together.
Redesigned from an ascending-bars chart (2026-09-15) - bars read as "growth
over time", generic fintech iconography that fits almost any tracker and
said nothing specific. Gold reads as money on its own, with no name-specific
pun required, which is why the mark survived every naming attempt tried and
dropped in this session (2026-09-16) unchanged: three coins cascading toward
a single landing point reads as coins going INTO a well - the same gesture
as tossing a coin into a wishing well. The app currently has no branded
name; manifest.json's "name" is "Personal Finance Tracker" and "short_name"
is "PF Tracker" (the home-screen label).

Colours are the app's own tokens, pre-composited onto the dark ground so the
PNGs need no transparency:
    --bg               #0f172a  (background)
    --series-2 (gold)  #EEDD88  (the two falling coins, at 55% and 85%)
    --accent           #38bdf8  (the coin that has landed)
    --border-strong    #708098  (the rim on every coin)

The rim matters, not just for looking like a coin. The identity palette
(--series-1..8) is tuned so its eight hues separate from EACH OTHER under
colour vision deficiency, not so any one of them clears a contrast floor
against a background. That is why those colours are exempt from the 3:1
non-text minimum in the one place they are normally used: as adjacent
segments of a stacked bar that always sums to 100%, where no track is ever
exposed behind them. A floating circle is not that case and has no such
exemption - on its own, --series-2 is far too pale to hold an edge against a
light surface. So every coin gets a real border-strong ring, which is the
same fix .acct-circle already uses for the identical reason.

The geometry sits inside the maskable safe zone (the middle 80% of the
canvas), so a platform that crops the icon to a circle does not clip a coin.

    python3 tools/make-icons.py
"""

from PIL import Image, ImageDraw

BG = (15, 23, 42)
GOLD = (238, 221, 136)
BLUE = (56, 189, 248)
RIM = (112, 128, 152)   # --border-strong, dark theme - the icon's ground is always dark

# center-x, center-y, radius, colour, alpha (None = solid)
COINS = [
    (150, 160, 36, GOLD, 0.55),
    (250, 260, 50, GOLD, 0.85),
    (380, 350, 68, BLUE, None),
]
CANVAS = 512
SUPERSAMPLE = 8
RIM_WIDTH = 5  # at the 512 scale; scaled up with SUPERSAMPLE below

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
    for cx, cy, r, colour, alpha in COINS:
        fill = colour if alpha is None else over(colour, alpha)
        rim = RIM if alpha is None else over(RIM, alpha)
        s = SUPERSAMPLE
        draw.ellipse(
            [(cx - r) * s, (cy - r) * s, (cx + r) * s, (cy + r) * s],
            fill=fill, outline=rim, width=RIM_WIDTH * s,
        )
    return img


if __name__ == "__main__":
    master = render()
    for size, path in SIZES.items():
        master.resize((size, size), Image.LANCZOS).save(path, optimize=True)
        print(f"wrote {path} ({size}x{size})")
    print("\nRemember to bump CACHE in app/sw.js so returning users refetch them.")
