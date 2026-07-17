// accidents.ts — accident risk rolls, placement, cleanup despawn (PROJECT_CONTEXT.md §7.3).
// Split like doors.ts: pure logic (risk math, placement selection, footprint overlap, the
// instance registry incl. serialize()/restore()) is headless-tested in test/accidents.test.ts;
// a thin three.js layer (AccidentsController) turns that into live meshes wired into main.ts's
// tap/autonomy/environment code paths, mirroring world.ts's "instant stand-in box, async GLB
// swap, keep the box on failure" pattern for furniture and doors.ts's own precedent.
//
// ROLL TIMING (§7.3: "once, when a sim finishes an action on the asset"): hooked to
// SimAgent.onActionStop in main.ts, which fires for EVERY stop reason — natural auto-stop
// (primaryNeed threshold), player cancel, or a fresh order overriding the current one. This is
// deliberate, not just "whatever's convenient": several actions (e.g. "cook") have
// `primaryNeed: null` and therefore NEVER auto-stop on their own (main.ts's gainAcc loop only
// auto-stops when a primaryNeed is set) — gating the roll on natural completion only would make
// their risk completely unreachable. §7.3 doesn't distinguish "cancelled early" from "ran to
// completion" either, so onActionStop's broad "the sim is done using this thing for now" is the
// correct reading.
//
// HIERARCHY (§7.3's exact rule): an accident instance whose footprint OVERLAPS a base asset's
// footprint blocks that asset — tapping it shows only the accident's own interactions, and
// autonomy skips it entirely. Overlap is purely geometric (AccidentRegistry.findBlocking), not
// keyed by "which asset triggered this accident" — a puddle that drifts under a neighboring
// chair blocks the chair too, even though the chair didn't cause it. The SEPARATE
// no-duplicate-stacking rule ("don't stack two instances of the same accident type on the same
// base asset") IS keyed by triggering instance (AccidentRegistry.canSpawn's baseKey), because
// that's a re-roll suppression concern, not a geometry concern.
//
// BASE-KEY IDENTITY: `THREE.Object3D.uuid` (built-in, unique per instance) is used as the
// stable string identifying "which specific placed asset instance triggered this accident" —
// no schema change to world.ts's placed-object userData was needed.

import * as THREE from 'three';
import type { AssetDef, AccidentRisk, AccidentRiskModifier, GameData, StatsData } from './data';
import type { EvalContext } from './quests';
import { resolveVar } from './quests';
import { type NavGrid, type Cell, isWalkable, worldToCell, cellCenter } from './nav';
import { attachMesh } from './world';

// ==================================================================== pure risk math

/** A modifier's percentage-point contribution: lerp(pctAt0 → pctAtMax) by resolved-stat / max.
 *  Unknown ids and non-numeric namespaces (vars.*, quests.*.state, ...) resolve to `undefined`/
 *  non-number via quests.ts's resolveVar and contribute exactly 0 — documented, never throws,
 *  matching quests.ts's own "unknown id → false/0, never throw" philosophy. */
export function accidentModifierContribution(mod: AccidentRiskModifier, ctx: EvalContext, stats: StatsData): number {
  const raw = resolveVar(mod.var, ctx);
  if (typeof raw !== 'number') return 0;
  const max = statMaxFor(mod.var, stats);
  const t = max > 0 ? clamp01(raw / max) : 0;
  return mod.pctAt0 + (mod.pctAtMax - mod.pctAt0) * t;
}

/** needs.<id> always interpolates against 100 (stats.ts's decayTick/applyGains hardcode that
 *  clamp for every need); skills.<id> uses that skill's own `max` from stats.json (default 100
 *  if somehow missing a def). Any other namespace (funds/time/vars/quests) isn't part of §7.3's
 *  spec'd use case, but interpolating against 100 rather than throwing keeps resolveVar's own
 *  "never throw" contract intact — documented as an edge case, not a primary path. */
function statMaxFor(varPath: string, stats: StatsData): number {
  if (varPath.startsWith('skills.')) {
    const id = varPath.slice('skills.'.length);
    return stats.skills.find((s) => s.id === id)?.max ?? 100;
  }
  return 100;
}

/** chance = clamp(base + Σ modifier contributions, 0, 100) — §7.3's risk formula, verbatim. */
export function computeAccidentChance(risk: AccidentRisk, ctx: EvalContext, stats: StatsData): number {
  let total = risk.baseChancePercent;
  for (const mod of risk.modifiers ?? []) total += accidentModifierContribution(mod, ctx, stats);
  return clamp(total, 0, 100);
}

/** One roll. `rng` is injectable (tests pass a fixed/sequenced fake; production defaults to
 *  Math.random) so the roll itself is deterministic and testable like doors.ts's swing timing. */
export function rollAccident(chancePercent: number, rng: () => number = Math.random): boolean {
  return rng() * 100 < chancePercent;
}

// ==================================================================== fire destruction/spread (ROADMAP_NEXT item 6, pure)

/** Fallback when `tuning.fire` is absent (pre-existing tuning fixtures/tests). */
export const DEFAULT_FIRE_TUNING = { burnSeconds: 30, spreadRadius: 2 };

/** True once a fire instance has burned (while still un-extinguished — i.e. still present in the
 *  registry; extinguishing already despawns it via the ordinary clearedBy/maybeCleanup path) for
 *  at least `burnSeconds`. `now`/`bornAt` are sim-time elapsed seconds — game/main.ts's own
 *  monotonic accumulator, NOT the wrapping day/night clock (a fire spanning midnight must not see
 *  its elapsed time jump backward). */
export function fireShouldDestroy(bornAt: number, now: number, burnSeconds: number): boolean {
  return now - bornAt >= burnSeconds;
}

/** Should THIS fire attempt its one-time roll against this candidate object right now? False if
 *  already rolled for this exact (fire, candidate) pair, the candidate is out of `spreadRadius`,
 *  or its own `delaySeconds` (measured from the fire's own `bornAt`) hasn't elapsed yet. Doesn't
 *  perform the roll itself — mirrors `computeAccidentChance`/`rollAccident`'s own decide-then-roll
 *  split, and mirrors §7.3's "gets ONE roll (per fire, per object)" wording exactly: once this
 *  returns true the caller must mark it rolled regardless of the roll's outcome. */
export function spreadShouldRoll(
  alreadyRolled: boolean,
  distance: number,
  spreadRadius: number,
  fireBornAt: number,
  now: number,
  delaySeconds: number,
): boolean {
  if (alreadyRolled) return false;
  if (distance > spreadRadius) return false;
  return now - fireBornAt >= delaySeconds;
}

// ==================================================================== footprint geometry

export interface Rect { x0: number; x1: number; z0: number; z1: number; }

/** Axis-aligned footprint rectangle in world space, with the SAME 90°-step swap rule
 *  nav.ts's bakeNavGrid and facing.ts's placedHalfExtents already use (a ~90°/~270° instance
 *  rotation swaps width/depth). */
export function footprintRect(pos: [number, number], rotDeg: number, footprint: [number, number]): Rect {
  let [w, d] = footprint;
  if ((((Math.round(rotDeg) % 180) + 180) % 180) === 90) [w, d] = [d, w];
  return { x0: pos[0] - w / 2, x1: pos[0] + w / 2, z0: pos[1] - d / 2, z1: pos[1] + d / 2 };
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;
}

// ==================================================================== placement selection

export interface PlacementPlan { placement: 'on' | 'adjacent'; pos: [number, number]; }

/** Scans a Chebyshev ring (grid-cell distance, matching "1–2 grid squares away") around
 *  `baseCell` for cells that are walkable (nav.ts already excludes walls AND static furniture
 *  footprints) AND pass the caller's extra `isFree` check (dynamic occupancy — other live
 *  accident instances aren't baked into the nav grid). Returns null when nothing qualifies —
 *  the caller falls back to "on" placement (§7.3: "If no free cell exists, fall back to 'on'"). */
export function findAdjacentCell(
  grid: NavGrid,
  baseCell: Cell,
  range: [number, number],
  isFree: (cell: Cell) => boolean,
  rng: () => number,
): Cell | null {
  const [minR, maxR] = range;
  const candidates: Cell[] = [];
  for (let dr = -maxR; dr <= maxR; dr++) {
    for (let dc = -maxR; dc <= maxR; dc++) {
      const dist = Math.max(Math.abs(dr), Math.abs(dc));
      if (dist < minR || dist > maxR) continue;
      const cell: Cell = { col: baseCell.col + dc, row: baseCell.row + dr };
      if (!isWalkable(grid, cell)) continue;
      if (!isFree(cell)) continue;
      candidates.push(cell);
    }
  }
  if (candidates.length === 0) return null;
  const idx = Math.min(candidates.length - 1, Math.floor(rng() * candidates.length));
  return candidates[idx];
}

/** Deterministic nearest-free fallback over expanding Chebyshev rings. */
export function findNearestFreeCell(
  grid: NavGrid,
  baseCell: Cell,
  isFree: (cell: Cell) => boolean,
): Cell | null {
  const maxRadius = Math.max(grid.cols, grid.rows);
  for (let radius = 0; radius <= maxRadius; radius++) {
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== radius) continue;
        const cell = { col: baseCell.col + dc, row: baseCell.row + dr };
        if (isWalkable(grid, cell) && isFree(cell)) return cell;
      }
    }
  }
  return null;
}

/**
 * Full placement decision for one risk entry (§7.3): "on" spawns at the base asset's own
 * position (same cells as the base asset — the point of a kitchen fire being ON the stove);
 * "adjacent" picks a random free in-bounds non-wall cell in `adjacentRange` squares, then expands
 * to the nearest free grid cell if that preferred ring is crowded. Only a completely full grid
 * retains the legacy "on" fallback; the live controller refuses an overlapping adjacent spawn.
 */
export function planAccidentPlacement(
  risk: AccidentRisk,
  basePos: [number, number],
  grid: NavGrid,
  isFree: (cell: Cell) => boolean,
  rng: () => number,
): PlacementPlan {
  if (risk.placement === 'adjacent') {
    const baseCell = worldToCell(grid, basePos[0], basePos[1]);
    const range = risk.adjacentRange ?? [1, 2];
    const cell = findAdjacentCell(grid, baseCell, range, isFree, rng);
    if (cell) return { placement: 'adjacent', pos: cellCenter(grid, cell) };
    const fallback = findNearestFreeCell(grid, baseCell, isFree);
    if (fallback) return { placement: 'adjacent', pos: cellCenter(grid, fallback) };
    // No free floor cell anywhere: preserve the pure legacy fallback; the controller rejects it.
  }
  return { placement: 'on', pos: basePos };
}

// ==================================================================== instance registry (pure)

export interface AccidentInstanceRecord {
  /** stable unique id within this registry, e.g. "fire#0" */
  key: string;
  /** which accident-category asset this instance is (an AssetDef id, e.g. "fire") */
  accidentId: string;
  pos: [number, number];
  rotDeg: number;
  footprint: [number, number];
  placement: 'on' | 'adjacent';
  /** which base-asset instance triggered this roll (THREE.Object3D.uuid in the live game),
   *  or null if spawned without a known trigger (e.g. restored from an old save). Used ONLY
   *  by the no-duplicate-stacking rule — hierarchy blocking is purely geometric (see below). */
  baseKey: string | null;
  /** ROADMAP_NEXT item 6 (fire): sim-time elapsed seconds (game/main.ts's monotonic clock, NOT
   *  the wrapping day clock) when this instance was spawned. Only meaningful for `fire` instances
   *  (burn-timer/spread-delay math); left undefined for every other accident type, and for `ash`
   *  it's just informational (ash has no timer of its own today). */
  bornAt?: number;
}

export interface AccidentsSaveState {
  instances: AccidentInstanceRecord[];
  seq: number;
  /** ROADMAP_NEXT item 6: baseKeys a fire has already burned down to ash — `canSpawn` refuses to
   *  spawn ANY new accident on one (rule: "a fire on a destroyed/ash spot doesn't re-roll the same
   *  object"). Optional so pre-fire save shapes/tests stay valid. */
  destroyedBase?: string[];
  /** ROADMAP_NEXT item 6: (fire instance key) → set of candidate baseKeys already given their
   *  one-time spread roll against that fire, win or lose. Optional for the same reason. */
  spreadRolled?: [string, string[]][];
}

/**
 * Pure runtime state — no THREE dependency, so spawn/despawn/hierarchy/serialize are all
 * headless-testable (test/accidents.test.ts). Mirrors QuestRunner's serialize()/restore()
 * convention (PROJECT_CONTEXT.md §3.3) so a future save system is a direct
 * `JSON.stringify(registry.serialize())` / `registry.restore(parsed)` call.
 */
export class AccidentRegistry {
  private instances: AccidentInstanceRecord[] = [];
  private seq = 0;
  /** ROADMAP_NEXT item 6: baseKeys destroyed down to ash — persists past the fire instance's own
   *  despawn (unlike the no-duplicate-stacking check below, which only looks at currently-live
   *  instances) so a burned-down spot never re-ignites or hosts any other accident type either. */
  private destroyedBase = new Set<string>();
  /** ROADMAP_NEXT item 6: fire instance key → candidate baseKeys already given their one-time
   *  spread roll against THAT fire (win or lose) — cleared automatically when the fire despawns. */
  private spreadRolled = new Map<string, Set<string>>();

  get all(): readonly AccidentInstanceRecord[] { return this.instances; }

  /** §7.3: "don't stack two instances of the same accident type on the same base asset." A
   *  null baseKey (unknown trigger) never blocks anything — only exact (accidentId, baseKey)
   *  pairs collide. Different accident types CAN coexist on the same base asset (not forbidden
   *  by the spec — e.g. nothing stops a stove from independently risking both fire and, if a
   *  designer configured it, a puddle). ROADMAP_NEXT item 6: a destroyed baseKey can never spawn
   *  anything at all, regardless of accidentId — it's ash now, not a stove. */
  canSpawn(accidentId: string, baseKey: string | null): boolean {
    if (baseKey === null) return true;
    if (this.destroyedBase.has(baseKey)) return false;
    return !this.instances.some((i) => i.accidentId === accidentId && i.baseKey === baseKey);
  }

  spawn(rec: Omit<AccidentInstanceRecord, 'key'>): AccidentInstanceRecord {
    const full: AccidentInstanceRecord = { key: `${rec.accidentId}#${this.seq++}`, ...rec };
    this.instances.push(full);
    return full;
  }

  despawn(key: string): AccidentInstanceRecord | null {
    const idx = this.instances.findIndex((i) => i.key === key);
    if (idx === -1) return null;
    this.spreadRolled.delete(key); // no more meaning once the fire itself is gone
    return this.instances.splice(idx, 1)[0];
  }

  /** ROADMAP_NEXT item 6: marks a baseKey as burned down to ash — see `canSpawn`/`destroyedBase`. */
  markDestroyed(baseKey: string) { this.destroyedBase.add(baseKey); }
  isDestroyed(baseKey: string): boolean { return this.destroyedBase.has(baseKey); }

  /** ROADMAP_NEXT item 6: has `fireKey` already used its one-time roll against `candidateKey`? */
  hasRolledSpread(fireKey: string, candidateKey: string): boolean {
    return this.spreadRolled.get(fireKey)?.has(candidateKey) ?? false;
  }
  markSpreadRolled(fireKey: string, candidateKey: string) {
    let set = this.spreadRolled.get(fireKey);
    if (!set) { set = new Set(); this.spreadRolled.set(fireKey, set); }
    set.add(candidateKey);
  }

  /** §7.3 hierarchy: the first live instance whose footprint overlaps the given base asset's
   *  footprint, or null if none do (no hierarchy — the base asset behaves normally). Geometric
   *  only — see the module doc comment for why this is deliberately NOT keyed by baseKey. */
  findBlocking(basePos: [number, number], baseRotDeg: number, baseFootprint: [number, number]): AccidentInstanceRecord | null {
    const baseRect = footprintRect(basePos, baseRotDeg, baseFootprint);
    for (const inst of this.instances) {
      if (rectsOverlap(footprintRect(inst.pos, inst.rotDeg, inst.footprint), baseRect)) return inst;
    }
    return null;
  }

  serialize(): AccidentsSaveState {
    return {
      instances: this.instances.map((i) => ({ ...i })),
      seq: this.seq,
      destroyedBase: [...this.destroyedBase],
      spreadRolled: [...this.spreadRolled.entries()].map(([k, v]) => [k, [...v]]),
    };
  }

  restore(s: AccidentsSaveState) {
    this.instances = s.instances.map((i) => ({ ...i }));
    this.seq = s.seq;
    this.destroyedBase = new Set(s.destroyedBase ?? []);
    this.spreadRolled = new Map((s.spreadRolled ?? []).map(([k, v]) => [k, new Set(v)]));
  }
}

/** §7.3 cleanup: does completing `actionId` on an accident instance despawn it? Pulled out as
 *  its own pure function (rather than inlined) so the decision is independently unit-tested. */
export function shouldDespawnOnCleanup(actionId: string, clearedBy: string[] | undefined): boolean {
  return !!clearedBy?.includes(actionId);
}

/** ROADMAP_NEXT item 2 (designer-placed puddle cleanup): should a clearing action remove a
 *  DESIGNER-PLACED (map placedObject) instance of a clearedBy-matching asset? A designer puddle is
 *  NOT in the AccidentRegistry (it lives in map.placedObjects, not spawned at runtime), so
 *  `maybeCleanup` never touches it — main.ts removes it from the scene via the buy-mode overlay
 *  instead. Gated on `completed` here so the side_effect_rule (side effects fire ONLY on completed
 *  actions, never on cancels/interrupts) is enforced in one pure, unit-tested place: an interrupted
 *  mop must leave the puddle. */
export function shouldRemovePlacedOnCleanup(completed: boolean, actionId: string, clearedBy: string[] | undefined): boolean {
  return completed && shouldDespawnOnCleanup(actionId, clearedBy);
}

/** §7.3 hierarchy decision — what asset id the tap menu should build actions from: the
 *  blocking accident's, if any, otherwise the tapped base asset's own. Kept as an explicit
 *  named function (not inlined in main.ts) so the decision itself is unit-tested. */
export function resolveTapAssetId(baseAssetId: string, blocking: AccidentInstanceRecord | null): string {
  return blocking ? blocking.accidentId : baseAssetId;
}

/** §7.3 hierarchy decision — autonomy must skip a base asset's actions entirely while
 *  something blocks it. */
export function isAutonomyBlocked(blocking: AccidentInstanceRecord | null): boolean {
  return blocking !== null;
}

function clamp(v: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, v)); }
function clamp01(v: number): number { return clamp(v, 0, 1); }

// ==================================================================== three.js layer

const ACCIDENT_STANDIN_COLORS: Record<string, number> = { fire: 0xff6a3d, water_puddle: 0x4fa8e0, ash: 0x5a5450, dirty_dishes: 0xcbb994, pee_puddle: 0xd8c14a, snack: 0xe3b45b, meal: 0xc98247 };
/** Flat (non-upright) stand-ins — puddles, ash, and dropped dirty dishes (ROADMAP_NEXT item 10;
 *  pee_puddle, ROADMAP_NEXT B2-4, is the same shape as water_puddle) all lie on the floor rather
 *  than standing up like a fire block. */
const FLAT_ACCIDENT_IDS = new Set(['water_puddle', 'ash', 'dirty_dishes', 'pee_puddle', 'snack', 'meal']);

/** Footprint-sized colored box, same "instant stand-in" philosophy as world.ts's makeStandIn —
 *  swapped for a GLB clone OR (§7.5) an image/GIF sprite if/when `def.mesh` loads, via world.ts's
 *  shared `attachMesh` (see buildGroup below). Puddles/ash render thin/flat and non-shadow-casting;
 *  anything else (fire) gets a small upright block. */
function makeAccidentStandIn(def: AssetDef): THREE.Group {
  const g = new THREE.Group();
  g.name = `accident:${def.id}`;
  const [fw, fd] = def.footprint;
  const color = ACCIDENT_STANDIN_COLORS[def.id] ?? 0xd14f4f;
  const isFlat = FLAT_ACCIDENT_IDS.has(def.id);
  const height = isFlat ? 0.03 : 0.5;
  const mat = new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.85 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(fw * 0.9, height, fd * 0.9), mat);
  body.position.y = height / 2;
  body.castShadow = !isFlat;
  g.add(body);
  return g;
}

function disposeAccidentGroup(g: THREE.Group) {
  g.traverse((o) => {
    if (o instanceof THREE.Mesh && !o.userData.sharedResource) {
      o.geometry.dispose();
      const m = o.material;
      (Array.isArray(m) ? m : [m]).forEach((mm) => mm.dispose());
    }
  });
}

/**
 * Thin three.js-aware wrapper around AccidentRegistry: owns the live THREE.Group per instance,
 * rolls risk on action completion, resolves the tap/autonomy hierarchy against live objects,
 * and re-parents surviving instances across main.ts's hot-reload world rebuilds (§7.3:
 * "Hot-reload of data must not wipe live accident instances").
 */
export class AccidentsController {
  readonly registry = new AccidentRegistry();
  private groups = new Map<string, THREE.Group>();

  constructor(
    private getData: () => GameData,
    private getWorld: () => THREE.Group,
    private getGrid: () => NavGrid,
    /** ROADMAP_NEXT item 6: called when a fire finishes burning down its base object. Kept as an
     *  injected callback (not a direct import) so accidents.ts stays independent of buymode.ts —
     *  the two modules already have a one-way import the other direction (buymode.ts reuses
     *  accidents.ts's footprintRect/rectsOverlap), and a back-import would create a cycle.
     *  main.ts wires this to `buyMode.instanceForObject` + `buyMode.destroyInstance` + a nav
     *  rebake. Optional so tests/tools that don't care about destruction can omit it. */
    private destroyBase?: (obj: THREE.Object3D) => void,
    /** ROADMAP_NEXT B2-5: called whenever a `fire` instance SPAWNS — either a direct onUse risk
     *  roll (`spawn`, below) or a spread success (`spawnFireOn`, below). Fired AFTER the live group
     *  is built (so the fire is already visible/queryable when the callback runs), and only for
     *  `accidentId === 'fire'` (a non-fire accident, e.g. water_puddle, never panics the sim).
     *  Injected callback, same reasoning as `destroyBase` above (keeps accidents.ts independent of
     *  main.ts's panic-timer state) — main.ts wires this to its own triggerPanic closure. Optional
     *  so tests/tools that don't care about panic can omit it. */
    private onFireSpawned?: (rec: AccidentInstanceRecord) => void,
  ) {}

  /** Live THREE.Object3D for a registry instance (used to redirect a blocked tap's walk/action
   *  target onto the accident itself instead of the base asset it's blocking). */
  groupFor(key: string): THREE.Object3D | null { return this.groups.get(key) ?? null; }

  /** §7.3 hierarchy: which accident (if any) currently blocks this base-asset Object3D. Accident
   *  instances never block each other (or themselves). */
  blockingFor(obj: THREE.Object3D, def: AssetDef): AccidentInstanceRecord | null {
    if (def.category === 'transient') return null;
    const pos: [number, number] = [obj.position.x, obj.position.z];
    const rotDeg = THREE.MathUtils.radToDeg(obj.rotation.y);
    return this.registry.findBlocking(pos, rotDeg, def.footprint);
  }

  isBlocked(obj: THREE.Object3D, def: AssetDef): boolean {
    return isAutonomyBlocked(this.blockingFor(obj, def));
  }

  /**
   * Roll every "onUse" risk entry configured on `def` — call from SimAgent.onActionStop when
   * the just-stopped action's target is a normal (non-accident) asset. `ctx` is the live stat
   * snapshot (needs/skills/funds/time/vars/quests) built by the caller, reused as-is against
   * quests.ts's resolveVar (§7.3: "reuse game/quests.ts's path resolution, don't reinvent").
   */
  rollFor(targetObj: THREE.Object3D, def: AssetDef, ctx: EvalContext, now: number, rng: () => number = Math.random) {
    if (def.category === 'transient' || !def.accidents?.length) return;
    const baseKey = targetObj.uuid;
    const stats = this.getData().stats;
    for (const risk of def.accidents) {
      if (risk.trigger !== 'onUse') continue; // only trigger implemented today (§7.3)
      if (!this.registry.canSpawn(risk.accidentId, baseKey)) continue;
      const chance = computeAccidentChance(risk, ctx, stats);
      if (!rollAccident(chance, rng)) continue;
      this.spawn(risk, targetObj, baseKey, now, rng);
    }
  }

  /** ROADMAP_NEXT item 10 (garbage/tidying): spawn a transient instance directly, with no risk roll
   *  and no triggering base object — e.g. game/garbage.ts's "drop a dirty_dishes pile near the sim"
   *  fallback. Reuses the EXACT same registry + live-group machinery as an onUse-rolled accident
   *  (hierarchy blocking, hot-reload reattach, clearedBy cleanup via onActionStop, serialize/restore
   *  all apply identically — a transient spawned this way is otherwise indistinguishable from one
   *  spawned via risk), per the brief's "reuse the accidents-registry spawn mechanics" instruction.
   *  `baseKey` is null (no triggering asset instance), so the no-duplicate-stacking rule never
   *  applies to it. Returns null (and warns) if `assetId` isn't a live transient-category asset. */
  spawnTransient(assetId: string, pos: [number, number], rotDeg = 0, now?: number): AccidentInstanceRecord | null {
    const def = this.getData().assets.assets.find((a) => a.id === assetId && a.category === 'transient');
    if (!def) { console.warn(`spawnTransient: unknown transient asset "${assetId}"`); return null; }
    const freePos = this.resolveFreePosition(def, pos, rotDeg);
    if (!freePos) { console.warn(`spawnTransient: no free floor cell for "${assetId}"`); return null; }
    const rec = this.registry.spawn({ accidentId: assetId, pos: freePos, rotDeg, footprint: def.footprint, placement: 'on', baseKey: null, bornAt: now });
    this.buildGroup(rec, def);
    return rec;
  }

  /** B4-2 visual seam: carried food stays in this controller's normal transient machinery, but is
   *  hidden while held/eaten and moved to the sim's exact position if interrupted. */
  setTransientPlacement(key: string, pos: [number, number], visible: boolean) {
    const rec = this.registry.all.find((i) => i.key === key);
    const group = this.groups.get(key);
    if (!rec || !group) return false;
    const def = this.getData().assets.assets.find((a) => a.id === rec.accidentId);
    const resolved = visible && def ? this.resolveFreePosition(def, pos, rec.rotDeg, key) : pos;
    if (!resolved) return false;
    rec.pos = [...resolved];
    group.position.set(resolved[0], 0, resolved[1]);
    group.visible = visible;
    return true;
  }

  /** Public only for B4-2 consumption/perishing; cleanup actions still use maybeCleanup. */
  despawnTransient(key: string) { this.despawn(key); }

  private spawn(risk: AccidentRisk, baseObj: THREE.Object3D, baseKey: string, now: number, rng: () => number) {
    const data = this.getData();
    const accidentDef = data.assets.assets.find((a) => a.id === risk.accidentId && a.category === 'transient');
    if (!accidentDef) { console.warn(`accident risk references unknown accident asset "${risk.accidentId}"`); return; }
    const grid = this.getGrid();
    const basePos: [number, number] = [baseObj.position.x, baseObj.position.z];
    const isFree = (cell: Cell) => this.isPlacementFree(accidentDef, cellCenter(grid, cell), 0);
    const plan = planAccidentPlacement(risk, basePos, grid, isFree, rng);
    if (risk.placement === 'adjacent' && !this.isPlacementFree(accidentDef, plan.pos, 0)) {
      console.warn(`accident spawn: no free floor cell for "${accidentDef.id}"`);
      return;
    }
    const rec = this.registry.spawn({
      accidentId: accidentDef.id, pos: plan.pos, rotDeg: 0,
      footprint: accidentDef.footprint, placement: plan.placement, baseKey, bornAt: now,
    });
    this.buildGroup(rec, accidentDef);
    // ROADMAP_NEXT B2-5: an onUse risk can spawn any accident (fire, water_puddle, ...) — only a
    // fire triggers panic.
    if (accidentDef.id === 'fire') this.onFireSpawned?.(rec);
  }

  /** Candidate footprint must avoid every live normal placed object and other transient. */
  private isPlacementFree(def: AssetDef, pos: [number, number], rotDeg: number, ignoreKey?: string): boolean {
    const rect = footprintRect(pos, rotDeg, def.footprint);
    if (this.registry.all.some((inst) => inst.key !== ignoreKey
      && rectsOverlap(rect, footprintRect(inst.pos, inst.rotDeg, inst.footprint)))) return false;
    const data = this.getData();
    for (const obj of this.getWorld().children) {
      if (obj.visible === false) continue;
      const placedDef = data.assets.assets.find((asset) => asset.id === obj.userData?.assetId);
      if (!placedDef || placedDef.category === 'transient') continue;
      const placedRect = footprintRect(
        [obj.position.x, obj.position.z],
        THREE.MathUtils.radToDeg(obj.rotation.y),
        placedDef.footprint,
      );
      if (rectsOverlap(rect, placedRect)) return false;
    }
    return true;
  }

  private resolveFreePosition(def: AssetDef, pos: [number, number], rotDeg: number, ignoreKey?: string): [number, number] | null {
    const grid = this.getGrid();
    const cell = findNearestFreeCell(grid, worldToCell(grid, pos[0], pos[1]), (candidate) =>
      this.isPlacementFree(def, cellCenter(grid, candidate), rotDeg, ignoreKey));
    return cell ? cellCenter(grid, cell) : null;
  }

  // ------------------------------------------------------ fire destruction/spread (ROADMAP_NEXT item 6)

  /** Per-frame fire tick: call once per render frame with the sim-time monotonic clock (same `sdt`
   *  accumulator doors/anim/sprites already advance on — pause freezes fire, 2x/3x speeds it up).
   *  Rolls spread against nearby combustible objects for every live fire, then destroys (base
   *  object → ash) any fire that's burned past `tuning.fire.burnSeconds`. Two separate passes over
   *  a stable snapshot array (not `this.registry.all` directly) so destroying one fire mid-loop
   *  never disturbs the other pass's iteration. */
  tick(now: number, rng: () => number = Math.random) {
    const tuning = this.getData().tuning.fire ?? DEFAULT_FIRE_TUNING;
    const fires = this.registry.all.filter((i) => i.accidentId === 'fire' && i.bornAt !== undefined);
    for (const fire of fires) this.rollSpreadFor(fire, tuning, now, rng);
    for (const fire of fires) {
      if (fireShouldDestroy(fire.bornAt!, now, tuning.burnSeconds)) this.destroyBaseAndAsh(fire, now);
    }
  }

  /** Scans every live, visible, asset-tagged object in the world for spread candidacy against one
   *  fire: within `spreadRadius`, has `combustibility` set, hasn't had its one-time roll against
   *  THIS fire yet, and its `delaySeconds` has elapsed since the fire started. Invisible objects
   *  (sold/destroyed via the buy-mode overlay) are skipped — a burned-down ash pile or a sold
   *  object never catches fire (§7.3-adjacent rule: "a fire on a destroyed/ash spot doesn't
   *  re-roll the same object"), and `registry.canSpawn`'s `destroyedBase` check is the
   *  belt-and-braces backstop for the same rule at the pure-logic layer. */
  private rollSpreadFor(fire: AccidentInstanceRecord, tuning: { burnSeconds: number; spreadRadius: number }, now: number, rng: () => number) {
    const data = this.getData();
    for (const obj of this.getWorld().children) {
      if (obj.visible === false) continue;
      const assetId = obj.userData?.assetId as string | undefined;
      if (!assetId || obj.uuid === fire.baseKey) continue; // the burning object itself isn't a spread target
      const def = data.assets.assets.find((a) => a.id === assetId);
      if (!def?.combustibility) continue;
      const candidateKey = obj.uuid;
      const already = this.registry.hasRolledSpread(fire.key, candidateKey);
      const dist = Math.hypot(obj.position.x - fire.pos[0], obj.position.z - fire.pos[1]);
      if (!spreadShouldRoll(already, dist, tuning.spreadRadius, fire.bornAt!, now, def.combustibility.delaySeconds)) continue;
      this.registry.markSpreadRolled(fire.key, candidateKey); // one roll, win or lose — never again for this pair
      if (!this.registry.canSpawn('fire', candidateKey)) continue; // already burning (or destroyed) from elsewhere
      if (!rollAccident(def.combustibility.chancePercent, rng)) continue;
      this.spawnFireOn(obj, now);
    }
  }

  /** A spread success: a brand-new fire instance "on" the candidate object, identical in every
   *  way (burn timer, further spread, extinguishable) to a directly-rolled one (§7.3/item 6:
   *  "Fires from spread behave identically"). */
  private spawnFireOn(obj: THREE.Object3D, now: number) {
    const fireDef = this.getData().assets.assets.find((a) => a.id === 'fire' && a.category === 'transient');
    if (!fireDef) return;
    const baseKey = obj.uuid;
    const pos: [number, number] = [obj.position.x, obj.position.z];
    const rec = this.registry.spawn({ accidentId: 'fire', pos, rotDeg: 0, footprint: fireDef.footprint, placement: 'on', baseKey, bornAt: now });
    this.buildGroup(rec, fireDef);
    this.onFireSpawned?.(rec); // ROADMAP_NEXT B2-5: spread fires panic the sim identically to a direct roll
  }

  /** Fire burned out unextinguished: despawns the fire itself, destroys its base object (via the
   *  injected `destroyBase` callback, if the live object can still be found and a callback was
   *  supplied), marks the baseKey permanently destroyed (`registry.markDestroyed` — see
   *  `canSpawn`), and spawns an `ash` transient in its place at the same spot. */
  private destroyBaseAndAsh(fire: AccidentInstanceRecord, now: number) {
    const baseObj = fire.baseKey ? this.getWorld().children.find((c) => c.uuid === fire.baseKey) ?? null : null;
    this.despawn(fire.key);
    if (fire.baseKey) this.registry.markDestroyed(fire.baseKey);
    if (baseObj) this.destroyBase?.(baseObj);
    const ashDef = this.getData().assets.assets.find((a) => a.id === 'ash' && a.category === 'transient');
    if (!ashDef) { console.warn('fire destruction fired but no "ash" transient asset is defined'); return; }
    const rec = this.registry.spawn({
      accidentId: 'ash', pos: fire.pos, rotDeg: fire.rotDeg, footprint: ashDef.footprint,
      placement: 'on', baseKey: fire.baseKey, bornAt: now,
    });
    this.buildGroup(rec, ashDef);
  }

  private buildGroup(rec: AccidentInstanceRecord, def: AssetDef) {
    const group = makeAccidentStandIn(def);
    group.position.set(rec.pos[0], 0, rec.pos[1]);
    group.rotation.y = THREE.MathUtils.degToRad(rec.rotDeg);
    group.userData = { assetId: def.id, interactions: def.interactions, accidentKey: rec.key };
    attachMesh(group, def); // §7.5: sprite support (allowSprite defaults true) is "for free" here
    this.groups.set(rec.key, group);
    this.getWorld().add(group);
  }

  /** §7.3 cleanup: call from onActionStop whenever the completed action's target carries an
   *  `accidentKey` (i.e. it WAS an accident instance) — despawns it if `actionId` is in the
   *  accident asset's `clearedBy` list. No-op for any other target. */
  maybeCleanup(targetObj: THREE.Object3D, actionId: string): boolean {
    const key = targetObj.userData?.accidentKey as string | undefined;
    if (!key) return false;
    const rec = this.registry.all.find((i) => i.key === key);
    if (!rec) return false;
    const def = this.getData().assets.assets.find((a) => a.id === rec.accidentId);
    if (!shouldDespawnOnCleanup(actionId, def?.clearedBy)) return false;
    this.despawn(key);
    return true;
  }

  private despawn(key: string) {
    this.registry.despawn(key);
    const group = this.groups.get(key);
    if (group) {
      group.parent?.remove(group);
      disposeAccidentGroup(group);
      this.groups.delete(key);
    }
  }

  /** Hot-reload: main.ts's `buildWorld(data)` rebuilds `world` from scratch every reload with
   *  no notion of runtime accident instances (they're never in map data) — call this right
   *  after `scene.add(world)` in the hot-reload handler to re-parent every LIVE instance group
   *  into the fresh world group, so editing tuning/assets/the map never wipes an active
   *  fire/puddle (§7.3: "Hot-reload of data must not wipe live accident instances"). */
  reattach(world: THREE.Group) {
    for (const group of this.groups.values()) world.add(group);
  }

  serialize(): AccidentsSaveState { return this.registry.serialize(); }

  /** Rebuilds BOTH the pure registry state and the live THREE groups from a save (future save
   *  system, same shape as QuestRunner.restore's doc comment). */
  restore(s: AccidentsSaveState) {
    for (const group of this.groups.values()) { group.parent?.remove(group); disposeAccidentGroup(group); }
    this.groups.clear();
    this.registry.restore(s);
    const data = this.getData();
    for (const rec of this.registry.all) {
      const def = data.assets.assets.find((a) => a.id === rec.accidentId);
      if (def) this.buildGroup(rec, def);
    }
  }
}
