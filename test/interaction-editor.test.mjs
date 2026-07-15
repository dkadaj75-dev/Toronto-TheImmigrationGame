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
    { id: 'cook', name: 'Cook', needGains: {}, skillGains: { cooking: 0.05 }, animation: 'stand_use', autonomyEligible: false, primaryNeed: null, duration: { baseSeconds: 60, skillVar: 'skills.cooking', atMaxSeconds: 20, modifiers: [{ var: 'needs.hunger', atMin: 1.2, atMax: 1 }] } },
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
// ROADMAP_NEXT B2-1: read-only reference data feeding the Conditions card's var-path dropdowns
// (vars.<id> / quests.<id>.state), same fixtures shape as test/quest-editor.test.mjs.
const simstate = {
  variables: [
    { id: 'job', name: 'Job', type: 'string', default: null },
    { id: 'visaStatus', name: 'Visa Status', type: 'string', default: 'tourist' },
  ],
};
const quests = { quests: [{ id: 'first_words', name: 'First Words', description: '', trigger: { all: [] }, completion: { all: [] }, rewards: [], onceOnly: true }] };

const puts = {};
const fetchMock = async (url, opts = {}) => {
  const path = String(url).replace('/api/data/', '');
  if (opts.method === 'PUT') {
    puts[path] = JSON.parse(opts.body);
    return { ok: true, status: 200, json: async () => ({}) };
  }
  const body = { 'interactions.json': interactions, 'assets.json': assets, 'stats.json': stats, 'simstate.json': simstate, 'quests.json': quests }[path];
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
assert(doc.getElementById('anim-warn').style.display === 'none', 'no blank-animation warning while animation is set');
animInput.value = 'sit_watch';
animInput.dispatchEvent(new window.Event('input', { bubbles: true }));
assert(doc.getElementById('anim-states-hint').textContent.includes('idle'), 'animation hint lists core states');
assert(doc.getElementById('anim-states-hint').textContent.includes('sit_idle') || doc.getElementById('anim-states-hint').textContent.includes('stand_use'), 'animation hint lists states already used by other actions');
assert(doc.getElementById('anim-warn').style.display === 'none', 'no blank-animation warning after editing to a non-blank value');

// --- blank-animation warning: clear the field, warning appears; re-fill, it disappears
animInput.value = '';
animInput.dispatchEvent(new window.Event('input', { bubbles: true }));
assert(doc.getElementById('anim-warn').style.display !== 'none', 'blank-animation warning shown when animation field is cleared');
animInput.value = 'sit_watch';
animInput.dispatchEvent(new window.Event('input', { bubbles: true }));
assert(doc.getElementById('anim-warn').style.display === 'none', 'blank-animation warning hidden again once refilled');

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

// --- censor checkbox (ROADMAP_NEXT B2-3): sparse, absent = false, watch_tv starts unchecked
const censorCb = doc.querySelector('input[data-path="censor"]');
assert(censorCb, 'censor checkbox rendered');
assert(censorCb.checked === false, 'watch_tv starts uncensored');
censorCb.checked = true;
censorCb.dispatchEvent(new window.Event('change', { bubbles: true }));

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

// --- duration modifiers (ROADMAP_NEXT B2-5): cook ships one (needs.hunger, atMin 1.2/atMax 1)
assert(doc.querySelectorAll('[data-mod-index]').length === 1, 'cook renders its 1 existing duration modifier');
const modVarSel = doc.querySelector('select[data-path="duration.modifiers.0.var"]');
assert(modVarSel.value === 'needs.hunger', 'modifier var rendered from data');
assert([...modVarSel.options].map((o) => o.value).includes('skills.cooking'), 'modifier var dropdown offers skills too, not just needs');
assert(doc.querySelector('input[data-path="duration.modifiers.0.atMin"]').value === '1.2', 'modifier atMin rendered from data');
assert(doc.querySelector('input[data-path="duration.modifiers.0.atMax"]').value === '1', 'modifier atMax rendered from data');

// add a second modifier row, edit its fields, then remove the FIRST row
doc.querySelector('[data-action="add-modifier"]').click();
assert(doc.querySelectorAll('[data-mod-index]').length === 2, '+ Modifier appends a second row');
const mod1Min = doc.querySelector('input[data-path="duration.modifiers.1.atMin"]');
mod1Min.value = '0.6';
mod1Min.dispatchEvent(new window.Event('input', { bubbles: true }));
const mod1Max = doc.querySelector('input[data-path="duration.modifiers.1.atMax"]');
mod1Max.value = '0.9';
mod1Max.dispatchEvent(new window.Event('input', { bubbles: true }));
doc.querySelector('button[data-action="remove-modifier"][data-remove-index="0"]').click();
assert(doc.querySelectorAll('[data-mod-index]').length === 1, 'removing the first row leaves exactly 1 modifier');
assert(doc.querySelector('input[data-path="duration.modifiers.0.atMin"]').value === '0.6', 'the surviving modifier is the edited second row, reindexed to 0');

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
assert(savedTv.censor === true, 'PUT carries censor turned on (B2-3)');
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
assert(savedCook.duration.modifiers.length === 1, 'PUT carries exactly 1 modifier (the removed first row is gone)');
// the surviving row is the SECOND one added (default var = first stats.json need, "fun" in this
// fixture — the original "needs.hunger" row was the one removed), with its edited atMin/atMax.
assert(savedCook.duration.modifiers[0].var === 'needs.fun' && savedCook.duration.modifiers[0].atMin === 0.6 && savedCook.duration.modifiers[0].atMax === 0.9,
  `PUT carries the surviving modifier's edited fields (${JSON.stringify(savedCook.duration.modifiers[0])})`);
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

// ROADMAP_NEXT B2-5: same sparse round trip, but WITH a modifier added — clearing baseSeconds
// prunes the whole duration object (modifiers included), matching the pre-existing
// "only baseSeconds gates the whole object" convention (pruneDurationIfEmpty).
const yogaBase2 = doc.querySelector('input[data-path="duration.baseSeconds"]');
yogaBase2.value = '15';
yogaBase2.dispatchEvent(new window.Event('input', { bubbles: true }));
doc.querySelector('[data-action="add-modifier"]').click();
assert(doc.querySelectorAll('[data-mod-index]').length === 1, 'do_yoga: add-modifier works on a freshly-created duration too');
doc.querySelector('input[data-path="duration.baseSeconds"]').value = '';
doc.querySelector('input[data-path="duration.baseSeconds"]').dispatchEvent(new window.Event('input', { bubbles: true }));
// pruneDurationIfEmpty deletes the whole `duration` object (modifiers included) the moment
// baseSeconds is cleared — verified below via the PUT payload once do_yoga is saved.

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

// --- conditions card (ROADMAP_NEXT B2-1): do_yoga has no conditions by default
doc.querySelector('[data-action-id="do_yoga"]').click();
assert(doc.getElementById('addConditions'), '"+ Add condition" button shown when action has no conditions');
assert(doc.getElementById('removeConditions') === null, 'no "remove all conditions" button when absent');
doc.getElementById('addConditions').click();
assert(doc.querySelector('.cond-group'), 'adding conditions renders an empty ALL group');
assert(doc.getElementById('removeConditions'), '"remove all conditions" button appears once conditions exist');

// add a leaf, point it at vars.job, set operator to neq, leave value at its type-appropriate default (null-ish string '')
doc.querySelector('[data-action="add-leaf"]').click();
const condVarSel = doc.querySelector('.cond-var-select');
const condVarValues = [...condVarSel.options].map((o) => o.value);
assert(condVarValues.includes('vars.job') && condVarValues.includes('quests.first_words.state'), 'condition var dropdown offers Variables and Quests namespaces');
condVarSel.value = 'vars.job';
condVarSel.dispatchEvent(new window.Event('change', { bubbles: true }));
const condOpSel = doc.querySelector('select[data-role="op"]');
condOpSel.value = 'neq';
condOpSel.dispatchEvent(new window.Event('change', { bubbles: true }));

doc.getElementById('save').click();
await new Promise((r) => setTimeout(r, 50));
let savedYoga = puts['interactions.json'].actions.find((a) => a.id === 'do_yoga');
assert(JSON.stringify(savedYoga.conditions) === JSON.stringify({ all: [{ var: 'vars.job', neq: '' }] }), `PUT carries the built condition tree exactly (${JSON.stringify(savedYoga.conditions)})`);

// removing the whole conditions block prunes the sparse key entirely
doc.getElementById('removeConditions').click();
assert(doc.getElementById('addConditions'), '"+ Add condition" reappears after removing all conditions');
doc.getElementById('save').click();
await new Promise((r) => setTimeout(r, 50));
savedYoga = puts['interactions.json'].actions.find((a) => a.id === 'do_yoga');
assert(!('conditions' in savedYoga), 'PUT: conditions key fully removed (sparse) after "remove all conditions"');

// --- shipped leave_for_work-style data (a pre-existing conditions tree, not built through the UI)
// renders correctly — separate DOM instance so it doesn't disturb the shared `doc`'s state above.
{
  const interactions2 = { actions: [
    { id: 'leave_for_work', name: 'Leave for work', needGains: {}, skillGains: {}, animation: '', autonomyEligible: false, primaryNeed: null, conditions: { all: [{ var: 'vars.job', neq: null }] } },
  ] };
  const fetchMock2 = async (url, opts = {}) => {
    const path = String(url).replace('/api/data/', '');
    if (opts.method === 'PUT') return { ok: true, status: 200, json: async () => ({}) };
    const body = { 'interactions.json': interactions2, 'assets.json': assets, 'stats.json': stats, 'simstate.json': simstate, 'quests.json': quests }[path];
    return { ok: !!body, status: body ? 200 : 404, json: async () => structuredClone(body) };
  };
  const dom2 = new JSDOM(html, {
    url: 'http://localhost:5173/tools/interactions.html',
    runScripts: 'dangerously',
    beforeParse(window) { window.fetch = fetchMock2; window.confirm = () => true; window.prompt = () => ''; window.alert = () => {}; },
  });
  await new Promise((r) => setTimeout(r, 50));
  const doc2 = dom2.window.document;
  assert(doc2.getElementById('removeConditions'), 'pre-existing conditions render the builder (not the empty-state button)');
  const leafRow = doc2.querySelector('.cond-leaf');
  assert(leafRow.querySelector('.cond-var-select').value === 'vars.job', 'shipped leaf var (vars.job) renders selected');
  assert(leafRow.querySelector('select[data-role="op"]').value === 'neq', 'shipped leaf operator (neq) renders selected');
  assert(doc2.getElementById('anim-warn').style.display !== 'none', 'blank shipped animation (leave_for_work-style) shows the warning on load, no edit needed');
}

// --- search filters sidebar
const search = doc.getElementById('search');
search.value = 'yoga';
search.dispatchEvent(new window.Event('input', { bubbles: true }));
const visible = doc.querySelectorAll('.action-item');
assert(visible.length === 1 && visible[0].dataset.actionId === 'do_yoga', 'search narrows sidebar to do_yoga');

if (failures > 0) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
console.log('\nALL INTERACTION-EDITOR TESTS PASSED');
