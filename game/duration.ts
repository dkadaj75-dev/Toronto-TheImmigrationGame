// duration.ts — ROADMAP_NEXT item 5: per-action completion timer driven by a skill.
// Pure logic, no DOM/three.js dependency — headless-tested in test/duration.test.ts.
//
// Schema (ActionDef.duration, sparse, see game/data.ts): { baseSeconds, skillVar?, atMaxSeconds? }.
// Absent `duration` = current behavior (the action runs until its primaryNeed is satisfied or the
// player/autonomy cancels it — main.ts's simTick gain loop, unchanged). When present, the action
// ALSO auto-completes after its computed duration even if its primaryNeed (if any) never fills —
// this is what finally gives `primaryNeed: null` actions like "cook" a natural stop.
//
// skillVar reuses the quest-condition namespace ("skills.<id>", see game/quests.ts's resolveVar)
// even though this module doesn't import quests.ts — kept deliberately standalone/pure (same
// "reuse the namespace convention, not the module" precedent as game/accidents.ts's risk modifiers,
// which DO import resolveVar because they already depend on EvalContext; duration.ts only ever
// needs a flat skills-value map + the skill's own `max` from stats.json, so a full EvalContext
// would be overkill here).

import type { ActionDef, SkillDef } from './data';

export type DurationConfig = NonNullable<ActionDef['duration']>;

/**
 * Resolves the actual duration (seconds) for one instance of an action, given the sim's current
 * skill values. Returns `null` when the action has no `duration` block at all (caller should fall
 * back to the existing primaryNeed/cancel-only behavior).
 *
 * Lerp only activates when BOTH `skillVar` and `atMaxSeconds` are present — a `skillVar` with no
 * `atMaxSeconds` (or vice versa) is treated as an incomplete lerp spec and falls back to the fixed
 * `baseSeconds`, same as omitting both (documented decision, not a schema requirement enforced
 * elsewhere — the Interaction Editor UI keeps the two fields paired so this case shouldn't arise
 * from normal editing, but hand-edited JSON should still degrade sanely rather than throw/NaN).
 *
 * An unresolvable skillVar (unknown id, or the referenced skill's `max` is 0) also falls back to
 * `baseSeconds` — consistent with the rest of the codebase's "unknown id → safe no-op" convention
 * (game/quests.ts's resolveVar, game/accidents.ts's risk modifiers).
 */
export function computeDurationSeconds(
  duration: DurationConfig | undefined,
  skills: Record<string, number>,
  skillDefs: readonly SkillDef[],
): number | null {
  if (!duration) return null;
  const { baseSeconds, skillVar, atMaxSeconds } = duration;
  if (!skillVar || atMaxSeconds === undefined) return baseSeconds;

  const skillId = skillVar.startsWith('skills.') ? skillVar.slice('skills.'.length) : skillVar;
  const def = skillDefs.find((s) => s.id === skillId);
  const value = skills[skillId];
  if (!def || def.max <= 0 || value === undefined) return baseSeconds;

  const t = Math.min(Math.max(value / def.max, 0), 1);
  return baseSeconds + (atMaxSeconds - baseSeconds) * t;
}

/** True once `elapsedSeconds` has reached the computed duration. `durationSeconds === null` (no
 *  duration configured) always returns false — the action never auto-completes by time. */
export function isDurationComplete(elapsedSeconds: number, durationSeconds: number | null): boolean {
  if (durationSeconds === null) return false;
  return elapsedSeconds >= durationSeconds;
}
