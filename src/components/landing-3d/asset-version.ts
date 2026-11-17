/**
 * The 3D day's files (public/landing/3d) are served with a year-long cache (public/_headers), so every URL
 * carries this version: a new build of the world gets new URLs and nobody sees an old file. It is a hash of
 * the files themselves; asset-version.test.ts fails until it is updated after a rebuild (ADR 0064).
 */
export const LANDING_3D_VERSION = '91d4a19177';

/** A file under /landing/3d, with its version. */
export const landingAsset = (path: string) => `/landing/3d/${path}?v=${LANDING_3D_VERSION}`;
