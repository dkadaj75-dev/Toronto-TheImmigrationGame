// anim.test.ts — AnimController against a real THREE.AnimationMixer (headless).
// Run: npx tsx test/anim.test.ts

import * as THREE from 'three';
import { AnimController } from '../game/anim';
import type { CharacterTuning } from '../game/data';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name} ${detail}`); }
}
function approx(a: number, b: number, eps = 0.02) { return Math.abs(a - b) <= eps; }

// A clip needs at least one track for the mixer to blend weights meaningfully.
function makeClip(name: string): THREE.AnimationClip {
  const track = new THREE.NumberKeyframeTrack('.visible', [0, 1], [1, 1]);
  return new THREE.AnimationClip(name, 1, [track]);
}

const clips = [makeClip('Idle'), makeClip('Walk_Forward'), makeClip('SittingIdle'), makeClip('Cook')];
const tuning: CharacterTuning = {
  meshPath: '/models/character.glb',
  heightMeters: 1.55,
  crossFadeSeconds: 0.5,
  walkClipSpeedReference: 2.0,
  sitHeight: 0.25,
  lieHeight: 0.55,
  clipMap: { idle: 'Idle', walk: 'walk_forward', sit: 'sitting', lie: 'LieDown', cook: 'Cook' },
};

console.log('anim.test — clip resolution');
{
  const c = new AnimController(new THREE.Object3D(), clips, tuning);
  check('exact match', c.resolveClip('idle')?.name === 'Idle');
  check('case-insensitive match', c.resolveClip('walk')?.name === 'Walk_Forward');
  check('substring match', c.resolveClip('sit')?.name === 'SittingIdle');
  check('unmapped state resolves to null', c.resolveClip('dance') === null);
  check('mapped-but-missing clip resolves to null', c.resolveClip('lie') === null);
}

console.log('anim.test — play & cross-fade');
{
  const c = new AnimController(new THREE.Object3D(), clips, tuning);
  c.play('idle');
  c.update(0);
  check('first play at full weight', approx(c.weightOf('idle'), 1), `got ${c.weightOf('idle')}`);

  c.play('walk');
  c.update(0.25); // half of the 0.5 s cross-fade
  check('mid-fade: walk ≈ 0.5', approx(c.weightOf('walk'), 0.5), `got ${c.weightOf('walk')}`);
  check('mid-fade: idle ≈ 0.5', approx(c.weightOf('idle'), 0.5), `got ${c.weightOf('idle')}`);

  c.update(0.3); // past the fade end
  check('fade done: walk = 1', approx(c.weightOf('walk'), 1), `got ${c.weightOf('walk')}`);
  check('fade done: idle = 0', approx(c.weightOf('idle'), 0), `got ${c.weightOf('idle')}`);

  const before = c.weightOf('walk');
  c.play('walk'); // same state again — must be a no-op, not a restart/fade
  c.update(0.1);
  check('repeat play is a no-op', approx(c.weightOf('walk'), before), `got ${c.weightOf('walk')}`);
  check('state tracked', c.state === 'walk');
}

console.log('anim.test — fallback to idle');
{
  const c = new AnimController(new THREE.Object3D(), clips, tuning);
  c.play('idle');
  c.update(1);
  c.play('lie'); // mapped to a clip that doesn't exist in the GLB
  c.update(1); // let any fade settle
  check('missing clip falls back to idle clip', approx(c.weightOf('idle'), 1), `got ${c.weightOf('idle')}`);
  check('requested state still recorded', c.state === 'lie');
  c.play('sit'); // recovering from fallback must still work
  c.update(1);
  check('recovers from fallback', approx(c.weightOf('sit'), 1), `got ${c.weightOf('sit')}`);
}

console.log('anim.test — walk playback rate');
{
  const c = new AnimController(new THREE.Object3D(), clips, tuning);
  c.play('walk');
  c.setWalkSpeed(3.0); // reference is 2.0 → timeScale 1.5
  // verify through mixer time advancement: at timeScale 1.5, 1 s of dt = 1.5 clip-seconds
  // (indirect check: weightOf unaffected; assert via the action's effective time scale)
  const clip = c.resolveClip('walk')!;
  // reach the private cache through the public path: play again is a no-op so the action persists
  const action = (c as any).actionCache.get(clip) as THREE.AnimationAction;
  check('timeScale = speed / reference', approx(action.getEffectiveTimeScale(), 1.5), `got ${action.getEffectiveTimeScale()}`);
}

console.log('anim.test — retune (hot-reload)');
{
  const c = new AnimController(new THREE.Object3D(), clips, tuning);
  c.play('cook');
  c.update(1);
  check('cook plays its own clip', approx(c.weightOf('cook'), 1));
  // designer remaps cook → the sitting clip, live
  const t2: CharacterTuning = { ...tuning, clipMap: { ...tuning.clipMap, cook: 'SittingIdle' } };
  c.retune(t2);
  c.update(1);
  check('retune re-resolves current state', approx(c.weightOf('cook'), 1) && c.resolveClip('cook')?.name === 'SittingIdle',
    `weight ${c.weightOf('cook')} clip ${c.resolveClip('cook')?.name}`);
}

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall anim tests passed');
