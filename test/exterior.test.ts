// exterior.test.ts — pure D4 exterior config resolution (ROADMAP_APT D4).
// Run: npx tsx test/exterior.test.ts
// Covers game/exterior.ts: defaults, sparse absence, backdrop mesh/image classification, distance
// guards, and fog range guards (non-finite / inverted / negative). No three.js / DOM.
import {
  resolveExterior, resolveBackdrop, resolveFog,
  DEFAULT_BACKDROP_DISTANCE, DEFAULT_FOG_NEAR, DEFAULT_FOG_FAR, DEFAULT_FOG_COLOR,
} from '../game/exterior';
import type { ExteriorConfig } from '../game/data';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (cond) console.log('  ok  ' + msg);
  else { failures++; console.error('FAIL: ' + msg); }
}

// ---- absent block → today's void ---------------------------------------------------------------
{
  const r = resolveExterior(undefined);
  assert(r.present === false, 'undefined config → present false');
  assert(r.skyColor === null && r.groundColor === null && r.backdrop === null && r.fog === null, 'undefined config → all null');
  const empty = resolveExterior({});
  assert(empty.present === false, 'empty {} config → present false (nothing rendered)');
  assert(resolveExterior(null).present === false, 'null config → present false');
}

// ---- colors: any non-empty trimmed string; blank/whitespace → null -----------------------------
{
  const r = resolveExterior({ skyColor: '#87b7e0', groundColor: '  #4a7c46  ' });
  assert(r.present === true, 'any color set → present true');
  assert(r.skyColor === '#87b7e0', 'skyColor kept verbatim');
  assert(r.groundColor === '#4a7c46', 'groundColor trimmed');
  assert(resolveExterior({ skyColor: '   ' }).skyColor === null, 'whitespace-only color → null');
  assert(resolveExterior({ skyColor: '' }).skyColor === null, 'empty color → null');
  assert(resolveExterior({ skyColor: 'skyblue' }).skyColor === 'skyblue', 'CSS color name accepted');
}

// ---- backdrop: mesh vs image classification + distance guard ------------------------------------
{
  const glb = resolveBackdrop({ backdrop: 'city_lowpoly.glb', backdropDistance: 80 });
  assert(glb?.kind === 'mesh' && glb.path === 'city_lowpoly.glb' && glb.distance === 80, '.glb → mesh kind, distance kept');
  assert(resolveBackdrop({ backdrop: 'x.GLTF' })?.kind === 'mesh', '.GLTF (any case) → mesh kind');
  const img = resolveBackdrop({ backdrop: 'ads/city.jpg' });
  assert(img?.kind === 'image', '.jpg → image kind');
  assert(img?.distance === DEFAULT_BACKDROP_DISTANCE, 'absent distance → default (60)');
  assert(resolveBackdrop({ backdrop: '   ' }) === null, 'blank backdrop path → null');
  assert(resolveBackdrop({}) === null, 'no backdrop key → null');
  // distance guards
  assert(resolveBackdrop({ backdrop: 'a.png', backdropDistance: NaN })?.distance === DEFAULT_BACKDROP_DISTANCE, 'NaN distance → default');
  assert(resolveBackdrop({ backdrop: 'a.png', backdropDistance: -5 })?.distance === DEFAULT_BACKDROP_DISTANCE, 'negative distance → default');
  assert(resolveBackdrop({ backdrop: 'a.png', backdropDistance: 0 })?.distance === DEFAULT_BACKDROP_DISTANCE, 'zero distance → default');
  assert(resolveBackdrop({ backdrop: 'a.png', backdropDistance: Infinity })?.distance === DEFAULT_BACKDROP_DISTANCE, 'Infinity distance → default');
}

// ---- fog: presence + range guards --------------------------------------------------------------
{
  assert(resolveFog({}) === null, 'no fog key → null');
  assert(resolveFog({ fog: {} })?.near === DEFAULT_FOG_NEAR, 'empty fog {} → default near');
  assert(resolveFog({ fog: {} })?.far === DEFAULT_FOG_FAR, 'empty fog {} → default far');
  const good = resolveFog({ fog: { color: '#cfd8e3', near: 40, far: 120 } });
  assert(good?.color === '#cfd8e3' && good.near === 40 && good.far === 120, 'valid fog kept verbatim');
  // color fallback chain: fog.color → skyColor → neutral grey
  assert(resolveFog({ skyColor: '#112233', fog: {} })?.color === '#112233', 'fog color falls back to skyColor');
  assert(resolveFog({ fog: {} })?.color === DEFAULT_FOG_COLOR, 'fog color falls back to neutral grey with no sky');
  // range guards
  assert(resolveFog({ fog: { near: NaN, far: 100 } })?.near === DEFAULT_FOG_NEAR, 'non-finite near → default');
  assert(resolveFog({ fog: { near: -10, far: 100 } })?.near === DEFAULT_FOG_NEAR, 'negative near → default');
  const inverted = resolveFog({ fog: { near: 100, far: 50 } });
  assert(!!inverted && inverted.far > inverted.near, 'far ≤ near → far pushed to a positive span');
  const infFar = resolveFog({ fog: { near: 30, far: Infinity } });
  assert(!!infFar && infFar.near === 30 && infFar.far > 30 && Number.isFinite(infFar.far), 'non-finite far → finite default span above near');
}

// ---- present flag is OR across every field -----------------------------------------------------
{
  assert(resolveExterior({ groundColor: '#333' }).present === true, 'ground only → present');
  assert(resolveExterior({ backdrop: 'x.glb' }).present === true, 'backdrop only → present');
  assert(resolveExterior({ fog: {} }).present === true, 'fog only → present');
  const full: ExteriorConfig = { skyColor: '#87b7e0', groundColor: '#4a7c46', backdrop: 'city.glb', backdropDistance: 60, fog: { color: '#cfd8e3', near: 40, far: 120 } };
  const r = resolveExterior(full);
  assert(r.present && r.skyColor === '#87b7e0' && r.groundColor === '#4a7c46' && r.backdrop?.kind === 'mesh' && r.fog?.far === 120, 'full block resolves every field');
}

if (failures) { console.error(`\n${failures} EXTERIOR TEST(S) FAILED`); process.exit(1); }
console.log('\nALL EXTERIOR TESTS PASSED');
