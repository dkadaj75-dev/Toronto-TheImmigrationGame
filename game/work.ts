// work.ts — pure work attendance/shift logic (PROJECT_CONTEXT.md §7.20 V3, ROADMAP_NEXT B3-8).
// No DOM or three.js dependency: hour-window math, returns/pay, missed-shift accounting, job loss,
// and save/restore are all headless-tested in test/work.test.ts. Runtime effects (hiding the sim,
// applying funds through QuestRunner, HUD toasts, and visa grace) stay in main.ts.

import type { JobDef, VisaDef } from './data';

export interface WorkTime { day: number; hour: number }
export interface WorkHours { startHour: number; endHour: number }
export interface WorkWindow { startAbsHour: number; endAbsHour: number }
export interface WorkReturnPoint { pos: [number, number]; facingDeg: number }

export interface ActiveWorkShift extends WorkWindow {
  jobId: string;
  levelIndex: number;
  payPerShift: number;
  needsCost: Record<string, number>;
  returnPoint: WorkReturnPoint;
}

export interface WorkSaveState {
  jobId: string | null;
  skips: number;
  nextShiftStartAbsHour: number | null;
  attendedShiftStartAbsHour: number | null;
  notifiedShiftStartAbsHour: number | null;
  activeShift: ActiveWorkShift | null;
  jobLevels: Record<string, number>;
}

export interface PromotionResult {
  promoted: boolean;
  chancePercent: number;
  fromLevel: number;
  toLevel: number;
  title: string;
  payIncrease: number;
}

export type StartWorkResult =
  | { ok: true; shift: ActiveWorkShift }
  | { ok: false; reason: 'already_at_work' | 'outside_hours' };

export type WorkTickEvent =
  | { type: 'due'; jobId: string; endHour: number }
  | { type: 'returned'; jobId: string; pay: number; needsCost: Record<string, number>; returnPoint: WorkReturnPoint }
  | { type: 'skipped'; jobId: string; skips: number }
  | { type: 'job_lost'; jobId: string; skips: number };

const EPSILON = 1e-9;

export function jobLevelIndex(job: JobDef, rawLevel: number): number {
  const max = Math.max(0, (job.levels?.length ?? 1) - 1);
  return Math.min(max, Math.max(0, Math.floor(Number.isFinite(rawLevel) ? rawLevel : 0)));
}

export function jobLevelTitle(job: JobDef, rawLevel = 0): string {
  const suffix = job.levels?.[jobLevelIndex(job, rawLevel)]?.suffix?.trim();
  return suffix ? `${job.name} ${suffix}` : job.name;
}

export function jobLevelPay(job: JobDef, rawLevel = 0): number {
  const authored = job.levels?.[jobLevelIndex(job, rawLevel)]?.payPerShift;
  return Number.isFinite(authored) ? authored! : job.payPerShift;
}

/** Exact B6-5 formula: current level chance × happiness/100 × promotionHappinessFactor. */
export function promotionChancePercent(job: JobDef, rawLevel: number, happiness: number, factor = 1): number {
  const level = jobLevelIndex(job, rawLevel);
  if (!job.levels || level >= job.levels.length - 1) return 0;
  const base = Number.isFinite(job.levels[level].promoteChancePercent) ? job.levels[level].promoteChancePercent : 0;
  const happyScale = Math.min(100, Math.max(0, Number.isFinite(happiness) ? happiness : 0)) / 100;
  const tunedFactor = Math.max(0, Number.isFinite(factor) ? factor : 1);
  return Math.min(100, Math.max(0, base * happyScale * tunedFactor));
}

export function rollForPromotion(
  job: JobDef, rawLevel: number, happiness: number, factor = 1, rng: () => number = Math.random,
): PromotionResult {
  const fromLevel = jobLevelIndex(job, rawLevel);
  const chancePercent = promotionChancePercent(job, fromLevel, happiness, factor);
  const rawRoll = rng();
  const roll = Number.isFinite(rawRoll) ? Math.min(0.999999999999, Math.max(0, rawRoll)) : 1;
  const promoted = chancePercent > 0 && roll * 100 < chancePercent;
  const toLevel = promoted ? fromLevel + 1 : fromLevel;
  return {
    promoted, chancePercent, fromLevel, toLevel,
    title: jobLevelTitle(job, toLevel),
    payIncrease: promoted ? jobLevelPay(job, toLevel) - jobLevelPay(job, fromLevel) : 0,
  };
}

export function normalizeGameHour(hour: number): number {
  return ((hour % 24) + 24) % 24;
}

export function absoluteGameHour(time: WorkTime): number {
  return time.day * 24 + normalizeGameHour(time.hour);
}

/** Shift duration in hours. Equal start/end is treated as a 24-hour window, not an empty shift. */
export function workWindowDuration(hours: WorkHours): number {
  const start = normalizeGameHour(hours.startHour);
  const end = normalizeGameHour(hours.endHour);
  const wrapped = (end - start + 24) % 24;
  return wrapped === 0 ? 24 : wrapped;
}

/** The shift that contains `time`, including a previous-day start for overnight jobs. */
export function workWindowContaining(time: WorkTime, hours: WorkHours): WorkWindow | null {
  const now = absoluteGameHour(time);
  const startHour = normalizeGameHour(hours.startHour);
  const duration = workWindowDuration(hours);
  const day = Math.floor(now / 24);
  const todayStart = day * 24 + startHour;
  for (const start of [todayStart, todayStart - 24]) {
    const end = start + duration;
    if (now + EPSILON >= start && now < end - EPSILON) {
      return { startAbsHour: start, endAbsHour: end };
    }
  }
  return null;
}

/** Start-inclusive/end-exclusive, including windows that cross midnight. */
export function isWithinWorkHours(time: WorkTime, hours: WorkHours): boolean {
  return workWindowContaining(time, hours) !== null;
}

/** Code-side companion to leave_for_work's existing vars.job condition. Unknown ids stay hidden. */
export function isLeaveForWorkAvailable(jobId: unknown, jobs: readonly JobDef[], time: WorkTime): boolean {
  if (typeof jobId !== 'string' || !jobId) return false;
  const job = jobs.find((entry) => entry.id === jobId);
  return !!job && isWithinWorkHours(time, job.hours);
}

/** Pure return/pay decision; the active shift snapshots its pay and end time at departure. */
export function decideWorkReturn(active: ActiveWorkShift | null, time: WorkTime): WorkTickEvent | null {
  if (!active || absoluteGameHour(time) + EPSILON < active.endAbsHour) return null;
  return {
    type: 'returned',
    jobId: active.jobId,
    pay: active.payPerShift,
    needsCost: { ...active.needsCost },
    returnPoint: { pos: [...active.returnPoint.pos] as [number, number], facingDeg: active.returnPoint.facingDeg },
  };
}

/** Return a new needs table after subtracting positive job costs. Unknown need ids are ignored. */
export function applyNeedsCost(
  currentNeeds: Readonly<Record<string, number>>,
  needsCost: Readonly<Record<string, number>> | undefined,
): Record<string, number> {
  const next = { ...currentNeeds };
  for (const [needId, rawCost] of Object.entries(needsCost ?? {})) {
    if (!(needId in next)) continue;
    const cost = Number.isFinite(rawCost) ? Math.max(0, rawCost) : 0;
    next[needId] = Math.max(0, next[needId] - cost);
  }
  return next;
}

/** Job-loss grace applies only to the exact job-granted, currently-held, losable visa. */
export function shouldStartVisaGrace(job: JobDef, currentStatusId: string, currentVisa: VisaDef | undefined): boolean {
  return !!job.grantsVisa
    && job.grantsVisa === currentStatusId
    && currentVisa?.id === currentStatusId
    && currentVisa.losable === true;
}

function firstShiftStartAtOrAfter(time: WorkTime, hours: WorkHours): number {
  const now = absoluteGameHour(time);
  const startHour = normalizeGameHour(hours.startHour);
  const day = Math.floor(now / 24);
  let candidate = day * 24 + startHour;
  if (candidate < now - EPSILON) candidate += 24;
  return candidate;
}

function cloneActive(active: ActiveWorkShift | null): ActiveWorkShift | null {
  return active ? {
    ...active,
    needsCost: { ...(active.needsCost ?? {}) },
    returnPoint: { pos: [...active.returnPoint.pos] as [number, number], facingDeg: active.returnPoint.facingDeg },
  } : null;
}

/**
 * Serializable runtime attendance state. `nextShiftStartAbsHour` is the first shift whose entire
 * window begins after the current job was acquired; this prevents a job accepted halfway through
 * today's hours from retroactively becoming a skip, while accepting before (or exactly at) the
 * start correctly tracks that shift. Each ended window advances the cursor by exactly 24 hours,
 * so a missed shift can increment only once even when tick() is called every frame.
 */
export class WorkTracker {
  private state: WorkSaveState = {
    jobId: null,
    skips: 0,
    nextShiftStartAbsHour: null,
    attendedShiftStartAbsHour: null,
    notifiedShiftStartAbsHour: null,
    activeShift: null,
    jobLevels: {},
  };

  get jobId(): string | null { return this.state.jobId; }
  get skips(): number { return this.state.skips; }
  get isAtWork(): boolean { return this.state.activeShift !== null; }
  get activeShift(): ActiveWorkShift | null { return cloneActive(this.state.activeShift); }
  getJobLevel(jobId: string): number { return Math.max(0, Math.floor(this.state.jobLevels[jobId] ?? 0)); }

  /** Changing jobs starts fresh attendance. Runtime state for the same job is left untouched. */
  syncJob(job: JobDef | null, time: WorkTime) {
    const nextId = job?.id ?? null;
    if (nextId === this.state.jobId) return;
    this.state = {
      jobId: nextId,
      skips: 0,
      nextShiftStartAbsHour: job ? firstShiftStartAtOrAfter(time, job.hours) : null,
      attendedShiftStartAbsHour: null,
      notifiedShiftStartAbsHour: null,
      activeShift: null,
      jobLevels: this.state.jobLevels,
    };
  }

  beginShift(job: JobDef, time: WorkTime, returnPoint: WorkReturnPoint): StartWorkResult {
    if (this.state.activeShift) return { ok: false, reason: 'already_at_work' };
    this.syncJob(job, time);
    const window = workWindowContaining(time, job.hours);
    if (!window) return { ok: false, reason: 'outside_hours' };
    const shift: ActiveWorkShift = {
      ...window,
      jobId: job.id,
      levelIndex: jobLevelIndex(job, this.getJobLevel(job.id)),
      payPerShift: jobLevelPay(job, this.getJobLevel(job.id)),
      needsCost: { ...(job.needsCost ?? {}) },
      returnPoint: { pos: [...returnPoint.pos] as [number, number], facingDeg: returnPoint.facingDeg },
    };
    this.state.activeShift = shift;
    this.state.attendedShiftStartAbsHour = window.startAbsHour;
    return { ok: true, shift: cloneActive(shift)! };
  }

  /** Called only by main.ts after a returned/completed shift; updates the serializable per-job map. */
  rollPromotion(job: JobDef, happiness: number, factor = 1, rng: () => number = Math.random): PromotionResult {
    const result = rollForPromotion(job, this.getJobLevel(job.id), happiness, factor, rng);
    if (result.promoted) this.state.jobLevels[job.id] = result.toLevel;
    return result;
  }

  /**
   * Called on game clock ticks. Emits return first, then processes every fully-ended attendance
   * window. A missed window increments once; skips > maxSkips emits job_lost and clears the tracked
   * job. The caller owns vars.job and applies that external mutation in response to the event.
   */
  tick(job: JobDef | null, time: WorkTime): WorkTickEvent[] {
    const events: WorkTickEvent[] = [];

    const returned = decideWorkReturn(this.state.activeShift, time);
    if (returned) {
      events.push(returned);
      this.state.activeShift = null;
    }

    // A shift snapshots its own end/pay/return data. Keep it authoritative until return even if a
    // hot-reload temporarily removes/changes the job definition or external vars.job changes.
    if (this.state.activeShift) return events;

    this.syncJob(job, time);
    if (!job || this.state.jobId !== job.id || this.state.nextShiftStartAbsHour === null) return events;

    const now = absoluteGameHour(time);
    const duration = workWindowDuration(job.hours);
    const nextStart = this.state.nextShiftStartAbsHour;
    if (now + EPSILON >= nextStart
      && now < nextStart + duration - EPSILON
      && this.state.attendedShiftStartAbsHour !== nextStart
      && this.state.notifiedShiftStartAbsHour !== nextStart) {
      this.state.notifiedShiftStartAbsHour = nextStart;
      events.push({ type: 'due', jobId: job.id, endHour: normalizeGameHour(job.hours.endHour) });
    }
    while (this.state.nextShiftStartAbsHour + duration <= now + EPSILON) {
      const shiftStart = this.state.nextShiftStartAbsHour;
      const attended = this.state.attendedShiftStartAbsHour !== null
        && Math.abs(this.state.attendedShiftStartAbsHour - shiftStart) <= EPSILON;
      this.state.nextShiftStartAbsHour += 24;
      if (attended) {
        this.state.attendedShiftStartAbsHour = null;
        continue;
      }

      this.state.skips += 1;
      events.push({ type: 'skipped', jobId: job.id, skips: this.state.skips });
      if (this.state.skips > job.maxSkips) {
        events.push({ type: 'job_lost', jobId: job.id, skips: this.state.skips });
        this.state.jobId = null;
        this.state.nextShiftStartAbsHour = null;
        this.state.attendedShiftStartAbsHour = null;
        this.state.notifiedShiftStartAbsHour = null;
        break;
      }
    }
    return events;
  }

  serialize(): WorkSaveState {
    return {
      ...this.state,
      activeShift: cloneActive(this.state.activeShift),
      jobLevels: { ...this.state.jobLevels },
    };
  }

  restore(saved: WorkSaveState) {
    this.state = {
      jobId: saved.jobId,
      skips: saved.skips,
      nextShiftStartAbsHour: saved.nextShiftStartAbsHour,
      attendedShiftStartAbsHour: saved.attendedShiftStartAbsHour,
      notifiedShiftStartAbsHour: saved.notifiedShiftStartAbsHour ?? null,
      activeShift: cloneActive(saved.activeShift),
      jobLevels: { ...(saved.jobLevels ?? {}) },
    };
  }
}
