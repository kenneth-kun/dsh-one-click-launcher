#!/usr/bin/env python3
"""Render the plugin icon (PNG + ICO; ICNS is produced by iconutil on macOS).

Maintainer-only helper: the generated files in assets/ are what ships.
Requires Pillow (`python3 -m pip install pillow`) and, for .icns, macOS.
"""
import pathlib
import shutil
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont

SIZE = 1024
SS = 4  # supersample factor for smooth edges
W = SIZE * SS
ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
FONT = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def rounded_mask(size, radius):
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def render() -> Image.Image:
    top, bottom = (77, 107, 254), (22, 35, 107)
    grad = Image.new("RGB", (W, W), top)
    gd = ImageDraw.Draw(grad)
    for y in range(W):
        gd.line([(0, y), (W, y)], fill=lerp(top, bottom, (y / (W - 1)) ** 0.85))

    radius = int(W * 0.2237)
    canvas = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    canvas.paste(grad, (0, 0), rounded_mask(W, radius))

    layer = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)

    # memo paper peeking out behind the bubble
    paper = Image.new("RGBA", (int(W * 0.42), int(W * 0.34)), (0, 0, 0, 0))
    pd = ImageDraw.Draw(paper)
    pw, ph = paper.size
    pd.rounded_rectangle(
        (0, 0, pw - 1, ph - 1),
        radius=int(pw * 0.09),
        fill=(247, 207, 90, 255),
        outline=(201, 154, 34, 255),
        width=int(W * 0.006),
    )
    for i in range(3):
        y = int(ph * (0.34 + i * 0.16))
        pd.line(
            [(int(pw * 0.18), y), (int(pw * (0.82 if i < 2 else 0.6)), y)],
            fill=(154, 116, 32, 190),
            width=int(W * 0.012),
        )
    paper = paper.rotate(9, expand=True, resample=Image.BICUBIC)
    layer.alpha_composite(paper, (int(W * 0.49), int(W * 0.12)))

    # speech bubble
    bx0, by0 = int(W * 0.17), int(W * 0.29)
    bx1, by1 = int(W * 0.83), int(W * 0.79)
    draw.rounded_rectangle((bx0, by0, bx1, by1), radius=int(W * 0.11), fill=(255, 255, 255, 255))
    draw.polygon(
        [
            (int(W * 0.30), int(W * 0.755)),
            (int(W * 0.245), int(W * 0.885)),
            (int(W * 0.435), int(W * 0.760)),
        ],
        fill=(255, 255, 255, 255),
    )

    # prompt glyph
    font = ImageFont.truetype(FONT, int(W * 0.24))
    glyph = "\u203a_"
    bbox = draw.textbbox((0, 0), glyph, font=font)
    gw, gh = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text(
        ((bx0 + bx1) / 2 - gw / 2 - bbox[0], (by0 + by1) / 2 - gh / 2 - bbox[1]),
        glyph,
        font=font,
        fill=(45, 76, 226, 255),
    )

    icon = Image.alpha_composite(canvas, layer).resize((SIZE, SIZE), Image.LANCZOS)
    return icon


def main() -> int:
    ASSETS.mkdir(parents=True, exist_ok=True)
    icon = render()

    icon.resize((512, 512), Image.LANCZOS).save(ASSETS / "icon.png", "PNG")
    icon.save(
        ASSETS / "icon.ico",
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )

    if sys.platform == "darwin" and shutil.which("iconutil"):
        iconset = ASSETS / "AppIcon.iconset"
        if iconset.exists():
            shutil.rmtree(iconset)
        iconset.mkdir()
        for size in (16, 32, 128, 256, 512):
            icon.resize((size, size), Image.LANCZOS).save(iconset / f"icon_{size}x{size}.png")
            icon.resize((size * 2, size * 2), Image.LANCZOS).save(
                iconset / f"icon_{size}x{size}@2x.png"
            )
        subprocess.run(
            ["iconutil", "-c", "icns", str(iconset), "-o", str(ASSETS / "icon.icns")], check=True
        )
        shutil.rmtree(iconset)
    print(f"icons written to {ASSETS}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
