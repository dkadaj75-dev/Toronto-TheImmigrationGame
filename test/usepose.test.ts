// usepose.test.ts — game/facing.ts's usePoseFor (AssetDef.usePose, PROJECT_CONTEXT.md §7.8,
// roadmap item 1 fix). Run: npx tsx test/usepose.test.ts
import { usePoseFor, type FacingInstance } from '../game/facing';
import type { AssetDef, TuningData } from '../game/data';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name} ${detail}`); }
}
function approx(a: number, b: number, eps = 1e-6) { return Math.abs(a - b) <= eps; }

const tuning = {
  character: { meshPath: '', heightMeters: 1.55, crossFadeSeconds: 0.25, walkClipSpeedReference: 2, sitHeight: 0.25, lieHeight: 0.55, clipMap: {} },
} as TuningData;

function asset(partial: Partial<AssetDef> = {}): AssetDef {
  return {
    id: 'a', name: 'A', category: 'seating', mesh: '', buyPrice: 0, sellPrice: 0, environmentScore: 0,
    footprint: [1, 1], interactions: [],
    ...partial,
  };
}

console.log('usepose.test — defaults with no usePose set');
{
  const chair = asset({ footprint: [1, 1] });
  const inst: FacingInstance = { pos: [5, 5], rotDeg: 0 };
  const r = usePoseFor('sit', inst, chair, tuning);
  check('default position is the footprint center', approx(r.pos[0], 5) && approx(r.pos[1], 5), JSON.stringify(r.pos));
  check('default sit height from tuning.character.sitHeight', approx(r.y, 0.25));
  check('default facing is worldFacingDeg (rotDeg 0 + facingDeg 0)', approx(r.facingDeg, 0));

  const rLie = usePoseFor('lie', inst, chair, tuning);
  check('default lie height from tuning.character.lieHeight', approx(rLie.y, 0.55));

  // missing tuning.character falls back sanely (mirrors useSpotFor's bareTuning precedent)
  const bareTuning = {} as TuningData;
  const rBare = usePoseFor('sit', inst, chair, bareTuning);
  check('missing tuning.character falls back to 0.25 for sit', approx(rBare.y, 0.25));
  const rBareLie = usePoseFor('lie', inst, chair, bareTuning);
  check('missing tuning.character falls back to 0.55 for lie', approx(rBareLie.y, 0.55));
}

console.log('usepose.test — bed: default lie facing aligns with the long axis (roadmap item 1)');
{
  // shipped condo.json bed: footprint [2,3] (depth=3 is the long axis, local Z), rotDeg 90
  const bed = asset({ footprint: [2, 3], category: 'beds' });
  const inst: FacingInstance = { pos: [1.5, 8], rotDeg: 90 };
  const r = usePoseFor('lie', inst, bed, tuning);
  // worldFacingDeg(rotDeg=90, facingDeg absent=0) = 90 → facingVector(90) = world +X, the SAME
  // axis footprint depth (local Z) rotates onto at a 90° instance rotation — i.e. long-axis-aligned.
  check('default lie position is the bed pivot (footprint center)', approx(r.pos[0], 1.5) && approx(r.pos[1], 8));
  check('default lie facing equals worldFacingDeg (long-axis-aligned)', approx(r.facingDeg, 90), `${r.facingDeg}`);
}

console.log('usepose.test — usePose overrides (offset rotates with the instance, y/facingDeg sparse)');
{
  const sofa = asset({ footprint: [3, 1], usePose: { sit: { offset: [1, 0], y: 0.42 } } });
  // rotDeg 0: local +X offset stays world +X (rotateLocalOffset(θ=0) is identity)
  const inst0: FacingInstance = { pos: [10, 10], rotDeg: 0 };
  const r0 = usePoseFor('sit', inst0, sofa, tuning);
  check('offset applied at rot 0 (world +X)', approx(r0.pos[0], 11) && approx(r0.pos[1], 10), JSON.stringify(r0.pos));
  check('y override applied', approx(r0.y, 0.42));
  check('facingDeg falls back to worldFacingDeg when the entry omits it', approx(r0.facingDeg, 0));

  // rotDeg 90: local +X offset rotates to world -Z (rotateLocalOffset(lx=1,lz=0,θ=90) = (cos90, -sin90) = (0,-1))
  const inst90: FacingInstance = { pos: [10, 10], rotDeg: 90 };
  const r90 = usePoseFor('sit', inst90, sofa, tuning);
  check('offset rotates with the instance (rot 90 → world -Z)', approx(r90.pos[0], 10) && approx(r90.pos[1], 9), JSON.stringify(r90.pos));

  // explicit facingDeg entry composes like AssetDef.facingDeg: world = instance.rotDeg + entry.facingDeg
  const withFacing = asset({ footprint: [1, 1], usePose: { lie: { facingDeg: 45 } } });
  const rf = usePoseFor('lie', { pos: [0, 0], rotDeg: 30 }, withFacing, tuning);
  check('explicit facingDeg composes with instance rotDeg', approx(rf.facingDeg, 75), `${rf.facingDeg}`);
}

console.log('usepose.test — B2-2: negative-offset regression, all 4 instance rotations');
{
  // Ground-truth check for game/facing.ts's rotateLocalOffset: a negative-z model-local offset
  // must consistently land BEHIND the instance's world-facing direction (i.e. at
  // -|offset.z| * facingVector(worldFacingDeg)), the same relationship at every 90°-step
  // rotation. Verified independently against a live THREE.Object3D parent/child transform
  // (matches to 1e-9) — this suite only re-asserts the pure-math side so it stays dependency-free.
  const bed = asset({ footprint: [2, 3], category: 'beds', usePose: { lie: { offset: [0, -0.5] } } });
  const cases: Array<{ rotDeg: number; expected: [number, number] }> = [
    { rotDeg: 0, expected: [0, -0.5] },   // facing +Z: -z offset stays -Z (behind)
    { rotDeg: 90, expected: [-0.5, 0] },  // facing +X: -z offset becomes -X (behind)
    { rotDeg: 180, expected: [0, 0.5] },  // facing -Z: -z offset becomes +Z (behind)
    { rotDeg: 270, expected: [0.5, 0] },  // facing -X: -z offset becomes +X (behind)
  ];
  for (const { rotDeg, expected } of cases) {
    const inst: FacingInstance = { pos: [0, 0], rotDeg };
    const r = usePoseFor('lie', inst, bed, tuning);
    check(
      `rotDeg ${rotDeg}: offset [0,-0.5] lands at ${JSON.stringify(expected)} (behind facing)`,
      approx(r.pos[0], expected[0]) && approx(r.pos[1], expected[1]),
      JSON.stringify(r.pos),
    );
    // Cross-check: the result must equal -0.5 * facingVector(worldFacingDeg) at every rotation —
    // i.e. "negative z = behind the asset's facing direction" holds uniformly, not just at rot 0.
    const rad = (rotDeg * Math.PI) / 180;
    const facing: [number, number] = [Math.sin(rad), Math.cos(rad)];
    check(
      `rotDeg ${rotDeg}: matches -0.5 * facingVector uniformly`,
      approx(r.pos[0], -0.5 * facing[0]) && approx(r.pos[1], -0.5 * facing[1]),
      JSON.stringify(r.pos),
    );
  }
}

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall usepose tests passed');
