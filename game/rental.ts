// rental.ts — ROADMAP_APT R2: pure Kijiji listing/availability logic.
// No DOM/three.js/fetch dependency: given all maps (each may carry R1's MapData.rental block),
// an EvalContext, finance data + assets, produce the per-map listing view-model the future R3
// phone tab renders. Reuses the EXISTING quest condition evaluator (game/quests.ts) for gating —
// never a second evaluator — and the EXISTING rent formula boundary (game/bills.ts's
// computeFinancePreview) for price — never a duplicated formula. See test/rental.test.ts.

import type { AssetsData, FinanceData, MapData } from './data';
import { isActionAvailable, type EvalContext } from './quests';
import { computeFinancePreview } from './bills';
import { floorsAreaM2 } from './textures';

/** Themeable copy so the "Not available yet" string isn't hardcoded/scattered in the UI layer.
 *  R3 (or a future tuning knob) can override either label; this module supplies the default. */
export interface RentalLabels {
  available: string;
  notAvailable: string;
}

export const DEFAULT_RENTAL_LABELS: RentalLabels = {
  available: 'Available',
  notAvailable: 'Not available yet',
};

function resolveLabels(labels?: Partial<RentalLabels>): RentalLabels {
  return { ...DEFAULT_RENTAL_LABELS, ...(labels ?? {}) };
}

export interface RentalListing {
  mapId: string;
  title: string;
  text: string;
  image?: string;
  areaM2: number;
  available: boolean;
  /** Present ONLY when `available` is true (never shown for a gated listing). */
  rentPrice?: number;
  statusLabel: string;
  moveInHours: number;
  /** True when this map is the sim's current home (`homeMapId` input match). */
  isCurrentHome: boolean;
}

export interface RentalListingContext {
  /** Every candidate map. Maps with no `rental` block, or `rental.listed === false`, are excluded. */
  maps: MapData[];
  /** Quest-state/simstate/creditScore/visaStatus snapshot — same EvalContext shape the quest
   *  runner already builds each tick (visaStatus/job/income live under `vars`, per PROJECT_CONTEXT). */
  evalContext: EvalContext;
  finance: FinanceData;
  assets: AssetsData;
  /** The engine's current home map id (simstate.json's `homeMap`, R4) — flags `isCurrentHome`. */
  homeMapId?: string;
  /** Sparse label overrides; unset fields fall back to DEFAULT_RENTAL_LABELS. */
  labels?: Partial<RentalLabels>;
}

// ============================================================= ROADMAP_APT R4 (pending move-in)

/** A rent that has been accepted but not yet completed: the sim moves `moveInHours` sim-time
 *  hours after `startHour` (both on main.ts's monotonic in-game-hour clock, gameHourNow — the
 *  same clock food perishing uses, so pause/2x/3x affect the countdown identically and crossing
 *  midnight never jumps it). */
export interface PendingMoveState {
  mapId: string;
  /** Monotonic in-game hour the rent was accepted at. */
  startHour: number;
  /** Sim-time hours until the move completes (MapData.rental.moveInHours). */
  moveInHours: number;
}

export interface PendingMoveSaveState { pending: PendingMoveState | null; }

/**
 * R4 pending-move state machine. Pure/headless (test/pendingmove.test.ts) — main.ts owns the
 * actual map switch and only performs it via takeCompleted(), so the side_effect_rule holds by
 * construction: `cancel()` applies NOTHING (no funds, no vars, no map change), and completion is
 * the ONLY path that ever returns a mapId to switch to. serialize()/restore() follow the exact
 * QuestRunner/AccidentRegistry convention so the future save system is a direct JSON round-trip.
 */
export class PendingMoveTracker {
  private state: PendingMoveState | null = null;

  get pending(): Readonly<PendingMoveState> | null { return this.state; }

  /** Starts a pending move. Refuses (returns false, no state change) while another move is
   *  already pending — the one-pending-move-at-a-time rule the phone UI's rentEnabled encodes. */
  start(mapId: string, moveInHours: number, nowHours: number): boolean {
    if (this.state || !mapId) return false;
    this.state = {
      mapId,
      startHour: Number.isFinite(nowHours) ? nowHours : 0,
      moveInHours: Number.isFinite(moveInHours) ? Math.max(0, moveInHours) : 0,
    };
    return true;
  }

  /** Cancels the pending move. Applies NOTHING else (side_effect_rule: cancellation has zero
   *  side effects — only completion switches maps). Returns whether a move was pending. */
  cancel(): boolean {
    const had = this.state !== null;
    this.state = null;
    return had;
  }

  /** Sim-time hours left before the move completes; null when nothing is pending. */
  remainingHours(nowHours: number): number | null {
    if (!this.state) return null;
    return Math.max(0, this.state.startHour + this.state.moveInHours - nowHours);
  }

  /** True once the countdown has elapsed (the caller may still defer the actual switch — e.g.
   *  while the sim is away at work — since the state stays put until takeCompleted()). */
  isReady(nowHours: number): boolean {
    return this.state !== null && nowHours >= this.state.startHour + this.state.moveInHours;
  }

  /** The single completion gate: returns the destination mapId AND clears the pending state,
   *  but only once the countdown is ready — null otherwise (state untouched). main.ts performs
   *  the world switch right after a successful take, so a switch can never double-fire. */
  takeCompleted(nowHours: number): string | null {
    if (!this.isReady(nowHours)) return null;
    const mapId = this.state!.mapId;
    this.state = null;
    return mapId;
  }

  serialize(): PendingMoveSaveState { return { pending: this.state ? { ...this.state } : null }; }
  restore(s: PendingMoveSaveState) { this.state = s.pending ? { ...s.pending } : null; }
}

/** Kijiji-card countdown copy ("Moving in 3h..."). Ceils so the label never claims 0h while the
 *  move is still pending; anything under an hour reads as 1h (coarse on purpose — the phone tab
 *  refreshes hourly, not per frame). */
export function pendingMoveLabel(remainingHours: number): string {
  const hours = Math.max(1, Math.ceil(Number.isFinite(remainingHours) ? remainingHours : 0));
  return `Moving in ${hours}h...`;
}

/**
 * Builds the Kijiji view-model for every listed map. Pure/deterministic: same inputs -> same
 * output, safe to call every frame/tab-open from a thin UI layer (R3) with zero DOM access here.
 */
export function listRentals(ctx: RentalListingContext): RentalListing[] {
  const labels = resolveLabels(ctx.labels);
  const listings: RentalListing[] = [];
  for (const map of ctx.maps) {
    const rental = map.rental;
    if (!rental || rental.listed === false) continue; // unlisted or no rental block = excluded entirely

    const available = isActionAvailable(rental.availability, ctx.evalContext);

    const areaM2 = rental.areaM2Override ?? floorsAreaM2(map.floors);

    let rentPrice: number | undefined;
    if (available) {
      rentPrice = rental.rentPriceOverride
        ?? computeFinancePreview(ctx.finance, { map, assets: ctx.assets }).rent;
    }

    listings.push({
      mapId: map.id,
      title: rental.adTitle ?? '',
      text: rental.adText ?? '',
      image: rental.adImage,
      areaM2,
      available,
      rentPrice,
      statusLabel: available ? labels.available : labels.notAvailable,
      moveInHours: rental.moveInHours ?? 0,
      isCurrentHome: ctx.homeMapId !== undefined && map.id === ctx.homeMapId,
    });
  }
  return listings;
}
