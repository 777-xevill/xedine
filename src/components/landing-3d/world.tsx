'use client';

import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import {
  type RefObject,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import * as THREE from 'three';
import { createScreen, planeUv, SCREEN_SIZES, type ScreenText } from './screens';
import { type ScreenId, toThree, type V3 } from './story';
import { friesShown, screenAt, timeOfDay, windowOpen } from './timeline';
import { landingAsset } from './asset-version';

/** Built by scripts/landing-3d/world.py + bake.py + pack.mjs (ADR 0064): one file per zone. */
export const ZONES = ['st', 'ca', 'ki', 'sr', 'of'] as const;
export type Zone = (typeof ZONES)[number];
export const zoneUrl = (z: Zone) => landingAsset(`world-${z}.glb`);
const NIGHT_URL = (atlas: string) => landingAsset(`night/${atlas}.webp`);

/**
 * From which point of the story (p) each zone may load: the café shows through the windows at dawn; the
 * kitchen and the storeroom are on the way to the bazar (moment 3); the office is moment 6.
 */
const ZONE_FROM: Record<Zone, number> = { st: 0, ca: 0, ki: 0.35, sr: 0.35, of: 3 };

/** Shared by every baked surface: how far into the night, and the light's colour (dawn is warm). */
export const LIGHT = { uNight: { value: 0 }, uTint: { value: new THREE.Color(1, 1, 1) } };

const loader = new THREE.TextureLoader();
const nightMaps = new Map<string, THREE.Texture>();

function nightMap(atlas: string) {
  let tex = nightMaps.get(atlas);
  if (!tex) {
    tex = loader.load(NIGHT_URL(atlas));
    tex.flipY = false; // glTF's UVs
    tex.colorSpace = THREE.SRGBColorSpace;
    nightMaps.set(atlas, tex);
  }
  return tex;
}

/** An unlit baked surface: the day picture, blended toward the night picture as the day ends. */
function bakedMaterial(day: THREE.Texture | null, atlas: string) {
  const mat = new THREE.MeshBasicMaterial({ map: day, toneMapped: false });
  const night = nightMap(atlas);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = LIGHT.uNight;
    shader.uniforms.uTint = LIGHT.uTint;
    shader.uniforms.nightMap = { value: night };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uNight;\nuniform vec3 uTint;\nuniform sampler2D nightMap;',
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        vec4 nightColor = texture2D(nightMap, vMapUv);
        diffuseColor.rgb = mix(diffuseColor.rgb * uTint, nightColor.rgb * 0.86, uNight);`,
      );
  };
  mat.customProgramCacheKey = () => 'baked-day-night';
  return mat;
}

type Screens = Partial<Record<ScreenId, ReturnType<typeof createScreen>>>;

const WARM = new THREE.Color(1, 0.86, 0.66);

function ZoneModel({
  zone,
  screens,
  live,
  onLoaded,
}: {
  zone: Zone;
  screens: Screens;
  live: RefObject<LiveParts>;
  onLoaded: (zone: Zone) => void;
}) {
  const { scene } = useGLTF(zoneUrl(zone), false, true);
  // Tells the world this zone is in, so the next one starts loading (one at a time, the street first).
  useEffect(() => onLoaded(zone), [onLoaded, zone]);
  useLayoutEffect(() => {
    const hinged: THREE.Mesh[] = [];
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      const name = mesh.name;
      if (mat.name.startsWith('MAT_BK_')) {
        mesh.material = bakedMaterial(mat.map, mat.name.slice('MAT_BK_'.length));
        return;
      }
      const screenId = name.startsWith('SM_Screen_')
        ? (name.slice(10).toLowerCase() as ScreenId)
        : null;
      if (screenId && screens[screenId]) {
        planeUv(mesh);
        mesh.material = new THREE.MeshBasicMaterial({
          map: screens[screenId]!.texture,
          toneMapped: false,
        });
        return;
      }
      const parts = live.current;
      if (!parts) return;
      if (name.startsWith('SM_Sign_Letters')) {
        const m = new THREE.MeshStandardMaterial({
          color: mat.color,
          roughness: 0.35,
          emissive: WARM,
          emissiveIntensity: 0,
        });
        mesh.material = m;
        parts.glow.push(m);
      } else if (name.startsWith('SM_Sign_Logo') || name.startsWith('SM_Decal_')) {
        const m = new THREE.MeshBasicMaterial({
          map: mat.map,
          transparent: true,
          depthWrite: false,
          toneMapped: false,
        });
        mesh.material = m;
        if (name.startsWith('SM_Sign_Logo')) parts.logo.push(m);
      } else if (name.startsWith('SM_Live_Lamp_Glow')) {
        const m = new THREE.MeshBasicMaterial({
          color: new THREE.Color(1, 0.85, 0.6),
          transparent: true,
          opacity: 0,
        });
        mesh.material = m;
        parts.lamps.push(m);
      } else if (name.startsWith('SM_Pendant_Globe') || name.startsWith('SM_Pendant_Glass')) {
        mesh.material = new THREE.MeshStandardMaterial({
          color: WARM,
          emissive: WARM,
          emissiveIntensity: 1.7,
          roughness: 0.55,
        });
      } else if (name.startsWith('SM_Clock_Hand_')) {
        (name.includes('Hour') ? parts.hourHands : parts.minuteHands).push(mesh);
      } else if (name.startsWith('SM_Live_Fries')) {
        // Golden even in the floor's shade (they're live, so the bake doesn't light them); the carton red.
        const carton = name.startsWith('SM_Live_Fries_Box');
        mesh.material = new THREE.MeshBasicMaterial({
          color: carton ? mat.color.clone().multiplyScalar(0.9) : new THREE.Color(0.93, 0.72, 0.33),
        });
        parts.fries.push(mesh);
        mesh.visible = false;
      } else if (name.startsWith('SM_Live_Office_')) {
        // The office window: two casements and the blinds, moved on their hinges (below).
        if (mat.transparent) {
          mat.depthWrite = false;
          mat.envMapIntensity = 1.4;
        }
        hinged.push(mesh);
      } else if (mat.transparent) {
        mat.depthWrite = false;
        mat.envMapIntensity = 1.4;
      }
    });
    // Each moving part turns about its own hinge (packing moved the meshes' origins to their middles, so
    // the hinge is a group of its own at the place world.py built it).
    const parts = live.current;
    if (parts && hinged.length) {
      scene.updateMatrixWorld(true);
      for (const [key, name, at] of HINGES) {
        let pivot = parts.hinges.get(key);
        if (!pivot) {
          pivot = new THREE.Group();
          pivot.position.set(...toThree(at));
          scene.add(pivot);
          pivot.updateMatrixWorld(true);
          parts.hinges.set(key, pivot);
        }
        for (const mesh of hinged)
          if (mesh.name === name || mesh.name.startsWith(`${name}_`)) pivot.attach(mesh);
      }
    }
  }, [scene, screens, live]);
  return <primitive object={scene} />;
}

/** The office window's hinges and the blinds' rail, where world.py built them (Blender metres). */
type Hinge = 'sashL' | 'sashR' | 'blinds';
const HINGES: [Hinge, string, V3][] = [
  ['sashL', 'SM_Live_Office_Sash_L', [5.65, -4.772, 1.05]],
  ['sashR', 'SM_Live_Office_Sash_R', [8.35, -4.772, 1.05]],
  ['blinds', 'SM_Live_Office_Blinds', [7.0, -4.63, 2.38]],
];

type LiveParts = {
  glow: THREE.MeshStandardMaterial[];
  logo: THREE.MeshBasicMaterial[];
  lamps: THREE.MeshBasicMaterial[];
  hourHands: THREE.Object3D[];
  minuteHands: THREE.Object3D[];
  fries: THREE.Object3D[];
  /** The office window's moving parts, each turning about its hinge (a group of its own). */
  hinges: Map<Hinge, THREE.Object3D>;
};

/**
 * The tables' QR cards, drawn sharp over their baked copies (a card this small gets only a few pixels of its
 * atlas, so the bake blurs its code): where world.py's qr_stand put them, facing the same way.
 */
const QR_CARDS: [V3, number][] = [
  [[-2.9, -3.63, 0.75], 200],
  [[-0.8, -3.63, 0.75], 200],
  [[-2.23, -0.35, 0.75], 160],
];

function QrCards() {
  const material = useMemo(() => {
    const tex = loader.load(landingAsset('qr-card.webp'));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
  }, []);
  useEffect(
    () => () => {
      material.map?.dispose();
      material.dispose();
    },
    [material],
  );
  const materialRef = useRef(material);
  useFrame(() => {
    // As lit as the baked room around it: dimmer at night.
    materialRef.current.color.setScalar(0.92 - 0.5 * LIGHT.uNight.value);
  });
  return (
    <>
      {QR_CARDS.map(([at, rot]) => {
        const turn = THREE.MathUtils.degToRad(rot);
        const facing = [Math.sin(turn), -Math.cos(turn)] as const;
        const middle: V3 = [at[0] + facing[0] * 0.004, at[1] + facing[1] * 0.004, at[2] + 0.125];
        return (
          <mesh key={`${at[0]},${at[1]}`} position={toThree(middle)} rotation={[0, turn, 0]}>
            <planeGeometry args={[0.14, 0.21]} />
            <primitive object={material} attach="material" />
          </mesh>
        );
      })}
    </>
  );
}

/** A label floating over the dropped fries, so nobody has to guess what they are (the founder, 2026-11-17). */
function FriesLabel({ progressRef, label }: { progressRef: RefObject<number>; label: string }) {
  const spriteRef = useRef<THREE.Sprite>(null);
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const css = getComputedStyle(document.documentElement);
      const yellow = css.getPropertyValue('--brand-yellow').trim() || 'gold';
      const grey = css.getPropertyValue('--brand-grey').trim() || 'black';
      const font = getComputedStyle(document.body).fontFamily || 'sans-serif';
      ctx.fillStyle = yellow;
      ctx.beginPath();
      ctx.roundRect(4, 8, 632, 112, 56);
      ctx.fill();
      ctx.font = '62px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText('🍟', 30, 66);
      ctx.fillStyle = grey;
      ctx.font = `800 46px ${font}`;
      ctx.fillText(label, 112, 66, 500);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, [label]);
  useEffect(() => () => texture.dispose(), [texture]);
  useFrame((_, delta) => {
    const sprite = spriteRef.current;
    if (!sprite) return;
    const shown = friesShown(progressRef.current ?? 0) ? 1 : 0;
    const mat = sprite.material;
    mat.opacity = THREE.MathUtils.damp(mat.opacity, shown, 8, Math.min(delta, 1 / 20));
    sprite.visible = mat.opacity > 0.01;
  });
  return (
    <sprite ref={spriteRef} position={toThree([6.1, -0.2, 0.62])} scale={[0.5, 0.1, 1]}>
      <spriteMaterial map={texture} transparent opacity={0} toneMapped={false} />
    </sprite>
  );
}

/**
 * The whole café world. Zones load one after another in the story's order, so the street (all the first
 * moment needs) is drawn first and the rest arrive while the visitor reads; every screen is drawn live from
 * the story, and the light follows the day: dawn, day, night.
 */
export function World({
  progressRef,
  text,
  zones,
  onStreet,
}: {
  progressRef: RefObject<number>;
  text: ScreenText;
  zones: readonly Zone[];
  /** Once the first zone is drawn. */
  onStreet?: () => void;
}) {
  // Zones load one at a time, and only once the story is near them (`ZONE_FROM`): someone who reads the
  // first moment downloads the street and the café, not the whole building.
  const [loaded, setLoaded] = useState(1);
  const [reached, setReached] = useState(1);
  const onLoaded = useCallback(
    (zone: Zone) => {
      const i = zones.indexOf(zone);
      if (i === 0) onStreet?.();
      setLoaded((n) => Math.max(n, i + 2));
    },
    [zones, onStreet],
  );
  const screens = useMemo<Screens>(() => {
    const out: Screens = {};
    for (const id of [
      'till',
      'kds',
      'safety',
      'stock',
      'staff',
      'office',
      'poster',
      'scale',
    ] as ScreenId[]) {
      const [w, h] = SCREEN_SIZES[id]!;
      out[id] = createScreen(w, h);
    }
    return out;
  }, []);
  useEffect(() => () => Object.values(screens).forEach((s) => s?.dispose()), [screens]);
  // Redraw everything once the page's fonts (Bangla too) are ready.
  useEffect(() => {
    let alive = true;
    void document.fonts?.ready.then(() => {
      if (!alive) return;
      const p = progressRef.current ?? 0;
      for (const [id, s] of Object.entries(screens)) {
        const { show, t } = screenAt(id as ScreenId, p);
        s?.paint(show, t, text, true);
      }
    });
    return () => {
      alive = false;
    };
  }, [screens, text, progressRef]);

  const live = useRef<LiveParts>({
    glow: [],
    logo: [],
    lamps: [],
    hourHands: [],
    minuteHands: [],
    fries: [],
    hinges: new Map(),
  });

  useFrame(() => {
    const p = progressRef.current ?? 0;
    const near = zones.reduce((n, z, i) => (p >= ZONE_FROM[z] ? i + 1 : n), 1);
    if (near > reached) setReached(near);
    const { hour, night } = timeOfDay(p);
    LIGHT.uNight.value = THREE.MathUtils.smoothstep(night, 0.15, 0.95);
    // Dawn is warm and low; mid-afternoon a touch golden; noon neutral.
    const dawn = THREE.MathUtils.clamp((7.5 - hour) / 1.5, 0, 1);
    const golden = THREE.MathUtils.clamp((hour - 14.5) / 3, 0, 1) * (1 - LIGHT.uNight.value);
    LIGHT.uTint.value.setRGB(
      1 - 0.06 * dawn,
      1 - 0.18 * dawn - 0.04 * golden,
      1 - 0.26 * dawn - 0.1 * golden,
    );
    LIGHT.uTint.value.multiplyScalar(1 - 0.22 * dawn);
    const parts = live.current;
    for (const m of parts.glow) m.emissiveIntensity = 0.15 + 2.2 * night;
    for (const m of parts.logo) m.color.setScalar(0.8 + 0.25 * night);
    for (const m of parts.lamps) m.opacity = night;
    const a = ((hour % 12) / 12) * Math.PI * 2;
    const b = ((hour % 1) * 60 * Math.PI * 2) / 60;
    for (const h of parts.hourHands) h.rotation.set(0, 0, -a);
    for (const h of parts.minuteHands) h.rotation.set(0, 0, -b);
    const fries = friesShown(p);
    for (const f of parts.fries) f.visible = fries;
    // The office window opens for Xedine's flight to the city: casements out, blinds up.
    const open = windowOpen(p);
    const sashL = parts.hinges.get('sashL');
    const sashR = parts.hinges.get('sashR');
    const blinds = parts.hinges.get('blinds');
    if (sashL) sashL.rotation.y = -open * THREE.MathUtils.degToRad(72);
    if (sashR) sashR.rotation.y = open * THREE.MathUtils.degToRad(72);
    if (blinds) blinds.scale.y = 1 - open * 0.94;
    for (const [id, s] of Object.entries(screens)) {
      const { show, t: st } = screenAt(id as ScreenId, p);
      s?.paint(show, st, text);
    }
  });

  return (
    <>
      {zones.slice(0, Math.min(loaded, reached)).map((z) => (
        <Suspense key={z} fallback={null}>
          <ZoneModel zone={z} screens={screens} live={live} onLoaded={onLoaded} />
        </Suspense>
      ))}
      <FriesLabel progressRef={progressRef} label={text.w.friesLabel ?? ''} />
      <QrCards />
    </>
  );
}

export function preloadWorld() {
  for (const z of ZONES) useGLTF.preload(zoneUrl(z), false, true);
}
