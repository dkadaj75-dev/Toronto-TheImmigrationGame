// sprites.test.ts — game/sprites.ts pure logic (PROJECT_CONTEXT.md §7.5 sprite/GIF visuals slice).
// Covers extension classification, sparse sprite-config resolution, GIF frame-timing math, and
// footprint-based plane sizing — everything that doesn't touch THREE/WebGL/ImageDecoder (those
// live in createSpriteInstance/decodeGifFrames, browser-only, not headless-testable — see
// game/sprites.ts's module doc comment).
// Run: npx tsx test/sprites.test.ts
import {
  extensionOf, classifyMeshPath, isGifPath, resolveSpriteConfig,
  frameDurationsMs, frameIndexAtTime, spritePlaneSize, preloadGif,
} from '../game/sprites';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name} ${detail}`); }
}

console.log('sprites.test — extensionOf / classifyMeshPath / isGifPath');
{
  check('extensionOf plain path', extensionOf('models/fire.gif') === 'gif');
  check('extensionOf uppercase extension lowercased', extensionOf('models/FIRE.GIF') === 'gif');
  check('extensionOf with query string', extensionOf('models/fire.gif?v=2') === 'gif');
  check('extensionOf with hash', extensionOf('models/fire.gif#frag') === 'gif');
  check('extensionOf no extension', extensionOf('models/fire') === '');
  check('extensionOf leading slash', extensionOf('/models/tv.glb') === 'glb');

  check('classify .glb → model', classifyMeshPath('/models/tv.glb') === 'model');
  check('classify .gltf → model', classifyMeshPath('/models/tv.gltf') === 'model');
  check('classify .png → image', classifyMeshPath('/models/fire.png') === 'image');
  check('classify .jpg → image', classifyMeshPath('/models/fire.jpg') === 'image');
  check('classify .jpeg → image', classifyMeshPath('/models/fire.jpeg') === 'image');
  check('classify .webp → image', classifyMeshPath('/models/fire.webp') === 'image');
  check('classify .gif → image', classifyMeshPath('/models/fire.gif') === 'image');
  check('classify uppercase .GIF → image', classifyMeshPath('/models/fire.GIF') === 'image');
  check('classify with query string → image', classifyMeshPath('/models/fire.gif?v=3') === 'image');
  check('classify unknown extension → model (safe GLB-loader fallback)', classifyMeshPath('/models/fire.xyz') === 'model');
  check('classify extensionless path → model', classifyMeshPath('/models/fire') === 'model');
  check('classify empty path → model', classifyMeshPath('') === 'model');

  check('isGifPath true for .gif', isGifPath('/models/fire.gif') === true);
  check('isGifPath false for .png', isGifPath('/models/fire.png') === false);
  check('isGifPath false for .glb', isGifPath('/models/tv.glb') === false);
}

console.log('sprites.test — resolveSpriteConfig (sparse, billboard default)');
{
  check('no sprite block → billboard, no fps', JSON.stringify(resolveSpriteConfig({})) === JSON.stringify({ orientation: 'billboard', fps: undefined }));
  check('explicit billboard passes through', resolveSpriteConfig({ sprite: { orientation: 'billboard' } }).orientation === 'billboard');
  check('explicit flat passes through', resolveSpriteConfig({ sprite: { orientation: 'flat' } }).orientation === 'flat');
  check('fps passes through when set', resolveSpriteConfig({ sprite: { fps: 12 } }).fps === 12);
  check('fps absent stays undefined', resolveSpriteConfig({ sprite: { orientation: 'flat' } }).fps === undefined);
}

console.log('sprites.test — frameDurationsMs (fps override vs. native GIF delays)');
{
  const delays = [100, 150, 80];
  check('no fps → native delays pass through unchanged', JSON.stringify(frameDurationsMs(delays)) === JSON.stringify(delays));
  check('fps override → uniform duration per frame', JSON.stringify(frameDurationsMs(delays, 10)) === JSON.stringify([100, 100, 100]));
  check('fps=0 is falsy → native delays used (no divide-by-zero)', JSON.stringify(frameDurationsMs(delays, 0)) === JSON.stringify(delays));
  check('negative fps ignored → native delays used', JSON.stringify(frameDurationsMs(delays, -5)) === JSON.stringify(delays));
  check('fps=25 → 40ms/frame', frameDurationsMs(delays, 25)[0] === 40);
}

console.log('sprites.test — frameIndexAtTime (loops via modulo, never throws)');
{
  const uniform = [100, 100, 100]; // 300ms total
  check('t=0 → frame 0', frameIndexAtTime(uniform, 0) === 0);
  check('t=50 → frame 0 (mid first frame)', frameIndexAtTime(uniform, 50) === 0);
  check('t=100 exactly → frame 1 (boundary belongs to the next frame)', frameIndexAtTime(uniform, 100) === 1);
  check('t=250 → frame 2', frameIndexAtTime(uniform, 250) === 2);
  check('t=300 (exactly one full loop) → frame 0 again', frameIndexAtTime(uniform, 300) === 0);
  check('t=650 (two loops + 50) → frame 0', frameIndexAtTime(uniform, 650) === 0);
  check('t=750 (two loops + 150) → frame 1', frameIndexAtTime(uniform, 750) === 1);

  const nonUniform = [50, 200, 30]; // 280ms total, uneven frame lengths
  check('non-uniform: t=40 → frame 0', frameIndexAtTime(nonUniform, 40) === 0);
  check('non-uniform: t=60 → frame 1', frameIndexAtTime(nonUniform, 60) === 1);
  check('non-uniform: t=260 → frame 2', frameIndexAtTime(nonUniform, 260) === 2);
  check('non-uniform: t=280 (loop) → frame 0', frameIndexAtTime(nonUniform, 280) === 0);

  check('empty durations → frame 0 (no crash)', frameIndexAtTime([], 12345) === 0);
  check('single frame → always frame 0', frameIndexAtTime([100], 999999) === 0);
  check('all-zero durations (zero total) → frame 0, no divide-by-zero', frameIndexAtTime([0, 0, 0], 500) === 0);
  check('defensive negative elapsed wraps forward, never negative index', frameIndexAtTime(uniform, -50) === 2);
}

console.log('sprites.test — spritePlaneSize (footprint × meshFit.scale)');
{
  check('no meshFit → plain footprint', JSON.stringify(spritePlaneSize({ footprint: [2, 1] })) === JSON.stringify([2, 1]));
  check('uniform scale multiplies both axes', JSON.stringify(spritePlaneSize({ footprint: [2, 1], meshFit: { scale: 1.5 } })) === JSON.stringify([3, 1.5]));
  check('per-axis scale uses x/y (z ignored — no depth on a 2D plane)', JSON.stringify(spritePlaneSize({ footprint: [2, 1], meshFit: { scale: [2, 3, 99] } })) === JSON.stringify([4, 3]));
}

if (failures > 0) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
console.log('sprites.test — preloadGif (ROADMAP_NEXT B3-1b: eager GIF-decode cache warm-up)');
{
  // Under plain `npx tsx` (Node, no browser globals) there's neither a `document` nor an
  // `ImageDecoder`, so preloadGif's real decode path can never run here — this only exercises its
  // guard clauses, which is exactly the point: it must be a no-op (never throw) for every input
  // this environment can hand it, mirroring createSpriteInstance's own `canTryGifDecode` gate.
  let threw = false;
  try {
    preloadGif('models/fire.png'); // not a .gif — should no-op before ever touching ImageDecoder
    preloadGif('sounds/fire.gif'); // IS a .gif, but ImageDecoder is undefined in this environment
    preloadGif('models/fire.gif?v=2'); // query-string variant, same no-op path
  } catch { threw = true; }
  check('preloadGif never throws when ImageDecoder is unavailable / path is not a gif', !threw);
}

console.log('\nALL SPRITES TESTS PASSED');
