// exterior.ts — PURE config resolution for a map's simplified 3D exterior environment (ROADMAP_APT
// D4). No DOM / no three.js — just defaults and guards, so it is headless-testable (test/exterior.
// test.ts). The thin three.js render layer (game/world.ts) consumes ResolvedExterior to build the
// sky color, ground plane, distant backdrop, and fog; day/night tinting is applied by world.ts's
// applyDayNight the same way the lights are tinted.
//
// Everything is sparse: an absent block (or every field absent) resolves to `present: false`, which
// world.ts treats as today's void — nothing is rendered outside the apartment.

import type { ExteriorConfig } from './data';

export const DEFAULT_BACKDROP_DISTANCE = 60;
export const DEFAULT_FOG_NEAR = 40;
export const DEFAULT_FOG_FAR = 120;
/** Neutral hazy grey used only when a fog block exists but names no color and the map has no sky. */
export const DEFAULT_FOG_COLOR = '#cfd8e3';

export interface ResolvedFog {
  color: string;
  near: number;
  far: number;
}

export interface ResolvedBackdrop {
  /** raw path as authored (world.ts runs it through normalizeMeshUrl before loading) */
  path: string;
  /** `.glb`/`.gltf` → a single distant mesh; anything else → a wraparound billboard image ring */
  kind: 'mesh' | 'image';
  distance: number;
}

export interface ResolvedExterior {
  /** false = render nothing (today's void). true = at least one of the fields below is set. */
  present: boolean;
  skyColor: string | null;
  groundColor: string | null;
  backdrop: ResolvedBackdrop | null;
  fog: ResolvedFog | null;
}

/** A usable color string is any non-empty trimmed string (THREE.Color accepts hex + CSS names). */
function cleanColor(c: unknown): string | null {
  return typeof c === 'string' && c.trim() ? c.trim() : null;
}

/** Positive finite number, else the fallback. Guards NaN/Infinity/≤0 authoring mistakes. */
function positiveOr(n: unknown, fallback: number): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : fallback;
}

function backdropKind(path: string): 'mesh' | 'image' {
  return /\.(glb|gltf)$/i.test(path) ? 'mesh' : 'image';
}

export function resolveBackdrop(cfg: ExteriorConfig | undefined | null): ResolvedBackdrop | null {
  const path = typeof cfg?.backdrop === 'string' ? cfg.backdrop.trim() : '';
  if (!path) return null;
  return { path, kind: backdropKind(path), distance: positiveOr(cfg?.backdropDistance, DEFAULT_BACKDROP_DISTANCE) };
}

export function resolveFog(cfg: ExteriorConfig | undefined | null): ResolvedFog | null {
  const fog = cfg?.fog;
  if (!fog || typeof fog !== 'object') return null;
  // near: finite and ≥ 0, else the default. far: finite, else the default; and always kept a
  // positive span beyond near (a far ≤ near would make THREE.Fog render as an instant grey wall).
  const near = typeof fog.near === 'number' && Number.isFinite(fog.near) && fog.near >= 0 ? fog.near : DEFAULT_FOG_NEAR;
  let far = typeof fog.far === 'number' && Number.isFinite(fog.far) ? fog.far : DEFAULT_FOG_FAR;
  if (far <= near) far = near + (DEFAULT_FOG_FAR - DEFAULT_FOG_NEAR);
  const color = cleanColor(fog.color) ?? cleanColor(cfg?.skyColor) ?? DEFAULT_FOG_COLOR;
  return { color, near, far };
}

export function resolveExterior(cfg: ExteriorConfig | undefined | null): ResolvedExterior {
  const skyColor = cleanColor(cfg?.skyColor);
  const groundColor = cleanColor(cfg?.groundColor);
  const backdrop = resolveBackdrop(cfg);
  const fog = resolveFog(cfg);
  const present = !!(skyColor || groundColor || backdrop || fog);
  return { present, skyColor, groundColor, backdrop, fog };
}
