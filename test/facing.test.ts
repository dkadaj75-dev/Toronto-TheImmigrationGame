// facing.test.ts — game/facing.ts pure logic (PROJECT_CONTEXT.md §7.2 as-built).
// Run: npx tsx test/facing.test.ts
import { worldFacingDeg, facingVector, useSpotFor, isInFrontHalfSpace, viewingPointFor, mutualFacingDeg, type FacingInstance } from '../game/facing';
import type { AssetDef, TuningData } from '../game/data';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name} ${detail}`); }
}
function approx(a: number, b: number, eps = 1e-6) { return Math.abs(a - b) <= eps; }

const tuning = {
  interaction: { useSpotClearance: 0.4, seatViewDistance: 2.5 },
} as TuningData;

function asset(partial: Partial<AssetDef> = {}): AssetDef {
  return {
    id: 'a', name: 'A', category: 'misc', mesh: '', buyPrice: 0, sellPrice: 0, environmentScore: 0,
    footprint: [1, 1], interactions: [],
    ...partial,
  };
}

console.log('facing.test — worldFacingDeg');
{
  check('absent facingDeg defaults to 0', worldFacingDeg({ pos: [0, 0], rotDeg: 90 }, asset()) === 90);
  check('adds facingDeg', worldFacingDeg({ pos: [0, 0], rotDeg: 90 }, asset({ facingDeg: 45 })) === 135);
  check('normalizes negative', worldFacingDeg({ pos: [0, 0], rotDeg: -90 }, asset()) === 270);
  check('normalizes over 360', worldFacingDeg({ pos: [0, 0], rotDeg: 270 }, asset({ facingDeg: 180 })) === 90);
}

console.log('facing.test — facingVector (rotation.y=0 → +Z, matching sim.ts/world.ts)');
{
  let [x, z] = facingVector(0); check('0° → +Z', approx(x, 0) && approx(z, 1), `${x},${z}`);
  [x, z] = facingVector(90); check('90° → +X', approx(x, 1) && approx(z, 0), `${x},${z}`);
  [x, z] = facingVector(180); check('180° → -Z', approx(x, 0) && approx(z, -1), `${x},${z}`);
  [x, z] = facingVector(270); check('270° → -X', approx(x, -1) && approx(z, 0), `${x},${z}`);
}

console.log('facing.test — mutual Sim facing');
{
  const [a, b] = mutualFacingDeg([1, 1], [3, 1]);
  check('first Sim faces +X toward second', approx(a, 90), `${a}`);
  check('second Sim faces -X toward first', approx(b, 270), `${b}`);
}

console.log('facing.test — useSpotFor (footprint edge along facing + clearance)');
{
  const fridge = asset({ footprint: [1, 1] });
  const inst: FacingInstance = { pos: [10, 10], rotDeg: 0 };
  // facingDeg 0, rot 0 → faces +Z: stand point is south of the fridge (halfD=0.5 + clearance 0.4)
  let [sx, sz] = useSpotFor(inst, fridge, tuning);
  check('stand point south of fridge (facing +Z)', approx(sx, 10) && approx(sz, 10.9), `${sx},${sz}`);

  // rot 90 with a rectangular footprint: [2,1] swaps to effective [1,2] at 90°, facing +X
  const rectAsset = asset({ footprint: [2, 1] });
  const inst90: FacingInstance = { pos: [0, 0], rotDeg: 90 };
  [sx, sz] = useSpotFor(inst90, rectAsset, tuning);
  // swapped half-extents: halfW=0.5, halfD=1 (post-swap [1,2]) but dir is pure +X so only halfW-along-X matters
  check('rot-90 footprint swap + facing +X', approx(sx, 0.5 + 0.4) && approx(sz, 0), `${sx},${sz}`);

  // an asset with its own facingDeg offset from its placement rotation
  const skewed = asset({ footprint: [1, 1], facingDeg: 90 });
  const instSkew: FacingInstance = { pos: [5, 5], rotDeg: 0 };
  [sx, sz] = useSpotFor(instSkew, skewed, tuning);
  check('facingDeg alone redirects the stand point (+X, not +Z)', approx(sx, 5.9) && approx(sz, 5), `${sx},${sz}`);

  // clearance is read from tuning.interaction.useSpotClearance
  const tightTuning = { interaction: { useSpotClearance: 1.0 } } as TuningData;
  [sx, sz] = useSpotFor(inst, fridge, tightTuning);
  check('clearance is tuning-driven', approx(sz, 10 + 0.5 + 1.0), `${sz}`);

  // missing tuning.interaction falls back sanely (mirrors character?.sitHeight ?? default)
  const bareTuning = {} as TuningData;
  [sx, sz] = useSpotFor(inst, fridge, bareTuning);
  check('missing tuning.interaction falls back to a default clearance', approx(sz, 10.9), `${sz}`);
}

console.log('facing.test — isInFrontHalfSpace + viewingPointFor (seat-in-front-of-TV screen)');
{
  // TV at (1.5,3) rot180 facing -Z (toward the sofa at z=0.5) — the shipped condo.json numbers
  const tv = asset({ facingDeg: 0 });
  const tvInst: FacingInstance = { pos: [1.5, 3], rotDeg: 180 };
  check('sofa (z=0.5) is in front of the TV', isInFrontHalfSpace([1.5, 0.5], tvInst, tv) === true);
  check('dining chair (z=3.5) behind the TV is excluded', isInFrontHalfSpace([7.5, 3.5], tvInst, tv) === false);

  const [vx, vz] = viewingPointFor(tvInst, tv, tuning);
  check('viewing point sits seatViewDistance in front of the TV', approx(vx, 1.5) && approx(vz, 3 - 2.5), `${vx},${vz}`);

  // ranking: sofa should be nearer the viewing point than an off-axis armchair
  const sofaPos: [number, number] = [1.5, 0.5];
  const armchairPos: [number, number] = [4.5, 1.5];
  const dSofa = Math.hypot(sofaPos[0] - vx, sofaPos[1] - vz);
  const dArmchair = Math.hypot(armchairPos[0] - vx, armchairPos[1] - vz);
  check('sofa ranks closer to the viewing point than the off-axis armchair', dSofa < dArmchair, `${dSofa} vs ${dArmchair}`);
}

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall facing tests passed');
