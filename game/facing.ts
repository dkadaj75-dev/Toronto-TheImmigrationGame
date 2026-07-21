// facing.ts — "which way does this asset face" helpers (PROJECT_CONTEXT.md §7.2 as-built).
//
// CONVENTION (derived from + must stay consistent with world.ts's placement math and
// sim.ts's own travel-facing logic, not guessed):
//   - world.ts places every object with `obj.rotation.y = degToRad(placed.rotDeg)` and
//     nothing else touches that outer rotation.
//   - sim.ts's SimAgent faces its direction of travel with `rotation.y = atan2(dx, dz)`,
//     which for a travel vector (dx,dz) means rotation.y=0 <=> facing world +Z. Three.js's
//     Y-rotation of a local +Z point (0,0,1) by angle θ lands at world (sinθ, 0, cosθ) —
//     exactly atan2's inverse — so this is the SAME "rotation.y=0 → local +Z is forward"
//     rule for the sim and for every placed object; there is only one convention in this
//     codebase, not two.
//   - Therefore: facingDeg=0 means the model's local +Z (after any meshFit.yawOffsetDeg
//     correction — world.ts applies that to the mesh independently, see game/world.ts)
//     IS the object's front, and needs no per-asset override. A world-facing yaw is just
//     instance.rotDeg + facingDeg.
//   - Verified against the shipped condo map with zero facingDeg overrides: the sofa
//     (rotDeg 0) and the TV (rotDeg 180) already face each other under this rule — see
//     PROJECT_CONTEXT.md §7.2 as-built for the full walkthrough.

import type { AssetDef, TuningData, UsePoseEntry } from './data';

export interface FacingInstance { pos: [number, number]; rotDeg: number; }

/** instance rot + the asset's own facingDeg (absent = 0), normalized to [0, 360). */
export function worldFacingDeg(instance: FacingInstance, def: AssetDef): number {
  const deg = instance.rotDeg + (def.facingDeg ?? 0);
  return ((deg % 360) + 360) % 360;
}

/** Unit XZ direction for a world-facing yaw, matching the rotation.y "0 = +Z" convention above. */
export function facingVector(worldDeg: number): [number, number] {
  const rad = (worldDeg * Math.PI) / 180;
  return [Math.sin(rad), Math.cos(rad)];
}

/** World yaw from one XZ point toward another, using the same 0 = +Z convention as SimAgent. */
export function facingDegToward(from: [number, number], to: [number, number]): number {
  const deg = Math.atan2(to[0] - from[0], to[1] - from[1]) * 180 / Math.PI;
  return ((deg % 360) + 360) % 360;
}

/** Mutual-facing pair for two Sims. Kept pure so two-agent choreography is not reimplemented. */
export function mutualFacingDeg(a: [number, number], b: [number, number]): [number, number] {
  return [facingDegToward(a, b), facingDegToward(b, a)];
}

/** Footprint half-extents as actually placed: swapped on a 90°-ish instance rotation, same
 *  90°-step rule bakeNavGrid() and the Map Editor's objectRect() already use. facingDeg is a
 *  direction, not a placement rotation, so it never resizes the footprint. */
function placedHalfExtents(footprint: [number, number], instanceRotDeg: number): [number, number] {
  let [w, d] = footprint;
  if ((((Math.round(instanceRotDeg) % 180) + 180) % 180) === 90) [w, d] = [d, w];
  return [w / 2, d / 2];
}

/**
 * Stand/approach point at the asset's footprint edge along its world facing, plus a small
 * clearance gap. Uses the oriented-box support-function formula
 * (|dir.x|*halfW + |dir.z|*halfD) — the same "bounds Origin + Forward·(|fwd.x|*Extent.x +
 * |fwd.y|*Extent.y)" stand-spot math the Unreal prototype's BP_Asset.DoAction used (CLAUDE.md),
 * ported here so any footprint/rotation combination gets a sensible outside-the-box point
 * without per-asset special-casing. This is the "walk to" point ONLY — sit/lie poses still
 * snap the sim's position onto the seat/bed object itself once arrived (unchanged, sim.ts).
 */
export function useSpotFor(instance: FacingInstance, def: AssetDef, tuning: TuningData): [number, number] {
  const [dx, dz] = facingVector(worldFacingDeg(instance, def));
  const [halfW, halfD] = placedHalfExtents(def.footprint, instance.rotDeg);
  const clearance = tuning.interaction?.useSpotClearance ?? 0.4; // fallback mirrors character?.sitHeight ?? 0.25
  const reach = Math.abs(dx) * halfW + Math.abs(dz) * halfD + clearance;
  return [instance.pos[0] + dx * reach, instance.pos[1] + dz * reach];
}

/** True if `point` lies in the front half-space of an asset instance's world facing
 *  (dot(point − instance.pos, facingVector) > 0) — §7.2's seat-in-front-of-TV screen. */
export function isInFrontHalfSpace(point: [number, number], instance: FacingInstance, def: AssetDef): boolean {
  const [dx, dz] = facingVector(worldFacingDeg(instance, def));
  return (point[0] - instance.pos[0]) * dx + (point[1] - instance.pos[1]) * dz > 0;
}

/** Rotate a model-local 2D offset [x,z] by an instance's placement rotation (rotDeg), using the
 *  SAME "rotation.y=0 → local +Z is forward" convention as facingVector/world.ts (a rotation.y
 *  of θ sends local (lx,lz) to world (lx·cosθ + lz·sinθ, −lx·sinθ + lz·cosθ) — check lx=0,lz=1:
 *  (sinθ,cosθ), matching facingVector(θ)). Used by usePoseFor for AssetDef.usePose's offset,
 *  which is a placement nudge (rotates with the instance), not a direction (which would compose
 *  with facingDeg like worldFacingDeg does). */
function rotateLocalOffset(offset: [number, number], rotDeg: number): [number, number] {
  const rad = (rotDeg * Math.PI) / 180;
  const [lx, lz] = offset;
  return [lx * Math.cos(rad) + lz * Math.sin(rad), -lx * Math.sin(rad) + lz * Math.cos(rad)];
}

/** World-space point represented by AssetDef.useFacingTarget's model-local x/z coordinates. */
export function useFacingTargetFor(instance: FacingInstance, def: AssetDef): [number, number] | null {
  if (!def.useFacingTarget) return null;
  const [ox, oz] = rotateLocalOffset(def.useFacingTarget, instance.rotDeg);
  return [instance.pos[0] + ox, instance.pos[1] + oz];
}

export function useFacingDegFor(from: [number, number], instance: FacingInstance, def: AssetDef): number | null {
  const target = useFacingTargetFor(instance, def);
  return target && Math.hypot(target[0] - from[0], target[1] - from[1]) > 1e-6
    ? facingDegToward(from, target)
    : null;
}

/**
 * Sit/lie/use perch transform for `pose` on an asset instance (PROJECT_CONTEXT.md §7.8, roadmap
 * item 1 fix; `use` added for ROADMAP_NEXT B2-3). Designer override via `def.usePose?.[pose]`
 * (sparse — see AssetDef's doc comment in game/data.ts for the field semantics). With NO usePose
 * entry set for `pose`, the defaults are:
 *   - position: the footprint CENTER (instance.pos, offset [0,0]) — the sim perches ON the
 *     asset instead of at its walk-up approach point (useSpotFor), which is the root cause fix
 *     for "sits/lies completely outside the furniture" (roadmap item 1).
 *   - height: tuning.character.sitHeight/lieHeight for sit/lie (unchanged fallback constants
 *     from before this field existed: 0.25/0.55); 0 (standing ground level) for `use`.
 *   - facing: worldFacingDeg(instance, def) — for a bed this is the SAME direction as its long
 *     axis (footprint depth is local Z, the axis facingVector treats as "forward"), so a sim
 *     lying down with no override aligns with the bed's long axis by construction.
 * This function computes the transform for WHATEVER `pose` it's called with — it has no opinion
 * on whether calling it was appropriate. For `use`, that decision (only snap when the asset
 * explicitly defines `usePose.use` — no computed default, unlike sit/lie) is the CALLER's job:
 * game/sim.ts's applyPose only invokes this with `pose: 'use'` when `def.usePose?.use` exists,
 * so a generic standing action (no `use` entry) never reaches here and keeps its approach spot.
 * Callers also still let a seat-aware action's subsequent "face the target" step (e.g. facing
 * the TV) override the returned facingDeg — this function only supplies the PERCH's own
 * default/overridden facing, not the final in-scene rotation.
 */
/** New.txt #5: resolve a pose from an EXPLICIT location entry (offset/y/facingDeg) rather than the
 *  asset's single `usePose[pose]`. This is the seam multi-location seating uses — the caller picks
 *  which of an asset's authored sit/lie locations a character claimed and passes its entry here.
 *  `entry` undefined reproduces the pre-usePose computed default exactly (footprint-center offset,
 *  tuning perch height, asset-facing), so a single-location or unauthored asset is unchanged. */
export function usePoseForEntry(
  pose: 'sit' | 'lie' | 'use',
  entry: { offset?: [number, number]; y?: number; facingDeg?: number } | undefined,
  instance: FacingInstance,
  def: AssetDef,
  tuning: TuningData,
): { pos: [number, number]; y: number; facingDeg: number } {
  const [ox, oz] = rotateLocalOffset(entry?.offset ?? [0, 0], instance.rotDeg);
  const y = entry?.y ?? (
    pose === 'sit' ? tuning.character?.sitHeight ?? 0.25
      : pose === 'lie' ? tuning.character?.lieHeight ?? 0.55
      : 0 // 'use': standing ground level, no tuning constant exists (or is needed) for it
  );
  const pos: [number, number] = [instance.pos[0] + ox, instance.pos[1] + oz];
  const targetFacing = useFacingDegFor(pos, instance, def);
  const facingDeg = targetFacing ?? (entry?.facingDeg !== undefined
    ? (((instance.rotDeg + entry.facingDeg) % 360) + 360) % 360
    : worldFacingDeg(instance, def));
  return { pos, y, facingDeg };
}

export function usePoseFor(
  pose: 'sit' | 'lie' | 'use',
  instance: FacingInstance,
  def: AssetDef,
  tuning: TuningData,
): { pos: [number, number]; y: number; facingDeg: number } {
  return usePoseForEntry(pose, def.usePose?.[pose], instance, def, tuning);
}

/** New.txt #5: the ordered list of authored sit/lie location entries for a pose. Always ≥1 so the
 *  occupancy picker has something to claim: the `useLocations` list if authored, else the single
 *  `usePose[pose]` entry, else a lone `undefined` (the computed-default location). Index in this
 *  list is the stable location id an occupant holds. `use` has no multi-location concept — it is a
 *  standing spot — so it always yields its single usePose entry. */
export function seatLocationEntries(
  def: Pick<AssetDef, 'useLocations' | 'usePose'>,
  pose: 'sit' | 'lie',
): (UsePoseEntry | undefined)[] {
  const authored = def.useLocations?.[pose]?.filter((entry) => !!entry);
  if (authored && authored.length) return authored;
  return [def.usePose?.[pose]];
}

/** World-space candidates (for occupancy ranking) of each authored location, in list order. */
export function seatLocationCandidates(
  def: Pick<AssetDef, 'useLocations' | 'usePose'>,
  pose: 'sit' | 'lie',
  instance: FacingInstance,
  fullDef: AssetDef,
  tuning: TuningData,
): { index: number; pos: [number, number]; entry: UsePoseEntry | undefined }[] {
  return seatLocationEntries(def, pose).map((entry, index) => ({
    index,
    pos: usePoseForEntry(pose, entry, instance, fullDef, tuning).pos,
    entry,
  }));
}

/** The point a seat-aware target (e.g. a TV) is "viewed from" — its position projected
 *  forward along its own facing by tuning.interaction.seatViewDistance. Candidate seats are
 *  ranked by distance to this point (nearest wins), mirroring the Unreal prototype's
 *  `own loc + RightVector·400` viewing-point ranking (CLAUDE.md ANIMATION_PLAN Phase A). */
export function viewingPointFor(instance: FacingInstance, def: AssetDef, tuning: TuningData): [number, number] {
  const [dx, dz] = facingVector(worldFacingDeg(instance, def));
  const dist = tuning.interaction?.seatViewDistance ?? 2.5;
  return [instance.pos[0] + dx * dist, instance.pos[1] + dz * dist];
}
