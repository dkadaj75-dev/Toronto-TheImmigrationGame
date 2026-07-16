import { wallCutShownHeight } from '../game/wallview';

let failures = 0;
function check(name: string, actual: number, expected: number) {
  if (actual === expected) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name}: expected ${expected}, got ${actual}`); }
}

console.log('wallview.test - wall-cut height resolution');
check('full view preserves normal height', wallCutShownHeight(false, 1, 2.5), 2.5);
check('cut view uses authored height', wallCutShownHeight(true, 1, 2.5), 1);
check('cut cannot extend a short visual', wallCutShownHeight(true, 3, 2.1), 2.1);
check('invalid tuning falls back to 1m', wallCutShownHeight(true, Number.NaN, 2.5), 1);
check('non-positive tuning retains a visible curb', wallCutShownHeight(true, 0, 2.5), 0.1);

if (failures) process.exit(1);
console.log('\nall wallview tests passed');
