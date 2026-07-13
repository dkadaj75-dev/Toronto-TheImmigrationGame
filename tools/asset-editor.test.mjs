// Headless smoke test for tools/assets.html (jsdom; the 3D module script is inert here).
// Verifies: load + sidebar render with placed-count badges, selecting, editing fields,
// interaction toggles, seat flags (sparse), duplicate/new/delete with usage warning,
// exact PUT payload, search filtering.
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../tools/assets.html', import.meta.url), 'utf8');

const assets = {
  categories: ['seating', 'electronics'],
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

// --- clear the sparse seats field
const seats = doc.querySelector('input[data-path="seats"]');
seats.value = '';
seats.dispatchEvent(new window.Event('input', { bubbles: true }));

// --- select TV, verify form re-renders
doc.querySelector('[data-asset-id="tv"]').click();
assert(doc.querySelector('input[data-path="buyPrice"]').value === '800', 'tv form rendered after select');
assert(doc.querySelector('input[data-path="interaction:watch_tv"]').checked, 'tv has watch_tv checked');

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
