// behavior.ts — pure B8-1-E utility scoring for autonomous action candidates.
// No DOM/three.js dependency: the runtime supplies distance and the shared quest EvalContext.

import type { ActionDef, AssetDef, BehaviorData } from './data';
import { evaluate, type EvalContext } from './quests';

export interface BehaviorScoreContext {
  behavior: BehaviorData;
  eval: EvalContext;
  distance: number;
}

export interface BehaviorCandidate<T = unknown> {
  asset: AssetDef;
  action: ActionDef;
  distance: number;
  value?: T;
}

export interface ScoredBehaviorCandidate<T = unknown> {
  candidate: BehaviorCandidate<T>;
  score: number;
}

function finite(value: number | undefined, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Locked formula: weighted need deficits × this action's gain rates, minus distance, plus
 * matching condition-gated rule bonuses. personalityAffinity scales the rule/trait term. */
export function scoreCandidate(asset: AssetDef, action: ActionDef, ctx: BehaviorScoreContext): number {
  const needScale = finite(ctx.behavior.weights?.needDeficit);
  const distanceScale = finite(ctx.behavior.weights?.distance);
  const affinityScale = finite(ctx.behavior.weights?.personalityAffinity);
  let needUtility = 0;

  for (const [needId, rawGain] of Object.entries(action.needGains ?? {})) {
    const current = ctx.eval.needs[needId];
    if (!Number.isFinite(current)) continue;
    const deficit = Math.max(0, 100 - current);
    const needWeight = finite(ctx.behavior.needWeights?.[needId], 1);
    needUtility += deficit * needWeight * finite(rawGain);
  }

  let ruleBonus = 0;
  for (const rule of ctx.behavior.rules ?? []) {
    if (rule.enabled === false) continue;
    if (rule.action && rule.action !== action.id) continue;
    if (rule.assetId && rule.assetId !== asset.id) continue;
    if (rule.assetCategory && rule.assetCategory !== asset.category) continue;
    if (rule.conditions && !evaluate(rule.conditions, ctx.eval)) continue;
    ruleBonus += finite(rule.scoreBonus);
  }

  return needScale * needUtility
    - distanceScale * Math.max(0, finite(ctx.distance))
    + affinityScale * ruleBonus;
}

/** Stable first-wins ties preserve placed-object/action ordering. A score must be strictly above
 * decisionThreshold; equal-to-threshold intentionally produces no autonomous decision. */
export function pickBest<T>(
  candidates: readonly BehaviorCandidate<T>[],
  ctx: Omit<BehaviorScoreContext, 'distance'>,
): ScoredBehaviorCandidate<T> | null {
  let best: ScoredBehaviorCandidate<T> | null = null;
  for (const candidate of candidates) {
    const score = scoreCandidate(candidate.asset, candidate.action, { ...ctx, distance: candidate.distance });
    if (!best || score > best.score) best = { candidate, score };
  }
  const threshold = finite(ctx.behavior.decisionThreshold);
  return best && best.score > threshold ? best : null;
}
