// autonomy.ts — free will (roadmap §2: "Autonomy").
// When the sim is idle and its lowest autonomy-participating need drops below
// tuning.autonomy.seekBelowThreshold, it walks to the nearest reachable object
// offering an autonomy-eligible action whose primaryNeed matches, and uses it.
// Player commands suppress autonomy for tuning.autonomy.postPlayerCommandCooldownSeconds.
// Evaluation happens on the needs-decay tick, so no extra interval constant exists.

import type * as THREE from 'three';
import type { GameData, ActionDef, AssetDef } from './data';
import type { SimAgent } from './sim';
import { findSeatFor } from './sim';
import { firstLegSeatAware } from './food';
import type { SimStats } from './stats';
import type { AccidentsController } from './accidents';
import { isActionAvailable, type EvalContext } from './quests';

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
    private stats: SimStats,
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
    const lowest = this.stats.lowestAutonomyNeed();
    if (!lowest || lowest.value >= data.tuning.autonomy.seekBelowThreshold) return null;

    const actionsById = new Map(data.interactions.actions.map((a) => [a.id, a]));
    const assetsById = new Map(data.assets.assets.map((a) => [a.id, a]));
    const simPos = this.agent.object.position;

    // collect (object, action, def) triples that can serve the lowest need, nearest first
    const candidates: { obj: THREE.Object3D; action: ActionDef; def: AssetDef; dist: number }[] = [];
    for (const obj of this.getWorld().children) {
      const assetId = obj.userData?.assetId as string | undefined;
      if (!assetId) continue;
      const def = assetsById.get(assetId);
      if (!def) continue;
      if (this.accidents?.isBlocked(obj, def)) continue; // §7.3: skip a base asset blocked by an accident
      for (const actionId of def.interactions) {
        const action = actionsById.get(actionId);
        if (!action || !action.autonomyEligible) continue;
        if (action.primaryNeed !== lowest.def.id) continue;
        // ROADMAP_NEXT B2-1: unmet conditions make this action ineligible for autonomy, same as
        // it being hidden from the tap menu — evaluated fresh per candidate (cheap: no per-tick
        // caching needed, this loop already runs once per needs-decay tick, not per frame).
        const evalCtx = this.getEvalContext?.();
        if (action.conditions && (!evalCtx || !isActionAvailable(action.conditions, evalCtx))) continue;
        if ((action.cost ?? 0) > (evalCtx?.funds ?? 0)) continue;
        const dx = obj.position.x - simPos.x, dz = obj.position.z - simPos.z;
        candidates.push({ obj, action, def, dist: Math.hypot(dx, dz) });
      }
    }
    candidates.sort((a, b) => a.dist - b.dist);

    // nearest reachable wins — orderAction() path-checks, so unreachable ones are skipped
    for (const c of candidates) {
      // ROADMAP_NEXT B7-4: food-source actions (fridge Eat / stove Cook) defer their seat to the
      // carry/eat second leg — the first leg must reach the source (see game/food.ts firstLegSeatAware).
      const legSeatAware = firstLegSeatAware(c.action);
      const seat = legSeatAware ? findSeatFor(this.getWorld(), data, c.obj) : null;
      if (this.agent.orderAction(c.action, c.obj, seat, c.def, legSeatAware)) {
        return { action: c.action, target: c.obj };
      }
    }
    return null;
  }
}
