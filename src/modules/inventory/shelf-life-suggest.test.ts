import { describe, expect, it } from 'vitest';
import { suggestShelfLife } from './shelf-life-suggest';

describe('suggestShelfLife', () => {
  it('knows common items in English, Banglish and Bangla', () => {
    expect(suggestShelfLife('Chicken')).toBe(2);
    expect(suggestShelfLife('murgi')).toBe(2);
    expect(suggestShelfLife('x', 'মুরগির মাংস')).toBe(2);
    expect(suggestShelfLife('bangla dhoi')).toBe(5);
    expect(suggestShelfLife('Bread slice')).toBe(3);
    expect(suggestShelfLife('Darchini')).toBe(180);
  });

  it('matches whole Latin words, so one item is not mistaken for another', () => {
    expect(suggestShelfLife('Chinigura rice')).toBe(180);
    expect(suggestShelfLife('Chini')).toBe(365);
    expect(suggestShelfLife('Dimsum wrapper')).toBeNull();
    expect(suggestShelfLife('Hotel pan liner')).toBeNull();
    // Bangla matches inside a word, so a fish must not read as oil (তেল) or a sausage as sauce.
    expect(suggestShelfLife('x', 'তেলাপিয়া')).toBe(2);
    expect(suggestShelfLife('x', 'সসেজ')).toBeNull();
  });

  it('leaves an unknown item empty rather than guessing', () => {
    expect(suggestShelfLife('Special house mix')).toBeNull();
  });
});
