// buydrag.test.ts — game/buydrag.ts pure logic (2026-07-25 smartphone tap-and-slide Buy Mode).
// Run: npx tsx test/buydrag.test.ts
import {
  DragTracker, grabsGhost, DRAG_SLOP_PX, GHOST_GRAB_MARGIN_M, LONG_PRESS_MS,
  type GhostFootprint,
} from '../game/buydrag';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name} ${detail}`); }
}

console.log('buydrag.test — DragTracker tap-vs-drag state machine');
{
  const t = new DragTracker();
  check('idle: not tracking, not dragging', !t.isTracking && !t.isDragging);
  check('begin claims the pointer', t.begin(1, 100, 100) && t.isTracking && !t.isDragging);
  check('second pointer refused while tracking', !t.begin(2, 50, 50));
  check('foreign pointer moves are ignored', t.move(2, 300, 300) === 'none' && !t.isDragging);
  check('inside-slop move stays pending', t.move(1, 100 + DRAG_SLOP_PX, 100) === 'none' && !t.isDragging);
  check('within-slop release is a tap', t.end(1) === 'tap' && !t.isTracking);

  check('re-begin after release', t.begin(1, 100, 100));
  check('slop-exceeding move starts the drag exactly once', t.move(1, 100, 100 + DRAG_SLOP_PX + 1) === 'start' && t.isDragging);
  check('subsequent moves report move, not start', t.move(1, 120, 140) === 'move');
  check('drag release is a drop', t.end(1) === 'drop' && !t.isTracking && !t.isDragging);

  check('untracked release is none', t.end(1) === 'none');
  check('untracked cancel is none', t.cancel(1) === 'none');
}

console.log('buydrag.test — DragTracker cancel semantics');
{
  const t = new DragTracker();
  t.begin(7, 0, 0);
  check('pre-slop cancel reports pending', t.cancel(7) === 'pending' && !t.isTracking);
  t.begin(7, 0, 0);
  t.move(7, 50, 0);
  check('mid-drag cancel reports drag', t.cancel(7) === 'drag' && !t.isTracking && !t.isDragging);
  t.begin(3, 0, 0);
  check('foreign-pointer cancel leaves tracking intact', t.cancel(9) === 'none' && t.isTracking);
}

console.log('buydrag.test — custom slop radius');
{
  const t = new DragTracker(20);
  t.begin(1, 0, 0);
  check('default-slop distance stays pending under a wider slop', t.move(1, 12, 0) === 'none');
  check('past the custom slop starts the drag', t.move(1, 21, 0) === 'start');
  t.end(1);
}

console.log('buydrag.test — long-press promote (pickup without slop)');
{
  const t = new DragTracker();
  check('promote on untracked pointer refused', !t.promote(1));
  t.begin(1, 100, 100);
  check('promote lifts the pending pointer into dragging', t.promote(1) && t.isDragging);
  check('second promote is not a transition', !t.promote(1) && t.isDragging);
  check('promoted moves report move (never a second start)', t.move(1, 130, 100) === 'move');
  check('promoted release is a drop', t.end(1) === 'drop');
  t.begin(2, 0, 0);
  check('promote ignores a foreign pointer id', !t.promote(9) && !t.isDragging);
  check('LONG_PRESS_MS stays above input.ts tap window (400ms)', LONG_PRESS_MS > 400);
  t.cancel(2);
}

console.log('buydrag.test — grabsGhost footprint hit test');
{
  const ghost: GhostFootprint = { pos: [5, 5], rotDeg: 0, footprint: [2, 1] };
  check('center point grabs', grabsGhost([5, 5], ghost));
  check('inside-footprint corner grabs', grabsGhost([5.9, 5.4], ghost));
  check('point just inside the margin grabs', grabsGhost([6 + GHOST_GRAB_MARGIN_M - 0.01, 5], ghost));
  check('point past the margin misses', !grabsGhost([6 + GHOST_GRAB_MARGIN_M + 0.01, 5], ghost));
  check('far point misses', !grabsGhost([0, 0], ghost));
  // 90° rotation swaps width/depth exactly like footprintRect/nav/validity
  const rotated: GhostFootprint = { ...ghost, rotDeg: 90 };
  check('90° rotation swaps the grab zone axes (long side now Z)', grabsGhost([5, 5.9], rotated) && !grabsGhost([5.9 + GHOST_GRAB_MARGIN_M, 5], rotated));
  check('explicit margin override respected', grabsGhost([7, 5], ghost, 1.0) && !grabsGhost([7.1, 5], ghost, 1.0));
}

if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall buydrag tests passed');
