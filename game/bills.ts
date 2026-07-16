// bills.ts — pure recurring-bill runtime state (PROJECT_CONTEXT.md §7.22).
// No DOM/three.js dependency: cadence, payment decisions, hot-retune, and persistence are headless-tested.

import type { BillDef, BillsData } from './data';

export const DEFAULT_BILL_INTERVAL_DAYS = 3;

export interface OutstandingBill extends BillDef {
  /** Unique per arrival, so an unpaid recurring bill can coexist with the next cycle's bill. */
  key: string;
  arrivalDay: number;
}

export interface BillsSaveState {
  outstanding: OutstandingBill[];
  lastArrivalDay: number;
}

export type BillArrival = { arrived: OutstandingBill[]; total: number };
export type BillPayment =
  | { ok: true; paid: number; remainingFunds: number }
  | { ok: false; reason: 'not_found' | 'insufficient_funds' };

function resolveInterval(value: number | undefined): number {
  return Number.isFinite(value) && value! > 0 ? Math.max(1, Math.floor(value!)) : DEFAULT_BILL_INTERVAL_DAYS;
}

/** Owns bill definitions plus only the runtime state a future save system needs to persist. */
export class BillState {
  private defs: BillDef[];
  private intervalDays: number;
  outstanding: OutstandingBill[] = [];
  lastArrivalDay: number;

  constructor(data: BillsData, intervalDays = DEFAULT_BILL_INTERVAL_DAYS, startDay = 1) {
    this.defs = data.bills;
    this.intervalDays = resolveInterval(intervalDays);
    this.lastArrivalDay = startDay;
  }

  /** Definition/cadence hot-reload never rewrites bills that have already arrived. */
  retune(data: BillsData, intervalDays = DEFAULT_BILL_INTERVAL_DAYS) {
    this.defs = data.bills;
    this.intervalDays = resolveInterval(intervalDays);
  }

  /** Called on each crossed day boundary. Returns null until the configured cadence is due. */
  tick(day: number): BillArrival | null {
    if (day - this.lastArrivalDay < this.intervalDays) return null;
    this.lastArrivalDay = day;
    const arrived = this.defs.map((bill, index) => ({
      ...bill,
      key: `${day}:${bill.id}:${index}`,
      arrivalDay: day,
    }));
    this.outstanding.push(...arrived);
    return { arrived, total: arrived.reduce((sum, bill) => sum + bill.amount, 0) };
  }

  get total(): number { return this.outstanding.reduce((sum, bill) => sum + bill.amount, 0); }

  pay(key: string, funds: number): BillPayment {
    const index = this.outstanding.findIndex((bill) => bill.key === key);
    if (index < 0) return { ok: false, reason: 'not_found' };
    const bill = this.outstanding[index];
    if (funds < bill.amount) return { ok: false, reason: 'insufficient_funds' };
    this.outstanding.splice(index, 1);
    return { ok: true, paid: bill.amount, remainingFunds: funds - bill.amount };
  }

  /** Pay-all is atomic: insufficient funds leaves every bill outstanding. */
  payAll(funds: number): BillPayment {
    const total = this.total;
    if (funds < total) return { ok: false, reason: 'insufficient_funds' };
    this.outstanding = [];
    return { ok: true, paid: total, remainingFunds: funds - total };
  }

  serialize(): BillsSaveState {
    return { outstanding: this.outstanding.map((bill) => ({ ...bill })), lastArrivalDay: this.lastArrivalDay };
  }

  restore(state: BillsSaveState) {
    this.outstanding = state.outstanding.map((bill) => ({ ...bill }));
    this.lastArrivalDay = state.lastArrivalDay;
  }
}
