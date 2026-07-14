// marker.test.ts — game/marker.ts pure logic (PROJECT_CONTEXT.md §7.7 overhead marker slice).
// Covers config resolution/defaults, bob/spin math, mesh-kind classification (delegating to
// sprites.ts, not duplicating), and the synthetic AssetDef fed to world.ts's attachMesh. The
// three.js layer (createMarkerInstance) is browser-only, not headless-testable — same precedent
// as sprites.ts's createSpriteInstance (see that module's doc comment).
// Run: npx tsx test/marker.test.ts
import {
  MARKER_DEFAULTS, MARKER_BASE_SIZE, resolveMarkerConfig, classifyMarkerMesh,
  bobOffset, spinAngleDeg, markerAnchorHeight, markerAssetDef,
} from '../game/marker';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name} ${detail}`); }
}

console.log('marker.test — resolveMarkerConfig (sparse merge over MARKER_DEFAULTS)');
{
  check('undefined marker block → all defaults', JSON.stringify(resolveMarkerConfig(undefined)) === JSON.stringify(MARKER_DEFAULTS));
  check('empty object → all defaults', JSON.stringify(resolveMarkerConfig({})) === JSON.stringify(MARKER_DEFAULTS));
  check('partial override: only scale set', JSON.stringify(resolveMarkerConfig({ scale: 0.5 })) === JSON.stringify({ ...MARKER_DEFAULTS, scale: 0.5 }));
  check('full override, every field', JSON.stringify(resolveMarkerConfig({
    mesh: '/models/plumbob.glb', yOffset: 0.5, scale: 0.6, spinDegPerSec: 45, bobAmplitude: 0.1, bobHz: 1.2,
  })) === JSON.stringify({ mesh: '/models/plumbob.glb', yOffset: 0.5, scale: 0.6, spinDegPerSec: 45, bobAmplitude: 0.1, bobHz: 1.2 }));
  check('mesh path is trimmed', resolveMarkerConfig({ mesh: '  /models/plumbob.glb  ' }).mesh === '/models/plumbob.glb');
  check('mesh absent → empty string (built-in default)', resolveMarkerConfig({}).mesh === '');
  check('zero is a legit override, not treated as absent', resolveMarkerConfig({ yOffset: 0 }).yOffset === 0);
}

console.log('marker.test — classifyMarkerMesh (delegates to sprites.ts classifyMeshPath)');
{
  check('empty string → default', classifyMarkerMesh('') === 'default');
  check('whitespace-only → default', classifyMarkerMesh('   ') === 'default');
  check('.glb → model', classifyMarkerMesh('/models/plumbob.glb') === 'model');
  check('.gltf → model', classifyMarkerMesh('/models/plumbob.gltf') === 'model');
  check('.png → image', classifyMarkerMesh('/models/plumbob.png') === 'image');
  check('.gif → image', classifyMarkerMesh('/models/plumbob.gif') === 'image');
  check('unknown extension → model (safe GLB fallback, same as sprites.ts)', classifyMarkerMesh('/models/plumbob.xyz') === 'model');
}

console.log('marker.test — bobOffset (sine wave, sim time)');
{
  check('t=0 → 0', bobOffset(0, 0.05, 0.8) === 0);
  check('zero amplitude → always 0', bobOffset(1.23, 0, 0.8) === 0);
  const period = 1 / 0.8;
  check('quarter period → +amplitude', Math.abs(bobOffset(period / 4, 0.05, 0.8) - 0.05) < 1e-9);
  check('half period → ~0', Math.abs(bobOffset(period / 2, 0.05, 0.8)) < 1e-9);
  check('three-quarter period → -amplitude', Math.abs(bobOffset(period * 0.75, 0.05, 0.8) + 0.05) < 1e-9);
  check('full period → back to ~0', Math.abs(bobOffset(period, 0.05, 0.8)) < 1e-9);
}

console.log('marker.test — spinAngleDeg (world yaw, normalized to [0,360), sim time)');
{
  check('t=0 → 0', spinAngleDeg(0, 90) === 0);
  check('1 second at 90deg/s → 90', spinAngleDeg(1, 90) === 90);
  check('4 seconds at 90deg/s (one full loop) → 0', Math.abs(spinAngleDeg(4, 90)) < 1e-9);
  check('5 seconds at 90deg/s (loop + 90) → 90', Math.abs(spinAngleDeg(5, 90) - 90) < 1e-9);
  check('stays in [0,360)', spinAngleDeg(123.456, 90) >= 0 && spinAngleDeg(123.456, 90) < 360);
  check('negative spin rate normalizes into [0,360)', spinAngleDeg(1, -90) === 270);
  check('zero spin rate → always 0', spinAngleDeg(999, 0) === 0);
}

console.log('marker.test — markerAnchorHeight');
{
  check('adds height + yOffset', markerAnchorHeight(1.55, 0.35) === 1.9);
  check('zero yOffset → just height', markerAnchorHeight(1.7, 0) === 1.7);
  check('zero height (no character block) → just yOffset', markerAnchorHeight(0, 0.35) === 0.35);
}

console.log('marker.test — markerAssetDef (synthetic AssetDef fed to world.ts attachMesh)');
{
  const def = markerAssetDef('/models/plumbob.glb');
  check('mesh path passed through', def.mesh === '/models/plumbob.glb');
  check('id is stable', def.id === 'overhead-marker');
  check('footprint uses MARKER_BASE_SIZE on both axes', def.footprint[0] === MARKER_BASE_SIZE && def.footprint[1] === MARKER_BASE_SIZE);
  check('sprite orientation defaults billboard (§7.7: markers don’t lie flat)', def.sprite?.orientation === 'billboard');
  check('no meshFit baked in (scale is applied live by the three.js layer instead)', def.meshFit === undefined);
  const def2 = markerAssetDef('');
  check('empty mesh path still produces a valid def (caller only invokes attachMesh for non-default kinds)', def2.mesh === '');
}

if (failures > 0) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
console.log('\nALL MARKER TESTS PASSED');
