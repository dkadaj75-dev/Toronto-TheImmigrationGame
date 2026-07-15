// camera.ts — ¾ overhead camera. One-finger pan, pinch zoom, mouse drag/wheel fallback,
// plus yaw rotation: desktop right-mouse drag, mobile two-finger twist (coexists with pinch).
// All clamps/speeds come from tuning.json (camera.*) — nothing hardcoded.

import * as THREE from 'three';
import type { TuningData, MapData } from './data';

const DEFAULT_ROTATE_SPEED_DEG_PER_PX = 0.3;
const DEFAULT_TWIST_DEADZONE_DEG = 1.5;
const DEFAULT_TWIST_SPEED = 1.2;

/** Angle (degrees, atan2 convention) of the vector from touch a to touch b. Pure/testable. */
export function twoTouchAngleDeg(ax: number, ay: number, bx: number, by: number): number {
  return THREE.MathUtils.radToDeg(Math.atan2(by - ay, bx - ax));
}

/** Shortest signed delta (degrees, in [-180, 180]) rotating from `from` to `to`. Pure/testable. */
export function shortestAngleDeltaDeg(from: number, to: number): number {
  let delta = (to - from) % 360;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta;
}

export class TouchCamera {
  readonly camera: THREE.PerspectiveCamera;
  private target = new THREE.Vector3();
  private zoom: number;
  private pitchDeg: number;
  private yawDeg = 45;
  private tuning: TuningData['camera'];
  private bounds: { minX: number; maxX: number; minZ: number; maxZ: number };

  // gesture state
  private pointers = new Map<number, { x: number; y: number; button: number }>();
  private lastPinchDist = 0;
  private lastTwistAngleDeg = 0;

  constructor(aspect: number, tuning: TuningData['camera'], map: MapData) {
    this.tuning = tuning;
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 200);
    this.zoom = (tuning.minZoom + tuning.maxZoom) / 2;
    this.pitchDeg = (tuning.minPitchDeg + tuning.maxPitchDeg) / 2;
    const p = tuning.panBoundsPadding;
    this.bounds = { minX: -p, maxX: map.bounds.w + p, minZ: -p, maxZ: map.bounds.h + p };
    this.target.set(map.bounds.w / 2, 0, map.bounds.h / 2);
    this.apply();
  }

  retune(tuning: TuningData['camera'], map: MapData) {
    this.tuning = tuning;
    const p = tuning.panBoundsPadding;
    this.bounds = { minX: -p, maxX: map.bounds.w + p, minZ: -p, maxZ: map.bounds.h + p };
    this.clampAll();
    this.apply();
  }

  attach(el: HTMLElement) {
    // right-mouse drag rotates the camera rather than issuing a tap/move order (input.ts ignores
    // non-left buttons for the same reason) — suppress the browser's own context menu on the canvas.
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button });
      if (this.pointers.size === 2) {
        this.lastPinchDist = this.pinchDist();
        this.lastTwistAngleDeg = this.pinchAngle();
      }
    });
    el.addEventListener('pointermove', (e) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY, button: prev.button };

      if (this.pointers.size === 1) {
        if (prev.button === 2) this.rotateBy((cur.x - prev.x) * -this.rotateSpeedDegPerPx());
        else this.pan(cur.x - prev.x, cur.y - prev.y, el.clientHeight);
      }
      this.pointers.set(e.pointerId, cur);
      if (this.pointers.size === 2) {
        // pinch (distance) and twist (angle) are independent measurements of the same two
        // touches, so both can apply within a single gesture without interfering.
        const d = this.pinchDist();
        if (this.lastPinchDist > 0) this.zoomBy(this.lastPinchDist / d);
        this.lastPinchDist = d;

        const a = this.pinchAngle();
        const delta = shortestAngleDeltaDeg(this.lastTwistAngleDeg, a);
        this.lastTwistAngleDeg = a;
        // dead zone: small angle jitter that naturally happens while pinching is dropped
        // entirely (not accumulated) so it never "spins" the camera.
        if (Math.abs(delta) > this.twistDeadzoneDeg()) this.rotateBy(delta * this.twistSpeed());
      }
    });
    const end = (e: PointerEvent) => { this.pointers.delete(e.pointerId); this.lastPinchDist = 0; };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', (e) => { e.preventDefault(); this.zoomBy(1 + Math.sign(e.deltaY) * 0.1); }, { passive: false });
  }

  private rotateSpeedDegPerPx(): number { return this.tuning.rotateSpeedDegPerPx ?? DEFAULT_ROTATE_SPEED_DEG_PER_PX; }
  private twistDeadzoneDeg(): number { return this.tuning.twistDeadzoneDeg ?? DEFAULT_TWIST_DEADZONE_DEG; }
  private twistSpeed(): number { return this.tuning.twistSpeed ?? DEFAULT_TWIST_SPEED; }

  private pinchDist(): number {
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private pinchAngle(): number {
    const [a, b] = [...this.pointers.values()];
    return twoTouchAngleDeg(a.x, a.y, b.x, b.y);
  }

  private rotateBy(deltaDeg: number) {
    this.yawDeg = (this.yawDeg + deltaDeg + 360) % 360;
    this.apply();
  }

  private pan(dxPx: number, dyPx: number, viewportH: number) {
    // convert pixel drag to world units at current zoom
    const worldPerPx = (this.zoom * 1.2) / viewportH;
    const yaw = THREE.MathUtils.degToRad(this.yawDeg);
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    this.target.addScaledVector(right, -dxPx * worldPerPx);
    this.target.addScaledVector(fwd, -dyPx * worldPerPx);
    this.clampAll();
    this.apply();
  }

  private zoomBy(factor: number) {
    this.zoom *= factor;
    this.clampAll();
    this.apply();
  }

  private clampAll() {
    this.zoom = THREE.MathUtils.clamp(this.zoom, this.tuning.minZoom, this.tuning.maxZoom);
    this.pitchDeg = THREE.MathUtils.clamp(this.pitchDeg, this.tuning.minPitchDeg, this.tuning.maxPitchDeg);
    this.target.x = THREE.MathUtils.clamp(this.target.x, this.bounds.minX, this.bounds.maxX);
    this.target.z = THREE.MathUtils.clamp(this.target.z, this.bounds.minZ, this.bounds.maxZ);
  }

  private apply() {
    const pitch = THREE.MathUtils.degToRad(this.pitchDeg);
    const yaw = THREE.MathUtils.degToRad(this.yawDeg);
    const offset = new THREE.Vector3(
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      Math.cos(yaw) * Math.cos(pitch),
    ).multiplyScalar(this.zoom);
    this.camera.position.copy(this.target).add(offset);
    this.camera.lookAt(this.target);
  }

  resize(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
