// bills.test.ts — headless tests for game/bills.ts. Run: npx tsx test/bills.test.ts

import { BillState } from '../game/bills';
import type { BillsData } from '../game/data';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name} ${detail}`); }
}

const defs: BillsData = { bills: [
  { id: 'rent', name: 'Rent', amount: 300 },
  { id: 'phone', name: 'Phone', amount: 40 },
  { id: 'hydro', name: 'Hydro', amount: 60 },
] };

console.log('bills.test — arrival cadence and recurring instances');
{
  const state = new BillState(defs, 3, 1);
  check('not due before interval', state.tick(2) === null && state.tick(3) === null);
  const first = state.tick(4);
  check('arrives on exact configured day', first?.arrived.length === 3);
  check('arrival total is data driven', first?.total === 400 && state.total === 400);
  check('last arrival day advances', state.lastArrivalDay === 4);
  check('next cycle does not arrive early', state.tick(6) === null);
  const second = state.tick(7);
  check('unpaid recurring bills coexist', second?.arrived.length === 3 && state.outstanding.length === 6 && state.total === 800);
  check('recurring instances have unique keys', new Set(state.outstanding.map((bill) => bill.key)).size === 6);
}

console.log('bills.test — payment decisions');
{
  const state = new BillState(defs, 3, 1);
  state.tick(4);
  const phone = state.outstanding.find((bill) => bill.id === 'phone')!;
  const refused = state.pay(phone.key, 39);
  check('single bill refuses insufficient funds', !refused.ok && refused.reason === 'insufficient_funds');
  check('refused bill remains outstanding', state.outstanding.some((bill) => bill.key === phone.key));
  const paid = state.pay(phone.key, 250);
  check('single bill returns deducted balance', paid.ok && paid.paid === 40 && paid.remainingFunds === 210);
  check('paid bill is removed', !state.outstanding.some((bill) => bill.key === phone.key) && state.total === 360);
  const missing = state.pay('missing', 1000);
  check('unknown bill is a safe refusal', !missing.ok && missing.reason === 'not_found');
  const before = state.serialize();
  const allRefused = state.payAll(359);
  check('pay all refuses insufficient total', !allRefused.ok && allRefused.reason === 'insufficient_funds');
  check('pay all refusal is atomic', JSON.stringify(state.serialize()) === JSON.stringify(before));
  const allPaid = state.payAll(500);
  check('pay all deducts exact total', allPaid.ok && allPaid.paid === 360 && allPaid.remainingFunds === 140);
  check('pay all clears badge-driving count', state.outstanding.length === 0 && state.total === 0);
}

console.log('bills.test — retune and persistence');
{
  const state = new BillState(defs, 3, 1);
  state.tick(4);
  state.retune({ bills: [{ id: 'rent', name: 'New Rent', amount: 500 }] }, 2);
  check('retune preserves already-arrived snapshot', state.outstanding[0].name === 'Rent' && state.total === 400);
  const next = state.tick(6);
  check('retune changes future cadence and definitions', next?.arrived.length === 1 && next.arrived[0].name === 'New Rent' && next.total === 500);
  const saved = state.serialize();
  const restored = new BillState({ bills: [] }, 99, 1);
  restored.restore(saved);
  check('serialize/restore round trips runtime state', JSON.stringify(restored.serialize()) === JSON.stringify(saved));
  const fallback = new BillState(defs, 0, 1);
  check('invalid interval uses default three days', fallback.tick(3) === null && fallback.tick(4)?.total === 400);
}

if (failures > 0) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
console.log('\nAll bills.test checks passed.');
