// happiness.ts — pure B6-5 designer-authored happiness formula.
// Runtime supplies the same EvalContext used by quests; this module only resolves, normalizes,
// weights, and clamps. It has no DOM or three.js dependency.

import type { HappinessComponent, HappinessData } from './data';
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
