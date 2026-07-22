import { carryAnchorPosition, hasCarryRotationLock, resolveLockedCarryEuler, rotateVec3XYZ } from '../game/carry';

let failures = 0;
function eq(name: string, actual: unknown, expected: unknown) {
  const rounded = (value: unknown): unknown => Array.isArray(value)
    ? value.map((entry) => typeof entry === 'number' ? Number(entry.toFixed(6)) : entry)
    : value;
  if (JSON.stringify(rounded(actual)) === JSON.stringify(rounded(expected))) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
}

console.log('carry.test - handle anchoring and world-axis locks');
eq('zero handle leaves authored offset unchanged', carryAnchorPosition([0, 0, 0], [1, 2, 3], [0, 0, 0], 2), [1, 2, 3]);
eq('handle is subtracted so it lands on the bone', carryAnchorPosition([0, 0.5, 0], [0, 0, 0], [0, 0, 0], 2), [0, -1, 0]);
eq('handle rotation participates in anchoring', carryAnchorPosition([1, 0, 0], [0, 0, 0], [0, 0, 90], 1), [0, -1, 0]);
eq('XYZ vector rotation matches expected quarter turn', rotateVec3XYZ([0, 1, 0], [90, 0, 0]), [0, 0, 1]);
eq('combined XYZ rotation matches three.js Euler order', rotateVec3XYZ([1, 2, 3], [90, 90, 90]), [3, -2, 1]);
eq('selected axes keep stable values while others follow', resolveLockedCarryEuler([1, 2, 3], [10, 20, 30], { x: true, z: true }), [10, 2, 30]);
eq('absent locks follow every bone axis', resolveLockedCarryEuler([1, 2, 3], [10, 20, 30], undefined), [1, 2, 3]);
eq('lock detector ignores sparse false values', hasCarryRotationLock({ x: false, y: false }), false);
eq('lock detector accepts any true axis', hasCarryRotationLock({ z: true }), true);

if (failures) process.exit(1);
console.log('\nall carry tests passed');
