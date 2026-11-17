'use client';

import { useAnimations, useGLTF } from '@react-three/drei';
import { type ThreeElements, useFrame } from '@react-three/fiber';
import {
  forwardRef,
  type RefObject,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';
import * as THREE from 'three';

/** Built by scripts/landing-3d/xedine.py from the chef logo (ADR 0064). */
export const XEDINE_GLB = '/landing/3d/xedine.glb';

/** Bones the page drives live (look, blink); the recorded moves never touch them. */
const LIVE_BONES = /^(eyelook|eye)_[LR]$/;
/** The moves recorded in Blender (scripts/landing-3d/xedine.py). */
export type XedineMove = 'AN_Idle' | 'AN_Wave' | 'AN_Point';

export type XedineHandle = { play: (move: Exclude<XedineMove, 'AN_Idle'>) => void };

type Rig = {
  looks: THREE.Object3D[];
  eyes: THREE.Object3D[];
  lookRest: THREE.Quaternion[];
  eyeRest: THREE.Vector3[];
  blinkAxis: ('x' | 'y' | 'z')[];
};

const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0);

function rigOf(model: THREE.Object3D): Rig {
  model.updateMatrixWorld(true);
  const looks = ['L', 'R']
    .map((s) => model.getObjectByName(`eyelook_${s}`))
    .filter(Boolean) as THREE.Object3D[];
  const eyes = ['L', 'R']
    .map((s) => model.getObjectByName(`eye_${s}`))
    .filter(Boolean) as THREE.Object3D[];
  const toModel = model.getWorldQuaternion(new THREE.Quaternion()).invert();
  // Which of the eye's own axes points up the character? Squashing that one is a blink.
  const blinkAxis = eyes.map((eye) => {
    const q = toModel.clone().multiply(eye.getWorldQuaternion(new THREE.Quaternion()));
    let best: 'x' | 'y' | 'z' = 'y';
    let most = -1;
    for (const [axis, v] of [
      ['x', new THREE.Vector3(1, 0, 0)],
      ['y', new THREE.Vector3(0, 1, 0)],
      ['z', new THREE.Vector3(0, 0, 1)],
    ] as const) {
      const d = Math.abs(v.clone().applyQuaternion(q).dot(UP));
      if (d > most) {
        most = d;
        best = axis;
      }
    }
    return best;
  });
  return {
    looks,
    eyes,
    lookRest: looks.map((b) => b.quaternion.clone()),
    eyeRest: eyes.map((b) => b.scale.clone()),
    blinkAxis,
  };
}

const damp = THREE.MathUtils.damp;
const clamp = THREE.MathUtils.clamp;

/**
 * Xedine, the AI manager: the chef logo floating with two mitten hands. It breathes and hovers on its own
 * (recorded in Blender), and live in the browser its eyes follow the pointer or finger, it blinks, turns a
 * little toward you, squints happily when you point at it, and waves when tapped.
 */
type Props = ThreeElements['group'] & {
  /** Look here (world space) instead of at the pointer: what the story's moment is about. */
  target?: RefObject<THREE.Vector3 | null>;
};

export const Xedine = forwardRef<XedineHandle, Props>(function Xedine({ target, ...props }, ref) {
  const group = useRef<THREE.Group>(null);
  const { scene, animations } = useGLTF(XEDINE_GLB, false, true);
  const clips = useMemo(
    () =>
      animations.map((clip) => {
        const c = clip.clone();
        c.tracks = c.tracks.filter((t) => !LIVE_BONES.test(t.name.split('.')[0] ?? ''));
        return c;
      }),
    [animations],
  );
  const { actions, mixer } = useAnimations(clips, group);
  const rig = useMemo(() => rigOf(scene), [scene]);
  const busy = useRef(false);
  const live = useRef({
    yaw: 0,
    pitch: 0,
    turn: 0,
    happy: 0,
    hover: 0,
    nextBlink: 1.2,
    blinkT: -1,
  });
  const tmp = useMemo(
    () => ({
      pivot: new THREE.Vector3(),
      camDir: new THREE.Vector3(),
      hit: new THREE.Vector3(),
      local: new THREE.Vector3(),
      origin: new THREE.Vector3(),
      plane: new THREE.Plane(),
      ray: new THREE.Raycaster(),
      q1: new THREE.Quaternion(),
      q2: new THREE.Quaternion(),
      qy: new THREE.Quaternion(),
      qp: new THREE.Quaternion(),
      up: new THREE.Vector3(),
      right: new THREE.Vector3(),
    }),
    [],
  );

  useEffect(() => {
    scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
  }, [scene]);

  useEffect(() => {
    actions.AN_Idle?.reset().play();
    const onFinished = (e: { action: THREE.AnimationAction }) => {
      if (e.action === actions.AN_Idle) return;
      busy.current = false;
      actions.AN_Idle?.reset().crossFadeFrom(e.action, 0.45, false).play();
    };
    mixer.addEventListener('finished', onFinished);
    return () => mixer.removeEventListener('finished', onFinished);
  }, [actions, mixer]);

  const play = useCallback(
    (move: Exclude<XedineMove, 'AN_Idle'>) => {
      const next = actions[move];
      const idle = actions.AN_Idle;
      if (!next || !idle || busy.current) return;
      busy.current = true;
      next.reset();
      next.setLoop(THREE.LoopOnce, 1);
      next.clampWhenFinished = true;
      next.crossFadeFrom(idle, 0.3, false).play();
    },
    [actions],
  );
  useImperativeHandle(ref, () => ({ play }), [play]);

  useFrame((state, delta) => {
    const g = group.current;
    const look = rig.looks[0];
    if (!g || !look) return;
    const s = live.current;
    const dt = Math.min(delta, 1 / 20);

    // Where is the pointer? On a plane between Xedine and the camera.
    look.getWorldPosition(tmp.pivot);
    state.camera.getWorldDirection(tmp.camDir);
    tmp.origin.copy(tmp.pivot).addScaledVector(tmp.camDir, -1.1);
    tmp.plane.setFromNormalAndCoplanarPoint(tmp.camDir, tmp.origin);
    tmp.ray.setFromCamera(state.pointer, state.camera);
    let yaw = 0;
    let pitch = 0;
    const focus = target?.current;
    if (focus) tmp.hit.copy(focus);
    if (focus || tmp.ray.ray.intersectPlane(tmp.plane, tmp.hit)) {
      g.worldToLocal(tmp.local.copy(tmp.hit));
      const pivotLocal = g.worldToLocal(tmp.origin.copy(tmp.pivot));
      tmp.local.sub(pivotLocal);
      yaw = Math.atan2(tmp.local.x, tmp.local.z);
      pitch = Math.atan2(tmp.local.y, Math.hypot(tmp.local.x, tmp.local.z));
    }
    // Small limits keep the eyes on the face; beyond them the body turns instead.
    s.yaw = damp(s.yaw, clamp(yaw, -0.36, 0.36), 9, dt);
    s.pitch = damp(s.pitch, clamp(pitch, -0.2, 0.18), 9, dt);
    s.turn = damp(s.turn, clamp((yaw + s.turn) * 0.3, -0.35, 0.35), 2.5, dt);
    g.rotation.y = s.turn;

    // Look: turn each eye around the dome's centre (it slides over the face, never off it).
    rig.looks.forEach((bone, i) => {
      const parent = bone.parent;
      if (!parent) return;
      g.getWorldQuaternion(tmp.q1).invert().multiply(parent.getWorldQuaternion(tmp.q2)).invert();
      tmp.up.copy(UP).applyQuaternion(tmp.q1);
      tmp.right.copy(RIGHT).applyQuaternion(tmp.q1);
      tmp.qy.setFromAxisAngle(tmp.up, s.yaw);
      tmp.qp.setFromAxisAngle(tmp.right, -s.pitch);
      bone.quaternion.copy(tmp.qy).multiply(tmp.qp).multiply(rig.lookRest[i]!);
    });

    // Blink every few seconds; squint happily while pointed at.
    s.nextBlink -= dt;
    if (s.nextBlink <= 0 && s.blinkT < 0) {
      s.blinkT = 0;
      s.nextBlink = 2 + Math.random() * 3.5;
    }
    let open = 1;
    if (s.blinkT >= 0) {
      s.blinkT += dt;
      const t = s.blinkT / 0.17;
      if (t >= 1) s.blinkT = -1;
      else open = 1 - 0.92 * Math.sin(Math.PI * t);
    }
    s.happy = damp(s.happy, s.hover, 6, dt);
    const squash = open * (1 - 0.32 * s.happy);
    rig.eyes.forEach((eye, i) => {
      eye.scale.copy(rig.eyeRest[i]!);
      eye.scale[rig.blinkAxis[i]!] *= squash;
    });
  });

  // The outer group places Xedine in the world (props); the inner one turns toward the visitor.
  return (
    <group {...props}>
      <group
        ref={group}
        onPointerOver={(e) => {
          e.stopPropagation();
          live.current.hover = 1;
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          live.current.hover = 0;
          document.body.style.cursor = '';
        }}
        onClick={(e) => {
          e.stopPropagation();
          play('AN_Wave');
        }}
      >
        <primitive object={scene} />
      </group>
    </group>
  );
});

useGLTF.preload(XEDINE_GLB, false, true);
