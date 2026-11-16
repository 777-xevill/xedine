import {
  backdrop,
  type Colors,
  contrast,
  css,
  cssUrl,
  type DishArt,
  doodle,
  type DoodleName,
  escapeHtml,
  FONTS,
  hasBangla,
  INK,
  mix,
  page,
  plate,
  REEL_SIZE,
  type Rgb,
  schemeColors,
  seeded,
  stack,
  WHITE,
} from './poster-kit';
import type { Enter, HookMotion, VideoLook } from './video-look';
import type { OccasionTheme } from './video-words';

/**
 * The autopilot's short videos (ADR 0061): 9:16, 10–12 seconds, a hook, one to three dish scenes and the
 * restaurant's logo, in the style of the motion-graphics food ads the founder chose. Everything moves with
 * CSS animations at fixed times; the renderer pauses them and steps them frame by frame, so a video is the
 * same however slow the machine is. Pure string building (no server imports), like the posters.
 *
 * Time line: hook [0, h) → the kind's scenes [h, o) → the logo [o, T). `h` grows when a voice reads the
 * hook; T is 11 s unless given.
 */
export interface VideoDish extends DishArt {
  /** The old menu price of a real offer the owner made ("৳৪৫০"), shown struck through. */
  was: string | null;
}

/** The words the writer fills for a video; one call fills every kind's lines. */
export interface VideoWords {
  /** The first-second line ("Still thinking about lunch?"). */
  hook: string;
  /** The answer that follows a question hook ("It's two!"). */
  punch: string;
  /** A question to the viewer ("Grilled or fried?", "Your favourite?"). */
  question: string;
  /** A short line under the dish ("Slow-cooked, fresh every day"). */
  tagline: string;
  cta: string;
}

/** Fixed words from the app's translations. */
export interface VideoLabels {
  or: string;
  onlyAt: string;
  now: string;
}

export interface VideoContent {
  look: VideoLook;
  words: VideoWords;
  labels: VideoLabels;
  restaurant: string;
  area: string | null;
  phone: string | null;
  colorMain: string;
  colorAccent: string;
  logoUrl: string | null;
  /** One to three dishes, in the order the video shows them. */
  dishes: VideoDish[];
  /** Whole length (10–12 s); 11 by default. */
  seconds?: number;
  /** How long the hook stays (a spoken hook needs its own length); 2.2 s by default. */
  hookSeconds?: number;
  /** A special day: its greeting (fixed text, or the owner's own words) opens the video in its theme. */
  occasion?: {
    greeting: string;
    theme: OccasionTheme;
    /** The day's own colours (a national day: the country's flag; Diwali: gold), else the theme's. */
    palette?: readonly (readonly [number, number, number])[];
    /** Hanging lanterns without the moon (Lunar New Year: red, Diwali: gold). */
    lanterns?: 'red' | 'gold';
  } | null;
  /** In the Growth preview the page fits its words and plays (and loops) by itself. */
  preview?: boolean;
}

/** A sound the mix lays under the picture: a whoosh at a cut, a pop or a stamp, sizzle under steam. */
export interface VideoHit {
  t: number;
  sound: 'whoosh' | 'pop' | 'stamp' | 'sizzle';
}

export interface VideoPlan {
  html: string;
  seconds: number;
  hits: VideoHit[];
}

export const VIDEO_SIZE = REEL_SIZE;
export const VIDEO_FPS = 30;
const W = VIDEO_SIZE.width;
const H = VIDEO_SIZE.height;
const OUTRO = 2.3;

export function videoSeconds(c: Pick<VideoContent, 'seconds'>): number {
  return Math.min(12, Math.max(10, c.seconds ?? 11));
}

// ---------------------------------------------------------------------------------------------
// Builder state
// ---------------------------------------------------------------------------------------------

interface B {
  c: VideoContent;
  look: VideoLook;
  k: Colors;
  rnd: () => number;
  font: { stack: string; weight: number; lineHeight: number; scale: number; upper: boolean };
  T: number;
  /** Keyframes made for this one video (carousels, rings, the swinging diagonal). */
  keyframes: string[];
  n: number;
  hits: VideoHit[];
}

const r = (x: number) => Math.round(x * 1000) / 1000;
const EASE = 'cubic-bezier(.2,.8,.2,1)';
const BOUNCE = 'cubic-bezier(.3,1.5,.5,1)';

/** One CSS animation: name, length, start (seconds from the start of the video). */
function an(
  name: string,
  dur: number,
  at: number,
  o: { ease?: string; iter?: number | 'infinite'; fill?: string; dir?: string } = {},
): string {
  return `${name} ${r(dur)}s ${o.ease ?? EASE} ${r(at)}s ${o.iter ?? 1} ${o.dir ?? 'normal'} ${o.fill ?? 'both'}`;
}

/** Keyframes for this video, from (time in seconds, CSS) pairs over the whole video. */
function timeline(b: B, frames: [number, string][]): string {
  const name = `k${b.n++}`;
  const steps = frames
    .map(
      ([t, style]) =>
        `${Math.min(100, Math.max(0, (t / b.T) * 100)).toFixed(3)}%{${style};animation-timing-function:cubic-bezier(.65,0,.35,1)}`,
    )
    .join('');
  b.keyframes.push(`@keyframes ${name}{${steps}}`);
  return `${name} ${b.T}s linear 0s 1 normal both`;
}

const STATIC_KEYFRAMES = `
@keyframes on{from{visibility:hidden}to{visibility:visible}}
@keyframes off{from{visibility:visible}to{visibility:hidden}}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@keyframes up{from{opacity:0;transform:translateY(70px)}to{opacity:1;transform:none}}
@keyframes wPop{0%{opacity:0;transform:scale(0) rotate(-8deg)}60%{opacity:1;transform:scale(1.18) rotate(2deg)}100%{opacity:1;transform:none}}
@keyframes wRise{from{transform:translateY(120%)}to{transform:none}}
@keyframes wFromL{0%{opacity:0;transform:translateX(-1000px) skewX(24deg)}70%{opacity:1;transform:translateX(30px) skewX(-6deg)}100%{opacity:1;transform:none}}
@keyframes wFromR{0%{opacity:0;transform:translateX(1000px) skewX(-24deg)}70%{opacity:1;transform:translateX(-30px) skewX(6deg)}100%{opacity:1;transform:none}}
@keyframes slam{0%{opacity:0;transform:scale(3.4)}55%{opacity:1;transform:scale(.92)}75%{transform:scale(1.04)}100%{opacity:1;transform:none}}
@keyframes shake{0%,100%{transform:none}20%{transform:translate(-16px,6px) rotate(-1.5deg)}40%{transform:translate(14px,-8px) rotate(1.2deg)}60%{transform:translate(-8px,4px)}80%{transform:translate(6px,-3px)}}
@keyframes blink{0%,49%{opacity:1}50%,100%{opacity:0}}
@keyframes eRise{0%{opacity:0;transform:translateY(760px) scale(.7)}70%{opacity:1;transform:translateY(-26px) scale(1.03)}100%{opacity:1;transform:none}}
@keyframes eSpin{0%{opacity:0;transform:rotate(-280deg) scale(.12);filter:blur(18px)}70%{opacity:1;transform:rotate(14deg) scale(1.05);filter:blur(0)}100%{opacity:1;transform:none;filter:none}}
@keyframes eSpinR{0%{opacity:0;transform:rotate(280deg) scale(.12);filter:blur(18px)}70%{opacity:1;transform:rotate(-14deg) scale(1.05);filter:blur(0)}100%{opacity:1;transform:none;filter:none}}
@keyframes eDrop{0%{opacity:0;transform:translateY(-1600px)}55%{opacity:1;transform:translateY(34px) scaleY(.94)}72%{transform:translateY(-44px)}86%{transform:translateY(10px)}100%{opacity:1;transform:none}}
@keyframes eZoom{0%{opacity:0;transform:scale(2.6);filter:blur(26px)}100%{opacity:1;transform:none;filter:none}}
@keyframes eSwing{0%{opacity:0;transform:translateX(-1400px) rotate(-40deg)}70%{opacity:1;transform:translateX(30px) rotate(4deg)}100%{opacity:1;transform:none}}
@keyframes eSwingR{0%{opacity:0;transform:translateX(1400px) rotate(40deg)}70%{opacity:1;transform:translateX(-30px) rotate(-4deg)}100%{opacity:1;transform:none}}
@keyframes floatY{0%,100%{transform:translateY(0)}50%{transform:translateY(-24px)}}
@keyframes sway{0%,100%{transform:rotate(-3deg)}50%{transform:rotate(3deg)}}
@keyframes kb{from{transform:scale(1)}to{transform:scale(1.16)}}
@keyframes turn{from{transform:rotate(0)}to{transform:rotate(30deg)}}
@keyframes steamUp{0%{opacity:0;transform:translateY(60px) scaleY(.7)}30%{opacity:.8}100%{opacity:0;transform:translateY(-260px) scaleY(1.25)}}
@keyframes strike{from{transform:rotate(-7deg) scaleX(0)}to{transform:rotate(-7deg) scaleX(1)}}
@keyframes stamp{0%{opacity:0;transform:scale(2.8) rotate(-16deg)}60%{opacity:1;transform:scale(.9) rotate(-7deg)}100%{opacity:1;transform:rotate(-7deg)}}
@keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.08)}}
@keyframes draw{from{stroke-dashoffset:var(--len)}to{stroke-dashoffset:0}}
@keyframes unblur{from{opacity:0;transform:scale(.55);filter:blur(24px)}to{opacity:1;transform:none;filter:none}}
@keyframes burstOut{0%{opacity:0;transform:scale(.3)}35%{opacity:1}100%{opacity:0;transform:scale(1.6)}}
@keyframes twinkle{0%,100%{opacity:.1;transform:scale(.5) rotate(0)}50%{opacity:1;transform:scale(1.1) rotate(45deg)}}
@keyframes drift{from{transform:translate(0,0) rotate(0)}to{transform:translate(var(--dx),var(--dy)) rotate(var(--dr))}}
@keyframes glowPulse{0%,100%{opacity:var(--o1)}50%{opacity:var(--o2)}}
@keyframes slideDown{from{transform:translateY(-110%)}to{transform:none}}
@keyframes slideUp{from{transform:translateY(110%)}to{transform:none}}
@keyframes tIris{from{clip-path:circle(0px at 540px 960px)}to{clip-path:circle(1200px at 540px 960px)}}
@keyframes tPushIn{from{transform:translateY(1920px)}to{transform:none}}
@keyframes tPushOut{from{transform:none}to{transform:translateY(-1920px)}}
@keyframes tWhipIn{from{transform:translateX(760px);filter:blur(30px)}to{transform:none;filter:none}}
@keyframes tWhipOut{from{transform:none;filter:none}to{transform:translateX(-760px);filter:blur(30px)}}
@keyframes tWipe{from{transform:translateX(-2600px) skewX(-14deg)}to{transform:translateX(2600px) skewX(-14deg)}}
@keyframes tTear{from{transform:translateY(-2900px)}to{transform:translateY(2900px)}}
@keyframes tFlash{0%{opacity:0}45%,55%{opacity:1}100%{opacity:0}}
@keyframes fadeOut{from{opacity:1}to{opacity:0}}
@keyframes tZoomIn{from{transform:scale(1.2)}to{transform:none}}
.w{display:inline-block;white-space:nowrap}
.m{display:inline-block;overflow:hidden;vertical-align:bottom;padding:.14em .04em}
.sc{position:absolute;inset:0;overflow:hidden}
.fill{position:absolute;inset:0}
`;

/**
 * Fits every [data-vfit] text box once the animations stand at their end (words in place), so a word
 * flying in from off-screen is not measured as overflow. The renderer calls it before the first frame. It keeps the
 * list of every animation first: one that has finished and fills nothing drops out of getAnimations(), and
 * the renderer must still step it back.
 */
const VFIT_SCRIPT = `<script>
window.__vfit=function(){window.__anims=document.getAnimations();for(const a of window.__anims){a.pause();a.currentTime=60000;}
for(const el of document.querySelectorAll('[data-vfit]')){let s=parseFloat(getComputedStyle(el).fontSize);const min=s*0.3;let n=0;
while((el.scrollWidth>el.clientWidth+1||el.scrollHeight>el.clientHeight+1)&&s>min&&n<90){s*=0.95;n++;el.style.fontSize=s+'px';}}
document.body.dataset.vfit='1';};
</script>`;

// ---------------------------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------------------------

type TextMotion = HookMotion | 'fade' | 'up';

/** The words of a line, each in its own span, arriving the given way from `at`. */
function wordSpans(
  b: B,
  text: string,
  at: number,
  motion: TextMotion,
  o: { highlight?: boolean; stagger?: number } = {},
): string {
  const bangla = hasBangla(text);
  const words = text.trim().split(/\s+/).filter(Boolean);
  const st = o.stagger ?? (motion === 'type' ? 0.05 : 0.11);
  const hl = o.highlight
    ? `background:${css(b.k.accent)};color:${css(b.k.onAccent)};padding:0 .14em;border-radius:.12em;`
    : '';
  if (motion === 'type' && !bangla) {
    // Letter by letter, with a caret that blinks until the line is done.
    let i = 0;
    const html = words
      .map((w) => {
        const letters = [...w]
          .map(
            (ch) =>
              `<span style="animation:${an('on', 0.001, at + i++ * st, { ease: 'linear' })}">${escapeHtml(ch)}</span>`,
          )
          .join('');
        i++;
        return `<span class="w" style="${hl}">${letters}</span>`;
      })
      .join(' ');
    const done = at + i * st;
    return `${html}<span class="w" style="width:.08em;height:.9em;margin-left:.06em;background:currentColor;vertical-align:-.08em;animation:${an('on', 0.001, at, { ease: 'linear' })},${an('blink', 0.5, at, { ease: 'linear', iter: Math.max(1, Math.round((done - at) / 0.5) + 2), fill: 'forwards' })}"></span>`;
  }
  return words
    .map((w, i) => {
      const t = at + i * (motion === 'type' ? 0.18 : st);
      const word = escapeHtml(w);
      switch (motion) {
        case 'pop':
          return `<span class="w" style="${hl}animation:${an('wPop', 0.45, t, { ease: BOUNCE })}">${word}</span>`;
        case 'rise':
          return `<span class="m"><span class="w" style="${hl}animation:${an('wRise', 0.5, t)}">${word}</span></span>`;
        case 'split':
          return `<span class="w" style="${hl}animation:${an(i % 2 ? 'wFromR' : 'wFromL', 0.55, t)}">${word}</span>`;
        case 'up':
          return `<span class="w" style="${hl}animation:${an('up', 0.45, t)}">${word}</span>`;
        default:
          // slam, fade and Bangla typing: the words appear (the block moves for slam).
          return `<span class="w" style="${hl}animation:${an('fadeIn', 0.25, motion === 'slam' ? at : t)}">${word}</span>`;
      }
    })
    .join(' ');
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Big words in the look's typeface, fitted to their box. */
function bigText(
  b: B,
  text: string,
  box: Box,
  size: number,
  at: number,
  motion: TextMotion,
  o: {
    color?: Rgb;
    align?: 'left' | 'center' | 'right';
    valign?: 'top' | 'center' | 'bottom';
    shadow?: boolean;
    highlight?: boolean;
    font?: 'display' | 'body';
    weight?: number;
    z?: number;
  } = {},
): string {
  if (!text.trim()) return '';
  const display = o.font !== 'body';
  const upper = display && b.font.upper && !hasBangla(text);
  const shown = upper ? text.toUpperCase() : text;
  const fam = display ? b.font.stack : stack('poppins');
  const weight = o.weight ?? (display ? b.font.weight : 700);
  const lh = hasBangla(text) ? 1.3 : display ? Math.max(1, b.font.lineHeight) : 1.2;
  const px = Math.round(size * (display ? b.font.scale : 1));
  const justify = { top: 'flex-start', center: 'center', bottom: 'flex-end' }[o.valign ?? 'center'];
  const shadow = o.shadow
    ? 'text-shadow:0 6px 24px rgb(0 0 0 / .45),0 2px 6px rgb(0 0 0 / .35);'
    : '';
  const inner = wordSpans(b, shown, at, motion, { highlight: o.highlight });
  const block = `<div class="abs" data-vfit style="left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px;display:flex;flex-direction:column;justify-content:${justify};font-family:${fam};font-weight:${weight};font-size:${px}px;line-height:${lh};color:${css(o.color ?? b.k.head)};text-align:${o.align ?? 'center'};${shadow}${o.z ? `z-index:${o.z};` : ''}"><div>${inner}</div></div>`;
  if (motion !== 'slam') return block;
  b.hits.push({ t: at + 0.22, sound: 'stamp' });
  // Slam: the whole line hits from big, then the screen shakes.
  return `<div class="fill" style="animation:${an('shake', 0.4, at + 0.42, { ease: 'linear' })}"><div class="fill" style="transform-origin:${box.left + box.width / 2}px ${box.top + box.height / 2}px;animation:${an('slam', 0.45, at, { ease: 'cubic-bezier(.5,0,.5,1)' })}">${block}</div></div>`;
}

/** A rounded label (a dish name, "Now") that pops in. */
function pill(
  b: B,
  text: string,
  cx: number,
  top: number,
  at: number,
  o: { bg?: Rgb; ink?: Rgb; size?: number; maxWidth?: number } = {},
): string {
  b.hits.push({ t: at, sound: 'pop' });
  if (!text.trim()) return '';
  const size = o.size ?? 40;
  const width = o.maxWidth ?? 760;
  return `<div class="abs" style="left:${cx - width / 2}px;top:${top}px;width:${width}px;display:flex;justify-content:center;animation:${an('wPop', 0.45, at, { ease: BOUNCE })}">
<span class="${hasBangla(text) ? 'bn' : ''}" style="display:inline-block;max-width:${width}px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:${Math.round(size * 0.35)}px ${Math.round(size * 0.9)}px;border-radius:999px;background:${css(o.bg ?? b.k.accent)};color:${css(o.ink ?? b.k.onAccent)};font-weight:800;font-size:${size}px;box-shadow:0 14px 30px rgb(0 0 0 / .25)">${escapeHtml(text)}</span></div>`;
}

// ---------------------------------------------------------------------------------------------
// Dishes
// ---------------------------------------------------------------------------------------------

const ENTER_ANIM: Record<Enter, [string, number, string]> = {
  rise: ['eRise', 0.75, EASE],
  spin: ['eSpin', 0.8, EASE],
  drop: ['eDrop', 0.9, 'cubic-bezier(.4,0,.6,1)'],
  zoom: ['eZoom', 0.6, EASE],
  swing: ['eSwing', 0.75, EASE],
};
const MIRROR: Partial<Record<string, string>> = { eSpin: 'eSpinR', eSwing: 'eSwingR' };

/** A dish in a box: its cut-out standing free, or its photo in a round plate; enters, then breathes. */
function dish(
  b: B,
  d: DishArt,
  box: Box,
  at: number,
  o: {
    enter?: Enter;
    mirror?: boolean;
    idle?: 'float' | 'sway' | 'kb' | 'turn' | 'none';
    z?: number;
  } = {},
): string {
  const [name, dur, ease] = ENTER_ANIM[o.enter ?? b.look.enter];
  b.hits.push({ t: at, sound: 'whoosh' });
  const enter = o.mirror ? (MIRROR[name] ?? name) : name;
  const idle = o.idle ?? (d.cutUrl ? 'float' : 'turn');
  const idleAnim =
    idle === 'float'
      ? an('floatY', 2.6, at + dur, { ease: 'ease-in-out', iter: 'infinite', fill: 'none' })
      : idle === 'sway'
        ? an('sway', 3, at + dur, { ease: 'ease-in-out', iter: 'infinite', fill: 'none' })
        : idle === 'kb'
          ? an('kb', 4, at, { ease: 'linear', fill: 'both' })
          : idle === 'turn'
            ? an('turn', 6, at, { ease: 'linear', fill: 'both' })
            : 'none';
  const inner = plate(
    d,
    { left: 0, top: 0, width: box.width, height: box.height },
    'float',
    b.k,
    b.rnd,
    {
      anchor: 'center',
      shadow: 'drop-shadow(0 40px 40px rgb(0 0 0 / .42)) drop-shadow(0 8px 10px rgb(0 0 0 / .2))',
      ring: css(WHITE, 0.95),
    },
  );
  return `<div class="abs" style="left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px;${o.z ? `z-index:${o.z};` : ''}animation:${an(enter, dur, at, { ease })}"><div class="fill" style="animation:${idleAnim}">${inner}</div></div>`;
}

/** Steam rising from a hot dish. */
function steam(b: B, cx: number, top: number, at: number, width = 300): string {
  b.hits.push({ t: at, sound: 'sizzle' });
  const ink = b.k.dark ? css(WHITE, 0.75) : css(WHITE, 0.85);
  return [0, 0.7, 1.4]
    .map((d, i) => {
      const left = cx - width / 2 + (i - 1) * width * 0.28;
      return `<div class="abs" style="left:${left}px;top:${top - width}px;width:${width}px;height:${width * 1.2}px;color:${ink};filter:blur(5px) drop-shadow(0 0 6px rgb(0 0 0 / .15));animation:${an('steamUp', 2.1, at + d, { ease: 'ease-out', iter: 'infinite', fill: 'backwards' })}">${doodleSvg('steam')}</div>`;
    })
    .join('');
}

function doodleSvg(name: DoodleName): string {
  return doodle(name, { left: 0, top: 0, width: 100, height: 100 }, 'currentColor')
    .replace(/^<div[^>]*>/, '')
    .replace(/<\/div>$/, '');
}

/** A round price tag (or a starburst) that stamps down. */
function priceTag(
  b: B,
  price: string,
  left: number,
  top: number,
  at: number,
  size = 230,
  burst = false,
): string {
  b.hits.push({ t: at + 0.2, sound: 'stamp' });
  const bg = b.k.accent;
  const words = `<div class="abs" style="inset:0;display:grid;place-items:center"><div data-vfit style="width:${Math.round(size * 0.8)}px;height:${Math.round(size * 0.4)}px;display:flex;align-items:center;justify-content:center;white-space:nowrap;font-family:${stack('archivo')};font-size:${Math.round(size * 0.28)}px;color:${css(b.k.onAccent)}">${escapeHtml(price)}</div></div>`;
  const shape = burst
    ? `<div class="fill" style="color:${css(bg)}">${doodleSvg('burst')}</div>`
    : `<div class="fill" style="border-radius:50%;background:${css(bg)};box-shadow:0 16px 34px rgb(0 0 0 / .3)"></div>`;
  return `<div class="abs" style="left:${left}px;top:${top}px;width:${size}px;height:${size}px;z-index:6;filter:drop-shadow(0 12px 18px rgb(0 0 0 / .25));animation:${an('stamp', 0.5, at, { ease: 'cubic-bezier(.5,0,.5,1)' })}">${shape}${words}</div>`;
}

/** Text along an arc around a dish (centre, radius, from/to angle in degrees, clockwise from 3 o'clock). */
function arcText(
  b: B,
  text: string,
  cx: number,
  cy: number,
  radius: number,
  from: number,
  to: number,
  size: number,
  at: number,
  color: Rgb,
): string {
  const id = `arc${b.n++}`;
  const p = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    return `${r(cx + radius * Math.cos(a))} ${r(cy + radius * Math.sin(a))}`;
  };
  const large = Math.abs(to - from) > 180 ? 1 : 0;
  const shown = b.font.upper && !hasBangla(text) ? text.toUpperCase() : text;
  return `<svg class="abs" width="${W}" height="${H}" style="left:0;top:0;overflow:visible;transform-origin:${cx}px ${cy}px;animation:${an('eSpin', 0.7, at)}"><defs><path id="${id}" d="M ${p(from)} A ${radius} ${radius} 0 ${large} 1 ${p(to)}"/></defs>
<text style="font-family:${b.font.stack};font-weight:${b.font.weight};font-size:${Math.round(size * b.font.scale)}px;letter-spacing:2px" fill="${css(color)}"><textPath href="#${id}" startOffset="50%" text-anchor="middle">${escapeHtml(shown)}</textPath></text></svg>`;
}

// ---------------------------------------------------------------------------------------------
// Brand
// ---------------------------------------------------------------------------------------------

/** The logo, or (with none uploaded) the restaurant's name set as a clean badge in its colours. */
function brandMark(b: B, cx: number, cy: number, size: number, onDark: boolean): string {
  const c = b.c;
  if (c.logoUrl)
    return `<img class="abs logo" alt="" src="${cssUrl(c.logoUrl)}" style="left:${cx - size * 1.4}px;top:${cy - size / 2}px;width:${size * 2.8}px;height:${size}px;object-fit:contain;filter:drop-shadow(0 10px 24px rgb(0 0 0 / .25))">`;
  const w = Math.round(size * 2.6);
  const h = Math.round(size * 0.95);
  const bg = onDark ? b.k.card : b.k.band;
  const ink = onDark ? b.k.cardHead : b.k.onBand;
  return `<div class="abs" style="left:${cx - w / 2}px;top:${cy - h / 2}px;width:${w}px;height:${h}px;border-radius:${Math.round(h / 2)}px;background:${css(bg)};box-shadow:0 18px 40px rgb(0 0 0 / .25),inset 0 0 0 ${Math.round(size * 0.05)}px ${css(b.k.accent)};display:grid;place-items:center">
<div data-vfit style="width:${w - size * 0.5}px;height:${h - size * 0.3}px;display:flex;align-items:center;justify-content:center;text-align:center;font-family:${b.font.stack};font-weight:${b.font.weight};font-size:${Math.round(size * 0.46 * b.font.scale)}px;line-height:1.05;color:${css(ink)}" class="${hasBangla(c.restaurant) ? 'bn' : ''}">${escapeHtml(b.font.upper && !hasBangla(c.restaurant) ? c.restaurant.toUpperCase() : c.restaurant)}</div></div>`;
}

// ---------------------------------------------------------------------------------------------
// Stage, ambient and cuts
// ---------------------------------------------------------------------------------------------

/** Where words over the stage should be inked, by height (the stage paints bands at some heights). */
function inkAt(b: B, y: number): { color: Rgb; shadow: boolean } {
  const s = b.look.stage;
  if (s === 'torn' && y < 700) return { color: b.k.onBand, shadow: false };
  if (s === 'table' && y > 1180) return { color: WHITE, shadow: true };
  if ((s === 'band' || s === 'diagonal') && y > 1250) return { color: b.k.onBand, shadow: false };
  return { color: b.k.head, shadow: false };
}

function stageHtml(b: B, h: number, cuts: number[]): string {
  const k = b.k;
  const T = b.T;
  const enter = h; // the stage's own shapes arrive with the first dish
  const deco = (zones: Box[]) =>
    `<div class="fill" style="animation:${an('fadeIn', 0.6, enter)}">${zones
      .map((z, i) => {
        const names: DoodleName[] =
          b.look.deco === 'leaves'
            ? ['leaf', 'leafDark']
            : b.look.deco === 'spice'
              ? ['chilli', 'leaf']
              : b.look.deco === 'hearts'
                ? ['heart', 'sparkle']
                : ['sparkle', 'star'];
        const name = names[i % names.length]!;
        const size = 70 + Math.round(b.rnd() * 60);
        const left = z.left + b.rnd() * Math.max(0, z.width - size);
        const top = z.top + b.rnd() * Math.max(0, z.height - size);
        return doodle(
          name,
          {
            left,
            top,
            width: size,
            height: name === 'chilli' || name.startsWith('leaf') ? size / 2 : size,
          },
          css(k.deco, 0.85),
          `transform:rotate(${Math.round(b.rnd() * 80 - 40)}deg)`,
        );
      })
      .join('')}</div>`;
  const base = (bg: string, html = '') =>
    `<div class="fill" style="background:${bg};animation:${an('kb', T, 0, { ease: 'linear' })}">${html}</div>`;
  switch (b.look.stage) {
    case 'plain': {
      const back = backdrop(b.look.backdrop, k, b.rnd, { x: 540, y: 1000 }, VIDEO_SIZE);
      return (
        base(back.bg, back.html) +
        deco([
          { left: 30, top: 260, width: 300, height: 260 },
          { left: 760, top: 1500, width: 280, height: 260 },
        ])
      );
    }
    case 'spotlight':
      return (
        base(
          `radial-gradient(ellipse 900px 1000px at 540px 1060px,${css(mix(k.bg, WHITE, 0.26))},${css(k.bg)} 70%)`,
        ) +
        `<div class="fill" style="background:radial-gradient(circle at 540px 980px,transparent 40%,rgb(0 0 0 / .45) 100%)"></div>`
      );
    case 'diagonal': {
      // A two-tone split that rises with the first dish and swings to a new angle at every cut.
      const angles = [-24, -12, -32, -18, -28, -10];
      const at = (y: number, a: number) => `transform:translateY(${y}px) rotate(${a}deg)`;
      const frames: [number, string][] = [
        [0, at(1800, angles[0]!)],
        [h, at(1800, angles[0]!)],
        [h + 0.5, at(0, angles[0]!)],
      ];
      cuts.forEach((t, i) => {
        if (t <= h + 0.5) return;
        frames.push([t - 0.01, at(0, angles[i % angles.length]!)]);
        frames.push([t + 0.45, at(0, angles[(i + 1) % angles.length]!)]);
      });
      frames.push([T, frames[frames.length - 1]![1]]);
      return (
        base(css(k.bg)) +
        `<div class="abs" style="left:${540 - 1800}px;top:1000px;width:3600px;height:2600px;background:${css(k.band)};transform-origin:1800px 0;animation:${timeline(b, frames)}"></div>`
      );
    }
    case 'band': {
      const top = 1200;
      const wave = `<svg class="abs" width="${W}" height="${H - top + 120}" style="left:0;top:0"><path d="M0 120 C 260 -10, 520 220, 780 90 S 1080 40, 1080 40 L 1080 ${H} L 0 ${H} Z" fill="${css(k.band)}"/><path d="M0 70 C 240 -40, 560 160, 1080 0" stroke="${css(k.accent)}" stroke-width="16" fill="none"/></svg>`;
      return (
        base(css(k.bg)) +
        `<div class="abs" style="left:0;top:${top - 120}px;width:${W}px;height:${H - top + 120}px;animation:${an('slideUp', 0.6, enter)}">${wave}</div>` +
        deco([
          { left: 40, top: 260, width: 260, height: 220 },
          { left: 780, top: 300, width: 260, height: 220 },
        ])
      );
    }
    case 'table': {
      // A wooden table top in perspective (fixed wood tones: food-illustration colours, not the brand).
      const wood = `repeating-linear-gradient(90deg,rgb(146 100 62) 0 7px,rgb(172 122 80) 7px 88px,rgb(136 92 56) 88px 95px,rgb(181 131 86) 95px 190px)`;
      return (
        base(css(k.bg)) +
        `<div class="abs" style="left:-420px;top:1180px;width:1920px;height:900px;transform:perspective(1100px) rotateX(42deg);transform-origin:50% 0;animation:${an('slideUp', 0.6, enter)}"><div class="fill" style="background:${wood}"></div><div class="fill" style="background:linear-gradient(rgb(0 0 0 / .35),transparent 30%,rgb(0 0 0 / .25))"></div></div>`
      );
    }
    case 'torn': {
      const rnd = seeded(`torn:${b.look.seed}`);
      const pts: string[] = [`0,0`, `${W},0`];
      for (let x = W; x >= 0; x -= 36) pts.push(`${x},${Math.round(640 + (rnd() - 0.5) * 50)}`);
      return (
        base(css(k.bg)) +
        `<svg class="abs" width="${W}" height="720" style="left:0;top:0;filter:drop-shadow(0 10px 14px rgb(0 0 0 / .25));animation:${an('slideDown', 0.6, enter)}"><polygon points="${pts.join(' ')}" fill="${css(k.band)}"/></svg>` +
        deco([{ left: 30, top: 1560, width: 1020, height: 300 }])
      );
    }
  }
}

function ambientHtml(b: B): string {
  const k = b.k;
  const rnd = seeded(`ambient:${b.look.seed}`);
  const T = b.T;
  const theme = b.c.occasion?.theme;
  if (theme && theme !== 'plain') {
    // A special day dresses the whole video: stars, flowers, confetti or hearts drifting down.
    const kinds: Record<Exclude<OccasionTheme, 'plain'>, { names: DoodleName[]; colors: Rgb[] }> = {
      islamic: { names: ['star', 'sparkle'], colors: [k.accent, WHITE] },
      boishakh: { names: ['ring', 'dot', 'sparkle'], colors: [[214, 38, 38], WHITE, k.accent] },
      national: { names: ['dot', 'star', 'ring'], colors: [[0, 106, 78], [244, 42, 65], WHITE] },
      festive: { names: ['dot', 'squiggle', 'star', 'ring'], colors: [k.accent, k.head, k.deco] },
      love: { names: ['heart', 'heartLine', 'sparkle'], colors: [[237, 73, 86], k.accent] },
    };
    const own = b.c.occasion?.palette;
    const set = own?.length
      ? { ...kinds[theme], colors: own.map((c) => [...c] as Rgb) }
      : kinds[theme];
    return Array.from({ length: 22 }, (_, i) => {
      const name = set.names[i % set.names.length]!;
      const size = 26 + Math.round(rnd() * 46);
      const left = Math.round(rnd() * W);
      const top = Math.round(rnd() * H) - 400;
      const color = css(set.colors[i % set.colors.length]!, 0.9);
      const style = `--dx:${Math.round(rnd() * 160 - 80)}px;--dy:${Math.round(300 + rnd() * 500)}px;--dr:${Math.round(rnd() * 360 - 180)}deg;animation:${an('drift', T, 0, { ease: 'linear' })},${an('twinkle', 1.6 + rnd(), rnd() * 2, { ease: 'ease-in-out', iter: 'infinite' })}`;
      return doodle(
        name,
        { left, top, width: size, height: name === 'squiggle' ? size / 4 : size },
        color,
        style,
      );
    }).join('');
  }
  switch (b.look.ambient) {
    case 'none':
      return '';
    case 'drift': {
      const names: DoodleName[] =
        b.look.deco === 'spice' ? ['chilli', 'leaf'] : ['leaf', 'leafDark', 'sparkle'];
      return Array.from({ length: 9 }, (_, i) => {
        const name = names[i % names.length]!;
        const size = 50 + Math.round(rnd() * 60);
        const left = Math.round(rnd() * W);
        const top = Math.round(rnd() * H);
        const style = `--dx:${Math.round(rnd() * 300 - 150)}px;--dy:${Math.round(-200 - rnd() * 400)}px;--dr:${Math.round(rnd() * 360 - 180)}deg;opacity:.8;animation:${an('drift', T, 0, { ease: 'linear' })}`;
        return doodle(
          name,
          { left, top, width: size, height: name === 'sparkle' ? size : size / 2 },
          css(k.deco, 0.8),
          style,
        );
      }).join('');
    }
    case 'bokeh':
      return Array.from({ length: 12 }, () => {
        const s = 40 + Math.round(rnd() * 140);
        const c = rnd() < 0.5 ? k.accent : WHITE;
        const o1 = (0.1 + rnd() * 0.15).toFixed(2);
        const o2 = (0.3 + rnd() * 0.3).toFixed(2);
        return `<div class="abs" style="left:${Math.round(rnd() * W) - s / 2}px;top:${Math.round(rnd() * H) - s / 2}px;width:${s}px;height:${s}px;border-radius:50%;background:${css(c)};filter:blur(${4 + Math.round(rnd() * 8)}px);--o1:${o1};--o2:${o2};--dx:${Math.round(rnd() * 160 - 80)}px;--dy:${Math.round(-60 - rnd() * 160)}px;--dr:0deg;animation:${an('glowPulse', 2 + rnd() * 2, rnd() * 2, { ease: 'ease-in-out', iter: 'infinite' })},${an('drift', T, 0, { ease: 'linear' })};mix-blend-mode:screen"></div>`;
      }).join('');
    case 'sparkle':
      return Array.from({ length: 14 }, () => {
        const s = 22 + Math.round(rnd() * 34);
        return doodle(
          'sparkle',
          { left: Math.round(rnd() * (W - s)), top: Math.round(rnd() * (H - s)), width: s },
          css(k.dark ? WHITE : k.accent, 0.9),
          `animation:${an('twinkle', 1.4 + rnd(), rnd() * 2, { ease: 'ease-in-out', iter: 'infinite' })}`,
        );
      }).join('');
  }
}

interface Scene {
  start: number;
  end: number;
  html: string;
  /** The scene paints its own background (the hook over a photo, the logo card). */
  opaque?: boolean;
}

/** How long the outgoing scene stays visible after a cut (the cut plays over both). */
function overlapOf(cut: VideoLook['cut']): number {
  return cut === 'iris' ? 0.6 : cut === 'push' ? 0.55 : 0;
}

function sectionHtml(b: B, s: Scene, i: number, last: boolean): string {
  const cut = b.look.cut;
  const ov = overlapOf(cut);
  const first = i === 0;
  const tin = first
    ? ''
    : cut === 'iris'
      ? `animation:${an('tIris', 0.6, s.start, { ease: 'cubic-bezier(.6,0,.3,1)' })}`
      : cut === 'push'
        ? `animation:${an('tPushIn', 0.55, s.start, { ease: 'cubic-bezier(.7,0,.3,1)' })}`
        : cut === 'whip'
          ? `animation:${an('tWhipIn', 0.3, s.start, { ease: 'ease-out' })}`
          : cut === 'flash'
            ? `animation:${an('tZoomIn', 0.5, s.start)}`
            : '';
  const tout = last
    ? ''
    : cut === 'push'
      ? `animation:${an('tPushOut', 0.55, s.end, { ease: 'cubic-bezier(.7,0,.3,1)', fill: 'forwards' })}`
      : cut === 'whip'
        ? `animation:${an('tWhipOut', 0.25, s.end - 0.25, { ease: 'ease-in', fill: 'forwards' })}`
        : cut === 'iris'
          ? `animation:${an('fadeOut', 0.4, s.end + 0.05, { ease: 'linear', fill: 'forwards' })}`
          : '';
  const vis = `animation:${an('on', 0.001, s.start, { ease: 'linear' })}${last ? '' : `,${an('off', 0.001, s.end + ov, { ease: 'linear', fill: 'forwards' })}`}`;
  return `<section class="sc" style="z-index:${10 + i};${vis}"><div class="fill" style="${tin}"><div class="fill" style="${tout}">${s.html}</div></div></section>`;
}

/** The cut's own layer (a colour wipe, torn paper, a flash) over the boundary at `t`. */
function cutOverlay(b: B, t: number): string {
  const k = b.k;
  switch (b.look.cut) {
    case 'wipe':
      return `<div class="abs" style="left:${540 - 1750}px;top:-200px;width:3500px;height:${H + 400}px;z-index:90;background:linear-gradient(90deg,${css(k.accent)} 0 5%,${css(k.band)} 5% 95%,${css(k.accent)} 95%);animation:${an('tWipe', 0.9, t - 0.45, { ease: 'cubic-bezier(.55,0,.45,1)', fill: 'none' })};transform:translateX(-2600px)"></div>`;
    case 'tear': {
      const rnd = seeded(`tear:${b.look.seed}:${t}`);
      const edge = (y: number, dir: number) => {
        const pts: string[] = [];
        for (let x = 0; x <= W; x += 30) pts.push(`${x},${Math.round(y + dir * rnd() * 46)}`);
        return pts;
      };
      const top = edge(60, 1);
      const bottom = edge(3140, -1).reverse();
      return `<svg class="abs" width="${W}" height="3200" style="left:0;top:${(H - 3200) / 2}px;z-index:90;filter:drop-shadow(0 0 18px rgb(0 0 0 / .35));animation:${an('tTear', 1, t - 0.5, { ease: 'cubic-bezier(.55,0,.45,1)', fill: 'none' })};transform:translateY(-2900px)"><polygon points="${[...top, ...bottom].join(' ')}" fill="${css(k.band)}"/></svg>`;
    }
    case 'flash':
      return `<div class="fill" style="z-index:90;background:${css(WHITE)};opacity:0;animation:${an('tFlash', 0.36, t - 0.18, { ease: 'linear', fill: 'none' })}"></div>`;
    default:
      return '';
  }
}

// ---------------------------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------------------------

function hookScene(b: B, h: number): Scene {
  const c = b.c;
  const onPhoto = b.look.hookOnPhoto && Boolean(c.dishes[0]?.photoUrl);
  const bg = onPhoto
    ? `<div class="abs" style="inset:-80px;background-image:url('${cssUrl(c.dishes[0]!.photoUrl)}');background-size:cover;background-position:center;filter:blur(8px) brightness(.42) saturate(1.2);animation:${an('kb', h + 0.6, 0, { ease: 'linear' })}"></div>`
    : '';
  const color = onPhoto ? WHITE : b.k.head;
  const size = hookPx(c.words.hook);
  if (c.occasion) return greetingScene(b, h, bg, onPhoto, c.occasion.greeting);
  const chip = c.logoUrl
    ? `<div class="fill" style="animation:${an('fadeIn', 0.4, 0.15)}">${brandMark(b, 540, 300, 110, onPhoto || b.k.dark)}</div>`
    : pill(b, c.restaurant, 540, 250, 0.15, {
        size: 46,
        bg: onPhoto ? WHITE : b.k.band,
        ink: onPhoto ? INK : b.k.onBand,
      });
  return {
    start: 0,
    end: h,
    opaque: onPhoto,
    html: `${bg}${chip}${bigText(b, c.words.hook, { left: 70, top: 520, width: 940, height: 860 }, size, 0.25, b.look.hook, { color, shadow: onPhoto, highlight: !onPhoto && b.look.hook === 'pop' && b.rnd() < 0.4 })}`,
  };
}

/**
 * A special day opens the video: the greeting big in the accent (fixed text, never AI-written), the hook
 * smaller under it, and the day's own decorations (the ambient layer carries the theme).
 */
function greetingScene(b: B, h: number, bg: string, onPhoto: boolean, greeting: string): Scene {
  const c = b.c;
  const theme = c.occasion?.theme ?? 'plain';
  const ink = onPhoto ? WHITE : b.k.head;
  const accent = onPhoto ? b.k.accent : contrast(b.k.accent, b.k.bg) >= 1.8 ? b.k.accent : b.k.head;
  const deco =
    theme === 'islamic'
      ? `<div class="abs" style="left:700px;top:180px;width:280px;height:280px;color:${css(b.k.accent)};animation:${an('unblur', 0.8, 0.05)}">${MOON}</div>
${[150, 330, 860].map((x, i) => `<div class="abs" style="left:${x}px;top:-40px;width:90px;height:${300 + i * 90}px;transform-origin:45px 0;color:${css(b.k.accent)};animation:${an('slideDown', 0.7, 0.1 + i * 0.12)},${an('sway', 2.6, 0.8, { ease: 'ease-in-out', iter: 'infinite', fill: 'none' })}">${LANTERN}</div>`).join('')}`
      : c.occasion?.lanterns
        ? [120, 300, 780, 930]
            .map(
              (x, i) =>
                `<div class="abs" style="left:${x}px;top:-40px;width:90px;height:${280 + (i % 2) * 110}px;transform-origin:45px 0;color:${c.occasion!.lanterns === 'red' ? 'rgb(214 38 38)' : 'rgb(244 180 40)'};animation:${an('slideDown', 0.7, 0.1 + i * 0.1)},${an('sway', 2.6, 0.8, { ease: 'ease-in-out', iter: 'infinite', fill: 'none' })}">${LANTERN}</div>`,
            )
            .join('')
        : '';
  return {
    start: 0,
    end: h,
    opaque: onPhoto,
    html: `${bg}${deco}
${bigText(b, greeting, { left: 60, top: 470, width: 960, height: 560 }, 200, 0.2, 'slam', { color: accent, shadow: onPhoto })}
${bigText(b, c.words.hook, { left: 80, top: 1060, width: 920, height: 380 }, 92, 0.75, 'up', { color: ink, shadow: onPhoto, font: 'body', weight: 800 })}`,
  };
}

/** A crescent moon and a star (Eid, Ramadan, Jummah). */
const MOON = `<svg viewBox="0 0 100 100" width="100%" height="100%" fill="currentColor"><path d="M62 8a42 42 0 1 0 30 62A36 36 0 1 1 62 8z"/><path d="M78 30l3 8 8 1-6 5 2 8-7-4-7 4 2-8-6-5 8-1z"/></svg>`;
/** A hanging lantern on its string. */
const LANTERN = `<svg viewBox="0 0 90 400" width="100%" height="100%" preserveAspectRatio="xMidYMax meet" fill="currentColor"><rect x="44" y="0" width="2" height="300"/><path d="M30 300h30l6 10H24z"/><path d="M24 312h42c4 18 4 42 0 60H24c-4-18-4-42 0-60z" opacity=".9"/><rect x="28" y="318" width="34" height="48" rx="6" fill="rgb(255 236 170)" opacity=".85"/><path d="M28 374h34l-6 12H34z"/></svg>`;

function hookPx(text: string): number {
  const len = [...text].length;
  return len <= 12 ? 230 : len <= 22 ? 196 : len <= 34 ? 168 : 136;
}

/** The name of a dish over the stage at the top of a scene. */
function headline(
  b: B,
  text: string,
  at: number,
  top = 230,
  height = 250,
  motion?: TextMotion,
): string {
  const ink = inkAt(b, top + height / 2);
  return bigText(
    b,
    text,
    { left: 60, top, width: 960, height },
    150,
    at,
    motion ?? (b.look.hook === 'type' ? 'rise' : b.look.hook),
    { color: ink.color, shadow: ink.shadow },
  );
}

function tagline(b: B, text: string, at: number, top: number, height = 150): string {
  const ink = inkAt(b, top + height / 2);
  return bigText(b, text, { left: 70, top, width: 940, height }, 66, at, 'up', {
    color: ink.color,
    shadow: ink.shadow,
    font: 'body',
    weight: 700,
    valign: 'top',
  });
}

function showcase(b: B, h: number, o: number): Scene[] {
  const d = b.c.dishes[0]!;
  const mid = r(h + (o - h) * 0.55);
  const a = `${headline(b, d.name, h + 0.35)}
${dish(b, d, { left: 90, top: 540, width: 900, height: 860 }, h + 0.05)}
${b.look.steam ? steam(b, 540, 700, h + 0.7) : ''}
${tagline(b, b.c.words.tagline, h + 0.9, 1460)}`;
  const close = `${dish(b, d, { left: -240, top: 300, width: 1560, height: 1380 }, mid, { enter: 'zoom', idle: 'kb' })}
${b.look.steam ? steam(b, 540, 520, mid + 0.3, 380) : ''}
${bigText(b, b.c.words.cta, { left: 70, top: 1380, width: 940, height: 300 }, 112, mid + 0.35, b.look.hook === 'type' ? 'pop' : b.look.hook, { color: WHITE, shadow: true })}
${d.price ? priceTag(b, d.price, 740, 300, mid + 0.7, 250, b.rnd() < 0.5) : ''}`;
  return [
    { start: h, end: mid, html: a },
    { start: mid, end: o, html: close },
  ];
}

function versus(b: B, h: number, o: number): Scene[] {
  const [d0, d1] = b.c.dishes as [VideoDish, VideoDish];
  const mid = r(h + (o - h) * 0.58);
  const ink = b.k.head;
  const a = `${dish(b, d0, { left: 330, top: 220, width: 820, height: 820 }, h + 0.05, { enter: 'spin' })}
${arcText(b, d0.name, 740, 630, 470, 115, 235, 84, h + 0.35, ink)}
${dish(b, d1, { left: -70, top: 960, width: 820, height: 820 }, h + 0.4, { enter: 'spin', mirror: true })}
${arcText(b, d1.name, 340, 1370, 470, -65, 55, 84, h + 0.7, inkAt(b, 1370).color)}
<div class="abs" style="left:390px;top:810px;width:300px;height:300px;z-index:8;animation:${an('slam', 0.45, h + 0.9, { ease: 'cubic-bezier(.5,0,.5,1)' })}"><div class="fill${hasBangla(b.c.labels.or) ? ' bn' : ''}" style="border-radius:50%;background:${css(b.k.accent)};box-shadow:0 18px 40px rgb(0 0 0 / .3);display:grid;place-items:center;font-family:${b.font.stack};font-weight:${b.font.weight};font-size:${Math.round(110 * b.font.scale)}px;color:${css(b.k.onAccent)}">${escapeHtml(b.font.upper ? b.c.labels.or.toUpperCase() : b.c.labels.or)}</div></div>`;
  const q = `${bigText(b, b.c.words.question, { left: 70, top: 260, width: 940, height: 640 }, 140, mid + 0.15, b.look.hook === 'type' ? 'pop' : b.look.hook, { color: inkAt(b, 580).color })}
${dish(b, d0, { left: 20, top: 960, width: 540, height: 540 }, mid + 0.45, { enter: 'rise', idle: 'sway' })}
${dish(b, d1, { left: 520, top: 960, width: 540, height: 540 }, mid + 0.6, { enter: 'rise', idle: 'sway' })}
${pill(b, d0.name, 290, 1520, mid + 0.9, { size: 46, maxWidth: 510 })}
${pill(b, d1.name, 790, 1520, mid + 1.0, { size: 46, maxWidth: 510 })}`;
  return [
    { start: h, end: mid, html: a },
    { start: mid, end: o, html: q },
  ];
}

function combo(b: B, h: number, o: number): Scene[] {
  const [d0, d1] = b.c.dishes as [VideoDish, VideoDish];
  const p = r(h + 1.2);
  const punch = `${bigText(b, b.c.words.punch, { left: 60, top: 600, width: 960, height: 600 }, 230, h + 0.05, 'slam', { highlight: true })}
<div class="abs" style="left:250px;top:1200px;width:580px;height:70px;color:${css(b.k.accent)}"><svg viewBox="0 0 300 30" width="580" height="70" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" style="--len:340;stroke-dasharray:340;animation:${an('draw', 0.45, h + 0.5)}"><path d="M6 20 C 80 6, 180 4, 294 14"/></svg></div>`;
  const pair = `${tagline(b, b.c.words.tagline, p + 0.3, 250, 200)}
${dish(b, d0, { left: -30, top: 560, width: 680, height: 680 }, p + 0.05, { enter: 'swing' })}
${dish(b, d1, { left: 430, top: 880, width: 680, height: 680 }, p + 0.55, { enter: 'swing', mirror: true })}
<div class="abs" style="left:440px;top:880px;width:200px;height:200px;z-index:8;animation:${an('wPop', 0.45, p + 1, { ease: BOUNCE })}"><div class="fill" style="border-radius:50%;background:${css(b.k.accent)};color:${css(b.k.onAccent)};display:grid;place-items:center;font:900 150px/1 ${stack('archivo')};box-shadow:0 14px 30px rgb(0 0 0 / .3)">+</div></div>
${pill(b, d0.name, 310, 1270, p + 1.15, { size: 50, maxWidth: 580 })}
${pill(b, d1.name, 760, 1590, p + 1.3, { size: 50, maxWidth: 580 })}`;
  return [
    { start: h, end: p, html: punch },
    { start: p, end: o, html: pair },
  ];
}

/** Cards that slide one by one into the middle: the menu carousel and the search's results. */
function cards(b: B, from: number, to: number, top: number): string {
  const ds = b.c.dishes;
  const n = ds.length;
  const cw = 640;
  const ch = 860;
  const step = 700;
  const slot = (to - from - 0.3) / n;
  const html = ds
    .map((d, j) => {
      const frames: [number, string][] = [];
      const at = (i: number) => {
        const off = (j - i) * step;
        const focus = i === j;
        return `transform:translateX(${off}px) scale(${focus ? 1 : 0.82});opacity:${Math.abs(j - i) <= 1 ? 1 : 0}`;
      };
      frames.push([0, `transform:translateX(${(j + 2) * step}px) scale(.82);opacity:0`]);
      frames.push([from, `transform:translateX(${(j + 2) * step}px) scale(.82);opacity:0`]);
      for (let i = 0; i < n; i++) {
        const s = from + 0.3 + i * slot;
        frames.push([s, at(i)]);
        frames.push([s + slot - 0.45, at(i)]);
      }
      frames.push([b.T, at(n - 1)]);
      const price = d.price
        ? pill(b, d.price, cw / 2, ch - 140, from + 0.3 + j * slot + 0.2, {
            size: 50,
            maxWidth: 420,
          })
        : '';
      return `<div class="abs" style="left:${540 - cw / 2}px;top:${top}px;width:${cw}px;height:${ch}px;animation:${timeline(b, frames)}">
<div class="fill" style="border-radius:44px;background:${css(b.k.card)};box-shadow:0 30px 60px rgb(0 0 0 / .28)"></div>
<div class="abs" style="left:40px;top:40px;width:${cw - 80}px;height:${cw - 80}px">${plate(d, { left: 0, top: 0, width: cw - 80, height: cw - 80 }, 'float', b.k, b.rnd, { anchor: 'center', ring: css(WHITE) })}</div>
<div class="abs ${hasBangla(d.name) ? 'bn' : ''}" data-vfit style="left:40px;top:${cw - 20}px;width:${cw - 80}px;height:110px;display:flex;align-items:center;justify-content:center;text-align:center;font-family:${b.font.stack};font-weight:${b.font.weight};font-size:${Math.round(84 * b.font.scale)}px;line-height:1.05;color:${css(b.k.cardHead)}">${escapeHtml(b.font.upper && !hasBangla(d.name) ? d.name.toUpperCase() : d.name)}</div>
${price}</div>`;
    })
    .join('');
  return html;
}

function carousel(b: B, h: number, o: number): Scene[] {
  const html = `${headline(b, b.c.words.tagline, h + 0.1, 220, 260)}
${cards(b, h, o, 560)}`;
  return [{ start: h, end: o, html }];
}

function search(b: B, h: number, o: number): Scene[] {
  const typed = b.c.restaurant;
  const s = r(h + 1.9);
  const bar = (at: number, top: number, animate: boolean) => {
    const letters = hasBangla(typed)
      ? escapeHtml(typed)
      : `<span style="white-space:pre">${[...typed].map((ch, i) => `<span style="animation:${an('on', 0.001, at + 0.35 + i * 0.06, { ease: 'linear' })}">${escapeHtml(ch)}</span>`).join('')}</span>`;
    return `<div class="abs" style="left:80px;top:${top}px;width:920px;height:150px;border-radius:999px;background:${css(b.k.card)};box-shadow:0 18px 40px rgb(0 0 0 / .22);display:flex;align-items:center;gap:24px;padding:0 44px;${animate ? `animation:${an('wPop', 0.5, at, { ease: BOUNCE })}` : ''}">
<div data-vfit style="flex:1;height:84px;display:flex;align-items:center;white-space:nowrap;overflow:hidden;font-size:62px;font-weight:600;color:${css(b.k.onCard)}" class="${hasBangla(typed) ? 'bn' : ''}">${animate ? letters : escapeHtml(typed)}${animate ? `<span style="display:inline-block;width:4px;height:52px;margin-left:4px;background:${css(b.k.accent)};animation:${an('blink', 0.5, at, { ease: 'linear', iter: 6, fill: 'forwards' })}"></span>` : ''}</div>
<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="${css(b.k.accent)}" stroke-width="2.6" stroke-linecap="round" style="${animate ? `animation:${an('pulse', 0.4, at + 0.4 + [...typed].length * 0.06, { iter: 2 })}` : ''}"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg></div>`;
  };
  const a = `<div class="fill" style="animation:${an('unblur', 0.5, h + 0.05)}">${brandMark(b, 540, 600, 170, b.k.dark)}</div>${bar(h + 0.2, 880, true)}
${dish(b, b.c.dishes[0]!, { left: 240, top: 1120, width: 600, height: 600 }, h + 0.9, { enter: 'rise' })}`;
  const results = `${bar(s, 250, false)}${cards(b, s, o, 520)}`;
  return [
    { start: h, end: s, html: a },
    { start: s, end: o, html: results },
  ];
}

function ring(b: B, h: number, o: number): Scene[] {
  const ds = b.c.dishes;
  const n = ds.length;
  const cx = 1180;
  const cy = 960;
  const radius = 560;
  const size = 330;
  const plates = 6;
  const stepDeg = 360 / plates;
  const slot = (o - h - 0.6) / n;
  const angle = (i: number) => -i * stepDeg;
  const frames: [number, string][] = [
    [0, 'transform:rotate(110deg)'],
    [h, 'transform:rotate(110deg)'],
    [h + 0.6, `transform:rotate(${angle(0)}deg)`],
  ];
  const counter: [number, string][] = [
    [0, 'transform:rotate(-110deg)'],
    [h, 'transform:rotate(-110deg)'],
    [h + 0.6, `transform:rotate(${-angle(0)}deg)`],
  ];
  for (let i = 1; i < n; i++) {
    const t = h + 0.6 + i * slot;
    frames.push(
      [t - 0.5, `transform:rotate(${angle(i - 1)}deg)`],
      [t, `transform:rotate(${angle(i)}deg)`],
    );
    counter.push(
      [t - 0.5, `transform:rotate(${-angle(i - 1)}deg)`],
      [t, `transform:rotate(${-angle(i)}deg)`],
    );
  }
  frames.push([b.T, frames[frames.length - 1]![1]]);
  counter.push([b.T, counter[counter.length - 1]![1]]);
  const counterAnim = timeline(b, counter);
  const platesHtml = Array.from({ length: plates }, (_, p) => {
    const d = ds[p % n]!;
    const a = ((180 + p * stepDeg) * Math.PI) / 180;
    const x = cx + radius * Math.cos(a) - size / 2;
    const y = cy + radius * Math.sin(a) - size / 2;
    return `<div class="abs" style="left:${r(x - (cx - 1000))}px;top:${r(y - (cy - 1000))}px;width:${size}px;height:${size}px;animation:${counterAnim}">
<div class="fill" style="border-radius:50%;background:${css(WHITE)};box-shadow:0 20px 40px rgb(0 0 0 / .3)"></div>
<div class="abs" style="left:20px;top:20px;width:${size - 40}px;height:${size - 40}px">${plate(d, { left: 0, top: 0, width: size - 40, height: size - 40 }, 'float', b.k, b.rnd, { anchor: 'center', ring: css(WHITE), shadow: 'drop-shadow(0 8px 10px rgb(0 0 0 / .25))' })}</div></div>`;
  }).join('');
  const names = ds
    .map((d, i) => {
      const t0 = h + 0.6 + i * slot;
      const t1 = i === n - 1 ? b.T : t0 + slot - 0.5;
      const ink = inkAt(b, 1640);
      return `<div class="fill" style="animation:${an('on', 0.001, t0, { ease: 'linear' })},${an('off', 0.001, t1, { ease: 'linear', fill: 'forwards' })}">${bigText(b, d.name, { left: 60, top: 1540, width: 960, height: 180 }, 110, t0, 'up', { color: ink.color, shadow: ink.shadow })}</div>`;
    })
    .join('');
  const html = `<div class="abs" style="left:${cx - 1000}px;top:${cy - 1000}px;width:2000px;height:2000px;transform-origin:1000px 1000px;animation:${timeline(b, frames)}">
<div class="abs" style="left:${1000 - radius}px;top:${1000 - radius}px;width:${radius * 2}px;height:${radius * 2}px;border-radius:50%;border:64px solid ${css(b.k.card, 0.95)};box-shadow:0 0 0 3px ${css(b.k.accent, 0.5)}"></div>
${platesHtml}</div>
<div class="abs" style="left:${cx - radius - size / 2 - 22}px;top:${cy - size / 2 - 22}px;width:${size + 44}px;height:${size + 44}px;border-radius:50%;border:10px solid ${css(b.k.accent)};animation:${an('wPop', 0.4, h + 0.7, { ease: BOUNCE })}"></div>
${bigText(b, b.c.words.question, { left: 40, top: 520, width: 380, height: 880 }, 150, h + 0.2, b.look.hook === 'type' ? 'rise' : b.look.hook, { align: 'left', color: inkAt(b, 900).color })}
${names}`;
  return [{ start: h, end: o, html }];
}

function offer(b: B, h: number, o: number): Scene[] {
  const d = b.c.dishes[0]!;
  const mid = r(h + (o - h) * 0.5);
  const was = d.was ?? '';
  const ink = inkAt(b, 1500);
  const a = `${headline(b, d.name, h + 0.3)}
${dish(b, d, { left: 110, top: 520, width: 860, height: 820 }, h + 0.05)}
${
  !was
    ? ''
    : `<div class="abs" style="left:140px;top:1400px;width:800px;height:220px;animation:${an('up', 0.45, h + 0.6)}">
<div data-vfit style="width:800px;height:220px;display:flex;align-items:center;justify-content:center;font-family:${stack('archivo')};font-size:150px;color:${css(ink.color)};${ink.shadow ? 'text-shadow:0 6px 20px rgb(0 0 0 / .4);' : ''}white-space:nowrap">${escapeHtml(was)}</div>
<div class="abs" style="left:40px;top:96px;width:720px;height:26px;border-radius:13px;background:${css(b.k.accent)};box-shadow:0 4px 12px rgb(0 0 0 / .3);transform-origin:0 50%;animation:${an('strike', 0.35, mid - 0.7, { ease: 'ease-out' })}"></div></div>`
}`;
  const now = `${tagline(b, b.c.words.tagline, mid + 0.1, 250, 180)}
${dish(b, d, { left: 190, top: 420, width: 700, height: 700 }, mid, { enter: 'zoom' })}
${pill(b, b.c.labels.now, 540, 1150, mid + 0.25, { size: 60, bg: b.k.card, ink: b.k.cardHead })}
${d.price ? priceTag(b, d.price, 330, 1270, mid + 0.5, 420, true) : ''}`;
  return [
    { start: h, end: mid, html: a },
    { start: mid, end: o, html: now },
  ];
}

function outroScene(b: B, o: number): Scene {
  const c = b.c;
  const k = b.k;
  const contact = [c.area, c.phone].filter((x): x is string => Boolean(x)).join('  •  ');
  // The button must stand out from the closing background: the accent when it does, else the light card.
  const cta = (top: number, at: number, onto: Rgb) => {
    const bg = contrast(k.accent, onto) >= 1.8 ? k.accent : k.card;
    const ink = bg === k.accent ? k.onAccent : k.onCard;
    return `<div class="abs" style="left:0;top:${top}px;width:${W}px;display:flex;justify-content:center;animation:${an('wPop', 0.4, at, { ease: BOUNCE })}"><span class="pill ${hasBangla(c.words.cta) ? 'bn' : ''}" style="font-size:58px;padding:30px 72px;background:${css(bg)};color:${css(ink)};animation:${an('pulse', 0.7, at + 0.45, { ease: 'ease-in-out', iter: 'infinite', fill: 'none' })}">${escapeHtml(c.words.cta)}</span></div>`;
  };
  // A text logo already says the name: then only the contact follows it.
  const nameLine = (top: number, at: number, ink: Rgb) =>
    `${c.logoUrl ? bigText(b, c.restaurant, { left: 80, top, width: 920, height: 130 }, 84, at, 'up', { color: ink }) : ''}
${contact ? bigText(b, contact, { left: 80, top: c.logoUrl ? top + 140 : top, width: 920, height: 80 }, 46, at + 0.15, 'up', { color: ink, font: 'body', weight: 600 }) : ''}`;
  switch (b.look.outro) {
    case 'reveal': {
      const bg = k.band;
      const ink = k.onBand;
      return {
        start: o,
        end: b.T,
        opaque: true,
        html: `<div class="fill" style="background:radial-gradient(circle at 540px 760px,${css(mix(bg, WHITE, 0.14))},${css(bg)} 65%)"></div>
<svg class="abs" width="520" height="520" style="left:280px;top:500px" viewBox="0 0 520 520"><circle cx="260" cy="260" r="240" fill="none" stroke="${css(k.accent)}" stroke-width="10" stroke-linecap="round" style="--len:1508;stroke-dasharray:1508;transform:rotate(-90deg);transform-origin:260px 260px;animation:${an('draw', 0.9, o + 0.1)}"/></svg>
<div class="fill" style="transform-origin:540px 760px;animation:${an('unblur', 0.7, o + 0.15)}">${brandMark(b, 540, 760, 200, true)}</div>
${nameLine(1080, o + 0.5, ink)}
${cta(c.logoUrl ? 1380 : 1230, o + 0.8, bg)}`,
      };
    }
    case 'stamp': {
      const bg = k.dark ? k.bg : mix(k.band, INK, 0.25);
      const ink = k.dark ? k.ink : WHITE;
      return {
        start: o,
        end: b.T,
        opaque: true,
        html: `<div class="fill" style="background:${css(bg)}"></div>
${bigText(b, c.labels.onlyAt, { left: 80, top: 450, width: 920, height: 140 }, 96, o + 0.1, 'up', { color: contrast(k.accent, bg) >= 2.2 ? k.accent : ink })}
<div class="fill" style="animation:${an('shake', 0.35, o + 0.75, { ease: 'linear' })}"><div class="fill" style="transform-origin:540px 780px;animation:${an('slam', 0.45, o + 0.35, { ease: 'cubic-bezier(.5,0,.5,1)' })}">${brandMark(b, 540, 780, 210, true)}</div></div>
${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<div class="abs" style="left:${540 - 320}px;top:${780 - 320}px;width:640px;height:640px;transform:rotate(${i * 45}deg)"><div class="abs" style="left:300px;top:0;width:40px;height:90px;color:${css(k.accent)};animation:${an('burstOut', 0.6, o + 0.7, { ease: 'ease-out' })}">${doodleSvg('spark')}</div></div>`).join('')}
${nameLine(1100, o + 0.8, ink)}
${cta(c.logoUrl ? 1400 : 1250, o + 1.0, bg)}`,
      };
    }
    case 'card': {
      const d = c.dishes[0]!;
      return {
        start: o,
        end: b.T,
        html: `${dish(b, d, { left: 190, top: 300, width: 700, height: 700 }, o, { enter: 'drop' })}
<div class="abs" style="left:0;top:1060px;width:${W}px;height:${H - 1060}px;border-radius:64px 64px 0 0;background:${css(WHITE)};box-shadow:0 -20px 50px rgb(0 0 0 / .2);animation:${an('slideUp', 0.55, o + 0.05)}">
<div class="fill" style="animation:${an('fadeIn', 0.3, o + 0.45)}">${brandMark(b, 540, 170, 130, false)}
${c.logoUrl ? bigText(b, c.restaurant, { left: 80, top: 270, width: 920, height: 110 }, 80, o + 0.5, 'up', { color: INK }) : ''}
${contact ? bigText(b, contact, { left: 80, top: c.logoUrl ? 390 : 300, width: 920, height: 80 }, 44, o + 0.6, 'up', { color: INK, font: 'body', weight: 600 }) : ''}
${cta(500, o + 0.75, WHITE)}</div></div>`,
      };
    }
  }
}

const KIND: Record<VideoLook['kind'], (b: B, h: number, o: number) => Scene[]> = {
  showcase,
  versus,
  combo,
  carousel,
  ring,
  search,
  offer,
};

/** The video as one HTML page; the renderer steps its animations frame by frame. */
/** The video as one HTML page plus where its sounds go; the renderer steps its animations frame by frame. */
export function videoHtml(c: VideoContent): string {
  return videoPlan(c).html;
}

/** Runs once in the Growth preview: fit the words, then play from the start and loop. */
const PREVIEW_SCRIPT = (seconds: number) => `<script>
document.fonts.ready.then(function(){Promise.all([].slice.call(document.images).map(function(i){return i.decode().catch(function(){})})).then(function(){
window.__vfit();var all=window.__anims;var go=function(){for(var a of all){a.currentTime=0;a.play();}};go();setInterval(go,${Math.round(seconds * 1000) + 600});});});
</script>`;

export function videoPlan(c: VideoContent): VideoPlan {
  const look = c.look;
  const T = videoSeconds(c);
  const h = Math.min(4.8, Math.max(1.6, c.hookSeconds ?? 2.2));
  const o = r(T - OUTRO);
  const f = FONTS[look.type];
  const b: B = {
    c,
    look,
    k: schemeColors(look.scheme, c.colorMain, c.colorAccent),
    rnd: seeded(`vstyle:${look.seed}`),
    font: {
      stack: stack(look.type),
      weight: f.weight,
      lineHeight: f.lineHeight,
      scale: f.scale,
      upper: f.upper,
    },
    T,
    keyframes: [],
    n: 0,
    hits: [],
  };
  const scenes = [hookScene(b, h), ...KIND[look.kind](b, h, o), outroScene(b, o)];
  const cuts = scenes.slice(1).map((s) => s.start);
  const stage = stageHtml(b, h, cuts);
  const body = `<div class="fill" style="z-index:0">${stage}</div>
<div class="fill" style="z-index:1;pointer-events:none">${ambientHtml(b)}</div>
${scenes.map((s, i) => sectionHtml(b, s, i, i === scenes.length - 1)).join('\n')}
${cuts.map((t) => cutOverlay(b, t)).join('')}
${VFIT_SCRIPT}${c.preview ? PREVIEW_SCRIPT(T) : ''}`;
  for (const t of cuts) b.hits.push({ t: t - 0.15, sound: 'whoosh' });
  const html = page(
    VIDEO_SIZE,
    [look.type, 'archivo'],
    css(b.k.bg),
    css(b.k.ink),
    STATIC_KEYFRAMES + b.keyframes.join('\n'),
    body,
  );
  // Sounds closer than 0.25 s to one of the same kind are one sound.
  const hits = b.hits
    .filter((x) => x.t >= 0 && x.t < T)
    .sort((x, y) => x.t - y.t)
    .filter((x, i, all) => !all.slice(0, i).some((y) => y.sound === x.sound && x.t - y.t < 0.25));
  return { html, seconds: T, hits };
}
