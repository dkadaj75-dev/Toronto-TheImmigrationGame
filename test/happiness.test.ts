// happiness.test.ts — headless B6-5 formula coverage. Run: npx tsx test/happiness.test.ts
import { computeHappiness, happinessStateDisplay, happinessStateFor, normalizeHappinessComponent } from '../game/happiness';
import type { HappinessData } from '../game/data';
import type { EvalContext } from '../game/quests';

let failures = 0;
function check(name: string, condition: boolean) {
  if (condition) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name}`); }
}
const ctx: EvalContext = {
  needs: { hunger: 75 }, skills: {}, funds: 2500, creditScore: 600,
  time: { day: 1, hour: 8 }, vars: { visaStatus: 'pr', job: 'cook' }, quests: {},
};
const data: HappinessData = {
  visaStatusRanks: { visitor: 0, pr: 3 },
  components: [
    { var: 'needs.hunger', weight: 4, min: 0, max: 100 },
    { var: 'funds', weight: 1, min: 0, max: 5000 },
    { var: 'creditScore', weight: 1, min: 300, max: 900 },
    { var: 'vars.visaStatus', weight: 1, min: 0, max: 3 },
    { var: 'vars.job', weight: 1, min: 0, max: 1 },
  ],
};

console.log('happiness.test — normalization and weighted formula');
check('numeric values normalize inside authored bounds', normalizeHappinessComponent(data.components[0], 75) === 0.75);
check('values clamp above authored max', normalizeHappinessComponent(data.components[0], 200) === 1);
check('visa id uses the authored status rank', normalizeHappinessComponent(data.components[3], 'pr', data.visaStatusRanks) === 1);
check('non-empty job id becomes an employed 1 bonus', normalizeHappinessComponent(data.components[4], 'cook') === 1);
check('weighted mean scales exactly to 0..100', computeHappiness(data, ctx) === 75);
check('unknown vars are ignored rather than crashing or diluting', computeHappiness({ components: [{ var: 'needs.missing', weight: 9 }, { var: 'funds', weight: 1, min: 0, max: 5000 }] }, ctx) === 50);
check('zero usable weight returns zero', computeHappiness({ components: [{ var: 'funds', weight: 0 }] }, ctx) === 0);

const states = [
  { id: 'low', atLeast: 0, label: 'Low', icon: '/icons/sad.svg' },
  { id: 'high', atLeast: 80, label: 'High', icon: '/icons/happy.svg' },
  { id: 'middle', atLeast: 50, label: 'Middle', icon: '/icons/neutral.svg' },
];
check('inclusive threshold edge resolves the matching state', happinessStateFor(80, states)?.id === 'high');
check('greatest matching threshold wins', happinessStateFor(95, states)?.id === 'high');
check('resolution is independent of array order', happinessStateFor(75, [...states].reverse())?.id === 'middle');
const tiedStates = [{ id: 'z', atLeast: 50, label: 'Z', icon: '' }, { id: 'a', atLeast: 50, label: 'A', icon: '' }];
check('equal thresholds also resolve independently of order', happinessStateFor(50, tiedStates)?.id === happinessStateFor(50, [...tiedStates].reverse())?.id);
check('empty state list resolves null', happinessStateFor(50, []) === null);
check('absent state list resolves null', happinessStateFor(50, undefined) === null);
check('below every authored threshold resolves null', happinessStateFor(-1, states) === null);
check('icon display resolves icon only', happinessStateDisplay('icon').icon && !happinessStateDisplay('icon').text);
check('text display resolves text only', !happinessStateDisplay('text').icon && happinessStateDisplay('text').text);
check('both and unknown display data resolve both', happinessStateDisplay('both').icon && happinessStateDisplay(undefined).text);

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nAll happiness.test checks passed.');

// --- H2 (ROADMAP_HAPPY): per-action mood coupling
import { happinessSkillFactor, isRefusedByMood } from '../game/happiness';
check('absent mod is a strict no-op', happinessSkillFactor(undefined, 50) === 1);
check('midpoint lerps to 1', happinessSkillFactor({ skillEffAtMin: 0.5, skillEffAtMax: 1.5 }, 50) === 1);
check('floor at 0 happiness', happinessSkillFactor({ skillEffAtMin: 0.5, skillEffAtMax: 1.5 }, 0) === 0.5);
check('ceiling at 100 happiness', happinessSkillFactor({ skillEffAtMin: 0.5, skillEffAtMax: 1.5 }, 100) === 1.5);
check('sparse min defaults to 1', happinessSkillFactor({ skillEffAtMax: 2 }, 100) === 2);
check('factor clamps at 0, never reverses learning', happinessSkillFactor({ skillEffAtMin: -5 }, 0) === 0);
check('no cutoff never refuses', isRefusedByMood(undefined, 0) === false);
check('below cutoff refuses', isRefusedByMood({ refuseBelow: 30 }, 29.9) === true);
check('cutoff is strictly-below', isRefusedByMood({ refuseBelow: 30 }, 30) === false);
console.log('H2 mood-coupling checks passed');
