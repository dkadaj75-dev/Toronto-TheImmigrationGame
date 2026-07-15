// progressbar.test.ts — game/progressbar.ts pure logic (ROADMAP_NEXT B2-5 progress bar slice).
// Covers anchor height and progress clamping. The three.js layer (createProgressBarInstance) is
// browser-only, not headless-testable — same precedent as marker.ts's createMarkerInstance /
// censor.ts's createCensorInstance (see those modules' doc comments).
// Run: npx tsx test/progressbar.test.ts
import { PROGRESS_BAR_DEFAULTS, progressBarAnchorHeight, clampProgress01 } from '../game/progressbar';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name} ${detail}`); }
}

console.log('progressbar.test — PROGRESS_BAR_DEFAULTS');
{
  check('yOffset (0.15) is smaller than the overhead marker\'s default yOffset (0.35) — the bar sits below the marker',
    PROGRESS_BAR_DEFAULTS.yOffset < 0.35, String(PROGRESS_BAR_DEFAULTS.yOffset));
  check('positive width/height', PROGRESS_BAR_DEFAULTS.widthMeters > 0 && PROGRESS_BAR_DEFAULTS.heightMeters > 0);
}

console.log('progressbar.test — progressBarAnchorHeight');
{
  check('adds height + yOffset', progressBarAnchorHeight(1.55, 0.15) === 1.7);
  check('zero yOffset → just height', progressBarAnchorHeight(1.7, 0) === 1.7);
  check('zero height (no character block) → just yOffset', progressBarAnchorHeight(0, 0.15) === 0.15);
  check('sits below the default marker anchor (1.55 + 0.35 = 1.9)', progressBarAnchorHeight(1.55, PROGRESS_BAR_DEFAULTS.yOffset) < 1.9);
}

console.log('progressbar.test — clampProgress01');
{
  check('mid-range passes through unchanged', clampProgress01(0.42) === 0.42);
  check('0 stays 0', clampProgress01(0) === 0);
  check('1 stays 1', clampProgress01(1) === 1);
  check('negative clamps to 0', clampProgress01(-0.3) === 0);
  check('above 1 clamps to 1', clampProgress01(1.7) === 1);
  check('exactly-at-completion elapsed/total (1.0) clamps to 1, not overshoot', clampProgress01(60 / 60) === 1);
  check('a stray past-completion frame (elapsed slightly > total) still clamps to 1', clampProgress01(60.5 / 60) === 1);
}

if (failures > 0) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
console.log('\nALL PROGRESSBAR TESTS PASSED');
