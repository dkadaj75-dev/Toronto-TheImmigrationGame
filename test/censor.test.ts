// censor.test.ts — game/censor.ts's pure logic (ROADMAP_NEXT B2-3). No THREE/canvas dependency,
// same split as marker.test.ts. Run: npx tsx test/censor.test.ts
import { censorAnchorHeight, shouldRegenMosaic, TORSO_HEIGHT_RATIO, MOSAIC_REGEN_INTERVAL_SECONDS, CENSOR_WIDTH, CENSOR_HEIGHT } from '../game/censor';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name} ${detail}`); }
}
function approx(a: number, b: number, eps = 1e-6) { return Math.abs(a - b) <= eps; }

console.log('censor.test — censorAnchorHeight');
{
  check('anchor is heightMeters * TORSO_HEIGHT_RATIO', approx(censorAnchorHeight(1.55), 1.55 * TORSO_HEIGHT_RATIO));
  check('zero height stays zero (no NaN)', approx(censorAnchorHeight(0), 0));
  check('falsy/undefined-ish height falls back to 0 (0 || 0)', approx(censorAnchorHeight(0), 0));
}

console.log('censor.test — shouldRegenMosaic cadence');
{
  check('below interval: no regen', !shouldRegenMosaic(0.1, 1 / 6));
  check('at interval: regen', shouldRegenMosaic(1 / 6, 1 / 6));
  check('past interval: regen', shouldRegenMosaic(0.5, 1 / 6));
  check('default interval constant used when omitted', shouldRegenMosaic(MOSAIC_REGEN_INTERVAL_SECONDS));
}

console.log('censor.test — quad size sanity (design brief: ~0.8x1.0m)');
{
  check('width is 0.8', approx(CENSOR_WIDTH, 0.8));
  check('height is 1.0', approx(CENSOR_HEIGHT, 1.0));
}

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall censor tests passed');
