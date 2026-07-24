import { DEFAULT_WALL_VIEW_MODE, nextWallViewMode, wallCutShownHeight, wallIsCameraSide, wallShouldCut } from '../game/wallview';

let failures = 0;
function check(name: string, actual: number, expected: number) {
  if (actual === expected) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name}: expected ${expected}, got ${actual}`); }
}
function checkBool(name: string, actual: boolean, expected: boolean) { check(name, Number(actual), Number(expected)); }

console.log('wallview.test - wall-cut height resolution');
checkBool('default view starts as Cut front', DEFAULT_WALL_VIEW_MODE === 'cutaway', true);
check('full view preserves normal height', wallCutShownHeight(false, 1, 2.5), 2.5);
check('cut view uses authored height', wallCutShownHeight(true, 1, 2.5), 1);
check('cut cannot extend a short visual', wallCutShownHeight(true, 3, 2.1), 2.1);
check('invalid tuning falls back to 1m', wallCutShownHeight(true, Number.NaN, 2.5), 1);
check('non-positive tuning retains a visible curb', wallCutShownHeight(true, 0, 2.5), 0.1);
checkBool('full mode never cuts', wallShouldCut('full', [9, 5], [12, 5], [5, 5]), false);
checkBool('cut mode cuts every wall', wallShouldCut('cut', [1, 5]), true);
checkBool('camera-side wall is in front', wallIsCameraSide([9, 5], [12, 5], [5, 5]), true);
checkBool('far wall remains full in cutaway', wallShouldCut('cutaway', [1, 5], [12, 5], [5, 5]), false);
checkBool('near wall cuts in cutaway', wallShouldCut('cutaway', [9, 5], [12, 5], [5, 5]), true);
checkBool('cutaway without camera context is safe/full', wallShouldCut('cutaway', [9, 5]), false);
checkBool('cycle full to cut', nextWallViewMode('full') === 'cut', true);
checkBool('cycle cut to cutaway', nextWallViewMode('cut') === 'cutaway', true);
checkBool('cycle cutaway to full', nextWallViewMode('cutaway') === 'full', true);

if (failures) process.exit(1);
console.log('\nall wallview tests passed');
