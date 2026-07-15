// garbage.test.ts — game/garbage.ts pure logic (ROADMAP_NEXT item 10).
// Run: npx tsx test/garbage.test.ts
// Only the pure half is unit-tested here (GarbageRegistry, findNearestNonFullCan,
// decideWasteHandling) — GarbageController's three.js layer (world-scanning, spawnTransient
// delegation) is sanity-checked by wiring/dev-server verification instead, same convention as
// AccidentsController/BuyModeController/doors.ts's own three.js layers.
import { GarbageRegistry, findNearestNonFullCan, decideWasteHandling, DEFAULT_GARBAGE_TUNING, type CanCandidate } from '../game/garbage';

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

  check('DEFAULT_GARBAGE_TUNING matches the roadmap-specified defaults',
    DEFAULT_GARBAGE_TUNING.autoTidyRadius === 4 && DEFAULT_GARBAGE_TUNING.cleanlinessThreshold === 5 && DEFAULT_GARBAGE_TUNING.cleanlinessVar === 'cleanliness');
}

if (failures > 0) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
console.log('\nALL GARBAGE TESTS PASSED');
