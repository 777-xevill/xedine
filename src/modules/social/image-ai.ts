import 'server-only';

/**
 * The AI-improved dish picture for a post (ADR 0040): Cloudflare Workers AI, FLUX.2 [klein] 4B, which
 * takes the restaurant's real dish photo as a reference and returns a studio-lit version on a plain
 * background in the brand colour. Free tier: 10,000 neurons a day, ~160 per 1024×1280 picture.
 *
 * The model never draws words: the headline, Bangla text and logo are laid on top by the poster renderer,
 * because image models garble text. Off (returns null) when CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_AI_TOKEN
 * are not set; the poster then uses the original photo.
 */
const MODEL = '@cf/black-forest-labs/flux-2-klein-4b';

export function imageAiConfigured(): boolean {
  return Boolean(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_AI_TOKEN);
}

/** A plain colour name the model understands better than a hex code. */
export function describeColour(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const light = (max + min) / 510;
  if (max - min < 24) return light > 0.8 ? 'white' : light < 0.2 ? 'charcoal black' : 'grey';
  let hue = 0;
  if (max === r) hue = ((g - b) / (max - min)) * 60;
  else if (max === g) hue = (2 + (b - r) / (max - min)) * 60;
  else hue = (4 + (r - g) / (max - min)) * 60;
  if (hue < 0) hue += 360;
  const name =
    hue < 15 || hue >= 340
      ? 'red'
      : hue < 40
        ? 'orange'
        : hue < 65
          ? 'yellow'
          : hue < 160
            ? 'green'
            : hue < 200
              ? 'teal'
              : hue < 255
                ? 'blue'
                : hue < 290
                  ? 'purple'
                  : 'pink';
  return `${light < 0.3 ? 'deep ' : light > 0.7 ? 'light ' : ''}${name}`;
}

export function dishPrompt(dish: string, colour: string): string {
  return [
    `Professional food advertising photograph of the dish in image 0 (${dish}).`,
    'Keep the same food, the same portion and the same plate or bowl; make it look freshly served,',
    'glossy and appetising, with soft studio light, gentle steam and a few fresh garnish leaves around.',
    `The plate sits in the centre on a smooth, plain, solid ${describeColour(colour)} background with a`,
    'soft shadow under it. Shot from a 45 degree angle. Lots of empty background above the plate.',
    'No text, no letters, no logo, no watermark, no hands, no people.',
  ].join(' ');
}

/**
 * Returns JPEG/PNG bytes, or null when not configured. `reference` must be smaller than 512×512
 * (the renderer shrinks the photo first).
 */
export async function improveDishPhoto(args: {
  reference: Uint8Array;
  dish: string;
  colour: string;
  seed: number;
  fetchImpl?: typeof fetch;
}): Promise<Uint8Array | null> {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_AI_TOKEN;
  if (!account || !token) return null;
  const form = new FormData();
  form.append('prompt', dishPrompt(args.dish, args.colour));
  form.append(
    'input_image_0',
    new Blob([new Uint8Array(args.reference)], { type: 'image/jpeg' }),
    'dish.jpg',
  );
  form.append('width', '1024');
  form.append('height', '1280');
  form.append('seed', String(args.seed));
  const res = await (args.fetchImpl ?? fetch)(
    `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${MODEL}`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form },
  );
  if (!res.ok) throw new Error(`image_ai_${res.status}`);
  const json = (await res.json()) as { result?: { image?: string }; success?: boolean };
  const b64 = json.result?.image;
  if (!b64) throw new Error('image_ai_empty');
  return new Uint8Array(Buffer.from(b64, 'base64'));
}
