// progressbar.test.ts — game/progressbar.ts pure logic (ROADMAP_NEXT B2-5 progress bar slice,
// B6-1 fill/bg alignment fix). Covers anchor height, progress clamping, and the fill-vs-bg
// alignment math (fillMargin/fillInnerWidth/fillLeftEdge/fillScaleX). The three.js layer
// (createProgressBarInstance) is browser-only, not headless-testable — same precedent as
// marker.ts's createMarkerInstance / censor.ts's createCensorInstance (see those modules' doc
// comments).
// Run: npx tsx test/progressbar.test.ts
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

if (failures > 0) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
console.log('\nALL PROGRESSBAR TESTS PASSED');
