// Headless smoke test for tools/assets.html (jsdom; the 3D module script is inert here).
// Verifies: load + sidebar render with placed-count badges, selecting, editing fields,
// interaction toggles, seat flags (sparse), duplicate/new/delete with usage warning,
// exact PUT payload, search filtering.
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../tools/assets.html', import.meta.url), 'utf8');

const assets = {
  categories: ['seating', 'electronics', 'door', 'appliances', 'transient'],
  assets: [
    { id: 'couch', name: 'Couch', category: 'seating', mesh: '/models/couch.glb', buyPrice: 500, sellPrice: 375, environmentScore: 5, footprint: [2, 1], seats: 3, seatTarget: true, interactions: [] },
    { id: 'tv', name: 'TV', category: 'electronics', mesh: '/models/tv.glb', buyPrice: 800, sellPrice: 600, environmentScore: 8, footprint: [1, 1], interactions: ['watch_tv'] },
    { id: 'stove', name: 'Stove', category: 'appliances', mesh: '/models/stove.glb', buyPrice: 400, sellPrice: 300, environmentScore: 1, footprint: [1, 1], interactions: ['cook'] },
    { id: 'fire', name: 'Fire', category: 'transient', mesh: '/models/fire.glb', buyPrice: 0, sellPrice: 0, environmentScore: -10, footprint: [1, 1], interactions: ['extinguish'], clearedBy: ['extinguish'], buyable: false },
    { id: 'water_puddle', name: 'Water puddle', category: 'transient', mesh: '/models/water_puddle.glb', buyPrice: 0, sellPrice: 0, environmentScore: -5, footprint: [1, 1], interactions: [], buyable: false },
  ],
};
const interactions = { actions: [
  { id: 'watch_tv', name: 'Watch TV', needGains: {}, skillGains: {}, animation: 'sit', autonomyEligible: true },
  { id: 'nap', name: 'Nap', needGains: {}, skillGains: {}, animation: 'lie', autonomyEligible: true },
  { id: 'cook', name: 'Cook', needGains: {}, skillGains: { cooking: 0.05 }, animation: 'stand_use', autonomyEligible: true, primaryNeed: null },
  { id: 'extinguish', name: 'Extinguish', needGains: {}, skillGains: {}, animation: 'stand_use', autonomyEligible: false, primaryNeed: null },
  { id: 'mop', name: 'Mop up', needGains: {}, skillGains: {}, animation: 'stand_use', autonomyEligible: false, primaryNeed: null },
] };
const condo = { placedObjects: [{ asset: 'couch', pos: [1, 1], rotDeg: 0 }, { asset: 'couch', pos: [3, 1], rotDeg: 0 }] };
const stats = {
  needs: [{ id: 'hunger', name: 'Hunger', color: '#e74c3c', default: 70, decayPerTick: 0.1, autonomy: true }],
  skills: [{ id: 'cooking', name: 'Cooking', color: '#d35400', default: 0, max: 10 }],
};

const puts = {};
const fetchMock = async (url, opts = {}) => {
  const path = String(url).replace('/api/data/', '');
  if (opts.method === 'PUT') {
    puts[path] = JSON.parse(opts.body);
    return { ok: true, status: 200, json: async () => ({}) };
  }
  const body = { 'assets.json': assets, 'interactions.json': interactions, 'maps/condo.json': condo, 'stats.json': stats }[path];
  return { ok: !!body, status: body ? 200 : 404, json: async () => structuredClone(body) };
};

const dom = new JSDOM(html, {
  url: 'http://localhost:5173/tools/assets.html',
  runScripts: 'dangerously',
  beforeParse(window) {
    window.fetch = fetchMock;
    window.confirm = () => true; // auto-accept deletes
    window.prompt = () => 'lamp'; // new-asset id
    window.alert = () => {};
  },
});
const { window } = dom;
const doc = window.document;
await new Promise((r) => setTimeout(r, 50));

// --- sidebar rendered with usage badge
const items = doc.querySelectorAll('.asset-item');
assert(items.length === 5, `sidebar shows 5 assets (${items.length})`);
assert(doc.querySelector('[data-asset-id="couch"] .badge')?.textContent === '×2 placed', 'couch shows ×2 placed badge');
assert(doc.querySelector('[data-asset-id="tv"] .badge') === null, 'tv has no badge');

// --- couch selected by default; edit price
assert(doc.querySelector('input[data-path="buyPrice"]').value === '500', 'buy price rendered');
const price = doc.querySelector('input[data-path="buyPrice"]');
price.value = '650';
price.dispatchEvent(new window.Event('input', { bubbles: true }));
assert(!doc.getElementById('save').disabled, 'save enabled after edit');

// --- toggle an interaction on the couch
const napCb = doc.querySelector('input[data-path="interaction:nap"]');
napCb.checked = true;
napCb.dispatchEvent(new window.Event('change', { bubbles: true }));

// --- buyable defaults to checked (absent = true); unchecking writes buyable:false explicitly
const buyableCb = doc.querySelector('input[data-path="buyable"]');
assert(buyableCb.checked === true, 'buyable defaults checked when absent');
buyableCb.checked = false;
buyableCb.dispatchEvent(new window.Event('change', { bubbles: true }));

// --- facingDeg: blank by default, sparse round-trip
const facingInput = doc.querySelector('input[data-path="facingDeg"]');
assert(facingInput.value === '', 'facingDeg blank when absent');
facingInput.value = '90';
facingInput.dispatchEvent(new window.Event('input', { bubbles: true }));

// --- requiresQuestUnlock (§7.6): sparse, absent by default, unchecked → key deleted
const questGateCb = doc.querySelector('input[data-path="requiresQuestUnlock"]');
assert(questGateCb.checked === false, 'requiresQuestUnlock unchecked when absent');
questGateCb.checked = true;
questGateCb.dispatchEvent(new window.Event('change', { bubbles: true }));

// --- icon (§7.6): blank by default, sparse round-trip, thumbnail element present
const iconInput = doc.querySelector('input[data-path="icon"]');
assert(iconInput.value === '', 'icon blank when absent');
assert(doc.getElementById('icon-thumb'), 'icon thumbnail <img> element rendered');
iconInput.value = '/models/icons/sofa.png';
iconInput.dispatchEvent(new window.Event('input', { bubbles: true }));

// --- usePose (§7.8, roadmap item 1): sparse per-pose sit/lie override, offset/y/facingDeg
const sitOffsetX = doc.querySelector('input[data-path="usePose.sit.offsetX"]');
assert(sitOffsetX, 'usePose.sit offset fields rendered');
assert(sitOffsetX.value === '', 'usePose.sit.offsetX blank when absent');
assert(doc.querySelector('input[data-path="usePose.sit.y"]').value === '', 'usePose.sit.y blank when absent');
assert(doc.querySelector('input[data-path="usePose.lie.y"]').value === '', 'usePose.lie fields rendered too (both poses always shown)');
sitOffsetX.value = '0.3';
sitOffsetX.dispatchEvent(new window.Event('input', { bubbles: true }));
const sitY = doc.querySelector('input[data-path="usePose.sit.y"]');
sitY.value = '0.42';
sitY.dispatchEvent(new window.Event('input', { bubbles: true }));
const sitFacing = doc.querySelector('input[data-path="usePose.sit.facingDeg"]');
sitFacing.value = '180';
sitFacing.dispatchEvent(new window.Event('input', { bubbles: true }));

// --- meshFit: sparse uniform scale, yawOffsetDeg, yOffset
const scaleInput = doc.querySelector('input[data-path="meshFit.scale"]');
assert(scaleInput.value === '', 'meshFit.scale blank when absent');
scaleInput.value = '1.2';
scaleInput.dispatchEvent(new window.Event('input', { bubbles: true }));
const yawInput = doc.querySelector('input[data-path="meshFit.yawOffsetDeg"]');
yawInput.value = '45';
yawInput.dispatchEvent(new window.Event('input', { bubbles: true }));

// --- clear the sparse seats field
const seats = doc.querySelector('input[data-path="seats"]');
seats.value = '';
seats.dispatchEvent(new window.Event('input', { bubbles: true }));

// --- select TV, verify form re-renders
doc.querySelector('[data-asset-id="tv"]').click();
assert(doc.querySelector('input[data-path="buyPrice"]').value === '800', 'tv form rendered after select');
assert(doc.querySelector('input[data-path="interaction:watch_tv"]').checked, 'tv has watch_tv checked');

// --- per-axis meshFit.scale (overrides the uniform field) — read back via a re-render,
// since the model itself isn't exposed on `window` (top-level `const state` in a classic
// script is a lexical binding, not a window property)
let scaleX = doc.querySelector('input[data-path="meshFit.scaleX"]');
scaleX.value = '1.5';
scaleX.dispatchEvent(new window.Event('input', { bubbles: true }));
doc.querySelector('[data-asset-id="tv"]').click();
scaleX = doc.querySelector('input[data-path="meshFit.scaleX"]');
assert(scaleX.value === '1.5', 'per-axis scale writes an array (read back after re-render)');
assert(doc.querySelector('input[data-path="meshFit.scale"]').value === '', 'uniform scale field reads blank once scale is an array');

// --- delete TV (unused → plain confirm text)
assert(doc.getElementById('delete').textContent === 'Delete', 'unused asset gets plain delete label');
doc.getElementById('delete').click();
assert(doc.querySelectorAll('.asset-item').length === 4, 'tv removed from sidebar');

// --- couch delete button warns about usage
doc.querySelector('[data-asset-id="couch"]').click();
assert(doc.getElementById('delete').textContent.includes('×2'), 'used asset delete label warns');

// --- new asset via prompt
doc.getElementById('new').click();
assert(doc.querySelectorAll('.asset-item').length === 5, 'new asset appears');
assert(doc.querySelector('input[data-path="id"]').value === 'lamp', 'new asset selected with prompted id');

// --- meshFit sparse pruning on the fresh (untouched) lamp: set the uniform scale field,
// then clear it — since it was the only meshFit sub-field ever set, the whole sparse
// meshFit object should be pruned away, not left behind as an empty {}.
const lampScale = doc.querySelector('input[data-path="meshFit.scale"]');
lampScale.value = '2';
lampScale.dispatchEvent(new window.Event('input', { bubbles: true }));
lampScale.value = '';
lampScale.dispatchEvent(new window.Event('input', { bubbles: true }));

// --- door section (§7.1): only rendered when category === "door"; absent otherwise
assert(doc.querySelector('input[data-path="door.hingeX"]') === null, 'no door section while lamp is category seating');
const lampCat = doc.querySelector('select[data-path="category"]');
lampCat.value = 'door';
lampCat.dispatchEvent(new window.Event('change', { bubbles: true }));
doc.querySelector('[data-asset-id="lamp"]').click(); // category change doesn't itself re-render the editor — reselect
assert(doc.querySelector('input[data-path="door.hingeX"]') !== null, 'door section appears once category is door');
assert(doc.querySelector('input[data-path="door.hingeX"]').value === '', 'hingeX blank by default');
assert(doc.querySelector('input[data-path="door.openAngleDeg"]').value === '', 'openAngleDeg blank by default (tuning fallback)');
const hingeX = doc.querySelector('input[data-path="door.hingeX"]');
hingeX.value = '-0.5';
hingeX.dispatchEvent(new window.Event('input', { bubbles: true }));
const hingeZ = doc.querySelector('input[data-path="door.hingeZ"]');
hingeZ.value = '0';
hingeZ.dispatchEvent(new window.Event('input', { bubbles: true }));
const openAngle = doc.querySelector('input[data-path="door.openAngleDeg"]');
openAngle.value = '100';
openAngle.dispatchEvent(new window.Event('input', { bubbles: true }));
// openSeconds/closeSeconds/triggerDistance deliberately left blank — sparse, tuning fallback

// --- accidents (§7.3): normal (non-accident) asset gets the risk-config section
doc.querySelector('[data-asset-id="stove"]').click();
assert(doc.querySelector('.card h2')?.textContent !== undefined, 'stove editor rendered');
assert(doc.querySelector('select[data-path^="accidents."]') === null, 'no risk rows yet — stove has no accidents[] to start');
assert(doc.querySelector('input[data-path^="clearedBy:"]') === null, 'normal asset never shows the Cleanup clearedBy checklist');

const addRiskBtn = [...doc.querySelectorAll('button')].find((b) => b.textContent === '+ Add accident risk');
assert(addRiskBtn, '"+ Add accident risk" button present on a normal asset');
addRiskBtn.click();

// --- referential sanity: accidentId dropdown only lists accident-category assets
const accidentIdSel = doc.querySelector('select[data-path="accidents.0.accidentId"]');
assert(accidentIdSel, 'accident risk row rendered after adding');
const accidentIdValues = [...accidentIdSel.options].map((o) => o.value);
assert(accidentIdValues.length === 2 && accidentIdValues.includes('fire') && accidentIdValues.includes('water_puddle'), `accidentId options are exactly the accident-category assets (${accidentIdValues})`);
assert(!accidentIdValues.includes('couch') && !accidentIdValues.includes('tv') && !accidentIdValues.includes('stove'), 'accidentId options exclude non-accident assets');
assert(accidentIdSel.value === 'fire', 'new risk row defaults to the first accident-category asset');

const triggerSel = doc.querySelector('select[data-path="accidents.0.trigger"]');
assert(triggerSel.value === 'onUse' && triggerSel.options.length === 1, 'trigger is fixed to the single "onUse" option');

const baseChanceInput = doc.querySelector('input[data-path="accidents.0.baseChancePercent"]');
baseChanceInput.value = '2';
baseChanceInput.dispatchEvent(new window.Event('input', { bubbles: true }));

// placement starts "on" — no adjacentRange fields until switched to "adjacent"
assert(doc.querySelector('input[data-path="accidents.0.adjacentRange.0"]') === null, 'adjacentRange hidden while placement is "on"');
const placementSel = doc.querySelector('select[data-path="accidents.0.placement"]');
assert(placementSel.value === 'on', 'placement defaults to "on"');
placementSel.value = 'adjacent';
placementSel.dispatchEvent(new window.Event('change', { bubbles: true }));

// placement change re-renders the editor (to reveal adjacentRange) — reselect the live inputs
doc.querySelector('[data-asset-id="stove"]').click();
assert(doc.querySelector('select[data-path="accidents.0.placement"]').value === 'adjacent', 'placement change persisted across the re-render');
const rangeMin = doc.querySelector('input[data-path="accidents.0.adjacentRange.0"]');
const rangeMax = doc.querySelector('input[data-path="accidents.0.adjacentRange.1"]');
assert(rangeMin && rangeMax, 'adjacentRange fields appear once placement is "adjacent"');
rangeMin.value = '1';
rangeMin.dispatchEvent(new window.Event('input', { bubbles: true }));
rangeMax.value = '2';
rangeMax.dispatchEvent(new window.Event('input', { bubbles: true }));

// --- modifier sub-row: var dropdown fed from stats.json needs+skills, namespace-prefixed
const addModBtn = [...doc.querySelectorAll('button')].find((b) => b.textContent === '+ Add modifier');
addModBtn.click();
const modVarSel = doc.querySelector('select[data-path="accidents.0.modifiers.0.var"]');
assert(modVarSel, 'modifier row rendered after adding');
const modVarValues = [...modVarSel.options].map((o) => o.value);
assert(modVarValues.includes('needs.hunger') && modVarValues.includes('skills.cooking'), `modifier var options are namespace-prefixed needs/skills (${modVarValues})`);
modVarSel.value = 'skills.cooking';
modVarSel.dispatchEvent(new window.Event('change', { bubbles: true }));
const pctAt0Input = doc.querySelector('input[data-path="accidents.0.modifiers.0.pctAt0"]');
pctAt0Input.value = '15';
pctAt0Input.dispatchEvent(new window.Event('input', { bubbles: true }));
const pctAtMaxInput = doc.querySelector('input[data-path="accidents.0.modifiers.0.pctAtMax"]');
pctAtMaxInput.value = '-2';
pctAtMaxInput.dispatchEvent(new window.Event('input', { bubbles: true }));

// --- accident-category asset: ONLY the clearedBy multi-select, never the risk section
doc.querySelector('[data-asset-id="fire"]').click();
assert(doc.querySelector('select[data-path^="accidents."]') === null, 'accident-category asset never shows the risk-config section');
const clearedCb = doc.querySelector('input[data-path="clearedBy:extinguish"]');
assert(clearedCb, 'clearedBy checklist scoped to fire\'s own interactions (extinguish)');
assert(clearedCb.checked === true, 'fire\'s existing clearedBy:["extinguish"] pre-checks the box');

// --- sprite card (§7.5): only shown when the mesh path is an image, not a GLB
doc.querySelector('[data-asset-id="fire"]').click();
assert(doc.querySelector('select[data-path="sprite.orientation"]') === null, 'no sprite card while fire mesh is a .glb');
const fireMeshInput = doc.querySelector('input[data-path="mesh"]');
fireMeshInput.value = '/models/fire.gif';
fireMeshInput.dispatchEvent(new window.Event('input', { bubbles: true }));
doc.querySelector('[data-asset-id="fire"]').click(); // reselect to re-render the guarded card
assert(doc.querySelector('select[data-path="sprite.orientation"]') !== null, 'sprite card appears once mesh is an image path');
assert(doc.querySelector('select[data-path="sprite.orientation"]').value === 'billboard', 'orientation defaults to billboard when absent');
assert(doc.querySelector('input[data-path="sprite.fps"]').value === '', 'fps blank by default');
const spriteOrient = doc.querySelector('select[data-path="sprite.orientation"]');
spriteOrient.value = 'flat';
spriteOrient.dispatchEvent(new window.Event('change', { bubbles: true }));
const spriteFps = doc.querySelector('input[data-path="sprite.fps"]');
spriteFps.value = '12';
spriteFps.dispatchEvent(new window.Event('input', { bubbles: true }));

// --- save: PUT carries all edits
doc.getElementById('save').click();
await new Promise((r) => setTimeout(r, 50));
const saved = puts['assets.json'];
assert(saved, 'PUT sent to assets.json');
const savedCouch = saved.assets.find((a) => a.id === 'couch');
assert(savedCouch.buyPrice === 650, 'PUT carries edited price');
assert(savedCouch.interactions.includes('nap'), 'PUT carries toggled interaction');
assert(!('seats' in savedCouch), 'blanked sparse seats key removed');
assert(savedCouch.seatTarget === true, 'untouched seatTarget preserved');
assert(!saved.assets.some((a) => a.id === 'tv'), 'PUT reflects deletion');
assert(saved.assets.some((a) => a.id === 'lamp'), 'PUT includes new asset');
assert(doc.getElementById('save').disabled, 'save disabled after saving');
assert(savedCouch.buyable === false, 'PUT carries explicit buyable:false');
assert(savedCouch.facingDeg === 90, 'PUT carries edited facingDeg');
assert(savedCouch.meshFit.scale === 1.2, 'PUT carries sparse meshFit.scale');
assert(savedCouch.meshFit.yawOffsetDeg === 45, 'PUT carries sparse meshFit.yawOffsetDeg');
assert(!('yOffset' in savedCouch.meshFit), 'untouched meshFit.yOffset stays absent (sparse)');
assert(savedCouch.usePose.sit.offset[0] === 0.3 && savedCouch.usePose.sit.offset[1] === 0, 'PUT carries usePose.sit.offset');
assert(savedCouch.usePose.sit.y === 0.42, 'PUT carries usePose.sit.y');
assert(savedCouch.usePose.sit.facingDeg === 180, 'PUT carries usePose.sit.facingDeg');
assert(!('lie' in savedCouch.usePose), 'untouched usePose.lie stays absent (sparse, per-pose)');
assert(savedCouch.requiresQuestUnlock === true, 'PUT carries checked requiresQuestUnlock');
assert(savedCouch.icon === '/models/icons/sofa.png', 'PUT carries edited icon path');
const savedLamp = saved.assets.find((a) => a.id === 'lamp');
assert(!('buyable' in savedLamp), 'new asset has no buyable key (defaults true)');
assert(!('facingDeg' in savedLamp), 'new asset has no facingDeg key (defaults 0)');
assert(!('meshFit' in savedLamp), 'new asset has no meshFit key (nothing set)');
assert(!('usePose' in savedLamp), 'new asset has no usePose key (nothing set)');
assert(!('requiresQuestUnlock' in savedLamp), 'new asset has no requiresQuestUnlock key (defaults unlocked)');
assert(!('icon' in savedLamp), 'new asset has no icon key (falls back to initials tile)');
assert(savedLamp.category === 'door', 'PUT carries lamp\'s category change to door');
assert(savedLamp.door.hingeOffset[0] === -0.5 && savedLamp.door.hingeOffset[1] === 0, 'PUT carries door.hingeOffset');
assert(savedLamp.door.openAngleDeg === 100, 'PUT carries door.openAngleDeg');
assert(!('openSeconds' in savedLamp.door), 'untouched door.openSeconds stays absent (sparse, tuning fallback)');
assert(!('closeSeconds' in savedLamp.door), 'untouched door.closeSeconds stays absent (sparse, tuning fallback)');
assert(!('triggerDistance' in savedLamp.door), 'untouched door.triggerDistance stays absent (sparse, tuning fallback)');

// --- accidents (§7.3): stove's risk config round-trips exactly
const savedStove = saved.assets.find((a) => a.id === 'stove');
assert(savedStove.accidents?.length === 1, 'PUT carries the added accident risk');
const savedRisk = savedStove.accidents[0];
assert(savedRisk.accidentId === 'fire', 'PUT carries risk.accidentId');
assert(savedRisk.trigger === 'onUse', 'PUT carries risk.trigger');
assert(savedRisk.baseChancePercent === 2, 'PUT carries risk.baseChancePercent');
assert(savedRisk.placement === 'adjacent', 'PUT carries risk.placement after the switch');
assert(savedRisk.adjacentRange[0] === 1 && savedRisk.adjacentRange[1] === 2, 'PUT carries risk.adjacentRange');
assert(savedRisk.modifiers.length === 1, 'PUT carries the added modifier');
assert(savedRisk.modifiers[0].var === 'skills.cooking', 'PUT carries modifier.var');
assert(savedRisk.modifiers[0].pctAt0 === 15, 'PUT carries modifier.pctAt0');
assert(savedRisk.modifiers[0].pctAtMax === -2, 'PUT carries modifier.pctAtMax');

const savedFire = saved.assets.find((a) => a.id === 'fire');
assert(JSON.stringify(savedFire.clearedBy) === JSON.stringify(['extinguish']), 'PUT preserves fire\'s untouched clearedBy');
assert(savedFire.mesh === '/models/fire.gif', 'PUT carries fire\'s mesh path change to .gif');
assert(savedFire.sprite.orientation === 'flat', 'PUT carries sprite.orientation');
assert(savedFire.sprite.fps === 12, 'PUT carries sprite.fps');
const savedWaterPuddle = saved.assets.find((a) => a.id === 'water_puddle');
assert(!('accidents' in savedWaterPuddle), 'accident-category asset never gets an accidents[] key');
assert(!('sprite' in savedWaterPuddle), 'untouched accident asset (still a .glb mesh) has no sprite key');

// --- search filters sidebar
const search = doc.getElementById('search');
search.value = 'lam';
search.dispatchEvent(new window.Event('input', { bubbles: true }));
const visible = doc.querySelectorAll('.asset-item');
assert(visible.length === 1 && visible[0].dataset.assetId === 'lamp', 'search narrows sidebar to lamp');

console.log('ALL ASSET-EDITOR TESTS PASSED');

function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); process.exit(1); }
}
