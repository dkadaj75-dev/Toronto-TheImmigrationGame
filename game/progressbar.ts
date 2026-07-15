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
// sprite; the fill sprite is LEFT-anchored (`sprite.center.set(0, 0.5)`) with its x-scale set to
// `progress * widthMeters`, so it grows rightward from a fixed left edge — the conventional
// "progress bar" visual. `depthTest: false` + a high `renderOrder` (same convention as censor.ts)
// so the bar reliably reads above nearby furniture it may be co-located with (e.g. extinguishing a
// fire right next to the stove).

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

export interface ProgressBarInstance {
  /** `active` = whether the current action has a duration in progress (game/main.ts's
   *  `durationState !== null`); when false the bar is hidden and position/scale aren't touched.
   *  `progress` = elapsed/total, any range (clamped internally). `heightMeters` = the character's
   *  authored standing height (data.tuning.character?.heightMeters, same fallback convention as
   *  censor.ts's `active`/`heightMeters` params). */
  update(characterRoot: THREE.Object3D, active: boolean, progress: number, heightMeters: number): void;
  dispose(): void;
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
  fill.center.set(0, 0.5); // left-anchored — grows rightward, see module doc comment's RENDERING note
  fill.position.x = -config.widthMeters / 2; // fixed left edge, aligned to the bg track's left edge
  fill.scale.set(0, config.heightMeters * 0.7, 1); // slightly inset vs. the bg track; starts empty

  pivot.add(bg, fill);
  scene.add(pivot);

  return {
    update(characterRoot, active, progress, heightMeters) {
      pivot.visible = active;
      if (!active) return;
      pivot.position.set(characterRoot.position.x, progressBarAnchorHeight(heightMeters, config.yOffset), characterRoot.position.z);
      fill.scale.x = config.widthMeters * clampProgress01(progress);
    },
    dispose() {
      scene.remove(pivot);
      bgMat.dispose();
      fillMat.dispose();
    },
  };
}
