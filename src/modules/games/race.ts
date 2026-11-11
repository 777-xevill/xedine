/**
 * Tap Race (ADR 0046, pictures from ADR 0047): pictures flash one after another; when the target picture
 * shows, the first to tap wins the point, and a tap on any other picture loses one. On one phone each player has a corner of the screen;
 * on separate phones each phone is a buzzer. The phone running the game decides what shows next.
 */
export interface RaceState {
  game: 'race';
  players: number;
  /** The pictures in play (numbers into PICTURES) and which of them is the target. */
  faces: number[];
  target: number;
  /** The face on screen now, with a counter so the same face twice is still a new show. */
  showing: { face: number; n: number } | null;
  claimed: boolean;
  targetsShown: number;
  scores: number[];
  last: { by: number; good: boolean; n: number } | null;
  phase: 'ready' | 'play' | 'done';
}

export type RaceAction =
  { type: 'start' } | { type: 'show'; face: number } | { type: 'tap' } | { type: 'end' };

export const RACE_TARGETS = 8;

export function initRace(players: number, faces: number[], target: number): RaceState {
  return {
    game: 'race',
    players,
    faces,
    target,
    showing: null,
    claimed: false,
    targetsShown: 0,
    scores: Array.from({ length: players }, () => 0),
    last: null,
    phase: 'ready',
  };
}

export function reduceRace(s: RaceState, a: RaceAction, by: number): RaceState {
  switch (a.type) {
    case 'start':
      return s.phase === 'ready' ? { ...s, phase: 'play' } : s;
    case 'end':
      return s.phase === 'play' ? { ...s, phase: 'done', showing: null } : s;
    case 'show': {
      if (s.phase !== 'play' || a.face < 0 || a.face >= s.faces.length) return s;
      const isTarget = a.face === s.target;
      return {
        ...s,
        showing: { face: a.face, n: (s.showing?.n ?? 0) + 1 },
        claimed: false,
        targetsShown: s.targetsShown + (isTarget ? 1 : 0),
      };
    }
    case 'tap': {
      if (s.phase !== 'play' || !s.showing || s.claimed || by < 0 || by >= s.players) return s;
      const good = s.showing.face === s.target;
      const scores = s.scores.map((v, i) => (i === by ? Math.max(0, v + (good ? 1 : -1)) : v));
      // A right tap closes the show for everyone; a wrong one only costs the one who tapped.
      return { ...s, scores, claimed: good, last: { by, good, n: s.showing.n } };
    }
  }
}

/** The next face to show: the target about one time in three, never the same wrong picture twice in a row. */
export function nextFace(s: RaceState, r: number, r2: number): number {
  if (r < 0.34) return s.target;
  const others = s.faces.map((_, i) => i).filter((i) => i !== s.target && i !== s.showing?.face);
  return others.length ? others[Math.floor(r2 * others.length)]! : s.target;
}
