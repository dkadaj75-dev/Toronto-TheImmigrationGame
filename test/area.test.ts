// area.test.ts — pure shoelace floor-area helpers (ROADMAP_APT R1).
// Run: npx tsx test/area.test.ts
// Covers game/textures.ts's polygonArea + floorsAreaM2 (the DEFAULT m² shown in every Kijiji ad).
import { polygonArea, floorsAreaM2 } from '../game/textures';
import type { MapData } from '../game/data';
import { readFileSync } from 'node:fs';

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('FAIL:', msg); process.exit(1); }
}
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

// ---- polygonArea: known shapes -----------------------------------------------------------------
assert(near(polygonArea([[0, 0], [4, 0], [4, 3], [0, 3]]), 12), '4x3 rectangle = 12 m^2');
assert(near(polygonArea([[0, 0], [1, 0], [1, 1], [0, 1]]), 1), 'unit square = 1 m^2');
assert(near(polygonArea([[0, 0], [4, 0], [0, 3]]), 6), 'right triangle (base 4, height 3) = 6 m^2');

// Winding order must not matter (shoelace is signed; helper returns absolute value).
const cw = polygonArea([[0, 0], [0, 3], [4, 3], [4, 0]]);
const ccw = polygonArea([[0, 0], [4, 0], [4, 3], [0, 3]]);
assert(near(cw, ccw) && near(cw, 12), 'clockwise and counter-clockwise give the same positive area');

// Non-axis-aligned polygon: a diamond with diagonals 4 and 2 → area = 4.
assert(near(polygonArea([[2, 0], [4, 1], [2, 2], [0, 1]]), 4), 'rotated diamond area = 4 m^2');

// ---- polygonArea: degenerate inputs → 0 (never NaN) ---------------------------------------------
assert(polygonArea([]) === 0, 'empty polygon = 0');
assert(polygonArea([[0, 0], [1, 1]]) === 0, 'two-vertex polygon = 0');
assert(polygonArea([[0, 0], [Infinity, 0], [1, 1]]) === 0, 'non-finite coordinate = 0 (no NaN)');
assert(Number.isFinite(polygonArea([[0, 0], [4, 0], [4, 3], [0, 3]])), 'valid polygon area is finite');

// ---- floorsAreaM2: sum across floors -----------------------------------------------------------
assert(near(floorsAreaM2([
  { polygon: [[0, 0], [4, 0], [4, 3], [0, 3]] },   // 12
  { polygon: [[0, 0], [2, 0], [2, 2], [0, 2]] },   // 4
]), 16), 'two floors sum to 16 m^2');
assert(floorsAreaM2([]) === 0, 'no floors = 0');
assert(floorsAreaM2(undefined as unknown as { polygon: [number, number][] }[]) === 0, 'non-array floors = 0 (no throw)');
assert(near(floorsAreaM2([{ polygon: [[0, 0], [4, 0], [4, 3], [0, 3]] }]), 12), 'single floor = its polygon area');

// ---- self-deriving check against the LIVE condo map (fixture rule) -----------------------------
// Derive the expected value from the same live polygons the helper reads — never a hardcoded m^2
// (which would silently rot the moment the designer reshapes the condo).
const condo = JSON.parse(readFileSync(new URL('../data/maps/condo.json', import.meta.url), 'utf8')) as MapData;
const live = floorsAreaM2(condo.floors);
const manual = condo.floors.reduce((s, f) => s + polygonArea(f.polygon), 0);
assert(near(live, manual), 'floorsAreaM2 equals the manual per-floor sum on the live condo map');
assert(live > 0, 'live condo map has a positive floor area');

console.log('ALL AREA TESTS PASSED — live condo floor area =', live.toFixed(2), 'm^2');
