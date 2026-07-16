// bills.ts — pure formula-driven recurring bills (PROJECT_CONTEXT.md §7.24 F1).
// No DOM/three.js dependency: map/asset math, arrival snapshots, payment decisions, hot-retune,
// and persistence are headless-tested. Both the game and Finance Editor import these helpers.

import type { AssetDef, AssetsData, BillDef, BillsData, FinanceData, MapData, PropertyType } from './data';

export const DEFAULT_BILL_INTERVAL_DAYS = 3;

export interface OutstandingBill extends BillDef {
  amount: number;
  /** Unique per arrival, so an unpaid recurring bill can coexist with the next cycle's bill. */
  key: string;
  arrivalDay: number;
}

export interface FinanceSaveState {
  outstanding: OutstandingBill[];
  lastArrivalDay: number;
  overdueSince: number | null;
  debt: number;
  debtSince: number | null;
}

export type BillArrival = { arrived: OutstandingBill[]; total: number };
export type BillPayment =
  | { ok: true; paid: number; remainingFunds: number }
  | { ok: false; reason: 'not_found' };

export interface RepoCandidate {
  key: string;
  name: string;
  sellPrice: number;
  survivalImportance?: number;
}

export interface RepoDecision {
  seized: RepoCandidate[];
  remainingFunds: number;
  gameOver: boolean;
}

/** Sparse survivalImportance defaults to neutral 0; lower values are seized first. */
export function survivalImportance(def: Pick<AssetDef, 'survivalImportance'>): number {
  const value = def.survivalImportance;
  return Number.isFinite(value) ? value! : 0;
}

/** Pure F2 decision boundary. Input order is the stable tie-breaker for equal importance. */
export function decideRepoSeizure(funds: number, candidates: readonly RepoCandidate[]): RepoDecision {
  let remainingFunds = Number.isFinite(funds) ? funds : 0;
  if (remainingFunds >= 0) return { seized: [], remainingFunds, gameOver: false };
  const ordered = candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => survivalImportance(a.candidate) - survivalImportance(b.candidate) || a.index - b.index);
  const seized: RepoCandidate[] = [];
  for (const { candidate } of ordered) {
    seized.push(candidate);
    remainingFunds += Math.max(0, Number.isFinite(candidate.sellPrice) ? candidate.sellPrice : 0);
    if (remainingFunds >= 0) break;
  }
  return { seized, remainingFunds, gameOver: remainingFunds < 0 };
}

export interface BillFormulaContext {
  map: MapData;
  assets: AssetsData;
  /** The live effective list: authored placements minus sold/destroyed items plus purchases. */
  placedObjects?: MapData['placedObjects'];
}

export interface FinancePreview {
  floorTileCount: number;
  totalAssetValue: number;
  rent: number;
  bills: { id: string; name: string; amount: number }[];
}

const PROPERTY_TYPES: PropertyType[] = ['condo', 'basement', 'townhouse', 'house', 'penthouse'];

function pointInPolygon(x: number, z: number, polygon: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i];
    const [xj, zj] = polygon[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Counts unique map-grid cells whose centres lie on any floor polygon. */
export function countFloorTiles(map: MapData): number {
  const size = Number.isFinite(map.gridSize) && map.gridSize > 0 ? map.gridSize : 1;
  const columns = Math.max(0, Math.ceil(map.bounds.w / size));
  const rows = Math.max(0, Math.ceil(map.bounds.h / size));
  let count = 0;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const x = (column + 0.5) * size;
      const z = (row + 0.5) * size;
      if (map.floors.some((floor) => pointInPolygon(x, z, floor.polygon))) count++;
    }
  }
  return count;
}

/** Sums buyPrice once per live/effective placed instance; unknown asset ids contribute zero. */
export function totalPlacedAssetValue(context: BillFormulaContext): number {
  const byId = new Map(context.assets.assets.map((asset) => [asset.id, asset.buyPrice]));
  return (context.placedObjects ?? context.map.placedObjects).reduce(
    (sum, placed) => sum + (byId.get(placed.asset) ?? 0),
    0,
  );
}

/** Single source of formula math for runtime arrivals and the Finance Editor live preview. */
export function computeFinancePreview(finance: FinanceData, context: BillFormulaContext): FinancePreview {
  const floorTileCount = countFloorTiles(context.map);
  const totalAssetValue = totalPlacedAssetValue(context);
  const propertyType = PROPERTY_TYPES.includes(context.map.propertyType as PropertyType)
    ? context.map.propertyType as PropertyType
    : 'condo';
  const rent = finance.rent.base
    + finance.rent.perFloorTile * floorTileCount
    + (finance.rent.byPropertyType[propertyType] ?? 0);
  const bills = finance.bills.map((bill) => ({
    id: bill.id,
    name: bill.name,
    amount: bill.base + bill.perAssetValue * totalAssetValue,
  }));
  return { floorTileCount, totalAssetValue, rent, bills };
}

/** Applies formulas to the ordered bills.json identity/display list. Unknown formulas cost zero. */
export function computeBillAmounts(data: BillsData, finance: FinanceData, context: BillFormulaContext): (BillDef & { amount: number })[] {
  const preview = computeFinancePreview(finance, context);
  const formulaAmounts = new Map(preview.bills.map((bill) => [bill.id, bill.amount]));
  return data.bills.map((bill) => ({
    ...bill,
    amount: bill.id === 'rent' ? preview.rent : (formulaAmounts.get(bill.id) ?? 0),
  }));
}

function resolveInterval(value: number | undefined): number {
  return Number.isFinite(value) && value! > 0 ? Math.max(1, Math.floor(value!)) : DEFAULT_BILL_INTERVAL_DAYS;
}

/** Owns bill definitions plus only the runtime state a future save system needs to persist. */
export class FinanceState {
  private defs: BillDef[];
  private finance: FinanceData;
  private intervalDays: number;
  outstanding: OutstandingBill[] = [];
  lastArrivalDay: number;
  overdueSince: number | null = null;
  debt = 0;
  debtSince: number | null = null;

  constructor(data: BillsData, finance: FinanceData, intervalDays = DEFAULT_BILL_INTERVAL_DAYS, startDay = 1) {
    this.defs = data.bills;
    this.finance = finance;
    this.intervalDays = resolveInterval(intervalDays);
    this.lastArrivalDay = startDay;
  }

  /** Definition/cadence hot-reload never rewrites bills that have already arrived. */
  retune(data: BillsData, finance: FinanceData, intervalDays = DEFAULT_BILL_INTERVAL_DAYS) {
    this.defs = data.bills;
    this.finance = finance;
    this.intervalDays = resolveInterval(intervalDays);
  }

  /** Called on each crossed day boundary. Returns null until the configured cadence is due. */
  tick(day: number, context: BillFormulaContext): BillArrival | null {
    this.updateOverdue(day);
    if (day - this.lastArrivalDay < this.intervalDays) return null;
    this.lastArrivalDay = day;
    const arrived = computeBillAmounts({ bills: this.defs }, this.finance, context).map((bill, index) => ({
      ...bill,
      key: `${day}:${bill.id}:${index}`,
      arrivalDay: day,
    }));
    this.outstanding.push(...arrived);
    this.updateOverdue(day);
    return { arrived, total: arrived.reduce((sum, bill) => sum + bill.amount, 0) };
  }

  get total(): number { return this.outstanding.reduce((sum, bill) => sum + bill.amount, 0); }

  /** Charges a bill even when cash is short. The caller applies remainingFunds, which may be negative. */
  pay(key: string, funds: number, day = this.lastArrivalDay): BillPayment {
    const index = this.outstanding.findIndex((bill) => bill.key === key);
    if (index < 0) return { ok: false, reason: 'not_found' };
    const bill = this.outstanding[index];
    this.outstanding.splice(index, 1);
    const remainingFunds = funds - bill.amount;
    this.observeFunds(day, remainingFunds);
    this.updateOverdue(day);
    return { ok: true, paid: bill.amount, remainingFunds };
  }

  /** Charges all outstanding bills atomically; an underfunded payment creates negative cash. */
  payAll(funds: number, day = this.lastArrivalDay): BillPayment {
    const total = this.total;
    this.outstanding = [];
    const remainingFunds = funds - total;
    this.observeFunds(day, remainingFunds);
    this.updateOverdue(day);
    return { ok: true, paid: total, remainingFunds };
  }

  observeFunds(day: number, funds: number) {
    this.debt = Math.max(0, -(Number.isFinite(funds) ? funds : 0));
    if (this.debt > 0) this.debtSince ??= day;
    else this.debtSince = null;
  }

  isRepoDue(day: number): boolean {
    const starts = [this.overdueSince, this.debtSince].filter((value): value is number => value !== null);
    return starts.some((start) => day - start >= Math.max(0, this.finance.tooLateDays));
  }

  serialize(): FinanceSaveState {
    return {
      outstanding: this.outstanding.map((bill) => ({ ...bill })),
      lastArrivalDay: this.lastArrivalDay,
      overdueSince: this.overdueSince,
      debt: this.debt,
      debtSince: this.debtSince,
    };
  }

  restore(state: FinanceSaveState) {
    this.outstanding = state.outstanding.map((bill) => ({ ...bill }));
    this.lastArrivalDay = state.lastArrivalDay;
    this.overdueSince = state.overdueSince ?? null;
    this.debt = Math.max(0, state.debt ?? 0);
    this.debtSince = state.debtSince ?? null;
  }

  private updateOverdue(day: number) {
    const hasOverdue = this.outstanding.some((bill) => day - bill.arrivalDay > Math.max(0, this.finance.overdueDays));
    if (hasOverdue) this.overdueSince ??= day;
    else this.overdueSince = null;
  }
}

export { FinanceState as BillState };
