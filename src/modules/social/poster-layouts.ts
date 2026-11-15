/**
 * Poster layouts (ADR 0057, 0058): where the dish, the words, the price and the contact go on a 1080×1350
 * (4:5) poster. A layout never fixes its colours, typeface, background, dish treatment or decorations — the
 * look does (Style, from poster-kit.ts) — so every layout comes in thousands of variations. The founder's
 * reference posters inspired the first ten; the rest are other things a restaurant's designer makes: a
 * magazine cover, a polaroid, a ticket, a chalkboard, a speech bubble, a collage…
 *
 * Words are escaped by text()/head(); pictures pass through cssUrl(); colours are the restaurant's own.
 */
import type { Layout } from './look';
import {
  type Box,
  contactLine,
  css,
  cssUrl,
  type DishArt,
  doodle,
  DOODLES,
  escapeHtml,
  INK,
  logo,
  mix,
  polaroidCaption,
  POSTER_SIZE,
  type PostContent,
  type Rgb,
  signature,
  stack,
  type Style,
  text,
  tornEdge,
  up,
  WHITE,
} from './poster-kit';

type Draw = (c: PostContent, s: Style) => string;

/** The headline split into up to `max` lines of similar length, for stacked type. */
export function stackLines(words: string, max: number): string[] {
  const parts = words.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= max) return parts.length ? parts : [words];
  const target = parts.join(' ').length / max;
  const out: string[] = [];
  let line = '';
  for (const w of parts) {
    if (line && line.length + 1 + w.length > target * 1.15 && out.length < max - 1) {
      out.push(line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) out.push(line);
  return out;
}

/** A pill with words, placed in a box and aligned in it. */
function pill(
  words: string,
  box: { left: number; top: number; width: number },
  bg: Rgb,
  ink: Rgb,
  o: { size?: number; align?: 'left' | 'right' | 'center'; extra?: string } = {},
): string {
  return `<div class="abs" style="left:${box.left}px;top:${box.top}px;width:${box.width}px;text-align:${o.align ?? 'left'};${o.extra ?? ''}"><span class="pill${/[ঀ-৿]/.test(words) ? ' bn' : ''}" style="background:${css(bg)};color:${css(ink)};font-size:${o.size ?? 32}px;max-width:${box.width}px;overflow:hidden;text-overflow:ellipsis;box-shadow:0 10px 24px rgb(0 0 0 / .18)">${escapeHtml(words)}</span></div>`;
}

/** A small line of capitals (or Bangla) above the big words. */
function kicker(
  words: string,
  box: Box,
  color: Rgb,
  align: 'left' | 'right' | 'center' = 'left',
  size = 26,
): string {
  return text(
    up(words),
    'abs nowrap',
    `left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px;font-size:${size}px;font-weight:800;letter-spacing:5px;line-height:${box.height}px;color:${css(color)};text-align:${align};overflow:hidden`,
  );
}

function line(
  words: string,
  box: Box,
  color: Rgb,
  o: { size?: number; weight?: number; align?: 'left' | 'right' | 'center'; wrap?: boolean; extra?: string } = {},
): string {
  const size = o.size ?? 32;
  return text(
    words,
    o.wrap ? 'abs' : 'abs nowrap',
    `left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px;font-size:${size}px;font-weight:${o.weight ?? 700};line-height:${o.wrap ? Math.round(size * 1.35) : box.height}px;color:${css(color)};text-align:${o.align ?? 'left'};overflow:hidden;${o.extra ?? ''}`,
  );
}

// ---------------------------------------------------------------------------------------------
// New layouts (ADR 0058)
// ---------------------------------------------------------------------------------------------

/** The dish in the middle, the headline above, the call to action on a tilted band. */
const spotlight: Draw = (c, s) => {
  const { k } = s;
  const w = c.words;
  return s.page(
    `${s.head(w.headline, { left: 50, top: 56, width: 980, height: 250 }, 160, { align: 'center', valign: 'center' })}
<div class="abs" style="left:110px;top:318px;width:860px;text-align:center">${text(w.tagline, '', `display:inline-block;max-width:860px;height:62px;padding:10px 30px;border-radius:999px;background:${css(k.card)};color:${css(k.onCard)};font-size:30px;font-weight:700;white-space:nowrap;overflow:hidden`)}</div>
${s.deco([
  { left: 40, top: 420, width: 190, height: 520 },
  { left: 850, top: 620, width: 190, height: 360 },
])}
<div class="abs" style="left:-200px;top:1040px;width:1600px;height:160px;background:${css(k.band)};transform:rotate(-6deg)"></div>
${s.head(c.cta, { left: 90, top: 1062, width: 900, height: 96 }, 70, { align: 'center', valign: 'center', color: k.onBand, nowrap: true, effect: 'plain', upper: true, extra: 'transform:rotate(-6deg)' })}
${s.plate(c.dish, { left: 130, top: 390, width: 820, height: 660 })}
${s.price(c.dish, 830, 420, 170)}
${s.sticker(c, 80, 450, -10)}
${signature(c, { left: 60, bottom: 36, width: 960 }, css(k.ink), { align: 'center', logoSize: 64, size: 0.9 })}`,
    { focus: { x: 540, y: 760 } },
  );
};

/** The headline stacked huge, line under line, the dish standing in front of it. */
const stacked: Draw = (c, s) => {
  const { k } = s;
  const lines = stackLines(c.words.headline, 4);
  const area = 720;
  const h = Math.floor(area / Math.max(lines.length, 2));
  const rows = lines
    .map((l, i) =>
      s.head(l, { left: 50, top: 50 + i * h, width: 980, height: h }, h * 1.08, {
        align: s.align('left'),
        nowrap: true,
        valign: 'center',
        color: i % 2 ? k.head2 : k.head,
      }),
    )
    .join('');
  return s.page(
    `${rows}
${s.plate(c.dish, { left: s.x(300, 780), top: 470, width: 780, height: 740 }, { z: 2 })}
${s.price(c.dish, s.x(70, 180), 880, 180, 'burst')}
${s.sticker(c, s.x(70, 300), 790, -8)}
${line(c.words.tagline, { left: s.x(60, 400), top: 1090, width: 400, height: 140 }, k.ink, { size: 34, wrap: true, align: s.align('left'), extra: 'z-index:3' })}
${signature(c, { left: 60, bottom: 34, width: 960 }, css(k.ink), { align: s.align('right'), logoSize: 60, size: 0.9 })}`,
    { focus: { x: 690, y: 860 } },
  );
};

/** The dish huge in a corner, running off the edges; the words stacked in the opposite corner. */
const corner: Draw = (c, s) => {
  const { k } = s;
  const w = c.words;
  const al = s.align('right');
  return s.page(
    `${s.plate(c.dish, { left: s.x(-160, 920), top: 500, width: 920, height: 900 }, { anchor: 'center' })}
${kicker(w.kicker, { left: s.x(360, 670), top: 70, width: 670, height: 44 }, k.head2, al, 26)}
${s.head(w.headline, { left: s.x(300, 730), top: 124, width: 730, height: 340 }, 150, { align: al })}
${line(w.tagline, { left: s.x(600, 430), top: 500, width: 430, height: 140 }, k.ink, { size: 30, weight: 600, wrap: true, align: al })}
${pill(c.cta, { left: s.x(560, 470), top: 680, width: 470 }, k.band, k.onBand, { align: al, size: 32 })}
${s.price(c.dish, s.x(840, 170), 820, 170)}
${s.sticker(c, s.x(60, 320), 90, -7)}
${s.deco([{ left: s.x(780, 260), top: 1000, width: 260, height: 200 }])}
${signature(c, { left: s.x(560, 470), bottom: 44, width: 470 }, css(k.ink), { align: al, logoSize: 60, size: 0.9 })}`,
    { focus: { x: s.x(300, 0), y: 960 } },
  );
};

/** A big circle of colour behind the dish, like a plate under a spotlight. */
const halo: Draw = (c, s) => {
  const { k } = s;
  const w = c.words;
  const R = 380;
  const cy = 760;
  return s.page(
    `<div class="abs" style="left:${540 - R}px;top:${cy - R}px;width:${R * 2}px;height:${R * 2}px;border-radius:50%;background:${css(k.band)}"></div>
<div class="abs" style="left:${540 - R - 36}px;top:${cy - R - 36}px;width:${(R + 36) * 2}px;height:${(R + 36) * 2}px;border-radius:50%;border:5px dashed ${css(k.deco, 0.6)}"></div>
${kicker(w.kicker, { left: 90, top: 56, width: 900, height: 44 }, k.head2, 'center', 26)}
${s.head(w.headline, { left: 60, top: 104, width: 960, height: 210 }, 140, { align: 'center', valign: 'center' })}
${s.plate(c.dish, { left: 200, top: 410, width: 680, height: 680 }, { anchor: 'center' })}
${s.price(c.dish, 800, 400, 160)}
${s.sticker(c, 100, 420, -10)}
${s.deco([
  { left: 30, top: 380, width: 140, height: 720 },
  { left: 910, top: 640, width: 140, height: 460 },
])}
${line(w.tagline, { left: 120, top: 1180, width: 840, height: 56 }, k.ink, { size: 32, align: 'center' })}
${signature(c, { left: 60, bottom: 26, width: 960 }, css(k.ink), { align: 'center', logoSize: 52, size: 0.8 })}`,
    { focus: { x: 540, y: cy } },
  );
};

/** A magazine cover: the restaurant's name as the masthead, the dish as the cover star, cover lines. */
const cover: Draw = (c, s) => {
  const { k } = s;
  const w = c.words;
  return s.page(
    `${s.head(c.restaurant, { left: 40, top: 26, width: 1000, height: 200 }, 200, { align: 'center', valign: 'center', nowrap: true, effect: 'plain' })}
<div class="abs" style="left:50px;top:232px;width:980px;height:5px;background:${css(k.head)}"></div>
${kicker(w.kicker, { left: 50, top: 248, width: 560, height: 40 }, k.ink, 'left', 24)}
${c.area ? kicker(c.area, { left: 620, top: 248, width: 410, height: 40 }, k.muted, 'right', 22) : ''}
${s.plate(c.dish, { left: 380, top: 330, width: 860, height: 1040 }, { anchor: 'center' })}
${s.head(w.headline, { left: 50, top: 330, width: 430, height: 420 }, 118, { extra: 'z-index:3' })}
${line(w.tagline, { left: 50, top: 780, width: 360, height: 190 }, k.ink, { size: 32, weight: 600, wrap: true, extra: 'z-index:3' })}
${s.price(c.dish, 60, 990, 180)}
${s.sticker(c, 720, 300, 8)}
${pill(c.cta, { left: 50, top: 1220, width: 520 }, k.band, k.onBand, { size: 30 })}`,
    { focus: { x: 800, y: 820 } },
  );
};

/** A colour panel down one side holding all the words; the dish on the other side. */
const side: Draw = (c, s) => {
  const { k } = s;
  const w = c.words;
  const P = 470;
  const al = s.align('left');
  const photo = !['float', 'sticker', 'podium'].includes(s.look.plate);
  return s.page(
    `<div class="abs" style="left:${s.x(0, P)}px;top:0;width:${P}px;height:1350px;background:${css(k.band)}"></div>
${kicker(w.kicker, { left: s.x(56, 380), top: 96, width: 380, height: 40 }, k.onBand, al, 22)}
${s.head(w.headline, { left: s.x(50, 390), top: 150, width: 390, height: 560 }, 130, { color: k.onBand, align: al })}
${line(w.tagline, { left: s.x(56, 370), top: 740, width: 370, height: 200 }, k.onBand, { size: 30, weight: 600, wrap: true, align: al })}
${pill(c.cta, { left: s.x(56, 380), top: 980, width: 380 }, k.card, k.onCard, { align: al, size: 30 })}
${signature(c, { left: s.x(56, 380), bottom: 56, width: 380 }, css(k.onBand), { align: al, logoSize: 56, size: 0.85 })}
${s.plate(
  c.dish,
  photo
    ? { left: s.x(530, 500), top: 220, width: 500, height: 880 }
    : { left: s.x(430, 640), top: 330, width: 640, height: 800 },
  { anchor: 'center' },
)}
${s.price(c.dish, s.x(870, 170), 1110, 170)}
${s.sticker(c, s.x(640, 300), 130, 6)}
${s.deco([{ left: s.x(520, 520), top: 50, width: 520, height: 150 }])}`,
    { focus: { x: s.x(760, 0), y: 720 } },
  );
};

/** A speech bubble asks the question; the dish below is the answer. */
const bubble: Draw = (c, s) => {
  const { k } = s;
  const w = c.words;
  const B = { left: 60, top: 70, width: 960, height: 420 };
  const tail = s.x(620, 120);
  const path = s.look.mirror ? 'M120 0 L 10 0 L 96 112 Z' : 'M0 0 L 110 0 L 24 112 Z';
  return s.page(
    `<div class="abs" style="left:${B.left}px;top:${B.top}px;width:${B.width}px;height:${B.height}px;border-radius:64px;background:${css(k.card)};box-shadow:0 24px 50px rgb(0 0 0 / .16)"></div>
<svg class="abs" style="left:${tail}px;top:${B.top + B.height - 4}px" width="120" height="114"><path d="${path}" fill="${css(k.card)}"/></svg>
${s.head(w.hook, { left: B.left + 56, top: B.top + 40, width: B.width - 112, height: B.height - 80 }, 120, { align: 'center', valign: 'center', color: k.cardHead, effect: 'plain' })}
${s.plate(c.dish, { left: 170, top: 560, width: 740, height: 610 })}
${s.price(c.dish, s.x(840, 170), 600, 170)}
${s.sticker(c, s.x(80, 300), 580, -8)}
${s.deco([
  { left: 30, top: 600, width: 150, height: 520 },
  { left: 900, top: 800, width: 150, height: 340 },
])}
${line(w.tagline, { left: 60, top: 1192, width: 960, height: 52 }, k.ink, { size: 30, align: 'center' })}
${signature(c, { left: 60, bottom: 24, width: 960 }, css(k.ink), { align: 'center', logoSize: 50, size: 0.8 })}`,
  );
};

/** A coupon-like ticket: the dish on top, the call to action on the stub below the perforation. */
const ticket: Draw = (c, s) => {
  const { k } = s;
  const w = c.words;
  const T = { left: 70, top: 76, width: 940, height: 1200 };
  const cut = 830;
  const r = 46;
  const mask = `radial-gradient(circle at 0 ${cut}px,transparent ${r}px,black ${r + 1}px) left/50.5% 100% no-repeat,radial-gradient(circle at 100% ${cut}px,transparent ${r}px,black ${r + 1}px) right/50.5% 100% no-repeat`;
  return s.page(
    `<div class="abs" style="left:${T.left}px;top:${T.top}px;width:${T.width}px;height:${T.height}px;filter:drop-shadow(0 26px 40px rgb(0 0 0 / .28))"><div style="width:100%;height:100%;border-radius:44px;background:${css(k.card)};-webkit-mask:${mask};mask:${mask}"></div></div>
<div class="abs" style="left:${T.left + 70}px;top:${T.top + cut - 3}px;width:${T.width - 140}px;height:0;border-top:5px dashed ${css(k.onCard, 0.22)}"></div>
${kicker(w.kicker, { left: 130, top: 126, width: 820, height: 40 }, k.cardHead, 'center', 24)}
${s.head(w.headline, { left: 120, top: 170, width: 840, height: 200 }, 120, { align: 'center', valign: 'center', color: k.cardHead })}
${s.plate(c.dish, { left: 200, top: 380, width: 680, height: 500 })}
${s.price(c.dish, 800, 620, 160)}
${s.sticker(c, 120, 410, -8)}
${s.head(c.cta, { left: 120, top: T.top + cut + 40, width: 840, height: 120 }, 92, { align: 'center', valign: 'center', color: k.cardHead, upper: true, effect: 'plain', nowrap: true })}
${line(w.tagline, { left: 140, top: T.top + cut + 168, width: 800, height: 48 }, k.onCard, { size: 28, weight: 600, align: 'center' })}
${signature(c, { left: 140, bottom: 104, width: 800 }, css(k.onCard), { align: 'center', logoSize: 52, size: 0.8 })}`,
  );
};

/** Comic-book shout: a starburst with the big words, the dish leaping out, halftone and rays. */
const burst: Draw = (c, s) => {
  const { k } = s;
  const w = c.words;
  const burstSvg = DOODLES.burst.replace(
    '<svg ',
    `<svg width="100%" height="100%" style="color:${css(k.band)}" `,
  );
  return s.page(
    `${s.plate(c.dish, { left: 250, top: 420, width: 830, height: 830 }, { anchor: 'center' })}
<div class="abs" style="left:10px;top:24px;width:660px;height:660px;transform:rotate(-8deg);filter:drop-shadow(0 18px 24px rgb(0 0 0 / .3))">${burstSvg}</div>
${s.head(w.headline, { left: 150, top: 190, width: 380, height: 320 }, 112, { align: 'center', valign: 'center', color: k.onBand, extra: 'transform:rotate(-8deg)' })}
${s.head(w.kicker, { left: 640, top: 70, width: 400, height: 230 }, 76, { align: 'right', valign: 'center' })}
${s.price(c.dish, 840, 980, 190, 'burst')}
${s.sticker(c, 700, 330, 10)}
${s.deco([
  { left: 30, top: 720, width: 220, height: 420 },
  { left: 700, top: 330, width: 330, height: 120 },
])}
${line(w.tagline, { left: 60, top: 1206, width: 960, height: 52 }, k.ink, { size: 32, align: 'center' })}
${signature(c, { left: 60, bottom: 24, width: 960 }, css(k.ink), { align: 'center', logoSize: 50, size: 0.8 })}`,
    { focus: { x: 660, y: 830 } },
  );
};

/** A polaroid of the real photo, taped on, the dish's name handwritten under it. */
const polaroid: Draw = (c, s) => {
  const { k } = s;
  const w = c.words;
  const box = { left: 210, top: 320, width: 660, height: 800 };
  const turn = Math.round(s.rnd() * 8 - 4);
  const cap = polaroidCaption(box);
  return s.page(
    `${s.head(w.headline, { left: 60, top: 56, width: 960, height: 236 }, 130, { align: 'center', valign: 'center' })}
<div class="abs" style="left:0;top:0;width:1080px;height:1350px;transform:rotate(${turn}deg);transform-origin:540px 720px">
${s.plate(c.dish, box, { kind: 'polaroid' })}
${text(c.dish.name, 'abs nowrap', `left:${cap.left}px;top:${cap.top}px;width:${cap.width}px;height:${cap.height}px;font-family:${stack('caveat')};font-weight:700;font-size:66px;line-height:${cap.height}px;color:${css(INK)};text-align:center;overflow:hidden`)}
</div>
${s.price(c.dish, 800, 340, 160)}
${s.sticker(c, 70, 360, -12)}
${s.deco([
  { left: 24, top: 420, width: 170, height: 680 },
  { left: 890, top: 560, width: 170, height: 560 },
])}
${line(w.tagline, { left: 60, top: 1166, width: 960, height: 56 }, k.ink, { size: 32, align: 'center' })}
${signature(c, { left: 60, bottom: 28, width: 960 }, css(k.ink), { align: 'center', logoSize: 52, size: 0.85 })}`,
    { fonts: ['caveat'] },
  );
};

/** A framed vintage bill: stars, a serif or slab headline, the dish in the middle, a ribbon. */
const vintage: Draw = (c, s) => {
  const { k } = s;
  const w = c.words;
  const rule = (top: number) =>
    `<div class="abs" style="left:330px;top:${top}px;width:420px;height:20px;display:flex;align-items:center;gap:14px"><div style="flex:1;height:3px;background:${css(k.head2, 0.7)}"></div><div style="width:16px;height:16px;transform:rotate(45deg);background:${css(k.head)}"></div><div style="flex:1;height:3px;background:${css(k.head2, 0.7)}"></div></div>`;
  const star = (left: number, size: number) =>
    doodle('star', { left, top: 86 - size / 2, width: size }, css(k.head));
  return s.page(
    `<div class="abs" style="inset:28px;border:4px solid ${css(k.head2, 0.75)}"></div>
<div class="abs" style="inset:42px;border:1.5px solid ${css(k.head2, 0.5)}"></div>
${star(470, 32)}${star(520, 40)}${star(578, 32)}
${kicker(w.kicker, { left: 120, top: 120, width: 840, height: 42 }, k.head2, 'center', 24)}
${s.head(w.headline, { left: 100, top: 170, width: 880, height: 250 }, 130, { align: 'center', valign: 'center' })}
${rule(440)}
${s.plate(c.dish, { left: 260, top: 486, width: 560, height: 560 }, { anchor: 'center' })}
${s.price(c.dish, 790, 520, 150)}
${s.sticker(c, 110, 530, -8)}
${line(w.tagline, { left: 120, top: 1070, width: 840, height: 56 }, k.ink, { size: 32, weight: 600, align: 'center', extra: 'font-style:italic' })}
<svg class="abs" style="left:220px;top:1144px" width="640" height="96"><polygon points="0,0 640,0 608,48 640,96 0,96 32,48" fill="${css(k.band)}"/></svg>
${s.head(c.cta, { left: 280, top: 1152, width: 520, height: 80 }, 48, { align: 'center', valign: 'center', color: k.onBand, nowrap: true, effect: 'plain', upper: true })}
${line([c.restaurant, contactLine(c)].filter(Boolean).join('  •  '), { left: 90, top: 1256, width: 900, height: 36 }, k.ink, { size: 22, align: 'center', extra: 'letter-spacing:1px' })}`,
  );
};

/** A café chalkboard in a wooden frame, the special written in chalk with an arrow to the dish. */
const chalkboard: Draw = (c, s) => {
  const { k } = s;
  const w = c.words;
  const wood = 'rgb(122 84 48)';
  const price = c.dish.price
    ? `${doodle('circle', { left: 96, top: 820, width: 250 }, css(k.accent), 'opacity:.9')}${text(c.dish.price, 'abs nowrap', `left:116px;top:900px;width:210px;height:90px;font-family:${stack('caveat')};font-weight:700;font-size:72px;line-height:90px;color:${css(k.ink)};text-align:center;overflow:hidden`)}`
    : '';
  return s.page(
    `${s.head(w.kicker, { left: 90, top: 76, width: 760, height: 100 }, 76, { color: k.head2, effect: 'plain', font: 'caveat', upper: false })}
${s.head(w.headline, { left: 90, top: 176, width: 900, height: 280 }, 140, {})}
${s.plate(c.dish, { left: 390, top: 470, width: 620, height: 640 }, { anchor: 'center' })}
${doodle('loopArrow', { left: 170, top: 500, width: 200, height: 240 }, css(k.ink), 'transform:rotate(-24deg);opacity:.85')}
${price}
${s.deco([{ left: 820, top: 70, width: 180, height: 300 }])}
${text(w.tagline, 'abs', `left:90px;top:1120px;width:600px;height:130px;font-family:${stack('caveat')};font-weight:700;font-size:50px;line-height:60px;color:${css(k.ink)};overflow:hidden`)}
${signature(c, { left: 600, bottom: 64, width: 420 }, css(k.ink), { align: 'right', logoSize: 52, size: 0.8 })}
<div class="abs" style="inset:0;border:30px solid ${wood};box-shadow:inset 0 0 0 6px rgb(0 0 0 / .25),inset 0 0 90px rgb(0 0 0 / .45)"></div>`,
    { fonts: ['caveat'] },
  );
};

/** Several real dish photos in a grid, a round badge with the big words in the middle. */
const collage: Draw = (c, s) => {
  const { k } = s;
  const w = c.words;
  const pics = [c.dish, ...c.more].slice(0, 4);
  const G = 14;
  const H = 1220;
  const half = (1080 - G) / 2;
  const halfH = (H - G) / 2;
  const tiles: Box[] =
    pics.length >= 4
      ? [
          { left: 0, top: 0, width: half, height: halfH },
          { left: half + G, top: 0, width: half, height: halfH },
          { left: 0, top: halfH + G, width: half, height: halfH },
          { left: half + G, top: halfH + G, width: half, height: halfH },
        ]
      : pics.length === 3
        ? [
            { left: 0, top: 0, width: half, height: H },
            { left: half + G, top: 0, width: half, height: halfH },
            { left: half + G, top: halfH + G, width: half, height: halfH },
          ]
        : [
            { left: 0, top: 0, width: 1080, height: halfH },
            { left: 0, top: halfH + G, width: 1080, height: halfH },
          ];
  const label = (d: DishArt, b: Box) =>
    text(
      d.price ? `${d.name}  ${d.price}` : d.name,
      'abs nowrap',
      `left:${b.left + 24}px;top:${b.top + b.height - 84}px;max-width:${b.width - 48}px;height:60px;padding:0 24px;border-radius:999px;background:${css(k.card, 0.92)};color:${css(k.onCard)};font-size:28px;font-weight:800;line-height:60px;overflow:hidden`,
    );
  const D = 440;
  const top = (H - D) / 2;
  return s.page(
    `${pics
      .map(
        (d, i) =>
          `<img class="photo" alt="" src="${cssUrl(d.photoUrl)}" style="left:${tiles[i]!.left}px;top:${tiles[i]!.top}px;width:${tiles[i]!.width}px;height:${tiles[i]!.height}px">${label(d, tiles[i]!)}`,
      )
      .join('')}
<div class="abs" style="left:${540 - D / 2}px;top:${top}px;width:${D}px;height:${D}px;border-radius:50%;background:${css(k.band)};box-shadow:0 0 0 14px ${css(k.bg)},0 30px 60px rgb(0 0 0 / .35)"></div>
${kicker(w.kicker, { left: 540 - D / 2 + 50, top: top + 80, width: D - 100, height: 40 }, k.onBand, 'center', 22)}
${s.head(w.headline, { left: 540 - D / 2 + 46, top: top + 124, width: D - 92, height: 200 }, 92, { align: 'center', valign: 'center', color: k.onBand })}
${s.sticker(c, 700, 90, 8)}
<div class="abs" style="left:0;top:${H}px;width:1080px;height:${1350 - H}px;background:${css(k.bg)}"></div>
${signature(c, { left: 60, bottom: 22, width: 960 }, css(k.ink), { align: 'center', logoSize: 60, size: 0.9 })}`,
    { backdrop: false },
  );
};

// ---------------------------------------------------------------------------------------------
// The first ten (ADR 0057), now in the look's colours, type and dish treatment
// ---------------------------------------------------------------------------------------------

/** "What's your status? ○ Single ○ Taken ✓ Hungry" with a hand-drawn arrow to the dish. */
const status: Draw = (c, s) => {
  const { k } = s;
  const head = css(k.head);
  const w = c.words;
  const row = (label: string, top: number, checked: boolean) =>
    `${doodle(checked ? 'checkCircle' : 'circle', { left: 84, top: top + 6, width: checked ? 92 : 82, height: 82 }, head)}
${text(label, 'abs nowrap', `left:200px;top:${top}px;width:560px;height:100px;font-size:78px;font-weight:600;color:${css(k.ink)};line-height:96px;overflow:hidden`)}`;
  return s.page(
    `${s.head(w.statusQ, { left: 80, top: 90, width: 930, height: 140 }, 118, { nowrap: true, valign: 'center' })}
${row(w.statusA, 270, false)}
${row(w.statusB, 390, false)}
${row(w.statusC, 510, true)}
${doodle('loopArrow', { left: 112, top: 640, width: 250, height: 300 }, head, 'transform:rotate(-8deg)')}
${s.plate(c.dish, { left: 260, top: 540, width: 820, height: 700 })}
${s.sticker(c, 720, 300)}
${signature(c, { left: 80, bottom: 56, width: 520 }, css(k.ink))}`,
    { focus: { x: 670, y: 900 } },
  );
};

/** "What's your M(dish)(dish)D today?": the O's of the word are plates. */
const mood: Draw = (c, s) => {
  const { k } = s;
  const w = c.words;
  const second = c.more[0] ?? c.dish;
  const plateO = (d: DishArt) =>
    d.cutUrl
      ? `<span style="display:inline-block;width:.82em;height:.82em;margin:0 .02em;vertical-align:-.06em;border-radius:50%;background:${css(k.card)};box-shadow:0 .05em .12em rgb(0 0 0 / .22);position:relative"><img alt="" src="${cssUrl(d.cutUrl)}" style="position:absolute;inset:6%;width:88%;height:88%;object-fit:contain"></span>`
      : `<img alt="" src="${cssUrl(d.photoUrl)}" style="display:inline-block;width:.82em;height:.82em;margin:0 .02em;vertical-align:-.06em;border-radius:50%;object-fit:cover;box-shadow:0 .05em .12em rgb(0 0 0 / .22)">`;
  let o = 0;
  const letters = [...w.moodWord]
    .map((ch) => (ch === 'O' ? plateO(o++ % 2 === 0 ? c.dish : second) : escapeHtml(ch)))
    .join('');
  const size = Math.round((290 * s.font.scale) / 0.78);
  return s.page(
    `${s.plate(c.dish, { left: 620, top: -170, width: 600, height: 560 }, { kind: c.dish.cutUrl ? 'float' : 'circle', anchor: 'center', rotate: -12 })}
${s.plate(second, { left: -190, top: 960, width: 600, height: 520 }, { kind: second.cutUrl ? 'float' : 'circle', anchor: 'center', rotate: 10 })}
${text(w.moodTop, 'abs nowrap', `left:120px;top:420px;width:840px;height:100px;font-size:74px;font-weight:800;line-height:96px;color:${css(k.ink)};overflow:hidden`)}
<div class="abs nowrap" data-fit style="left:90px;top:515px;width:900px;height:300px;font-family:${s.font.stack};font-weight:${s.font.weight};font-size:${size}px;line-height:290px;text-align:center;color:${css(k.head)};overflow:hidden">${letters}</div>
${text(w.moodBottom, 'abs nowrap', `left:120px;top:812px;width:840px;height:100px;font-size:74px;font-weight:800;text-align:right;line-height:96px;color:${css(k.ink)};overflow:hidden`)}
${signature(c, { left: 560, bottom: 60, width: 460 }, css(k.ink), { align: 'right', logoSize: 70 })}`,
  );
};

/** A giant sideways word on a colour strip, the dish standing in front, "the best is here at …". */
const giant: Draw = (c, s) => {
  const { k } = s;
  const word = up(c.dish.name);
  const mirror = s.look.mirror;
  const al = s.align('right');
  const rotated = mirror
    ? `left:1040px;top:40px;transform:rotate(90deg)`
    : `left:40px;top:1310px;transform:rotate(-90deg)`;
  return s.page(
    `<div class="abs" style="left:${s.x(0, 410)}px;top:0;width:410px;height:1350px;background:${css(k.band)};border-radius:${mirror ? '260px 0 0 0' : '0 260px 0 0'}"></div>
<div class="abs nowrap${/[ঀ-৿]/.test(word) ? ' bn' : ''}" data-fit style="${rotated};width:1260px;height:350px;transform-origin:0 0;font-family:${s.font.stack};font-weight:${s.font.weight};font-size:${Math.round(330 * s.font.scale)}px;line-height:350px;color:${css(k.onBand)};overflow:hidden">${escapeHtml(word)}</div>
${s.head(c.words.kicker, { left: s.x(440, 600), top: 70, width: 600, height: 250 }, 118, { align: al })}
${line(up(c.restaurant), { left: s.x(440, 600), top: 330, width: 600, height: 84 }, k.ink, { size: 62, align: al, extra: `font-family:${s.font.stack};font-weight:${s.font.weight}` })}
${c.dish.price ? line(`${c.dish.name}  ${c.dish.price}`, { left: s.x(440, 600), top: 420, width: 600, height: 50 }, k.ink, { size: 34, weight: 600, align: al }) : ''}
${s.deco([{ left: s.x(420, 620), top: 500, width: 620, height: 700 }])}
${s.plate(c.dish, { left: s.x(300, 760), top: 490, width: 760, height: 750 }, { anchor: 'center', kind: s.look.plate === 'card' ? 'card' : undefined })}
${s.sticker(c, s.x(470, 300), 500, -8)}
${signature(c, { left: s.x(440, 600), bottom: 40, width: 600 }, css(k.ink), { align: al, logoSize: 64 })}`,
    { focus: { x: s.x(680, 0), y: 860 } },
  );
};

/** Slanted launch headline, the dish riding a thick diagonal band with the call to action along it. */
const band: Draw = (c, s) => {
  const { k } = s;
  const second = c.more[0];
  return s.page(
    `${s.head(c.words.headline, { left: 50, top: 70, width: 980, height: 290 }, 210, { extra: 'transform:rotate(-5deg) skewX(-6deg)' })}
${line(c.words.tagline, { left: 70, top: 330, width: 900, height: 120 }, k.ink, { size: 44, wrap: true, extra: 'transform:rotate(-5deg)' })}
<div class="abs" style="left:-320px;top:760px;width:1900px;height:330px;background:${css(k.band)};transform:rotate(-22deg)">
${text(up(c.cta), 'abs nowrap up', `right:620px;bottom:30px;width:640px;height:70px;font-size:46px;font-weight:800;letter-spacing:2px;line-height:70px;color:${css(k.onBand)};text-align:right;overflow:hidden`)}
</div>
${s.plate(c.dish, { left: 430, top: 430, width: 620, height: 450 })}
${second ? s.plate(second, { left: 60, top: 760, width: 440, height: 330 }) : ''}
${s.sticker(c, 690, 380, -14)}
${s.deco([{ left: 60, top: 470, width: 320, height: 240 }])}
${logo(c, 84, 'right:60px;bottom:150px', k)}
${line(c.restaurant, { left: 500, top: 1208, width: 520, height: 46 }, k.ink, { size: 34, weight: 800, align: 'right' })}
${contactLine(c) ? line(contactLine(c), { left: 500, top: 1262, width: 520, height: 36 }, k.ink, { size: 24, weight: 600, align: 'right' }) : ''}`,
  );
};

/** Bold colour with a light road through it, flying leaves, a playful headline and the phone number. */
const split: Draw = (c, s) => {
  const { k } = s;
  const names = [c.dish, ...c.more]
    .slice(0, 4)
    .map((d) => up(d.name))
    .join('  |  ');
  return s.page(
    `<svg class="abs" style="left:0;top:0" width="1080" height="1350"><polygon points="150,0 340,0 760,1350 0,1350 0,560" fill="${css(k.card)}"/></svg>
${doodle('leaf', { left: 40, top: 40, width: 120, height: 60 }, '', 'transform:rotate(-30deg)')}
${doodle('leafDark', { left: 170, top: 150, width: 90, height: 45 }, '', 'transform:rotate(40deg)')}
${doodle('leaf', { left: 380, top: 70, width: 70, height: 35 }, '', 'transform:rotate(-70deg)')}
${logo(c, 92, 'left:600px;top:60px', k, true)}
${line(up(c.restaurant), { left: 710, top: 66, width: 330, height: 84 }, k.ink, { size: 40, wrap: true, extra: `font-family:${s.font.stack};line-height:42px` })}
${line(names, { left: 520, top: 220, width: 520, height: 40 }, k.ink, { size: 24, align: 'right', extra: 'letter-spacing:1px' })}
${s.head(c.words.headline, { left: 480, top: 280, width: 560, height: 330 }, 150, { align: 'right' })}
${line(c.words.tagline, { left: 560, top: 640, width: 480, height: 170 }, k.ink, { size: 30, weight: 500, wrap: true, align: 'right' })}
${pill(c.labels.orderNow, { left: 560, top: 850, width: 480 }, k.band, k.onBand, { align: 'right' })}
${c.phone ? line(c.phone, { left: 560, top: 960, width: 480, height: 76 }, k.ink, { size: 58, weight: 800, align: 'right' }) : ''}
${c.area ? line(c.area, { left: 560, top: 1040, width: 480, height: 44 }, k.ink, { size: 28, weight: 600, align: 'right', extra: 'opacity:.9' }) : ''}
${s.deco([{ left: 200, top: 230, width: 200, height: 150 }])}
${s.plate(c.dish, { left: -20, top: 360, width: 580, height: 540 }, { anchor: 'center' })}
${s.head(c.cta, { left: 40, top: 960, width: 560, height: 330 }, 120, { color: k.cardHead, extra: 'transform:rotate(-8deg)' })}
${s.sticker(c, 360, 300, -10)}`,
  );
};

/** An Instagram-style post card over the dish's own photo, the plate breaking out of the frame. */
const frame: Draw = (c, s) => {
  const { k } = s;
  const ink = css(INK);
  const muted = 'rgb(110 110 120)';
  const cardTop = 250;
  const imgTop = cardTop + 118;
  const imgH = 620;
  return s.page(
    `<img class="photo" alt="" src="${cssUrl(c.dish.photoUrl)}" style="left:-80px;top:-80px;width:1240px;height:1510px;filter:blur(30px) brightness(.5) saturate(1.25)">
<div class="abs" style="inset:0;background:radial-gradient(circle at 50% 45%,${css(k.bg2, 0.2)} 30%,${css(mix(k.bg2, INK, 0.5), 0.6)} 100%)"></div>
${s.head(c.words.headline, { left: 60, top: 64, width: 960, height: 150 }, 124, { align: 'center', valign: 'center', nowrap: true, color: WHITE, extra: 'text-shadow:0 8px 30px rgb(0 0 0 / .35)' })}
<div class="abs" style="left:150px;top:${cardTop}px;width:780px;height:${118 + imgH + 120}px;background:${css(WHITE)};border-radius:34px;box-shadow:0 40px 90px rgb(0 0 0 / .45)"></div>
${logo(c, 72, `left:184px;top:${cardTop + 23}px;border-radius:50%`, k)}
${line(c.restaurant, { left: 274, top: cardTop + 22, width: 520, height: 44 }, INK, { size: 32 })}
${c.area ? `${doodle('pin', { left: 274, top: cardTop + 68, width: 22 }, muted)}${text(c.area, 'abs nowrap', `left:300px;top:${cardTop + 62}px;width:480px;height:34px;font-size:24px;color:${muted};overflow:hidden`)}` : ''}
${doodle('dots', { left: 860, top: cardTop + 40, width: 40 }, ink)}
<div class="abs" style="left:150px;top:${imgTop}px;width:780px;height:${imgH}px;overflow:hidden">
<img class="photo" alt="" src="${cssUrl(c.dish.photoUrl)}" style="left:0;top:0;width:100%;height:100%;${c.dish.cutUrl ? 'filter:blur(8px) brightness(.9);transform:scale(1.15)' : ''}">
</div>
${c.dish.cutUrl ? s.plate(c.dish, { left: 90, top: imgTop + 30, width: 900, height: imgH + 40 }, { kind: 'float', anchor: 'center', shadow: 'drop-shadow(0 30px 40px rgb(0 0 0 / .45))' }) : ''}
${doodle('heart', { left: 184, top: imgTop + imgH + 34, width: 52 }, '')}
${doodle('comment', { left: 260, top: imgTop + imgH + 36, width: 48 }, ink)}
${doodle('send', { left: 334, top: imgTop + imgH + 36, width: 48 }, ink)}
${doodle('bookmark', { left: 848, top: imgTop + imgH + 36, width: 48 }, ink)}
${line(c.words.tagline, { left: 90, top: cardTop + 118 + imgH + 150, width: 900, height: 120 }, WHITE, { size: 40, wrap: true, align: 'center' })}
${contactLine(c) ? line(contactLine(c), { left: 90, top: 1264, width: 900, height: 40 }, WHITE, { size: 26, weight: 600, align: 'center', extra: 'opacity:.85' }) : ''}
${s.deco([{ left: 30, top: 300, width: 110, height: 700 }, { left: 940, top: 300, width: 110, height: 700 }])}
${s.sticker(c, 700, cardTop - 40, 8)}`,
    { backdrop: false, bg: css(mix(k.bg2, INK, 0.5)) },
  );
};

/** A menu drop: up to three dishes on a diagonal band, each with its price and the menu's own words. */
const menu: Draw = (c, s) => {
  const { k } = s;
  const items = [c.dish, ...c.more].slice(0, 3);
  const label = (
    d: DishArt,
    box: { left: number; top: number; width: number },
    note: boolean,
    align = 'left',
  ) =>
    `<div class="abs" style="left:${box.left}px;top:${box.top}px;width:${box.width}px;text-align:${align};color:${css(k.ink)}">
${d.price ? text(d.price, 'nowrap', `font-family:${stack('archivo')};font-size:60px;line-height:72px;height:74px;width:100%;overflow:hidden`) : ''}
${text(d.name, 'nowrap', `font-weight:800;font-size:34px;line-height:44px;height:46px;width:100%;overflow:hidden`)}
${note && d.note ? text(d.note, '', `font-size:24px;font-weight:500;line-height:32px;height:66px;width:100%;overflow:hidden;opacity:.8`) : ''}
</div>`;
  const [a, b, d3] = items as [DishArt, DishArt | undefined, DishArt | undefined];
  return s.page(
    `${s.head(c.words.headline, { left: 56, top: 56, width: 620, height: 300 }, 165, {})}
${logo(c, 110, 'right:56px;top:56px', k)}
<div class="abs" style="left:-360px;top:790px;width:1800px;height:280px;background:${css(k.band)};transform:rotate(-29.9deg)"></div>
<div class="abs" style="left:-360px;top:612px;width:1800px;height:12px;background:${css(k.accent)};transform:rotate(-29.9deg)"></div>
${s.plate(a, { left: 290, top: 370, width: 540, height: 500 })}
${label(a, { left: 56, top: 400, width: 250 }, true)}
${b ? s.plate(b, { left: 760, top: 330, width: 290, height: 300 }) + label(b, { left: 680, top: 190, width: 344 }, false, 'right') : ''}
${d3 ? s.plate(d3, { left: 30, top: 880, width: 400, height: 330 }, { anchor: 'center' }) + label(d3, { left: 480, top: 1140, width: 550 }, false) : ''}
${line([c.restaurant, contactLine(c)].filter(Boolean).join('  •  '), { left: 400, top: 1280, width: 640, height: 40 }, k.ink, { size: 24, align: 'right' })}`,
  );
};

/** A phone showing the restaurant's profile; the dish bursts out through torn paper. */
const breakout: Draw = (c, s) => {
  const { k } = s;
  const ink = css(INK);
  const muted = 'rgb(100 100 110)';
  // The profile grid shows the restaurant's own dish photos (repeated when the menu has few).
  const pool = c.more.length ? [...c.more, c.dish] : [c.dish];
  const tiles = Array.from({ length: 6 }, (_, i) => pool[i % pool.length]!)
    .map(
      (d, i) =>
        `<img class="photo" alt="" src="${cssUrl(d.photoUrl)}" style="left:${(i % 3) * 297}px;top:${720 + Math.floor(i / 3) * 252}px;width:294px;height:249px">`,
    )
    .join('');
  // Screen coordinates are inside the phone; the hole and the dish are drawn on the poster above it.
  const hole = { x: 760, y: 420 };
  const outer = tornEdge(hole.x, hole.y, 245, 255, s.rnd);
  const inner = tornEdge(hole.x, hole.y, 196, 208, s.rnd);
  return s.page(
    `<div class="abs" style="left:80px;top:50px;width:920px;height:1250px;border-radius:72px;background:${css(WHITE)};border:16px solid rgb(18 18 22);box-shadow:0 50px 100px rgb(0 0 0 / .5);overflow:hidden">
${line(c.restaurant, { left: 44, top: 34, width: 560, height: 50 }, INK, { size: 34 })}
<div class="abs" style="left:40px;top:110px;width:176px;height:176px;border-radius:50%;background:linear-gradient(45deg,${css(k.accent)},${css(k.band)});padding:9px"><div style="width:100%;height:100%;border-radius:50%;background:${css(WHITE)};position:relative;overflow:hidden">${logo(c, 142, 'left:8px;top:8px;width:142px;border-radius:50%', k)}</div></div>
${line(c.restaurant, { left: 40, top: 306, width: 400, height: 46 }, INK, { size: 34, weight: 800 })}
${line(c.words.tagline, { left: 40, top: 356, width: 340, height: 144 }, INK, { size: 27, weight: 400, wrap: true })}
${c.area ? text(c.area, 'abs nowrap', `left:40px;top:510px;width:340px;height:36px;font-size:24px;color:${muted};overflow:hidden`) : ''}
<div class="abs" style="left:40px;top:580px;width:190px;height:70px;border-radius:16px;background:${css(k.band)};color:${css(k.onBand)};display:grid;place-items:center;font-weight:700;font-size:26px">${escapeHtml(c.labels.follow)}</div>
<div class="abs" style="left:244px;top:580px;width:190px;height:70px;border-radius:16px;background:rgb(236 236 240);color:${ink};display:grid;place-items:center;font-weight:700;font-size:26px">${escapeHtml(c.labels.message)}</div>
${tiles}
</div>
<svg class="abs" style="left:0;top:0;filter:drop-shadow(0 18px 24px rgb(0 0 0 / .35))" width="1080" height="1350"><polygon points="${outer}" fill="${css([250, 249, 245])}"/><polygon points="${inner}" fill="rgb(16 16 20)"/></svg>
${doodle('steam', { left: hole.x - 70, top: hole.y - 250, width: 140, height: 160 }, css(WHITE), 'opacity:.9')}
${s.plate(c.dish, { left: hole.x - 330, top: hole.y - 190, width: 640, height: 520 }, { kind: 'float', anchor: 'center', shadow: 'drop-shadow(0 40px 40px rgb(0 0 0 / .5))' })}
${s.head(c.words.headline, { left: 60, top: 1170, width: 600, height: 110 }, 70, { nowrap: true, valign: 'center', color: k.onAccent, effect: 'plain', extra: `padding:0 32px;border-radius:24px;background:${css(k.accent)};transform:rotate(-4deg);box-shadow:0 18px 40px rgb(0 0 0 / .35)` })}`,
    { backdrop: false, bg: `linear-gradient(160deg,${css(k.bg)},${css(mix(k.bg, INK, 0.7))})` },
  );
};

/** Quiet and premium: a serif headline in the middle of a calm page, dishes at the corners. */
const minimal: Draw = (c, s) => {
  const { k } = s;
  const second = c.more[0];
  return s.page(
    `${second ? s.plate(second, { left: -150, top: -120, width: 560, height: 520 }, { anchor: 'center', rotate: 8 }) : ''}
${s.plate(c.dish, { left: 420, top: 760, width: 820, height: 720 }, { anchor: 'center', rotate: -6 })}
${kicker(c.words.kicker, { left: 90, top: 430, width: 620, height: 40 }, k.head, 'left', 26)}
${s.head(c.words.headline, { left: 84, top: 480, width: 700, height: 270 }, 132, {})}
<div class="abs" style="left:92px;top:770px;width:120px;height:4px;background:${css(k.head)}"></div>
${line(c.words.tagline, { left: 90, top: 800, width: 440, height: 130 }, k.muted, { size: 30, weight: 500, wrap: true })}
${c.dish.price ? line(c.dish.price, { left: 90, top: 950, width: 300, height: 80 }, k.head, { size: 64, weight: 800, extra: `font-family:${s.font.stack}` }) : ''}
${s.deco([{ left: 700, top: 120, width: 320, height: 380 }])}
${signature(c, { left: 90, bottom: 60, width: 480 }, css(k.ink), { logoSize: 66 })}`,
  );
};

export const LAYOUT_DRAW: Record<Layout, Draw> = {
  spotlight,
  stack: stacked,
  corner,
  halo,
  cover,
  side,
  bubble,
  ticket,
  burst,
  polaroid,
  vintage,
  chalkboard,
  collage,
  status,
  mood,
  giant,
  band,
  split,
  frame,
  menu,
  breakout,
  minimal,
};

export { POSTER_SIZE };
