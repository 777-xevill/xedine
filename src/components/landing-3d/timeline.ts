import * as THREE from 'three';
import {
  BEATS,
  type Blocking,
  CAST_IDS,
  CAST_SIZE,
  type CastId,
  HOME,
  IN,
  OUT,
  type Pose,
  type ScreenId,
  type Show,
  toThree,
  type V3,
  type XedineKey,
} from './story';

/**
 * The day as one timeline (ADR 0064): p runs from 0 to BEATS.length with the scroll. Beat b owns [b, b + 1):
 * its camera keys fill [b + IN, b + OUT]; between OUT and the next beat's IN the camera travels its path,
 * a few steps behind Xedine, looking at it, so you see which room it goes to (the founder, 2026-11-17).
 */
export { IN, OUT };
export const LAST = BEATS.length;
/** How long (in p) Xedine takes to leave its place for the road, and to settle at the next one. */
const RAMP = 0.08;
/** How long the camera waits at the end of a moment before it follows. */
const HOLD = 0.07;
/** How far ahead of the camera Xedine leads, in metres along the road. */
const LEAD = 2.2;
/** Xedine floats this far below the camera's road (its middle is ~0.5 m above its origin). */
const FLOAT_BELOW = 0.85;
const XEDINE_MIDDLE = 0.48;

type Key = {
  p: number;
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
  fit: number;
  fitH: number;
};

const v3 = (v: V3) => new THREE.Vector3(...toThree(v));
const smooth = (x: number) => {
  const c = THREE.MathUtils.clamp(x, 0, 1);
  return c * c * (3 - 2 * c);
};

/** Where a beat's key (or a moment of its content, 0..1) falls in p, after its pace. */
export function keyP(b: number, at: number) {
  return b + IN + at * (BEATS[b]?.pace ?? 1) * (OUT - IN);
}

/** A beat's content time (0..1, before its pace) at its own time t. */
const contentT = (b: number, t: number) => Math.min(1, t / (BEATS[b]?.pace ?? 1));

/** A view the camera holds most of the way to the next one, so a stop in the scroll is a clean picture. */
const SETTLE = 0.65;

function buildTrack(): Key[] {
  const keys: Key[] = [];
  BEATS.forEach((beat, b) => {
    beat.cam.forEach((k, i) => {
      const key: Key = {
        p: keyP(b, k.at),
        pos: v3(k.pos),
        look: v3(k.look),
        fov: k.fov ?? 44,
        fit: k.fit?.[0] ?? 0,
        fitH: k.fit?.[1] ?? 0,
      };
      keys.push(key);
      const next = beat.cam[i + 1];
      // Hold this view for a while before moving on (not in doorways, which are passed through).
      if (next && !k.pass && !next.pass) {
        keys.push({ ...key, p: key.p + (keyP(b, next.at) - key.p) * SETTLE });
      }
    });
    const next = BEATS[b + 1];
    if (!next) return;
    const last = beat.cam[beat.cam.length - 1]!;
    const first = next.cam[0]!;
    // The camera holds a moment at the end of a beat while it turns to Xedine, who sets off first.
    keys.push({
      p: b + OUT + HOLD,
      pos: v3(last.pos),
      look: v3(last.look),
      fov: last.fov ?? 44,
      fit: 0,
      fitH: 0,
    });
    const path = beat.path ?? [];
    if (path.length === 0) return;
    const from = b + OUT + HOLD;
    const to = b + 1 + IN;
    // The flight up to the city spreads its road by distance (at least 3 m a step), so the long climb
    // doesn't rush past while the short steps through the window crawl (the founder saw it shake).
    const stops = [last.pos, ...path, first.pos];
    const steps = stops
      .slice(1)
      .map((w, i) => (next.city ? Math.max(3, v3(w).distanceTo(v3(stops[i]!))) : 1));
    const total = steps.reduce((s, x) => s + x, 0);
    let walked = 0;
    path.forEach((w, i) => {
      const ahead = path[i + 1] ?? first.pos;
      walked += steps[i]!;
      const f = walked / total;
      // Along a road the camera looks ahead (Xedine takes over); on a hop it turns from one view to the next.
      const look = beat.hop ? v3(last.look).lerp(v3(first.look), f) : v3(ahead);
      if (!beat.hop) look.y = v3(w).y - 0.1;
      keys.push({
        p: from + (to - from) * f,
        pos: v3(w),
        look,
        fov: THREE.MathUtils.lerp(last.fov ?? 44, first.fov ?? 44, f),
        fit: 0,
        fitH: 0,
      });
    });
  });
  return keys.sort((a, b) => a.p - b.p);
}

export const TRACK = buildTrack();

/** Uniform Catmull-Rom through the keys: smooth through doorways, exact at every key. */
function catmull(
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
  d: THREE.Vector3,
  t: number,
  out: THREE.Vector3,
) {
  const t2 = t * t;
  const t3 = t2 * t;
  out.set(0, 0, 0);
  out.addScaledVector(a, -0.5 * t3 + t2 - 0.5 * t);
  out.addScaledVector(b, 1.5 * t3 - 2.5 * t2 + 1);
  out.addScaledVector(c, -1.5 * t3 + 2 * t2 + 0.5 * t);
  out.addScaledVector(d, 0.5 * t3 - 0.5 * t2);
  return out;
}

/** The track itself: where the camera is and what its keys look at, its angle and how close it reads. */
function trackAt(p: number, pos: THREE.Vector3, look: THREE.Vector3) {
  const k = TRACK;
  if (p <= k[0]!.p) {
    pos.copy(k[0]!.pos);
    look.copy(k[0]!.look);
    return { fov: k[0]!.fov, fit: k[0]!.fit, fitH: k[0]!.fitH };
  }
  const lastKey = k[k.length - 1]!;
  if (p >= lastKey.p) {
    pos.copy(lastKey.pos);
    look.copy(lastKey.look);
    return { fov: lastKey.fov, fit: lastKey.fit, fitH: lastKey.fitH };
  }
  let i = 0;
  while (i < k.length - 2 && k[i + 1]!.p <= p) i++;
  const a = k[Math.max(0, i - 1)]!;
  const b = k[i]!;
  const c = k[i + 1]!;
  const d = k[Math.min(k.length - 1, i + 2)]!;
  const t = (p - b.p) / Math.max(1e-6, c.p - b.p);
  // Holding still (a key repeated): no drift between the two.
  if (b.pos.distanceToSquared(c.pos) < 1e-8 && b.look.distanceToSquared(c.look) < 1e-8) {
    pos.copy(b.pos);
    look.copy(b.look);
    return {
      fov: b.fov,
      fit: THREE.MathUtils.lerp(b.fit, c.fit, t),
      fitH: THREE.MathUtils.lerp(b.fitH, c.fitH, t),
    };
  }
  // Ease a little at the beat's own keys (where the story stops to look), not at waypoints.
  const e = t * t * (3 - 2 * t) * 0.35 + t * 0.65;
  catmull(a.pos, b.pos, c.pos, d.pos, e, pos);
  catmull(a.look, b.look, c.look, d.look, e, look);
  return {
    fov: THREE.MathUtils.lerp(b.fov, c.fov, e),
    fit: THREE.MathUtils.lerp(b.fit, c.fit, e),
    fitH: THREE.MathUtils.lerp(b.fitH, c.fitH, e),
  };
}

/** The road's length so far, sampled finely, so Xedine can lead by metres rather than by scroll. */
const STEP = 0.002;
const ROAD = (() => {
  const n = Math.ceil(LAST / STEP) + 1;
  const s = new Float32Array(n);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const l = new THREE.Vector3();
  trackAt(0, a, l);
  for (let i = 1; i < n; i++) {
    trackAt(i * STEP, b, l);
    s[i] = s[i - 1]! + a.distanceTo(b);
    a.copy(b);
  }
  return s;
})();

function roadAt(p: number) {
  const x = THREE.MathUtils.clamp(p / STEP, 0, ROAD.length - 1);
  const i = Math.floor(x);
  const j = Math.min(ROAD.length - 1, i + 1);
  return THREE.MathUtils.lerp(ROAD[i]!, ROAD[j]!, x - i);
}

/** The p (not beyond `limit`) where the road has gone `metres` further than at `p`. */
function aheadOnRoad(p: number, metres: number, limit: number) {
  const goal = roadAt(p) + metres;
  let lo = p;
  let hi = limit;
  if (roadAt(hi) <= goal) return hi;
  for (let k = 0; k < 24; k++) {
    const mid = (lo + hi) / 2;
    if (roadAt(mid) < goal) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** Which beat, and how far through its own window (0..1); `inside` is false while travelling between beats. */
export function beatAt(p: number) {
  const b = THREE.MathUtils.clamp(Math.floor(p), 0, BEATS.length - 1);
  const t = THREE.MathUtils.clamp((p - b - IN) / (OUT - IN), 0, 1);
  const inside = p - b >= IN - 0.04 && p - b <= OUT + 0.04;
  return { index: b, beat: BEATS[b]!, t, inside };
}

/** The travel around p: the window [from, to] between two beats, or null inside a beat. */
function travelAt(p: number) {
  const b = Math.floor(p);
  const local = p - b;
  if (b >= LAST) return null;
  if (local > OUT && b + 1 < LAST) return { from: b + OUT, to: b + 1 + IN, beat: b };
  if (local < IN && b > 0) return { from: b - 1 + OUT, to: b + IN, beat: b - 1 };
  return null;
}

/** The clock and the light: hours and night (0..1) blended across the travel between beats. */
export function timeOfDay(p: number) {
  const { index, beat } = beatAt(p);
  const next = BEATS[index + 1];
  const f = next ? smooth((p - index - OUT) / (1 + IN - OUT)) : 0;
  const hour = next ? THREE.MathUtils.lerp(beat.hour, next.hour, f) : beat.hour;
  const night = next ? THREE.MathUtils.lerp(beat.night, next.night, f) : beat.night;
  const city = (beat.city ? 1 : 0) * (1 - f) + (next?.city ? 1 : 0) * f;
  return { hour, night, city };
}

function routeAt(route: XedineKey[], t: number, out: THREE.Vector3) {
  if (t <= route[0]!.at || route.length === 1) return out.set(...toThree(route[0]!.pos));
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]!;
    const b = route[i]!;
    if (t <= b.at) {
      const f = smooth((t - a.at) / Math.max(1e-6, b.at - a.at));
      out.set(...toThree(a.pos));
      return out.lerp(new THREE.Vector3(...toThree(b.pos)), f);
    }
  }
  return out.set(...toThree(route[route.length - 1]!.pos));
}

const tmpPos = new THREE.Vector3();
const tmpLook = new THREE.Vector3();
const tmpA = new THREE.Vector3();

/**
 * Where Xedine leads the camera around p: between two beats, or inside one (its `lead`), with where it sets
 * off from and where it settles.
 */
function leadAt(p: number) {
  const travel = travelAt(p);
  if (travel && BEATS[travel.beat]!.hop) return null;
  if (travel) {
    const from = BEATS[travel.beat]!.xedine.route;
    return {
      from: travel.from,
      to: travel.to,
      start: new THREE.Vector3(...toThree(from[from.length - 1]!.pos)),
      end: new THREE.Vector3(...toThree(BEATS[travel.beat + 1]!.xedine.route[0]!.pos)),
    };
  }
  const { index, beat } = beatAt(p);
  const lead = beat.xedine.lead;
  if (!lead) return null;
  const from = keyP(index, lead[0]);
  const to = keyP(index, lead[1]);
  if (p < from || p > to) return null;
  return {
    from,
    to,
    start: routeAt(beat.xedine.route, lead[0], new THREE.Vector3()),
    end: routeAt(beat.xedine.route, lead[1], new THREE.Vector3()),
  };
}

/**
 * Where Xedine floats: at its place in the beat (its route), or on the road a couple of metres ahead of the
 * camera while it leads the way, so the camera follows it from room to room.
 */
/** Xedine never brushes the lens: on the way, it keeps at least this far from the camera. */
const CLEAR = 1.6;

function keepClear(p: number, out: THREE.Vector3) {
  const cam = new THREE.Vector3();
  trackAt(p, cam, new THREE.Vector3());
  const dx = out.x - cam.x;
  const dz = out.z - cam.z;
  const d = Math.hypot(dx, dz);
  if (d >= CLEAR) return out;
  if (d < 1e-3) return out.set(cam.x + CLEAR, out.y, cam.z);
  out.x = cam.x + (dx / d) * CLEAR;
  out.z = cam.z + (dz / d) * CLEAR;
  return out;
}

/**
 * The travel up to the city: `stop` is where the road passes closest to Xedine's spot above the street, and
 * `reached` where Xedine, leading by LEAD metres, arrives there.
 */
const CITY_FLIGHTS = BEATS.flatMap((beat, b) => {
  const next = BEATS[b + 1];
  if (!next?.city || beat.hop || !beat.path?.length) return [];
  const from = b + OUT;
  const to = b + 1 + IN;
  const end = new THREE.Vector3(...toThree(next.xedine.route[0]!.pos));
  const at = new THREE.Vector3();
  const spare = new THREE.Vector3();
  let stop = from;
  let best = Infinity;
  for (let q = from; q <= to; q += STEP) {
    trackAt(q, at, spare);
    at.y -= FLOAT_BELOW;
    const d = at.distanceTo(end);
    if (d < best) {
      best = d;
      stop = q;
    }
  }
  let reached = from;
  while (reached < stop && roadAt(reached) + LEAD < roadAt(stop)) reached += STEP;
  return [{ from, to, stop, reached }];
});

function cityFlight(p: number) {
  return CITY_FLIGHTS.find((f) => p > f.from && p < f.to) ?? null;
}

export function xedineAt(p: number, out: THREE.Vector3) {
  const { index, beat, t } = beatAt(p);
  routeAt(beat.xedine.route, contentT(index, t), out);
  const travel = travelAt(p);
  if (travel && BEATS[travel.beat]!.hop) {
    // A hop in the same room: straight from its place to the next one while the camera turns.
    const from = BEATS[travel.beat]!.xedine.route;
    const next = BEATS[travel.beat + 1]!.xedine.route[0]!.pos;
    out
      .set(...toThree(from[from.length - 1]!.pos))
      .lerp(
        new THREE.Vector3(...toThree(next)),
        smooth((p - travel.from) / (travel.to - travel.from)),
      );
    return keepClear(p, out);
  }
  const lead = leadAt(p);
  if (!lead) return out;
  const leave = smooth((p - lead.from) / RAMP);
  const flight = cityFlight(p);
  if (flight) {
    // Out through the window ahead of the camera, then it glides to its spot above the street and waits
    // there while the camera climbs over it: no turning back, no pushing aside.
    const q = aheadOnRoad(p, LEAD, flight.stop);
    const road = new THREE.Vector3();
    trackAt(q, road, new THREE.Vector3());
    road.y -= FLOAT_BELOW;
    road.lerp(lead.end, smooth(1 - (roadAt(flight.stop) - roadAt(q)) / LEAD));
    return out.copy(lead.start).lerp(road, leave);
  }
  // On the road: a point ahead of the camera, never closer than it should be where the road bends.
  const cam = new THREE.Vector3();
  const spare = new THREE.Vector3();
  trackAt(p, cam, spare);
  let q = aheadOnRoad(p, LEAD, lead.to);
  const road = new THREE.Vector3();
  trackAt(q, road, spare);
  for (let k = 0; k < 60 && q < lead.to && road.distanceTo(cam) < LEAD * 0.9; k++) {
    q = Math.min(lead.to, q + STEP);
    trackAt(q, road, spare);
  }
  road.y -= FLOAT_BELOW;
  // Toward the road's end (or once the camera is near its next place) it turns off to its place in the next
  // moment, and waits there while the camera arrives and turns to the view.
  const remaining = roadAt(lead.to) - roadAt(p);
  const late = p > (lead.from + lead.to) / 2;
  const near = late ? smooth(2 - cam.distanceTo(lead.end) / LEAD) : 0;
  const settle = Math.max(remaining < LEAD * 2 ? smooth(1 - remaining / (LEAD * 2)) : 0, near);
  road.lerp(lead.end, settle);
  // Leaving: from its place onto the road.
  out.copy(lead.start).lerp(road, leave);
  return keepClear(p, out);
}

/** How much the camera looks at Xedine instead of its key (1 on the road, 0 at the moments). */
function followAt(p: number) {
  const lead = leadAt(p);
  if (!lead) return 0;
  const flight = cityFlight(p);
  // Up to the city the camera lets go of Xedine before it reaches it, and looks where it climbs.
  if (flight)
    return smooth((p - lead.from) / RAMP) * (1 - smooth((p - (flight.reached - RAMP)) / RAMP));
  return smooth((p - lead.from) / RAMP) * (1 - smooth((p - (lead.to - RAMP)) / RAMP));
}

/** The camera this frame: on its track, looking where the moment looks, or at Xedine on the road. */
export function cameraAt(p: number, pos: THREE.Vector3, look: THREE.Vector3) {
  const lens = trackAt(p, pos, look);
  const follow = followAt(p);
  if (follow > 0) {
    xedineAt(p, tmpA);
    tmpA.y += XEDINE_MIDDLE;
    look.lerp(tmpA, follow);
  }
  return lens;
}

export function xedineLook(p: number): THREE.Vector3 | null {
  const { beat } = beatAt(p);
  return beat.xedine.look ? v3(beat.xedine.look) : null;
}

/** The page's camera from the track (StoryCamera and the framing test share it). */
export function frameCamera(
  camera: THREE.PerspectiveCamera,
  pos: THREE.Vector3,
  look: THREE.Vector3,
  lens: { fov: number; fit: number; fitH: number },
  width: number,
  height: number,
) {
  const aspect = width / Math.max(1, height);
  camera.position.copy(pos);
  camera.lookAt(look);
  const fov = lens.fov;
  const tan = Math.tan(THREE.MathUtils.degToRad(fov) / 2);
  const toFov = (halfTan: number) => THREE.MathUtils.radToDeg(2 * Math.atan(halfTan));
  let next = fov;
  if (aspect < 1) {
    // An upright phone keeps the part of the wide shot that is free of the card (everyone in it), so its
    // view is taller: the angle opens until that width fits.
    next = THREE.MathUtils.clamp(toFov((0.72 * tan * (16 / 9)) / aspect), fov, 104);
    // A close look at a screen or a phone fills the phone instead: its width, and its height above the card.
    if (lens.fit > 0.01) {
      const dist = Math.max(0.05, pos.distanceTo(look));
      const byWidth = lens.fit / 2 / 0.66 / dist / aspect;
      const byHeight = lens.fitH / 0.52 / 2 / dist;
      const tight = THREE.MathUtils.clamp(toFov(Math.max(byWidth, byHeight)), 18, 104);
      next = THREE.MathUtils.lerp(next, tight, THREE.MathUtils.clamp(lens.fit / 0.12, 0, 1));
    }
  } else if (aspect < 16 / 9) {
    // A squarer window keeps the authored width.
    next = THREE.MathUtils.clamp(toFov((tan * (16 / 9)) / aspect), fov, 80);
  }
  const near = THREE.MathUtils.clamp(pos.y / 80, 0.05, 2);
  // The moment's card sits on the left (wide screens) or along the bottom (phones): frame the subject in
  // the free part of the screen by shifting the view, not the camera.
  const ox = aspect > 1.15 ? -width * 0.16 : 0;
  const oy = aspect < 0.85 ? height * 0.17 : 0;
  let dirty =
    Math.abs(camera.fov - next) > 0.01 ||
    Math.abs(camera.near - near) > 0.001 ||
    Math.abs(camera.aspect - aspect) > 1e-4;
  camera.fov = next;
  camera.near = near;
  camera.aspect = aspect;
  const view = camera.view;
  if (
    !view ||
    view.offsetX !== ox ||
    view.offsetY !== oy ||
    view.fullWidth !== width ||
    view.fullHeight !== height
  ) {
    camera.setViewOffset(width, height, ox, oy, width, height);
    dirty = false;
  }
  if (dirty) camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

export type CastState = {
  visible: boolean;
  pos: THREE.Vector3;
  /** Facing in radians (three.js Y rotation), or null to face the camera. */
  face: number | null;
  pose: Pose;
  props: string[];
  phone: Show | null;
};

const HIDDEN: CastState = {
  visible: false,
  pos: new THREE.Vector3(),
  face: 0,
  pose: 'idle',
  props: [],
  phone: null,
};

function placed(b: Blocking, t: number): CastState {
  const at = v3(b.at);
  return {
    visible: true,
    pos: b.to ? at.lerp(v3(b.to), smooth(t)) : at,
    face: b.face === undefined ? null : THREE.MathUtils.degToRad(b.face),
    pose: b.pose ?? 'idle',
    props: b.props ?? [],
    phone: b.phone ?? null,
  };
}

/** From one place to another across the travel (f 0..1): they glide, and take the new pose halfway. */
function between(from: CastState, to: CastState, f: number): CastState {
  const pos = from.pos.clone().lerp(to.pos, f);
  return { ...(f < 0.5 ? from : to), pos, visible: true };
}

/** Each person's wish, before visibility is timed: their beat, their way to the next one, or their usual spot. */
function wantedAt(id: CastId, p: number): CastState {
  const travel = travelAt(p);
  if (travel) {
    const f = smooth((p - travel.from) / (travel.to - travel.from));
    const a = BEATS[travel.beat]!.cast.find((c) => c.id === id);
    const b = BEATS[travel.beat + 1]!.cast.find((c) => c.id === id);
    const before = a ? placed(a, 1) : homeAt(id, travel.beat);
    const after = b ? placed(b, 0) : homeAt(id, travel.beat + 1);
    // Needed next: on their way, or already there while the camera travels (out of sight, see `showing`).
    if (after && before) return between(before, after, f);
    if (after) return after;
    // Not needed next: they stay until the camera has gone.
    if (before) return f < 0.5 ? before : HIDDEN;
  }
  const { index, beat, t } = beatAt(p);
  const here = beat.cast.find((c) => c.id === id);
  if (here) return placed(here, contentT(index, t));
  return homeAt(id, index) ?? HIDDEN;
}

function homeAt(id: CastId, index: number): CastState | null {
  const home = HOME[id];
  if (!home || index < home.from || index > home.until || home.away?.includes(index)) return null;
  return {
    visible: true,
    pos: v3(home.at),
    face: home.face === undefined ? null : THREE.MathUtils.degToRad(home.face),
    pose: home.pose,
    props: id === 'cook' ? ['spatula'] : [],
    phone: null,
  };
}

/** A person's box (three.js), for "can the camera see them?". */
export function personBox(id: CastId, pos: THREE.Vector3, out = new THREE.Box3()) {
  const s = CAST_SIZE[id] * 0.78;
  return out.set(
    new THREE.Vector3(pos.x - 0.56 * s, pos.y + 0.02, pos.z - 0.56 * s),
    new THREE.Vector3(pos.x + 0.56 * s, pos.y + 1.26 * s, pos.z + 0.56 * s),
  );
}

/** Xedine's box (three.js) at its origin. */
export function xedineBox(pos: THREE.Vector3, out = new THREE.Box3()) {
  return out.set(
    new THREE.Vector3(pos.x - 0.34, pos.y + 0.12, pos.z - 0.34),
    new THREE.Vector3(pos.x + 0.34, pos.y + 0.84, pos.z + 0.34),
  );
}

const CORNERS = Array.from({ length: 8 }, () => new THREE.Vector3());

/** How much of a box the camera shows: 'all', 'none' or 'part' (inside the given part of the picture). */
export function boxInView(
  camera: THREE.PerspectiveCamera,
  box: THREE.Box3,
  area = { x0: 0, x1: 1, y0: 0, y1: 1 },
): 'all' | 'none' | 'part' {
  const { min, max } = box;
  let i = 0;
  for (const x of [min.x, max.x])
    for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) CORNERS[i++]!.set(x, y, z);
  let inside = 0;
  let behind = 0;
  const view = new THREE.Vector3();
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const c of CORNERS) {
    view.copy(c).applyMatrix4(camera.matrixWorldInverse);
    if (view.z > -camera.near) {
      behind++;
      continue;
    }
    c.project(camera);
    const sx = (c.x + 1) / 2;
    const sy = (1 - c.y) / 2;
    x0 = Math.min(x0, sx);
    x1 = Math.max(x1, sx);
    y0 = Math.min(y0, sy);
    y1 = Math.max(y1, sy);
    if (sx >= area.x0 && sx <= area.x1 && sy >= area.y0 && sy <= area.y1) inside++;
  }
  if (behind === 8) return 'none';
  // A speck far below (the café from above the city) is not a person you can see appear.
  if (behind === 0 && x1 - x0 < 0.012 && y1 - y0 < 0.012) return 'none';
  if (inside === 8) return 'all';
  // Entirely off one side of the picture (or behind the camera on the rest): not seen.
  if (behind === 0 && (x1 < area.x0 || x0 > area.x1 || y1 < area.y0 || y0 > area.y1)) return 'none';
  if (behind > 0 && inside === 0 && (x1 < area.x0 || x0 > area.x1 || y1 < area.y0 || y0 > area.y1))
    return 'none';
  return 'part';
}

/** The two screens the story is drawn for: a wide one (card on the left) and an upright phone. */
export const VIEWS = [
  { width: 1600, height: 900 },
  { width: 390, height: 844 },
] as const;

/** When each person shows: they pop in and out only where the camera cannot see them. */
let showing: Map<CastId, [number, number][]> | null = null;

function seen(id: CastId, p: number, pos: THREE.Vector3, cams: THREE.PerspectiveCamera[]) {
  const lens = cameraAt(p, tmpPos, tmpLook);
  const box = personBox(id, pos);
  return cams.some((cam, i) => {
    frameCamera(cam, tmpPos, tmpLook, lens, VIEWS[i]!.width, VIEWS[i]!.height);
    return boxInView(cam, box) !== 'none';
  });
}

const SHOW_STEP = 0.004;

/** The raw spans (in steps) when a person is wanted on stage. */
function wantedSpans(id: CastId, n: number) {
  const spans: [number, number][] = [];
  let open = -1;
  for (let i = 0; i <= n; i++) {
    const on = wantedAt(id, i * SHOW_STEP).visible;
    if (on && open < 0) open = i;
    if (!on && open >= 0) {
      spans.push([open, i - 1]);
      open = -1;
    }
  }
  if (open >= 0) spans.push([open, n]);
  return spans;
}

/**
 * When each person shows, in p: every entrance moved earlier and every exit later (up to 0.6 of a beat, never
 * into their other appearances) until the camera cannot see the spot, so nobody pops in or out in view.
 */
export function showingSpans(): Map<CastId, [number, number][]> {
  if (showing) return showing;
  const out = new Map<CastId, [number, number][]>();
  const cams = VIEWS.map(() => new THREE.PerspectiveCamera(44, 16 / 9, 0.05, 4000));
  const n = Math.floor(LAST / SHOW_STEP);
  for (const id of CAST_IDS) {
    const raw = wantedSpans(id, n);
    const spans: [number, number][] = [];
    raw.forEach(([i, j], k) => {
      const floor = k > 0 ? raw[k - 1]![1] + 2 : 0;
      const ceil = k + 1 < raw.length ? raw[k + 1]![0] - 2 : n;
      const posIn = wantedAt(id, i * SHOW_STEP).pos;
      const hidden = (k: number, pos: THREE.Vector3) => !seen(id, k * SHOW_STEP, pos, cams);
      /** The nearest step to `from` (within `lo`..`hi`) where the camera cannot see `pos`. */
      const nearestHidden = (from: number, lo: number, hi: number, pos: THREE.Vector3) => {
        for (let d = 0; d < 150; d++) {
          if (from - d >= lo && hidden(from - d, pos)) return from - d;
          if (from + d <= hi && hidden(from + d, pos)) return from + d;
        }
        return from;
      };
      // Each entrance and exit moves to the nearest moment the camera cannot see the spot.
      const a = nearestHidden(i, floor, j, posIn);
      const posOut = wantedAt(id, j * SHOW_STEP).pos;
      const e = nearestHidden(j, a, ceil, posOut);
      spans.push([a * SHOW_STEP, e * SHOW_STEP]);
    });
    out.set(id, spans);
  }
  showing = out;
  return out;
}

/** Each person's place this moment: from the beat that is playing, else their usual spot while at work. */
export function castAt(id: CastId, p: number): CastState {
  const spans = showingSpans().get(id) ?? [];
  const span = spans.find(([a, b]) => p >= a - 1e-6 && p <= b + SHOW_STEP);
  if (!span) return HIDDEN;
  const want = wantedAt(id, p);
  if (want.visible) return want;
  // Shown a little sooner (or kept a little longer) where they are about to be (or were), out of the
  // camera's sight: the nearest moment they are wanted.
  const sooner = Math.abs(p - span[0]) < Math.abs(p - span[1]);
  for (let k = 1; k < 160; k++) {
    const q = sooner ? p + k * SHOW_STEP : p - k * SHOW_STEP;
    const s = wantedAt(id, q);
    if (s.visible) return s;
  }
  return HIDDEN;
}

/** What each fixed screen shows now, and its moment (0..1). */
export function screenAt(id: ScreenId, p: number): { show: Show; t: number } {
  const { beat, t } = beatAt(p);
  const show = beat.screens[id];
  if (show) return { show, t };
  // Between their moments the screens keep their last state, as a real café's screens would.
  const defaults: Partial<Record<ScreenId, Show>> = {
    till: 'till',
    kds: 'kds',
    poster: 'poster',
    stock: 'stockUp',
  };
  return { show: defaults[id] ?? 'idle', t: 1 };
}

/** The office window: open from the money moment until the owner sits down after the city (0..1). */
export function windowOpen(p: number) {
  const leaks = BEATS.findIndex((b) => b.id === 'leaks');
  const ask = BEATS.findIndex((b) => b.id === 'ask');
  return smooth((p - (leaks + OUT - 0.05)) / 0.1) * (1 - smooth((p - (ask + OUT + 0.08)) / 0.12));
}

/** The dropped fries: on the floor from the moment the cook drops them until the waste is counted. */
export function friesShown(p: number) {
  const stock = BEATS.findIndex((b) => b.id === 'stock');
  const { index, t } = beatAt(p);
  return index === stock && t > 0.32;
}
