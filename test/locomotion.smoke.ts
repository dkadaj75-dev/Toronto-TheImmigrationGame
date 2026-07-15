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

if (!ok1 || !ok2 || !ok3) process.exit(1);
console.log('locomotion smoke passed');
