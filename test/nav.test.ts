// Headless nav test: two rooms separated by a wall with a 1m door gap.
// The path from room A to room B must exist and must pass through the gap.
import { bakeNavGrid, findPath, isWalkable, worldToCell } from '../game/nav';
import type { MapData } from '../game/data';
import { readFileSync } from 'node:fs';

const map: MapData = {
  id: 'test', name: 'test', gridSize: 0.5,
  bounds: { w: 10, h: 6 },
  floors: [
    { id: 'a', polygon: [[0, 0], [10, 0], [10, 6], [0, 6]], material: 'wood' },
  ],
  walls: [
    // outer shell
    { from: [0, 0], to: [10, 0] }, { from: [10, 0], to: [10, 6] },
    { from: [10, 6], to: [0, 6] }, { from: [0, 6], to: [0, 0] },
    // divider at x=5 with a door gap between z=2.5 and z=3.5
    { from: [5, 0], to: [5, 2.5] },
    { from: [5, 3.5], to: [5, 6] },
  ],
  doors: [{ at: [5, 3], orientation: 'vertical' }],
  spawn: { pos: [2, 3], facingDeg: 0 },
  placedObjects: [],
};

const grid = bakeNavGrid(map);

// sanity: interiors walkable, wall cells blocked
assert(isWalkable(grid, worldToCell(grid, 2, 3)), 'room A interior walkable');
assert(isWalkable(grid, worldToCell(grid, 8, 3)), 'room B interior walkable');
assert(!isWalkable(grid, worldToCell(grid, 5, 1)), 'divider wall blocked');
assert(isWalkable(grid, worldToCell(grid, 5.25, 3.25)) || isWalkable(grid, worldToCell(grid, 4.75, 2.75)), 'door gap has walkable cells');

// path across rooms
const path = findPath(grid, [2, 3], [8, 3]);
assert(path !== null && path.length >= 2, 'path exists across rooms');

// every smoothed segment must stay walkable and pass near the door (x≈5 crossing at 2.5<z<3.5)
let crossesDoor = false;
for (let i = 1; i < path!.length; i++) {
  const [ax, az] = path![i - 1], [bx, bz] = path![i];
  const steps = 40;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
    assert(isWalkable(grid, worldToCell(grid, x, z)), `segment ${i} stays walkable at (${x.toFixed(2)},${z.toFixed(2)})`);
    if (Math.abs(x - 5) < 0.3) {
      assert(z > 2.4 && z < 3.6, `crosses divider inside the door gap (z=${z.toFixed(2)})`);
      crossesDoor = true;
    }
  }
}
assert(crossesDoor, 'path crosses through the doorway');

// unreachable: an enclosed pocket with no gap AND no door (doors carve openings now)
const sealed: MapData = { ...map, doors: [], walls: [...map.walls, { from: [5, 2.5], to: [5, 3.5] }] };
const g2 = bakeNavGrid(sealed);
assert(findPath(g2, [2, 3], [8, 3]) === null, 'sealed room (no door) is unreachable');

// door carving beats a wall drawn straight across: same seal, but the door stays
const sealedWithDoor: MapData = { ...map, walls: [...map.walls, { from: [5, 2.5], to: [5, 3.5] }] };
const g3 = bakeNavGrid(sealedWithDoor);
assert(findPath(g3, [2, 3], [8, 3]) !== null, 'door carves through a wall drawn across it');

// D1 door-in-plain-wall: an ON-WALL door on one CONTINUOUS divider (no gap segments at all)
// carves the same pass-through — the canonical new-form map.
const continuous: MapData = {
  ...map,
  walls: [...map.walls.slice(0, 4), { from: [5, 0], to: [5, 6] }],
  doors: [{ at: [5, 3], orientation: 'vertical' }],
};
const gD1 = bakeNavGrid(continuous);
assert(findPath(gD1, [2, 3], [8, 3]) !== null, 'on-wall door carves a pass-through in a continuous wall');
// ...and cutsWall:false makes that same door purely decorative: no hole, no route.
const decorative: MapData = { ...continuous, doors: [{ at: [5, 3], orientation: 'vertical', cutsWall: false }] };
const gDec = bakeNavGrid(decorative);
assert(findPath(gDec, [2, 3], [8, 3]) === null, 'cutsWall:false door does not carve — wall stays sealed');

// door carving beats furniture parked in the doorway (footprint blocking)
const crateAssets = {
  categories: ['misc'],
  assets: [{ id: 'crate', name: 'Crate', category: 'misc', mesh: '', buyPrice: 0, sellPrice: 0, environmentScore: 0, footprint: [1.5, 1.5] as [number, number], interactions: [] }],
};
const cluttered: MapData = { ...map, placedObjects: [{ asset: 'crate', pos: [5, 3], rotDeg: 0 }] };
const g4 = bakeNavGrid(cluttered, crateAssets);
assert(findPath(g4, [2, 3], [8, 3]) !== null, 'doorway stays open with furniture parked in it');
// but the same crate away from the door still blocks normally
const cluttered2: MapData = { ...map, placedObjects: [{ asset: 'crate', pos: [8, 3], rotDeg: 0 }] };
const g5 = bakeNavGrid(cluttered2, crateAssets);
assert(!isWalkable(g5, worldToCell(g5, 8, 3)), 'crate away from doors still blocks its cells');

// ROADMAP_NEXT item 2: blocksNav:false keeps a flat sprite's footprint walkable; absent still blocks.
const puddleAssets = {
  categories: ['transient'],
  assets: [
    { id: 'puddle', name: 'Puddle', category: 'transient', mesh: '', buyPrice: 0, sellPrice: 0, environmentScore: 0, footprint: [1, 1] as [number, number], interactions: [], blocksNav: false },
    { id: 'block', name: 'Block', category: 'misc', mesh: '', buyPrice: 0, sellPrice: 0, environmentScore: 0, footprint: [1, 1] as [number, number], interactions: [] },
  ],
};
const puddleMap: MapData = { ...map, placedObjects: [{ asset: 'puddle', pos: [8, 3], rotDeg: 0 }] };
const g6 = bakeNavGrid(puddleMap, puddleAssets);
assert(isWalkable(g6, worldToCell(g6, 8, 3)), 'blocksNav:false asset leaves its cells walkable');
const blockMap: MapData = { ...map, placedObjects: [{ asset: 'block', pos: [8, 3], rotDeg: 0 }] };
const g7 = bakeNavGrid(blockMap, puddleAssets);
assert(!isWalkable(g7, worldToCell(g7, 8, 3)), 'asset without blocksNav still blocks (default behavior)');

// tap on a wall resolves to a nearby walkable cell
const p3 = findPath(grid, [2, 3], [5, 1]); // goal is on the divider wall
assert(p3 !== null, 'tap on wall snaps to nearest walkable');

console.log('ALL NAV TESTS PASSED —', path!.length, 'waypoints in the cross-room path:', JSON.stringify(path!.map(p => p.map(v => +v.toFixed(2)))));

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('FAIL:', msg); process.exit(1); }
}

// offset-door case: start/goal not aligned with the gap → must produce a bent path
const p4 = findPath(grid, [1, 0.75], [9, 5.25]);
assert(p4 !== null && p4.length >= 3, `offset route bends through the door (${p4?.length} waypoints)`);
console.log('offset route:', JSON.stringify(p4!.map(p => p.map(v => +v.toFixed(2)))));

// B6-6 performance/regression check against the shipped 0.5m condo: the finer grid is 18x18,
// preserves meter-space map geometry, and remains comfortably cheap to bake.
const condo = JSON.parse(readFileSync(new URL('../data/maps/condo.json', import.meta.url), 'utf8')) as MapData;
const condoAssets = JSON.parse(readFileSync(new URL('../data/assets.json', import.meta.url), 'utf8'));
const bakeStarted = performance.now();
const condoGrid = bakeNavGrid(condo, condoAssets);
const bakeMs = performance.now() - bakeStarted;
assert(condo.gridSize === 0.5 && condo.snapStep === 0.25, 'shipped condo separates 0.5m tiles from 0.25m placement snap');
// Derive expected cells from the LIVE map's own bounds (self-deriving fixture rule — the designer
// resizes the map; a hardcoded 18x18 broke under live data drift).
const expCols = Math.ceil(condo.bounds.w / condo.gridSize), expRows = Math.ceil(condo.bounds.h / condo.gridSize);
assert(condoGrid.cols === expCols && condoGrid.rows === expRows, `shipped condo bakes ${expCols}x${expRows} 0.5m nav cells from its own bounds`);
assert(bakeMs < 1000, `shipped condo nav bake remains fast (${bakeMs.toFixed(2)}ms)`);
console.log(`condo 0.5m nav bake: ${condoGrid.cols * condoGrid.rows} cells in ${bakeMs.toFixed(2)}ms`);
