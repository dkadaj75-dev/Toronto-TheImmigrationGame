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
  if (u === '/api/textures') return { ok: true, status: 200, json: async () => ['textures/oak.jpg', 'textures/tile.png'] };
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
  // Derive expected footprints from whatever the designer currently has placed,
  // instead of hardcoding coordinates — condo.json's object positions/rotations
  // have drifted under the test more than once (fixture drift).
  const footprintOf = (assetId) => assets.assets.find((a) => a.id === assetId).footprint;
  const spanOf = (p) => {
    const rot = ((p.rotDeg % 360) + 360) % 360;
    let [w, d] = footprintOf(p.asset);
    if (rot === 90 || rot === 270) [w, d] = [d, w];
    return { xmin: p.pos[0] - w / 2, xmax: p.pos[0] + w / 2, zmin: p.pos[1] - d / 2, zmax: p.pos[1] + d / 2 };
  };
  const sofaObj = st.doc.placedObjects.find((p) => p.asset === 'sofa');
  const sofaSpan = spanOf(sofaObj);
  const insideSofa = [(sofaSpan.xmin + sofaSpan.xmax) / 2, (sofaSpan.zmin + sofaSpan.zmax) / 2];
  check('hit inside footprint', ME.hitTest(...insideSofa)?.kind === 'object' && st.doc.placedObjects[ME.hitTest(...insideSofa).index].asset === 'sofa');
  // a point well outside every placed object's footprint (bounds start at 0,0; go negative)
  check('miss outside footprint', ME.hitTest(-5, -5) === null);
  // rotation-aware: bed's footprint swaps axes when rotDeg is 90/270
  const bedObj = st.doc.placedObjects.find((p) => p.asset === 'bed');
  const bedSpan = spanOf(bedObj);
  const insideBed = [(bedSpan.xmin + bedSpan.xmax) / 2, (bedSpan.zmin + bedSpan.zmax) / 2];
  const bedHit = ME.hitTest(...insideBed);
  check('rotation-aware hit (bed rot 90 swaps axes)', bedHit && st.doc.placedObjects[bedHit.index].asset === 'bed');
  check('placement snap is explicit 0.25m, independent of gridSize', ME.snapPoint(1.13, 3.87).join(',') === '1.25,3.75');
  check('rot normalization 450→90', ME.normRot(450) === 90);
  check('rot normalization -90→270', ME.normRot(-90) === 270);

  // drag the sofa (pointerdown exactly on its actual pos so the drag anchor offset is 0)
  pointer('pointerdown', sofaObj.pos[0], sofaObj.pos[1]);
  check('pointerdown selects', st.sel?.kind === 'object' && st.doc.placedObjects[st.sel.index].asset === 'sofa');
  const dragTarget = [sofaObj.pos[0] + 1.63, sofaObj.pos[1] + 2.36];
  pointer('pointermove', ...dragTarget);
  pointer('pointerup', ...dragTarget);
  const expectedSnap = ME.snapPoint(...dragTarget).join(',');
  const sofa = st.doc.placedObjects.find((p) => p.asset === 'sofa');
  check(`drag moves with snap ${expectedSnap}`, sofa.pos.join(',') === expectedSnap, sofa.pos.join(','));
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

// B6-13: jsdom cannot execute the module import, so inject the same bridge surface and verify the
// classic-script editor delegates add/drag/rotation instead of reimplementing wall math.
console.log('map-editor.test — wall-mounted objects use PlacementBridge');
{
  let calls = 0;
  window.PlacementBridge = {
    snapWallMounted(requested) { calls++; return { pos: [requested[0], 0.16], rotDeg: 0, wallIndex: 0 }; },
  };
  const before = st.doc.placedObjects.length;
  doc.querySelector('#palette .item[data-asset="wall_lamp"]').click();
  const mounted = st.doc.placedObjects.at(-1);
  check('palette wall asset delegates to bridge and is added', calls === 1 && mounted.asset === 'wall_lamp');
  check('bridge snap position/facing are applied', mounted.pos[1] === 0.16 && mounted.rotDeg === 0, JSON.stringify(mounted));
  ME.rotateSelected();
  check('manual rotate is blocked for wall-mounted asset', mounted.rotDeg === 0);
  ME.deleteSelected();
  check('wall-mounted test cleanup restores object count', st.doc.placedObjects.length === before);
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
  // ROADMAP_NEXT item 7 (audio): music playlist field, comma-separated round-trip, sparse when empty
  const musicField = doc.querySelector('input[data-field="map.music"]');
  check('music field rendered', !!musicField);
  check('music field reflects the fixture\'s current playlist', musicField.value === (st.doc.music ?? []).join(', '), musicField.value);
  musicField.value = 'sounds/a.wav, sounds/b.wav';
  musicField.dispatchEvent(new window.Event('change', { bubbles: true }));
  check('music comma-separated input parses to a trimmed array', JSON.stringify(st.doc.music) === JSON.stringify(['sounds/a.wav', 'sounds/b.wav']), JSON.stringify(st.doc.music));
  musicField.value = '';
  musicField.dispatchEvent(new window.Event('change', { bubbles: true }));
  check('clearing the music field prunes the key entirely (sparse)', !('music' in st.doc));
  const materialSel = doc.getElementById('floor-material');
  materialSel.value = 'tile';
  materialSel.dispatchEvent(new window.Event('change', { bubbles: true }));
  pointer('pointerdown', 0.2, 10.7);
  pointer('pointermove', 3.9, 12.6);
  pointer('pointerup', 3.9, 12.6);
  check('drag creates a rect floor', st.doc.floors.length === before + 1);
  const f = st.doc.floors.at(-1);
  const floorStart = ME.snapPoint(0.2, 10.7);
  const floorEnd = ME.snapPoint(3.9, 12.6);
  const expectedFloor = [[floorStart[0], floorStart[1]], [floorEnd[0], floorStart[1]], [floorEnd[0], floorEnd[1]], [floorStart[0], floorEnd[1]]];
  check('floor polygon uses the map placement snap', JSON.stringify(f.polygon) === JSON.stringify(expectedFloor), JSON.stringify(f.polygon));
  check('floor uses selected material', f.material === 'tile');
  check('unique floor id', st.doc.floors.filter((x) => x.id === f.id).length === 1);
  check('new floor selected', st.sel?.kind === 'floor');
  // edit via inspector
  const mat = doc.querySelector('select[data-field="floor.material"]');
  mat.value = 'carpet';
  mat.dispatchEvent(new window.Event('change', { bubbles: true }));
  check('material editable', st.doc.floors[st.sel.index].material === 'carpet');
  // click-select an existing floor — use the first original floor's own centroid
  // and its actual id, rather than a hardcoded point/id (floor ids/layout drift).
  const firstFloor = st.doc.floors[0];
  const cx = firstFloor.polygon.reduce((s, [x]) => s + x, 0) / firstFloor.polygon.length;
  const cz = firstFloor.polygon.reduce((s, [, z]) => s + z, 0) / firstFloor.polygon.length;
  pointer('pointerdown', cx, cz);
  check('click selects existing floor', st.sel?.kind === 'floor' && st.doc.floors[st.sel.index].id === firstFloor.id);
}

// ------------------------------------------------------------------ B9-1: floor texture picker
console.log('map-editor.test — floor texture dropdown (texture round-trip)');
{
  ME.setMode('floors');
  const f0 = st.doc.floors[0];
  delete f0.texture; delete f0.textureScale; // fixture may carry a live designer texture; test the picker's own default (in-memory only, never written back)
  const cx = f0.polygon.reduce((s, [x]) => s + x, 0) / f0.polygon.length;
  const cz = f0.polygon.reduce((s, [, z]) => s + z, 0) / f0.polygon.length;
  pointer('pointerdown', cx, cz);
  const sel = doc.querySelector('select[data-field="floor.texture"]');
  check('floor texture dropdown renders, defaulting to (none)', !!sel && sel.value === '');
  check('scale input hidden while no texture is selected', doc.querySelector('input[data-field="floor.textureScale"]')?.style.display === 'none');
  const offered = [...sel.options].slice(1).map((o) => o.value); // skip "(none)"
  check('dropdown offers the listed textures', offered.includes('textures/oak.jpg') && offered.includes('textures/tile.png'), offered.join(','));
  sel.value = 'textures/oak.jpg';
  sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  check('picking a texture sets floors[].texture', st.doc.floors[st.sel.index].texture === 'textures/oak.jpg');
  check('preview swatch reflects the selection', doc.querySelector('img[data-field="floor.texture.swatch"]')?.getAttribute('src') === '/textures/oak.jpg');
  // texture scale follow-up (PROJECT_CONTEXT §7.32): sparse — only written when != 1
  const scaleInput = doc.querySelector('input[data-field="floor.textureScale"]');
  check('scale input visible once a texture is selected', scaleInput?.style.display !== 'none');
  check('scale input renders next to a selected texture, defaulting to 1', !!scaleInput && scaleInput.value == 1);
  scaleInput.value = '2';
  scaleInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  check('setting scale to 2 writes floors[].textureScale', st.doc.floors[st.sel.index].textureScale === 2);
  scaleInput.value = '1';
  scaleInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  check('setting scale back to 1 deletes the key (sparse)', !('textureScale' in st.doc.floors[st.sel.index]));
  scaleInput.value = '3';
  scaleInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  scaleInput.value = '';
  scaleInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  check('clearing scale deletes the key (sparse)', !('textureScale' in st.doc.floors[st.sel.index]));
  sel.value = '';
  sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  check('picking (none) removes texture — back to color material', !('texture' in st.doc.floors[st.sel.index]));
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

// ------------------------------------------------------------------ B9-1: wall texture picker
console.log('map-editor.test — wall texture dropdown (texture round-trip)');
{
  ME.setMode('walls');
  const before = st.doc.walls.length;
  pointer('pointerdown', 1.2, 11.2); // draw a fresh wall in the empty new-floor zone (auto-selected)
  pointer('pointermove', 3.7, 11.5);
  pointer('pointerup', 3.7, 11.5);
  check('wall selected for texture edit', st.sel?.kind === 'wall' && st.doc.walls.length === before + 1);
  const sel = doc.querySelector('select[data-field="wall.texture"]');
  check('wall texture dropdown renders, defaulting to (none)', !!sel && sel.value === '');
  const offered = [...sel.options].slice(1).map((o) => o.value);
  check('dropdown offers the listed textures', offered.includes('textures/oak.jpg') && offered.includes('textures/tile.png'), offered.join(','));
  sel.value = 'textures/tile.png';
  sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  check('picking a texture sets walls[].texture', st.doc.walls[st.sel.index].texture === 'textures/tile.png');
  // texture scale follow-up (PROJECT_CONTEXT §7.32): sparse round-trip, mirrors the floor test
  const wallScaleInput = doc.querySelector('input[data-field="wall.textureScale"]');
  check('wall scale input visible once a texture is selected', wallScaleInput?.style.display !== 'none');
  wallScaleInput.value = '0.5';
  wallScaleInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  check('setting wall scale to 0.5 writes walls[].textureScale', st.doc.walls[st.sel.index].textureScale === 0.5);
  wallScaleInput.value = '1';
  wallScaleInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  check('setting wall scale back to 1 deletes the key (sparse)', !('textureScale' in st.doc.walls[st.sel.index]));
  sel.value = '';
  sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  check('picking (none) removes wall texture', !('texture' in st.doc.walls[st.sel.index]));
  // per-side follow-up (PROJECT_CONTEXT §7.32): side-B dropdown, sparse (absent = same as side A)
  const selB = doc.querySelector('select[data-field="wall.textureB"]');
  check('wall side-B dropdown renders, defaulting to (same as side A)', !!selB && selB.value === '');
  const offeredB = [...selB.options].slice(1).map((o) => o.value);
  check('side-B dropdown offers the listed textures', offeredB.includes('textures/oak.jpg') && offeredB.includes('textures/tile.png'), offeredB.join(','));
  selB.value = 'textures/oak.jpg';
  selB.dispatchEvent(new window.Event('change', { bubbles: true }));
  check('picking a side-B texture sets walls[].textureB', st.doc.walls[st.sel.index].textureB === 'textures/oak.jpg');
  check('side-B swatch reflects the selection', doc.querySelector('img[data-field="wall.textureB.swatch"]')?.getAttribute('src') === '/textures/oak.jpg');
  selB.value = '';
  selB.dispatchEvent(new window.Event('change', { bubbles: true }));
  check('picking (same as side A) removes walls[].textureB (sparse)', !('textureB' in st.doc.walls[st.sel.index]));
  ME.deleteSelected(); // clean up the test wall
  check('cleanup: wall count restored', st.doc.walls.length === before);
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
  const doorStart = ME.snapPoint(9, 1.32);
  check('door snapped onto the wall line', d.at[0] === 9 && d.at[1] === doorStart[1], d.at.join(','));
  check('orientation inferred from wall axis', d.orientation === 'vertical');
  // clicking far from any wall does nothing
  pointer('pointerdown', 2, 12);
  pointer('pointerup', 2, 12);
  check('no door in open space', st.doc.doors.length === before + 1);
  // move an existing door by drag
  ME.setMode('doors');
  pointer('pointerdown', ...d.at);
  pointer('pointermove', 9.03, 2.04);
  pointer('pointerup', 9.03, 2.04);
  check('door draggable with snap', st.doc.doors.at(-1).at[1] === ME.snapPoint(9, 2.04)[1], st.doc.doors.at(-1).at.join(','));
  st.sel = { kind: 'door', index: st.doc.doors.length - 1 };
  ME.rotateSelected();
  check('R toggles orientation', st.doc.doors.at(-1).orientation === 'horizontal');
  ME.deleteSelected();
  check('door deletable', st.doc.doors.length === before);
}

// ------------------------------------------------------------------ doors-as-assets (§7.1)
console.log('map-editor.test — door asset dropdown (assetId round-trip)');
{
  ME.setMode('doors');
  const before = st.doc.doors.length;
  pointer('pointerdown', 9.15, 1.32);
  pointer('pointerup', 9.15, 1.32);
  const sel = doc.querySelector('select[data-field="door.assetId"]');
  check('door asset dropdown renders, defaulting to (none)', !!sel && sel.value === '');
  const doorAssets = assets.assets.filter((a) => a.category === 'door').map((a) => a.id);
  const offered = [...sel.options].slice(1).map((o) => o.value); // skip the "(none)" option
  check('dropdown offers exactly the door-category assets', doorAssets.length > 0 && offered.length === doorAssets.length && doorAssets.every((id) => offered.includes(id)), offered.join(','));

  sel.value = 'door_basic';
  sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  check('picking an asset sets doors[].assetId', st.doc.doors.at(-1).assetId === 'door_basic');

  sel.value = '';
  sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  check('picking (none) removes assetId — back to a bare opening', !('assetId' in st.doc.doors.at(-1)));

  ME.deleteSelected(); // clean up the test door
  check('cleanup: door count restored', st.doc.doors.length === before);
}

// ------------------------------------------------------------------ windows (ROADMAP_NEXT item 9)
console.log('map-editor.test — windows: place on wall / inferred orientation / move / R flip / delete');
{
  check('windows array normalized on load', Array.isArray(st.doc.windows));
  ME.setMode('windows');
  const before = st.doc.windows.length;
  // click near the same vertical kitchen wall segment used by the doors test above
  pointer('pointerdown', 9.15, 1.32);
  pointer('pointerup', 9.15, 1.32);
  check('click near wall places a window', st.doc.windows.length === before + 1);
  const w = st.doc.windows.at(-1);
  const windowStart = ME.snapPoint(9, 1.32);
  check('window snapped onto the wall line', w.at[0] === 9 && w.at[1] === windowStart[1], w.at.join(','));
  check('orientation inferred from wall axis', w.orientation === 'vertical');
  // clicking far from any wall does nothing
  pointer('pointerdown', 2, 12);
  pointer('pointerup', 2, 12);
  check('no window in open space', st.doc.windows.length === before + 1);
  // move an existing window by drag
  ME.setMode('windows');
  pointer('pointerdown', ...w.at);
  pointer('pointermove', 9.03, 2.04);
  pointer('pointerup', 9.03, 2.04);
  check('window draggable with snap', st.doc.windows.at(-1).at[1] === ME.snapPoint(9, 2.04)[1], st.doc.windows.at(-1).at.join(','));
  st.sel = { kind: 'window', index: st.doc.windows.length - 1 };
  ME.rotateSelected();
  check('R flips orientation', st.doc.windows.at(-1).orientation === 'horizontal');
  ME.deleteSelected();
  check('window deletable', st.doc.windows.length === before);
}

console.log('map-editor.test — window inspector: x/z/orientation/width/assetId round-trip');
{
  ME.setMode('windows');
  const before = st.doc.windows.length;
  pointer('pointerdown', 9.15, 1.32);
  pointer('pointerup', 9.15, 1.32);

  const xInput = doc.querySelector('input[data-field="window.x"]');
  check('x field renders with the placed value', !!xInput && Number(xInput.value) === 9);
  xInput.value = '9.5';
  xInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  check('x editable', st.doc.windows.at(-1).at[0] === 9.5);

  const orientSel = doc.querySelector('select[data-field="window.orientation"]');
  check('orientation dropdown renders', !!orientSel && orientSel.value === 'vertical');
  orientSel.value = 'horizontal';
  orientSel.dispatchEvent(new window.Event('change', { bubbles: true }));
  check('orientation editable via dropdown', st.doc.windows.at(-1).orientation === 'horizontal');

  const widthInput = doc.querySelector('input[data-field="window.width"]');
  check('width blank by default (sparse — tuning fallback)', !!widthInput && widthInput.value === '');
  widthInput.value = '2';
  widthInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  check('width settable', st.doc.windows.at(-1).width === 2);
  widthInput.value = '';
  widthInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  check('blanking width removes it (sparse)', !('width' in st.doc.windows.at(-1)));

  const assetSel = doc.querySelector('select[data-field="window.assetId"]');
  check('window asset dropdown renders, defaulting to (none)', !!assetSel && assetSel.value === '');
  const windowAssets = assets.assets.filter((a) => a.category === 'window').map((a) => a.id);
  const offered = [...assetSel.options].slice(1).map((o) => o.value);
  check('dropdown offers exactly the window-category assets', windowAssets.length > 0 && offered.length === windowAssets.length && windowAssets.every((id) => offered.includes(id)), offered.join(','));
  assetSel.value = 'window_basic';
  assetSel.dispatchEvent(new window.Event('change', { bubbles: true }));
  check('picking an asset sets windows[].assetId', st.doc.windows.at(-1).assetId === 'window_basic');
  assetSel.value = '';
  assetSel.dispatchEvent(new window.Event('change', { bubbles: true }));
  check('picking (none) removes assetId', !('assetId' in st.doc.windows.at(-1)));

  ME.deleteSelected();
  check('cleanup: window count restored', st.doc.windows.length === before);
}

// ------------------------------------------------------------------ slice 2: spawn
console.log('map-editor.test — spawn');
{
  ME.setMode('spawn');
  pointer('pointerdown', 5.24, 4.76);
  pointer('pointerup', 5.24, 4.76);
  check('click places spawn (snapped)', st.doc.spawn.pos.join(',') === ME.snapPoint(5.24, 4.76).join(','), st.doc.spawn.pos.join(','));
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
