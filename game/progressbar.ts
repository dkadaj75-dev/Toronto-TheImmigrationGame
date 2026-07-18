// progressbar.ts — ROADMAP_NEXT B2-5: world-anchored progress bar above the sim's head, shown only
// while the currently-active action has a `duration` (§7.11, extended this slice with `modifiers`
// — see game/duration.ts) — e.g. extinguish/clean_up/sweep/mop, and cook too (free consistency
// win: cook already had a duration before this slice, so it gets a bar with zero extra wiring).
// Mirrors game/marker.ts's/game/censor.ts's split: pure logic (anchor height, progress clamp) is
// headless-tested in test/progressbar.test.ts with zero THREE dependency; the thin three.js layer
// below turns it into two live camera-facing sprites (background track + fill) tracking the sim.
//
// ANCHOR DESIGN (same precedent as marker.ts/censor.ts's module doc comments): the bar is an
// INDEPENDENT top-level object, not parented under the character root — game/main.ts's
// loadCharacter() calls sim.clear() on every rig (re)load, which would silently delete a child
// object mid-action. Position is copied from the character root every frame (translation only).
// Sits BELOW the overhead marker: `heightMeters + yOffset` with a smaller yOffset (0.15) than the
// marker's own default (0.35) — "above the sim, below the marker" per the brief.
//
// SIM TIME: the bar has no internal timer of its own — `progress` is computed by the caller
// (game/main.ts) from `durationState.elapsed / durationState.totalSeconds`, which already advances
// on `sdt` (pause freezes it, 2x/3x speeds it up, exactly like the timer it visualizes). This
// module just clamps/renders whatever progress it's handed.
//
// RENDERING: two THREE.Sprite (full camera billboard, same mechanism as censor.ts's quad and
// marker.ts's image kind — no manual look-at math), plain-color SpriteMaterials (no texture, no
// asset/mesh pipeline needed for a procedural HUD-style bar). The background track is a fixed-size
// sprite; the fill sprite shares the track's exact world position and uses a progress-dependent
// `sprite.center.x` with its x-scale set to `progress * innerWidth`, so its camera-facing quad grows
// rightward from a fixed left edge. `depthTest: false` + a high `renderOrder` (same convention as censor.ts)
// so the bar reliably reads above nearby furniture it may be co-located with (e.g. extinguishing a
// fire right next to the stove).
//
// ROADMAP_NEXT B6-1 root cause: the fill's height was inset 30% inside the bg track
// (`heightMeters * 0.7`, a fixed margin of `heightMeters * 0.15` per side) but its WIDTH was not
// inset at all — `fill.position.x` sat exactly on the bg's left edge and, at progress 1, the fill's
// right edge landed exactly on the bg's right edge (flush, zero margin). The result: a border
// visible above/below the fill but none left/right — an asymmetric inset that reads as "the fill
// doesn't sit inside the track" even though the underlying sprite anchor math (center/scale) was
// internally consistent. Fix: derive a single `fillMargin` (15% of heightMeters) and apply it
// symmetrically to BOTH axes via `fillInnerWidth`/`fillLeftEdge`/`fillScaleX` below, so the fill
// keeps a matching margin on all four sides of the bg track at every progress value.
//
// ROADMAP_NEXT B7-3 root cause: the B6-1 code put the fill's fixed left edge in
// `fill.position.x`. A Sprite's position is transformed in WORLD axes, but its quad/center/scale
// are applied in CAMERA axes by three's billboard shader. With the shipped isometric camera,
// world-X projects diagonally down-left, so the track stayed at the pivot while the fill floated
// below-left. The earlier real-THREE test compared world rects without a camera and therefore
// missed that coordinate-space mismatch. The live fix keeps both sprites at the identical world
// origin and expresses the fixed left edge entirely through `fill.center.x`, which is evaluated in
// the same camera-facing coordinate frame as the fill quad.

import * as THREE from 'three';

export interface ProgressBarConfig {
  widthMeters: number;
  heightMeters: number;
  yOffset: number;
  bgColor: number;
  fillColor: number;
}

/** Shipped defaults — modest size, sits just under the overhead marker (default yOffset 0.35)
 *  without overlapping it, tuned against the shipped 1.55m character. */
export const PROGRESS_BAR_DEFAULTS: ProgressBarConfig = {
  widthMeters: 0.5, heightMeters: 0.08, yOffset: 0.15, bgColor: 0x1c2436, fillColor: 0x5ec9d6,
};

/** Anchor height above the floor (meters): the character's authored standing height plus the
 *  bar's own vertical offset. Same "known limitation, documented not fixed" precedent as
 *  marker.ts's markerAnchorHeight — doesn't account for a seated/lying pose's shifted root Y
 *  (a duration-timed action like cook/extinguish is a standing action today, so this doesn't
 *  currently bite in practice; out of scope to fix here). */
export function progressBarAnchorHeight(heightMeters: number, yOffset: number): number {
  return heightMeters + yOffset;
}

/** Clamp progress to [0,1] — defensive against a caller passing elapsed/total slightly past 1 (a
 *  stray frame before the completing stopAction() call lands could otherwise overshoot the fill
 *  sprite's scale into negative/oversized territory). */
export function clampProgress01(p: number): number {
  return Math.min(Math.max(p, 0), 1);
}

/** Margin (meters) kept between the fill and the bg track's edges, applied symmetrically to BOTH
 *  axes (see B6-1 root-cause note above) — 15% of the bar's height per side, which reproduces the
 *  original shipped vertical inset exactly (`heightMeters - 2*margin === heightMeters * 0.7`) while
 *  giving the horizontal axis the matching margin it was previously missing. */
export function fillMargin(heightMeters: number): number {
  return heightMeters * 0.15;
}

/** Width available to the fill once the symmetric margin is subtracted from both sides. Clamped to
 *  0 so a pathologically small/negative widthMeters (misconfigured caller) can't go negative. */
export function fillInnerWidth(widthMeters: number, heightMeters: number): number {
  return Math.max(0, widthMeters - fillMargin(heightMeters) * 2);
}

/** Height available to the fill once the same symmetric margin is subtracted top/bottom. */
export function fillInnerHeight(heightMeters: number): number {
  return Math.max(0, heightMeters - fillMargin(heightMeters) * 2);
}

/** Fill sprite's fixed local x-offset from the pivot (= the bg track's center), i.e. its
 *  left-anchored transform origin (`sprite.center.set(0, 0.5)`) — the inset left edge of the track,
 *  not the bg's own left edge. Constant across progress; only `fillScaleX` changes per frame. */
export function fillLeftEdge(widthMeters: number, heightMeters: number): number {
  return -fillInnerWidth(widthMeters, heightMeters) / 2;
}

/** Fill sprite's x-scale (world width) at a given progress: the inset inner width times clamped
 *  progress, so the fill's right edge sweeps from the inset left edge (progress 0) to the inset
 *  right edge (progress 1) — never past it, matching the bg track's inset bounds exactly. */
export function fillScaleX(widthMeters: number, heightMeters: number, progress: number): number {
  return fillInnerWidth(widthMeters, heightMeters) * clampProgress01(progress);
}

/** Sprite-center value that keeps the fill's left edge at `-innerWidth/2` while its width grows.
 *  Sprite centers are not restricted to [0,1]; values above 1 for partial progress are valid and
 *  let the whole anchor offset stay in the billboard shader's camera-facing coordinate frame. */
export function fillCenterX(progress: number): number {
  const p = clampProgress01(progress);
  return p > 0 ? 1 / (2 * p) : 0.5;
}

export interface ProgressBarInstance {
  /** `active` = whether the current action has a duration in progress (game/main.ts's
   *  `durationState !== null`); when false the bar is hidden and position/scale aren't touched.
   *  `progress` = elapsed/total, any range (clamped internally). `heightMeters` = the character's
   *  authored standing height (data.tuning.character?.heightMeters, same fallback convention as
   *  censor.ts's `active`/`heightMeters` params). */
  update(characterRoot: THREE.Object3D, active: boolean, progress: number, heightMeters: number): void;
  dispose(): void;
}

// ==================================================================== ITEM 2: skill progress bar
// A SECOND world bar shown near the sim whenever the current action has skillGains (game/main.ts
// resolves the primary skill + next-point fraction from game/stats.ts's skillPointProgress). Reuses
// this module's fill/track geometry helpers (fillScaleX/fillCenterX/fillInnerHeight — the exact
// B6-1/B7-3 camera-space-anchor math) so it never re-derives the sprite-center trick. Stacked ABOVE
// the action progress bar by `gapMeters` of world-Y (world-up projects near-vertically under the
// isometric camera, so a pure Y offset separates the two bars on screen without the world-X drift
// the B7-3 note warns about — the two bars share the sim's x/z and never overlap). Label is a
// camera-facing canvas-texture sprite ('<SkillName>:'), the "sprite text" option the brief offered
// (progressbar.ts had no text mechanism; the floating-feedback HTML is transient, unfit for a
// persistent label). Always-visible while active — NOT occlusion-tested (only garbage fill bars are).

export interface SkillBarConfig {
  widthMeters: number; heightMeters: number; gapMeters: number;
  fillColor: number | string; trackColor: number | string;
}

/** Shipped defaults — a DISTINCT fillColor (warm gold) from the action bar's cyan so the two read
 *  as different HUD elements when both are visible; sized like the action bar and stacked above it. */
export const SKILL_BAR_DEFAULTS: SkillBarConfig = {
  widthMeters: 0.5, heightMeters: 0.08, gapMeters: 0.12, fillColor: '#f4c542', trackColor: '#1c2436',
};

/** Merge a sparse tuning.feedback.skillBar block over the defaults. */
export function resolveSkillBarConfig(partial?: Partial<SkillBarConfig>): SkillBarConfig {
  return {
    widthMeters: partial?.widthMeters ?? SKILL_BAR_DEFAULTS.widthMeters,
    heightMeters: partial?.heightMeters ?? SKILL_BAR_DEFAULTS.heightMeters,
    gapMeters: partial?.gapMeters ?? SKILL_BAR_DEFAULTS.gapMeters,
    fillColor: partial?.fillColor ?? SKILL_BAR_DEFAULTS.fillColor,
    trackColor: partial?.trackColor ?? SKILL_BAR_DEFAULTS.trackColor,
  };
}

/** World-Y anchor of the skill bar: the action bar's own anchor height plus `gapMeters`, so it sits
 *  clear above the action bar (which is at heightMeters + PROGRESS_BAR_DEFAULTS.yOffset) and below
 *  the overhead marker (default yOffset 0.35). Pure/testable. */
export function skillBarAnchorHeight(heightMeters: number, gapMeters: number): number {
  return progressBarAnchorHeight(heightMeters, PROGRESS_BAR_DEFAULTS.yOffset) + gapMeters;
}

// --- Label canvas sizing (2026-07-17 bug fix) ------------------------------------------------
// The label was drawn onto a FIXED 256x64 canvas, centered with textAlign:'center'. Once the label
// grew from a bare '<Skill>:' to '<Skill> <level>/<max>:' (e.g. 'English 15/100:'), a bold 40px
// string overran 256px and its first/last glyphs were clipped at the canvas edges (the designer's
// "caption cut off" report). Fix: measure the text (ctx.measureText) and size the canvas to fit it
// with symmetric padding, redrawing whenever the text changes, then scale the sprite from the
// canvas aspect so glyphs never stretch however wide the label grows. The canvas-render step needs
// a real 2D context (unavailable under jsdom), so the SIZING math lives in these pure helpers with
// their own tests; redrawLabel just wires them to measureText + the sprite scale.

/** Font used for the in-world skill label; shared by the measure pass and the draw pass. */
export const SKILL_LABEL_FONT = 'bold 40px sans-serif';
/** Horizontal padding (px) kept on EACH side of the measured text so the outline stroke and glyph
 *  side-bearings never touch the canvas edge. */
export const SKILL_LABEL_PAD_PX = 16;
/** Canvas height (px) — one 40px line plus room for its 6px outline stroke. */
export const SKILL_LABEL_HEIGHT_PX = 64;
/** Floor on canvas width so a very short label still gets a sane texture. */
export const SKILL_LABEL_MIN_WIDTH_PX = 64;
/** World-height of the label line as a fraction of the bar width — reproduces the legacy
 *  0.125m line height at the default 0.5m bar width (0.5 * 0.25). Width then follows the canvas
 *  aspect (see skillLabelWorldSize), so the on-screen text height stays constant across labels. */
export const SKILL_LABEL_WORLD_HEIGHT_RATIO = 0.25;

/** Canvas pixel size that fits a measured label without clipping: width = ceil(measured text) +
 *  symmetric padding (never below a floor), height fixed for a single line + its outline. Pure. */
export function skillLabelCanvasSize(textWidthPx: number): { width: number; height: number } {
  const w = Number.isFinite(textWidthPx) && textWidthPx > 0 ? textWidthPx : 0;
  return {
    width: Math.max(SKILL_LABEL_MIN_WIDTH_PX, Math.ceil(w) + SKILL_LABEL_PAD_PX * 2),
    height: SKILL_LABEL_HEIGHT_PX,
  };
}

/** World-space size of the label sprite: a fixed world line height, with width following the canvas
 *  aspect so glyphs are never stretched however wide the text grows. Pure. */
export function skillLabelWorldSize(canvasWidth: number, canvasHeight: number, worldHeight: number): { width: number; height: number } {
  const aspect = canvasHeight > 0 ? canvasWidth / canvasHeight : 1;
  return { width: worldHeight * aspect, height: worldHeight };
}

export interface SkillBarInstance {
  update(characterRoot: THREE.Object3D, active: boolean, fraction: number, label: string, heightMeters: number, config: SkillBarConfig): void;
  dispose(): void;
}

export function createSkillBarInstance(scene: THREE.Object3D): SkillBarInstance {
  const pivot = new THREE.Group();
  pivot.name = 'skill-bar';
  pivot.visible = false;

  const bgMat = new THREE.SpriteMaterial({ depthTest: false, transparent: true, opacity: 0.85 });
  const bg = new THREE.Sprite(bgMat);
  bg.renderOrder = 998;

  const fillMat = new THREE.SpriteMaterial({ depthTest: false });
  const fill = new THREE.Sprite(fillMat);
  fill.renderOrder = 999;
  fill.center.set(0.5, 0.5);

  // Label — a canvas-texture sprite redrawn only when the text changes (cheap steady state). The
  // canvas is RESIZED per label to fit the measured text (see skillLabelCanvasSize) so long labels
  // like 'English 15/100:' are never clipped at the edges.
  const canvas = document.createElement('canvas');
  canvas.width = SKILL_LABEL_MIN_WIDTH_PX; canvas.height = SKILL_LABEL_HEIGHT_PX;
  const ctx = canvas.getContext('2d');
  const labelTex = new THREE.CanvasTexture(canvas);
  const labelMat = new THREE.SpriteMaterial({ map: labelTex, depthTest: false, transparent: true });
  const labelSprite = new THREE.Sprite(labelMat);
  labelSprite.renderOrder = 1000;
  let lastLabel = '';
  const redrawLabel = (text: string) => {
    if (!ctx) return;
    ctx.font = SKILL_LABEL_FONT;
    const size = skillLabelCanvasSize(ctx.measureText(text).width);
    // Resizing the canvas resets ALL 2D context state (font/align/styles), so re-apply after.
    canvas.width = size.width; canvas.height = size.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = SKILL_LABEL_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)'; // outline for legibility over any background
    ctx.strokeText(text, canvas.width / 2, canvas.height / 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
    labelTex.needsUpdate = true;
  };

  pivot.add(bg, fill, labelSprite);
  scene.add(pivot);

  return {
    update(characterRoot, active, fraction, label, heightMeters, config) {
      pivot.visible = active;
      if (!active) return;
      pivot.position.set(characterRoot.position.x, skillBarAnchorHeight(heightMeters, config.gapMeters), characterRoot.position.z);
      bgMat.color.set(config.trackColor as THREE.ColorRepresentation);
      bg.scale.set(config.widthMeters, config.heightMeters, 1);
      fillMat.color.set(config.fillColor as THREE.ColorRepresentation);
      fill.scale.set(fillScaleX(config.widthMeters, config.heightMeters, fraction), fillInnerHeight(config.heightMeters), 1);
      fill.center.x = fillCenterX(fraction); // camera-space left anchor (same B7-3 lesson)
      if (label !== lastLabel) { lastLabel = label; redrawLabel(label); }
      // Label sits just above the bar. Its world size follows the (now text-fitted) canvas aspect
      // so the line height stays constant while the width grows to fit longer labels — no clipping,
      // no stretching (see skillLabelWorldSize).
      const world = skillLabelWorldSize(canvas.width, canvas.height, config.widthMeters * SKILL_LABEL_WORLD_HEIGHT_RATIO);
      labelSprite.scale.set(world.width, world.height, 1);
      labelSprite.position.set(0, config.heightMeters / 2 + world.height / 2 + 0.02, 0);
    },
    dispose() {
      scene.remove(pivot);
      bgMat.dispose();
      fillMat.dispose();
      labelMat.dispose();
      labelTex.dispose();
    },
  };
}

export function createProgressBarInstance(scene: THREE.Object3D, config: ProgressBarConfig = PROGRESS_BAR_DEFAULTS): ProgressBarInstance {
  const pivot = new THREE.Group();
  pivot.name = 'progress-bar';
  pivot.visible = false;

  const bgMat = new THREE.SpriteMaterial({ color: config.bgColor, depthTest: false, transparent: true, opacity: 0.85 });
  const bg = new THREE.Sprite(bgMat);
  bg.renderOrder = 998;
  bg.scale.set(config.widthMeters, config.heightMeters, 1);

  const fillMat = new THREE.SpriteMaterial({ color: config.fillColor, depthTest: false });
  const fill = new THREE.Sprite(fillMat);
  fill.renderOrder = 999;
  fill.center.set(0.5, 0.5);
  fill.scale.set(0, fillInnerHeight(config.heightMeters), 1); // inset on all sides, symmetric with X; starts empty

  pivot.add(bg, fill);
  scene.add(pivot);

  return {
    update(characterRoot, active, progress, heightMeters) {
      pivot.visible = active;
      if (!active) return;
      pivot.position.set(characterRoot.position.x, progressBarAnchorHeight(heightMeters, config.yOffset), characterRoot.position.z);
      fill.scale.x = fillScaleX(config.widthMeters, config.heightMeters, progress);
      fill.center.x = fillCenterX(progress); // camera-space left anchor; never offset in world X (B7-3)
    },
    dispose() {
      scene.remove(pivot);
      bgMat.dispose();
      fillMat.dispose();
    },
  };
}
