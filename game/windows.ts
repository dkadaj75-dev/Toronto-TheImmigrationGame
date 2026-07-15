// windows.ts — visual-only wall openings/panes for map.windows[] (ROADMAP_NEXT item 9).
//
// Windows are ALWAYS visual-only: they never affect the nav grid or wall collision. Unlike a
// door — whose opening is a real gap encoded as separate `walls[]` segments (see nav.ts's "walls
// already have door gaps" comment) — a window sits on top of an UNBROKEN wall segment; the wall
// stays a single impassable box exactly as authored, and a window just draws a translucent pane
// over it, "above walk height" per the design brief. So there's no hinge, no swing, no open/close
// state machine, and no nav-grid interaction at all — just placement math for a pane rectangle.
//
// Pure geometry here (headless-tested in test/windows.test.ts); game/world.ts's buildWorld is the
// thin three.js layer that turns this into a frame + pane mesh pair, reusing the same base-yaw
// convention as game/doors.ts's doorBaseYawDeg so a window's long axis lies flush along whichever
// wall it's set into.

import type { TuningData } from './data';

/** The shape of a map.windows[] entry — mirrors doors.ts's DoorEntry shape/semantics for `at`/
 *  `orientation`/`width` (a point on a wall + which way the wall runs). */
export interface WindowEntry {
  at: [number, number];
  orientation: 'vertical' | 'horizontal';
  width?: number;
  /** Optional window-category asset — carried for a future real mesh; not consumed by the
   *  current pane-stand-in rendering (see world.ts). */
  assetId?: string;
}

export interface WindowConfig {
  width: number;
  height: number;
  sillHeight: number;
}

/** Sparse per-window `width` merged over tuning.windows defaults (mirrors doors.ts's
 *  resolveDoorConfig sparse-merge convention). height/sillHeight are tuning-only today — no
 *  per-window override exists yet, same "data now, more knobs later if needed" precedent as
 *  other sparse tuning blocks in this repo. */
export function resolveWindowConfig(entry: WindowEntry, tuning: TuningData): WindowConfig {
  const t = tuning.windows;
  return {
    width: entry.width ?? t?.width ?? 1.2,
    height: t?.height ?? 1.1,
    sillHeight: t?.sillHeight ?? 0.9,
  };
}

const PANE_THICKNESS = 0.06;

/** The fixed yaw (degrees) that lays the pane's long axis flush along the wall it sits on — the
 *  SAME rule as doors.ts's doorBaseYawDeg: a 'vertical' wall (running along world Z) needs the
 *  pane rotated 90°, a 'horizontal' wall (running along world X) needs no rotation. */
export function windowBaseYawDeg(orientation: 'vertical' | 'horizontal'): number {
  return orientation === 'vertical' ? 90 : 0;
}

export interface WindowPaneRect {
  /** world-space center: x, y (vertical center of the pane), z */
  position: [number, number, number];
  /** width (along the wall), height, thickness */
  size: [number, number, number];
  yawDeg: number;
}

/** World-space box params for the glass-pane stand-in, centered exactly on `entry.at` at
 *  sillHeight + half the pane height. */
export function windowPaneRect(entry: WindowEntry, config: WindowConfig): WindowPaneRect {
  return {
    position: [entry.at[0], config.sillHeight + config.height / 2, entry.at[1]],
    size: [config.width, config.height, PANE_THICKNESS],
    yawDeg: windowBaseYawDeg(entry.orientation),
  };
}
