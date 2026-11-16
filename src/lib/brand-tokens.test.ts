import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * ADR 0009 / 0063: brand colour lives in CSS variables only, and since ADR 0063 the whole app wears the
 * founder's three colours and nothing else: grey (primary, the page), silver and yellow. A hex literal
 * in a component defeats "rebrand = token swap".
 */
const SRC = join(import.meta.dirname, '..');
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

const block = (css: string, selector: string) => {
  const from = css.slice(css.indexOf(`${selector} {`));
  return from.slice(0, from.indexOf('\n}'));
};

describe('brand tokens (ADR 0009, ADR 0063, docs/BRAND.md)', () => {
  const css = readFileSync(join(SRC, 'app', 'globals.css'), 'utf8').toLowerCase();

  it("defines the founder's three colours as CSS variables", () => {
    for (const [name, hex] of Object.entries({
      '--brand-grey': '#2b2d31',
      '--brand-silver': '#d9dadc',
      '--brand-yellow': '#ffc93c',
    }))
      expect(css, `${name} should be ${hex}`).toContain(`${name}: ${hex};`);
  });

  it('uses no colour but grey, silver and yellow (white only for paper, QR codes and the landing page)', () => {
    // globals.css and every stylesheet it imports (src/app/styles/*.css).
    const sheets = walk(join(SRC, 'app'))
      .filter((f) => f.endsWith('.css'))
      .map((f) => readFileSync(f, 'utf8').toLowerCase())
      .join('\n')
      // Comments may name what is banned; only the rules count.
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const allowed = new Set(['#2b2d31', '#d9dadc', '#ffc93c', '#ffffff']);
    const found = new Set(sheets.match(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/g) ?? []);
    expect([...found].filter((hex) => !allowed.has(hex))).toEqual([]);
    // No rgb()/hsl()/oklch() side doors either: every other shade is a color-mix of the three.
    expect(sheets).not.toMatch(/\b(?:rgba?|hsla?|oklch|oklab)\(/);
  });

  it('grey is the primary colour and the page; silver the words; yellow the actions', () => {
    const root = block(css, ':root');
    for (const mapping of [
      '--bg: var(--brand-grey);',
      '--text: var(--brand-silver);',
      '--on-action: var(--brand-grey);',
      '--accent-purple: var(--brand-yellow);',
      'color-scheme: dark;',
    ])
      expect(root).toContain(mapping);
    expect(root).toMatch(/--action-gradient: linear-gradient\([^;]*var\(--brand-yellow\)/);
  });

  it('there is one theme: the light/dark switch is gone (ADR 0063 supersedes ADR 0034)', () => {
    expect(css).not.toContain("[data-theme='dark']");
  });

  it('the landing page keeps its light parts (ADR 0056) with yellow buttons and grey words', () => {
    const landing = block(css, '.landing');
    expect(landing).toContain('--on-action: var(--landing-grey);');
    expect(landing).toContain(
      '--action-gradient: linear-gradient(var(--landing-yellow), var(--landing-yellow));',
    );
    expect(landing).toContain('color-scheme: light;');
    // Yellow text is unreadable on its light parts: inks turn grey there.
    expect(landing).toContain('--accent-purple-ink: var(--landing-grey);');
  });

  it('every animation holds still for people who ask for reduced motion', () => {
    const reduced = css.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/g) ?? [];
    const all = reduced.join('\n');
    for (const selector of ['.page-enter > *', '[data-reveal]', '.aurora::before', 'dialog[open]'])
      expect(all, `${selector} should stop for reduced motion`).toContain(selector);
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
