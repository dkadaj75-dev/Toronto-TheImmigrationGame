import { actionConnectionIssues, actionGraphIssues, carriesSpawnedProduct, describeActionFlow, nearestRequiredAsset, requiresAssetPresence, resolvedFollowUpActionId } from '../game/actionchain';
import type { ActionDef, AssetDef } from '../game/data';
import { readFileSync } from 'node:fs';

let failures = 0;
function check(name: string, condition: boolean) {
  if (condition) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name}`); }
}

console.log('actionchain.test — required assets and spawned follow-ups');
const candidates = [
  { assetId: 'fridge', pos: [4, 0] as [number, number], value: 'far' },
  { assetId: 'fridge', pos: [1, 0] as [number, number], value: 'near' },
  { assetId: 'sink', pos: [0.5, 0] as [number, number], value: 'wrong-kind' },
];
check('nearest matching required asset wins', nearestRequiredAsset([0, 0], { assetId: 'fridge', radiusMeters: 5 }, candidates)?.value === 'near');
check('radius is measured from the source target', nearestRequiredAsset([8, 0], { assetId: 'fridge', radiusMeters: 5 }, candidates)?.value === 'far');
check('matching assets outside radius are unavailable', nearestRequiredAsset([0, 0], { assetId: 'fridge', radiusMeters: 0.5 }, candidates) === null);
check('an authored equivalent asset variant satisfies the same requirement', nearestRequiredAsset(
  [0, 0], { assetId: 'modern_fridge', alternativeAssetIds: ['fridge'], radiusMeters: 2 }, candidates,
)?.value === 'near');
check('negative radius clamps to zero', nearestRequiredAsset([0, 0], { assetId: 'fridge', radiusMeters: -4 }, candidates) === null);
check('absent requirement has no candidate', nearestRequiredAsset([0, 0], undefined, candidates) === null);
check('presence gate applies even with both visit flags false', requiresAssetPresence({ assetId: 'fridge', radiusMeters: 5 }) === true);
check('known automatic action resolves', resolvedFollowUpActionId({ assetId: 'meal', actionId: 'consume_food' }, new Set(['consume_food'])) === 'consume_food');
check('missing automatic action degrades to no follow-up', resolvedFollowUpActionId({ assetId: 'meal', actionId: 'missing' }, new Set(['consume_food'])) === null);
check('spawn without automatic action is valid', resolvedFollowUpActionId({ assetId: 'meal' }, new Set(['consume_food'])) === null);
check('follow-up carrying the spawned asset reuses the exact product', carriesSpawnedProduct({ carriedAsset: { assetId: 'book' } }, 'book'));
check('different carried prop does not consume the spawned product', !carriesSpawnedProduct({ carriedAsset: { assetId: 'tray' } }, 'book'));
check('follow-up without a carried prop leaves the spawned product in-world', !carriesSpawnedProduct({}, 'book'));

const book = { id: 'book', name: 'Book', category: 'transient', interactions: ['read'], footprint: [0.2, 0.2] } as unknown as AssetDef;
const shelfRead = { id: 'read_book', name: 'Read a book', spawnsAsset: { assetId: 'book', actionId: 'read' } } as ActionDef;
const read = { id: 'read', name: 'Read', seatAware: true, carriedAsset: { assetId: 'book', bone: 'RightHand' } } as ActionDef;
check('valid spawned-book connection has no issues', actionConnectionIssues(shelfRead, [shelfRead, read], [book]).length === 0);
check('flow description states that the exact spawned book is reused', describeActionFlow(shelfRead, [shelfRead, read], [book]).at(-1) === 'Automatically Read using that same Book');
const broken = {
  id: 'broken', name: 'Broken', seatAware: false, fetchBeforeSeat: true, consumesFood: true, discardsFood: true,
  spawnsAsset: { assetId: 'missing', actionId: 'gone' }, carriedAsset: { assetId: 'book', bone: '' },
} as ActionDef;
const brokenCodes = actionConnectionIssues(broken, [broken], [book]).map((issue) => issue.code);
check('connection audit catches inert seating, contradictory food, missing links, and empty bone',
  ['fetch_without_seat', 'consume_and_discard', 'missing_spawned_asset', 'missing_follow_up', 'missing_carry_bone'].every((code) => brokenCodes.includes(code)));
const badAsset = { ...book, id: 'bad_asset', name: 'Bad asset', interactions: ['gone', 'gone'] } as AssetDef;
const graphCodes = actionGraphIssues([broken], [book, badAsset]).map((issue) => issue.code);
check('whole-graph audit catches missing and duplicate asset-owned action links',
  ['missing_asset_action', 'duplicate_asset_action'].every((code) => graphCodes.includes(code)));

const can = { id: 'can', name: 'Utility bin', category: 'appliances', interactions: ['empty'], footprint: [1, 1], container: { capacity: 8 } } as unknown as AssetDef;
const door = { id: 'door', name: 'Exterior door', category: 'door', interactions: [], footprint: [1, 1] } as unknown as AssetDef;
const dishes = { id: 'dishes', name: 'Dirty dishes', category: 'transient', interactions: ['deposit'], footprint: [0.2, 0.2], containerSpace: 2 } as unknown as AssetDef;
const deposit = { id: 'deposit', name: 'Put away', containerTransfer: { mode: 'deposit', containerAssetId: 'can' } } as ActionDef;
const empty = { id: 'empty', name: 'Take contents out', containerTransfer: { mode: 'empty', destinationAssetId: 'door' } } as ActionDef;
check('valid deposit and empty references pass action-level validation',
  actionConnectionIssues(deposit, [deposit, empty], [can, door, dishes]).length === 0
  && actionConnectionIssues(empty, [deposit, empty], [can, door, dishes]).length === 0);
check('container transfer flow names both authored movement legs',
  describeActionFlow(deposit, [deposit, empty], [can, door, dishes]).join(' / ') === 'Perform Put away / Carry the targeted transient to Utility bin / Deposit it into Utility bin'
  && describeActionFlow(empty, [deposit, empty], [can, door, dishes]).join(' / ').includes('Carry them to Exterior door'));
check('valid owner categories and transient space pass whole-graph validation',
  actionGraphIssues([deposit, empty], [can, door, dishes]).length === 0);

const invalidCan = { ...can, id: 'bad_can', container: { capacity: 0 }, interactions: ['deposit', 'empty'] } as AssetDef;
const invalidTransient = { ...dishes, id: 'bad_dishes', containerSpace: 0, interactions: ['empty'] } as AssetDef;
const badDeposit = { ...deposit, id: 'bad_deposit', containerTransfer: { mode: 'deposit', containerAssetId: 'door' } } as ActionDef;
const badEmpty = { ...empty, id: 'bad_empty', containerTransfer: { mode: 'empty', destinationAssetId: 'missing' } } as ActionDef;
const transferActionCodes = [
  ...actionConnectionIssues(badDeposit, [badDeposit, badEmpty], [invalidCan, door, invalidTransient]),
  ...actionConnectionIssues(badEmpty, [badDeposit, badEmpty], [invalidCan, door, invalidTransient]),
].map((issue) => issue.code);
check('action validation catches a non-container deposit reference and missing empty destination',
  transferActionCodes.includes('deposit_target_not_container') && transferActionCodes.includes('missing_empty_destination'));
const transferGraphCodes = actionGraphIssues([deposit, empty], [invalidCan, door, invalidTransient]).map((issue) => issue.code);
check('graph validation catches invalid capacity, space, and owner categories',
  ['invalid_container_capacity', 'invalid_container_space', 'empty_on_non_container'].every((code) => transferGraphCodes.includes(code)));

const liveAssets = JSON.parse(readFileSync(new URL('../data/assets.json', import.meta.url), 'utf8')).assets as AssetDef[];
const liveActions = JSON.parse(readFileSync(new URL('../data/interactions.json', import.meta.url), 'utf8')).actions as ActionDef[];
const liveThrowAway = liveActions.find((action) => action.id === 'throw_away_food');
check('shipped food disposal uses the generic container-transfer seam',
  liveThrowAway?.containerTransfer?.mode === 'deposit'
  && liveThrowAway.containerTransfer.containerAssetId === 'garbage_can'
  && !liveThrowAway.discardsFood);
check('every shipped food-disposal target authors its own occupied space',
  ['snack', 'meal', 'rotten_food', 'coffee'].every((id) => (liveAssets.find((asset) => asset.id === id)?.containerSpace ?? 0) > 0));
const liveEat = liveActions.find((action) => action.id === 'consume_food');
check('eating uses the generic product -> action -> container-transfer graph',
  liveEat?.spawnsAsset?.assetId === 'dirty_dishes'
  && liveEat.spawnsAsset.actionId === 'clean_up'
  && !liveEat.producesWaste);

if (failures) process.exit(1);
console.log('\nall actionchain tests passed');
