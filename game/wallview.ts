// wallview.ts — pure height decision for the view-only Sims-style wall cut (B6-9).

export type WallViewMode = 'full' | 'cut' | 'cutaway';

/** In-page starting preference. `cutaway` is labelled "Cut front" in the HUD. */
export const DEFAULT_WALL_VIEW_MODE: WallViewMode = 'cutaway';

export function nextWallViewMode(mode: WallViewMode): WallViewMode {
  return mode === 'full' ? 'cut' : mode === 'cut' ? 'cutaway' : 'full';
}

export function wallIsCameraSide(
  wallPos: readonly [number, number],
  cameraPos: readonly [number, number],
  mapCenter: readonly [number, number],
): boolean {
  const wx = wallPos[0] - mapCenter[0], wz = wallPos[1] - mapCenter[1];
  const cx = cameraPos[0] - mapCenter[0], cz = cameraPos[1] - mapCenter[1];
  return wx * cx + wz * cz > 0;
}

export function wallShouldCut(
  mode: WallViewMode,
  wallPos: readonly [number, number],
  cameraPos?: readonly [number, number],
  mapCenter?: readonly [number, number],
): boolean {
  if (mode === 'cut') return true;
  if (mode !== 'cutaway' || !cameraPos || !mapCenter) return false;
  return wallIsCameraSide(wallPos, cameraPos, mapCenter);
}

/** Resolve a wall/door visual's shown height. Invalid tuning falls back to 1m; authored cut
 * heights never extend a visual beyond its normal height and retain a small visible curb. */
export function wallCutShownHeight(active: boolean, requestedHeight: number, fullHeight: number): number {
  if (!active) return fullHeight;
  const cutHeight = Number.isFinite(requestedHeight) ? Math.max(0.1, requestedHeight) : 1;
  return Math.min(fullHeight, cutHeight);
}
