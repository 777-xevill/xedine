'use client';

import { ContactShadows, Environment } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { type RefObject, Suspense, useRef } from 'react';
import * as THREE from 'three';
import { CAFE_ENV, CafeCorner } from './cafe-corner';
import type { TillLine, TillWords } from './till-screen';
import { Xedine, type XedineHandle } from './xedine';

// Blender is Z-up, the page Y-up: (x, y, z) in Blender is (x, z, -y) here.
const CAMERA = new THREE.Vector3(3.15, 1.55, 4.15);
const TARGET = new THREE.Vector3(0.6, 1.12, -1.05);
// A phone held upright sees a narrow slice: aim it at the till and Xedine.
const TARGET_PHONE = new THREE.Vector3(2.2, 1.1, -0.6);
const XEDINE_AT: [number, number, number] = [2.85, 0.62, 0.15];
const XEDINE_TURN = Math.atan2(3.15 - 2.85, 4.15 - 0.15) - 0.25;

/** The camera of the Blender shot; it leans with the pointer so the room feels deep, and fits any screen. */
function CameraRig() {
  const leanRef = useRef({ x: 0, y: 0, aspect: 0 });
  useFrame((state, delta) => {
    const camera = state.camera as THREE.PerspectiveCamera;
    const dt = Math.min(delta, 1 / 20);
    const lean = leanRef.current;
    const aspect = state.size.width / Math.max(state.size.height, 1);
    if (aspect !== lean.aspect) {
      lean.aspect = aspect;
      // Keep Blender's 30 mm view across; on a tall phone open up the angle, within reason.
      const vertical = THREE.MathUtils.radToDeg(2 * Math.atan(0.6 / aspect));
      camera.fov = THREE.MathUtils.clamp(vertical, 37, 72);
      camera.updateProjectionMatrix();
    }
    lean.x = THREE.MathUtils.damp(lean.x, state.pointer.x, 2.2, dt);
    lean.y = THREE.MathUtils.damp(lean.y, state.pointer.y, 2.2, dt);
    camera.position.set(
      CAMERA.x + lean.x * 0.32,
      CAMERA.y + lean.y * 0.14,
      CAMERA.z - Math.abs(lean.x) * 0.08,
    );
    // From a wide screen (aspect ≥ 1.2) to an upright phone (≤ 0.6), slide the aim toward the till.
    const phone = THREE.MathUtils.clamp((1.2 - aspect) / 0.6, 0, 1);
    camera.lookAt(
      THREE.MathUtils.lerp(TARGET.x, TARGET_PHONE.x, phone) + lean.x * 0.1,
      THREE.MathUtils.lerp(TARGET.y, TARGET_PHONE.y, phone) + lean.y * 0.05,
      THREE.MathUtils.lerp(TARGET.z, TARGET_PHONE.z, phone),
    );
  });
  return null;
}

type Props = {
  xedine: RefObject<XedineHandle | null>;
  till: TillWords;
  order: TillLine[];
  total: string;
};

/** The café corner, live (ADR 0064, approval 2): baked café, live till, Xedine lit by the café's own light. */
export default function CafeStage({ xedine, till, order, total }: Props) {
  return (
    <Canvas
      dpr={[1, 1.75]}
      camera={{ position: CAMERA.toArray(), fov: 37, near: 0.05, far: 60 }}
      gl={{ antialias: true }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.NeutralToneMapping;
        gl.toneMappingExposure = 1.0;
      }}
    >
      <CameraRig />
      {/* Light for the live things (Xedine, glass): the café's own 360° view plus its sun and pendants. */}
      <ambientLight intensity={0.15} />
      <directionalLight position={[-4.9, 3.0, 1.7]} intensity={1.4} color={[1, 0.94, 0.85]} />
      {[-0.45, 0.85, 2.1].map((x) => (
        <pointLight
          key={x}
          position={[x, 2.05, -1.28]}
          intensity={2.2}
          distance={6}
          decay={2}
          color={[1, 0.74, 0.46]}
        />
      ))}
      <Suspense fallback={null}>
        <CafeCorner till={till} order={order} total={total} />
        <Xedine ref={xedine} position={XEDINE_AT} rotation={[0, XEDINE_TURN, 0]} scale={0.62} />
        <ContactShadows
          position={[XEDINE_AT[0], 0.004, XEDINE_AT[2]]}
          opacity={0.38}
          scale={1.8}
          blur={2.8}
          far={1.6}
          resolution={256}
        />
        <Environment files={CAFE_ENV} />
      </Suspense>
    </Canvas>
  );
}
