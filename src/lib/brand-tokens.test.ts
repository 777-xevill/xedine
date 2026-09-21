import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** ADR 0009: brand colour lives in CSS variables only. A hex literal in a component defeats "rebrand = token swap". */
const SRC = join(import.meta.dirname, '..');
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

describe('brand tokens (ADR 0009, docs/BRAND.md)', () => {
  const css = readFileSync(join(SRC, 'app', 'globals.css'), 'utf8').toLowerCase();

  it('defines every colour from the brand guideline as a CSS variable', () => {
    const guideline: Record<string, string> = {
      '--bg': '#05060a',
      '--bg-secondary': '#080b16',
      '--surface': '#0d1120',
      '--surface-elevated': '#12182a',
      '--text': '#f7f8fc',
      '--text-secondary': '#a7adbf',
      '--text-muted': '#687087',
      '--text-disabled': '#41485a',
      '--border': '#1b2133',
      '--border-strong': '#2a3248',
      '--accent-pink': '#e84cff',
      '--accent-purple': '#7c3cff',
      '--accent-blue': '#267bff',
      '--accent-cyan': '#17d9ff',
      '--success': '#3dda9a',
      '--warning': '#ffbe55',
      '--danger': '#ff667a',
    };
    for (const [name, hex] of Object.entries(guideline)) {
      expect(css, `${name} should be ${hex}`).toContain(`${name}: ${hex};`);
    }
  });

  it('no component, page or module hardcodes a colour', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC).filter(
      (f) => /\.(tsx?|css)$/.test(f) && !f.endsWith('globals.css') && !f.endsWith('.test.ts'),
    )) {
      const text = readFileSync(file, 'utf8');
      const hex = text.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g);
      // viewport themeColor in the root layout is metadata, not styling.
      if (hex && !file.endsWith('layout.tsx')) offenders.push(`${file}: ${hex.join(', ')}`);
      if (/\b(?:bg|text|border)-\[#/.test(text)) offenders.push(`${file}: arbitrary colour class`);
    }
    expect(offenders).toEqual([]);
  });
});
