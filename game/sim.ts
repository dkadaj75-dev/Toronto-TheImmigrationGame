// sim.ts — Phase 1 slice 1: the sim walks where the player taps.
// Speed and arrival radius come from tuning.json (movement.*) — design pillar: no magic numbers.
// Needs/autonomy/actions plug into this same class in the next slices.

import * as THREE from 'three';
import type { TuningData, ActionDef, GameData, AssetDef } from './data';
import { findPath, nearestWalkable, worldToCell, cellCenter, type NavGrid } from './nav';
import { useSpotFor, isInFrontHalfSpace, viewingPointFor, usePoseFor, type FacingInstance } from './facing';

/** THREE.Object3D → the {pos, rotDeg} shape facing.ts's pure math works with. Objects are
 *  placed with `obj.rotation.y = degToRad(placed.rotDeg)` and nothing else touches that outer
 *  rotation (world.ts), so this recovers the exact original instance rotation. */
function facingInstanceOf(obj: THREE.Object3D): FacingInstance {
  return { pos: [obj.position.x, obj.position.z], rotDeg: THREE.MathUtils.radToDeg(obj.rotation.y) };
}

/** What the sim is doing right now. */
export interface ActiveAction {
  action: ActionDef;
  target: THREE.Object3D;
  /** where the sim actually sits/lies while performing (couch for TV, the bed itself for sleep) */
  seat: THREE.Object3D | null;
  /** ROADMAP_NEXT item 2: true when a seat-aware action found no eligible seat (none within
   *  tuning.interaction.seatSearchRadius, or the resolved seat was unreachable) — the sim sits
   *  on the ground at its walked-to spot instead of snapping onto the target object itself. */
  groundSit?: boolean;
}

/**
 * For a seat-aware action, find the best seat-target object to serve the action's object
 * (e.g. the couch that faces the TV) — §7.2's "sit in front of the TV" screen: candidate
 * seats are filtered to the target's front half-space (dot(seatPos − targetPos, targetFacing)
 * > 0) AND within `tuning.interaction.seatSearchRadius` of the target itself (ROADMAP_NEXT
 * item 2, default 5 — "no eligible seat" beyond this range), then the nearest to a viewing
 * point projected out along the target's facing wins among survivors.
 * This replaces the old "nearest seat regardless of side" heuristic and the TV-specific
 * RightVector exception the Unreal prototype needed (CLAUDE.md ANIMATION_PLAN Phase A) —
 * with per-asset facingDeg, any seat-aware asset gets the same treatment for free.
 * Returns null when the home has no seat in front of the target within range — the caller
 * (sim.ts's orderAction) then falls back to sitting the sim on the ground (groundSit).
 */
export function findSeatFor(world: THREE.Group, data: GameData, target: THREE.Object3D): THREE.Object3D | null {
  const assetsById = new Map(data.assets.assets.map((a) => [a.id, a]));
  const targetDef = assetsById.get(target.userData?.assetId as string);
  if (!targetDef) return null;
  const targetInstance = facingInstanceOf(target);
  const viewPoint = viewingPointFor(targetInstance, targetDef, data.tuning);
  const searchRadius = data.tuning.interaction?.seatSearchRadius ?? 5;

  let best: THREE.Object3D | null = null;
  let bestDist = Infinity;
  for (const obj of world.children) {
    const assetId = obj.userData?.assetId as string | undefined;
    if (!assetId || obj === target) continue;
    const def = assetsById.get(assetId);
    if (!def?.seatTarget) continue;
    if (!isInFrontHalfSpace([obj.position.x, obj.position.z], targetInstance, targetDef)) continue;
    const distToTarget = Math.hypot(obj.position.x - targetInstance.pos[0], obj.position.z - targetInstance.pos[1]);
    if (distToTarget > searchRadius) continue;
    const d = Math.hypot(obj.position.x - viewPoint[0], obj.position.z - viewPoint[1]);
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
    /** id → AssetDef lookup for perch (sit/lie) pose resolution (usePoseFor) — a plain test
     *  double with no userData.assetId simply misses this map and gets the pre-usePose
     *  fallback (see applyPose), so omitting this param is still safe. */
    private assetsById: Map<string, AssetDef> = new Map(),
  ) {}

  /** Called on data hot-reload so speed/radius/asset-def tweaks apply live. */
  retune(tuning: TuningData, grid: NavGrid, assetsById?: Map<string, AssetDef>) {
    this.tuning = tuning;
    this.grid = grid;
    if (assetsById) this.assetsById = assetsById;
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
   *
   * `targetDef` (optional, §7.2): when supplied, the walk-to point for `target` is
   * useSpotFor's footprint-edge-along-facing point instead of the raw pivot — the sim
   * approaches the asset from its front (fridge, stove, sink…) rather than beelining to
   * its center. Omitting it (e.g. tests with no asset data) falls back to the old pivot
   * heuristic. The seat branch is unchanged — sitting is still ON the seat, not in front
   * of it — and either way the FINAL sit/lie position still snaps onto the seat/target
   * itself once arrived (applyPose, below), so this only changes where the sim walks to.
   *
   * `seatAware` (optional, ROADMAP_NEXT item 2): pass the action's own `seatAware` flag (NOT
   * just "was a seat resolved") so that BOTH "no eligible seat found" (`seat` is null) AND
   * "a seat was found but is unreachable" (falls through to the target-front branch below)
   * are treated the same way — the queued action is flagged `groundSit`, and the sim sits on
   * the floor at wherever it walked to instead of snapping onto the target object itself
   * (which, for something like a TV, made no sense — see sim.ts's applyPose doc comment).
   * Actions that aren't seat-aware at all (seatAware omitted/false) never set groundSit; they
   * keep whatever pose their own `action.animation` implies, unchanged.
   */
  orderAction(action: ActionDef, target: THREE.Object3D, seat: THREE.Object3D | null = null, targetDef?: AssetDef, seatAware = false): boolean {
    this.stopAction();
    const routeToPivot = (obj: THREE.Object3D): boolean => {
      const stand = nearestWalkable(this.grid, worldToCell(this.grid, obj.position.x, obj.position.z));
      if (!stand) return false;
      const [sx, sz] = cellCenter(this.grid, stand);
      return this.route(sx, sz);
    };
    const routeToTargetFront = (obj: THREE.Object3D, def: AssetDef): boolean => {
      const [fx, fz] = useSpotFor(facingInstanceOf(obj), def, this.tuning);
      const stand = nearestWalkable(this.grid, worldToCell(this.grid, fx, fz));
      if (!stand) return routeToPivot(obj); // front cell unreachable (e.g. asset flush against a wall) — old heuristic still works
      const [sx, sz] = cellCenter(this.grid, stand);
      return this.route(sx, sz);
    };
    if (seat && routeToPivot(seat)) {
      this.queued = { action, target, seat };
      return true;
    }
    const reachedTarget = targetDef ? routeToTargetFront(target, targetDef) : routeToPivot(target);
    if (reachedTarget) {
      this.queued = { action, target, seat: null, groundSit: seatAware };
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

  /**
   * Snap onto the seat/target for sit/lie actions (roadmap item 1 fix, PROJECT_CONTEXT.md §7.8):
   * category is derived from `action.animation`'s "sit_"/"lie_" prefix (interactions.json's
   * actual values — "sit_idle", "sit_eat", "lie_sleep" — never matched the old EXACT 'sit'/'lie'
   * comparison, so this never fired for any shipped action; that silent no-op, not pivot math,
   * was the actual root cause of "sits/lies completely outside the furniture": the sim was left
   * standing at its walk-up approach point, useSpotFor's point OUTSIDE the footprint edge).
   * `perch` also now defaults to `a.target` (not just seat-aware actions' resolved seat) — a
   * plain "Sit" on an armchair has no separate seat object, the armchair itself IS the seat.
   * Stand actions (prefix neither "sit" nor "lie", e.g. "stand_use") are left alone: the sim
   * stays at its walked-to spot, which is already a sensible "stand in front of it" position.
   */
  private applyPose(a: ActiveAction) {
    if (a.groundSit) {
      // ROADMAP_NEXT item 2: no eligible seat in range — sit right where the sim already
      // walked to (useSpotFor's in-front-of-the-target spot) instead of snapping onto the
      // target object itself (which, e.g. for a TV, made no geometric sense). Animation state
      // is resolved separately by the caller (main.ts) to 'sit_ground', not action.animation.
      this.savedPose = { pos: this.object.position.clone(), rotX: this.object.rotation.x };
      this.object.position.y = 0;
      return;
    }
    const anim = a.action.animation;
    const pose: 'sit' | 'lie' | null = anim.startsWith('lie') ? 'lie' : anim.startsWith('sit') ? 'sit' : null;
    if (!pose) return;
    const perch = a.seat ?? a.target;

    this.savedPose = { pos: this.object.position.clone(), rotX: this.object.rotation.x };

    const def = this.assetsById.get(perch.userData?.assetId as string);
    if (def) {
      const { pos, y, facingDeg } = usePoseFor(pose, facingInstanceOf(perch), def, this.tuning);
      this.object.position.x = pos[0];
      this.object.position.z = pos[1];
      this.object.position.y = y;
      this.object.rotation.y = THREE.MathUtils.degToRad(facingDeg); // may be overridden right after by "face the target" (update())
    } else {
      // no AssetDef on record (e.g. a bare test double) — old fallback: snap onto the perch's
      // raw position at the tuning height, no rotation override.
      const c = this.tuning.character;
      this.object.position.x = perch.position.x;
      this.object.position.z = perch.position.z;
      this.object.position.y = pose === 'sit' ? (c?.sitHeight ?? 0.25) : (c?.lieHeight ?? 0.55);
    }
    // capsule stand-in tips over to "lie"; a rigged lie clip is already horizontal
    if (pose === 'lie' && !this.hasRig) this.object.rotation.x = -Math.PI / 2;
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

  /** Current position + remaining unvisited waypoints — the "current nav path" systems like
   *  game/doors.ts's crossing test need to know what the sim is about to walk through. Empty
   *  while not moving (nothing planned to cross anything). */
  getPathPoints(): [number, number][] {
    if (!this.isMoving) return [];
    return [[this.object.position.x, this.object.position.z], ...this.path.slice(this.pathIndex)];
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
