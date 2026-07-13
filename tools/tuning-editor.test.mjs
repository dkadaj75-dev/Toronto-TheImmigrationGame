// Headless smoke test for tools/tuning.html using jsdom.
// Verifies: load + render from the API, editing marks dirty, PUT sends the exact
// modified JSON, sparse gain maps add/remove keys correctly, search filters rows.
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../tools/tuning.html', import.meta.url), 'utf8');

const tuning = {
  simulation: { needsDecayTickSeconds: 1, activityGainTickSeconds: 2 },
  autonomy: { seekBelowThreshold: 30, stopAtThreshold: 95, postPlayerCommandCooldownSeconds: 10 },
  time: { secondsPerGameDay: 60, nightStartHour: 22, nightEndHour: 7 },
  economy: { startingFunds: 1000, currencyName: 'condobucks' },
  movement: { walkSpeed: 2, arrivalRadius: 0.3 },
  camera: { minZoom: 4, maxZoom: 20, minPitchDeg: 30, maxPitchDeg: 70, panBoundsPadding: 2 },
};
const stats = {
  needs: [
    { id: 'hunger', name: 'Hunger', color: '#e07a5f', default: 70, decayPerTick: 0.5, autonomy: true },
    { id: 'environment', name: 'Environment', color: '#9b8ec4', default: 50, decayPerTick: 0, autonomy: false, computed: 'sum' },
  ],
  skills: [{ id: 'english', name: 'English', color: '#5390d9', default: 0, max: 10 }],
};
const interactions = {
  actions: [
    { id: 'watch_tv', name: 'Watch TV', needGains: { fun: 5 }, skillGains: { english: 0.1 }, animation: 'sit', autonomyEligible: true, primaryNeed: 'fun', seatAware: true },
  ],
};

const puts = {};
const fetchMock = async (url, opts = {}) => {
  const file = String(url).split('/').pop();
  if (opts.method === 'PUT') {
    puts[file] = JSON.parse(opts.body);
    return { ok: true, status: 200, json: async () => ({}) };
  }
  const body = { 'tuning.json': tuning, 'stats.json': stats, 'interactions.json': interactions }[file];
  return { ok: !!body, status: body ? 200 : 404, json: async () => structuredClone(body) };
};

const dom = new JSDOM(html, {
  url: 'http://localhost:5173/tools/tuning.html',
  runScripts: 'dangerously',
  beforeParse(window) { window.fetch = fetchMock; },
});
const { window } = dom;
const doc = window.document;

await new Promise((r) => setTimeout(r, 50)); // let load() finish

// --- rendered from API
const rows = doc.querySelectorAll('.row');
assert(rows.length > 15, `rendered ${rows.length} parameter rows`);
const walkSpeed = doc.querySelector('input[data-path="movement.walkSpeed"]');
assert(walkSpeed && walkSpeed.value === '2', 'walkSpeed rendered with value 2');
assert(doc.querySelector('input[data-path="need.environment.decayPerTick"]') === null, 'computed need hides decay field');
assert(doc.getElementById('save').disabled, 'save disabled while clean');

// --- edit a tuning number → dirty + PUT payload contains it
walkSpeed.value = '3.5';
walkSpeed.dispatchEvent(new window.Event('input', { bubbles: true }));
assert(!doc.getElementById('save').disabled, 'save enabled after edit');
assert(doc.querySelector('section[data-file="tuning.json"]').classList.contains('dirty'), 'tuning section marked dirty');

// --- sanity hint: out-of-range warns
const decay = doc.querySelector('input[data-path="need.hunger.decayPerTick"]');
decay.value = '9';
decay.dispatchEvent(new window.Event('input', { bubbles: true }));
assert(decay.classList.contains('warn'), 'out-of-range decay gets warn style');
decay.value = '0.8';
decay.dispatchEvent(new window.Event('input', { bubbles: true }));
assert(!decay.classList.contains('warn'), 'in-range clears warn');

// --- sparse gains: add a hunger gain to watch_tv, blank out english gain
const hungerGain = doc.querySelector('input[data-path="action.watch_tv.gain:hunger"]');
assert(hungerGain.value === '', 'absent gain renders blank');
hungerGain.value = '-2';
hungerGain.dispatchEvent(new window.Event('input', { bubbles: true }));
const englishGain = doc.querySelector('input[data-path="action.watch_tv.gain:english"]');
englishGain.value = '';
englishGain.dispatchEvent(new window.Event('input', { bubbles: true }));

// --- save all dirty files
doc.getElementById('save').click();
await new Promise((r) => setTimeout(r, 50));

assert(puts['tuning.json']?.movement.walkSpeed === 3.5, 'PUT tuning.json carries new walkSpeed');
assert(puts['stats.json']?.needs[0].decayPerTick === 0.8, 'PUT stats.json carries new decay');
assert(puts['interactions.json']?.actions[0].needGains.hunger === -2, 'PUT adds hunger gain key');
assert(!('english' in puts['interactions.json'].actions[0].skillGains), 'PUT removed blanked skill gain key');
assert(puts['interactions.json'].actions[0].needGains.fun === 5, 'untouched gain preserved');
assert(doc.getElementById('save').disabled, 'save disabled again after saving');

// --- search filters
const search = doc.getElementById('search');
search.value = 'walkspeed';
search.dispatchEvent(new window.Event('input', { bubbles: true }));
const visible = [...doc.querySelectorAll('.row')].filter((r) => !r.classList.contains('hidden'));
assert(visible.length === 1 && visible[0].dataset.label.includes('walkspeed'), 'search narrows to walkSpeed row');
assert(doc.querySelector('section[data-file="stats.json"]').classList.contains('hidden'), 'empty sections hidden by search');

// clear search before exercising add/remove flows
search.value = '';
search.dispatchEvent(new window.Event('input', { bubbles: true }));

// ==================================================================
// Add / remove needs & skills (designer-autonomy slice)
// ==================================================================

// --- add a need: prompt supplies a name, id is derived + defaults are sane
window.prompt = () => 'Thirst';
doc.querySelector('[data-action="add-need"]').click();
const thirstGroup = doc.querySelector('input[data-path="need.thirst.default"]');
assert(thirstGroup, 'new need "thirst" rendered with a default field');
assert(doc.querySelector('input[data-path="need.thirst.decayPerTick"]'), 'new need has a decay field (not computed)');
assert(doc.querySelector('input[data-path="need.thirst.autonomy"]').checked, 'new need defaults to autonomy-eligible');
assert(doc.querySelector('section[data-file="stats.json"]').classList.contains('dirty'), 'adding a need marks stats.json dirty');
// default/decay copied from the average of existing (non-computed) needs — here just "hunger",
// whose decayPerTick was changed to 0.8 by the sanity-hint test above (default stayed 70)
assert(Number(thirstGroup.value) === 70, 'new need default copies the average of existing needs');
assert(doc.querySelector('input[data-path="need.thirst.decayPerTick"]').value === '0.8', 'new need decay copies the average of existing needs');

// --- cancelled prompt adds nothing
window.prompt = () => '';
const needCountBefore = doc.querySelectorAll('section[data-file="stats.json"] .group').length;
doc.querySelector('[data-action="add-need"]').click();
assert(doc.querySelectorAll('section[data-file="stats.json"] .group').length === needCountBefore, 'blank prompt adds no need');

// --- duplicate names get a uniquified id, not a collision
window.prompt = () => 'Thirst';
doc.querySelector('[data-action="add-need"]').click();
assert(doc.querySelector('input[data-path="need.thirst_2.default"]'), 'second "Thirst" gets a uniquified id (thirst_2)');

// --- add a need whose id happens to match an existing action reference ("fun"), to test the
// referenced-deletion path below (the fixture's watch_tv action already has needGains.fun + primaryNeed "fun")
window.prompt = () => 'Fun';
doc.querySelector('[data-action="add-need"]').click();
assert(doc.querySelector('input[data-path="need.fun.default"]'), 'need "fun" added');

// --- add a skill: prompt supplies a name, id derived, max copies average of existing skills
window.prompt = () => 'Gardening';
doc.querySelector('[data-action="add-skill"]').click();
assert(doc.querySelector('input[data-path="skill.gardening.default"]'), 'new skill "gardening" rendered');
assert(doc.querySelector('input[data-path="skill.gardening.default"]').value === '0', 'new skill starts at 0 (skills grow through practice)');
assert(doc.querySelector('input[data-path="skill.gardening.max"]').value === '10', 'new skill max copies average of existing skills (english=10)');
assert(doc.querySelector('input[data-path="skill.gardening.enabled"]').checked, 'new skill enabled by default');

// give "gardening" a real gain on watch_tv so the referenced-skill-delete path (below) has
// something to strip — the earlier "sparse gains" test already blanked out watch_tv's original
// english gain, so english is unreferenced by this point (used for the unreferenced-skill case).
const gardeningGain = doc.querySelector('input[data-path="action.watch_tv.gain:gardening"]');
assert(gardeningGain, 'gardening gain field rendered on watch_tv after the skill was added');
gardeningGain.value = '0.05';
gardeningGain.dispatchEvent(new window.Event('input', { bubbles: true }));

// --- delete an unreferenced need: plain confirm message, no interactions.json change
let confirmMsg = '';
window.confirm = (msg) => { confirmMsg = msg; return true; };
doc.querySelector('[data-action="delete-need"][data-need-id="thirst_2"]').click();
assert(confirmMsg.includes('No actions reference it'), 'unreferenced need gets a plain delete message');
assert(!doc.querySelector('input[data-path="need.thirst_2.default"]'), 'thirst_2 removed from the DOM');

// --- cancel a referenced delete: nothing changes
window.confirm = () => false;
doc.querySelector('[data-action="delete-need"][data-need-id="fun"]').click();
assert(doc.querySelector('input[data-path="need.fun.default"]'), 'cancelled delete leaves the need in place');

// --- confirm a referenced delete: need removed AND dangling references stripped from interactions.json
window.confirm = (msg) => { confirmMsg = msg; return true; };
doc.querySelector('[data-action="delete-need"][data-need-id="fun"]').click();
assert(confirmMsg.includes('Watch TV') && confirmMsg.includes('primary need'), 'referenced-need delete lists the referencing action and field');
assert(!doc.querySelector('input[data-path="need.fun.default"]'), 'need "fun" removed');
assert(doc.querySelector('section[data-file="interactions.json"]').classList.contains('dirty'), 'stripping references marks interactions.json dirty');

// --- delete an unreferenced skill: plain confirm message (its earlier gain was blanked out above)
window.confirm = (msg) => { confirmMsg = msg; return true; };
doc.querySelector('[data-action="delete-skill"][data-skill-id="english"]').click();
assert(confirmMsg.includes('No actions reference it'), 'unreferenced skill gets a plain delete message');
assert(!doc.querySelector('input[data-path="skill.english.default"]'), 'skill "english" removed');

// --- delete a referenced skill: strips the skillGains key too
window.confirm = (msg) => { confirmMsg = msg; return true; };
doc.querySelector('[data-action="delete-skill"][data-skill-id="gardening"]').click();
assert(confirmMsg.includes('Watch TV'), 'referenced-skill delete lists the referencing action');
assert(!doc.querySelector('input[data-path="skill.gardening.default"]'), 'skill "gardening" removed');

// --- save: PUT reflects the final add/remove state
doc.getElementById('save').click();
await new Promise((r) => setTimeout(r, 50));
const savedStats = puts['stats.json'];
const savedInteractions = puts['interactions.json'];
assert(savedStats.needs.some((n) => n.id === 'thirst'), 'PUT stats.json includes the surviving new need "thirst"');
assert(!savedStats.needs.some((n) => n.id === 'fun' || n.id === 'thirst_2'), 'PUT stats.json excludes deleted needs');
assert(!savedStats.skills.some((s) => s.id === 'gardening' || s.id === 'english'), 'PUT stats.json excludes both deleted skills');
const watchTv = savedInteractions.actions.find((a) => a.id === 'watch_tv');
assert(!('fun' in watchTv.needGains), 'PUT interactions.json stripped the dangling needGains.fun key');
assert(watchTv.primaryNeed === null, 'PUT interactions.json cleared the dangling primaryNeed');
assert(!('gardening' in watchTv.skillGains), 'PUT interactions.json stripped the dangling skillGains.gardening key');
assert(doc.getElementById('save').disabled, 'save disabled again after saving the add/remove changes');

console.log('ALL TUNING-EDITOR TESTS PASSED');

function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); process.exit(1); }
}
