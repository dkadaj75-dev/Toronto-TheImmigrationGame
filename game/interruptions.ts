// Pure pause-reason ownership. The HUD/main-loop adapter is intentionally deferred to G2/G3.

export interface PauseToken { readonly id: number; }

/**
 * Holds independent pause reasons without owning the simulation clock or work away-state.
 *
 * Composition contract for main.ts: when `isPaused()` is true, effective speed is always zero.
 * Only while the stack is empty may main.ts choose the work-away `tuning.work.autoSpeed` override;
 * otherwise it uses the HUD's player-selected speed. `speedToRestore()` yields the remembered
 * player speed once after the final token pops, so an away auto-speed is never captured/restored.
 */
export class PauseStack {
  private nextId = 0;
  private readonly reasons = new Map<PauseToken, string>();
  private rememberedPlayerSpeed = 1;
  private pausedPlayerSpeed: number | null = null;
  private pendingRestoreSpeed: number | null = null;

  push(reason: string): PauseToken {
    if (this.reasons.size === 0) {
      this.pausedPlayerSpeed = this.rememberedPlayerSpeed;
      this.pendingRestoreSpeed = null;
    }
    const token = Object.freeze({ id: ++this.nextId });
    this.reasons.set(token, reason);
    return token;
  }

  pop(token: PauseToken): void {
    if (!this.reasons.delete(token)) return;
    if (this.reasons.size === 0) {
      this.pendingRestoreSpeed = this.pausedPlayerSpeed;
      this.pausedPlayerSpeed = null;
    }
  }

  isPaused(): boolean { return this.reasons.size > 0; }

  /** Records a player HUD choice only while no interruption owns the pause. */
  rememberSpeed(speed: number): void {
    if (this.isPaused() || !Number.isFinite(speed) || speed < 0) return;
    this.rememberedPlayerSpeed = speed;
  }

  /** Returns the final-pop restore speed once; null while nested/paused or after consumption. */
  speedToRestore(): number | null {
    if (this.isPaused()) return null;
    const speed = this.pendingRestoreSpeed;
    this.pendingRestoreSpeed = null;
    return speed;
  }

  /** Reasons in push order. Duplicate reason strings remain visible as independent owners. */
  pausedBy(): string[] { return [...this.reasons.values()]; }
}
