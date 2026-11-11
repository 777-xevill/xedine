/**
 * Table games (ADR 0046, 0047): the games a customer can play on the table page while the food is cooking,
 * on one phone or each on their own phone. Pure: shared by the owner's page, the table page and the games.
 */

export const GAME_KEYS = [
  'catch',
  'quiz',
  'guess',
  'memory',
  'race',
  'duel',
  'rather',
  'wheel',
  'love',
] as const;
export type GameKey = (typeof GAME_KEYS)[number];

/** What the owner can rename: every game and the host character who presents them. */
export const NAME_KEYS = [...GAME_KEYS, 'host'] as const;
export type NameKey = (typeof NAME_KEYS)[number];

export const MAX_NAME = 40;

/** How many can play each game. The couple game is always two. */
export const PLAYERS: Record<GameKey, { min: number; max: number }> = {
  catch: { min: 1, max: 4 },
  quiz: { min: 1, max: 4 },
  guess: { min: 1, max: 4 },
  memory: { min: 1, max: 4 },
  race: { min: 2, max: 4 },
  duel: { min: 1, max: 2 },
  rather: { min: 2, max: 4 },
  wheel: { min: 2, max: 4 },
  love: { min: 2, max: 2 },
};

export function isGameKey(value: unknown): value is GameKey {
  return typeof value === 'string' && (GAME_KEYS as readonly string[]).includes(value);
}

/** The owner's names, keeping only known keys with a non-empty name of at most MAX_NAME characters. */
export function parseGameNames(value: unknown): Partial<Record<NameKey, string>> {
  const out: Partial<Record<NameKey, string>> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const key of NAME_KEYS) {
    const v = (value as Record<string, unknown>)[key];
    if (typeof v !== 'string') continue;
    const name = v.replace(/\s+/g, ' ').trim();
    if (name && name.length <= MAX_NAME) out[key] = name;
  }
  return out;
}

export interface Player {
  id: string;
  name: string;
}
