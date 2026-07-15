// duration.ts — ROADMAP_NEXT item 5: per-action completion timer driven by a skill.
// Pure logic, no DOM/three.js dependency — headless-tested in test/duration.test.ts.
//
// Schema (ActionDef.duration, sparse, see game/data.ts): { baseSeconds, skillVar?, atMaxSeconds?,
// modifiers? }. Absent `duration` = current behavior (the action runs until its primaryNeed is
// satisfied or the player/autonomy cancels it — main.ts's simTick gain loop, unchanged). When
// present, the action ALSO auto-completes after its computed duration even if its primaryNeed (if
// any) never fills — this is what finally gives `primaryNeed: null` actions like "cook" a natural
// stop.
//
// skillVar/modifiers[].var reuse the quest-condition namespace ("skills.<id>"/"needs.<id>", see
// game/quests.ts's resolveVar) even though this module doesn't import quests.ts — kept
// deliberately standalone/pure (same "reuse the namespace convention, not the module" precedent as
// game/accidents.ts's risk modifiers, which DO import resolveVar because they already depend on
// EvalContext; duration.ts only ever needs flat skills/needs-value maps + a skill's own `max` from
// stats.json, so a full EvalContext would be overkill here). Needs have no `max` field in
// stats.json — game/stats.ts's SimStats always clamps them to 0..100, so a needs.<id> var's ratio
// is simply value/100.
//
// ROADMAP_NEXT B2-5 (`modifiers`): each entry lerps a MULTIPLIER (not seconds) from `atMin` (the
// named var at 0) to `atMax` (the var at its own max), then multiplies it onto the base/lerped
// seconds computed above — e.g. `extinguish`'s intelligence modifier makes a smarter sim faster
// (atMin 1 → atMax 0.5, so the multiplier only ever shrinks the duration), while its energy
// modifier makes a tired sim slower (atMin 1.6 → atMax 1, at LOW energy the ratio is near 0 so the
// multiplier is near atMin — the sim is slow when tired, back to normal at full energy). Modifiers
// stack by multiplication, applied in array order; an unresolvable var (unknown id, missing value)
// contributes a no-op ×1, same "unknown id → safe no-op" convention as skillVar above.

import type { ActionDef, SkillDef } from './data';

export type DurationConfig = NonNullable<ActionDef['duration']>;
export type DurationModifier = NonNullable<DurationConfig['modifiers']>[number];

/** Ratio [0,1] of `varPath` ("skills.<id>", bare skill id, or "needs.<id>") against its own max —
 *  skills via `skillDefs`' own `max`, needs via the fixed 0..100 range every need is clamped to
 *  (game/stats.ts). Returns `null` when unresolvable (unknown id, missing value, skill max <= 0) —
 *  callers treat that as "no modifier effect", never a thrown error or NaN. */
function resolveVarRatio(
  varPath: string,
  skills: Record<string, number>,
  skillDefs: readonly SkillDef[],
  needs: Record<string, number>,
): number | null {
  if (varPath.startsWith('needs.')) {
    const value = needs[varPath.slice('needs.'.length)];
    if (value === undefined) return null;
    return Math.min(Math.max(value / 100, 0), 1);
  }
  const skillId = varPath.startsWith('skills.') ? varPath.slice('skills.'.length) : varPath;
  const def = skillDefs.find((s) => s.id === skillId);
  const value = skills[skillId];
  if (!def || def.max <= 0 || value === undefined) return null;
  return Math.min(Math.max(value / def.max, 0), 1);
}

/**
 * Resolves the actual duration (seconds) for one instance of an action, given the sim's current
 * skill/need values. Returns `null` when the action has no `duration` block at all (caller should
 * fall back to the existing primaryNeed/cancel-only behavior).
 *
 * Lerp only activates when BOTH `skillVar` and `atMaxSeconds` are present — a `skillVar` with no
 * `atMaxSeconds` (or vice versa) is treated as an incomplete lerp spec and falls back to the fixed
 * `baseSeconds`, same as omitting both (documented decision, not a schema requirement enforced
 * elsewhere — the Interaction Editor UI keeps the two fields paired so this case shouldn't arise
 * from normal editing, but hand-edited JSON should still degrade sanely rather than throw/NaN).
 *
 * An unresolvable skillVar (unknown id, or the referenced skill's `max` is 0) also falls back to
 * `baseSeconds` — consistent with the rest of the codebase's "unknown id → safe no-op" convention
 * (game/quests.ts's resolveVar, game/accidents.ts's risk modifiers). `modifiers` (see module doc
 * comment) then multiply on top, in order; `needs` defaults to `{}` for backward compat with every
 * pre-existing 3-arg call site — omitting it simply means any `needs.<id>` modifier no-ops.
 */
export function computeDurationSeconds(
  duration: DurationConfig | undefined,
  skills: Record<string, number>,
  skillDefs: readonly SkillDef[],
  needs: Record<string, number> = {},
): number | null {
  if (!duration) return null;
  const { baseSeconds, skillVar, atMaxSeconds, modifiers } = duration;

  let seconds = baseSeconds;
  if (skillVar && atMaxSeconds !== undefined) {
    const t = resolveVarRatio(skillVar, skills, skillDefs, needs);
    if (t !== null) seconds = baseSeconds + (atMaxSeconds - baseSeconds) * t;
  }

  if (modifiers) {
    for (const mod of modifiers) {
      const t = resolveVarRatio(mod.var, skills, skillDefs, needs);
      const multiplier = t === null ? 1 : mod.atMin + (mod.atMax - mod.atMin) * t;
      seconds *= multiplier;
    }
  }

  return seconds;
}

/** True once `elapsedSeconds` has reached the computed duration. `durationSeconds === null` (no
 *  duration configured) always returns false — the action never auto-completes by time. */
export function isDurationComplete(elapsedSeconds: number, durationSeconds: number | null): boolean {
  if (durationSeconds === null) return false;
  return elapsedSeconds >= durationSeconds;
}
