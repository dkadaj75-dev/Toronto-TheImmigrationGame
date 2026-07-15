// duration.test.ts — game/duration.ts pure logic (ROADMAP_NEXT item 5, PROJECT_CONTEXT.md §7.11).
// Run: npx tsx test/duration.test.ts
import { computeDurationSeconds, isDurationComplete } from '../game/duration';
import type { SkillDef } from '../game/data';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name} ${detail}`); }
}
function approx(a: number, b: number, eps = 1e-9) { return Math.abs(a - b) <= eps; }

const skillDefs: SkillDef[] = [
  { id: 'cooking', name: 'Cooking', color: '#d35400', default: 0, max: 10 },
  { id: 'zeromax', name: 'ZeroMax', color: '#000', default: 0, max: 0 },
];

console.log('duration.test — computeDurationSeconds');
{
  check('no duration block → null', computeDurationSeconds(undefined, {}, skillDefs) === null);

  const fixed = computeDurationSeconds({ baseSeconds: 45 }, {}, skillDefs);
  check('fixed baseSeconds (no skillVar) → baseSeconds', fixed === 45, String(fixed));

  const skillVarOnlyNoMax = computeDurationSeconds({ baseSeconds: 45, skillVar: 'skills.cooking' }, { cooking: 10 }, skillDefs);
  check('skillVar without atMaxSeconds falls back to baseSeconds', skillVarOnlyNoMax === 45, String(skillVarOnlyNoMax));

  const maxOnlyNoSkillVar = computeDurationSeconds({ baseSeconds: 45, atMaxSeconds: 5 }, { cooking: 10 }, skillDefs);
  check('atMaxSeconds without skillVar falls back to baseSeconds', maxOnlyNoSkillVar === 45, String(maxOnlyNoSkillVar));

  // the §7.11 worked example: cook, skills.cooking, base 60 → atMax 20, cooking.max = 10
  const dur = { baseSeconds: 60, skillVar: 'skills.cooking', atMaxSeconds: 20 };
  check('skill 0 → baseSeconds exactly', computeDurationSeconds(dur, { cooking: 0 }, skillDefs) === 60);
  check('skill at max → atMaxSeconds exactly', computeDurationSeconds(dur, { cooking: 10 }, skillDefs) === 20);
  const half = computeDurationSeconds(dur, { cooking: 5 }, skillDefs);
  check('skill at 50% of max → halfway lerp', approx(half!, 40), String(half));

  check('bare "cooking" (no "skills." prefix) resolves the same as "skills.cooking"',
    computeDurationSeconds(dur, { cooking: 10 }, skillDefs) === computeDurationSeconds({ ...dur, skillVar: 'cooking' }, { cooking: 10 }, skillDefs));

  const unknownSkill = computeDurationSeconds({ baseSeconds: 60, skillVar: 'skills.nonexistent', atMaxSeconds: 20 }, { cooking: 10 }, skillDefs);
  check('unknown skill id → falls back to baseSeconds', unknownSkill === 60, String(unknownSkill));

  const missingValue = computeDurationSeconds(dur, {}, skillDefs);
  check('skill value absent from snapshot → falls back to baseSeconds', missingValue === 60, String(missingValue));

  const zeroMax = computeDurationSeconds({ baseSeconds: 60, skillVar: 'skills.zeromax', atMaxSeconds: 20 }, { zeromax: 0 }, skillDefs);
  check('skill with max <= 0 → falls back to baseSeconds (guards div-by-zero)', zeroMax === 60, String(zeroMax));

  const overMax = computeDurationSeconds(dur, { cooking: 999 }, skillDefs);
  check('skill value above max clamps to atMaxSeconds (no overshoot)', overMax === 20, String(overMax));

  const negative = computeDurationSeconds(dur, { cooking: -50 }, skillDefs);
  check('negative skill value clamps to baseSeconds (no undershoot)', negative === 60, String(negative));

  const inverted = computeDurationSeconds({ baseSeconds: 20, skillVar: 'skills.cooking', atMaxSeconds: 60 }, { cooking: 5 }, skillDefs);
  check('inverted base/atMax (duration grows with skill) lerps correctly too', approx(inverted!, 40), String(inverted));
}

console.log('duration.test — isDurationComplete');
{
  check('null durationSeconds never completes', isDurationComplete(1e9, null) === false);
  check('elapsed below duration is not complete', isDurationComplete(59, 60) === false);
  check('elapsed exactly at duration is complete', isDurationComplete(60, 60) === true);
  check('elapsed past duration is complete', isDurationComplete(61, 60) === true);
  check('zero-second duration completes immediately', isDurationComplete(0, 0) === true);
}

if (failures > 0) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
console.log('\nALL DURATION TESTS PASSED');
