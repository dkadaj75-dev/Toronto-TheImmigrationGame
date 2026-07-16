// Headless smoke test for tools/interactions.html (jsdom).
// Focused on the B9-1 follow-up: the sparse `faceTarget` checkbox — ticked (default true)
// deletes the key, unticked writes `faceTarget: false` explicitly. Mirrors the
// seatAware/censor sparse-boolean pattern already covered informally by the tool itself.
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../tools/interactions.html', import.meta.url), 'utf8');

const interactions = { actions: [
  {
    id: 'read_book', name: 'Read a book', needGains: { fun: 1 }, skillGains: { english: 0.04 },
    animation: 'sit_idle', autonomyEligible: true, primaryNeed: 'fun', seatAware: true, faceTarget: false,
  },
  {
    id: 'watch_tv', name: 'Watch TV', needGains: { fun: 2.5 }, skillGains: {},
    animation: 'sit_idle', autonomyEligible: true, primaryNeed: 'fun', seatAware: true,
  },
] };
const assets = { categories: ['seating', 'electronics'], assets: [
  { id: 'sofa', name: 'Sofa', category: 'seating', mesh: '', buyPrice: 0, sellPrice: 0, environmentScore: 0, footprint: [1, 1], seats: 2, seatTarget: true, interactions: ['read_book'] },
  { id: 'tv', name: 'TV', category: 'electronics', mesh: '', buyPrice: 0, sellPrice: 0, environmentScore: 0, footprint: [1, 1], interactions: ['watch_tv'] },
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

// --- read_book selected by default (first action); faceTarget:false → checkbox unchecked
assert(doc.querySelector('input[data-path="id"]').value === 'read_book', 'read_book selected by default');
const faceCb = doc.querySelector('input[data-path="faceTarget"]');
assert(faceCb, 'faceTarget checkbox rendered');
assert(faceCb.checked === false, 'faceTarget unchecked when explicitly false');

// re-check it (back to default true) → key should be deleted on save
faceCb.checked = true;
faceCb.dispatchEvent(new window.Event('change', { bubbles: true }));

// --- select watch_tv: faceTarget absent → checkbox defaults CHECKED (absent = true)
doc.querySelector('[data-action-id="watch_tv"]').click();
const faceCb2 = doc.querySelector('input[data-path="faceTarget"]');
assert(faceCb2.checked === true, 'faceTarget defaults checked when absent');
faceCb2.checked = false;
faceCb2.dispatchEvent(new window.Event('change', { bubbles: true }));

// --- save: PUT reflects both round-trips
doc.getElementById('save').click();
await new Promise((r) => setTimeout(r, 50));
const saved = puts['interactions.json'];
assert(saved, 'PUT sent to interactions.json');
const savedReadBook = saved.actions.find((a) => a.id === 'read_book');
assert(!('faceTarget' in savedReadBook), 're-checking faceTarget deletes the key (back to default true)');
const savedWatchTv = saved.actions.find((a) => a.id === 'watch_tv');
assert(savedWatchTv.faceTarget === false, 'unchecking faceTarget on watch_tv writes faceTarget:false');

console.log('ALL INTERACTION-EDITOR TESTS PASSED');

function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); process.exit(1); }
}
