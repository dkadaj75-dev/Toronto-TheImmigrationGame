// hydro.test.ts — headless tests for game/hydro.ts pure metered-power logic (2026-07-17 slice):
// power resolution, active-rate summing, per-hour accumulation over sim-hours, ON/OFF transitions
// modelled as rate changes, cycle reset, and serialize/restore. Run: npx tsx test/hydro.test.ts

import { HydroMeter, resolveAssetPower, activePowerRate, usageCharge, HYDRO_BILL_ID } from '../game/hydro';
import type { AssetDef } from '../game/data';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name} ${detail}`); }
}
function approx(a: number, b: number, eps = 1e-9) { return Math.abs(a - b) <= eps; }

const asset = (over: Partial<AssetDef> = {}): AssetDef => ({
  id: 'a', name: 'A', category: 'furniture', mesh: '', buyPrice: 0, sellPrice: 0,
  environmentScore: 0, footprint: [1, 1], interactions: [], ...over,
});

console.log('hydro.test — resolveAssetPower (sparse, guarded)');
{
  check('absent power => null', resolveAssetPower(asset()) === null);
  check('positive rate resolves', resolveAssetPower(asset({ power: { ratePerHour: 3 } }))?.ratePerHour === 3);
  check('zero rate => null (draws nothing)', resolveAssetPower(asset({ power: { ratePerHour: 0 } })) === null);
  check('negative rate => null', resolveAssetPower(asset({ power: { ratePerHour: -2 } })) === null);
  check('NaN rate => null', resolveAssetPower(asset({ power: { ratePerHour: NaN } })) === null);
  check('bill id constant is hydro', HYDRO_BILL_ID === 'hydro');
}

console.log('hydro.test — activePowerRate (sum of ON metered assets)');
{
  check('empty => 0', activePowerRate([]) === 0);
  check('sums positive rates', activePowerRate([1, 2, 3.5]) === 6.5);
  check('ignores non-positive/non-finite entries', activePowerRate([2, 0, -1, NaN, 4]) === 6);
}

console.log('hydro.test — usageCharge (hours x rate, guarded)');
{
  check('2h at 3/h => 6', usageCharge(2, 3) === 6);
  check('fractional hours accrue proportionally', approx(usageCharge(0.25, 4), 1));
  check('zero hours => 0 (paused frame)', usageCharge(0, 5) === 0);
  check('zero rate => 0 (empty room)', usageCharge(3, 0) === 0);
  check('negative/NaN inputs => 0', usageCharge(-1, 3) === 0 && usageCharge(2, NaN) === 0);
}

console.log('hydro.test — HydroMeter accumulation over sim hours');
{
  const m = new HydroMeter();
  check('starts empty', m.accruedCharge === 0);
  m.accrue(1, 10);            // 1h at 10/h
  check('accrues 1h at 10/h', m.accruedCharge === 10);
  m.accrue(0.5, 10);          // +0.5h at 10/h
  check('accumulates across frames', m.accruedCharge === 15);
  m.accrue(2, 0);             // TV off (rate 0) for 2h — no charge
  check('OFF interval (rate 0) adds nothing', m.accruedCharge === 15);
  m.accrue(0, 10);            // paused frame — no hours
  check('paused frame adds nothing', m.accruedCharge === 15);
}

console.log('hydro.test — ON/OFF transitions modelled as changing rate');
{
  // Simulate a lamp (2/h) on the whole time and a TV (5/h) turned on midway then off.
  const m = new HydroMeter();
  m.accrue(1, activePowerRate([2]));       // 1h: only the lamp
  m.accrue(1, activePowerRate([2, 5]));    // 1h: lamp + TV on
  m.accrue(1, activePowerRate([2]));       // 1h: TV back off
  check('sums each interval at its active rate', m.accruedCharge === 2 + 7 + 2, String(m.accruedCharge));
}

console.log('hydro.test — billing cycle reset (takeCharge)');
{
  const m = new HydroMeter();
  m.accrue(3, 4); // 12
  check('takeCharge returns accrued', m.takeCharge() === 12);
  check('takeCharge resets the period', m.accruedCharge === 0);
  m.accrue(1, 4);
  check('accrues fresh after reset', m.accruedCharge === 4);
  m.reset();
  check('reset zeroes without returning (map switch)', m.accruedCharge === 0);
}

console.log('hydro.test — serialize / restore (save-system ready)');
{
  const m = new HydroMeter();
  m.accrue(2.5, 6); // 15
  const saved = m.serialize();
  check('serialize captures accrued charge', saved.accruedCharge === 15);
  const restored = new HydroMeter();
  restored.restore(saved);
  check('restore round-trips the accumulator', restored.accruedCharge === 15);
  const clean = new HydroMeter();
  clean.restore({ accruedCharge: -5 as unknown as number });
  check('restore guards a bad negative value to 0', clean.accruedCharge === 0);
  clean.restore({ accruedCharge: NaN as unknown as number });
  check('restore guards NaN to 0', clean.accruedCharge === 0);
}

if (failures > 0) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
console.log('\nAll hydro.test checks passed.');
