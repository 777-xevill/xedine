import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BEATS, type CamKey, CAST_IDS, toThree } from './story';
import {
  boxInView,
  cameraAt,
  castAt,
  frameCamera,
  IN,
  keyP,
  OUT,
  personBox,
  showingSpans,
  VIEWS,
  xedineAt,
  xedineBox,
} from './timeline';

/**
 * The founder's rule for the 3D day (2026-11-17): whoever the camera shows, it shows whole, head to floor, clear
 * of the moment's card; nobody pops in or out in view; Xedine stays in the picture from room to room; and a
 * close look at a screen or a phone makes it big enough to read.
 */

/** The free part of a wide screen (the card covers the left) and of an upright phone (the card, the bottom). */
const AREA = [
  { x0: 0.31, x1: 0.99, y0: 0.02, y1: 0.98 },
  { x0: 0.01, x1: 0.99, y0: 0.05, y1: 0.7 },
] as const;

const smooth = (x: number) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

function camera(p: number, view: (typeof VIEWS)[number]) {
  const pos = new THREE.Vector3();
  const look = new THREE.Vector3();
  const lens = cameraAt(p, pos, look);
  const cam = new THREE.PerspectiveCamera(44, 16 / 9, 0.05, 4000);
  frameCamera(cam, pos, look, lens, view.width, view.height);
  return cam;
}

/** How much of the picture a close key's subject fills (it faces the camera), and whether it is all in view. */
function subject(cam: THREE.PerspectiveCamera, key: CamKey, area: (typeof AREA)[number]) {
  const [w, h] = key.fit!;
  const c = new THREE.Vector3(...toThree(key.look));
  const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const sx of [-1, 1])
    for (const sy of [-1, 1]) {
      const v = c
        .clone()
        .addScaledVector(right, (sx * w) / 2)
        .addScaledVector(up, (sy * h) / 2)
        .project(cam);
      xs.push((v.x + 1) / 2);
      ys.push((1 - v.y) / 2);
    }
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return {
    inside: x0 >= area.x0 && x1 <= area.x1 && y0 >= area.y0 && y1 <= area.y1,
    width: x1 - x0,
    height: y1 - y0,
    where: `x ${x0.toFixed(2)}..${x1.toFixed(2)} y ${y0.toFixed(2)}..${y1.toFixed(2)}`,
  };
}

/** Which room a point (three.js) is in, by world.py's walls. */
function roomOf(v: THREE.Vector3) {
  const x = v.x;
  const y = -v.z;
  if (y < -4.7 || x < -4.15 || x > 9.6 || y > 6.25) return 'street';
  if (x < 4.15) return 'cafe';
  if (y >= 2.68) return 'store';
  if (y <= -1.1) return 'office';
  return 'kitchen';
}

/** Where a box falls in the picture (0..1 across and down). */
function rect(cam: THREE.PerspectiveCamera, box: THREE.Box3) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y])
      for (const z of [box.min.z, box.max.z]) {
        const v = new THREE.Vector3(x, y, z).project(cam);
        xs.push((v.x + 1) / 2);
        ys.push((1 - v.y) / 2);
      }
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

/** How tall a box looks, as a share of the picture's height. */
function boxHeight(cam: THREE.PerspectiveCamera, box: THREE.Box3) {
  const ys: number[] = [];
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y])
      for (const z of [box.min.z, box.max.z]) ys.push(new THREE.Vector3(x, y, z).project(cam).y);
  return (Math.max(...ys) - Math.min(...ys)) / 2;
}

function problemsAtKeys() {
  const out: string[] = [];
  BEATS.forEach((beat, b) => {
    beat.cam.forEach((key) => {
      const p = keyP(b, key.at);
      VIEWS.forEach((view, v) => {
        const cam = camera(p, view);
        const area = AREA[v]!;
        const where = `${beat.id} key ${key.at} (${v === 0 ? 'wide' : 'phone'})`;
        const wide = !key.fit && !key.pass;
        // A close look at a phone shows the hand and face behind it: only its holder may be partly seen.
        const phone = key.fit && key.fit[0] < 0.2;
        // Everyone the camera can see, the moment's people and those at work in the background alike.
        for (const id of CAST_IDS) {
          const s = castAt(id, p);
          if (!s.visible) continue;
          if (phone && beat.cast.some((c) => c.id === id && c.phone)) continue;
          // Behind a wall (another room), or far off through a doorway, nobody is cut by the picture.
          if (!beat.cast.some((c) => c.id === id)) {
            if (roomOf(s.pos) !== roomOf(cam.position)) continue;
            if (boxHeight(cam, personBox(id, s.pos)) < 0.12) continue;
          }
          const seen = boxInView(cam, personBox(id, s.pos), area);
          if (seen === 'part') out.push(`${where}: ${id} is cut`);
        }
        const x = xedineAt(p, new THREE.Vector3());
        // Nobody stands in front of anybody else in a wide view (Xedine included).
        if (wide && v === 0) {
          const subjects = [
            ...beat.cast.map((c) => ({
              id: c.id as string,
              box: personBox(c.id, castAt(c.id, p).pos),
            })),
            { id: 'Xedine', box: xedineBox(x) },
          ]
            .filter((s) => boxInView(cam, s.box, area) === 'all')
            .map((s) => ({
              ...s,
              ...rect(cam, s.box),
              d: cam.position.distanceTo(s.box.getCenter(new THREE.Vector3())),
            }));
          for (const near of subjects)
            for (const far of subjects) {
              if (near === far || near.d >= far.d) continue;
              const w = Math.min(near.x1, far.x1) - Math.max(near.x0, far.x0);
              const h = Math.min(near.y1, far.y1) - Math.max(near.y0, far.y0);
              const covered =
                w > 0 && h > 0 ? (w * h) / ((far.x1 - far.x0) * (far.y1 - far.y0)) : 0;
              if (covered > 0.3) out.push(`${where}: ${near.id} hides ${far.id}`);
            }
        }
        const seenX = boxInView(cam, xedineBox(x), area);
        if (seenX === 'part') out.push(`${where}: Xedine is cut`);
        // Every moment opens on Xedine; later in a moment it may step out of a view.
        if (wide && v === 0 && key === beat.cam[0] && seenX === 'none' && !beat.city)
          out.push(`${where}: Xedine is not in the picture`);
        if (key.fit) {
          const s = subject(cam, key, area);
          if (!s.inside) out.push(`${where}: the screen is not all in view (${s.where})`);
          // The scale's display shows one big number: a small display still reads.
          const need = key.fit[0] < 0.1 ? 0.5 : 1;
          const readable =
            (v === 0
              ? Math.max(s.width / 0.28, s.height / 0.55)
              : Math.max(s.width / 0.62, s.height / 0.42)) / need;
          if (readable < 1)
            out.push(
              `${where}: the screen is small (${s.width.toFixed(2)} × ${s.height.toFixed(2)})`,
            );
        }
      });
    });
  });
  return out;
}

/** From room to room Xedine leads and stays whole in the picture; within a room it never brushes the lens. */
function problemsOnTheRoad() {
  const out: string[] = [];
  const name = (b: number) => `${BEATS[b]!.id} → ${BEATS[b + 1]!.id}`;
  BEATS.forEach((beat, b) => {
    if (b + 1 >= BEATS.length || beat.city || BEATS[b + 1]!.city) return;
    if (beat.hop) {
      for (let p = b + OUT; p <= b + 1 + IN; p += 0.005) {
        const cam = camera(p, VIEWS[0]);
        const x = xedineAt(p, new THREE.Vector3());
        const near = cam.position.distanceTo(x.clone().setY(x.y + 0.48)) < 1.2;
        if (near && boxInView(cam, xedineBox(x)) !== 'none') {
          out.push(`${name(b)} at ${p.toFixed(3)}: Xedine passes too close to the camera`);
          break;
        }
      }
      return;
    }
    // The open road: after the camera has turned to follow, until it turns to the next moment.
    for (let p = b + OUT + 0.16; p <= b + 1 + IN - 0.08; p += 0.005) {
      const cam = camera(p, VIEWS[0]);
      const x = xedineAt(p, new THREE.Vector3());
      const seen = boxInView(cam, xedineBox(x), { x0: 0.3, x1: 1, y0: 0, y1: 1 });
      if (seen !== 'all') {
        out.push(
          `${name(b)} at ${p.toFixed(3)}: Xedine is ${seen === 'none' ? 'out of' : 'cut by'} the picture`,
        );
        break;
      }
    }
  });
  return out;
}

function problemsPopping() {
  const out: string[] = [];
  const spans = showingSpans();
  for (const id of CAST_IDS) {
    for (const [a, b] of spans.get(id) ?? []) {
      for (const [edge, kind] of [
        [a, 'appears'],
        [b, 'leaves'],
      ] as const) {
        if (edge <= 0.001 || edge >= BEATS.length - 0.01) continue;
        const s = castAt(id, edge);
        const shown = VIEWS.some((view) =>
          ['all', 'part'].includes(boxInView(camera(edge, view), personBox(id, s.pos))),
        );
        if (shown) out.push(`${id} ${kind} in view at ${edge.toFixed(3)}`);
      }
    }
  }
  return out;
}

describe('the 3D day frames its people (the founder, 2026-11-17)', () => {
  it('shows everyone whole at every moment, and every close look readable', () => {
    expect(problemsAtKeys()).toEqual([]);
  });
  it('keeps Xedine in the picture from room to room', () => {
    expect(problemsOnTheRoad()).toEqual([]);
  });
  it('never pops anyone in or out in view', () => {
    expect(problemsPopping()).toEqual([]);
  });
  it('moves the travel so it is slow enough to follow', () => {
    expect(1 + IN - OUT).toBeGreaterThanOrEqual(0.4);
    void smooth;
  });
});
