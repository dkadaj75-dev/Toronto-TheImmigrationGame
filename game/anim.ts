// anim.ts — rigged character animation controller (replaces sim.ts stand-in poses).
// Logical states ("idle", "walk", "sit", "lie", or any action's `animation` value) are
// resolved to GLB clip names through tuning.character.clipMap — design pillar: the clip
// mapping is data, so a differently-named Mixamo/Quaternius export is a JSON edit.
//
// Resolution order per state: exact clip name → case-insensitive → case-insensitive
// substring. A state with no resolvable clip falls back to the idle clip (warned once).

import * as THREE from 'three';
import type { CharacterTuning } from './data';

export class AnimController {
  private mixer: THREE.AnimationMixer;
  private actionCache = new Map<THREE.AnimationClip, THREE.AnimationAction>();
  private currentAction: THREE.AnimationAction | null = null;
  private walkClip: THREE.AnimationClip | null = null;
  /** the logical state last requested (even if its clip fell back to idle) */
  state: string | null = null;
  private warned = new Set<string>();

  constructor(
    root: THREE.Object3D,
    private clips: THREE.AnimationClip[],
    private tuning: CharacterTuning,
  ) {
    this.mixer = new THREE.AnimationMixer(root);
    this.walkClip = this.resolveClip('walk');
  }

  /** Data hot-reload: new clipMap / cross-fade / walk reference apply live. */
  retune(tuning: CharacterTuning) {
    this.tuning = tuning;
    this.warned.clear();
    this.walkClip = this.resolveClip('walk');
    // re-resolve the current state in case the clipMap now points elsewhere
    const s = this.state;
    if (s) { this.state = null; this.play(s); }
  }

  /** exact → case-insensitive → substring lookup of the clip mapped for a logical state. */
  resolveClip(state: string): THREE.AnimationClip | null {
    const wanted = this.tuning.clipMap[state];
    if (!wanted) return null;
    const lower = wanted.toLowerCase();
    return (
      this.clips.find((c) => c.name === wanted) ??
      this.clips.find((c) => c.name.toLowerCase() === lower) ??
      this.clips.find((c) => c.name.toLowerCase().includes(lower)) ??
      null
    );
  }

  /** Cross-fade to the clip for a logical state. Unmapped states fall back to idle. */
  play(state: string) {
    if (state === this.state) return;
    this.state = state;

    let clip = this.resolveClip(state);
    if (!clip) {
      if (!this.warned.has(state)) {
        console.warn(`No animation clip for state "${state}" (clipMap: ${JSON.stringify(this.tuning.clipMap[state] ?? null)}; available: ${this.clips.map((c) => c.name).join(', ')}) — falling back to idle.`);
        this.warned.add(state);
      }
      clip = this.resolveClip('idle');
      if (!clip) return; // nothing sensible to show; leave the last pose running
    }

    const next = this.actionFor(clip);
    if (next === this.currentAction) return; // two states mapped to the same clip
    next.reset(); // restart from frame 0; timeScale persists (setWalkSpeed owns the walk rate)
    next.setEffectiveWeight(1);
    next.play();
    if (this.currentAction) this.currentAction.crossFadeTo(next, this.tuning.crossFadeSeconds, false);
    this.currentAction = next;
  }

  /**
   * Scale the walk clip so feet match the actual ground speed:
   * timeScale = worldSpeed / walkClipSpeedReference (the speed the clip was authored at).
   */
  setWalkSpeed(unitsPerSecond: number) {
    if (!this.walkClip) return;
    const ref = Math.max(this.tuning.walkClipSpeedReference, 1e-6);
    this.actionFor(this.walkClip).setEffectiveTimeScale(unitsPerSecond / ref);
  }

  /** Advance the mixer. Pass simulation dt (speed-scaled) so pause freezes animation. */
  update(dt: number) {
    this.mixer.update(dt);
  }

  /** Effective blend weight of the clip mapped to a state (test/diagnostic helper). */
  weightOf(state: string): number {
    const clip = this.resolveClip(state);
    if (!clip) return 0;
    const a = this.actionCache.get(clip);
    return a ? a.getEffectiveWeight() : 0;
  }

  private actionFor(clip: THREE.AnimationClip): THREE.AnimationAction {
    let a = this.actionCache.get(clip);
    if (!a) {
      a = this.mixer.clipAction(clip);
      a.setLoop(THREE.LoopRepeat, Infinity);
      this.actionCache.set(clip, a);
    }
    return a;
  }
}
