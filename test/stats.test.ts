import { computeEnvironmentScore, scaleSkillGain, effectiveNeedGain, SimStats } from '../game/stats';
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

// --- effectiveNeedGain: the ONE shared helper the sim tick and the autonomy scorer both use.
check('effectiveNeedGain defaults to 1x when no multipliers map is given', effectiveNeedGain('comfort', 4) === 4);
check('effectiveNeedGain defaults to 1x for a need absent from the map', effectiveNeedGain('comfort', 4, { energy: 2 }) === 4);
check('effectiveNeedGain scales a matched need', effectiveNeedGain('comfort', 4, { comfort: 1.5 }) === 6);
check('effectiveNeedGain allows a NEGATIVE multiplier (draining asset)', effectiveNeedGain('comfort', 4, { comfort: -0.5 }) === -2);
check(
  'effectiveNeedGain scales several needs independently',
  effectiveNeedGain('comfort', 4, { comfort: 2, energy: 0.25 }) === 8 && effectiveNeedGain('energy', 4, { comfort: 2, energy: 0.25 }) === 1,
);

// --- applyGains threads the asset's needMultipliers through the same helper.
{
  const needDefs: StatsData = {
    needs: [{ id: 'comfort', name: 'Comfort', color: '#fff', default: 50, decayPerTick: 0 }],
    skills: [],
  };
  const sitAction: ActionDef = {
    id: 'sit', name: 'Sit', needGains: { comfort: 10 }, skillGains: {},
    animation: '', autonomyEligible: false, primaryNeed: 'comfort',
  };
  const plain = new SimStats(needDefs);
  plain.applyGains(sitAction);
  check('applyGains without multipliers is unchanged (50 + 10)', plain.needs.get('comfort') === 60);

  const luxury = new SimStats(needDefs);
  luxury.applyGains(sitAction, { comfort: 1.5 });
  check('applyGains scales the gain by a positive multiplier (50 + 10*1.5)', luxury.needs.get('comfort') === 65);

  const awful = new SimStats(needDefs);
  awful.applyGains(sitAction, { comfort: -0.5 });
  check('applyGains drains comfort with a negative multiplier (50 + 10*-0.5)', awful.needs.get('comfort') === 45);
}

// B10-11: environmentScore is a pure aggregate of assets currently present — no drift over time.
const envScoreFor = (assetId: string) => ({ couch: 5, tv: 3, puddle: -8, fire: -20 }[assetId] ?? 0);
check(
  'destroyed instance (mopped puddle / burned asset) is excluded once removed from the effective list',
  computeEnvironmentScore(['couch'], [], envScoreFor) === 5,
  `expected only couch's score, got ${computeEnvironmentScore(['couch'], [], envScoreFor)}`,
);
check(
  'purchase is included via the effective placed-object list',
  computeEnvironmentScore(['couch', 'tv'], [], envScoreFor) === 8,
);
check(
  'live accident registry instance (e.g. an active fire) is included via the accident sum',
  computeEnvironmentScore(['couch'], ['fire'], envScoreFor) === 5 + -20,
);
check(
  'a still-present designer puddle drags the score down until destroyed',
  computeEnvironmentScore(['couch', 'puddle'], [], envScoreFor) === 5 + -8,
);

console.log(`\n${passed} stats tests passed.`);
