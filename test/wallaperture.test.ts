// wallaperture.test.ts — game/wallaperture.ts pure aperture/segment math (ROADMAP_APT D1).
// Run: npx tsx test/wallaperture.test.ts
import {
  DEFAULT_APERTURE_HEIGHT, DEFAULT_APERTURE_WIDTH, ON_WALL_TOLERANCE,
  doorCutsWall, apertureSizeFor, doorAlongWall, aperturesForWall, wallSegments,
  walkableSpans, lintelVisibleUnderCut,
  type ApertureDoorEntry, type WallLike, type Aperture,
} from '../game/wallaperture';
import { textureRepeat } from '../game/textures';
import type { AssetDef } from '../game/data';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name} ${detail}`); }
}
function approx(a: number, b: number, eps = 1e-6) { return Math.abs(a - b) <= eps; }

const WALL_H = 2.5;

function makeDoorAsset(over: Partial<AssetDef> = {}): AssetDef {
  return {
    id: 'door_test', name: 'Test door', category: 'door', mesh: '',
    buyPrice: 0, sellPrice: 0, environmentScore: 0,
    footprint: [1, 0.12], interactions: [],
    door: { hingeOffset: [-0.5, 0] },
    ...over,
  };
}

// ------------------------------------------------------------------ doorCutsWall (sparse)
console.log('wallaperture.test — doorCutsWall sparse semantics');
{
  check('absent = true (doors cut by default)', doorCutsWall({}) === true);
  check('explicit true cuts', doorCutsWall({ cutsWall: true }) === true);
  check('false opts out', doorCutsWall({ cutsWall: false }) === false);
}

// ------------------------------------------------------------------ apertureSizeFor
console.log('wallaperture.test — apertureSizeFor (explicit fields beat derived defaults)');
{
  const base = makeDoorAsset();
  const s = apertureSizeFor(base);
  check('width defaults to footprint[0]', s.width === 1);
  check('height defaults to the 2.1m stand-in panel height', s.height === DEFAULT_APERTURE_HEIGHT);

  const explicit = makeDoorAsset({ door: { hingeOffset: [-0.5, 0], apertureWidth: 0.9, apertureHeight: 2.0 } });
  const se = apertureSizeFor(explicit);
  check('explicit apertureWidth wins', se.width === 0.9);
  check('explicit apertureHeight wins', se.height === 2.0);

  const scaled = makeDoorAsset({ meshFit: { scale: [1.2, 1.1, 1] } });
  const ss = apertureSizeFor(scaled);
  check('meshFit x-scale multiplies the footprint-derived width', approx(ss.width, 1.2));
  check('meshFit y-scale multiplies the default height', approx(ss.height, DEFAULT_APERTURE_HEIGHT * 1.1));

  const uniform = makeDoorAsset({ meshFit: { scale: 1.5 } });
  const su = apertureSizeFor(uniform);
  check('uniform meshFit scale applies to both axes', approx(su.width, 1.5) && approx(su.height, DEFAULT_APERTURE_HEIGHT * 1.5));

  const explicitBeatsScale = makeDoorAsset({ meshFit: { scale: 2 }, door: { hingeOffset: [0, 0], apertureWidth: 1.1 } });
  check('explicit width ignores meshFit scale', apertureSizeFor(explicitBeatsScale).width === 1.1);

  const bad = makeDoorAsset({ door: { hingeOffset: [0, 0], apertureWidth: 0, apertureHeight: -3 } });
  const sb = apertureSizeFor(bad);
  check('zero/negative explicit values fall back to derived defaults', sb.width === 1 && sb.height === DEFAULT_APERTURE_HEIGHT);

  const noAsset = apertureSizeFor(undefined, { width: 1.4 });
  check('no asset: width falls back to the entry nav width', noAsset.width === 1.4);
  check('no asset: height falls back to the default', noAsset.height === DEFAULT_APERTURE_HEIGHT);
  const noAnything = apertureSizeFor(undefined, {});
  check('no asset, no entry width: 1.0m default', noAnything.width === DEFAULT_APERTURE_WIDTH);
}

// ------------------------------------------------------------------ doorAlongWall matching
console.log('wallaperture.test — doorAlongWall (geometric on-wall matching)');
{
  const hWall: WallLike = { from: [2, 5], to: [10, 5] }; // horizontal, len 8
  check('door on a horizontal wall matches at its along-position',
    approx(doorAlongWall(hWall, { at: [6, 5], orientation: 'horizontal' }) ?? NaN, 4));
  check('orientation mismatch → null',
    doorAlongWall(hWall, { at: [6, 5], orientation: 'vertical' }) === null);
  check('within tolerance off the centerline still matches',
    doorAlongWall(hWall, { at: [6, 5 + ON_WALL_TOLERANCE * 0.9], orientation: 'horizontal' }) !== null);
  check('beyond tolerance → null',
    doorAlongWall(hWall, { at: [6, 5.5], orientation: 'horizontal' }) === null);
  check('projection outside the segment → null (a gap door beside this wall)',
    doorAlongWall(hWall, { at: [10.5, 5], orientation: 'horizontal' }) === null);
  check('door exactly at a wall end matches at along=0',
    approx(doorAlongWall(hWall, { at: [2, 5], orientation: 'horizontal' }) ?? NaN, 0));

  const vWall: WallLike = { from: [0, 10], to: [0, 0] }; // vertical, reversed from/to, len 10
  check('vertical wall (reversed endpoints) matches a vertical door',
    approx(doorAlongWall(vWall, { at: [0, 2], orientation: 'vertical' }) ?? NaN, 8));
  check('degenerate zero-length wall → null',
    doorAlongWall({ from: [1, 1], to: [1, 1] }, { at: [1, 1], orientation: 'horizontal' }) === null);
}

// ------------------------------------------------------------------ gap-form doors match nothing
console.log('wallaperture.test — legacy gap doors never match their flanking segments');
{
  // A 1m gap between two collinear segments (the exact condo.json exterior-door pattern).
  const left: WallLike = { from: [0, 10], to: [0, 2.5] };
  const right: WallLike = { from: [0, 1.5], to: [0, 0] };
  const gapDoor: ApertureDoorEntry = { at: [0, 2], orientation: 'vertical' };
  check('gap door matches neither flanking wall',
    doorAlongWall(left, gapDoor) === null && doorAlongWall(right, gapDoor) === null);
  check('gap door produces no apertures on either wall',
    aperturesForWall(left, [gapDoor], () => undefined, WALL_H).length === 0 &&
    aperturesForWall(right, [gapDoor], () => undefined, WALL_H).length === 0);
  check('flanking walls stay single full solid segments',
    wallSegments(7.5, WALL_H, []).length === 1 && wallSegments(7.5, WALL_H, [])[0].kind === 'solid');
}

// ------------------------------------------------------------------ single door mid-wall
console.log('wallaperture.test — single door mid-wall → left / right / lintel');
{
  const wall: WallLike = { from: [0, 5], to: [8, 5] };
  const door: ApertureDoorEntry = { at: [3, 5], orientation: 'horizontal', assetId: 'door_test' };
  const defs = new Map([['door_test', makeDoorAsset()]]);
  const aps = aperturesForWall(wall, [door], (id) => (id ? defs.get(id) : undefined), WALL_H);
  check('one aperture found', aps.length === 1);
  check('aperture spans door.at +/- width/2', approx(aps[0].start, 2.5) && approx(aps[0].end, 3.5));
  check('aperture height = asset default (2.1), below wall height', approx(aps[0].height, 2.1));

  const segs = wallSegments(8, WALL_H, aps);
  check('three segments: left solid, lintel, right solid', segs.length === 3,
    segs.map((s) => s.kind).join(','));
  const [l, lin, r] = segs;
  check('left solid spans 0..2.5, full height, grounded',
    l.kind === 'solid' && approx(l.alongCenter, 1.25) && approx(l.alongLength, 2.5) &&
    approx(l.height, WALL_H) && approx(l.yCenter, WALL_H / 2));
  check('lintel spans the aperture, from aperture height to wall top',
    lin.kind === 'lintel' && approx(lin.alongCenter, 3) && approx(lin.alongLength, 1) &&
    approx(lin.height, WALL_H - 2.1) && approx(lin.yCenter, (2.1 + WALL_H) / 2));
  check('right solid spans 3.5..8',
    r.kind === 'solid' && approx(r.alongCenter, 5.75) && approx(r.alongLength, 4.5));
  check('walkable span = the aperture interval',
    walkableSpans(aps).length === 1 && approx(walkableSpans(aps)[0].start, 2.5) && approx(walkableSpans(aps)[0].end, 3.5));

  // Segment texture repeat dims (B9-1 physical tiling per SEGMENT).
  const mpt = 1;
  check('solid segment repeat = [segLen, WALL_H] tiles',
    approx(textureRepeat(l.alongLength, mpt), 2.5) && approx(textureRepeat(l.height, mpt), WALL_H));
  check('lintel repeat spans its own shorter height',
    approx(textureRepeat(lin.alongLength, mpt), 1) && approx(textureRepeat(lin.height, mpt), WALL_H - 2.1));
}

// ------------------------------------------------------------------ door at wall end
console.log('wallaperture.test — door at a wall end (aperture clamped)');
{
  const wall: WallLike = { from: [0, 0], to: [6, 0] };
  const door: ApertureDoorEntry = { at: [0.25, 0], orientation: 'horizontal' }; // half the hole off-wall
  const aps = aperturesForWall(wall, [door], () => undefined, WALL_H);
  check('aperture clamps to the wall start', aps.length === 1 && approx(aps[0].start, 0) && approx(aps[0].end, 0.75));
  const segs = wallSegments(6, WALL_H, aps);
  check('no zero-length left segment — lintel + right solid only', segs.length === 2,
    segs.map((s) => s.kind).join(','));
  check('lintel covers the clamped aperture', segs[0].kind === 'lintel' && approx(segs[0].alongLength, 0.75));
  check('right solid fills the rest', segs[1].kind === 'solid' && approx(segs[1].alongLength, 5.25));
}

// ------------------------------------------------------------------ two doors on one wall
console.log('wallaperture.test — two doors on one wall');
{
  const wall: WallLike = { from: [0, 0], to: [10, 0] };
  const doors: ApertureDoorEntry[] = [
    { at: [7.5, 0], orientation: 'horizontal' }, // deliberately out of order
    { at: [2.5, 0], orientation: 'horizontal' },
  ];
  const aps = aperturesForWall(wall, doors, () => undefined, WALL_H);
  check('two apertures, sorted by start', aps.length === 2 && aps[0].start < aps[1].start);
  const segs = wallSegments(10, WALL_H, aps);
  check('five segments: solid, lintel, solid, lintel, solid',
    segs.map((s) => s.kind).join(',') === 'solid,lintel,solid,lintel,solid');
  check('middle solid spans between the apertures',
    approx(segs[2].alongCenter, 5) && approx(segs[2].alongLength, 4));
  check('two walkable spans', walkableSpans(aps).length === 2);

  // Overlapping doors merge into one aperture (tallest height wins).
  const defs = new Map([['tall', makeDoorAsset({ id: 'tall', door: { hingeOffset: [0, 0], apertureHeight: 2.3 } })]]);
  const overlapping: ApertureDoorEntry[] = [
    { at: [3, 0], orientation: 'horizontal' },
    { at: [3.5, 0], orientation: 'horizontal', assetId: 'tall' },
  ];
  const merged = aperturesForWall(wall, overlapping, (id) => (id ? defs.get(id) : undefined), WALL_H);
  check('overlapping apertures merge', merged.length === 1 && approx(merged[0].start, 2.5) && approx(merged[0].end, 4));
  check('merged aperture keeps the tallest height', approx(merged[0].height, 2.3));
}

// ------------------------------------------------------------------ aperture taller than wall
console.log('wallaperture.test — aperture taller than the wall (clamped, no lintel)');
{
  const wall: WallLike = { from: [0, 0], to: [6, 0] };
  const defs = new Map([['huge', makeDoorAsset({ id: 'huge', door: { hingeOffset: [0, 0], apertureHeight: 9 } })]]);
  const door: ApertureDoorEntry = { at: [3, 0], orientation: 'horizontal', assetId: 'huge' };
  const aps = aperturesForWall(wall, [door], (id) => (id ? defs.get(id) : undefined), WALL_H);
  check('aperture height clamps to the wall height', aps.length === 1 && approx(aps[0].height, WALL_H));
  const segs = wallSegments(6, WALL_H, aps);
  check('full-height cut → two solids, no lintel', segs.map((s) => s.kind).join(',') === 'solid,solid');
}

// ------------------------------------------------------------------ guards
console.log('wallaperture.test — guards (zero-width, cutsWall:false, degenerate walls)');
{
  const wall: WallLike = { from: [0, 0], to: [6, 0] };
  const defs = new Map([['zero', makeDoorAsset({ id: 'zero', footprint: [0, 0.12], door: { hingeOffset: [0, 0] } })]]);
  const zeroDoor: ApertureDoorEntry = { at: [3, 0], orientation: 'horizontal', assetId: 'zero' };
  const aps = aperturesForWall(wall, [zeroDoor], (id) => (id ? defs.get(id) : undefined), WALL_H);
  // zero-width footprint falls through to the entry/default width — never a zero-width hole
  check('zero-width footprint falls back to the 1.0m default, not a zero hole',
    aps.length === 1 && approx(aps[0].end - aps[0].start, DEFAULT_APERTURE_WIDTH));

  const optOut: ApertureDoorEntry = { at: [3, 0], orientation: 'horizontal', cutsWall: false };
  check('cutsWall: false cuts nothing', aperturesForWall(wall, [optOut], () => undefined, WALL_H).length === 0);

  check('degenerate wall yields no segments', wallSegments(0, WALL_H, []).length === 0);
  check('invalid wall height yields no apertures',
    aperturesForWall(wall, [{ at: [3, 0], orientation: 'horizontal' }], () => undefined, 0).length === 0);
}

// ------------------------------------------------------------------ wall-cut view resolver
console.log('wallaperture.test — lintelVisibleUnderCut');
{
  check('lintel visible with the cut off', lintelVisibleUnderCut(false) === true);
  check('lintel hidden with the cut on (window precedent)', lintelVisibleUnderCut(true) === false);
}

// ------------------------------------------------------------------ live-data smoke: condo.json
console.log('wallaperture.test — live condo.json segment structure is aperture-consistent');
{
  // Self-deriving from the shipped map — NEVER hardcode counts here: the designer freely mixes
  // gap-form and D1 on-wall doors. For every wall, wallSegments' output must structurally match
  // aperturesForWall's output: solid spans around/between apertures (degenerate < EPS spans
  // dropped) plus one lintel per aperture shorter than the wall.
  const { readFileSync } = await import('node:fs');
  const condo = JSON.parse(readFileSync(new URL('../data/maps/condo.json', import.meta.url), 'utf8'));
  const assets = JSON.parse(readFileSync(new URL('../data/assets.json', import.meta.url), 'utf8'));
  const byId = new Map<string, AssetDef>(assets.assets.map((a: AssetDef) => [a.id, a]));
  const EPS = 1e-6;
  let wallsChecked = 0, mismatches = 0;
  for (const wall of condo.walls) {
    const len = Math.hypot(wall.to[0] - wall.from[0], wall.to[1] - wall.from[1]);
    const aps = aperturesForWall(wall, condo.doors, (id) => (id ? byId.get(id) : undefined), WALL_H);
    const segs = wallSegments(len, WALL_H, aps);
    let expectedSolids = 0, cursor = 0;
    for (const a of aps) {
      if (a.start - cursor > EPS) expectedSolids++;
      cursor = a.end;
    }
    if (len - cursor > EPS) expectedSolids++;
    const expectedLintels = aps.filter((a) => WALL_H - a.height > EPS).length;
    const solids = segs.filter((s) => s.kind === 'solid').length;
    const lintels = segs.filter((s) => s.kind === 'lintel').length;
    if (solids !== expectedSolids || lintels !== expectedLintels) {
      mismatches++;
      console.error(`  wall ${JSON.stringify(wall.from)}->${JSON.stringify(wall.to)}: solids ${solids} vs ${expectedSolids}, lintels ${lintels} vs ${expectedLintels}`);
    }
    wallsChecked++;
  }
  check(`every shipped wall's segments are aperture-consistent (${wallsChecked} walls)`, mismatches === 0, `${mismatches} mismatched`);
  check('shipped map has at least one wall', wallsChecked > 0);
}

if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }
console.log('wallaperture.test — all passed');
