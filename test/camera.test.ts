// camera.test.ts — game/camera.ts pure gesture math + pan-axis rotation (ROADMAP_NEXT item 3).
// Run: npx tsx test/camera.test.ts
import { twoTouchAngleDeg, shortestAngleDeltaDeg, TouchCamera } from '../game/camera';
import type { TuningData, MapData } from '../game/data';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name} ${detail}`); }
}
function approx(a: number, b: number, eps = 1e-6) { return Math.abs(a - b) <= eps; }

console.log('camera.test — twoTouchAngleDeg');
{
  check('pure +X → 0deg', approx(twoTouchAngleDeg(0, 0, 10, 0), 0));
  check('pure +Y (down in screen space) → 90deg', approx(twoTouchAngleDeg(0, 0, 0, 10), 90));
  check('pure -X → 180/-180deg', approx(Math.abs(twoTouchAngleDeg(0, 0, -10, 0)), 180));
  check('pure -Y → -90deg', approx(twoTouchAngleDeg(0, 0, 0, -10), -90));
}

console.log('camera.test — shortestAngleDeltaDeg');
{
  check('small positive delta', approx(shortestAngleDeltaDeg(0, 10), 10));
  check('small negative delta', approx(shortestAngleDeltaDeg(10, 0), -10));
  check('wraps 179 -> -179 as +2 (not -358)', approx(shortestAngleDeltaDeg(179, -179), 2));
  check('wraps -179 -> 179 as -2 (not +358)', approx(shortestAngleDeltaDeg(-179, 179), -2));
  check('zero delta', approx(shortestAngleDeltaDeg(45, 45), 0));
  check('full reversal is +/-180', approx(Math.abs(shortestAngleDeltaDeg(0, 180)), 180));
}

console.log('camera.test — pan direction stays screen-relative after yaw rotation');
{
  const tuning: TuningData['camera'] = {
    minZoom: 4, maxZoom: 18, minPitchDeg: 30, maxPitchDeg: 70, panBoundsPadding: 2,
    rotateSpeedDegPerPx: 0.3, twistDeadzoneDeg: 1.5, twistSpeed: 1.2,
  };
  const map: MapData = { bounds: { w: 20, h: 20 }, floors: [], walls: [], doors: [] } as unknown as MapData;
  const cam = new TouchCamera(1, tuning, map) as any;

  // Drag right (dx>0) at the default yaw (45deg) and record the resulting target.
  const before = cam.target.clone();
  cam.pan(100, 0, 600);
  const afterYaw45 = cam.target.clone();
  const delta45 = afterYaw45.clone().sub(before);
  check('a horizontal drag moves the target (not a no-op)', delta45.length() > 1e-6);

  // Rotate the camera 90deg, then repeat the identical screen-space drag from the same target.
  cam.target.copy(before);
  cam.rotateBy(90);
  const before90 = cam.target.clone();
  cam.pan(100, 0, 600);
  const delta90 = cam.target.clone().sub(before90);

  // Screen-relative pan means the drag's effect direction must itself have rotated ~90deg in
  // the XZ plane (same magnitude, perpendicular-ish direction) rather than staying world-fixed.
  const angleBetween = THREE_angleXZ(delta45, delta90);
  check('pan axis rotates with yaw (not stuck in world space)', approx(Math.abs(angleBetween), 90, 1),
    `delta45=${delta45.x.toFixed(3)},${delta45.z.toFixed(3)} delta90=${delta90.x.toFixed(3)},${delta90.z.toFixed(3)} angle=${angleBetween}`);
  check('pan magnitude unchanged by rotation', approx(delta45.length(), delta90.length(), 1e-4));
}

function THREE_angleXZ(a: { x: number; z: number }, b: { x: number; z: number }): number {
  const angA = Math.atan2(a.z, a.x) * 180 / Math.PI;
  const angB = Math.atan2(b.z, b.x) * 180 / Math.PI;
  let d = (angB - angA) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

console.log(failures === 0 ? '\ncamera.test — ALL PASS' : `\ncamera.test — ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
