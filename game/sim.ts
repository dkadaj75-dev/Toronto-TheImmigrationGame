// sim.ts — Phase 1 slice 1: the sim walks where the player taps.
// Speed and arrival radius come from tuning.json (movement.*) — design pillar: no magic numbers.
// Needs/autonomy/actions plug into this same class in the next slices.

import * as THREE from 'three';
import type { TuningData, ActionDef, GameData } from './data';
import { findPath, nearestWalkable, worldToCell, cellCenter, type NavGrid } from './nav';

/** What the sim is doing right now. */
export interface ActiveAction {
  action: ActionDef;
  target: THREE.Object3D;
  /** where the sim actually sits/lies while performing (couch for TV, the bed itself for sleep) */
  seat: THREE.Object3D | null;
}

/**
 * For a seat-aware action, find the nearest seat-target object to the action's object
 * (e.g. the couch closest to the TV). Returns null when the home has no seats —
 * the sim then just stands, the graceful fallback.
 */
export function findSeatFor(world: THREE.Group, data: GameData, target: THREE.Object3D): THREE.Object3D | null {
  const assetsById = new Map(data.assets.assets.map((a) => [a.id, a]));
  let best: THREE.Object3D | null = null;
  let bestDist = Infinity;
  for (const obj of world.children) {
    const assetId = obj.userData?.assetId as string | undefined;
    if (!assetId || obj === target) continue;
    const def = assetsById.get(assetId);
    if (!def?.seatTarget) continue;
    const d = obj.position.distanceTo(target.position);
    if (d < bestDist) { bestDist = d; best = obj; }
  }
  return best;
}

export class SimAgent {
  private path: [number, number][] = [];
  private pathIndex = 0;
  /** action waiting for arrival at its object */
  private queued: ActiveAction | null = null;
  /** action currently being performed */
  current: ActiveAction | null = null;
  /** fired when a queued action starts (arrival at the object) */
  onActionStart: ((a: ActiveAction) => void) | null = null;
  /** fired when the current action stops for any reason */
  onActionStop: ((a: ActiveAction) => void) | null = null;
  /** fired when walking starts/stops — drives idle↔walk animation without per-frame polling */
  onLocomotionChange: ((moving: boolean) => void) | null = null;
  /** true once the rigged GLB is attached: real clips replace the transform-pose hacks */
  hasRig = false;
  private wasMoving = false;

  constructor(
    public readonly object: THREE.Group,
    private grid: NavGrid,
    private tuning: TuningData,
  ) {}

  /** Called on data hot-reload so speed/radius tweaks apply live. */
  retune(tuning: TuningData, grid: NavGrid) {
    this.tuning = tuning;
    this.grid = grid;
  }

  /** Route to a world position. Cancels any action. Returns false if no path exists. */
  goTo(x: number, z: number): boolean {
    this.stopAction();
    this.queued = null;
    return this.route(x, z);
  }

  /**
   * Walk to an object, then perform an action on it. For seat-aware actions pass the
   * resolved seat (findSeatFor) — the sim walks to the seat instead and sits facing the
   * target. Unreachable seat falls back to standing at the target. Returns false only
   * if neither is reachable.
   */
  orderAction(action: ActionDef, target: THREE.Object3D, seat: THREE.Object3D | null = null): boolean {
    this.stopAction();
    const routeToObj = (obj: THREE.Object3D): boolean => {
      const stand = nearestWalkable(this.grid, worldToCell(this.grid, obj.position.x, obj.position.z));
      if (!stand) return false;
      const [sx, sz] = cellCenter(this.grid, stand);
      return this.route(sx, sz);
    };
    if (seat && routeToObj(seat)) {
      this.queued = { action, target, seat };
      return true;
    }
    if (routeToObj(target)) {
      this.queued = { action, target, seat: null };
      return true;
    }
    return false;
  }

  /** Stop the current action (auto-stop, player override, hot-reload). */
  stopAction() {
    if (this.current) {
      const a = this.current;
      this.current = null;
      this.restorePose();
      this.onActionStop?.(a);
    }
  }

  /** Hard relocation (map switch): clears path, queued & current action, sets position/facing. */
  teleportTo(x: number, z: number, facingDeg = 0) {
    this.stopAction();
    this.queued = null;
    this.path = [];
    this.pathIndex = 0;
    this.object.position.set(x, 0, z);
    this.object.rotation.set(0, (facingDeg * Math.PI) / 180, 0);
  }

  // --- stand-in poses (replaced by real animation clips when the rigged GLB lands) ---
  private savedPose: { pos: THREE.Vector3; rotX: number } | null = null;

  private applyPose(a: ActiveAction) {
    const anim = a.action.animation;
    const perch = a.seat ?? (anim === 'lie' ? a.target : null); // sleep lies on the bed itself
    if (!perch || (anim !== 'sit' && anim !== 'lie')) return;

    this.savedPose = { pos: this.object.position.clone(), rotX: this.object.rotation.x };
    this.object.position.x = perch.position.x;
    this.object.position.z = perch.position.z;
    // perch heights come from tuning.character (fallbacks preserve pre-rig behavior)
    const c = this.tuning.character;
    if (anim === 'sit') {
      this.object.position.y = c?.sitHeight ?? 0.25; // perched on the seat
    } else {
      this.object.position.y = c?.lieHeight ?? 0.55; // lying on top of the bed
      // capsule stand-in tips over to "lie"; a rigged lie clip is already horizontal
      if (!this.hasRig) this.object.rotation.x = -Math.PI / 2;
    }
  }

  private restorePose() {
    if (!this.savedPose) return;
    this.object.position.copy(this.savedPose.pos); // back to the stand cell beside the seat
    this.object.rotation.x = this.savedPose.rotX;
    this.savedPose = null;
  }

  private route(x: number, z: number): boolean {
    const p = this.object.position;
    const path = findPath(this.grid, [p.x, p.z], [x, z]);
    if (!path) return false;
    this.path = path;
    this.pathIndex = 0;
    return true;
  }

  get isMoving(): boolean {
    return this.pathIndex < this.path.length;
  }

  /** Moving, en route to an action, or performing one — autonomy stays out of the way. */
  get isBusy(): boolean {
    return this.isMoving || this.queued !== null || this.current !== null;
  }

  update(dt: number) {
    if (this.isMoving !== this.wasMoving) {
      this.wasMoving = this.isMoving;
      this.onLocomotionChange?.(this.isMoving);
    }
    if (!this.isMoving) return;
    const speed = this.tuning.movement.walkSpeed;
    const arrive = this.tuning.movement.arrivalRadius;
    const p = this.object.position;
    let budget = speed * dt;

    while (budget > 0 && this.pathIndex < this.path.length) {
      const [tx, tz] = this.path[this.pathIndex];
      const dx = tx - p.x, dz = tz - p.z;
      const dist = Math.hypot(dx, dz);
      const isLast = this.pathIndex === this.path.length - 1;

      if (dist <= (isLast ? Math.max(arrive, 1e-3) : 1e-3)) {
        this.pathIndex++;
        continue;
      }

      // face the direction of travel (nose cone points +Z in the stand-in)
      this.object.rotation.y = lerpAngle(this.object.rotation.y, Math.atan2(dx, dz), Math.min(1, dt * 10));

      const step = Math.min(budget, dist);
      p.x += (dx / dist) * step;
      p.z += (dz / dist) * step;
      budget -= step;
    }

    // arrived → start the queued action, facing its object
    if (!this.isMoving && this.queued) {
      const a = this.queued;
      this.queued = null;
      this.current = a;
      this.applyPose(a); // sit on the couch / lie on the bed first…
      const dx = a.target.position.x - p.x, dz = a.target.position.z - p.z;
      if (Math.hypot(dx, dz) > 1e-3) this.object.rotation.y = Math.atan2(dx, dz); // …then face the target from where we ended up
      this.onActionStart?.(a);
    }
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** Sims-style click cue: a ring that pulses at the tapped spot, then fades. */
export class ClickCue {
  readonly object: THREE.Mesh;
  private life = 0;

  constructor() {
    const geo = new THREE.RingGeometry(0.18, 0.28, 32);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0x6fe36f, transparent: true, opacity: 0, depthWrite: false });
    this.object = new THREE.Mesh(geo, mat);
    this.object.position.y = 0.02;
    this.object.visible = false;
  }

  showAt(x: number, z: number) {
    this.object.position.x = x;
    this.object.position.z = z;
    this.object.visible = true;
    this.life = 0.8;
  }

  update(dt: number) {
    if (!this.object.visible) return;
    this.life -= dt;
    if (this.life <= 0) { this.object.visible = false; return; }
    const t = this.life / 0.8;
    const s = 1 + (1 - t) * 0.8;
    this.object.scale.setScalar(s);
    (this.object.material as THREE.MeshBasicMaterial).opacity = t;
  }
}
