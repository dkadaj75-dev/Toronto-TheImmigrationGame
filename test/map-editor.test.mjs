// map-editor.test.mjs — Map Editor (slices 1+2) under jsdom.
// Run: node test/map-editor.test.mjs
// Canvas drawing and the nav bake are skipped headlessly (no 2d context / NavBridge);
// all state logic, hit-testing, drawing gestures, maps CRUD and PUT payloads are exercised.

import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../tools/map.html', import.meta.url), 'utf8');

// ------------------------------------------------------------------ fixtures
const condo = JSON.parse(readFileSync(new URL('../data/maps/condo.json', import.meta.url), 'utf8'));
const assets = JSON.parse(readFileSync(new URL('../data/assets.json', import.meta.url), 'utf8'));
const tuning = { time: { secondsPerGameDay: 60 }, map: { active: 'condo' }, movement: { walkSpeed: 2 } };

const puts = {};
const deletes = [];
const fetchMock = async (url, opts = {}) => {
  const u = String(url);
  if (opts.method === 'PUT') { puts[u] = JSON.parse(opts.body); return { ok: true, status: 200, json: async () => ({}) }; }
  if (opts.method === 'DELETE') { deletes.push(u); return { ok: true, status: 200, json: async () => ({}) }; }
  if (u === '/api/maps') return { ok: true, status: 200, json: async () => ({ maps: ['condo'] }) };
  const body = {
    '/api/data/maps/condo.json': condo,
    '/api/data/assets.json': assets,
    '/api/data/tuning.json': tuning,
  }[u] ?? (u.startsWith('/api/data/maps/') && puts[u] ? puts[u] : null);
  return { ok: !!body, status: body ? 200 : 404, json: async () => structuredClone(body) };
};

const dom = new JSDOM(html, {
  url: 'http://localhost:5173/tools/map.html',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  beforeParse(window) {
    window.fetch = fetchMock;
    window.confirm = () => true;
  },
});
const { window } = dom;
const doc = window.document;
await new Promise((r) => setTimeout(r, 50)); // let boot() finish
const ME = window.MapEditor;
const st = ME.state;

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name} ${detail}`); }
}
const pointer = (type, worldX, worldZ) => {
  // jsdom canvas rect is 0×0 at (0,0) → clientX/Y are canvas CSS px directly
  const [px, py] = ME.worldToPx(worldX, worldZ);
  doc.getElementById('canvas').dispatchEvent(new window.MouseEvent(type, { clientX: px, clientY: py, bubbles: true }));
};

// ------------------------------------------------------------------ boot & palette
console.log('map-editor.test — boot');
check('map loaded', st.doc?.id === 'condo' && st.mapId === 'condo');
check('map select rendered with active tag', doc.getElementById('map-select').options[0].textContent.includes('(active)'));
check('palette renders all assets', doc.querySelectorAll('#palette .item').length === assets.assets.length);
check('save disabled while clean', doc.getElementById('save').disabled);

// ------------------------------------------------------------------ slice 1: objects
console.log('map-editor.test — objects: hit test / snap / drag / rotate / delete');
{
  // sofa at [1.5,0.5] (condo.json), footprint 3×1, rot 0 → hit at x∈[0,3], z∈[0,1]
  check('hit inside footprint', ME.hitTest(2.7, 0.7)?.kind === 'object' && st.doc.placedObjects[ME.hitTest(2.7, 0.7).index].asset === 'sofa');
  check('miss outside footprint', ME.hitTest(3, 2.2) === null || st.doc.placedObjects[ME.hitTest(3, 2.2).index].asset !== 'sofa');
  // rotation-aware: bed at [1.5,8] footprint [2,3] rot 90 → spans x∈[0,3], z∈[7,9]
  const bedHit = ME.hitTest(2.3, 7.2);
  check('rotation-aware hit (bed rot 90 swaps axes)', bedHit && st.doc.placedObjects[bedHit.index].asset === 'bed');
  check('snap math (half cell)', ME.snapPoint(1.26, 3.74).join(',') === '1.5,3.5');
  check('rot normalization 450→90', ME.normRot(450) === 90);
  check('rot normalization -90→270', ME.normRot(-90) === 270);

  // drag the sofa (pointerdown exactly on its actual pos so the drag anchor offset is 0)
  pointer('pointerdown', 1.5, 0.5);
  check('pointerdown selects', st.sel?.kind === 'object' && st.doc.placedObjects[st.sel.index].asset === 'sofa');
  pointer('pointermove', 4.13, 2.86);
  pointer('pointerup', 4.13, 2.86);
  const sofa = st.doc.placedObjects.find((p) => p.asset === 'sofa');
  check('drag moves with snap', sofa.pos.join(',') === '4,3', sofa.pos.join(','));
  check('drag marks dirty', st.dirty === true);

  // inspector round-trip incl. rot normalization
  const rotInput = doc.querySelector('input[data-field="obj.rot"]');
  rotInput.value = '450';
  rotInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  check('inspector rot round-trip 450→90', sofa.rotDeg === 90);

  ME.rotateSelected();
  check('R rotates +90', sofa.rotDeg === 180);

  const before = st.doc.placedObjects.length;
  ME.deleteSelected();
  check('delete removes object', st.doc.placedObjects.length === before - 1 && st.sel === null);

  // palette add
  doc.querySelector('#palette .item[data-asset="armchair"]').click();
  check('palette adds at snapped center + selects', st.doc.placedObjects.at(-1).asset === 'armchair' && st.sel?.kind === 'object');
}

// ------------------------------------------------------------------ slice 2: floors
console.log('map-editor.test — floors: draw rect / material / edit / delete');
{
  ME.setMode('floors');
  check('mode help updates', doc.getElementById('mode-help').textContent.includes('floor'));
  check('new-floor material select in inspector', !!doc.getElementById('floor-material'));
  const before = st.doc.floors.length;
  // draw a rect outside existing floors: from (0.2, 10.9)→(3.8, 12.6)... outside bounds h=10; draw inside empty? whole map is floored.
  // The map is fully floored, so a fresh rect must start on empty canvas space — extend bounds first via inspector.
  st.sel = null; ME.setMode('floors');
  const bh = doc.querySelector('input[data-field="map.bounds.h"]');
  bh.value = '14';
  bh.dispatchEvent(new window.Event('change', { bubbles: true }));
  check('bounds editable from map properties', st.doc.bounds.h === 14);
  const materialSel = doc.getElementById('floor-material');
  materialSel.value = 'tile';
  materialSel.dispatchEvent(new window.Event('change', { bubbles: true }));
  pointer('pointerdown', 0.2, 10.7);
  pointer('pointermove', 3.9, 12.6);
  pointer('pointerup', 3.9, 12.6);
  check('drag creates a rect floor', st.doc.floors.length === before + 1);
  const f = st.doc.floors.at(-1);
  check('floor polygon snapped rect', JSON.stringify(f.polygon) === JSON.stringify([[0, 10.5], [4, 10.5], [4, 12.5], [0, 12.5]]), JSON.stringify(f.polygon));
  check('floor uses selected material', f.material === 'tile');
  check('unique floor id', st.doc.floors.filter((x) => x.id === f.id).length === 1);
  check('new floor selected', st.sel?.kind === 'floor');
  // edit via inspector
  const mat = doc.querySelector('select[data-field="floor.material"]');
  mat.value = 'carpet';
  mat.dispatchEvent(new window.Event('change', { bubbles: true }));
  check('material editable', st.doc.floors[st.sel.index].material === 'carpet');
  // click-select an existing floor
  pointer('pointerdown', 2, 2);
  check('click selects existing floor', st.sel?.kind === 'floor' && st.doc.floors[st.sel.index].id === 'living');
}

// ------------------------------------------------------------------ slice 2: walls
console.log('map-editor.test — walls: draw axis-locked / select / edit / delete');
{
  ME.setMode('walls');
  const before = st.doc.walls.length;
  pointer('pointerdown', 1.1, 11.1);   // empty area (new floor zone)
  pointer('pointermove', 3.6, 11.4);   // mostly horizontal → z locks to start
  pointer('pointerup', 3.6, 11.4);
  check('drag creates a wall', st.doc.walls.length === before + 1);
  const w = st.doc.walls.at(-1);
  check('wall axis-locked + snapped', w.from.join(',') === '1,11' && w.to.join(',') === '3.5,11', `${w.from} → ${w.to}`);
  // select an existing wall (top boundary y=0) and edit an endpoint
  pointer('pointerdown', 5, 0.05);
  check('click near wall selects it', st.sel?.kind === 'wall');
  const fx = doc.querySelector('input[data-field="wall.fx"]');
  fx.value = '0.5';
  fx.dispatchEvent(new window.Event('change', { bubbles: true }));
  check('endpoint editable', st.doc.walls[st.sel.index].from[0] === 0.5);
  st.doc.walls[st.sel.index].from[0] = 0; // restore for later door test
  const count = st.doc.walls.length;
  st.sel = { kind: 'wall', index: st.doc.walls.length - 1 };
  ME.deleteSelected();
  check('wall deletable', st.doc.walls.length === count - 1);
}

// ------------------------------------------------------------------ slice 2: doors
console.log('map-editor.test — doors: place on wall / inferred orientation / move / delete');
{
  ME.setMode('doors');
  const before = st.doc.doors.length;
  // click near the vertical kitchen wall segment (9, 0→2.5)
  pointer('pointerdown', 9.15, 1.32);
  pointer('pointerup', 9.15, 1.32);
  check('click near wall places a door', st.doc.doors.length === before + 1);
  const d = st.doc.doors.at(-1);
  check('door snapped onto the wall line', d.at[0] === 9 && d.at[1] === 1.5, d.at.join(','));
  check('orientation inferred from wall axis', d.orientation === 'vertical');
  // clicking far from any wall does nothing
  pointer('pointerdown', 2, 12);
  pointer('pointerup', 2, 12);
  check('no door in open space', st.doc.doors.length === before + 1);
  // move an existing door by drag
  ME.setMode('doors');
  pointer('pointerdown', 9, 1.5);
  pointer('pointermove', 9.03, 2.04);
  pointer('pointerup', 9.03, 2.04);
  check('door draggable with snap', st.doc.doors.at(-1).at[1] === 2, st.doc.doors.at(-1).at.join(','));
  st.sel = { kind: 'door', index: st.doc.doors.length - 1 };
  ME.rotateSelected();
  check('R toggles orientation', st.doc.doors.at(-1).orientation === 'horizontal');
  ME.deleteSelected();
  check('door deletable', st.doc.doors.length === before);
}

// ------------------------------------------------------------------ slice 2: spawn
console.log('map-editor.test — spawn');
{
  ME.setMode('spawn');
  pointer('pointerdown', 5.24, 4.76);
  pointer('pointerup', 5.24, 4.76);
  check('click places spawn (snapped)', st.doc.spawn.pos.join(',') === '5,5' || st.doc.spawn.pos.join(',') === '5.5,5', st.doc.spawn.pos.join(','));
  const facing = doc.querySelector('input[data-field="spawn.facing"]');
  facing.value = '270';
  facing.dispatchEvent(new window.Event('change', { bubbles: true }));
  check('facing editable', st.doc.spawn.facingDeg === 270);
}

// ------------------------------------------------------------------ undo
console.log('map-editor.test — undo');
{
  const objCount = st.doc.placedObjects.length;
  ME.setMode('objects');
  doc.querySelector('#palette .item[data-asset="tv"]').click();
  check('object added', st.doc.placedObjects.length === objCount + 1);
  ME.undo();
  check('Ctrl+Z restores previous doc', st.doc.placedObjects.length === objCount);
}

// ------------------------------------------------------------------ save payload
console.log('map-editor.test — save PUT payload');
{
  await ME.save();
  const put = puts['/api/data/maps/condo.json'];
  check('PUT to the current map file', !!put);
  check('payload is the edited doc', JSON.stringify(put) === JSON.stringify(st.doc));
  check('dirty cleared', st.dirty === false && doc.getElementById('save').disabled);
}

// ------------------------------------------------------------------ maps CRUD + active switch
console.log('map-editor.test — maps: new / duplicate / play / delete guards');
{
  const ok = await ME.newMap('basement');
  check('new map created + switched', ok === true && st.mapId === 'basement' && st.doc.placedObjects.length === 0);
  check('new map PUT immediately', !!puts['/api/data/maps/basement.json'] && puts['/api/data/maps/basement.json'].id === 'basement');
  check('map list grew', st.maps.includes('basement'));

  check('duplicate rejects existing id', (await ME.duplicateMap('condo')) === false);
  await ME.selectMap('condo'); // duplicate copies the CURRENT map — switch back first
  const ok2 = await ME.duplicateMap('condo_copy');
  check('duplicate creates a copy', ok2 === true && st.mapId === 'condo_copy' && puts['/api/data/maps/condo_copy.json'].walls.length > 0);

  await ME.playThisMap();
  check('play sets tuning.map.active', puts['/api/data/tuning.json']?.map?.active === 'condo_copy');
  check('play preserves other tuning groups', puts['/api/data/tuning.json']?.time?.secondsPerGameDay === 60);

  check('cannot delete the active map', (await ME.deleteMap()) === false);
  await ME.selectMap('basement');
  const del = await ME.deleteMap();
  check('delete removes non-active map', del === true && !st.maps.includes('basement') && deletes.includes('/api/data/maps/basement.json'));
}

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall map-editor tests passed');
