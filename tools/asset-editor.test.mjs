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
const condo = { gridSize: 0.5, placedObjects: [{ asset: 'couch', pos: [1, 1], rotDeg: 0 }, { asset: 'couch', pos: [3, 1], rotDeg: 0 }] };
const stats = {
  needs: [
    { id: 'hunger', name: 'Hunger', color: '#e74c3c', default: 70, decayPerTick: 0.1, autonomy: true },
    { id: 'comfort', name: 'Comfort', color: '#3498db', default: 50, decayPerTick: 0.1, autonomy: true },
    { id: 'energy', name: 'Energy', color: '#2ecc71', default: 60, decayPerTick: 0.1, autonomy: true },
  ],
  skills: [{ id: 'cooking', name: 'Cooking', color: '#d35400', default: 0, max: 10 }],
};
const tuning = {
  character: {
    meshPath: '/models/character.glb', heightMeters: 1.55, crossFadeSeconds: 0.25,
    walkClipSpeedReference: 2, sitHeight: 0.25, lieHeight: 0.55,
    clipMap: { idle: 'Idle', sit: 'Sitting', lie: 'Sleeping', sit_idle: 'SittingIdle', stand_use: 'Using' },
  },
};

const puts = {};
const fetchMock = async (url, opts = {}) => {
  const path = String(url).replace('/api/data/', '');
  if (opts.method === 'PUT') {
    puts[path] = JSON.parse(opts.body);
    return { ok: true, status: 200, json: async () => ({}) };
  }
  const body = { 'assets.json': assets, 'interactions.json': interactions, 'maps/condo.json': condo, 'stats.json': stats, 'tuning.json': tuning }[path];
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

// --- preview live-refresh (B7-1): the module 3D script is inert in jsdom, so spy on the API it
// exposes. schedulePreview must always hand the CURRENT asset to the preview, and any field edit
// (via markDirty) must trigger a refresh so footprint/meshFit changes update the grounded preview.
const previewCalls = [];
window.AssetPreview = { show: (mesh, asset) => previewCalls.push({ mesh, asset }) };

// --- character pose preview: view-only checkbox defaults off; pure helpers stay jsdom-testable.
const characterCheckbox = doc.querySelector('input[data-path="preview.showCharacter"]');
assert(characterCheckbox && !characterCheckbox.checked, 'Show character defaults unchecked');
assert(!characterCheckbox.disabled, 'Show character is enabled when tuning.character exists');
assert(JSON.stringify(window.AssetEditor.availablePreviewPoses(assets.assets[0])) === JSON.stringify(['sit', 'lie', 'use']), 'sit/lie/use preview poses are always offered');
assert(window.AssetEditor.previewPoseSource('use', assets.assets[2]) === 'computed default', 'sparse use pose previews the computed default standing spot');
assert(window.AssetEditor.previewPoseSource('use', { ...assets.assets[2], usePose: { use: {} } }) === 'computed default', 'empty use pose object is still treated as computed default');
assert(window.AssetEditor.previewPoseSource('use', { ...assets.assets[2], usePose: { use: { y: 0 } } }) === 'authored', 'any authored usePose.use field switches the preview to authored');
const sitAnim = window.AssetEditor.resolvePoseAnimation(
  'sit', { ...assets.assets[0], interactions: ['custom_sit'] },
  [{ id: 'custom_sit', animation: 'sit_unmapped' }], tuning.character.clipMap,
);
assert(sitAnim.logicalState === 'sit' && sitAnim.clipName === 'Sitting', 'pose animation falls back to mapped core sit state when the action state is unmapped');
const useAnim = window.AssetEditor.resolvePoseAnimation('use', assets.assets[2], interactions.actions, tuning.character.clipMap);
assert(useAnim.logicalState === 'stand_use' && useAnim.clipName === 'Using', 'use pose resolves the asset action through clipMap');

const noCharacterDom = new JSDOM(html, {
  url: 'http://localhost:5173/tools/assets.html',
  runScripts: 'dangerously',
  beforeParse(noCharacterWindow) {
    noCharacterWindow.fetch = async (url, opts = {}) => {
      if (String(url).endsWith('/tuning.json')) return { ok: false, status: 404, json: async () => ({}) };
      return fetchMock(url, opts);
    };
    noCharacterWindow.confirm = () => true;
    noCharacterWindow.prompt = () => null;
    noCharacterWindow.alert = () => {};
  },
});
await new Promise((r) => setTimeout(r, 50));
const noCharacterCheckbox = noCharacterDom.window.document.querySelector('input[data-path="preview.showCharacter"]');
assert(noCharacterCheckbox?.disabled, 'Show character is disabled when tuning.character is unavailable');
assert(noCharacterDom.window.document.getElementById('preview-msg')?.textContent.includes('Character preview unavailable'), 'missing character tuning is explained in the preview message');
noCharacterDom.window.close();

assert(window.AssetEditor.previewGridSize() === 0.5, 'preview grid reads the map tile size');
const previewGrid = window.AssetEditor.previewGridSpec();
assert(previewGrid.size / previewGrid.divisions === condo.gridSize, 'one preview square equals one map tile');
window.AssetEditor.state.map = null;
assert(window.AssetEditor.previewGridSize() === 0.5, 'preview grid falls back to 0.5m when map data is unavailable');
window.AssetEditor.state.map = condo;

// --- sidebar rendered with usage badge
const items = doc.querySelectorAll('.asset-item');
assert(items.length === 5, `sidebar shows 5 assets (${items.length})`);
assert(doc.querySelector('[data-asset-id="couch"] .badge')?.textContent === '×2 placed', 'couch shows ×2 placed badge');
assert(doc.querySelector('[data-asset-id="tv"] .badge') === null, 'tv has no badge');

// --- couch selected by default; edit price
assert(doc.querySelector('input[data-path="buyPrice"]').value === '500', 'buy price rendered');
const price = doc.querySelector('input[data-path="buyPrice"]');
const nPreviewBefore = previewCalls.length;
price.value = '650';
price.dispatchEvent(new window.Event('input', { bubbles: true }));
assert(!doc.getElementById('save').disabled, 'save enabled after edit');
assert(previewCalls.length > nPreviewBefore, 'a field edit live-refreshes the preview (markDirty → schedulePreview)');
assert(previewCalls.at(-1).asset?.id === 'couch', 'preview refresh passes the current asset');

// --- F2 repo priority: sparse number, higher values are seized later
const survivalImportance = doc.querySelector('input[data-path="survivalImportance"]');
assert(survivalImportance.value === '', 'survivalImportance blank when absent');
survivalImportance.value = '75';
survivalImportance.dispatchEvent(new window.Event('input', { bubbles: true }));

// --- toggle an interaction on the couch
const napCb = doc.querySelector('input[data-path="interaction:nap"]');
napCb.checked = true;
napCb.dispatchEvent(new window.Event('change', { bubbles: true }));

// --- buyable defaults to checked (absent = true); unchecking writes buyable:false explicitly
const buyableCb = doc.querySelector('input[data-path="buyable"]');
assert(buyableCb.checked === true, 'buyable defaults checked when absent');
buyableCb.checked = false;
buyableCb.dispatchEvent(new window.Event('change', { bubbles: true }));

// --- blocksNav (ROADMAP_NEXT item 2): sparse, absent = true (checked); unchecking writes blocksNav:false
const blocksNavCb = doc.querySelector('input[data-path="blocksNav"]');
assert(blocksNavCb, 'blocks navigation checkbox rendered');
assert(blocksNavCb.checked === true, 'blocksNav defaults checked when absent (absent = blocks)');
blocksNavCb.checked = false;
blocksNavCb.dispatchEvent(new window.Event('change', { bubbles: true }));

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

// --- sound (ROADMAP_NEXT item 7): blank by default, sparse round-trip
const soundInput = doc.querySelector('input[data-path="sound"]');
assert(soundInput, 'sound field rendered');
assert(soundInput.value === '', 'sound blank when absent');
soundInput.value = '/sounds/couch_creak.wav';
soundInput.dispatchEvent(new window.Event('input', { bubbles: true }));

// --- B6-12 Light card: block-presence toggle + sparse fields/defaultOn
const lightEnabled = doc.querySelector('input[data-path="light.enabled"]');
assert(lightEnabled && !lightEnabled.checked, 'Light card rendered and disabled when block absent');
lightEnabled.checked = true;
lightEnabled.dispatchEvent(new window.Event('change', { bubbles: true }));
const lightColor = doc.querySelector('input[data-path="light.color"]');
lightColor.value = '#ffeeaa'; lightColor.dispatchEvent(new window.Event('input', { bubbles: true }));
const lightIntensity = doc.querySelector('input[data-path="light.intensity"]');
lightIntensity.value = '3.5'; lightIntensity.dispatchEvent(new window.Event('input', { bubbles: true }));
const lightDefault = doc.querySelector('input[data-path="light.defaultOn"]');
lightDefault.checked = true; lightDefault.dispatchEvent(new window.Event('change', { bubbles: true }));

// --- B6-13 Wall-mounted card: empty block is enabled; height remains sparse
const wallEnabled = doc.querySelector('input[data-path="wallMounted.enabled"]');
assert(wallEnabled && !wallEnabled.checked, 'Wall-mounted card rendered and disabled when block absent');
wallEnabled.checked = true; wallEnabled.dispatchEvent(new window.Event('change', { bubbles: true }));
const wallHeight = doc.querySelector('input[data-path="wallMounted.heightY"]');
wallHeight.value = '1.8'; wallHeight.dispatchEvent(new window.Event('input', { bubbles: true }));

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

// --- usePose.use (ROADMAP_NEXT B2-3): same sparse convention, third pose card, never touched
// here on the couch — should stay absent through save (verified below).
assert(doc.querySelector('input[data-path="usePose.use.offsetX"]'), 'usePose.use offset fields rendered too (three pose cards: sit/lie/use)');
assert(doc.querySelector('input[data-path="usePose.use.y"]').value === '', 'usePose.use.y blank when absent');

// --- meshFit: sparse uniform scale, yawOffsetDeg, yOffset
const scaleInput = doc.querySelector('input[data-path="meshFit.scale"]');
assert(scaleInput.value === '', 'meshFit.scale blank when absent');
scaleInput.value = '1.2';
scaleInput.dispatchEvent(new window.Event('input', { bubbles: true }));
const yawInput = doc.querySelector('input[data-path="meshFit.yawOffsetDeg"]');
yawInput.value = '45';
yawInput.dispatchEvent(new window.Event('input', { bubbles: true }));

// --- meshFit 3-axis position offset (sparse superset): set X and Z, leave the legacy Y axis
// blank to prove the two new axes coexist with — and don't force — the pre-existing yOffset.
const xOffInput = doc.querySelector('input[data-path="meshFit.xOffset"]');
assert(xOffInput && xOffInput.value === '', 'meshFit.xOffset blank when absent');
assert(doc.querySelector('input[data-path="meshFit.yOffset"]'), 'meshFit.yOffset input still present');
assert(doc.querySelector('input[data-path="meshFit.zOffset"]'), 'meshFit.zOffset input present (3-axis)');
xOffInput.value = '0.25';
xOffInput.dispatchEvent(new window.Event('input', { bubbles: true }));
const zOffInput = doc.querySelector('input[data-path="meshFit.zOffset"]');
zOffInput.value = '-0.5';
zOffInput.dispatchEvent(new window.Event('input', { bubbles: true }));

// --- need multipliers (add/remove rows + sparse map). Add two rows, edit their values, remove
// one, and confirm the surviving one round-trips while the removed key is gone.
assert(!doc.querySelector('input[data-path^="needMultipliers."]'), 'no multiplier rows on a fresh asset');
const addMultBtn = [...doc.querySelectorAll('button')].find((b) => b.textContent === '+ Add need multiplier');
assert(addMultBtn, 'Need multipliers card renders an add button');
addMultBtn.click(); // first row (first unused need = hunger)
[...doc.querySelectorAll('button')].find((b) => b.textContent === '+ Add need multiplier').click(); // second row (comfort)
// The two rows should default to distinct needs (add picks the first UNUSED need each time).
assert(doc.querySelector('select[data-path="needMultipliers.hunger.need"]'), 'first multiplier row keyed on hunger');
const comfortSel = doc.querySelector('select[data-path="needMultipliers.comfort.need"]');
assert(comfortSel, 'second multiplier row keyed on the next unused need (comfort)');
// Set a NEGATIVE multiplier on comfort (an awful chair drains comfort) and a positive on hunger.
const hungerMult = doc.querySelector('input[data-path="needMultipliers.hunger"]');
hungerMult.value = '1.5';
hungerMult.dispatchEvent(new window.Event('input', { bubbles: true }));
const comfortMult = doc.querySelector('input[data-path="needMultipliers.comfort"]');
comfortMult.value = '-0.5';
comfortMult.dispatchEvent(new window.Event('input', { bubbles: true }));
// Remove the hunger row — its key must vanish from the sparse map (sparse deletion).
[...doc.querySelectorAll('#editor .frow')].find((r) => r.querySelector('select[data-path="needMultipliers.hunger.need"]'))
  .querySelector('button').click();
assert(!doc.querySelector('select[data-path="needMultipliers.hunger.need"]'), 'removed multiplier row is gone from the form');
assert(doc.querySelector('select[data-path="needMultipliers.comfort.need"]'), 'the untouched comfort multiplier row survives the removal');

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

// --- combustibility sparse pruning (ROADMAP_NEXT item 6), same convention as meshFit above:
// set chancePercent then clear it — the only sub-field ever touched, so the whole sparse
// combustibility object should be pruned away, not left behind as an empty {}.
const lampCombust = doc.querySelector('input[data-path="combustibility.chancePercent"]');
lampCombust.value = '30';
lampCombust.dispatchEvent(new window.Event('input', { bubbles: true }));
lampCombust.value = '';
lampCombust.dispatchEvent(new window.Event('input', { bubbles: true }));

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

// --- exterior checkbox (ROADMAP_NEXT item 9): sparse, absent = false/interior
const exteriorCb = doc.querySelector('input[data-path="door.exterior"]');
assert(exteriorCb, 'exterior checkbox rendered on the door card');
assert(exteriorCb.checked === false, 'exterior unchecked by default');
exteriorCb.checked = true;
exteriorCb.dispatchEvent(new window.Event('change', { bubbles: true }));
assert(exteriorCb.checked === true, 'exterior checkbox togglable');

// --- D1 aperture fields (ROADMAP_APT D1): sparse explicit overrides of footprint/meshFit defaults
const apW = doc.querySelector('input[data-path="door.apertureWidth"]');
const apH = doc.querySelector('input[data-path="door.apertureHeight"]');
assert(apW && apH, 'aperture width/height fields rendered on the door card');
assert(apW.value === '' && apH.value === '', 'aperture fields blank by default (derived defaults)');
apW.value = '0.9';
apW.dispatchEvent(new window.Event('input', { bubbles: true }));
// apertureHeight deliberately left blank — must stay absent in the PUT payload (sparse)

// --- accidents (§7.3): normal (non-accident) asset gets the risk-config section
doc.querySelector('[data-asset-id="stove"]').click();
assert(doc.querySelector('.card h2')?.textContent !== undefined, 'stove editor rendered');

// --- usePose.use round-trip on the stove (ROADMAP_NEXT B2-3): positive case, unlike couch above
// which only proved the sparse "never touched" absence.
const useOffsetZ = doc.querySelector('input[data-path="usePose.use.offsetZ"]');
useOffsetZ.value = '0';
useOffsetZ.dispatchEvent(new window.Event('input', { bubbles: true }));
const useY = doc.querySelector('input[data-path="usePose.use.y"]');
useY.value = '0.05';
useY.dispatchEvent(new window.Event('input', { bubbles: true }));
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

// --- combustibility (ROADMAP_NEXT item 6): sparse round-trip on a normal (non-transient) asset
assert(doc.querySelector('input[data-path="combustibility.chancePercent"]').value === '', 'combustibility.chancePercent blank when absent');
assert(doc.querySelector('input[data-path="combustibility.delaySeconds"]').value === '', 'combustibility.delaySeconds blank when absent');
const combustChance = doc.querySelector('input[data-path="combustibility.chancePercent"]');
combustChance.value = '40';
combustChance.dispatchEvent(new window.Event('input', { bubbles: true }));
const combustDelay = doc.querySelector('input[data-path="combustibility.delaySeconds"]');
combustDelay.value = '15';
combustDelay.dispatchEvent(new window.Event('input', { bubbles: true }));

// --- accident-category asset: ONLY the clearedBy multi-select, never the risk section
doc.querySelector('[data-asset-id="fire"]').click();
assert(doc.querySelector('select[data-path^="accidents."]') === null, 'accident-category asset never shows the risk-config section');
assert(doc.querySelector('input[data-path="combustibility.chancePercent"]') === null, 'transient-category asset never shows the Combustibility card either');
assert(doc.querySelector('input[data-path="food.hungerGain"]'), 'transient-category asset shows the sparse Food card');
assert(doc.querySelector('input[data-path="food.hungerGain"]').value === '', 'non-food transient leaves hunger gain blank');
const foodGain = doc.querySelector('input[data-path="food.hungerGain"]');
foodGain.value = '18'; foodGain.dispatchEvent(new window.Event('input', { bubbles: true }));
const perishHours = doc.querySelector('input[data-path="food.perishHours"]');
perishHours.value = '3'; perishHours.dispatchEvent(new window.Event('input', { bubbles: true }));
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
assert(savedCouch.blocksNav === false, 'PUT carries explicit blocksNav:false');
assert(savedCouch.survivalImportance === 75, 'PUT carries sparse survivalImportance');
assert(savedCouch.facingDeg === 90, 'PUT carries edited facingDeg');
assert(savedCouch.meshFit.scale === 1.2, 'PUT carries sparse meshFit.scale');
assert(savedCouch.meshFit.yawOffsetDeg === 45, 'PUT carries sparse meshFit.yawOffsetDeg');
assert(savedCouch.meshFit.xOffset === 0.25, 'PUT carries sparse meshFit.xOffset (3-axis)');
assert(savedCouch.meshFit.zOffset === -0.5, 'PUT carries sparse meshFit.zOffset (3-axis, negative)');
assert(!('yOffset' in savedCouch.meshFit), 'untouched meshFit.yOffset stays absent (sparse superset — new axes do not force it)');
assert(savedCouch.needMultipliers && savedCouch.needMultipliers.comfort === -0.5, 'PUT carries sparse needMultipliers (negative comfort)');
assert(!('hunger' in savedCouch.needMultipliers), 'removed need multiplier key is gone (sparse deletion)');
assert(savedCouch.usePose.sit.offset[0] === 0.3 && savedCouch.usePose.sit.offset[1] === 0, 'PUT carries usePose.sit.offset');
assert(savedCouch.usePose.sit.y === 0.42, 'PUT carries usePose.sit.y');
assert(savedCouch.usePose.sit.facingDeg === 180, 'PUT carries usePose.sit.facingDeg');
assert(!('lie' in savedCouch.usePose), 'untouched usePose.lie stays absent (sparse, per-pose)');
assert(!('use' in savedCouch.usePose), 'untouched usePose.use stays absent (sparse, per-pose, B2-3)');
const savedStoveUsePose = saved.assets.find((a) => a.id === 'stove');
assert(savedStoveUsePose.usePose.use.offset[0] === 0 && savedStoveUsePose.usePose.use.offset[1] === 0, 'PUT carries usePose.use.offset (B2-3)');
assert(savedStoveUsePose.usePose.use.y === 0.05, 'PUT carries usePose.use.y (B2-3)');
assert(!('sit' in savedStoveUsePose.usePose), 'stove usePose.use set without ever touching sit (sparse, per-pose)');
assert(savedCouch.requiresQuestUnlock === true, 'PUT carries checked requiresQuestUnlock');
assert(savedCouch.icon === '/models/icons/sofa.png', 'PUT carries edited icon path');
assert(savedCouch.sound === '/sounds/couch_creak.wav', 'PUT carries edited sound path');
assert(savedCouch.light.color === '#ffeeaa' && savedCouch.light.intensity === 3.5 && savedCouch.light.defaultOn === true, 'PUT carries sparse Light card fields');
assert(!('distance' in savedCouch.light) && !('yOffset' in savedCouch.light), 'untouched Light fields stay absent');
assert(savedCouch.wallMounted.heightY === 1.8, 'PUT carries wall-mounted height');
const savedLamp = saved.assets.find((a) => a.id === 'lamp');
assert(!('buyable' in savedLamp), 'new asset has no buyable key (defaults true)');
assert(!('blocksNav' in savedLamp), 'new asset has no blocksNav key (defaults to blocking)');
assert(!('survivalImportance' in savedLamp), 'new asset has no survivalImportance key (defaults neutral)');
assert(!('facingDeg' in savedLamp), 'new asset has no facingDeg key (defaults 0)');
assert(!('meshFit' in savedLamp), 'new asset has no meshFit key (nothing set)');
assert(!('needMultipliers' in savedLamp), 'new asset has no needMultipliers key (empty map pruned)');
assert(!('usePose' in savedLamp), 'new asset has no usePose key (nothing set)');
assert(!('requiresQuestUnlock' in savedLamp), 'new asset has no requiresQuestUnlock key (defaults unlocked)');
assert(!('icon' in savedLamp), 'new asset has no icon key (falls back to initials tile)');
assert(!('sound' in savedLamp), 'new asset has no sound key (no loop by default)');
assert(!('light' in savedLamp), 'new asset has no light block unless enabled');
assert(!('wallMounted' in savedLamp), 'new asset is not wall-mounted unless enabled');
assert(!('combustibility' in savedLamp), 'new asset has no combustibility key (set-then-cleared, pruned to absent)');
assert(savedLamp.category === 'door', 'PUT carries lamp\'s category change to door');
assert(savedLamp.door.hingeOffset[0] === -0.5 && savedLamp.door.hingeOffset[1] === 0, 'PUT carries door.hingeOffset');
assert(savedLamp.door.openAngleDeg === 100, 'PUT carries door.openAngleDeg');
assert(!('openSeconds' in savedLamp.door), 'untouched door.openSeconds stays absent (sparse, tuning fallback)');
assert(!('closeSeconds' in savedLamp.door), 'untouched door.closeSeconds stays absent (sparse, tuning fallback)');
assert(!('triggerDistance' in savedLamp.door), 'untouched door.triggerDistance stays absent (sparse, tuning fallback)');
assert(savedLamp.door.exterior === true, 'PUT carries checked door.exterior (ROADMAP_NEXT item 9)');
assert(savedLamp.door.apertureWidth === 0.9, 'PUT carries explicit door.apertureWidth (D1)');
assert(!('apertureHeight' in savedLamp.door), 'untouched door.apertureHeight stays absent (sparse, derived default)');

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
assert(savedStove.combustibility.chancePercent === 40, 'PUT carries combustibility.chancePercent');
assert(savedStove.combustibility.delaySeconds === 15, 'PUT carries combustibility.delaySeconds');

const savedFire = saved.assets.find((a) => a.id === 'fire');
assert(JSON.stringify(savedFire.clearedBy) === JSON.stringify(['extinguish']), 'PUT preserves fire\'s untouched clearedBy');
assert(savedFire.mesh === '/models/fire.gif', 'PUT carries fire\'s mesh path change to .gif');
assert(savedFire.sprite.orientation === 'flat', 'PUT carries sprite.orientation');
assert(savedFire.sprite.fps === 12, 'PUT carries sprite.fps');
assert(savedFire.food.hungerGain === 18 && savedFire.food.perishHours === 3, 'PUT carries transient food fields');
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
