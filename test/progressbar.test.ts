// progressbar.test.ts — game/progressbar.ts pure logic (ROADMAP_NEXT B2-5 progress bar slice,
// B6-1 fill/bg alignment fix, B7-3 re-verification). Covers anchor height, progress clamping, and
// the fill-vs-bg alignment math (fillMargin/fillInnerWidth/fillLeftEdge/fillScaleX). The
// three.js RENDER layer (createProgressBarInstance itself) still isn't exercised here — it needs a
// live characterRoot/scene — but ROADMAP_NEXT B7-3 asked specifically whether the pure-number
// checks below actually reflect real THREE.Sprite geometry (`sprite.center` changes what a given
// `position`/`scale` mean) rather than just re-deriving the same arithmetic by hand. The
// "THREE.Sprite real-geometry" block does that: it builds actual THREE.Sprite/Group objects with
// the exact center/position/scale createProgressBarInstance uses, updates their world matrices,
// and reconstructs the on-screen rect from the real vertex-shader formula (three's
// sprite.glsl.js: `alignedPosition = (position.xy - (center - vec2(0.5))) * scale`, then added to
// the sprite's own translation) — instead of assuming the hand-derived left/right formulas match.
// Result (see below): they do — bg (center 0.5,0.5) and fill (center 0,0.5) nest with an identical
// margin on all four sides at progress 0/0.1/0.5/1, so B7-3's "fill detached below-left of the
// track" is NOT reproducible from this module's math; if it's still seen live, suspect a stale
// bundle/cache rather than progressbar.ts's formulas.
// Run: npx tsx test/progressbar.test.ts
import * as THREE from 'three';
import {
  PROGRESS_BAR_DEFAULTS, progressBarAnchorHeight, clampProgress01,
  fillMargin, fillInnerWidth, fillInnerHeight, fillLeftEdge, fillScaleX,
} from '../game/progressbar';

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

console.log('progressbar.test — fill/bg alignment (B6-1)');
{
  const { widthMeters: W, heightMeters: H } = PROGRESS_BAR_DEFAULTS;
  const bgLeft = -W / 2, bgRight = W / 2;
  const margin = fillMargin(H);
  const innerW = fillInnerWidth(W, H);
  const left = fillLeftEdge(W, H);

  check('margin is positive and symmetric-derived from height', margin === H * 0.15, String(margin));
  check('inner width is inset from bg width by 2×margin', innerW === W - margin * 2, String(innerW));
  check('inner height is inset from bg height by 2×margin (matches legacy 0.7 factor)',
    Math.abs(fillInnerHeight(H) - H * 0.7) < 1e-9, String(fillInnerHeight(H)));
  check('fill left edge sits INSIDE the bg left edge, not flush', left > bgLeft, `left=${left} bgLeft=${bgLeft}`);

  // progress 0: zero-width fill, left edge only, still inside the track
  {
    const scaleX = fillScaleX(W, H, 0);
    const right = left + scaleX;
    check('progress 0 → zero fill width', scaleX === 0);
    check('progress 0 → right edge === left edge (collapsed, inside track)', right === left, `right=${right}`);
  }

  // progress 0.5: fill spans exactly half the inset inner width
  {
    const scaleX = fillScaleX(W, H, 0.5);
    const right = left + scaleX;
    check('progress 0.5 → half the inner width', Math.abs(scaleX - innerW / 2) < 1e-9, String(scaleX));
    check('progress 0.5 → still fully inside the bg track on both sides',
      left >= bgLeft && right <= bgRight, `left=${left} right=${right} bgLeft=${bgLeft} bgRight=${bgRight}`);
  }

  // progress 1: fill spans the full inset inner width, symmetric margin from both bg edges
  {
    const scaleX = fillScaleX(W, H, 1);
    const right = left + scaleX;
    check('progress 1 → full inner width', Math.abs(scaleX - innerW) < 1e-9, String(scaleX));
    check('progress 1 → right edge sits INSIDE the bg right edge, not flush', right < bgRight, `right=${right} bgRight=${bgRight}`);
    check('progress 1 → left/right margins from the bg track are equal (symmetric inset)',
      Math.abs((left - bgLeft) - (bgRight - right)) < 1e-9, `leftMargin=${left - bgLeft} rightMargin=${bgRight - right}`);
  }

  // overshoot clamps the same way scale does
  {
    const scaleX = fillScaleX(W, H, 1.7);
    check('progress > 1 clamps to the full inner width, no overshoot past the track', Math.abs(scaleX - innerW) < 1e-9, String(scaleX));
  }
}

console.log('progressbar.test — THREE.Sprite real-geometry nesting (B7-3)');
{
  // Reconstructs createProgressBarInstance's exact bg/fill sprite setup (same center/position/
  // scale calls) and computes each sprite's true on-screen rect via three's actual vertex-shader
  // formula, rather than trusting the hand-derived left/right numbers above to match reality.
  function spriteWorldRect(sprite: THREE.Sprite) {
    sprite.updateMatrixWorld(true);
    const basePos = new THREE.Vector3().setFromMatrixPosition(sprite.matrixWorld);
    const worldScale = new THREE.Vector3();
    new THREE.Matrix4().copy(sprite.matrixWorld).decompose(new THREE.Vector3(), new THREE.Quaternion(), worldScale);
    const cx = sprite.center.x, cy = sprite.center.y;
    // three.js sprite.glsl.js: alignedPosition = (position.xy - (center - vec2(0.5))) * scale,
    // where position.xy is the quad vertex attribute, ranging -0.5..0.5 (Sprite.js geometry).
    const alignedX = (v: number) => (v - (cx - 0.5)) * worldScale.x;
    const alignedY = (v: number) => (v - (cy - 0.5)) * worldScale.y;
    return {
      left: basePos.x + alignedX(-0.5), right: basePos.x + alignedX(0.5),
      bottom: basePos.y + alignedY(-0.5), top: basePos.y + alignedY(0.5),
    };
  }

  const { widthMeters: W, heightMeters: H } = PROGRESS_BAR_DEFAULTS;
  const pivot = new THREE.Group();
  const bg = new THREE.Sprite(new THREE.SpriteMaterial({ color: PROGRESS_BAR_DEFAULTS.bgColor }));
  bg.scale.set(W, H, 1);
  const fill = new THREE.Sprite(new THREE.SpriteMaterial({ color: PROGRESS_BAR_DEFAULTS.fillColor }));
  fill.center.set(0, 0.5);
  fill.position.x = fillLeftEdge(W, H);
  fill.scale.set(0, fillInnerHeight(H), 1);
  pivot.add(bg, fill);
  pivot.position.set(3.7, 5.2, -1.4); // arbitrary, non-origin — a real characterRoot position

  const margin = fillMargin(H);
  for (const progress of [0, 0.1, 0.5, 1]) {
    fill.scale.x = fillScaleX(W, H, progress);
    const bgRect = spriteWorldRect(bg);
    const fillRect = spriteWorldRect(fill);

    check(`p=${progress}: fill stays fully inside bg horizontally`,
      fillRect.left >= bgRect.left - 1e-9 && fillRect.right <= bgRect.right + 1e-9,
      JSON.stringify({ bgRect, fillRect }));
    check(`p=${progress}: fill stays fully inside bg vertically`,
      fillRect.bottom >= bgRect.bottom - 1e-9 && fillRect.top <= bgRect.top + 1e-9,
      JSON.stringify({ bgRect, fillRect }));
    check(`p=${progress}: left margin matches the designed fillMargin (no anchor-mismatch gap/overhang)`,
      Math.abs((fillRect.left - bgRect.left) - margin) < 1e-9,
      `leftMargin=${fillRect.left - bgRect.left} expected=${margin}`);
    check(`p=${progress}: top/bottom margins match the designed fillMargin`,
      Math.abs((fillRect.top - bgRect.top) + margin) < 1e-9 && Math.abs((fillRect.bottom - bgRect.bottom) - margin) < 1e-9,
      `topGap=${bgRect.top - fillRect.top} bottomGap=${fillRect.bottom - bgRect.bottom} expected=${margin}`);
  }
  // progress 1's right margin should also equal the same margin (symmetric on the growing edge too)
  {
    fill.scale.x = fillScaleX(W, H, 1);
    const bgRect = spriteWorldRect(bg);
    const fillRect = spriteWorldRect(fill);
    check('p=1: right margin matches the designed fillMargin too (fully symmetric inset)',
      Math.abs((bgRect.right - fillRect.right) - margin) < 1e-9,
      `rightMargin=${bgRect.right - fillRect.right} expected=${margin}`);
  }
}

if (failures > 0) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
console.log('\nALL PROGRESSBAR TESTS PASSED');
