// Headless smoke test for tools/assets.html (jsdom; the 3D module script is inert here).
// Verifies: load + sidebar render with placed-count badges, selecting, editing fields,
// interaction toggles, seat flags (sparse), duplicate/new/delete with usage warning,
// exact PUT payload, search filtering.
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../tools/assets.html', import.meta.url), 'utf8');

const assets = {
  categories: ['seating', 'electronics', 'door'],
  assets: [
    { id: 'couch', name: 'Couch', category: 'seating', mesh: '/models/couch.glb', buyPrice: 500, sellPrice: 375, environmentScore: 5, footprint: [2, 1], seats: 3, seatTarget: true, interactions: [] },
    { id: 'tv', name: 'TV', category: 'electronics', mesh: '/models/tv.glb', buyPrice: 800, sellPrice: 600, environmentScore: 8, footprint: [1, 1], interactions: ['watch_tv'] },
  ],
};
const interactions = { actions: [
  { id: 'watch_tv', name: 'Watch TV', needGains: {}, skillGains: {}, animation: 'sit', autonomyEligible: true },
  { id: 'nap', name: 'Nap', needGains: {}, skillGains: {}, animation: 'lie', autonomyEligible: true },
] };
const condo = { placedObjects: [{ asset: 'couch', pos: [1, 1], rotDeg: 0 }, { asset: 'couch', pos: [3, 1], rotDeg: 0 }] };

const puts = {};
const fetchMock = async (url, opts = {}) => {
  const path = String(url).replace('/api/data/', '');
  if (opts.method === 'PUT') {
    puts[path] = JSON.parse(opts.body);
    return { ok: true, status: 200, json: async () => ({}) };
  }
  const body = { 'assets.json': assets, 'interactions.json': interactions, 'maps/condo.json': condo }[path];
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
assert(items.length === 2, `sidebar shows 2 assets (${items.length})`);
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
assert(doc.querySelectorAll('.asset-item').length === 1, 'tv removed from sidebar');

// --- couch delete button warns about usage
doc.querySelector('[data-asset-id="couch"]').click();
assert(doc.getElementById('delete').textContent.includes('×2'), 'used asset delete label warns');

// --- new asset via prompt
doc.getElementById('new').click();
assert(doc.querySelectorAll('.asset-item').length === 2, 'new asset appears');
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
const savedLamp = saved.assets.find((a) => a.id === 'lamp');
assert(!('buyable' in savedLamp), 'new asset has no buyable key (defaults true)');
assert(!('facingDeg' in savedLamp), 'new asset has no facingDeg key (defaults 0)');
assert(!('meshFit' in savedLamp), 'new asset has no meshFit key (nothing set)');
assert(savedLamp.category === 'door', 'PUT carries lamp\'s category change to door');
assert(savedLamp.door.hingeOffset[0] === -0.5 && savedLamp.door.hingeOffset[1] === 0, 'PUT carries door.hingeOffset');
assert(savedLamp.door.openAngleDeg === 100, 'PUT carries door.openAngleDeg');
assert(!('openSeconds' in savedLamp.door), 'untouched door.openSeconds stays absent (sparse, tuning fallback)');
assert(!('closeSeconds' in savedLamp.door), 'untouched door.closeSeconds stays absent (sparse, tuning fallback)');
assert(!('triggerDistance' in savedLamp.door), 'untouched door.triggerDistance stays absent (sparse, tuning fallback)');

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
