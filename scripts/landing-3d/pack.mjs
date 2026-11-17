// Packs the raw Blender exports for the page (ADR 0064): merge duplicate data, drop what nothing uses, shrink
// the live plants' textures, then quantize and compress the meshes (EXT_meshopt_compression; the page loads
// them with drei's useGLTF(url, false, true)).
//
//   node scripts/landing-3d/pack.mjs            (after world.py + bake.py, cast.py)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const WORK = join(ROOT, '.cache', 'landing-3d');
const OUT = join(ROOT, 'public', 'landing', '3d');
const CLI = join(ROOT, 'node_modules', '@gltf-transform', 'cli', 'bin', 'cli.js');

const run = (...args) => execFileSync(process.execPath, [CLI, ...args], { stdio: 'pipe' });

const FILES = [
  ...['st', 'ca', 'ki', 'sr', 'of'].map((zone) => [`world-${zone}-raw.glb`, `world-${zone}.glb`]),
  ['cast-raw.glb', 'cast.glb'],
];

mkdirSync(OUT, { recursive: true });
for (const [from, to] of FILES) {
  const src = join(WORK, from);
  if (!existsSync(src)) {
    console.log('skip (not built)', from);
    continue;
  }
  const a = join(WORK, `pack-a-${to}`);
  const b = join(WORK, `pack-b-${to}`);
  run('dedup', src, a);
  run('prune', a, b);
  run('resize', b, a, '--pattern', '*plant*', '--width', '512', '--height', '512');
  run('meshopt', a, join(OUT, to), '--level', 'medium');
  const kb = (p) => Math.round(statSync(p).size / 1024);
  console.log(`${to}: ${kb(src)} KB -> ${kb(join(OUT, to))} KB`);
}
