// phone.test.ts — headless tests for game/phone.ts. Run: npx tsx test/phone.test.ts

import {
  PhoneJobSearch,
  applyForJob,
  applyForVisa,
  jobListingViews,
  pendingDaysRemaining,
  visaApplicationViews,
} from '../game/phone';
import type { EvalContext, VarValue } from '../game/quests';
import type { JobsData, VisasData } from '../game/data';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name} ${detail}`); }
}

const jobs: JobsData = {
  jobs: [
    { id: 'dishwasher', name: 'Dishwasher', grantsVisa: 'lmia', hours: { startHour: 9, endHour: 17 }, payPerShift: 100, maxSkips: 3 },
    { id: 'cook', name: 'Cook', requirements: { var: 'skills.cooking', gte: 3 }, hours: { startHour: 15, endHour: 23 }, payPerShift: 200, maxSkips: 2 },
    { id: 'tutor', name: 'Tutor', requirements: { var: 'skills.english', gte: 6 }, hours: { startHour: 10, endHour: 18 }, payPerShift: 250, maxSkips: 2 },
    { id: 'barista', name: 'Barista', hours: { startHour: 6, endHour: 14 }, payPerShift: 150, maxSkips: 3 },
  ],
};

function makeContext(overrides: Partial<EvalContext> = {}): EvalContext {
  return {
    needs: {},
    skills: { cooking: 2, english: 7 },
    funds: 1200,
    time: { hour: 8, day: 2 },
    vars: { job: null, visaStatus: 'visitor' },
    quests: {},
    ...overrides,
  };
}

console.log('phone.test — job roll cadence and subset size');
{
  let rngCalls = 0;
  const sequence = [0.1, 0.7, 0.3, 0.9, 0.2, 0.8];
  const search = new PhoneJobSearch(jobs, 3, () => sequence[(rngCalls++) % sequence.length]);
  const first = search.search({ day: 1, hour: 8 });
  const callsAfterFirst = rngCalls;
  const sameHour = search.search({ day: 1, hour: 8.99 });
  check('subset uses tuning size', first.length === 3);
  check('subset has no duplicate jobs', new Set(first.map((job) => job.id)).size === 3);
  check('same in-game hour returns identical ids', sameHour.map((job) => job.id).join(',') === first.map((job) => job.id).join(','));
  check('same in-game hour consumes no more RNG', rngCalls === callsAfterFirst);
  search.search({ day: 1, hour: 9 });
  check('next hour permits exactly one fresh roll', rngCalls > callsAfterFirst);
  const callsAfterNextHour = rngCalls;
  search.search({ day: 1, hour: 9.5 });
  check('second click in next hour does not reroll', rngCalls === callsAfterNextHour);
  search.search({ day: 2, hour: 9 });
  check('same clock hour on another day is a new roll window', rngCalls > callsAfterNextHour);

  const oversized = new PhoneJobSearch(jobs, 99, () => 0);
  check('subset size clamps to available jobs', oversized.search({ day: 1, hour: 1 }).length === jobs.jobs.length);
}

console.log('phone.test — requirement gating');
{
  const c = makeContext();
  const listings = jobListingViews(jobs.jobs, c);
  check('job without requirements is met', listings.find((x) => x.job.id === 'dishwasher')?.requirementsMet === true);
  check('cooking requirement is unmet against live context', listings.find((x) => x.job.id === 'cook')?.requirementsMet === false);
  check('english requirement is met against live context', listings.find((x) => x.job.id === 'tutor')?.requirementsMet === true);
  check('requirement display carries met/unmet state', listings.find((x) => x.job.id === 'cook')?.requirements[0]?.met === false);
}

console.log('phone.test — job apply effects');
{
  const c = makeContext();
  const vars: Record<string, VarValue> = { ...c.vars };
  const grants: { id: string; day: number }[] = [];
  const denied = applyForJob('cook', jobs, c, vars, (id, day) => grants.push({ id, day }));
  check('unmet job application is rejected', denied.ok === false && denied.reason === 'requirements_unmet');
  check('rejected job does not mutate vars.job', vars.job === null);

  const accepted = applyForJob('dishwasher', jobs, c, vars, (id, day) => grants.push({ id, day }));
  check('met job application succeeds', accepted.ok === true);
  check('successful job application sets vars.job', vars.job === 'dishwasher');
  check('grantsVisa goes through injected visa callback with live day', grants.length === 1 && grants[0].id === 'lmia' && grants[0].day === 2);
}

const visas: VisasData = {
  visas: [
    { id: 'visitor', name: 'Visitor', durationDays: 15 },
    { id: 'lmia', name: 'LMIA', durationDays: 90, obtainedVia: 'quest' },
    { id: 'pr', name: 'Permanent Resident', durationDays: null, obtainedVia: 'application', applicationDays: 30, requirements: { var: 'skills.english', gte: 8 } },
    { id: 'open_permit', name: 'Open Permit', durationDays: 180, obtainedVia: 'application', applicationDays: 7, requirements: { var: 'skills.english', gte: 5 } },
  ],
};

console.log('phone.test — visa application listing and gating');
{
  const c = makeContext();
  const list = visaApplicationViews(visas, c);
  check('only obtainedVia application statuses are listed', list.map((x) => x.visa.id).join(',') === 'pr,open_permit');
  check('unmet application requirement is marked unmet', list.find((x) => x.visa.id === 'pr')?.requirementsMet === false);
  check('met application requirement is marked met', list.find((x) => x.visa.id === 'open_permit')?.requirementsMet === true);

  let applied: { id: string; day: number } | null = null;
  const denied = applyForVisa('pr', visas, c, (id, day) => { applied = { id, day }; return true; });
  check('visa application is denied before machine call when requirements are unmet', denied.ok === false && applied === null);
  const accepted = applyForVisa('open_permit', visas, c, (id, day) => { applied = { id, day }; return true; });
  check('eligible visa application calls pending-flow seam', accepted.ok === true && applied?.id === 'open_permit' && applied.day === 2);
  const rejected = applyForVisa('open_permit', visas, c, () => false);
  check('visa machine rejection is surfaced', rejected.ok === false && rejected.reason === 'application_rejected');
  check('pending days remaining is day based', pendingDaysRemaining({ resolvesAtDay: 12 }, 5) === 7);
}

if (failures > 0) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
console.log('\nAll phone.test checks passed.');
