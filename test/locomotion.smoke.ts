// locomotion smoke: SimAgent fires onLocomotionChange(true) on departure, (false) on arrival,
// and the sit pose honors tuning.character heights. Run: npx tsx test/locomotion.smoke.ts
import * as THREE from 'three';
import { bakeNavGrid } from '../game/nav';
import { SimAgent } from '../game/sim';
import type { MapData, TuningData } from '../game/data';

const map: MapData = {
  id: 't', name: 't', gridSize: 0.5, bounds: { w: 6, h: 6 },
  floors: [{ id: 'f', polygon: [[0, 0], [6, 0], [6, 6], [0, 6]], material: 'wood' }],
  walls: [], doors: [], spawn: { pos: [1, 1], facingDeg: 0 }, placedObjects: [],
};
const tuning = {
  simulation: { needsDecayTickSeconds: 1, activityGainTickSeconds: 2 },
  autonomy: { seekBelowThreshold: 30, stopAtThreshold: 95, postPlayerCommandCooldownSeconds: 10 },
  time: { secondsPerGameDay: 60, nightStartHour: 22, nightEndHour: 6 },
  economy: { startingFunds: 0, currencyName: '§' },
  movement: { walkSpeed: 2, arrivalRadius: 0.35 },
  camera: { minZoom: 4, maxZoom: 18, minPitchDeg: 30, maxPitchDeg: 70, panBoundsPadding: 2 },
  quests: { toastDurationSeconds: 4, completedLogLimit: 5 },
  character: { meshPath: '', heightMeters: 1.55, crossFadeSeconds: 0.25, walkClipSpeedReference: 2, sitHeight: 0.4, lieHeight: 0.7, clipMap: {} },
} satisfies TuningData;

const grid = bakeNavGrid(map);
const obj = new THREE.Group();
obj.position.set(1, 0, 1);
const agent = new SimAgent(obj, grid, tuning);
const events: boolean[] = [];
agent.onLocomotionChange = (m) => events.push(m);

if (!agent.goTo(4.5, 4.5)) { console.error('FAIL no path'); process.exit(1); }
for (let i = 0; i < 300 && (agent.isMoving || events.length < 2); i++) agent.update(1 / 30);

const ok1 = events[0] === true && events[events.length - 1] === false && events.length === 2;
console.log(ok1 ? '  ok  locomotion fires true→false exactly once each' : `FAIL events=${JSON.stringify(events)}`);

// sit pose height from tuning.character
const target = new THREE.Group(); target.position.set(2, 0, 2);
const agent2 = new SimAgent(obj, grid, tuning);
agent2.orderAction({ id: 'sit', name: 'Sit', needGains: {}, skillGains: {}, animation: 'sit', autonomyEligible: false, primaryNeed: null }, target, target /* seat */);
for (let i = 0; i < 300 && !agent2.current; i++) agent2.update(1 / 30);
const ok2 = !!agent2.current && Math.abs(obj.position.y - 0.4) < 1e-6;
console.log(ok2 ? '  ok  sit height from tuning.character (0.4)' : `FAIL y=${obj.position.y} current=${!!agent2.current}`);

// usePoseFor path: a target WITH an AssetDef on record (roadmap item 1 fix) perches at the
// asset's footprint center + usePose override, not just the raw tuning height — and a plain
// "sit" on a non-seat-aware target (no explicit seat passed) now perches too, since applyPose
// defaults `perch` to `a.target` (previously it silently no-op'd for this exact case).
const bed = new THREE.Group();
bed.position.set(3, 0, 3);
bed.rotation.y = 0;
bed.userData.assetId = 'bed';
const assetsById = new Map<string, import('../game/data').AssetDef>([
  ['bed', { id: 'bed', name: 'Bed', category: 'beds', mesh: '', buyPrice: 0, sellPrice: 0, environmentScore: 0, footprint: [2, 3], interactions: ['sleep'], usePose: { lie: { y: 0.56 } } }],
]);
const agent3 = new SimAgent(obj, grid, tuning, assetsById);
agent3.orderAction({ id: 'sleep', name: 'Sleep', needGains: {}, skillGains: {}, animation: 'lie_sleep', autonomyEligible: false, primaryNeed: null }, bed);
for (let i = 0; i < 300 && !agent3.current; i++) agent3.update(1 / 30);
const ok3 = !!agent3.current
  && Math.abs(obj.position.x - 3) < 1e-6 && Math.abs(obj.position.z - 3) < 1e-6 && Math.abs(obj.position.y - 0.56) < 1e-6;
console.log(ok3 ? '  ok  lie perch snaps onto the bed via usePoseFor (roadmap item 1)' : `FAIL pos=${obj.position.x},${obj.position.y},${obj.position.z} current=${!!agent3.current}`);

// ROADMAP_NEXT B2-3: a STANDING action ("stand_use") on an asset with an explicit usePose.use
// snaps INSIDE the asset (shower) instead of staying at the walk-up approach spot. Fresh sim
// object (not reusing `obj`'s end-of-test position) to keep this case independent of ordering.
const obj4 = new THREE.Group();
obj4.position.set(1, 0, 1);
const shower = new THREE.Group();
shower.position.set(3, 0, 2);
shower.rotation.y = 0;
shower.userData.assetId = 'shower';
const assetsById2 = new Map<string, import('../game/data').AssetDef>([
  ['shower', { id: 'shower', name: 'Shower', category: 'plumbing', mesh: '', buyPrice: 0, sellPrice: 0, environmentScore: 0, footprint: [1, 1], interactions: ['shower'], usePose: { use: { offset: [0, 0] } } }],
]);
const agent4 = new SimAgent(obj4, grid, tuning, assetsById2);
agent4.orderAction({ id: 'shower', name: 'Shower', needGains: {}, skillGains: {}, animation: 'stand_use', autonomyEligible: false, primaryNeed: null }, shower);
for (let i = 0; i < 300 && !agent4.current; i++) agent4.update(1 / 30);
const ok4 = !!agent4.current
  && Math.abs(obj4.position.x - 3) < 1e-6 && Math.abs(obj4.position.z - 2) < 1e-6 && Math.abs(obj4.position.y - 0) < 1e-6;
console.log(ok4 ? '  ok  stand-use perch snaps inside the shower via usePoseFor (B2-3)' : `FAIL pos=${obj4.position.x},${obj4.position.y},${obj4.position.z} current=${!!agent4.current}`);

// a generic standing action with NO usePose.use on its asset keeps the approach spot (outside
// the footprint edge, per useSpotFor) instead of snapping to the footprint center.
const obj5 = new THREE.Group();
obj5.position.set(1, 0, 1);
const stove = new THREE.Group();
stove.position.set(2, 0, 3);
stove.rotation.y = 0;
stove.userData.assetId = 'stove';
const assetsById3 = new Map<string, import('../game/data').AssetDef>([
  ['stove', { id: 'stove', name: 'Stove', category: 'appliances', mesh: '', buyPrice: 0, sellPrice: 0, environmentScore: 0, footprint: [1, 1], interactions: ['cook'] }],
]);
const agent5 = new SimAgent(obj5, grid, tuning, assetsById3);
agent5.orderAction({ id: 'cook', name: 'Cook', needGains: {}, skillGains: {}, animation: 'stand_use', autonomyEligible: false, primaryNeed: null }, stove, null, assetsById3.get('stove'));
for (let i = 0; i < 300 && !agent5.current; i++) agent5.update(1 / 30);
const ok5 = !!agent5.current && !(Math.abs(obj5.position.x - 2) < 1e-6 && Math.abs(obj5.position.z - 3) < 1e-6);
console.log(ok5 ? '  ok  stand action with no usePose.use keeps the approach spot, not the footprint center' : `FAIL pos=${obj5.position.x},${obj5.position.y},${obj5.position.z} current=${!!agent5.current}`);

// ROADMAP_NEXT B3-4: stopAction's `completed` flag threads through to onActionStop exactly as
// passed — default (no arg / cancel paths like goTo/orderAction-override/teleportTo) is `false`;
// an explicit `stopAction(true)` (main.ts's two natural-finish call sites) is reported as `true`.
const obj6 = new THREE.Group();
obj6.position.set(1, 0, 1);
const target6 = new THREE.Group(); target6.position.set(2, 0, 2);
const agent6 = new SimAgent(obj6, grid, tuning);
const stops: boolean[] = [];
agent6.onActionStop = (_a, completed) => stops.push(completed);
agent6.orderAction({ id: 'sit', name: 'Sit', needGains: {}, skillGains: {}, animation: 'sit', autonomyEligible: false, primaryNeed: null }, target6, target6);
for (let i = 0; i < 300 && !agent6.current; i++) agent6.update(1 / 30);
agent6.stopAction(); // default — a cancel
agent6.orderAction({ id: 'sit', name: 'Sit', needGains: {}, skillGains: {}, animation: 'sit', autonomyEligible: false, primaryNeed: null }, target6, target6);
for (let i = 0; i < 300 && !agent6.current; i++) agent6.update(1 / 30);
agent6.stopAction(true); // explicit completion
const ok6 = stops.length === 2 && stops[0] === false && stops[1] === true;
console.log(ok6 ? '  ok  stopAction threads completed=false (default/cancel) and completed=true (explicit) to onActionStop' : `FAIL stops=${JSON.stringify(stops)}`);

// goTo/orderAction's own internal stopAction() (overriding an in-progress action) is also a
// cancel — never reported as completed, even though it's stopping a DIFFERENT action than the one
// being newly ordered.
const obj7 = new THREE.Group();
obj7.position.set(1, 0, 1);
const target7 = new THREE.Group(); target7.position.set(2, 0, 2);
const agent7 = new SimAgent(obj7, grid, tuning);
const stops7: boolean[] = [];
agent7.onActionStop = (_a, completed) => stops7.push(completed);
agent7.orderAction({ id: 'sit', name: 'Sit', needGains: {}, skillGains: {}, animation: 'sit', autonomyEligible: false, primaryNeed: null }, target7, target7);
for (let i = 0; i < 300 && !agent7.current; i++) agent7.update(1 / 30);
agent7.goTo(1, 1); // interrupts the in-progress sit — a cancel, not a completion
const ok7 = stops7.length === 1 && stops7[0] === false;
console.log(ok7 ? '  ok  goTo interrupting an in-progress action reports completed=false' : `FAIL stops7=${JSON.stringify(stops7)}`);

if (!ok1 || !ok2 || !ok3 || !ok4 || !ok5 || !ok6 || !ok7) process.exit(1);
console.log('locomotion smoke passed');
