/**
 * The pictures the table games use (ADR 0047): bright, friendly things that are not on the menu, in five
 * themes of twelve. Only emoji from the early sets are used, so budget phones show them too. A "face" in a
 * game is a number: the place of the picture in `PICTURES`.
 */
export const THEMES = [
  {
    key: 'animals',
    pics: ['🐯', '🐘', '🦜', '🐒', '🐢', '🦁', '🐼', '🐬', '🦋', '🐙', '🦒', '🐧'],
  },
  { key: 'space', pics: ['🚀', '🌙', '⭐', '🛸', '👽', '🌍', '🌞', '🔭', '🌌', '🌠', '🌕', '🌟'] },
  { key: 'sports', pics: ['⚽', '🏏', '🏀', '🎾', '🏸', '🏓', '🥊', '🏐', '🏆', '🎯', '🏹', '🏈'] },
  {
    key: 'vehicles',
    pics: ['🚲', '🚂', '🚁', '🚢', '🚌', '🚗', '🚕', '🚒', '🚜', '🚑', '🚓', '🚤'],
  },
  { key: 'party', pics: ['🎈', '🎁', '🎸', '🎮', '🎨', '🎩', '🎪', '🎺', '📸', '🎧', '🎤', '🎻'] },
] as const;

export type ThemeKey = (typeof THEMES)[number]['key'];

export const THEME_SIZE = 12;

export const PICTURES: readonly string[] = THEMES.flatMap((t) => t.pics);

/** The picture numbers of one theme. */
export function themeFaces(theme: number): number[] {
  return Array.from({ length: THEME_SIZE }, (_, k) => theme * THEME_SIZE + k);
}

export function themeOf(face: number): number {
  return Math.floor(face / THEME_SIZE);
}

export function themeKey(theme: number): ThemeKey {
  return THEMES[theme % THEMES.length]!.key;
}
