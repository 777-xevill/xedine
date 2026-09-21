import { describe, expect, it } from 'vitest';
import bn from '../../messages/bn.json';
import en from '../../messages/en.json';

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out[path] = value;
    else Object.assign(out, flatten(value, path));
  }
  return out;
}

const en_ = flatten(en as Tree);
const bn_ = flatten(bn as Tree);
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

// CLAUDE.md non-negotiable #6: every UI string exists in bn and en.
describe('i18n message catalogues', () => {
  it('bn and en have exactly the same keys', () => {
    expect(Object.keys(bn_).sort()).toEqual(Object.keys(en_).sort());
  });

  it('no message is empty', () => {
    for (const [k, v] of [...Object.entries(en_), ...Object.entries(bn_)])
      expect(v.trim(), k).not.toBe('');
  });

  it('placeholders match between languages', () => {
    for (const key of Object.keys(en_))
      expect(placeholders(bn_[key]!), key).toEqual(placeholders(en_[key]!));
  });

  it('Bangla messages are actually Bangla (brand names and language labels excepted)', () => {
    const allowedLatin = new Set(['common.appName', 'common.english']);
    for (const [key, value] of Object.entries(bn_)) {
      if (allowedLatin.has(key)) continue;
      expect(/[ঀ-৿]/.test(value), `${key} is not translated: "${value}"`).toBe(true);
    }
  });

  it('every role and weekday has a label', () => {
    for (const role of ['owner', 'manager', 'cashier', 'kitchen', 'purchaser', 'accountant'])
      expect(en_[`roles.${role}`]).toBeTruthy();
    for (let d = 0; d < 7; d++) expect(bn_[`weekdays.${d}`]).toBeTruthy();
  });
});
