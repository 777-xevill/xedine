"""
Makes the Android / web-app icons from the chef tile (ADR 0065). Run from the repo root:

    python android/make-icons.py

Source: public/brand/logo-chef-512.png (the chef tile used everywhere, ADR 0063). Writes:
  public/brand/app-icon-full-512.png     full-bleed square (no rounded corners, no rim)
  public/brand/app-maskable-512.png      maskable: the whole chef inside the safe zone
  public/brand/app-maskable-192.png
  public/brand/app-monochrome-512.png    silhouette (alpha only): themed icon + notification icon
  docs/play-store/graphics/icon-512.png  the Play listing icon (= app-icon-full-512)
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "public" / "brand" / "logo-chef-512.png"
OUT = ROOT / "public" / "brand"
PLAY = ROOT / "docs" / "play-store" / "graphics"

# The tile's own paper colour (sampled 235-246 across the tile; 238 is its middle).
PAPER = (238, 238, 238, 255)


def chef_cutout(tile: Image.Image) -> Image.Image:
    """The chef alone on a transparent ground: flood the tile's light paper from its edges."""
    rgba = tile.convert("RGBA")
    lum = rgba.convert("L")
    alpha = rgba.getchannel("A")
    # 255 = paper-like (light, or the transparent corners), 0 = anything else.
    paper = Image.eval(lum, lambda v: 255 if v >= 222 else 0)
    paper.paste(255, mask=Image.eval(alpha, lambda a: 255 if a < 128 else 0))
    flood = paper.copy()
    for seed in [(0, 0), (511, 0), (256, 4), (4, 256), (507, 256), (0, 511), (511, 511)]:
        if flood.getpixel(seed) == 255:
            ImageDraw.floodfill(flood, seed, 128)
    # 128 = background reached from the edge; everything else (incl. the white eyes) is the chef.
    chef_mask = Image.eval(flood, lambda v: 0 if v == 128 else 255)
    chef_mask = chef_mask.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(0.8))
    out = rgba.copy()
    out.putalpha(chef_mask)
    return out


def place(chef: Image.Image, scale: float, centre_y: float | None = None) -> Image.Image:
    """The chef on the paper colour, scaled about the canvas centre (or bottom-flush at scale 1)."""
    canvas = Image.new("RGBA", (512, 512), PAPER)
    s = round(512 * scale)
    small = chef.resize((s, s), Image.LANCZOS)
    box = small.getbbox() or (0, 0, s, s)
    x = (512 - s) // 2
    if centre_y is None:
        y = 512 - s
    else:
        # Centre the chef's own bounding box vertically on centre_y.
        y = round(centre_y - (box[1] + box[3]) / 2)
    canvas.alpha_composite(small, (x, y))
    return canvas


def monochrome(icon: Image.Image) -> Image.Image:
    """White silhouette: the dark body and hat are solid; eyes, hat band, cloche and plate are holes."""
    lum = icon.convert("L")
    alpha = lum.point(lambda v: 255 if v < 60 else 0 if v > 110 else round((110 - v) * 255 / 50))
    white = Image.new("RGBA", icon.size, (255, 255, 255, 0))
    white.putalpha(alpha.filter(ImageFilter.GaussianBlur(0.5)))
    return white


def main() -> None:
    tile = Image.open(SRC).convert("RGBA")
    assert tile.size == (512, 512), tile.size
    chef = chef_cutout(tile)
    PLAY.mkdir(parents=True, exist_ok=True)

    # Full-bleed: the tile's composition without its rounded corners and rim. Play rounds it itself.
    full = place(chef, 1.0)
    full.save(OUT / "app-icon-full-512.png", optimize=True)
    full.convert("RGBA").save(PLAY / "icon-512.png", optimize=True)

    # Maskable: Android shows the middle ~79% (Bubblewrap insets the image 8.5dp in a 108dp layer, the
    # launcher masks the inner 72dp); the web's safe zone is a 40%-radius circle. At 0.6 the whole
    # chef, cloche and plate included, sits inside the circle.
    mask_icon = place(chef, 0.6, centre_y=262)
    mask_icon.save(OUT / "app-maskable-512.png", optimize=True)
    mask_icon.resize((192, 192), Image.LANCZOS).save(OUT / "app-maskable-192.png", optimize=True)

    monochrome(mask_icon).save(OUT / "app-monochrome-512.png", optimize=True)
    print("icons written to", OUT, "and", PLAY)


if __name__ == "__main__":
    main()
