// autonomy.ts — free will (roadmap §2: "Autonomy").
// With behavior.json, an idle sim utility-scores every eligible placed-object action. Without it,
// the legacy lowest-need threshold + nearest primary-need match remains the fallback.
// Player commands suppress autonomy for tuning.autonomy.postPlayerCommandCooldownSeconds.
// Evaluation happens on the needs-decay tick, so no extra interval constant exists.

import type * as THREE from 'three';
import type { GameData, ActionDef, AssetDef, NeedDef } from './data';
import type { SimAgent } from './sim';
import { findSeatFor } from './sim';
import { firstLegSeatAware } from './food';
import type { AccidentsController } from './accidents';
import { isActionAvailable, type EvalContext } from './quests';
import { pickBest, type BehaviorCandidate } from './behavior';

/** The small state surface autonomy actually reads. SimStats implements it, and visitors can
 * provide a single-meter adapter without constructing the player's full needs/skills stack. */
export interface AutonomyStats {
  needs: Map<string, number>;
  skills: Map<string, number>;
  personality: Map<string, number>;
  lowestAutonomyNeed(): { def: NeedDef; value: number } | null;
}

export interface AutonomyOptions {
  /** Optional data-driven allow-list. Absent preserves player autonomy exactly. */
  allowedActionIds?: () => readonly string[];
  /** Extra candidates (S4 visiting Sims) join the ordinary utility list and may provide their
   * own order hook for engagement setup. Absent preserves asset-only autonomy exactly. */
  extraCandidates?: () => readonly AutonomyExtraCandidate[];
  /** Optional live runtime veto for code-side state that is not expressible in quest conditions
   *  (B13-10: a bed sleep/nap candidate while room ambience blocks sleeping). */
  candidateAvailable?: (action: ActionDef, object: THREE.Object3D, asset: AssetDef) => boolean;
}

export interface AutonomyExtraCandidate {
  object: THREE.Object3D;
  action: ActionDef;
  scoringAsset: AssetDef;
  order?: () => boolean;
}

export class Autonomy {
  private cooldownRemaining = 0;
  /** B7-6: a SEPARATE cooldown raised ONLY by an explicit player command (not by event-driven
   *  forceCooldown). Work auto-departure gates on this so "player orders still override" holds,
   *  while energy-collapse/bladder/panic suppression (which use forceCooldown) does NOT block a
   *  qualifying auto-departure. */
  private playerCooldownRemaining = 0;

  /** B7-6: true while a recent player command should still suppress autonomous work departure. */
  get playerCommandActive(): boolean { return this.playerCooldownRemaining > 0; }

  constructor(
    private getData: () => GameData,
    private getWorld: () => THREE.Group,
    private agent: SimAgent,
    private stats: AutonomyStats,
    /** Optional (§7.3): when supplied, autonomy skips any base asset currently blocked by an
     *  overlapping accident instance entirely — "impossible to cook while the kitchen is on
     *  fire" extends to the sim's own free will, not just player taps. Omitting it (e.g. older
     *  call sites / tests that predate the accidents slice) preserves the exact old behavior. */
    private accidents?: AccidentsController,
    /** Optional (ROADMAP_NEXT B2-1): builds a fresh EvalContext for gating candidates on
     *  `ActionDef.conditions` — same evaluator/namespace as quests (game/quests.ts's `evaluate`).
     *  Omitting it (older call sites) preserves old behavior: an action with `conditions` set is
     *  then treated as unmet (skipped) rather than silently always-available, since there's no
     *  context to check it against. Actions with no `conditions` are unaffected either way. */
    private getEvalContext?: () => EvalContext,
    private options: AutonomyOptions = {},
  ) {}

  /** Call whenever the player issues a command (go-to, action, stop). */
  notePlayerCommand() {
    this.cooldownRemaining = this.getData().tuning.autonomy.postPlayerCommandCooldownSeconds;
    this.playerCooldownRemaining = this.cooldownRemaining;
  }

  /** ROADMAP_NEXT B2-4: suppress autonomy for an EXPLICIT number of seconds — distinct from
   *  notePlayerCommand's fixed tuning-driven cooldown. Used by the bladder-failure event so free
   *  will can't preempt the sim mid-"pee" animation (e.g. immediately walking it to the toilet
   *  the instant `isBusy` goes false); the suppression window matches the event's own animation
   *  duration, not an unrelated player-command constant. Only extends, never shortens, an
   *  in-progress cooldown. */
  forceCooldown(seconds: number) {
    this.cooldownRemaining = Math.max(this.cooldownRemaining, seconds);
  }

  /** Call every frame to run the cooldown down. */
  update(dt: number) {
    if (this.cooldownRemaining > 0) this.cooldownRemaining = Math.max(0, this.cooldownRemaining - dt);
    if (this.playerCooldownRemaining > 0) this.playerCooldownRemaining = Math.max(0, this.playerCooldownRemaining - dt);
  }

  /** Call on each needs-decay tick. Returns the started action, or null if it did nothing. */
  maybeAct(): { action: ActionDef; target: THREE.Object3D } | null {
    if (this.cooldownRemaining > 0) return null;
    if (this.agent.isBusy) return null;

    const data = this.getData();
    // B8-1-E: behavior.json opts into utility scoring. Its deliberate absence keeps the exact
    // original lowest-need gate/filter below for old installs and fixtures.
    const behavior = data.behavior;
    const lowest = behavior ? null : this.stats.lowestAutonomyNeed();
    if (!behavior && (!lowest || lowest.value >= data.tuning.autonomy.seekBelowThreshold)) return null;

    const actionsById = new Map(data.interactions.actions.map((a) => [a.id, a]));
    const allowed = this.options.allowedActionIds?.();
    const allowedSet = allowed ? new Set(allowed) : null;
    const assetsById = new Map(data.assets.assets.map((a) => [a.id, a]));
    const simPos = this.agent.object.position;
    const evalCtx = this.getEvalContext?.();

    // Collect every eligible triple for utility mode; legacy mode retains its primary-need filter.
    const candidates: { obj: THREE.Object3D; action: ActionDef; def: AssetDef; dist: number; order?: () => boolean }[] = [];
    for (const obj of this.getWorld().children) {
      const assetId = obj.userData?.assetId as string | undefined;
      if (!assetId) continue;
      const def = assetsById.get(assetId);
      if (!def) continue;
      if (this.accidents?.isBlocked(obj, def)) continue; // §7.3: skip a base asset blocked by an accident
      for (const actionId of def.interactions) {
        if (allowedSet && !allowedSet.has(actionId)) continue;
        const action = actionsById.get(actionId);
        if (!action || !action.autonomyEligible) continue;
        if (this.options.candidateAvailable && !this.options.candidateAvailable(action, obj, def)) continue;
        if (!behavior && action.primaryNeed !== lowest!.def.id) continue;
        // ROADMAP_NEXT B2-1: unmet conditions make this action ineligible for autonomy, same as
        // it being hidden from the tap menu — evaluated from one fresh snapshot per autonomy scan
        // (this loop already runs once per needs-decay tick, not per frame).
        if (action.conditions && (!evalCtx || !isActionAvailable(action.conditions, evalCtx))) continue;
        if ((action.cost ?? 0) > (evalCtx?.funds ?? 0)) continue;
        const dx = obj.position.x - simPos.x, dz = obj.position.z - simPos.z;
        candidates.push({ obj, action, def, dist: Math.hypot(dx, dz) });
      }
    }

    // SOCIAL S4: visiting-Sim actions are already presence/level filtered by their pure provider,
    // then pass the same authored autonomy flag and the same behavior score/pick loop as assets.
    for (const extra of this.options.extraCandidates?.() ?? []) {
      if (!extra.action.autonomyEligible) continue;
      const dx = extra.object.position.x - simPos.x, dz = extra.object.position.z - simPos.z;
      candidates.push({
        obj: extra.object, action: extra.action, def: extra.scoringAsset,
        dist: Math.hypot(dx, dz), order: extra.order,
      });
    }

    if (behavior) {
      const scoringCtx: EvalContext = evalCtx ?? {
        needs: Object.fromEntries(this.stats.needs),
        skills: Object.fromEntries(this.stats.skills),
        personality: Object.fromEntries(this.stats.personality),
        funds: 0,
        time: { hour: 0, day: 1 },
        vars: {},
        quests: {},
      };
      const remaining: BehaviorCandidate<typeof candidates[number]>[] = candidates.map((candidate) => ({
        asset: candidate.def,
        action: candidate.action,
        distance: candidate.dist,
        value: candidate,
      }));

      // orderAction path-checks. If the best candidate is unreachable, remove it and score the
      // remainder so utility mode preserves the legacy "nearest reachable" resilience.
      while (remaining.length) {
        const best = pickBest(remaining, { behavior, eval: scoringCtx });
        if (!best) return null;
        const c = best.candidate.value!;
        const legSeatAware = firstLegSeatAware(c.action);
        const seat = legSeatAware ? findSeatFor(this.getWorld(), data, c.obj) : null;
        if ((c.order ? c.order() : this.agent.orderAction(c.action, c.obj, seat, c.def, legSeatAware))) {
          return { action: c.action, target: c.obj };
        }
        remaining.splice(remaining.indexOf(best.candidate), 1);
      }
      return null;
    }

    candidates.sort((a, b) => a.dist - b.dist);

    // nearest reachable wins — orderAction() path-checks, so unreachable ones are skipped
    for (const c of candidates) {
      // ROADMAP_NEXT B7-4: food-source actions (fridge Eat / stove Cook) defer their seat to the
      // carry/eat second leg — the first leg must reach the source (see game/food.ts firstLegSeatAware).
      const legSeatAware = firstLegSeatAware(c.action);
      const seat = legSeatAware ? findSeatFor(this.getWorld(), data, c.obj) : null;
      if ((c.order ? c.order() : this.agent.orderAction(c.action, c.obj, seat, c.def, legSeatAware))) {
        return { action: c.action, target: c.obj };
      }
    }
    return null;
  }
}
