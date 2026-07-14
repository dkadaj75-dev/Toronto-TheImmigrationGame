// fbxclips.test.ts — game/fbxclips.ts pure logic (PROJECT_CONTEXT.md §2 FBX addendum). Covers
// track-name retargeting (mixamorig prefix strip / pass-through / unmatched), root-position-track
// stripping, filename-stem extraction, and clip-name dedupe/fallback. The actual FBXLoader parse
// is browser-only, not headless-testable — see game/world.ts's loadFbxClips doc comment.
// Run: npx tsx test/fbxclips.test.ts
import {
  stripMixamoPrefix, splitTrackName, retargetTrackName, isPositionTrackName,
  stripPositionTracks, fileStem, resolveClipName,
} from '../game/fbxclips';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name} ${detail}`); }
}

console.log('fbxclips.test — stripMixamoPrefix');
{
  check('colon form', stripMixamoPrefix('mixamorig:Hips') === 'Hips');
  check('no-colon form', stripMixamoPrefix('mixamorigHips') === 'Hips');
  check('no prefix — unchanged', stripMixamoPrefix('Hips') === 'Hips');
  check('prefix-looking but not a real prefix match is still stripped (literal prefix rule)', stripMixamoPrefix('mixamorigArm_L') === 'Arm_L');
}

console.log('fbxclips.test — splitTrackName');
{
  check('simple position track', JSON.stringify(splitTrackName('Hips.position')) === JSON.stringify({ node: 'Hips', rest: '.position' }));
  check('quaternion track', JSON.stringify(splitTrackName('mixamorig:Spine.quaternion')) === JSON.stringify({ node: 'mixamorig:Spine', rest: '.quaternion' }));
  check('component-indexed track', JSON.stringify(splitTrackName('Hips.position[x]')) === JSON.stringify({ node: 'Hips', rest: '.position[x]' }));
  check('no dot — whole string is the node', JSON.stringify(splitTrackName('Hips')) === JSON.stringify({ node: 'Hips', rest: '' }));
}

console.log('fbxclips.test — retargetTrackName');
{
  const targetBones = new Set(['Hips', 'Spine', 'LeftArm', 'RightArm']);
  check('exact match passes through unchanged', JSON.stringify(retargetTrackName('Hips.position', targetBones)) === JSON.stringify({ trackName: 'Hips.position', matched: true }));
  check('mixamorig:-prefixed strips to a matching bone', JSON.stringify(retargetTrackName('mixamorig:Spine.quaternion', targetBones)) === JSON.stringify({ trackName: 'Spine.quaternion', matched: true }));
  check('mixamorig-no-colon-prefixed strips to a matching bone', JSON.stringify(retargetTrackName('mixamorigLeftArm.quaternion', targetBones)) === JSON.stringify({ trackName: 'LeftArm.quaternion', matched: true }));
  const r = retargetTrackName('mixamorig:LeftToeBase.quaternion', targetBones);
  check('unmatched bone (target lacks it even after stripping) reports matched:false, name unchanged', r.matched === false && r.trackName === 'mixamorig:LeftToeBase.quaternion');
  check('target rig ITSELF prefixed: exact prefixed match passes through (no double-strip)', retargetTrackName('mixamorig:Hips.position', new Set(['mixamorig:Hips'])).trackName === 'mixamorig:Hips.position');
  const unknown = retargetTrackName('mixamorig:Hips.position', new Set());
  check('empty target skeleton (not yet known) does not spuriously flag unmatched', unknown.matched === true && unknown.trackName === 'mixamorig:Hips.position');
}

console.log('fbxclips.test — isPositionTrackName / stripPositionTracks');
{
  check('.position is a position track', isPositionTrackName('Hips.position'));
  check('.position[x] (component) is still a position track', isPositionTrackName('Hips.position[x]'));
  check('.quaternion is not', !isPositionTrackName('Hips.quaternion'));
  check('.scale is not', !isPositionTrackName('Hips.scale'));
  const names = ['Hips.position', 'Hips.quaternion', 'Spine.quaternion', 'LeftArm.quaternion', 'mixamorig:Hips.position[y]'];
  const { kept, dropped } = stripPositionTracks(names);
  check('drops every position track (root-motion strip)', JSON.stringify(dropped) === JSON.stringify(['Hips.position', 'mixamorig:Hips.position[y]']));
  check('keeps every non-position track, in order', JSON.stringify(kept) === JSON.stringify(['Hips.quaternion', 'Spine.quaternion', 'LeftArm.quaternion']));
}

console.log('fbxclips.test — fileStem');
{
  check('unix path', fileStem('/models/anims/walking.fbx') === 'walking');
  check('windows-style path', fileStem('C:\\models\\anims\\walking.fbx') === 'walking');
  check('bare filename', fileStem('mixamo.com.fbx') === 'mixamo.com'); // last dot only strips the true extension
  check('query string stripped', fileStem('/models/anims/walking.fbx?v=2') === 'walking');
  check('no extension', fileStem('walking') === 'walking');
  check('leading dot (hidden file) is not treated as an extension marker', fileStem('.fbx') === '.fbx');
}

console.log('fbxclips.test — resolveClipName');
{
  const used = new Set<string>();
  const n1 = resolveClipName('Walking', 'walking', used); used.add(n1);
  check('embedded name kept when unused', n1 === 'Walking');

  const n2 = resolveClipName('', 'idle_loop', used); used.add(n2);
  check('blank embedded name falls back to filename stem', n2 === 'idle_loop');

  const n3 = resolveClipName(undefined, 'sit_down', used); used.add(n3);
  check('undefined embedded name falls back to filename stem', n3 === 'sit_down');

  const n4 = resolveClipName('mixamo.com', 'walking_2', used); used.add(n4);
  check('unique embedded name "mixamo.com" is NOT special-cased by itself — only collision triggers fallback', n4 === 'mixamo.com');

  const n5 = resolveClipName('mixamo.com', 'walking_3', used); used.add(n5);
  check('duplicate embedded name "mixamo.com" falls back to filename stem', n5 === 'walking_3');

  const usedCollide = new Set(['mixamo.com', 'run']);
  const n6 = resolveClipName('mixamo.com', 'run', usedCollide);
  check('even the filename-stem fallback collides → incrementing suffix', n6 === 'run_2');

  const usedCollide2 = new Set(['mixamo.com', 'run', 'run_2']);
  const n7 = resolveClipName('mixamo.com', 'run', usedCollide2);
  check('suffix increments past existing collisions', n7 === 'run_3');

  const usedNoMutate = new Set(['x']);
  resolveClipName('x', 'y', usedNoMutate);
  check('resolveClipName does not mutate the passed-in set', usedNoMutate.size === 1 && usedNoMutate.has('x'));
}

if (failures > 0) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
console.log('\nALL FBXCLIPS TESTS PASSED');
