// garbage.test.ts — game/garbage.ts pure logic (ROADMAP_NEXT item 10).
// Run: npx tsx test/garbage.test.ts
// Only the pure half is unit-tested here (GarbageRegistry, findNearestNonFullCan,
// decideWasteHandling) — GarbageController's three.js layer (world-scanning, spawnTransient
// delegation) is sanity-checked by wiring/dev-server verification instead, same convention as
// AccidentsController/BuyModeController/doors.ts's own three.js layers.
import {
  GarbageRegistry, findNearestNonFullCan, decideWasteHandling, wasteItemCount, DEFAULT_GARBAGE_TUNING, type CanCandidate,
  garbageFillRatio, shouldShowFillBar, garbageFillBarGeometry, DEFAULT_GARBAGE_FILLBAR,
  chooseFullestCan, fillBarOccluded, depositOneAtNearestCan,
} from '../game/garbage';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name} ${detail}`); }
}

console.log('garbage.test — GarbageRegistry');
{
  const reg = new GarbageRegistry();
  check('fresh can fillOf is 0', reg.fillOf('can#0') === 0);
  check('fresh can is not full (capacity 10)', reg.isFull('can#0', 10) === false);

  check('deposit succeeds while under capacity', reg.deposit('can#0', 2) === true);
  check('fill is now 1', reg.fillOf('can#0') === 1);
  check('deposit succeeds again', reg.deposit('can#0', 2) === true);
  check('fill is now 2 (== capacity)', reg.fillOf('can#0') === 2);
  check('can now reports full', reg.isFull('can#0', 2) === true);
  check('deposit past capacity is a no-op, returns false', reg.deposit('can#0', 2) === false);
  check('fill stays at 2 after the rejected deposit', reg.fillOf('can#0') === 2);

  reg.deposit('can#1', 5);
  check('a second can tracks independently', reg.fillOf('can#1') === 1 && reg.fillOf('can#0') === 2);

  reg.emptyAll();
  check('emptyAll resets every can (seen or not) to 0', reg.fillOf('can#0') === 0 && reg.fillOf('can#1') === 0 && reg.fillOf('can#never-seen') === 0);

  // serialize/restore round trip
  reg.deposit('can#0', 10);
  reg.deposit('can#0', 10);
  reg.deposit('can#1', 10);
  const saved = reg.serialize();
  const reg2 = new GarbageRegistry();
  reg2.restore(saved);
  check('restore round-trips fill counts', reg2.fillOf('can#0') === 2 && reg2.fillOf('can#1') === 1);
  check('restore with an absent/undefined fills array falls back to empty (no throw)', (() => {
    const reg3 = new GarbageRegistry();
    reg3.restore({ fills: undefined as any });
    return reg3.fillOf('anything') === 0;
  })());
}

console.log('garbage.test — completed throw-away capacity');
{
  const reg = new GarbageRegistry();
  const cans: CanCandidate[] = [
    { key: 'near-full', pos: [1, 0], capacity: 1 },
    { key: 'far-open', pos: [4, 0], capacity: 2 },
  ];
  check('first thrown-away item fills the nearest can by one',
    depositOneAtNearestCan(reg, [0, 0], cans) === 'near-full' && reg.fillOf('near-full') === 1);
  check('next item skips the newly-full can and fills another',
    depositOneAtNearestCan(reg, [0, 0], cans) === 'far-open' && reg.fillOf('far-open') === 1);
  reg.deposit('far-open', 2);
  const before = reg.serialize();
  check('all-full refusal returns null and changes no capacity',
    depositOneAtNearestCan(reg, [0, 0], cans) === null
      && JSON.stringify(reg.serialize()) === JSON.stringify(before));
}

console.log('garbage.test — findNearestNonFullCan');
{
  const cans: CanCandidate[] = [
    { key: 'near', pos: [1, 0], capacity: 5 },
    { key: 'far', pos: [10, 0], capacity: 5 },
    { key: 'nearest-but-full', pos: [0.5, 0], capacity: 1 },
  ];
  const fillOf = (k: string) => (k === 'nearest-but-full' ? 1 : 0); // full
  const result = findNearestNonFullCan([0, 0], cans, fillOf);
  check('picks the nearest NON-full can, skipping a closer full one', result?.key === 'near', JSON.stringify(result));
  check('reports the correct distance', result !== null && Math.abs(result.dist - 1) < 1e-9);

  const allFull = findNearestNonFullCan([0, 0], cans, () => 999);
  check('every can full → null', allFull === null);

  const none = findNearestNonFullCan([0, 0], [], () => 0);
  check('no cans at all → null', none === null);

  // ROADMAP_NEXT B3-5: main.ts's GarbageController.nearestNonFullCanPos is a thin wrapper around
  // this exact function (just plucking `.pos` off the result) to get a walk target for the sim's
  // "carry to garbage" order — assert the position it hands back is the can's own, not some
  // recomputed/rounded value, since that position feeds agent.goTo() directly.
  check("nearest result's pos is the can's own position (feeds agent.goTo directly)",
    result !== null && result.pos[0] === 1 && result.pos[1] === 0, JSON.stringify(result));
}

console.log('garbage.test — decideWasteHandling');
{
  const tuning = { autoTidyRadius: 4, cleanlinessThreshold: 5 };
  const nearCan: CanCandidate[] = [{ key: 'c1', pos: [2, 0], capacity: 5 }];
  const farCan: CanCandidate[] = [{ key: 'c1', pos: [100, 0], capacity: 5 }];
  const empty = (_k: string) => 0;

  const auto = decideWasteHandling([0, 0], nearCan, empty, 8, tuning);
  check('within radius + clean enough → auto', auto.kind === 'auto' && auto.canKey === 'c1', JSON.stringify(auto));

  const dropFar = decideWasteHandling([0, 0], farCan, empty, 8, tuning);
  check('can too far → drop even though clean enough', dropFar.kind === 'drop', JSON.stringify(dropFar));

  const dropDirty = decideWasteHandling([0, 0], nearCan, empty, 2, tuning);
  check('can reachable but cleanliness below threshold → drop', dropDirty.kind === 'drop', JSON.stringify(dropDirty));

  const atThreshold = decideWasteHandling([0, 0], nearCan, empty, 5, tuning);
  check('cleanliness exactly at threshold → auto (>=, not >)', atThreshold.kind === 'auto', JSON.stringify(atThreshold));

  const undefinedCleanliness = decideWasteHandling([0, 0], nearCan, empty, undefined, tuning);
  check('cleanliness stat missing entirely → conservative drop', undefinedCleanliness.kind === 'drop', JSON.stringify(undefinedCleanliness));

  const noCanAtAll = decideWasteHandling([0, 0], [], empty, 10, tuning);
  check('no cans anywhere → drop', noCanAtAll.kind === 'drop');

  const allFullNearby = decideWasteHandling([0, 0], nearCan, () => 999, 10, tuning);
  check('the only nearby can is full → drop', allFullNearby.kind === 'drop');

  // item 1 fix: an ABANDONED carried-food item is routed through this exact waste pipeline (main.ts
  // dropActiveFood → handleProducedWaste → decideWasteHandling), so a dropped snack/meal near a
  // clean sim auto-tidies into the can instead of leaving any transient behind — no longer a
  // self-perishing uncleanable food blob.
  const droppedFoodWaste = decideWasteHandling([0, 0], nearCan, empty, 8, tuning);
  check('abandoned-food waste auto-tidies into a nearby can when the sim is clean', droppedFoodWaste.kind === 'auto');

  check('DEFAULT_GARBAGE_TUNING matches the roadmap-specified defaults',
    DEFAULT_GARBAGE_TUNING.autoTidyRadius === 4 && DEFAULT_GARBAGE_TUNING.cleanlinessThreshold === 5 && DEFAULT_GARBAGE_TUNING.cleanlinessVar === 'cleanliness');
}

console.log('garbage.test - tunable waste amount');
{
  const stats = { needs: [], skills: [], personality: [{ id: 'cleanliness', name: 'Cleanliness', default: 5, max: 10 }] };
  const base = { needs: {}, skills: {}, personality: { cleanliness: 0 }, funds: 0, time: { hour: 0, day: 1 }, vars: {}, quests: {} };
  const tuning = { extraChanceVar: 'personality.cleanliness', extraAtMin: 1, extraAtMax: 0 };
  check('minimum cleanliness guarantees one extra item', wasteItemCount(tuning, base, stats, () => 0.999) === 2);
  check('maximum cleanliness produces baseline only', wasteItemCount(tuning, { ...base, personality: { cleanliness: 10 } }, stats, () => 0) === 1);
  check('mid cleanliness lerps to 50% extra chance', wasteItemCount(tuning, { ...base, personality: { cleanliness: 5 } }, stats, () => 0.49) === 2
    && wasteItemCount(tuning, { ...base, personality: { cleanliness: 5 } }, stats, () => 0.5) === 1);
  check('missing mapping preserves one baseline item', wasteItemCount(undefined, base, stats, () => 0) === 1);
}

console.log('garbage.test — fill-bar pure logic (designer request, 2026-07-16)');
{
  check('empty can → ratio 0', garbageFillRatio(0, 5) === 0);
  check('half-full can → ratio 0.5', garbageFillRatio(2, 4) === 0.5);
  check('full can → ratio 1', garbageFillRatio(5, 5) === 1);
  check('over-full (should not normally happen) clamps to ratio 1', garbageFillRatio(7, 5) === 1);
  check('zero capacity guards against divide-by-zero, reports empty', garbageFillRatio(3, 0) === 0);
  check('negative capacity (misconfigured) also reports empty, no throw', garbageFillRatio(3, -1) === 0);

  check('ratio 0 + showWhenEmpty false → hidden', shouldShowFillBar(0, false) === false);
  check('ratio 0 + showWhenEmpty true → shown', shouldShowFillBar(0, true) === true);
  check('ratio > 0 + showWhenEmpty false → shown', shouldShowFillBar(0.01, false) === true);
  check('ratio > 0 + showWhenEmpty true → shown', shouldShowFillBar(0.5, true) === true);
  check('ratio 1 always shown regardless of showWhenEmpty', shouldShowFillBar(1, false) === true && shouldShowFillBar(1, true) === true);

  const W = DEFAULT_GARBAGE_FILLBAR.widthMeters, H = DEFAULT_GARBAGE_FILLBAR.heightMeters;
  const zero = garbageFillBarGeometry(W, H, 0);
  const half = garbageFillBarGeometry(W, H, 0.5);
  const full = garbageFillBarGeometry(W, H, 1);
  check('progress 0 → zero fill width', zero.scaleX === 0);
  check('progress 1 → full fill width is wider than progress 0.5', full.scaleX > half.scaleX && half.scaleX > zero.scaleX);
  check('innerHeight is stable across ratio (only depends on heightMeters)', zero.innerHeight === half.innerHeight && half.innerHeight === full.innerHeight);
  check('geometry values match progressbar.ts\'s own fillScaleX/fillCenterX exactly (reused, not reimplemented)',
    (() => {
      const overshoot = garbageFillBarGeometry(W, H, 1.7); // out-of-range ratio should clamp the same way fillScaleX does
      return overshoot.scaleX === full.scaleX;
    })());

  check('DEFAULT_GARBAGE_FILLBAR ships sane positive dimensions and hidden-when-empty default',
    DEFAULT_GARBAGE_FILLBAR.widthMeters > 0 && DEFAULT_GARBAGE_FILLBAR.heightMeters > 0 && DEFAULT_GARBAGE_FILLBAR.showWhenEmpty === false);
}

console.log('garbage.test — chooseFullestCan (ITEM 3 put-trash-out routing)');
{
  const cans: CanCandidate[] = [
    { key: 'a', pos: [0, 0], capacity: 10 },
    { key: 'b', pos: [1, 0], capacity: 10 },
    { key: 'c', pos: [5, 0], capacity: 10 },
  ];
  const sim: [number, number] = [0, 0];

  check('all-empty → null (nothing to collect)', chooseFullestCan(sim, cans, () => 0) === null);
  check('no cans → null', chooseFullestCan(sim, [], () => 5) === null);

  const fills1 = new Map([['a', 2], ['b', 7], ['c', 4]]);
  const fullest = chooseFullestCan(sim, cans, (k) => fills1.get(k) ?? 0);
  check('picks the fullest can regardless of distance', fullest?.key === 'b', `got ${fullest?.key}`);
  check('reports that can\'s fill', fullest?.fill === 7);

  // tie on fill (both 5) → nearest to sim wins (a at dist 0 beats b at dist 1)
  const fills2 = new Map([['a', 5], ['b', 5], ['c', 1]]);
  const tie = chooseFullestCan(sim, cans, (k) => fills2.get(k) ?? 0);
  check('fill tie broken by nearest', tie?.key === 'a', `got ${tie?.key}`);

  // a zero-fill can is never chosen even if nearest
  const fills3 = new Map([['a', 0], ['c', 3]]);
  const skipEmpty = chooseFullestCan(sim, cans, (k) => fills3.get(k) ?? 0);
  check('zero-fill nearest can is skipped for the only filled can', skipEmpty?.key === 'c');
}

console.log('garbage.test — fillBarOccluded (ITEM 1 fill-bar occlusion)');
{
  check('no hit before the anchor → not occluded', fillBarOccluded(null, 10) === false);
  check('hit clearly closer than the anchor → occluded', fillBarOccluded(3, 10) === true);
  check('hit essentially AT the anchor (within eps) → not occluded', fillBarOccluded(9.99, 10, 0.05) === false);
  check('hit just inside eps of the anchor → not occluded', fillBarOccluded(9.96, 10, 0.05) === false);
  check('hit just beyond eps (closer) → occluded', fillBarOccluded(9.9, 10, 0.05) === true);
}

if (failures > 0) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
console.log('\nALL GARBAGE TESTS PASSED');
