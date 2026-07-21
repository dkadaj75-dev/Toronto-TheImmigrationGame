// occupancy.test.ts — New.txt #5 pure seat/lie location occupancy (game/occupancy.ts).
// Covers closest-free selection, claim/steal rules, one-slot-per-instance, release-all-on-stop,
// and save round-tripping. Run: npx tsx test/occupancy.test.ts

import { OccupancyRegistry, pickClosestFreeLocation, type LocationCandidate } from '../game/occupancy';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name} ${detail}`); }
}

// A three-cushion couch laid out along local X.
const cushions: LocationCandidate[] = [
  { index: 0, pos: [-0.6, 0] },
  { index: 1, pos: [0, 0] },
  { index: 2, pos: [0.6, 0] },
];

// --- closest-free selection
check('picks the nearest free location', pickClosestFreeLocation(cushions, [0.55, 0], new Set()) === 2);
check('a claimed nearest is skipped for the next nearest', pickClosestFreeLocation(cushions, [0.55, 0], new Set([2])) === 1);
check('all-claimed returns null', pickClosestFreeLocation(cushions, [0, 0], new Set([0, 1, 2])) === null);
check('ties break toward the lower index', pickClosestFreeLocation(cushions, [0, 0], new Set([1])) === 0);
check('single-location asset always resolves index 0 when free',
  pickClosestFreeLocation([{ index: 0, pos: [3, 3] }], [0, 0], new Set()) === 0);
check('single-location asset resolves null when its one slot is taken',
  pickClosestFreeLocation([{ index: 0, pos: [3, 3] }], [0, 0], new Set([0])) === null);

// --- claim / availability
const reg = new OccupancyRegistry();
const key = 'designer:7';
check('a fresh instance has no claimed indices', reg.claimedIndices(key).size === 0);
check('claiming succeeds and marks the slot', reg.claim(key, 2, 'player') && !reg.isFree(key, 2));
check('claimedIndices reflects the claim', reg.claimedIndices(key).has(2) && reg.claimedIndices(key).size === 1);
check('another occupant cannot steal a held slot', reg.claim(key, 2, 'amara') === false && reg.occupantAt(key, 2) === 'player');
check('re-claiming the same slot by the same occupant is idempotent', reg.claim(key, 2, 'player') && reg.claimedIndices(key).size === 1);

// two sims arriving pick DIFFERENT closest-free cushions
const claimedNow = reg.claimedIndices(key);
const npcPick = pickClosestFreeLocation(cushions, [-0.55, 0], claimedNow);
check('a second sim picks a different free cushion', npcPick === 0 && npcPick !== 2);
reg.claim(key, npcPick!, 'amara');
check('both cushions are now held by distinct occupants',
  reg.occupantAt(key, 2) === 'player' && reg.occupantAt(key, 0) === 'amara' && reg.claimedIndices(key).size === 2);

// --- one location per instance per occupant
reg.claim(key, 1, 'player'); // player moves to the middle cushion
check('claiming a new slot releases the occupant\'s previous slot on the same instance',
  reg.occupantAt(key, 1) === 'player' && reg.isFree(key, 2));
check('the other occupant is untouched by that move', reg.occupantAt(key, 0) === 'amara');

// --- release-all on stop
reg.releaseOccupant('player');
check('releaseOccupant frees everything the occupant held', reg.isFree(key, 1) && reg.occupantAt(key, 0) === 'amara');
reg.releaseOccupant('ghost'); // unknown occupant — no throw, no-op
check('releasing an unknown occupant is a safe no-op', reg.claimedIndices(key).size === 1);

// an occupant may hold locations on DIFFERENT instances at once
reg.claim('designer:9', 0, 'amara');
check('an occupant can hold one slot on each of two instances',
  reg.occupantAt(key, 0) === 'amara' && reg.occupantAt('designer:9', 0) === 'amara');
reg.releaseOccupant('amara');
check('releaseOccupant clears the occupant across every instance',
  reg.claimedIndices(key).size === 0 && reg.claimedIndices('designer:9').size === 0);

// --- save round-trip
const reg2 = new OccupancyRegistry();
reg2.claim('designer:1', 0, 'player');
reg2.claim('designer:1', 1, 'amara');
reg2.claim('designer:3', 2, 'player');
const saved = reg2.serialize();
check('serialize captures every claim', saved.claims['designer:1']['0'] === 'player'
  && saved.claims['designer:1']['1'] === 'amara' && saved.claims['designer:3']['2'] === 'player');
const restored = new OccupancyRegistry();
restored.restore(saved);
check('restore round-trips the claims',
  restored.occupantAt('designer:1', 0) === 'player' && restored.occupantAt('designer:1', 1) === 'amara'
  && restored.occupantAt('designer:3', 2) === 'player');
check('a restored occupant is still tracked for release-all', (() => {
  restored.releaseOccupant('player');
  return restored.isFree('designer:1', 0) && restored.isFree('designer:3', 2) && restored.occupantAt('designer:1', 1) === 'amara';
})());
check('restoring undefined clears the registry', (() => { restored.restore(undefined); return restored.claimedIndices('designer:1').size === 0; })());

if (failures > 0) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
console.log('\nall occupancy checks passed');
