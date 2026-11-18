import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BEAT_SCROLL_VH, BEAT_VH, BEATS, IN, OUT, scrollToP, STORY_VH } from './story';
import { cameraAt } from './timeline';

/**
 * The camera never rushes between two rooms (the founder, 2026-11-18: after the first phone screen, one flick
 * flew from the street to the storeroom). Measured as metres the camera moves per screen height of scroll.
 */

/** Where in the scroll (screen heights) the story reaches p. */
function scrollAt(p: number) {
  let lo = 0;
  let hi = STORY_VH;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (scrollToP(mid) < p) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** The fastest the camera moves on the road out of beat b, in metres per screen height of scroll. */
function topSpeed(b: number) {
  const from = scrollAt(b + OUT);
  const to = scrollAt(b + 1 + IN);
  const step = 0.5;
  const a = new THREE.Vector3();
  const c = new THREE.Vector3();
  const look = new THREE.Vector3();
  let top = 0;
  cameraAt(scrollToP(from), a, look);
  for (let vh = from + step; vh <= to; vh += step) {
    cameraAt(scrollToP(vh), c, look);
    top = Math.max(top, (a.distanceTo(c) / step) * 100);
    a.copy(c);
  }
  return top;
}

describe('pace of the day', () => {
  it('maps scroll to the story without gaps or going back', () => {
    let last = 0;
    for (let vh = 0; vh <= STORY_VH; vh += 0.5) {
      const p = scrollToP(vh);
      expect(p).toBeGreaterThanOrEqual(last);
      expect(p - last).toBeLessThan(0.02);
      last = p;
    }
    expect(scrollToP(STORY_VH)).toBeCloseTo(BEATS.length, 5);
    // The first moment scrolls as before: only the roads between rooms are longer.
    expect(scrollToP(OUT * BEAT_VH)).toBeCloseTo(OUT, 5);
    // Every moment's own part (IN to OUT) keeps its scroll.
    BEATS.forEach((_, b) => {
      expect(scrollAt(b + OUT) - scrollAt(b + IN)).toBeCloseTo((OUT - IN) * BEAT_VH, 3);
      expect(BEAT_SCROLL_VH[b]).toBeGreaterThanOrEqual(BEAT_VH - 1e-9);
    });
  });

  it('never rushes from room to room', () => {
    const rows: string[] = [];
    BEATS.forEach((beat, b) => {
      const next = BEATS[b + 1];
      if (!next || beat.city || next.city) return;
      const speed = topSpeed(b);
      rows.push(`${beat.id} -> ${next.id}: ${speed.toFixed(1)} m per screen of scroll`);
      // Before this rule the walk to the storeroom ran at 66 m per screen; the calm ones run under 16.
      expect(speed, `${beat.id} -> ${next.id}`).toBeLessThan(20);
    });
    if (process.env.PACE_REPORT) process.stderr.write(`${rows.join('\n')}\n`);
  });
});
