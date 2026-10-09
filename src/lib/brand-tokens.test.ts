import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** ADR 0009 / 0024: brand colour lives in CSS variables only. A hex literal in a component defeats "rebrand = token swap". */
const SRC = join(import.meta.dirname, '..');
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

describe('brand tokens (ADR 0009, docs/BRAND.md)', () => {
  const css = readFileSync(join(SRC, 'app', 'globals.css'), 'utf8').toLowerCase();

  it('defines every colour from the brand guideline as a CSS variable', () => {
    // ADR 0024: the guideline palette is kept verbatim as raw tokens; the light theme maps onto it.
    const guideline: Record<string, string> = {
      '--palette-night': '#05060a',
      '--palette-night-2': '#080b16',
      '--palette-navy': '#0d1120',
      '--palette-navy-2': '#12182a',
      '--palette-mist': '#f7f8fc',
      '--palette-slate-300': '#a7adbf',
      '--palette-slate-500': '#687087',
      '--palette-slate-700': '#41485a',
      '--palette-line-dark': '#1b2133',
      '--palette-line-dark-2': '#2a3248',
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

  it('the light theme is built on the guideline palette (ADR 0024)', () => {
    for (const mapping of [
      '--bg: var(--palette-mist);',
      '--text: var(--palette-navy);',
      '--text-secondary: var(--palette-slate-700);',
      '--text-muted: var(--palette-slate-500);',
      'color-scheme: light;',
    ])
      expect(css).toContain(mapping);
  });

  it('the dark theme (ADR 0034) remaps every surface and text token onto the navy palette', () => {
    const block = css.slice(css.indexOf("[data-theme='dark'] {"));
    const dark = block.slice(0, block.indexOf('\n}'));
    for (const token of [
      '--bg',
      '--surface',
      '--surface-elevated',
      '--text',
      '--text-secondary',
      '--text-muted',
      '--border',
      '--glass-fill',
      '--accent-purple-ink',
    ])
      expect(dark, `dark theme should set ${token}`).toContain(`${token}:`);
    expect(dark).toContain('color-scheme: dark;');
    // Never a pure-black page (the founder's rule): the page is the guideline navy.
    expect(dark).toContain('--bg: var(--palette-navy);');
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
