import { describe, expect, it } from 'vitest';
import bn from '../../messages/bn.json';
import en from '../../messages/en.json';
import { routeQuestion, type MenuRef } from './router';
import { SUGGESTIONS } from './suggestions';

const menu: MenuRef[] = [
  { id: 'km', name: 'Kacchi Biryani (Mutton)', name_bn: 'কাচ্চি বিরিয়ানি (মটন)' },
  { id: 'th', name: 'Beef Tehari', name_bn: 'বিফ তেহারি' },
];

/**
 * The starter questions on the new-chat screen must be answerable with no AI key: each one has to
 * reach the deterministic router's intended metric in both languages (ADR 0024).
 */
describe('assistant starter questions', () => {
  for (const [locale, messages] of [
    ['en', en],
    ['bn', bn],
  ] as const) {
    it.each(SUGGESTIONS)(`${locale}: %s routes to its metric`, (key, kind) => {
      const text = messages.assistantPage.suggestions[key];
      expect(routeQuestion(text, menu)).toMatchObject({ kind });
    });
  }
});
