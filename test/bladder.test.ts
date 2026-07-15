// bladder.test.ts — game/bladder.ts pure logic (ROADMAP_NEXT B2-4, PROJECT_CONTEXT.md §7.17;
// re-arm fix ROADMAP_NEXT B3-3). Run: npx tsx test/bladder.test.ts
import { initBladderFailureState, checkBladderFailure, rearmBladderFailure } from '../game/bladder';

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
  check('bladder above 0 never fires', checkBladderFailure(s, 45) === false);
  check('still armed while above 0', s.armed === true);
  check('reaching exactly 0 fires while armed', checkBladderFailure(s, 0) === true);
  check('disarms immediately after firing', s.armed === false);

  // no retrigger while it stays at/under 0 (would otherwise fire every single decay tick)
  check('does not refire while still at 0', checkBladderFailure(s, 0) === false);
  check('does not refire on a hypothetical negative reading either', checkBladderFailure(s, -5) === false);

  // ROADMAP_NEXT B3-3 regression: bladder decaying back down toward/at reliefAmount (or anywhere
  // else) NEVER re-arms on its own anymore — only an explicit rearmBladderFailure() call does.
  s = initBladderFailureState();
  checkBladderFailure(s, 0); // fires once, disarms
  check('sitting at reliefAmount does not re-arm by itself', checkBladderFailure(s, 30) === false);
  check('still disarmed at reliefAmount with no explicit re-arm', s.armed === false);
  check('climbing well above reliefAmount does not re-arm by itself either', checkBladderFailure(s, 95) === false);
  check('still disarmed — decay-only readings never re-arm', s.armed === false);
}

console.log('\nbladder.test — rearmBladderFailure (ROADMAP_NEXT B3-3: re-arm on event completion)');
{
  // the actual designer-reported bug: with the OLD design (re-arm only once bladder > reliefAmount
  // via decay), a second failure could never fire because nothing in this build refills bladder
  // past reliefAmount except the failure's own top-up landing AT reliefAmount. Fixed: main.ts calls
  // rearmBladderFailure explicitly once the failure event completes (relief applied), independent
  // of any later bladder reading — so decay 30 -> 0 again fires a SECOND time.
  const s = initBladderFailureState();
  check('fires the first time', checkBladderFailure(s, 0) === true);
  check('disarmed after first fire', s.armed === false);
  check('does not refire while still at/near 0 before the event completes', checkBladderFailure(s, 0) === false);

  rearmBladderFailure(s); // main.ts calls this right after applying the relief refill
  check('armed again immediately after the event completes', s.armed === true);
  check('does not fire merely from re-arming (bladder already back up at reliefAmount, e.g. 30)', checkBladderFailure(s, 30) === false);

  // decay 30 -> 0 again (no bathroom visit in between) — must fire again now that it's re-armed
  check('decaying 30 -> 0 fires a second time after the explicit re-arm', checkBladderFailure(s, 0) === true);
  check('disarms again after the second fire', s.armed === false);

  // a third cycle behaves identically — re-arm isn't a one-shot special case
  rearmBladderFailure(s);
  check('re-armed for a third cycle', s.armed === true);
  check('fires a third time after another 0-crossing', checkBladderFailure(s, 0) === true);
  check('disarmed again', s.armed === false);

  // calling rearmBladderFailure while already armed (e.g. a defensive extra call) is a harmless no-op
  const s2 = initBladderFailureState();
  rearmBladderFailure(s2);
  check('re-arming an already-armed state is a no-op', s2.armed === true);
}

if (failures > 0) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
console.log('\nALL BLADDER TESTS PASSED');
