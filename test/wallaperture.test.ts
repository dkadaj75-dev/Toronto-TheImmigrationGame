// wallaperture.test.ts — game/wallaperture.ts pure aperture/segment math (ROADMAP_APT D1).
// Run: npx tsx test/wallaperture.test.ts
import {
  DEFAULT_APERTURE_HEIGHT, DEFAULT_APERTURE_WIDTH, ON_WALL_TOLERANCE,
  doorCutsWall, apertureSizeFor, doorAlongWall, aperturesForWall, wallSegments,
  walkableSpans, lintelVisibleUnderCut,
  DEFAULT_MULLION_SPACING, isCurtainWall, resolveMullionSpacing, mullionPositions,
  gapDoorLintel,
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
  // ITEM 3: meshFit y-scale is a per-mesh authoring correction, NOT a doorway-height statement — it
  // no longer inflates the default aperture height (that inflation pushed the doorway past the wall
  // and killed the lintel). The default stays the canonical DEFAULT_APERTURE_HEIGHT.
  check('meshFit y-scale does NOT inflate the default height', approx(ss.height, DEFAULT_APERTURE_HEIGHT));

  const uniform = makeDoorAsset({ meshFit: { scale: 1.5 } });
  const su = apertureSizeFor(uniform);
  check('uniform meshFit scale widens the hole but leaves height canonical',
    approx(su.width, 1.5) && approx(su.height, DEFAULT_APERTURE_HEIGHT));

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

// ------------------------------------------------------------------ ITEM 3 regression: a meshFit
// y-scale that used to inflate the doorway past the wall (shipped door.glb carries meshFit
// scale [1.5,1.75,1.8]; 2.1 x 1.75 = 3.675 > 2.5) must NO LONGER fill the wall — a shorter-than-
// wall door leaves a lintel.
console.log('wallaperture.test — ITEM 3: meshFit-scaled door still yields a lintel (no full-height hole)');
{
  const wall: WallLike = { from: [0, 5], to: [8, 5] };
  const door: ApertureDoorEntry = { at: [4, 5], orientation: 'horizontal', assetId: 'door_scaled' };
  const scaledDoor = makeDoorAsset({ id: 'door_scaled', meshFit: { scale: [1.5, 1.75, 1.8] } });
  const defs = new Map([['door_scaled', scaledDoor]]);
  const aps = aperturesForWall(wall, [door], (id) => (id ? defs.get(id) : undefined), WALL_H);
  check('aperture height stays canonical 2.1 (not 3.675), below the 2.5 wall', aps.length === 1 && approx(aps[0].height, 2.1));
  check('aperture width still tracks the meshFit x-scale (1.5)', approx(aps[0].end - aps[0].start, 1.5));
  const segs = wallSegments(8, WALL_H, aps);
  check('a lintel IS produced above the meshFit-scaled door', segs.some((s) => s.kind === 'lintel'));
  check('lintel height = wall minus the 2.1 doorway', approx(segs.find((s) => s.kind === 'lintel')!.height, WALL_H - 2.1));

  // Explicit override still wins and CAN reach full height (a deliberate garage-style opening).
  const tallExplicit = makeDoorAsset({ id: 'door_tall', door: { hingeOffset: [0, 0], apertureHeight: 9 } });
  const apsTall = aperturesForWall(
    { from: [0, 5], to: [8, 5] },
    [{ at: [4, 5], orientation: 'horizontal', assetId: 'door_tall' }],
    () => tallExplicit, WALL_H,
  );
  check('explicit apertureHeight >= wall clamps to full height (no lintel)', approx(apsTall[0].height, WALL_H));
  check('explicit full-height door → no lintel segment', !wallSegments(8, WALL_H, apsTall).some((s) => s.kind === 'lintel'));

  // Degenerate guards: a door with no def falls back to the canonical height and still leaves a lintel.
  const apsNoDef = aperturesForWall({ from: [0, 5], to: [8, 5] }, [{ at: [4, 5], orientation: 'horizontal' }], () => undefined, WALL_H);
  check('no-def door uses the canonical height and leaves a lintel',
    apsNoDef.length === 1 && approx(apsNoDef[0].height, DEFAULT_APERTURE_HEIGHT) &&
    wallSegments(8, WALL_H, apsNoDef).some((s) => s.kind === 'lintel'));
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

// ------------------------------------------------------------------ D3 curtain wall + mullions
console.log('wallaperture.test — isCurtainWall / resolveMullionSpacing');
{
  check('absent kind = not a curtain wall', isCurtainWall({}) === false);
  check("kind 'solid' = not a curtain wall", isCurtainWall({ kind: 'solid' }) === false);
  check("kind 'curtainWall' = curtain wall", isCurtainWall({ kind: 'curtainWall' }) === true);

  check('resolveMullionSpacing uses a positive value', resolveMullionSpacing(1.5) === 1.5);
  check('absent → default', resolveMullionSpacing(undefined) === DEFAULT_MULLION_SPACING);
  check('zero → default', resolveMullionSpacing(0) === DEFAULT_MULLION_SPACING);
  check('negative → default', resolveMullionSpacing(-2) === DEFAULT_MULLION_SPACING);
  check('NaN → default', resolveMullionSpacing(Number.NaN) === DEFAULT_MULLION_SPACING);
}

console.log('wallaperture.test — mullionPositions (spacing / aperture skip / degenerate)');
{
  // Even spacing across a length that's a whole multiple: posts at 0,2,4,6 (both ends included).
  const even = mullionPositions(6, 2, []);
  check('evenly spaced posts include both ends', even.length === 4 &&
    approx(even[0], 0) && approx(even[1], 2) && approx(even[2], 4) && approx(even[3], 6));

  // Non-multiple length: grid posts 0,2,4 then a capped far-end post at the wall length.
  const capped = mullionPositions(5, 2, []);
  check('non-multiple length caps a post at the far end', capped.length === 4 &&
    approx(capped[0], 0) && approx(capped[1], 2) && approx(capped[2], 4) && approx(capped[3], 5));

  // Aperture at [2.4, 3.6] skips the grid post at 4? No — 4 is outside; but a door at [1.5,2.5]
  // covering the post at 2 removes it.
  const skip = mullionPositions(6, 2, [{ start: 1.5, end: 2.5 }]);
  check('a post inside a door aperture span is skipped',
    !skip.some((p) => approx(p, 2)) && skip.some((p) => approx(p, 0)) && skip.some((p) => approx(p, 4)),
    skip.join(','));

  // A post exactly at an aperture edge is skipped (the door frame owns that jamb).
  const edge = mullionPositions(6, 2, [{ start: 2, end: 3 }]);
  check('a post at an aperture edge is skipped', !edge.some((p) => approx(p, 2)), edge.join(','));

  // The far-end cap is also suppressed when the wall end sits inside an aperture.
  const endInAp = mullionPositions(5, 2, [{ start: 4.5, end: 5 }]);
  check('far-end cap suppressed when the end is inside an aperture', !endInAp.some((p) => approx(p, 5)), endInAp.join(','));

  // Degenerate inputs.
  check('zero-length wall → no mullions', mullionPositions(0, 1.2, []).length === 0);
  check('non-positive spacing → no mullions', mullionPositions(6, 0, []).length === 0);
  check('shorter than one spacing still frames both edges', (() => {
    const m = mullionPositions(1, 2, []);
    return m.length === 2 && approx(m[0], 0) && approx(m[1], 1);
  })());
}

console.log('wallaperture.test — a balcony door on a curtain wall uses the SAME aperture math (no special casing)');
{
  // A curtain wall is just walls[].kind === 'curtainWall'; aperturesForWall/wallSegments never
  // receive the wall kind, so a door cuts a curtain wall byte-identically to a solid one. world.ts
  // renders the SAME segments as glazing instead of opaque boxes — D1 apertures compose for free.
  const solidWall: WallLike = { from: [0, 5], to: [8, 5] };
  const curtainWall = { ...solidWall, kind: 'curtainWall' as const };
  const door: ApertureDoorEntry = { at: [3, 5], orientation: 'horizontal', assetId: 'door_test' };
  const defs = new Map([['door_test', makeDoorAsset()]]);
  const defFor = (id: string | undefined) => (id ? defs.get(id) : undefined);
  const apsSolid = aperturesForWall(solidWall, [door], defFor, WALL_H);
  const apsCurtain = aperturesForWall(curtainWall, [door], defFor, WALL_H);
  check('curtain wall gets the same aperture as a solid wall',
    apsCurtain.length === apsSolid.length && approx(apsCurtain[0].start, apsSolid[0].start) &&
    approx(apsCurtain[0].end, apsSolid[0].end) && approx(apsCurtain[0].height, apsSolid[0].height));
  check('curtain wall is flagged, solid is not', isCurtainWall(curtainWall) && !isCurtainWall(solidWall));
  const mulls = mullionPositions(8, 1.2, apsCurtain);
  check('mullions never fall inside the balcony doorway',
    !mulls.some((p) => p > apsCurtain[0].start - 1e-6 && p < apsCurtain[0].end + 1e-6), mulls.join(','));
}

// ------------------------------------------------------------------ gapDoorLintel (2026-07-17)
// The entrance/exterior door bug: a GAP-ENCODED door (opening = gap between two separate wall
// segments) never matched aperturesForWall, so wallSegments emitted no lintel and the doorway read
// as a full-height void above the panel. gapDoorLintel derives the missing header from the flanking
// walls so a gap door reads identically to an ON-WALL D1 door.
console.log('wallaperture.test — gapDoorLintel (gap-encoded door headers)');
{
  // The real condo.json entrance geometry: a vertical exterior door at x=0 sitting in the gap
  // between walls [0,6]->[0,2.5] and [0,1.5]->[0,0] (gap z=1.5..2.5).
  const entranceWalls: WallLike[] = [
    { from: [0, 6], to: [0, 2.5] },
    { from: [0, 1.5], to: [0, 0] },
  ];
  const entrance: ApertureDoorEntry = { at: [0, 2.17], orientation: 'vertical', assetId: 'door_exterior' };
  const def = makeDoorAsset({ id: 'door_exterior', door: { hingeOffset: [-0.5, 0], exterior: true } });
  const spec = gapDoorLintel(entrance, entranceWalls, def, WALL_H);
  check('gap door yields a header spec', spec !== null);
  if (spec) {
    check('header spans the full flanking gap (1.5..2.5 => length 1.0)', approx(spec.length, 1.0), String(spec.length));
    check('header is centred on the gap midpoint (z=2.0)', approx(spec.center[1], 2.0) && approx(spec.center[0], 0), spec.center.join(','));
    check('header keeps the door orientation', spec.orientation === 'vertical');
    // aperture height defaults to 2.1 (no explicit door.apertureHeight), wall top 2.5 => 0.4 header.
    check('header height = wall top - aperture height (2.5 - 2.1)', approx(spec.height, 0.4), String(spec.height));
    check('header hangs above the aperture, centred between 2.1 and 2.5', approx(spec.yCenter, 2.3), String(spec.yCenter));
  }

  // A horizontal gap door (constant Z, runs along X) works symmetrically.
  const hWalls: WallLike[] = [
    { from: [0, 4], to: [3, 4] },
    { from: [4, 4], to: [8, 4] },
  ];
  const hDoor: ApertureDoorEntry = { at: [3.5, 4], orientation: 'horizontal', assetId: 'd' };
  const hSpec = gapDoorLintel(hDoor, hWalls, makeDoorAsset(), WALL_H);
  check('horizontal gap door yields a header', hSpec !== null);
  if (hSpec) {
    check('horizontal header spans gap 3..4 (length 1.0)', approx(hSpec.length, 1.0), String(hSpec.length));
    check('horizontal header centred at x=3.5, z=4', approx(hSpec.center[0], 3.5) && approx(hSpec.center[1], 4), hSpec.center.join(','));
  }

  // An ON-WALL door (sits on a continuous wall) returns null — aperturesForWall handles those.
  const contWall: WallLike[] = [{ from: [4, 9], to: [4, 6] }];
  const onWall: ApertureDoorEntry = { at: [4, 7.5], orientation: 'vertical', assetId: 'd' };
  check('on-wall door returns null (handled by aperturesForWall)', gapDoorLintel(onWall, contWall, makeDoorAsset(), WALL_H) === null);
  // Sanity: that same door DOES match a wall via doorAlongWall (proving it is the on-wall form).
  check('on-wall door matches its wall via doorAlongWall', doorAlongWall(contWall[0], onWall) !== null);

  // cutsWall:false opts out entirely.
  check('cutsWall:false opts out of a header', gapDoorLintel({ ...entrance, cutsWall: false }, entranceWalls, def, WALL_H) === null);

  // A floating door with no collinear flanking walls gets no header (nothing to derive from).
  check('door with no flanking walls => null', gapDoorLintel(entrance, [], def, WALL_H) === null);
  check('door flanked on only one side => null', gapDoorLintel(entrance, [entranceWalls[0]], def, WALL_H) === null);

  // An explicit full-height aperture leaves no room for a header.
  const tallDef = makeDoorAsset({ door: { hingeOffset: [-0.5, 0], apertureHeight: WALL_H } });
  check('aperture already at wall top => null header', gapDoorLintel(entrance, entranceWalls, tallDef, WALL_H) === null);

  // A collinear wall too far off the door's line (beyond tolerance) is not counted as flanking.
  const offLine: WallLike[] = [
    { from: [0.5, 6], to: [0.5, 2.5] },
    { from: [0.5, 1.5], to: [0.5, 0] },
  ];
  check('walls off the door line (> tolerance) => null', gapDoorLintel(entrance, offLine, def, WALL_H) === null);
}

if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }
console.log('wallaperture.test — all passed');
