// wallview.ts — pure height decision for the view-only Sims-style wall cut (B6-9).

/** Resolve a wall/door visual's shown height. Invalid tuning falls back to 1m; authored cut
 * heights never extend a visual beyond its normal height and retain a small visible curb. */
export function wallCutShownHeight(active: boolean, requestedHeight: number, fullHeight: number): number {
  if (!active) return fullHeight;
  const cutHeight = Number.isFinite(requestedHeight) ? Math.max(0.1, requestedHeight) : 1;
  return Math.min(fullHeight, cutHeight);
}
