'use client';

import * as THREE from 'three';

/** An upright phone (the layout with the card at the bottom). */
const isPhone = () =>
  typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches;

/**
 * Draws the whole scene once into a tiny hidden picture, with nothing culled and hidden people shown, so the
 * phone's graphics card prepares every texture and shader now: done lazily, it froze the page for up to
 * 0.2 s the first time the camera walked into the café (the founder, 2026-11-18).
 */
function drawOnceHidden(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
  const shown: THREE.Object3D[] = [];
  const unculled: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if (!o.visible) {
      o.visible = true;
      shown.push(o);
    }
    if (o.frustumCulled) {
      o.frustumCulled = false;
      unculled.push(o);
    }
  });
  const target = new THREE.WebGLRenderTarget(16, 16);
  const before = gl.getRenderTarget();
  try {
    gl.setRenderTarget(target);
    gl.render(scene, camera);
  } finally {
    gl.setRenderTarget(before);
    target.dispose();
    for (const o of shown) o.visible = false;
    for (const o of unculled) o.frustumCulled = true;
  }
}

/**
 * On a phone, the moment `object` arrives: compile it for the real scene (its lights and environment) in the
 * background, then draw the scene once out of sight (see drawOnceHidden). Other devices keep their
 * behaviour: returns false there and does nothing.
 */
export function warmUpOnPhone(
  gl: THREE.WebGLRenderer,
  object: THREE.Object3D,
  camera: THREE.Camera,
  scene: THREE.Scene,
  /** Runs just before the hidden draw (e.g. paint canvases, so their first upload happens now). */
  before?: () => void,
) {
  if (!isPhone()) return false;
  void gl
    .compileAsync(object, camera, scene)
    .then(() => {
      before?.();
      drawOnceHidden(gl, scene, camera);
    })
    .catch(() => undefined);
  return true;
}
