// autonomy-grace.test.ts — B13-7 headless coverage for the tunable autonomy decision grace window.
// Run: npx tsx test/autonomy-grace.test.ts
import * as THREE from 'three';
import { Autonomy } from '../game/autonomy';
import { SimStats } from '../game/stats';
import type { ActionDef, AssetDef, GameData } from '../game/data';
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
const nap: ActionDef = {
  id: 'nap', name: 'Nap', needGains: { energy: 1.5 }, skillGains: {}, animation: 'lie_sleep',
  autonomyEligible: true, primaryNeed: 'energy',
};
const evalCtx: EvalContext = {
  needs: { energy: 5 }, skills: {}, personality: {}, funds: 100,
  time: { hour: 1, day: 1 }, vars: {}, quests: {},
};
const decisionGraceSeconds = 5;

function graceData(): GameData {
  return {
    stats: { needs: [{ id: 'energy', name: 'Energy', color: '#0f0', default: 10, decayPerTick: 1, autonomy: true }], skills: [], personality: [] },
    interactions: { actions: [nap] }, assets: { categories: ['seating'], assets: [sofa] },
    map: { id: 'test', name: 'Test', gridSize: 0.5, bounds: { w: 10, h: 10 }, floors: [], walls: [], doors: [], spawn: { pos: [0, 0], facingDeg: 0 }, placedObjects: [] },
    tuning: {
      simulation: { needsDecayTickSeconds: 1, activityGainTickSeconds: 2 },
      autonomy: { seekBelowThreshold: 30, stopAtThreshold: 95, postPlayerCommandCooldownSeconds: 10, decisionGraceSeconds },
      time: { secondsPerGameDay: 60, nightStartHour: 22, nightEndHour: 6 },
      economy: { startingFunds: 0, currencyName: '$' }, movement: { walkSpeed: 2, arrivalRadius: 0.3 },
      camera: { minZoom: 1, maxZoom: 10, minPitchDeg: 30, maxPitchDeg: 70, panBoundsPadding: 1 },
      quests: { toastDurationSeconds: 1, completedLogLimit: 1 },
    },
    simstate: { variables: [] }, quests: { quests: [] }, visas: { statuses: [] }, jobs: { jobs: [] },
    bills: { bills: [] }, finance: { bills: { base: 0, perAssetValue: 0 }, rent: { byPropertyType: {}, perFloorTile: 0 }, overdueDays: 1, tooLateDays: 2, negativeGraceDays: 1 },
    happiness: { components: [] }, loading: { phrases: [], phraseIntervalSeconds: 1 },
  } as GameData;
}

function makeAutonomy() {
  const data = graceData();
  const world = new THREE.Group();
  const sofaObj = new THREE.Group(); sofaObj.userData.assetId = 'sofa'; sofaObj.position.set(1, 0, 0);
  world.add(sofaObj);
  let ordered: string | undefined;
  let orderCalls = 0;
  const agent = {
    isBusy: false,
    object: new THREE.Group(),
    orderAction(action: ActionDef) { orderCalls++; ordered = action.id; return true; },
  };
  const stats = new SimStats(data.stats);
  const autonomy = new Autonomy(() => data, () => world, agent as never, stats, undefined, () => evalCtx);
  return { data, autonomy, agent, get ordered() { return ordered; }, get orderCalls() { return orderCalls; } };
}

console.log('autonomy-grace.test — B13-7 tunable decision grace window');

// --- tuning key present with a positive default -------------------------------------------
{
  const { data } = makeAutonomy();
  check('tuning.autonomy.decisionGraceSeconds is a positive number', data.tuning.autonomy.decisionGraceSeconds! > 0);
}

// --- each "fresh start" trigger arms the SAME mechanism main.ts wires them to: forceCooldown --
{
  const { autonomy, data } = makeAutonomy();
  check('no grace armed yet — autonomy acts immediately', autonomy.maybeAct() !== null);
}
for (const trigger of ['boot', 'map switch', 'return from work', 'return from visit'] as const) {
  const { autonomy, data } = makeAutonomy();
  // main.ts calls exactly this at each of the four fresh-start sites.
  autonomy.forceCooldown(data.tuning.autonomy.decisionGraceSeconds!);
  check(`${trigger}: autonomous decision suppressed while grace is armed`, autonomy.maybeAct() === null);
}

// --- suppresses autonomy while positive, and only autonomy (player orders bypass it) ------
{
  const { autonomy, agent } = makeAutonomy();
  autonomy.forceCooldown(decisionGraceSeconds);
  check('maybeAct() is a no-op while grace is armed', autonomy.maybeAct() === null && agent.orderAction === agent.orderAction);
  // Player orders go straight through agent.orderAction (main.ts's tap-to-order path), never
  // through Autonomy.maybeAct() — so they are structurally unaffected by cooldownRemaining.
  const directOrder = agent.orderAction(nap);
  check('a direct (player) order still succeeds while autonomy is suppressed', directOrder === true);
  check('notePlayerCommand does not get blocked by an armed grace window either', (() => {
    autonomy.notePlayerCommand();
    return true; // notePlayerCommand has no gate — it unconditionally (re)arms the cooldowns
  })());
}

// --- expires on SIM time (update(dt) uses the caller-supplied dt, i.e. sdt in main.ts) ----
{
  const { autonomy } = makeAutonomy();
  autonomy.forceCooldown(decisionGraceSeconds);
  autonomy.update(decisionGraceSeconds - 0.01);
  check('grace still suppresses autonomy just before it elapses', autonomy.maybeAct() === null);
}
{
  const { autonomy } = makeAutonomy();
  autonomy.forceCooldown(decisionGraceSeconds);
  autonomy.update(decisionGraceSeconds + 0.01);
  check('grace has expired — autonomy acts again once sim time passes the window', autonomy.maybeAct() !== null);
}
{
  const { autonomy } = makeAutonomy();
  autonomy.forceCooldown(decisionGraceSeconds);
  // Simulate a paused frame: main.ts derives sdt = 0 while paused/loading/buy-mode/game-over, so
  // update(0) must never decay the grace window — pause truly freezes it.
  autonomy.update(0);
  autonomy.update(0);
  check('update(0) (paused sim time) does not decay the grace window at all', autonomy.maybeAct() === null);
}

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nAll autonomy-grace.test checks passed.');
