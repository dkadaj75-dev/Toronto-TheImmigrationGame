// accidents.test.ts — game/accidents.ts pure logic (PROJECT_CONTEXT.md §7.3 accidents slice).
// Run: npx tsx test/accidents.test.ts
import {
  accidentModifierContribution, computeAccidentChance, rollAccident,
  footprintRect, rectsOverlap,
  findAdjacentCell, findNearestFreeCell, planAccidentPlacement,
  AccidentRegistry, shouldDespawnOnCleanup, shouldRemovePlacedOnCleanup, resolveTapAssetId, isAutonomyBlocked,
  fireShouldDestroy, spreadShouldRoll, DEFAULT_FIRE_TUNING,
  type AccidentInstanceRecord,
} from '../game/accidents';
import type { AccidentRisk, StatsData } from '../game/data';
import type { EvalContext } from '../game/quests';
import type { NavGrid, Cell } from '../game/nav';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name} ${detail}`); }
}
function approx(a: number, b: number, eps = 1e-6) { return Math.abs(a - b) <= eps; }

const stats: StatsData = {
  needs: [
    { id: 'hunger', name: 'Hunger', color: '#000', default: 70, decayPerTick: 0.1, autonomy: true },
    { id: 'hygiene', name: 'Hygiene', color: '#000', default: 70, decayPerTick: 0.05, autonomy: true },
  ],
  skills: [
    { id: 'cooking', name: 'Cooking', color: '#000', default: 0, max: 10 },
    { id: 'charisma', name: 'Charisma', color: '#000', default: 0, max: 50 },
  ],
};

function ctx(overrides: Partial<EvalContext> = {}): EvalContext {
  return {
    needs: { hunger: 70, hygiene: 70 },
    skills: { cooking: 0, charisma: 0 },
    funds: 0,
    time: { hour: 8, day: 1 },
    vars: {},
    quests: {},
    ...overrides,
  };
}

console.log('accidents.test — accidentModifierContribution / computeAccidentChance (§7.3 risk formula)');
{
  const risk: AccidentRisk = {
    accidentId: 'fire', trigger: 'onUse', baseChancePercent: 2, placement: 'on',
    modifiers: [{ var: 'skills.cooking', pctAt0: 15, pctAtMax: -2 }],
  };
  check('novice cook (stat=0) → base + pctAt0', approx(computeAccidentChance(risk, ctx({ skills: { cooking: 0, charisma: 0 } }), stats), 17));
  check('master cook (stat=max) → base + pctAtMax', approx(computeAccidentChance(risk, ctx({ skills: { cooking: 10, charisma: 0 } }), stats), 0));
  check('mid-skill cook (stat=half max) → halfway lerp', approx(computeAccidentChance(risk, ctx({ skills: { cooking: 5, charisma: 0 } }), stats), 2 + (15 + (-2 - 15) * 0.5)));

  check('base only, no modifiers', approx(computeAccidentChance({ accidentId: 'x', trigger: 'onUse', baseChancePercent: 7, placement: 'on' }, ctx(), stats), 7));

  check('clamps above 100', approx(computeAccidentChance({ accidentId: 'x', trigger: 'onUse', baseChancePercent: 150, placement: 'on' }, ctx(), stats), 100));
  check('clamps below 0', approx(computeAccidentChance({ accidentId: 'x', trigger: 'onUse', baseChancePercent: -50, placement: 'on' }, ctx(), stats), 0));

  const unknownSkill: AccidentRisk = { accidentId: 'x', trigger: 'onUse', baseChancePercent: 5, placement: 'on', modifiers: [{ var: 'skills.nonexistent', pctAt0: 40, pctAtMax: -40 }] };
  check('unknown skill id contributes 0 (documented)', approx(computeAccidentChance(unknownSkill, ctx(), stats), 5));

  const unknownNamespace: AccidentRisk = { accidentId: 'x', trigger: 'onUse', baseChancePercent: 5, placement: 'on', modifiers: [{ var: 'vars.someFlag', pctAt0: 40, pctAtMax: -40 }] };
  check('non-numeric namespace (vars.*) contributes 0', approx(computeAccidentChance(unknownNamespace, ctx({ vars: { someFlag: true } }), stats), 5));

  const needsMod: AccidentRisk = { accidentId: 'x', trigger: 'onUse', baseChancePercent: 0, placement: 'on', modifiers: [{ var: 'needs.hygiene', pctAt0: 20, pctAtMax: 0 }] };
  check('needs.<id> interpolates against a fixed max of 100', approx(computeAccidentChance(needsMod, ctx({ needs: { hunger: 70, hygiene: 50 } }), stats), 20 + (0 - 20) * 0.5));

  check('accidentModifierContribution: unknown var → exactly 0', accidentModifierContribution({ var: 'skills.ghost', pctAt0: 99, pctAtMax: -99 }, ctx(), stats) === 0);

  // multiple modifiers sum together
  const multi: AccidentRisk = {
    accidentId: 'x', trigger: 'onUse', baseChancePercent: 1, placement: 'on',
    modifiers: [{ var: 'skills.cooking', pctAt0: 10, pctAtMax: 0 }, { var: 'skills.charisma', pctAt0: 5, pctAtMax: 0 }],
  };
  check('multiple modifiers sum', approx(computeAccidentChance(multi, ctx({ skills: { cooking: 0, charisma: 0 } }), stats), 1 + 10 + 5));
}

console.log('accidents.test — rollAccident (injectable rng)');
{
  check('rng below threshold → true', rollAccident(50, () => 0.1) === true);
  check('rng above threshold → false', rollAccident(50, () => 0.9) === false);
  check('0% never rolls true', rollAccident(0, () => 0) === false);
  check('100% always rolls true (rng<1)', rollAccident(100, () => 0.999999) === true);
}

console.log('accidents.test — footprintRect / rectsOverlap (§7.3 hierarchy geometry)');
{
  const r0 = footprintRect([5, 5], 0, [2, 1]);
  check('unrotated rect uses footprint as-is', approx(r0.x0, 4) && approx(r0.x1, 6) && approx(r0.z0, 4.5) && approx(r0.z1, 5.5), JSON.stringify(r0));
  const r90 = footprintRect([5, 5], 90, [2, 1]);
  check('~90° rotation swaps w/d (matches nav.ts/facing.ts convention)', approx(r90.x0, 4.5) && approx(r90.x1, 5.5) && approx(r90.z0, 4) && approx(r90.z1, 6), JSON.stringify(r90));
  const r270 = footprintRect([5, 5], 270, [2, 1]);
  check('~270° also swaps (180-mod rule)', approx(r270.x0, 4.5) && approx(r270.x1, 5.5), JSON.stringify(r270));

  const a = footprintRect([5, 5], 0, [1, 1]);
  const b = footprintRect([5.5, 5], 0, [1, 1]);
  check('overlapping rects', rectsOverlap(a, b) === true);
  const c = footprintRect([10, 10], 0, [1, 1]);
  check('far-apart rects do not overlap', rectsOverlap(a, c) === false);
  const touching = footprintRect([6, 5], 0, [1, 1]); // a spans x[4.5,5.5]; touching spans x[5.5,6.5] — edges meet exactly
  check('edge-touching rects (open interval) do not count as overlap', rectsOverlap(a, touching) === false);
}

console.log('accidents.test — findAdjacentCell / planAccidentPlacement (on/adjacent/fallback, seeded RNG)');
{
  // 7x7 all-walkable grid, cellSize 1
  function makeGrid(cols: number, rows: number, blocked: [number, number][] = []): NavGrid {
    const walkable = new Uint8Array(cols * rows).fill(1);
    for (const [c, r] of blocked) walkable[r * cols + c] = 0;
    return { cols, rows, cellSize: 1, walkable };
  }
  const grid = makeGrid(7, 7);
  const baseCell: Cell = { col: 3, row: 3 };
  const alwaysFree = () => true;

  check('adjacent: picks a cell within the requested Chebyshev range', (() => {
    const cell = findAdjacentCell(grid, baseCell, [1, 1], alwaysFree, () => 0);
    return !!cell && Math.max(Math.abs(cell.col - 3), Math.abs(cell.row - 3)) === 1;
  })());

  const firstCandidate = findAdjacentCell(grid, baseCell, [1, 2], alwaysFree, () => 0);
  const lastCandidate = findAdjacentCell(grid, baseCell, [1, 2], alwaysFree, () => 0.999999);
  check('seeded rng=0 vs rng≈1 pick different candidates deterministically', firstCandidate !== null && lastCandidate !== null && (firstCandidate.col !== lastCandidate.col || firstCandidate.row !== lastCandidate.row), JSON.stringify({ firstCandidate, lastCandidate }));

  check('range [2,2] excludes distance-1 cells', (() => {
    const cell = findAdjacentCell(grid, baseCell, [2, 2], alwaysFree, () => 0);
    return !!cell && Math.max(Math.abs(cell.col - 3), Math.abs(cell.row - 3)) === 2;
  })());

  check('no free cell (isFree always false) → null', findAdjacentCell(grid, baseCell, [1, 2], () => false, () => 0) === null);
  const nearest = findNearestFreeCell(grid, baseCell, (cell) => cell.col === 3 && cell.row === 5);
  check('nearest-free fallback expands beyond a crowded preferred ring', nearest?.col === 3 && nearest.row === 5);

  // every distance-2 neighbor of a 3x3 grid's center cell falls off the grid — a clean way to
  // prove out-of-bounds candidates are rejected (isWalkable already bounds-checks) rather than
  // silently accepted.
  const smallGrid = makeGrid(3, 3);
  check('out-of-bounds candidates are excluded (isWalkable rejects them) → null', findAdjacentCell(smallGrid, { col: 1, row: 1 }, [2, 2], alwaysFree, () => 0) === null);
  check('in-bounds distance-1 ring on the same small grid still resolves', (() => {
    const cell = findAdjacentCell(smallGrid, { col: 1, row: 1 }, [1, 1], alwaysFree, () => 0);
    return !!cell && cell.col >= 0 && cell.col < 3 && cell.row >= 0 && cell.row < 3;
  })());

  // planAccidentPlacement
  const onRisk: AccidentRisk = { accidentId: 'fire', trigger: 'onUse', baseChancePercent: 2, placement: 'on' };
  const onPlan = planAccidentPlacement(onRisk, [3.5, 3.5], grid, alwaysFree, () => 0);
  check('"on" placement always spawns at the base position', onPlan.placement === 'on' && approx(onPlan.pos[0], 3.5) && approx(onPlan.pos[1], 3.5));

  const adjRisk: AccidentRisk = { accidentId: 'water_puddle', trigger: 'onUse', baseChancePercent: 4, placement: 'adjacent', adjacentRange: [1, 1] };
  const adjPlan = planAccidentPlacement(adjRisk, [3.5, 3.5], grid, alwaysFree, () => 0);
  check('"adjacent" placement resolves to a cell 1 square away', adjPlan.placement === 'adjacent' && Math.max(Math.abs(adjPlan.pos[0] - 3.5), Math.abs(adjPlan.pos[1] - 3.5)) === 1);

  const fallbackPlan = planAccidentPlacement(adjRisk, [3.5, 3.5], grid, () => false, () => 0);
  check('"adjacent" with no free cell falls back to "on" (§7.3)', fallbackPlan.placement === 'on' && approx(fallbackPlan.pos[0], 3.5) && approx(fallbackPlan.pos[1], 3.5));
  const distantFallback = planAccidentPlacement(adjRisk, [3.5, 3.5], grid, (cell) => cell.col === 3 && cell.row === 6, () => 0);
  check('adjacent placement uses nearest-free fallback outside authored range', distantFallback.placement === 'adjacent' && distantFallback.pos[1] === 6.5);

  const defaultRangeRisk: AccidentRisk = { accidentId: 'water_puddle', trigger: 'onUse', baseChancePercent: 4, placement: 'adjacent' };
  const defaultPlan = planAccidentPlacement(defaultRangeRisk, [3.5, 3.5], grid, alwaysFree, () => 0);
  check('missing adjacentRange defaults to [1,2]', defaultPlan.placement === 'adjacent', JSON.stringify(defaultPlan));
}

console.log('accidents.test — AccidentRegistry (spawn/despawn/no-duplicate-stacking/hierarchy)');
{
  function rec(over: Partial<AccidentInstanceRecord> = {}): Omit<AccidentInstanceRecord, 'key'> {
    return { accidentId: 'fire', pos: [5, 5], rotDeg: 0, footprint: [1, 1], placement: 'on', baseKey: 'stove#A', ...over };
  }

  const reg = new AccidentRegistry();
  check('empty registry starts with no instances', reg.all.length === 0);

  const r1 = reg.spawn(rec());
  check('spawn adds an instance with a generated key', reg.all.length === 1 && r1.key === 'fire#0');

  // --- no-duplicate-stacking (§7.3)
  check('canSpawn false for the same accidentId+baseKey pairing once spawned', reg.canSpawn('fire', 'stove#A') === false);
  check('canSpawn true for a different baseKey', reg.canSpawn('fire', 'stove#B') === true);
  check('canSpawn true for a different accidentId on the SAME base (not forbidden)', reg.canSpawn('water_puddle', 'stove#A') === true);
  check('canSpawn true when baseKey is null (unknown trigger never collides)', reg.canSpawn('fire', null) === true);

  const r2 = reg.spawn(rec({ accidentId: 'water_puddle', pos: [8, 8], baseKey: 'shower#A' }));
  check('second spawn gets a fresh sequential key', r2.key === 'water_puddle#1');
  check('registry now holds 2 instances', reg.all.length === 2);

  // --- hierarchy: findBlocking is geometric, independent of baseKey
  const blocking = reg.findBlocking([5, 5], 0, [1, 1]); // same footprint as r1
  check('findBlocking finds the overlapping fire instance', blocking !== null && blocking.key === r1.key);
  const noBlock = reg.findBlocking([20, 20], 0, [1, 1]);
  check('findBlocking returns null when nothing overlaps', noBlock === null);
  const puddleBlock = reg.findBlocking([8.3, 8], 0, [1, 1]); // overlaps r2's footprint, unrelated baseKey
  check('findBlocking blocks ANY overlapping base, not just the triggering one', puddleBlock !== null && puddleBlock.key === r2.key);

  // --- decision-logic wrappers
  check('resolveTapAssetId returns the blocking accident id when blocked', resolveTapAssetId('stove', blocking) === 'fire');
  check('resolveTapAssetId returns the base id when not blocked', resolveTapAssetId('stove', null) === 'stove');
  check('isAutonomyBlocked true when blocked', isAutonomyBlocked(blocking) === true);
  check('isAutonomyBlocked false when not blocked', isAutonomyBlocked(null) === false);

  // --- cleanup despawn
  check('shouldDespawnOnCleanup true for a listed clearedBy action', shouldDespawnOnCleanup('extinguish', ['extinguish']) === true);
  check('shouldDespawnOnCleanup false for an unrelated action', shouldDespawnOnCleanup('mop', ['extinguish']) === false);
  check('shouldDespawnOnCleanup false when clearedBy is undefined', shouldDespawnOnCleanup('extinguish', undefined) === false);

  // --- ROADMAP_NEXT item 2: designer-placed puddle removal is completed-only (side_effect_rule)
  check('shouldRemovePlacedOnCleanup true for a completed clearedBy action', shouldRemovePlacedOnCleanup(true, 'mop', ['mop']) === true);
  check('shouldRemovePlacedOnCleanup false for a CANCELLED clearedBy action (puddle survives)', shouldRemovePlacedOnCleanup(false, 'mop', ['mop']) === false);
  check('shouldRemovePlacedOnCleanup false for a completed but non-clearing action', shouldRemovePlacedOnCleanup(true, 'sit', ['mop']) === false);
  check('shouldRemovePlacedOnCleanup false when clearedBy is undefined', shouldRemovePlacedOnCleanup(true, 'mop', undefined) === false);

  const despawned = reg.despawn(r1.key);
  check('despawn removes and returns the record', despawned?.key === r1.key && reg.all.length === 1);
  check('despawning an unknown key returns null and is a no-op', reg.despawn('ghost#99') === null && reg.all.length === 1);
  check('findBlocking no longer finds the despawned fire', reg.findBlocking([5, 5], 0, [1, 1]) === null);

  // --- serialize/restore round-trip
  reg.spawn(rec({ accidentId: 'fire', pos: [1, 1], baseKey: 'stove#C' }));
  const snapshot = reg.serialize();
  check('serialize produces a plain JSON-cloneable shape', JSON.stringify(JSON.parse(JSON.stringify(snapshot))) === JSON.stringify(snapshot));

  const reg2 = new AccidentRegistry();
  reg2.restore(snapshot);
  check('restore reproduces the exact same instances', JSON.stringify(reg2.all) === JSON.stringify(reg.all));
  check('restore reproduces the seq counter (next spawn keys continue, no collision)', (() => {
    const before = reg2.all.length;
    const spawned = reg2.spawn(rec({ accidentId: 'fire', baseKey: 'stove#D' }));
    return reg2.all.length === before + 1 && !reg.all.some((i) => i.key === spawned.key);
  })());

  // mutating the restored registry must not affect the original snapshot object (deep copy, not shared refs)
  const snapshotCountBefore = snapshot.instances.length;
  const reg3 = new AccidentRegistry();
  reg3.restore(snapshot);
  reg3.despawn(reg3.all[0].key);
  check('restore deep-copies — mutating the restored registry leaves the original snapshot untouched', snapshot.instances.length === snapshotCountBefore && reg3.all.length === snapshotCountBefore - 1);
}

console.log('accidents.test — fireShouldDestroy / spreadShouldRoll (ROADMAP_NEXT item 6 pure math)');
{
  check('DEFAULT_FIRE_TUNING matches the documented fallback', DEFAULT_FIRE_TUNING.burnSeconds === 30 && DEFAULT_FIRE_TUNING.spreadRadius === 2);

  check('fireShouldDestroy false before burnSeconds elapses', fireShouldDestroy(0, 29, 30) === false);
  check('fireShouldDestroy true exactly at burnSeconds', fireShouldDestroy(0, 30, 30) === true);
  check('fireShouldDestroy true well past burnSeconds', fireShouldDestroy(100, 200, 30) === true);
  check('fireShouldDestroy respects a non-zero bornAt (not just elapsed-since-0)', fireShouldDestroy(50, 79, 30) === false && fireShouldDestroy(50, 80, 30) === true);

  check('spreadShouldRoll false once already rolled, regardless of everything else', spreadShouldRoll(true, 0, 10, 0, 100, 0) === false);
  check('spreadShouldRoll false when candidate is out of radius', spreadShouldRoll(false, 3, 2, 0, 100, 0) === false);
  check('spreadShouldRoll false before the candidate\'s own delaySeconds has elapsed', spreadShouldRoll(false, 1, 2, 0, 5, 10) === false);
  check('spreadShouldRoll true exactly at delaySeconds, in range, not yet rolled', spreadShouldRoll(false, 1, 2, 0, 10, 10) === true);
  check('spreadShouldRoll true well past delaySeconds', spreadShouldRoll(false, 1, 2, 0, 999, 10) === true);
  check('spreadShouldRoll true at the exact radius boundary (inclusive)', spreadShouldRoll(false, 2, 2, 0, 10, 10) === true);
}

console.log('accidents.test — AccidentRegistry fire bookkeeping (destroyedBase / spreadRolled, ROADMAP_NEXT item 6)');
{
  const reg = new AccidentRegistry();
  const fire = reg.spawn({ accidentId: 'fire', pos: [1, 1], rotDeg: 0, footprint: [1, 1], placement: 'on', baseKey: 'stove#A', bornAt: 0 });

  // --- spreadRolled: one-time roll bookkeeping, scoped per (fireKey, candidateKey)
  check('hasRolledSpread false before any roll', reg.hasRolledSpread(fire.key, 'sofa#A') === false);
  reg.markSpreadRolled(fire.key, 'sofa#A');
  check('hasRolledSpread true after marking', reg.hasRolledSpread(fire.key, 'sofa#A') === true);
  check('a different candidate under the same fire is unaffected', reg.hasRolledSpread(fire.key, 'sofa#B') === false);
  check('the same candidate under a DIFFERENT fire key is unaffected (scoped per fire)', reg.hasRolledSpread('fire#999', 'sofa#A') === false);

  // --- despawning a fire clears its spreadRolled bookkeeping (no more meaning once it's gone)
  reg.despawn(fire.key);
  check('despawn clears spreadRolled for that fire key', reg.hasRolledSpread(fire.key, 'sofa#A') === false);

  // --- destroyedBase: a burned-down spot can never spawn anything again, any accidentId
  check('isDestroyed false before marking', reg.isDestroyed('stove#A') === false);
  check('canSpawn true for a fresh baseKey before destruction', reg.canSpawn('fire', 'stove#A') === true);
  reg.markDestroyed('stove#A');
  check('isDestroyed true after marking', reg.isDestroyed('stove#A') === true);
  check('canSpawn false for ANY accidentId on a destroyed baseKey (fire)', reg.canSpawn('fire', 'stove#A') === false);
  check('canSpawn false for ANY accidentId on a destroyed baseKey (water_puddle too)', reg.canSpawn('water_puddle', 'stove#A') === false);
  check('a different, non-destroyed baseKey is unaffected', reg.canSpawn('fire', 'stove#B') === true);

  // --- serialize/restore round-trip carries the new fire-bookkeeping fields
  const reg2 = new AccidentRegistry();
  const fire2 = reg2.spawn({ accidentId: 'fire', pos: [2, 2], rotDeg: 0, footprint: [1, 1], placement: 'on', baseKey: 'bed#A', bornAt: 5 });
  reg2.markSpreadRolled(fire2.key, 'bookshelf#A');
  reg2.markDestroyed('stove#Z');
  const snap = reg2.serialize();
  check('serialize includes destroyedBase', JSON.stringify(snap.destroyedBase) === JSON.stringify(['stove#Z']));
  check('serialize includes spreadRolled', JSON.stringify(snap.spreadRolled) === JSON.stringify([[fire2.key, ['bookshelf#A']]]));
  check('serialize produces a plain JSON-cloneable shape (fire fields included)', JSON.stringify(JSON.parse(JSON.stringify(snap))) === JSON.stringify(snap));

  const reg3 = new AccidentRegistry();
  reg3.restore(snap);
  check('restore reproduces isDestroyed', reg3.isDestroyed('stove#Z') === true);
  check('restore reproduces hasRolledSpread', reg3.hasRolledSpread(fire2.key, 'bookshelf#A') === true);
  check('restore rejects canSpawn for the restored destroyed baseKey', reg3.canSpawn('fire', 'stove#Z') === false);

  // --- old-shape save state (pre-item-6, no destroyedBase/spreadRolled keys) restores cleanly
  const reg4 = new AccidentRegistry();
  reg4.restore({ instances: [], seq: 0 } as any);
  check('restoring a pre-fire save shape (missing destroyedBase/spreadRolled) does not throw and starts clean', reg4.isDestroyed('anything') === false && reg4.all.length === 0);

  // --- bornAt round-trips through spawn/serialize like any other field
  check('spawned fire instance carries bornAt', fire.bornAt === 0 && fire2.bornAt === 5);
}

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall accidents tests passed');
