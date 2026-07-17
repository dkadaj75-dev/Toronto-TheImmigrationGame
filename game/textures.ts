// textures.ts — pure sizing math for floor/wall image textures (ROADMAP_NEXT B9-1).
// No DOM / three.js here (headless-testable): world.ts owns the TextureLoader + UV wiring.

import type { TuningData } from './data';

/** Physical tile size in meters (one texture repeat spans this many meters on the surface).
 *  Reads tuning.textures.metersPerTile; absent / non-positive / non-finite → 1m (a texture
 *  authored to read at 1m intervals). */
export function resolveMetersPerTile(tuning: Pick<TuningData, 'textures'>): number {
  const v = tuning.textures?.metersPerTile;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 1;
}

/** Follow-up to B9-1 (PROJECT_CONTEXT §7.32): per-surface texture scale. A floor/wall's optional
 *  `textureScale` multiplies the tuning-wide `metersPerTile` for that one surface (2 = texture
 *  reads twice as big / half as many repeats). Guards non-finite / non-positive → 1 (no scaling)
 *  so a bad value never propagates a NaN/zero repeat. */
export function effectiveMetersPerTile(metersPerTile: number, textureScale?: number): number {
  const s = typeof textureScale === 'number' && Number.isFinite(textureScale) && textureScale > 0 ? textureScale : 1;
  return metersPerTile * s;
}

/** How many times the texture repeats across `surfaceMeters` of surface, given the physical
 *  tile size. This is the value fed straight into a THREE.Texture's `.repeat` component when the
 *  surface's UVs run 0..1 across that dimension (walls: BoxGeometry face UVs; floors: normalized
 *  ShapeGeometry UVs — see world.ts). Guards a zero/negative tile size (→1m) and a
 *  zero/negative/non-finite surface (→0 repeat, i.e. no tiling rather than NaN). */
export function textureRepeat(surfaceMeters: number, metersPerTile: number): number {
  const mpt = Number.isFinite(metersPerTile) && metersPerTile > 0 ? metersPerTile : 1;
  const m = Number.isFinite(surfaceMeters) && surfaceMeters > 0 ? surfaceMeters : 0;
  return m / mpt;
}

/** Axis-aligned bounds of a floor polygon (meters). `w`/`h` are the span used both to normalize
 *  the ShapeGeometry UVs to 0..1 and to size the per-axis texture repeat. Empty/degenerate
 *  polygon → all-zero (no tiling). */
export function polygonBounds(polygon: [number, number][]): { minX: number; minY: number; w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of polygon) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, w: 0, h: 0 };
  return { minX, minY, w: maxX - minX, h: maxY - minY };
}

/** ROADMAP_APT R1: absolute area (m²) of a single floor polygon via the shoelace formula. Winding
 *  order does not matter (result is always non-negative); a degenerate polygon (fewer than 3
 *  vertices, or any non-finite coordinate) yields 0. Coordinates are in map meters — the same
 *  world units the floor polygons are authored in (game/world.ts / bills.ts's pointInPolygon). Pure
 *  and headless: the Map Editor reaches it through a bridge; R2's game/rental.ts sums it per map. */
export function polygonArea(polygon: [number, number][]): number {
  if (!Array.isArray(polygon) || polygon.length < 3) return 0;
  let twiceArea = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (!Number.isFinite(xi) || !Number.isFinite(yi) || !Number.isFinite(xj) || !Number.isFinite(yj)) return 0;
    twiceArea += xj * yi - xi * yj;
  }
  return Math.abs(twiceArea) / 2;
}

/** ROADMAP_APT R1: a map's total floor area (m²) — the DEFAULT shown in every Kijiji ad when a map
 *  has no `rental.areaM2Override`. Sums each floor polygon's shoelace area. NOTE this is a naive sum
 *  (overlapping floor polygons would be double-counted); today's maps author non-overlapping floor
 *  rectangles, matching how the designer builds rooms, and an override exists for any exception. The
 *  `floors` param is typed structurally so both MapData['floors'] and lighter fixtures satisfy it. */
export function floorsAreaM2(floors: { polygon: [number, number][] }[]): number {
  if (!Array.isArray(floors)) return 0;
  return floors.reduce((sum, f) => sum + polygonArea(f?.polygon ?? []), 0);
}
