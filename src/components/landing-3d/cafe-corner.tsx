'use client';

import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo } from 'react';
import * as THREE from 'three';
import { createTillScreen, type TillLine, type TillWords } from './till-screen';
import { landingAsset } from './asset-version';

/** Built by scripts/landing-3d/cafe.py and bake.py: the still café with its light baked in (ADR 0064). */
export const CAFE_GLB = landingAsset('cafe-corner.glb');
export const CAFE_ENV = landingAsset('cafe-env.jpg');

/**
 * The café corner. Baked meshes (BK_*) draw their texture as-is, unlit: the light is already in it, exactly
 * as Blender rendered it. Glass stays see-through and reflective; the till's screen is drawn live.
 */
export function CafeCorner({
  till,
  order,
  total,
}: {
  till: TillWords;
  order: TillLine[];
  total: string;
}) {
  const { scene } = useGLTF(CAFE_GLB, false, true);
  const screen = useMemo(() => createTillScreen(till, order, total), [till, order, total]);

  useLayoutEffect(() => {
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (mat.name.startsWith('MAT_BK_')) {
        mesh.material = new THREE.MeshBasicMaterial({ map: mat.map, toneMapped: false });
      } else if (mesh.name.startsWith('SM_Till_Screen')) {
        mesh.material = new THREE.MeshBasicMaterial({ map: screen.texture, toneMapped: false });
      } else if (
        mesh.name.startsWith('SM_Pendant_Globe') ||
        mesh.name.startsWith('SM_Pendant_Glass')
      ) {
        // Lit frosted glass: a warm glow, a touch of shape from the café's reflections.
        const warm = new THREE.Color(1, 0.86, 0.66);
        mesh.material = new THREE.MeshStandardMaterial({
          color: warm,
          emissive: warm,
          emissiveIntensity: 1.7,
          roughness: 0.55,
        });
      } else if (mat.transparent) {
        mat.depthWrite = false;
        mat.envMapIntensity = 1.4;
      }
    });
  }, [scene, screen]);

  useFrame((state) => screen.update(state.clock.elapsedTime));

  return <primitive object={scene} />;
}

useGLTF.preload(CAFE_GLB, false, true);
