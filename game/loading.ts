// loading.ts — B7-7 pure initial-load accounting + phrase selection.
// The browser overlay lives in main.ts/index.html; this module deliberately has no DOM/three.js
// dependency so the important "started vs settled, then seal" gate is headless-testable.

export interface LoadingProgress {
  started: number;
  settled: number;
  ratio: number;
  sealed: boolean;
  complete: boolean;
}

export type LoadProgressCallback = (progress: LoadingProgress) => void;

export class InitialLoadTracker {
  private started = 0;
  private settled = 0;
  private sealed = false;
  private listeners = new Set<LoadProgressCallback>();
  private resolveDone!: () => void;
  readonly done = new Promise<void>((resolve) => { this.resolveDone = resolve; });

  get progress(): LoadingProgress {
    const complete = this.sealed && this.settled >= this.started;
    return {
      started: this.started,
      settled: this.settled,
      ratio: this.started === 0 ? (complete ? 1 : 0) : Math.min(1, this.settled / this.started),
      sealed: this.sealed,
      complete,
    };
  }

  subscribe(listener: LoadProgressCallback): () => void {
    this.listeners.add(listener);
    listener(this.progress);
    return () => this.listeners.delete(listener);
  }

  /** Register one real async load. Success and fallback/failure both count as settled. */
  track<T>(promise: Promise<T>): Promise<T> {
    if (this.sealed) throw new Error('InitialLoadTracker cannot register loads after seal()');
    this.started++;
    this.emit();
    return promise.finally(() => {
      this.settled++;
      this.emit();
    });
  }

  /** Close registration only after every initial builder has kicked off its promises. */
  seal(): void {
    this.sealed = true;
    this.emit();
  }

  private emit(): void {
    const progress = this.progress;
    for (const listener of this.listeners) listener(progress);
    if (progress.complete) this.resolveDone();
  }
}

export function phraseAt(phrases: readonly string[], elapsedSeconds: number, intervalSeconds: number): string {
  if (phrases.length === 0) return 'Loading condo…';
  const interval = Number.isFinite(intervalSeconds) && intervalSeconds > 0 ? intervalSeconds : 3;
  const elapsed = Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0;
  return phrases[Math.floor(elapsed / interval) % phrases.length];
}
