// bladder.ts — ROADMAP_NEXT B2-4: bladder failure ("pees itself") trigger/cooldown decision.
// Pure logic only (no THREE/DOM dependency, mirrors game/duration.ts's split) — headless-tested
// in test/bladder.test.ts. game/main.ts owns the actual event (stopAction, animation, transient
// spawn, need refill); this module only decides WHEN the event should fire.
//
// Design: a simple armed/disarmed latch, not a time-based cooldown. Bladder decays every needs
// tick (game/stats.ts's decayTick, clamped 0..100) so it can sit AT 0 for many consecutive ticks
// once it hits bottom — without a latch, the event would refire every single tick while low.
// `armed` starts true; the moment bladder reaches 0 while armed, the event fires and the latch
// disarms (won't fire again). It only re-arms once bladder climbs back ABOVE the failure's own
// `reliefAmount` (not just "above 0") — per the brief, "not again until bladder > relief": the
// relief refill itself lands exactly AT reliefAmount, so a normal decay back down to 0 from there
// (with no bathroom visit in between) must NOT retrigger; only a real need-satisfying top-up
// (autonomy/player using the toilet) that pushes bladder past reliefAmount re-arms it.
export interface BladderFailureState {
  armed: boolean;
}

export function initBladderFailureState(): BladderFailureState {
  return { armed: true };
}

/** Call once per needs-decay tick with the freshly-decayed bladder value. Returns true exactly
 *  on the tick the failure should fire (mutates `state` in place, same convention as the rest of
 *  this codebase's small stateful trackers, e.g. main.ts's durationState). */
export function checkBladderFailure(state: BladderFailureState, bladderValue: number, reliefAmount: number): boolean {
  if (state.armed && bladderValue <= 0) {
    state.armed = false;
    return true;
  }
  if (bladderValue > reliefAmount) state.armed = true;
  return false;
}
