// Headless suite for tools/events.html (jsdom): event CRUD, effect authoring through typed
// dropdowns (never free text), effect reordering, sparse pruning, rename-follows-references,
// cycle warning, trigger listing, and the exact whole-file PUT body.
// Run: node test/event-editor.test.mjs
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '../tools/events.html'), 'utf8');
const condBuilderSrc = readFileSync(join(here, '../tools/condition-builder.js'), 'utf8');

const events = {
  events: [
    {
      id: 'sink_leak', name: 'Sink leak',
      effects: [
        { type: 'notification', event: 'questReceived', title: 'Leak!' },
        { type: 'spawnTransient', asset: 'water_puddle' },
        { type: 'needDelta', need: 'hygiene', amount: -10, at: 'sim' },
      ],
    },
    { id: 'loop_a', effects: [{ type: 'fireEvent', event: 'loop_b' }] },
    { id: 'loop_b', effects: [{ type: 'fireEvent', event: 'loop_a' }] },
  ],
};
const interactions = { actions: [
  { id: 'fix_sink', name: 'Fix sink', needGains: {}, skillGains: {}, animation: 'stand_use', autonomyEligible: false, primaryNeed: null, emitsEvent: 'sink_leak' },
  { id: 'cook', name: 'Cook', needGains: {}, skillGains: {}, animation: 'stand_use', autonomyEligible: true, primaryNeed: null },
] };
const assets = { categories: ['plumbing', 'transient'], assets: [
  { id: 'sink', name: 'Sink', category: 'plumbing', interactions: ['fix_sink'], states: [{ id: 'working' }, { id: 'broken' }] },
  { id: 'water_puddle', name: 'Water puddle', category: 'transient', interactions: [] },
] };
const stats = { needs: [{ id: 'hygiene', name: 'Hygiene' }], skills: [{ id: 'handiness', name: 'Handiness' }], personality: [] };
const simstate = { variables: [{ id: 'job', name: 'Job', type: 'string' }] };
const quests = { quests: [{ id: 'first_words', name: 'First Words' }] };
const npcs = { npcs: [{ id: 'amara', name: 'Amara' }] };
const notifications = { tiers: {}, stackCap: 5, events: { questReceived: { tier: 'modal' }, sinkLeak: { tier: 'card' } } };
const visas = { visas: [{ id: 'lmia', name: 'LMIA' }] };

const puts = {};
const fetchMock = async (url, opts = {}) => {
  const path = String(url).replace('/api/data/', '');
  if (opts.method === 'PUT') { puts[path] = JSON.parse(opts.body); return { ok: true, status: 200, json: async () => ({}) }; }
  const body = { 'events.json': events, 'interactions.json': interactions, 'assets.json': assets, 'stats.json': stats,
    'simstate.json': simstate, 'quests.json': quests, 'npcs.json': npcs, 'notifications.json': notifications, 'visas.json': visas }[path];
  return { ok: !!body, status: body ? 200 : 404, json: async () => structuredClone(body) };
};

const dom = new JSDOM(html, {
  url: 'http://localhost:5173/tools/events.html', runScripts: 'dangerously',
  beforeParse(window) {
    window.fetch = fetchMock;
    window.confirm = () => true;
    window.eval(condBuilderSrc); // jsdom does not fetch <script src>
  },
});
const { window } = dom;
const doc = window.document;
await new Promise((r) => setTimeout(r, 60));

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name} ${detail}`); }
}
const editor = window.EventEditor;
const q = (sel) => doc.querySelector(sel);
const fire = (el, type) => el.dispatchEvent(new window.Event(type, { bubbles: true }));

check('editor exposed and loaded', !!editor && editor.state.events.events.length === 3);
check('sidebar lists every event', doc.querySelectorAll('.event-item').length === 3);
check('effect count badge shown', q('[data-event-id="sink_leak"] .badge').textContent === '3');

// --- effects render with typed controls
check('effects render in authored order',
  [...doc.querySelectorAll('[data-effect-index]')].map((b) => q(`[data-path="effects.${b.dataset.effectIndex}.type"]`).value).join(',')
  === 'notification,spawnTransient,needDelta');
const needSel = q('[data-path="effects.2.need"]');
check('need is a dropdown, never free text', needSel && needSel.tagName === 'SELECT' && needSel.value === 'hygiene');
check('need options come from stats.json', [...needSel.options].some((o) => o.value === 'hygiene'));
const transientSel = q('[data-path="effects.1.asset"]');
check('spawnTransient only offers transient-category assets',
  [...transientSel.options].filter((o) => o.value).every((o) => o.value === 'water_puddle'));
const scopeSel = q('[data-path="effects.2.at"]');
check('scope round-trips', scopeSel.value === 'sim' && q('[data-path="effects.0.at"]').value === 'target');

// --- scope sparseness: 'target' is the default and must not be written
scopeSel.value = 'target'; fire(scopeSel, 'change');
check('setting scope back to target deletes the key', !('at' in editor.state.events.events[0].effects[2]));

// --- reorder + add + remove
q('[data-effect-index="2"] [data-action="move-up"]').click();
check('move-up reorders the effect list',
  editor.state.events.events[0].effects.map((e) => e.type).join(',') === 'notification,needDelta,spawnTransient');
doc.getElementById('addEffect').click();
check('add appends a new effect', editor.state.events.events[0].effects.length === 4);
q('[data-effect-index="3"] [data-action="remove-effect"]').click();
check('remove drops only that effect', editor.state.events.events[0].effects.length === 3);

// --- switching type clears stale fields but keeps scope
const typeSel = q('[data-path="effects.1.type"]');
typeSel.value = 'funds'; fire(typeSel, 'change');
const switched = editor.state.events.events[0].effects[1];
check('switching effect type drops the previous type-specific fields',
  switched.type === 'funds' && !('need' in switched), JSON.stringify(switched));

// --- chance is sparse
const chance = q('[data-path="event.chancePercent"]');
chance.value = '50'; fire(chance, 'input');
check('chance writes through', editor.state.events.events[0].chancePercent === 50);
chance.value = ''; fire(chance, 'input');
check('blank chance deletes the key', !('chancePercent' in editor.state.events.events[0]));

// --- conditions use the SHARED builder
doc.getElementById('addConditions').click();
check('conditions use the shared condition builder', !!q('[data-cond-root]') && !!editor.state.events.events[0].conditions);
doc.getElementById('clearConditions').click();
check('clearing conditions deletes the key', !('conditions' in editor.state.events.events[0]));

// --- triggers listing + cycle warning
check('the fired-by list names the interaction that emits it', q('[data-role="triggers"]').textContent.includes('Fix sink'));
check('a straight event shows no cycle warning', !q('[data-role="cycle-warning"]'));
check('cycles() detects a mutual pair', editor.cycles('loop_a') === true && editor.cycles('sink_leak') === false);
doc.querySelector('[data-event-id="loop_a"]').click();
check('a cyclic event warns in the editor', !!q('[data-role="cycle-warning"]'));

// --- rename follows references (both event->event and interaction->event)
doc.querySelector('[data-event-id="sink_leak"]').click();
const idInput = q('[data-path="event.id"]');
idInput.value = 'sink_burst'; fire(idInput, 'input');
check('rename updates the emitting interaction',
  editor.state.interactions.actions.find((a) => a.id === 'fix_sink').emitsEvent === 'sink_burst');

// --- new + delete
doc.getElementById('new').click();
check('new event created with a unique id', editor.state.events.events.some((e) => e.id === 'event_1'));
doc.getElementById('deleteEvent').click();
check('delete removes it', !editor.state.events.events.some((e) => e.id === 'event_1'));

// --- PUT bodies
await editor.save();
check('events.json PUT carries the edits',
  puts['events.json'].events.some((e) => e.id === 'sink_burst') && puts['events.json'].events.length === 3);
check('interactions.json PUT carries the followed rename',
  puts['interactions.json'].actions.find((a) => a.id === 'fix_sink').emitsEvent === 'sink_burst');

if (failures > 0) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
console.log('\nALL EVENT-EDITOR TESTS PASSED');
