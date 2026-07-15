// censor.ts — Sims-style censor pixelation over the sim while a `censor: true` action (shower,
// use_toilet — ROADMAP_NEXT B2-3) is the ACTIVE one. Mirrors game/marker.ts's split: pure logic
// (regen cadence, anchor height) is headless-tested here with zero THREE dependency; the thin
// three.js layer below turns it into a live camera-facing quad tracking the character.
//
// ANCHOR DESIGN (same precedent as marker.ts's module doc comment): the quad is an INDEPENDENT
// top-level object, not parented under the character root — game/main.ts's loadCharacter() calls
// sim.clear() on every rig (re)load, which would silently delete a child object mid-shower.
// Position is copied from the character root every frame (translation only); no rotation is
// needed at all here because a THREE.Sprite always faces the camera by construction (three.js
// built-in behavior), which is exactly the "camera-facing quad" the design brief asks for — no
// manual look-at math, and it automatically degrades gracefully to "sprites don't rotate" the
// same way marker.ts's billboard image kind does.
//
// VISIBILITY: driven by polling `agent.current?.action.censor` every render frame (see
// game/main.ts) rather than onActionStart/onActionStop events — that means EVERY stop path
// (natural auto-stop, player cancel, override) hides the quad uniformly for free, with no extra
// wiring, mirroring accidents.ts's documented "onActionStop fires for every stop reason" rule
// (here we don't even need the event: agent.current already reflects "nothing running" the
// instant a stop happens).
//
// REAL-TIME, NOT SIM-TIME (documented per the design brief's "real-time ok, document"): mosaic
// regeneration uses raw frame dt, not the sdt (pause/2x/3x-scaled) clock the animation
// mixer/doors/marker use. This is deliberate and the OPPOSITE of marker.ts's choice: marker's
// spin/bob must freeze on pause because they're diegetic character motion; this quad is a pure
// screen-space VFX overlay with no simulation meaning, and continuing to redraw its mosaic while
// paused reads as "the game is still alive", not as a physics/logic leak — same category as
// ClickCue/camera staying real-time (game/main.ts's render loop comment on `cue.update(dt)`).

import * as THREE from 'three';

/** World-space quad size (meters) — "~0.8×1.0m" per the design brief. */
export const CENSOR_WIDTH = 0.8;
export const CENSOR_HEIGHT = 1.0;

/** Mosaic redraw cadence — "regenerated a few times per second" per the design brief. Real-time
 *  seconds (see module doc comment), not sim time. */
export const MOSAIC_REGEN_INTERVAL_SECONDS = 1 / 6;

/** Torso height as a fraction of the character's authored standing height (heightMeters) — a
 *  fixed approximation, not bone/socket-driven (same "documented, not fixed" precedent as
 *  marker.ts's markerAnchorHeight doc comment: precise anchoring would need real skeleton
 *  lookups, out of scope here). Centers the quad roughly chest-height on a STANDING sim, which is
 *  the only pose `censor` currently ships on (shower is a standing action; use_toilet is a sit
 *  pose but the quad's fixed torso height still reads fine seated — no separate seated case). */
export const TORSO_HEIGHT_RATIO = 0.55;

export function censorAnchorHeight(heightMeters: number): number {
  return (heightMeters || 0) * TORSO_HEIGHT_RATIO;
}

/** True once `elapsedSinceRegen` has crossed the regen interval — pure cadence check (the same
 *  "just tell me when to redraw" shape as marker.ts's spinAngleDeg/bobOffset, testable with no
 *  THREE/canvas dependency). */
export function shouldRegenMosaic(elapsedSinceRegen: number, intervalSeconds = MOSAIC_REGEN_INTERVAL_SECONDS): boolean {
  return elapsedSinceRegen >= intervalSeconds;
}

/** 8x8 blocks — coarse "Sims pixelation" look, not a fine blur. */
const MOSAIC_GRID = 8;

function drawMosaic(ctx: CanvasRenderingContext2D, size: number) {
  const cell = size / MOSAIC_GRID;
  for (let y = 0; y < MOSAIC_GRID; y++) {
    for (let x = 0; x < MOSAIC_GRID; x++) {
      const g = 90 + Math.floor(Math.random() * 120); // grayscale block, no skin-tone assumption
      ctx.fillStyle = `rgb(${g},${g},${g})`;
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }
}

export interface CensorInstance {
  /** `dtSeconds` is RAW frame delta (real-time, not sim time — see module doc comment).
   *  `active` = the current action's `censor` flag; when false the quad is hidden and no mosaic
   *  work happens. `heightMeters` = data.tuning.character.heightMeters (torso anchor input). */
  update(dtSeconds: number, characterRoot: THREE.Object3D, active: boolean, heightMeters: number): void;
  dispose(): void;
}

export function createCensorInstance(scene: THREE.Object3D): CensorInstance {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  drawMosaic(ctx, size);
  const texture = new THREE.CanvasTexture(canvas);
  // depthTest off + high renderOrder: the quad must reliably cover the sim it's co-located with
  // rather than z-fight against the character mesh occupying the exact same world position.
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.renderOrder = 999;
  sprite.scale.set(CENSOR_WIDTH, CENSOR_HEIGHT, 1);
  sprite.visible = false;
  scene.add(sprite);

  let regenElapsed = 0;

  return {
    update(dtSeconds, characterRoot, active, heightMeters) {
      sprite.visible = active;
      if (!active) return;
      sprite.position.set(characterRoot.position.x, censorAnchorHeight(heightMeters), characterRoot.position.z);
      regenElapsed += dtSeconds;
      if (shouldRegenMosaic(regenElapsed)) {
        regenElapsed = 0;
        drawMosaic(ctx, size);
        texture.needsUpdate = true;
      }
    },
    dispose() {
      scene.remove(sprite);
      texture.dispose();
      material.dispose();
    },
  };
}
