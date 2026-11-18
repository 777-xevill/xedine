import type { FeatureId } from './features';

/**
 * One day in the café, beat by beat (ADR 0064, docs/LANDING-3D.md). Positions are in Blender's metres (x right,
 * y into the building, z up) so they match scripts/landing-3d/world.py; `toThree` turns them into the page's.
 *
 * Scroll runs a single number, p, from 0 to BEATS.length: beat b owns [b, b + 1). Inside a beat the camera
 * moves through its keys; between beats it follows Xedine along the `path` (doorways, the office window) to
 * the next. Every key shows the people of its moment whole, head to floor, or not at all; a close key reads a
 * screen or a phone (framing.test.ts checks both, the founder's rule of 2026-11-17).
 */

export type V3 = readonly [number, number, number];

/** Beat b's own keys fill [b + IN, b + OUT] of the scroll; the rest is the way to the next beat. */
export const IN = 0.1;
export const OUT = 0.68;

/** Blender (x, y, z) → three.js (x, z, -y). */
export const toThree = (v: V3): [number, number, number] => [v[0], v[2], -v[1]];

export type CastId =
  | 'owner'
  | 'shopper'
  | 'cook'
  | 'waiter'
  | 'cashier'
  | 'manager'
  | 'guest_a'
  | 'guest_b'
  | 'guest_c'
  | 'guest_d';

export const CAST_IDS: readonly CastId[] = [
  'owner',
  'shopper',
  'cook',
  'waiter',
  'cashier',
  'manager',
  'guest_a',
  'guest_b',
  'guest_c',
  'guest_d',
];

/** Each person's size, as modelled (scripts/landing-3d/cast.py). */
export const CAST_SIZE: Record<CastId, number> = {
  owner: 1,
  shopper: 1,
  cook: 1.04,
  waiter: 1,
  cashier: 0.96,
  manager: 1.05,
  guest_a: 0.95,
  guest_b: 0.97,
  guest_c: 0.9,
  guest_d: 0.93,
};

/** How the hands are held. */
export type Pose =
  'idle' | 'phone' | 'carry' | 'tray' | 'work' | 'wave' | 'sit' | 'sitPhone' | 'point';
export type Prop = 'phone' | 'bag' | 'tray' | 'mug' | 'spatula' | 'notepad' | 'card';

/** What a screen shows (painters in screens.ts). */
export type Show =
  | 'brief'
  | 'telegram'
  | 'stockUp'
  | 'safety'
  | 'staff'
  | 'plan'
  | 'table'
  | 'till'
  | 'approval'
  | 'kds'
  | 'scale'
  | 'stockDown'
  | 'poster'
  | 'offer'
  | 'notify'
  | 'review'
  | 'complaint'
  | 'closing'
  | 'leaks'
  | 'ask'
  | 'idle';

/** Screens fixed in the world (world.py) and the phones in people's hands. */
export type ScreenId =
  'till' | 'kds' | 'safety' | 'stock' | 'staff' | 'office' | 'poster' | 'scale';

export type Blocking = {
  id: CastId;
  at: V3;
  /** Where they glide to by the end of the beat. */
  to?: V3;
  /** Facing, in degrees: 0 = toward the street (-y), 90 = toward +x. Omitted: toward the camera. */
  face?: number;
  pose?: Pose;
  props?: Prop[];
  /** The phone's screen, when they hold one. */
  phone?: Show;
};

export type CamKey = {
  at: number;
  pos: V3;
  look: V3;
  fov?: number;
  /** A close look at a screen or a phone this wide and tall (metres): an upright phone narrows its view to it. */
  fit?: readonly [number, number];
  /** A key on the way (a doorway inside a moment): nobody needs to be in the picture, nobody half in it. */
  pass?: boolean;
};

/** Xedine's place through a beat: keys in the beat's own time (0..1), glided between. */
export type XedineKey = { at: number; pos: V3 };

export type Beat = {
  id: string;
  /** The café's clock, in hours (7.5 = 7:30). */
  hour: number;
  /** 0 = day, 1 = night (blends the baked night light in). */
  night: number;
  features: FeatureId[];
  cam: CamKey[];
  /** Waypoints after this beat, on the way to the next one (Xedine leads, the camera follows). */
  path?: V3[];
  /** The next beat is in the same room: Xedine glides straight to its next place, the camera turns to it. */
  hop?: boolean;
  /**
   * How much of the beat its keys and Xedine's moves take (default 1): the rest holds the last view while
   * its screen plays, so the close look arrives early and stays.
   */
  pace?: number;
  xedine: {
    route: XedineKey[];
    look?: V3;
    move?: 'AN_Wave' | 'AN_Point';
    /** Part of the beat (its own time) where Xedine leads the camera into another room. */
    lead?: readonly [number, number];
  };
  cast: Blocking[];
  screens: Partial<Record<ScreenId, Show>>;
  /** Show the city (and the globe) instead of only the café. */
  city?: boolean;
};

// Places, reused below (the camera flies above the prep table and through the doorways).
const DOOR_OUT: V3 = [1.75, -5.7, 1.6];
const DOOR_IN: V3 = [1.75, -4.1, 1.6];
const CAFE_MID: V3 = [2.6, -1.4, 1.65];
const KITCHEN_DOOR: V3 = [4.07, 1.3, 1.65];
const KITCHEN_AISLE: V3 = [4.9, 1.3, 1.7];
const KITCHEN_NE: V3 = [8.4, 1.3, 1.7];
const STORE_DOOR: V3 = [8.9, 2.68, 1.65];
const STORE_IN: V3 = [8.4, 3.4, 1.6];
const OFFICE_DOOR: V3 = [4.08, -2.95, 1.6];
const OFFICE_IN: V3 = [5.1, -2.9, 1.6];
const OFFICE_WINDOW: V3 = [7.0, -4.78, 1.72];
const STREET_UP: V3 = [7.0, -9.0, 4.0];

/** The screens' middles (world.py, cafe.py). */
export const TILL: V3 = [2.2, 1.22, 1.29];
export const KDS: V3 = [4.72, 2.585, 1.6];
export const SAFETY: V3 = [4.95, -1.0, 1.45];
export const STOCK: V3 = [7.1, 6.23, 1.62];
export const STAFF: V3 = [9.59, 3.48, 1.45];
export const MONITOR: V3 = [9.19, -3.0, 1.26];
export const POSTER: V3 = [3.99, -1.55, 1.62];
export const SCALE: V3 = [6.61, 0.15, 0.94];

/**
 * Where the phone someone holds up sits, from their feet (cast.tsx holds it there, for a person of size 1):
 * ahead of them, to the viewer's left, and up. The hand holds it from below and behind, off the screen.
 */
export const PHONE_HOLD = { ahead: 0.53, left: 0.24, up: 0.71, width: 0.13, height: 0.25 };

/** The middle of the phone held by someone at `at`, of `size`, facing `toward` (the camera's side). */
export function phoneAt(at: V3, toward: readonly [number, number], size = 1): V3 {
  const len = Math.hypot(toward[0], toward[1]);
  const d = [toward[0] / len, toward[1] / len] as const;
  const left = [d[1], -d[0]] as const;
  const s = size;
  return [
    at[0] + (d[0] * PHONE_HOLD.ahead + left[0] * PHONE_HOLD.left) * s,
    at[1] + (d[1] * PHONE_HOLD.ahead + left[1] * PHONE_HOLD.left) * s,
    at[2] + PHONE_HOLD.up * s,
  ];
}

/** A close shot of the phone someone at `at` holds toward `toward` (where the camera comes from). */
function phoneShot(
  at: V3,
  toward: readonly [number, number],
  key: number,
  size = 1,
  dist = 0.62,
  fov = 34,
): CamKey {
  const len = Math.hypot(toward[0], toward[1]);
  const d = [toward[0] / len, toward[1] / len] as const;
  const phone = phoneAt(at, toward, size);
  return {
    at: key,
    pos: [phone[0] + d[0] * dist, phone[1] + d[1] * dist, phone[2] + 0.04],
    look: phone,
    fov,
    fit: [PHONE_HOLD.width * size, PHONE_HOLD.height * size],
  };
}

/** A key `dist` metres from `look`, from the direction `from` (on the floor), at height `h`. */
function shot(
  key: number,
  look: V3,
  from: readonly [number, number],
  dist: number,
  h: number,
  fov: number,
  fit?: readonly [number, number],
): CamKey {
  const len = Math.hypot(from[0], from[1]);
  return {
    at: key,
    pos: [look[0] + (from[0] / len) * dist, look[1] + (from[1] / len) * dist, h],
    look,
    fov,
    ...(fit ? { fit } : {}),
  };
}

/** Xedine stays put through the beat. */
const still = (pos: V3): XedineKey[] => [{ at: 0, pos }];

const OWNER_STREET: V3 = [4.3, -6.95, 0];
const SHOPPER_IN: V3 = [6.15, 4.45, 0];
const COOK_SAFETY: V3 = [4.75, -0.5, 0];
const MANAGER_OFFICE: V3 = [8.4, -2.12, 0];
const GUEST_A: V3 = [-1.67, -3.75, 0.18];
const GUEST_B: V3 = [-0.23, -3.75, 0.18];
const GUEST_C: V3 = [-3.74, -3.75, 0.18];
const CASHIER: V3 = [2.95, 1.42, 0];
const MANAGER_FLOOR: V3 = [3.05, 0.1, 0];
const COOK_LINE: V3 = [6.1, 1.3, 0];
const COOK_PREP: V3 = [5.4, -0.5, 0];
const OWNER_CORNER: V3 = [-3.15, -0.55, 0.18];
const GUEST_DOOR: V3 = [1.25, -3.9, 0];
const MANAGER_DOOR: V3 = [2.85, -2.7, 0];
const OWNER_SOFA: V3 = [6.25, -1.85, 0.22];
const OWNER_DESK: V3 = [8.4, -2.12, 0];

export const BEATS: Beat[] = [
  {
    id: 'dawn',
    hour: 6.25,
    night: 0.55,
    features: ['languages', 'countries'],
    cam: [
      { at: 0, pos: [1.2, -15.5, 1.9], look: [0.8, -4.8, 2.7], fov: 44, pass: true },
      { at: 1, pos: [2.9, -11.6, 1.6], look: [2.95, -5.6, 1.6], fov: 44 },
    ],
    hop: true,
    xedine: { route: still([1.75, -6.3, 0.6]), look: [2.9, -11.6, 1.6], move: 'AN_Wave' },
    cast: [{ id: 'owner', at: [7.6, -6.95, 0], to: OWNER_STREET, pose: 'idle', props: ['mug'] }],
    screens: {},
  },
  {
    id: 'brief',
    hour: 7,
    night: 0.3,
    pace: 0.6,
    features: ['brief', 'home', 'weather'],
    cam: [
      shot(0, [3.85, -6.85, 0.7], [0.5, -1], 3.6, 1.5, 44),
      phoneShot(OWNER_STREET, [0.45, -1], 1),
    ],
    path: [
      [3.0, -7.4, 1.6],
      DOOR_OUT,
      DOOR_IN,
      CAFE_MID,
      KITCHEN_DOOR,
      KITCHEN_AISLE,
      KITCHEN_NE,
      STORE_DOOR,
    ],
    xedine: {
      route: [
        { at: 0, pos: [3.2, -6.5, 0.75] },
        { at: 0.45, pos: [3.2, -6.5, 0.75] },
        { at: 0.9, pos: [2.6, -6.9, 0.75] },
      ],
      look: [4.4, -7.4, 1.0],
    },
    cast: [
      { id: 'owner', at: OWNER_STREET, pose: 'phone', props: ['phone', 'mug'], phone: 'brief' },
    ],
    screens: {},
  },
  {
    id: 'bazar',
    hour: 7.5,
    night: 0,
    pace: 0.8,
    features: ['telegram', 'purchases', 'draftApprove', 'stockGuard', 'stock'],
    cam: [
      shot(0, [6.75, 4.75, 0.8], [1, -0.75], 2.8, 1.45, 46),
      phoneShot(SHOPPER_IN, [1, -0.7], 0.42),
      shot(0.68, [7.95, 5.5, 1.05], [0.35, -1], 2.6, 1.55, 46),
      shot(1, STOCK, [0, -1], 1.55, 1.62, 40, [0.9, 0.52]),
    ],
    path: [STORE_IN, STORE_DOOR, [7.6, 2.2, 1.7], [5.4, 2.2, 1.7]],
    xedine: {
      route: [
        { at: 0, pos: [6.95, 5.0, 0.72] },
        { at: 0.45, pos: [6.95, 5.0, 0.72] },
        { at: 0.62, pos: [7.95, 5.55, 0.95] },
        { at: 0.92, pos: [8.6, 3.75, 0.9] },
      ],
      look: STOCK,
      move: 'AN_Point',
    },
    cast: [
      {
        id: 'shopper',
        at: SHOPPER_IN,
        pose: 'phone',
        props: ['phone', 'bag'],
        phone: 'telegram',
      },
    ],
    screens: { stock: 'stockUp' },
  },
  {
    id: 'safety',
    hour: 8,
    night: 0,
    pace: 0.6,
    features: ['foodSafety', 'dailyChecks', 'compliance'],
    cam: [
      shot(0, [5.1, -0.5, 0.75], [-0.18, 1], 2.2, 1.6, 52),
      shot(1, SAFETY, [0.5, 0.85], 0.9, 1.5, 40, [0.54, 0.36]),
    ],
    path: [[6.9, -0.3, 1.6], [8.25, 0.35, 1.7], [8.45, 1.4, 1.7], STORE_DOOR, STORE_IN],
    xedine: {
      route: [
        { at: 0, pos: [5.7, -0.6, 0.82] },
        { at: 0.35, pos: [5.7, -0.6, 0.82] },
        { at: 0.85, pos: [6.9, -0.4, 0.85] },
      ],
      look: SAFETY,
      move: 'AN_Point',
    },
    cast: [{ id: 'cook', at: COOK_SAFETY, to: [4.6, 0.55, 0], pose: 'idle' }],
    screens: { safety: 'safety' },
  },
  {
    id: 'staff',
    hour: 8.5,
    night: 0,
    pace: 0.6,
    features: ['staffRecords', 'team', 'staffPins'],
    cam: [
      shot(0, [8.25, 4.3, 0.75], [-1, -0.08], 3.5, 1.5, 52),
      shot(1, STAFF, [-1, 0], 0.85, 1.48, 40, [0.48, 0.32]),
    ],
    path: [
      STORE_DOOR,
      KITCHEN_NE,
      KITCHEN_AISLE,
      KITCHEN_DOOR,
      CAFE_MID,
      [3.3, -2.95, 1.6],
      OFFICE_DOOR,
      OFFICE_IN,
    ],
    xedine: {
      route: [
        { at: 0, pos: [9.1, 4.1, 0.85] },
        { at: 0.5, pos: [9.1, 4.1, 0.85] },
        { at: 0.9, pos: [7.6, 2.95, 0.9] },
      ],
      look: STAFF,
      move: 'AN_Point',
    },
    cast: [
      { id: 'manager', at: [8.12, 5.54, 0], pose: 'idle' },
      { id: 'waiter', at: [8.24, 4.75, 0], pose: 'idle', props: ['notepad'] },
      { id: 'cashier', at: [8.2, 3.95, 0], face: 75, pose: 'point' },
      { id: 'shopper', at: [8.2, 3.1, 0], pose: 'idle' },
    ],
    screens: { staff: 'staff' },
  },
  {
    id: 'plan',
    hour: 9,
    night: 0,
    pace: 0.6,
    features: ['plan', 'weather'],
    cam: [
      shot(0, [8.55, -2.95, 0.8], [-1, 0.12], 3.3, 1.5, 48),
      shot(1, MONITOR, [-1, 0], 1.12, 1.32, 40, [0.74, 0.43]),
    ],
    path: [OFFICE_IN, OFFICE_DOOR, [3.0, -2.5, 1.65]],
    xedine: {
      route: [
        { at: 0, pos: [8.45, -3.72, 0.9] },
        { at: 0.5, pos: [8.45, -3.72, 0.9] },
        { at: 0.9, pos: [6.4, -3.05, 0.85] },
      ],
      look: MONITOR,
      move: 'AN_Point',
    },
    cast: [{ id: 'manager', at: MANAGER_OFFICE, pose: 'idle' }],
    screens: { office: 'plan' },
  },
  {
    id: 'table',
    hour: 12.5,
    night: 0,
    pace: 0.8,
    features: ['tableQr', 'foodFacts', 'memberCard', 'offers', 'games'],
    cam: [
      shot(0, [-0.95, -3.7, 0.75], [0.2, 1], 3.5, 1.6, 46),
      shot(0.35, [-0.95, -3.65, 0.85], [0, 1], 2.8, 1.4, 46),
      phoneShot(GUEST_B, [0.25, 1], 0.62, 0.97),
      phoneShot(GUEST_B, [0.25, 1], 1, 0.97),
    ],
    path: [[1.4, -2.4, 1.6]],
    hop: true,
    xedine: {
      route: [
        { at: 0, pos: [-0.95, -4.3, 0.75] },
        { at: 0.38, pos: [-0.95, -4.3, 0.75] },
        { at: 0.55, pos: [1.2, -2.0, 0.85] },
      ],
      look: [-0.45, -3.3, 1.0],
      move: 'AN_Point',
    },
    cast: [
      { id: 'guest_a', at: GUEST_A, face: 90, pose: 'sit' },
      { id: 'guest_b', at: GUEST_B, pose: 'sitPhone', props: ['phone'], phone: 'table' },
    ],
    screens: {},
  },
  {
    id: 'till',
    hour: 12.58,
    night: 0,
    pace: 0.6,
    features: ['pos', 'memberCard', 'discountCodes', 'tax', 'offline', 'tillHelper'],
    cam: [
      shot(0, [1.85, 0.75, 0.82], [0.25, -1], 3.75, 1.5, 46),
      shot(1, TILL, [0.375, -0.927], 0.66, 1.38, 36, [0.336, 0.215]),
    ],
    path: [[2.4, -0.6, 1.55]],
    hop: true,
    xedine: {
      route: [
        { at: 0, pos: [2.7, 1.05, 1.05] },
        { at: 0.5, pos: [2.7, 1.05, 1.05] },
        { at: 0.9, pos: [1.6, -0.9, 0.85] },
      ],
      look: TILL,
      move: 'AN_Point',
    },
    cast: [
      { id: 'cashier', at: CASHIER, pose: 'work' },
      { id: 'waiter', at: [0.45, 0.6, 0], pose: 'idle', props: ['notepad'] },
      { id: 'guest_a', at: [1.45, 0.45, 0], pose: 'idle', props: ['card'] },
    ],
    screens: { till: 'till' },
  },
  {
    id: 'manager',
    hour: 12.6,
    night: 0,
    pace: 0.6,
    features: ['approvals', 'moneyVisibility', 'audit', 'home'],
    cam: [
      shot(0, [2.85, 0.4, 0.8], [-0.35, -1], 3.3, 1.5, 46),
      phoneShot(MANAGER_FLOOR, [0.45, -1], 1, 1.05),
    ],
    path: [[3.6, 0.0, 1.6], KITCHEN_DOOR, KITCHEN_AISLE, [7.2, 1.3, 1.7]],
    xedine: {
      route: [
        { at: 0, pos: [2.15, -0.4, 0.85] },
        { at: 0.5, pos: [2.15, -0.4, 0.85] },
        { at: 0.9, pos: [4.0, -0.3, 0.85] },
      ],
      look: [3.0, -0.3, 1.1],
    },
    cast: [
      { id: 'manager', at: MANAGER_FLOOR, pose: 'phone', props: ['phone'], phone: 'approval' },
      { id: 'guest_a', at: GUEST_A, face: 90, pose: 'sit' },
    ],
    screens: { till: 'till' },
  },
  {
    id: 'kitchen',
    hour: 12.62,
    night: 0,
    pace: 0.6,
    features: ['kds', 'staffPins'],
    cam: [
      shot(0, [5.9, 1.35, 0.85], [1, -0.02], 2.9, 1.6, 50),
      shot(1, KDS, [0, -1], 1.35, 1.6, 40, [0.84, 0.48]),
    ],
    path: [
      [6.2, 1.25, 1.7],
      [7.9, 1.05, 1.7],
      [8.35, 0.1, 1.6],
    ],
    hop: true,
    xedine: {
      route: [
        { at: 0, pos: [5.65, 0.5, 1.0] },
        { at: 0.55, pos: [5.65, 0.5, 1.0] },
        { at: 0.9, pos: [6.9, 0.95, 0.8] },
      ],
      look: KDS,
      move: 'AN_Point',
    },
    cast: [{ id: 'cook', at: COOK_LINE, pose: 'work', props: ['spatula'] }],
    screens: { kds: 'kds' },
  },
  {
    id: 'stock',
    hour: 12.67,
    night: 0,
    features: ['recipes', 'stock', 'loss', 'waste', 'estimate'],
    cam: [
      shot(0, [6.3, 0.1, 0.95], [1, -0.22], 2.3, 1.5, 46),
      shot(0.22, SCALE, [0.05, -1], 0.36, 1.1, 36, [0.08, 0.03]),
      shot(0.4, [5.7, -0.05, 0.7], [1, -0.3], 2.1, 1.45, 46),
      { at: 0.58, pos: [8.45, 0.75, 1.7], look: [8.85, 2.7, 1.4], fov: 46, pass: true },
      { at: 0.72, pos: [8.85, 2.65, 1.65], look: [7.8, 4.6, 1.3], fov: 46, pass: true },
      shot(1, STOCK, [0, -1], 1.55, 1.62, 40, [0.9, 0.52]),
    ],
    path: [
      STORE_IN,
      STORE_DOOR,
      KITCHEN_NE,
      KITCHEN_AISLE,
      KITCHEN_DOOR,
      [3.0, 0.2, 1.65],
      [2.2, -1.5, 1.6],
    ],
    xedine: {
      route: [
        { at: 0, pos: [6.65, 0.3, 0.9] },
        { at: 0.12, pos: [6.65, 0.3, 0.9] },
        { at: 0.2, pos: [7.3, 0.95, 1.0] },
        { at: 0.3, pos: [7.3, 0.95, 1.0] },
        { at: 0.4, pos: [8.2, 0.35, 0.9] },
        { at: 0.45, pos: [8.2, 0.35, 0.9] },
        { at: 0.78, pos: [7.95, 5.55, 0.95] },
        { at: 0.86, pos: [7.95, 5.55, 0.95] },
        { at: 0.96, pos: [8.6, 3.75, 0.9] },
      ],
      look: SCALE,
      move: 'AN_Point',
      lead: [0.45, 0.78],
    },
    cast: [{ id: 'cook', at: COOK_PREP, pose: 'work' }],
    screens: { scale: 'scale', stock: 'stockDown' },
  },
  {
    id: 'social',
    hour: 15,
    night: 0,
    pace: 0.6,
    features: ['social', 'posters', 'videos', 'tiktok'],
    cam: [
      shot(0, [3.45, -1.85, 1.15], [-1, -0.3], 2.4, 1.55, 46),
      shot(1, POSTER, [-1, 0], 1.08, 1.6, 40, [0.5, 0.72]),
    ],
    path: [[1.7, -2.05, 1.6]],
    hop: true,
    xedine: {
      route: [
        { at: 0, pos: [3.4, -2.4, 0.82] },
        { at: 0.5, pos: [3.4, -2.4, 0.82] },
        { at: 0.9, pos: [0.95, -1.9, 0.82] },
      ],
      look: POSTER,
      move: 'AN_Point',
    },
    cast: [],
    screens: { poster: 'poster' },
  },
  {
    id: 'offer',
    hour: 16,
    night: 0,
    pace: 0.8,
    features: ['offers', 'customers', 'privacy', 'draftApprove'],
    cam: [
      shot(0, [-2.6, -0.85, 0.85], [0.9, -0.8], 2.5, 1.5, 46),
      phoneShot(OWNER_CORNER, [0.9, -0.8], 0.42),
      shot(0.72, [-3.25, -3.6, 0.8], [0.6, 1], 3.0, 1.5, 46),
      phoneShot(GUEST_C, [-0.3, 1], 1, 0.9),
    ],
    path: [
      [-1.3, -2.55, 1.55],
      [0.9, -2.35, 1.6],
    ],
    hop: true,
    xedine: {
      route: [
        { at: 0, pos: [-2.6, 0.45, 0.85] },
        { at: 0.5, pos: [-2.6, 0.45, 0.85] },
        { at: 0.68, pos: [-3.05, -4.3, 0.95] },
        { at: 0.95, pos: [-1.0, -3.3, 0.8] },
      ],
      look: [-2.6, -1.4, 1.0],
      move: 'AN_Point',
    },
    cast: [
      { id: 'owner', at: OWNER_CORNER, pose: 'sitPhone', props: ['phone'], phone: 'offer' },
      { id: 'guest_c', at: GUEST_C, pose: 'sitPhone', props: ['phone'], phone: 'notify' },
    ],
    screens: {},
  },
  {
    id: 'reviews',
    hour: 17,
    night: 0.1,
    pace: 0.8,
    features: ['reviews'],
    cam: [
      shot(0, [2.35, -3.2, 0.8], [-0.08, 1], 3.1, 1.55, 46),
      phoneShot(GUEST_DOOR, [0.35, 1], 0.45, 0.93),
      phoneShot(MANAGER_DOOR, [-0.45, 1], 1, 1.05),
    ],
    hop: true,
    xedine: { route: still([1.95, -3.05, 0.85]), look: [1.5, -3.4, 1.05] },
    cast: [
      { id: 'guest_d', at: GUEST_DOOR, pose: 'phone', props: ['phone'], phone: 'review' },
      { id: 'manager', at: MANAGER_DOOR, pose: 'phone', props: ['phone'], phone: 'complaint' },
    ],
    screens: {},
  },
  {
    id: 'closing',
    hour: 23,
    night: 1,
    pace: 0.6,
    features: ['pos', 'sales', 'home'],
    cam: [
      shot(0, [2.05, 0.75, 0.82], [0.25, -1], 3.7, 1.5, 46),
      shot(1, TILL, [0.375, -0.927], 0.66, 1.38, 36, [0.336, 0.215]),
    ],
    path: [[3.2, -1.2, 1.6], [3.4, -2.9, 1.6], OFFICE_DOOR, OFFICE_IN],
    xedine: {
      route: [
        { at: 0, pos: [3.05, 0.35, 0.85] },
        { at: 0.5, pos: [3.05, 0.35, 0.85] },
        { at: 0.9, pos: [3.6, -1.0, 0.85] },
      ],
      look: TILL,
      move: 'AN_Point',
    },
    cast: [{ id: 'cashier', at: CASHIER, pose: 'work' }],
    screens: { till: 'closing' },
  },
  {
    id: 'leaks',
    hour: 23.17,
    night: 1,
    pace: 0.6,
    features: ['leaks', 'costs', 'menuProfit', 'moneyVisibility'],
    cam: [
      shot(0, [8.55, -2.95, 0.8], [-1, 0.12], 3.3, 1.5, 48),
      shot(1, MONITOR, [-1, 0], 1.12, 1.32, 40, [0.74, 0.43]),
    ],
    path: [
      [7.4, -3.7, 1.65],
      OFFICE_WINDOW,
      [7.0, -6.3, 2.4],
      STREET_UP,
      [7.2, -13.0, 8.0],
      [7.5, -18.5, 14.0],
      [7.8, -24.0, 21.0],
    ],
    xedine: {
      route: [
        { at: 0, pos: [8.45, -3.72, 0.9] },
        { at: 0.5, pos: [8.45, -3.72, 0.9] },
        { at: 0.9, pos: [7.0, -4.3, 1.05] },
      ],
      look: MONITOR,
      move: 'AN_Point',
    },
    cast: [{ id: 'owner', at: OWNER_DESK, pose: 'idle' }],
    screens: { office: 'leaks' },
  },
  {
    id: 'city',
    hour: 23.33,
    night: 1,
    features: ['branches', 'newBranch', 'benchmarks', 'countries'],
    cam: [
      { at: 0, pos: [8.0, -30.0, 30.0], look: [2.5, 2.0, 0.0], fov: 46 },
      { at: 0.45, pos: [10.0, -70.0, 105.0], look: [2.5, 10.0, 0.0], fov: 46 },
      { at: 1, pos: [2.5, -40.0, 520.0], look: [2.5, 0.0, -120.0], fov: 40 },
    ],
    path: [
      [7.0, -30.0, 60.0],
      [7.0, -10.0, 6.0],
      [7.0, -6.3, 2.4],
      OFFICE_WINDOW,
      [6.6, -4.45, 1.5],
    ],
    xedine: { route: still([7.0, -10.0, 4.5]), look: [2.5, 2.0, 0.0], move: 'AN_Wave' },
    cast: [],
    screens: {},
    city: true,
  },
  {
    id: 'ask',
    hour: 23.5,
    night: 1,
    pace: 0.6,
    features: ['assistant', 'assistantRules', 'languages'],
    cam: [
      shot(0, [6.25, -1.95, 0.85], [0.12, -1], 2.85, 1.45, 46),
      phoneShot(OWNER_SOFA, [0.15, -1], 1),
    ],
    path: [OFFICE_IN, OFFICE_DOOR, [3.0, -2.95, 1.6], DOOR_IN, DOOR_OUT],
    xedine: {
      route: [
        { at: 0, pos: [6.8, -2.35, 0.95] },
        { at: 0.5, pos: [6.8, -2.35, 0.95] },
        { at: 0.75, pos: [6.6, -3.6, 0.9] },
        { at: 0.95, pos: [4.75, -3.2, 0.85] },
      ],
      look: [6.2, -2.4, 1.1],
      move: 'AN_Wave',
    },
    cast: [
      { id: 'owner', at: OWNER_SOFA, pose: 'sitPhone', props: ['phone', 'mug'], phone: 'ask' },
    ],
    screens: {},
  },
  {
    id: 'start',
    hour: 23.75,
    night: 1,
    features: ['signIn', 'setup', 'billing', 'switches', 'menu'],
    cam: [
      { at: 0, pos: [2.9, -11.6, 1.6], look: [2.95, -5.6, 1.6], fov: 44 },
      { at: 1, pos: [1.2, -15.5, 2.0], look: [0.8, -4.8, 2.7], fov: 44, pass: true },
    ],
    xedine: { route: still([1.75, -6.3, 0.6]), look: [1.4, -12.0, 1.6], move: 'AN_Wave' },
    cast: [{ id: 'owner', at: [3.3, -6.9, 0], pose: 'wave', props: ['mug'] }],
    screens: {},
  },
];

export type BeatId = (typeof BEATS)[number]['id'];

/** The moment the card shows: it changes halfway along the way, when the next room comes into view. */
export function cardAt(p: number) {
  const half = (1 + IN - OUT) / 2;
  return Math.min(BEATS.length - 1, Math.max(0, Math.floor(p + (1 - OUT - half))));
}

/** Scroll length of one moment, in screen heights (slow enough to follow Xedine from room to room). */
export const BEAT_VH = 190;
/**
 * The camera's way between two rooms gets at least this much scroll per metre. Every moment once had the same
 * scroll, so the 18 m walk from the street to the storeroom after the first phone flew past in one flick
 * (the founder, 2026-11-18) while a 3 m turn crawled.
 */
export const ROAD_VH_PER_M = 12;

/** Metres the camera travels from beat b's last view, along its path, to the next beat's first view. */
export function roadLength(b: number) {
  const beat = BEATS[b];
  const next = BEATS[b + 1];
  if (!beat || !next) return 0;
  const stops = [beat.cam[beat.cam.length - 1]!.pos, ...(beat.path ?? []), next.cam[0]!.pos];
  let total = 0;
  for (let i = 1; i < stops.length; i++) {
    const [a, c] = [stops[i - 1]!, stops[i]!];
    total += Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
  }
  return total;
}

/**
 * Extra scroll for the road out of beat b (screen heights): enough for ROAD_VH_PER_M on every metre. A road runs
 * from b + OUT to b + 1 + IN, so the extra is shared between the end of beat b and the start of the next one,
 * in proportion, and the camera keeps one speed across the line between the two. The moments themselves
 * (IN to OUT) never change. The flights to and from the city keep their own pacing (timeline.ts spreads them
 * by distance and Xedine's lead is tuned to them).
 */
const ROAD_SPAN = 1 - OUT + IN;
const ROAD_EXTRA: readonly number[] = BEATS.map((beat, b) => {
  const next = BEATS[b + 1];
  if (!next || beat.city || next.city) return 0;
  return Math.max(0, Math.round(roadLength(b) * ROAD_VH_PER_M - ROAD_SPAN * BEAT_VH));
});

/** Each beat's scroll in three parts: arriving [0, IN], the moment [IN, OUT], leaving [OUT, 1]. */
const PARTS = BEATS.map((_, b) => {
  const before = b > 0 ? (ROAD_EXTRA[b - 1]! * IN) / ROAD_SPAN : 0;
  const after = (ROAD_EXTRA[b]! * (1 - OUT)) / ROAD_SPAN;
  return [IN * BEAT_VH + before, (OUT - IN) * BEAT_VH, (1 - OUT) * BEAT_VH + after] as const;
});

/** Each beat's scroll, in screen heights (BEAT_VH, more around a long road). */
export const BEAT_SCROLL_VH: readonly number[] = PARTS.map(([a, m, l]) => a + m + l);

/** The whole day's scroll, in screen heights. */
export const STORY_VH = BEAT_SCROLL_VH.reduce((sum, vh) => sum + vh, 0);

/** p (0..BEATS.length) at `vh` screen heights scrolled into the day. */
export function scrollToP(vh: number) {
  const bounds = [0, IN, OUT, 1];
  let start = 0;
  for (let b = 0; b < BEATS.length; b++) {
    let local = Math.max(0, vh - start);
    for (let part = 0; part < 3; part++) {
      const height = PARTS[b]![part]!;
      if (local < height) {
        return b + bounds[part]! + (local / height) * (bounds[part + 1]! - bounds[part]!);
      }
      local -= height;
    }
    start += BEAT_SCROLL_VH[b]!;
  }
  return BEATS.length;
}

/** Where each person is when no beat places them (the café keeps working in the background). */
export const HOME: Partial<
  Record<
    CastId,
    { at: V3; face?: number; pose: Pose; from: number; until: number; away?: number[] }
  >
> = {
  cook: { at: [7.1, 1.35, 0], face: 180, pose: 'work', from: 4, until: 14 },
  // Away from the till while the manager approves on the floor (behind the manager in the close look).
  cashier: { at: CASHIER, pose: 'idle', from: 5, until: 15, away: [8] },
  waiter: { at: [-1.0, 0.45, 0], face: 160, pose: 'idle', from: 5, until: 9 },
  // In the office while the till takes the order (the till's wide view keeps to the counter).
  manager: { at: [-0.9, 0.3, 0], face: 200, pose: 'idle', from: 6, until: 13, away: [7] },
  // Lunch: the guest at table 4 stays while the order goes through.
  guest_a: { at: GUEST_A, face: 90, pose: 'sit', from: 8, until: 9 },
  guest_b: { at: GUEST_B, face: -90, pose: 'sit', from: 7, until: 9 },
};

/** Where each market sits on the globe (its main city), for the countries moment. */
export const COUNTRY_PLACES: Record<string, { lat: number; lng: number }> = {
  BD: { lat: 23.8, lng: 90.4 },
  IN: { lat: 28.6, lng: 77.2 },
  PK: { lat: 24.9, lng: 67.0 },
  AE: { lat: 25.2, lng: 55.3 },
  SA: { lat: 24.7, lng: 46.7 },
  QA: { lat: 25.3, lng: 51.5 },
  MY: { lat: 3.1, lng: 101.7 },
  SG: { lat: 1.35, lng: 103.8 },
  GB: { lat: 51.5, lng: -0.13 },
  US: { lat: 40.7, lng: -74.0 },
};
