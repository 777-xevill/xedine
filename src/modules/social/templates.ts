import type { PosterDesign } from './schedule';

/**
 * HTML for the autopilot's posters (1080×1350, Instagram/Facebook 4:5) and reels (1080×1920, 9:16),
 * rendered by a real Chromium so Bangla joins correctly (ADR 0040). The look follows the founder's
 * references in Brand_assets/demo-gen: one dish on a bold flat colour, a diagonal band, a huge headline,
 * a short tagline, logo and contact. Colours come from the restaurant's settings (data), so this file
 * holds no colour literals of its own beyond neutral rgb() ink.
 */
export interface PostContent {
  design: PosterDesign;
  hook: string;
  headline: string;
  tagline: string;
  cta: string;
  badge: string | null;
  restaurant: string;
  area: string | null;
  phone: string | null;
  colorMain: string;
  colorAccent: string;
  /** data: URLs, so the renderer never waits on the network for pictures. */
  imageUrl: string;
  logoUrl: string | null;
}

export const POSTER_SIZE = { width: 1080, height: 1350 } as const;
export const REEL_SIZE = { width: 1080, height: 1920 } as const;
export const REEL_SECONDS = 8;

const FONTS =
  'https://fonts.googleapis.com/css2?family=Anton&family=Hind+Siliguri:wght@500;700&family=Poppins:wght@500;700;800&display=block';

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Dark ink on a light colour, white on a dark one (WCAG relative luminance). */
export function inkOn(hex: string): string {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return l > 0.45 ? 'rgb(22 22 30)' : 'rgb(255 255 255)';
}

/** Headline size that keeps long (or Bangla) headlines inside the poster. */
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

function contactLine(c: PostContent): string {
  return [c.area, c.phone]
    .filter(Boolean)
    .map((x) => escapeHtml(x!))
    .join('  •  ');
}

function head(c: PostContent, size: { width: number; height: number }, css: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${FONTS}" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${size.width}px;height:${size.height}px;overflow:hidden}
body{position:relative;background:${c.colorMain};color:${inkOn(c.colorMain)};font-family:'Poppins','Hind Siliguri',sans-serif}
.display{font-family:'Anton','Hind Siliguri',sans-serif;text-transform:uppercase;line-height:.95;letter-spacing:.5px}
.bn{font-family:'Hind Siliguri','Poppins',sans-serif}
.dish{position:absolute;border-radius:50%;background-size:cover;background-position:center;
  box-shadow:0 40px 80px rgb(0 0 0 / .35),0 0 0 14px rgb(255 255 255 / .9)}
.logo{height:84px;max-width:260px;object-fit:contain}
.pill{display:inline-block;padding:18px 40px;border-radius:999px;font-weight:800;font-size:34px;letter-spacing:1px}
.badge{position:absolute;padding:12px 26px;border-radius:999px;font-weight:700;font-size:28px;
  background:rgb(255 255 255);color:rgb(22 22 30);box-shadow:0 10px 30px rgb(0 0 0 / .2)}
${css}
</style></head><body>`;
}

function footer(c: PostContent, ink: string): string {
  return `<div style="position:absolute;left:60px;right:60px;bottom:48px;display:flex;align-items:center;justify-content:space-between;gap:24px;color:${ink}">
  <div style="display:flex;align-items:center;gap:20px;min-width:0">
    ${c.logoUrl ? `<img class="logo" src="${c.logoUrl}">` : ''}
    <div style="min-width:0"><div style="font-weight:800;font-size:34px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(c.restaurant)}</div>
    <div class="bn" style="font-size:26px;opacity:.9">${contactLine(c)}</div></div>
  </div>
</div>`;
}

/** A 4:5 poster in one of four designs. */
export function posterHtml(c: PostContent): string {
  const ink = inkOn(c.colorMain);
  const accentInk = inkOn(c.colorAccent);
  const h = escapeHtml(c.headline);
  const t = escapeHtml(c.tagline);
  const badge = c.badge ? escapeHtml(c.badge) : null;
  const img = `background-image:url('${c.imageUrl}')`;

  if (c.design === 'band') {
    return `${head(c, POSTER_SIZE, '')}
<div style="position:absolute;left:-300px;top:560px;width:1800px;height:330px;background:${c.colorAccent};transform:rotate(-24deg)"></div>
<div style="position:absolute;left:-300px;top:1010px;width:1800px;height:120px;background:${c.colorAccent};opacity:.55;transform:rotate(-24deg)"></div>
<div class="display" style="position:absolute;left:64px;top:110px;width:640px;font-size:${headlineSize(c.headline, 132)}px;transform:rotate(-8deg);color:${ink};text-shadow:6px 6px 0 ${c.colorAccent}">${h}</div>
<div class="bn" style="position:absolute;left:70px;top:430px;width:560px;font-size:34px;font-weight:700;transform:rotate(-8deg)">${t}</div>
<div class="dish" style="${img};width:700px;height:700px;right:-40px;top:380px"></div>
${badge ? `<div class="badge" style="right:80px;top:330px">${badge}</div>` : ''}
<div style="position:absolute;left:60px;bottom:170px"><span class="pill" style="background:${c.colorAccent};color:${accentInk}">${escapeHtml(c.cta)}</span></div>
${footer(c, ink)}</body></html>`;
  }

  if (c.design === 'centre') {
    return `${head(c, POSTER_SIZE, '')}
<div style="position:absolute;inset:0;background:radial-gradient(circle at 50% 55%,rgb(255 255 255 / .22),transparent 60%)"></div>
<div class="display" style="position:absolute;left:0;right:0;top:80px;text-align:center;font-size:${headlineSize(c.headline, 150)}px;padding:0 50px">${h}</div>
<div class="bn" style="position:absolute;left:120px;right:120px;top:300px;text-align:center"><span style="display:inline-block;background:rgb(255 255 255);color:rgb(22 22 30);padding:16px 34px;border-radius:28px;font-size:32px;font-weight:700">${t}</span></div>
<div style="position:absolute;left:-200px;top:985px;width:1600px;height:150px;background:${c.colorAccent};transform:rotate(-6deg)"></div>
<div class="dish" style="${img};width:600px;height:600px;left:240px;top:400px"></div>
${badge ? `<div class="badge" style="left:120px;top:450px">${badge}</div>` : ''}
<div class="display" style="position:absolute;left:0;right:0;top:1018px;text-align:center;font-size:62px;color:${accentInk};transform:rotate(-6deg)">${escapeHtml(c.cta)}</div>
${footer(c, ink)}</body></html>`;
  }

  if (c.design === 'frame') {
    return `${head(c, POSTER_SIZE, '')}
<div style="position:absolute;inset:0;background:linear-gradient(180deg,rgb(255 255 255 / .12),rgb(0 0 0 / .28))"></div>
<div class="bn" style="position:absolute;left:0;right:0;top:70px;text-align:center;font-size:30px;letter-spacing:10px;font-weight:700;opacity:.9">${escapeHtml(c.restaurant)}</div>
<div class="display" style="position:absolute;left:0;right:0;top:120px;text-align:center;font-size:${headlineSize(c.headline, 140)}px;padding:0 60px;text-shadow:0 8px 24px rgb(0 0 0 / .25)">${h}</div>
<div class="bn" style="position:absolute;left:0;right:0;top:330px;text-align:center;font-size:36px;font-weight:700;color:${c.colorAccent}">${t}</div>
<div style="position:absolute;left:150px;right:150px;top:420px;height:620px;border-radius:36px;background:rgb(0 0 0 / .22);box-shadow:inset 0 30px 60px rgb(0 0 0 / .45)"></div>
<div class="dish" style="${img};width:560px;height:560px;left:260px;top:450px"></div>
${badge ? `<div class="badge" style="right:120px;top:400px">${badge}</div>` : ''}
<div style="position:absolute;left:0;right:0;top:1085px;text-align:center"><span class="pill" style="background:${c.colorAccent};color:${accentInk}">${escapeHtml(c.cta)}</span></div>
${footer(c, ink)}</body></html>`;
  }

  // split: a light page with the headline in the brand colour and a dark band carrying the dish.
  return `${head(c, POSTER_SIZE, 'body{background:rgb(250 250 247)}')}
<div class="display" style="position:absolute;left:60px;right:60px;top:90px;font-size:${headlineSize(c.headline, 160)}px;color:${c.colorMain};transform:rotate(-4deg)">${h}</div>
<div class="bn" style="position:absolute;left:66px;right:60px;top:330px;font-size:36px;font-weight:700;color:rgb(40 40 48);transform:rotate(-4deg)">${t}</div>
<div style="position:absolute;left:-250px;top:640px;width:1700px;height:300px;background:${c.colorMain};transform:rotate(-22deg)"></div>
<div class="dish" style="${img};width:600px;height:600px;left:380px;top:430px"></div>
${badge ? `<div class="badge" style="left:120px;top:520px;background:${c.colorAccent};color:${accentInk}">${badge}</div>` : ''}
<div style="position:absolute;left:60px;top:1060px"><span class="pill" style="background:${c.colorAccent};color:${accentInk}">${escapeHtml(c.cta)}</span></div>
${footer(c, 'rgb(30 30 38)')}</body></html>`;
}

/**
 * A 9:16 reel, 8 seconds. Scene 1 (0–3 s): the hook, huge, over the dish blurred and dark. Scene 2
 * (3–6 s): the dish on a plate slides in with the headline and tagline. Scene 3 (6–8 s): the call to
 * action with logo and contact. Every animation is paused and stepped frame by frame by the renderer
 * (document.getAnimations()), so the video is identical however slow the machine is.
 */
export function reelHtml(c: PostContent): string {
  const ink = inkOn(c.colorMain);
  const accentInk = inkOn(c.colorAccent);
  const css = `
@keyframes kb{from{transform:scale(1.05)}to{transform:scale(1.25)}}
@keyframes fadeOut{to{opacity:0}}
@keyframes pop{0%{opacity:0;transform:scale(1.7)}60%{opacity:1;transform:scale(.94)}100%{opacity:1;transform:scale(1)}}
@keyframes hookOut{to{opacity:0;transform:translateY(-120px) scale(.9)}}
@keyframes plateIn{0%{opacity:0;transform:translateY(500px) scale(.6) rotate(-20deg)}70%{opacity:1;transform:translateY(-20px) scale(1.04) rotate(2deg)}100%{opacity:1;transform:none}}
@keyframes spin{from{rotate:0deg}to{rotate:8deg}}
@keyframes slideL{from{opacity:0;transform:translateX(-700px)}to{opacity:1;transform:none}}
@keyframes up{from{opacity:0;transform:translateY(80px)}to{opacity:1;transform:none}}
@keyframes bandIn{from{transform:translateX(-1900px) rotate(-18deg)}to{transform:translateX(0) rotate(-18deg)}}
@keyframes cardUp{from{transform:translateY(700px)}to{transform:none}}
@keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.07)}}
.a{animation-fill-mode:both;animation-timing-function:cubic-bezier(.2,.8,.2,1)}
`;
  return `${head(c, REEL_SIZE, css)}
<div class="a" style="position:absolute;inset:-60px;background-image:url('${c.imageUrl}');background-size:cover;background-position:center;filter:blur(6px) brightness(.45);animation:kb 8s linear 0s both,fadeOut .5s ease 2.9s both"></div>
<div class="display a" style="position:absolute;left:60px;right:60px;top:560px;text-align:center;font-size:${hookSize(c.hook)}px;line-height:1.35;animation:pop .6s 0s both,hookOut .4s ease-in 2.8s both"><span style="background:${c.colorAccent};color:${accentInk};padding:4px 22px;border-radius:18px;box-decoration-break:clone;-webkit-box-decoration-break:clone">${escapeHtml(c.hook)}</span></div>
<div class="a" style="position:absolute;left:-400px;top:900px;width:1900px;height:380px;background:${c.colorAccent};animation:bandIn .6s 3s both"></div>
<div class="a" style="position:absolute;left:150px;top:640px;width:780px;height:780px;animation:plateIn .9s 3.05s both">
  <div class="dish a" style="position:absolute;inset:0;background-image:url('${c.imageUrl}');animation:spin 5s linear 3s both"></div>
</div>
<div class="display a" style="position:absolute;left:60px;right:60px;top:170px;font-size:${headlineSize(c.headline, 150)}px;color:${ink};animation:slideL .5s 3.4s both">${escapeHtml(c.headline)}</div>
<div class="bn a" style="position:absolute;left:66px;right:60px;top:420px;font-size:44px;font-weight:700;color:${ink};animation:up .5s 3.8s both">${escapeHtml(c.tagline)}</div>
${c.badge ? `<div class="badge a" style="right:90px;top:600px;font-size:34px;animation:up .4s 4.3s both">${escapeHtml(c.badge)}</div>` : ''}
<div class="a" style="position:absolute;left:0;right:0;bottom:0;height:470px;background:rgb(255 255 255);border-radius:60px 60px 0 0;color:rgb(22 22 30);padding:60px 70px;animation:cardUp .6s 6s both">
  <div style="display:flex;align-items:center;gap:26px">
    ${c.logoUrl ? `<img class="logo" style="height:110px" src="${c.logoUrl}">` : ''}
    <div><div style="font-weight:800;font-size:46px">${escapeHtml(c.restaurant)}</div>
    <div class="bn" style="font-size:34px;opacity:.85">${contactLine(c)}</div></div>
  </div>
  <div style="margin-top:46px"><span class="pill a" style="font-size:44px;padding:24px 56px;background:${c.colorAccent};color:${accentInk};animation:pulse 1s ease-in-out 6.6s 2 both">${escapeHtml(c.cta)}</span></div>
</div>
</body></html>`;
}
