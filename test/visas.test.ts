// visas.test.ts — headless tests for the visa/status state machine (game/visas.ts).
// Run: npx tsx test/visas.test.ts

import { VisaMachine } from '../game/visas';
import type { VisasData } from '../game/data';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name} ${detail}`); }
}

const visas: VisasData = {
  visas: [
    { id: 'visitor', name: 'Visitor', durationDays: 15, losable: false },
    { id: 'lmia', name: 'LMIA Work Permit', durationDays: 90, losable: true, graceDays: 3, obtainedVia: 'quest' },
    { id: 'temp_worker', name: 'Temporary Worker', durationDays: 365, losable: true, graceDays: 3, obtainedVia: 'quest' },
    {
      id: 'permanent_resident', name: 'Permanent Resident', durationDays: null, losable: false,
      obtainedVia: 'application', applicationDays: 30,
      requirements: { all: [{ var: 'skills.english', gte: 8 }, { var: 'funds', gte: 1000 }] },
    },
    { id: 'citizen', name: 'Citizen', durationDays: null, losable: false, obtainedVia: 'quest' },
  ],
};

console.log('visas.test — start status');
{
  const m = new VisaMachine(visas, 'visitor', 1);
  check('statusId is the start status', m.statusId === 'visitor');
  check('gameOver false at start', m.gameOver === false);
  check('expiresAtDay = start day + durationDays (1 + 15)', m.expiresAtDay === 16);
  check('daysLeft(1) = 15', m.daysLeft(1) === 15);
  check('daysLeft(10) = 6', m.daysLeft(10) === 6);
  check('not in grace at start', m.inGrace() === false);
}

console.log('visas.test — expiry -> game over (non-losable status)');
{
  const m = new VisaMachine(visas, 'visitor', 1);
  let overReason: string | null = null;
  m.onGameOver = (reason) => { overReason = reason; };
  for (let d = 2; d <= 15; d++) m.tick(d);
  check('not game over the day before expiry (day 15)', m.gameOver === false);
  m.tick(16);
  check('game over exactly on the expiry day', m.gameOver === true);
  check('reason is "expired"', overReason === 'expired');
  check('gameOverReason mirrored on the instance', m.gameOverReason === 'expired');
  // terminal: further ticks are no-ops
  m.tick(50);
  check('gameOver stays true, no re-trigger', m.gameOver === true);
}

console.log('visas.test — grace flow (losable status)');
{
  const m = new VisaMachine(visas, 'lmia', 1); // 90 days, grace 3
  check('expiresAtDay = 1 + 90', m.expiresAtDay === 91);
  for (let d = 2; d <= 90; d++) m.tick(d);
  check('no grace yet before expiry', m.inGrace() === false && m.gameOver === false);
  m.tick(91);
  check('expiry opens a grace window instead of game over', m.gameOver === false);
  check('now in grace', m.inGrace() === true);
  check('graceUntilDay = 91 + 3', m.graceUntilDay === 94);
  check('graceDaysLeft reports the HUD countdown', m.graceDaysLeft(91) === 3 && m.graceDaysLeft(93) === 1);
  m.tick(92);
  m.tick(93);
  check('still not game over inside the grace window', m.gameOver === false);
  let overReason: string | null = null;
  m.onGameOver = (reason) => { overReason = reason; };
  m.tick(94);
  check('grace expiry -> game over', m.gameOver === true);
  check('reason is "grace_expired"', overReason === 'grace_expired');
}

console.log('visas.test — grace resolved by a fresh grant before it lapses');
{
  const m = new VisaMachine(visas, 'lmia', 1);
  for (let d = 2; d <= 91; d++) m.tick(d);
  check('in grace after expiry', m.inGrace() === true);
  m.grantVisa('temp_worker', 92); // renewed just in time
  check('status switched', m.statusId === 'temp_worker');
  check('grace cleared by the fresh grant', m.inGrace() === false);
  check('expiry reset from the grant day (92 + 365)', m.expiresAtDay === 457);
  m.tick(94); // the day the old grace would have expired
  check('no game over — grace was cleared', m.gameOver === false);
}

console.log('visas.test — job-loss grace API');
{
  const m = new VisaMachine(visas, 'lmia', 5);
  check('startGrace opens current losable visa grace immediately', m.startGrace(10) === true);
  check('job-loss grace uses the visa definition days', m.graceUntilDay === 13 && m.expiresAtDay === null);
  check('repeated startGrace does not extend the deadline', m.startGrace(11) === false && m.graceUntilDay === 13);

  const visitor = new VisaMachine(visas, 'visitor', 1);
  check('non-losable status refuses job-loss grace', visitor.startGrace(2) === false && !visitor.inGrace());
}

console.log('visas.test — pending application resolution');
{
  const m = new VisaMachine(visas, 'lmia', 1); // remains valid through the day-35 resolution
  const applied = m.apply('permanent_resident', 5); // requirements are the CALLER's job to check first
  check('apply() succeeds for an application-type status', applied === true);
  check('pending set with the right resolve day (5 + 30)', m.pending?.resolvesAtDay === 35);
  check('statusId unchanged while pending', m.statusId === 'lmia');
  m.tick(10);
  check('still pending, not yet resolve day', m.pending !== null && m.statusId === 'lmia');
  m.tick(35);
  check('resolved: status switched to the applied-for one', m.statusId === 'permanent_resident');
  check('pending cleared', m.pending === null);
  check('permanent_resident has no expiry', m.expiresAtDay === null);
}

console.log('visas.test — pending application cannot rescue an expired current status');
{
  const m = new VisaMachine(visas, 'visitor', 1); // expires day 16; PR would resolve day 31
  check('application starts while visitor status is valid', m.apply('permanent_resident', 1) === true);
  for (let d = 2; d <= 16; d++) m.tick(d);
  check('current status expiry wins before pending resolution', m.gameOver === true && m.statusId === 'visitor');
  m.tick(31);
  check('pending application never resolves after terminal game over', m.statusId === 'visitor');
}

console.log('visas.test — apply() edge cases');
{
  const m = new VisaMachine(visas, 'visitor', 1);
  check('apply() rejects a non-application status', m.apply('lmia', 1) === false);
  check('apply() rejects an unknown id', m.apply('nonexistent', 1) === false);
  const ok = m.apply('permanent_resident', 1);
  check('first apply succeeds', ok === true);
  check('a second apply while one is pending is rejected', m.apply('citizen', 2) === false);
}

console.log('visas.test — grantVisa resets expiry from the grant day');
{
  const m = new VisaMachine(visas, 'visitor', 1);
  m.tick(10); // partway through the visitor clock
  let changedTo: string | null = null;
  m.onStatusChanged = (def) => { changedTo = def.id; };
  m.grantVisa('lmia', 20);
  check('statusId switched', m.statusId === 'lmia');
  check('onStatusChanged fired with the new def', changedTo === 'lmia');
  check('expiresAtDay recomputed from the grant day (20 + 90)', m.expiresAtDay === 110);
}

console.log('visas.test — permanent statuses never expire');
{
  const m = new VisaMachine(visas, 'citizen', 1);
  check('citizen has no expiry from the start', m.expiresAtDay === null);
  check('daysLeft is null (permanent)', m.daysLeft(1) === null);
  for (let d = 2; d <= 10000; d += 137) m.tick(d);
  check('never goes game over across 10000 in-game days', m.gameOver === false);

  const m2 = new VisaMachine(visas, 'visitor', 1);
  m2.grantVisa('permanent_resident', 5);
  for (let d = 6; d <= 10000; d += 211) m2.tick(d);
  check('a granted permanent status also never expires', m2.gameOver === false);
}

console.log('visas.test — grantVisa unknown id is a safe no-op');
{
  const m = new VisaMachine(visas, 'visitor', 1);
  let fired = false;
  m.onStatusChanged = () => { fired = true; };
  m.grantVisa('not_a_real_visa', 5);
  check('statusId unchanged', m.statusId === 'visitor');
  check('onStatusChanged did not fire', fired === false);
}

console.log('visas.test — grantVisa/apply/tick no-op once game over (terminal in V1)');
{
  const m = new VisaMachine(visas, 'visitor', 1);
  for (let d = 2; d <= 16; d++) m.tick(d);
  check('game over reached', m.gameOver === true);
  m.grantVisa('citizen', 20);
  check('grantVisa after game over is a no-op', m.statusId === 'visitor');
  check('apply() after game over is rejected', m.apply('permanent_resident', 20) === false);
}

console.log('visas.test — retune adopts new definitions, keeps runtime state');
{
  const m = new VisaMachine(visas, 'visitor', 1);
  m.tick(10);
  const retuned: VisasData = {
    visas: [
      { id: 'visitor', name: 'Visitor (renamed)', durationDays: 20, losable: false }, // duration changed, doesn't retroactively move expiresAtDay
      ...visas.visas.slice(1),
    ],
  };
  m.retune(retuned);
  check('statusId/expiresAtDay preserved across retune', m.statusId === 'visitor' && m.expiresAtDay === 16);
  check('new definition data is adopted (name)', m.currentDef()?.name === 'Visitor (renamed)');
  m.grantVisa('lmia', 12); // a subsequent grant uses the NEW durationDays for lmia (unchanged here) to prove defs are live
  check('post-retune grants still work', m.statusId === 'lmia');
}

console.log('visas.test — serialize/restore round trip');
{
  const m = new VisaMachine(visas, 'lmia', 1);
  for (let d = 2; d <= 91; d++) m.tick(d); // now in grace
  const saved = m.serialize();
  check('serialize captures grace state', saved.graceUntilDay === 94 && saved.expiresAtDay === null);

  const m2 = new VisaMachine(visas, 'visitor', 1); // different starting state
  m2.restore(saved);
  check('restore reproduces statusId', m2.statusId === 'lmia');
  check('restore reproduces grace window', m2.inGrace() === true && m2.graceUntilDay === 94);
  m2.tick(94);
  check('restored state continues ticking correctly (grace expires -> game over)', m2.gameOver === true);
}

if (failures > 0) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
console.log('\nAll visas.test checks passed.');
