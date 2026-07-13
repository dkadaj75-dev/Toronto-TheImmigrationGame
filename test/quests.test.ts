// quests.test.ts — headless tests for the quest condition evaluator + QuestRunner lifecycle.
// Run: npx tsx test/quests.test.ts

import { evaluate, QuestRunner, type EvalContext } from '../game/quests';
import type { Condition, QuestDef, QuestsData, SimStateData } from '../game/data';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name} ${detail}`); }
}

function ctx(overrides: Partial<EvalContext> = {}): EvalContext {
  return {
    needs: { hunger: 80, energy: 40 },
    skills: { english: 5, cooking: 0 },
    funds: 300,
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
}

console.log('quests.test — namespaces');
{
  const c = ctx();
  check('needs.<id>', evaluate({ var: 'needs.hunger', gte: 50 }, c));
  check('skills.<id>', evaluate({ var: 'skills.english', gte: 5 }, c));
  check('funds', evaluate({ var: 'funds', gte: 300 }, c));
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

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall quests tests passed');
