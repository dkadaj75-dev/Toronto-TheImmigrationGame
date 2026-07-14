// marker.ts — Sims-style overhead marker floating above the character's head (PROJECT_CONTEXT.md
// §7.7). Split like doors.ts/accidents.ts/sprites.ts: pure logic (config resolution, bob/spin
// math, mesh-kind classification) is headless-tested in test/marker.test.ts with zero THREE
// dependency; the thin three.js layer below turns that into a live group tracking the character.
//
// ANCHOR DESIGN (documented finding, per the task brief's "check how sit/lie perch transforms are
// applied — to the rig mesh or the root; document what you found"): sim.ts's `applyPose` only ever
// rotates the character ROOT (`object.rotation.x = -Math.PI/2`) for the pre-rig CAPSULE stand-in
// (`!agent.hasRig`) — the real rigged character never rotates its root for sit/lie; only its
// `position.y` changes (seat/bed perch height), the seated/lying visual itself comes from the
// animation clip. So literal `THREE.Object3D` parenting under the character root would be safe
// from tilt in the common case — BUT `game/main.ts`'s `loadCharacter()` calls `sim.clear()` on
// every rig (re)load (first load, or a `meshPath` hot-reload edit), which would silently DELETE a
// marker parented there. Rather than special-case re-adding the marker after every rig reload, the
// marker's pivot is instead added as an INDEPENDENT top-level object (a sibling of the character
// root, not a child) and its position is copied from the character root every frame — TRANSLATION
// ONLY, rotation is deliberately never read. This makes the marker immune BY CONSTRUCTION to any
// current or future root-rotation trick (the capsule tip hack, a facing snap, a future pose), not
// merely because today's specific cases were audited, and it sidesteps the `sim.clear()` hazard
// entirely. The one tradeoff: the marker's height doesn't know about seated/lying poses adjusting
// the character's TRUE head height (see markerAnchorHeight's doc comment) — documented, not fixed,
// same "known limitation, future refinement" precedent as this repo's other approximate transforms.
//
// SPIN CONVENTION: since the pivot never inherits the character's rotation, a 3D marker's own
// `visual.rotation.y` IS already a world-space yaw with no counter-rotation needed — spin simply
// advances it every frame. Sprites (THREE.Sprite) ignore rotation entirely (full camera billboard,
// built into three.js), so §7.7's "sprites don't spin" falls out for free — no special-casing.
//
// SCALE CONVENTION: unlike an ordinary AssetDef, `scale` is NOT baked into the loaded mesh via
// meshFit (which would only re-apply on a mesh reload) — it's applied continuously to the OUTER
// `visual` group every frame, so it (and yOffset/bob/spin) stay instantly live-tunable for every
// mesh kind, including the async GLB/sprite ones, with zero reload. Only the `mesh` PATH triggers
// an async rebuild — exactly the §7.7 "recreate marker on marker.mesh change, re-tune numbers in
// place otherwise" rule.

import * as THREE from 'three';
import type { AssetDef, CharacterTuning, MarkerTuning } from './data';
import { classifyMeshPath } from './sprites';
import { attachMesh } from './world';

// ==================================================================== pure logic (headless-tested)

export interface MarkerConfig {
  mesh: string;
  yOffset: number;
  scale: number;
  spinDegPerSec: number;
  bobAmplitude: number;
  bobHz: number;
}

/** Shipped defaults (data/tuning.json documents the same numbers, §7.7): tuned against the
 *  shipped 1.55m character — yOffset clears a real head, scale keeps the marker a modest ~0.3m
 *  (not overpowering the character), spin/bob read as a gentle "alive" plumbob idle. */
export const MARKER_DEFAULTS: MarkerConfig = {
  mesh: '', yOffset: 0.35, scale: 0.3, spinDegPerSec: 90, bobAmplitude: 0.05, bobHz: 0.8,
};

/** Sparse `tuning.character.marker` merged over MARKER_DEFAULTS — same convention as
 *  sprites.ts's resolveSpriteConfig / doors.ts's resolveDoorConfig. */
export function resolveMarkerConfig(marker: MarkerTuning | undefined): MarkerConfig {
  return {
    mesh: (marker?.mesh ?? MARKER_DEFAULTS.mesh).trim(),
    yOffset: marker?.yOffset ?? MARKER_DEFAULTS.yOffset,
    scale: marker?.scale ?? MARKER_DEFAULTS.scale,
    spinDegPerSec: marker?.spinDegPerSec ?? MARKER_DEFAULTS.spinDegPerSec,
    bobAmplitude: marker?.bobAmplitude ?? MARKER_DEFAULTS.bobAmplitude,
    bobHz: marker?.bobHz ?? MARKER_DEFAULTS.bobHz,
  };
}

export type MarkerMeshKind = 'default' | 'model' | 'image';

/** Empty/whitespace mesh path → the built-in default octahedron; otherwise defers to the SAME
 *  extension rule every other mesh-loading call site uses (game/sprites.ts's classifyMeshPath) —
 *  no separate/duplicated extension logic for the marker (§7.5's "one place" rule). */
export function classifyMarkerMesh(mesh: string): MarkerMeshKind {
  const trimmed = mesh.trim();
  if (!trimmed) return 'default';
  return classifyMeshPath(trimmed);
}

/** Vertical bob offset (meters) at `elapsedSeconds` of accumulated SIM time — a plain sine wave;
 *  amplitude in meters, hz = full cycles per second. Zero amplitude or hz is a flat 0, no NaN. */
export function bobOffset(elapsedSeconds: number, amplitudeM: number, hz: number): number {
  return amplitudeM * Math.sin(2 * Math.PI * hz * elapsedSeconds);
}

/** World-yaw spin angle in degrees, normalized to [0,360) — SIM time, so pause freezes it and
 *  2x/3x speed it up like everything else. Handles negative `degPerSec` (spin the other way). */
export function spinAngleDeg(elapsedSeconds: number, degPerSec: number): number {
  return (((degPerSec * elapsedSeconds) % 360) + 360) % 360;
}

/** Anchor height above the floor (meters) while the character is standing/walking: its authored
 *  height plus the marker's own vertical offset. KNOWN LIMITATION (documented, not fixed this
 *  slice): while sitting/lying, the character root's `position.y` shifts to `sitHeight`/
 *  `lieHeight` (seat-surface alignment, not the seated character's true head height) — the
 *  marker's pivot tracks that Y too (see createMarkerInstance), so `heightMeters` no longer
 *  represents the seated/lying sim's real head height and the marker will read as floating too
 *  high above a seated/lying sim. Precise pose-aware anchoring would need bone/socket lookups,
 *  out of scope for this slice — same "documented, future refinement" precedent as this repo's
 *  other approximate transforms (e.g. PROJECT_CONTEXT.md §8's HUD-collision accepted tradeoff). */
export function markerAnchorHeight(heightMeters: number, yOffset: number): number {
  return heightMeters + yOffset;
}

/** Synthetic footprint (meters) every marker mesh kind is fit to. Deliberately NOT combined with
 *  the live `scale` tuning field (see the module doc comment's SCALE CONVENTION) — scale is
 *  applied continuously to the wrapper group instead, so this stays a fixed constant. */
export const MARKER_BASE_SIZE = 1;

/** Synthetic AssetDef handed to world.ts's shared `attachMesh` so the marker's mesh resolution
 *  goes through the EXACT §7.5 pipeline (extension → GLB vs. billboard sprite) instead of a
 *  reimplementation. Only `id`/`mesh`/`footprint`/`sprite` are load-bearing; the rest are inert
 *  placeholder values required by the AssetDef shape. */
export function markerAssetDef(meshPath: string): AssetDef {
  return {
    id: 'overhead-marker',
    name: 'Overhead marker',
    category: 'marker',
    mesh: meshPath,
    buyPrice: 0,
    sellPrice: 0,
    environmentScore: 0,
    footprint: [MARKER_BASE_SIZE, MARKER_BASE_SIZE],
    interactions: [],
    sprite: { orientation: 'billboard' },
  };
}

// ==================================================================== three.js layer

const OCTA_RADIUS = MARKER_BASE_SIZE / 2; // matches the footprint GLBs/sprites are fit to, so `scale` behaves identically across every mesh kind
const OCTA_COLOR = 0x3ec93e; // flat, always-readable green — MeshBasicMaterial (ignores lighting) so the marker reads the same at night as in daylight, matching a Sims plumbob's always-visible role
const OCTA_ELONGATION_Y = 1.4; // "slightly elongated like a plumbob" per §7.7

function buildDefaultOctahedron(): THREE.Mesh {
  const geo = new THREE.OctahedronGeometry(OCTA_RADIUS);
  geo.scale(1, OCTA_ELONGATION_Y, 1);
  const mat = new THREE.MeshBasicMaterial({ color: OCTA_COLOR });
  return new THREE.Mesh(geo, mat);
}

function disposeVisual(visual: THREE.Group) {
  visual.traverse((o) => {
    if (o instanceof THREE.Mesh && !o.userData.sharedResource) { // GLB clones share the cached template's buffers, same rule as world.ts's disposeGroup
      o.geometry.dispose();
      const m = o.material;
      (Array.isArray(m) ? m : [m]).forEach((mm) => mm?.dispose?.());
    }
  });
}

export interface MarkerInstance {
  /** The independent top-level object added into the scene — NOT a child of the character root,
   *  see the module doc comment's ANCHOR DESIGN. Exposed for tests/diagnostics; callers don't
   *  need to touch it beyond initial scene.add (done internally) and eventual disposal. */
  readonly pivot: THREE.Group;
  /** Advance spin/bob/GIF frames by `dtSeconds` of SIM time (0 while paused/in buy mode, exactly
   *  like doors/accidents/the animation mixer) and re-sync position from the character root.
   *  `character` is read fresh every call so numeric field edits apply live with no rebuild;
   *  the `mesh` path is the one field that triggers an async rebuild when it changes. */
  update(dtSeconds: number, character: CharacterTuning): void;
  dispose(): void;
}

/**
 * Creates the marker and adds it to `scene`. `characterRoot` is read (position only, every
 * update()) to follow walking/turning — never its rotation, see the module doc comment.
 */
export function createMarkerInstance(
  scene: THREE.Object3D,
  characterRoot: THREE.Object3D,
  character: CharacterTuning,
): MarkerInstance {
  const pivot = new THREE.Group();
  pivot.name = 'overhead-marker';
  const visual = new THREE.Group();
  visual.name = 'overhead-marker-visual';
  pivot.add(visual);
  scene.add(pivot);

  let elapsed = 0;
  let meshSig = ''; // only the mesh path triggers a rebuild — see SCALE CONVENTION above

  const rebuild = (mesh: string) => {
    meshSig = mesh;
    disposeVisual(visual);
    visual.clear();
    visual.add(buildDefaultOctahedron()); // instant stand-in — same philosophy as every other mesh call site
    if (classifyMarkerMesh(mesh) !== 'default') {
      attachMesh(visual, markerAssetDef(mesh)); // async swap; attachMesh itself keeps the stand-in on any failure
    }
  };
  rebuild(resolveMarkerConfig(character.marker).mesh);

  return {
    pivot,
    update(dtSeconds, char) {
      elapsed += dtSeconds;
      pivot.position.copy(characterRoot.position); // translation only — rotation deliberately never read, see ANCHOR DESIGN

      const cfg = resolveMarkerConfig(char.marker);
      if (cfg.mesh !== meshSig) rebuild(cfg.mesh);

      const anchorY = markerAnchorHeight(char.heightMeters ?? 0, cfg.yOffset);
      visual.position.set(0, anchorY + bobOffset(elapsed, cfg.bobAmplitude, cfg.bobHz), 0);
      visual.scale.setScalar(cfg.scale);
      // Spin applies to every 3D mesh — the built-in default octahedron AND a loaded .glb — but
      // never an 'image' kind: THREE.Sprite always faces the camera regardless of rotation
      // (full billboard, built into three.js), so spinning it would be a silent no-op at best
      // and fight the billboard behavior at worst. Only 'image' opts out.
      visual.rotation.y = classifyMarkerMesh(cfg.mesh) === 'image'
        ? 0
        : THREE.MathUtils.degToRad(spinAngleDeg(elapsed, cfg.spinDegPerSec));

      visual.traverse((o) => { o.userData.spriteUpdate?.(dtSeconds); }); // §7.5 GIF frame advance, same sim time
    },
    dispose() {
      scene.remove(pivot);
      disposeVisual(visual);
    },
  };
}
