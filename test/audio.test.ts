// audio.test.ts — game/audio.ts pure logic (ROADMAP_NEXT item 7: data-driven audio placeholders).
// Run: npx tsx test/audio.test.ts
import {
  AutoplayGate, resolveAudioTuning, effectiveVolume, trackForContext, nextPlaylistIndex, normalizeSoundUrl, loopSoundFor,
} from '../game/audio';
import type { TuningData, MapData, ActionDef, AssetDef } from '../game/data';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name} ${detail}`); }
}
function approx(a: number, b: number, eps = 1e-9) { return Math.abs(a - b) <= eps; }

console.log('audio.test — resolveAudioTuning');
{
  const defaults = resolveAudioTuning({});
  check('absent audio block falls back to sane defaults', defaults.masterVolume === 0.8 && defaults.musicVolume === 0.6 && defaults.sfxVolume === 0.8 && defaults.musicCrossfadeSeconds === 1.5, JSON.stringify(defaults));
  check('buyModeMusic absent by default', defaults.buyModeMusic === undefined);

  const custom = resolveAudioTuning({ audio: { masterVolume: 0.5, musicVolume: 0.3, sfxVolume: 0.9, musicCrossfadeSeconds: 2, buyModeMusic: 'sounds/x.wav' } });
  check('explicit values pass through', custom.masterVolume === 0.5 && custom.musicVolume === 0.3 && custom.sfxVolume === 0.9 && custom.musicCrossfadeSeconds === 2);
  check('buyModeMusic passes through', custom.buyModeMusic === 'sounds/x.wav');

  const cues = resolveAudioTuning({ audio: { moveOrder: 'move.wav', actionSelect: 'pick.wav', questStarted: 'new.wav', questCompleted: 'done.wav', notification: 'note.wav', skillUp: 'skill.wav', moneyUp: 'up.wav', moneyDown: 'down.wav' } });
  check('B6-10/B6-16 cue paths pass through', cues.moveOrder === 'move.wav' && cues.actionSelect === 'pick.wav' && cues.questStarted === 'new.wav' && cues.questCompleted === 'done.wav' && cues.notification === 'note.wav' && cues.skillUp === 'skill.wav' && cues.moneyUp === 'up.wav' && cues.moneyDown === 'down.wav');

  const clamped = resolveAudioTuning({ audio: { masterVolume: 2, musicVolume: -1 } });
  check('out-of-range volumes clamp to 0..1', clamped.masterVolume === 1 && clamped.musicVolume === 0, JSON.stringify(clamped));

  const negFade = resolveAudioTuning({ audio: { musicCrossfadeSeconds: -5 } });
  check('negative crossfade clamps to 0', negFade.musicCrossfadeSeconds === 0);
}

console.log('audio.test — effectiveVolume');
{
  const audio = resolveAudioTuning({ audio: { masterVolume: 0.5, musicVolume: 0.4, sfxVolume: 0.6 } });
  check('music channel = master * musicVolume', approx(effectiveVolume(audio, 'music'), 0.2));
  check('sfx channel = master * sfxVolume', approx(effectiveVolume(audio, 'sfx'), 0.3));
}

console.log('audio.test — trackForContext');
{
  const audio = resolveAudioTuning({ audio: { buyModeMusic: 'sounds/buy.wav' } });
  const map: Pick<MapData, 'music'> = { music: ['sounds/a.wav', 'sounds/b.wav'] };
  const emptyMap: Pick<MapData, 'music'> = { music: [] };
  const noMusicMap: Pick<MapData, 'music'> = {};

  check('buymode context returns tuning.audio.buyModeMusic', trackForContext('buymode', map, audio, 0) === 'sounds/buy.wav');
  const noBuy = resolveAudioTuning({});
  check('buymode context with no buyModeMusic set returns null', trackForContext('buymode', map, noBuy, 0) === null);
  check('loading context returns its boot-only track', trackForContext('loading', map, audio, 0, 'sounds/loading.wav') === 'sounds/loading.wav');
  check('loading context may be silent', trackForContext('loading', map, audio, 0) === null);

  check('map context index 0 returns first track', trackForContext('map', map, audio, 0) === 'sounds/a.wav');
  check('map context index 1 returns second track', trackForContext('map', map, audio, 1) === 'sounds/b.wav');
  check('map context wraps out-of-range index via modulo', trackForContext('map', map, audio, 2) === 'sounds/a.wav');
  check('map context negative index still resolves sanely (no negative array access)', trackForContext('map', map, audio, -1) === 'sounds/b.wav');
  check('map context with empty playlist returns null (silence)', trackForContext('map', emptyMap, audio, 0) === null);
  check('map context with absent music key returns null', trackForContext('map', noMusicMap, audio, 0) === null);
}

console.log('audio.test — nextPlaylistIndex');
{
  const list = ['a', 'b', 'c'];
  check('advances by one', nextPlaylistIndex(list, 0) === 1);
  check('wraps at the end', nextPlaylistIndex(list, 2) === 0);
  check('empty list returns 0 (never negative/NaN)', nextPlaylistIndex([], 5) === 0);
}

console.log('audio.test — normalizeSoundUrl');
{
  check('bare relative path gets a leading slash', normalizeSoundUrl('sounds/x.wav') === '/sounds/x.wav');
  check('already-absolute path is untouched', normalizeSoundUrl('/sounds/x.wav') === '/sounds/x.wav');
  check('a full URL is untouched', normalizeSoundUrl('https://example.com/x.wav') === 'https://example.com/x.wav');
}

console.log('audio.test — loopSoundFor (ActionDef.sound vs AssetDef.sound precedence)');
{
  const actionWithSound: Pick<ActionDef, 'sound'> = { sound: 'sounds/action.wav' };
  const actionNoSound: Pick<ActionDef, 'sound'> = {};
  const assetWithSound: Pick<AssetDef, 'sound' | 'interactions'> = { sound: 'sounds/asset.wav', interactions: [] };
  const assetNoSound: Pick<AssetDef, 'sound' | 'interactions'> = { interactions: [] };
  const statefulAsset: Pick<AssetDef, 'sound' | 'interactions'> = { sound: 'sounds/tv.wav', interactions: ['turn_on', 'turn_off'] };

  check('asset sound wins when both are set', loopSoundFor(actionWithSound, assetWithSound) === 'sounds/asset.wav');
  check('falls back to action sound when asset has none', loopSoundFor(actionWithSound, assetNoSound) === 'sounds/action.wav');
  check('asset sound used even with undefined asset def object entirely (no asset targeted)', loopSoundFor(actionWithSound, undefined) === 'sounds/action.wav');
  check('neither set → undefined', loopSoundFor(actionNoSound, assetNoSound) === undefined);
  check('neither set, no asset at all → undefined', loopSoundFor(actionNoSound, undefined) === undefined);
  check('stateful asset sound is not action-scoped', loopSoundFor(actionWithSound, statefulAsset) === 'sounds/action.wav');
  check('stateful asset with no action sound returns undefined', loopSoundFor(actionNoSound, statefulAsset) === undefined);
}

console.log('audio.test - loading autoplay fallback');
{
  const allowed = new AutoplayGate();
  let allowedAttempts = 0;
  let allowedStarted = 0;
  allowed.bestEffort(() => { allowedAttempts++; return Promise.resolve(); }, () => true, () => { allowedStarted++; });
  await Promise.resolve();
  check('relaxed policy starts loading music without a gesture', allowedAttempts === 1 && allowedStarted === 1);

  const gate = new AutoplayGate();
  let attempts = 0;
  let started = 0;
  gate.bestEffort(() => {
    attempts++;
    return attempts === 1 ? Promise.reject(new Error('autoplay blocked')) : Promise.resolve();
  }, () => true, () => { started++; });
  await Promise.resolve();
  await Promise.resolve();
  check('loading music is attempted immediately', attempts === 1);
  check('blocked autoplay waits for a gesture retry', started === 0);
  gate.unlock();
  await Promise.resolve();
  await Promise.resolve();
  check('first gesture retries the blocked loading track once', attempts === 2 && started === 1);
  gate.unlock();
  check('later gestures do not replay the fallback', attempts === 2);

  const stale = new AutoplayGate();
  let wanted = true;
  let staleAttempts = 0;
  stale.bestEffort(() => { staleAttempts++; return Promise.reject(new Error('blocked')); }, () => wanted);
  await Promise.resolve();
  await Promise.resolve();
  wanted = false;
  stale.unlock();
  check('a context switch cancels the queued loading retry', staleAttempts === 1);
}

if (failures) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
console.log('\nall audio.test checks passed');
