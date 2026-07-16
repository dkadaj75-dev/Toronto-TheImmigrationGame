// bills.test.ts — headless tests for game/bills.ts. Run: npx tsx test/bills.test.ts

import { BillState, computeBillAmounts, computeFinancePreview, countFloorTiles } from '../game/bills';
import type { AssetsData, BillsData, FinanceData, MapData } from '../game/data';

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

console.log('bills.test — formula math');
{
  check('floor-tile count uses unique grid cells across polygons', countFloorTiles(map) === 6);
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

console.log('bills.test — arrival cadence, payment, retune, persistence');
{
  const state = new BillState(defs, finance, 3, 1);
  check('not due before interval', state.tick(2, context) === null && state.tick(3, context) === null);
  const first = state.tick(4, context);
  check('computed cycle arrives on exact configured day', first?.arrived.length === 3 && first.total === 225, String(first?.total));
  const phone = state.outstanding.find((bill) => bill.id === 'phone')!;
  check('phone UI amount is snapshotted on outstanding bill', phone.amount === 25);
  check('single bill refuses insufficient funds', state.pay(phone.key, 24).ok === false);
  const paid = state.pay(phone.key, 100);
  check('single bill returns computed deduction', paid.ok && paid.paid === 25 && paid.remainingFunds === 75);
  const before = state.serialize(); check('pay all remains atomic', !state.payAll(199).ok && JSON.stringify(state.serialize()) === JSON.stringify(before));
  const changed: FinanceData = { ...finance, bills: finance.bills.map((bill) => ({ ...bill, base: bill.base + 100 })) };
  state.retune(defs, changed, 2);
  check('retune preserves arrived formula snapshots', state.total === 200);
  const next = state.tick(6, context);
  check('retune affects future formula snapshots only', next?.total === 425);
  check('recurring instances keep unique keys', new Set(state.outstanding.map((bill) => bill.key)).size === state.outstanding.length);
  const saved = state.serialize(); const restored = new BillState({ bills: [] }, finance, 99, 1); restored.restore(saved);
  check('serialize/restore round trips computed outstanding amounts', JSON.stringify(restored.serialize()) === JSON.stringify(saved));
  const fallback = new BillState(defs, finance, 0, 1);
  check('invalid interval uses default three days', fallback.tick(3, context) === null && fallback.tick(4, context)?.total === 225);
}

if (failures > 0) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
console.log('\nAll bills.test checks passed.');
