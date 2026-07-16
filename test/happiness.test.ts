// happiness.test.ts — headless B6-5 formula coverage. Run: npx tsx test/happiness.test.ts
import { computeHappiness, normalizeHappinessComponent } from '../game/happiness';
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

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nAll happiness.test checks passed.');
