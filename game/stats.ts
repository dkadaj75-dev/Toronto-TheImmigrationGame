// stats.ts — the sim's needs & skills state.
// All definitions (colors, defaults, decay rates, maxes) come from stats.json;
// all gain values come from interactions.json; tick lengths from tuning.json.
// Nothing here is a constant — design pillar #2.

import type { StatsData, ActionDef, AssetDef, NeedDef, SkillDef, PersonalityDef } from './data';

/** THE single source of truth for how an asset's per-need multiplier scales an action's raw
 *  per-tick need gain. Used by BOTH the sim tick (SimStats.applyGains, below) and the autonomy
 *  scorer (game/behavior.ts scoreCandidate) — there must never be two implementations, or a
 *  luxury sofa could rank differently from how it actually feels to sit on. `multipliers` is the
 *  needMultipliers map of the asset the gain is credited to (see main.ts for the seat-vs-target
 *  decision); an absent map or absent key defaults to a 1x (unchanged) multiplier, and negative
 *  values are allowed and intentional (an awful asset that drains a need while used). */
export function effectiveNeedGain(needId: string, rawGain: number, multipliers?: AssetDef['needMultipliers']): number {
  return rawGain * (multipliers?.[needId] ?? 1);
}

/** B10-11: Environment (Sims "Room" score) is a PURE aggregate of assets currently present —
 *  it never drifts over time. `placedAssetIds` must be the EFFECTIVE placed-object list (buy-mode
 *  purchases included, sold/destroyed instances excluded — see buymode.ts's
 *  `effectivePlacedObjectsList()`), NOT the raw designer-authored `map.placedObjects`, so a mopped
 *  puddle or a fire-destroyed asset stops contributing the instant it's gone rather than forever.
 *  `accidentAssetIds` is the live AccidentRegistry list (fire/puddle instances currently burning/
 *  wet) — those already self-correct on cleanup since the registry itself drops them. */
export function computeEnvironmentScore(
  placedAssetIds: string[],
  accidentAssetIds: string[],
  environmentScoreFor: (assetId: string) => number,
): number {
  const placedSum = placedAssetIds.reduce((sum, id) => sum + environmentScoreFor(id), 0);
  const accidentSum = accidentAssetIds.reduce((sum, id) => sum + environmentScoreFor(id), 0);
  return placedSum + accidentSum;
}

/** B5-1: positive practice gains taper as a skill approaches its max. Losses/decay are returned
 *  untouched; exponent 0 preserves the previous linear gain, except that a skill already at max
 *  can never gain further. */
export function scaleSkillGain(rawDelta: number, level: number, max: number, curveExp = 1.5): number {
  if (rawDelta <= 0) return rawDelta;
  if (max <= 0 || level >= max) return 0;
  const ratio = clamp(level / max, 0, 1);
  return rawDelta * Math.pow(1 - ratio, Math.max(0, curveExp));
}

/** ITEM 2 (skill progress bar, 2026-07-17): fraction of the way from the current skill point to the
 *  NEXT one, plus an `atMax` flag (bar hidden at max).
 *
 *  Design note — the growth curve: skill "points" are the INTEGER values of the raw skill (the exact
 *  same convention feedback.ts's skillLevelUps uses — it floors before/after to count level-ups), so
 *  the point thresholds are evenly (linearly) spaced along the value axis. `tuning.skills.growthCurveExp`
 *  (see scaleSkillGain above) tapers the per-practice GAIN RATE near max — it makes high levels take
 *  more practice-time to traverse — but it does NOT move where the point thresholds sit. So, per the
 *  brief's "honoring the growth curve IF levels are non-linear": on inspection the levels here are
 *  linear, and the correct next-point fraction is simply the value's fractional part. A value sitting
 *  exactly on a point returns fraction 0 (bar empty); at/above max, atMax=true (caller hides it). */
export interface SkillPointProgress { fraction: number; atMax: boolean; }
export function skillPointProgress(value: number, max: number): SkillPointProgress {
  if (!(max > 0) || value >= max) return { fraction: 1, atMax: true };
  const v = Math.max(0, value);
  return { fraction: v - Math.floor(v), atMax: false };
}

/** ITEM 2: the PRIMARY skill of an action = its largest positive skillGain, or null if the action
 *  grants no (positive) skill. Deterministic tie-break: the first-encountered entry wins. */
export function primarySkillGain(skillGains: Record<string, number>): { id: string; gain: number } | null {
  let best: { id: string; gain: number } | null = null;
  for (const [id, gain] of Object.entries(skillGains)) {
    if (!(gain > 0)) continue;
    if (!best || gain > best.gain) best = { id, gain };
  }
  return best;
}

export class SimStats {
  needs = new Map<string, number>();
  skills = new Map<string, number>();
  /** ROADMAP_NEXT item 10: personality traits are STATIC — seeded from their `default` and never
   *  touched by decayTick/applyGains (no decay field, no gain source anywhere in interactions.json).
   *  No HUD bars exist for this family yet (traits don't change, so there's nothing to watch live —
   *  the designer can request a HUD later); consumers (e.g. game/garbage.ts's waste-handling
   *  decision) read this map directly by id. */
  personality = new Map<string, number>();
  private defs: StatsData;
  private growthCurveExp: number;

  constructor(defs: StatsData, growthCurveExp = 1.5) {
    this.defs = defs;
    this.growthCurveExp = growthCurveExp;
    for (const n of defs.needs) this.needs.set(n.id, n.default);
    for (const s of defs.skills) if (s.enabled !== false) this.skills.set(s.id, s.default);
    for (const p of defs.personality ?? []) this.personality.set(p.id, p.default);
  }

  /** Hot-reload: adopt new definitions, keep current values, add any new stats at their default. */
  retune(defs: StatsData, growthCurveExp = 1.5) {
    this.defs = defs;
    this.growthCurveExp = growthCurveExp;
    for (const n of defs.needs) if (!this.needs.has(n.id)) this.needs.set(n.id, n.default);
    for (const s of defs.skills) if (s.enabled !== false && !this.skills.has(s.id)) this.skills.set(s.id, s.default);
    for (const p of defs.personality ?? []) if (!this.personality.has(p.id)) this.personality.set(p.id, p.default);
  }

  get needDefs(): NeedDef[] { return this.defs.needs; }
  get skillDefs(): SkillDef[] { return this.defs.skills.filter((s) => s.enabled !== false); }
  get personalityDefs(): PersonalityDef[] { return this.defs.personality ?? []; }

  /** One needs-decay tick. Computed needs (Environment) don't decay — they're set externally. */
  decayTick() {
    for (const def of this.defs.needs) {
      if (def.computed) continue;
      const v = this.needs.get(def.id) ?? def.default;
      this.needs.set(def.id, clamp(v - def.decayPerTick, 0, 100));
    }
  }

  /** One activity-gain tick while an action runs. `needMultipliers` (optional) scales the effective
   *  per-need gain by the asset the gain is credited to (main.ts passes the perched seat's map for
   *  seat-aware actions, the target asset's otherwise — see its call site). Absent = every need
   *  multiplies by 1x (old behavior). */
  applyGains(action: ActionDef, needMultipliers?: AssetDef['needMultipliers']) {
    for (const [needId, gain] of Object.entries(action.needGains)) {
      const v = this.needs.get(needId);
      if (v !== undefined) this.needs.set(needId, clamp(v + effectiveNeedGain(needId, gain, needMultipliers), 0, 100));
    }
    for (const [skillId, gain] of Object.entries(action.skillGains)) {
      const v = this.skills.get(skillId);
      if (v === undefined) continue;
      const max = this.defs.skills.find((s) => s.id === skillId)?.max ?? 100;
      const effectiveGain = scaleSkillGain(gain, v, max, this.growthCurveExp);
      this.skills.set(skillId, clamp(v + effectiveGain, 0, max));
    }
  }

  /** ROADMAP_NEXT B2-4: an absolute refill (not a per-tick delta like applyGains) — e.g. the
   *  bladder-failure event's fixed `reliefAmount`. No-op if `id` isn't a known need (mirrors
   *  applyGains' own "undefined → skip" guard). */
  refillNeed(id: string, value: number) {
    if (this.needs.has(id)) this.needs.set(id, clamp(value, 0, 100));
  }

  /** Environment = Σ environment scores of everything placed in the home (Sims "Room" score). */
  setComputed(id: string, value: number) {
    if (this.defs.needs.find((n) => n.id === id)?.computed !== undefined || this.needs.has(id)) {
      this.needs.set(id, clamp(value, 0, 100));
    }
  }

  lowestAutonomyNeed(): { def: NeedDef; value: number } | null {
    let best: { def: NeedDef; value: number } | null = null;
    for (const def of this.defs.needs) {
      if (!def.autonomy) continue;
      const value = this.needs.get(def.id) ?? def.default;
      if (!best || value < best.value) best = { def, value };
    }
    return best;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
