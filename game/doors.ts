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
import {
  attachMesh, loadMeshTemplate, normalizeModelToFootprint, applyMeshFit, normalizeMeshUrl,
  type TrackInitialLoad,
} from './world';
import { DEFAULT_APERTURE_HEIGHT } from './wallaperture';

/** Marker height for the stand-in panel — matches the pre-existing plain door marker in world.ts.
 *  D1: shared with wallaperture.ts's apertureHeight default so the stand-in panel and the hole it
 *  swings in can never drift apart. */
export const DOOR_HEIGHT = DEFAULT_APERTURE_HEIGHT;

// ------------------------------------------------------------------ pure math (headless-tested)

/** The shape of a map.doors[] entry that the door math needs (avoids importing MapData just for this). */
export interface DoorEntry {
  at: [number, number];
  orientation: 'vertical' | 'horizontal';
  width?: number;
  assetId?: string;
  /** D1 (game/data.ts MapData.doors doc): sparse wall-cutting opt-out. Door open/close behavior
   *  here is IDENTICAL for both placement forms — this module never reads it; carried so a
   *  map.doors[] entry of either form is a DoorEntry as-is. */
  cutsWall?: boolean;
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

// ------------------------------------------------------------------ explicit exterior transits (pure state + thin runtime adapter)

export type DoorTransitPhase = 'idle' | 'opening' | 'passing' | 'closing';

export interface DoorTransitStep {
  targetOpen: boolean;
  passNow: boolean;
  closedNow: boolean;
}

/**
 * Pure lifecycle for an explicit exterior-door transit. The actual angle remains owned by the
 * ordinary DoorInstance/stepDoorAngle machinery; this machine only waits for its fully-open/
 * fully-closed inputs and exposes the single pass-through seam between them.
 */
export class DoorTransitMachine {
  private current: DoorTransitPhase = 'idle';

  get phase(): DoorTransitPhase { return this.current; }
  get active(): boolean { return this.current !== 'idle'; }
  get targetOpen(): boolean { return this.current === 'opening' || this.current === 'passing'; }

  begin(): boolean {
    if (this.active) return false;
    this.current = 'opening';
    return true;
  }

  update(fullyOpen: boolean, fullyClosed: boolean, passComplete: boolean): DoorTransitStep {
    let passNow = false;
    let closedNow = false;
    if (this.current === 'opening' && fullyOpen) {
      this.current = 'passing';
      passNow = true;
    }
    if (this.current === 'passing' && passComplete) this.current = 'closing';
    if (this.current === 'closing' && fullyClosed) {
      this.current = 'idle';
      closedNow = true;
    }
    return { targetOpen: this.targetOpen, passNow, closedNow };
  }

  /** Interruptions always target closed; the runtime may optionally snap the panel shut. */
  interrupt(): boolean {
    if (!this.active) return false;
    this.current = 'closing';
    return true;
  }

  reset(): void { this.current = 'idle'; }
}

// ------------------------------------------------------------------ D2 frame/pane split (pure)

/** The two sparse forms of a frame/pane split (AssetDef.door.paneNode / paneMesh, see game/data.ts).
 *  Resolved so the three.js layer never re-reads the raw fields. */
export interface PaneConfig {
  /** Name of the pane node inside the asset's single `mesh` GLB. */
  paneNode?: string;
  /** Path to a separate pane GLB combined with the frame `mesh`. */
  paneMesh?: string;
}

/**
 * The frame/pane split config for a door asset, or null when none is configured (whole asset
 * pivots — today's behavior). paneNode wins if BOTH are set (a single GLB is the simpler, cheaper
 * path — never load a redundant second GLB). Blank strings are treated as absent.
 */
export function resolvePaneConfig(def: AssetDef | undefined): PaneConfig | null {
  const node = def?.door?.paneNode?.trim();
  const mesh = def?.door?.paneMesh?.trim();
  if (node) return { paneNode: node };
  if (mesh) return { paneMesh: mesh };
  return null;
}

/** Axis-aligned XZ bounds of the pane in the door's CANONICAL model-local frame (local +X = swing
 *  axis, +Z = thickness) — what world.ts's Box3 yields for the pane sub-object before base yaw. */
export interface PaneBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * The hinge point (canonical model-local XZ) for a pane split: the pane pivots about its OWN
 * swing-side EDGE, not the whole asset's center. The edge is chosen by the SIGN of the authored
 * hingeOffset[0] — positive → the pane's +X (max) edge, otherwise its -X (min) edge (0 defaults
 * left, matching the shipped door_basic's left-edge hinge). The hinge sits at the pane's thickness
 * center in Z. Derived from the pane's real bounds, so pane size/placement inside the model never
 * needs a re-authored hingeOffset.
 */
export function paneHingeLocal(bounds: PaneBounds, hingeOffset: [number, number]): [number, number] {
  const x = hingeOffset[0] > 0 ? bounds.maxX : bounds.minX;
  const z = (bounds.minZ + bounds.maxZ) / 2;
  return [x, z];
}

/**
 * The pane's center offset FROM its hinge (same canonical frame) — the pane object's local
 * position under the hinge pivot so that at swing angle 0 it sits exactly where it lives inside
 * the model. Composes with paneHingeLocal: hinge + this = the pane's canonical center.
 */
export function paneLocalOffsetFromHinge(bounds: PaneBounds, hingeOffset: [number, number]): [number, number] {
  const [hx, hz] = paneHingeLocal(bounds, hingeOffset);
  return [(bounds.minX + bounds.maxX) / 2 - hx, (bounds.minZ + bounds.maxZ) / 2 - hz];
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
  readonly config: DoorConfig;
  /** Authored entry identity lets pure room queries pair runtime openness with map geometry. */
  readonly entry: DoorEntry;
  /** `simPos`/`simPath` are world XZ; `simPath` is the sim's current remaining route
   *  (SimAgent.getPathPoints()) — empty while the sim isn't moving. */
  update(dt: number, simPos: [number, number], simPath: [number, number][]): void;
  setTransitOpen(open: boolean | null): void;
  isFullyOpen(): boolean;
  isOpen(): boolean;
  isFullyClosed(): boolean;
  forceClosed(): void;
}

export interface ExteriorDoorTransitRequest {
  passThrough: () => void;
  passComplete: () => boolean;
  onClosed?: () => void;
}

export interface ExteriorDoorTransitHandle { cancel(snapClosed?: boolean): void; }

/** Shared runtime adapter around the pure transit machine and the real animated door instance. */
export class ExteriorDoorTransit {
  private machine = new DoorTransitMachine();
  private door: DoorInstance | null = null;
  private request: ExteriorDoorTransitRequest | null = null;
  private token: object | null = null;

  get active(): boolean { return this.machine.active; }

  begin(door: DoorInstance | undefined, request: ExteriorDoorTransitRequest): ExteriorDoorTransitHandle | null {
    if (!door?.config.exterior || !this.machine.begin()) return null;
    const token = {};
    this.token = token;
    this.door = door;
    this.request = request;
    door.setTransitOpen(true);
    return { cancel: (snapClosed = false) => { if (this.token === token) this.cancel(snapClosed); } };
  }

  update(): void {
    const door = this.door;
    const request = this.request;
    if (!door || !request) return;
    const step = this.machine.update(
      door.isFullyOpen(), door.isFullyClosed(),
      this.machine.phase === 'passing' && request.passComplete(),
    );
    door.setTransitOpen(step.targetOpen);
    if (step.passNow) request.passThrough();
    if (step.closedNow) this.finish(request.onClosed);
  }

  cancel(snapClosed = false): void {
    if (!this.door || !this.machine.interrupt()) return;
    this.door.setTransitOpen(false);
    if (!snapClosed) return;
    this.door.forceClosed();
    const onClosed = this.request?.onClosed;
    this.machine.reset();
    this.finish(onClosed);
  }

  private finish(onClosed?: () => void): void {
    const door = this.door;
    this.door = null;
    this.request = null;
    this.token = null;
    door?.setTransitOpen(null);
    onClosed?.();
  }
}

/**
 * Builds one animated door: a hinge pivot at the resolved hinge position, holding a panel that
 * starts as a stand-in box (sized to the canonical local frame: footprint[0] = long axis,
 * footprint[1] = thickness) and swaps to a GLB clone if/when `def.mesh` loads — same "instant
 * box, async swap, keep the box on failure" philosophy as world.ts's attachMesh for furniture.
 */
/** Tag cloned GLB meshes exactly as world.ts's attachMesh does: cast shadows, and mark
 *  sharedResource so the disposal sweep skips template-shared geometry/materials. */
function tagClonedMeshes(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    if (o instanceof THREE.Mesh) { o.castShadow = true; o.userData.sharedResource = true; }
  });
}

export function createDoorInstance(door: DoorEntry, def: AssetDef, tuning: TuningData, trackInitialLoad?: TrackInitialLoad): DoorInstance | null {
  const config = resolveDoorConfig(def, tuning);
  if (!config) return null;
  const baseYaw = doorBaseYawDeg(door.orientation);
  const pane = resolvePaneConfig(def);
  const [px, pz] = panelLocalOffset(config.hingeOffset);
  const [length, thickness] = def.footprint;

  // ---- No pane configured: today's whole-asset swing, byte-for-byte unchanged (zero breakage) ----
  if (!pane) {
    const [hx, hz] = hingeWorldPos(door, config.hingeOffset);
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
    let transitOpen: boolean | null = null;

    return {
      pivot,
      config,
      entry: door,
      update(dt, simPos, simPath) {
        const within = distanceToDoor(simPos, door) < config.triggerDistance;
        const crosses = within && pathCrossesDoorway(simPath, door);
        open = transitOpen ?? doorShouldBeOpenExt(config.exterior, within, crosses, open);
        angle = stepDoorAngle(angle, open, config, dt);
        pivot.rotation.y = THREE.MathUtils.degToRad(baseYaw + angle);
      },
      setTransitOpen(value) { transitOpen = value; },
      isFullyOpen: () => angle === config.openAngleDeg,
      isOpen: () => angle > 0,
      isFullyClosed: () => angle === 0,
      forceClosed() {
        transitOpen = false; open = false; angle = 0;
        pivot.rotation.y = THREE.MathUtils.degToRad(baseYaw);
      },
    };
  }

  // ---- D2 frame/pane split: ONLY the pane swings, the frame stays static ----
  // `root` maps the door's CANONICAL model-local frame (local +X = swing axis, +Z = thickness)
  // into the world: positioned at door.at, rotated by the door's base yaw. `frameGroup` holds the
  // static frame at the door position; `paneGroup` is the hinge pivot and carries ONLY the swing
  // angle (base yaw lives on root, so composing the two stays a pair of plain Y rotations, exactly
  // like the whole-asset path). Until the GLB(s) load, a stand-in box swings from the AUTHORED
  // hinge — the same box the whole-asset path shows — so a load failure degrades to today's look.
  const root = new THREE.Group();
  root.name = `door-hinge:${def.id}`;
  root.position.set(door.at[0], 0, door.at[1]);
  root.rotation.y = THREE.MathUtils.degToRad(baseYaw);
  root.userData.wallCutVisual = 'animated-door';
  root.userData.wallCutFullHeight = DOOR_HEIGHT;
  if (config.exterior) Object.assign(root.userData, { assetId: def.id, interactions: def.interactions });

  const frameGroup = new THREE.Group();
  frameGroup.name = 'door-frame';
  root.add(frameGroup);

  const paneGroup = new THREE.Group(); // hinge pivot — swing angle only
  paneGroup.name = 'door-pane';
  paneGroup.position.set(config.hingeOffset[0], 0, config.hingeOffset[1]); // authored hinge (stand-in)
  root.add(paneGroup);

  const standIn = new THREE.Mesh(
    new THREE.BoxGeometry(length, DOOR_HEIGHT, thickness),
    new THREE.MeshLambertMaterial({ color: 0x8a5a2b }),
  );
  standIn.position.set(px, DOOR_HEIGHT / 2, pz); // -hingeOffset from the hinge → closed center on the doorway
  standIn.castShadow = true;
  paneGroup.add(standIn);
  let standInLive = true;
  const dropStandIn = () => {
    if (!standInLive) return;
    paneGroup.remove(standIn);
    standIn.geometry.dispose();
    (standIn.material as THREE.Material).dispose();
    standInLive = false;
  };

  // Reparent a canonical-frame `paneObj` (a descendant of `model`) onto the hinge pivot, deriving
  // the hinge from the PANE's own bounds, and drop `model` (now pane-less) in as the static frame.
  // The reparent must happen in CANONICAL space (root's world transform temporarily neutralized) so
  // THREE.attach preserves the pane's real position rather than folding in door.at/base yaw.
  const performSplit = (model: THREE.Object3D, paneObj: THREE.Object3D) => {
    tagClonedMeshes(model);
    model.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(paneObj); // canonical (model is standalone here)
    const bounds: PaneBounds = { minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z };
    const [hx, hz] = paneHingeLocal(bounds, config.hingeOffset);

    const savedPos = root.position.clone();
    const savedRotY = root.rotation.y;
    root.position.set(0, 0, 0);
    root.rotation.y = 0;
    root.updateMatrixWorld(true);
    paneGroup.position.set(hx, 0, hz);
    paneGroup.rotation.y = 0;
    paneGroup.updateMatrixWorld(true);
    paneGroup.attach(paneObj); // removes paneObj from model, keeps its canonical world → local offset from hinge
    frameGroup.add(model);
    dropStandIn();
    root.position.copy(savedPos);
    root.rotation.y = savedRotY;
    root.updateMatrixWorld(true);
  };

  // Whole-asset fallback (paneNode not found): swing the entire loaded model from the AUTHORED
  // hinge — exactly today's behavior — instead of a lone stand-in box.
  const swingWholeModel = (model: THREE.Object3D) => {
    tagClonedMeshes(model);
    model.position.x += px; // shift centered model so its center sits -hingeOffset from the hinge
    model.position.z += pz;
    paneGroup.add(model);
    dropStandIn();
  };

  let ready: Promise<unknown>;
  if (pane.paneNode) {
    // Single GLB carrying both frame and pane: load the CLONE, find the pane node by name.
    const url = normalizeMeshUrl(def.mesh);
    ready = loadMeshTemplate(url)
      .then((template) => {
        const model = template.clone(true); // never mutate the cached template
        normalizeModelToFootprint(model, def.footprint);
        applyMeshFit(model, def.meshFit);
        const paneObj = model.getObjectByName(pane.paneNode!);
        if (!paneObj) {
          console.warn(`Door "${def.id}": pane node "${pane.paneNode}" not found in ${url} — swinging the whole asset instead.`);
          swingWholeModel(model);
          return;
        }
        performSplit(model, paneObj);
      })
      .catch(() => console.warn(`Could not load mesh for door "${def.id}" (${url}) — keeping the stand-in pane.`));
  } else {
    // Two GLBs "combined in one viewer": frame = def.mesh, pane = def.door.paneMesh. Both are fitted
    // to the footprint TOGETHER (shared authored coordinate space) so their relative placement holds.
    const frameUrl = normalizeMeshUrl(def.mesh);
    const paneUrl = normalizeMeshUrl(pane.paneMesh!);
    ready = Promise.all([
      loadMeshTemplate(frameUrl).catch(() => null),
      loadMeshTemplate(paneUrl).catch(() => null),
    ]).then(([frameT, paneT]) => {
      if (!paneT) {
        // Documented fallback: keep the frame + let the stand-in pane box swing.
        console.warn(`Door "${def.id}": pane mesh "${paneUrl}" failed to load — keeping frame + stand-in pane swing.`);
        if (frameT) {
          const fm = frameT.clone(true);
          normalizeModelToFootprint(fm, def.footprint);
          applyMeshFit(fm, def.meshFit);
          tagClonedMeshes(fm);
          frameGroup.add(fm);
        } else {
          console.warn(`Door "${def.id}": frame mesh "${frameUrl}" also failed — keeping the stand-in pane.`);
        }
        return; // stand-in keeps swinging
      }
      if (!frameT) {
        console.warn(`Door "${def.id}": frame mesh "${frameUrl}" failed to load — keeping the stand-in pane swing.`);
        return;
      }
      const combined = new THREE.Group();
      combined.add(frameT.clone(true), paneT.clone(true));
      const paneModel = combined.children[1];
      normalizeModelToFootprint(combined, def.footprint);
      applyMeshFit(combined, def.meshFit);
      performSplit(combined, paneModel);
    });
  }
  void (trackInitialLoad ? trackInitialLoad(ready) : ready);

  let angle = 0; // 0 = closed
  let open = false;
  let transitOpen: boolean | null = null;
  return {
    pivot: root,
    config,
    entry: door,
    update(dt, simPos, simPath) {
      const within = distanceToDoor(simPos, door) < config.triggerDistance;
      const crosses = within && pathCrossesDoorway(simPath, door);
      open = transitOpen ?? doorShouldBeOpenExt(config.exterior, within, crosses, open);
      angle = stepDoorAngle(angle, open, config, dt);
      paneGroup.rotation.y = THREE.MathUtils.degToRad(angle); // ONLY the pane swings; frame stays put
    },
    setTransitOpen(value) { transitOpen = value; },
    isFullyOpen: () => angle === config.openAngleDeg,
    isOpen: () => angle > 0,
    isFullyClosed: () => angle === 0,
    forceClosed() {
      transitOpen = false; open = false; angle = 0;
      paneGroup.rotation.y = 0;
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
