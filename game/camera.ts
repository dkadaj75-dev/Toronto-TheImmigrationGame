// camera.ts — ¾ overhead camera. One-finger pan, pinch zoom, mouse drag/wheel fallback.
// All clamps come from tuning.json (camera.*) — nothing hardcoded.

import * as THREE from 'three';
import type { TuningData, MapData } from './data';

export class TouchCamera {
  readonly camera: THREE.PerspectiveCamera;
  private target = new THREE.Vector3();
  private zoom: number;
  private pitchDeg: number;
  private yawDeg = 45;
  private tuning: TuningData['camera'];
  private bounds: { minX: number; maxX: number; minZ: number; maxZ: number };

  // gesture state
  private pointers = new Map<number, { x: number; y: number }>();
  private lastPinchDist = 0;

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
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) this.lastPinchDist = this.pinchDist();
    });
    el.addEventListener('pointermove', (e) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY };

      if (this.pointers.size === 1) {
        this.pan(cur.x - prev.x, cur.y - prev.y, el.clientHeight);
      }
      this.pointers.set(e.pointerId, cur);
      if (this.pointers.size === 2) {
        const d = this.pinchDist();
        if (this.lastPinchDist > 0) this.zoomBy(this.lastPinchDist / d);
        this.lastPinchDist = d;
      }
    });
    const end = (e: PointerEvent) => { this.pointers.delete(e.pointerId); this.lastPinchDist = 0; };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', (e) => { e.preventDefault(); this.zoomBy(1 + Math.sign(e.deltaY) * 0.1); }, { passive: false });
  }

  private pinchDist(): number {
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
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
