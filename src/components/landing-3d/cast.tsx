'use client';

import { useGLTF } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { type RefObject, useEffect, useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';
import { createScreen, planeUv, SCREEN_SIZES, type ScreenText } from './screens';
import { CAST_IDS, type CastId, type Pose, type Prop } from './story';
import { beatAt, castAt } from './timeline';
import { landingAsset } from './asset-version';
import { withMeshopt } from './gltf';
import { warmUpOnPhone } from './warm-up';

/** Built by scripts/landing-3d/cast.py (ADR 0064): the café's people, little blobs from Xedine's family. */
export const CAST_GLB = landingAsset('cast.glb');

/** Hand positions per pose, in Blender's character space (x right of the character… y behind, z up). */
const POSES: Record<Pose, { l: [number, number, number]; r: [number, number, number] }> = {
  idle: { l: [0.6, -0.14, 0.62], r: [-0.6, -0.14, 0.62] },
  phone: { l: [0.58, -0.16, 0.6], r: [-0.2, -0.56, 0.86] },
  sitPhone: { l: [0.46, -0.3, 0.55], r: [-0.2, -0.56, 0.86] },
  carry: { l: [0.66, -0.05, 0.46], r: [-0.66, -0.05, 0.46] },
  tray: { l: [0.58, -0.14, 0.6], r: [-0.44, -0.42, 0.84] },
  work: { l: [0.26, -0.56, 0.62], r: [-0.26, -0.56, 0.62] },
  wave: { l: [0.6, -0.14, 0.62], r: [-0.74, -0.12, 1.22] },
  sit: { l: [0.36, -0.46, 0.5], r: [-0.36, -0.46, 0.5] },
  point: { l: [0.6, -0.14, 0.62], r: [-0.4, -0.66, 0.96] },
};

const toLocal = ([x, y, z]: [number, number, number]) => new THREE.Vector3(x, z, -y);
const damp = THREE.MathUtils.damp;
const CAST_SCALE = 0.78;
/** Phones are cartoon-big, so their live screens read from the story's camera. */
const PHONE_SCALE = 2;

type Rig = {
  root: THREE.Object3D;
  bob: THREE.Object3D;
  face: THREE.Object3D | undefined;
  eyes: THREE.Object3D[];
  eyeRest: number[];
  /** Each hand's offset from its modelled wrist (packing moves a mesh's origin to its middle). */
  hands: { l: THREE.Object3D; r: THREE.Object3D; offL: THREE.Vector3; offR: THREE.Vector3 };
  props: Partial<Record<Prop, THREE.Object3D[]>>;
  phone: ReturnType<typeof createScreen> | null;
  state: {
    shown: number;
    yaw: number;
    blink: number;
    nextBlink: number;
    phase: number;
    placed: boolean;
  };
};

function rigOf(
  scene: THREE.Object3D,
  id: CastId,
  protos: Partial<Record<Prop, THREE.Object3D>>,
  phase: number,
): Rig | null {
  const root = scene.getObjectByName(`CH_${id}`);
  const bob = scene.getObjectByName(`CH_${id}_Bob`);
  const l = scene.getObjectByName(`CH_${id}_Hand_L`);
  const r = scene.getObjectByName(`CH_${id}_Hand_R`);
  if (!root || !bob || !l || !r) return null;
  const props: Rig['props'] = {};
  let phone: Rig['phone'] = null;
  for (const [name, proto] of Object.entries(protos) as [Prop, THREE.Object3D][]) {
    const copies = (name === 'bag' ? [0, 1] : [0]).map(() => {
      const c = proto.clone(true);
      c.visible = false;
      if (name === 'phone') c.scale.multiplyScalar(PHONE_SCALE);
      bob.add(c);
      return c;
    });
    if (name === 'phone') {
      const [w, h] = SCREEN_SIZES.phone!;
      phone = createScreen(w, h);
      const screen = copies[0]!.getObjectByName('SC_Phone') as THREE.Mesh | undefined;
      if (screen) {
        planeUv(screen);
        screen.material = new THREE.MeshBasicMaterial({ map: phone.texture, toneMapped: false });
      }
    }
    props[name] = copies;
  }
  return {
    root,
    bob,
    face: scene.getObjectByName(`CH_${id}_Face`) ?? undefined,
    eyes: ['L', 'R']
      .map((s) => scene.getObjectByName(`CH_${id}_Eye_${s}`))
      .filter(Boolean) as THREE.Object3D[],
    eyeRest: ['L', 'R'].map((side) => scene.getObjectByName(`CH_${id}_Eye_${side}`)?.scale.y ?? 1),
    hands: {
      l,
      r,
      offL: l.position.clone().sub(toLocal(POSES.idle.l)),
      offR: r.position.clone().sub(toLocal(POSES.idle.r)),
    },
    props,
    phone,
    state: { shown: 0, yaw: 0, blink: -1, nextBlink: 1 + phase * 3, phase, placed: false },
  };
}

/**
 * The people of the café, driven live by the story: they glide to their places, float and breathe, blink,
 * look at you (or at what the moment is about), and hold what the moment needs: a phone with a live screen,
 * the shopping, a tray.
 */
export function Cast({
  progressRef,
  text,
  phonesRef,
}: {
  progressRef: RefObject<number>;
  text: ScreenText;
  /** Where each held phone is this frame (the camera aims its close looks at the real phone). */
  phonesRef: RefObject<Map<CastId, THREE.Vector3>>;
}) {
  const { scene } = useGLTF(CAST_GLB, false, false, withMeshopt);
  const rigsRef = useRef<Partial<Record<CastId, Rig>>>({});
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const root = useThree((state) => state.scene);
  const tmpRef = useRef({ v: new THREE.Vector3(), w: new THREE.Vector3() });

  useLayoutEffect(() => {
    const protos: Partial<Record<Prop, THREE.Object3D>> = {};
    for (const [prop, node] of [
      ['phone', 'PROP_Phone'],
      ['bag', 'PROP_Bag'],
      ['tray', 'PROP_Tray'],
      ['mug', 'PROP_Mug'],
      ['spatula', 'PROP_Spatula'],
      ['notepad', 'PROP_Notepad'],
      ['card', 'PROP_Card'],
    ] as [Prop, string][]) {
      const o = scene.getObjectByName(node);
      if (o) {
        o.visible = false;
        protos[prop] = o;
      }
    }
    scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    const out: Partial<Record<CastId, Rig>> = {};
    CAST_IDS.forEach((id, i) => {
      const rig = rigOf(scene, id, protos, (i * 0.37) % 1);
      if (rig) {
        rig.root.visible = false;
        out[id] = rig;
      }
    });
    rigsRef.current = out;
    return () => {
      for (const rig of Object.values(out)) rig?.phone?.dispose();
    };
  }, [scene]);

  // On a phone, the people (hidden until their moment) are compiled now, not when they first walk in.
  // And every phone screen is drawn once on a throwaway canvas, so its text and emoji are ready.
  useEffect(() => {
    warmUpOnPhone(gl, scene, camera, root, () => {
      const [w, h] = SCREEN_SIZES.phone!;
      const spare = createScreen(w, h);
      spare.warm(text);
      spare.dispose();
    });
  }, [gl, scene, camera, root, text]);

  // Phones redraw once the page's fonts (Bangla too) are ready.
  const repaintRef = useRef(true);
  useEffect(() => {
    void document.fonts?.ready.then(() => {
      repaintRef.current = true;
    });
  }, []);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 1 / 20);
    const p = progressRef.current ?? 0;
    const tmp = tmpRef.current;
    const time = state.clock.elapsedTime;
    const cam = state.camera.position;
    const { t: beatT } = beatAt(p);
    for (const id of CAST_IDS) {
      const rig = rigsRef.current[id];
      if (!rig) continue;
      const s = castAt(id, p);
      const st = rig.state;
      // Pop in and out like a cartoon; glide while visible.
      st.shown = damp(st.shown, s.visible ? 1 : 0, 9, dt);
      rig.root.visible = st.shown > 0.02;
      if (!rig.root.visible) {
        st.placed = false;
        continue;
      }
      // People are drawn a little smaller than modelled, so they fit the café's aisles and tables.
      const scale = (rig.root.userData.baseScale ??= rig.root.scale.x * CAST_SCALE) as number;
      rig.root.scale.setScalar(scale * (0.6 + 0.4 * st.shown));
      if (!st.placed) {
        rig.root.position.copy(s.pos);
        st.placed = true;
      } else {
        rig.root.position.x = damp(rig.root.position.x, s.pos.x, 3, dt);
        rig.root.position.y = damp(rig.root.position.y, s.pos.y, 3, dt);
        rig.root.position.z = damp(rig.root.position.z, s.pos.z, 3, dt);
      }
      // Face the camera unless the moment says otherwise; anyone holding a phone shows it to you.
      const toCam = Math.atan2(cam.x - rig.root.position.x, cam.z - rig.root.position.z);
      let yaw = s.face ?? toCam;
      if (s.phone) yaw = toCam;
      const diff = THREE.MathUtils.euclideanModulo(yaw - st.yaw + Math.PI, Math.PI * 2) - Math.PI;
      st.yaw += diff * (1 - Math.exp(-4 * dt));
      rig.root.rotation.set(0, st.yaw, 0);
      // Float and breathe.
      rig.bob.position.y = Math.sin(time * 2.1 + st.phase * 6) * 0.025;
      rig.bob.scale.y = 1 + Math.sin(time * 2.1 + st.phase * 6 + 1) * 0.012;
      // Hands to the pose, with a little life.
      const pose = POSES[s.pose];
      const work = s.pose === 'work' ? Math.sin(time * 9 + st.phase * 3) * 0.04 : 0;
      const wave = s.pose === 'wave' ? Math.sin(time * 10) * 0.12 : 0;
      tmp.v.copy(toLocal(pose.l)).add(rig.hands.offL);
      tmp.v.y += work;
      rig.hands.l.position.lerp(tmp.v, 1 - Math.exp(-8 * dt));
      tmp.w.copy(toLocal(pose.r)).add(rig.hands.offR);
      tmp.w.y -= work;
      tmp.w.x += wave;
      rig.hands.r.position.lerp(tmp.w, 1 - Math.exp(-8 * dt));
      // Props follow the hands.
      for (const [prop, copies] of Object.entries(rig.props) as [Prop, THREE.Object3D[]][]) {
        const on = s.props.includes(prop);
        copies.forEach((c, i) => {
          c.visible = on && (prop === 'bag' ? s.pose === 'carry' || i === 0 : i === 0);
          if (!c.visible) return;
          const hand =
            prop === 'bag'
              ? i === 0
                ? rig.hands.l
                : rig.hands.r
              : prop === 'mug'
                ? rig.hands.l
                : rig.hands.r;
          c.position.copy(hand.position);
          // The phone sits above and in front of the hand that holds it from below, so no mitten covers its
          // screen (story.ts PHONE_HOLD; the founder, 2026-11-17).
          if (prop === 'phone') c.position.add(tmp.v.set(0.02, 0.16, 0.12));
          else if (prop === 'bag') c.position.add(tmp.v.set(0, -0.36, 0));
          else if (prop === 'tray') c.position.add(tmp.v.set(0, 0.04, 0));
          else if (prop === 'mug') c.position.add(tmp.v.set(0, 0.02, 0.04));
          else if (prop === 'spatula') {
            c.position.add(tmp.v.set(0, 0.05, 0.05));
            c.rotation.set(-0.6, 0, 0);
          } else c.position.add(tmp.v.set(0, 0.06, 0.04));
          if (prop === 'phone') c.rotation.set(-0.12, 0, 0);
        });
      }
      if (rig.phone && s.phone) rig.phone.paint(s.phone, beatT, text, repaintRef.current);
      const held = rig.props.phone?.[0];
      if (held?.visible) {
        const at = phonesRef.current.get(id) ?? new THREE.Vector3();
        held.getWorldPosition(at);
        phonesRef.current.set(id, at);
      } else phonesRef.current.delete(id);
      // Eyes: look at the camera (the visitor), blink every few seconds.
      if (rig.face) {
        rig.root.worldToLocal(tmp.v.copy(cam));
        tmp.v.sub(rig.face.position);
        const ly = THREE.MathUtils.clamp(Math.atan2(tmp.v.x, tmp.v.z), -0.35, 0.35);
        const lp = THREE.MathUtils.clamp(
          Math.atan2(tmp.v.y, Math.hypot(tmp.v.x, tmp.v.z)),
          -0.2,
          0.2,
        );
        rig.face.rotation.y = damp(rig.face.rotation.y, ly, 6, dt);
        rig.face.rotation.x = damp(rig.face.rotation.x, -lp, 6, dt);
      }
      st.nextBlink -= dt;
      if (st.nextBlink <= 0 && st.blink < 0) {
        st.blink = 0;
        st.nextBlink = 2.2 + ((st.phase * 7.3 + time) % 3);
      }
      let open = 1;
      if (st.blink >= 0) {
        st.blink += dt;
        const k = st.blink / 0.16;
        if (k >= 1) st.blink = -1;
        else open = 1 - 0.9 * Math.sin(Math.PI * k);
      }
      // Packed meshes carry a scale that undoes their compression: blink relative to it.
      rig.eyes.forEach((eye, i) => eye.scale.setY((rig.eyeRest[i] ?? 1) * open));
    }
    repaintRef.current = false;
  });

  return <primitive object={scene} />;
}

// Not preloaded on import: the stage loads the people after the street (the first picture comes first).
