// doors.ts — animated door panels for door-category assets linked via map.doors[].assetId
// (PROJECT_CONTEXT.md §7.1). Pure hinge/crossing/state-machine math lives here, headless-tested
// in test/doors.test.ts; the thin three.js layer below (DoorInstance/buildDoors) turns it into a
// rotating panel mesh, mirroring world.ts's "instant stand-in box, async GLB swap" pattern.
//
// TICK CHOICE: no new timer. DoorInstance.update(dt, ...) is called once per render frame from
// main.ts's existing render loop, passed the same SIM time (`sdt`) the animation mixer advances
// on — so pause/1x/2x/3x freeze/speed doors exactly like every other animated thing in the game.
// Per-frame update with cheap distance/crossing early-outs is fine for a handful of doors.
//
// HINGE CONVENTION: hingeOffset (AssetDef.door.hingeOffset) is defined in the door's CANONICAL
// model-local frame, where local +X is the door's long axis (the swing width) and local +Z is
// its thickness axis — the SAME frame regardless of which way the door is oriented in the map.
// Placing a door rotates this local frame by a fixed "base yaw" so the panel's long axis lies
// along the wall it sits in:
//   'horizontal' orientation (wall runs along world X) → base yaw   0° (local X already = world X)
//   'vertical'   orientation (wall runs along world Z) → base yaw  90° (local X maps to world Z)
// This matches world.ts's pre-existing plain-marker box dimensions exactly (BoxGeometry(1.0,h,0.14)
// for horizontal doors, BoxGeometry(0.14,h,1.0) for vertical ones) — same rotation, same math,
// just parented under a hinge pivot instead of centered on the doorway.
//
// The panel's rotation is BASE_YAW + swing angle (0 = closed .. openAngleDeg = fully open); the
// swing angle only ever needs to compose additively with base yaw because both are plain yaws
// around the same world Y axis (the hinge pivot's own rotation.y).

import * as THREE from 'three';
import type { AssetDef, GameData, TuningData } from './data';
import { attachMesh, type TrackInitialLoad } from './world';

/** Marker height for the stand-in panel — matches the pre-existing plain door marker in world.ts. */
export const DOOR_HEIGHT = 2.1;

// ------------------------------------------------------------------ pure math (headless-tested)

/** The shape of a map.doors[] entry that the door math needs (avoids importing MapData just for this). */
export interface DoorEntry {
  at: [number, number];
  orientation: 'vertical' | 'horizontal';
  width?: number;
  assetId?: string;
}

export interface DoorConfig {
  hingeOffset: [number, number];
  openAngleDeg: number;
  openSeconds: number;
  closeSeconds: number;
  triggerDistance: number;
  /** ROADMAP_NEXT item 9: true for an exterior door — see resolveDoorTickOpen. */
  exterior: boolean;
}

/**
 * Sparse per-asset `door` block merged over tuning.doors defaults (§7.1: "Per-asset values
 * override tuning defaults"). Returns null when the asset isn't door-capable — no `door` block
 * means no hingeOffset to build a hinge from, so there's nothing to animate; callers fall back
 * to the plain marker (world.ts) / skip the door entirely (buildDoors below).
 */
export function resolveDoorConfig(def: AssetDef | undefined, tuning: TuningData): DoorConfig | null {
  if (!def?.door) return null;
  const t = tuning.doors;
  return {
    hingeOffset: def.door.hingeOffset,
    openAngleDeg: def.door.openAngleDeg ?? t?.openAngleDeg ?? 90,
    openSeconds: def.door.openSeconds ?? t?.openSeconds ?? 0.5,
    closeSeconds: def.door.closeSeconds ?? t?.closeSeconds ?? 0.5,
    triggerDistance: def.door.triggerDistance ?? t?.triggerDistance ?? 1.5,
    exterior: def.door.exterior === true,
  };
}

/** The fixed yaw (degrees) that rotates the door's canonical model-local frame (+X = long axis,
 *  +Z = thickness) so its long axis lies along the wall it's set into. See module doc comment. */
export function doorBaseYawDeg(orientation: 'vertical' | 'horizontal'): number {
  return orientation === 'vertical' ? 90 : 0;
}

/** Rotate a local-frame [x,z] point by `deg` around Y, using the SAME matrix convention as
 *  game/facing.ts's facingVector (rotation.y=0 → local +Z is forward; three.js's Y-rotation of
 *  a point, not just the unit +Z vector, so this generalizes that same rule to hingeOffset). */
function rotateXZ([x, z]: [number, number], deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  const s = Math.sin(rad), c = Math.cos(rad);
  return [x * c + z * s, -x * s + z * c];
}

/** World position of the door's hinge — the fixed pivot point the panel swings around. */
export function hingeWorldPos(door: DoorEntry, hingeOffset: [number, number]): [number, number] {
  const [ox, oz] = rotateXZ(hingeOffset, doorBaseYawDeg(door.orientation));
  return [door.at[0] + ox, door.at[1] + oz];
}

/** The panel's local offset FROM the hinge, in the same canonical (unrotated) model-local frame
 *  as hingeOffset — three.js applies the pivot's own rotation via the parent-child hierarchy, so
 *  this stays constant. Panel center coincides with door.at exactly when the swing angle is 0. */
export function panelLocalOffset(hingeOffset: [number, number]): [number, number] {
  return [-hingeOffset[0], -hingeOffset[1]];
}

/**
 * True if the segment p1→p2 crosses the doorway's plane within its opening width — the
 * "consecutive path-point pairs vs the door's segment in door-local space" pair-crossing test
 * (§7.1, porting the Unreal prototype's BP_Door: "transform consecutive point pairs into
 * door-local space and open only if a pair crosses the doorway plane").
 */
export function segmentCrossesDoorway(p1: [number, number], p2: [number, number], door: DoorEntry): boolean {
  const half = (door.width ?? 1.0) / 2;
  const axis = door.orientation === 'vertical' ? 0 : 1; // coordinate that's constant across the doorway plane
  const along = 1 - axis;
  const s1 = p1[axis] - door.at[axis];
  const s2 = p2[axis] - door.at[axis];
  if (s1 === 0 && s2 === 0) return false; // degenerate: both exactly on the plane — no defined crossing
  if ((s1 > 0) === (s2 > 0)) return false; // same side, doesn't cross
  const t = s1 / (s1 - s2); // fraction along p1→p2 where the plane coordinate hits 0
  const alongAt = p1[along] + t * (p2[along] - p1[along]);
  return Math.abs(alongAt - door.at[along]) <= half;
}

/** Any consecutive pair in `path` crosses the doorway. Empty/1-point paths never cross. */
export function pathCrossesDoorway(path: [number, number][], door: DoorEntry): boolean {
  for (let i = 0; i < path.length - 1; i++) {
    if (segmentCrossesDoorway(path[i], path[i + 1], door)) return true;
  }
  return false;
}

export function distanceToDoor(pos: [number, number], door: DoorEntry): number {
  return Math.hypot(pos[0] - door.at[0], pos[1] - door.at[1]);
}

/**
 * The §7.1 open/close state machine, evaluated fresh each tick from three booleans — no hidden
 * state beyond what the caller already tracks (`currentlyOpen`, i.e. the CURRENT target, not the
 * mid-swing angle):
 *   - within trigger distance AND the sim's path crosses the doorway → open.
 *   - "Never close while the sim is within the trigger distance" (don't trap/clip it mid-transit):
 *     if already open and still within trigger distance, STAY open even if the path no longer
 *     crosses (e.g. the path changed underneath it).
 *   - Standing near a door without ever having crossed it does NOT open it (third case below:
 *     within trigger, no crossing, not already open → stays closed).
 *   - Farther than the trigger distance → close.
 */
export function doorShouldBeOpen(withinTrigger: boolean, pathCrosses: boolean, currentlyOpen: boolean): boolean {
  if (!withinTrigger) return false;
  if (pathCrosses) return true;
  return currentlyOpen;
}

/**
 * ROADMAP_NEXT item 9: an exterior door "does NOT open/close like interior doors" — it's static
 * and always rendered closed, regardless of proximity/path-crossing. Wraps doorShouldBeOpen so
 * every caller (and test) expresses the exterior gate through one function instead of a
 * special-cased early-return at each call site.
 */
export function doorShouldBeOpenExt(exterior: boolean, withinTrigger: boolean, pathCrosses: boolean, currentlyOpen: boolean): boolean {
  if (exterior) return false;
  return doorShouldBeOpen(withinTrigger, pathCrosses, currentlyOpen);
}

/**
 * Linear swing toward the target angle (0 = closed, config.openAngleDeg = open) at a rate that
 * covers the FULL swing in openSeconds/closeSeconds respectively (§7.1: "rotate open... over
 * openSeconds"/"rotate closed... over closeSeconds") — reaches the target exactly, never
 * overshoots, and a zero-second config snaps instantly (guards div-by-zero).
 */
export function stepDoorAngle(currentAngle: number, targetOpen: boolean, config: DoorConfig, dt: number): number {
  const target = targetOpen ? config.openAngleDeg : 0;
  const seconds = targetOpen ? config.openSeconds : config.closeSeconds;
  if (seconds <= 0) return target;
  const maxDelta = (config.openAngleDeg / seconds) * dt;
  if (currentAngle < target) return Math.min(target, currentAngle + maxDelta);
  if (currentAngle > target) return Math.max(target, currentAngle - maxDelta);
  return currentAngle;
}

/** True when a map door links to an asset with a resolvable `door` block — i.e. it's rendered
 *  and animated by buildDoors()/DoorInstance below rather than world.ts's plain frame marker. */
export function isAnimatedDoor(door: DoorEntry, byId: Map<string, AssetDef>, tuning: TuningData): boolean {
  const def = door.assetId ? byId.get(door.assetId) : undefined;
  return !!resolveDoorConfig(def, tuning);
}

// ------------------------------------------------------------------ three.js layer

export interface DoorInstance {
  readonly pivot: THREE.Group;
  /** `simPos`/`simPath` are world XZ; `simPath` is the sim's current remaining route
   *  (SimAgent.getPathPoints()) — empty while the sim isn't moving. */
  update(dt: number, simPos: [number, number], simPath: [number, number][]): void;
}

/**
 * Builds one animated door: a hinge pivot at the resolved hinge position, holding a panel that
 * starts as a stand-in box (sized to the canonical local frame: footprint[0] = long axis,
 * footprint[1] = thickness) and swaps to a GLB clone if/when `def.mesh` loads — same "instant
 * box, async swap, keep the box on failure" philosophy as world.ts's attachMesh for furniture.
 */
export function createDoorInstance(door: DoorEntry, def: AssetDef, tuning: TuningData, trackInitialLoad?: TrackInitialLoad): DoorInstance | null {
  const config = resolveDoorConfig(def, tuning);
  if (!config) return null;

  const [hx, hz] = hingeWorldPos(door, config.hingeOffset);
  const [px, pz] = panelLocalOffset(config.hingeOffset);
  const baseYaw = doorBaseYawDeg(door.orientation);

  const pivot = new THREE.Group();
  pivot.name = `door-hinge:${def.id}`;
  pivot.position.set(hx, 0, hz);
  pivot.userData.wallCutVisual = 'animated-door';
  pivot.userData.wallCutFullHeight = DOOR_HEIGHT;
  // ROADMAP_NEXT item 9: exterior doors are tappable interactables (their own AssetDef.interactions
  // surface in the tap menu, e.g. a future "go to work") — same userData.assetId convention
  // world.ts uses for furniture, so input.ts's existing raycast-and-climb-to-userData.assetId tap
  // resolution picks this up with zero changes elsewhere. Interior doors get no userData at all,
  // exactly as before this field existed — they stay non-tappable.
  if (config.exterior) Object.assign(pivot.userData, { assetId: def.id, interactions: def.interactions });

  const panel = new THREE.Group();
  panel.position.set(px, 0, pz);
  pivot.add(panel);

  const [length, thickness] = def.footprint;
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(length, DOOR_HEIGHT, thickness),
    new THREE.MeshLambertMaterial({ color: 0x8a5a2b }),
  );
  box.position.y = DOOR_HEIGHT / 2;
  box.castShadow = true;
  panel.add(box);

  // §7.5: door panels explicitly reject the image/sprite path (allowSprite: false) — see
  // world.ts's attachMesh doc comment for why a billboard or floor-flat plane can't represent a
  // swinging hinge panel. GLB behavior is completely unchanged (shared with furniture/accidents).
  attachMesh(panel, def, { allowSprite: false, trackInitialLoad });

  let angle = 0; // 0 = closed, degrees of swing added on top of baseYaw
  let open = false; // current target state (not the mid-swing angle)

  return {
    pivot,
    update(dt, simPos, simPath) {
      const within = distanceToDoor(simPos, door) < config.triggerDistance;
      const crosses = within && pathCrossesDoorway(simPath, door);
      open = doorShouldBeOpenExt(config.exterior, within, crosses, open);
      angle = stepDoorAngle(angle, open, config, dt);
      pivot.rotation.y = THREE.MathUtils.degToRad(baseYaw + angle);
    },
  };
}

/**
 * Builds every animated door for the current map (doors whose assetId resolves to a door-capable
 * asset). Doors without an assetId, or pointing at an asset with no `door` block, are left to
 * world.ts's existing plain-marker rendering — old maps/behavior stay unchanged (§7.1).
 */
export function buildDoors(data: GameData, trackInitialLoad?: TrackInitialLoad): { group: THREE.Group; instances: DoorInstance[] } {
  const group = new THREE.Group();
  group.name = 'doors';
  const instances: DoorInstance[] = [];
  const byId = new Map(data.assets.assets.map((a) => [a.id, a]));
  for (const door of data.map.doors) {
    if (!door.assetId) continue;
    const def = byId.get(door.assetId);
    if (!def) { console.warn(`Unknown door asset in map: ${door.assetId}`); continue; }
    const instance = createDoorInstance(door, def, data.tuning, trackInitialLoad);
    if (!instance) continue; // asset has no `door` block — world.ts already keeps the plain marker for it
    group.add(instance.pivot);
    instances.push(instance);
  }
  return { group, instances };
}
