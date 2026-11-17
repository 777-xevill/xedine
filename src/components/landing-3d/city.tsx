'use client';

import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';

/**
 * Above the city at night, then the whole globe (ADR 0064, the branches and countries moment). The city around
 * the café is drawn here in code: night blocks whose windows light up, and pins for the branches. Then the
 * camera climbs until the café sits on top of the globe, with the ten countries Xedine works in.
 */

export type CountryPin = { code: string; name: string; currency: string; lat: number; lng: number };
export type BranchLabel = { name: string; value: string; rank: number };

const GLOBE_R = 140;
// Roads every 40 m, lined up with the café's main street and side street (Blender x = -10, y = -13.4).
const PERIOD = 40;

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function windowTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  const rand = seeded(7);
  if (ctx) {
    ctx.fillStyle = 'rgb(0, 0, 0)';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        const lit = rand() < 0.38;
        const warm = rand();
        ctx.fillStyle = lit
          ? `rgb(255, ${Math.round(190 + warm * 40)}, ${Math.round(120 + warm * 60)})`
          : 'rgb(18, 22, 30)';
        ctx.fillRect(i * 32 + 8, j * 32 + 7, 16, 18);
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** The night city: blocks of buildings around the café's block, their windows on a world-space grid. */
function Blocks({ fadeRef }: { fadeRef: RefObject<number> }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const mesh = useMemo(() => {
    const rand = seeded(42);
    const boxes: { x: number; z: number; w: number; d: number; h: number; tone: number }[] = [];
    for (let kx = -4; kx <= 4; kx++) {
      for (let ky = -4; ky <= 4; ky++) {
        if (kx === 0 && ky === 0) continue;
        // A block between roads, in Blender coordinates, split into lots.
        const x0 = -4 + kx * PERIOD;
        const y0 = -7.4 + ky * PERIOD;
        const lots = 2 + Math.floor(rand() * 2);
        for (let i = 0; i < lots; i++) {
          for (let j = 0; j < 2; j++) {
            const w = 28 / lots - 2;
            const d = 12;
            const far = Math.hypot(kx, ky);
            boxes.push({
              x: x0 + 1 + i * (28 / lots) + w / 2,
              z: -(y0 + 1 + j * 14 + d / 2),
              w,
              d,
              h: 8 + rand() * (14 + far * 4),
              tone: rand(),
            });
          }
        }
      }
    }
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const tex = windowTexture();
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(1, 1, 1),
      roughness: 0.85,
      emissive: new THREE.Color(1, 1, 1),
      emissiveMap: tex,
      emissiveIntensity: 1.4,
      transparent: true,
      opacity: 1,
    });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.windows = { value: tex };
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying vec3 vCityPos;\nvarying vec3 vCityNormal;',
        )
        .replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
          vec4 cityWorld = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
          vCityPos = cityWorld.xyz;
          vCityNormal = normalize(mat3(modelMatrix * instanceMatrix) * objectNormal);`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform sampler2D windows;\nvarying vec3 vCityPos;\nvarying vec3 vCityNormal;',
        )
        .replace(
          '#include <emissivemap_fragment>',
          `float side = step(abs(vCityNormal.y), 0.5);
          float along = abs(vCityNormal.x) > 0.5 ? vCityPos.z : vCityPos.x;
          vec4 win = texture2D(windows, vec2(along / 24.0, vCityPos.y / 25.6));
          totalEmissiveRadiance *= win.rgb * side;`,
        );
    };
    const im = new THREE.InstancedMesh(geo, mat, boxes.length);
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    boxes.forEach((b, i) => {
      m.makeScale(b.w, b.h, b.d).setPosition(b.x, -0.16, b.z);
      im.setMatrixAt(i, m);
      col.setHSL(0.08 + b.tone * 0.5, 0.12, 0.2 + b.tone * 0.12);
      im.setColorAt(i, col);
    });
    im.instanceMatrix.needsUpdate = true;
    return im;
  }, []);
  useEffect(() => () => mesh.dispose(), [mesh]);
  useFrame(() => {
    const m = meshRef.current;
    if (!m) return;
    const material = m.material as THREE.MeshStandardMaterial;
    material.opacity = fadeRef.current ?? 1;
    m.visible = material.opacity > 0.01;
  });
  return <primitive ref={meshRef} object={mesh} />;
}

/** A pin over a branch: a pole and a glowing head, with its label. */
function Pin({
  at,
  color,
  label,
  height,
  labels,
}: {
  labels: boolean;
  at: [number, number];
  color: THREE.Color;
  label: BranchLabel | string;
  height: number;
}) {
  return (
    <group position={[at[0], 0, -at[1]]}>
      <mesh position={[0, height / 2, 0]}>
        <cylinderGeometry args={[0.25, 0.25, height, 8]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      <mesh position={[0, height, 0]}>
        <sphereGeometry args={[1.6, 20, 12]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      {labels && (
        <Html position={[0, height + 3.2, 0]} center zIndexRange={[20, 0]}>
          <div className="xedine-chip pointer-events-none rounded-xl px-3 py-1.5 text-center text-xs whitespace-nowrap">
            {typeof label === 'string' ? (
              label
            ) : (
              <>
                <div className="font-bold">{`#${label.rank} ${label.name}`}</div>
                <div>{label.value}</div>
              </>
            )}
          </div>
        </Html>
      )}
    </group>
  );
}

function brandColor(name: string, fallback: [number, number, number]) {
  const v =
    typeof document === 'undefined'
      ? ''
      : getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const c = new THREE.Color(...fallback);
  if (v) c.setStyle(v);
  return c;
}

/** Latitude/longitude on a sphere (three.js axes: +Y north, the prime meridian toward +Z). */
function onSphere(lat: number, lng: number, r: number) {
  const phi = THREE.MathUtils.degToRad(90 - lat);
  const theta = THREE.MathUtils.degToRad(lng);
  return new THREE.Vector3(
    r * Math.sin(phi) * Math.sin(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.cos(theta),
  );
}

function Globe({
  fadeRef,
  home,
  countries,
  labels,
}: {
  labels: boolean;
  fadeRef: RefObject<number>;
  home: CountryPin;
  countries: CountryPin[];
}) {
  const group = useRef<THREE.Group>(null);
  const silver = useMemo(() => brandColor('--brand-silver', [0.85, 0.85, 0.86]), []);
  const yellow = useMemo(() => brandColor('--brand-yellow', [1, 0.79, 0.24]), []);
  const dots = useMemo(
    () =>
      new THREE.PointsMaterial({
        color: silver,
        size: 1.5,
        sizeAttenuation: true,
        transparent: true,
      }),
    [silver],
  );
  const ocean = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(0.1, 0.13, 0.19),
        roughness: 0.7,
        transparent: true,
      }),
    [],
  );
  const pointsRef = useRef<THREE.Points | null>(null);
  const oceanRef = useRef<THREE.Mesh>(null);
  // Turn the globe so the visitor's own country sits on top, under the café.
  const turn = useMemo(
    () =>
      new THREE.Quaternion().setFromUnitVectors(
        onSphere(home.lat, home.lng, 1).normalize(),
        new THREE.Vector3(0, 1, 0),
      ),
    [home],
  );
  useEffect(() => {
    const img = new Image();
    img.src = '/landing/3d/land.png';
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      const pos: number[] = [];
      const n = 16000;
      const golden = Math.PI * (3 - Math.sqrt(5));
      for (let i = 0; i < n; i++) {
        const y = 1 - (i / (n - 1)) * 2;
        const lat = THREE.MathUtils.radToDeg(Math.asin(y));
        const lng =
          THREE.MathUtils.radToDeg(THREE.MathUtils.euclideanModulo(i * golden, Math.PI * 2)) - 180;
        const px = Math.floor(((lng + 180) / 360) * c.width) % c.width;
        const py = Math.min(c.height - 1, Math.floor(((90 - lat) / 180) * c.height));
        if (data[(py * c.width + px) * 4]! > 127) {
          const v = onSphere(lat, lng, GLOBE_R + 0.4);
          pos.push(v.x, v.y, v.z);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const cloud = new THREE.Points(g, dots.clone());
      pointsRef.current = cloud;
      group.current?.add(cloud);
    };
    return () => pointsRef.current?.geometry.dispose();
  }, [dots]);
  useFrame(() => {
    const f = fadeRef.current ?? 0;
    if (group.current) group.current.visible = f > 0.01;
    const cloud = pointsRef.current;
    if (cloud) (cloud.material as THREE.PointsMaterial).opacity = f;
    const sea = oceanRef.current;
    if (sea) (sea.material as THREE.MeshStandardMaterial).opacity = f;
  });
  return (
    <group ref={group} position={[2, -GLOBE_R - 0.5, 0]} quaternion={turn}>
      <mesh ref={oceanRef} material={ocean}>
        <sphereGeometry args={[GLOBE_R, 64, 48]} />
      </mesh>
      {countries.map((c) => {
        const v = onSphere(c.lat, c.lng, GLOBE_R + 1.5);
        return (
          <group key={c.code} position={v}>
            <mesh>
              <sphereGeometry args={[2.2, 16, 10]} />
              <meshBasicMaterial color={yellow} toneMapped={false} />
            </mesh>
            {labels && (
              <Html center zIndexRange={[20, 0]} position={[0, 5, 0]}>
                <div className="xedine-chip pointer-events-none rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap">
                  {`${c.name} · ${c.currency}`}
                </div>
              </Html>
            )}
          </group>
        );
      })}
    </group>
  );
}

export function City({
  showRef,
  branches,
  waiting,
  peers,
  home,
  countries,
}: {
  showRef: RefObject<{ city: number; globe: number }>;
  branches: BranchLabel[];
  waiting: string;
  peers: string;
  home: CountryPin;
  countries: CountryPin[];
}) {
  const yellow = useMemo(() => brandColor('--brand-yellow', [1, 0.79, 0.24]), []);
  const silver = useMemo(() => brandColor('--brand-silver', [0.85, 0.85, 0.86]), []);
  const cityFadeRef = useRef(1);
  const globeFadeRef = useRef(0);
  const pinsRef = useRef<THREE.Group>(null);
  // Labels are page elements (they don't hide with their 3D parent): show each set only in its phase.
  const [phase, setPhase] = useState<'none' | 'city' | 'globe'>('none');
  useFrame(() => {
    const s = showRef.current;
    cityFadeRef.current = s?.city ?? 0;
    globeFadeRef.current = s?.globe ?? 0;
    const next =
      globeFadeRef.current > 0.55 ? 'globe' : cityFadeRef.current > 0.5 ? 'city' : 'none';
    if (pinsRef.current) pinsRef.current.visible = next === 'city';
    if (next !== phase) setPhase(next);
  });
  const [riverside, here, oldTown] = branches;
  return (
    <>
      <Blocks fadeRef={cityFadeRef} />
      <group ref={pinsRef}>
        {here && (
          <Pin at={[2, 0]} color={yellow} label={here} height={16} labels={phase === 'city'} />
        )}
        {riverside && (
          <Pin
            at={[40, 20]}
            color={yellow}
            label={riverside}
            height={40}
            labels={phase === 'city'}
          />
        )}
        {oldTown && (
          <Pin
            at={[-40, 20]}
            color={yellow}
            label={oldTown}
            height={40}
            labels={phase === 'city'}
          />
        )}
        <Pin at={[20, -30]} color={silver} label={waiting} height={40} labels={phase === 'city'} />
        {phase === 'city' && (
          <Html position={[2, 34, 0]} center zIndexRange={[20, 0]}>
            <div className="xedine-chip pointer-events-none rounded-full px-3 py-1 text-xs whitespace-nowrap">
              {peers}
            </div>
          </Html>
        )}
      </group>
      <Globe fadeRef={globeFadeRef} home={home} countries={countries} labels={phase === 'globe'} />
    </>
  );
}
