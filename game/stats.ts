// stats.ts — the sim's needs & skills state.
// All definitions (colors, defaults, decay rates, maxes) come from stats.json;
// all gain values come from interactions.json; tick lengths from tuning.json.
// Nothing here is a constant — design pillar #2.

import type { StatsData, ActionDef, NeedDef, SkillDef, PersonalityDef } from './data';

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

  constructor(defs: StatsData) {
    this.defs = defs;
    for (const n of defs.needs) this.needs.set(n.id, n.default);
    for (const s of defs.skills) if (s.enabled !== false) this.skills.set(s.id, s.default);
    for (const p of defs.personality ?? []) this.personality.set(p.id, p.default);
  }

  /** Hot-reload: adopt new definitions, keep current values, add any new stats at their default. */
  retune(defs: StatsData) {
    this.defs = defs;
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

  /** One activity-gain tick while an action runs. */
  applyGains(action: ActionDef) {
    for (const [needId, gain] of Object.entries(action.needGains)) {
      const v = this.needs.get(needId);
      if (v !== undefined) this.needs.set(needId, clamp(v + gain, 0, 100));
    }
    for (const [skillId, gain] of Object.entries(action.skillGains)) {
      const v = this.skills.get(skillId);
      if (v === undefined) continue;
      const max = this.defs.skills.find((s) => s.id === skillId)?.max ?? 100;
      this.skills.set(skillId, clamp(v + gain, 0, max));
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
