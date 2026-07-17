// garbage.ts — garbage cans + autonomous tidying (ROADMAP_NEXT item 10).
// Split like doors.ts/accidents.ts: pure fill/capacity bookkeeping + the auto-tidy-vs-drop decision
// is headless-tested in test/garbage.test.ts with zero THREE dependency; a thin three.js layer
// (GarbageController) scans the world for placed garbage-can instances and delegates the "drop it
// on the ground" case to game/accidents.ts's AccidentsController.spawnTransient — dirty_dishes is a
// transient asset, so it gets the exact same spawn/hierarchy/hot-reload/serialize machinery as any
// accident-spawned transient (fire/puddle/ash) for free, per the brief's own "reuse the
// accidents-registry spawn mechanics" instruction.
//
// WASTE FLOW DECISION (ROADMAP_NEXT item 10, verbatim from the roadmap slice):
//   On an action's stop, if it has `producesWaste` set (e.g. "eat" -> "dirty_dishes"):
//     1. find the nearest non-full garbage can (fill < capacity) anywhere in the world.
//     2. IF one exists within `tuning.garbage.autoTidyRadius` of the sim AND the sim's cleanliness
//        personality stat (`tuning.garbage.cleanlinessVar`, default id "cleanliness") is at least
//        `tuning.garbage.cleanlinessThreshold` -> AUTO-TIDY: that can's fill+1, no transient is ever
//        spawned.
//     3. ELSE -> DROP: spawn the `producesWaste` transient asset at the sim's position instead, to
//        be cleaned up later (the "clean_up" action, or emptying every can via the exterior door's
//        "empty_garbage" interaction).
//
// SIMPLIFICATION (documented, not an oversight): auto-tidy (waste production's own step 2 above)
// does NOT walk the sim to the can with a dedicated animation — deposit is instant/teleport-free
// the moment the waste-producing action stops. The roadmap brief explicitly allows this ("deposit
// is instant on arrival via existing activity flow if feasible, else teleport-free direct
// handling") and it mirrors the SAME simplification PROJECT_CONTEXT.md §7.14 already made for the
// exterior door ("no carrying sim animation" when emptying garbage).
//
// CARRY TO GARBAGE (ROADMAP_NEXT B3-5, upgrades the "drop" case's own cleanup path): completing
// clean_up (on dirty_dishes) or sweep (on ash) — i.e. the PLAYER-triggered cleanup of an already-
// dropped transient, not auto-tidy above — no longer despawns the transient in place. Instead
// game/main.ts's onActionStop routes the sim to nearestNonFullCanPos via a bare agent.goTo (no new
// ActionDef/ActiveAction — sim.ts still has no multi-leg activity chaining, so this is a second,
// independent walk order tracked by main.ts's own `carryState`, not sim.ts), and only on arrival
// (agent.isMoving going false) does it deposit (depositAtNearestCan, re-resolved at arrival time)
// and despawn (accidents.maybeCleanup). No carried-item visual follows the sim (documented skip of
// the brief's own "nice-to-have, skip if it bloats" clause) — the transient simply stays visible at
// its original spot until the sim reaches the can. Any other order (fresh tap, panic, bladder
// failure, a buy-mode stop-in-place) cancels the walk (main.ts's cancelCarry) and leaves the
// transient exactly where it was, still dirty, can fill untouched. `mop` (water_puddle/pee_puddle)
// is NOT part of this — puddles still despawn in place instantly, per the brief ("puddles just
// vanish").
//
// EMPTYING (the same roadmap slice's item 4: `empty_garbage` on `door_exterior`): resets EVERY
// garbage can's fill to 0 in one shot (GarbageRegistry.emptyAll) — same "no carrying sim animation"
// simplification, no per-can walk/collection loop.

import * as THREE from 'three';
import type { GameData, StatsData, TuningData } from './data';
import { resolveVar, type EvalContext } from './quests';
import type { AccidentsController } from './accidents';
import { clampProgress01, fillInnerHeight, fillScaleX, fillCenterX } from './progressbar';

// ==================================================================== pure fill/capacity bookkeeping

export interface GarbageSaveState { fills: [string, number][]; }

/**
 * Per-instance fill count, keyed by the live garbage-can instance's stable string identity (the
 * THREE.Object3D.uuid in the real game — same "no schema change to world.ts's placed-object
 * userData needed" identity convention as accidents.ts's baseKey). Pure — no THREE dependency —
 * headless-tested in test/garbage.test.ts. Mirrors AccidentRegistry/QuestRunner's
 * serialize()/restore() convention so a future save system is a direct JSON round-trip.
 */
export class GarbageRegistry {
  private fill = new Map<string, number>();

  fillOf(key: string): number { return this.fill.get(key) ?? 0; }
  isFull(key: string, capacity: number): boolean { return this.fillOf(key) >= capacity; }

  /** Deposits one unit of waste. Returns false (no-op) if the can is already full. */
  deposit(key: string, capacity: number): boolean {
    const f = this.fillOf(key);
    if (f >= capacity) return false;
    this.fill.set(key, f + 1);
    return true;
  }

  /** ROADMAP_NEXT item 4/10: the `empty_garbage` interaction resets EVERY can (seen or not) to 0. */
  emptyAll() { this.fill.clear(); }

  serialize(): GarbageSaveState { return { fills: [...this.fill.entries()] }; }
  restore(s: GarbageSaveState) { this.fill = new Map(s.fills ?? []); }
}

// ==================================================================== pure decision logic

/** `y` (world height, meters) is optional — only the fill-bar renderer below needs it (the
 *  auto-tidy distance math above is 2D, ground-plane only); absent/undefined treated as 0 by
 *  callers, and existing pre-fill-bar test fixtures that build CanCandidate literals without it
 *  stay valid. */
export interface CanCandidate { key: string; pos: [number, number]; capacity: number; y?: number; }
export interface NearestCan { key: string; pos: [number, number]; dist: number; }

/** Nearest can with fill < capacity, or null if every known can is full (or there are none at all). */
export function findNearestNonFullCan(
  simPos: [number, number],
  cans: CanCandidate[],
  fillOf: (key: string) => number,
): NearestCan | null {
  let best: NearestCan | null = null;
  for (const c of cans) {
    if (fillOf(c.key) >= c.capacity) continue;
    const dist = Math.hypot(c.pos[0] - simPos[0], c.pos[1] - simPos[1]);
    if (!best || dist < best.dist) best = { key: c.key, pos: c.pos, dist };
  }
  return best;
}

export interface FullestCan { key: string; pos: [number, number]; fill: number; dist: number; }

/** ITEM 3 (put-trash-out routing, 2026-07-17): pick the FULLEST can (highest fill), tie-break on
 *  nearest to `simPos`. Cans with zero fill are never chosen (nothing to collect there). Returns
 *  null when every known can is empty (or there are none) — main.ts then skips the collection leg
 *  and walks straight to the exterior door. Pure/headless-tested in test/garbage.test.ts. */
export function chooseFullestCan(
  simPos: [number, number],
  cans: CanCandidate[],
  fillOf: (key: string) => number,
): FullestCan | null {
  let best: FullestCan | null = null;
  for (const c of cans) {
    const fill = fillOf(c.key);
    if (fill <= 0) continue;
    const dist = Math.hypot(c.pos[0] - simPos[0], c.pos[1] - simPos[1]);
    if (!best || fill > best.fill || (fill === best.fill && dist < best.dist)) {
      best = { key: c.key, pos: c.pos, fill, dist };
    }
  }
  return best;
}

/** Fallback when `tuning.garbage` (or one of its fields) is absent. */
export const DEFAULT_GARBAGE_TUNING = { autoTidyRadius: 4, cleanlinessThreshold: 5, cleanlinessVar: 'cleanliness' };
export interface GarbageTuning { autoTidyRadius: number; cleanlinessThreshold: number; }

/** B6-4 baseline-one waste quantity with at most one probabilistic extra item. The probability is
 * linearly interpolated by any numeric quest-namespace stat, including personality.*. */
export function wasteItemCount(
  tuning: TuningData['waste'],
  ctx: EvalContext,
  stats: StatsData,
  rng: () => number = Math.random,
): number {
  if (!tuning?.extraChanceVar) return 1;
  const value = resolveVar(tuning.extraChanceVar, ctx);
  if (typeof value !== 'number') return 1;
  const id = tuning.extraChanceVar.slice(tuning.extraChanceVar.indexOf('.') + 1);
  const max = tuning.extraChanceVar.startsWith('skills.')
    ? stats.skills.find((entry) => entry.id === id)?.max ?? 100
    : tuning.extraChanceVar.startsWith('personality.')
      ? stats.personality?.find((entry) => entry.id === id)?.max ?? 100
      : 100;
  const t = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const atMin = tuning.extraAtMin ?? 0;
  const chance = Math.min(1, Math.max(0, atMin + ((tuning.extraAtMax ?? 0) - atMin) * t));
  return 1 + (rng() < chance ? 1 : 0);
}

export type WastePlan =
  | { kind: 'auto'; canKey: string; canPos: [number, number] }
  | { kind: 'drop' };

/**
 * ROADMAP_NEXT item 10's exact decision, pure and independently testable. `cleanliness` is the
 * sim's current value of the configured personality stat, or `undefined` if that stat doesn't
 * exist (deleted by the designer, or stats.json predates this slice) — treated as "not clean
 * enough" (always drop), the conservative fallback rather than silently skipping the gate.
 */
export function decideWasteHandling(
  simPos: [number, number],
  cans: CanCandidate[],
  fillOf: (key: string) => number,
  cleanliness: number | undefined,
  tuning: GarbageTuning,
): WastePlan {
  const nearest = findNearestNonFullCan(simPos, cans, fillOf);
  if (!nearest) return { kind: 'drop' };
  if (nearest.dist > tuning.autoTidyRadius) return { kind: 'drop' };
  if (cleanliness === undefined || cleanliness < tuning.cleanlinessThreshold) return { kind: 'drop' };
  return { kind: 'auto', canKey: nearest.key, canPos: nearest.pos };
}

// ==================================================================== fill-bar pure logic (designer
// request, 2026-07-16: a small in-world fill indicator over each garbage can)
//
// Mirrors game/progressbar.ts's own split exactly: the ratio/visibility/geometry math below is pure
// and headless-tested (test/garbage.test.ts); the three.js sprite rendering lives in
// GarbageFillBarController further down and REUSES progressbar.ts's exported bar-geometry helpers
// (fillInnerHeight/fillScaleX/fillCenterX/clampProgress01) rather than re-deriving the same
// symmetric-inset/camera-space-anchor math a second time — same CRITICAL lesson as the progress
// bar's own module doc comment: THREE.Sprite offsets are CAMERA-space, never world-space, so the
// fill sprite's "grows rightward from a fixed left edge" trick has to be expressed through
// sprite.center/scale exactly like progressbar.ts does, not through position.

/** Fallback when `tuning.garbage.fillBar` (or one of its fields) is absent — kept modest and
 *  visually distinct from the progress bar's own default (a different fillColor) so the two read
 *  as different HUD elements even when both are visible at once. */
export const DEFAULT_GARBAGE_FILLBAR = {
  widthMeters: 0.4, heightMeters: 0.06, yOffsetMeters: 0.55, fillColor: '#7ed957', trackColor: '#1c2436', showWhenEmpty: false,
  hideWhenOccluded: true,
};
export interface GarbageFillBarTuning {
  widthMeters: number; heightMeters: number; yOffsetMeters: number; fillColor: string; trackColor: string; showWhenEmpty: boolean;
  hideWhenOccluded: boolean;
}

/** ITEM 1 (fill-bar occlusion, 2026-07-17): pure decision from a camera-to-anchor raycast. Given
 *  the distance to the NEAREST occluder hit along the ray from the camera toward the bar anchor
 *  (`nearestHitDist`, or null when nothing was hit before the anchor) and the straight-line
 *  distance to the anchor itself (`anchorDist`), the bar is occluded iff something was hit
 *  meaningfully closer than the anchor. `eps` (meters) absorbs a grazing hit on the can's own top
 *  surface / a co-planar adjacent asset so the bar doesn't flicker at the edge. Pure/headless-tested
 *  in test/garbage.test.ts; the three.js raycast that produces `nearestHitDist` lives in
 *  GarbageFillBarController.updateOcclusion. */
export function fillBarOccluded(nearestHitDist: number | null, anchorDist: number, eps = 0.05): boolean {
  return nearestHitDist !== null && nearestHitDist < anchorDist - eps;
}

/** Fill ratio in [0,1] — 0 = empty, 1 = full. Guards a non-positive/misconfigured capacity (would
 *  otherwise divide by zero or go negative) by reporting empty rather than throwing. */
export function garbageFillRatio(fill: number, capacity: number): number {
  if (!(capacity > 0)) return 0;
  return clampProgress01(fill / capacity);
}

/** Whether the bar should be drawn at all: always once there's any fill, or always (even at 0) when
 *  the designer opts into `showWhenEmpty`. */
export function shouldShowFillBar(ratio: number, showWhenEmpty: boolean): boolean {
  return showWhenEmpty || ratio > 0;
}

/** Bar geometry fractions for a given ratio, expressed the identical way progressbar.ts's own
 *  ProgressBarInstance.update() sets its fill sprite — reused here (not reimplemented) so any future
 *  fix to the fill/track alignment math (see progressbar.ts's B6-1/B7-3 root-cause comments) applies
 *  to both bars for free. `innerHeight` only depends on heightMeters (not ratio) but is included here
 *  so callers/tests have the complete per-frame geometry in one place. */
export function garbageFillBarGeometry(widthMeters: number, heightMeters: number, ratio: number): { scaleX: number; centerX: number; innerHeight: number } {
  return {
    scaleX: fillScaleX(widthMeters, heightMeters, ratio),
    centerX: fillCenterX(ratio),
    innerHeight: fillInnerHeight(heightMeters),
  };
}

// ==================================================================== three.js layer

interface FillBarEntry { pivot: THREE.Group; bg: THREE.Sprite; fill: THREE.Sprite; bgMat: THREE.SpriteMaterial; fillMat: THREE.SpriteMaterial; }

/**
 * Renders one small camera-facing fill-bar sprite pair per live garbage can, keyed by the same
 * `obj.uuid` identity GarbageRegistry itself uses. Same ANCHOR DESIGN precedent as
 * progressbar.ts/marker.ts/censor.ts: bars are INDEPENDENT top-level objects added directly to
 * `scene` (never parented under a placed can or the world group), since game/main.ts's hot-reload
 * handler does `scene.remove(world); disposeGroup(world); world = buildWorld(data)` — parenting
 * under a world-owned object would silently delete the bar on every hot-reload. `sync()` is called
 * from main.ts right after every event that can change a can's fill OR the live can set itself
 * (deposit, emptyAll, carry-to-garbage arrival, and post-hot-reload/buy-mode-reattach) rather than
 * every render frame — the designer's own spec for this feature: "fill only changes on discrete
 * events," no sim-tick timer needed, mirroring GarbageRegistry's own event-driven (not polled)
 * bookkeeping.
 */
export class GarbageFillBarController {
  private bars = new Map<string, FillBarEntry>();
  private ray = new THREE.Raycaster();
  private tmpDir = new THREE.Vector3();

  constructor(private scene: THREE.Object3D) {}

  /** ITEM 1 (fill-bar occlusion, 2026-07-17): show/hide each live bar based on whether its can is
   *  occluded from `camera` by any `occluders` (main.ts passes the live world children — walls +
   *  placed asset meshes). Casts one cheap ray per bar from the camera toward the bar's own anchor
   *  (entry.pivot.position, already set by sync()), skipping hits that belong to the can the bar
   *  sits on (walk the hit's ancestry to `key`) so a can never occludes its own bar. Called on a
   *  THROTTLE from main.ts (camera move/rotate + a ~0.25s tick, not every frame — the only inputs
   *  that change occlusion are camera motion and the rare world rebuild, and fill bars are a small
   *  set). When `hideWhenOccluded` is off, every bar is forced visible (restores the tunable's
   *  opt-out cleanly). Visibility is owned ENTIRELY here; sync() only creates/removes bars and never
   *  touches `pivot.visible`, so the two never fight. */
  updateOcclusion(camera: THREE.Camera, occluders: THREE.Object3D[], hideWhenOccluded: boolean) {
    if (!hideWhenOccluded) {
      for (const entry of this.bars.values()) entry.pivot.visible = true;
      return;
    }
    const camPos = camera.position;
    for (const [key, entry] of this.bars) {
      const anchorDist = this.tmpDir.subVectors(entry.pivot.position, camPos).length();
      if (!(anchorDist > 1e-4)) { entry.pivot.visible = true; continue; }
      this.ray.set(camPos, this.tmpDir.multiplyScalar(1 / anchorDist));
      this.ray.far = anchorDist;
      const hits = this.ray.intersectObjects(occluders, true);
      let nearestHitDist: number | null = null;
      for (const hit of hits) {
        let o: THREE.Object3D | null = hit.object;
        let isSelf = false;
        while (o) { if (o.uuid === key) { isSelf = true; break; } o = o.parent; }
        if (isSelf) continue; // the can this bar belongs to never occludes its own bar
        nearestHitDist = hit.distance;
        break;
      }
      entry.pivot.visible = !fillBarOccluded(nearestHitDist, anchorDist);
    }
  }

  private ensure(key: string, cfg: GarbageFillBarTuning): FillBarEntry {
    const existing = this.bars.get(key);
    if (existing) return existing;
    const pivot = new THREE.Group();
    pivot.name = 'garbage-fill-bar';
    const bgMat = new THREE.SpriteMaterial({ color: cfg.trackColor, depthTest: false, transparent: true, opacity: 0.85 });
    const bg = new THREE.Sprite(bgMat);
    bg.renderOrder = 998;
    bg.scale.set(cfg.widthMeters, cfg.heightMeters, 1);
    const fillMat = new THREE.SpriteMaterial({ color: cfg.fillColor, depthTest: false });
    const fill = new THREE.Sprite(fillMat);
    fill.renderOrder = 999;
    fill.center.set(0.5, 0.5);
    fill.scale.set(0, fillInnerHeight(cfg.heightMeters), 1); // starts empty; sync() sets real scale/center
    pivot.add(bg, fill);
    this.scene.add(pivot);
    const entry: FillBarEntry = { pivot, bg, fill, bgMat, fillMat };
    this.bars.set(key, entry);
    return entry;
  }

  private remove(key: string) {
    const entry = this.bars.get(key);
    if (!entry) return;
    this.scene.remove(entry.pivot);
    entry.bgMat.dispose();
    entry.fillMat.dispose();
    this.bars.delete(key);
  }

  /** Resyncs bars to the live can set: creates a bar the first time a can becomes visible (fill > 0,
   *  or always when `showWhenEmpty`), updates position/fill for every visible can, and disposes bars
   *  for cans that are hidden (fill dropped back to 0 without showWhenEmpty) or no longer exist
   *  (sold/destroyed/hot-reloaded away). `cans` already carries each can's live world position/
   *  capacity (GarbageController.cans()); `fillOf` reads the pure registry. */
  sync(cans: CanCandidate[], fillOf: (key: string) => number, cfg: GarbageFillBarTuning) {
    const liveKeys = new Set(cans.map((c) => c.key));
    for (const key of [...this.bars.keys()]) if (!liveKeys.has(key)) this.remove(key);
    for (const can of cans) {
      const ratio = garbageFillRatio(fillOf(can.key), can.capacity);
      if (!shouldShowFillBar(ratio, cfg.showWhenEmpty)) { this.remove(can.key); continue; }
      const entry = this.ensure(can.key, cfg);
      entry.pivot.position.set(can.pos[0], (can.y ?? 0) + cfg.yOffsetMeters, can.pos[1]);
      const geom = garbageFillBarGeometry(cfg.widthMeters, cfg.heightMeters, ratio);
      entry.fill.scale.x = geom.scaleX;
      entry.fill.center.x = geom.centerX; // camera-space left anchor; never offset in world X (same B7-3 lesson as progressbar.ts)
    }
  }

  dispose() {
    for (const key of [...this.bars.keys()]) this.remove(key);
  }
}

/**
 * Thin three.js-aware wrapper: scans the live world for placed garbage-can instances (any placed
 * object whose AssetDef carries a `garbage` block — designer-placed OR buy-mode-purchased, both
 * tag `userData.assetId` the same way, see world.ts/buymode.ts), applies decideWasteHandling on a
 * producesWaste action's stop, and owns the pure GarbageRegistry's fill bookkeeping. The "drop"
 * case delegates to AccidentsController.spawnTransient rather than duplicating mesh/hierarchy/
 * hot-reload code (see module doc comment).
 */
export class GarbageController {
  readonly registry = new GarbageRegistry();
  private readonly fillBars: GarbageFillBarController;

  constructor(
    private getData: () => GameData,
    private getWorld: () => THREE.Group,
    scene: THREE.Object3D,
  ) {
    this.fillBars = new GarbageFillBarController(scene);
  }

  private fillBarTuning(): GarbageFillBarTuning {
    const f = this.getData().tuning.garbage?.fillBar;
    return {
      widthMeters: f?.widthMeters ?? DEFAULT_GARBAGE_FILLBAR.widthMeters,
      heightMeters: f?.heightMeters ?? DEFAULT_GARBAGE_FILLBAR.heightMeters,
      yOffsetMeters: f?.yOffsetMeters ?? DEFAULT_GARBAGE_FILLBAR.yOffsetMeters,
      fillColor: f?.fillColor ?? DEFAULT_GARBAGE_FILLBAR.fillColor,
      trackColor: f?.trackColor ?? DEFAULT_GARBAGE_FILLBAR.trackColor,
      showWhenEmpty: f?.showWhenEmpty ?? DEFAULT_GARBAGE_FILLBAR.showWhenEmpty,
      hideWhenOccluded: f?.hideWhenOccluded ?? DEFAULT_GARBAGE_FILLBAR.hideWhenOccluded,
    };
  }

  /** ITEM 1 (2026-07-17): recompute per-can fill-bar occlusion against the live world. main.ts calls
   *  this on a throttle (camera move + ~0.25s) — see GarbageFillBarController.updateOcclusion. */
  updateFillBarOcclusion(camera: THREE.Camera, occluders: THREE.Object3D[]) {
    this.fillBars.updateOcclusion(camera, occluders, this.fillBarTuning().hideWhenOccluded);
  }

  /** Designer request (2026-07-16): resync every can's fill-bar sprite to the live can set + fill
   *  state. Call after anything that can change a can's fill (deposit/emptyAll/carry-arrival) or the
   *  live can set itself (world rebuild/hot-reload, buy-mode reattach/sell) — see
   *  GarbageFillBarController's own doc comment for why this is event-driven, not per-frame. */
  syncFillBars() {
    this.fillBars.sync(this.cans(), (k) => this.registry.fillOf(k), this.fillBarTuning());
  }

  disposeFillBars() { this.fillBars.dispose(); }

  private tuning(): GarbageTuning {
    const g = this.getData().tuning.garbage;
    return {
      autoTidyRadius: g?.autoTidyRadius ?? DEFAULT_GARBAGE_TUNING.autoTidyRadius,
      cleanlinessThreshold: g?.cleanlinessThreshold ?? DEFAULT_GARBAGE_TUNING.cleanlinessThreshold,
    };
  }

  /** Which personality stat id gates auto-tidying (default "cleanliness") — callers read this
   *  value out of SimStats.personality themselves and pass it into handleWaste/hasNonFullCan. */
  cleanlinessVarId(): string { return this.getData().tuning.garbage?.cleanlinessVar ?? DEFAULT_GARBAGE_TUNING.cleanlinessVar; }

  private cans(): CanCandidate[] {
    const data = this.getData();
    const out: CanCandidate[] = [];
    for (const obj of this.getWorld().children) {
      if (obj.visible === false) continue;
      const assetId = obj.userData?.assetId as string | undefined;
      if (!assetId) continue;
      const def = data.assets.assets.find((a) => a.id === assetId);
      if (!def?.garbage) continue;
      out.push({ key: obj.uuid, pos: [obj.position.x, obj.position.z], capacity: def.garbage.capacity, y: obj.position.y });
    }
    return out;
  }

  /** Player-facing pre-check for the `clean_up` action (item 3: "if ALL cans full/none, action
   *  refuses with a HUD toast") — call BEFORE ordering the walk so the sim never sets off toward a
   *  transient it can't actually finish cleaning up. */
  hasNonFullCan(): boolean {
    const cans = this.cans();
    return cans.some((c) => this.registry.fillOf(c.key) < c.capacity);
  }

  /** ROADMAP_NEXT B3-5 "carry to garbage": the nearest non-full can's world position from `simPos`,
   *  or null if every can is full (or none exist) — main.ts routes the sim there (agent.goTo) once
   *  a clean_up/sweep action completes on a non-puddle transient, instead of despawning it in place. */
  nearestNonFullCanPos(simPos: [number, number]): [number, number] | null {
    const cans = this.cans();
    const nearest = findNearestNonFullCan(simPos, cans, (k) => this.registry.fillOf(k));
    return nearest ? nearest.pos : null;
  }

  /** ITEM 3 (put-trash-out routing, 2026-07-17): world position of the FULLEST can (tie-break
   *  nearest to `simPos`), or null if every can is empty. main.ts routes the take-out-trash flow
   *  here FIRST (collection leg) before the exterior door. See chooseFullestCan. */
  fullestCanPos(simPos: [number, number]): [number, number] | null {
    const c = chooseFullestCan(simPos, this.cans(), (k) => this.registry.fillOf(k));
    return c ? c.pos : null;
  }

  /** ITEM 3: fill of a specific live can Object3D (keyed by uuid) — main.ts uses this to decide
   *  whether an `empty_garbage` action ordered directly ON a can makes that can the first stop. */
  fillOfObject(obj: THREE.Object3D): number { return this.registry.fillOf(obj.uuid); }

  /** Call from main.ts's onActionStop whenever the just-stopped action's `producesWaste` is set.
   *  `cleanliness` is the sim's current value of `cleanlinessVarId()` (or undefined if that stat
   *  doesn't exist). `accidents` supplies spawnTransient for the drop case. Returns the plan taken
   *  (purely for logging/testing convenience). */
  handleWaste(wasteAssetId: string, simPos: [number, number], cleanliness: number | undefined, accidents: AccidentsController): WastePlan {
    const cans = this.cans();
    const plan = decideWasteHandling(simPos, cans, (k) => this.registry.fillOf(k), cleanliness, this.tuning());
    if (plan.kind === 'auto') {
      const capacity = cans.find((c) => c.key === plan.canKey)?.capacity ?? Infinity;
      this.registry.deposit(plan.canKey, capacity);
      this.syncFillBars(); // fill-bar request: a deposit can flip a can's bar from hidden to visible (or grow it)
    } else {
      accidents.spawnTransient(wasteAssetId, simPos);
    }
    return plan;
  }

  /** ROADMAP_NEXT B3-5: called once the sim's "carry to garbage" walk (main.ts's carryState)
   *  arrives at the can — deposits into whichever can is nearest AT ARRIVAL TIME (re-resolved, not
   *  necessarily the same can `nearestNonFullCanPos` picked when the walk started, in case another
   *  deposit filled it up in the meantime), then main.ts despawns the transient via the ordinary
   *  clearedBy/maybeCleanup mechanism right after. Returns false (no-op) if every can somehow
   *  filled up during the walk — the transient still despawns via clearedBy either way (the sim
   *  did carry it out, it just didn't "count" toward any can) — an acceptable, documented edge case
   *  rather than adding rollback/retry complexity. */
  depositAtNearestCan(simPos: [number, number]): boolean {
    const cans = this.cans();
    const nearest = findNearestNonFullCan(simPos, cans, (k) => this.registry.fillOf(k));
    if (!nearest) return false;
    const capacity = cans.find((c) => c.key === nearest.key)?.capacity ?? Infinity;
    const deposited = this.registry.deposit(nearest.key, capacity);
    if (deposited) this.syncFillBars(); // fill-bar request: reflect the carry-to-garbage deposit immediately
    return deposited;
  }

  /** ROADMAP_NEXT item 4: the exterior door's `empty_garbage` interaction — resets every can. */
  emptyAll() {
    this.registry.emptyAll();
    this.syncFillBars(); // fill-bar request: every bar should disappear (or reset, if showWhenEmpty) on empty
  }

  serialize(): GarbageSaveState { return this.registry.serialize(); }
  restore(s: GarbageSaveState) { this.registry.restore(s); }
}
