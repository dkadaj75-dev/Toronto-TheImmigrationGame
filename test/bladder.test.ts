// bladder.test.ts — game/bladder.ts pure logic (ROADMAP_NEXT B2-4, PROJECT_CONTEXT.md §7.17).
// Run: npx tsx test/bladder.test.ts
import { initBladderFailureState, checkBladderFailure } from '../game/bladder';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name} ${detail}`); }
}

console.log('bladder.test — checkBladderFailure');
{
  // starts armed: fires the very first time bladder reaches 0
  let s = initBladderFailureState();
  check('starts armed', s.armed === true);
  check('bladder above 0 never fires', checkBladderFailure(s, 45, 30) === false);
  check('still armed while above 0', s.armed === true);
  check('reaching exactly 0 fires while armed', checkBladderFailure(s, 0, 30) === true);
  check('disarms immediately after firing', s.armed === false);

  // no retrigger while it stays at/under 0 (would otherwise fire every single decay tick)
  check('does not refire while still at 0', checkBladderFailure(s, 0, 30) === false);
  check('does not refire on a hypothetical negative reading either', checkBladderFailure(s, -5, 30) === false);

  // no retrigger from the relief top-up itself decaying back down to 0 without a real bathroom visit
  s = initBladderFailureState();
  checkBladderFailure(s, 0, 30); // fires once, disarms
  check('relief amount itself (30) does not re-arm — must be STRICTLY above', checkBladderFailure(s, 30, 30) === false);
  check('still disarmed at exactly reliefAmount', s.armed === false);
  check('decaying back to 0 from 30 without ever exceeding relief does not refire', checkBladderFailure(s, 0, 30) === false);

  // re-arms only once bladder climbs strictly above reliefAmount (e.g. autonomy sends the sim to
  // the toilet after relief, which fills bladder well past 30)
  s = initBladderFailureState();
  checkBladderFailure(s, 0, 30); // fires, disarms
  check('one unit above relief re-arms', checkBladderFailure(s, 31, 30) === false); // re-arming itself never "fires"
  check('armed again once above reliefAmount', s.armed === true);
  check('a fresh decay to 0 after re-arming fires again', checkBladderFailure(s, 0, 30) === true);
  check('disarmed again after the second fire', s.armed === false);

  // full bathroom trip (toilet-style refill all the way to ~95) obviously re-arms too
  s = initBladderFailureState();
  checkBladderFailure(s, 0, 30);
  checkBladderFailure(s, 95, 30); // re-arms (no fire on the way up)
  check('re-arming step itself never fires', s.armed === true);
  check('fires again after a full refill + full decay cycle', checkBladderFailure(s, 0, 30) === true);

  // different reliefAmount tunings behave consistently
  s = initBladderFailureState();
  checkBladderFailure(s, 0, 50);
  check('custom reliefAmount: at exactly 50 does not re-arm', checkBladderFailure(s, 50, 50) === false);
  check('custom reliefAmount: exactly 50 still disarmed', s.armed === false);
  check('custom reliefAmount: at 51 re-arms (step itself never fires)', checkBladderFailure(s, 51, 50) === false);
  check('re-armed flag reflects it', s.armed === true);
}

if (failures > 0) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
console.log('\nALL BLADDER TESTS PASSED');
