// Headless suite for tools/system.html (jsdom): title.json / notifications.json / save.json
// editing — field round-trips, sparse pruning, path normalization, menu/option/event CRUD, and
// exact whole-file PUT bodies. Run: node test/system-editor.test.mjs
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '../tools/system.html'), 'utf8');

const title = {
  logoText: '', logoImage: null, background: 'textures/Title1.jpg', music: null, hideCard: true,
  menuLayout: { anchor: 'bc', offsetX: 0, offsetY: 48 },
  menu: [{ id: 'new', label: 'New Game' }, { id: 'load', label: 'Load Game' }, { id: 'options', label: 'Options' }],
  options: [{ id: 'masterVolume', type: 'slider', label: 'Master volume', min: 0, max: 1, step: 0.05, default: 1 }],
  credits: '',
};
const notifications = {
  tiers: { modal: { pausesGame: true, requiresOk: true }, card: { autoExpireSeconds: 20, sound: 'notification' }, passive: { autoExpireSeconds: 8 } },
  stackCap: 5,
  events: {
    questReceived: { tier: 'modal', icon: '/icons/beginquest.png', sound: 'questStarted' },
    visitorArrived: { tier: 'card', action: { type: 'phoneTab', tab: 'contacts', label: 'Contacts' } },
    workMissed: { tier: 'card' },
  },
};
const save = { slots: 3, autosaveSlotId: 'autosave', autosaveIntervalHours: 12, autosaveOnEvents: ['moveIn', 'dayRollover'], storageKeyPrefix: 'condo-life-save' };

const puts = {};
const fetchMock = async (url, opts = {}) => {
  const path = String(url).replace('/api/data/', '');
  if (opts.method === 'PUT') {
    puts[path] = JSON.parse(opts.body);
    return { ok: true, status: 200, json: async () => ({}) };
  }
  const body = { 'title.json': title, 'notifications.json': notifications, 'save.json': save }[path];
  return { ok: !!body, status: body ? 200 : 404, json: async () => structuredClone(body) };
};

const dom = new JSDOM(html, {
  url: 'http://localhost:5173/tools/system.html', runScripts: 'dangerously',
  beforeParse(window) { window.fetch = fetchMock; window.confirm = () => true; },
});
const { window } = dom;
const doc = window.document;
await new Promise((resolve) => setTimeout(resolve, 30)); // let load() settle

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name} ${detail}`); }
}
const input = (path) => doc.querySelector(`[data-path="${path}"]`);
const fire = (el, type = 'input') => el.dispatchEvent(new window.Event(type, { bubbles: true }));

const editor = window.SystemEditor;
check('editor exposed with loaded state', !!editor && !!editor.state.title && !!editor.state.notifications && !!editor.state.save);

// --- title: fields, normalization, menu/options CRUD
const bg = input('title.background');
check('background rendered', bg && bg.value === 'textures/Title1.jpg');
bg.value = 'C:\\proj\\public\\textures\\Title2.jpg'; fire(bg);
check('background normalizes a pasted Windows path', editor.state.title.background === 'textures/Title2.jpg');
const logoImage = input('title.logoImage');
logoImage.value = ''; fire(logoImage);
check('blank logo image stores null', editor.state.title.logoImage === null);
doc.getElementById('addMenuEntry').click();
check('menu entry added', editor.state.title.menu.length === 4);
const newMenuId = input('title.menu.3.id');
newMenuId.value = 'credits_roll'; fire(newMenuId);
editor.renderAll(); // the unknown-id warning is computed at render time
check('unknown menu id warns', [...doc.querySelectorAll('#titleBody .warn')].some((w) => w.textContent.includes('credits_roll')));
doc.querySelector('[data-menu-index="3"] [data-action="remove-menu"]').click();
check('menu entry removed', editor.state.title.menu.length === 3);
const menuEnabled = input('title.menu.1.enabled');
menuEnabled.checked = false; fire(menuEnabled, 'change');
check('disabling a menu entry writes sparse enabled:false', editor.state.title.menu[1].enabled === false);
doc.getElementById('addOptionEntry').click();
const optType = input('title.options.1.type');
optType.value = 'toggle'; fire(optType, 'change');
check('toggle option coerces its default to boolean', typeof editor.state.title.options[1].default === 'boolean');

// --- notifications: tier + event edits, action parsing, CRUD
const stackCap = input('notifications.stackCap');
stackCap.value = '7'; fire(stackCap);
check('stackCap edits', editor.state.notifications.stackCap === 7);
const cardExpire = input('notifications.tiers.card.autoExpireSeconds');
cardExpire.value = '12'; fire(cardExpire);
check('tier auto-expire edits', editor.state.notifications.tiers.card.autoExpireSeconds === 12);
const evTier = input('notifications.events.workMissed.tier');
evTier.value = 'passive'; fire(evTier, 'change');
check('event tier edits', editor.state.notifications.events.workMissed.tier === 'passive');
const evAction = input('notifications.events.workMissed.action');
evAction.value = 'phoneTab:bills:Bills'; fire(evAction);
check('action text parses to a sparse action object',
  JSON.stringify(editor.state.notifications.events.workMissed.action) === '{"type":"phoneTab","label":"Bills","tab":"bills"}');
evAction.value = ''; fire(evAction);
check('blank action clears the block', !('action' in editor.state.notifications.events.workMissed));
const visitorAction = input('notifications.events.visitorArrived.action');
check('existing action round-trips into the compact text form', visitorAction.value === 'phoneTab:contacts:Contacts');
doc.getElementById('newEventId').value = 'customThing';
doc.getElementById('addEvent').click();
check('new event created as card tier', editor.state.notifications.events.customThing?.tier === 'card');
doc.querySelector('[data-event-id="questReceived"] [data-action="remove-event"]').click();
check('event deleted', !('questReceived' in editor.state.notifications.events));

// --- save: fields + event checkboxes + prefix warning
const slots = input('save.slots');
slots.value = '5'; fire(slots);
check('slots edits (floored, min 1)', editor.state.save.slots === 5);
const moveIn = input('save.autosaveOnEvents.moveIn');
moveIn.checked = false; fire(moveIn, 'change');
check('unchecking an autosave event removes it', !editor.state.save.autosaveOnEvents.includes('moveIn')
  && editor.state.save.autosaveOnEvents.includes('dayRollover'));
check('storage-prefix orphan warning shown', [...doc.querySelectorAll('#saveBody .warn')].some((w) => w.textContent.includes('ORPHANS')));

// --- PUT bodies: whole files, all three dirty
await editor.saveAll();
check('title PUT carries edits', puts['title.json'].background === 'textures/Title2.jpg' && puts['title.json'].menu.length === 3);
check('notifications PUT carries edits', puts['notifications.json'].stackCap === 7
  && puts['notifications.json'].events.customThing.tier === 'card' && !('questReceived' in puts['notifications.json'].events));
check('save PUT carries edits', puts['save.json'].slots === 5 && puts['save.json'].autosaveOnEvents.join(',') === 'dayRollover');

if (failures > 0) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
console.log('\nALL SYSTEM-EDITOR TESTS PASSED');
