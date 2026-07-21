// quests.test.ts — headless tests for the quest condition evaluator + QuestRunner lifecycle.
// Run: npx tsx test/quests.test.ts

import { evaluate, QuestRunner, type EvalContext } from '../game/quests';
import { applyForJob } from '../game/phone';
import { actionCost, canAffordActionCost } from '../game/actioncost';
import type { Condition, JobsData, QuestDef, QuestsData, SimStateData } from '../game/data';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name} ${detail}`); }
}

function ctx(overrides: Partial<EvalContext> = {}): EvalContext {
  return {
    needs: { hunger: 80, energy: 40 },
    skills: { english: 5, cooking: 0 },
    personality: { cleanliness: 4 },
    funds: 300,
    creditScore: 650,
    time: { hour: 14, day: 3 },
    vars: { visaStatus: 'tourist', job: null, income: 0 },
    quests: { first_words: 'active', done_quest: 'done' },
    ...overrides,
  };
}

console.log('quests.test — operators');
{
  const c = ctx();
  check('gte true', evaluate({ var: 'needs.hunger', gte: 80 }, c) === true);
  check('gte false', evaluate({ var: 'needs.hunger', gte: 81 }, c) === false);
  check('lte true', evaluate({ var: 'needs.energy', lte: 40 }, c) === true);
  check('lte false', evaluate({ var: 'needs.energy', lte: 39 }, c) === false);
  check('eq string true', evaluate({ var: 'vars.visaStatus', eq: 'tourist' }, c) === true);
  check('eq string false', evaluate({ var: 'vars.visaStatus', eq: 'student' }, c) === false);
  check('eq null true (vars.job is null)', evaluate({ var: 'vars.job', eq: null }, c) === true);
  check('neq true', evaluate({ var: 'vars.visaStatus', neq: 'student' }, c) === true);
  check('neq false', evaluate({ var: 'vars.visaStatus', neq: 'tourist' }, c) === false);
  check('personality namespace resolves like needs/skills', evaluate({ var: 'personality.cleanliness', gte: 4 }, c) === true);
  // ROADMAP_NEXT B2-1: leave_for_work ships `{ all: [{ var: "vars.job", neq: null }] }`. job's
  // simstate.json default is null, and QuestRunner seeds `vars.job = null` (an actual present key,
  // not an absent one) — so resolveVar returns `null`, not `undefined`, and the `value === undefined`
  // early-return in evaluateLeaf does NOT fire; the neq comparison runs for real: null !== null is
  // false, matching the intended "unavailable until a job exists" semantics. Once a job system sets
  // vars.job to a real string, the same leaf flips true. No evaluator change was needed — this just
  // pins the behavior down as a regression test.
  check('neq null vs null (job unset) — condition UNMET', evaluate({ var: 'vars.job', neq: null }, c) === false);
  check('neq null vs a real job — condition MET', evaluate({ var: 'vars.job', neq: null }, ctx({ vars: { ...c.vars, job: 'chef' } })) === true);

  // BUG 1 (2026-07-17): the Quest/condition builder only offers true/false for a var declared
  // `type: boolean` in simstate.json (e.g. `job`), so a designer's "has a job" completion is
  // authored as `{ var: 'vars.job', eq: true }`. But the runtime stores the employer id STRING in
  // vars.job (null when jobless — the work system depends on that id). A boolean eq/neq literal is
  // therefore a TRUTHINESS test, not a strict === against a raw boolean, so these must hold:
  const withJob = ctx({ vars: { ...c.vars, job: 'chef' } });
  check('eq true vs a real job id — MET (BUG 1 core)', evaluate({ var: 'vars.job', eq: true }, withJob) === true);
  check('eq true vs null (jobless) — UNMET', evaluate({ var: 'vars.job', eq: true }, c) === false);
  check('eq false vs null (jobless) — MET', evaluate({ var: 'vars.job', eq: false }, c) === true);
  check('eq false vs a real job id — UNMET', evaluate({ var: 'vars.job', eq: false }, withJob) === false);
  check('neq true vs null (jobless) — MET', evaluate({ var: 'vars.job', neq: true }, c) === true);
  check('neq true vs a real job id — UNMET', evaluate({ var: 'vars.job', neq: true }, withJob) === false);
  // Genuine boolean values are unchanged by the coercion (Boolean(x) === x for real booleans).
  check('eq true vs actual boolean true still MET', evaluate({ var: 'vars.flag', eq: true }, ctx({ vars: { ...c.vars, flag: true } })) === true);
  check('eq true vs actual boolean false still UNMET', evaluate({ var: 'vars.flag', eq: true }, ctx({ vars: { ...c.vars, flag: false } })) === false);
  // A boolean literal against an unknown var is still UNMET (undefined early-returns before coercion).
  check('eq true vs unknown var — UNMET', evaluate({ var: 'vars.nope', eq: true }, c) === false);
}

console.log('quests.test — namespaces');
{
  const c = ctx();
  check('needs.<id>', evaluate({ var: 'needs.hunger', gte: 50 }, c));
  check('skills.<id>', evaluate({ var: 'skills.english', gte: 5 }, c));
  check('funds', evaluate({ var: 'funds', gte: 300 }, c));
  check('creditScore', evaluate({ var: 'creditScore', gte: 650 }, c));
  check('job.level resolves the current authored career level', evaluate({ var: 'job.level', gte: 7 }, ctx({ job: { level: 7 } })));
  check('job.level is false while jobless/absent', evaluate({ var: 'job.level', gte: 1 }, c) === false);
  check('time.hour', evaluate({ var: 'time.hour', eq: 14 }, c));
  check('time.day', evaluate({ var: 'time.day', eq: 3 }, c));
  check('vars.<name>', evaluate({ var: 'vars.income', eq: 0 }, c));
  check('quests.<id>.state active', evaluate({ var: 'quests.first_words.state', eq: 'active' }, c));
  check('quests.<id>.state done', evaluate({ var: 'quests.done_quest.state', eq: 'done' }, c));
}

console.log('quests.test — combinators (all/any), nested');
{
  const c = ctx();
  const allTrue: Condition = { all: [{ var: 'funds', gte: 100 }, { var: 'needs.hunger', gte: 50 }] };
  check('all: both true → true', evaluate(allTrue, c));
  const allFalse: Condition = { all: [{ var: 'funds', gte: 100 }, { var: 'needs.hunger', gte: 999 }] };
  check('all: one false → false', !evaluate(allFalse, c));
  const anyTrue: Condition = { any: [{ var: 'funds', gte: 99999 }, { var: 'needs.hunger', gte: 50 }] };
  check('any: one true → true', evaluate(anyTrue, c));
  const anyFalse: Condition = { any: [{ var: 'funds', gte: 99999 }, { var: 'needs.hunger', gte: 999 }] };
  check('any: none true → false', !evaluate(anyFalse, c));
  const nested: Condition = { all: [{ any: [{ var: 'funds', gte: 99999 }, { var: 'skills.english', gte: 1 }] }, { var: 'time.hour', gte: 10 }] };
  check('nested any-inside-all', evaluate(nested, c));
  check('empty all() is vacuously true', evaluate({ all: [] }, c) === true);
  check('empty any() is false', evaluate({ any: [] }, c) === false);
}

console.log('quests.test — unknown-id / malformed-leaf semantics (never throw, always false)');
{
  const c = ctx();
  check('unknown need id → false', evaluate({ var: 'needs.thirst', gte: 0 }, c) === false);
  check('unknown skill id → false', evaluate({ var: 'skills.magic', gte: 0 }, c) === false);
  check('unknown var name → false', evaluate({ var: 'vars.nonexistent', eq: undefined as unknown as string }, c) === false);
  check('unknown quest id → false', evaluate({ var: 'quests.nope.state', eq: 'locked' }, c) === false);
  check('unrecognized namespace → false', evaluate({ var: 'bogus.path', gte: 0 }, c) === false);
  check('leaf with no operator → false', evaluate({ var: 'funds' }, c) === false);
  // gte/lte against a non-numeric resolved value (e.g. comparing a string var numerically) → false, not a crash
  check('gte against a string value → false', evaluate({ var: 'vars.visaStatus', gte: 0 }, c) === false);
}

// ---- QuestRunner lifecycle ----------------------------------------------------------------------

function makeQuest(overrides: Partial<QuestDef> = {}): QuestDef {
  return {
    id: 'q1', name: 'Q1', description: 'test quest',
    trigger: { all: [{ var: 'skills.english', gte: 1 }] },
    completion: { all: [{ var: 'skills.english', gte: 10 }, { var: 'funds', gte: 500 }] },
    rewards: [{ type: 'funds', amount: 200 }, { type: 'setVar', var: 'visaStatus', value: 'student' }],
    onceOnly: true,
    ...overrides,
  };
}

const simState: SimStateData = {
  variables: [
    { id: 'visaStatus', name: 'Visa Status', type: 'string', default: 'tourist' },
    { id: 'job', name: 'Job', type: 'string', default: null },
    { id: 'income', name: 'Income', type: 'number', default: 0 },
  ],
};

console.log('quests.test — runner: locked → active → done, onceOnly, rewards');
{
  const quests: QuestsData = { quests: [makeQuest()] };
  const runner = new QuestRunner(quests, simState, 300);
  let started = 0, completed = 0;
  runner.onQuestStarted = () => started++;
  runner.onQuestCompleted = () => completed++;

  check('starts locked', runner.quests['q1'] === 'locked');
  check('funds seeded from startingFunds', runner.funds === 300);
  check('vars seeded from simstate defaults', runner.vars['visaStatus'] === 'tourist' && runner.vars['job'] === null && runner.vars['income'] === 0);

  // english too low to trigger yet
  runner.tick({}, { english: 0 }, { hour: 9, day: 1 });
  check('does not trigger below threshold', runner.quests['q1'] === 'locked');
  check('onQuestStarted not fired yet', started === 0);

  // triggers now
  runner.tick({}, { english: 2 }, { hour: 9, day: 1 });
  check('triggers → active', runner.quests['q1'] === 'active');
  check('onQuestStarted fired once', started === 1);

  // active but completion not met (funds 300 < 500)
  runner.tick({}, { english: 12 }, { hour: 9, day: 1 });
  check('not complete: funds still short', runner.quests['q1'] === 'active');
  check('funds unchanged before completion', runner.funds === 300);

  // bump funds externally (simulating player earning money elsewhere) then re-tick
  runner.funds = 500;
  runner.tick({}, { english: 12 }, { hour: 9, day: 1 });
  check('completes → done', runner.quests['q1'] === 'done');
  check('onQuestCompleted fired once', completed === 1);
  check('funds reward applied (500 + 200)', runner.funds === 700);
  check('setVar reward applied', runner.vars['visaStatus'] === 'student');
  check('completedLog recorded', runner.completedLog.length === 1 && runner.completedLog[0] === 'q1');

  // onceOnly: further ticks with conditions still (trivially) true never re-trigger
  const startedBefore = started, completedBefore = completed;
  runner.tick({}, { english: 12 }, { hour: 9, day: 1 });
  runner.tick({}, { english: 12 }, { hour: 9, day: 1 });
  check('onceOnly quest stays done and never re-fires', runner.quests['q1'] === 'done' && started === startedBefore && completed === completedBefore);
}

console.log('quests.test — runner: repeatable quest (onceOnly:false) resets to locked and can re-trigger');
{
  const repeatable = makeQuest({
    id: 'repeat1', onceOnly: false,
    trigger: { all: [{ var: 'needs.hunger', lte: 30 }] },
    completion: { all: [{ var: 'needs.hunger', gte: 90 }] },
    rewards: [{ type: 'funds', amount: 10 }],
  });
  const runner = new QuestRunner({ quests: [repeatable] }, simState, 0);
  runner.tick({ hunger: 20 }, {}, { hour: 0, day: 1 }); // triggers
  check('round 1: triggers', runner.quests['repeat1'] === 'active');
  runner.tick({ hunger: 95 }, {}, { hour: 0, day: 1 }); // completes
  check('round 1: completes and resets to locked (repeatable)', runner.quests['repeat1'] === 'locked');
  check('round 1: funds reward applied', runner.funds === 10);

  // conditions swing low again → should be able to trigger a second time
  runner.tick({ hunger: 25 }, {}, { hour: 0, day: 1 });
  check('round 2: triggers again', runner.quests['repeat1'] === 'active');
  runner.tick({ hunger: 95 }, {}, { hour: 0, day: 1 });
  check('round 2: completes again', runner.quests['repeat1'] === 'locked' && runner.funds === 20);
  check('completedLog has two entries for the repeatable quest', runner.completedLog.filter((id) => id === 'repeat1').length === 2);
}

console.log('quests.test — runner: unlockAsset reward');
{
  const q = makeQuest({
    id: 'unlockq', trigger: { all: [] }, completion: { all: [] },
    rewards: [{ type: 'unlockAsset', asset: 'sofa' }],
  });
  const runner = new QuestRunner({ quests: [q] }, simState, 0);
  runner.tick({}, {}, { hour: 0, day: 1 }); // trigger: vacuous all([]) → true
  runner.tick({}, {}, { hour: 0, day: 1 }); // complete: vacuous all([]) → true
  check('unlockAsset reward recorded', runner.isAssetUnlocked('sofa') === true);
  check('other assets remain locked', runner.isAssetUnlocked('bed') === false);
}

console.log('quests.test — runner: grantVisa reward (ROADMAP_NEXT B3-6) fires onGrantVisa, no built-in bookkeeping here');
{
  const q = makeQuest({
    id: 'grantq', trigger: { all: [] }, completion: { all: [] },
    rewards: [{ type: 'grantVisa', statusId: 'permanent_resident' }],
  });
  const runner = new QuestRunner({ quests: [q] }, simState, 0);
  const granted: string[] = [];
  runner.onGrantVisa = (statusId) => granted.push(statusId);
  runner.tick({}, {}, { hour: 0, day: 1 }); // trigger
  runner.tick({}, {}, { hour: 0, day: 1 }); // complete → applies the reward
  check('onGrantVisa fired with the reward statusId', granted.length === 1 && granted[0] === 'permanent_resident');
  check('QuestRunner itself does not mutate vars.visaStatus (that is main.ts wiring visas.onStatusChanged)', runner.vars['visaStatus'] === 'tourist');
}
console.log('quests.test — runner: grantVisa reward is a safe no-op when onGrantVisa is unset');
{
  const q = makeQuest({
    id: 'grantq2', trigger: { all: [] }, completion: { all: [] },
    rewards: [{ type: 'grantVisa', statusId: 'citizen' }],
  });
  const runner = new QuestRunner({ quests: [q] }, simState, 0);
  runner.tick({}, {}, { hour: 0, day: 1 });
  runner.tick({}, {}, { hour: 0, day: 1 });
  check('completes without throwing even with no onGrantVisa callback wired', runner.quests['grantq2'] === 'done');
}

console.log('quests.test — retune (hot-reload) preserves runtime state, adds new defs at defaults');
{
  const runner = new QuestRunner({ quests: [makeQuest()] }, simState, 300);
  runner.tick({}, { english: 2 }, { hour: 9, day: 1 }); // → active
  check('pre-retune: active', runner.quests['q1'] === 'active');
  runner.vars['income'] = 999; // designer-independent runtime change

  // hot-reload: quest description edited (definition change) + a brand-new quest + a brand-new variable
  const editedQuests: QuestsData = { quests: [makeQuest({ description: 'edited copy' }), makeQuest({ id: 'q2' })] };
  const editedSimState: SimStateData = { variables: [...simState.variables, { id: 'newVar', name: 'New Var', type: 'number', default: 42 }] };
  runner.retune(editedQuests, editedSimState);

  check('existing quest state survives definition hot-reload', runner.quests['q1'] === 'active');
  check('existing variable value survives hot-reload', runner.vars['income'] === 999);
  check('new quest added at locked', runner.quests['q2'] === 'locked');
  check('new variable added at its default', runner.vars['newVar'] === 42);
}

console.log('quests.test — serialize/restore round-trip (shape for a future save system)');
{
  const runner = new QuestRunner({ quests: [makeQuest()] }, simState, 300);
  runner.tick({}, { english: 2 }, { hour: 9, day: 1 });
  const saved = runner.serialize();
  const runner2 = new QuestRunner({ quests: [makeQuest()] }, simState, 0);
  runner2.restore(saved);
  check('restore reproduces quest state', runner2.quests['q1'] === 'active');
  check('restore reproduces funds', runner2.funds === 300);
  check('restore reproduces vars', runner2.vars['visaStatus'] === 'tourist');
}

console.log('quests.test — BUG 1: job acquisition completes a boolean job quest + income-gated quest');
{
  // The designer's authored quests (data/quests.json): find_a_job completes on `vars.job eq true`
  // (the only form the builder offers for a boolean var), apply_for_permanent_residence triggers on
  // `vars.income >= 350`. Drive them through the REAL job-acceptance path (game/phone.ts applyForJob)
  // and the runner's tick re-evaluation to prove the end-to-end fix.
  const findJob: QuestDef = {
    id: 'find_a_job', name: 'Find a job', description: '',
    trigger: { all: [{ var: 'skills.english', gte: 0 }] },
    completion: { all: [{ var: 'vars.job', eq: true }] },
    rewards: [], onceOnly: true,
  };
  const prQuest: QuestDef = {
    id: 'apply_pr', name: 'Apply PR', description: '',
    trigger: { all: [{ var: 'vars.income', gte: 350 }] },
    completion: { all: [] }, rewards: [], onceOnly: true,
  };
  const runner = new QuestRunner({ quests: [findJob, prQuest] }, simState, 0);
  const jobs: JobsData = { jobs: [
    { id: 'dishwasher', name: 'Dishwasher', hours: { startHour: 9, endHour: 17 }, payPerShift: 400, maxSkips: 3 },
  ] };

  runner.tick({}, { english: 1 }, { hour: 9, day: 1 }); // find_a_job triggers; still jobless
  check('find_a_job active but not done while jobless', runner.quests['find_a_job'] === 'active');
  check('income-gated PR quest not triggered while income is 0', runner.quests['apply_pr'] === 'locked');

  const evalCtx: EvalContext = { needs: {}, skills: { english: 1 }, funds: 0, time: { hour: 9, day: 1 }, vars: runner.vars, quests: runner.quests };
  const res = applyForJob('dishwasher', jobs, evalCtx, runner.vars, () => {});
  check('job accepted via the real phone path', res.ok === true);
  check('vars.job holds the employer id string (work system contract)', runner.vars['job'] === 'dishwasher');
  check('vars.income seeded to the job base pay', runner.vars['income'] === 400);

  runner.tick({}, { english: 1 }, { hour: 9, day: 1 }); // re-evaluate after acquisition
  check('BUG 1 FIX: find_a_job completes once the sim has a job', runner.quests['find_a_job'] === 'done');
  check('BUG 1 FIX: income-gated PR quest triggers off vars.income', runner.quests['apply_pr'] === 'done');

  // Job loss (main.ts writes vars.job=null, vars.income=0) — the boolean condition flips back UNMET.
  runner.vars['job'] = null; runner.vars['income'] = 0;
  check('boolean job condition is UNMET again once jobless', evaluate({ var: 'vars.job', eq: true }, evalCtx) === false);
}

// --- H1 (ROADMAP_HAPPY): top-level happiness in the condition namespace
{
  const { resolveVar, evaluate } = await import('../game/quests');
  const ctx = { needs: {}, skills: {}, funds: 0, time: { hour: 0, day: 0 }, happiness: 42, vars: {}, quests: {} };
  check('resolveVar reads happiness', resolveVar('happiness', ctx) === 42);
  check('conditions can gate on happiness', evaluate({ all: [{ var: 'happiness', gte: 40 }] }, ctx) === true
    && evaluate({ all: [{ var: 'happiness', gte: 50 }] }, ctx) === false);
  check('absent happiness stays safe-false', evaluate({ all: [{ var: 'happiness', gte: 0 }] }, { ...ctx, happiness: undefined }) === false);
}

console.log('quests.test — grantContact reward seam');
{
  const runner = new QuestRunner({ quests: [] }, { variables: [] }, 0);
  const granted: string[] = [];
  runner.onGrantContact = (npcId) => granted.push(npcId);
  runner.applyReward({ type: 'grantContact', npc: 'amara' });
  check('grantContact delegates to the runtime phone book owner', granted[0] === 'amara');
}

console.log('quests.test — action-cost affordability');
{
  const runner = new QuestRunner({ quests: [] }, { variables: [] }, -10);
  check('shared affordability rule treats invalid and negative costs as free', actionCost(-1) === 0 && actionCost(Number.NaN) === 0);
  check('shared affordability rule permits free actions in debt but rejects paid actions', canAffordActionCost(-10, 0) && !canAffordActionCost(-10, 1));
  check('a zero-cost action can start while funds are negative', runner.spend(0) && runner.funds === -10);
  check('a paid action cannot start while funds are negative', !runner.spend(1) && runner.funds === -10);
}

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall quests tests passed');
