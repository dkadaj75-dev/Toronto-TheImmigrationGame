import { carryAnchorPosition, carryBoneTransform, hasCarryRotationLock, normalizeCarryBoneName, resolveLockedCarryEuler, rotateVec3XYZ } from '../game/carry';
import * as THREE from 'three';

let failures = 0;
function eq(name: string, actual: unknown, expected: unknown) {
  const rounded = (value: unknown): unknown => Array.isArray(value)
    ? value.map((entry) => typeof entry === 'number' ? Number(entry.toFixed(6)) : entry)
    : value;
  if (JSON.stringify(rounded(actual)) === JSON.stringify(rounded(expected))) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
}

console.log('carry.test - handle anchoring and world-axis locks');
eq('unnumbered Mixamo hand bone normalizes', normalizeCarryBoneName('mixamorigRightHand'), 'righthand');
eq('colon-separated Mixamo hand bone normalizes', normalizeCarryBoneName('mixamorig:RightHand'), 'righthand');
eq('numbered Mixamo hand bone normalizes', normalizeCarryBoneName('mixamorig2:RightHand'), 'righthand');
eq('plain rig hand bone normalizes to the same key', normalizeCarryBoneName('RightHand'), 'righthand');
eq('zero handle leaves authored offset unchanged', carryAnchorPosition([0, 0, 0], [1, 2, 3], [0, 0, 0], 2), [1, 2, 3]);
eq('handle is subtracted so it lands on the bone', carryAnchorPosition([0, 0.5, 0], [0, 0, 0], [0, 0, 0], 2), [0, -1, 0]);
eq('handle rotation participates in anchoring', carryAnchorPosition([1, 0, 0], [0, 0, 0], [0, 0, 90], 1), [0, -1, 0]);
const scaledRigCarry = carryBoneTransform([0, 0, -0.127], [0, 0.06, 0], [0, 0, 0], 1, [0.01, 0.01, 0.01]);
eq('scaled rig is inversely compensated so carried prop keeps world size', scaledRigCarry.scale, [100, 100, 100]);
eq('scaled rig compensates authored metre offset and handle', scaledRigCarry.position, [0, 6, 12.7]);
eq('compensated handle still lands at the authored world offset', [
  (scaledRigCarry.position[0] + 0 * scaledRigCarry.scale[0]) * 0.01,
  (scaledRigCarry.position[1] + 0 * scaledRigCarry.scale[1]) * 0.01,
  (scaledRigCarry.position[2] - 0.127 * scaledRigCarry.scale[2]) * 0.01,
], [0, 0.06, 0]);
const carryWorld = new THREE.Group();
const scaledRig = new THREE.Group();
scaledRig.scale.setScalar(0.01);
carryWorld.add(scaledRig);
const scaledBone = new THREE.Bone();
scaledRig.add(scaledBone);
const carriedProp = new THREE.Group();
scaledBone.add(carriedProp);
carriedProp.position.fromArray(scaledRigCarry.position);
carriedProp.scale.fromArray(scaledRigCarry.scale);
carryWorld.updateMatrixWorld(true);
const carriedWorldScale = carriedProp.getWorldScale(new THREE.Vector3());
eq('live scene graph gives carried prop its authored world size', carriedWorldScale.toArray(), [1, 1, 1]);
carryWorld.attach(carriedProp);
carryWorld.updateMatrixWorld(true);
const placedWorldScale = carriedProp.getWorldScale(new THREE.Vector3());
eq('detaching carried prop to a table preserves visible world size', placedWorldScale.toArray(), [1, 1, 1]);
eq('XYZ vector rotation matches expected quarter turn', rotateVec3XYZ([0, 1, 0], [90, 0, 0]), [0, 0, 1]);
eq('combined XYZ rotation matches three.js Euler order', rotateVec3XYZ([1, 2, 3], [90, 90, 90]), [3, -2, 1]);
eq('selected axes keep stable values while others follow', resolveLockedCarryEuler([1, 2, 3], [10, 20, 30], { x: true, z: true }), [10, 2, 30]);
eq('absent locks follow every bone axis', resolveLockedCarryEuler([1, 2, 3], [10, 20, 30], undefined), [1, 2, 3]);
eq('lock detector ignores sparse false values', hasCarryRotationLock({ x: false, y: false }), false);
eq('lock detector accepts any true axis', hasCarryRotationLock({ z: true }), true);

if (failures) process.exit(1);
console.log('\nall carry tests passed');
