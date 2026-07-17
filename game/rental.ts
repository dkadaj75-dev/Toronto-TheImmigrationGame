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
