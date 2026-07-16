// promotion.test.ts — headless B6-5 job-level/promotion coverage. Run: npx tsx test/promotion.test.ts
import type { JobDef } from '../game/data';
import { WorkTracker, jobLevelPay, jobLevelTitle, promotionChancePercent, rollForPromotion } from '../game/work';

let failures = 0;
function check(name: string, condition: boolean) {
  if (condition) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name}`); }
}
const job: JobDef = {
  id: 'dishwasher', name: 'Dishwasher', hours: { startHour: 9, endHour: 17 }, payPerShift: 100, maxSkips: 2,
  levels: [
    { suffix: 'I', payPerShift: 100, promoteChancePercent: 40 },
    { suffix: 'II', payPerShift: 140, promoteChancePercent: 20 },
    { suffix: 'III', payPerShift: 200, promoteChancePercent: 0 },
  ],
};

console.log('promotion.test — pure formula, pay and persistence');
check('level zero is the authored base title', jobLevelTitle(job, 0) === 'Dishwasher I');
check('current level selects authored pay', jobLevelPay(job, 1) === 140);
check('chance scales by happiness and tuning factor', promotionChancePercent(job, 0, 50, 1.5) === 30);
check('zero happiness prevents promotion', !rollForPromotion(job, 0, 0, 1, () => 0).promoted);
const promoted = rollForPromotion(job, 0, 100, 1, () => 0.39);
check('roll below exact chance promotes one level', promoted.promoted && promoted.toLevel === 1);
check('promotion reports title and pay increase', promoted.title === 'Dishwasher II' && promoted.payIncrease === 40);
check('last level never promotes', !rollForPromotion(job, 2, 100, 99, () => 0).promoted);

const tracker = new WorkTracker();
tracker.rollPromotion(job, 100, 1, () => 0);
const restored = new WorkTracker(); restored.restore(tracker.serialize());
check('per-job level serializes and restores', restored.getJobLevel(job.id) === 1);
const shift = restored.beginShift(job, { day: 1, hour: 10 }, { pos: [0, 0], facingDeg: 0 });
check('next shift snapshots promoted level pay', shift.ok && shift.shift.payPerShift === 140 && shift.shift.levelIndex === 1);

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nAll promotion.test checks passed.');
