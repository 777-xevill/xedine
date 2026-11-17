import * as THREE from 'three';
import type { Show } from './story';
import { landingAsset } from './asset-version';

/**
 * The screens inside the 3D café, drawn live on canvases in the real app's look (ADR 0063: grey, silver,
 * yellow; ADR 0064: "Xedine" and its chef logo on every screen). Each painter draws one moment of the story
 * from its progress `t` (0..1, scrubbed by the scroll, so it plays backwards too). Every word and number
 * arrives ready in `ScreenText` (story-text.ts), built from the messages and the story ledger. Text is large:
 * a visitor reads these screens from the story's camera (the founder, 2026-11-17).
 */

export type Row = {
  name: string;
  value?: string;
  note?: string;
  icon?: string;
  tone?: 'ok' | 'warn' | 'off';
};
export type Bar = { name: string; from: number; to: number; label: string; note?: string };
/** A kitchen ticket: where it goes, what to cook, how long it has waited. */
export type Ticket = { where: string; lines: string[]; mins: number; wait: string };

export type ScreenText = {
  brand: string;
  w: Record<string, string>;
  brief: string[];
  telegram: {
    lines: string[];
    ask: string;
    yes: string;
    no: string;
    saved: string;
    lasts: string[];
  };
  stockUp: Bar[];
  safety: { lots: Row[]; checks: Row[]; licence: string };
  staff: { rows: Row[]; present: string };
  plan: {
    days: { label: string; icon: string; mm?: string; holiday?: boolean }[];
    best: Row[];
    buy: Row[];
  };
  table: { dishes: Row[]; points: string };
  till: {
    tiles: { icon: string; name: string }[];
    lines: Row[];
    member: string;
    code: string;
    subtotal: string;
    discount: string;
    tax: string;
    taxName: string;
    total: string;
    cash: string;
    card: string;
    points: string;
  };
  approval: { ask: string; pct: string; recorded: string; soFar: string };
  kds: { tickets: Ticket[]; next: Ticket; signedIn: string };
  scale: { grams: string; recipe: string };
  stockDown: { bars: Bar[]; loss: string; waste: string; left: string };
  poster: { price: string; dish: string };
  offer: { quiet: string; line: string; sendTo: string; sent: string; regulars: string };
  notify: { body: string; pct: string };
  closing: {
    expected: string;
    counted: string;
    short: string;
    sales: string;
    bills: string;
    best: Row[];
    lunch: string;
    hours: number[];
  };
  leaks: { rows: Row[]; total: string; profit: Row[]; profitTotal: string; star: string };
  ask: { q: string; a: string; placeholder: string };
};

type Colors = { grey: string; silver: string; yellow: string };

/** The brand's three colours, read from the page's CSS variables (never written here, ADR 0063). */
function brand(): Colors {
  const css = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    grey: read('--brand-grey', 'black'),
    silver: read('--brand-silver', 'silver'),
    yellow: read('--brand-yellow', 'gold'),
  };
}

/** Pictures the screens draw: the chef logo, and the logos of the networks Xedine posts to. */
const LOGO = '/brand/logo-chef-192.png';
const NETWORKS = [
  landingAsset('logos/facebook.svg'),
  landingAsset('logos/instagram.svg'),
  landingAsset('logos/tiktok.svg'),
] as const;
const pictures = new Map<string, HTMLImageElement>();
/** Bumped when a picture arrives, so every screen paints again with it. */
let picturesLoaded = 0;

function picture(src: string): HTMLImageElement | null {
  if (typeof Image === 'undefined') return null;
  let img = pictures.get(src);
  if (!img) {
    img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      picturesLoaded++;
    };
    img.src = src;
    pictures.set(src, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

const EMOJI = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** 0 before `a`, 1 after `a + d`, eased between. */
const step = (t: number, a: number, d = 0.08) => {
  const x = clamp01((t - a) / d);
  return x * x * (3 - 2 * x);
};

class Ui {
  readonly ctx: CanvasRenderingContext2D;
  readonly w: number;
  readonly h: number;
  readonly c: Colors;
  readonly font: string;
  constructor(ctx: CanvasRenderingContext2D, c: Colors, font: string) {
    this.ctx = ctx;
    this.w = ctx.canvas.width;
    this.h = ctx.canvas.height;
    this.c = c;
    this.font = font;
  }
  bg() {
    this.ctx.globalAlpha = 1;
    this.ctx.fillStyle = this.c.grey;
    this.ctx.fillRect(0, 0, this.w, this.h);
  }
  box(x: number, y: number, w: number, h: number, r: number, fill: string, alpha = 1) {
    const { ctx } = this;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ring(x: number, y: number, w: number, h: number, r: number, stroke: string, width: number) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.stroke();
  }
  text(
    s: string,
    x: number,
    y: number,
    size: number,
    opts: {
      weight?: number;
      color?: string;
      align?: CanvasTextAlign;
      alpha?: number;
      max?: number;
    } = {},
  ) {
    const { ctx } = this;
    ctx.globalAlpha = opts.alpha ?? 1;
    ctx.font = `${opts.weight ?? 500} ${size}px ${this.font}`;
    ctx.fillStyle = opts.color ?? this.c.silver;
    ctx.textAlign = opts.align ?? 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(s, x, y, opts.max);
    ctx.globalAlpha = 1;
  }
  /** Wrapped text; returns the height used. */
  para(
    s: string,
    x: number,
    y: number,
    width: number,
    size: number,
    opts: { weight?: number; color?: string; alpha?: number } = {},
  ) {
    const { ctx } = this;
    ctx.font = `${opts.weight ?? 500} ${size}px ${this.font}`;
    const lines: string[] = [];
    for (const part of s.split('\n')) {
      let line = '';
      for (const word of part.split(' ')) {
        const next = line ? `${line} ${word}` : word;
        if (ctx.measureText(next).width > width && line) {
          lines.push(line);
          line = word;
        } else line = next;
      }
      lines.push(line);
    }
    lines.forEach((l, i) => this.text(l, x, y + i * size * 1.25, size, opts));
    return lines.length * size * 1.25;
  }
  emoji(s: string, x: number, y: number, size: number, alpha = 1) {
    const { ctx } = this;
    ctx.globalAlpha = alpha;
    ctx.font = `${size}px ${EMOJI}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(s, x, y);
    ctx.globalAlpha = 1;
  }
  /** A picture, if it has arrived. */
  image(src: string, x: number, y: number, w: number, h: number, alpha = 1) {
    const img = picture(src);
    if (!img) return false;
    this.ctx.globalAlpha = alpha;
    this.ctx.drawImage(img, x, y, w, h);
    this.ctx.globalAlpha = 1;
    return true;
  }
  /** Xedine's chef logo as a tile (a yellow tile until the picture arrives). */
  logo(x: number, y: number, size: number, alpha = 1) {
    if (!this.image(LOGO, x, y, size, size, alpha))
      this.box(x, y, size, size, size * 0.26, this.c.yellow, alpha);
  }
  /** The app's top bar: the chef logo, "Xedine", the section. */
  header(brandName: string, section: string, size = 1) {
    const h = 92 * size;
    this.box(0, 0, this.w, h, 0, this.c.silver, 0.06);
    this.logo(22 * size, 18 * size, 56 * size);
    this.text(brandName, 90 * size, 47 * size, 32 * size, { weight: 800 });
    this.text(section, this.w - 24 * size, 47 * size, 28 * size, {
      weight: 600,
      align: 'right',
      alpha: 0.75,
      max: this.w * 0.55,
    });
    return h;
  }
  chip(
    s: string,
    x: number,
    y: number,
    size: number,
    tone: 'yellow' | 'silver' = 'silver',
    alpha = 1,
  ) {
    const { ctx } = this;
    ctx.font = `600 ${size}px ${this.font}`;
    const w = ctx.measureText(s).width + size * 1.4;
    const h = size * 1.9;
    this.box(
      x,
      y - h / 2,
      w,
      h,
      h / 2,
      tone === 'yellow' ? this.c.yellow : this.c.silver,
      (tone === 'yellow' ? 1 : 0.14) * alpha,
    );
    this.text(s, x + size * 0.7, y, size, {
      weight: 600,
      color: tone === 'yellow' ? this.c.grey : this.c.silver,
      alpha,
    });
    return w;
  }
  button(s: string, x: number, y: number, w: number, h: number, on: number) {
    this.box(x, y, w, h, h / 2, this.c.yellow, 0.35 + 0.65 * on);
    this.text(s, x + w / 2, y + h / 2, h * 0.4, {
      weight: 700,
      color: this.c.grey,
      align: 'center',
      max: w - h * 0.6,
    });
  }
  bar(x: number, y: number, w: number, h: number, value: number, warn = false) {
    this.box(x, y, w, h, h / 2, this.c.silver, 0.12);
    this.box(
      x,
      y,
      Math.max(h, w * clamp01(value)),
      h,
      h / 2,
      warn ? this.c.yellow : this.c.silver,
      warn ? 1 : 0.85,
    );
  }
  bubble(s: string, side: 'me' | 'them', y: number, size: number, alpha: number) {
    if (alpha <= 0) return 0;
    const { ctx } = this;
    const maxW = this.w * 0.8;
    ctx.font = `500 ${size}px ${this.font}`;
    const words = s.split(' ');
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > maxW - size * 1.6 && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
    const width = Math.min(
      maxW,
      Math.max(...lines.map((l) => ctx.measureText(l).width)) + size * 1.6,
    );
    const height = lines.length * size * 1.3 + size * 1.1;
    const x = side === 'me' ? this.w - 24 - width : 24;
    const lift = (1 - alpha) * 16;
    this.box(
      x,
      y + lift,
      width,
      height,
      size * 0.9,
      side === 'me' ? this.c.yellow : this.c.silver,
      alpha * (side === 'me' ? 1 : 0.14),
    );
    lines.forEach((l, i) =>
      this.text(l, x + size * 0.8, y + lift + size * 1.2 + i * size * 1.3, size, {
        color: side === 'me' ? this.c.grey : this.c.silver,
        alpha,
      }),
    );
    return height + size * 0.7;
  }
}

type Painter = (ui: Ui, t: number, x: ScreenText) => void;

// ---------------------------------------------------------------- phones (540 × 1080)

const brief: Painter = (ui, t, x) => {
  ui.bg();
  let y = ui.header(x.brand, x.w.brief ?? '') + 54;
  ui.text(x.w.goodMorning ?? '', 32, y, 44, { weight: 800 });
  y += 70;
  const icons = ['⭐', '🌧️', '🥯', '📄'];
  x.brief.forEach((line, i) => {
    const a = step(t, 0.08 + i * 0.16, 0.1);
    ui.box(24, y, ui.w - 48, 168, 26, ui.c.silver, 0.08 * a);
    ui.emoji(icons[i] ?? '•', 76, y + 84, 46, a);
    ui.para(line, 124, y + 52, ui.w - 168, 30, { alpha: a, weight: i === 0 ? 700 : 600 });
    y += 186;
  });
  ui.button(x.w.askAnything ?? '', 32, ui.h - 112, ui.w - 64, 84, step(t, 0.75));
};

const telegram: Painter = (ui, t, x) => {
  ui.bg();
  let y = ui.header(x.brand, x.w.telegram ?? '', 0.92) + 26;
  x.telegram.lines.forEach((line, i) => {
    y += ui.bubble(line, 'me', y, 28, step(t, 0.05 + i * 0.07, 0.06));
  });
  y += ui.bubble(x.telegram.ask, 'them', y, 28, step(t, 0.45, 0.06));
  const choose = step(t, 0.55, 0.05);
  if (choose > 0) {
    ui.box(24, y, 230, 64, 32, ui.c.yellow, choose);
    ui.text(x.telegram.yes, 139, y + 32, 26, {
      weight: 700,
      color: ui.c.grey,
      align: 'center',
      alpha: choose,
    });
    ui.box(270, y, 230, 64, 32, ui.c.silver, 0.14 * choose);
    ui.text(x.telegram.no, 385, y + 32, 26, { weight: 600, align: 'center', alpha: choose });
    y += 90;
  }
  y += ui.bubble(x.telegram.saved, 'them', y, 28, step(t, 0.68, 0.06));
  x.telegram.lasts.forEach((line, i) => {
    y += ui.bubble(line, 'them', y, 28, step(t, 0.8 + i * 0.07, 0.06));
  });
};

/** The guest's phone at the table, page by page: the menu with food facts, the member card, a game. */
const table: Painter = (ui, t, x) => {
  ui.bg();
  const top = ui.header(x.brand, x.w.table ?? '', 0.92);
  const menu = 1 - step(t, 0.4, 0.06);
  const card = step(t, 0.4, 0.06) * (1 - step(t, 0.7, 0.06));
  const game = step(t, 0.7, 0.06);
  if (menu > 0.01) {
    let y = top + 46;
    ui.text(x.w.menu ?? '', 28, y, 40, { weight: 800, alpha: menu });
    y += 46;
    const filter = step(t, 0.24, 0.08);
    x.table.dishes.forEach((d, i) => {
      const hidden = filter > 0 && i === 0; // the burger has beef: filtered out
      const a = (hidden ? 1 - filter * 0.75 : 1) * menu;
      ui.box(24, y, ui.w - 48, 150, 24, ui.c.silver, 0.08 * menu);
      ui.emoji(d.icon ?? '', 78, y + 75, 58, a);
      ui.text(d.name, 132, y + 50, 34, { weight: 700, alpha: a, max: 250 });
      ui.text(d.note ?? '', 132, y + 104, 25, { alpha: 0.8 * a, max: ui.w - 170 });
      ui.text(d.value ?? '', ui.w - 44, y + 50, 32, { weight: 800, align: 'right', alpha: a });
      y += 164;
    });
    y += 30;
    ui.text(x.w.dontEat ?? '', 28, y, 28, { alpha: 0.85 * menu, weight: 600 });
    const w1 = ui.chip(x.w.nuts ?? '', 230, y, 26, 'silver', menu);
    ui.chip(x.w.beef ?? '', 246 + w1, y, 26, filter > 0.5 ? 'yellow' : 'silver', menu);
  }
  if (card > 0.01) {
    let y = top + 60;
    // The member card, as on the customer's phone (ADR 0042).
    ui.box(28, y, ui.w - 56, 320, 32, ui.c.yellow, card);
    ui.logo(56, y + 34, 76, card);
    ui.text(x.brand, 150, y + 72, 38, { weight: 800, color: ui.c.grey, alpha: card });
    ui.para(x.table.points, 56, y + 190, ui.w - 120, 46, {
      weight: 800,
      color: ui.c.grey,
      alpha: card,
    });
    y += 370;
    const tick = step(t, 0.55, 0.05);
    ui.box(
      28,
      y,
      64,
      64,
      16,
      tick > 0.5 ? ui.c.yellow : ui.c.silver,
      (tick > 0.5 ? 1 : 0.25) * card,
    );
    if (tick > 0.5)
      ui.text('✓', 60, y + 33, 42, { weight: 800, color: ui.c.grey, align: 'center', alpha: card });
    ui.para(x.w.notifyMe ?? '', 112, y + 18, ui.w - 150, 32, { weight: 700, alpha: card });
  }
  if (game > 0.01) {
    let y = top + 80;
    ui.text(x.w.play ?? '', 32, y, 34, { weight: 600, alpha: 0.85 * game });
    y += 70;
    ui.box(24, y, ui.w - 48, 330, 30, ui.c.silver, 0.1 * game);
    ui.text(x.w.quiz ?? '', ui.w / 2, y + 90, 56, { weight: 800, align: 'center', alpha: game });
    ui.emoji('🍕 ☕ 🥐', ui.w / 2, y + 210, 64, game);
  }
};

/** The manager's phone: a big discount waits for one PIN, and the moment is recorded. */
const approval: Painter = (ui, t, x) => {
  ui.bg();
  let y = ui.header(x.brand, x.w.approval ?? '', 0.92) + 48;
  ui.text(x.w.approvalTitle ?? '', 32, y, 38, { weight: 800 });
  y += 44;
  ui.box(24, y, ui.w - 48, 220, 28, ui.c.silver, 0.1);
  ui.para(x.approval.ask, 48, y + 46, ui.w - 96, 30, { weight: 600 });
  ui.text(x.approval.pct, ui.w / 2, y + 160, 76, {
    weight: 800,
    align: 'center',
    color: ui.c.yellow,
  });
  y += 250;
  ui.text(x.w.approvalPin ?? '', ui.w / 2, y, 30, { weight: 700, align: 'center', alpha: 0.85 });
  y += 40;
  const typed = Math.floor(step(t, 0.15, 0.3) * 4);
  for (let i = 0; i < 4; i++) {
    ui.box(86 + i * 100, y, 68, 68, 34, i < typed ? ui.c.yellow : ui.c.silver, i < typed ? 1 : 0.2);
  }
  y += 112;
  const ok = step(t, 0.48, 0.06);
  ui.box(24, y, ui.w - 48, 76, 38, ui.c.yellow, ok);
  ui.text(x.w.approved ?? '', ui.w / 2, y + 38, 32, {
    weight: 800,
    align: 'center',
    color: ui.c.grey,
    alpha: ok,
  });
  y += 100;
  ui.para(x.approval.recorded, 32, y + 6, ui.w - 64, 26, { alpha: 0.85 * step(t, 0.58, 0.06) });
  y += 92;
  const so = step(t, 0.7, 0.08);
  ui.para(x.approval.soFar, 32, y, ui.w - 64, 30, { weight: 700, alpha: so });
  y += 84;
  ui.emoji('🔒', 50, y + 4, 34, so);
  ui.para(x.w.profitLocked ?? '', 84, y, ui.w - 120, 26, { alpha: so * 0.85 });
};

const offer: Painter = (ui, t, x) => {
  ui.bg();
  let y = ui.header(x.brand, x.w.suggests ?? '', 0.92) + 40;
  ui.box(24, y, ui.w - 48, 460, 30, ui.c.silver, 0.08);
  ui.emoji('📉', 72, y + 62, 46);
  ui.para(x.offer.quiet, 116, y + 46, ui.w - 160, 28, { weight: 600 });
  ui.para(x.offer.line, 48, y + 190, ui.w - 96, 44, { weight: 800 });
  ui.para(x.offer.sendTo, 48, y + 318, ui.w - 96, 27, { alpha: 0.85 });
  y += 490;
  const tap = step(t, 0.42, 0.06);
  ui.button(
    tap > 0.5 ? x.offer.sent : (x.w.approve ?? ''),
    24,
    y,
    ui.w - 48,
    88,
    0.45 + tap * 0.55,
  );
  y += 136;
  const more = step(t, 0.62, 0.08);
  ui.text(x.offer.regulars, 32, y, 28, { weight: 700, alpha: more });
  ui.para(x.w.deleted ?? '', 32, y + 58, ui.w - 64, 25, { alpha: 0.8 * step(t, 0.75, 0.08) });
};

/**
 * The guest's phone at 16:05: the offer notification and what it means, all there the moment the screen is
 * seen (the founder, 2026-11-18: no empty phone, plain words).
 */
const notify: Painter = (ui, t, x) => {
  ui.bg();
  ui.box(0, 0, ui.w, ui.h, 0, ui.c.silver, 0.04);
  ui.text('16:05', ui.w / 2, 120, 92, { weight: 300, align: 'center' });
  // The notification.
  let y = 210;
  ui.box(24, y, ui.w - 48, 230, 30, ui.c.silver, 0.18);
  ui.logo(46, y + 24, 56);
  ui.text(x.w.notifyTitle ?? '', 116, y + 52, 26, { weight: 700, alpha: 0.85 });
  ui.para(x.w.notifyHead ?? '', 48, y + 116, ui.w - 96, 30, { weight: 800 });
  ui.para(x.notify.body, 48, y + 168, ui.w - 96, 28, { weight: 600 });
  // What the offer is, opened from the notification.
  y += 260;
  ui.box(24, y, ui.w - 48, 330, 30, ui.c.silver, 0.1);
  ui.ring(24, y, ui.w - 48, 330, 30, ui.c.yellow, 3);
  ui.text(x.notify.pct, ui.w / 2, y + 86, 84, {
    weight: 800,
    align: 'center',
    color: ui.c.yellow,
  });
  ui.text(x.w.notifyWhat ?? '', ui.w / 2, y + 170, 30, { weight: 700, align: 'center' });
  ui.para(x.w.notifyHow ?? '', 52, y + 236, ui.w - 104, 26, { weight: 600, alpha: 0.9 });
  y += 360;
  ui.para(x.w.notifyWhy ?? '', 32, y, ui.w - 64, 23, { alpha: 0.8 });
  ui.para(x.w.notifyNoSms ?? '', 32, y + 66, ui.w - 64, 23, { alpha: 0.8 });
  // A soft pulse on the button once the moment has played a while: the guest is about to tap it.
  ui.button(x.w.notifyOpen ?? '', 24, ui.h - 112, ui.w - 48, 84, 0.75 + 0.25 * step(t, 0.5, 0.1));
};

const review: Painter = (ui, t, x) => {
  ui.bg();
  let y = ui.header(x.brand, x.w.table ?? '', 0.92) + 90;
  ui.text(x.w.howWasIt ?? '', ui.w / 2, y, 40, { weight: 800, align: 'center' });
  y += 120;
  const stars = Math.round(step(t, 0.1, 0.3) * 5);
  for (let i = 0; i < 5; i++) ui.emoji(i < stars ? '⭐' : '☆', 110 + i * 80, y, 68);
  y += 140;
  ui.para(x.w.thanks ?? '', 40, y, ui.w - 80, 32, { alpha: step(t, 0.45, 0.08), weight: 600 });
  y += 110;
  ui.button(x.w.openGoogle ?? '', 32, y, ui.w - 64, 88, step(t, 0.6, 0.08));
};

const complaint: Painter = (ui, t, x) => {
  ui.bg();
  let y = ui.header(x.brand, x.w.complaint ?? '', 0.92) + 36;
  ui.box(24, y, ui.w - 48, 120, 24, ui.c.silver, 0.1);
  ui.text(`“${x.w.complaintText ?? ''}”`, 48, y + 60, 32, { weight: 700, max: ui.w - 96 });
  y += 150;
  const rows: [string, string][] = [
    [x.w.why ?? '', x.w.whyText ?? ''],
    [x.w.gave ?? '', x.w.gaveText ?? ''],
    [x.w.fixed ?? '', x.w.fixedText ?? ''],
  ];
  rows.forEach(([k, v], i) => {
    const a = step(t, 0.15 + i * 0.17, 0.08);
    ui.text(k, 32, y + 20, 25, { alpha: 0.75 * a, weight: 600 });
    ui.para(v, 32, y + 62, ui.w - 64, 30, { alpha: a, weight: 700 });
    y += 160;
  });
  ui.button(x.w.closed ?? '', 32, y + 6, ui.w - 64, 84, step(t, 0.72, 0.08));
};

/** The owner asks Xedine in plain words, like ChatGPT, and the answer comes from the café's own numbers. */
const ask: Painter = (ui, t, x) => {
  ui.bg();
  let y = ui.header(x.brand, x.w.askTitle ?? '', 0.92) + 40;
  y += ui.bubble(x.ask.q, 'me', y, 32, step(t, 0.12, 0.08));
  const thinking = step(t, 0.25, 0.05) * (1 - step(t, 0.4, 0.05));
  if (thinking > 0) ui.text('• • •', 52, y + 30, 40, { weight: 800, alpha: thinking });
  ui.bubble(x.ask.a, 'them', y, 31, step(t, 0.4, 0.08));
  ui.box(24, ui.h - 120, ui.w - 48, 88, 44, ui.c.silver, 0.12);
  ui.text(x.ask.placeholder, 56, ui.h - 76, 27, { alpha: 0.7, max: ui.w - 190 });
  ui.box(ui.w - 120, ui.h - 112, 72, 72, 36, ui.c.yellow);
  ui.text('↑', ui.w - 84, ui.h - 76, 40, { weight: 800, color: ui.c.grey, align: 'center' });
};

// ---------------------------------------------------------------- wall screens and tablets

function barsBoard(ui: Ui, x: ScreenText, title: string, bars: Bar[], t: number, warnAt?: number) {
  ui.bg();
  let y = ui.header(x.brand, title) + 40;
  const move = step(t, 0.05, 0.55);
  bars.forEach((b, i) => {
    const v = b.from + (b.to - b.from) * move;
    ui.text(b.name, 40, y + 22, 32, { weight: 700, max: 270 });
    ui.bar(320, y + 6, ui.w - 680, 32, v, warnAt !== undefined && i === warnAt && move > 0.5);
    ui.text(b.label, ui.w - 330, y + 22, 28, { weight: 700 });
    if (b.note) ui.chip(b.note, ui.w - 200, y + 22, 21, 'silver', step(t, 0.55, 0.1));
    y += 84;
  });
  return y;
}

const stockUp: Painter = (ui, t, x) => {
  const y = barsBoard(ui, x, x.w.stock ?? '', x.stockUp, t);
  ui.chip(x.w.bought ?? '', 40, y + 20, 24, 'silver');
  ui.chip(x.w.guardOk ?? '', 40, y + 84, 26, 'yellow', step(t, 0.7, 0.1));
};

const stockDown: Painter = (ui, t, x) => {
  const y = barsBoard(ui, x, x.w.used ?? '', x.stockDown.bars, t, 2);
  ui.chip(x.stockDown.loss, 40, y + 16, 25, 'yellow', step(t, 0.45, 0.08));
  ui.chip(x.stockDown.waste, 40, y + 80, 23, 'silver', step(t, 0.6, 0.08));
  ui.text(x.stockDown.left, 40, y + 140, 26, { alpha: step(t, 0.78, 0.08), weight: 700 });
};

/** Food safety: every lot dated (left); today's checks and the licence reminder (right). */
const safety: Painter = (ui, t, x) => {
  ui.bg();
  const top = ui.header(x.brand, x.w.foodSafety ?? '') + 22;
  const lw = 560;
  let y = top;
  x.safety.lots.forEach((lot, i) => {
    const a = step(t, 0.05 + i * 0.1, 0.08);
    ui.box(
      22,
      y,
      lw,
      90,
      18,
      lot.tone === 'warn' ? ui.c.yellow : ui.c.silver,
      (lot.tone === 'warn' ? 0.95 : 0.08) * a,
    );
    const color = lot.tone === 'warn' ? ui.c.grey : ui.c.silver;
    ui.text(lot.name, 42, y + 30, 29, { weight: 800, color, alpha: a, max: lw - 40 });
    ui.text(lot.value ?? '', 42, y + 66, 23, { color, alpha: a, weight: 600, max: lw - 40 });
    y += 100;
  });
  const cx = lw + 46;
  const cw = ui.w - cx - 22;
  let cy = top;
  ui.box(cx - 10, cy, cw + 10, 300, 22, ui.c.silver, 0.06);
  ui.text(x.w.checks ?? '', cx + 10, cy + 36, 28, { weight: 800, max: cw - 20 });
  cy += 80;
  x.safety.checks.forEach((c, i) => {
    const a = step(t, 0.45 + i * 0.08, 0.06);
    ui.text(c.tone === 'ok' ? '✓' : '!', cx + 18, cy, 30, {
      weight: 800,
      alpha: a,
      color: c.tone === 'ok' ? ui.c.silver : ui.c.yellow,
    });
    ui.para(c.name, cx + 52, cy, cw - 70, 24, { alpha: a, weight: 600 });
    cy += 70;
  });
  const lic = step(t, 0.75, 0.08);
  ui.box(cx - 10, top + 320, cw + 10, 150, 22, ui.c.yellow, lic);
  ui.emoji('📄', cx + 34, top + 395, 40, lic);
  ui.para(x.safety.licence, cx + 66, top + 370, cw - 80, 26, {
    weight: 800,
    color: ui.c.grey,
    alpha: lic,
  });
};

/** Attendance: each name lights up as its person taps in at the back door. */
const staff: Painter = (ui, t, x) => {
  ui.bg();
  let y = ui.header(x.brand, x.w.team ?? '', 0.9) + 22;
  const marked = Math.floor(step(t, 0.05, 0.6) * x.staff.rows.length + 0.001);
  x.staff.rows.forEach((r, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const px = 22 + col * (ui.w / 2 - 8);
    const py = y + row * 74;
    const on = i < marked && r.tone === 'ok';
    ui.box(px, py, ui.w / 2 - 36, 62, 31, on ? ui.c.yellow : ui.c.silver, on ? 1 : 0.12);
    ui.text(`${on ? '✓ ' : ''}${r.name}`, px + 24, py + 31, 32, {
      weight: 800,
      color: on ? ui.c.grey : ui.c.silver,
      alpha: r.tone === 'off' ? 0.55 : 1,
    });
  });
  y += Math.ceil(x.staff.rows.length / 2) * 74 + 10;
  ui.text(x.staff.present, 28, y + 14, 32, { weight: 800, alpha: step(t, 0.65, 0.08) });
  ui.text(`🔒 ${x.w.privateNote ?? ''}`, 28, y + 60, 23, {
    alpha: 0.8 * step(t, 0.8, 0.08),
    max: ui.w - 56,
  });
};

/** Tomorrow: the week's weather, the dishes that will likely sell best, the bazar list (no dish count). */
const plan: Painter = (ui, t, x) => {
  ui.bg();
  let y = ui.header(x.brand, x.w.plan ?? '') + 22;
  const dw = (ui.w - 48) / 7;
  x.plan.days.forEach((d, i) => {
    const px = 24 + i * dw;
    ui.box(px + 4, y, dw - 8, 150, 20, i === 1 ? ui.c.yellow : ui.c.silver, i === 1 ? 0.95 : 0.08);
    const color = i === 1 ? ui.c.grey : ui.c.silver;
    ui.text(d.label, px + dw / 2, y + 28, 26, { weight: 800, align: 'center', color });
    ui.emoji(d.icon, px + dw / 2, y + 80, 42);
    ui.text(d.holiday ? (x.w.holiday ?? '') : (d.mm ?? ''), px + dw / 2, y + 126, 21, {
      align: 'center',
      color,
      alpha: 0.9,
      weight: 600,
    });
  });
  y += 186;
  const best = step(t, 0.1, 0.1);
  ui.text(x.w.tomorrowBest ?? '', 40, y, 34, { weight: 800, alpha: best });
  let cx = 40;
  x.plan.best.forEach((d, i) => {
    const a = step(t, 0.14 + i * 0.06, 0.08);
    cx +=
      ui.chip(`${d.icon ?? ''} ${d.name}`, cx, y + 60, 30, i === 0 ? 'yellow' : 'silver', a) + 14;
  });
  ui.chip(x.w.rainMoves ?? '', 40, y + 128, 24, 'silver', step(t, 0.3, 0.1));
  y += 186;
  ui.text(x.w.buyList ?? '', 40, y, 28, { weight: 800, alpha: step(t, 0.45, 0.1) });
  y += 30;
  x.plan.buy.forEach((r, i) => {
    const a = step(t, 0.5 + i * 0.06, 0.06);
    const col = i % 3;
    const row = Math.floor(i / 3);
    const cw = (ui.w - 80) / 3;
    const px = 40 + col * cw;
    ui.box(px, y + row * 66, cw - 16, 56, 16, ui.c.silver, 0.12 * a);
    ui.text(r.name, px + 16, y + row * 66 + 28, 25, { alpha: a, weight: 600, max: cw - 140 });
    ui.text(r.value ?? '', px + cw - 32, y + row * 66 + 28, 25, {
      weight: 800,
      align: 'right',
      alpha: a,
    });
  });
  ui.button(x.w.sendList ?? '', ui.w - 400, ui.h - 84, 360, 64, step(t, 0.85, 0.08));
};

/**
 * The kitchen screen: each ticket says which table, what to cook and how long it has waited; the oldest is
 * first, a late one turns yellow, the new order slides in, and one tap marks a ticket ready.
 */
const kds: Painter = (ui, t, x) => {
  ui.bg();
  ui.header(x.brand, x.kds.signedIn);
  const arrive = step(t, 0.12, 0.08);
  const ready = step(t, 0.5, 0.06);
  const gone = step(t, 0.68, 0.08);
  // The late takeaway (second ticket) is cooked first: Ready, then it leaves the screen.
  const [first, late, ...rest] = x.kds.tickets;
  const tickets: { tk: (typeof x.kds.tickets)[number]; isNew: boolean; isLate: boolean }[] = [];
  if (first) tickets.push({ tk: first, isNew: false, isLate: false });
  if (late && gone < 0.99) tickets.push({ tk: late, isNew: false, isLate: true });
  for (const tk of rest) tickets.push({ tk, isNew: false, isLate: false });
  if (arrive > 0) tickets.push({ tk: x.kds.next, isNew: true, isLate: false });
  const cw = (ui.w - 60) / 4;
  tickets.slice(0, 4).forEach(({ tk, isNew, isLate }, i) => {
    const px = 20 + i * (cw + 7);
    const a = (isNew ? arrive : 1) * (isLate ? 1 - gone : 1);
    const warn = tk.mins >= 10 && !(isLate && ready > 0.5);
    ui.box(
      px,
      108 + (1 - a) * 30,
      cw,
      ui.h - 128,
      22,
      warn ? ui.c.yellow : ui.c.silver,
      (warn ? 0.95 : 0.1) * a,
    );
    const color = warn ? ui.c.grey : ui.c.silver;
    ui.text(tk.where, px + 20, 150, 34, { weight: 800, color, alpha: a, max: cw - 40 });
    ui.text(`⏱ ${tk.wait}`, px + 20, 196, 26, {
      weight: 600,
      color,
      alpha: 0.9 * a,
    });
    if (isNew) ui.chip(x.w.newTicket ?? '', px + cw - 116, 150, 22, 'yellow', a);
    if (warn) ui.chip(x.w.late ?? '', px + cw - 120, 196, 21, 'silver', a);
    tk.lines.forEach((l, j) =>
      ui.text(l, px + 20, 258 + j * 46, 30, { weight: 700, color, alpha: a, max: cw - 36 }),
    );
    if (isLate)
      ui.button(
        ready > 0.5 ? (x.w.readyDone ?? '') : (x.w.ready ?? ''),
        px + 16,
        ui.h - 108,
        cw - 32,
        68,
        0.4 + 0.6 * ready,
      );
  });
};

const scale: Painter = (ui, t, x) => {
  ui.ctx.fillStyle = 'black';
  ui.ctx.fillRect(0, 0, ui.w, ui.h);
  const a = step(t, 0.1, 0.15);
  ui.text(a > 0.5 ? x.scale.grams : '0 g', ui.w / 2 - 20, ui.h / 2, 76, {
    weight: 800,
    align: 'center',
    color: a > 0.5 ? ui.c.yellow : ui.c.silver,
  });
};

const poster: Painter = (ui, t, x) => {
  const { ctx, w, h } = ui;
  const stage = t < 0.25 ? 0 : t < 0.5 ? 1 : 2;
  // The real photo (stage 0), cut out (1), on a designed poster (2).
  ctx.fillStyle = stage === 2 ? ui.c.yellow : ui.c.grey;
  if (stage === 0) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgb(122, 94, 70)');
    g.addColorStop(1, 'rgb(64, 46, 34)');
    ctx.fillStyle = g;
  }
  ctx.fillRect(0, 0, w, h);
  if (stage === 2) {
    ui.box(-60, h * 0.5, w + 120, h * 0.62, 200, ui.c.grey, 0.92);
  }
  if (stage === 1) {
    ctx.beginPath();
    ctx.arc(w / 2, h * 0.5, w * 0.36, 0, Math.PI * 2);
    ctx.strokeStyle = ui.c.silver;
    ctx.lineWidth = 10;
    ctx.setLineDash([24, 16]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ui.emoji('☕', w / 2, h * (stage === 2 ? 0.4 : 0.5), w * 0.46);
  if (stage === 0) ui.chip(x.w.poster ?? '', 30, 60, 28, 'yellow');
  if (stage === 1)
    ui.text(x.w.posterCut ?? '', w / 2, h - 90, 30, { weight: 700, align: 'center', max: w - 40 });
  if (stage === 2) {
    ui.para(x.w.posterHead ?? '', 40, 86, w - 80, 58, { weight: 800, color: ui.c.grey });
    ui.text(x.poster.price, w / 2, h * 0.66, 66, { weight: 800, align: 'center' });
    ui.text(x.brand, w / 2, h * 0.745, 34, { weight: 800, align: 'center', alpha: 0.85 });
    // Posted by itself to the three networks: their logos, so nobody has to guess where.
    const posted = step(t, 0.78, 0.06);
    if (posted > 0) {
      const top = h - 186;
      ui.box(24, top, w - 48, 166, 30, ui.c.silver, 0.97 * posted);
      ui.text(x.w.posted ?? '', 52, top + 40, 34, { weight: 800, color: ui.c.grey, alpha: posted });
      ui.text(`▶ ${x.w.video ?? ''}`, w - 52, top + 40, 26, {
        weight: 700,
        color: ui.c.grey,
        align: 'right',
        alpha: posted,
      });
      NETWORKS.forEach((src, i) => ui.image(src, 52 + i * 92, top + 78, 72, 72, posted));
    }
  }
};

/** The till: the order, the member card and the code, the tax, the order to the kitchen, then checkout. */
const till: Painter = (ui, t, x) => {
  ui.bg();
  const W = ui.w;
  for (let i = 0; i < 4; i++)
    ui.box(22 + i * 132, 14, 118, 36, 18, i === 0 ? ui.c.yellow : ui.c.silver, i === 0 ? 1 : 0.12);
  const shown = t < 0.06 ? 0 : Math.min(x.till.lines.length, Math.floor((t - 0.06) / 0.07) + 1);
  x.till.tiles.forEach((tile, i) => {
    const px = 22 + (i % 2) * 290;
    const py = 70 + Math.floor(i / 2) * 290;
    ui.box(px, py, 272, 272, 26, ui.c.silver, 0.08);
    if (i === shown - 1 && t < 0.28) ui.ring(px, py, 272, 272, 26, ui.c.yellow, 8);
    ui.emoji(tile.icon, px + 136, py + 112, 112);
    ui.text(tile.name, px + 136, py + 222, 34, { weight: 700, align: 'center', max: 250 });
  });
  ui.box(608, 62, 400, 588, 28, ui.c.silver, 0.07);
  ui.text(x.w.newOrder ?? '', 632, 98, 30, { weight: 800 });
  let y = 140;
  x.till.lines.slice(0, shown).forEach((l) => {
    ui.text(`${l.icon ?? ''} ${l.name}`, 632, y, 26, { weight: 600 });
    ui.text(l.value ?? '', 984, y, 26, { align: 'right', weight: 600 });
    y += 38;
  });
  const member = step(t, 0.28, 0.05);
  if (member > 0) ui.text(x.till.member, 632, y + 2, 21, { alpha: member, weight: 600, max: 352 });
  y += 36;
  const code = step(t, 0.36, 0.05);
  if (code > 0) {
    ui.text(x.till.code, 632, y, 22, { alpha: code });
    ui.text(x.till.discount, 984, y, 22, { align: 'right', alpha: code });
  }
  y += 34;
  const tax = step(t, 0.42, 0.05);
  if (tax > 0) {
    ui.text(x.till.taxName, 632, y, 22, { alpha: tax });
    ui.text(x.till.tax, 984, y, 22, { align: 'right', alpha: tax });
    ui.box(632, y + 20, 352, 3, 1, ui.c.silver, 0.3 * tax);
    ui.text(x.w.total ?? '', 632, y + 50, 32, { weight: 800, alpha: tax });
    ui.text(x.till.total, 984, y + 50, 32, { weight: 800, align: 'right', alpha: tax });
  }
  // Checkout above, the kitchen below: the order goes to the kitchen, then the guest pays (ADR 0064).
  const sent = t > 0.5;
  const checkout = step(t, 0.56, 0.05);
  const paid = t > 0.72;
  if (checkout > 0) {
    ui.button(
      paid ? (x.w.paid ?? '') : `${x.w.checkout ?? ''} · ${x.till.total}`,
      632,
      484,
      352,
      62,
      0.45 + 0.55 * step(t, 0.62, 0.04),
    );
    const split = step(t, 0.66, 0.05);
    if (split > 0) {
      ui.text(`${x.w.cash ?? ''} ${x.till.cash}`, 632, 562, 21, { alpha: split, weight: 600 });
      ui.text(`${x.w.card ?? ''} ${x.till.card}`, 984, 562, 21, {
        align: 'right',
        alpha: split,
        weight: 600,
      });
    }
  }
  ui.button(
    sent ? `✓ ${x.w.sent ?? ''}` : (x.w.placeOrder ?? ''),
    632,
    580,
    352,
    56,
    step(t, 0.46, 0.05),
  );
  const offline = step(t, 0.62, 0.05) * (1 - step(t, 0.9, 0.05));
  if (offline > 0) ui.chip(`📶 ${x.w.offline ?? ''}`, 24, ui.h - 30, 20, 'yellow', offline);
  if (t > 0.86) ui.chip(x.w.quickOrder ?? '', 24, ui.h - 30, 18, 'silver', step(t, 0.88, 0.05));
  if (paid)
    ui.text(x.till.points, W - 34, 98, 24, {
      weight: 800,
      align: 'right',
      color: ui.c.yellow,
      alpha: step(t, 0.74, 0.05),
    });
};

const closing: Painter = (ui, t, x) => {
  ui.bg();
  let y = 50;
  ui.text(x.w.closeDay ?? '', 30, y, 36, { weight: 800 });
  y += 58;
  const rows: [string, string, boolean][] = [
    [x.w.expected ?? '', x.closing.expected, false],
    [x.w.counted ?? '', x.closing.counted, false],
    [x.w.short ?? '', x.closing.short, true],
  ];
  rows.forEach(([k, v, warn], i) => {
    const a = step(t, 0.05 + i * 0.12, 0.08);
    ui.box(24, y, 480, 66, 18, warn ? ui.c.yellow : ui.c.silver, (warn ? 0.95 : 0.08) * a);
    const color = warn ? ui.c.grey : ui.c.silver;
    ui.text(k, 44, y + 33, 26, { color, alpha: a, weight: 600, max: 260 });
    ui.text(v, 484, y + 33, 28, { weight: 800, align: 'right', color, alpha: a });
    y += 78;
  });
  ui.text(x.closing.sales, 30, y + 38, 44, { weight: 800, alpha: step(t, 0.4, 0.08) });
  ui.text(x.closing.bills, 30, y + 90, 24, { alpha: 0.8 * step(t, 0.42, 0.08), weight: 600 });
  ui.text(x.w.best ?? '', 540, 50, 26, { weight: 800 });
  x.closing.best.forEach((b, i) => {
    const a = step(t, 0.45 + i * 0.06, 0.06);
    ui.emoji(b.icon ?? '', 562, 102 + i * 56, 36, a);
    ui.text(b.name, 604, 102 + i * 56, 26, { alpha: a, weight: 600 });
    ui.text(b.value ?? '', 990, 102 + i * 56, 26, { weight: 800, align: 'right', alpha: a });
  });
  const max = Math.max(...x.closing.hours);
  const grow = step(t, 0.55, 0.2);
  const bw = 440 / x.closing.hours.length;
  x.closing.hours.forEach((v, i) => {
    const bh = (v / max) * 180 * grow;
    ui.box(
      540 + i * bw,
      480 - bh,
      bw - 6,
      bh,
      6,
      i >= 5 && i <= 7 ? ui.c.yellow : ui.c.silver,
      i >= 5 && i <= 7 ? 1 : 0.5,
    );
  });
  ui.chip(x.closing.lunch, 540, 540, 21, 'silver', step(t, 0.8, 0.08));
};

/** Where the money leaked: each leak with its proof and what to do; the true profit, for the owner only. */
const leaksScreen: Painter = (ui, t, x) => {
  ui.bg();
  let y = ui.header(x.brand, x.w.leaks ?? '') + 20;
  const lw = ui.w * 0.58;
  x.leaks.rows.forEach((r, i) => {
    const a = step(t, 0.05 + i * 0.12, 0.08);
    ui.box(24, y, lw, 140, 22, ui.c.silver, 0.09 * a);
    ui.text(r.name, 46, y + 34, 30, { weight: 800, alpha: a, max: lw - 200 });
    ui.text(r.value ?? '', lw, y + 34, 32, {
      weight: 800,
      align: 'right',
      color: ui.c.yellow,
      alpha: a,
    });
    ui.text(r.note ?? '', 46, y + 78, 23, { alpha: 0.8 * a, max: lw - 50 });
    ui.text(`→ ${r.icon ?? ''}`, 46, y + 114, 23, { weight: 700, alpha: a, max: lw - 50 });
    y += 154;
  });
  ui.text(x.leaks.total, 46, y + 22, 32, { weight: 800, alpha: step(t, 0.42, 0.08) });
  const px = ui.w * 0.64;
  let py = 116;
  const p = step(t, 0.5, 0.1);
  ui.box(px, py - 20, ui.w - px - 24, 470, 26, ui.c.silver, 0.09 * p);
  ui.text(x.w.trueProfit ?? '', px + 24, py + 18, 28, { weight: 800, alpha: p });
  py += 64;
  x.leaks.profit.forEach((r) => {
    ui.text(r.name, px + 24, py, 22, { alpha: 0.85 * p, weight: 600, max: 220 });
    ui.text(r.value ?? '', ui.w - 48, py, 24, { weight: 800, align: 'right', alpha: p });
    py += 50;
  });
  ui.box(px + 24, py, ui.w - px - 72, 3, 1, ui.c.silver, 0.3 * p);
  ui.text(x.leaks.profitTotal, ui.w - 48, py + 48, 44, {
    weight: 800,
    align: 'right',
    color: ui.c.yellow,
    alpha: p,
  });
  ui.chip(`🔒 ${x.w.ownerOnly ?? ''}`, px + 24, py + 118, 21, 'silver', p);
  ui.chip(x.leaks.star, px + 24, py + 178, 22, 'yellow', step(t, 0.7, 0.08));
};

const idle: Painter = (ui, _t, x) => {
  ui.bg();
  ui.header(x.brand, x.w.home ?? '');
  const s = Math.min(ui.w, ui.h) * 0.36;
  ui.logo(ui.w / 2 - s / 2, ui.h / 2 + 46 - s / 2, s, 0.95);
};

const PAINTERS: Record<Show, Painter> = {
  brief,
  telegram,
  stockUp,
  safety,
  staff,
  plan,
  table,
  till,
  approval,
  kds,
  scale,
  stockDown,
  poster,
  offer,
  notify,
  review,
  complaint,
  closing,
  leaks: leaksScreen,
  ask,
  idle,
};

/** A canvas texture that redraws only when what it shows, or its moment, changes. */
export function createScreen(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  // glTF's convention (UV 0,0 at the image's top-left), like every model file's UVs: see planeUv.
  texture.flipY = false;
  const colors = brand();
  const font = getComputedStyle(document.body).fontFamily || 'sans-serif';
  const ui = ctx ? new Ui(ctx, colors, font) : null;
  let last = '';
  return {
    texture,
    paint(show: Show, t: number, text: ScreenText, force = false) {
      if (!ui) return;
      const key = `${show}:${Math.round(clamp01(t) * 60)}:${picturesLoaded}`;
      if (key === last && !force) return;
      last = key;
      PAINTERS[show](ui, clamp01(t), text);
      texture.needsUpdate = true;
    },
    dispose() {
      texture.dispose();
    },
  };
}

/** Pixel size of each fixed screen's canvas (its shape matches the plane in world.py). */
export const SCREEN_SIZES: Record<string, [number, number]> = {
  till: [1024, 656],
  kds: [1120, 640],
  safety: [960, 640],
  stock: [1280, 740],
  staff: [900, 600],
  office: [1240, 720],
  poster: [600, 864],
  scale: [400, 120],
  phone: [540, 1080],
};

/**
 * Blender's exporter drops the UVs of a surface whose material has no image, so a live screen arrives with
 * none: give a flat quad 0..1 UVs, upright as its viewer sees it (from its normal, world up), in glTF's
 * convention (v grows downward) so it matches the screens that kept theirs.
 */
export function planeUv(mesh: THREE.Mesh) {
  const g = mesh.geometry;
  if (g.getAttribute('uv')) return;
  mesh.updateWorldMatrix(true, false);
  const pos = g.getAttribute('position');
  const nrm = g.getAttribute('normal');
  if (!pos || !nrm) return;
  const normal = new THREE.Vector3(nrm.getX(0), nrm.getY(0), nrm.getZ(0))
    .applyMatrix3(new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld))
    .normalize();
  const up = Math.abs(normal.y) > 0.9 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(up, normal).normalize();
  const trueUp = new THREE.Vector3().crossVectors(normal, right).normalize();
  const p = new THREE.Vector3();
  const us: number[] = [];
  const vs: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    us.push(p.dot(right));
    vs.push(p.dot(trueUp));
  }
  const [u0, u1, v0, v1] = [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)];
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (us[i]! - u0) / Math.max(1e-6, u1 - u0);
    uv[i * 2 + 1] = 1 - (vs[i]! - v0) / Math.max(1e-6, v1 - v0);
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
