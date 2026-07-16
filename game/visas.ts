// visas.ts — visa/status state machine (PROJECT_CONTEXT.md §7.20, ROADMAP_NEXT B3-6, V1 slice).
// Pure logic: no DOM/three.js dependency, safe to unit test headless (test/visas.test.ts).
// Mirrors game/quests.ts's QuestRunner shape/conventions on purpose (serialize/restore,
// retune-preserves-state, unknown-id-is-a-safe-no-op) so the two systems feel like one family.
//
// Day-based ticking (NOT seconds): the whole system counts in-game DAYS (gameDay in main.ts,
// already tracked for quests' `time.day`), advanced once per day-boundary crossing, not every
// frame/tick. `expiresAtDay`/`graceUntilDay`/`pending.resolvesAtDay` are all absolute day numbers;
// `tick(day)` is a level-triggered check ("has day reached the threshold yet"), safe to call
// on every day change including a multi-day jump (fast-forward) — it re-checks from scratch each
// call rather than assuming exactly one day elapsed since the last call.
//
// Semantics (checked in this priority order):
//   1. Already in grace and the grace window has elapsed → GAME OVER (reason 'grace_expired').
//   2. The current status's own expiry has been reached →
//        - losable with a graceDays window → open grace (graceUntilDay = day + graceDays,
//          expiresAtDay cleared so it can't also double-fire next tick)
//        - otherwise → GAME OVER (reason 'expired')
//   3. A pending application has reached its resolve day → grantVisa the applied-for status.
// Expiry is deliberately checked before resolution: §7.20 requires the old status to remain valid
// while an application is pending. A losable status may enter grace and resolve an application on
// the same day; a non-losable expired status reaches game over before the pending grant can land.
// Permanent statuses (durationDays: null) have expiresAtDay = null forever, so step 3 never fires.

import type { Condition, VisaDef, VisasData } from './data';

export type GameOverReason = 'expired' | 'grace_expired';

/** Everything a save system would need to persist (mirrors QuestSaveState's role/shape). */
export interface VisaSaveState {
  statusId: string;
  expiresAtDay: number | null;
  graceUntilDay: number | null;
  pending: { statusId: string; resolvesAtDay: number } | null;
  gameOver: boolean;
  gameOverReason: GameOverReason | null;
}

export class VisaMachine {
  private defs: VisaDef[];

  statusId: string;
  expiresAtDay: number | null = null;
  graceUntilDay: number | null = null;
  pending: { statusId: string; resolvesAtDay: number } | null = null;
  gameOver = false;
  gameOverReason: GameOverReason | null = null;

  /** fired whenever the active status changes (initial construction does NOT fire this — callers
   *  that need the starting status read `.currentDef()`/`.statusId` directly right after construction) */
  onStatusChanged: ((def: VisaDef) => void) | null = null;
  /** fired exactly once, the tick a game-over condition is reached */
  onGameOver: ((reason: GameOverReason, def: VisaDef | undefined) => void) | null = null;

  constructor(data: VisasData, startStatusId: string, currentDay: number) {
    this.defs = data.visas;
    this.statusId = startStatusId;
    this.expiresAtDay = this.computeExpiry(startStatusId, currentDay);
  }

  /** Hot-reload: adopt new visa DEFINITIONS (durations/grace/requirements may have been retuned),
   *  keep current runtime STATE untouched (statusId/expiresAtDay/pending/gameOver all survive) —
   *  same convention as QuestRunner.retune/stats.ts's retune(). */
  retune(data: VisasData) { this.defs = data.visas; }

  def(id: string): VisaDef | undefined { return this.defs.find((d) => d.id === id); }
  currentDef(): VisaDef | undefined { return this.def(this.statusId); }

  private computeExpiry(id: string, fromDay: number): number | null {
    const d = this.def(id);
    if (!d || d.durationDays == null) return null; // unknown id or explicitly permanent
    return fromDay + d.durationDays;
  }

  /** Call once per day-boundary crossing (main.ts increments gameDay in its clock-wrap loop —
   *  call this right there, not on a per-frame/per-second basis). No-ops once gameOver is true. */
  tick(day: number) {
    if (this.gameOver) return;

    if (this.graceUntilDay !== null && day >= this.graceUntilDay) {
      this.triggerGameOver('grace_expired');
      return;
    }

    if (this.expiresAtDay !== null && day >= this.expiresAtDay) {
      const d = this.currentDef();
      if (d?.losable && d.graceDays) {
        this.graceUntilDay = day + d.graceDays;
        this.expiresAtDay = null; // grace clock now governs, not the normal expiry
      } else {
        this.triggerGameOver('expired');
        return;
      }
    }

    if (this.pending && day >= this.pending.resolvesAtDay) {
      const resolvedId = this.pending.statusId;
      this.pending = null;
      this.grantVisa(resolvedId, day);
    }
  }

  private triggerGameOver(reason: GameOverReason) {
    this.gameOver = true;
    this.gameOverReason = reason;
    this.onGameOver?.(reason, this.currentDef());
  }

  /**
   * Grant a new status NOW (quest reward `grantVisa`, or a resolved application). Resets expiry
   * from `day` using the new status's own durationDays, and clears any grace window (a fresh
   * status means the old one's jeopardy no longer applies — e.g. a new job replacing the one that
   * was about to lapse). Unknown status ids are a safe no-op (same "never throw" precedent as
   * game/quests.ts's evaluator). No-ops once gameOver is true (game over is terminal in V1 — no
   * save/continue system yet, per §7.20: "no save system yet").
   */
  grantVisa(statusId: string, day: number) {
    if (this.gameOver) return;
    const d = this.def(statusId);
    if (!d) return;
    this.statusId = statusId;
    this.expiresAtDay = this.computeExpiry(statusId, day);
    this.graceUntilDay = null;
    this.onStatusChanged?.(d);
  }

  /**
   * V2 hook (phone applications): begin a pending application for `statusId`, resolving after
   * that status's own `applicationDays`. The caller (future phone UI) is responsible for checking
   * `requirements` via the quest condition evaluator BEFORE calling this — apply() itself doesn't
   * evaluate conditions (it has no EvalContext; keeping this module free of a quests.ts import,
   * same reasoning as the onGrantVisa seam being main.ts's job, not quests.ts's). Returns false
   * (no-op) for an unknown id, a non-'application' status, or while already game over/already
   * pending (only one application in flight at a time in V1). Applying does NOT pause or extend
   * the CURRENT status's own expiry clock. tick() checks that expiry before resolving a pending
   * application, enforcing §7.20's "must keep a valid status while pending" rule.
   */
  apply(statusId: string, day: number): boolean {
    if (this.gameOver || this.pending) return false;
    const d = this.def(statusId);
    if (!d || d.obtainedVia !== 'application') return false;
    this.pending = { statusId, resolvesAtDay: day + (d.applicationDays ?? 0) };
    return true;
  }

  /** null = permanent status (never expires). Negative once past due (grace/game-over handles that). */
  daysLeft(day: number): number | null {
    if (this.expiresAtDay === null) return null;
    return this.expiresAtDay - day;
  }

  inGrace(): boolean { return this.graceUntilDay !== null; }

  /** Remaining grace days for the HUD; null when no grace window is active. */
  graceDaysLeft(day: number): number | null {
    if (this.graceUntilDay === null) return null;
    return this.graceUntilDay - day;
  }

  /** requirements-check helper for the future V2 phone UI — re-exported here (not from quests.ts)
   *  so callers don't need to know evaluate() lives in quests.ts too; just documents the shape. */
  requirementsFor(statusId: string): Condition | undefined { return this.def(statusId)?.requirements; }

  serialize(): VisaSaveState {
    return {
      statusId: this.statusId,
      expiresAtDay: this.expiresAtDay,
      graceUntilDay: this.graceUntilDay,
      pending: this.pending ? { ...this.pending } : null,
      gameOver: this.gameOver,
      gameOverReason: this.gameOverReason,
    };
  }

  restore(s: VisaSaveState) {
    this.statusId = s.statusId;
    this.expiresAtDay = s.expiresAtDay;
    this.graceUntilDay = s.graceUntilDay;
    this.pending = s.pending ? { ...s.pending } : null;
    this.gameOver = s.gameOver;
    this.gameOverReason = s.gameOverReason;
  }
}
