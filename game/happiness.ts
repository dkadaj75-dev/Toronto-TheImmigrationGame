// happiness.ts — pure B6-5 designer-authored happiness formula.
// Runtime supplies the same EvalContext used by quests; this module only resolves, normalizes,
// weights, and clamps. It has no DOM or three.js dependency.

import type { HappinessComponent, HappinessData, HappinessStateDef, HappinessStateDisplay } from './data';
import { resolveVar, type EvalContext, type VarValue } from './quests';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Convert quest values to a number. Non-empty strings/true are useful as 0/1 authored bonuses;
 * vars.visaStatus is the one categorical exception and uses happiness.json's explicit rank table. */
export function numericHappinessValue(
  component: HappinessComponent,
  value: VarValue | undefined,
  visaStatusRanks: Readonly<Record<string, number>> = {},
): number | undefined {
  if (component.var === 'vars.visaStatus' && typeof value === 'string') return visaStatusRanks[value];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string') return value.length ? 1 : 0;
  if (value === null) return 0;
  return undefined;
}

export function normalizeHappinessComponent(
  component: HappinessComponent,
  value: VarValue | undefined,
  visaStatusRanks: Readonly<Record<string, number>> = {},
): number | undefined {
  const numeric = numericHappinessValue(component, value, visaStatusRanks);
  if (numeric === undefined) return undefined;
  const min = Number.isFinite(component.min) ? component.min! : 0;
  const max = Number.isFinite(component.max) ? component.max! : 100;
  if (max === min) return numeric >= max ? 1 : 0;
  return clamp((numeric - min) / (max - min), 0, 1);
}

/** Invalid/unknown components and non-positive weights are ignored. No usable weight yields 0. */
/** H2 (ROADMAP_HAPPY): per-action skill-learning efficiency. Lerps skillEffAtMin→skillEffAtMax
 *  over happiness 0→100; sparse/absent ends default to 1 so an untouched action is a strict no-op.
 *  Result is clamped to ≥ 0 (a designer typo can slow learning to zero, never reverse it). */
export function happinessSkillFactor(mod: { skillEffAtMin?: number; skillEffAtMax?: number } | undefined, happiness: number): number {
  const lo = Number.isFinite(mod?.skillEffAtMin) ? mod!.skillEffAtMin! : 1;
  const hi = Number.isFinite(mod?.skillEffAtMax) ? mod!.skillEffAtMax! : 1;
  const t = clamp(Number.isFinite(happiness) ? happiness : 0, 0, 100) / 100;
  return Math.max(0, lo + (hi - lo) * t);
}

/** H2: whether the sim refuses this action at the given happiness. Strictly-below semantics;
 *  absent refuseBelow never refuses. */
export function isRefusedByMood(mod: { refuseBelow?: number } | undefined, happiness: number): boolean {
  const cutoff = mod?.refuseBelow;
  if (typeof cutoff !== 'number' || !Number.isFinite(cutoff)) return false;
  return (Number.isFinite(happiness) ? happiness : 0) < cutoff;
}

export function computeHappiness(data: HappinessData, ctx: EvalContext): number {
  let weighted = 0;
  let totalWeight = 0;
  for (const component of data.components ?? []) {
    const weight = Number.isFinite(component.weight) ? component.weight : 0;
    if (weight <= 0) continue;
    const normalized = normalizeHappinessComponent(
      component,
      resolveVar(component.var, ctx),
      data.visaStatusRanks,
    );
    if (normalized === undefined) continue;
    weighted += normalized * weight;
    totalWeight += weight;
  }
  return totalWeight > 0 ? clamp(weighted / totalWeight * 100, 0, 100) : 0;
}

/**
 * Resolve a numeric happiness value to its designer-authored state. This deliberately mirrors
 * social.ts `levelFor`: inclusive bounds, greatest matching `atLeast` wins, and array order has no
 * ranking meaning. Unlike relationship levels, missing/empty state data has no fallback because G4
 * specifies sparse data should render nothing on the player HUD.
 */
export function happinessStateFor(
  value: number,
  states: readonly HappinessStateDef[] | null | undefined,
): HappinessStateDef | null {
  if (!states?.length) return null;
  let best: HappinessStateDef | null = null;
  for (const state of states) {
    if (!Number.isFinite(state.atLeast)) continue;
    if (value >= state.atLeast && (best === null || state.atLeast > best.atLeast
      || (state.atLeast === best.atLeast && state.id.localeCompare(best.id) < 0))) best = state;
  }
  return best;
}

/** Invalid/absent display data degrades to the authored default: icon and text. */
export function happinessStateDisplay(
  display: HappinessStateDisplay | string | null | undefined,
): { icon: boolean; text: boolean } {
  if (display === 'icon') return { icon: true, text: false };
  if (display === 'text') return { icon: false, text: true };
  return { icon: true, text: true };
}
