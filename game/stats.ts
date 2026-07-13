// stats.ts — the sim's needs & skills state.
// All definitions (colors, defaults, decay rates, maxes) come from stats.json;
// all gain values come from interactions.json; tick lengths from tuning.json.
// Nothing here is a constant — design pillar #2.

import type { StatsData, ActionDef, NeedDef, SkillDef } from './data';

export class SimStats {
  needs = new Map<string, number>();
  skills = new Map<string, number>();
  private defs: StatsData;

  constructor(defs: StatsData) {
    this.defs = defs;
    for (const n of defs.needs) this.needs.set(n.id, n.default);
    for (const s of defs.skills) if (s.enabled !== false) this.skills.set(s.id, s.default);
  }

  /** Hot-reload: adopt new definitions, keep current values, add any new stats at their default. */
  retune(defs: StatsData) {
    this.defs = defs;
    for (const n of defs.needs) if (!this.needs.has(n.id)) this.needs.set(n.id, n.default);
    for (const s of defs.skills) if (s.enabled !== false && !this.skills.has(s.id)) this.skills.set(s.id, s.default);
  }

  get needDefs(): NeedDef[] { return this.defs.needs; }
  get skillDefs(): SkillDef[] { return this.defs.skills.filter((s) => s.enabled !== false); }

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
