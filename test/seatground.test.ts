// seatground.test.ts — ROADMAP_NEXT item 2: sit-on-ground fallback for seat-aware actions
// (typically "Watch TV") when no eligible seat is within tuning.interaction.seatSearchRadius.
// Run: npx tsx test/seatground.test.ts
import * as THREE from 'three';
import { bakeNavGrid } from '../game/nav';
import { SimAgent, findSeatFor } from '../game/sim';
import type { MapData, TuningData, GameData, AssetDef, ActionDef } from '../game/data';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name} ${detail}`); }
}

const map: MapData = {
  id: 't', name: 't', gridSize: 0.5, bounds: { w: 20, h: 20 },
  floors: [{ id: 'f', polygon: [[0, 0], [20, 0], [20, 20], [0, 20]], material: 'wood' }],
  walls: [], doors: [], spawn: { pos: [1, 1], facingDeg: 0 }, placedObjects: [],
};
const tuning: TuningData = {
  simulation: { needsDecayTickSeconds: 1, activityGainTickSeconds: 2 },
  autonomy: { seekBelowThreshold: 30, stopAtThreshold: 95, postPlayerCommandCooldownSeconds: 10 },
  time: { secondsPerGameDay: 60, nightStartHour: 22, nightEndHour: 6 },
  economy: { startingFunds: 0, currencyName: '$' },
  movement: { walkSpeed: 4, arrivalRadius: 0.35 },
  camera: { minZoom: 4, maxZoom: 18, minPitchDeg: 30, maxPitchDeg: 70, panBoundsPadding: 2 },
  quests: { toastDurationSeconds: 4, completedLogLimit: 5 },
  character: { meshPath: '', heightMeters: 1.55, crossFadeSeconds: 0.25, walkClipSpeedReference: 2, sitHeight: 0.4, lieHeight: 0.7, clipMap: {} },
  interaction: { useSpotClearance: 0.4, seatViewDistance: 2.5, seatSearchRadius: 5 },
};

function asset(partial: Partial<AssetDef> = {}): AssetDef {
  return {
    id: 'a', name: 'A', category: 'misc', mesh: '', buyPrice: 0, sellPrice: 0, environmentScore: 0,
    footprint: [1, 1], interactions: [],
    ...partial,
  };
}

const tvDef = asset({ id: 'tv', name: 'TV', footprint: [1, 1], interactions: ['watch_tv'] });
const sofaDef = asset({ id: 'sofa', name: 'Sofa', footprint: [1, 1], interactions: ['sit'], seatTarget: true });

function makeWorld(seatPos: [number, number] | null, tvPos: [number, number] = [10, 10]) {
  const world = new THREE.Group();
  const tv = new THREE.Group();
  tv.position.set(tvPos[0], 0, tvPos[1]);
  tv.rotation.y = Math.PI; // rotDeg 180 → faces -Z, so a seat at z < tvPos.z is "in front"
  tv.userData.assetId = 'tv';
  world.add(tv);
  if (seatPos) {
    const sofa = new THREE.Group();
    sofa.position.set(seatPos[0], 0, seatPos[1]);
    sofa.userData.assetId = 'sofa';
    world.add(sofa);
  }
  return { world, tv };
}

const gameData = (): GameData => ({
  stats: { needs: [], skills: [] } as any,
  interactions: { actions: [] } as any,
  assets: { categories: [], assets: [tvDef, sofaDef] },
  map,
  tuning,
  simstate: {} as any,
  quests: { quests: [] } as any,
});

console.log('seatground.test — findSeatFor radius cutoff');
{
  // sofa 3m in front of the TV (within default radius 5) → eligible
  const { world, tv } = makeWorld([10, 7]);
  const seat = findSeatFor(world, gameData(), tv);
  check('seat within seatSearchRadius is found', seat !== null && seat.userData.assetId === 'sofa');

  // sofa 8m in front of the TV (beyond default radius 5) → ineligible, null
  const { world: world2, tv: tv2 } = makeWorld([10, 2]);
  const seat2 = findSeatFor(world2, gameData(), tv2);
  check('seat beyond seatSearchRadius is rejected (null)', seat2 === null, `${seat2}`);

  // no seat placed at all → null (pre-existing graceful fallback)
  const { world: world3, tv: tv3 } = makeWorld(null);
  const seat3 = findSeatFor(world3, gameData(), tv3);
  check('no seat placed → null', seat3 === null);

  // custom (tighter) seatSearchRadius via tuning
  const tightTuning: GameData = { ...gameData(), tuning: { ...tuning, interaction: { ...tuning.interaction, seatSearchRadius: 2 } } };
  const { world: world4, tv: tv4 } = makeWorld([10, 7]); // 3m away
  const seat4 = findSeatFor(world4, tightTuning, tv4);
  check('seatSearchRadius is tuning-driven (3m rejected at radius 2)', seat4 === null);
}

console.log('seatground.test — orderAction groundSit decision');
const watchTvAction: ActionDef = {
  id: 'watch_tv', name: 'Watch TV', needGains: { fun: 2.5 }, skillGains: {}, animation: 'sit_idle',
  autonomyEligible: true, primaryNeed: 'fun', seatAware: true,
};
const assetsById = new Map<string, AssetDef>([['tv', tvDef], ['sofa', sofaDef]]);
{
  // seat found and reachable → groundSit is falsy, sim ends up on the seat (unchanged behavior)
  const grid = bakeNavGrid(map);
  const { world, tv } = makeWorld([10, 7]);
  const obj = new THREE.Group(); obj.position.set(1, 0, 1);
  const agent = new SimAgent(obj, grid, tuning, assetsById);
  const seat = findSeatFor(world, gameData(), tv);
  agent.orderAction(watchTvAction, tv, seat, tvDef, watchTvAction.seatAware);
  for (let i = 0; i < 600 && !agent.current; i++) agent.update(1 / 30);
  check('seat found → groundSit not set', !!agent.current && !agent.current!.groundSit);
  check('seat found → sim ends up at the seat position', Math.abs(obj.position.x - 10) < 1e-6 && Math.abs(obj.position.z - 7) < 1e-6, `${obj.position.x},${obj.position.z}`);
}
{
  // no eligible seat within radius → groundSit true, sim sits at its walked-to spot (ground, y=0)
  const grid = bakeNavGrid(map);
  const { world, tv } = makeWorld([10, 2]); // 8m away, beyond default radius 5
  const obj = new THREE.Group(); obj.position.set(1, 0, 1);
  const agent = new SimAgent(obj, grid, tuning, assetsById);
  const seat = findSeatFor(world, gameData(), tv);
  agent.orderAction(watchTvAction, tv, seat, tvDef, watchTvAction.seatAware);
  for (let i = 0; i < 600 && !agent.current; i++) agent.update(1 / 30);
  check('no eligible seat → groundSit is set', !!agent.current && agent.current!.groundSit === true);
  check('groundSit → sim stays at ground height (y=0)', Math.abs(obj.position.y) < 1e-6, `${obj.position.y}`);
  check('groundSit → sim does NOT snap onto the TV itself', !(Math.abs(obj.position.x - 10) < 1e-6 && Math.abs(obj.position.z - 2) < 1e-6));
  // still faces the target (existing "face the target" step in sim.ts's update(), unaffected by groundSit)
  const dx = tv.position.x - obj.position.x, dz = tv.position.z - obj.position.z;
  const expectedYaw = Math.atan2(dx, dz);
  check('groundSit still faces the TV', Math.abs(obj.rotation.y - expectedYaw) < 1e-3, `${obj.rotation.y} vs ${expectedYaw}`);
}
{
  // a non-seat-aware action never sets groundSit, even with no seat passed (unrelated actions e.g. "cook")
  const grid = bakeNavGrid(map);
  const obj = new THREE.Group(); obj.position.set(1, 0, 1);
  const target = new THREE.Group(); target.position.set(3, 0, 3); target.userData.assetId = 'sofa';
  const agent = new SimAgent(obj, grid, tuning, assetsById);
  const plainAction: ActionDef = { id: 'sit', name: 'Sit', needGains: {}, skillGains: {}, animation: 'sit', autonomyEligible: false, primaryNeed: null };
  agent.orderAction(plainAction, target, null, sofaDef, false);
  for (let i = 0; i < 600 && !agent.current; i++) agent.update(1 / 30);
  check('non-seat-aware action never sets groundSit', !!agent.current && !agent.current!.groundSit);
}

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall seatground tests passed');
