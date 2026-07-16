// work.test.ts — headless coverage for game/work.ts. Run: npx tsx test/work.test.ts

import type { JobDef, VisaDef } from '../game/data';
import {
  WorkTracker,
  absoluteGameHour,
  applyNeedsCost,
  decideWorkReturn,
  isLeaveForWorkAvailable,
  isWithinWorkHours,
  shouldStartVisaGrace,
  workWindowContaining,
} from '../game/work';

let failures = 0;
function check(name: string, condition: boolean, detail = '') {
  if (condition) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name} ${detail}`); }
}

const dayJob: JobDef = {
  id: 'day', name: 'Day job', grantsVisa: 'lmia',
  hours: { startHour: 9, endHour: 17 }, payPerShift: 120, maxSkips: 1,
  needsCost: { energy: 35, hunger: 20 },
};
const nightJob: JobDef = {
  id: 'night', name: 'Night job',
  hours: { startHour: 22, endHour: 6 }, payPerShift: 180, maxSkips: 2,
};
const returnPoint = { pos: [0, 2] as [number, number], facingDeg: 90 };

console.log('work.test — availability inside/outside ordinary hours');
{
  check('start hour is available', isWithinWorkHours({ day: 1, hour: 9 }, dayJob.hours));
  check('middle of shift is available', isWithinWorkHours({ day: 1, hour: 12.5 }, dayJob.hours));
  check('end hour is excluded', !isWithinWorkHours({ day: 1, hour: 17 }, dayJob.hours));
  check('before start is excluded', !isWithinWorkHours({ day: 1, hour: 8.99 }, dayJob.hours));
  check('unset job fails code-side availability', !isLeaveForWorkAvailable(null, [dayJob], { day: 1, hour: 10 }));
  check('unknown job fails code-side availability', !isLeaveForWorkAvailable('missing', [dayJob], { day: 1, hour: 10 }));
  check('known job in hours passes code-side availability', isLeaveForWorkAvailable('day', [dayJob], { day: 1, hour: 10 }));
}

console.log('work.test — midnight-crossing window');
{
  check('overnight start is included', isWithinWorkHours({ day: 2, hour: 22 }, nightJob.hours));
  check('late night is included', isWithinWorkHours({ day: 2, hour: 23.5 }, nightJob.hours));
  check('after midnight belongs to previous start day', isWithinWorkHours({ day: 3, hour: 2 }, nightJob.hours));
  check('overnight end is excluded', !isWithinWorkHours({ day: 3, hour: 6 }, nightJob.hours));
  check('daytime outside overnight window is excluded', !isWithinWorkHours({ day: 2, hour: 12 }, nightJob.hours));
  const window = workWindowContaining({ day: 3, hour: 2 }, nightJob.hours);
  check('containing overnight window starts previous day at 22', window?.startAbsHour === absoluteGameHour({ day: 2, hour: 22 }));
  check('containing overnight window ends current day at 6', window?.endAbsHour === absoluteGameHour({ day: 3, hour: 6 }));
}

console.log('work.test — full leave/return/pay flow and serialization');
{
  const work = new WorkTracker();
  work.syncJob(dayJob, { day: 1, hour: 8 });
  const start = work.beginShift(dayJob, { day: 1, hour: 9.5 }, returnPoint);
  check('leave succeeds inside hours', start.ok);
  check('tracker is at work after leaving', work.isAtWork);
  check('return decision stays null before endHour', decideWorkReturn(work.activeShift, { day: 1, hour: 16.99 }) === null);

  const saved = work.serialize();
  const restored = new WorkTracker();
  restored.restore(saved);
  check('serializable state restores active shift and return point', restored.isAtWork && restored.activeShift?.returnPoint.pos[1] === 2);

  const events = restored.tick(dayJob, { day: 1, hour: 17 });
  const returned = events.find((event) => event.type === 'returned');
  check('endHour emits one return', events.filter((event) => event.type === 'returned').length === 1);
  check('return carries snapshotted pay', returned?.type === 'returned' && returned.pay === 120);
  check('return carries snapshotted needs costs', returned?.type === 'returned' && returned.needsCost.energy === 35 && returned.needsCost.hunger === 20);
  check('return carries exterior-door position', returned?.type === 'returned' && returned.returnPoint.pos.join(',') === '0,2');
  check('attended window is not a skip', !events.some((event) => event.type === 'skipped'));
  check('tracker is no longer at work', !restored.isAtWork);
  check('repeated end-hour tick does not pay twice', !restored.tick(dayJob, { day: 1, hour: 17.5 }).some((event) => event.type === 'returned'));
}

console.log('work.test — work-time reminder emits once per window');
{
  const work = new WorkTracker();
  work.syncJob(dayJob, { day: 1, hour: 8 });
  check('no reminder before startHour', !work.tick(dayJob, { day: 1, hour: 8.99 }).some((event) => event.type === 'due'));
  const due = work.tick(dayJob, { day: 1, hour: 9 });
  check('startHour emits one due event with deadline', due.filter((event) => event.type === 'due').length === 1 && due.some((event) => event.type === 'due' && event.endHour === 17));
  const restored = new WorkTracker(); restored.restore(work.serialize());
  check('same saved/restored window cannot remind twice', !restored.tick(dayJob, { day: 1, hour: 12 }).some((event) => event.type === 'due'));
  restored.tick(dayJob, { day: 1, hour: 17 });
  check('next work window reminds again', restored.tick(dayJob, { day: 2, hour: 9 }).some((event) => event.type === 'due'));
}

console.log('work.test — needs-cost application decision');
{
  const after = applyNeedsCost({ energy: 50, hunger: 10, hygiene: 40 }, { energy: 35, hunger: 20, missing: 99 });
  check('known costs subtract on return', after.energy === 15);
  check('needs costs clamp at zero', after.hunger === 0);
  check('sparse and unknown costs leave other needs unchanged', after.hygiene === 40 && !('missing' in after));
  check('negative authored costs cannot increase a need', applyNeedsCost({ energy: 50 }, { energy: -10 }).energy === 50);
}

console.log('work.test — skip increments exactly once per missed window');
{
  const work = new WorkTracker();
  work.syncJob(dayJob, { day: 1, hour: 8 });
  check('no skip before the first window ends', !work.tick(dayJob, { day: 1, hour: 16.99 }).some((event) => event.type === 'skipped'));
  const first = work.tick(dayJob, { day: 1, hour: 17 });
  check('first missed end emits one skip', first.filter((event) => event.type === 'skipped').length === 1 && work.skips === 1);
  check('same ended window cannot increment again', work.tick(dayJob, { day: 1, hour: 23 }).length === 0 && work.skips === 1);
  check('next day before end cannot increment', !work.tick(dayJob, { day: 2, hour: 16 }).some((event) => event.type === 'skipped') && work.skips === 1);
  const second = work.tick(dayJob, { day: 2, hour: 17 });
  check('next missed window increments once', second.filter((event) => event.type === 'skipped').length === 1 && work.skips === 2);
  check('skips > maxSkips emits job loss', second.some((event) => event.type === 'job_lost') && work.jobId === null);
}

console.log('work.test — overnight skip and job-acquired-mid-window boundary');
{
  const overnight = new WorkTracker();
  overnight.syncJob(nightJob, { day: 4, hour: 21 });
  check('overnight shift is not missed before next-day end', !overnight.tick(nightJob, { day: 5, hour: 5.9 }).some((event) => event.type === 'skipped'));
  check('overnight shift skips once at next-day end', overnight.tick(nightJob, { day: 5, hour: 6 }).filter((e) => e.type === 'skipped').length === 1);
  check('overnight repeated tick does not double-skip', overnight.tick(nightJob, { day: 5, hour: 12 }).length === 0);

  const hiredMidShift = new WorkTracker();
  hiredMidShift.syncJob(dayJob, { day: 1, hour: 12 });
  check('hiring after start does not retroactively track an incomplete held window', hiredMidShift.tick(dayJob, { day: 1, hour: 17 }).length === 0);
  check('the next full held window is tracked', hiredMidShift.tick(dayJob, { day: 2, hour: 17 }).some((e) => e.type === 'skipped'));
}

console.log('work.test — grace trigger decision');
{
  const lmia: VisaDef = { id: 'lmia', name: 'LMIA', durationDays: 90, losable: true, graceDays: 3 };
  const visitor: VisaDef = { id: 'visitor', name: 'Visitor', durationDays: 15, losable: false };
  check('matching job-granted losable visa starts grace', shouldStartVisaGrace(dayJob, 'lmia', lmia));
  check('different current status does not start grace', !shouldStartVisaGrace(dayJob, 'visitor', visitor));
  check('matching but non-losable visa does not start grace', !shouldStartVisaGrace({ ...dayJob, grantsVisa: 'visitor' }, 'visitor', visitor));
  check('job without grantsVisa does not start grace', !shouldStartVisaGrace({ ...dayJob, grantsVisa: undefined }, 'lmia', lmia));
}

if (failures > 0) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
console.log('\nAll work.test checks passed.');
