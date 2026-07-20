// stateviz.ts — pure state-visuals resolution (screen overlays + per-state mesh variants).
// Follows the strict split (AGENTS.md): this module is headless-testable — no DOM, no three.js.
// The thin THREE layer lives in world.ts (attachScreenOverlay / attachMesh state variants /
// setAssetObjectOn) and the GIF playback machinery is reused from sprites.ts.
//
// Both features key off the SAME per-instance power state the light/sound already use
// (assetstate.ts AssetStateRegistry): a designer flips nothing new — turning the TV ON shows its
// screen overlay exactly when the glow light and sound start.

import type { AssetDef } from './data';

export interface ResolvedScreenOverlay {
  image: string;
  widthMeters: number;
  heightMeters: number;
  /** Asset-LOCAL meters from the footprint center at ground level; rotates with the instance. */
  offset: [number, number, number];
  yawDeg: number;
  pitchDeg: number;
  fps?: number;
  doubleSided: boolean;
  when: 'on' | 'off';
}

function finitePositive(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Sparse → full overlay config; null when the asset has no usable overlay (no image path). */
export function resolveScreenOverlay(def: Pick<AssetDef, 'screenOverlay'>): ResolvedScreenOverlay | null {
  const raw = def.screenOverlay;
  const image = raw?.image?.trim();
  if (!image) return null;
  const offset = raw?.offset;
  return {
    image,
    widthMeters: finitePositive(raw?.widthMeters, 1),
    heightMeters: finitePositive(raw?.heightMeters, 0.6),
    offset: Array.isArray(offset) && offset.length === 3 && offset.every((v) => Number.isFinite(v))
      ? [offset[0], offset[1], offset[2]] : [0, 0, 0],
    yawDeg: finiteOr(raw?.yawDeg, 0),
    pitchDeg: finiteOr(raw?.pitchDeg, 0),
    fps: finitePositive(raw?.fps, 0) || undefined,
    doubleSided: raw?.doubleSided === true,
    when: raw?.when === 'off' ? 'off' : 'on',
  };
}

/** Whether the overlay should be visible for the given instance power state. */
export function overlayVisibleWhenOn(overlay: Pick<ResolvedScreenOverlay, 'when'>, on: boolean): boolean {
  return overlay.when === 'on' ? on : !on;
}

/** The mesh path a placed instance should SHOW for a power state: the state's variant if authored
 *  (non-empty), else the base `mesh`. Pure string resolution — normalization to a URL stays with
 *  the caller (world.ts normalizeMeshUrl), matching how `mesh` itself flows. */
export function meshForState(def: Pick<AssetDef, 'mesh' | 'stateMeshes'>, on: boolean): string {
  const variant = on ? def.stateMeshes?.on : def.stateMeshes?.off;
  return variant?.trim() || def.mesh;
}

/** Every distinct mesh path this asset can ever show (base first) — what world.ts must load. */
export function allStateMeshes(def: Pick<AssetDef, 'mesh' | 'stateMeshes'>): string[] {
  const paths = [def.mesh, def.stateMeshes?.on?.trim(), def.stateMeshes?.off?.trim()];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    if (p && !seen.has(p)) { seen.add(p); out.push(p); }
  }
  return out;
}
