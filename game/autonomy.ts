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
import type { SimStats } from './stats';
import type { AccidentsController } from './accidents';
import { isActionAvailable, type EvalContext } from './quests';

export class Autonomy {
  private cooldownRemaining = 0;

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
  }

  /** Call every frame to run the cooldown down. */
  update(dt: number) {
    if (this.cooldownRemaining > 0) this.cooldownRemaining = Math.max(0, this.cooldownRemaining - dt);
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
        if (action.conditions && (!this.getEvalContext || !isActionAvailable(action.conditions, this.getEvalContext()))) continue;
        const dx = obj.position.x - simPos.x, dz = obj.position.z - simPos.z;
        candidates.push({ obj, action, def, dist: Math.hypot(dx, dz) });
      }
    }
    candidates.sort((a, b) => a.dist - b.dist);

    // nearest reachable wins — orderAction() path-checks, so unreachable ones are skipped
    for (const c of candidates) {
      const seat = c.action.seatAware ? findSeatFor(this.getWorld(), data, c.obj) : null;
      if (this.agent.orderAction(c.action, c.obj, seat, c.def, c.action.seatAware)) {
        return { action: c.action, target: c.obj };
      }
    }
    return null;
  }
}
