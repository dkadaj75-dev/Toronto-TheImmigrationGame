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

export interface CanCandidate { key: string; pos: [number, number]; capacity: number; }
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

// ==================================================================== three.js layer

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

  constructor(
    private getData: () => GameData,
    private getWorld: () => THREE.Group,
  ) {}

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
      out.push({ key: obj.uuid, pos: [obj.position.x, obj.position.z], capacity: def.garbage.capacity });
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
    return this.registry.deposit(nearest.key, capacity);
  }

  /** ROADMAP_NEXT item 4: the exterior door's `empty_garbage` interaction — resets every can. */
  emptyAll() { this.registry.emptyAll(); }

  serialize(): GarbageSaveState { return this.registry.serialize(); }
  restore(s: GarbageSaveState) { this.registry.restore(s); }
}
