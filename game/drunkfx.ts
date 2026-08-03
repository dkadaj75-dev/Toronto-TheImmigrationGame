// drunkfx.ts — drunk-screen effect math, PURE half (ROADMAP_NEXT "Drunk screen effect", §7.76).
//
// PROJECT_CONTEXT §7.75 models drunkenness as the INVERTED `sobriety` need (full = sober). This
// module turns that need's live value into a screen-effect frame — blur/saturation, a vignette
// opacity, and a slow view sway — that INTENSIFIES as sobriety falls. It is deliberately split
// from rendering (the strict pure-logic/thin-layer convention): everything here is a deterministic
// function of (sobriety, time, tuning), so tests never need a DOM or three.js. game/main.ts's
// render loop applies the result as CSS on the WebGL canvas plus one gradient overlay div.
//
// Design decisions, mirrored from precedents:
//   - All knobs live in `tuning.drunkFx` (no magic numbers) and every field is sparse with the
//     defaults below, so an absent block just works and old fixtures stay valid.
//   - The sway clock runs on RAW dt in the caller (pure cosmetic — the ghost-bounce precedent,
//     §7.6 addendum): a paused game keeps gently swaying, but intensity itself is frozen because
//     sobriety only changes on sim ticks.
//   - Malformed tuning degrades to the defaults instead of throwing (resolveVar's never-throw
//     precedent).

export interface DrunkFxTuning {
  /** Literal false disables the whole effect. Absent = enabled. */
  enabled?: boolean;
  /** Which need drives the effect. Default 'sobriety' (the §7.75 inverted need). */
  needId?: string;
  /** The effect ramps in below this need value and peaks at 0. Default 70. */
  startBelowSobriety?: number;
  /** CSS blur radius at peak drunkenness, px. Default 2.5. */
  maxBlurPx?: number;
  /** CSS saturate() at peak (1 = unchanged). Default 1.6 — a boozy, over-warm look. */
  maxSaturate?: number;
  /** Vignette overlay opacity at peak, 0..1. Default 0.55. */
  maxVignette?: number;
  /** View-sway roll at peak, degrees. Default 1.5. */
  wobbleMaxDeg?: number;
  /** View-sway drift at peak, px. Default 10. */
  wobbleMaxShiftPx?: number;
  /** Base sway frequency, Hz. Default 0.22 — a slow ocean roll, not a shake. */
  wobbleHz?: number;
}

/** One resolved screen-effect frame. All zeros/identity when sober (or disabled). */
export interface DrunkFxFrame {
  /** 0 (sober / disabled) .. 1 (sobriety 0). */
  intensity: number;
  blurPx: number;
  saturate: number;
  vignetteOpacity: number;
  rollDeg: number;
  shiftXPx: number;
  shiftYPx: number;
  /** Slight zoom hiding the edges the roll/shift would otherwise expose. 1 when sober. */
  scale: number;
}

const finite = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export const DRUNK_FX_DEFAULTS = {
  needId: 'sobriety',
  startBelowSobriety: 70,
  maxBlurPx: 2.5,
  maxSaturate: 1.6,
  maxVignette: 0.55,
  wobbleMaxDeg: 1.5,
  wobbleMaxShiftPx: 10,
  wobbleHz: 0.22,
} as const;

/** 0 at/above the ramp threshold, 1 at sobriety 0, linear between. Disabled/malformed => 0. */
export function drunkIntensity(sobriety: number, cfg?: DrunkFxTuning): number {
  if (cfg?.enabled === false) return 0;
  const start = finite(cfg?.startBelowSobriety, DRUNK_FX_DEFAULTS.startBelowSobriety);
  if (!(start > 0) || !Number.isFinite(sobriety)) return 0;
  return clamp01((start - sobriety) / start);
}

/**
 * Resolve the full effect frame for a moment in time. `tSeconds` is the caller's raw cosmetic
 * clock; the three sway channels run at deliberately non-harmonic frequency ratios so the drift
 * never settles into a visible repeating loop.
 */
export function drunkFxFrame(sobriety: number, tSeconds: number, cfg?: DrunkFxTuning): DrunkFxFrame {
  const intensity = drunkIntensity(sobriety, cfg);
  if (intensity <= 0) {
    return { intensity: 0, blurPx: 0, saturate: 1, vignetteOpacity: 0, rollDeg: 0, shiftXPx: 0, shiftYPx: 0, scale: 1 };
  }
  const t = Number.isFinite(tSeconds) ? tSeconds : 0;
  const hz = Math.max(0, finite(cfg?.wobbleHz, DRUNK_FX_DEFAULTS.wobbleHz));
  const w = 2 * Math.PI * hz * t;
  const rollAmp = Math.max(0, finite(cfg?.wobbleMaxDeg, DRUNK_FX_DEFAULTS.wobbleMaxDeg)) * intensity;
  const shiftAmp = Math.max(0, finite(cfg?.wobbleMaxShiftPx, DRUNK_FX_DEFAULTS.wobbleMaxShiftPx)) * intensity;
  const rollDeg = Math.sin(w) * rollAmp;
  const shiftXPx = Math.sin(w * 0.83 + 1.3) * shiftAmp;
  const shiftYPx = Math.cos(w * 0.61 + 0.7) * shiftAmp * 0.6;
  return {
    intensity,
    blurPx: Math.max(0, finite(cfg?.maxBlurPx, DRUNK_FX_DEFAULTS.maxBlurPx)) * intensity,
    saturate: 1 + (Math.max(1, finite(cfg?.maxSaturate, DRUNK_FX_DEFAULTS.maxSaturate)) - 1) * intensity,
    vignetteOpacity: clamp01(finite(cfg?.maxVignette, DRUNK_FX_DEFAULTS.maxVignette)) * intensity,
    rollDeg,
    shiftXPx,
    shiftYPx,
    // Worst-case roll+shift exposes ~(shift + tan(roll)·halfEdge) at the borders; a small
    // intensity-scaled zoom (3% at peak) more than covers the defaults without being noticeable.
    scale: 1 + 0.03 * intensity,
  };
}

/** CSS `filter` for the canvas. Empty string when the frame is identity (lets the caller unset). */
export function drunkFilterCss(frame: DrunkFxFrame): string {
  if (frame.intensity <= 0) return '';
  const parts: string[] = [];
  if (frame.blurPx > 0.01) parts.push(`blur(${frame.blurPx.toFixed(2)}px)`);
  if (Math.abs(frame.saturate - 1) > 0.005) parts.push(`saturate(${frame.saturate.toFixed(3)})`);
  return parts.join(' ');
}

/** CSS `transform` for the canvas sway. Empty string when identity. */
export function drunkTransformCss(frame: DrunkFxFrame): string {
  if (frame.intensity <= 0) return '';
  return `translate(${frame.shiftXPx.toFixed(1)}px, ${frame.shiftYPx.toFixed(1)}px) rotate(${frame.rollDeg.toFixed(2)}deg) scale(${frame.scale.toFixed(3)})`;
}
