// toolnav.test.mjs — tools/nav.js under jsdom (PROJECT_CONTEXT.md §7.4).
// Run: node test/toolnav.test.mjs
// nav.js is a plain classic script; we read its source and eval it directly
// against a synthetic page (rather than relying on jsdom to fetch an external
// <script src>, which it doesn't do by default without `resources: "usable"` —
// the same reason including it in every tool page is safe for the *other*
// jsdom suites: they never execute it at all).

import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const navSrc = readFileSync(join(here, '../tools/nav.js'), 'utf8');

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name} ${detail}`); }
}

function loadPage(url, bodyHtml) {
  const dom = new JSDOM(`<!doctype html><html><body>${bodyHtml}</body></html>`, {
    runScripts: 'dangerously',
    url,
  });
  const script = dom.window.document.createElement('script');
  script.textContent = navSrc;
  dom.window.document.body.appendChild(script);
  return dom;
}

// ------------------------------------------------------------------ tool page
{
  const dom = loadPage('http://localhost:5173/tools/assets.html', '<header>Asset Editor</header><div id="layout"></div>');
  const doc = dom.window.document;

  const strip = doc.getElementById('condo-toolnav');
  check('top strip injected on a tool page', !!strip);
  check('strip is the first body child (sits above the page header)', doc.body.firstElementChild === strip);
  check('no corner button on tool pages', doc.getElementById('condo-toolnav-corner') === null);

  const links = [...strip.querySelectorAll('a')];
  check('all 7 tools listed', links.length === 7, `got ${links.length}`);
  const active = strip.querySelector('a.ctn-active');
  check('Assets tab marked active', active && active.textContent === 'Assets', active && active.textContent);
  check('only one active tab', strip.querySelectorAll('a.ctn-active').length === 1);
}

// ------------------------------------------------------------------ another tool, different active tab
{
  const dom = loadPage('http://localhost:5173/tools/quests.html', '<header>Quests</header>');
  const doc = dom.window.document;
  const active = doc.querySelector('#condo-toolnav a.ctn-active');
  check('Quests tab marked active on quests.html', active && active.textContent === 'Quests', active && active.textContent);
}

// ------------------------------------------------------------------ game page
{
  const dom = loadPage('http://localhost:5173/index.html', '<div id="app"></div><div id="devbar"></div>');
  const doc = dom.window.document;

  check('no top strip on the game page', doc.getElementById('condo-toolnav') === null);
  const corner = doc.getElementById('condo-toolnav-corner');
  check('corner menu injected on the game page', !!corner);

  const active = corner && corner.querySelector('a.ctn-active');
  check('Game tab marked active in the corner menu', active && active.textContent === 'Game', active && active.textContent);

  const panel = doc.getElementById('condo-toolnav-panel');
  check('panel starts closed', panel && !panel.classList.contains('ctn-open'));
  doc.getElementById('condo-toolnav-toggle').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  check('panel opens on toggle click', panel.classList.contains('ctn-open'));
  doc.body.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  check('panel closes on outside click', !panel.classList.contains('ctn-open'));
}

// ------------------------------------------------------------------ idempotency (double-inject no-op)
{
  const dom = loadPage('http://localhost:5173/tools/map.html', '<header>Map</header>');
  const doc = dom.window.document;
  const script2 = doc.createElement('script');
  script2.textContent = navSrc;
  doc.body.appendChild(script2);
  check('re-running init does not double-inject', doc.querySelectorAll('#condo-toolnav').length === 1);
}

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall toolnav tests passed');
