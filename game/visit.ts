// visit.ts — SOCIAL S6 "go to their place" away flow (ROADMAP_SOCIAL.md §3 S6).
//
// PURE, HEADLESS logic only (same contract as social.ts/work.ts): no DOM, no three.js.
// Deliberately thin: this is a work-system CLONE, reusing the going-to-work hide/time machinery
// rather than re-deriving it —
//   - `WorkReturnPoint`/`WorkTime` (the exact types WorkTracker's ActiveWorkShift uses for its
//     return teleport + clock reads) are imported, not redeclared.
//   - `absoluteGameHour` is the SAME sim-time comparison work.ts's `decideWorkReturn` uses; the
//     tracker below is a minimal analogue of `WorkTracker`'s activeShift/tick pair, stripped of the
//     job-specific fields (pay, needsCost, departure window, skips) that don't apply to a visit.
//     A full merge into WorkTracker itself would entangle two unrelated domains for no benefit at
//     this thin mechanical-clone stage — see PROJECT_CONTEXT.md §7.20 for the shift machinery this
//     mirrors.
//   - Gating reuses `levelAllows` from social.ts verbatim (a synthetic `requiresLevelAtLeast`
//     InteractionDef) rather than re-implementing the level-order comparison.
//   - The actual needs/relationship outcome math is entirely S1's `visitOutcome` (social.ts); this
//     module only decides WHEN the away period ends, not what it's worth.
//
// Side-effect rule (repo-wide): nothing in here mutates player/relationship state. main.ts applies
// visitOutcome() only when `tick()` reports 'returned' (completion) — a cancelled/interrupted
// departure (the walk to the exterior door never finishes) never calls `begin()` at all, so nothing
// is ever undone; there is simply nothing to undo.

import { absoluteGameHour, type WorkReturnPoint, type WorkTime } from './work';
import { levelAllows, type InteractionDef, type RelationshipState, type SocialData } from './social';
import { isNpcAvailable, type NpcDef } from './npc';

// Same floating-point tolerance work.ts's decideWorkReturn uses for its absolute-hour comparison —
// a structural literal (guards against equal-but-not-exactly-equal doubles), not a gameplay tunable.
const EPSILON = 1e-9;

// ---------------------------------------------------------------------------------------------------
// Contacts-tab gating — the SAME predicate the accept call re-checks, so the tab's displayed
// disabled-reason can never disagree with what actually happens on click (contacts.ts precedent).
// ---------------------------------------------------------------------------------------------------

export type VisitBlockedReason = 'below_min_level' | 'outside_hours' | 'visitor_present' | 'player_away';

export interface VisitGateContext {
  hourNow: number;
  relationships: RelationshipState;
  data: SocialData;
  /** true while a guest is present/pending (mirrors NpcVisitorController.canInvite()'s inverse —
   *  the sim can't leave to visit someone while hosting/awaiting a guest). */
  visitorBusy: boolean;
  /** true while the sim is already away (at work OR already mid-visit) — the same "off-lot, cannot
   *  start another away state" exclusivity WorkTracker.isAtWork enforces for its own domain. */
  playerAway: boolean;
}

/** Null = allowed. Order mirrors severity: an away/busy sim is checked first (nothing else matters
 *  if the sim can't act at all), then the NPC-side hours window, then the relationship gate. */
export function visitGate(npc: NpcDef, ctx: VisitGateContext): VisitBlockedReason | null {
  if (ctx.playerAway) return 'player_away';
  if (ctx.visitorBusy) return 'visitor_present';
  if (!isNpcAvailable(ctx.hourNow, npc.availableHours)) return 'outside_hours';
  const levelId = ctx.relationships.levelFor(npc.id);
  // Reuses levelAllows's existing "requiresLevelAtLeast" convention (social.ts): an unknown minLevel
  // id is treated as no lower bound (never throw on a designer typo), exactly like every other
  // level-order gate in this codebase.
  const gate: InteractionDef = { id: '__visit_their_place_gate', requiresLevelAtLeast: ctx.data.visitTheirPlace.minLevel };
  if (!levelAllows(gate, levelId, ctx.data)) return 'below_min_level';
  return null;
}

export function canVisitTheirPlace(npc: NpcDef, ctx: VisitGateContext): boolean {
  return visitGate(npc, ctx) === null;
}

/** Human-readable reason for the Contacts-tab disabled tooltip (contacts.ts's existing pattern). */
export function visitGateReasonLabel(reason: VisitBlockedReason): string {
  switch (reason) {
    case 'below_min_level': return 'Relationship not strong enough yet';
    case 'outside_hours': return 'Outside available hours';
    case 'visitor_present': return 'Visitor already present';
    case 'player_away': return 'Not available right now';
  }
}

// ---------------------------------------------------------------------------------------------------
// VisitAwayTracker — the away-period clock. Directly analogous to WorkTracker's activeShift/tick,
// with the job-specific fields dropped (see module doc above).
// ---------------------------------------------------------------------------------------------------

export interface VisitAwaySaveState {
  npcId: string | null;
  endAbsHour: number | null;
  returnPoint: WorkReturnPoint | null;
}

const idleAway = (): VisitAwaySaveState => ({ npcId: null, endAbsHour: null, returnPoint: null });

function cloneReturnPoint(point: WorkReturnPoint): WorkReturnPoint {
  return { pos: [point.pos[0], point.pos[1]], facingDeg: point.facingDeg };
}

export interface VisitReturnEvent {
  type: 'returned';
  npcId: string;
  returnPoint: WorkReturnPoint;
}

/**
 * Pure, serializable, exactly-one-visit-at-a-time state machine (mirrors WorkTracker's own
 * exactly-one-active-shift invariant). `begin()` is only ever called by main.ts once hiding the sim
 * actually happens (the visit_their_place action's completion, same seam as leave_for_work's
 * work.beginShift call) — a departure cancelled mid-walk never reaches `begin()`, so "cancel applies
 * nothing" falls out of the call site rather than needing special-cased undo logic here.
 */
export class VisitAwayTracker {
  private state: VisitAwaySaveState = idleAway();

  get isAway(): boolean { return this.state.npcId !== null; }
  get activeNpcId(): string | null { return this.state.npcId; }

  /** Snapshots the return point/end time at the moment the sim disappears. Fails (no-op, returns
   *  false) if already away — exactly one visit at a time, same invariant WorkTracker enforces for
   *  shifts via `already_at_work`. */
  begin(npcId: string, time: WorkTime, awayHours: number, returnPoint: WorkReturnPoint): boolean {
    if (this.isAway || !npcId) return false;
    const hours = Number.isFinite(awayHours) && awayHours > 0 ? awayHours : 0;
    this.state = {
      npcId,
      endAbsHour: absoluteGameHour(time) + hours,
      returnPoint: cloneReturnPoint(returnPoint),
    };
    return true;
  }

  /** Pure return decision — the exact same absolute-hour comparison work.ts's decideWorkReturn uses.
   *  Clears state before returning so the event can never fire twice for the same visit. */
  tick(time: WorkTime): VisitReturnEvent | null {
    const { npcId, endAbsHour, returnPoint } = this.state;
    if (npcId === null || endAbsHour === null || returnPoint === null) return null;
    if (absoluteGameHour(time) + EPSILON < endAbsHour) return null;
    this.state = idleAway();
    return { type: 'returned', npcId, returnPoint: cloneReturnPoint(returnPoint) };
  }

  serialize(): VisitAwaySaveState {
    return {
      npcId: this.state.npcId,
      endAbsHour: this.state.endAbsHour,
      returnPoint: this.state.returnPoint ? cloneReturnPoint(this.state.returnPoint) : null,
    };
  }

  restore(saved: VisitAwaySaveState): void {
    if (!saved || !saved.npcId || !Number.isFinite(saved.endAbsHour) || !saved.returnPoint) {
      this.state = idleAway();
      return;
    }
    this.state = {
      npcId: saved.npcId,
      endAbsHour: saved.endAbsHour,
      returnPoint: cloneReturnPoint(saved.returnPoint),
    };
  }
}
