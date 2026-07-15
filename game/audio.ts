// audio.ts — ROADMAP_NEXT item 7: data-driven audio system with placeholders.
// Split like doors.ts/accidents.ts/marker.ts: pure logic (volume resolution, context→track
// selection, playlist cycling) is headless-tested in test/audio.test.ts with zero DOM/Audio
// dependency; the thin AudioManager below is a real HTMLAudioElement-based player wired into
// game/main.ts's action-start/stop, buy-mode enter/exit, and map-load points.
//
// SEMANTICS (documented decision, one clear meaning per source — see game/data.ts's doc comments
// on ActionDef.sound / AssetDef.sound):
//   - ActionDef.sound: loops for as long as the SIM is performing that action (e.g. a generic
//     "shower running" trickle tied to the "shower" action, independent of which asset it's used
//     on). Started in main.ts's agent.onActionStart, stopped in onActionStop.
//   - AssetDef.sound: loops for as long an action is in progress that TARGETS that asset instance
//     (e.g. the TV's own hum while anything is happening at it) — keyed per placed-object instance
//     (THREE.Object3D.uuid) so multiple TVs each get their own independent loop. This is the
//     "asset is on" case from the ROADMAP_NEXT brief: since this repo has no explicit on/off toggle
//     state on assets (unlike the Unreal prototype's Switch ON/OFF), "the asset is on" is read as
//     "an action currently targets it" — the TV hums while being watched, the shower runs while
//     showering, and both fall silent the instant the action stops. Picking ONE semantic per field
//     (action vs asset) rather than layering both onto the same sound avoids doubled/duplicate
//     loops when an action's own sound AND its target asset's sound would otherwise both fire for
//     the same activity.
//   - Music: one channel, one context at a time. Contexts today: 'map' (cycles through the active
//     map's `music[]` playlist — advances to the NEXT track when one ends; a single-cut, not a
//     crossfade, since "cycling" reads as a playlist advancing between separate tracks) and
//     'buymode' (single fixed track, `tuning.audio.buyModeMusic`). Switching CONTEXT (e.g. entering
//     buy mode, or exiting it back to the map) crossfades over `tuning.audio.musicCrossfadeSeconds`
//     — the "crossfade-or-cut" the roadmap item names: crossfade across a context switch, cut
//     between playlist entries within the same context. Silence (empty/absent playlist, or no
//     buyModeMusic) is a valid "context" too and crossfades to/from it like any other.
//   - PAUSE: sfx/asset/action loops pause (paused game shouldn't keep a shower running); music
//     keeps playing (menu/ambient music during a paused moment is the more natural default, mirrors
//     how three.js's own render loop and the HUD stay live while sim time is frozen — see main.ts's
//     buy-mode `sdt` freeze, which is a DIFFERENT kind of pause and is handled the same way: entering
//     buy mode force-stops action loops via the ordinary onActionStop path already firing when buy
//     mode's own tap-routing takes over, so no special-casing is needed here).
//   - AUTOPLAY POLICY: browsers refuse to start ANY audio (WebAudio context or a plain
//     HTMLAudioElement) before a user gesture. `AudioManager` defers every real `.play()` call
//     behind a one-time "unlocked" flag that flips on the first `pointerdown`/`keydown` anywhere in
//     the document (the standard pattern — see MDN "Autoplay guide for media and Web Audio APIs").
//     Anything requested before that point (e.g. map music wanting to start at page load) is queued
//     as the "desired" state and applied the instant the gesture fires.

import type { ActionDef, AssetDef, MapData, TuningData } from './data';

// ==================================================================== pure logic (headless-tested)

export interface AudioTuning { masterVolume: number; musicVolume: number; sfxVolume: number; musicCrossfadeSeconds: number; buyModeMusic?: string }

const AUDIO_DEFAULTS: AudioTuning = { masterVolume: 0.8, musicVolume: 0.6, sfxVolume: 0.8, musicCrossfadeSeconds: 1.5 };

/** Sparse `tuning.audio` resolved against sane defaults — mirrors every other `tuning.<x>?`
 *  optional-group precedent in game/data.ts (interaction?/doors?/fire?/camera's rotate* fields). */
export function resolveAudioTuning(tuning: Pick<TuningData, 'audio'>): AudioTuning {
  const a = tuning.audio;
  return {
    masterVolume: clamp01(a?.masterVolume ?? AUDIO_DEFAULTS.masterVolume),
    musicVolume: clamp01(a?.musicVolume ?? AUDIO_DEFAULTS.musicVolume),
    sfxVolume: clamp01(a?.sfxVolume ?? AUDIO_DEFAULTS.sfxVolume),
    musicCrossfadeSeconds: Math.max(0, a?.musicCrossfadeSeconds ?? AUDIO_DEFAULTS.musicCrossfadeSeconds),
    buyModeMusic: a?.buyModeMusic,
  };
}

function clamp01(v: number): number { return Math.min(1, Math.max(0, v)); }

/** Effective gain for a channel = masterVolume × the channel's own category volume. Both already
 *  clamped 0..1 by resolveAudioTuning, so the product is too — no further clamping needed. */
export function effectiveVolume(audio: AudioTuning, category: 'music' | 'sfx'): number {
  return audio.masterVolume * (category === 'music' ? audio.musicVolume : audio.sfxVolume);
}

export type MusicContext = 'map' | 'buymode';

/** What SHOULD be playing for a given context, independent of what IS currently playing (the
 *  AudioManager below diffs against its own current state to decide whether to crossfade).
 *  'map': the map's own music[] playlist, current entry by (possibly out-of-range) index — wraps
 *  via modulo so a stale index after a playlist edit still resolves; empty/absent playlist = null
 *  (silence is this context's valid "track"). 'buymode': tuning.audio.buyModeMusic, or null if unset. */
export function trackForContext(context: MusicContext, map: Pick<MapData, 'music'>, audio: AudioTuning, playlistIndex: number): string | null {
  if (context === 'buymode') return audio.buyModeMusic ?? null;
  const list = map.music ?? [];
  if (list.length === 0) return null;
  const i = ((playlistIndex % list.length) + list.length) % list.length;
  return list[i];
}

/** Cycles a map's music[] playlist forward by one (wrapping) — called when the currently-playing
 *  track ends. `list.length === 0` returns 0 (nothing to cycle, but never negative/NaN). */
export function nextPlaylistIndex(list: readonly string[], currentIndex: number): number {
  if (list.length === 0) return 0;
  return (currentIndex + 1) % list.length;
}

/** Normalizes a data-file sound/mesh-style path to a fetchable URL the same way world.ts's
 *  normalizeMeshUrl does for meshes (leading slash, left absolute URLs untouched) — kept as an
 *  independent copy here rather than importing world.ts, since audio.ts has zero other dependency
 *  on the three.js/world module and this one-line rule doesn't justify coupling the two. */
export function normalizeSoundUrl(path: string): string {
  return /^(\/|https?:)/.test(path) ? path : '/' + path;
}

// ==================================================================== three.js-free browser layer
// (uses HTMLAudioElement, not THREE — no three.js dependency at all, unlike sprites.ts/marker.ts;
// browser-only, not headless-testable: jsdom's HTMLMediaElement.play()/pause() are stubs. Manual
// `npm run dev` sanity check covers this half, exactly like sprites.ts's GIF decode path.)

export interface LoopHandle { readonly key: string; stop(): void }

export class AudioManager {
  private audio: AudioTuning;
  private unlocked = false;
  private pendingUnlock: Array<() => void> = [];
  private paused = false;

  private readonly loops = new Map<string, HTMLAudioElement>(); // sfx/asset/action loop channels, keyed by caller-chosen id
  private musicA: HTMLAudioElement | null = null;
  private musicB: HTMLAudioElement | null = null;
  private musicActiveIsA = true;
  private musicContext: MusicContext | null = null;
  private musicTrack: string | null = null;
  private musicPlaylistIndex = 0;
  private fadeRaf: number | null = null;

  constructor(tuning: Pick<TuningData, 'audio'>) {
    this.audio = resolveAudioTuning(tuning);
    const unlock = () => {
      if (this.unlocked) return;
      this.unlocked = true;
      document.removeEventListener('pointerdown', unlock);
      document.removeEventListener('keydown', unlock);
      const queued = this.pendingUnlock.splice(0);
      for (const fn of queued) fn();
    };
    document.addEventListener('pointerdown', unlock);
    document.addEventListener('keydown', unlock);
  }

  /** Forces the next `setMusicContext('map', …)` call to treat it as a fresh context (playlist
   *  index reset to 0, forces a crossfade even if the resolved track string happens to coincide)
   *  — called by main.ts when the active map itself changes (tuning.map.active), so switching
   *  maps always restarts that map's playlist from the top rather than resuming wherever the
   *  previous map's cycle position happened to be. */
  mapChanged(): void {
    this.musicPlaylistIndex = 0;
    this.musicContext = null;
  }

  /** Re-applies tuning after a hot-reload edit (volumes, crossfade duration, buyModeMusic) —
   *  live-updates every currently-playing element's volume immediately, same convention as
   *  anim.ts's/camera.ts's retune(). */
  retune(tuning: Pick<TuningData, 'audio'>): void {
    this.audio = resolveAudioTuning(tuning);
    for (const el of this.loops.values()) el.volume = effectiveVolume(this.audio, 'sfx');
    const active = this.musicActiveIsA ? this.musicA : this.musicB;
    if (active) active.volume = effectiveVolume(this.audio, 'music');
  }

  private whenUnlocked(fn: () => void): void {
    if (this.unlocked) fn();
    else this.pendingUnlock.push(fn);
  }

  /** One-shot sound effect (e.g. a discrete UI cue) — not tracked/stoppable, fires and forgets. */
  playSfx(path: string): void {
    this.whenUnlocked(() => {
      const el = new Audio(normalizeSoundUrl(path));
      el.volume = effectiveVolume(this.audio, 'sfx');
      el.play().catch(() => {}); // autoplay-policy or 404 — silently drop, never throws into caller
    });
  }

  /** Starts (or restarts, if `path` differs from what's already looping under `key`) a looping
   *  sfx channel identified by `key` — callers use a stable id (an action id for ActionDef.sound,
   *  a placed-object's THREE.Object3D.uuid for AssetDef.sound) so multiple independent instances
   *  (two TVs) don't collide. Re-calling with the SAME path is a no-op (idempotent start). */
  startLoop(key: string, path: string): void {
    const existing = this.loops.get(key);
    if (existing && existing.dataset.src === path) return;
    this.stopLoop(key);
    const el = new Audio(normalizeSoundUrl(path));
    el.loop = true;
    el.volume = effectiveVolume(this.audio, 'sfx');
    el.dataset.src = path;
    this.loops.set(key, el);
    if (!this.paused) this.whenUnlocked(() => el.play().catch(() => {}));
  }

  stopLoop(key: string): void {
    const el = this.loops.get(key);
    if (!el) return;
    el.pause();
    this.loops.delete(key);
  }

  /** §7's PAUSE decision: sfx/action/asset loops pause; music is untouched by this call. */
  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    for (const el of this.loops.values()) {
      if (paused) el.pause();
      else this.whenUnlocked(() => el.play().catch(() => {}));
    }
  }

  /** Ensures the music channel is playing whatever `trackForContext` resolves for `context`.
   *  No-ops if that's already what's playing (including "already silent"). A genuine change
   *  crossfades from the current track (or from silence) to the new one (or to silence) over
   *  `tuning.audio.musicCrossfadeSeconds`. */
  setMusicContext(context: MusicContext, map: Pick<MapData, 'music'>): void {
    if (context !== this.musicContext) this.musicPlaylistIndex = 0; // fresh context starts its playlist from the top
    const desired = trackForContext(context, map, this.audio, this.musicPlaylistIndex);
    const contextChanged = context !== this.musicContext;
    const trackChanged = desired !== this.musicTrack;
    this.musicContext = context;
    if (!contextChanged && !trackChanged) return;
    this.musicTrack = desired;
    this.crossfadeTo(desired, context, map);
  }

  private crossfadeTo(path: string | null, context: MusicContext, map: Pick<MapData, 'music'>): void {
    const outgoing = this.musicActiveIsA ? this.musicA : this.musicB;
    let incoming: HTMLAudioElement | null = null;
    if (path) {
      incoming = new Audio(normalizeSoundUrl(path));
      incoming.loop = false; // 'map' cycles via 'ended' below; a single buyModeMusic track loops via its own 'ended' → replay
      incoming.volume = 0;
      incoming.addEventListener('ended', () => this.onTrackEnded(context, map));
      this.whenUnlocked(() => incoming!.play().catch(() => {}));
    }
    if (this.musicActiveIsA) this.musicB = incoming; else this.musicA = incoming;
    this.musicActiveIsA = !this.musicActiveIsA;

    const seconds = this.audio.musicCrossfadeSeconds;
    const targetVol = effectiveVolume(this.audio, 'music');
    if (this.fadeRaf !== null) cancelAnimationFrame(this.fadeRaf);
    if (seconds <= 0 || typeof requestAnimationFrame === 'undefined') {
      if (outgoing) { outgoing.pause(); }
      if (incoming) incoming.volume = targetVol;
      return;
    }
    const start = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / (seconds * 1000));
      if (outgoing) outgoing.volume = targetVol * (1 - t);
      if (incoming) incoming.volume = targetVol * t;
      if (t < 1) {
        this.fadeRaf = requestAnimationFrame(step);
      } else {
        this.fadeRaf = null;
        if (outgoing) outgoing.pause();
      }
    };
    this.fadeRaf = requestAnimationFrame(step);
  }

  private onTrackEnded(context: MusicContext, map: Pick<MapData, 'music'>): void {
    if (context !== 'map') { // buyModeMusic (or any single fixed track) just loops in place
      const active = this.musicActiveIsA ? this.musicA : this.musicB;
      if (active && this.musicTrack) { active.currentTime = 0; active.play().catch(() => {}); }
      return;
    }
    const list = map.music ?? [];
    this.musicPlaylistIndex = nextPlaylistIndex(list, this.musicPlaylistIndex);
    const next = trackForContext('map', map, this.audio, this.musicPlaylistIndex);
    this.musicTrack = next;
    this.crossfadeTo(next, 'map', map); // playlist advance is a same-context cut per the module doc's decision — musicCrossfadeSeconds still applies to keep the transition click-free, but there's no separate "instant cut" path needed since 0s is an available tuning value for anyone who wants a hard cut
  }
}

// ==================================================================== ActionDef/AssetDef helpers

/** Which loop path (if any) should be running while `action` targets `asset` — used by main.ts's
 *  onActionStart/onActionStop; see the module doc comment for the "one field wins" semantic. If
 *  BOTH happen to be set (designer set both action.sound and asset.sound), the asset's sound wins
 *  since it's the more specific "this particular object" cue — documented, not asserted elsewhere. */
export function loopSoundFor(action: Pick<ActionDef, 'sound'>, asset: Pick<AssetDef, 'sound'> | undefined): string | undefined {
  return asset?.sound ?? action.sound;
}
