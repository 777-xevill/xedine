"""Draws the café's own textures (plain Python + Pillow):  python scripts/landing-3d/make_textures.py

- the menu chalkboard: "Xedine" written at the top (the founder wants the name seen, 2026-11-17), chalk drawings
  of a coffee, a burger, a pizza slice and a croissant, dotted price lines and no other words, so it reads in
  every language and country;
- the A-frame chalk boards, the awning's edge and the window lettering, each with the name;
- the table QR card, the kitchen's checklist and a framed licence (marks and lines, no words);
- the wall clock's face: ticks only, no numerals (any language);
- latte art for the coffee cup;
- a stand-in till screen for Blender's look renders only (the page shows the real till screen live).
"""

import math
import os
import random

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, '.cache', 'landing-3d', 'assets', 'made')
FONTS = os.path.join(ROOT, '.cache', 'landing-3d', 'assets', 'fonts')
LOGO = os.path.join(ROOT, 'public', 'brand', 'logo-chef-512.png')
NAME = 'Xedine'  # our name, the same in Bangla and English
os.makedirs(OUT, exist_ok=True)
rng = random.Random(64)

CHALK = (236, 233, 222)


def chalk_line(d, pts, width=7, passes=4, jitter=2.2):
    for _ in range(passes):
        q = [(x + rng.uniform(-jitter, jitter), y + rng.uniform(-jitter, jitter)) for x, y in pts]
        a = rng.randint(120, 200)
        d.line(q, fill=(*CHALK, a), width=max(2, width + rng.randint(-2, 1)), joint='curve')


def arc_pts(cx, cy, rx, ry, a0, a1, n=40):
    return [(cx + rx * math.cos(math.radians(a0 + (a1 - a0) * i / n)),
             cy + ry * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]


def menu_board():
    w, h = 2048, 1024
    img = Image.new('RGBA', (w, h), (34, 38, 40, 255))
    # Slate texture: soft smudges of old chalk.
    smudge = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    sd = ImageDraw.Draw(smudge)
    for _ in range(140):
        x, y, r = rng.randint(0, w), rng.randint(0, h), rng.randint(40, 220)
        sd.ellipse((x - r, y - r * 0.4, x + r, y + r * 0.4), fill=(200, 200, 195, rng.randint(4, 12)))
    img.alpha_composite(smudge.filter(ImageFilter.GaussianBlur(28)))
    noise = Image.effect_noise((w, h), 18).convert('L').point(lambda p: int(p * 0.12))
    img = Image.composite(Image.new('RGBA', (w, h), (60, 64, 66, 255)), img, noise)
    layer = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    # Border
    m = 46
    chalk_line(d, [(m, m), (w - m, m), (w - m, h - m), (m, h - m), (m, m)], width=6)
    img.alpha_composite(layer.filter(ImageFilter.GaussianBlur(0.8)))
    chalk_title(img, NAME, (w // 2, 150), 150)
    layer = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    cells = [(256, 'coffee'), (768, 'burger'), (1280, 'pizza'), (1792, 'croissant')]
    for cx, kind in cells:
        cy = 470
        if kind == 'coffee':
            chalk_line(d, [(cx - 120, cy - 60), (cx - 100, cy + 110), (cx + 100, cy + 110), (cx + 120, cy - 60)])
            chalk_line(d, [(cx - 128, cy - 62), (cx + 128, cy - 62)])
            chalk_line(d, arc_pts(cx + 150, cy + 10, 50, 55, -90, 90))
            for sx in (-50, 0, 50):
                chalk_line(d, [(cx + sx + 12 * math.sin(t / 3), cy - 90 - t * 9) for t in range(14)], width=5)
            chalk_line(d, [(cx - 170, cy + 130), (cx + 190, cy + 130)])
        elif kind == 'burger':
            chalk_line(d, arc_pts(cx, cy - 20, 170, 120, 180, 360))
            chalk_line(d, [(cx - 170, cy - 20), (cx + 170, cy - 20)])
            chalk_line(d, [(cx - 185 + i * 37, cy + 10 + (12 if i % 2 else -6)) for i in range(11)], width=6)
            chalk_line(d, [(cx - 175, cy + 45), (cx + 175, cy + 45), (cx + 165, cy + 85), (cx - 165, cy + 85),
                           (cx - 175, cy + 45)])
            chalk_line(d, arc_pts(cx, cy + 105, 170, 40, 0, 180))
            for sx, sy in ((-60, -90), (0, -110), (60, -85), (-110, -60), (110, -55)):
                chalk_line(d, [(cx + sx - 8, cy + sy), (cx + sx + 8, cy + sy - 4)], width=5, passes=2)
        elif kind == 'pizza':
            chalk_line(d, [(cx - 150, cy - 110), (cx + 150, cy - 110), (cx, cy + 150), (cx - 150, cy - 110)])
            chalk_line(d, arc_pts(cx, cy - 175, 170, 70, 60, 120))
            for sx, sy, r in ((-60, -60, 26), (40, -40, 22), (-5, 30, 24), (70, -85, 16)):
                chalk_line(d, arc_pts(cx + sx, cy + sy, r, r, 0, 360, 24), width=5, passes=3)
        else:
            chalk_line(d, arc_pts(cx, cy + 40, 200, 110, 200, 340))
            chalk_line(d, arc_pts(cx, cy + 40, 200, 40, 20, 160))
            for sx in (-100, -35, 35, 100):
                chalk_line(d, [(cx + sx - 20, cy - 40), (cx + sx + 10, cy + 60)], width=6)
        # A dotted "price" line under each picture, no numbers or words.
        for i in range(12):
            x = cx - 170 + i * 25
            chalk_line(d, [(x, 760), (x + 9, 760)], width=6, passes=2, jitter=1.2)
        chalk_line(d, arc_pts(cx + 160, 760, 28, 28, 0, 360, 20), width=5, passes=3)
    img.alpha_composite(layer.filter(ImageFilter.GaussianBlur(0.8)))
    img.convert('RGB').save(os.path.join(OUT, 'menu_board.png'))


def font(size, weight='ExtraBold'):
    return ImageFont.truetype(os.path.join(FONTS, f'Inter-{weight}.ttf'), size)


def chalk_title(img, text, centre, size):
    """The name in chalk: solid letters broken up by grain, a soft dusty edge."""
    w, h = img.size
    mask = Image.new('L', (w, h), 0)
    ImageDraw.Draw(mask).text(centre, text, font=font(size), fill=255, anchor='mm')
    grain = Image.effect_noise((w, h), 90).convert('L').point(lambda p: 255 if p > 70 else 120)
    mask = Image.composite(mask, Image.new('L', (w, h), 0), grain).filter(ImageFilter.GaussianBlur(1.1))
    chalk = Image.new('RGBA', (w, h), (*CHALK, 255))
    chalk.putalpha(mask.point(lambda p: int(p * 0.9)))
    img.alpha_composite(chalk)


def slate(w, h):
    img = Image.new('RGBA', (w, h), (34, 38, 40, 255))
    smudge = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    sd = ImageDraw.Draw(smudge)
    for _ in range(60):
        x, y, r = rng.randint(0, w), rng.randint(0, h), rng.randint(30, 160)
        sd.ellipse((x - r, y - r * 0.4, x + r, y + r * 0.4), fill=(200, 200, 195, rng.randint(4, 12)))
    img.alpha_composite(smudge.filter(ImageFilter.GaussianBlur(22)))
    noise = Image.effect_noise((w, h), 18).convert('L').point(lambda p: int(p * 0.12))
    return Image.composite(Image.new('RGBA', (w, h), (60, 64, 66, 255)), img, noise)


def chalk_aframe():
    """The standing board by the door: the name, a coffee and a croissant, a little sun (morning)."""
    w, h = 768, 1152
    img = slate(w, h)
    chalk_title(img, NAME, (w // 2, 150), 128)
    layer = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    chalk_line(d, [(36, 36), (w - 36, 36), (w - 36, h - 36), (36, h - 36), (36, 36)], width=5)
    chalk_line(d, [(170, 250), (w - 170, 250)], width=5)
    cx, cy = w // 2, 520
    chalk_line(d, [(cx - 130, cy - 70), (cx - 105, cy + 120), (cx + 105, cy + 120), (cx + 130, cy - 70)])
    chalk_line(d, [(cx - 140, cy - 72), (cx + 140, cy - 72)])
    chalk_line(d, arc_pts(cx + 160, cy + 10, 52, 58, -90, 90))
    for sx in (-55, 0, 55):
        chalk_line(d, [(cx + sx + 12 * math.sin(t / 3), cy - 100 - t * 9) for t in range(13)], width=5)
    cy = 860
    chalk_line(d, arc_pts(cx, cy, 200, 105, 200, 340))
    chalk_line(d, arc_pts(cx, cy, 200, 38, 20, 160))
    for sx in (-100, -35, 35, 100):
        chalk_line(d, [(cx + sx - 20, cy - 80), (cx + sx + 10, cy + 20)], width=6)
    chalk_line(d, arc_pts(640, 330, 46, 46, 0, 360, 24), width=5)
    for i in range(8):
        a = math.tau * i / 8
        chalk_line(d, [(640 + 62 * math.cos(a), 330 + 62 * math.sin(a)),
                       (640 + 86 * math.cos(a), 330 + 86 * math.sin(a))], width=4, passes=2)
    img.alpha_composite(layer.filter(ImageFilter.GaussianBlur(0.8)))
    img.convert('RGB').save(os.path.join(OUT, 'chalk_aframe.png'))


def awning_valance():
    """The awning's front edge: sage cloth with the name in cream, scallops along the bottom."""
    w, h = 4096, 256
    sage, cream = (79, 122, 98), (244, 235, 221)
    img = Image.new('RGBA', (w, h), (*sage, 255))
    d = ImageDraw.Draw(img)
    d.rectangle((0, 18, w, 28), fill=(*cream, 255))
    d.text((w // 2, 112), NAME, font=font(132), fill=(*cream, 255), anchor='mm')
    d.rectangle((0, h - 30, w, h - 22), fill=(*cream, 255))
    img.convert('RGB').save(os.path.join(OUT, 'awning_valance.png'))


def awning_stripes():
    w, h = 1024, 256
    img = Image.new('RGB', (w, h), (79, 122, 98))
    d = ImageDraw.Draw(img)
    for i in range(0, w, 128):
        d.rectangle((i + 64, 0, i + 127, h), fill=(240, 232, 216))
    img = img.filter(ImageFilter.GaussianBlur(0.6))
    img.save(os.path.join(OUT, 'awning_stripes.png'))


def window_lettering():
    """The name on the shop window, white and a little see-through (the glass is live on the page)."""
    w, h = 2048, 512
    img = Image.new('RGBA', (w, h), (255, 255, 255, 0))
    d = ImageDraw.Draw(img)
    d.text((w // 2, h // 2 - 20), NAME, font=font(300), fill=(255, 255, 255, 235), anchor='mm')
    d.rectangle((w // 2 - 330, h - 92, w // 2 + 330, h - 80), fill=(255, 201, 60, 235))
    img.save(os.path.join(OUT, 'window_lettering.png'))


def qr_card():
    """The table's QR card: a scannable-looking code under the chef logo and the name, no other words."""
    w, h = 512, 768
    img = Image.new('RGB', (w, h), (248, 248, 246))
    d = ImageDraw.Draw(img)
    logo = Image.open(LOGO).convert('RGBA').resize((132, 132))
    img.paste(logo, (w // 2 - 66, 26), logo)
    d.text((w // 2, 196), NAME, font=font(50), fill=(43, 45, 49), anchor='mm')
    n, size = 25, 14
    x0, y0 = (w - n * size) // 2, 260
    q = random.Random(45)
    for r in range(n):
        for c in range(n):
            corners = ((0, 0), (0, n - 7), (n - 7, 0))
            box = next(((fr, fc) for fr, fc in corners if fr <= r < fr + 7 and fc <= c < fc + 7), None)
            if box:
                rr, cc = r - box[0], c - box[1]
                on = rr in (0, 6) or cc in (0, 6) or (2 <= rr <= 4 and 2 <= cc <= 4)
            else:
                on = q.random() < 0.48
            if on:
                d.rectangle((x0 + c * size, y0 + r * size, x0 + (c + 1) * size - 1, y0 + (r + 1) * size - 1),
                            fill=(43, 45, 49))
    d.rounded_rectangle((x0 - 18, y0 - 18, x0 + n * size + 18, y0 + n * size + 18), 18, outline=(255, 201, 60),
                        width=8)
    img.save(os.path.join(OUT, 'qr_card.png'))


def checklist():
    """The kitchen's daily checklist on a clipboard: tick boxes and lines."""
    w, h = 512, 700
    img = Image.new('RGB', (w, h), (250, 249, 244))
    d = ImageDraw.Draw(img)
    for i in range(9):
        y = 70 + i * 66
        d.rectangle((40, y, 80, y + 40), outline=(60, 62, 66), width=4)
        if i < 6:
            d.line([(47, y + 20), (58, y + 33), (78, y + 4)], fill=(46, 125, 80), width=7)
        d.line([(104, y + 22), (104 + rng.randint(220, 340), y + 22)], fill=(150, 152, 156), width=8)
    img.save(os.path.join(OUT, 'checklist.png'))


def certificate():
    """A framed licence on the office wall: a seal and lines, no words."""
    w, h = 700, 500
    img = Image.new('RGB', (w, h), (247, 243, 232))
    d = ImageDraw.Draw(img)
    d.rectangle((18, 18, w - 18, h - 18), outline=(150, 120, 70), width=6)
    d.rectangle((32, 32, w - 32, h - 32), outline=(190, 165, 110), width=2)
    d.line([(160, 90), (540, 90)], fill=(70, 72, 76), width=16)
    for i in range(5):
        d.line([(110, 160 + i * 42), (590 - (i % 2) * 90, 160 + i * 42)], fill=(160, 162, 166), width=7)
    d.ellipse((470, 330, 590, 450), fill=(196, 52, 52))
    d.ellipse((488, 348, 572, 432), outline=(240, 200, 200), width=4)
    d.line([(110, 420), (300, 420)], fill=(70, 72, 76), width=4)
    img.save(os.path.join(OUT, 'certificate.png'))


def clock_face():
    s = 1024
    img = Image.new('RGB', (s, s), (244, 241, 234))
    d = ImageDraw.Draw(img)
    c = s / 2
    for i in range(60):
        a = math.radians(i * 6)
        r1, r2, wd = (c * 0.92, c * 0.78, 18) if i % 5 == 0 else (c * 0.92, c * 0.86, 6)
        d.line([(c + r1 * math.sin(a), c - r1 * math.cos(a)), (c + r2 * math.sin(a), c - r2 * math.cos(a))],
               fill=(36, 38, 41), width=wd)
    d.ellipse((c - 18, c - 18, c + 18, c + 18), fill=(36, 38, 41))
    img.save(os.path.join(OUT, 'clock_face.png'))


def latte_art():
    s = 512
    img = Image.new('RGB', (s, s), (96, 58, 34))
    d = ImageDraw.Draw(img)
    for r in range(240, 0, -4):
        t = r / 240
        d.ellipse((s / 2 - r, s / 2 - r, s / 2 + r, s / 2 + r), fill=(int(110 - 30 * t), int(68 - 18 * t), int(40 - 10 * t)))
    cream = (236, 214, 184)
    # A heart: two circles and a triangle, softened.
    d.ellipse((150, 150, 270, 270), fill=cream)
    d.ellipse((242, 150, 362, 270), fill=cream)
    d.polygon([(152, 222), (360, 222), (256, 372)], fill=cream)
    img = img.filter(ImageFilter.GaussianBlur(3))
    img.save(os.path.join(OUT, 'latte.png'))


def till_stand_in():
    """Only for Blender's pictures; on the page the till screen is the real UI, live."""
    w, h = 1280, 800
    grey, silver, yellow = (43, 45, 49), (217, 218, 220), (255, 201, 60)
    img = Image.new('RGB', (w, h), grey)
    d = ImageDraw.Draw(img)
    d.rectangle((0, 0, w, 64), fill=(36, 38, 41))
    for i in range(5):
        d.rounded_rectangle((24 + i * 150, 14, 154 + i * 150, 50), 18,
                            fill=yellow if i == 0 else (58, 61, 66))
    foods = [(214, 140, 60), (196, 64, 48), (230, 196, 120), (120, 160, 80), (150, 96, 60), (240, 220, 200)]
    for r in range(3):
        for c in range(4):
            x, y = 24 + c * 200, 88 + r * 230
            d.rounded_rectangle((x, y, x + 184, y + 214), 22, fill=(52, 55, 60))
            d.ellipse((x + 42, y + 26, x + 142, y + 126), fill=foods[(r * 4 + c) % 6])
            d.rounded_rectangle((x + 22, y + 150, x + 162, y + 166), 8, fill=silver)
            d.rounded_rectangle((x + 22, y + 178, x + 102, y + 192), 7, fill=(140, 142, 146))
    d.rounded_rectangle((850, 88, 1256, 776), 24, fill=(52, 55, 60))
    for i in range(5):
        y = 120 + i * 70
        d.rounded_rectangle((878, y, 1080, y + 18), 9, fill=silver)
        d.rounded_rectangle((1160, y, 1228, y + 18), 9, fill=(170, 172, 176))
    d.rounded_rectangle((878, 680, 1228, 748), 26, fill=yellow)
    img.save(os.path.join(OUT, 'till_stand_in.png'))


if __name__ == '__main__':
    menu_board()
    chalk_aframe()
    awning_valance()
    awning_stripes()
    window_lettering()
    qr_card()
    checklist()
    certificate()
    clock_face()
    latte_art()
    till_stand_in()
    print('TEXTURES OK', OUT)
