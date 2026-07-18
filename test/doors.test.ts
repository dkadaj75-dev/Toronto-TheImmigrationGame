// doors.test.ts — game/doors.ts pure logic (PROJECT_CONTEXT.md §7.1 doors-as-assets slice).
// Run: npx tsx test/doors.test.ts
import {
  resolveDoorConfig, doorBaseYawDeg, hingeWorldPos, panelLocalOffset,
  segmentCrossesDoorway, pathCrossesDoorway, distanceToDoor, doorShouldBeOpen, doorShouldBeOpenExt,
  stepDoorAngle, isAnimatedDoor, resolvePaneConfig, paneHingeLocal, paneLocalOffsetFromHinge,
  DoorTransitMachine, type DoorEntry, type DoorConfig, type PaneBounds,
} from '../game/doors';
import type { AssetDef, TuningData } from '../game/data';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name} ${detail}`); }
}
function approx(a: number, b: number, eps = 1e-6) { return Math.abs(a - b) <= eps; }

function asset(partial: Partial<AssetDef> = {}): AssetDef {
  return {
    id: 'door_basic', name: 'Basic door', category: 'door', mesh: '', buyPrice: 0, sellPrice: 0,
    environmentScore: 0, footprint: [1, 0.12], interactions: [],
    ...partial,
  };
}

const tuning: TuningData = {
  simulation: { needsDecayTickSeconds: 1, activityGainTickSeconds: 2 },
  autonomy: { seekBelowThreshold: 30, stopAtThreshold: 95, postPlayerCommandCooldownSeconds: 10 },
  time: { secondsPerGameDay: 60, nightStartHour: 22, nightEndHour: 6 },
  economy: { startingFunds: 0, currencyName: '§' },
  movement: { walkSpeed: 2, arrivalRadius: 0.35 },
  camera: { minZoom: 4, maxZoom: 18, minPitchDeg: 30, maxPitchDeg: 70, panBoundsPadding: 2 },
  quests: { toastDurationSeconds: 4, completedLogLimit: 5 },
  doors: { openSeconds: 0.5, closeSeconds: 0.5, openAngleDeg: 90, triggerDistance: 1.5 },
};

console.log('doors.test — resolveDoorConfig (sparse override over tuning.doors)');
{
  check('no door block → null', resolveDoorConfig(asset(), tuning) === null);
  check('no asset at all → null', resolveDoorConfig(undefined, tuning) === null);

  const bare = asset({ door: { hingeOffset: [-0.5, 0] } });
  const cfg = resolveDoorConfig(bare, tuning)!;
  check('hingeOffset passed through', cfg.hingeOffset[0] === -0.5 && cfg.hingeOffset[1] === 0);
  check('openSeconds falls back to tuning', cfg.openSeconds === 0.5);
  check('closeSeconds falls back to tuning', cfg.closeSeconds === 0.5);
  check('openAngleDeg falls back to tuning', cfg.openAngleDeg === 90);
  check('triggerDistance falls back to tuning', cfg.triggerDistance === 1.5);

  const overridden = asset({ door: { hingeOffset: [-0.4, 0.1], openAngleDeg: 110, openSeconds: 1, closeSeconds: 2, triggerDistance: 3 } });
  const cfg2 = resolveDoorConfig(overridden, tuning)!;
  check('per-asset openAngleDeg overrides tuning', cfg2.openAngleDeg === 110);
  check('per-asset openSeconds overrides tuning', cfg2.openSeconds === 1);
  check('per-asset closeSeconds overrides tuning', cfg2.closeSeconds === 2);
  check('per-asset triggerDistance overrides tuning', cfg2.triggerDistance === 3);

  const noTuningGroup: TuningData = { ...tuning, doors: undefined };
  const cfg3 = resolveDoorConfig(bare, noTuningGroup)!;
  check('missing tuning.doors group falls back to hardcoded defaults', cfg3.openSeconds === 0.5 && cfg3.closeSeconds === 0.5 && cfg3.openAngleDeg === 90 && cfg3.triggerDistance === 1.5);
}

console.log('doors.test — doorBaseYawDeg + hinge/panel transform (closed panel center == door.at)');
{
  check('horizontal → base yaw 0', doorBaseYawDeg('horizontal') === 0);
  check('vertical → base yaw 90', doorBaseYawDeg('vertical') === 90);

  const hingeOffset: [number, number] = [-0.5, 0];

  // horizontal door: wall runs along X, hinge sits half a door-width to the -X side of door.at
  const doorH: DoorEntry = { at: [3.5, 6], orientation: 'horizontal' };
  const [hx, hz] = hingeWorldPos(doorH, hingeOffset);
  check('horizontal hinge offset along -X', approx(hx, 3.0) && approx(hz, 6.0), `${hx},${hz}`);
  const [px, pz] = panelLocalOffset(hingeOffset);
  // panel center (angle=0, i.e. closed) = hinge + rotate(panelLocalOffset, baseYaw)
  const closedCenterH: [number, number] = [hx + px, hz + pz]; // baseYaw=0, rotation is identity
  check('closed horizontal panel center reproduces door.at', approx(closedCenterH[0], 3.5) && approx(closedCenterH[1], 6), `${closedCenterH}`);

  // vertical door: wall runs along Z, hinge offset rotates 90° into the Z axis
  const doorV: DoorEntry = { at: [9, 3.5], orientation: 'vertical' };
  const [hx2, hz2] = hingeWorldPos(doorV, hingeOffset);
  check('vertical hinge offset rotated onto +Z', approx(hx2, 9) && approx(hz2, 4.0), `${hx2},${hz2}`);
  // closed panel center = hinge + rotateXZ(panelLocalOffset, 90)
  const rad = Math.PI / 2;
  const rx = px * Math.cos(rad) + pz * Math.sin(rad);
  const rz = -px * Math.sin(rad) + pz * Math.cos(rad);
  const closedCenterV: [number, number] = [hx2 + rx, hz2 + rz];
  check('closed vertical panel center reproduces door.at', approx(closedCenterV[0], 9) && approx(closedCenterV[1], 3.5), `${closedCenterV}`);
}

console.log('doors.test — segmentCrossesDoorway / pathCrossesDoorway');
{
  const doorV: DoorEntry = { at: [9, 3.5], orientation: 'vertical' }; // plane x=9, opening z∈[3,4] (width 1.0 default)
  check('straight crossing through the opening', segmentCrossesDoorway([8, 3.5], [10, 3.5], doorV) === true);
  check('crossing but outside the opening width', segmentCrossesDoorway([8, 10], [10, 10], doorV) === false);
  check('both points same side — no crossing', segmentCrossesDoorway([8, 3.5], [8.5, 3.5], doorV) === false);
  check('both points exactly on the plane — degenerate, no crossing', segmentCrossesDoorway([9, 3.2], [9, 3.8], doorV) === false);
  check('endpoint exactly on plane, other side — treated as a crossing', segmentCrossesDoorway([9, 3.5], [10, 3.5], doorV) === true);
  // custom width
  const doorWide: DoorEntry = { at: [9, 3.5], orientation: 'vertical', width: 2 };
  check('wider door widens the accepted along-range', segmentCrossesDoorway([8, 4.4], [10, 4.4], doorWide) === true);

  const doorH: DoorEntry = { at: [3.5, 6], orientation: 'horizontal' }; // plane z=6, opening x∈[3,4]
  check('horizontal crossing through the opening', segmentCrossesDoorway([3.5, 5], [3.5, 7], doorH) === true);
  check('horizontal crossing outside the opening', segmentCrossesDoorway([0, 5], [0, 7], doorH) === false);

  // full path: only the second leg crosses
  const path: [number, number][] = [[8, 3.5], [8.9, 3.5], [10.5, 3.5]];
  check('pathCrossesDoorway finds a crossing anywhere in the path', pathCrossesDoorway(path, doorV) === true);
  check('pathCrossesDoorway false when no leg crosses', pathCrossesDoorway([[8, 3.5], [8.9, 3.5]], doorV) === false);
  check('empty path never crosses', pathCrossesDoorway([], doorV) === false);
  check('single-point path never crosses', pathCrossesDoorway([[9, 3.5]], doorV) === false);
}

console.log('doors.test — distanceToDoor');
{
  const door: DoorEntry = { at: [9, 3.5], orientation: 'vertical' };
  check('euclidean distance', approx(distanceToDoor([9, 5.5], door), 2));
  check('zero at the door itself', approx(distanceToDoor([9, 3.5], door), 0));
}

console.log('doors.test — doorShouldBeOpen (§7.1 state machine)');
{
  check('within trigger + crossing → open', doorShouldBeOpen(true, true, false) === true);
  check('within trigger, no crossing, not already open → stays closed (standing near ≠ opening)', doorShouldBeOpen(true, false, false) === false);
  check('within trigger, no crossing, ALREADY open → never close mid-transit', doorShouldBeOpen(true, false, true) === true);
  check('within trigger, crossing, already open → stays open', doorShouldBeOpen(true, true, true) === true);
  check('beyond trigger, was open → closes', doorShouldBeOpen(false, false, true) === false);
  check('beyond trigger, was open, crossing flag irrelevant when far → still closes', doorShouldBeOpen(false, true, true) === false);
  check('beyond trigger, was closed → stays closed', doorShouldBeOpen(false, false, false) === false);
}

console.log('doors.test — stepDoorAngle (linear swing over openSeconds/closeSeconds)');
{
  const cfg: DoorConfig = { hingeOffset: [-0.5, 0], openAngleDeg: 90, openSeconds: 0.5, closeSeconds: 0.5, triggerDistance: 1.5, exterior: false };
  check('opening: half the duration → half the angle', approx(stepDoorAngle(0, true, cfg, 0.25), 45));
  check('opening: full duration reaches exactly openAngleDeg', approx(stepDoorAngle(0, true, cfg, 0.5), 90));
  check('opening never overshoots past a big dt', approx(stepDoorAngle(0, true, cfg, 10), 90));
  check('closing: full duration reaches exactly 0', approx(stepDoorAngle(90, false, cfg, 0.5), 0));
  check('closing never undershoots below 0', approx(stepDoorAngle(90, false, cfg, 10), 0));
  check('already at target: no-op', approx(stepDoorAngle(90, true, cfg, 0.1), 90));
  check('zero dt: no movement', approx(stepDoorAngle(10, true, cfg, 0), 10));

  const asymCfg: DoorConfig = { hingeOffset: [-0.5, 0], openAngleDeg: 90, openSeconds: 1, closeSeconds: 0.25, triggerDistance: 1.5, exterior: false };
  check('opening rate uses openSeconds (slower)', approx(stepDoorAngle(0, true, asymCfg, 0.5), 45));
  check('closing rate uses closeSeconds (faster)', approx(stepDoorAngle(90, false, asymCfg, 0.125), 45));

  const instantCfg: DoorConfig = { hingeOffset: [-0.5, 0], openAngleDeg: 90, openSeconds: 0, closeSeconds: 0, triggerDistance: 1.5, exterior: false };
  check('zero-second config snaps instantly (guards div-by-zero)', approx(stepDoorAngle(0, true, instantCfg, 0.001), 90));

  // full simulated opening then closing sequence, sub-stepped
  let angle = 0;
  for (let i = 0; i < 5; i++) angle = stepDoorAngle(angle, true, cfg, 0.1); // 0.5s total
  check('sub-stepped opening converges to openAngleDeg', approx(angle, 90, 1e-4), String(angle));
  for (let i = 0; i < 5; i++) angle = stepDoorAngle(angle, false, cfg, 0.1); // 0.5s total
  check('sub-stepped closing converges to 0', approx(angle, 0, 1e-4), String(angle));
}

console.log('doors.test — resolveDoorConfig exposes the exterior flag (ROADMAP_NEXT item 9)');
{
  const interior = asset({ door: { hingeOffset: [-0.5, 0] } });
  check('absent door.exterior resolves to false', resolveDoorConfig(interior, tuning)!.exterior === false);

  const exterior = asset({ door: { hingeOffset: [-0.5, 0], exterior: true } });
  check('door.exterior:true passes through', resolveDoorConfig(exterior, tuning)!.exterior === true);
}

console.log('doors.test — doorShouldBeOpenExt: exterior doors skip the open/close tick entirely');
{
  check('exterior door stays closed even within trigger and crossing', doorShouldBeOpenExt(true, true, true, false) === false);
  check('exterior door is forced closed even if currentlyOpen was somehow true', doorShouldBeOpenExt(true, true, true, true) === false);
  check('exterior gate never opens regardless of proximity', doorShouldBeOpenExt(true, false, false, false) === false);
  for (const [within, crosses, currentlyOpen] of [
    [true, true, false], [true, false, false], [true, false, true], [true, true, true],
    [false, false, true], [false, true, true], [false, false, false],
  ] as [boolean, boolean, boolean][]) {
    check(
      `non-exterior matches doorShouldBeOpen exactly (within=${within} crosses=${crosses} open=${currentlyOpen})`,
      doorShouldBeOpenExt(false, within, crosses, currentlyOpen) === doorShouldBeOpen(within, crosses, currentlyOpen),
    );
  }
}

console.log('doors.test — isAnimatedDoor');
{
  const byId = new Map<string, AssetDef>([
    ['door_basic', asset({ door: { hingeOffset: [-0.5, 0] } })],
    ['sofa', asset({ id: 'sofa', category: 'seating', door: undefined })],
  ]);
  check('door with a door-capable asset is animated', isAnimatedDoor({ at: [0, 0], orientation: 'vertical', assetId: 'door_basic' }, byId, tuning) === true);
  check('door with no assetId is not animated', isAnimatedDoor({ at: [0, 0], orientation: 'vertical' }, byId, tuning) === false);
  check('door pointing at a non-door asset is not animated', isAnimatedDoor({ at: [0, 0], orientation: 'vertical', assetId: 'sofa' }, byId, tuning) === false);
  check('door pointing at an unknown assetId is not animated', isAnimatedDoor({ at: [0, 0], orientation: 'vertical', assetId: 'ghost' }, byId, tuning) === false);
}

console.log('doors.test — D1 on-wall form: door behavior is placement-form-agnostic');
{
  // A D1 on-wall entry is the SAME DoorEntry shape plus sparse cutsWall — none of the door
  // open/close/hinge logic reads it, so both forms must produce identical results.
  const byId = new Map<string, AssetDef>([['door_basic', asset({ door: { hingeOffset: [-0.5, 0] } })]]);
  const gapForm = { at: [3, 5] as [number, number], orientation: 'horizontal' as const, assetId: 'door_basic' };
  const onWallForm = { ...gapForm, cutsWall: true };
  const decorative = { ...gapForm, cutsWall: false };
  for (const [label, entry] of [['on-wall', onWallForm], ['decorative (cutsWall:false)', decorative]] as const) {
    check(`${label}: isAnimatedDoor matches the gap form`, isAnimatedDoor(entry, byId, tuning) === isAnimatedDoor(gapForm, byId, tuning));
    check(`${label}: hingeWorldPos matches the gap form`, hingeWorldPos(entry, [-0.5, 0]).join(',') === hingeWorldPos(gapForm, [-0.5, 0]).join(','));
    check(`${label}: segmentCrossesDoorway matches the gap form`,
      segmentCrossesDoorway([3, 4], [3, 6], entry) === segmentCrossesDoorway([3, 4], [3, 6], gapForm));
    check(`${label}: distanceToDoor matches the gap form`, distanceToDoor([0, 0], entry) === distanceToDoor([0, 0], gapForm));
  }
}

console.log('doors.test — D2 resolvePaneConfig (frame/pane split target selection)');
{
  check('no asset → null', resolvePaneConfig(undefined) === null);
  check('no door block → null', resolvePaneConfig(asset()) === null);
  check('door block without pane fields → null', resolvePaneConfig(asset({ door: { hingeOffset: [-0.5, 0] } })) === null);

  const nodeOnly = resolvePaneConfig(asset({ door: { hingeOffset: [-0.5, 0], paneNode: 'Door_Pane' } }))!;
  check('paneNode resolves', nodeOnly.paneNode === 'Door_Pane' && nodeOnly.paneMesh === undefined);

  const meshOnly = resolvePaneConfig(asset({ door: { hingeOffset: [-0.5, 0], paneMesh: 'models/pane.glb' } }))!;
  check('paneMesh resolves', meshOnly.paneMesh === 'models/pane.glb' && meshOnly.paneNode === undefined);

  const both = resolvePaneConfig(asset({ door: { hingeOffset: [-0.5, 0], paneNode: 'Pane', paneMesh: 'models/pane.glb' } }))!;
  check('paneNode wins when both set (single-GLB path is cheaper)', both.paneNode === 'Pane' && both.paneMesh === undefined);

  check('blank paneNode treated as absent', resolvePaneConfig(asset({ door: { hingeOffset: [-0.5, 0], paneNode: '   ' } })) === null);
  check('blank paneMesh treated as absent', resolvePaneConfig(asset({ door: { hingeOffset: [-0.5, 0], paneMesh: '' } })) === null);
}

console.log('doors.test — D2 paneHingeLocal / paneLocalOffsetFromHinge (hinge from the pane bounds)');
{
  // A 1m-wide pane spanning local X ∈ [-0.5, 0.5], thickness Z ∈ [-0.05, 0.05], centered on origin.
  const centered: PaneBounds = { minX: -0.5, maxX: 0.5, minZ: -0.05, maxZ: 0.05 };
  const left = paneHingeLocal(centered, [-0.5, 0]);
  check('negative hingeOffset[0] → hinge on the pane -X (min) edge', approx(left[0], -0.5) && approx(left[1], 0), String(left));
  const right = paneHingeLocal(centered, [0.5, 0]);
  check('positive hingeOffset[0] → hinge on the pane +X (max) edge', approx(right[0], 0.5) && approx(right[1], 0), String(right));
  const zero = paneHingeLocal(centered, [0, 0]);
  check('zero hingeOffset[0] defaults to the -X (left) edge', approx(zero[0], -0.5), String(zero));

  // Hinge sits at the pane's thickness center regardless of authored hingeOffset[1].
  const offZ: PaneBounds = { minX: -0.5, maxX: 0.5, minZ: 0, maxZ: 0.1 };
  check('hinge Z is the pane thickness center', approx(paneHingeLocal(offZ, [-0.5, 0.7])[1], 0.05));

  // Composition invariant: hinge + offset-from-hinge == the pane's real center, for ANY bounds/side.
  const offset = paneLocalOffsetFromHinge(centered, [-0.5, 0]);
  check('centered pane: closed-pane center reproduced (hinge+offset == center 0,0)',
    approx(left[0] + offset[0], 0) && approx(left[1] + offset[1], 0), String(offset));

  // An OFF-CENTER pane (its geometry doesn't straddle the model origin): the hinge follows the real
  // edge, and the composition still lands on the pane's true center — the whole point of deriving
  // the hinge from bounds rather than the asset center.
  const offCenter: PaneBounds = { minX: 0.2, maxX: 1.2, minZ: -0.05, maxZ: 0.05 };
  const h = paneHingeLocal(offCenter, [-0.5, 0]);
  const o = paneLocalOffsetFromHinge(offCenter, [-0.5, 0]);
  check('off-center pane: hinge on real min edge', approx(h[0], 0.2), String(h));
  check('off-center pane: hinge+offset == real center (0.7, 0)', approx(h[0] + o[0], 0.7) && approx(h[1] + o[1], 0), String(o));
}

console.log('doors.test — explicit exterior transit opens, passes, closes, and interrupts safely');
{
  const transit = new DoorTransitMachine();
  check('transit begins in opening state', transit.begin() && transit.phase === 'opening' && transit.targetOpen);
  check('a second transit cannot overlap', !transit.begin());
  check('not-yet-open door does not release the passer', !transit.update(false, true, false).passNow);
  const opened = transit.update(true, false, false);
  check('fully open door releases the passer exactly at the pass seam', opened.passNow && transit.phase === 'passing');
  const closing = transit.update(true, false, true);
  check('completed passage targets closing', !closing.targetOpen && transit.phase === 'closing');
  check('door remains occupied until fully closed', !transit.update(false, false, true).closedNow);
  check('fully closed door completes and becomes reusable', transit.update(false, true, true).closedNow && !transit.active && transit.begin());
  check('interruption always changes the target to closing', transit.interrupt() && transit.phase === 'closing' && !transit.targetOpen);
  check('interrupted transit ends idle only once the door is closed', transit.update(false, true, false).closedNow && transit.phase === 'idle');
}

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall doors tests passed');
