import { DESIGNS } from './poster-designs';
import {
  css,
  cssUrl,
  dish,
  escapeHtml,
  hasBangla,
  inkOn,
  INK,
  page,
  palette,
  type PostContent,
  REEL_SIZE,
  stack,
  WHITE,
  contactLine,
} from './poster-kit';

export {
  type DishArt,
  escapeHtml,
  inkOn,
  MOOD_WORDS,
  type MoodWord,
  type PosterLabels,
  type PosterLang,
  type PosterWords,
  type PostContent,
  POSTER_SIZE,
  REEL_SECONDS,
  REEL_SIZE,
} from './poster-kit';

/**
 * The autopilot's posters (1080×1350, 4:5) and reels (1080×1920, 9:16), drawn by a real Chromium so Bangla
 * joins correctly (ADR 0040). The poster designs live in poster-designs.ts (ADR 0057); this file picks one
 * and draws the reel. Pure: the owner's live preview runs the same code in the browser.
 */
export function posterHtml(c: PostContent): string {
  return DESIGNS[c.design](c);
}

/** Headline size that keeps long (or Bangla) headlines inside the reel. */
export function headlineSize(text: string, base: number): number {
  const len = [...text].length;
  if (len <= 10) return base;
  if (len <= 16) return Math.round(base * 0.8);
  if (len <= 24) return Math.round(base * 0.64);
  return Math.round(base * 0.5);
}

/** The reel's first-second hook wraps over up to three lines, so it can stay big. */
export function hookSize(text: string): number {
  const len = [...text].length;
  return len <= 12 ? 130 : len <= 22 ? 112 : len <= 34 ? 96 : 80;
}

/**
 * A 9:16 reel, 8 seconds. Scene 1 (0–3 s): the hook, huge, over the dish blurred and dark. Scene 2
 * (3–6 s): the dish slides in with the headline and tagline. Scene 3 (6–8 s): the call to action with logo
 * and contact. Every animation is paused and stepped frame by frame by the renderer
 * (document.getAnimations()), so the video is identical however slow the machine is.
 */
export function reelHtml(c: PostContent): string {
  const p = palette(c);
  const ink = inkOn(c.colorMain);
  const accent = css(p.accent);
  const w = c.words;
  const bn = (s: string) => (hasBangla(s) ? ' bn' : '');
  const animations = `
@keyframes kb{from{transform:scale(1.05)}to{transform:scale(1.25)}}
@keyframes fadeOut{to{opacity:0}}
@keyframes pop{0%{opacity:0;transform:scale(1.7)}60%{opacity:1;transform:scale(.94)}100%{opacity:1;transform:scale(1)}}
@keyframes hookOut{to{opacity:0;transform:translateY(-120px) scale(.9)}}
@keyframes plateIn{0%{opacity:0;transform:translateY(500px) scale(.6) rotate(-20deg)}70%{opacity:1;transform:translateY(-20px) scale(1.04) rotate(2deg)}100%{opacity:1;transform:none}}
@keyframes spin{from{rotate:0deg}to{rotate:8deg}}
@keyframes float{0%,100%{translate:0 0}50%{translate:0 -18px}}
@keyframes slideL{from{opacity:0;transform:translateX(-700px)}to{opacity:1;transform:none}}
@keyframes up{from{opacity:0;transform:translateY(80px)}to{opacity:1;transform:none}}
@keyframes bandIn{from{transform:translateX(-1900px) rotate(-18deg)}to{transform:translateX(0) rotate(-18deg)}}
@keyframes cardUp{from{transform:translateY(700px)}to{transform:none}}
@keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.07)}}
.a{animation-fill-mode:both;animation-timing-function:cubic-bezier(.2,.8,.2,1)}
.display{font-family:${stack('anton')};text-transform:uppercase;line-height:.95;letter-spacing:.5px}
`;
  // A clean cut-out floats on the band; a photo spins in as a round plate.
  const plate = c.dish.cutUrl
    ? `<div class="a" style="position:absolute;left:60px;top:560px;width:960px;height:900px;animation:plateIn .9s 3.05s both">
  <div class="a" style="position:absolute;inset:0;animation:float 2.4s ease-in-out 3.9s 2 both">${dish(c.dish, { left: 0, top: 0, width: 960, height: 900 }, { anchor: 'center', shadow: 'drop-shadow(0 40px 46px rgb(0 0 0 / .45))' })}</div>
</div>`
    : `<div class="a" style="position:absolute;left:150px;top:640px;width:780px;height:780px;animation:plateIn .9s 3.05s both">
  <div class="a" style="position:absolute;inset:0;border-radius:50%;background-image:url('${cssUrl(c.dish.photoUrl)}');background-size:cover;background-position:center;box-shadow:0 40px 80px rgb(0 0 0 / .35),0 0 0 14px rgb(255 255 255 / .9);animation:spin 5s linear 3s both"></div>
</div>`;
  return page(
    REEL_SIZE,
    ['anton', 'poppins'],
    css(p.main),
    ink,
    animations,
    `<div class="a" style="position:absolute;inset:-60px;background-image:url('${cssUrl(c.dish.photoUrl)}');background-size:cover;background-position:center;filter:blur(6px) brightness(.45);animation:kb 8s linear 0s both,fadeOut .5s ease 2.9s both"></div>
<div class="display a${bn(w.hook)}" style="position:absolute;left:60px;right:60px;top:560px;text-align:center;font-size:${hookSize(w.hook)}px;line-height:1.35;animation:pop .6s 0s both,hookOut .4s ease-in 2.8s both"><span style="background:${accent};color:${p.onAccent};padding:4px 22px;border-radius:18px;box-decoration-break:clone;-webkit-box-decoration-break:clone">${escapeHtml(w.hook)}</span></div>
<div class="a" style="position:absolute;left:-400px;top:960px;width:1900px;height:380px;background:${accent};animation:bandIn .6s 3s both"></div>
${plate}
<div class="display a${bn(w.headline)}" style="position:absolute;left:60px;right:60px;top:170px;font-size:${headlineSize(w.headline, 150)}px;color:${ink};animation:slideL .5s 3.4s both">${escapeHtml(w.headline)}</div>
<div class="a${bn(w.tagline)}" style="position:absolute;left:66px;right:60px;top:420px;font-size:44px;font-weight:700;color:${ink};animation:up .5s 3.8s both">${escapeHtml(w.tagline)}</div>
${c.badge ? `<div class="a${bn(c.badge)}" style="position:absolute;right:90px;top:560px;padding:12px 30px;border-radius:999px;font-weight:700;font-size:34px;background:${css(WHITE)};color:${css(INK)};box-shadow:0 10px 30px rgb(0 0 0 / .2);animation:up .4s 4.3s both">${escapeHtml(c.badge)}</div>` : ''}
<div class="a" style="position:absolute;left:0;right:0;bottom:0;height:470px;background:${css(WHITE)};border-radius:60px 60px 0 0;color:${css(INK)};padding:60px 70px;animation:cardUp .6s 6s both">
  <div style="display:flex;align-items:center;gap:26px">
    ${c.logoUrl ? `<img class="logo" alt="" style="height:110px;max-width:300px" src="${cssUrl(c.logoUrl)}">` : ''}
    <div><div class="${bn(c.restaurant)}" style="font-weight:800;font-size:46px">${escapeHtml(c.restaurant)}</div>
    <div class="${bn(contactLine(c))}" style="font-size:34px;opacity:.85">${escapeHtml(contactLine(c))}</div></div>
  </div>
  <div style="margin-top:46px"><span class="pill a${bn(c.cta)}" style="font-size:44px;padding:24px 56px;background:${accent};color:${p.onAccent};animation:pulse 1s ease-in-out 6.6s 2 both">${escapeHtml(c.cta)}</span></div>
</div>`,
  );
}
