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
  // ROADMAP_NEXT item 10: cleanlinessVar names a personality trait id by a free-typed string
  // (not a dropdown) — pre-set to "grit" so the personality delete tests below can exercise the
  // referenced-by-tuning.json branch against the REAL loaded doc (not a stale local fixture var).
  garbage: { autoTidyRadius: 4, cleanlinessThreshold: 5, cleanlinessVar: 'grit' },
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
const loading = {
  phrases: ['Loading visa status…', 'Going through customs…'],
  phraseIntervalSeconds: 2.5,
  music: 'sounds/loading.mp3',
  background: '',
  bar: { fillColor: '#9fd08c', trackColor: '#313b50', height: 14 },
};

const puts = {};
const fetchMock = async (url, opts = {}) => {
  const file = String(url).split('/').pop();
  if (opts.method === 'PUT') {
    puts[file] = JSON.parse(opts.body);
    return { ok: true, status: 200, json: async () => ({}) };
  }
  const body = { 'tuning.json': tuning, 'stats.json': stats, 'interactions.json': interactions, 'loading.json': loading }[file];
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

// --- dedicated loading card: edit presentation, add/remove phrases, normalize Windows public path
assert(doc.querySelector('section[data-file="loading.json"]'), 'loading screen section rendered');
const loadingBg = doc.querySelector('input[data-path="loading.background"]');
loadingBg.value = 'D:\\Game\\public\\images\\loading.jpg';
loadingBg.dispatchEvent(new window.Event('input', { bubbles: true }));
const loadingFill = doc.querySelector('input[data-path="loading.bar.fillColor"]');
loadingFill.value = '#ff8800';
loadingFill.dispatchEvent(new window.Event('input', { bubbles: true }));
doc.querySelector('[data-action="remove-loading-phrase"]').click();
doc.querySelector('[data-action="add-loading-phrase"]').click();
const addedPhrase = doc.querySelector('input[data-path="loading.phrase.1"]');
addedPhrase.value = 'Calling immigration…';
addedPhrase.dispatchEvent(new window.Event('input', { bubbles: true }));

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
assert(puts['loading.json']?.background === '/images/loading.jpg', 'PUT normalizes pasted Windows public path');
assert(puts['loading.json']?.bar.fillColor === '#ff8800', 'PUT carries loading bar color');
assert(JSON.stringify(puts['loading.json']?.phrases) === JSON.stringify(['Going through customs…', 'Calling immigration…']), 'PUT carries phrase add/remove/edit');
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

// ==================================================================
// Personality (ROADMAP_NEXT item 10) — same add/remove pattern as needs/skills above, plus
// referential integrity against tuning.json's garbage.cleanlinessVar (a free-typed string, not
// interactions.json).
// ==================================================================

// --- add a trait ("grit" — matches the fixture's pre-set tuning.garbage.cleanlinessVar above):
// prompt supplies a name, id derived, defaults are sane (no decay/autonomy fields)
window.prompt = () => 'Grit';
doc.querySelector('[data-action="add-personality"]').click();
assert(doc.querySelector('input[data-path="personality.grit.default"]'), 'new personality trait "grit" rendered');
assert(!doc.querySelector('input[data-path="personality.grit.decayPerTick"]'), 'personality traits have no decay field');
assert(!doc.querySelector('input[data-path="personality.grit.autonomy"]'), 'personality traits have no autonomy checkbox');
assert(doc.querySelector('section[data-file="stats.json"]').classList.contains('dirty'), 'adding a trait marks stats.json dirty');

// --- second, unreferenced trait
window.prompt = () => 'Neatness';
doc.querySelector('[data-action="add-personality"]').click();
assert(doc.querySelector('input[data-path="personality.neatness.default"]'), 'new personality trait "neatness" rendered');

// --- delete the unreferenced trait: plain confirm message
window.confirm = (msg) => { confirmMsg = msg; return true; };
doc.querySelector('[data-action="delete-personality"][data-personality-id="neatness"]').click();
assert(confirmMsg.includes('Nothing references it'), 'unreferenced trait gets a plain delete message');
assert(!doc.querySelector('input[data-path="personality.neatness.default"]'), 'trait "neatness" removed');

// --- cancel a referenced delete: nothing changes
window.confirm = () => false;
doc.querySelector('[data-action="delete-personality"][data-personality-id="grit"]').click();
assert(doc.querySelector('input[data-path="personality.grit.default"]'), 'cancelled delete leaves the trait in place');
assert(doc.querySelector('input[data-path="garbage.cleanlinessVar"]')?.value === 'grit', 'cancelled delete leaves cleanlinessVar untouched');

// --- confirm a referenced delete: trait removed AND tuning.json's garbage.cleanlinessVar cleared
window.confirm = (msg) => { confirmMsg = msg; return true; };
doc.querySelector('[data-action="delete-personality"][data-personality-id="grit"]').click();
assert(confirmMsg.includes('cleanlinessVar'), 'referenced-trait delete message names the cleanlinessVar reference');
assert(!doc.querySelector('input[data-path="personality.grit.default"]'), 'trait "grit" removed');
assert(doc.querySelector('section[data-file="stats.json"]').classList.contains('dirty'), 'deleting a trait marks stats.json dirty');
assert(!doc.querySelector('input[data-path="garbage.cleanlinessVar"]'), 'referenced delete strips tuning.json\'s garbage.cleanlinessVar field');

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
assert(!savedStats.personality.some((p) => p.id === 'grit' || p.id === 'neatness'), 'PUT stats.json excludes both deleted personality traits');
assert(!('cleanlinessVar' in (puts['tuning.json']?.garbage ?? {})), 'PUT tuning.json reflects the stripped cleanlinessVar');
assert(doc.getElementById('save').disabled, 'save disabled again after saving the add/remove changes');

// --- AUDIT UX 47/48/60: editable display names + engine-backed `computed` select
{
  const hungerName = doc.querySelector('input[data-path="need.hunger.name"]');
  assert(!!hungerName && hungerName.value === 'Hunger', 'need display name is editable, not display-only');
  hungerName.value = 'Appetite';
  hungerName.dispatchEvent(new window.Event('input', { bubbles: true }));

  // (earlier cases add/delete skills, so target whichever skill row is present now)
  // earlier cases delete every seeded skill/trait, so create fresh ones to rename
  doc.querySelector('button[data-action="add-skill"]').click();
  const skillName = doc.querySelector('input[data-path^="skill."][data-path$=".name"]');
  assert(!!skillName, 'skill display name is editable');
  skillName.value = 'Renamed skill';
  skillName.dispatchEvent(new window.Event('input', { bubbles: true }));
  const skillDoc = window.TuningEditor.state.docs['stats.json'];
  assert(skillDoc.skills.some((x) => x.name === 'Renamed skill'), 'skill rename writes through to stats.json');

  doc.querySelector('button[data-action="add-personality"]').click();
  const traitName = doc.querySelector('input[data-path^="personality."][data-path$=".name"]');
  assert(!!traitName, 'personality display name is editable');
  traitName.value = 'Renamed trait';
  traitName.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert(skillDoc.personality.some((x) => x.name === 'Renamed trait'), 'trait rename writes through to stats.json');

  const computedSel = doc.querySelector('[data-path="need.environment.computed"]');
  assert(!!computedSel && computedSel.tagName === 'SELECT', 'computed is a select of engine-backed formulas, never free text');
  const optionValues = [...computedSel.options].map((o) => o.value);
  assert(optionValues.includes('') && optionValues.includes('sumOfPlacedObjectEnvScores'),
    'computed offers "not computed" plus the engine formula');
  assert(optionValues.includes('sum'), 'an unknown authored computed value is preserved as an option, never silently dropped');
  assert([...computedSel.options].some((o) => o.value === 'sum' && /unknown/i.test(o.textContent)),
    'the unknown computed value is labelled as not engine-backed');

  // Turning a plain need into a computed one hides its decay row (computed needs never tick-decay).
  const hungerComputed = doc.querySelector('[data-path="need.hunger.computed"]');
  hungerComputed.value = 'sumOfPlacedObjectEnvScores';
  hungerComputed.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert(!doc.querySelector('[data-path="need.hunger.decayPerTick"]'), 'a computed need loses its decay-per-tick row');
  assert(!!doc.querySelector('[data-warn="multiple-computed"]'), 'two computed needs warn that only the first is engine-wired');

  // Back off again: the key is deleted (sparse), decay row returns, warning clears.
  const hungerComputed2 = doc.querySelector('[data-path="need.hunger.computed"]');
  hungerComputed2.value = '';
  hungerComputed2.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert(!!doc.querySelector('[data-path="need.hunger.decayPerTick"]'), 'clearing computed restores the decay row');
  assert(!doc.querySelector('[data-warn="multiple-computed"]'), 'single computed need raises no warning');
  const liveHunger = window.TuningEditor.state.docs['stats.json'].needs.find((n) => n.id === 'hunger');
  assert(liveHunger.name === 'Appetite', 'need rename writes through to stats.json');
  assert(!('computed' in liveHunger), 'clearing computed deletes the key (sparse), never stores empty string');
}

console.log('ALL TUNING-EDITOR TESTS PASSED');

function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); process.exit(1); }
}
