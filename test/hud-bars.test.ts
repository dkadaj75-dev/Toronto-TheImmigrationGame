// hud-bars.test.ts — ITEM 4 (2026-07-17) jsdom smoke for the numeric level shown INSIDE each HUD
// needs/skills bar (game/ui.ts Hud.rebuildBars/refresh). Runs under tsx (`npx tsx test/hud-bars.test.ts`)
// with a jsdom window so the real Hud builds its real DOM. Covers: a `.bar-value` element rides in
// every need + skill bar; needs read "value/100" (needs are a 0-100 scale, no per-need max); skills
// read "value/max" using each skill's real max from stats.json; and the text re-renders on refresh().

import { JSDOM } from 'jsdom';
import type { StatsData } from '../game/data';

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
  url: 'http://localhost:5173/',
  pretendToBeVisual: true,
});
const { window } = dom;
const g = globalThis as unknown as Record<string, unknown>;
g.window = window;
g.document = window.document;
g.HTMLElement = window.HTMLElement;
g.HTMLButtonElement = window.HTMLButtonElement;
g.Node = window.Node;
g.Event = window.Event;
g.location = window.location;

const { Hud, NEED_MAX } = await import('../game/ui');
const { SimStats } = await import('../game/stats');

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name} ${detail}`); }
}

const defs: StatsData = {
  needs: [
    { id: 'hunger', name: 'Hunger', color: '#e07a5f', default: 54, decayPerTick: 0, autonomy: true },
    { id: 'energy', name: 'Energy', color: '#5fa8e0', default: 80, decayPerTick: 0, autonomy: true },
  ],
  skills: [
    { id: 'charisma', name: 'Charisma', color: '#f4c542', default: 3, max: 10 },
    { id: 'cooking', name: 'Cooking', color: '#8ec07c', default: 54, max: 100 },
  ],
  personality: [],
};

const stats = new SimStats(defs);
const hud = new Hud(stats); // builds the HUD DOM + bars, then refresh() populates values
const doc = window.document;

const needBars = [...doc.querySelectorAll('#needs-panel .bars .bar-row')];
const skillBars = [...doc.querySelectorAll('#skills-panel .bars .bar-row')];
check('a bar row is built for every need', needBars.length === 2);
check('a bar row is built for every skill', skillBars.length === 2);

// Every bar carries a .bar-value element (the in-bar readout).
check('every need bar has a .bar-value element', needBars.every((r) => !!r.querySelector('.bar-value')));
check('every skill bar has a .bar-value element', skillBars.every((r) => !!r.querySelector('.bar-value')));

const needValue = (i: number) => needBars[i].querySelector('.bar-value')!.textContent;
const skillValue = (i: number) => skillBars[i].querySelector('.bar-value')!.textContent;

// Needs are a 0-100 scale → "value/100".
check('need value reads "54/100" (0-100 scale)', needValue(0) === `54/${NEED_MAX}`, needValue(0) ?? '');
check('second need reads "80/100"', needValue(1) === '80/100', needValue(1) ?? '');

// Skills read "value/max" using each skill's real max from stats.json.
check('skill value reads "3/10" (real max 10)', skillValue(0) === '3/10', skillValue(0) ?? '');
check('skill with max 100 reads "54/100"', skillValue(1) === '54/100', skillValue(1) ?? '');

// Values re-render through the existing refresh() path (fractional skill level is rounded).
stats.needs.set('hunger', 27);
stats.skills.set('charisma', 6.7);
hud.refresh();
check('need text updates after refresh() → "27/100"', needValue(0) === '27/100', needValue(0) ?? '');
check('skill text rounds + updates after refresh() → "7/10"', skillValue(0) === '7/10', skillValue(0) ?? '');

if (failures > 0) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
console.log('\nAll hud-bars.test checks passed.');
