// bladder.ts — ROADMAP_NEXT B2-4: bladder failure ("pees itself") trigger/cooldown decision.
// Pure logic only (no THREE/DOM dependency, mirrors game/duration.ts's split) — headless-tested
// in test/bladder.test.ts. game/main.ts owns the actual event (stopAction, animation, transient
// spawn, need refill); this module only decides WHEN the event should fire.
//
// Design: a simple armed/disarmed latch, not a time-based cooldown. Bladder decays every needs
// tick (game/stats.ts's decayTick, clamped 0..100) so it can sit AT 0 for many consecutive ticks
// once it hits bottom — without a latch, the event would refire every single tick while low.
// `armed` starts true; the moment bladder reaches 0 while armed, the event fires and the latch
// disarms (won't fire again).
//
// ROADMAP_NEXT B3-3 (bugfix): the original design re-armed only once bladder climbed STRICTLY
// ABOVE `reliefAmount` via a later `checkBladderFailure` call — but decay only ever moves bladder
// DOWN, and the failure's own relief top-up lands it exactly AT reliefAmount (by design, so a
// normal re-decay from there doesn't immediately retrigger). With no other bladder-raising event
// wired up (no toilet action refills bladder past reliefAmount in this build), the latch could
// only ever re-arm once, ever — a designer-reported bug ("second failure never fires"). Fixed:
// `rearmBladderFailure` is called EXPLICITLY once the failure event itself completes (i.e. right
// after main.ts applies the relief refill) rather than being inferred from a later bladder
// reading — "the event completing" is itself sufficient justification to re-arm, independent of
// whether anything else ever pushes bladder back up.
export interface BladderFailureState {
  armed: boolean;
}

export function initBladderFailureState(): BladderFailureState {
  return { armed: true };
}

/** Call once per needs-decay tick with the freshly-decayed bladder value. Returns true exactly
 *  on the tick the failure should fire (mutates `state` in place, same convention as the rest of
 *  this codebase's small stateful trackers, e.g. main.ts's durationState). */
export function checkBladderFailure(state: BladderFailureState, bladderValue: number): boolean {
  if (state.armed && bladderValue <= 0) {
    state.armed = false;
    return true;
  }
  return false;
}

/** ROADMAP_NEXT B3-3: call once the failure event itself completes (main.ts's peeState timer
 *  finishing, right after the relief refill is applied) — re-arms the latch so a SECOND failure
 *  can fire once bladder decays back to 0 again, with no dependency on any other event ever
 *  raising bladder past reliefAmount. */
export function rearmBladderFailure(state: BladderFailureState): void {
  state.armed = true;
}
