import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import bn from '@/messages/bn.json';
import en from '@/messages/en.json';
import { FEATURES } from './features';
import { BEATS } from './story';

const ROOT = join(__dirname, '..', '..', '..');
const day = { en: en.landing3d.day, bn: bn.landing3d.day };

describe('every feature, A to Z, in the 3D day (ADR 0064)', () => {
  it('shows every feature in at least one moment', () => {
    const shown = new Set(BEATS.flatMap((b) => b.features));
    const missing = FEATURES.filter((f) => !shown.has(f.id)).map((f) => f.id);
    expect(missing).toEqual([]);
  });

  it('shows only features Xedine has', () => {
    const known = new Set<string>(FEATURES.map((f) => f.id));
    const unknown = BEATS.flatMap((b) => b.features).filter((f) => !known.has(f));
    expect(unknown).toEqual([]);
  });

  it('points every feature at the code that is it', () => {
    const gone = FEATURES.filter((f) => !existsSync(join(ROOT, f.source))).map(
      (f) => `${f.id}: ${f.source}`,
    );
    expect(gone).toEqual([]);
  });

  it('names and explains every feature, and tells every moment, in Bangla and English', () => {
    for (const lang of ['en', 'bn'] as const) {
      const features = day[lang].features as Record<string, { name: string; line: string }>;
      const beats = day[lang].beats as Record<
        string,
        { time: string; place: string; title: string; body: string }
      >;
      for (const f of FEATURES) {
        expect(features[f.id]?.name, `${lang} ${f.id}`).toBeTruthy();
        expect(features[f.id]?.line, `${lang} ${f.id}`).toBeTruthy();
      }
      for (const b of BEATS) {
        for (const k of ['time', 'place', 'title', 'body'] as const)
          expect(beats[b.id]?.[k], `${lang} ${b.id}.${k}`).toBeTruthy();
      }
    }
  });

  it('keeps the moments in the order of the day', () => {
    const hours = BEATS.map((b) => b.hour);
    expect(hours).toEqual([...hours].sort((a, b) => a - b));
  });
});
