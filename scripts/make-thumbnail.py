#!/usr/bin/env python3
"""
Devpost thumbnail generator for PalateOps.

Renders 1200x800 (3:2) at 2x and downsamples with Lanczos so type and rounded
corners stay crisp. Two variants: a full composition and a minimal one that
survives a tight crop.

This is optional tooling, not part of the app: the server never imports it.
Requires Pillow. It reads a system font read-only and writes only into docs/.

    python3 scripts/make-thumbnail.py
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs"

W, H = 1200, 800
SS = 2  # supersampling factor

BG = (20, 51, 42)
LIME = (220, 233, 122)
WHITE = (244, 247, 233)
MUTED = (156, 178, 163)

SERIF = "/System/Library/Fonts/Supplemental/Georgia.ttf"
SANS = "/System/Library/Fonts/HelveticaNeue.ttc"


def font(path, size, index=0):
    return ImageFont.truetype(path, size * SS, index=index)


def tracked(draw, xy, text, fnt, fill, tracking=0.0):
    """Draw letter-spaced text; returns the x position after the last glyph."""
    x, y = xy
    for char in text:
        draw.text((x, y), char, font=fnt, fill=fill)
        x += draw.textlength(char, font=fnt) + tracking * SS
    return x


def fit_font(draw, path, text, max_size, max_width):
    """Largest size at which `text` still fits `max_width`."""
    size = max_size
    while size > 12:
        candidate = font(path, size)
        if draw.textlength(text, font=candidate) <= max_width:
            return candidate
        size -= 2
    return font(path, 12)


def glow(draw_size, center, radius, color, peak):
    """Radial falloff painted into the background."""
    yy, xx = np.mgrid[0:draw_size[1], 0:draw_size[0]]
    dist = np.sqrt((xx - center[0]) ** 2 + (yy - center[1]) ** 2)
    alpha = np.clip(1 - dist / radius, 0, 1) ** 2 * peak
    layer = np.zeros((draw_size[1], draw_size[0], 4), dtype=np.uint8)
    layer[..., 0], layer[..., 1], layer[..., 2] = color
    layer[..., 3] = alpha.astype(np.uint8)
    return Image.fromarray(layer, "RGBA")


def brand_mark(draw, x, y, scale=1.0):
    """Three ascending bars, the same motif as the favicon."""
    widths = [4, 4, 4]
    heights = [9, 16, 11]
    opacities = [178, 255, 216]
    gap = 4 * scale
    for index, (width, height) in enumerate(zip(widths, heights)):
        bar_x = x + index * (width * scale + gap)
        bar_y = y + (16 - height) * scale
        box = [bar_x, bar_y, bar_x + width * scale, bar_y + height * scale]
        draw.rounded_rectangle(box, radius=width * scale / 2, fill=(*LIME, opacities[index]))


def score_bars(draw, x, y, width):
    """Five people's scores for the same place — the product's core visual."""
    rows = [
        ("ANN", 0.74),
        ("BO", 0.66),
        ("CY", 0.84),
        ("DEE", 0.46),
        ("ELI", 0.55),
    ]
    label_font = font(SANS, 11)
    row_height = 8 * SS
    gap = 34 * SS
    for index, (label, value) in enumerate(rows):
        top = y + index * gap
        draw.text((x, top - 4 * SS), label, font=label_font, fill=(*MUTED, 190))
        track_x = x + 58 * SS
        track_w = width - 58 * SS
        draw.rounded_rectangle(
            [track_x, top, track_x + track_w, top + row_height],
            radius=row_height / 2,
            fill=(255, 255, 255, 16),
        )
        draw.rounded_rectangle(
            [track_x, top, track_x + track_w * value, top + row_height],
            radius=row_height / 2,
            fill=(*LIME, 210 if index == 2 else 120),
        )


def base_canvas():
    canvas = Image.new("RGBA", (W * SS, H * SS), (*BG, 255))
    canvas.alpha_composite(glow((W * SS, H * SS), (1040 * SS, 720 * SS), 620 * SS, LIME, 34))
    return canvas


def variant_full():
    canvas = base_canvas()
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    pad = 72 * SS
    divider_x = 748 * SS
    left_width = divider_x - pad - 34 * SS

    brand_mark(draw, pad, 58 * SS)
    draw.text((pad + 26 * SS, 56 * SS), "palateops", font=font(SANS, 21), fill=(*WHITE, 255))

    tracked(draw, (pad, 214 * SS), "GROUP DINING, DECIDED BY TASTE", font(SANS, 13), (*LIME, 235), tracking=2.6)

    line_one = "One table."
    line_two = "Nobody pretending."
    headline = fit_font(draw, SERIF, line_two, 84, left_width)
    draw.text((pad, 252 * SS), line_one, font=headline, fill=(*WHITE, 255))
    draw.text((pad, 348 * SS), line_two, font=headline, fill=(*WHITE, 255))

    draw.text((pad, 496 * SS), "Qloo ranks the same real restaurants for every person.",
              font=font(SANS, 19), fill=(*MUTED, 255))
    draw.text((pad, 528 * SS), "A place has to win twice to be called an answer.",
              font=font(SANS, 19), fill=(*MUTED, 255))

    draw.line([(divider_x, 214 * SS), (divider_x, 520 * SS)], fill=(255, 255, 255, 22), width=SS)
    right_x = divider_x + 40 * SS
    tracked(draw, (right_x, 214 * SS), "SAME PLACE", font(SANS, 11), (*MUTED, 190), tracking=1.6)
    tracked(draw, (right_x, 232 * SS), "FIVE PEOPLE", font(SANS, 11), (*MUTED, 190), tracking=1.6)
    score_bars(draw, right_x, 282 * SS, 300 * SS)
    tracked(draw, (right_x, 478 * SS), "ONE DECISION", font(SANS, 11), (*LIME, 200), tracking=1.6)

    draw.text((pad, 712 * SS), "POWERED BY QLOO", font=font(SANS, 11), fill=(*MUTED, 180))
    canvas.alpha_composite(layer)
    return canvas


def variant_minimal():
    canvas = base_canvas()
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    pad = 84 * SS

    brand_mark(draw, pad, 62 * SS)
    draw.text((pad + 26 * SS, 60 * SS), "palateops", font=font(SANS, 21), fill=(*WHITE, 255))

    draw.text((pad, 260 * SS), "One table.", font=font(SERIF, 104), fill=(*WHITE, 255))
    draw.text((pad, 376 * SS), "Nobody pretending.", font=font(SERIF, 104), fill=(*WHITE, 255))

    draw.rounded_rectangle([pad, 548 * SS, pad + 96 * SS, 554 * SS], radius=3 * SS, fill=(*LIME, 255))

    draw.text(
        (pad, 592 * SS),
        "An agent that ranks the same restaurants for everyone at the table",
        font=font(SANS, 19),
        fill=(*MUTED, 255),
    )
    draw.text(
        (pad, 622 * SS),
        "and keeps only the ones nobody has to pretend about.",
        font=font(SANS, 19),
        fill=(*MUTED, 255),
    )
    canvas.alpha_composite(layer)
    return canvas


def save(canvas, name, quality=92):
    full = canvas.convert("RGB").resize((W, H), Image.LANCZOS)
    png_path = OUT / f"{name}.png"
    jpg_path = OUT / f"{name}.jpg"
    full.save(png_path, "PNG", optimize=True)
    full.save(jpg_path, "JPEG", quality=quality, optimize=True)
    for path in (png_path, jpg_path):
        print(f"  {path.relative_to(ROOT)}  {path.stat().st_size // 1024} KB")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    print("rendering:")
    save(variant_full(), "thumbnail")
    save(variant_minimal(), "thumbnail-minimal")
    print("done — pick one, both are 1200x800 (3:2) and well under 5 MB")
