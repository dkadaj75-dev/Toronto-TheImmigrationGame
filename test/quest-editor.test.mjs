// Headless smoke test for tools/quests.html (jsdom).
// Verifies: load + render (variables list, quest sidebar, quest editor), variable CRUD
// (edit type/default incl. null toggle, add with slugify+uniquify, both referential-integrity
// delete branches), quest add + uniquify, condition-builder edits producing exact nested
// all/any JSON, rewards rows (all 4 types, add/edit/remove), quest delete both branches,
// validation panel (empty groups, unknown ids, missing operator), exact PUT payloads.
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '../tools/quests.html'), 'utf8');
// ROADMAP_APT R1: the condition builder now lives in the shared tools/condition-builder.js, loaded
// on the real page via <script src>. jsdom does not fetch external scripts, so we evaluate its
// source into the window before the page's inline script runs (same pattern as toolnav.test.mjs).
const condBuilderSrc = readFileSync(join(here, '../tools/condition-builder.js'), 'utf8');

const simstate = {
  variables: [
    { id: 'visaStatus', name: 'Visa Status', type: 'string', default: 'tourist' },
    { id: 'job', name: 'Job', type: 'string', default: null },
    { id: 'unused_var', name: 'Unused Var', type: 'number', default: 0 },
  ],
};
const quests = {
  quests: [
    {
      id: 'first_words', name: 'First Words', description: 'Reach English level 10 and save 500.',
      trigger: { all: [{ var: 'skills.english', gte: 1 }] },
      completion: { all: [{ var: 'skills.english', gte: 10 }, { var: 'funds', gte: 500 }] },
      rewards: [{ type: 'funds', amount: 200 }, { type: 'setVar', var: 'visaStatus', value: 'student' }],
      onceOnly: true,
    },
    {
      id: 'explore_condo', name: 'Explore The Condo', description: 'Finish First Words then look around.',
      trigger: { all: [{ var: 'quests.first_words.state', eq: 'done' }] },
      completion: { any: [{ var: 'vars.visaStatus', eq: 'student' }] },
      rewards: [],
      onceOnly: false,
    },
    {
      id: 'broken_quest', name: 'Broken Quest', description: 'Intentionally bad data for validation coverage.',
      trigger: { all: [{ var: 'needs.nonexistent_need', gte: 5 }] },
      completion: { all: [{ var: 'vars.missing_var' }] },
      rewards: [{ type: 'setVar', var: 'missing_var', value: 'x' }, { type: 'grantVisa', statusId: 'missing_visa' }, { type: 'event', event: 'legacy_event' }],
      onceOnly: true,
    },
  ],
};
const stats = {
  needs: [{ id: 'hunger', name: 'Hunger', color: '#e74c3c', default: 70, decayPerTick: 0.1, autonomy: true }],
  skills: [{ id: 'english', name: 'English', color: '#2980b9', default: 3, max: 10 }],
};
const assets = {
  categories: ['electronics'],
  assets: [{ id: 'tv', name: 'TV', category: 'electronics', mesh: 'models/tv.glb', buyPrice: 800, sellPrice: 600, environmentScore: 2, footprint: [2, 1], interactions: ['watch_tv'] }],
};
const visas = {
  visas: [
    { id: 'visitor', name: 'Visitor', durationDays: 15 },
    { id: 'citizen', name: 'Citizen', durationDays: null, obtainedVia: 'quest' },
  ],
};
const events = { events: [{ id: 'sink_leak', effects: [] }] };
const npcs = { npcs: [{ id: 'amara', name: 'Amara' }] };

const puts = {};
const fetchMock = async (url, opts = {}) => {
  const path = String(url).replace('/api/data/', '');
  if (opts.method === 'PUT') {
    puts[path] = JSON.parse(opts.body);
    return { ok: true, status: 200, json: async () => ({}) };
  }
  const body = { 'simstate.json': simstate, 'quests.json': quests, 'stats.json': stats, 'assets.json': assets, 'visas.json': visas, 'npcs.json': npcs, 'events.json': events }[path];
  return { ok: !!body, status: body ? 200 : 404, json: async () => structuredClone(body) };
};

const dom = new JSDOM(html, {
  url: 'http://localhost:5173/tools/quests.html',
  runScripts: 'dangerously',
  beforeParse(window) {
    window.fetch = fetchMock;
    window.confirm = () => true;
    window.prompt = () => '';
    window.alert = () => {};
    window.eval(condBuilderSrc); // define window.ConditionBuilder before the inline script runs
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
function fire(el, type) { el.dispatchEvent(new window.Event(type, { bubbles: true })); }

// ==================================================================== render
assert(doc.querySelectorAll('.var-row').length === 3, 'variables section renders 3 rows');
assert(doc.querySelectorAll('.quest-item').length === 3, 'quest sidebar renders 3 quests');
assert(doc.querySelector('input[data-path="id"]').value === 'first_words', 'first quest selected by default');
assert(doc.querySelector('input[data-path="id"]').readOnly, 'quest id field is readonly');
assert(doc.querySelector('[data-quest-id="explore_condo"] .badge')?.textContent === 'repeatable', 'onceOnly:false quest shows repeatable badge');
assert(doc.querySelector('[data-quest-id="first_words"] .badge') === null, 'onceOnly:true quest has no badge');

// ==================================================================== validation (initial, incl. broken_quest)
let validationText = () => [...doc.querySelectorAll('#validationList li')].map((li) => li.textContent).join('\n');
assert(validationText().includes('unknown need id "needs.nonexistent_need"'), 'validation flags unknown need id');
assert(validationText().includes('no operator'), 'validation flags leaf with no operator');
assert(validationText().includes('unknown variable "missing_var"'), 'validation flags unknown variable in condition');
assert(validationText().includes('setVar references unknown variable "missing_var"'), 'validation flags unknown variable in setVar reward');
assert(validationText().includes('grantVisa references unknown visa "missing_visa"'), 'validation flags unknown visa in grantVisa reward');

// ==================================================================== variables: edit type + default incl. null
const jobRow = doc.querySelector('.var-row[data-var-id="job"]');
const jobNullCb = jobRow.querySelector('input[data-path="var.job.defaultIsNull"]');
assert(jobNullCb.checked, 'job variable starts with null default (checkbox checked)');
assert(jobRow.querySelector('input[data-path="var.job.default"]').disabled, 'default value input disabled while null');

jobNullCb.checked = false;
fire(jobNullCb, 'change');
const jobRow2 = doc.querySelector('.var-row[data-var-id="job"]');
assert(jobRow2.querySelector('input[data-path="var.job.default"]').value === '', 'unchecking null gives job an empty-string default (string type)');
assert(!jobRow2.querySelector('input[data-path="var.job.default"]').disabled, 'default value input re-enabled');

const jobTypeSel = doc.querySelector('select[data-path="var.job.type"]');
jobTypeSel.value = 'number';
fire(jobTypeSel, 'change');
const jobRow3 = doc.querySelector('.var-row[data-var-id="job"]');
assert(jobRow3.querySelector('input[data-path="var.job.default"]').value === '0', 'switching type to number coerces default to 0');
assert(jobRow3.querySelector('input[data-path="var.job.default"]').type === 'number', 'default input becomes a number input for number type');

// ==================================================================== variables: add with slugify+uniquify
window.prompt = () => 'Language';
doc.getElementById('addVariable').click();
assert(doc.querySelectorAll('.var-row').length === 4, 'new variable appears');
assert(doc.querySelector('.var-row[data-var-id="language"]') !== null, 'new variable id slugified from name');

window.prompt = () => 'Language'; // duplicate name -> uniquified id
doc.getElementById('addVariable').click();
assert(doc.querySelector('.var-row[data-var-id="language_2"]') !== null, 'duplicate variable name gets uniquified id');

window.prompt = () => ''; // cancelled prompt adds nothing
const varCountBefore = doc.querySelectorAll('.var-row').length;
doc.getElementById('addVariable').click();
assert(doc.querySelectorAll('.var-row').length === varCountBefore, 'blank prompt adds no variable');

// ==================================================================== variables: delete unreferenced (plain confirm)
let confirmMsg = '';
window.confirm = (msg) => { confirmMsg = msg; return true; };
doc.querySelector('[data-action="delete-variable"][data-var-id="unused_var"]').click();
assert(confirmMsg.includes('No quests reference it'), 'unreferenced variable gets a plain delete message');
assert(doc.querySelector('.var-row[data-var-id="unused_var"]') === null, 'unused_var removed');

// ==================================================================== variables: delete referenced (strip + both files dirty)
window.confirm = (msg) => { confirmMsg = msg; return true; };
doc.querySelector('[data-action="delete-variable"][data-var-id="visaStatus"]').click();
assert(confirmMsg.includes('First Words') && confirmMsg.includes('Explore The Condo'), 'referenced-variable delete lists both referencing quests');
assert(doc.querySelector('.var-row[data-var-id="visaStatus"]') === null, 'visaStatus variable removed');

// save now to capture the exact stripped payload for this step
doc.getElementById('save').click();
await new Promise((r) => setTimeout(r, 50));
let savedSim = puts['simstate.json'];
let savedQuests = puts['quests.json'];
assert(savedSim && !savedSim.variables.some((v) => v.id === 'visaStatus'), 'PUT simstate.json no longer has visaStatus');
let savedFirstWords = savedQuests.quests.find((q) => q.id === 'first_words');
assert(!savedFirstWords.rewards.some((r) => r.type === 'setVar' && r.var === 'visaStatus'), 'PUT quests.json stripped the setVar visaStatus reward from First Words');
assert(savedFirstWords.rewards.some((r) => r.type === 'funds'), 'PUT quests.json kept the unrelated funds reward on First Words');
let savedExplore = savedQuests.quests.find((q) => q.id === 'explore_condo');
assert(Array.isArray(savedExplore.completion.any) && savedExplore.completion.any.length === 0, 'PUT quests.json stripped the vars.visaStatus leaf from Explore The Condo completion (emptied "any")');
assert(doc.getElementById('save').disabled, 'save disabled after saving');

// validation should now flag the emptied "any" as always-false
assert(validationText().includes('always FALSE'), 'validation flags the emptied any-group as always FALSE');

// ==================================================================== quests: add + uniquify + cancel
window.prompt = () => 'New Quest';
doc.getElementById('newQuest').click();
assert(doc.querySelectorAll('.quest-item').length === 4, 'new quest appears in sidebar');
assert(doc.querySelector('input[data-path="id"]').value === 'new_quest', 'new quest id slugified from name');
assert(doc.querySelector('input[data-path="name"]').value === 'New Quest', 'new quest name set from prompt');
assert(doc.querySelector('input[data-path="onceOnly"]').checked, 'new quest defaults onceOnly true');
assert(doc.querySelector('.hint-line').textContent.includes('repeatable'), 'onceOnly hint explains repeatable semantics');

window.prompt = () => 'New Quest';
doc.getElementById('newQuest').click();
assert(doc.querySelector('input[data-path="id"]').value === 'new_quest_2', 'duplicate quest name gets uniquified id (new_quest_2)');

window.prompt = () => '';
const questCountBefore = doc.querySelectorAll('.quest-item').length;
doc.getElementById('newQuest').click();
assert(doc.querySelectorAll('.quest-item').length === questCountBefore, 'blank prompt adds no quest');

// new_quest starts with empty trigger/completion -> validation warns vacuously TRUE (x2)
const vacuousCount = [...doc.querySelectorAll('#validationList li')].filter((li) => li.textContent.includes('vacuously TRUE')).length;
assert(vacuousCount >= 2, `empty trigger+completion on new quests flagged vacuously TRUE (found ${vacuousCount})`);

// ==================================================================== condition builder: build a nested tree on new_quest
doc.querySelector('[data-quest-id="new_quest"]').click();

// trigger: add a leaf (defaults to needs.hunger gte 0), then change its var -> funds, op -> eq, value -> 500
doc.querySelector('[data-action="add-leaf"][data-cond-path="trigger"]').click();
let varSel = doc.querySelector('[data-role="var"][data-cond-path="trigger.0"]');
assert(varSel.value === 'needs.hunger', 'new leaf defaults to the first need');
varSel.value = 'funds';
fire(varSel, 'change');
let opSel = doc.querySelector('[data-role="op"][data-cond-path="trigger.0"]');
assert(opSel.value === 'gte', 'operator preserved (gte) after var change');
opSel.value = 'eq';
fire(opSel, 'change');
let valInput = doc.querySelector('[data-role="value"][data-cond-path="trigger.0"]');
assert(valInput.tagName === 'INPUT' && valInput.type === 'number', 'funds is a numeric namespace -> number value input');
valInput.value = '500';
fire(valInput, 'input');

// trigger: add a nested group, add a leaf inside it, flip its combinator to ANY
doc.querySelector('[data-action="add-group"][data-cond-path="trigger"]').click();
doc.querySelector('[data-action="add-leaf"][data-cond-path="trigger.1"]').click();
varSel = doc.querySelector('[data-role="var"][data-cond-path="trigger.1.0"]');
varSel.value = 'skills.english';
fire(varSel, 'change');
valInput = doc.querySelector('[data-role="value"][data-cond-path="trigger.1.0"]');
valInput.value = '5';
fire(valInput, 'input');
const nestedCombinator = doc.querySelector('[data-role="combinator"][data-cond-path="trigger.1"]');
nestedCombinator.value = 'any';
fire(nestedCombinator, 'change');

// completion: add two leaves, then remove the first
doc.querySelector('[data-action="add-leaf"][data-cond-path="completion"]').click();
doc.querySelector('[data-action="add-leaf"][data-cond-path="completion"]').click();
let compVar1 = doc.querySelector('[data-role="var"][data-cond-path="completion.1"]');
compVar1.value = 'time.day';
fire(compVar1, 'change');
doc.querySelector('[data-action="remove-cond"][data-cond-path="completion.0"]').click();
let compVar0 = doc.querySelector('[data-role="var"][data-cond-path="completion.0"]');
assert(compVar0.value === 'time.day', 'removing the first leaf leaves the second in its place');

// ==================================================================== rewards on new_quest
doc.getElementById('addReward').click();
let amtInput = doc.querySelector('input[data-role="reward-amount"][data-reward-index="0"]');
assert(amtInput.value === '0', 'new reward defaults to funds/amount 0');
amtInput.value = '150';
fire(amtInput, 'input');

doc.getElementById('addReward').click();
let typeSel1 = doc.querySelector('select[data-role="reward-type"][data-reward-index="1"]');
typeSel1.value = 'setVar';
fire(typeSel1, 'change');
let rewardVarSel = doc.querySelector('select[data-role="reward-var"][data-reward-index="1"]');
rewardVarSel.value = 'job';
fire(rewardVarSel, 'change');
let rewardValInput = doc.querySelector('[data-role="reward-value"][data-reward-index="1"]');
rewardValInput.value = '42';
fire(rewardValInput, 'input');

doc.getElementById('addReward').click();
let typeSel2 = doc.querySelector('select[data-role="reward-type"][data-reward-index="2"]');
typeSel2.value = 'unlockAsset';
fire(typeSel2, 'change');
let rewardAssetSel = doc.querySelector('select[data-role="reward-asset"][data-reward-index="2"]');
rewardAssetSel.value = 'tv';
fire(rewardAssetSel, 'change');

doc.getElementById('addReward').click();
let typeSel3 = doc.querySelector('select[data-role="reward-type"][data-reward-index="3"]');
typeSel3.value = 'grantVisa';
fire(typeSel3, 'change');
let rewardVisaSel = doc.querySelector('select[data-role="reward-visa"][data-reward-index="3"]');
assert(rewardVisaSel.value === 'visitor', 'grantVisa reward defaults to the first visas.json status');
rewardVisaSel.value = 'citizen';
fire(rewardVisaSel, 'change');

doc.getElementById('addReward').click();
let typeSelContact = doc.querySelector('select[data-role="reward-type"][data-reward-index="4"]');
typeSelContact.value = 'grantContact';
fire(typeSelContact, 'change');
let rewardContactSel = doc.querySelector('select[data-role="reward-contact"][data-reward-index="4"]');
assert(rewardContactSel?.value === 'amara', 'grantContact reward defaults to the first NPC');

doc.getElementById('addReward').click();
let typeSel4 = doc.querySelector('select[data-role="reward-type"][data-reward-index="5"]');
assert([...typeSel4.options].some((o) => o.value === 'event'), 'event reward type renders in the type dropdown');
typeSel4.value = 'event';
fire(typeSel4, 'change');
let rewardEventSel = doc.querySelector('select[data-role="reward-event"][data-reward-index="5"]');
assert(rewardEventSel && rewardEventSel.value === '', 'event reward renders one blank event-id dropdown');
rewardEventSel.value = 'sink_leak'; fire(rewardEventSel, 'change');
assert(rewardEventSel.value === 'sink_leak', 'selecting an event reward writes the event id');
rewardEventSel.value = ''; fire(rewardEventSel, 'change');
doc.getElementById('save').click();
await new Promise((r) => setTimeout(r, 50));
assert(!('event' in puts['quests.json'].quests.find((q) => q.id === 'new_quest').rewards[5]), 'blank event reward selection deletes the sparse event key');
rewardEventSel.value = 'sink_leak'; fire(rewardEventSel, 'change');

// remove the middle (setVar) reward
doc.querySelector('[data-action="remove-reward"][data-reward-index="1"]').click();

// ==================================================================== quest delete: referenced branch (first_words)
doc.querySelector('[data-quest-id="first_words"]').click();
assert(doc.getElementById('deleteQuest').textContent.includes('1 quest'), 'referenced quest delete label warns with usage count');
window.confirm = (msg) => { confirmMsg = msg; return true; };
doc.getElementById('deleteQuest').click();
assert(confirmMsg.includes('Explore The Condo'), 'referenced-quest delete lists the referencing quest by name');
assert(doc.querySelector('[data-quest-id="first_words"]') === null, 'first_words removed from sidebar');

// ==================================================================== quest delete: unreferenced branch (new_quest_2)
doc.querySelector('[data-quest-id="new_quest_2"]').click();
window.confirm = (msg) => { confirmMsg = msg; return true; };
doc.getElementById('deleteQuest').click();
assert(confirmMsg.includes('No other quests reference it'), 'unreferenced quest delete gets a plain message');
assert(doc.querySelector('[data-quest-id="new_quest_2"]') === null, 'new_quest_2 removed from sidebar');

// cancel path: confirm cancel leaves everything untouched
doc.querySelector('[data-quest-id="broken_quest"]').click();
const unknownEventSel = doc.querySelector('select[data-role="reward-event"][data-reward-index="2"]');
assert(unknownEventSel.value === 'legacy_event' && [...unknownEventSel.options].some((o) => o.value === 'legacy_event' && o.textContent === 'legacy_event (unknown)'), 'event reward preserves an authored unknown event id');
window.confirm = () => false;
doc.getElementById('deleteQuest').click();
assert(doc.querySelector('[data-quest-id="broken_quest"]') !== null, 'cancelled delete leaves the quest in place');

// ==================================================================== final save: exact PUT payloads
doc.getElementById('save').click();
await new Promise((r) => setTimeout(r, 50));
savedQuests = puts['quests.json'];
savedSim = puts['simstate.json'];

assert(!savedQuests.quests.some((q) => q.id === 'first_words' || q.id === 'new_quest_2'), 'PUT quests.json excludes deleted quests');
const savedExploreAfter = savedQuests.quests.find((q) => q.id === 'explore_condo');
assert(Array.isArray(savedExploreAfter.trigger.all) && savedExploreAfter.trigger.all.length === 0, 'PUT quests.json stripped the quests.first_words.state leaf from Explore The Condo trigger (emptied "all")');

const savedNewQuest = savedQuests.quests.find((q) => q.id === 'new_quest');
const expectedTrigger = { all: [{ var: 'funds', eq: 500 }, { any: [{ var: 'skills.english', gte: 5 }] }] };
assert(JSON.stringify(savedNewQuest.trigger) === JSON.stringify(expectedTrigger), `PUT quests.json new_quest trigger matches exact nested JSON (got ${JSON.stringify(savedNewQuest.trigger)})`);
const expectedCompletion = { all: [{ var: 'time.day', gte: 0 }] };
assert(JSON.stringify(savedNewQuest.completion) === JSON.stringify(expectedCompletion), `PUT quests.json new_quest completion matches exact JSON after leaf removal (got ${JSON.stringify(savedNewQuest.completion)})`);
assert(savedNewQuest.rewards.length === 5, 'PUT quests.json new_quest has 5 rewards after removing the middle one');
assert(savedNewQuest.rewards[0].type === 'funds' && savedNewQuest.rewards[0].amount === 150, 'PUT quests.json new_quest funds reward amount = 150');
assert(savedNewQuest.rewards[1].type === 'unlockAsset' && savedNewQuest.rewards[1].asset === 'tv', 'PUT quests.json new_quest unlockAsset reward = tv');
assert(savedNewQuest.rewards[2].type === 'grantVisa' && savedNewQuest.rewards[2].statusId === 'citizen', 'PUT quests.json new_quest grantVisa reward = citizen');
assert(savedNewQuest.rewards[3].type === 'grantContact' && savedNewQuest.rewards[3].npc === 'amara', 'exact PUT quests.json payload carries the contact reward');
assert(savedNewQuest.rewards[4].type === 'event' && savedNewQuest.rewards[4].event === 'sink_leak', 'exact PUT quests.json payload carries the event reward');
assert(!puts['events.json'], 'Quest Editor never PUTs read-only events.json');

assert(savedSim.variables.some((v) => v.id === 'job' && v.type === 'number' && v.default === 0), 'PUT simstate.json job variable reflects type/default edits');
assert(savedSim.variables.some((v) => v.id === 'language') && savedSim.variables.some((v) => v.id === 'language_2'), 'PUT simstate.json includes both added variables');
assert(doc.getElementById('save').disabled, 'save disabled again after saving');

// ==================================================================== search filters quest sidebar
const search = doc.getElementById('questSearch');
search.value = 'broken';
fire(search, 'input');
const visible = doc.querySelectorAll('.quest-item');
assert(visible.length === 1 && visible[0].dataset.questId === 'broken_quest', 'search narrows quest sidebar to broken_quest');

if (failures > 0) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
console.log('\nALL QUEST-EDITOR TESTS PASSED');
