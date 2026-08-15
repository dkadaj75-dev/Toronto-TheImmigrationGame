// housing-ladder.test.ts — headless coverage for the AUTHORED rental ladder (the 10 Kijiji maps
// in data/maps/ plus the housing quest arc in data/quests.json). Run: npx tsx test/housing-ladder.test.ts
//
// Everything here runs against LIVE data through the shipped modules — never a re-implementation:
// game/nav.ts bakes the grids, game/bills.ts prices the rent, game/rental.ts builds the listings and
// game/quests.ts steps the quest state machine. The fixtures are self-deriving (AGENTS.md): the
// ladder order is read from the maps' own rent, and room/asset expectations come from the map files,
// so the designer can retune a layout, an ad or a condition in the tools without editing this file.
//
// What it guards:
//   1. every authored map is playable   — spawn walkable, nothing cut off, every object approachable
//   2. every authored map is coherent   — known asset ids, furniture inside floors and off the walls,
//                                         doors/windows sitting on a wall of their own axis
//   3. the Kijiji ladder is monotonic   — rent rises with the tier order the quests unlock
//   4. cross-file ids resolve           — rental/quest conditions and quest reward events all exist
//   5. the arc is completable           — a simulated playthrough unlocks each listing in turn and
//                                         finishes on "The Canadian dream"

import { readFileSync, readdirSync } from 'node:fs';
import { bakeNavGrid, isWalkable, worldToCell, type NavGrid } from '../game/nav';
import { computeFinancePreview } from '../game/bills';
import { listRentals } from '../game/rental';
import { QuestRunner, type EvalContext } from '../game/quests';
import { floorsAreaM2 } from '../game/textures';
import type { AssetsData, Condition, EventsData, FinanceData, MapData, QuestsData, SimStateData } from '../game/data';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name} ${detail}`); }
}

const read = <T>(rel: string): T => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8')) as T;
const assets = read<AssetsData>('../data/assets.json');
const finance = read<FinanceData>('../data/finance.json');
const questsData = read<QuestsData>('../data/quests.json');
const simstate = read<SimStateData>('../data/simstate.json');
const events = read<EventsData>('../data/events.json');
const assetById = new Map(assets.assets.map((a) => [a.id, a]));

const mapFiles = readdirSync(new URL('../data/maps/', import.meta.url))
  .filter((f) => f.endsWith('.json') && f !== 'index.json').sort();
const maps = mapFiles.map((f) => read<MapData>(`../data/maps/${f}`));
const mapById = new Map(maps.map((m) => [m.id, m]));

/** The authored ladder, cheapest rung first — the order the quest arc walks the player through.
 *  Kept as ids only; every number (rent, area, gating) is derived from the live files below. */
const LADDER: string[][] = [
  ['Apt1', 'parkdale_studio'],
  ['junction_1br'],
  ['east_york_2br'],
  ['liberty_village_condo'],
  ['distillery_loft'],
  ['leslieville_townhouse'],
  ['north_york_semi'],
  ['etobicoke_bungalow'],
  ['forest_hill_house', 'yorkville_penthouse'],
];
const LADDER_IDS = LADDER.flat();

// ============================================================ 1+2. every authored map is playable
function pointInPolygon(x: number, z: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Footprint in world space, honouring nav.ts's own 90° rotation rule. */
function footprintOf(placed: MapData['placedObjects'][number]): { x0: number; x1: number; z0: number; z1: number } | null {
  const def = assetById.get(placed.asset);
  if (!def) return null;
  let [w, d] = def.footprint;
  if ((((Math.round(placed.rotDeg) % 180) + 180) % 180) === 90) [w, d] = [d, w];
  return { x0: placed.pos[0] - w / 2, x1: placed.pos[0] + w / 2, z0: placed.pos[1] - d / 2, z1: placed.pos[1] + d / 2 };
}

/** Axis-aligned wall segment passing THROUGH a rectangle's interior (touching is fine — that is
 *  exactly how furniture is pushed against a wall). */
function wallCrossesRect(wall: MapData['walls'][number], r: { x0: number; x1: number; z0: number; z1: number }): boolean {
  const [ax, az] = wall.from, [bx, bz] = wall.to;
  const E = 1e-6;
  if (Math.abs(ax - bx) < E) {
    return ax > r.x0 + E && ax < r.x1 - E && Math.min(az, bz) < r.z1 - E && Math.max(az, bz) > r.z0 + E;
  }
  return az > r.z0 + E && az < r.z1 - E && Math.min(ax, bx) < r.x1 - E && Math.max(ax, bx) > r.x0 + E;
}

function floodFill(grid: NavGrid, from: { col: number; row: number }): Uint8Array {
  const seen = new Uint8Array(grid.cols * grid.rows);
  const stack = [from.row * grid.cols + from.col];
  seen[stack[0]] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const col = i % grid.cols, row = (i - col) / grid.cols;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const c = col + dc, r = row + dr;
      if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) continue;
      const j = r * grid.cols + c;
      if (seen[j] || !isWalkable(grid, { col: c, row: r })) continue;
      seen[j] = 1;
      stack.push(j);
    }
  }
  return seen;
}

console.log('housing-ladder.test — authored maps are playable');
for (const map of maps) {
  const label = map.id;

  const inBounds = [...map.floors.flatMap((f) => f.polygon), ...map.walls.flatMap((w) => [w.from, w.to])]
    .every(([x, z]) => x >= 0 && z >= 0 && x <= map.bounds.w && z <= map.bounds.h);
  check(`${label}: floors and walls stay inside the map bounds`, inBounds);

  // doors/windows are "a point on a wall" (ROADMAP_APT D1) — a stray one would render an aperture
  // in mid-air and, for a door, carve nav where no wall exists.
  const openings = [
    ...map.doors.map((d) => ({ ...d, kind: 'door' })),
    ...(map.windows ?? []).map((w) => ({ ...w, kind: 'window' })),
  ];
  const orphan = openings.find((o) => !map.walls.some((wall) => {
    const [ax, az] = wall.from, [bx, bz] = wall.to;
    const vertical = Math.abs(ax - bx) < 1e-6;
    if (vertical !== (o.orientation === 'vertical')) return false;
    const half = (o.width ?? 1.0) / 2;
    return vertical
      ? Math.abs(ax - o.at[0]) < 1e-6 && o.at[1] - half >= Math.min(az, bz) - 1e-6 && o.at[1] + half <= Math.max(az, bz) + 1e-6
      : Math.abs(az - o.at[1]) < 1e-6 && o.at[0] - half >= Math.min(ax, bx) - 1e-6 && o.at[0] + half <= Math.max(ax, bx) + 1e-6;
  }));
  check(`${label}: every door and window sits on a wall of its own axis`, !orphan,
    orphan ? `${orphan.kind} at ${orphan.at} (${orphan.orientation})` : '');

  const unknown = map.placedObjects.filter((p) => !assetById.has(p.asset)).map((p) => p.asset);
  check(`${label}: every placed object is a known asset`, unknown.length === 0, unknown.join(', '));

  const offFloor: string[] = [], throughWall: string[] = [];
  for (const placed of map.placedObjects) {
    const box = footprintOf(placed);
    if (!box) continue;
    const inset = 0.02;
    const corners: [number, number][] = [
      [box.x0 + inset, box.z0 + inset], [box.x1 - inset, box.z0 + inset],
      [box.x1 - inset, box.z1 - inset], [box.x0 + inset, box.z1 - inset],
    ];
    if (!corners.every(([x, z]) => map.floors.some((f) => pointInPolygon(x, z, f.polygon)))) offFloor.push(placed.asset);
    if (map.walls.some((w) => wallCrossesRect(w, box))) throughWall.push(placed.asset);
  }
  check(`${label}: no furniture hangs off the floor`, offFloor.length === 0, offFloor.join(', '));
  check(`${label}: no furniture is buried in a wall`, throughWall.length === 0, throughWall.join(', '));

  const grid = bakeNavGrid(map, assets);
  const spawnCell = worldToCell(grid, map.spawn.pos[0], map.spawn.pos[1]);
  check(`${label}: the sim spawns on a walkable cell`, isWalkable(grid, spawnCell));

  const seen = floodFill(grid, spawnCell);
  let walkable = 0, cutOff = 0;
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      if (!isWalkable(grid, { col: c, row: r })) continue;
      walkable++;
      if (!seen[r * grid.cols + c]) cutOff++;
    }
  }
  check(`${label}: every walkable cell is reachable from the spawn`, cutOff === 0, `${cutOff}/${walkable} cut off`);

  // a room whose only door is blocked, or a fridge parked behind a bed, is authored dead weight
  const roomless = map.floors.filter((f) => {
    const xs = f.polygon.map((p) => p[0]), zs = f.polygon.map((p) => p[1]);
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        const cx = (c + 0.5) * grid.cellSize, cz = (r + 0.5) * grid.cellSize;
        if (cx < Math.min(...xs) || cx > Math.max(...xs) || cz < Math.min(...zs) || cz > Math.max(...zs)) continue;
        if (seen[r * grid.cols + c]) return false;
      }
    }
    return true;
  }).map((f) => f.id);
  check(`${label}: every room can be reached`, roomless.length === 0, roomless.join(', '));

  const stranded = map.placedObjects.filter((placed) => {
    const box = footprintOf(placed);
    if (!box) return false;
    const pad = 0.55; // roughly one nav cell plus the sim's approach slack
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        if (!seen[r * grid.cols + c]) continue;
        const cx = (c + 0.5) * grid.cellSize, cz = (r + 0.5) * grid.cellSize;
        if (cx >= box.x0 - pad && cx <= box.x1 + pad && cz >= box.z0 - pad && cz <= box.z1 + pad) return false;
      }
    }
    return true;
  }).map((p) => `${p.asset}@${p.pos}`);
  check(`${label}: every object has a reachable cell beside it`, stranded.length === 0, stranded.join(', '));
}

// ============================================================ 3. the ladder itself
console.log('\nhousing-ladder.test — the Kijiji ladder');
{
  const missing = LADDER_IDS.filter((id) => !mapById.has(id));
  check('every ladder map exists on disk', missing.length === 0, missing.join(', '));

  const unlisted = LADDER_IDS.filter((id) => mapById.get(id)?.rental?.listed !== true);
  check('every ladder map is listed on Kijiji', unlisted.length === 0, unlisted.join(', '));

  // rent comes from the ONE shipped formula (finance.json via bills.ts) — never a hardcoded number
  const rentOf = (id: string) => computeFinancePreview(finance, { map: mapById.get(id)!, assets }).rent;
  const rungRent = LADDER.map((rung) => Math.max(...rung.map(rentOf)));
  const monotonic = rungRent.every((rent, i) => i === 0 || rent >= rungRent[i - 1]);
  check('rent rises (never falls) as the ladder climbs', monotonic, rungRent.map((r) => `$${r}`).join(' -> '));

  const areaOf = (id: string) => floorsAreaM2((mapById.get(id)!.floors).filter((f) => !f.outdoor));
  const rungArea = LADDER.map((rung) => Math.max(...rung.map(areaOf)));
  check('floor area grows with the ladder', rungArea.every((a, i) => i === 0 || a >= rungArea[i - 1]),
    rungArea.map((a) => `${a}m2`).join(' -> '));

  const outdoorMaps = maps.filter((m) => m.floors.some((f) => f.outdoor)).map((m) => m.id);
  check('the balcony/terrace units keep their outdoor floors out of the rent', outdoorMaps.length >= 2
    && outdoorMaps.every((id) => areaOf(id) < floorsAreaM2(mapById.get(id)!.floors)), outdoorMaps.join(', '));

  const glass = maps.filter((m) => m.walls.some((w) => w.kind === 'curtainWall')).map((m) => m.id);
  check('the glass-tower units are authored with curtain walls', glass.length >= 3, glass.join(', '));
}

// ============================================================ 4. cross-file ids
console.log('\nhousing-ladder.test — cross-file references');
{
  const questIds = new Set(questsData.quests.map((q) => q.id));
  const varIds = new Set(simstate.variables.map((v) => v.id));
  const eventIds = new Set(events.events.map((e) => e.id));
  const bad: string[] = [];

  const walk = (cond: Condition | undefined, where: string) => {
    if (!cond) return;
    if ('all' in cond) { cond.all.forEach((c) => walk(c, where)); return; }
    if ('any' in cond) { cond.any.forEach((c) => walk(c, where)); return; }
    const questRef = /^quests\.(.+)\.state$/.exec(cond.var);
    if (questRef && !questIds.has(questRef[1])) bad.push(`${where}: unknown quest "${questRef[1]}"`);
    if (cond.var.startsWith('vars.') && !varIds.has(cond.var.slice(5))) bad.push(`${where}: unknown var "${cond.var}"`);
    // a homeMap comparison must name a map that actually exists, or the quest can never complete
    if (cond.var === 'vars.homeMap' && typeof cond.eq === 'string' && !mapById.has(cond.eq)) {
      bad.push(`${where}: homeMap references missing map "${cond.eq}"`);
    }
  };

  for (const map of maps) walk(map.rental?.availability, `${map.id} rental`);
  for (const quest of questsData.quests) {
    walk(quest.trigger, `quest ${quest.id} trigger`);
    walk(quest.completion, `quest ${quest.id} completion`);
    for (const reward of quest.rewards) {
      if (reward.type === 'event' && !eventIds.has(reward.event)) bad.push(`quest ${quest.id}: unknown event "${reward.event}"`);
    }
  }
  check('every rental/quest condition and reward id resolves', bad.length === 0, bad.join(' | '));
}

// ============================================================ 5. a simulated playthrough
console.log('\nhousing-ladder.test — the arc is completable');
{
  const startingFunds = 300;
  const runner = new QuestRunner(questsData, simstate, startingFunds);
  let creditScore = 500;
  let jobLevel = 1;
  const needs: Record<string, number> = { comfort: 40, hunger: 80, energy: 80 };
  const skills: Record<string, number> = { english: 5 };

  const evalCtx = (): EvalContext => ({
    needs, skills, funds: runner.funds, creditScore, time: { hour: 12, day: 1 },
    job: { level: jobLevel }, vars: runner.vars, quests: runner.quests,
  });
  const tick = () => runner.tick(needs, skills, { hour: 12, day: 1 }, { creditScore, job: { level: jobLevel } });
  const availableNow = () => listRentals({ maps, evalContext: evalCtx(), finance, assets, homeMapId: runner.vars.homeMap as string })
    .filter((l) => l.available).map((l) => l.mapId).sort();
  const moveTo = (mapId: string) => { runner.vars.homeMap = mapId; tick(); };
  const state = (id: string) => runner.quests[id];

  // --- landing: nothing is rentable until the shipped chain says it is time to move out
  tick();
  check('on arrival nothing on Kijiji is available yet', availableNow().length === 0, availableNow().join(', '));

  // --- the shipped chain hands over: a better visa opens "Move out!"
  runner.quests.find_a_job = 'done';
  runner.quests.get_a_promotion = 'done';
  runner.quests.get_a_better_visa = 'done';
  runner.vars.job = 'dishwasher';
  runner.vars.income = 120;
  runner.vars.visaStatus = 'temp_worker';
  tick();
  check('"Move out!" stays ACTIVE while the sim still lives in the basement', state('move_out') === 'active',
    `state=${state('move_out')} homeMap=${JSON.stringify(runner.vars.homeMap)}`);
  check('the two first-rung listings are the ones on offer',
    availableNow().join(',') === LADDER[0].slice().sort().join(','), availableNow().join(', '));

  // --- rung 1 -> the arc takes over
  moveTo('parkdale_studio');
  needs.comfort = 80;
  tick();
  check('moving out completes "Move out!" and starts "Home sweet home"', state('move_out') === 'done');
  check('settling in completes "Home sweet home"', state('home_sweet_home') === 'done');
  // QuestRunner activates before it completes within a tick, so a quest gated on the one that
  // just finished starts on the NEXT tick — the arc is chained, so every hand-off costs one tick.
  tick();
  check('"Good tenant, good credit" is now the active goal', state('good_tenant') === 'active');

  creditScore = 560;
  runner.vars.income = 150;
  tick();
  check('paying the bills completes "Good tenant, good credit"', state('good_tenant') === 'done');
  check('rung 2 (Junction 1BR) unlocks on credit + income', availableNow().includes('junction_1br'), availableNow().join(', '));
  check('rung 3 (East York 2BR) stays locked until the income clears its bar too',
    !availableNow().includes('east_york_2br'), availableNow().join(', '));
  runner.vars.income = 180;
  check('rung 3 (East York 2BR) unlocks on the higher income', availableNow().includes('east_york_2br'), availableNow().join(', '));

  moveTo('junction_1br');
  check('moving up completes "A real bedroom"', state('a_real_bedroom') === 'done');
  check('the $150 reward landed', runner.funds === startingFunds + 150, `funds=${runner.funds}`);

  jobLevel = 3;
  runner.vars.income = 260;
  tick();
  check('the promotion completes "Climb the ladder"', state('career_climb') === 'done');
  check('rung 4 (Liberty Village) still refuses a 560 credit score',
    !availableNow().includes('liberty_village_condo'), availableNow().join(', '));
  creditScore = 600;
  check('rung 4 (Liberty Village) unlocks on the promotion plus a 600 score',
    availableNow().includes('liberty_village_condo'), availableNow().join(', '));

  creditScore = 620;
  runner.vars.income = 300;
  runner.funds = 6000;
  moveTo('liberty_village_condo');
  check('the balcony unit completes "A room with a view"', state('room_with_a_view') === 'done');
  check('rung 5 (Distillery loft) unlocks', availableNow().includes('distillery_loft'), availableNow().join(', '));

  creditScore = 650;
  runner.vars.income = 350;
  runner.funds = 9000;
  moveTo('distillery_loft');
  check('the loft completes "Loft life"', state('loft_life') === 'done');
  check('rung 6 (Leslieville townhouse) unlocks', availableNow().includes('leslieville_townhouse'), availableNow().join(', '));

  creditScore = 680;
  runner.vars.income = 390;
  runner.funds = 12000;
  moveTo('leslieville_townhouse');
  check('the townhouse completes "Your own front door"', state('own_front_door') === 'done');
  check('rung 7 (North York semi) unlocks', availableNow().includes('north_york_semi'), availableNow().join(', '));
  tick();
  check('"The paperwork" (the PR file) is the next goal', state('the_paperwork') === 'active');

  moveTo('north_york_semi');
  skills.english = 50;
  runner.funds = 20000;
  runner.vars.income = 500;
  tick();
  check('English + savings + income complete "The paperwork"', state('the_paperwork') === 'done');
  check('a detached house stays locked without Permanent Residence', !availableNow().includes('etobicoke_bungalow'),
    availableNow().join(', '));

  runner.vars.visaStatus = 'permanent_resident';
  creditScore = 700;
  runner.funds = 18000;
  tick();
  check('PR completes "Permanent roots"', state('permanent_roots') === 'done');
  check('rung 8 (Etobicoke bungalow) unlocks with PR', availableNow().includes('etobicoke_bungalow'), availableNow().join(', '));

  creditScore = 750;
  runner.vars.income = 625;
  runner.funds = 30000;
  moveTo('etobicoke_bungalow');
  check('the detached house completes "A driveway of your own"', state('the_driveway') === 'done');
  check('rung 9 (Forest Hill) unlocks for a permanent resident', availableNow().includes('forest_hill_house'), availableNow().join(', '));
  check('the penthouse still refuses a non-citizen', !availableNow().includes('yorkville_penthouse'), availableNow().join(', '));

  runner.vars.visaStatus = 'citizen';
  creditScore = 780;
  runner.vars.income = 775;
  runner.funds = 40000;
  tick();
  check('citizenship completes "The ceremony"', state('citizenship_ceremony') === 'done');
  check('the penthouse opens to a citizen', availableNow().includes('yorkville_penthouse'), availableNow().join(', '));

  const beforeDream = runner.funds;
  moveTo('yorkville_penthouse');
  check('the penthouse completes "The Canadian dream"', state('the_canadian_dream') === 'done');
  check('the finale pays out', runner.funds === beforeDream + 2500, `funds=${runner.funds}`);

  const stillLocked = questsData.quests.filter((q) => runner.quests[q.id] === 'locked').map((q) => q.id);
  const arcIds = ['good_tenant', 'a_real_bedroom', 'career_climb', 'room_with_a_view', 'loft_life',
    'own_front_door', 'the_paperwork', 'permanent_roots', 'the_driveway', 'citizenship_ceremony',
    'the_canadian_dream'];
  check('every quest in the new arc reached "done"', arcIds.every((id) => state(id) === 'done'),
    arcIds.filter((id) => state(id) !== 'done').join(', '));
  check('the playthrough left no arc quest stranded', arcIds.every((id) => !stillLocked.includes(id)));

  // the finale is reachable through the OTHER endgame home too
  const alt = new QuestRunner(questsData, simstate, 0);
  alt.quests.the_driveway = 'done';
  alt.vars.visaStatus = 'citizen';
  alt.vars.homeMap = 'forest_hill_house';
  alt.tick({}, {}, { hour: 12, day: 1 });
  check('the Forest Hill house also completes "The Canadian dream"', alt.quests.the_canadian_dream === 'done');
}

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log(`\nall housing-ladder tests passed (${maps.length} maps, ${questsData.quests.length} quests)`);
