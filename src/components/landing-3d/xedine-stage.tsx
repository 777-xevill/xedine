'use client';

import { ContactShadows, Environment, Lightformer, PresentationControls } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { type RefObject, Suspense, useEffect } from 'react';
import * as THREE from 'three';
import { Xedine, type XedineHandle } from './xedine';

/** Keep all of Xedine (hat, hover and a raised hand) in view on any screen, a phone held upright included. */
function FitCamera() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  useEffect(() => {
    const half = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const aspect = size.width / Math.max(size.height, 1);
    // Room for the title above and the buttons below.
    const tall = 3.0;
    const wide = 2.1;
    const distance = Math.max(tall / 2 / half, wide / 2 / (half * aspect));
    camera.position.set(0, 1.0, distance);
    camera.lookAt(0, 0.9, 0);
    camera.updateProjectionMatrix();
  }, [camera, size]);
  return null;
}

/**
 * The look-test stage for Xedine (ADR 0064): a soft studio made of light panels (no image files), a contact
 * shadow under the hover, Khronos PBR Neutral tone mapping so the logo's yellow stays true (as in Blender).
 */
export default function XedineStage({ xedine }: { xedine: RefObject<XedineHandle | null> }) {
  return (
    <Canvas
      shadows="percentage"
      dpr={[1, 2]}
      camera={{ position: [0, 0.95, 4.2], fov: 30, near: 0.1, far: 60 }}
      gl={{ antialias: true, alpha: true }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.NeutralToneMapping;
        gl.toneMappingExposure = 1.05;
      }}
    >
      <FitCamera />
      <ambientLight intensity={0.25} />
      <directionalLight
        position={[-2.3, 3.1, 2.7]}
        intensity={2.4}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0004}
      />
      {/* Rim lights from behind: they draw the dark body's outline, as in the logo. */}
      <directionalLight position={[2.0, 2.7, -2.4]} intensity={2.6} />
      <directionalLight position={[-2.2, 1.6, -2.0]} intensity={1.4} />
      <Suspense fallback={null}>
        <PresentationControls
          global={false}
          cursor={false}
          snap
          speed={1.4}
          polar={[-0.05, 0.15]}
          azimuth={[-Math.PI / 2.5, Math.PI / 2.5]}
        >
          <Xedine ref={xedine} />
        </PresentationControls>
        <ContactShadows
          position={[0, 0.001, 0]}
          opacity={0.42}
          scale={3.2}
          blur={2.6}
          far={1.6}
          resolution={512}
        />
        <Environment resolution={256}>
          <Lightformer
            form="rect"
            intensity={2.2}
            position={[-2.3, 3.1, 2.7]}
            scale={[2.6, 2.6, 1]}
            target={[0, 0.9, 0]}
          />
          <Lightformer
            form="rect"
            intensity={0.8}
            position={[2.9, 1.4, 2.3]}
            scale={[3, 2, 1]}
            target={[0, 0.9, 0]}
          />
          <Lightformer
            form="rect"
            intensity={3}
            position={[2.0, 2.7, -2.4]}
            scale={[1.4, 1.4, 1]}
            target={[0, 1, 0]}
          />
          <Lightformer
            form="ring"
            intensity={1.2}
            position={[0, 4, 0]}
            scale={2}
            target={[0, 0, 0]}
          />
        </Environment>
      </Suspense>
    </Canvas>
  );
}
