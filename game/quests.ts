// quests.ts — quest condition evaluator + runtime quest/variable state (PROJECT_CONTEXT.md §3).
// Pure logic: no DOM/three.js dependency, safe to unit test headless (test/quests.test.ts).
//
// Condition namespace (§3.2): needs.<id>, skills.<id>, funds, time.hour, time.day, vars.<name>,
// quests.<id>.state ('locked'|'active'|'done'). Operators: gte, lte, eq, neq (one per leaf).
// Combinators: all (every sub-condition), any (at least one), both nestable arbitrarily deep.
//
// Unknown-id semantics (deliberate design decision — never throw):
//   - A `var` path that doesn't resolve to anything (unknown need/skill/var id, or a quest id that
//     doesn't exist) resolves to `undefined`, and *every* operator against `undefined` evaluates to
//     false. A stale/renamed id in quests.json therefore just makes that leaf false, not a crash —
//     consistent with how stats.ts/autonomy.ts already no-op on unknown ids elsewhere in the codebase.
//   - A leaf with none of gte/lte/eq/neq set (malformed data) also evaluates to false, same reasoning.
//   - `all` of an empty array is vacuously true (standard); `any` of an empty array is false (nothing
//     to satisfy) — both are what Array.prototype.every/some already return, called out here as intent.

import type { Condition, QuestDef, QuestsData, QuestState, Reward, SimStateData, VarDef } from './data';

export type VarValue = string | number | boolean | null;

/** Read-only snapshot the evaluator runs against. Built fresh by the caller each tick. */
export interface EvalContext {
  needs: Record<string, number>;
  skills: Record<string, number>;
  /** Static designer-authored traits. Optional for pre-personality fixtures/saves. */
  personality?: Record<string, number>;
  funds: number;
  /** Current FinanceState score. Optional so older quest/test contexts remain valid. */
  creditScore?: number;
  time: { hour: number; day: number };
  /** H1 (ROADMAP_HAPPY): live 0-100 happiness — lets interaction conditions, behavior.json
   *  autonomy rules, and quest conditions gate on mood. Optional for older fixtures. */
  happiness?: number;
  vars: Record<string, VarValue>;
  quests: Record<string, QuestState>;
}

/** Exported for reuse by game/accidents.ts (§7.3: accident risk modifiers read `needs.<id>`/
 *  `skills.<id>` via this SAME path resolver — "reuse game/quests.ts's path resolution, don't
 *  reinvent"). Any accidents-specific EvalContext fields it doesn't have a real value for
 *  (funds/time/vars/quests) can be passed as safe defaults; only needs/skills paths matter there. */
export function resolveVar(path: string, ctx: EvalContext): number | VarValue | undefined {
  if (path === 'funds') return ctx.funds;
  if (path === 'creditScore') return ctx.creditScore;
  if (path === 'happiness') return ctx.happiness;
  if (path === 'time.hour') return ctx.time.hour;
  if (path === 'time.day') return ctx.time.day;
  if (path.startsWith('needs.')) return ctx.needs[path.slice('needs.'.length)];
  if (path.startsWith('skills.')) return ctx.skills[path.slice('skills.'.length)];
  if (path.startsWith('personality.')) return ctx.personality?.[path.slice('personality.'.length)];
  if (path.startsWith('vars.')) return ctx.vars[path.slice('vars.'.length)];
  const questMatch = /^quests\.(.+)\.state$/.exec(path);
  if (questMatch) return ctx.quests[questMatch[1]];
  return undefined; // unrecognized namespace — same "false, never throw" treatment
}

function evaluateLeaf(leaf: { var: string; gte?: number; lte?: number; eq?: VarValue; neq?: VarValue }, ctx: EvalContext): boolean {
  const value = resolveVar(leaf.var, ctx);
  if (value === undefined) return false; // unknown id → false, never throw
  if (leaf.gte !== undefined) return typeof value === 'number' && value >= leaf.gte;
  if (leaf.lte !== undefined) return typeof value === 'number' && value <= leaf.lte;
  // A boolean literal on eq/neq is a TRUTHINESS test, not a strict === against a `true`/`false`
  // value. This matters for designer variables whose declared type is `boolean` but whose runtime
  // value is a nullable payload rather than a raw boolean — most notably `vars.job`, which is
  // `null` when jobless and holds the employer id STRING when hired (the work system depends on
  // that id; see game/work.ts). The Quest/condition builder only offers true/false for a boolean
  // var, so a "has a job" condition is authored as `{ var: 'vars.job', eq: true }`; without this
  // coercion that could never match the string id and the quest would never complete. Genuine
  // boolean values are unaffected (Boolean(true|false) === the literal is identical to ===).
  if (leaf.eq !== undefined) return typeof leaf.eq === 'boolean' ? Boolean(value) === leaf.eq : value === leaf.eq;
  if (leaf.neq !== undefined) return typeof leaf.neq === 'boolean' ? Boolean(value) !== leaf.neq : value !== leaf.neq;
  return false; // no operator present — malformed leaf, treated the same as unknown
}

/** Recursively evaluate a condition tree against a state snapshot. Pure, never throws. */
export function evaluate(cond: Condition, ctx: EvalContext): boolean {
  if ('all' in cond) return cond.all.every((c) => evaluate(c, ctx));
  if ('any' in cond) return cond.any.some((c) => evaluate(c, ctx));
  return evaluateLeaf(cond, ctx);
}

/**
 * ROADMAP_NEXT B2-1: shared availability gate for `ActionDef.conditions` — a sparse field, so
 * "absent" reads as "always available" (same reasoning as `all([])` being vacuously true, just
 * one level up: no condition tree at all is the least restrictive case). Reused verbatim by
 * game/main.ts's tap-menu action filter (unmet → hidden from the menu) and game/autonomy.ts's
 * `maybeAct` candidate loop (unmet → skipped), so both call sites can never drift apart on what
 * "available" means. Pure/headless-testable (test/interaction-conditions.test.ts).
 */
export function isActionAvailable(conditions: Condition | undefined, ctx: EvalContext): boolean {
  return !conditions || evaluate(conditions, ctx);
}

/** Everything the runner tracks that a save system would need to persist (see the class doc below). */
export interface QuestSaveState {
  quests: Record<string, QuestState>;
  vars: Record<string, VarValue>;
  funds: number;
  unlockedAssets: string[];
  /** completed-quest ids, in completion order — used to rebuild the HUD's "recently completed" log */
  completedLog: string[];
}

/**
 * Runtime quest/variable state + the runner that steps it forward.
 *
 * Persistence: there is no save system in this repo yet (`data/save/` is empty, gitignored, and no
 * save.ts module exists) — the quest slice therefore keeps all runtime state in memory only. This
 * class's shape is deliberately flat and JSON-serializable (see `serialize()`/`restore()`) so wiring
 * it into a future save system is a `JSON.stringify(runner.serialize())` / `runner.restore(parsed)`
 * away, with no further refactor. Until that lands, quest progress and variable values reset on page
 * reload — same as every other piece of sim state (needs/skills aren't persisted either today).
 *
 * Hot-reload: `retune()` is called when quests.json/simstate.json change on disk. It must NOT wipe
 * runtime STATE — only adopt new/edited quest DEFINITIONS and variable DEFINITIONS. Concretely:
 * existing quest states (locked/active/done) and existing variable values are left untouched; only
 * brand-new quest ids get an initial 'locked' state and brand-new variable ids get their default
 * value. Removed quest/variable ids simply leave their old runtime entry orphaned (harmless — nothing
 * reads it once its definition is gone), mirroring stats.ts's retune() convention.
 */
export class QuestRunner {
  private questDefs: QuestDef[];
  private varDefs: VarDef[];

  quests: Record<string, QuestState> = {};
  vars: Record<string, VarValue> = {};
  funds: number;
  unlockedAssets = new Set<string>();
  /** completed-quest ids in completion order (repeat entries allowed for repeatable quests) */
  completedLog: string[] = [];

  /** fired when a quest transitions locked → active ("quest started" toast) */
  onQuestStarted: ((q: QuestDef) => void) | null = null;
  /** fired when a quest transitions active → done, AFTER rewards have been applied */
  onQuestCompleted: ((q: QuestDef) => void) | null = null;
  /** PROJECT_CONTEXT.md §7.20 B3-6: fired for a `grantVisa` reward. QuestRunner doesn't import
   *  game/visas.ts (avoids a circular import — visas.ts has no reason to know about quests.ts, and
   *  main.ts is the natural place to wire "quest reward → state machine call"); this callback is
   *  the seam. If left unset, a grantVisa reward silently no-ops (same "never throw" precedent as
   *  every other reward/condition path in this file). */
  onGrantVisa: ((statusId: string) => void) | null = null;

  constructor(quests: QuestsData, simState: SimStateData, startingFunds: number) {
    this.questDefs = quests.quests;
    this.varDefs = simState.variables;
    for (const v of this.varDefs) this.vars[v.id] = v.default;
    for (const q of this.questDefs) this.quests[q.id] = 'locked';
    this.funds = startingFunds;
  }

  /** Hot-reload: adopt new quest/variable DEFINITIONS, keep current runtime STATE (see class doc). */
  retune(quests: QuestsData, simState: SimStateData) {
    this.questDefs = quests.quests;
    this.varDefs = simState.variables;
    for (const v of this.varDefs) if (!(v.id in this.vars)) this.vars[v.id] = v.default;
    for (const q of this.questDefs) if (!(q.id in this.quests)) this.quests[q.id] = 'locked';
  }

  get questDefsList(): readonly QuestDef[] { return this.questDefs; }

  /** B4-2 economy seam for action costs. Returns false without mutation when unaffordable. */
  spend(amount: number): boolean {
    const cost = Number.isFinite(amount) ? Math.max(0, amount) : 0;
    if (this.funds < cost) return false;
    this.funds -= cost;
    return true;
  }

  /**
   * Call once per needs-decay tick (same reuse-an-existing-interval convention as autonomy.ts).
   * needs/skills are plain snapshots (e.g. `Object.fromEntries(stats.needs)`); time is the current
   * game clock. Triggers are evaluated before completions in the same pass, so a quest whose trigger
   * fires this tick can also complete this same tick if its completion condition happens to already
   * hold (ctx.quests is a live reference to `this.quests`, so the just-updated state is visible) —
   * documented rather than special-cased, since nothing in §3.2 requires a one-tick delay.
   */
  tick(needs: Record<string, number>, skills: Record<string, number>, time: { hour: number; day: number }) {
    const ctx: EvalContext = { needs, skills, funds: this.funds, time, vars: this.vars, quests: this.quests };

    for (const q of this.questDefs) {
      if (this.quests[q.id] === 'locked' && evaluate(q.trigger, ctx)) {
        this.quests[q.id] = 'active';
        this.onQuestStarted?.(q);
      }
    }
    for (const q of this.questDefs) {
      if (this.quests[q.id] === 'active' && evaluate(q.completion, ctx)) {
        this.applyRewards(q);
        // onceOnly quests stay 'done' forever; repeatable quests reset to 'locked' so their
        // trigger can fire again later (see class/file doc comment on this design choice).
        this.quests[q.id] = q.onceOnly ? 'done' : 'locked';
        this.completedLog.push(q.id);
        this.onQuestCompleted?.(q);
      }
    }
  }

  private applyRewards(q: QuestDef) {
    for (const r of q.rewards) this.applyReward(r);
  }

  private applyReward(r: Reward) {
    if (r.type === 'funds') this.funds += r.amount;
    else if (r.type === 'setVar') this.vars[r.var] = r.value;
    else if (r.type === 'unlockAsset') this.unlockedAssets.add(r.asset);
    else if (r.type === 'grantVisa') this.onGrantVisa?.(r.statusId);
  }

  /** True once any quest reward has unlocked this catalog asset id (see unlockAsset doc below). */
  isAssetUnlocked(assetId: string): boolean { return this.unlockedAssets.has(assetId); }

  serialize(): QuestSaveState {
    return {
      quests: { ...this.quests },
      vars: { ...this.vars },
      funds: this.funds,
      unlockedAssets: [...this.unlockedAssets],
      completedLog: [...this.completedLog],
    };
  }

  restore(s: QuestSaveState) {
    this.quests = { ...s.quests };
    this.vars = { ...s.vars };
    this.funds = s.funds;
    this.unlockedAssets = new Set(s.unlockedAssets);
    this.completedLog = [...s.completedLog];
  }
}

// --- unlockAsset reward (§3.2) -------------------------------------------------------------------
// "hides/shows catalog entries — ties into Buy/Sell mode" (not built yet). Implementation chosen
// here: `unlockedAssets` is a plain Set<string> of asset ids a quest reward has explicitly unlocked
// (empty by default). It's additive-only state, not a schema change to assets.json — no AssetDef
// currently opts into being quest-gated. When Buy/Sell mode (roadmap §4 item 6) lands, its catalog
// filter is expected to be: an asset is purchasable if it has no quest-gate flag OR
// `runner.isAssetUnlocked(asset.id)` is true. That quest-gate flag itself (e.g. a future
// `AssetDef.requiresQuestUnlock: boolean`) is for that slice to add; nothing here presumes it.
