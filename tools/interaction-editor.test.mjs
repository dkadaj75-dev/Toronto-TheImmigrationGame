// Headless smoke test for tools/interactions.html (jsdom).
// Focused on the B9-1 follow-up: the sparse `faceTarget` checkbox — ticked (default true)
// deletes the key, unticked writes `faceTarget: false` explicitly. Mirrors the
// seatAware/censor sparse-boolean pattern already covered informally by the tool itself.
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const conditionBuilder = readFileSync(new URL('../tools/condition-builder.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../tools/interactions.html', import.meta.url), 'utf8')
  .replace('<script src="/tools/condition-builder.js"></script>', `<script>${conditionBuilder}</script>`);

const interactions = { actions: [
  {
    id: 'read_book', name: 'Read a book', needGains: { fun: 1 }, skillGains: { english: 0.04 },
    animation: 'sit_idle', autonomyEligible: true, primaryNeed: 'fun', seatAware: true,
    fetchBeforeSeat: true, faceTarget: false,
    containerTransfer: { mode: 'deposit', containerAssetId: 'removed_can' },
  },
  {
    id: 'watch_tv', name: 'Watch TV', needGains: { fun: 2.5 }, skillGains: {},
    animation: 'sit_idle', autonomyEligible: true, primaryNeed: 'fun', seatAware: true,
  },
  {
    id: 'consume_food', name: 'Eat', needGains: {}, skillGains: {},
    animation: 'sit_eat', autonomyEligible: false, primaryNeed: null, consumesFood: true,
  },
] };
const assets = { categories: ['seating', 'electronics', 'transient'], assets: [
  { id: 'sofa', name: 'Sofa', category: 'seating', mesh: '', buyPrice: 0, sellPrice: 0, environmentScore: 0, footprint: [1, 1], seats: 2, seatTarget: true, interactions: ['read_book'] },
  { id: 'tv', name: 'TV', category: 'electronics', mesh: '', buyPrice: 0, sellPrice: 0, environmentScore: 0, footprint: [1, 1], interactions: ['watch_tv'] },
  { id: 'fridge', name: 'Fridge', category: 'electronics', mesh: '', buyPrice: 0, sellPrice: 0, environmentScore: 0, footprint: [1, 1], interactions: [] },
  { id: 'old_fridge', name: 'Old Fridge', category: 'electronics', mesh: '', buyPrice: 0, sellPrice: 0, environmentScore: 0, footprint: [1, 1], interactions: [] },
  { id: 'garbage_can', name: 'Garbage can', category: 'electronics', mesh: '', buyPrice: 0, sellPrice: 0, environmentScore: 0, footprint: [1, 1], interactions: [], container: { capacity: 8 } },
  { id: 'exterior_door', name: 'Exterior door', category: 'door', mesh: '', buyPrice: 0, sellPrice: 0, environmentScore: 0, footprint: [1, 1], interactions: [] },
  { id: 'book_prop', name: 'Book prop', category: 'transient', mesh: '', buyPrice: 0, sellPrice: 0, environmentScore: 0, footprint: [0.2, 0.2], interactions: [], buyable: false, containerSpace: 2 },
  { id: 'meal', name: 'Meal', category: 'transient', mesh: '', buyPrice: 0, sellPrice: 0, environmentScore: 0, footprint: [0.2, 0.2], interactions: ['consume_food'], buyable: false, food: { hungerGain: 20, perishHours: 4 } },
] };
const stats = {
  needs: [{ id: 'fun', name: 'Fun', color: '#3498db', default: 70, decayPerTick: 0.1, autonomy: true }],
  skills: [{ id: 'english', name: 'English', color: '#2ecc71', default: 0, max: 10 }],
};
const simstate = { variables: [] };
const quests = { quests: [] };

const puts = {};
const fetchMock = async (url, opts = {}) => {
  const path = String(url).replace('/api/data/', '');
  if (opts.method === 'PUT') {
    puts[path] = JSON.parse(opts.body);
    return { ok: true, status: 200, json: async () => ({}) };
  }
  const body = {
    'interactions.json': interactions, 'assets.json': assets, 'stats.json': stats,
    'simstate.json': simstate, 'quests.json': quests,
  }[path];
  return { ok: !!body, status: body ? 200 : 404, json: async () => structuredClone(body) };
};

const dom = new JSDOM(html, {
  url: 'http://localhost:5173/tools/interactions.html',
  runScripts: 'dangerously',
  beforeParse(window) {
    window.fetch = fetchMock;
    window.confirm = () => true;
    window.prompt = () => null;
    window.alert = () => {};
  },
});
const { window } = dom;
const doc = window.document;
await new Promise((r) => setTimeout(r, 50));

window.InteractionEditor.setActionChainEngine({
  describeActionFlow: (action) => [`Perform ${action.name}`, 'Create linked product'],
  actionConnectionIssues: (action) => action.id === 'read_book'
    ? [{ level: 'warning', code: 'test_link', message: 'Test connection warning.' }]
    : [],
  actionGraphIssues: () => [{ level: 'error', code: 'test_owner', actionId: 'read_book', assetId: 'book_prop', message: 'Test target category warning.' }],
});
assert(doc.querySelector('[data-action-flow]')?.textContent.includes('Create linked product'), 'action flow renders the shared connection-engine sequence');
assert(doc.querySelector('[data-connection-issue="test_link"]')?.textContent.includes('Test connection warning'), 'action flow renders shared connection validation issues');
assert(doc.querySelector('[data-connection-issue="test_owner"]')?.textContent.includes('Test target category warning'), 'action flow renders owner/category graph validation');

// --- read_book selected by default (first action); faceTarget:false → checkbox unchecked
assert(doc.querySelector('input[data-path="id"]').value === 'read_book', 'read_book selected by default');
const faceCb = doc.querySelector('input[data-path="faceTarget"]');
assert(faceCb, 'faceTarget checkbox rendered');
assert(faceCb.checked === false, 'faceTarget unchecked when explicitly false');
const fetchCb = doc.querySelector('input[data-path="fetchBeforeSeat"]');
assert(fetchCb, 'fetchBeforeSeat checkbox rendered');
assert(fetchCb.checked === true, 'fetchBeforeSeat checked when explicitly true');
const staleContainer = doc.querySelector('select[data-path="containerTransfer.containerAssetId"]');
assert(staleContainer?.value === 'removed_can' && [...staleContainer.options].some((option) => option.textContent.includes('unknown')), 'unknown authored container id is preserved and visibly flagged');

// re-check it (back to default true) → key should be deleted on save
faceCb.checked = true;
faceCb.dispatchEvent(new window.Event('change', { bubbles: true }));

// --- select watch_tv: faceTarget absent → checkbox defaults CHECKED (absent = true)
doc.querySelector('[data-action-id="watch_tv"]').click();
const faceCb2 = doc.querySelector('input[data-path="faceTarget"]');
assert(faceCb2.checked === true, 'faceTarget defaults checked when absent');
const physicalPose = doc.querySelector('select[data-path="pose"]');
assert(physicalPose?.value === '', 'physical pose defaults to animation-name inference');
physicalPose.value = 'sit'; physicalPose.dispatchEvent(new window.Event('change', { bubbles: true }));
const fetchCb2 = doc.querySelector('input[data-path="fetchBeforeSeat"]');
assert(fetchCb2.checked === false, 'fetchBeforeSeat defaults unchecked when absent');
const seatSearch = doc.querySelector('select[data-path="seatSearch"]');
assert(seatSearch?.value === 'targetFacing', 'seat selection defaults to target-facing viewing');
seatSearch.value = 'nearest'; seatSearch.dispatchEvent(new window.Event('change', { bubbles: true }));
faceCb2.checked = false;
faceCb2.dispatchEvent(new window.Event('change', { bubbles: true }));

const transferMode = doc.querySelector('select[data-path="containerTransfer.mode"]');
assert(transferMode?.value === '' && !doc.querySelector('[data-path="containerTransfer.containerAssetId"]'), 'container transfer starts off and hides irrelevant selectors');
transferMode.value = 'deposit'; transferMode.dispatchEvent(new window.Event('change', { bubbles: true }));
const containerPicker = doc.querySelector('select[data-path="containerTransfer.containerAssetId"]');
assert(containerPicker?.value === 'garbage_can' && [...containerPicker.options].every((option) => option.value === 'garbage_can'), 'deposit reveals a live-data picker limited to authored containers');
const transferModeAfterRender = doc.querySelector('select[data-path="containerTransfer.mode"]');
transferModeAfterRender.value = 'empty'; transferModeAfterRender.dispatchEvent(new window.Event('change', { bubbles: true }));
const destinationPicker = doc.querySelector('select[data-path="containerTransfer.destinationAssetId"]');
assert(destinationPicker && [...destinationPicker.options].some((option) => option.value === 'exterior_door'), 'empty reveals live non-transient destinations');
destinationPicker.value = 'exterior_door'; destinationPicker.dispatchEvent(new window.Event('change', { bubbles: true }));

// --- B13-2 powersOnTarget: sparse checkbox, absent = unchecked; ticking writes true
const powerCb = doc.querySelector('input[data-path="powersOnTarget"]');
assert(powerCb, 'powersOnTarget checkbox rendered');
assert(powerCb.checked === false, 'powersOnTarget defaults unchecked when absent');
powerCb.checked = true;
powerCb.dispatchEvent(new window.Event('change', { bubbles: true }));
fetchCb2.checked = true;
fetchCb2.dispatchEvent(new window.Event('change', { bubbles: true }));

const requiredAsset = doc.querySelector('select[data-path="requiredAsset.assetId"]');
requiredAsset.value = 'fridge'; requiredAsset.dispatchEvent(new window.Event('change', { bubbles: true }));
const requiredRadius = doc.querySelector('input[data-path="requiredAsset.radiusMeters"]');
const requiredAlternatives = doc.querySelector('select[data-path="requiredAsset.alternativeAssetIds"]');
const visitBefore = doc.querySelector('input[data-path="requiredAsset.visitBefore"]');
const visitAfter = doc.querySelector('input[data-path="requiredAsset.visitAfter"]');
assert(requiredRadius?.value === '5' && requiredAlternatives && visitBefore && visitAfter, 'required asset reveals variants, radius, and before/after routing controls');
for (const option of requiredAlternatives.options) option.selected = option.value === 'old_fridge';
requiredAlternatives.dispatchEvent(new window.Event('change', { bubbles: true }));
requiredRadius.value = '7'; requiredRadius.dispatchEvent(new window.Event('input', { bubbles: true }));
visitBefore.checked = true; visitBefore.dispatchEvent(new window.Event('change', { bubbles: true }));

const spawnedAsset = doc.querySelector('select[data-path="spawnsAsset.assetId"]');
spawnedAsset.value = 'meal'; spawnedAsset.dispatchEvent(new window.Event('change', { bubbles: true }));
const autoAction = doc.querySelector('select[data-path="spawnsAsset.actionId"]');
assert([...autoAction.options].some((option) => option.value === 'consume_food'), 'automatic action picker follows the spawned asset interaction list');
autoAction.value = 'consume_food'; autoAction.dispatchEvent(new window.Event('change', { bubbles: true }));
const cookingScale = doc.querySelector('input[data-path="spawnsAsset.applyCookingSkill"]');
assert(cookingScale, 'food product exposes cooking-skill scaling');
cookingScale.checked = true; cookingScale.dispatchEvent(new window.Event('change', { bubbles: true }));

const carriedAsset = doc.querySelector('select[data-path="carriedAsset.assetId"]');
assert(carriedAsset && [...carriedAsset.options].some((o) => o.value === 'book_prop'), 'carried-asset picker is fed by transient assets');
carriedAsset.value = 'book_prop'; carriedAsset.dispatchEvent(new window.Event('change', { bubbles: true }));
const carryBone = doc.querySelector('select[data-path="carriedAsset.bone"]');
assert(carryBone?.value === 'mixamorigRightHand', 'new carried prop defaults to the right-hand bone');
const lockX = doc.querySelector('input[data-path="carriedAsset.lockRotationAxes.x"]');
const lockZ = doc.querySelector('input[data-path="carriedAsset.lockRotationAxes.z"]');
assert(lockX && lockZ && !lockX.checked && !lockZ.checked, 'carried prop exposes sparse X/Y/Z world-rotation locks');
const dropOnInterrupt = doc.querySelector('input[data-path="carriedAsset.dropOnInterrupt"]');
assert(dropOnInterrupt?.checked, 'carried prop drops on interruption by default');
dropOnInterrupt.checked = false; dropOnInterrupt.dispatchEvent(new window.Event('change', { bubbles: true }));
lockX.checked = true; lockX.dispatchEvent(new window.Event('change', { bubbles: true }));
lockZ.checked = true; lockZ.dispatchEvent(new window.Event('change', { bubbles: true }));
const consumesFood = doc.querySelector('input[data-path="consumesFood"]');
consumesFood.checked = true; consumesFood.dispatchEvent(new window.Event('change', { bubbles: true }));

// --- food override (ROADMAP item 2, meal tiers): sparse numeric override of the spawned food
// transient's own food block. Blank when absent; setting a field creates a.food; clearing a field
// prunes just that field (the object survives while any other field is set).
const foodHunger = doc.querySelector('input[data-path="food.hungerGain"]');
assert(foodHunger, 'food.hungerGain input rendered');
assert(foodHunger.value === '', 'food override blank when absent');
const foodPerish = doc.querySelector('input[data-path="food.perishHours"]');
assert(foodPerish, 'food.perishHours input rendered');
foodHunger.value = '30';
foodHunger.dispatchEvent(new window.Event('input', { bubbles: true }));
foodPerish.value = '5';
foodPerish.dispatchEvent(new window.Event('input', { bubbles: true }));
// clear perishHours again → object stays (hungerGain still set) but perishHours is pruned out
foodPerish.value = '';
foodPerish.dispatchEvent(new window.Event('input', { bubbles: true }));

// --- save: PUT reflects both round-trips
doc.getElementById('save').click();
await new Promise((r) => setTimeout(r, 50));
const saved = puts['interactions.json'];
assert(saved, 'PUT sent to interactions.json');
const savedReadBook = saved.actions.find((a) => a.id === 'read_book');
assert(!('faceTarget' in savedReadBook), 're-checking faceTarget deletes the key (back to default true)');
assert(savedReadBook.fetchBeforeSeat === true, 'untouched fetchBeforeSeat:true survives save');
assert(savedReadBook.containerTransfer?.containerAssetId === 'removed_can', 'unknown container references survive a whole-file save');
const savedWatchTv = saved.actions.find((a) => a.id === 'watch_tv');
assert(savedWatchTv.faceTarget === false, 'unchecking faceTarget on watch_tv writes faceTarget:false');
assert(savedWatchTv.pose === 'sit', 'explicit physical placement pose saves independently from animation state');
assert(savedWatchTv.fetchBeforeSeat === true, 'checking fetchBeforeSeat writes sparse true');
assert(savedWatchTv.seatSearch === 'nearest', 'nearest seat-selection strategy saves sparsely');
assert(savedWatchTv.containerTransfer?.mode === 'empty' && savedWatchTv.containerTransfer.destinationAssetId === 'exterior_door', 'empty-container destination saves as an explicit transfer');
assert(savedWatchTv.requiredAsset?.assetId === 'fridge' && savedWatchTv.requiredAsset.alternativeAssetIds?.[0] === 'old_fridge' && savedWatchTv.requiredAsset.radiusMeters === 7 && savedWatchTv.requiredAsset.visitBefore === true && !savedWatchTv.requiredAsset.visitAfter, 'required asset routing saves sparsely');
assert(savedWatchTv.spawnsAsset?.assetId === 'meal' && savedWatchTv.spawnsAsset.actionId === 'consume_food' && savedWatchTv.spawnsAsset.applyCookingSkill === true, 'completion product and automatic action save');
assert(savedWatchTv.powersOnTarget === true, 'ticking powersOnTarget writes sparse true (B13-2)');
assert(savedWatchTv.carriedAsset?.assetId === 'book_prop' && savedWatchTv.carriedAsset.bone === 'mixamorigRightHand', 'carried asset and bone save');
assert(savedWatchTv.carriedAsset.lockRotationAxes?.x === true && savedWatchTv.carriedAsset.lockRotationAxes?.z === true, 'carried world-axis rotation locks save sparsely');
assert(savedWatchTv.carriedAsset.dropOnInterrupt === false, 'temporary carried prop can opt out of interruption drops');
assert(savedWatchTv.consumesFood === true, 'food-consumption semantic saves sparsely');
assert(!('powersOnTarget' in savedReadBook), 'untouched action carries no powersOnTarget key');
assert(savedWatchTv.food && savedWatchTv.food.hungerGain === 30, 'food.hungerGain override written sparsely');
assert(!('perishHours' in savedWatchTv.food), 'cleared perishHours pruned from the sparse food override');

console.log('ALL INTERACTION-EDITOR TESTS PASSED');

function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); process.exit(1); }
}
