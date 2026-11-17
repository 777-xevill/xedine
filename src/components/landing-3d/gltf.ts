'use client';

import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

// The 3D day's files are meshopt-compressed (pack.mjs). three's decoder unpacks them in two background
// workers, so a room arriving mid-scroll doesn't freeze the page (the founder saw it stutter, 2026-11-18).
// (three names it useWorkers; it is not a React hook.)
const { useWorkers: startWorkers } = MeshoptDecoder;
if (typeof window !== 'undefined') startWorkers(2);

/** Pass as useGLTF's fourth argument (with useMeshopt false): the worker-backed decoder. */
export const withMeshopt = (loader: {
  setMeshoptDecoder: (decoder: typeof MeshoptDecoder) => unknown;
}) => {
  loader.setMeshoptDecoder(MeshoptDecoder);
};
