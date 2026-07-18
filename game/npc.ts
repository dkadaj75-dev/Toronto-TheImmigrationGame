// npc.ts — SOCIAL S3 visiting-NPC lifecycle (pure) + a thin THREE/SimAgent runtime adapter.
// The lifecycle owns all time/state/side-effect gates. NpcVisitorController only translates its
// transitions into the existing character loader, AnimController, SimAgent and Autonomy classes.

import * as THREE from 'three';
import type { AssetDef, CharacterTuning, GameData } from './data';
import type { NavGrid } from './nav';
import { cellCenter, isWalkable, worldToCell } from './nav';
import { SimAgent, type ActiveAction } from './sim';
import { Autonomy, type AutonomyStats } from './autonomy';
import { AnimController } from './anim';
import { loadRiggedCharacter } from './world';
import { effectiveNeedGain } from './stats';
import { phoneGain, type PhoneGainResult, type SocialData } from './social';
import type { EvalContext } from './quests';
import type { ExteriorDoorTransitHandle } from './doors';

export interface NpcDef {
  id: string;
  name: string;
  portrait?: string;
  mesh?: string;
  tint?: string;
  clipMap?: Record<string, string> | null;
  personality: Record<string, number>;
  availableHours: { from: number; to: number };
  visitDurationHours: number;
  arrivalDelayMinutes: number;
  /** Per-NPC object-action allow-list consumed by the ordinary Autonomy scanner/scorer. */
  visitorActions: string[];
}

export interface NpcsData { npcs: NpcDef[]; }

export type VisitPhase = 'idle' | 'pending' | 'entering' | 'visiting' | 'leaving';
export type VisitLeaveReason = 'duration' | 'asked' | 'availability' | null;

export interface VisitSaveState {
  phase: VisitPhase;
  npcId: string | null;
  compatibilityMultiplier: number;
  pendingElapsedMinutes: number;
  visitElapsedMinutes: number;
  /** One normalized internal meter: 1 = content/socially full, 0 = ready to leave. */
  socialMeter: number;
  leaveReason: VisitLeaveReason;
}

export interface VisitTickHooks {
  /** Rig readiness is an explicit pure input: pending waits; failed uses the call fallback. */
  modelReadiness(npc: NpcDef): 'pending' | 'ready' | 'failed';
  /** Completion seam for the pending-arrival timer once the rig is ready. */
  beginArrival(npc: NpcDef): boolean;
  onCallFallback?(npc: NpcDef, outcome: PhoneGainResult): void;
}

const idleState = (): VisitSaveState => ({
  phase: 'idle', npcId: null, compatibilityMultiplier: 1,
  pendingElapsedMinutes: 0, visitElapsedMinutes: 0, socialMeter: 1, leaveReason: null,
});

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Availability supports ordinary daytime windows and ranges crossing midnight. The end is
 * exclusive: reaching `to` is the exact leave trigger. */
export function isNpcAvailable(hour: number, hours: NpcDef['availableHours']): boolean {
  const h = ((hour % 24) + 24) % 24;
  const from = ((hours.from % 24) + 24) % 24;
  const to = ((hours.to % 24) + 24) % 24;
  if (from === to) return true;
  return from < to ? h >= from && h < to : h >= from || h < to;
}

/** Pure, serializable, exactly-one-visitor state machine. Durations are authored in game
 * minutes/hours; tick converts the caller's simulation `sdt` using main.ts's live clock scale. */
export class VisitLifecycle {
  private saved: VisitSaveState = idleState();

  constructor(private getNpcs: () => NpcsData, private getSocial: () => SocialData) {}

  canInvite(): boolean { return this.saved.phase === 'idle'; }
  get state(): Readonly<VisitSaveState> { return { ...this.saved }; }

  invite(npcId: string, compatibilityMultiplier = 1): boolean {
    if (!this.canInvite() || !this.findNpc(npcId)) return false;
    this.saved = {
      phase: 'pending', npcId,
      compatibilityMultiplier: Number.isFinite(compatibilityMultiplier) ? compatibilityMultiplier : 1,
      pendingElapsedMinutes: 0, visitElapsedMinutes: 0, socialMeter: 1, leaveReason: null,
    };
    return true;
  }

  /** Called by S4 only after its social interaction completes. Passing false is an explicit
   * cancel/interrupt and therefore changes nothing (the repo's completion-only rule). */
  endVisit(completed = true): boolean {
    if (!completed || (this.saved.phase !== 'entering' && this.saved.phase !== 'visiting')) return false;
    this.beginLeaving('asked');
    return true;
  }

  /** Runtime arrival notification: walking through the door completed. */
  markEntered(): boolean {
    if (this.saved.phase !== 'entering') return false;
    this.saved.phase = 'visiting';
    return true;
  }

  /** Runtime departure notification: walking back to the exterior door completed. */
  markExited(): boolean {
    if (this.saved.phase !== 'leaving') return false;
    this.saved = idleState();
    return true;
  }

  /** S4 can mirror completed positive social outcomes into the visitor's ONE internal meter. */
  adjustSocialMeter(delta: number): void {
    if (this.saved.phase !== 'visiting' || !Number.isFinite(delta)) return;
    this.saved.socialMeter = Math.max(0, Math.min(1, this.saved.socialMeter + delta));
  }

  tick(sdtSeconds: number, gameSecondsPerSimSecond: number, hourNow: number, hooks: VisitTickHooks): void {
    const deltaMinutes = finiteNonNegative(sdtSeconds) * finiteNonNegative(gameSecondsPerSimSecond) / 60;
    const npc = this.saved.npcId ? this.findNpc(this.saved.npcId) : null;
    if (!npc) {
      if (this.saved.phase !== 'idle') this.saved = idleState();
      return;
    }

    if (this.saved.phase === 'pending') {
      this.saved.pendingElapsedMinutes += deltaMinutes;
      if (this.saved.pendingElapsedMinutes < finiteNonNegative(npc.arrivalDelayMinutes)) return;
      const readiness = hooks.modelReadiness(npc);
      if (readiness === 'pending') return;
      // Load failure and an unreachable door deliberately share the exact call-fallback seam.
      if (readiness === 'failed' || !hooks.beginArrival(npc)) {
        const outcome = phoneGain('call', this.saved.compatibilityMultiplier, this.getSocial());
        this.saved = idleState();
        hooks.onCallFallback?.(npc, outcome);
        return;
      }
      this.saved.phase = 'entering';
      return;
    }

    if (this.saved.phase !== 'visiting') return;
    this.saved.visitElapsedMinutes += deltaMinutes;
    const durationMinutes = finiteNonNegative(npc.visitDurationHours) * 60;
    if (durationMinutes > 0) {
      this.saved.socialMeter = Math.max(0, this.saved.socialMeter - deltaMinutes / durationMinutes);
    } else {
      this.saved.socialMeter = 0;
    }
    if (durationMinutes === 0 || this.saved.visitElapsedMinutes >= durationMinutes) {
      this.beginLeaving('duration');
    } else if (!isNpcAvailable(hourNow, npc.availableHours)) {
      this.beginLeaving('availability');
    }
  }

  serialize(): VisitSaveState { return { ...this.saved }; }

  restore(state: VisitSaveState): void {
    const phases: VisitPhase[] = ['idle', 'pending', 'entering', 'visiting', 'leaving'];
    if (!state || !phases.includes(state.phase) || (state.phase !== 'idle' && !this.findNpc(state.npcId ?? ''))) {
      this.saved = idleState();
      return;
    }
    this.saved = {
      phase: state.phase,
      npcId: state.phase === 'idle' ? null : state.npcId,
      compatibilityMultiplier: Number.isFinite(state.compatibilityMultiplier) ? state.compatibilityMultiplier : 1,
      pendingElapsedMinutes: finiteNonNegative(state.pendingElapsedMinutes),
      visitElapsedMinutes: finiteNonNegative(state.visitElapsedMinutes),
      socialMeter: Math.max(0, Math.min(1, Number.isFinite(state.socialMeter) ? state.socialMeter : 1)),
      leaveReason: state.leaveReason ?? null,
    };
  }

  private findNpc(id: string): NpcDef | null {
    return this.getNpcs().npcs.find((npc) => npc.id === id) ?? null;
  }

  private beginLeaving(reason: Exclude<VisitLeaveReason, null>): void {
    this.saved.phase = 'leaving';
    this.saved.leaveReason = reason;
  }
}

export interface NpcVisitorControllerOptions {
  scene: THREE.Scene;
  getData: () => GameData;
  getWorld: () => THREE.Group;
  getGrid: () => NavGrid;
  getHour: () => number;
  getEvalContext?: () => EvalContext;
  getCompatibilityMultiplier?: (npc: NpcDef) => number;
  exteriorDoorUsable?: (doorObject: THREE.Object3D, doorDef: AssetDef) => boolean;
  requestExteriorTransit?: (request: {
    passThrough: () => void;
    passComplete: () => boolean;
    onClosed?: () => void;
  }) => ExteriorDoorTransitHandle | null;
  onCallFallback?: (npc: NpcDef, outcome: PhoneGainResult) => void;
  feedback?: (message: string) => void;
}

interface LiveVisitor {
  npc: NpcDef;
  root: THREE.Group;
  agent: SimAgent;
  anim: AnimController | null;
  autonomy: Autonomy;
  autonomyPaused: boolean;
  leaveOrdered: boolean;
  decisionAcc: number;
  gainAcc: number;
  loadToken: object;
  rigSignature: string;
  transit: ExteriorDoorTransitHandle | null;
  entryStarted: boolean;
  entryClosed: boolean;
  exitTransitStarted: boolean;
}

interface PreparedVisitorRig {
  npcId: string;
  signature: string;
  model: THREE.Object3D;
  anim: AnimController;
}

type RigPreloadState =
  | { status: 'idle' }
  | { status: 'pending'; npcId: string; signature: string; token: object }
  | { status: 'ready'; rig: PreparedVisitorRig }
  | { status: 'failed'; npcId: string; signature: string };

/** Thin scene adapter. Public methods are intentionally the S4/S5 integration surface. */
export class NpcVisitorController {
  readonly lifecycle: VisitLifecycle;
  private live: LiveVisitor | null = null;
  private preload: RigPreloadState = { status: 'idle' };

  constructor(private options: NpcVisitorControllerOptions) {
    this.lifecycle = new VisitLifecycle(
      () => this.options.getData().npcs ?? { npcs: [] },
      () => this.options.getData().social as SocialData,
    );
  }

  canInvite(): boolean { return this.lifecycle.canInvite(); }
  get state(): Readonly<VisitSaveState> { return this.lifecycle.state; }
  get visitorObject(): THREE.Group | null { return this.live?.root ?? null; }
  get visitorAgent(): SimAgent | null { return this.live?.agent ?? null; }

  /** S4 presentation/meter adapters. State math remains owned by VisitLifecycle. */
  playInteraction(animation: string): void { this.live?.anim?.play(animation || 'idle'); }
  stopInteraction(): void { this.live?.anim?.play(this.live?.agent.isMoving ? 'walk' : 'idle'); }
  adjustSocialMeter(delta: number): void { this.lifecycle.adjustSocialMeter(delta); }

  invite(npcId: string): boolean {
    const data = this.options.getData();
    const npc = data.npcs?.npcs.find((entry) => entry.id === npcId);
    if (!npc || !data.social) return false;
    const accepted = this.lifecycle.invite(npcId, this.options.getCompatibilityMultiplier?.(npc) ?? 1);
    if (accepted) this.preloadRig(npc);
    return accepted;
  }

  endVisit(completed = true): boolean { return this.lifecycle.endVisit(completed); }

  /** S4 engagement seam: pause free will and cancel the NPC's object action as an interruption. */
  engage(): void { this.setAutonomyPaused(true); }
  setAutonomyPaused(paused: boolean): void {
    if (!this.live) return;
    this.live.autonomyPaused = paused;
    if (paused) this.live.agent.stopAction(false);
  }

  retune(): void {
    const data = this.options.getData();
    const pendingId = this.lifecycle.state.phase === 'pending' ? this.lifecycle.state.npcId : null;
    if (pendingId) {
      const pendingNpc = data.npcs?.npcs.find((npc) => npc.id === pendingId);
      if (pendingNpc && this.rigReadiness(pendingNpc) === 'failed') this.preloadRig(pendingNpc);
    }
    if (!this.live) return;
    const current = data.npcs?.npcs.find((npc) => npc.id === this.live!.npc.id);
    if (!current) {
      this.despawn();
      this.lifecycle.restore({ ...idleState() });
      return;
    }
    this.live.npc = current;
    this.live.agent.stopAction(false);
    this.live.agent.retune(data.tuning, this.options.getGrid(), assetMap(data));
    const nextTuning = characterTuningFor(this.live.npc, data);
    const nextSignature = characterSignature(nextTuning, this.live.npc.tint);
    if (this.live.rigSignature !== nextSignature) {
      this.live.rigSignature = nextSignature;
      this.live.loadToken = {};
      this.loadRig(this.live);
    } else {
      this.live.anim?.retune(nextTuning);
    }
  }

  update(sdtSeconds: number, gameSecondsPerSimSecond: number): void {
    const data = this.options.getData();
    if (!data.social || !data.npcs) return;
    this.lifecycle.tick(sdtSeconds, gameSecondsPerSimSecond, this.options.getHour(), {
      modelReadiness: (npc) => this.rigReadiness(npc),
      beginArrival: (npc) => this.spawn(npc, true),
      onCallFallback: (npc, outcome) => {
        this.clearPreload();
        this.options.onCallFallback?.(npc, outcome);
        this.options.feedback?.(`${npc.name} couldn't reach your door, so you caught up by phone.`);
      },
    });

    const live = this.live;
    if (!live) return;
    live.agent.update(sdtSeconds);
    live.anim?.update(sdtSeconds);

    if (this.lifecycle.state.phase === 'entering' && live.entryStarted && !live.transit && !live.agent.isMoving) {
      live.entryClosed = true;
    }
    if (this.lifecycle.state.phase === 'entering' && live.entryClosed) {
      this.lifecycle.markEntered();
      live.anim?.play('idle');
    }

    if (this.lifecycle.state.phase === 'visiting' && !live.autonomyPaused) {
      live.autonomy.update(sdtSeconds);
      live.decisionAcc += sdtSeconds;
      const decisionEvery = data.tuning.simulation.needsDecayTickSeconds;
      while (decisionEvery > 0 && live.decisionAcc >= decisionEvery) {
        live.decisionAcc -= decisionEvery;
        live.autonomy.maybeAct();
      }
      this.tickVisitorAction(live, sdtSeconds);
    }

    if (this.lifecycle.state.phase === 'leaving') this.beginLeaving(live);
  }

  serialize(): VisitSaveState { return this.lifecycle.serialize(); }
  restore(state: VisitSaveState): void {
    this.despawn();
    this.clearPreload();
    this.lifecycle.restore(state);
    const restored = this.lifecycle.state;
    if (restored.phase === 'idle' || !restored.npcId) return;
    const npc = this.options.getData().npcs?.npcs.find((entry) => entry.id === restored.npcId);
    if (!npc) {
      this.lifecycle.restore(idleState());
      return;
    }
    // A restored visible phase must still honor the preload invariant. Re-enter through pending,
    // preserving elapsed clocks; the already-completed arrival delay means it resumes as soon as
    // the rig is ready instead of ever constructing a placeholder.
    if (restored.phase !== 'pending') {
      this.lifecycle.restore({ ...restored, phase: 'pending', pendingElapsedMinutes: npc.arrivalDelayMinutes });
    }
    this.preloadRig(npc);
  }

  private spawn(npc: NpcDef, routeIn: boolean): boolean {
    this.despawn();
    const data = this.options.getData();
    const prepared = this.takePreparedRig(npc);
    if (!prepared) return false;
    const door = exteriorDoor(data);
    if (!door) { disposeObject(prepared.model); return false; }
    const points = doorPoints(this.options.getGrid(), door.entry);
    if (!points) { disposeObject(prepared.model); return false; }
    if (this.options.exteriorDoorUsable && !this.options.exteriorDoorUsable(door.object, door.def)) {
      disposeObject(prepared.model);
      return false;
    }

    const root = new THREE.Group();
    root.add(prepared.model);
    root.name = `npc:${npc.id}`;
    root.userData.npcId = npc.id;
    root.position.set(routeIn ? points.outside[0] : points.inside[0], 0, routeIn ? points.outside[1] : points.inside[1]);
    const agent = new SimAgent(root, this.options.getGrid(), data.tuning, assetMap(data));
    agent.hasRig = true;
    // Validate the same route before making the rig visible/state entering. Movement itself is
    // restarted only by the exterior-transit pass seam after the pane is fully open.
    if (routeIn && !agent.goTo(points.inside[0], points.inside[1])) {
      disposeObject(root);
      return false;
    }
    if (routeIn) agent.halt();

    const stats = visitorStats(npc, () => this.lifecycle.state.socialMeter);
    const live: LiveVisitor = {
      npc, root, agent, anim: prepared.anim, autonomyPaused: false, leaveOrdered: false,
      decisionAcc: 0, gainAcc: 0, loadToken: {},
      rigSignature: prepared.signature, transit: null,
      entryStarted: !routeIn, entryClosed: !routeIn, exitTransitStarted: false,
      autonomy: null as unknown as Autonomy,
    };
    live.autonomy = new Autonomy(
      this.options.getData,
      this.options.getWorld,
      agent,
      stats,
      undefined,
      () => visitorEvalContext(
        this.options.getData(), live.npc, this.lifecycle.state.socialMeter,
        this.options.getHour(), this.options.getEvalContext?.(),
      ),
      { allowedActionIds: () => live.npc.visitorActions ?? [] },
    );
    agent.onLocomotionChange = (moving) => {
      if (!live.anim) return;
      live.anim.play(moving ? 'walk' : agent.current ? actionAnim(agent.current) : 'idle');
      if (moving) live.anim.setWalkSpeed(this.options.getData().tuning.movement.walkSpeed);
    };
    agent.onActionStart = (active) => live.anim?.play(actionAnim(active));
    agent.onActionStop = () => live.anim?.play(agent.isMoving ? 'walk' : 'idle');
    this.live = live;
    this.options.scene.add(root);
    if (routeIn) {
      let passedDoor = false;
      const beginEntry = () => {
        if (this.live !== live) return;
        live.entryStarted = live.agent.goTo(points.inside[0], points.inside[1]);
        passedDoor = live.entryStarted;
        if (!live.entryStarted) live.transit?.cancel();
      };
      if (this.options.requestExteriorTransit) {
        live.transit = this.options.requestExteriorTransit({
          passThrough: beginEntry,
          passComplete: () => this.live !== live || (live.entryStarted && !live.agent.isMoving),
          onClosed: () => {
            if (this.live !== live) return;
            live.transit = null;
            if (passedDoor) live.entryClosed = true;
            else { this.lifecycle.restore(idleState()); this.despawn(); }
          },
        });
        if (!live.transit) { this.despawn(); return false; }
      } else {
        beginEntry();
        if (!live.entryStarted) { this.despawn(); return false; }
      }
    }
    return true;
  }

  private loadRig(live: LiveVisitor): void {
    const tuning = characterTuningFor(live.npc, this.options.getData());
    if (!tuning.meshPath) return;
    const token = live.loadToken;
    loadRiggedCharacter(tuning).then(({ model, clips }) => {
      if (this.live !== live || live.loadToken !== token) { disposeObject(model); return; }
      tintObject(model, live.npc.tint);
      disposeObject(live.root);
      live.root.clear();
      live.root.add(model);
      live.anim = new AnimController(model, clips, tuning);
      live.agent.hasRig = true;
      live.anim.setWalkSpeed(this.options.getData().tuning.movement.walkSpeed);
      live.anim.play(live.agent.current ? actionAnim(live.agent.current) : live.agent.isMoving ? 'walk' : 'idle');
    }).catch((error) => console.warn(`NPC "${live.npc.id}" replacement rig failed to load; keeping the ready rig.`, error));
  }

  private preloadRig(npc: NpcDef): void {
    this.clearPreload();
    const tuning = characterTuningFor(npc, this.options.getData());
    const signature = characterSignature(tuning, npc.tint);
    if (!tuning.meshPath) {
      this.preload = { status: 'failed', npcId: npc.id, signature };
      return;
    }
    const token = {};
    this.preload = { status: 'pending', npcId: npc.id, signature, token };
    loadRiggedCharacter(tuning).then(({ model, clips }) => {
      if (this.preload.status !== 'pending' || this.preload.token !== token) {
        disposeObject(model);
        return;
      }
      tintObject(model, npc.tint);
      const anim = new AnimController(model, clips, tuning);
      anim.setWalkSpeed(this.options.getData().tuning.movement.walkSpeed);
      anim.play('idle');
      this.preload = { status: 'ready', rig: { npcId: npc.id, signature, model, anim } };
    }).catch((error) => {
      if (this.preload.status !== 'pending' || this.preload.token !== token) return;
      console.warn(`NPC "${npc.id}" rig failed to preload; converting the visit to a call.`, error);
      this.preload = { status: 'failed', npcId: npc.id, signature };
    });
  }

  private rigReadiness(npc: NpcDef): 'pending' | 'ready' | 'failed' {
    const signature = characterSignature(characterTuningFor(npc, this.options.getData()), npc.tint);
    if (this.preload.status === 'ready') {
      return this.preload.rig.npcId === npc.id && this.preload.rig.signature === signature ? 'ready' : 'failed';
    }
    if (this.preload.status === 'pending') {
      return this.preload.npcId === npc.id && this.preload.signature === signature ? 'pending' : 'failed';
    }
    return this.preload.status === 'failed' && this.preload.npcId === npc.id ? 'failed' : 'pending';
  }

  private takePreparedRig(npc: NpcDef): PreparedVisitorRig | null {
    if (this.rigReadiness(npc) !== 'ready' || this.preload.status !== 'ready') return null;
    const rig = this.preload.rig;
    this.preload = { status: 'idle' };
    return rig;
  }

  private clearPreload(): void {
    if (this.preload.status === 'ready') disposeObject(this.preload.rig.model);
    this.preload = { status: 'idle' };
  }

  private tickVisitorAction(live: LiveVisitor, sdtSeconds: number): void {
    const data = this.options.getData();
    live.gainAcc += sdtSeconds;
    const every = data.tuning.simulation.activityGainTickSeconds;
    while (every > 0 && live.gainAcc >= every) {
      live.gainAcc -= every;
      const active = live.agent.current;
      if (!active) continue;
      const gainObject = active.seat ?? active.target;
      const def = data.assets.assets.find((asset) => asset.id === gainObject.userData.assetId);
      let gain = 0;
      for (const [needId, raw] of Object.entries(active.action.needGains ?? {})) {
        gain += Math.max(0, effectiveNeedGain(needId, raw, def?.needMultipliers));
      }
      this.lifecycle.adjustSocialMeter(gain / 100);
      if (this.lifecycle.state.socialMeter * 100 >= data.tuning.autonomy.stopAtThreshold) {
        live.agent.stopAction(true);
      }
    }
  }

  private beginLeaving(live: LiveVisitor): void {
    const door = exteriorDoor(this.options.getData());
    const points = door ? doorPoints(this.options.getGrid(), door.entry) : null;
    if (!points) {
      this.lifecycle.markExited();
      this.despawn();
      return;
    }
    if (!live.leaveOrdered) {
      live.autonomyPaused = true;
      live.agent.stopAction(false);
      if (!live.agent.goTo(points.inside[0], points.inside[1])) {
        this.lifecycle.markExited();
        this.despawn();
        return;
      }
      live.leaveOrdered = true;
      return;
    }
    if (live.agent.isMoving || live.exitTransitStarted) return;
    live.exitTransitStarted = true;
    const passThrough = () => {
      if (this.live !== live) return;
      live.anim?.play('walk');
      live.agent.teleportTo(points.outside[0], points.outside[1], THREE.MathUtils.radToDeg(live.root.rotation.y));
    };
    const finish = () => {
      if (this.live !== live) return;
      this.lifecycle.markExited();
      this.despawn();
    };
    if (this.options.requestExteriorTransit) {
      live.transit = this.options.requestExteriorTransit({
        passThrough,
        passComplete: () => true,
        onClosed: finish,
      });
      if (live.transit) return;
    }
    passThrough();
    finish();
  }

  private despawn(): void {
    if (!this.live) return;
    this.live.transit?.cancel();
    this.live.loadToken = {};
    this.live.agent.stopAction(false);
    this.options.scene.remove(this.live.root);
    disposeObject(this.live.root);
    this.live = null;
  }
}

function actionAnim(active: ActiveAction): string {
  return active.groundSit ? 'sit_ground' : active.action.animation || 'idle';
}

function assetMap(data: GameData): Map<string, AssetDef> {
  return new Map(data.assets.assets.map((asset) => [asset.id, asset]));
}

function characterTuningFor(npc: NpcDef, data: GameData): CharacterTuning {
  const base = data.tuning.character;
  return {
    ...(base ?? {
      meshPath: '', heightMeters: 1.55, yawOffsetDeg: 0, animationPaths: [],
      clipMap: {}, crossFadeSeconds: 0.2, walkClipSpeedReference: 1, sitHeight: 0.25, lieHeight: 0.55,
    }),
    meshPath: npc.mesh || base?.meshPath || '',
    clipMap: npc.clipMap ?? base?.clipMap ?? {},
  };
}

function characterSignature(tuning: CharacterTuning, tint?: string): string {
  return JSON.stringify([tuning.meshPath, tuning.animationPaths ?? [], tuning.clipMap, tint ?? null]);
}

function visitorStats(npc: NpcDef, meter: () => number): AutonomyStats {
  return {
    needs: new Map([['social', meter() * 100]]),
    skills: new Map(),
    personality: new Map(Object.entries(npc.personality)),
    lowestAutonomyNeed: () => null,
  };
}

function visitorEvalContext(data: GameData, npc: NpcDef, meter: number, hour: number, base?: EvalContext): EvalContext {
  const value = Math.max(0, Math.min(100, meter * 100));
  return {
    // One underlying meter, projected across authored need ids solely so the existing scorer can
    // compare whitelisted comfort/fun actions. This is not a second NPC needs stack.
    needs: Object.fromEntries(data.stats.needs.map((need) => [need.id, value])),
    skills: {}, personality: { ...npc.personality }, funds: base?.funds ?? 0,
    creditScore: base?.creditScore,
    time: { hour, day: base?.time.day ?? 1 }, vars: base?.vars ?? {}, quests: base?.quests ?? {},
  };
}

function exteriorDoor(data: GameData): { entry: GameData['map']['doors'][number]; def: AssetDef; object: THREE.Object3D } | null {
  const defs = assetMap(data);
  for (const entry of data.map.doors) {
    const def = entry.assetId ? defs.get(entry.assetId) : undefined;
    if (!def?.door?.exterior) continue;
    const object = new THREE.Group();
    object.position.set(entry.at[0], 0, entry.at[1]);
    object.rotation.y = THREE.MathUtils.degToRad(entry.orientation === 'vertical' ? 90 : 0);
    object.userData.assetId = def.id;
    return { entry, def, object };
  }
  return null;
}

/** Resolve the floor-side door apron from the baked nav. The opposite point is deliberately
 * outside nav; SimAgent's ordinary route start recovery makes the rig visibly cross inward. */
function doorPoints(grid: NavGrid, door: GameData['map']['doors'][number]): { inside: [number, number]; outside: [number, number] } | null {
  const normal: [number, number] = door.orientation === 'vertical' ? [1, 0] : [0, 1];
  const distance = grid.cellSize;
  for (const sign of [1, -1]) {
    const candidate: [number, number] = [door.at[0] + normal[0] * distance * sign, door.at[1] + normal[1] * distance * sign];
    const cell = worldToCell(grid, candidate[0], candidate[1]);
    if (!isWalkable(grid, cell)) continue;
    const inside = cellCenter(grid, cell);
    const outside: [number, number] = [door.at[0] - normal[0] * distance * sign, door.at[1] - normal[1] * distance * sign];
    return { inside, outside };
  }
  return null;
}

function tintObject(root: THREE.Object3D, tint?: string): void {
  if (!tint) return;
  const color = new THREE.Color(tint);
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = (Array.isArray(object.material) ? object.material : [object.material]).map((material) => {
      const clone = material.clone();
      const colored = clone as THREE.Material & { color?: THREE.Color };
      colored.color?.multiply(color);
      return clone;
    });
    object.material = Array.isArray(object.material) ? materials : materials[0];
  });
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object.userData.sharedResource) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) material.dispose();
  });
}
