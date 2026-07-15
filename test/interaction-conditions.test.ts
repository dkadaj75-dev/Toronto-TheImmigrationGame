// interaction-conditions.test.ts — headless tests for ROADMAP_NEXT B2-1's availability gate:
// game/quests.ts's `isActionAvailable`, the shared pure helper both game/main.ts's tap-menu
// filter and game/autonomy.ts's `maybeAct` candidate loop call so the two call sites can never
// disagree about what "available" means. Run: npx tsx test/interaction-conditions.test.ts

import { isActionAvailable, type EvalContext } from '../game/quests';

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
    quests: { first_words: 'active' },
    ...overrides,
  };
}

console.log('interaction-conditions.test — isActionAvailable');
{
  // absent/sparse conditions = always available (the common case: most actions have none)
  check('undefined conditions -> available', isActionAvailable(undefined, ctx()) === true);

  // an empty `all` group is vacuously true (same semantics as quests' trigger/completion trees)
  check('empty all-group -> available', isActionAvailable({ all: [] }, ctx()) === true);
  // an empty `any` group is always false (nothing to satisfy)
  check('empty any-group -> unavailable', isActionAvailable({ any: [] }, ctx()) === false);

  // the exact shipped leave_for_work shape: { all: [{ var: "vars.job", neq: null }] }
  const leaveForWork = { all: [{ var: 'vars.job', neq: null }] } as const;
  check(
    'leave_for_work UNAVAILABLE while vars.job is null (simstate.json default)',
    isActionAvailable(leaveForWork, ctx()) === false,
  );
  check(
    'leave_for_work AVAILABLE once vars.job is set to a real job',
    isActionAvailable(leaveForWork, ctx({ vars: { visaStatus: 'tourist', job: 'chef', income: 0 } })) === true,
  );

  // a plain gte condition against a need, both directions
  const wellFed = { all: [{ var: 'needs.hunger', gte: 50 }] };
  check('need-gated condition met', isActionAvailable(wellFed, ctx()) === true);
  check('need-gated condition unmet', isActionAvailable(wellFed, ctx({ needs: { hunger: 10, energy: 40 } })) === false);

  // nested any/all combinator still resolves through the shared helper
  const nested = { all: [{ any: [{ var: 'funds', gte: 1000 }, { var: 'vars.visaStatus', eq: 'tourist' }] }] };
  check('nested all/any resolves via isActionAvailable', isActionAvailable(nested, ctx()) === true);
}

console.log('interaction-conditions.test — menu-hide / autonomy-skip simulation');
{
  // Mirrors game/main.ts's tap-menu filter: `actions.filter((x) => isActionAvailable(x.conditions, ctx))`.
  type FakeAction = { id: string; conditions?: any };
  const actions: FakeAction[] = [
    { id: 'empty_garbage' },
    { id: 'leave_for_work', conditions: { all: [{ var: 'vars.job', neq: null }] } },
  ];
  const menuVisible = (c: EvalContext) => actions.filter((a) => isActionAvailable(a.conditions, c)).map((a) => a.id);
  check(
    'exterior door menu hides "leave_for_work" while job is null',
    JSON.stringify(menuVisible(ctx())) === JSON.stringify(['empty_garbage']),
  );
  check(
    'exterior door menu shows "leave_for_work" once a job exists',
    JSON.stringify(menuVisible(ctx({ vars: { visaStatus: 'tourist', job: 'chef', income: 0 } }))) === JSON.stringify(['empty_garbage', 'leave_for_work']),
  );

  // Mirrors game/autonomy.ts's candidate loop: a conditioned, autonomy-eligible action is skipped
  // as a candidate entirely (never even offered/reachability-checked) while its conditions are unmet.
  const autonomyCandidates = (c: EvalContext) =>
    actions.filter((a) => isActionAvailable(a.conditions, c)).map((a) => a.id);
  check('autonomy candidate pool excludes gated action while unmet', !autonomyCandidates(ctx()).includes('leave_for_work'));
  check('autonomy candidate pool includes it once met', autonomyCandidates(ctx({ vars: { visaStatus: 'tourist', job: 'chef', income: 0 } })).includes('leave_for_work'));
}

if (failures > 0) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
console.log('\nALL INTERACTION-CONDITIONS TESTS PASSED');
