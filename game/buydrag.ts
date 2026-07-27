// buydrag.ts — smartphone drag gestures for Buy Mode (designer request 2026-07-25: "tap and
// slide" placement). Split like doors.ts/accidents.ts/buymode.ts: the pure half (DragTracker's
// tap-vs-drag state machine, the grabsGhost footprint hit test) is headless-tested in
// test/buydrag.test.ts with zero THREE/DOM dependency; the thin DOM layer (BuyModeDrag) below
// turns pointer events on the game canvas into buymode.ts calls via main.ts-supplied hooks.
//
// GESTURES (all only while buyMode.active — outside buy mode nothing here reacts at all):
//   - Finger down on a placed (selectable) object + slide → the object turns into the usual
//     move ghost and follows the finger; lifting the finger confirms the move if the spot is
//     valid (invalid → the ghost stays put with the normal tap-adjust controls).
//   - Finger down on the active placement/move ghost + slide → same follow/release behavior.
//   - A plain tap (never left the slop radius) is deliberately NOT handled here — input.ts's
//     TapInput fires for it as before, and main.ts's handleBuyModeTap now pivots the tapped
//     object in place (the "one tap rotates" half of the request).
//
// CAMERA COEXISTENCE: TouchCamera pans on any one-finger drag over the canvas. A drag that
// begins on furniture/the ghost must move the furniture, not the camera, so camera.ts gained an
// `acceptPointer` predicate — main.ts points it at this class's `wouldClaim`/`engaged` so the
// camera simply never tracks a claimed pointer. Drags that start on empty floor still pan.

import type * as THREE from 'three';
import { footprintRect } from './accidents';

/** Matches input.ts's TAP_SLOP_PX so "tap" and "drag" mean the same thing in both modules —
 *  a claimed pointer that stays inside this radius falls through to TapInput's tap (rotate). */
export const DRAG_SLOP_PX = 8;

/** Designer request 2026-07-25 follow-up: MAINTAINING the tap/click on a placed object (or the
 *  ghost) picks it up without needing to cross the slop radius first — the ghost lifts in place
 *  (hover + bounce, see buymode.ts's ghostHoverOffset) and then follows the finger. MUST stay
 *  greater than input.ts's TAP_MAX_MS (400): a release before 400ms is a tap (rotate), a hold
 *  past this threshold is a pickup, and the gap between the two means no gesture can ever be
 *  both — no cross-module suppression flag needed. */
export const LONG_PRESS_MS = 450;

export type DragMoveResult = 'none' | 'start' | 'move';
export type DragEndResult = 'none' | 'tap' | 'drop';
export type DragCancelResult = 'none' | 'pending' | 'drag';

/** Pure tap-vs-drag state machine for ONE tracked pointer (a second finger is ignored — it
 *  means pinch/camera, never furniture). No DOM, no timers: callers feed it pointer events. */
export class DragTracker {
  private pointerId: number | null = null;
  private startX = 0;
  private startY = 0;
  private dragging = false;

  constructor(private slopPx = DRAG_SLOP_PX) {}

  get isTracking(): boolean { return this.pointerId !== null; }
  get isDragging(): boolean { return this.dragging; }

  /** Starts tracking; refuses (returns false) while another pointer is already tracked. */
  begin(pointerId: number, x: number, y: number): boolean {
    if (this.pointerId !== null) return false;
    this.pointerId = pointerId;
    this.startX = x;
    this.startY = y;
    this.dragging = false;
    return true;
  }

  /** Long-press pickup: force the tracked pointer into dragging without waiting for slop.
   *  True only on the transition (already-dragging / untracked → false), mirroring move()'s
   *  fire-exactly-once 'start' contract. */
  promote(pointerId: number): boolean {
    if (this.pointerId !== pointerId || this.dragging) return false;
    this.dragging = true;
    return true;
  }

  /** 'start' fires exactly once, on the move that first leaves the slop radius. */
  move(pointerId: number, x: number, y: number): DragMoveResult {
    if (this.pointerId !== pointerId) return 'none';
    if (this.dragging) return 'move';
    if (Math.hypot(x - this.startX, y - this.startY) <= this.slopPx) return 'none';
    this.dragging = true;
    return 'start';
  }

  /** 'tap' = never left the slop radius (TapInput will fire for it); 'drop' = a real drag ended. */
  end(pointerId: number): DragEndResult {
    if (this.pointerId !== pointerId) return 'none';
    const wasDragging = this.dragging;
    this.reset();
    return wasDragging ? 'drop' : 'tap';
  }

  /** pointercancel (browser stole the gesture): 'drag' = a live drag was aborted mid-flight. */
  cancel(pointerId: number): DragCancelResult {
    if (this.pointerId !== pointerId) return 'none';
    const wasDragging = this.dragging;
    this.reset();
    return wasDragging ? 'drag' : 'pending';
  }

  private reset() {
    this.pointerId = null;
    this.dragging = false;
  }
}

/** Finger-friendly grab margin around the ghost footprint (meters). A fingertip is fat and the
 *  ghost may be a thin wall shelf — pure cosmetics/feel, not gameplay, so no tuning field
 *  (same rationale as §7.6's ghost tint alpha). */
export const GHOST_GRAB_MARGIN_M = 0.4;

export interface GhostFootprint { pos: [number, number]; rotDeg: number; footprint: [number, number]; }

/** True when a ground point lands on (or within `margin` of) the active ghost's footprint —
 *  the "finger grabbed the ghost" test. Reuses accidents.ts's footprintRect so the grab zone
 *  rotates with the same 90°-step width/depth swap as validity/nav. */
export function grabsGhost(point: [number, number], ghost: GhostFootprint, margin = GHOST_GRAB_MARGIN_M): boolean {
  const rect = footprintRect(ghost.pos, ghost.rotDeg, ghost.footprint);
  return point[0] >= rect.x0 - margin && point[0] <= rect.x1 + margin
    && point[1] >= rect.z0 - margin && point[1] <= rect.z1 + margin;
}

// ==================================================================== DOM layer

export interface BuyDragHit {
  ground: { x: number; z: number } | null;
  object: THREE.Object3D | null;
}

export interface BuyDragHooks {
  /** buyMode.active (and not blocked by an overlay) — everything below is gated on this. */
  isActive(): boolean;
  /** Screen point → ground/object, via TapInput's raycaster (one raycast implementation). */
  resolve(clientX: number, clientY: number): BuyDragHit;
  /** The active placing/moving ghost's footprint, or null when no ghost is up. */
  ghostFootprint(): GhostFootprint | null;
  /** Whether this tapped object resolves to a selectable (movable) effective instance. */
  canGrabObject(object: THREE.Object3D): boolean;
  /** Slop exceeded on a grabbed object: select it + begin the move ghost. False = abort drag. */
  beginObjectMove(object: THREE.Object3D): boolean;
  /** Ghost follows the finger (same surface-then-ground routing as handleBuyModeTap). */
  dragTo(clientX: number, clientY: number): void;
  /** A live finger drag began/ended — drives the ghost's hover+bounce "picked up" visual. */
  setDragging(active: boolean): void;
  /** Finger lifted after a real drag: confirm if valid, else keep the ghost for adjustment. */
  drop(): void;
  /** Browser cancelled the gesture mid-drag: keep the ghost + show the manual controls. */
  abort(): void;
}

type Grab = { kind: 'ghost' } | { kind: 'object'; object: THREE.Object3D; moving: boolean };

/**
 * Thin pointer-event layer: claims pointers that land on furniture/the ghost while buy mode is
 * active, promotes slop-exceeding moves into live ghost drags, and releases into drop()/abort().
 * Taps intentionally fall through untouched to input.ts's TapInput.
 */
export class BuyModeDrag {
  private tracker = new DragTracker();
  private grab: Grab | null = null;
  private holdTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private el: HTMLElement, private hooks: BuyDragHooks) {
    el.addEventListener('pointerdown', (e) => this.onDown(e));
    el.addEventListener('pointermove', (e) => this.onMove(e));
    el.addEventListener('pointerup', (e) => this.onUp(e));
    el.addEventListener('pointercancel', (e) => this.onCancel(e));
  }

  private clearHoldTimer() {
    if (this.holdTimer !== null) { clearTimeout(this.holdTimer); this.holdTimer = null; }
  }

  /** LONG_PRESS_MS elapsed with the finger still resting on the grab: pick it up in place —
   *  the object lifts under the finger (no teleport to the ground point) and later pointermoves
   *  make it follow. Same activation path as a slop-exceeding move, minus the dragTo. */
  private onHold(pointerId: number) {
    this.holdTimer = null;
    if (!this.grab || !this.tracker.promote(pointerId)) return;
    if (this.grab.kind === 'object') {
      if (!this.hooks.beginObjectMove(this.grab.object)) {
        this.tracker.cancel(pointerId);
        this.grab = null;
        return;
      }
      this.grab.moving = true;
    }
    this.hooks.setDragging(true);
  }

  /** True while a pointer is claimed (even pre-slop) — camera.ts must not track it either. */
  get engaged(): boolean { return this.tracker.isTracking; }

  /** camera.ts acceptPointer predicate: would a pointer landing here grab furniture? */
  wouldClaim(clientX: number, clientY: number): boolean {
    return this.classify(clientX, clientY) !== null;
  }

  private classify(clientX: number, clientY: number): Grab | null {
    if (!this.hooks.isActive()) return null;
    const hit = this.hooks.resolve(clientX, clientY);
    const ghost = this.hooks.ghostFootprint();
    if (ghost) {
      // While a ghost is up, only the ghost itself is draggable — everywhere else stays
      // camera pan / TapInput tap-to-reposition, exactly as before.
      return hit.ground && grabsGhost([hit.ground.x, hit.ground.z], ghost) ? { kind: 'ghost' } : null;
    }
    return hit.object && this.hooks.canGrabObject(hit.object)
      ? { kind: 'object', object: hit.object, moving: false }
      : null;
  }

  private onDown(e: PointerEvent) {
    if (e.button !== 0 || this.tracker.isTracking) return;
    const grab = this.classify(e.clientX, e.clientY);
    if (!grab) return;
    if (!this.tracker.begin(e.pointerId, e.clientX, e.clientY)) return;
    this.grab = grab;
    this.el.setPointerCapture(e.pointerId);
    this.clearHoldTimer();
    this.holdTimer = setTimeout(() => this.onHold(e.pointerId), LONG_PRESS_MS);
  }

  private onMove(e: PointerEvent) {
    const result = this.tracker.move(e.pointerId, e.clientX, e.clientY);
    if (result === 'none' || !this.grab) return;
    if (result === 'start') {
      this.clearHoldTimer();
      if (this.grab.kind === 'object') {
        if (!this.hooks.beginObjectMove(this.grab.object)) {
          this.tracker.cancel(e.pointerId);
          this.grab = null;
          return;
        }
        this.grab.moving = true;
      }
      this.hooks.setDragging(true);
    }
    this.hooks.dragTo(e.clientX, e.clientY);
  }

  private onUp(e: PointerEvent) {
    const result = this.tracker.end(e.pointerId);
    if (result === 'none') return;
    this.clearHoldTimer();
    this.grab = null;
    if (result === 'drop') { this.hooks.setDragging(false); this.hooks.drop(); }
    // 'tap' → TapInput handles it (rotate-in-place / ghost reposition); nothing to do here.
  }

  private onCancel(e: PointerEvent) {
    const result = this.tracker.cancel(e.pointerId);
    if (result === 'none') return;
    this.clearHoldTimer();
    this.grab = null;
    if (result === 'drag') { this.hooks.setDragging(false); this.hooks.abort(); }
  }
}
