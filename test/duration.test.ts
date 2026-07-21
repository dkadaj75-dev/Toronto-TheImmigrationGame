// duration.test.ts — game/duration.ts pure logic (ROADMAP_NEXT item 5, PROJECT_CONTEXT.md §7.11).
// Run: npx tsx test/duration.test.ts
import { readFileSync } from 'node:fs';
import { computeDurationSeconds, isDurationComplete } from '../game/duration';
import type { SkillDef, ActionDef } from '../game/data';

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

console.log('duration.test — computeDurationSeconds modifiers (ROADMAP_NEXT B2-5)');
{
  // no modifiers → identical to the pre-existing base/lerp math (backward compat check)
  const noMods = computeDurationSeconds({ baseSeconds: 10 }, {}, skillDefs);
  check('no modifiers key → unchanged from base', noMods === 10, String(noMods));

  const emptyMods = computeDurationSeconds({ baseSeconds: 10, modifiers: [] }, {}, skillDefs);
  check('empty modifiers array → unchanged from base', emptyMods === 10, String(emptyMods));

  // single modifier, skills-namespaced: intelligence 0..10, atMin 1 (at 0) -> atMax 0.5 (at max)
  const intel0 = computeDurationSeconds({ baseSeconds: 10, modifiers: [{ var: 'skills.cooking', atMin: 1, atMax: 0.5 }] }, { cooking: 0 }, skillDefs);
  check('modifier at var=0 applies atMin exactly', intel0 === 10, String(intel0)); // 10 * 1
  const intelMax = computeDurationSeconds({ baseSeconds: 10, modifiers: [{ var: 'skills.cooking', atMin: 1, atMax: 0.5 }] }, { cooking: 10 }, skillDefs);
  check('modifier at var=max applies atMax exactly', approx(intelMax!, 5), String(intelMax)); // 10 * 0.5
  const intelHalf = computeDurationSeconds({ baseSeconds: 10, modifiers: [{ var: 'skills.cooking', atMin: 1, atMax: 0.5 }] }, { cooking: 5 }, skillDefs);
  check('modifier at var=50% lerps the multiplier halfway', approx(intelHalf!, 7.5), String(intelHalf)); // 10 * 0.75

  // needs-namespaced modifier: needs are always 0..100 (game/stats.ts), no SkillDef lookup needed
  const energyLow = computeDurationSeconds({ baseSeconds: 10, modifiers: [{ var: 'needs.energy', atMin: 1.6, atMax: 1 }] }, {}, skillDefs, { energy: 0 });
  check('needs. modifier at 0 applies atMin exactly (tired sim is slower)', approx(energyLow!, 16), String(energyLow)); // 10 * 1.6
  const energyFull = computeDurationSeconds({ baseSeconds: 10, modifiers: [{ var: 'needs.energy', atMin: 1.6, atMax: 1 }] }, {}, skillDefs, { energy: 100 });
  check('needs. modifier at 100 applies atMax exactly', approx(energyFull!, 10), String(energyFull)); // 10 * 1

  // stacking: two modifiers multiply together, in array order — the shipped "extinguish" shape
  const extinguishDur = { baseSeconds: 10, modifiers: [{ var: 'skills.cooking', atMin: 1, atMax: 0.5 }, { var: 'needs.energy', atMin: 1.6, atMax: 1 }] };
  const stacked = computeDurationSeconds(extinguishDur, { cooking: 10 }, skillDefs, { energy: 0 });
  check('two modifiers stack by multiplication', approx(stacked!, 8), String(stacked)); // 10 * 0.5 * 1.6

  // unresolvable modifier var → no-op ×1, same "unknown id → safe fallback" convention as skillVar
  const unknownVar = computeDurationSeconds({ baseSeconds: 10, modifiers: [{ var: 'needs.nonexistent', atMin: 2, atMax: 4 }] }, {}, skillDefs, {});
  check('unresolvable needs. modifier var → no-op (×1)', unknownVar === 10, String(unknownVar));
  const unknownSkillMod = computeDurationSeconds({ baseSeconds: 10, modifiers: [{ var: 'skills.nonexistent', atMin: 2, atMax: 4 }] }, {}, skillDefs, {});
  check('unresolvable skills. modifier var → no-op (×1)', unknownSkillMod === 10, String(unknownSkillMod));

  // modifiers compose with the base skillVar/atMaxSeconds lerp too, not just fixed baseSeconds
  const withBaseLerp = computeDurationSeconds(
    { baseSeconds: 60, skillVar: 'skills.cooking', atMaxSeconds: 20, modifiers: [{ var: 'needs.energy', atMin: 2, atMax: 1 }] },
    { cooking: 10 }, skillDefs, { energy: 0 },
  );
  check('modifiers apply on top of the skillVar/atMaxSeconds lerp result', approx(withBaseLerp!, 40), String(withBaseLerp)); // lerp->20, *2 energy penalty -> 40

  // needs defaults to {} when the 4th arg is omitted — every pre-existing 3-arg call site keeps
  // working, a needs. modifier just no-ops (backward compat, see the module doc comment)
  const omittedNeeds = computeDurationSeconds({ baseSeconds: 10, modifiers: [{ var: 'needs.energy', atMin: 2, atMax: 4 }] }, {}, skillDefs);
  check('omitting the needs arg entirely → needs. modifiers no-op (backward compat)', omittedNeeds === 10, String(omittedNeeds));
}

console.log('duration.test — shipped data sanity (data/interactions.json + data/stats.json)');
{
  const interactions = JSON.parse(readFileSync(new URL('../data/interactions.json', import.meta.url), 'utf8'));
  const stats = JSON.parse(readFileSync(new URL('../data/stats.json', import.meta.url), 'utf8'));
  const intel = stats.skills.find((s: SkillDef) => s.id === 'intelligence');
  // Self-deriving (AGENTS.md: never hardcode live data — this pinned max 10 until the designer
  // retuned intelligence to max 100 in the Tuning Editor). Only the SHAPE is asserted here; the
  // behavioural checks below feed the skill's own live max so the maths stays meaningful.
  check('stats.json ships an "intelligence" skill with a usable range',
    !!intel && Number.isFinite(intel.default) && typeof intel.max === 'number' && intel.max > 0, JSON.stringify(intel));

  for (const id of ['extinguish', 'clean_up', 'sweep', 'mop']) {
    const action = interactions.actions.find((a: ActionDef) => a.id === id);
    check(`${id} ships a duration block`, !!action?.duration, JSON.stringify(action?.duration));
    const seconds = computeDurationSeconds(action.duration, {}, stats.skills, {});
    check(`${id} computeDurationSeconds resolves without throwing/NaN (no skill/need snapshot)`, typeof seconds === 'number' && !Number.isNaN(seconds), String(seconds));
  }

  const extinguish = interactions.actions.find((a: ActionDef) => a.id === 'extinguish');
  const fastExtinguish = computeDurationSeconds(extinguish.duration, { intelligence: intel.max }, stats.skills, { energy: 100 });
  const slowExtinguish = computeDurationSeconds(extinguish.duration, { intelligence: 0 }, stats.skills, { energy: 0 });
  check('extinguish: smart + energetic sim is faster than dumb + tired sim', fastExtinguish! < slowExtinguish!, `${fastExtinguish} vs ${slowExtinguish}`);
  check('extinguish base 10s: a maxed-intelligence, rested sim halves it (10 * 0.5 * 1)', approx(fastExtinguish!, 5), String(fastExtinguish));
  check('extinguish base 10s: dumb+tired ≈ 16s (10 * 1 * 1.6)', approx(slowExtinguish!, 16), String(slowExtinguish));
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
