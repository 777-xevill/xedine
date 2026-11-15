/**
 * The poster designs (ADR 0057). Each one is a layout a restaurant's designer would make by hand — the
 * founder's reference set: a checklist joke, dishes standing in for letters, a giant sideways word, a launch
 * band, a playful split, an Instagram frame, a menu drop, a phone the dish bursts out of, a centred
 * spotlight and a quiet premium page. All are 1080×1350 (4:5). Words are escaped by text(); pictures pass
 * through cssUrl(); colours are the restaurant's own (Palette).
 */
import {
  css,
  type DishArt,
  dish,
  doodle,
  escapeHtml,
  hasBangla,
  INK,
  logo,
  mix,
  page,
  palette,
  PAPER,
  POSTER_SIZE,
  type PostContent,
  readable,
  seeded,
  signature,
  stack,
  text,
  tornEdge,
  WHITE,
  contactLine,
  cssUrl,
} from './poster-kit';
import type { PosterDesign } from './schedule';

type Design = (c: PostContent) => string;

const up = (s: string) => (hasBangla(s) ? s : s.toUpperCase());

/** The badge (best seller, perfect for lunch…) as a tilted sticker, as wide as its words. */
function sticker(c: PostContent, left: number, top: number, bg: string, ink: string, rotate = -8) {
  if (!c.badge) return '';
  const width = Math.min(440, 64 + [...c.badge].length * 17);
  return text(
    c.badge,
    'abs nowrap',
    `left:${left}px;top:${top}px;width:${width}px;height:62px;padding:0 24px;border-radius:999px;background:${bg};color:${ink};font-weight:800;font-size:28px;text-align:center;line-height:62px;box-shadow:0 12px 26px rgb(0 0 0 / .22);transform:rotate(${rotate}deg);overflow:hidden`,
  );
}

function priceTag(d: DishArt, left: number, top: number, bg: string, ink: string, size = 150) {
  if (!d.price) return '';
  return `<div class="abs" style="left:${left}px;top:${top}px;width:${size}px;height:${size}px;border-radius:50%;background:${bg};color:${ink};display:grid;place-items:center;transform:rotate(-10deg);box-shadow:0 14px 30px rgb(0 0 0 / .25)">
${text(d.price, 'nowrap', `font-family:${stack('archivo')};font-weight:800;font-size:${Math.round(size * 0.27)}px;width:${size - 22}px;height:${Math.round(size * 0.42)}px;text-align:center;overflow:hidden`)}
</div>`;
}

// ---------------------------------------------------------------------------------------------

/** "What's your status? ○ Single ○ Taken ✓ Hungry" with a hand-drawn arrow to the dish. */
const status: Design = (c) => {
  const p = palette(c);
  const head = css(readable(p.main, PAPER, 4.5));
  const w = c.words;
  const row = (label: string, top: number, checked: boolean) =>
    `${doodle(checked ? 'checkCircle' : 'circle', { left: 84, top: top + 6, width: checked ? 92 : 82, height: 82 }, head)}
${text(label, 'abs nowrap', `left:200px;top:${top}px;width:560px;height:100px;font-size:78px;font-weight:600;color:${css(INK)};line-height:96px;overflow:hidden`)}`;
  return page(
    POSTER_SIZE,
    ['archivo', 'poppins'],
    css(PAPER),
    css(INK),
    '',
    `${text(up(w.statusQ), 'abs nowrap', `left:80px;top:96px;width:930px;height:130px;font-family:${stack('archivo')};font-size:92px;color:${head};line-height:120px;overflow:hidden`)}
${row(w.statusA, 270, false)}
${row(w.statusB, 390, false)}
${row(w.statusC, 510, true)}
${doodle('loopArrow', { left: 112, top: 640, width: 250, height: 300 }, head, 'transform:rotate(-8deg)')}
${dish(c.dish, { left: 260, top: 540, width: 820, height: 700 }, { fallback: 'circle' })}
${sticker(c, 720, 300, css(p.accent), p.onAccent)}
${signature(c, p, { left: 80, bottom: 56, width: 520 }, css(INK))}`,
  );
};

/** "What's your M(dish)(dish)D today?": the O's of the word are plates. */
const mood: Design = (c) => {
  const p = palette(c);
  const head = css(readable(p.main, PAPER, 5));
  const w = c.words;
  const second = c.more[0] ?? c.dish;
  const plate = (d: DishArt) =>
    d.cutUrl
      ? `<span style="display:inline-block;width:.82em;height:.82em;margin:0 .02em;vertical-align:-.06em;border-radius:50%;background:${css(WHITE)};box-shadow:0 .05em .12em rgb(0 0 0 / .22);position:relative"><img alt="" src="${cssUrl(d.cutUrl)}" style="position:absolute;inset:6%;width:88%;height:88%;object-fit:contain"></span>`
      : `<img alt="" src="${cssUrl(d.photoUrl)}" style="display:inline-block;width:.82em;height:.82em;margin:0 .02em;vertical-align:-.06em;border-radius:50%;object-fit:cover;box-shadow:0 .05em .12em rgb(0 0 0 / .22)">`;
  let o = 0;
  const letters = [...w.moodWord]
    .map((ch) => (ch === 'O' ? plate(o++ % 2 === 0 ? c.dish : second) : escapeHtml(ch)))
    .join('');
  return page(
    POSTER_SIZE,
    ['archivo', 'poppins'],
    css(PAPER),
    head,
    '',
    `${dish(c.dish, { left: 620, top: -170, width: 600, height: 560 }, { fallback: 'circle', anchor: 'center', rotate: -12 })}
${dish(second, { left: -190, top: 960, width: 600, height: 520 }, { fallback: 'circle', anchor: 'center', rotate: 10 })}
${text(w.moodTop, 'abs nowrap', `left:120px;top:420px;width:840px;height:100px;font-size:74px;font-weight:800;line-height:96px;overflow:hidden`)}
<div class="abs nowrap" data-fit style="left:90px;top:515px;width:900px;height:300px;font-family:${stack('archivo')};font-size:290px;line-height:290px;text-align:center;overflow:hidden">${letters}</div>
${text(w.moodBottom, 'abs nowrap', `left:120px;top:812px;width:840px;height:100px;font-size:74px;font-weight:800;text-align:right;line-height:96px;overflow:hidden`)}
${signature(c, p, { left: 560, bottom: 60, width: 460 }, css(INK), { align: 'right', logoSize: 70 })}`,
  );
};

/** A giant sideways word on a brand strip, the dish standing in front, "the best is here at …". */
const giant: Design = (c) => {
  const p = palette(c);
  const light = css(mix(p.accent, WHITE, 0.55));
  const strong = css(readable(p.main, mix(p.accent, WHITE, 0.55), 4));
  const word = up(c.dish.name);
  const rnd = seeded(c.dish.name);
  // Sparkles stay around the dish, never on the words above it.
  const sparkles = [0, 1, 2, 3]
    .map((i) =>
      doodle(
        'sparkle',
        {
          left: (i % 2 ? 860 : 400) + Math.round(rnd() * 140),
          top: (i < 2 ? 520 : 980) + Math.round(rnd() * 120),
          width: 34 + Math.round(rnd() * 40),
        },
        i % 2 ? css(WHITE) : css(p.main),
        'opacity:.9',
      ),
    )
    .join('');
  return page(
    POSTER_SIZE,
    ['anton', 'poppins'],
    light,
    css(INK),
    '',
    `<div class="abs" style="left:0;top:0;width:410px;height:1350px;background:${css(p.main)};border-radius:0 260px 0 0"></div>
<div class="abs nowrap" data-fit style="left:40px;top:1310px;width:1260px;height:350px;transform-origin:0 0;transform:rotate(-90deg);font-family:${stack('anton')};font-size:330px;line-height:350px;color:${css(PAPER)};overflow:hidden${hasBangla(word) ? ';line-height:1.2' : ''}">${escapeHtml(word)}</div>
${text(up(c.words.kicker), 'abs up', `left:440px;top:70px;width:600px;height:250px;font-family:${stack('anton')};font-size:118px;line-height:118px;color:${strong};text-align:right;overflow:hidden`)}
${text(up(c.restaurant), 'abs nowrap', `left:440px;top:330px;width:600px;height:84px;font-family:${stack('anton')};font-size:70px;line-height:84px;color:${css(INK)};text-align:right;overflow:hidden`)}
${c.dish.price ? text(`${c.dish.name}  ${c.dish.price}`, 'abs nowrap', `left:440px;top:420px;width:600px;height:50px;font-size:34px;font-weight:600;color:${css(INK)};text-align:right;overflow:hidden`) : ''}
${sparkles}
${dish(c.dish, { left: 300, top: 490, width: 760, height: 750 }, { fallback: 'card', anchor: 'center' })}
${sticker(c, 470, 500, css(p.main), p.onMain, -8)}
${signature(c, p, { left: 440, bottom: 40, width: 600 }, css(INK), { align: 'right', logoSize: 64 })}`,
  );
};

/** Slanted launch headline, the dish riding a thick diagonal band with the call to action along it. */
const band: Design = (c) => {
  const p = palette(c);
  const deep = css(readable(p.main, WHITE, 5));
  const second = c.more[0];
  return page(
    POSTER_SIZE,
    ['bebas', 'poppins'],
    css(WHITE),
    deep,
    '',
    `${text(up(c.words.headline), 'abs up', `left:50px;top:70px;width:980px;height:290px;font-family:${stack('bebas')};font-size:230px;line-height:200px;transform:rotate(-5deg) skewX(-6deg);overflow:hidden`)}
${text(c.words.tagline, 'abs', `left:70px;top:330px;width:900px;height:120px;font-size:44px;font-weight:700;line-height:58px;transform:rotate(-5deg);overflow:hidden`)}
<div class="abs" style="left:-320px;top:760px;width:1900px;height:330px;background:${deep};transform:rotate(-22deg)">
${text(up(c.cta), 'abs nowrap up', `right:620px;bottom:30px;width:640px;height:70px;font-size:46px;font-weight:800;letter-spacing:2px;line-height:70px;color:${css(WHITE)};text-align:right;overflow:hidden`)}
</div>
${dish(c.dish, { left: 430, top: 430, width: 620, height: 450 }, { fallback: 'circle' })}
${second ? dish(second, { left: 60, top: 760, width: 440, height: 330 }, { fallback: 'circle' }) : ''}
${sticker(c, 690, 380, css(p.accent), p.onAccent, -14)}
${logo(c, 84, 'right:60px;bottom:150px', p)}
${text(c.restaurant, 'abs nowrap', `right:60px;bottom:96px;width:520px;height:46px;font-weight:800;font-size:34px;text-align:right;overflow:hidden`)}
${contactLine(c) ? text(contactLine(c), 'abs nowrap', `right:60px;bottom:52px;width:520px;height:36px;font-size:24px;font-weight:600;text-align:right;overflow:hidden`) : ''}`,
  );
};

/** Bold colour with a white road through it, flying leaves, a playful headline and the phone number. */
const split: Design = (c) => {
  const p = palette(c);
  const names = [c.dish, ...c.more]
    .slice(0, 4)
    .map((d) => up(d.name))
    .join('  |  ');
  const cta = css(readable(p.main, WHITE, 3.5));
  return page(
    POSTER_SIZE,
    ['shrikhand', 'poppins'],
    css(p.main),
    p.onMain,
    '',
    `<svg class="abs" style="left:0;top:0" width="1080" height="1350"><polygon points="150,0 340,0 760,1350 0,1350 0,560" fill="${css(WHITE)}"/></svg>
${doodle('leaf', { left: 40, top: 40, width: 120, height: 60 }, '', 'transform:rotate(-30deg)')}
${doodle('leafDark', { left: 170, top: 150, width: 90, height: 45 }, '', 'transform:rotate(40deg)')}
${doodle('leaf', { left: 380, top: 70, width: 70, height: 35 }, '', 'transform:rotate(-70deg)')}
${logo(c, 92, 'left:600px;top:60px', p, true)}
${text(up(c.restaurant), 'abs nowrap', `left:710px;top:66px;width:330px;height:84px;font-family:${stack('shrikhand')};font-size:44px;line-height:42px;color:${p.onMain};overflow:hidden;white-space:normal`)}
${text(names, 'abs nowrap', `left:520px;top:220px;width:520px;height:40px;font-size:24px;font-weight:700;letter-spacing:1px;color:${p.onMain};text-align:right;overflow:hidden`)}
${text(c.words.headline, 'abs', `left:480px;top:280px;width:560px;height:330px;display:flex;align-items:flex-end;justify-content:flex-end;font-family:${stack('shrikhand')};font-size:150px;line-height:150px;color:${p.onMain};text-align:right;text-shadow:0 8px 0 rgb(0 0 0 / .14);overflow:hidden`)}
${text(c.words.tagline, 'abs', `left:560px;top:640px;width:480px;height:170px;font-size:30px;font-weight:500;line-height:42px;color:${p.onMain};text-align:right;overflow:hidden`)}
<div class="abs" style="right:40px;top:850px"><span class="pill" style="background:${css(INK)};color:${css(WHITE)}">${escapeHtml(c.labels.orderNow)}</span></div>
${c.phone ? text(c.phone, 'abs nowrap', `left:560px;top:960px;width:480px;height:76px;font-size:58px;font-weight:800;color:${p.onMain};text-align:right;overflow:hidden`) : ''}
${c.area ? text(c.area, 'abs nowrap', `left:560px;top:1040px;width:480px;height:44px;font-size:28px;font-weight:600;color:${p.onMain};text-align:right;opacity:.9;overflow:hidden`) : ''}
${doodle('steam', { left: 230, top: 250, width: 110, height: 130 }, css(mix(p.main, WHITE, 0.4)), 'opacity:.8')}
${dish(c.dish, { left: -20, top: 360, width: 580, height: 540 }, { fallback: 'circle', anchor: 'center' })}
${text(up(c.cta), 'abs', `left:40px;top:960px;width:560px;height:330px;font-family:${stack('shrikhand')};font-size:120px;line-height:118px;color:${cta};transform:rotate(-8deg);overflow:hidden`)}
${sticker(c, 360, 300, css(p.accent), p.onAccent, -10)}`,
  );
};

/** An Instagram-style post card over the dish's own photo, the plate breaking out of the frame. */
const frame: Design = (c) => {
  const p = palette(c);
  const ink = css(INK);
  const muted = 'rgb(110 110 120)';
  const cardTop = 250;
  const imgTop = cardTop + 118;
  const imgH = 620;
  return page(
    POSTER_SIZE,
    ['anton', 'poppins'],
    css(mix(p.deep, INK, 0.5)),
    css(WHITE),
    '',
    `<img class="photo" alt="" src="${cssUrl(c.dish.photoUrl)}" style="left:-80px;top:-80px;width:1240px;height:1510px;filter:blur(30px) brightness(.5) saturate(1.25)">
<div class="abs" style="inset:0;background:radial-gradient(circle at 50% 45%,transparent 30%,rgb(0 0 0 / .45) 100%)"></div>
${text(up(c.words.headline), 'abs nowrap up', `left:60px;top:70px;width:960px;height:140px;font-family:${stack('anton')};font-size:124px;line-height:140px;text-align:center;color:${css(WHITE)};text-shadow:0 8px 30px rgb(0 0 0 / .35);overflow:hidden`)}
<div class="abs" style="left:150px;top:${cardTop}px;width:780px;height:${118 + imgH + 120}px;background:${css(WHITE)};border-radius:34px;box-shadow:0 40px 90px rgb(0 0 0 / .45)"></div>
${logo(c, 72, `left:184px;top:${cardTop + 23}px;border-radius:50%`, p)}
${text(c.restaurant, 'abs nowrap', `left:274px;top:${cardTop + 22}px;width:520px;height:44px;font-weight:700;font-size:32px;color:${ink};overflow:hidden`)}
${c.area ? `${doodle('pin', { left: 274, top: cardTop + 68, width: 22 }, muted)}${text(c.area, 'abs nowrap', `left:300px;top:${cardTop + 62}px;width:480px;height:34px;font-size:24px;color:${muted};overflow:hidden`)}` : ''}
${doodle('dots', { left: 860, top: cardTop + 40, width: 40 }, ink)}
<div class="abs" style="left:150px;top:${imgTop}px;width:780px;height:${imgH}px;overflow:hidden">
<img class="photo" alt="" src="${cssUrl(c.dish.photoUrl)}" style="left:0;top:0;width:100%;height:100%;${c.dish.cutUrl ? 'filter:blur(8px) brightness(.9);transform:scale(1.15)' : ''}">
</div>
${c.dish.cutUrl ? dish(c.dish, { left: 90, top: imgTop + 30, width: 900, height: imgH + 40 }, { anchor: 'center', shadow: 'drop-shadow(0 30px 40px rgb(0 0 0 / .45))' }) : ''}
${doodle('heart', { left: 184, top: imgTop + imgH + 34, width: 52 }, '')}
${doodle('comment', { left: 260, top: imgTop + imgH + 36, width: 48 }, ink)}
${doodle('send', { left: 334, top: imgTop + imgH + 36, width: 48 }, ink)}
${doodle('bookmark', { left: 848, top: imgTop + imgH + 36, width: 48 }, ink)}
${text(c.words.tagline, 'abs', `left:90px;top:${cardTop + 118 + imgH + 150}px;width:900px;height:120px;font-size:40px;font-weight:700;line-height:54px;text-align:center;color:${css(WHITE)};overflow:hidden`)}
${contactLine(c) ? text(contactLine(c), 'abs nowrap', `left:90px;bottom:46px;width:900px;height:40px;font-size:26px;font-weight:600;text-align:center;color:${css(WHITE)};opacity:.85;overflow:hidden`) : ''}
${sticker(c, 700, cardTop - 40, css(p.accent), p.onAccent, 8)}`,
  );
};

/** A menu drop: up to three dishes on a diagonal band, each with its price and the menu's own words. */
const menu: Design = (c) => {
  const p = palette(c);
  const ink = css(INK);
  const items = [c.dish, ...c.more].slice(0, 3);
  const hex = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="56" height="97" viewBox="0 0 56 97"><path d="M28 0l28 16v32L28 64 0 48V16zM28 64v33" fill="none" stroke="rgb(0,0,0)" stroke-opacity=".06" stroke-width="2"/></svg>')}")`;
  // Every label sits on the paper, never on the band, so it always reads.
  const label = (
    d: DishArt,
    box: { left: number; top: number; width: number },
    note: boolean,
    align = 'left',
  ) =>
    `<div class="abs" style="left:${box.left}px;top:${box.top}px;width:${box.width}px;text-align:${align}">
${d.price ? text(d.price, 'nowrap', `font-family:${stack('archivo')};font-size:60px;line-height:72px;height:74px;width:100%;overflow:hidden`) : ''}
${text(d.name, 'nowrap', `font-weight:800;font-size:34px;line-height:44px;height:46px;width:100%;overflow:hidden`)}
${note && d.note ? text(d.note, '', `font-size:24px;font-weight:500;line-height:32px;height:66px;width:100%;overflow:hidden;opacity:.8`) : ''}
</div>`;
  const [a, b, d3] = items as [DishArt, DishArt | undefined, DishArt | undefined];
  // The band runs from the bottom-left corner up to the right edge: centre line (0,1240) → (1080,620).
  return page(
    POSTER_SIZE,
    ['bebas', 'archivo', 'poppins'],
    css(PAPER),
    ink,
    `body{background-image:${hex}}`,
    `${text(up(c.words.headline), 'abs up', `left:56px;top:56px;width:620px;height:300px;font-family:${stack('bebas')};font-size:180px;line-height:150px;overflow:hidden`)}
${logo(c, 110, 'right:56px;top:56px', p)}
<div class="abs" style="left:-360px;top:790px;width:1800px;height:280px;background:${ink};transform:rotate(-29.9deg)"></div>
<div class="abs" style="left:-360px;top:612px;width:1800px;height:12px;background:${css(p.main)};transform:rotate(-29.9deg)"></div>
${dish(a, { left: 290, top: 370, width: 540, height: 500 }, { fallback: 'circle' })}
${label(a, { left: 56, top: 400, width: 250 }, true)}
${b ? dish(b, { left: 760, top: 330, width: 290, height: 300 }, { fallback: 'circle' }) + label(b, { left: 680, top: 190, width: 344 }, false, 'right') : ''}
${d3 ? dish(d3, { left: 30, top: 880, width: 400, height: 330 }, { fallback: 'circle', anchor: 'center' }) + label(d3, { left: 480, top: 1140, width: 550 }, false) : ''}
${text([c.restaurant, contactLine(c)].filter(Boolean).join('  •  '), 'abs nowrap', `right:40px;bottom:30px;width:640px;height:40px;font-size:24px;font-weight:700;text-align:right;color:${ink};overflow:hidden`)}`,
  );
};

/** A phone showing the restaurant's profile; the dish bursts out through torn paper. */
const breakout: Design = (c) => {
  const p = palette(c);
  const ink = css(INK);
  const muted = 'rgb(100 100 110)';
  const rnd = seeded(c.restaurant + c.dish.name);
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
  const outer = tornEdge(hole.x, hole.y, 245, 255, rnd);
  const inner = tornEdge(hole.x, hole.y, 196, 208, rnd);
  return page(
    POSTER_SIZE,
    ['archivo', 'poppins'],
    `linear-gradient(160deg,${css(p.deep)},${css(mix(p.deep, INK, 0.7))})`,
    ink,
    '',
    `<div class="abs" style="left:80px;top:50px;width:920px;height:1250px;border-radius:72px;background:${css(WHITE)};border:16px solid rgb(18 18 22);box-shadow:0 50px 100px rgb(0 0 0 / .5);overflow:hidden">
${text(c.restaurant, 'abs nowrap', `left:44px;top:34px;width:560px;height:50px;font-weight:700;font-size:34px;color:${ink};overflow:hidden`)}
<div class="abs" style="left:40px;top:110px;width:176px;height:176px;border-radius:50%;background:linear-gradient(45deg,${css(p.accent)},${css(p.main)});padding:9px"><div style="width:100%;height:100%;border-radius:50%;background:${css(WHITE)};position:relative;overflow:hidden">${logo(c, 142, 'left:8px;top:8px;width:142px;border-radius:50%', p)}</div></div>
${text(c.restaurant, 'abs nowrap', `left:40px;top:306px;width:400px;height:46px;font-weight:800;font-size:34px;color:${ink};overflow:hidden`)}
${text(c.words.tagline, 'abs', `left:40px;top:356px;width:340px;height:144px;font-size:27px;line-height:36px;color:${ink};overflow:hidden`)}
${c.area ? text(c.area, 'abs nowrap', `left:40px;top:510px;width:340px;height:36px;font-size:24px;color:${muted};overflow:hidden`) : ''}
<div class="abs" style="left:40px;top:580px;width:190px;height:70px;border-radius:16px;background:${css(p.main)};color:${p.onMain};display:grid;place-items:center;font-weight:700;font-size:26px">${escapeHtml(c.labels.follow)}</div>
<div class="abs" style="left:244px;top:580px;width:190px;height:70px;border-radius:16px;background:rgb(236 236 240);color:${ink};display:grid;place-items:center;font-weight:700;font-size:26px">${escapeHtml(c.labels.message)}</div>
${tiles}
</div>
<svg class="abs" style="left:0;top:0;filter:drop-shadow(0 18px 24px rgb(0 0 0 / .35))" width="1080" height="1350"><polygon points="${outer}" fill="${css(PAPER)}"/><polygon points="${inner}" fill="rgb(16 16 20)"/></svg>
${doodle('steam', { left: hole.x - 70, top: hole.y - 250, width: 140, height: 160 }, css(WHITE), 'opacity:.9')}
${dish(c.dish, { left: hole.x - 330, top: hole.y - 190, width: 640, height: 520 }, { fallback: 'circle', anchor: 'center', shadow: 'drop-shadow(0 40px 40px rgb(0 0 0 / .5))' })}
${text(c.words.headline, 'abs nowrap', `left:60px;top:1170px;width:600px;height:110px;padding:0 32px;border-radius:24px;background:${css(p.accent)};color:${p.onAccent};font-family:${stack('archivo')};font-size:56px;line-height:110px;transform:rotate(-4deg);box-shadow:0 18px 40px rgb(0 0 0 / .35);overflow:hidden`)}`,
  );
};

/** The dish in the middle of the brand colour, the headline above, the call to action on a tilted band. */
const centre: Design = (c) => {
  const p = palette(c);
  const rnd = seeded(c.dish.name);
  const sparkles = [0, 1, 2, 3, 4]
    .map(() =>
      doodle(
        'sparkle',
        {
          left: 80 + Math.round(rnd() * 900),
          top: 330 + Math.round(rnd() * 560),
          width: 30 + Math.round(rnd() * 44),
        },
        css(p.accent),
        'opacity:.95',
      ),
    )
    .join('');
  return page(
    POSTER_SIZE,
    ['anton', 'poppins'],
    css(p.main),
    p.onMain,
    '',
    `<div class="abs" style="inset:0;background:radial-gradient(circle at 50% 58%,rgb(255 255 255 / .28),transparent 58%)"></div>
${text(up(c.words.headline), 'abs up', `left:50px;top:66px;width:980px;height:250px;font-family:${stack('anton')};font-size:160px;line-height:124px;text-align:center;text-shadow:0 8px 0 rgb(0 0 0 / .15);overflow:hidden`)}
<div class="abs" style="left:110px;top:330px;width:860px;text-align:center">${text(c.words.tagline, '', `display:inline-block;max-width:860px;height:62px;padding:10px 30px;border-radius:999px;background:${css(WHITE)};color:${css(INK)};font-size:30px;font-weight:700;white-space:nowrap;overflow:hidden`)}</div>
${sparkles}
<div class="abs" style="left:-200px;top:1040px;width:1600px;height:160px;background:${css(p.accent)};transform:rotate(-6deg)"></div>
${text(up(c.cta), 'abs nowrap up', `left:90px;top:1062px;width:900px;height:96px;font-family:${stack('anton')};font-size:70px;line-height:96px;text-align:center;color:${p.onAccent};transform:rotate(-6deg);overflow:hidden`)}
${dish(c.dish, { left: 120, top: 420, width: 840, height: 680 }, { fallback: 'circle', anchor: 'bottom' })}
${priceTag(c.dish, 830, 430, css(WHITE), css(INK), 170)}
${sticker(c, 90, 460, css(WHITE), css(INK), -10)}
${signature(c, p, { left: 60, bottom: 40, width: 960 }, p.onMain, { align: 'center', logoSize: 70 })}`,
  );
};

/** Quiet and premium: a serif headline in the middle of a cream page, dishes at the corners. */
const minimal: Design = (c) => {
  const p = palette(c);
  const accent = css(readable(p.main, PAPER, 4.5));
  const second = c.more[0];
  return page(
    POSTER_SIZE,
    ['playfair', 'poppins'],
    css(PAPER),
    css(INK),
    '',
    `${second ? dish(second, { left: -150, top: -120, width: 560, height: 520 }, { fallback: 'circle', anchor: 'center', rotate: 8 }) : ''}
${dish(c.dish, { left: 380, top: 690, width: 860, height: 760 }, { fallback: 'circle', anchor: 'center', rotate: -6 })}
${text(up(c.words.kicker), 'abs nowrap up', `left:90px;top:430px;width:620px;height:40px;font-size:26px;font-weight:700;letter-spacing:8px;color:${accent};overflow:hidden`)}
${text(c.words.headline, 'abs', `left:84px;top:480px;width:700px;height:270px;font-family:${stack('playfair')};font-style:italic;font-weight:800;font-size:118px;line-height:124px;overflow:hidden`)}
<div class="abs" style="left:92px;top:770px;width:120px;height:4px;background:${accent}"></div>
${text(c.words.tagline, 'abs', `left:90px;top:800px;width:560px;height:130px;font-size:30px;line-height:42px;font-weight:500;color:rgb(70 70 80);overflow:hidden`)}
${c.dish.price ? text(c.dish.price, 'abs nowrap', `left:90px;top:950px;width:300px;height:80px;font-family:${stack('playfair')};font-weight:800;font-size:64px;color:${accent};overflow:hidden`) : ''}
${signature(c, p, { left: 90, bottom: 60, width: 480 }, css(INK), { logoSize: 66 })}`,
  );
};

export const DESIGNS: Record<PosterDesign, Design> = {
  status,
  mood,
  giant,
  band,
  split,
  frame,
  menu,
  breakout,
  centre,
  minimal,
};
