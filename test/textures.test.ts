// textures.test — game/textures.ts pure sizing math (ROADMAP_NEXT B9-1).
// Run: npx tsx test/textures.test.ts
import { resolveMetersPerTile, textureRepeat, polygonBounds } from '../game/textures';
import type { TuningData } from '../game/data';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name} ${detail}`); }
}
function approx(a: number, b: number, eps = 1e-9) { return Math.abs(a - b) <= eps; }

const base: Pick<TuningData, 'textures'> = {};

console.log('textures.test — resolveMetersPerTile');
{
  check('absent block → 1m', resolveMetersPerTile(base) === 1);
  check('absent field → 1m', resolveMetersPerTile({ textures: {} }) === 1);
  check('positive value used', resolveMetersPerTile({ textures: { metersPerTile: 2 } }) === 2);
  check('fractional value used', resolveMetersPerTile({ textures: { metersPerTile: 0.5 } }) === 0.5);
  check('zero → 1m guard', resolveMetersPerTile({ textures: { metersPerTile: 0 } }) === 1);
  check('negative → 1m guard', resolveMetersPerTile({ textures: { metersPerTile: -3 } }) === 1);
  check('NaN → 1m guard', resolveMetersPerTile({ textures: { metersPerTile: Number.NaN } }) === 1);
}

console.log('textures.test — textureRepeat (tiles across a surface span)');
{
  check('1m tile → repeat equals meters', textureRepeat(6, 1) === 6);
  check('2m tile halves the tiling', textureRepeat(6, 2) === 3);
  check('0.5m tile doubles the tiling', approx(textureRepeat(6, 0.5), 12));
  check('wall height example (2.5m at 1m tile)', textureRepeat(2.5, 1) === 2.5);
  check('non-positive tile → treated as 1m', textureRepeat(4, 0) === 4);
  check('non-finite tile → treated as 1m', textureRepeat(4, Number.POSITIVE_INFINITY) === 4);
  check('zero surface → no tiling (0, not NaN)', textureRepeat(0, 1) === 0);
  check('negative surface → 0', textureRepeat(-5, 1) === 0);
}

console.log('textures.test — polygonBounds');
{
  const square = polygonBounds([[0, 0], [6, 0], [6, 6], [0, 6]]);
  check('square bounds min corner', square.minX === 0 && square.minY === 0);
  check('square bounds span', square.w === 6 && square.h === 6);

  const offset = polygonBounds([[6, 0], [9, 0], [9, 6], [6, 6]]);
  check('offset kitchen bounds min corner', offset.minX === 6 && offset.minY === 0, `${offset.minX},${offset.minY}`);
  check('offset kitchen span (3 wide, 6 deep)', offset.w === 3 && offset.h === 6, `${offset.w}x${offset.h}`);

  const empty = polygonBounds([]);
  check('empty polygon → all-zero (no NaN)', empty.minX === 0 && empty.minY === 0 && empty.w === 0 && empty.h === 0);

  // end-to-end: a 3×6 floor at 1.5m tile → 2×4 repeats
  const b = polygonBounds([[6, 0], [9, 0], [9, 6], [6, 6]]);
  const mpt = resolveMetersPerTile({ textures: { metersPerTile: 1.5 } });
  check('floor repeat end-to-end', textureRepeat(b.w, mpt) === 2 && textureRepeat(b.h, mpt) === 4);
}

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall textures tests passed');
