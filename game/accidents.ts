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
import { loadMeshTemplate, applyMeshFit, normalizeModelToFootprint } from './world';

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

/**
 * Full placement decision for one risk entry (§7.3): "on" spawns at the base asset's own
 * position (same cells as the base asset — the point of a kitchen fire being ON the stove);
 * "adjacent" picks a random free in-bounds non-wall cell in `adjacentRange` squares, falling
 * back to "on" if none qualify.
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
    // no free adjacent cell — fall back to "on" (§7.3)
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
}

export interface AccidentsSaveState { instances: AccidentInstanceRecord[]; seq: number; }

/**
 * Pure runtime state — no THREE dependency, so spawn/despawn/hierarchy/serialize are all
 * headless-testable (test/accidents.test.ts). Mirrors QuestRunner's serialize()/restore()
 * convention (PROJECT_CONTEXT.md §3.3) so a future save system is a direct
 * `JSON.stringify(registry.serialize())` / `registry.restore(parsed)` call.
 */
export class AccidentRegistry {
  private instances: AccidentInstanceRecord[] = [];
  private seq = 0;

  get all(): readonly AccidentInstanceRecord[] { return this.instances; }

  /** §7.3: "don't stack two instances of the same accident type on the same base asset." A
   *  null baseKey (unknown trigger) never blocks anything — only exact (accidentId, baseKey)
   *  pairs collide. Different accident types CAN coexist on the same base asset (not forbidden
   *  by the spec — e.g. nothing stops a stove from independently risking both fire and, if a
   *  designer configured it, a puddle). */
  canSpawn(accidentId: string, baseKey: string | null): boolean {
    if (baseKey === null) return true;
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
    return this.instances.splice(idx, 1)[0];
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
    return { instances: this.instances.map((i) => ({ ...i })), seq: this.seq };
  }

  restore(s: AccidentsSaveState) {
    this.instances = s.instances.map((i) => ({ ...i }));
    this.seq = s.seq;
  }
}

/** §7.3 cleanup: does completing `actionId` on an accident instance despawn it? Pulled out as
 *  its own pure function (rather than inlined) so the decision is independently unit-tested. */
export function shouldDespawnOnCleanup(actionId: string, clearedBy: string[] | undefined): boolean {
  return !!clearedBy?.includes(actionId);
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

const ACCIDENT_STANDIN_COLORS: Record<string, number> = { fire: 0xff6a3d, water_puddle: 0x4fa8e0 };

/** Footprint-sized colored box, same "instant stand-in" philosophy as world.ts's makeStandIn —
 *  swapped for a GLB clone if/when `def.mesh` loads (attachAccidentMesh below). Puddles render
 *  thin/flat and non-shadow-casting; anything else (fire) gets a small upright block. */
function makeAccidentStandIn(def: AssetDef): THREE.Group {
  const g = new THREE.Group();
  g.name = `accident:${def.id}`;
  const [fw, fd] = def.footprint;
  const color = ACCIDENT_STANDIN_COLORS[def.id] ?? 0xd14f4f;
  const isFlat = def.id === 'water_puddle';
  const height = isFlat ? 0.03 : 0.5;
  const mat = new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.85 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(fw * 0.9, height, fd * 0.9), mat);
  body.position.y = height / 2;
  body.castShadow = !isFlat;
  g.add(body);
  return g;
}

function attachAccidentMesh(group: THREE.Group, def: AssetDef) {
  if (!def.mesh) return;
  const url = /^(\/|https?:)/.test(def.mesh) ? def.mesh : '/' + def.mesh;
  loadMeshTemplate(url)
    .then((template) => {
      const model = template.clone(true);
      normalizeModelToFootprint(model, def.footprint);
      applyMeshFit(model, def.meshFit);
      model.traverse((o) => {
        if (o instanceof THREE.Mesh) { o.castShadow = true; o.userData.sharedResource = true; }
      });
      group.clear();
      group.add(model);
    })
    .catch(() => console.warn(`Could not load mesh for accident "${def.id}" (${url}) — keeping stand-in.`));
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
  ) {}

  /** Live THREE.Object3D for a registry instance (used to redirect a blocked tap's walk/action
   *  target onto the accident itself instead of the base asset it's blocking). */
  groupFor(key: string): THREE.Object3D | null { return this.groups.get(key) ?? null; }

  /** §7.3 hierarchy: which accident (if any) currently blocks this base-asset Object3D. Accident
   *  instances never block each other (or themselves). */
  blockingFor(obj: THREE.Object3D, def: AssetDef): AccidentInstanceRecord | null {
    if (def.category === 'accident') return null;
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
  rollFor(targetObj: THREE.Object3D, def: AssetDef, ctx: EvalContext, rng: () => number = Math.random) {
    if (def.category === 'accident' || !def.accidents?.length) return;
    const baseKey = targetObj.uuid;
    const stats = this.getData().stats;
    for (const risk of def.accidents) {
      if (risk.trigger !== 'onUse') continue; // only trigger implemented today (§7.3)
      if (!this.registry.canSpawn(risk.accidentId, baseKey)) continue;
      const chance = computeAccidentChance(risk, ctx, stats);
      if (!rollAccident(chance, rng)) continue;
      this.spawn(risk, targetObj, baseKey, rng);
    }
  }

  private spawn(risk: AccidentRisk, baseObj: THREE.Object3D, baseKey: string, rng: () => number) {
    const data = this.getData();
    const accidentDef = data.assets.assets.find((a) => a.id === risk.accidentId && a.category === 'accident');
    if (!accidentDef) { console.warn(`accident risk references unknown accident asset "${risk.accidentId}"`); return; }
    const grid = this.getGrid();
    const basePos: [number, number] = [baseObj.position.x, baseObj.position.z];
    const isFree = (cell: Cell) => {
      const rect = footprintRect(cellCenter(grid, cell), 0, accidentDef.footprint);
      return !this.registry.all.some((i) => rectsOverlap(rect, footprintRect(i.pos, i.rotDeg, i.footprint)));
    };
    const plan = planAccidentPlacement(risk, basePos, grid, isFree, rng);
    const rec = this.registry.spawn({
      accidentId: accidentDef.id, pos: plan.pos, rotDeg: 0,
      footprint: accidentDef.footprint, placement: plan.placement, baseKey,
    });
    this.buildGroup(rec, accidentDef);
  }

  private buildGroup(rec: AccidentInstanceRecord, def: AssetDef) {
    const group = makeAccidentStandIn(def);
    group.position.set(rec.pos[0], 0, rec.pos[1]);
    group.rotation.y = THREE.MathUtils.degToRad(rec.rotDeg);
    group.userData = { assetId: def.id, interactions: def.interactions, accidentKey: rec.key };
    attachAccidentMesh(group, def);
    this.groups.set(rec.key, group);
    this.getWorld().add(group);
  }

  /** §7.3 cleanup: call from onActionStop whenever the completed action's target carries an
   *  `accidentKey` (i.e. it WAS an accident instance) — despawns it if `actionId` is in the
   *  accident asset's `clearedBy` list. No-op for any other target. */
  maybeCleanup(targetObj: THREE.Object3D, actionId: string) {
    const key = targetObj.userData?.accidentKey as string | undefined;
    if (!key) return;
    const rec = this.registry.all.find((i) => i.key === key);
    if (!rec) return;
    const def = this.getData().assets.assets.find((a) => a.id === rec.accidentId);
    if (!shouldDespawnOnCleanup(actionId, def?.clearedBy)) return;
    this.despawn(key);
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
