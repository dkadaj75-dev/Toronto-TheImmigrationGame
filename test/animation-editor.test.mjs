// animation-editor.test.mjs — Animation Mapper editor logic under jsdom.
// Run: node test/animation-editor.test.mjs   (needs `npm i -D jsdom` once)
// The tool's plain inline script runs; the three.js module script is inert in jsdom.

import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '../tools/animations.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost:5173/tools/animations.html', pretendToBeVisual: true });
const { window } = dom;
const { document } = window;
await new Promise((r) => window.addEventListener('load', r));
const AnimTool = window.AnimTool;

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name} ${detail}`); }
}

// ------------------------------------------------------------------ fixtures
const tuning = {
  simulation: { needsDecayTickSeconds: 1, activityGainTickSeconds: 2 },
  autonomy: { seekBelowThreshold: 30, stopAtThreshold: 95, postPlayerCommandCooldownSeconds: 10 },
  time: { secondsPerGameDay: 60, nightStartHour: 22, nightEndHour: 6 },
  economy: { startingFunds: 20000, currencyName: '§' },
  movement: { walkSpeed: 2, arrivalRadius: 0.35 },
  camera: { minZoom: 4, maxZoom: 18, minPitchDeg: 30, maxPitchDeg: 70, panBoundsPadding: 2 },
  // no character block on purpose — the tool must create defaults
};
const interactions = {
  actions: [
    { id: 'watch_tv', name: 'Watch TV', animation: 'sit', needGains: {}, skillGains: {}, autonomyEligible: true, primaryNeed: 'fun' },
    { id: 'sleep', name: 'Sleep', animation: 'lie', needGains: {}, skillGains: {}, autonomyEligible: true, primaryNeed: 'energy' },
    { id: 'read_book', name: 'Read Book', animation: 'read', needGains: {}, skillGains: {}, autonomyEligible: false, primaryNeed: null },
    { id: 'cook_meal', name: 'Cook Meal', animation: 'cook', needGains: {}, skillGains: {}, autonomyEligible: true, primaryNeed: 'hunger' },
    { id: 'no_anim', name: 'No Anim Action', animation: '', needGains: {}, skillGains: {}, autonomyEligible: false, primaryNeed: null },
  ],
};

AnimTool.init({ tuning: JSON.parse(JSON.stringify(tuning)), interactions });

console.log('animation-editor.test — defaults & state list');
{
  const c = AnimTool.character();
  check('missing character block gets defaults', !!c && c.meshPath === '/models/character.glb' && Array.isArray(c.animationPaths));
  const ids = AnimTool.states().map((s) => s.id);
  check('core states first', ids.slice(0, 4).join(',') === 'idle,walk,sit,lie', ids.join(','));
  check('action animations appear (read, cook)', ids.includes('read') && ids.includes('cook'));
  check('empty animation fields ignored', !ids.includes(''));
  const read = AnimTool.states().find((s) => s.id === 'read');
  check('action origin badge with action name', read.origin === 'action' && read.detail.includes('Read Book'), read.detail);
  const rows = document.querySelectorAll('#states-body tr');
  check('one row per state', rows.length === ids.length, `${rows.length} vs ${ids.length}`);
  check('unmapped states flagged warn', document.querySelector('tr[data-state="read"]').classList.contains('warn'));
  check('starts clean', AnimTool.dirty === false);
}

console.log('animation-editor.test — clip assignment via the DOM');
{
  AnimTool.setClips(['Idle', 'Walking_A', 'Sit_Floor_Idle', 'Cooking', 'Reading']);
  const walkSel = document.querySelector('tr[data-state="walk"] select');
  check('dropdown lists all clips + none', walkSel.options.length === 6, `${walkSel.options.length}`);
  walkSel.value = 'Walking_A';
  walkSel.dispatchEvent(new window.Event('change', { bubbles: true }));
  check('assignment writes clipMap', AnimTool.character().clipMap.walk === 'Walking_A');
  check('assignment sets dirty', AnimTool.dirty === true);

  const readSel = document.querySelector('tr[data-state="read"] select');
  readSel.value = 'Reading';
  readSel.dispatchEvent(new window.Event('change', { bubbles: true }));
  check('warn cleared once mapped', !document.querySelector('tr[data-state="read"]').classList.contains('warn'));

  const readSel2 = document.querySelector('tr[data-state="read"] select');
  readSel2.value = '';
  readSel2.dispatchEvent(new window.Event('change', { bubbles: true }));
  check('blank removes the key (sparse)', !('read' in AnimTool.character().clipMap));
}

console.log('animation-editor.test — custom states');
{
  document.querySelector('#new-state').value = 'scream';
  document.querySelector('#add-state').click();
  check('custom state row appears', !!document.querySelector('tr[data-state="scream"]'));
  check('duplicate rejected', AnimTool.addState('walk') === false);
  check('blank rejected', AnimTool.addState('  ') === false);
  const sel = document.querySelector('tr[data-state="scream"] select');
  sel.value = 'Idle';
  sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  check('custom state mappable', AnimTool.character().clipMap.scream === 'Idle');
  document.querySelector('tr[data-state="scream"] button.danger').click();
  check('custom state removable (row + mapping)', !document.querySelector('tr[data-state="scream"]') && !('scream' in AnimTool.character().clipMap));
}

console.log('animation-editor.test — animation sources');
{
  document.querySelector('#new-source').value = 'models/anims/walk.glb';
  document.querySelector('#add-source').click();
  check('source added with leading slash normalized', AnimTool.character().animationPaths.includes('/models/anims/walk.glb'));
  check('duplicate source rejected', AnimTool.addSource('/models/anims/walk.glb') === false);
  document.querySelector('#sources-list button.danger').click();
  check('source removable', AnimTool.character().animationPaths.length === 0);
}

console.log('animation-editor.test — numeric settings');
{
  const input = document.querySelector('input[data-field="heightMeters"]');
  input.value = '1.7';
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
  check('numeric field writes tuning', AnimTool.character().heightMeters === 1.7);
}

console.log('animation-editor.test — save PUTs the whole tuning file');
{
  let captured = null;
  window.fetch = (url, opts) => {
    captured = { url, ...opts };
    return Promise.resolve({ ok: true, status: 200 });
  };
  document.querySelector('#save').click();
  await new Promise((r) => setTimeout(r, 0));
  check('PUT to /api/data/tuning.json', captured?.url === '/api/data/tuning.json' && captured?.method === 'PUT', captured?.url);
  const body = JSON.parse(captured.body);
  check('payload preserves untouched groups', body.autonomy.stopAtThreshold === 95 && body.economy.startingFunds === 20000);
  check('payload carries the edits', body.character.clipMap.walk === 'Walking_A' && body.character.heightMeters === 1.7);
  check('dirty cleared after save', AnimTool.dirty === false);
  check('status reads saved', document.querySelector('#status').textContent === 'saved');
}

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall animation-editor tests passed');
