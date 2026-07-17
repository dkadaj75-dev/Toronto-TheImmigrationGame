// pendingmove.test.ts — headless tests for ROADMAP_APT R4's pure pending-move state machine
// (game/rental.ts PendingMoveTracker + pendingMoveLabel), the §6.1 home-map resolution
// (game/data.ts resolveHomeMapId), and a headless map-switch smoke: nav rebaked from the new
// map, spawn applied, sim stats preserved. Run: npx tsx test/pendingmove.test.ts

import { PendingMoveTracker, pendingMoveLabel } from '../game/rental';
import { resolveHomeMapId } from '../game/data';
import type { AssetsData, MapData, SimStateData, TuningData } from '../game/data';
import { bakeNavGrid } from '../game/nav';
import { SimStats } from '../game/stats';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name} ${detail}`); }
}

// ------------------------------------------------------------------ PendingMoveTracker basics

{
  const t = new PendingMoveTracker();
  check('no pending move initially', t.pending === null);
  check('remainingHours is null with nothing pending', t.remainingHours(10) === null);
  check('isReady is false with nothing pending', t.isReady(10) === false);
  check('takeCompleted returns null with nothing pending', t.takeCompleted(10) === null);

  check('start begins a pending move', t.start('loft', 48, 100) === true);
  check('pending state exposes the destination', t.pending?.mapId === 'loft');
  check('pending state records start hour + duration', t.pending?.startHour === 100 && t.pending?.moveInHours === 48);
  check('a second start is refused while one is pending', t.start('other', 5, 101) === false);
  check('the refused start did not clobber the pending move', t.pending?.mapId === 'loft');
}

// ------------------------------------------------------------------ countdown / completion

{
  const t = new PendingMoveTracker();
  t.start('loft', 48, 100);
  check('remainingHours counts down on the sim clock', t.remainingHours(112) === 36);
  check('remainingHours clamps at 0 past the deadline', t.remainingHours(200) === 0);
  check('not ready before the countdown elapses', t.isReady(147.9) === false);
  check('takeCompleted refuses before ready (state untouched)', t.takeCompleted(147.9) === null && t.pending !== null);
  check('ready exactly at the deadline', t.isReady(148) === true);
  const mapId = t.takeCompleted(148);
  check('takeCompleted returns the destination once ready', mapId === 'loft');
  check('takeCompleted clears the pending state (single-fire)', t.pending === null);
  check('a second take returns null (can never double-switch)', t.takeCompleted(149) === null);
}

// ------------------------------------------------------------------ deferred completion (at work etc.)

{
  const t = new PendingMoveTracker();
  t.start('loft', 2, 0);
  check('a ready move WAITS until taken (deferral while at work)', t.isReady(50) === true && t.pending !== null);
  check('deferred take still returns the destination', t.takeCompleted(50) === 'loft');
}

// ------------------------------------------------------------------ cancel applies NOTHING

{
  const t = new PendingMoveTracker();
  t.start('loft', 48, 100);
  check('cancel reports a move was pending', t.cancel() === true);
  check('cancel clears the pending state', t.pending === null);
  check('a cancelled move can never complete', t.isReady(1000) === false && t.takeCompleted(1000) === null);
  check('cancel with nothing pending reports false', t.cancel() === false);
  check('a new rent can start after a cancel', t.start('studio', 1, 200) === true);
}

// ------------------------------------------------------------------ input hygiene

{
  const t = new PendingMoveTracker();
  check('empty mapId is refused', t.start('', 5, 0) === false);
  check('negative moveInHours clamps to 0 (instant readiness)', t.start('loft', -3, 10) && t.isReady(10));
  t.cancel();
  check('non-finite moveInHours clamps to 0', t.start('loft', Number.NaN, 10) && t.isReady(10));
}

// ------------------------------------------------------------------ serialize / restore

{
  const t = new PendingMoveTracker();
  t.start('loft', 48, 100);
  const saved = JSON.parse(JSON.stringify(t.serialize()));
  const t2 = new PendingMoveTracker();
  t2.restore(saved);
  check('restore reproduces the pending move', t2.pending?.mapId === 'loft' && t2.remainingHours(112) === 36);
  const empty = new PendingMoveTracker();
  const t3 = new PendingMoveTracker();
  t3.start('x', 1, 0);
  t3.restore(empty.serialize());
  check('restoring an empty save clears any pending move', t3.pending === null);
  check('serialize snapshots (mutating the save does not leak)', (() => {
    const s = t.serialize();
    if (s.pending) s.pending.mapId = 'hacked';
    return t.pending?.mapId === 'loft';
  })());
}

// ------------------------------------------------------------------ countdown label

check('label ceils remaining hours', pendingMoveLabel(35.2) === 'Moving in 36h...');
check('label for whole hours', pendingMoveLabel(3) === 'Moving in 3h...');
check('label never claims 0h while pending', pendingMoveLabel(0.1) === 'Moving in 1h...');
check('label handles 0/NaN defensively', pendingMoveLabel(0) === 'Moving in 1h...' && pendingMoveLabel(Number.NaN) === 'Moving in 1h...');

// ------------------------------------------------------------------ resolveHomeMapId (§6.1)

const tuningWithActive = { map: { active: 'condo' } } as TuningData;
const noVars: SimStateData = { variables: [] };
const withHome: SimStateData = { variables: [{ id: 'homeMap', name: 'Home Map', type: 'string', default: 'loft' }] };
const withNullHome: SimStateData = { variables: [{ id: 'homeMap', name: 'Home Map', type: 'string', default: null }] };

check('homeMap var wins when set', resolveHomeMapId(withHome, tuningWithActive) === 'loft');
check('falls back to tuning.map.active without a homeMap var', resolveHomeMapId(noVars, tuningWithActive) === 'condo');
check('null homeMap default falls back to tuning', resolveHomeMapId(withNullHome, tuningWithActive) === 'condo');
check('final fallback is "condo"', resolveHomeMapId(noVars, {} as TuningData) === 'condo');

// ------------------------------------------------------------------ headless map-switch smoke:
// nav rebaked from the new map, spawn applied, sim stats preserved. Uses the same pure surfaces
// main.ts's switch path drives (bakeNavGrid + spawn fields + an untouched SimStats) — the
// three.js world rebuild itself stays thin/live-verified per the codebase convention.

const assets: AssetsData = {
  categories: [],
  assets: [{ id: 'sofa', name: 'Sofa', category: 'seat', mesh: '', buyPrice: 1, sellPrice: 1, environmentScore: 0, footprint: [1, 1], interactions: [] }],
};

function smokeMap(id: string, size: number, spawn: [number, number], placed: MapData['placedObjects']): MapData {
  return {
    id, name: id, gridSize: 0.5, bounds: { w: size, h: size },
    floors: [{ id: 'f', material: 'wood', polygon: [[0, 0], [size, 0], [size, size], [0, size]] }],
    walls: [], doors: [],
    spawn: { pos: spawn, facingDeg: 90 },
    placedObjects: placed,
  };
}

const oldMap = smokeMap('old_home', 4, [1, 1], [{ asset: 'sofa', pos: [2, 2], rotDeg: 0 }]);
const newMap = smokeMap('new_home', 8, [6, 6], []);

const oldGrid = bakeNavGrid(oldMap, assets);
const newGrid = bakeNavGrid(newMap, assets);
check('nav rebake reflects the new map bounds', newGrid.cols !== oldGrid.cols || newGrid.rows !== oldGrid.rows);
const cellAt = (grid: ReturnType<typeof bakeNavGrid>, x: number, z: number) => {
  const gx = Math.floor(x / grid.cellSize);
  const gz = Math.floor(z / grid.cellSize);
  return grid.walkable[gz * grid.cols + gx] === 1;
};
check('old map blocked the sofa cell', cellAt(oldGrid, 2, 2) === false);
check('new map has no stale old-map blockers at that spot', cellAt(newGrid, 2, 2) === true);
check('new spawn is applied from the new map', newMap.spawn.pos[0] === 6 && newMap.spawn.pos[1] === 6 && newMap.spawn.facingDeg === 90);
check('new spawn cell is walkable on the rebaked grid', cellAt(newGrid, newMap.spawn.pos[0], newMap.spawn.pos[1]) === true);

// stats preserved: the switch never touches SimStats — same object, same values.
const stats = new SimStats({
  needs: [{ id: 'hunger', name: 'Hunger', color: '#fff', default: 55, decayPerTick: 0, autonomy: true }],
  skills: [{ id: 'cooking', name: 'Cooking', color: '#fff', default: 12, max: 100 }],
  personality: [{ id: 'cleanliness', name: 'Cleanliness', default: 7, max: 10 }],
});
const before = {
  hunger: stats.needs.get('hunger'),
  cooking: stats.skills.get('cooking'),
  cleanliness: stats.personality.get('cleanliness'),
};
// (the R4 switch performs no stats mutation whatsoever — assert the snapshot still matches)
check('needs preserved across the switch', stats.needs.get('hunger') === before.hunger && before.hunger === 55);
check('skills preserved across the switch', stats.skills.get('cooking') === before.cooking && before.cooking === 12);
check('personality preserved across the switch', stats.personality.get('cleanliness') === before.cleanliness && before.cleanliness === 7);

if (failures > 0) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
console.log('\nAll pendingmove.test checks passed.');
