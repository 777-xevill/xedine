import * as THREE from 'three';
import type { DemoDish } from './story-ledger';

export type TillWords = {
  newOrder: string;
  total: string;
  placeOrder: string;
  sent: string;
  dishes: Record<DemoDish, string>;
};

export type TillLine = { dish: DemoDish; price: string };

const ICON: Record<DemoDish, string> = {
  burger: '🍔',
  latte: '☕',
  croissant: '🥐',
  pizza: '🍕',
  fries: '🍟',
};
const TILES: DemoDish[] = ['burger', 'latte', 'croissant', 'pizza'];
const LOOP = 9; // seconds: tap three dishes, the total, place the order, "sent to the kitchen", start again

/** The brand's three colours, read from the page's CSS variables (never written here, ADR 0063). */
function brand() {
  const css = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    grey: read('--brand-grey', 'black'),
    silver: read('--brand-silver', 'silver'),
    yellow: read('--brand-yellow', 'gold'),
  };
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/**
 * The till's screen in the 3D café, drawn live on a canvas: the cashier taps the dishes, the order fills in,
 * the total appears, "Place order" sends it to the kitchen. The same three colours as the real till.
 */
export function createTillScreen(words: TillWords, order: TillLine[], total: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 656;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const c = brand();
  // The page's own font (next/font gives it a generated family name), so the till reads like the app.
  const font = getComputedStyle(document.body).fontFamily || 'sans-serif';
  let lastStep = -1;

  const draw = (t: number) => {
    if (!ctx) return;
    const time = t % LOOP;
    const shown = time < 1 ? 0 : Math.min(order.length, Math.floor((time - 1) / 1.2) + 1);
    const placed = time > 5.8;
    const step = shown * 10 + (placed ? 1 : 0) + (time > 4.6 ? 2 : 0);
    // Redraw only when something changes, plus the tap flash.
    const flashing = shown > 0 && (time - 1) % 1.2 < 0.35 && shown <= order.length && time < 4.6;
    if (step === lastStep && !flashing) return;
    lastStep = flashing ? -1 : step;

    const W = canvas.width;
    const H = canvas.height;
    ctx.fillStyle = c.grey;
    ctx.fillRect(0, 0, W, H);
    // Top bar with category pills.
    ctx.globalAlpha = 0.06;
    ctx.fillStyle = c.silver;
    ctx.fillRect(0, 0, W, 64);
    ctx.globalAlpha = 1;
    for (let i = 0; i < 4; i++) {
      roundRect(ctx, 22 + i * 132, 14, 118, 36, 18);
      ctx.fillStyle = i === 0 ? c.yellow : c.silver;
      ctx.globalAlpha = i === 0 ? 1 : 0.12;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // Dish tiles.
    const tapped = flashing ? order[shown - 1]?.dish : undefined;
    TILES.forEach((dish, i) => {
      const x = 22 + (i % 2) * 290;
      const y = 84 + Math.floor(i / 2) * 280;
      roundRect(ctx, x, y, 272, 262, 26);
      ctx.fillStyle = c.silver;
      ctx.globalAlpha = 0.08;
      ctx.fill();
      ctx.globalAlpha = 1;
      if (dish === tapped) {
        ctx.lineWidth = 8;
        ctx.strokeStyle = c.yellow;
        ctx.stroke();
      }
      ctx.font = '112px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ICON[dish], x + 136, y + 108);
      ctx.font = `600 34px ${font}`;
      ctx.fillStyle = c.silver;
      ctx.fillText(words.dishes[dish], x + 136, y + 214);
    });
    // The order panel.
    roundRect(ctx, 620, 84, 382, 550, 28);
    ctx.fillStyle = c.silver;
    ctx.globalAlpha = 0.07;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = c.silver;
    ctx.font = `700 38px ${font}`;
    ctx.fillText(words.newOrder, 648, 140);
    order.slice(0, shown).forEach((line, i) => {
      const y = 214 + i * 64;
      ctx.font = `500 32px ${font}`;
      ctx.fillStyle = c.silver;
      ctx.textAlign = 'left';
      ctx.fillText(`${ICON[line.dish]} ${words.dishes[line.dish]}`, 648, y);
      ctx.textAlign = 'right';
      ctx.fillText(line.price, 976, y);
    });
    if (time > 4.6) {
      ctx.globalAlpha = 0.25;
      ctx.fillRect(648, 430, 328, 3);
      ctx.globalAlpha = 1;
      ctx.textAlign = 'left';
      ctx.font = `700 36px ${font}`;
      ctx.fillText(words.total, 648, 484);
      ctx.textAlign = 'right';
      ctx.fillText(total, 976, 484);
    }
    // The button: yellow, then "sent to the kitchen".
    roundRect(ctx, 648, 530, 328, 80, 40);
    ctx.fillStyle = c.yellow;
    ctx.globalAlpha = time > 4.6 ? 1 : 0.35;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = c.grey;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 32px ${font}`;
    ctx.fillText(placed ? `✓ ${words.sent}` : words.placeOrder, 812, 571);
    texture.needsUpdate = true;
  };

  draw(0);
  return { texture, update: draw };
}
