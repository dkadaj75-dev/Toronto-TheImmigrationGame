// fbxclips.ts — pure logic for merging Mixamo-style separate-file FBX animation clips into the
// rigged character's clip set (PROJECT_CONTEXT.md §2 FBX addendum). No three.js/DOM dependency,
// so this is fully headless-testable (test/fbxclips.test.ts, run via `npx tsx`). The actual FBX
// parsing (FBXLoader) is browser-only — jsdom can't run it — so only the string-level decisions
// live here; game/world.ts's loadFbxClips wires these into real THREE.AnimationClip/
// KeyframeTrack objects and is the thing both the game and tools/animations.html call (never
// reimplement, PROJECT_CONTEXT.md §5).

/** Strip a leading "mixamorig:" or "mixamorig" (no colon) prefix, if present. */
export function stripMixamoPrefix(boneName: string): string {
  return boneName.replace(/^mixamorig:?/, '');
}

/**
 * Split a three.js track name ("Hips.position[x]", "mixamorig:Spine.quaternion") into its node
 * name and the remainder (starting with the dot). Bone names never contain dots in practice
 * (Mixamo/standard rigs), so splitting on the FIRST dot is safe and avoids needing three.js's
 * PropertyBinding parser just for this.
 */
export function splitTrackName(trackName: string): { node: string; rest: string } {
  const idx = trackName.indexOf('.');
  return idx === -1 ? { node: trackName, rest: '' } : { node: trackName.slice(0, idx), rest: trackName.slice(idx) };
}

export interface RetargetedTrack {
  trackName: string;
  /** false = neither the exact nor the prefix-stripped name resolved against the target skeleton
   *  (and the target skeleton IS known, i.e. non-empty) — worth a designer-facing warning. */
  matched: boolean;
}

/**
 * Resolve one FBX clip track's bone name against the target skeleton's actual bone names.
 *  1. Exact match → pass through unchanged (non-Mixamo FBX exports, or a base rig that already
 *     carries mixamorig-prefixed bone names).
 *  2. `mixamorig:`/`mixamorig` prefix stripped, and THAT resolves → use the stripped name (the
 *     common Mixamo-FBX-onto-differently-named-base-rig case).
 *  3. Neither resolves → left unchanged, reported unmatched (unless the target skeleton is itself
 *     unknown/empty — e.g. called before the base model finished loading — in which case we can't
 *     tell, so we don't spuriously flag it).
 */
export function retargetTrackName(trackName: string, targetBoneNames: ReadonlySet<string>): RetargetedTrack {
  const { node, rest } = splitTrackName(trackName);
  if (targetBoneNames.has(node)) return { trackName, matched: true };
  const stripped = stripMixamoPrefix(node);
  if (stripped !== node && targetBoneNames.has(stripped)) return { trackName: stripped + rest, matched: true };
  return { trackName, matched: targetBoneNames.size === 0 };
}

/** true for a position-typed track ("Bone.position", optionally with a [component] suffix). */
export function isPositionTrackName(trackName: string): boolean {
  return splitTrackName(trackName).rest.startsWith('.position');
}

/**
 * Filter position tracks out of a track-name list — the "drop root translation entirely" decision
 * (see the longer rationale in game/world.ts's loadFbxClips doc comment): Mixamo skeletons only
 * ever keyframe position on the root/hip bone, so dropping every position track is equivalent to
 * dropping root motion without needing to identify "which bone is the root" from the FBX's
 * hierarchy. The game's locomotion is already procedural (anim.ts scales the walk clip's
 * timeScale off actual ground speed), so no clip here needs baked-in translation.
 */
export function stripPositionTracks(trackNames: string[]): { kept: string[]; dropped: string[] } {
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const t of trackNames) (isPositionTrackName(t) ? dropped : kept).push(t);
  return { kept, dropped };
}

/** Basename without extension or query/hash, accepting POSIX or Windows separators. */
export function fileStem(path: string): string {
  const clean = path.split(/[?#]/)[0];
  const base = clean.split(/[\\/]/).pop() ?? clean;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

/**
 * Pick a clip name that won't collide with `usedNames`:
 *  1. the embedded clip name, if present and not already used;
 *  2. else the source file's basename (handles Mixamo's "every export is named mixamo.com" quirk,
 *     and a missing/blank embedded name);
 *  3. else (the basename ALSO collides — e.g. two source files sharing a stem, or several clips
 *     embedded in one FBX) an incrementing `_2`, `_3`, … suffix on the basename.
 * Callers add the returned name to `usedNames` themselves once accepted (this function doesn't
 * mutate the set, so a caller can probe without committing).
 */
export function resolveClipName(embeddedName: string | undefined | null, filenameStem: string, usedNames: ReadonlySet<string>): string {
  const trimmed = (embeddedName ?? '').trim();
  let candidate = trimmed && !usedNames.has(trimmed) ? trimmed : filenameStem;
  if (usedNames.has(candidate)) {
    let i = 2;
    while (usedNames.has(`${filenameStem}_${i}`)) i++;
    candidate = `${filenameStem}_${i}`;
  }
  return candidate;
}
