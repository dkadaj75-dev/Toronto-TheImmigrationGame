// hydro.ts — pure metered-power accumulation for the Hydro bill (2026-07-17 designer slice).
// No DOM / three.js: the accumulator, the active-rate sum, and serialize/restore are all headless-
// testable (test/hydro.test.ts). main.ts owns the per-frame plumbing (walk the ON assets, feed sim-
// hour deltas in) and folds the accrued charge onto the Hydro bill via game/bills.ts.
//
// MODEL: every placed asset may carry a sparse `power.ratePerHour` (currency charged per sim-hour it
// is ON — its AssetStateRegistry ON/OFF state, the same boolean that drives its light). Each frame,
// main.ts sums the rate of the currently-ON metered assets (activePowerRate) and accrues that rate
// over the sim-hours elapsed this frame (HydroMeter.accrue). When a billing cycle arrives, the
// accrued charge is ADDED on top of the Hydro bill's base formula (FinanceState.tick extraCharges)
// and the accumulator resets for the next period — so the bill's base/perAssetValue formula is
// untouched and the usage is purely additive.

import type { AssetDef } from './data';

/** The billing id the accumulated usage charge is added onto (data/bills.json + finance.json). */
export const HYDRO_BILL_ID = 'hydro';

export interface AssetPower { ratePerHour: number }

export interface HydroSaveState { accruedCharge: number }

/** Resolve the sparse power block. Returns null unless `ratePerHour` is a finite positive number
 *  (absent/zero/negative/NaN = draws no metered power), so callers never accrue a bogus rate. */
export function resolveAssetPower(def: Pick<AssetDef, 'power'>): AssetPower | null {
  const rate = def.power?.ratePerHour;
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0 ? { ratePerHour: rate } : null;
}

/** Combined per-hour draw of a set of currently-ON metered assets (currency/sim-hour). Non-finite
 *  or negative entries are ignored so one bad rate can't poison the sum. */
export function activePowerRate(onRatesPerHour: readonly number[]): number {
  let sum = 0;
  for (const rate of onRatesPerHour) if (Number.isFinite(rate) && rate > 0) sum += rate;
  return sum;
}

/** The usage charge accumulated over `hours` sim-hours at a combined `ratePerHour`. Pure; guards
 *  non-positive/non-finite inputs to zero so a paused frame (0 hours) or empty room adds nothing. */
export function usageCharge(hours: number, ratePerHour: number): number {
  if (!(hours > 0) || !(ratePerHour > 0) || !Number.isFinite(hours) || !Number.isFinite(ratePerHour)) return 0;
  return hours * ratePerHour;
}

/** Running accumulator of the Hydro usage charge across a billing period. serialize()/restore()
 *  expose it for the future save system (same convention as FinanceState/AssetStateRegistry). */
export class HydroMeter {
  private accrued = 0;

  /** Accrue `hours` sim-hours of draw at the given combined rate (currency/sim-hour). */
  accrue(hours: number, ratePerHour: number): void {
    this.accrued += usageCharge(hours, ratePerHour);
  }

  /** Charge accumulated so far this billing period (currency). */
  get accruedCharge(): number { return this.accrued; }

  /** Take the accrued charge and reset the accumulator for the next billing period. */
  takeCharge(): number {
    const charge = this.accrued;
    this.accrued = 0;
    return charge;
  }

  /** Zero the accumulator without returning it (e.g. a map switch that abandons the period). */
  reset(): void { this.accrued = 0; }

  serialize(): HydroSaveState { return { accruedCharge: this.accrued }; }

  restore(state: HydroSaveState): void {
    const value = state?.accruedCharge;
    this.accrued = typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
  }
}
