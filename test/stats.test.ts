import { computeEnvironmentScore, scaleSkillGain, effectiveNeedGain, SimStats, skillPointProgress, primarySkillGain } from '../game/stats';
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

{
  const decayStats = new SimStats({
    needs: [
      { id: 'comfort', name: 'Comfort', color: '#fff', default: 50, decayPerTick: 1 },
      { id: 'environment', name: 'Environment', color: '#fff', default: 50, decayPerTick: 1, computed: true },
    ],
    skills: [],
  });
  decayStats.decayTick();
  check('ordinary needs decay normally', decayStats.needs.get('comfort') === 49);
  check('computed Environment never changes on a needs tick', decayStats.needs.get('environment') === 50);
}

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
check(
  'event-resolved night penalty plus lamp bonus enters the existing Environment aggregate',
  computeEnvironmentScore(['couch'], [], envScoreFor, -7 + 0.75) === -1.25,
);
check('day/disabled contribution leaves the base aggregate unchanged', computeEnvironmentScore(['couch'], [], envScoreFor, 0) === 5);

// ITEM 2 (skill progress bar) — skillPointProgress: fraction toward the next integer skill point.
{
  const midA = skillPointProgress(3.25, 100);
  check('mid-level fraction is the value\'s fractional part', approx(midA.fraction, 0.25) && midA.atMax === false);
  const midB = skillPointProgress(15.75, 100);
  check('another mid-level fraction', approx(midB.fraction, 0.75) && midB.atMax === false);
  check('exactly on a point → fraction 0 (bar empty)', skillPointProgress(5, 100).fraction === 0 && skillPointProgress(5, 100).atMax === false);
  check('value 0 → fraction 0', skillPointProgress(0, 10).fraction === 0);
  const atMax = skillPointProgress(100, 100);
  check('at max → atMax true (bar hidden)', atMax.atMax === true);
  check('above max (clamped elsewhere) → atMax true', skillPointProgress(120, 100).atMax === true);
  check('just below max still shows its fraction', (() => { const p = skillPointProgress(99.5, 100); return p.atMax === false && approx(p.fraction, 0.5); })());
  check('non-positive max → atMax true (no divide/invalid)', skillPointProgress(3, 0).atMax === true);
}

// ITEM 2 — primarySkillGain: the largest positive skill gain of an action, or null.
{
  check('null when the action grants no skill', primarySkillGain({}) === null);
  check('null when all gains are non-positive', primarySkillGain({ cooking: 0, english: -1 }) === null);
  const p = primarySkillGain({ english: 0.2, cooking: 0.5, finance: 0.1 });
  check('picks the largest gain as primary', p?.id === 'cooking' && p?.gain === 0.5);
  check('single-skill action returns that skill', primarySkillGain({ engineering: 0.3 })?.id === 'engineering');
}

console.log(`\n${passed} stats tests passed.`);
