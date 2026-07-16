// survival.ts — B6-14 energy collapse + B6-15 starvation state machines.
// Pure, serializable logic only. main.ts owns animation, interruption, toast, and game-over UI.

export interface EnergyCollapseState { armed: boolean; phase: 'ready' | 'collapse' | 'sleep'; elapsed: number }
export interface EnergyCollapseConfig { collapseSeconds: number; sleepSeconds: number }

export function initEnergyCollapseState(): EnergyCollapseState {
  return { armed: true, phase: 'ready', elapsed: 0 };
}

export type EnergyCollapseEvent = 'collapse' | 'sleep' | 'complete' | null;

export function tickEnergyCollapse(state: EnergyCollapseState, dt: number, energy: number, cfg: EnergyCollapseConfig): EnergyCollapseEvent {
  if (state.phase === 'ready') {
    if (!state.armed || energy > 0) return null;
    state.armed = false;
    state.phase = 'collapse';
    state.elapsed = 0;
    return 'collapse';
  }
  state.elapsed += Math.max(0, dt);
  if (state.phase === 'collapse' && state.elapsed >= Math.max(0, cfg.collapseSeconds)) {
    state.phase = 'sleep';
    state.elapsed = 0;
    return 'sleep';
  }
  if (state.phase === 'sleep' && state.elapsed >= Math.max(0, cfg.sleepSeconds)) {
    state.phase = 'ready';
    state.elapsed = 0;
    state.armed = true;
    return 'complete';
  }
  return null;
}

export interface StarvationState { phase: 'safe' | 'countdown' | 'collapse' | 'gameOver'; elapsed: number }
export interface StarvationConfig { countdownSeconds: number; collapseSeconds: number; recoveryThreshold: number }
export type StarvationEvent = 'warning' | 'cancelled' | 'collapse' | 'gameOver' | null;

export class StarvationTracker {
  state: StarvationState = { phase: 'safe', elapsed: 0 };

  tick(dt: number, hunger: number, cfg: StarvationConfig): StarvationEvent {
    if (this.state.phase === 'safe') {
      if (hunger > 0) return null;
      this.state = { phase: 'countdown', elapsed: 0 };
      return 'warning';
    }
    if (this.state.phase === 'gameOver') return null;
    if (this.state.phase === 'countdown' && hunger > Math.max(0, cfg.recoveryThreshold)) {
      this.state = { phase: 'safe', elapsed: 0 };
      return 'cancelled';
    }
    this.state.elapsed += Math.max(0, dt);
    if (this.state.phase === 'countdown' && this.state.elapsed >= Math.max(0, cfg.countdownSeconds)) {
      this.state = { phase: 'collapse', elapsed: 0 };
      return 'collapse';
    }
    if (this.state.phase === 'collapse' && this.state.elapsed >= Math.max(0, cfg.collapseSeconds)) {
      this.state = { phase: 'gameOver', elapsed: 0 };
      return 'gameOver';
    }
    return null;
  }

  serialize(): StarvationState { return { ...this.state }; }
  restore(state: StarvationState): void { this.state = { ...state }; }
}
