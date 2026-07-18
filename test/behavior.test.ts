// behavior.test.ts — headless B8-1-E scoring + Autonomy compatibility coverage.
// Run: npx tsx test/behavior.test.ts
import * as THREE from 'three';
import { scoreCandidate, pickBest } from '../game/behavior';
import { Autonomy } from '../game/autonomy';
import { SimStats } from '../game/stats';
import type { ActionDef, AssetDef, BehaviorData, GameData } from '../game/data';
import type { EvalContext } from '../game/quests';

let failures = 0;
function check(name: string, condition: boolean) {
  if (condition) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name}`); }
}

const sofa: AssetDef = {
  id: 'sofa', name: 'Sofa', category: 'seating', mesh: '', buyPrice: 0, sellPrice: 0,
  environmentScore: 0, footprint: [2, 1], interactions: ['nap'],
};
const bed: AssetDef = {
  id: 'bed', name: 'Bed', category: 'beds', mesh: '', buyPrice: 0, sellPrice: 0,
  environmentScore: 0, footprint: [2, 3], interactions: ['sleep'],
};
const nap: ActionDef = {
  id: 'nap', name: 'Nap', needGains: { energy: 1.5 }, skillGains: {}, animation: 'lie_sleep',
  autonomyEligible: true, primaryNeed: 'energy',
};
const sleep: ActionDef = {
  id: 'sleep', name: 'Sleep', needGains: { energy: 3 }, skillGains: {}, animation: 'lie_sleep',
  autonomyEligible: true, primaryNeed: 'energy',
};
const evalCtx: EvalContext = {
  needs: { energy: 10, hunger: 50 }, skills: {}, personality: { cleanliness: 2 }, funds: 100,
  time: { hour: 1, day: 1 }, vars: {}, quests: {},
};
const behavior: BehaviorData = {
  weights: { needDeficit: 1, distance: 1, personalityAffinity: 1 },
  decisionThreshold: 0,
  needWeights: { energy: 1 },
  rules: [],
};

console.log('behavior.test — utility formula and compatibility');

const ranked = pickBest([
  { asset: sofa, action: nap, distance: 1 },
  { asset: bed, action: sleep, distance: 8 },
], { behavior, eval: evalCtx });
check('bed sleep outranks closer sofa nap through its higher per-action gain rate', ranked?.candidate.asset.id === 'bed');

const distanceWinner = pickBest([
  { asset: sofa, action: nap, distance: 4 },
  { asset: { ...sofa, id: 'sofa_near' }, action: nap, distance: 1 },
], { behavior, eval: evalCtx });
check('distance breaks otherwise equal utility toward the nearer candidate', distanceWinner?.candidate.asset.id === 'sofa_near');

// --- per-asset needMultipliers flow into scoring: two IDENTICAL assets (same action, same
// distance) rank differently purely by their needMultipliers, so a luxury sofa outranks a bad one.
const luxSofa: AssetDef = { ...sofa, id: 'lux_sofa', needMultipliers: { energy: 2 } };
const badSofa: AssetDef = { ...sofa, id: 'bad_sofa', needMultipliers: { energy: 0.25 } };
const multRanked = pickBest([
  { asset: badSofa, action: nap, distance: 1 },
  { asset: luxSofa, action: nap, distance: 1 },
], { behavior, eval: evalCtx });
check('a higher needMultiplier makes an otherwise identical asset outrank a worse one', multRanked?.candidate.asset.id === 'lux_sofa');
check(
  'the multiplier scales the score itself (2x asset scores exactly 2x a 1x asset)',
  scoreCandidate(luxSofa, nap, { behavior, eval: evalCtx, distance: 0 }) === 2 * scoreCandidate(sofa, nap, { behavior, eval: evalCtx, distance: 0 }),
);
check(
  'a negative multiplier drives the utility term below zero (draining asset)',
  scoreCandidate(badSofa, nap, { behavior, eval: evalCtx, distance: 0 }) > 0 &&
  scoreCandidate({ ...sofa, id: 'drain', needMultipliers: { energy: -1 } }, nap, { behavior, eval: evalCtx, distance: 0 }) < 0,
);

const ruleBehavior: BehaviorData = {
  ...behavior,
  rules: [{
    id: 'avoids_cleaning', name: 'Avoids cleaning', action: 'clean_up', assetCategory: 'transient',
    conditions: { all: [{ var: 'personality.cleanliness', lte: 3 }] }, scoreBonus: -20, enabled: true,
  }],
};
const mess: AssetDef = { ...sofa, id: 'mess', category: 'transient', interactions: ['clean_up'] };
const clean: ActionDef = { ...nap, id: 'clean_up', name: 'Clean up', primaryNeed: null, needGains: {} };
check('matching rule bonus applies when its personality condition passes', scoreCandidate(mess, clean, { behavior: ruleBehavior, eval: evalCtx, distance: 0 }) === -20);
check('rule bonus is gated off when its personality condition fails', scoreCandidate(mess, clean, { behavior: ruleBehavior, eval: { ...evalCtx, personality: { cleanliness: 8 } }, distance: 0 }) === 0);

const exactScore = scoreCandidate(bed, sleep, { behavior, eval: evalCtx, distance: 8 });
check('threshold suppresses a best score equal to (not above) the threshold', pickBest(
  [{ asset: bed, action: sleep, distance: 8 }],
  { behavior: { ...behavior, decisionThreshold: exactScore }, eval: evalCtx },
) === null);

function autonomyData(withBehavior: boolean): GameData {
  return {
    stats: { needs: [{ id: 'energy', name: 'Energy', color: '#0f0', default: 10, decayPerTick: 1, autonomy: true }], skills: [], personality: [] },
    interactions: { actions: [nap, sleep] }, assets: { categories: ['seating', 'beds'], assets: [sofa, bed] },
    map: { id: 'test', name: 'Test', gridSize: 0.5, bounds: { w: 10, h: 10 }, floors: [], walls: [], doors: [], spawn: { pos: [0, 0], facingDeg: 0 }, placedObjects: [] },
    tuning: {
      simulation: { needsDecayTickSeconds: 1, activityGainTickSeconds: 2 },
      autonomy: { seekBelowThreshold: 30, stopAtThreshold: 95, postPlayerCommandCooldownSeconds: 10 },
      time: { secondsPerGameDay: 60, nightStartHour: 22, nightEndHour: 6 },
      economy: { startingFunds: 0, currencyName: '$' }, movement: { walkSpeed: 2, arrivalRadius: 0.3 },
      camera: { minZoom: 1, maxZoom: 10, minPitchDeg: 30, maxPitchDeg: 70, panBoundsPadding: 1 },
      quests: { toastDurationSeconds: 1, completedLogLimit: 1 },
    },
    simstate: { variables: [] }, quests: { quests: [] }, visas: { statuses: [] }, jobs: { jobs: [] },
    bills: { bills: [] }, finance: { bills: { base: 0, perAssetValue: 0 }, rent: { byPropertyType: {}, perFloorTile: 0 }, overdueDays: 1, tooLateDays: 2, negativeGraceDays: 1 },
    happiness: { components: [] }, loading: { phrases: [], phraseIntervalSeconds: 1 },
    ...(withBehavior ? { behavior } : {}),
  } as GameData;
}

function runAutonomy(withBehavior: boolean, allowedActionIds?: string[]): string | undefined {
  const data = autonomyData(withBehavior);
  const world = new THREE.Group();
  const sofaObj = new THREE.Group(); sofaObj.userData.assetId = 'sofa'; sofaObj.position.set(1, 0, 0);
  const bedObj = new THREE.Group(); bedObj.userData.assetId = 'bed'; bedObj.position.set(8, 0, 0);
  world.add(sofaObj, bedObj);
  let ordered: string | undefined;
  const agent = {
    isBusy: false,
    object: new THREE.Group(),
    orderAction(action: ActionDef) { ordered = action.id; return true; },
  };
  const stats = new SimStats(data.stats);
  const autonomy = new Autonomy(
    () => data, () => world, agent as never, stats, undefined, () => evalCtx,
    allowedActionIds ? { allowedActionIds: () => allowedActionIds } : undefined,
  );
  autonomy.maybeAct();
  return ordered;
}

check('Autonomy utility mode chooses the farther bed with the stronger gain rate', runAutonomy(true) === 'sleep');
check('optional visitor allow-list excludes a higher-scoring disallowed action', runAutonomy(true, ['nap']) === 'nap');
check('absent behavior.json preserves legacy lowest-need nearest-candidate fallback', runAutonomy(false) === 'nap');

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nAll behavior.test checks passed.');
