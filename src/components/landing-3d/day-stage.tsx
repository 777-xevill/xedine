'use client';

import { Environment } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { type RefObject, Suspense, useCallback, useRef, useState } from 'react';
import * as THREE from 'three';
import { Cast } from './cast';
import { City, type BranchLabel, type CountryPin } from './city';
import type { ScreenText } from './screens';
import type { CastId } from './story';
import { beatAt, cameraAt, frameCamera, timeOfDay, xedineAt, xedineLook } from './timeline';
import { World, ZONES } from './world';
import { Xedine, type XedineHandle } from './xedine';
import { landingAsset } from './asset-version';

const ENV_DAY = landingAsset('env-cafe-day.jpg');

/** How much of the city and of the globe to show (the countries moment). */
type Show = { city: number; globe: number };

const SKY_DAY = new THREE.Color(0.74, 0.84, 0.94);
const SKY_DAWN = new THREE.Color(0.95, 0.76, 0.66);
const SKY_NIGHT = new THREE.Color(0.035, 0.05, 0.09);

/**
 * The story's camera: it eases toward the scroll's progress (shared with everything through `easedRef`), flies
 * the track, leans a little with the pointer, and widens its angle on an upright phone.
 */
function StoryCamera({
  targetRef,
  easedRef,
  showRef,
  phonesRef,
}: {
  targetRef: RefObject<number>;
  easedRef: RefObject<number>;
  showRef: RefObject<Show>;
  phonesRef: RefObject<Map<CastId, THREE.Vector3>>;
}) {
  const lean = useRef({ x: 0, y: 0 });
  const still = useRef(
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const tmp = useRef({
    pos: new THREE.Vector3(),
    look: new THREE.Vector3(),
    right: new THREE.Vector3(),
  });
  useFrame((state, delta) => {
    const dt = Math.min(delta, 1 / 20);
    const goal = targetRef.current ?? 0;
    let p = still.current ? goal : THREE.MathUtils.damp(easedRef.current ?? goal, goal, 5, dt);
    if (Math.abs(p - goal) < 1e-4) p = goal;
    easedRef.current = p;
    const camera = state.camera as THREE.PerspectiveCamera;
    const { pos, look, right } = tmp.current;
    const lens = cameraAt(p, pos, look);
    // A close look at a phone aims at the phone itself: each person holds it a little differently.
    if (lens.fit > 0.01 && lens.fit < 0.2) {
      let nearest: THREE.Vector3 | null = null;
      for (const at of phonesRef.current.values())
        if (
          at.distanceTo(look) < 0.45 &&
          (!nearest || at.distanceTo(look) < nearest.distanceTo(look))
        )
          nearest = at;
      if (nearest) {
        const shift = tmp.current.right
          .subVectors(nearest, look)
          .multiplyScalar(Math.min(1, lens.fit / 0.12));
        pos.add(shift);
        look.add(shift);
      }
    }
    const l = lean.current;
    l.x = still.current ? 0 : THREE.MathUtils.damp(l.x, state.pointer.x, 2.2, dt);
    l.y = still.current ? 0 : THREE.MathUtils.damp(l.y, state.pointer.y, 2.2, dt);
    right.subVectors(look, pos).cross(camera.up).normalize();
    // A little lean with the pointer, then the story's lens (the framing test checks the same one).
    pos.addScaledVector(right, l.x * 0.1);
    pos.y += l.y * 0.05;
    frameCamera(camera, pos, look, lens, state.size.width, state.size.height);
    // The city fades in above the roofs and out again as the globe appears.
    const { city } = timeOfDay(p);
    showRef.current.city = city * (1 - THREE.MathUtils.smoothstep(pos.y, 220, 330));
    showRef.current.globe = city * THREE.MathUtils.smoothstep(pos.y, 140, 330);
  });
  return null;
}

function Atmosphere({ easedRef }: { easedRef: RefObject<number> }) {
  const hemi = useRef<THREE.HemisphereLight>(null);
  const sun = useRef<THREE.DirectionalLight>(null);
  const fog = useRef(new THREE.Fog(SKY_NIGHT.clone(), 120, 1e6));
  const sky = useRef(new THREE.Color());
  useFrame((state) => {
    const { hour, night, city } = timeOfDay(easedRef.current ?? 0);
    const dawn = THREE.MathUtils.clamp((7.5 - hour) / 1.5, 0, 1);
    sky.current.copy(SKY_DAY).lerp(SKY_DAWN, dawn).lerp(SKY_NIGHT, night);
    state.scene.background = sky.current;
    state.scene.environmentIntensity = THREE.MathUtils.lerp(1, 0.3, night);
    state.scene.fog = fog.current;
    fog.current.color.copy(sky.current);
    fog.current.far = city > 0.01 ? THREE.MathUtils.lerp(1e6, 900, city) : 1e6;
    if (hemi.current) hemi.current.intensity = THREE.MathUtils.lerp(0.9, 0.35, night);
    if (sun.current) sun.current.intensity = THREE.MathUtils.lerp(1.3, 0, night) * (1 - 0.4 * dawn);
  });
  return (
    <>
      <hemisphereLight
        ref={hemi}
        args={[new THREE.Color(1, 0.97, 0.92), new THREE.Color(0.42, 0.36, 0.3), 0.9]}
      />
      <directionalLight
        ref={sun}
        position={[-4.9, 3, 1.7]}
        intensity={1.3}
        color={new THREE.Color(1, 0.94, 0.85)}
      />
    </>
  );
}

/** Xedine in the story: at its place in each moment, leading the way in between; it waves or points once. */
function StoryXedine({ easedRef }: { easedRef: RefObject<number> }) {
  const group = useRef<THREE.Group>(null);
  const handle = useRef<XedineHandle>(null);
  const look = useRef<THREE.Vector3 | null>(null);
  const placed = useRef({ beat: -1, played: false, ready: false });
  const tmp = useRef(new THREE.Vector3());
  useFrame((state, delta) => {
    const g = group.current;
    if (!g) return;
    const p = easedRef.current ?? 0;
    const dt = Math.min(delta, 1 / 20);
    xedineAt(p, tmp.current);
    if (!placed.current.ready) {
      g.position.copy(tmp.current);
      placed.current.ready = true;
    } else {
      g.position.x = THREE.MathUtils.damp(g.position.x, tmp.current.x, 10, dt);
      g.position.y = THREE.MathUtils.damp(g.position.y, tmp.current.y, 10, dt);
      g.position.z = THREE.MathUtils.damp(g.position.z, tmp.current.z, 10, dt);
    }
    const cam = state.camera.position;
    const yaw = Math.atan2(cam.x - g.position.x, cam.z - g.position.z);
    const diff =
      THREE.MathUtils.euclideanModulo(yaw - g.rotation.y + Math.PI, Math.PI * 2) - Math.PI;
    g.rotation.y += diff * (1 - Math.exp(-5 * dt));
    look.current = xedineLook(p);
    const { index, beat, t, inside } = beatAt(p);
    if (index !== placed.current.beat) {
      placed.current.beat = index;
      placed.current.played = false;
    }
    if (!placed.current.played && inside && t > 0.12 && beat.xedine.move) {
      handle.current?.play(beat.xedine.move);
      placed.current.played = true;
    }
  });
  return (
    <group ref={group}>
      <Xedine ref={handle} target={look} scale={0.5} />
    </group>
  );
}

export type StageProps = {
  targetRef: RefObject<number>;
  easedRef: RefObject<number>;
  text: ScreenText;
  showCity: boolean;
  /** Once the first view is whole (the street and the café): the 3D fades in over the picture. */
  onReady?: () => void;
  city: {
    branches: BranchLabel[];
    waiting: string;
    peers: string;
    home: CountryPin;
    countries: CountryPin[];
  };
};

/** The day, live (ADR 0064): the baked café world, its screens, the people, Xedine, the city and the globe. */
export default function DayStage({
  targetRef,
  easedRef,
  text,
  showCity,
  onReady,
  city,
}: StageProps) {
  const showRef = useRef<Show>({ city: 0, globe: 0 });
  // The people's file waits for the street, so the first picture comes first.
  const [street, setStreet] = useState(false);
  const onStreet = useCallback(() => setStreet(true), []);
  const phonesRef = useRef(new Map<CastId, THREE.Vector3>());
  return (
    <Canvas
      dpr={[1, 1.6]}
      camera={{ fov: 44, near: 0.05, far: 4000, position: [1.2, 1.9, 15.5] }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.NeutralToneMapping;
        gl.toneMappingExposure = 1;
      }}
    >
      <StoryCamera
        targetRef={targetRef}
        easedRef={easedRef}
        showRef={showRef}
        phonesRef={phonesRef}
      />
      <Atmosphere easedRef={easedRef} />
      <World
        progressRef={easedRef}
        text={text}
        zones={ZONES}
        onStreet={onStreet}
        onFirstView={onReady}
      />
      {street && (
        <Suspense fallback={null}>
          <Cast progressRef={easedRef} text={text} phonesRef={phonesRef} />
        </Suspense>
      )}
      <Suspense fallback={null}>
        <StoryXedine easedRef={easedRef} />
      </Suspense>
      <Suspense fallback={null}>
        <Environment files={ENV_DAY} />
      </Suspense>
      {showCity && (
        <Suspense fallback={null}>
          <City showRef={showRef} {...city} />
        </Suspense>
      )}
    </Canvas>
  );
}
