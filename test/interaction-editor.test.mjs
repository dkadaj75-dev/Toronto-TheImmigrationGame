// Headless smoke test for tools/interactions.html (jsdom).
// Verifies: load + sidebar render (player-only badge), selecting, editing fields
// (name/animation/primaryNeed/need+skill gains/autonomyEligible/seatAware), exact PUT
// payload, add action with id uniquify, remove unreferenced action (plain confirm),
// remove referenced action (confirm lists assets, strips the id from assets.json,
// both files PUT together), search filtering.
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '../tools/interactions.html'), 'utf8');

const interactions = {
  actions: [
    { id: 'watch_tv', name: 'Watch TV', needGains: { fun: 2.5 }, skillGains: { english: 0.02 }, animation: 'sit_idle', autonomyEligible: true, primaryNeed: 'fun', seatAware: true },
    { id: 'cook', name: 'Cook', needGains: {}, skillGains: { cooking: 0.05 }, animation: 'stand_use', autonomyEligible: false, primaryNeed: null, duration: { baseSeconds: 60, skillVar: 'skills.cooking', atMaxSeconds: 20 } },
  ],
};
const assets = {
  categories: ['electronics', 'appliances'],
  assets: [
    { id: 'tv', name: 'TV', category: 'electronics', mesh: 'models/tv.glb', buyPrice: 800, sellPrice: 600, environmentScore: 2, footprint: [2, 1], interactions: ['watch_tv'] },
    { id: 'stove', name: 'Stove', category: 'appliances', mesh: 'models/stove.glb', buyPrice: 400, sellPrice: 300, environmentScore: 1, footprint: [1, 1], interactions: ['cook'] },
  ],
};
const stats = {
  needs: [
    { id: 'fun', name: 'Fun', color: '#9b59b6', default: 70, decayPerTick: 0.07, autonomy: true },
    { id: 'hunger', name: 'Hunger', color: '#e74c3c', default: 70, decayPerTick: 0.1, autonomy: true },
  ],
  skills: [
    { id: 'english', name: 'English', color: '#2980b9', default: 3, max: 10 },
    { id: 'cooking', name: 'Cooking', color: '#d35400', default: 0, max: 10 },
  ],
};

const puts = {};
const fetchMock = async (url, opts = {}) => {
  const path = String(url).replace('/api/data/', '');
  if (opts.method === 'PUT') {
    puts[path] = JSON.parse(opts.body);
    return { ok: true, status: 200, json: async () => ({}) };
  }
  const body = { 'interactions.json': interactions, 'assets.json': assets, 'stats.json': stats }[path];
  return { ok: !!body, status: body ? 200 : 404, json: async () => structuredClone(body) };
};

const dom = new JSDOM(html, {
  url: 'http://localhost:5173/tools/interactions.html',
  runScripts: 'dangerously',
  beforeParse(window) {
    window.fetch = fetchMock;
    window.confirm = () => true;
    window.prompt = () => 'Do Yoga';
    window.alert = () => {};
  },
});
const { window } = dom;
const doc = window.document;
await new Promise((r) => setTimeout(r, 50));

let failures = 0;
function assert(cond, msg) {
  if (cond) console.log('  ok  ' + msg);
  else { failures++; console.error('FAIL  ' + msg); }
}

// --- sidebar rendered, player-only badge on autonomy-ineligible action
const items = doc.querySelectorAll('.action-item');
assert(items.length === 2, `sidebar shows 2 actions (${items.length})`);
assert(doc.querySelector('[data-action-id="watch_tv"] .badge') === null, 'watch_tv (autonomy-eligible) has no badge');
assert(doc.querySelector('[data-action-id="cook"] .badge')?.textContent === 'player-only', 'cook (autonomy-ineligible) shows player-only badge');

// --- watch_tv selected by default; id is readonly
assert(doc.querySelector('input[data-path="id"]').value === 'watch_tv', 'watch_tv selected by default');
assert(doc.querySelector('input[data-path="id"]').readOnly, 'id field is readonly');

// --- edit name, animation
const nameInput = doc.querySelector('input[data-path="name"]');
nameInput.value = 'Watch Television';
nameInput.dispatchEvent(new window.Event('input', { bubbles: true }));
assert(!doc.getElementById('save').disabled, 'save enabled after edit');
assert(doc.querySelector('[data-action-id="watch_tv"] span')?.textContent === 'Watch Television', 'sidebar label updates live on name edit');

const animInput = doc.querySelector('input[data-path="animation"]');
assert(animInput.value === 'sit_idle', 'animation field rendered');
animInput.value = 'sit_watch';
animInput.dispatchEvent(new window.Event('input', { bubbles: true }));
assert(doc.querySelector('.hint-line').textContent.includes('idle'), 'animation hint lists core states');
assert(doc.querySelector('.hint-line').textContent.includes('sit_idle') || doc.querySelector('.hint-line').textContent.includes('stand_use'), 'animation hint lists states already used by other actions');

// --- autonomy eligible + seat aware toggles round-trip
const autoCb = doc.querySelector('input[data-path="autonomyEligible"]');
assert(autoCb.checked, 'watch_tv starts autonomy-eligible');
autoCb.checked = false;
autoCb.dispatchEvent(new window.Event('change', { bubbles: true }));
assert(doc.querySelector('[data-action-id="watch_tv"] .badge')?.textContent === 'player-only', 'unchecking autonomyEligible immediately updates sidebar badge');
autoCb.checked = true;
autoCb.dispatchEvent(new window.Event('change', { bubbles: true }));

const seatCb = doc.querySelector('input[data-path="seatAware"]');
assert(seatCb.checked, 'watch_tv starts seat-aware');
seatCb.checked = false;
seatCb.dispatchEvent(new window.Event('change', { bubbles: true }));

// --- primary need dropdown fed from stats.json, no free-typed ids
const needSel = doc.querySelector('select[data-path="primaryNeed"]');
const needOptValues = [...needSel.options].map((o) => o.value);
assert(needOptValues.includes('fun') && needOptValues.includes('hunger') && needOptValues.includes(''), 'primary need options come from stats.json needs + none');
needSel.value = 'hunger';
needSel.dispatchEvent(new window.Event('change', { bubbles: true }));

// --- need + skill gain fields, sparse add/remove
const funGain = doc.querySelector('input[data-path="gain.need.fun"]');
assert(funGain.value === '2.5', 'existing need gain rendered');
funGain.value = '';
funGain.dispatchEvent(new window.Event('input', { bubbles: true }));
const hungerGain = doc.querySelector('input[data-path="gain.need.hunger"]');
assert(hungerGain.value === '', 'absent need gain renders blank');
hungerGain.value = '1.5';
hungerGain.dispatchEvent(new window.Event('input', { bubbles: true }));
const englishGain = doc.querySelector('input[data-path="gain.skill.english"]');
assert(englishGain.value === '0.02', 'existing skill gain rendered');
const cookingGainOnTv = doc.querySelector('input[data-path="gain.skill.cooking"]');
assert(cookingGainOnTv.value === '', 'unrelated skill gain renders blank on watch_tv');

// --- sound (ROADMAP_NEXT item 7): blank by default, sparse round-trip
const soundInput = doc.querySelector('input[data-path="sound"]');
assert(soundInput, 'sound field rendered');
assert(soundInput.value === '', 'watch_tv has no sound set (blank)');
soundInput.value = '/sounds/action_beep.wav';
soundInput.dispatchEvent(new window.Event('input', { bubbles: true }));

// --- duration fields (ROADMAP_NEXT item 5, §7.11): watch_tv has none, cook ships the worked example
assert(doc.querySelector('input[data-path="duration.baseSeconds"]').value === '', 'watch_tv has no duration.baseSeconds (blank)');
assert(doc.querySelector('select[data-path="duration.skillVar"]').value === '', 'watch_tv duration skillVar defaults to none');
assert(doc.querySelector('input[data-path="duration.atMaxSeconds"]').value === '', 'watch_tv has no duration.atMaxSeconds (blank)');

doc.querySelector('[data-action-id="cook"]').click();
assert(doc.querySelector('input[data-path="duration.baseSeconds"]').value === '60', 'cook duration.baseSeconds rendered from data');
const skillVarSel = doc.querySelector('select[data-path="duration.skillVar"]');
assert(skillVarSel.value === 'skills.cooking', 'cook duration.skillVar rendered from data, options fed from stats.json skills');
assert([...skillVarSel.options].map((o) => o.value).includes('skills.english'), 'duration skillVar dropdown offers every stats.json skill');
assert(doc.querySelector('input[data-path="duration.atMaxSeconds"]').value === '20', 'cook duration.atMaxSeconds rendered from data');

// edit base + clear skillVar (prunes only the skillVar key — baseSeconds/atMaxSeconds remain, since
// the object itself is only pruned when baseSeconds is cleared)
const durBaseCook = doc.querySelector('input[data-path="duration.baseSeconds"]');
durBaseCook.value = '50';
durBaseCook.dispatchEvent(new window.Event('input', { bubbles: true }));
skillVarSel.value = '';
skillVarSel.dispatchEvent(new window.Event('change', { bubbles: true }));

// --- save: PUT carries all edits on interactions.json
doc.getElementById('save').click();
await new Promise((r) => setTimeout(r, 50));
let saved = puts['interactions.json'];
assert(saved, 'PUT sent to interactions.json');
let savedTv = saved.actions.find((a) => a.id === 'watch_tv');
assert(savedTv.name === 'Watch Television', 'PUT carries edited name');
assert(savedTv.animation === 'sit_watch', 'PUT carries edited animation');
assert(savedTv.autonomyEligible === true, 'PUT carries autonomyEligible round-trip (toggled off then back on)');
assert(savedTv.seatAware === undefined, 'PUT reflects seatAware turned off (sparse key removed)');
assert(savedTv.primaryNeed === 'hunger', 'PUT carries edited primaryNeed');
assert(!('fun' in savedTv.needGains), 'PUT removed blanked need gain key');
assert(savedTv.needGains.hunger === 1.5, 'PUT added new need gain key');
assert(savedTv.skillGains.english === 0.02, 'untouched skill gain preserved');
assert(savedTv.duration === undefined, 'PUT: watch_tv still has no duration key (never touched)');
assert(savedTv.sound === '/sounds/action_beep.wav', 'PUT carries edited sound path');
let savedCook = saved.actions.find((a) => a.id === 'cook');
assert(savedCook.duration.baseSeconds === 50, 'PUT carries edited cook duration.baseSeconds');
assert(savedCook.duration.skillVar === undefined, 'PUT: clearing skillVar prunes only that key');
assert(savedCook.duration.atMaxSeconds === 20, 'PUT: untouched atMaxSeconds preserved after skillVar was cleared');
assert(doc.getElementById('save').disabled, 'save disabled after saving');

// --- add action: prompted name, slugified+uniquified id, sane defaults
window.prompt = () => 'Do Yoga';
doc.getElementById('new').click();
assert(doc.querySelectorAll('.action-item').length === 3, 'new action appears in sidebar');
assert(doc.querySelector('input[data-path="id"]').value === 'do_yoga', 'new action id slugified from name');
assert(doc.querySelector('input[data-path="name"]').value === 'Do Yoga', 'new action name set from prompt');
assert(doc.querySelector('input[data-path="animation"]').value === '', 'new action defaults to blank animation');
assert(doc.querySelector('input[data-path="autonomyEligible"]').checked, 'new action defaults autonomy-eligible');
assert(doc.querySelector('select[data-path="primaryNeed"]').value === '', 'new action defaults to no primary need');
assert(doc.querySelector('input[data-path="duration.baseSeconds"]').value === '', 'new action defaults to no duration');
assert(doc.querySelector('input[data-path="sound"]').value === '', 'new action defaults to no sound');

// duration full sparse round trip on the new action: set baseSeconds only, then clear it back —
// the whole `duration` object should be pruned, not left as an empty {}
const yogaBase = doc.querySelector('input[data-path="duration.baseSeconds"]');
yogaBase.value = '15';
yogaBase.dispatchEvent(new window.Event('input', { bubbles: true }));
yogaBase.value = '';
yogaBase.dispatchEvent(new window.Event('input', { bubbles: true }));

// duplicate name → uniquified id, not a collision
window.prompt = () => 'Do Yoga';
doc.getElementById('new').click();
assert(doc.querySelectorAll('.action-item').length === 4, 'second Do Yoga added');
assert(doc.querySelector('input[data-path="id"]').value === 'do_yoga_2', 'duplicate name gets uniquified id (do_yoga_2)');

// cancelled prompt adds nothing
window.prompt = () => '';
const countBefore = doc.querySelectorAll('.action-item').length;
doc.getElementById('new').click();
assert(doc.querySelectorAll('.action-item').length === countBefore, 'blank prompt adds no action');

// --- remove unreferenced action (do_yoga_2): plain confirm message, no assets.json change
doc.querySelector('[data-action-id="do_yoga_2"]').click();
let confirmMsg = '';
window.confirm = (msg) => { confirmMsg = msg; return true; };
doc.getElementById('delete').click();
assert(confirmMsg.includes('No assets reference it'), 'unreferenced action gets a plain delete message');
assert(doc.querySelector('[data-action-id="do_yoga_2"]') === null, 'do_yoga_2 removed from sidebar');

// --- cancel a referenced delete: nothing changes
doc.querySelector('[data-action-id="cook"]').click();
window.confirm = () => false;
doc.getElementById('delete').click();
assert(doc.querySelector('[data-action-id="cook"]') !== null, 'cancelled delete leaves the action in place');

// --- confirm a referenced delete: action removed AND asset's interactions list stripped
window.confirm = (msg) => { confirmMsg = msg; return true; };
assert(doc.getElementById('delete').textContent.includes('1 asset'), 'referenced action delete label warns with usage count');
doc.getElementById('delete').click();
assert(confirmMsg.includes('Stove'), 'referenced-action delete lists the referencing asset by name');
assert(doc.querySelector('[data-action-id="cook"]') === null, 'action "cook" removed from sidebar');

// --- save: PUT reflects the final add/remove state on both files
doc.getElementById('save').click();
await new Promise((r) => setTimeout(r, 50));
saved = puts['interactions.json'];
const savedAssets = puts['assets.json'];
assert(saved.actions.some((a) => a.id === 'do_yoga'), 'PUT interactions.json includes the surviving new action');
assert(!saved.actions.some((a) => a.id === 'do_yoga_2' || a.id === 'cook'), 'PUT interactions.json excludes deleted actions');
assert(saved.actions.find((a) => a.id === 'do_yoga').duration === undefined, 'PUT: do_yoga duration fully pruned after set-then-clear (no stray empty object)');
assert(savedAssets, 'PUT sent to assets.json (referential integrity strip)');
const savedStove = savedAssets.assets.find((x) => x.id === 'stove');
assert(!savedStove.interactions.includes('cook'), 'PUT assets.json stripped the dangling "cook" interaction id from Stove');
assert(doc.getElementById('save').disabled, 'save disabled again after saving');

// --- search filters sidebar
const search = doc.getElementById('search');
search.value = 'yoga';
search.dispatchEvent(new window.Event('input', { bubbles: true }));
const visible = doc.querySelectorAll('.action-item');
assert(visible.length === 1 && visible[0].dataset.actionId === 'do_yoga', 'search narrows sidebar to do_yoga');

if (failures > 0) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
console.log('\nALL INTERACTION-EDITOR TESTS PASSED');
