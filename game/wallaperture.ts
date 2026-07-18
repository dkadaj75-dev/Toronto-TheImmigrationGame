// wallaperture.ts — pure aperture/segment math for door-in-plain-wall holes (ROADMAP_APT D1).
// No DOM / three.js here (headless-tested in test/wallaperture.test.ts): world.ts owns the
// mesh/material wiring, nav.ts owns the walkability carve. Follows the doors.ts/windows.ts
// "pure math + thin three.js layer" precedent.
//
// THE TWO DOOR FORMS (see game/data.ts MapData.doors doc):
//  - GAP-ENCODED (legacy, stays valid forever): the doorway is a real gap between two separate
//    walls[] segments; the door's `at` sits in that gap, ON NO wall segment, so nothing here
//    matches it and the wall rendering is byte-identical to before D1.
//  - ON-WALL (D1): the door's `at` sits ON a continuous wall segment (same point+orientation
//    shape — the wall is derived GEOMETRICALLY, mirroring windows' "point on a wall, no wall
//    reference" precedent, so wall edits/reorders/deletions never dangle an index). Unless the
//    entry opts out with `cutsWall: false`, the wall is rendered AROUND the door's aperture:
//    left solid segment / right solid segment / lintel above the aperture height — pure box
//    arithmetic, no CSG.
//
// Aperture size comes from the door ASSET (AssetDef.door.apertureWidth/apertureHeight, D1
// resolved decision §6.2) with footprint/meshFit-derived defaults — see apertureSizeFor.

import type { AssetDef } from './data';

/** Stand-in door panel height in meters — the SAME 2.1m world.ts's plain door marker and
 *  doors.ts's stand-in panel (DOOR_HEIGHT) have always used; doors.ts imports this constant so
 *  the two can never drift. Also the apertureHeight default (scaled by meshFit y-scale). */
export const DEFAULT_APERTURE_HEIGHT = 2.1;

/** Fallback aperture width when neither the asset nor the door entry can size it. Matches the
 *  1.0m default of a door entry's nav `width` (nav.ts) and the old marker box. */
export const DEFAULT_APERTURE_WIDTH = 1.0;

/** How far (meters, perpendicular) a door's `at` may sit off a wall's centerline and still count
 *  as ON that wall. Editor placement projects exactly onto the line; this tolerates small manual
 *  nudges while staying far below a gap door's >=~0.4m distance to its flanking segments. */
export const ON_WALL_TOLERANCE = 0.2;

/** The subset of a map.doors[] entry this module needs (mirrors doors.ts's DoorEntry precedent
 *  of not importing MapData wholesale). */
export interface ApertureDoorEntry {
  at: [number, number];
  orientation: 'vertical' | 'horizontal';
  width?: number;
  assetId?: string;
  /** D1: sparse, absent = true. False = the door never cuts (no wall hole, no nav carve) —
   *  a purely decorative door against a solid wall. */
  cutsWall?: boolean;
}

export interface WallLike {
  from: [number, number];
  to: [number, number];
}

/** An open span cut through one wall: along-the-wall meters (from the wall's `from` endpoint)
 *  plus the aperture's height from the floor (already clamped to the wall height). */
export interface Aperture {
  start: number;
  end: number;
  height: number;
}

/** One box the wall is rebuilt from. All coordinates are wall-local: `alongCenter` is meters
 *  from the wall's `from` endpoint along its direction; `yCenter`/`height` are world-vertical.
 *  Thickness is the caller's (world.ts keeps its WALL_T). `kind` drives wall-cut view behavior:
 *  'solid' segments ground at y=0 and scale like any wall; 'lintel' hangs above the aperture
 *  and HIDES under the wall-cut view (see lintelVisibleUnderCut). */
export interface WallSegmentSpec {
  alongCenter: number;
  alongLength: number;
  yCenter: number;
  height: number;
  kind: 'solid' | 'lintel';
}

const EPS = 1e-6;

/** D1 sparse boolean: absent = true (doors cut by default). */
export function doorCutsWall(door: Pick<ApertureDoorEntry, 'cutsWall'>): boolean {
  return door.cutsWall !== false;
}

function finitePositive(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/** meshFit scale component along one axis: array → that axis, single number → uniform, absent /
 *  invalid → 1 (no scaling). Index 0 = x (the door's long axis), 1 = y (height). */
function meshFitScale(fit: AssetDef['meshFit'], axis: 0 | 1): number {
  const s = fit?.scale;
  const v = Array.isArray(s) ? s[axis] : s;
  return finitePositive(v) ? v : 1;
}

/**
 * The aperture (hole) size a door punches through a wall, in meters.
 * Resolution order (D1 resolved decision §6.2 — explicit fields beat derived defaults so the
 * designer can fix a badly-sized GLB without re-exporting):
 *  - width:  AssetDef.door.apertureWidth → footprint[0] (the door's long axis) x meshFit x-scale
 *            → the entry's own nav `width` → DEFAULT_APERTURE_WIDTH.
 *  - height: AssetDef.door.apertureHeight → DEFAULT_APERTURE_HEIGHT (the canonical 2.1m doorway
 *            height, which the shipped door.glb also fits to naturally).
 *
 * ITEM 3 fix (2026-07-17): the default height is NO LONGER multiplied by meshFit y-scale.
 * meshFit.scale is a per-mesh AUTHORING correction (fixing a GLB's import units/proportions), NOT a
 * statement about how tall the DOORWAY should be — conflating the two produced a doorway taller than
 * its wall. The shipped door.glb is ~2.1m at its natural footprint fit but carries meshFit y=1.75,
 * so `2.1 x 1.75 = 3.675m` overshot the 2.5m wall: aperturesForWall clamped it to full wall height
 * and wallSegments emitted no lintel (the designer's "wall hole is full height / no lintel" bug).
 * A doorway's canonical height is DEFAULT_APERTURE_HEIGHT; a designer who genuinely wants a taller or
 * shorter opening sets the explicit door.apertureHeight (Asset Editor), which still wins. This keeps
 * the aperture height decoupled from the GLB's internal proportions, which apertureSizeFor cannot
 * measure purely anyway.
 * Non-finite / non-positive values are ignored at every step (never a zero/NaN hole).
 */
export function apertureSizeFor(
  def: AssetDef | undefined,
  entry?: Pick<ApertureDoorEntry, 'width'>,
): { width: number; height: number } {
  const explicitW = def?.door?.apertureWidth;
  const explicitH = def?.door?.apertureHeight;
  let width: number;
  if (finitePositive(explicitW)) width = explicitW;
  else if (def && finitePositive(def.footprint?.[0])) width = def.footprint[0] * meshFitScale(def.meshFit, 0);
  else if (finitePositive(entry?.width)) width = entry!.width!;
  else width = DEFAULT_APERTURE_WIDTH;
  let height: number;
  if (finitePositive(explicitH)) height = explicitH;
  else height = DEFAULT_APERTURE_HEIGHT;
  return { width, height };
}

/**
 * Where (meters along the wall from its `from` endpoint) a door sits ON this wall — or null when
 * it doesn't: orientation mismatch (a 'horizontal' door only cuts a wall running mostly along X,
 * a 'vertical' one a wall running mostly along Z — same axis rule as doors.ts's doorBaseYawDeg),
 * perpendicular distance beyond ON_WALL_TOLERANCE, or projection outside the segment. A legacy
 * gap door's `at` sits in the gap BETWEEN segments (projection lands outside its neighbors), so
 * it returns null against every wall — the geometric backbone of the two-forms coexistence.
 */
export function doorAlongWall(wall: WallLike, door: Pick<ApertureDoorEntry, 'at' | 'orientation'>): number | null {
  const [x1, z1] = wall.from, [x2, z2] = wall.to;
  const dx = x2 - x1, dz = z2 - z1;
  const len = Math.hypot(dx, dz);
  if (len <= EPS) return null;
  const horizontal = Math.abs(dx) >= Math.abs(dz);
  if ((door.orientation === 'horizontal') !== horizontal) return null;
  const rx = door.at[0] - x1, rz = door.at[1] - z1;
  const along = (rx * dx + rz * dz) / len;
  if (along < -EPS || along > len + EPS) return null;
  const perp = Math.abs(rx * dz - rz * dx) / len;
  if (perp > ON_WALL_TOLERANCE) return null;
  return Math.min(Math.max(along, 0), len);
}

/**
 * Every aperture cut through `wall` by the given doors: on-wall matches only (doorAlongWall),
 * cutsWall opt-outs skipped, aperture sized per door asset (apertureSizeFor), clamped to the
 * wall's extent and height (an aperture taller than the wall cuts full height — no lintel),
 * zero-width results dropped, and overlapping apertures MERGED (height = the tallest of the
 * group) so segments never overlap however many doors share a wall. Sorted by `start`.
 */
export function aperturesForWall(
  wall: WallLike,
  doors: ApertureDoorEntry[],
  defFor: (assetId: string | undefined) => AssetDef | undefined,
  wallHeight: number,
): Aperture[] {
  const [x1, z1] = wall.from, [x2, z2] = wall.to;
  const len = Math.hypot(x2 - x1, z2 - z1);
  if (len <= EPS || !finitePositive(wallHeight)) return [];
  const raw: Aperture[] = [];
  for (const door of doors) {
    if (!doorCutsWall(door)) continue;
    const along = doorAlongWall(wall, door);
    if (along === null) continue;
    const { width, height } = apertureSizeFor(defFor(door.assetId), door);
    const start = Math.max(0, along - width / 2);
    const end = Math.min(len, along + width / 2);
    if (end - start <= EPS) continue; // clamped away (or zero-width guard upstream)
    raw.push({ start, end, height: Math.min(height, wallHeight) });
  }
  raw.sort((a, b) => a.start - b.start);
  const merged: Aperture[] = [];
  for (const a of raw) {
    const last = merged[merged.length - 1];
    if (last && a.start <= last.end + EPS) {
      last.end = Math.max(last.end, a.end);
      last.height = Math.max(last.height, a.height);
    } else {
      merged.push({ ...a });
    }
  }
  return merged;
}

/**
 * The boxes a wall of `wallLen` x `wallHeight` is rebuilt from around its apertures — pure box
 * arithmetic (D1: no CSG). No apertures → ONE full-size solid segment (the unchanged legacy
 * wall). Each aperture removes a ground-to-height hole: solid full-height segments fill the
 * spans between apertures, and each aperture shorter than the wall gets a lintel box from its
 * height up to the wall top. Degenerate (< EPS long) segments are dropped.
 */
export function wallSegments(wallLen: number, wallHeight: number, apertures: Aperture[]): WallSegmentSpec[] {
  if (!(wallLen > 0) || !(wallHeight > 0)) return [];
  const solid = (start: number, end: number): WallSegmentSpec => ({
    alongCenter: (start + end) / 2,
    alongLength: end - start,
    yCenter: wallHeight / 2,
    height: wallHeight,
    kind: 'solid',
  });
  if (apertures.length === 0) return [solid(0, wallLen)];
  const out: WallSegmentSpec[] = [];
  let cursor = 0;
  for (const a of apertures) {
    if (a.start - cursor > EPS) out.push(solid(cursor, a.start));
    if (wallHeight - a.height > EPS) {
      out.push({
        alongCenter: (a.start + a.end) / 2,
        alongLength: a.end - a.start,
        yCenter: (a.height + wallHeight) / 2,
        height: wallHeight - a.height,
        kind: 'lintel',
      });
    }
    cursor = a.end;
  }
  if (wallLen - cursor > EPS) out.push(solid(cursor, wallLen));
  return out;
}

/** The pass-through spans (along-the-wall meters) the apertures open at walk height — the
 *  walkable counterpart of wallSegments for tests/tools. Nav itself keeps carving from the door
 *  entry's own `width` (unchanged legacy behavior, see nav.ts's carve loop doc). */
export function walkableSpans(apertures: Aperture[]): { start: number; end: number }[] {
  return apertures.map((a) => ({ start: a.start, end: a.end }));
}

// ---------------------------------------------------------------------------------------------
// D3 — curtain-wall façade mullion layout (pure math; world.ts owns the glazing/mullion meshes).
// ---------------------------------------------------------------------------------------------

/** Default spacing (meters) between a curtain wall's vertical mullions when tuning omits it. */
export const DEFAULT_MULLION_SPACING = 1.2;

/** True when a wall renders as a transparent glazed façade (D3). Absent/'solid' = opaque wall. */
export function isCurtainWall(wall: { kind?: 'solid' | 'curtainWall' }): boolean {
  return wall.kind === 'curtainWall';
}

/** Resolve the mullion spacing from tuning.facade.mullionSpacingMeters, guarding
 *  absent/0/negative/NaN → DEFAULT_MULLION_SPACING. */
export function resolveMullionSpacing(spacing: number | undefined): number {
  return finitePositive(spacing) ? spacing : DEFAULT_MULLION_SPACING;
}

/**
 * Where (meters along the wall from its `from` endpoint) a curtain wall's vertical mullions sit:
 * evenly spaced at `spacing` from 0 up to the wall length (both ends included as jamb posts),
 * SKIPPING any position that falls inside a door aperture span (so a mullion never crosses a
 * balcony doorway — the door frame owns that gap). Degenerate walls (len <= 0) or non-positive
 * spacing → no mullions. Positions inside `[start, end]` of any aperture (edges inclusive within
 * EPS) are dropped; an aperture edge that coincides with a grid position still counts as skipped
 * because the door frame already stands there.
 */
export function mullionPositions(
  wallLen: number,
  spacing: number,
  apertures: { start: number; end: number }[] = [],
): number[] {
  if (!(wallLen > 0) || !(spacing > 0)) return [];
  const insideAperture = (p: number) =>
    apertures.some((a) => p >= a.start - EPS && p <= a.end + EPS);
  const out: number[] = [];
  const count = Math.floor(wallLen / spacing + EPS);
  for (let i = 0; i <= count; i++) {
    const p = Math.min(i * spacing, wallLen);
    if (!insideAperture(p)) out.push(p);
  }
  // Always cap the far end with a jamb post (unless the last grid step already landed there, or it
  // sits in an aperture) so a wall whose length isn't a whole multiple of the spacing still reads
  // as a framed façade edge-to-edge.
  const last = out[out.length - 1];
  if ((last === undefined || wallLen - last > EPS) && !insideAperture(wallLen)) out.push(wallLen);
  return out;
}

/**
 * Wall-cut view behavior for lintel segments (D1 decision, documented here as the pure resolver):
 * a lintel hangs entirely ABOVE the aperture (above walk height, like a window pane), so scaling
 * it down from the ground the way solid walls scale would drop a floating slab into the doorway.
 * It HIDES instead — the exact precedent of procedural windows under the wall-cut view (§7.14
 * B6-9: "above-cut procedural windows hide for the simplest consistent silhouette").
 */
export function lintelVisibleUnderCut(cutActive: boolean): boolean {
  return !cutActive;
}
