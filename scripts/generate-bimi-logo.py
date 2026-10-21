#!/usr/bin/env python3
"""Generate the BIMI logo (SVG Tiny PS) from the brand font.

    pip install fonttools
    python3 scripts/generate-bimi-logo.py

Writes `public/bimi-logo.svg`. The output is committed, so this only needs
running when the mark changes.

Why a generator rather than a hand-drawn SVG
--------------------------------------------
The mark is the "LD." lockup in DM Serif Display, the same face the site
and the email shell use. A BIMI logo cannot reference a font: the file is
rendered by a mailbox provider that has no access to ours, and SVG Tiny PS
forbids external references anyway. So the letters have to ship as
outlines, and outlines traced by hand would drift from the brand face —
exactly the failure docs/56 records for fonts.

This pulls the real glyph contours out of `public/fonts/DMSerifDisplay-
Regular.ttf`, so the mark is the brand face by construction.

Constraints encoded here (from draft-svg-tiny-ps-abrotman-00)
-------------------------------------------------------------
* root carries `version="1.2"` and `baseProfile="tiny-ps"`
* exactly one non-empty `<title>` as a child of `<svg>`
* no script, link, image, animation, switch or external reference
* no `x`/`y` on the root element
* square viewBox

Gmail crops a sender avatar to a circle, so the background is full bleed
and the lockup sits inside the inscribed circle with margin to spare. The
rounded corners still matter for providers that show the square.
"""
from __future__ import annotations

from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.misc.transform import Transform
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
FONT = ROOT / "public" / "fonts" / "DMSerifDisplay-Regular.ttf"
OUT = ROOT / "public" / "bimi-logo.svg"
FAVICON = ROOT / "src" / "app" / "icon.svg"

BOX = 1024           # square canvas
TEAL = "#0F766E"     # EMAIL_COLORS.primary
AMBER = "#D97706"    # EMAIL_COLORS.accent
WHITE = "#FFFFFF"
CORNER = 180         # rounded square, ignored under a circular crop

# The lockup is sized against the inscribed circle, not the square: at
# BOX/2 radius a centred band of this width keeps every contour clear of
# the crop with room for the dot.
LOCKUP_WIDTH = 600.0


def glyph_path(glyphset, name: str, transform: Transform) -> str:
    pen = SVGPathPen(glyphset)
    glyphset[name].draw(TransformPen(pen, transform))
    return pen.getCommands()


def main() -> None:
    font = TTFont(FONT)
    glyphset = font.getGlyphSet()
    cmap = font.getBestCmap()
    hmtx = font["hmtx"]
    cap_height = font["OS/2"].sCapHeight  # 660 for this face

    # Lay the lockup out in FONT units first, then centre on the ink it
    # actually makes.
    #
    # Centring on advance widths instead puts the mark visibly off centre:
    # the trailing dot's advance carries sidebearing that the eye does not
    # see, and the first attempt here centred "LD" alone and then hung the
    # dot outside that box, which left a wide gap on the left and almost
    # none on the right. Bounds are what a reader perceives.
    DOT_TRACKING = -6  # tuck the accent closer than its natural sidebearing

    pen = 0.0
    placed: list[tuple[str, float, str]] = []  # (glyph name, pen x, fill)
    for char in "LD":
        name = cmap[ord(char)]
        placed.append((name, pen, WHITE))
        pen += hmtx[name][0]
    dot_name = cmap[ord(".")]
    placed.append((dot_name, pen + DOT_TRACKING, AMBER))

    def ink_bounds(name: str, offset: float) -> tuple[float, float]:
        bounds = BoundsPen(glyphset)
        glyphset[name].draw(bounds)
        if bounds.bounds is None:  # pragma: no cover - no blank glyphs here
            return (offset, offset)
        return (bounds.bounds[0] + offset, bounds.bounds[2] + offset)

    spans = [ink_bounds(name, offset) for name, offset, _ in placed]
    ink_left = min(s[0] for s in spans)
    ink_right = max(s[1] for s in spans)
    ink_width = ink_right - ink_left

    scale = LOCKUP_WIDTH / ink_width
    # Centre the ink horizontally, and centre vertically on cap height:
    # glyphs sit on a y=0 baseline, so "LD" is visually centred when the
    # baseline sits cap_height/2 below the middle.
    origin_x = (BOX - LOCKUP_WIDTH) / 2 - ink_left * scale
    baseline_y = BOX / 2 + (cap_height * scale) / 2

    paths: list[str] = []
    for name, offset, fill in placed:
        # y is negated: font space is y-up, SVG is y-down.
        t = Transform(scale, 0, 0, -scale, origin_x + offset * scale, baseline_y)
        paths.append(f'  <path d="{glyph_path(glyphset, name, t)}" fill="{fill}"/>')

    body = chr(10).join(paths)

    bimi = f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny-ps" viewBox="0 0 {BOX} {BOX}">
  <title>LastDonor</title>
  <rect width="{BOX}" height="{BOX}" rx="{CORNER}" ry="{CORNER}" fill="{TEAL}"/>
{body}
</svg>
"""
    OUT.write_text(bimi, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}  ({len(bimi.encode()):,} bytes)")

    # The browser favicon, from the SAME outlines.
    #
    # It used to set the letters as `<text>` in Georgia, which is a font
    # the brand does not use and which is absent on most Linux and Android
    # devices - so the tab icon fell back to whatever serif was installed,
    # and differed from the email avatar. Sharing the outlines makes the
    # two marks identical by construction. No SVG Tiny PS constraints here;
    # a favicon is rendered by a browser.
    favicon = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {BOX} {BOX}">
  <title>LastDonor</title>
  <rect width="{BOX}" height="{BOX}" rx="{CORNER}" ry="{CORNER}" fill="{TEAL}"/>
{body}
</svg>
"""
    FAVICON.write_text(favicon, encoding="utf-8")
    print(f"wrote {FAVICON.relative_to(ROOT)}  ({len(favicon.encode()):,} bytes)")


if __name__ == "__main__":
    main()
