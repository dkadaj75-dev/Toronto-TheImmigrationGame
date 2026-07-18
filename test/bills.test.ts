// bills.test.ts — headless tests for game/bills.ts. Run: npx tsx test/bills.test.ts

import { FinanceState, applyCreditDelta, clampCreditScore, computeBillAmounts, computeFinancePreview, countFloorTiles, decideRepoSeizure, scaledDebtWindows } from '../game/bills';
import type { AssetsData, BillsData, CreditTuning, FinanceData, MapData } from '../game/data';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name} ${detail}`); }
}

const defs: BillsData = { bills: [
  { id: 'rent', name: 'Rent' }, { id: 'phone', name: 'Phone' }, { id: 'hydro', name: 'Hydro' },
] };
const finance: FinanceData = {
  rent: { base: 100, perFloorTile: 5, byPropertyType: { condo: 20, basement: -10, townhouse: 50, house: 100, penthouse: 250 } },
  bills: [
    { id: 'phone', name: 'Phone', base: 10, perAssetValue: 0.1 },
    { id: 'hydro', name: 'Hydro', base: 20, perAssetValue: 0.2 },
  ], overdueDays: 3, tooLateDays: 7, negativeGraceDays: 2,
};
const map: MapData = {
  id: 'test', name: 'Test', propertyType: 'condo', gridSize: 1, bounds: { w: 4, h: 3 },
  floors: [
    { id: 'a', material: 'wood', polygon: [[0,0],[2,0],[2,2],[0,2]] },
    { id: 'b', material: 'tile', polygon: [[2,0],[4,0],[4,1],[2,1]] },
  ], walls: [], doors: [], spawn: { pos: [0.5,0.5], facingDeg: 0 },
  placedObjects: [{ asset: 'chair', pos: [0.5,0.5], rotDeg: 0 }, { asset: 'lamp', pos: [1.5,0.5], rotDeg: 0 }],
};
const assets: AssetsData = { categories: [], assets: [
  { id: 'chair', name: 'Chair', category: 'seat', mesh: '', buyPrice: 100, sellPrice: 50, environmentScore: 0, footprint: [1,1], interactions: [] },
  { id: 'lamp', name: 'Lamp', category: 'decor', mesh: '', buyPrice: 50, sellPrice: 25, environmentScore: 0, footprint: [1,1], interactions: [] },
] };
const context = { map, assets };
const credit: CreditTuning = {
  min: 300, max: 900, startingScore: 500,
  onTimePaymentDelta: 8, overdueDelta: -20, debtEntryDelta: -10,
  debtDailyDelta: -3, repoDelta: -100,
  lowScoreDebtWindowFactor: 0.75, highScoreDebtWindowFactor: 1.5, historyLimit: 6,
};

console.log('bills.test — formula math');
{
  check('floor-tile count uses unique grid cells across polygons', countFloorTiles(map) === 6);
  // ROADMAP_APT D3 (§6.3): outdoor floors (balconies) are excluded from the rent tile count.
  const withOutdoor: MapData = { ...map, floors: [map.floors[0], { ...map.floors[1], outdoor: true }] };
  check('outdoor floor excluded from rent tile count (indoor-only)', countFloorTiles(withOutdoor) === 4);
  check('outdoor exclusion lowers rent via the formula',
    computeFinancePreview(finance, { ...context, map: withOutdoor }).rent
      === finance.rent.base + finance.rent.perFloorTile * 4 + finance.rent.byPropertyType.condo);
  const preview = computeFinancePreview(finance, context);
  check('placed asset value sums buyPrice once per instance', preview.totalAssetValue === 150);
  check('rent = base + per tile + condo property adjustment', preview.rent === 150, String(preview.rent));
  check('bill = base + perAssetValue * total asset value', preview.bills[0].amount === 25 && preview.bills[1].amount === 50);
  const basement = computeFinancePreview(finance, { ...context, map: { ...map, propertyType: 'basement' } });
  const penthouse = computeFinancePreview(finance, { ...context, map: { ...map, propertyType: 'penthouse' } });
  check('property-type table changes rent', basement.rent === 120 && penthouse.rent === 380);
  const legacy = computeFinancePreview(finance, { ...context, map: { ...map, propertyType: undefined } });
  check('missing propertyType defaults to condo', legacy.rent === preview.rent);
  const owned = computeBillAmounts(defs, finance, { ...context, placedObjects: [...map.placedObjects, { asset: 'chair', pos: [3.5,0.5] as [number,number], rotDeg: 0 }] });
  check('effective player-owned addition contributes at arrival', owned.find((bill) => bill.id === 'phone')?.amount === 35);
}

console.log('bills.test — Hydro usage charge composition (additive on top of the base formula)');
{
  // computeBillAmounts: a usage charge on 'hydro' adds ON TOP of the base formula; other bills and
  // rent are untouched, and the Finance Editor preview path (no usage arg) stays formula-only.
  const base = computeBillAmounts(defs, finance, context);
  const hydroBase = base.find((b) => b.id === 'hydro')!.amount;
  const withUsage = computeBillAmounts(defs, finance, context, { hydro: 7.5 });
  check('usage adds on top of the hydro base formula', withUsage.find((b) => b.id === 'hydro')!.amount === hydroBase + 7.5, String(withUsage.find((b) => b.id === 'hydro')!.amount));
  check('usage on hydro leaves phone/rent unchanged',
    withUsage.find((b) => b.id === 'phone')!.amount === base.find((b) => b.id === 'phone')!.amount
    && withUsage.find((b) => b.id === 'rent')!.amount === base.find((b) => b.id === 'rent')!.amount);
  check('negative/NaN usage is ignored (never reduces a bill)',
    computeBillAmounts(defs, finance, context, { hydro: -5 }).find((b) => b.id === 'hydro')!.amount === hydroBase
    && computeBillAmounts(defs, finance, context, { hydro: NaN }).find((b) => b.id === 'hydro')!.amount === hydroBase);

  // FinanceState.tick folds the usage onto the arrived bill; base bill total gets +usage exactly.
  const meterState = new FinanceState(defs, finance, 3, 1);
  const plain = meterState.tick(4, context);              // day 4: first cycle, no usage
  const plainTotal = plain!.total;
  const withUsageArrival = meterState.tick(7, context, { hydro: 12 }); // next cycle with usage
  check('tick folds hydro usage into the arrived bill total', withUsageArrival!.total === plainTotal + 12, `${withUsageArrival!.total} vs ${plainTotal}`);
  const arrivedHydro = withUsageArrival!.arrived.find((b) => b.id === 'hydro')!;
  check('the arrived hydro outstanding bill carries base + usage', arrivedHydro.amount === base.find((b) => b.id === 'hydro')!.amount + 12);
  // A non-billing day returns null and ignores the usage (caller keeps accumulating).
  check('usage passed on a non-arrival day is a no-op (tick returns null)', meterState.tick(8, context, { hydro: 999 }) === null);
}

console.log('bills.test — arrival cadence, payment, retune, persistence');
{
  const state = new FinanceState(defs, finance, 3, 1);
  check('not due before interval', state.tick(2, context) === null && state.tick(3, context) === null);
  const first = state.tick(4, context);
  check('computed cycle arrives on exact configured day', first?.arrived.length === 3 && first.total === 225, String(first?.total));
  const phone = state.outstanding.find((bill) => bill.id === 'phone')!;
  check('phone UI amount is snapshotted on outstanding bill', phone.amount === 25);
  const paid = state.pay(phone.key, 24, 4);
  check('underfunded bill payment is charged into negative funds', paid.ok && paid.paid === 25 && paid.remainingFunds === -1);
  check('negative payment records serializable debt age', state.debt === 1 && state.debtSince === 4);
  const changed: FinanceData = { ...finance, bills: finance.bills.map((bill) => ({ ...bill, base: bill.base + 100 })) };
  state.retune(defs, changed, 2);
  check('retune preserves arrived formula snapshots', state.total === 200);
  const next = state.tick(6, context);
  check('retune affects future formula snapshots only', next?.total === 425);
  check('recurring instances keep unique keys', new Set(state.outstanding.map((bill) => bill.key)).size === state.outstanding.length);
  const saved = state.serialize(); const restored = new FinanceState({ bills: [] }, finance, 99, 1); restored.restore(saved);
  check('serialize/restore round trips computed outstanding amounts', JSON.stringify(restored.serialize()) === JSON.stringify(saved));
  const fallback = new FinanceState(defs, finance, 0, 1);
  check('invalid interval uses default three days', fallback.tick(3, context) === null && fallback.tick(4, context)?.total === 225);
}

console.log('bills.test â€” F2 overdue/debt and pure repo decisions');
{
  const state = new FinanceState(defs, finance, 99, 1);
  state.outstanding.push({ id: 'rent', name: 'Rent', amount: 100, key: '1:rent:0', arrivalDay: 1 });
  state.tick(4, context);
  check('bill is not overdue at exactly overdueDays old', state.overdueSince === null);
  state.tick(5, context);
  check('overdueSince records first day past overdueDays', state.overdueSince === 5);
  state.observeFunds(5, -20);
  check('negativeGraceDays counts from first day in negative debt', !state.isRepoDue(6) && state.isRepoDue(7));
  const saved = state.serialize();
  const restored = new FinanceState(defs, finance, 99, 1); restored.restore(saved);
  check('finance state persists outstanding, overdueSince and debt', JSON.stringify(restored.serialize()) === JSON.stringify(saved));

  const candidates = [
    { key: 'bed', name: 'Bed', sellPrice: 100, survivalImportance: 100 },
    { key: 'tv', name: 'TV', sellPrice: 40, survivalImportance: -10 },
    { key: 'sofa', name: 'Sofa', sellPrice: 30 },
  ];
  const covered = decideRepoSeizure(-50, candidates);
  check('partial seizure stops as soon as debt is covered', covered.seized.map((x) => x.key).join(',') === 'tv,sofa' && covered.remainingFunds === 20 && !covered.gameOver);
  check('importance ordering seizes low priority before survival assets', covered.seized.every((x) => x.key !== 'bed'));
  const short = decideRepoSeizure(-500, candidates);
  check('full seizure still short determines game over', short.seized.length === 3 && short.remainingFunds === -330 && short.gameOver);
  const solvent = decideRepoSeizure(10, candidates);
  check('nothing is seized when solvent', solvent.seized.length === 0 && solvent.remainingFunds === 10 && !solvent.gameOver);
}

console.log('bills.test — F3 credit score and scaled debt windows');
{
  check('delta application clamps at configured minimum', applyCreditDelta(305, -20, credit) === 300);
  check('score clamping handles both ends', clampCreditScore(100, credit) === 300 && clampCreditScore(1000, credit) === 900);
  const low = scaledDebtWindows(finance, 300, credit);
  const start = scaledDebtWindows(finance, 500, credit);
  const high = scaledDebtWindows(finance, 900, credit);
  check('debt-window factor scales linearly from low to high credit', low.factor === 0.75 && start.factor === 1 && high.factor === 1.5);
  check('scaled windows round upward to whole days', low.negativeGraceDays === 2 && high.negativeGraceDays === 3 && high.tooLateDays === 11);

  const onTime = new FinanceState(defs, finance, 99, 1, credit);
  onTime.outstanding.push({ id: 'rent', name: 'Rent', amount: 100, key: '1:rent:0', arrivalDay: 1 });
  onTime.pay('1:rent:0', 200, 2);
  check('on-time bill payment raises score', onTime.creditScore === 508 && onTime.creditHistory[0]?.reason.includes('paid on time'));

  const consequences = new FinanceState(defs, finance, 99, 1, credit);
  consequences.outstanding.push({ id: 'rent', name: 'Rent', amount: 100, key: '1:rent:0', arrivalDay: 1 });
  consequences.tick(5, context);
  check('first overdue event lowers score once', consequences.creditScore === 480);
  consequences.tick(6, context);
  check('remaining overdue does not repeat event penalty', consequences.creditScore === 480);
  consequences.observeFunds(6, -10);
  consequences.observeFunds(8, -10);
  check('debt entry and each in-debt day decay score', consequences.creditScore === 464);
  consequences.applyRepoPenalty(8);
  check('repo applies the tunable large penalty', consequences.creditScore === 364);

  const highScoreCredit = { ...credit, startingScore: 900 };
  const highScoreDebt = new FinanceState(defs, finance, 99, 1, highScoreCredit);
  highScoreDebt.observeFunds(1, -1);
  check('F2 repo trigger reads score-scaled negative window', !highScoreDebt.isRepoDue(3) && highScoreDebt.isRepoDue(4));
  const saved = highScoreDebt.serialize();
  const restored = new FinanceState(defs, finance, 99, 1, credit); restored.restore(saved);
  check('credit score, trend and decay cursor serialize in FinanceState', JSON.stringify(restored.serialize()) === JSON.stringify(saved));
}

if (failures > 0) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
console.log('\nAll bills.test checks passed.');
