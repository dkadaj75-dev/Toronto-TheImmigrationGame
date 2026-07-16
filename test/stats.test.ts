import { scaleSkillGain, SimStats } from '../game/stats';
import type { ActionDef, StatsData } from '../game/data';

let passed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (!ok) throw new Error(`FAIL: ${name}${detail ? ` (${detail})` : ''}`);
  console.log(`PASS: ${name}`);
  passed++;
}
const approx = (a: number, b: number, eps = 1e-10) => Math.abs(a - b) <= eps;

const raw = 2;
check('low-level gain is approximately the raw gain', approx(scaleSkillGain(raw, 0.01, 100, 1.5), raw, 0.001));
check('near-max gain is strongly reduced', scaleSkillGain(raw, 90, 100, 1.5) < raw * 0.04);
check('curve exponent 0 preserves linear gain', scaleSkillGain(raw, 90, 100, 0) === raw);
check('at max positive gain is zero', scaleSkillGain(raw, 100, 100, 0) === 0);
check('negative skill delta is untouched', scaleSkillGain(-2, 90, 100, 1.5) === -2);

const defs: StatsData = {
  needs: [],
  skills: [{ id: 'cooking', name: 'Cooking', color: '#fff', default: 90, max: 100 }],
};
const action: ActionDef = {
  id: 'practice', name: 'Practice', needGains: {}, skillGains: { cooking: raw },
  animation: '', autonomyEligible: false, primaryNeed: null,
};
const stats = new SimStats(defs, 1.5);
stats.applyGains(action);
check('SimStats.applyGains uses the non-linear helper', approx(stats.skills.get('cooking')!, 90 + scaleSkillGain(raw, 90, 100, 1.5)));

console.log(`\n${passed} stats tests passed.`);
