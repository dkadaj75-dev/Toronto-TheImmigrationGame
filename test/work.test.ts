// work.test.ts — headless coverage for game/work.ts. Run: npx tsx test/work.test.ts

import type { JobDef, VisaDef } from '../game/data';
import {
  WorkTracker,
  absoluteGameHour,
  applyNeedsCost,
  decideAutoDepart,
  decideWorkReturn,
  departureWindowCloseOffset,
  isScheduledWorkWindow,
  isWorkDay,
  isLeaveForWorkAvailable,
  isWithinDepartureWindow,
  isWithinWorkHours,
  promotionRequirementsFor,
  rollForPromotion,
  shouldStartVisaGrace,
  weekdayIndex,
  weekdayName,
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

console.log('work.test — B7-5 departure-window math');
{
  check('ordinary window includes start', isWithinDepartureWindow({ day: 1, hour: 9 }, dayJob.hours, 2));
  check('ordinary window includes time before deadline', isWithinDepartureWindow({ day: 1, hour: 10.999 }, dayJob.hours, 2));
  check('ordinary deadline is excluded', !isWithinDepartureWindow({ day: 1, hour: 11 }, dayJob.hours, 2));
  check('manual leave is hidden after departure deadline', !isLeaveForWorkAvailable('day', [dayJob], { day: 1, hour: 12 }, 2));
  check('beginShift rejects arrival at the deadline', !new WorkTracker().beginShift(dayJob, { day: 1, hour: 11 }, returnPoint, 2).ok);
  check('window length clamps to shift duration', departureWindowCloseOffset(dayJob.hours, 99) === 8);
  check('negative window closes immediately', departureWindowCloseOffset(dayJob.hours, -1) === 0);
  check('overnight window includes pre-midnight start', isWithinDepartureWindow({ day: 2, hour: 23.5 }, nightJob.hours, 2));
  check('overnight deadline at midnight is excluded', !isWithinDepartureWindow({ day: 3, hour: 0 }, nightJob.hours, 2));
  check('overnight next-day time past deadline stays excluded', !isWithinDepartureWindow({ day: 3, hour: 1 }, nightJob.hours, 2));
}

console.log('work.test — B7-6 autonomous-departure decision');
{
  const eligible = { withinDepartureWindow: true, happiness: 40, energy: 25, happinessMin: 40, energyMin: 25 };
  check('inclusive happiness and energy thresholds depart', decideAutoDepart(eligible));
  check('low happiness stays home', !decideAutoDepart({ ...eligible, happiness: 39.99 }));
  check('low energy stays home', !decideAutoDepart({ ...eligible, energy: 24.99 }));
  check('closed departure window always stays home', !decideAutoDepart({ ...eligible, withinDepartureWindow: false }));
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

console.log('work.test — B7-5 miss registers at departure-window close');
{
  const work = new WorkTracker();
  work.syncJob(dayJob, { day: 1, hour: 8 });
  const due = work.tick(dayJob, { day: 1, hour: 9 }, 2);
  check('reminder carries departure deadline', due.some((event) => event.type === 'due' && event.departByHour === 11));
  check('no skip before departure deadline', !work.tick(dayJob, { day: 1, hour: 10.999 }, 2).some((event) => event.type === 'skipped'));
  check('skip emits at departure deadline', work.tick(dayJob, { day: 1, hour: 11 }, 2).filter((event) => event.type === 'skipped').length === 1 && work.skips === 1);
  check('same closed departure window cannot double-skip', work.tick(dayJob, { day: 1, hour: 17 }, 2).length === 0 && work.skips === 1);

  const overnight = new WorkTracker();
  overnight.syncJob(nightJob, { day: 4, hour: 21 });
  check('overnight reminder deadline normalizes to midnight', overnight.tick(nightJob, { day: 4, hour: 22 }, 2).some((event) => event.type === 'due' && event.departByHour === 0));
  check('overnight miss registers at next-day midnight', overnight.tick(nightJob, { day: 5, hour: 0 }, 2).filter((event) => event.type === 'skipped').length === 1);
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

console.log('work.test - B13-11 weekday derivation and sparse schedules');
{
  const calendar = { dayNames: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], startDayIndex: 0 };
  check('game day 1 uses startDayIndex', weekdayIndex({ day: 1, hour: 0 }, calendar) === 0 && weekdayName({ day: 1, hour: 12 }, calendar) === 'Mon');
  check('weekday rolls over with absolute game day', weekdayName({ day: 2, hour: 0 }, calendar) === 'Tue' && weekdayName({ day: 8, hour: 0 }, calendar) === 'Mon');
  check('startDayIndex offsets the opening weekday', weekdayName({ day: 1, hour: 0 }, { ...calendar, startDayIndex: 2 }) === 'Wed');
  check('absent workDays remains daily', isWorkDay(dayJob, 6, calendar));
  const scheduled = { ...dayJob, workDays: [0, 'Wed'] };
  check('numeric and named sparse days resolve', isWorkDay(scheduled, 0, calendar) && isWorkDay(scheduled, 2, calendar));
  check('sparse schedule excludes other days', !isWorkDay(scheduled, 1, calendar));
  check('empty schedule means no work days', !isWorkDay({ ...dayJob, workDays: [] }, 0, calendar));
}

console.log('work.test - B13-11 scheduled attendance pipeline');
{
  const calendar = { dayNames: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], startDayIndex: 0 };
  const scheduled: JobDef = { ...dayJob, workDays: [0, 2] };
  check('manual shift is unavailable on an off-day', !isLeaveForWorkAvailable('day', [scheduled], { day: 2, hour: 9.5 }, 2, calendar));
  check('beginShift rejects an off-day', !new WorkTracker().beginShift(scheduled, { day: 2, hour: 9.5 }, returnPoint, 2, calendar).ok);
  check('scheduled window helper feeds auto-depart false on off-days', !decideAutoDepart({
    withinDepartureWindow: isScheduledWorkWindow(scheduled, { day: 2, hour: 9.5 }, calendar)
      && isWithinDepartureWindow({ day: 2, hour: 9.5 }, scheduled.hours, 2),
    happiness: 100, energy: 100, happinessMin: 40, energyMin: 25,
  }));
  const work = new WorkTracker();
  work.syncJob(scheduled, { day: 1, hour: 8 }, calendar);
  work.tick(scheduled, { day: 1, hour: 11 }, 2, calendar);
  check('scheduled missed shift applies its penalty', work.skips === 1);
  check('off-day applies no missed-shift penalty', work.tick(scheduled, { day: 2, hour: 23 }, 2, calendar).length === 0 && work.skips === 1);
  check('next scheduled day still triggers', work.tick(scheduled, { day: 3, hour: 9 }, 2, calendar).some((event) => event.type === 'due'));
}

// --- H4 (ROADMAP_HAPPY): unhappy-streak firing (recordShiftMood)
{
  const moodJob: JobDef = { ...dayJob, id: 'mood', firing: { minHappiness: 40, maxUnhappyShifts: 2 } };
  const work = new WorkTracker();
  work.syncJob(moodJob, { day: 1, hour: 8 });
  check('happy shift emits nothing and keeps streak 0', work.recordShiftMood(moodJob, 80).length === 0);
  const w1 = work.recordShiftMood(moodJob, 10);
  check('first unhappy shift warns with streak 1', w1.length === 1 && w1[0].type === 'unhappy_shift' && (w1[0] as { streak: number }).streak === 1);
  check('a happy shift resets the streak', work.recordShiftMood(moodJob, 60).length === 0
    && (work.recordShiftMood(moodJob, 0)[0] as { streak: number }).streak === 1);
  work.recordShiftMood(moodJob, 0); // streak 2
  const fired = work.recordShiftMood(moodJob, 0); // streak 3 > max 2
  check('exceeding maxUnhappyShifts fires and clears the job', fired[0]?.type === 'fired' && work.jobId === null);
  const work2 = new WorkTracker();
  work2.syncJob(moodJob, { day: 1, hour: 8 });
  work2.recordShiftMood(moodJob, 0);
  const saved = work2.serialize();
  check('unhappyStreak serializes', saved.unhappyStreak === 1);
  const restored2 = new WorkTracker();
  restored2.restore({ ...saved, unhappyStreak: undefined }); // pre-batch-15 save shape
  check('sparse old save restores streak 0 and still warns before firing',
    restored2.recordShiftMood(moodJob, 0)[0]?.type === 'unhappy_shift');
  const noFire = new WorkTracker();
  noFire.syncJob(dayJob, { day: 1, hour: 8 });
  check('job without firing config never warns or fires', noFire.recordShiftMood(dayJob, 0).length === 0);
  const warnOnly = { ...dayJob, id: 'warn', firing: { minHappiness: 40 } };
  const wo = new WorkTracker();
  wo.syncJob(warnOnly, { day: 1, hour: 8 });
  for (let i = 0; i < 5; i++) check(`warn-only job never fires (${i})`, wo.recordShiftMood(warnOnly, 0)[0]?.type === 'unhappy_shift');
}

// --- B13-19: promotion requirements gate
{
  const ladder: JobDef = { ...dayJob, id: 'ladder', levels: [
    { suffix: 'I', payPerShift: 100, promoteChancePercent: 100 },
    { suffix: 'II', payPerShift: 150, promoteChancePercent: 0, requirements: { all: [{ var: 'skills.cooking', gte: 5 }] } },
  ] };
  check('requirements surface for the NEXT level', JSON.stringify(promotionRequirementsFor(ladder, 0)) === JSON.stringify({ all: [{ var: 'skills.cooking', gte: 5 }] }));
  check('ladder end has no requirements', promotionRequirementsFor(ladder, 1) === undefined);
  const met = rollForPromotion(ladder, 0, 100, 1, () => 0, true);
  const unmet = rollForPromotion(ladder, 0, 100, 1, () => 0, false);
  check('met requirements promote at 100%', met.promoted === true);
  check('unmet requirements zero the roll', unmet.promoted === false && unmet.chancePercent === 0);
  check('default (no requirements arg) keeps old behavior', rollForPromotion(ladder, 0, 100, 1, () => 0).promoted === true);
}

if (failures > 0) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
console.log('\nAll work.test checks passed.');
