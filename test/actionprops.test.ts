import * as THREE from 'three';
import { CarriedPropController, type TransientPropHost } from '../game/actionprops';
import type { ActionDef, AssetDef } from '../game/data';
import type { ActiveAction } from '../game/sim';

let failures = 0;
function check(name: string, condition: boolean) {
  if (condition) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name}`); }
}
function approx(a: number, b: number, eps = 1e-6) { return Math.abs(a - b) <= eps; }

console.log('actionprops.test — one carried-prop lifecycle');
const world = new THREE.Group();
const sim = new THREE.Group();
const rig = new THREE.Group(); rig.scale.setScalar(0.01); sim.add(rig);
const hand = new THREE.Bone(); hand.name = 'mixamorig2:RightHand'; rig.add(hand);
const book = {
  id: 'book', name: 'Book', category: 'transient', footprint: [0.2, 0.2], buyPrice: 0, sellPrice: 0,
  interactions: ['read'], carryHandle: [0.05, 0, -0.1],
} as unknown as AssetDef;
const assets = new Map([[book.id, book]]);
const groups = new Map<string, THREE.Object3D>();
let seq = 0;
let placedKey: string | null = null;
let despawnedKey: string | null = null;
const transients: TransientPropHost = {
  spawnTransient(assetId) {
    const key = `${assetId}#${seq++}`;
    const group = new THREE.Group(); group.userData = { assetId, accidentKey: key };
    groups.set(key, group); world.add(group); return { key };
  },
  groupFor: (key) => groups.get(key) ?? null,
  despawnTransient(key) { despawnedKey = key; groups.get(key)?.parent?.remove(groups.get(key)!); groups.delete(key); },
  setTransientPlacement(key, pos, visible) {
    const group = groups.get(key); if (!group) return false;
    group.position.set(pos[0], 0, pos[1]); group.rotation.set(0, 0, 0); group.visible = visible; placedKey = key; return true;
  },
};
const controller = new CarriedPropController({
  sim, getWorld: () => world, assetById: (id) => assets.get(id), transients, nowSeconds: () => 12,
});
const read = {
  id: 'read', name: 'Read', animation: 'Reading', autonomyEligible: true, primaryNeed: 'fun',
  needGains: { fun: 1 }, skillGains: {}, carriedAsset: { assetId: 'book', bone: 'mixamorigRightHand' },
} as unknown as ActionDef;
const shelf = new THREE.Group(); shelf.userData = { assetId: 'bookshelf' };
const first = { action: read, target: shelf, seat: null } as ActiveAction;
controller.start(first);
const firstKey = controller.activeKey!;
const firstGroup = groups.get(firstKey)!;
world.updateMatrixWorld(true); sim.updateMatrixWorld(true);
check('ordinary action spawns exactly one disposable prop', seq === 1 && !!firstGroup);
check('numbered Mixamo bone is resolved by the shared controller', firstGroup.parent === hand);
const worldScale = firstGroup.getWorldScale(new THREE.Vector3());
check('controller preserves authored world size below a normalized rig', approx(worldScale.x, 1));
controller.stop(first, false);
check('interruption drops the owned prop through the transient host', placedKey === firstKey && firstGroup.parent === world);

const libraryRead = {
  ...read,
  id: 'library_read',
  carriedAsset: { ...read.carriedAsset!, dropOnInterrupt: false },
} as ActionDef;
const temporary = { action: libraryRead, target: shelf, seat: null } as ActiveAction;
despawnedKey = null;
controller.start(temporary);
const temporaryKey = controller.activeKey!;
controller.stop(temporary, false);
check('an interrupted temporary source prop is removed instead of dropped', despawnedKey === temporaryKey && !groups.has(temporaryKey));

const existingKey = 'book#existing';
const existing = new THREE.Group(); existing.userData = { assetId: 'book', accidentKey: existingKey };
groups.set(existingKey, existing); world.add(existing);
const resume = { action: read, target: existing, seat: null } as ActiveAction;
controller.start(resume);
check('matching transient target is adopted rather than duplicated', controller.activeKey === existingKey && seq === 2);
controller.stop(resume, true);
check('completion removes the exact adopted target', despawnedKey === existingKey && !groups.has(existingKey));

if (failures) process.exit(1);
console.log('\nall actionprops tests passed');
