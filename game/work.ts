// work.ts — pure work attendance/shift logic (PROJECT_CONTEXT.md §7.20 V3, ROADMAP_NEXT B3-8).
// No DOM or three.js dependency: weekday/schedule math, hour windows, returns/pay, missed-shift
// accounting, job loss, and save/restore are headless-tested in test/work.test.ts. Runtime effects,
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
  /** H4 (ROADMAP_HAPPY): consecutive completed shifts below the job's firing.minHappiness.
   *  Sparse in old saves (restore defaults 0); resets on job change and on any happy-enough shift. */
  unhappyStreak?: number;
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
  | { type: 'due'; jobId: string; endHour: number; departByHour: number }
  | { type: 'returned'; jobId: string; pay: number; needsCost: Record<string, number>; returnPoint: WorkReturnPoint }
  | { type: 'skipped'; jobId: string; skips: number }
  | { type: 'job_lost'; jobId: string; skips: number }
  // H4 (ROADMAP_HAPPY): unhappy-streak firing (recordShiftMood, called on each completed shift).
  | { type: 'unhappy_shift'; jobId: string; streak: number; maxUnhappyShifts: number }
  | { type: 'fired'; jobId: string; streak: number };

const EPSILON = 1e-9;
export const DEFAULT_DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export interface CalendarTuning { dayNames?: string[]; startDayIndex?: number }

export function calendarDayNames(calendar?: CalendarTuning): string[] {
  const authored = calendar?.dayNames?.map((name) => String(name).trim());
  return authored?.length === 7 && authored.every(Boolean) ? authored : [...DEFAULT_DAY_NAMES];
}

function normalizeDayIndex(index: number, count = 7): number {
  const whole = Math.floor(Number.isFinite(index) ? index : 0);
  return ((whole % count) + count) % count;
}

/** Game day 1 is the tunable start day; the weekday is otherwise derived only from game time. */
export function weekdayIndex(time: WorkTime, calendar?: CalendarTuning): number {
  const names = calendarDayNames(calendar);
  const absoluteDay = Math.floor(absoluteGameHour(time) / 24);
  return normalizeDayIndex((calendar?.startDayIndex ?? 0) + absoluteDay - 1, names.length);
}

export function weekdayName(time: WorkTime, calendar?: CalendarTuning): string {
  const names = calendarDayNames(calendar);
  return names[weekdayIndex(time, calendar)];
}

export function currentWeekday(time: WorkTime, calendar?: CalendarTuning): { id: number; name: string } {
  const id = weekdayIndex(time, calendar);
  return { id, name: calendarDayNames(calendar)[id] };
}

/** Missing workDays is daily. An authored empty array means the job has no scheduled shifts. */
export function isWorkDay(job: Pick<JobDef, 'workDays'>, dayIndex: number, calendar?: CalendarTuning): boolean {
  if (job.workDays === undefined) return true;
  const names = calendarDayNames(calendar);
  const wanted = normalizeDayIndex(dayIndex, names.length);
  return job.workDays.some((entry) => {
    if (typeof entry === 'number' && Number.isFinite(entry)) return normalizeDayIndex(entry, names.length) === wanted;
    if (typeof entry !== 'string') return false;
    return names.findIndex((name) => name.toLocaleLowerCase() === entry.trim().toLocaleLowerCase()) === wanted;
  });
}

function weekdayIndexAtAbsoluteHour(absHour: number, calendar?: CalendarTuning): number {
  return weekdayIndex({ day: Math.floor(absHour / 24), hour: normalizeGameHour(absHour) }, calendar);
}

export function isScheduledWorkWindow(job: JobDef, time: WorkTime, calendar?: CalendarTuning): boolean {
  const window = workWindowContaining(time, job.hours);
  return !!window && isWorkDay(job, weekdayIndexAtAbsoluteHour(window.startAbsHour, calendar), calendar);
}

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

/** B13-19: the sparse Condition gating promotion INTO the next level (levels[from+1]), or
 *  undefined when the ladder ends or the level has none. The CALLER evaluates it (quests.ts
 *  evaluate + live EvalContext) — this module stays free of a quests.ts import. */
export function promotionRequirementsFor(job: JobDef, rawLevel: number): JobDef['requirements'] | undefined {
  const next = job.levels?.[jobLevelIndex(job, rawLevel) + 1];
  return next?.requirements;
}

export function rollForPromotion(
  job: JobDef, rawLevel: number, happiness: number, factor = 1, rng: () => number = Math.random,
  requirementsMet = true,
): PromotionResult {
  const fromLevel = jobLevelIndex(job, rawLevel);
  // B13-19: unmet next-level requirements zero the roll — the chance/happiness math never runs.
  const chancePercent = requirementsMet ? promotionChancePercent(job, fromLevel, happiness, factor) : 0;
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

/**
 * B7-5: how many hours after startHour the DEPARTURE window stays open. Clamped to [0, shift
 * duration]: you can never leave after the shift itself has ended, and a non-positive value closes
 * the window entirely. `Number.isFinite`-guarded so a missing/garbage tunable falls back to the
 * whole shift (old "leave anywhere in hours" behavior).
 */
export function departureWindowCloseOffset(hours: WorkHours, departureWindowHours: number): number {
  const duration = workWindowDuration(hours);
  const raw = Number.isFinite(departureWindowHours) ? departureWindowHours : duration;
  return Math.min(Math.max(0, raw), duration);
}

/**
 * B7-5: the sim may only LEAVE for work within `departureWindowHours` after the shift's startHour
 * (start-inclusive, deadline-exclusive), including windows that cross midnight. Before the shift or
 * past the departure deadline the shift can no longer be attended and is counted as missed.
 */
export function isWithinDepartureWindow(time: WorkTime, hours: WorkHours, departureWindowHours: number): boolean {
  const window = workWindowContaining(time, hours);
  if (!window) return false;
  const close = window.startAbsHour + departureWindowCloseOffset(hours, departureWindowHours);
  return absoluteGameHour(time) < close - EPSILON;
}

/**
 * Code-side companion to leave_for_work's existing vars.job condition. Unknown ids stay hidden.
 * B7-5: pass `departureWindowHours` to gate on the ~2h post-start departure window; omitting it
 * preserves the old "available anywhere within job hours" behavior (used by pre-B7-5 tests).
 */
export function isLeaveForWorkAvailable(
  jobId: unknown, jobs: readonly JobDef[], time: WorkTime, departureWindowHours?: number,
  calendar?: CalendarTuning,
): boolean {
  if (typeof jobId !== 'string' || !jobId) return false;
  const job = jobs.find((entry) => entry.id === jobId);
  if (!job) return false;
  if (!isScheduledWorkWindow(job, time, calendar)) return false;
  return departureWindowHours === undefined
    ? isWithinWorkHours(time, job.hours)
    : isWithinDepartureWindow(time, job.hours, departureWindowHours);
}

/** B7-6 autonomous-departure decision inputs. */
export interface AutoDepartDecision {
  withinDepartureWindow: boolean;
  happiness: number;
  energy: number;
  happinessMin: number;
  energyMin: number;
}

/**
 * B7-6 deterministic-threshold model (documented in PROJECT_CONTEXT.md §7.20): while the departure
 * window is open the sim leaves for work on its OWN iff BOTH happiness and energy clear their
 * independent minimums; below either it stays home. No RNG — fully predictable/testable, and the
 * two floors are tuned separately (tuning.work.autoDepartHappinessMin / autoDepartEnergyMin).
 * Outside the window the decision is always false regardless of stats.
 */
export function decideAutoDepart(d: AutoDepartDecision): boolean {
  if (!d.withinDepartureWindow) return false;
  return d.happiness >= d.happinessMin && d.energy >= d.energyMin;
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

function firstShiftStartAtOrAfter(time: WorkTime, job: JobDef, calendar?: CalendarTuning): number | null {
  const now = absoluteGameHour(time);
  const startHour = normalizeGameHour(job.hours.startHour);
  const day = Math.floor(now / 24);
  let candidate = day * 24 + startHour;
  if (candidate < now - EPSILON) candidate += 24;
  const cycle = calendarDayNames(calendar).length;
  for (let offset = 0; offset < cycle; offset++, candidate += 24) {
    if (isWorkDay(job, weekdayIndexAtAbsoluteHour(candidate, calendar), calendar)) return candidate;
  }
  return null;
}

function nextShiftStartAfter(startAbsHour: number, job: JobDef, calendar?: CalendarTuning): number | null {
  const startHour = normalizeGameHour(job.hours.startHour);
  let candidate = (Math.floor(startAbsHour / 24) + 1) * 24 + startHour;
  const cycle = calendarDayNames(calendar).length;
  for (let offset = 0; offset < cycle; offset++, candidate += 24) {
    if (isWorkDay(job, weekdayIndexAtAbsoluteHour(candidate, calendar), calendar)) return candidate;
  }
  return null;
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
 * start correctly tracks that shift. Each ended window advances the cursor to the next scheduled
 * weekday, so an off-day never increments skips and a missed shift can increment only once.
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

  /** H4 (ROADMAP_HAPPY): record a COMPLETED shift's mood against the job's sparse firing config.
   *  happiness < firing.minHappiness increments the streak (warning event); streak >
   *  firing.maxUnhappyShifts fires (caller handles job loss + visa consequences). A happy-enough
   *  shift, or a job with no firing config, resets the streak. Pure decision, no side effects. */
  recordShiftMood(job: JobDef, happiness: number): WorkTickEvent[] {
    const firing = job.firing;
    const min = firing?.minHappiness;
    if (job.id !== this.state.jobId || typeof min !== 'number' || !Number.isFinite(min)
      || (Number.isFinite(happiness) ? happiness : 0) >= min) {
      this.state.unhappyStreak = 0;
      return [];
    }
    const streak = (this.state.unhappyStreak ?? 0) + 1;
    this.state.unhappyStreak = streak;
    const max = Math.max(0, Math.floor(Number.isFinite(firing?.maxUnhappyShifts) ? firing!.maxUnhappyShifts! : Infinity));
    if (Number.isFinite(max) && streak > max) {
      this.state.jobId = null; // same clearing the job_lost path performs (caller mirrors quests.vars)
      this.state.unhappyStreak = 0;
      return [{ type: 'fired', jobId: job.id, streak }];
    }
    return [{ type: 'unhappy_shift', jobId: job.id, streak, maxUnhappyShifts: Number.isFinite(max) ? max : 0 }];
  }

  /** Changing jobs starts fresh attendance. Runtime state for the same job is left untouched. */
  syncJob(job: JobDef | null, time: WorkTime, calendar?: CalendarTuning) {
    const nextId = job?.id ?? null;
    if (nextId === this.state.jobId) return;
    this.state = {
      jobId: nextId,
      skips: 0,
      unhappyStreak: 0,
      nextShiftStartAbsHour: job ? firstShiftStartAtOrAfter(time, job, calendar) : null,
      attendedShiftStartAbsHour: null,
      notifiedShiftStartAbsHour: null,
      activeShift: null,
      jobLevels: this.state.jobLevels,
    };
  }

  beginShift(job: JobDef, time: WorkTime, returnPoint: WorkReturnPoint, departureWindowHours?: number, calendar?: CalendarTuning): StartWorkResult {
    if (this.state.activeShift) return { ok: false, reason: 'already_at_work' };
    this.syncJob(job, time, calendar);
    const window = workWindowContaining(time, job.hours);
    if (!window) return { ok: false, reason: 'outside_hours' };
    if (!isWorkDay(job, weekdayIndexAtAbsoluteHour(window.startAbsHour, calendar), calendar)) {
      return { ok: false, reason: 'outside_hours' };
    }
    // B7-5: even if still within overall job hours, a departure past the ~2h window is too late —
    // the walk from menu-open to the exterior door can push the sim past the deadline.
    if (departureWindowHours !== undefined && !isWithinDepartureWindow(time, job.hours, departureWindowHours)) {
      return { ok: false, reason: 'outside_hours' };
    }
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
  rollPromotion(job: JobDef, happiness: number, factor = 1, rng: () => number = Math.random, requirementsMet = true): PromotionResult {
    const result = rollForPromotion(job, this.getJobLevel(job.id), happiness, factor, rng, requirementsMet);
    if (result.promoted) this.state.jobLevels[job.id] = result.toLevel;
    return result;
  }

  /**
   * Called on game clock ticks. Emits return first, then processes every fully-ended attendance
   * window. A missed window increments once; skips > maxSkips emits job_lost and clears the tracked
   * job. The caller owns vars.job and applies that external mutation in response to the event.
   */
  tick(job: JobDef | null, time: WorkTime, departureWindowHours?: number, calendar?: CalendarTuning): WorkTickEvent[] {
    const events: WorkTickEvent[] = [];

    const returned = decideWorkReturn(this.state.activeShift, time);
    if (returned) {
      events.push(returned);
      this.state.activeShift = null;
    }

    // A shift snapshots its own end/pay/return data. Keep it authoritative until return even if a
    // hot-reload temporarily removes/changes the job definition or external vars.job changes.
    if (this.state.activeShift) return events;

    this.syncJob(job, time, calendar);
    if (!job || this.state.jobId !== job.id) return events;
    if (this.state.nextShiftStartAbsHour === null) {
      this.state.nextShiftStartAbsHour = firstShiftStartAtOrAfter(time, job, calendar);
      if (this.state.nextShiftStartAbsHour === null) return events;
    }

    if (!isWorkDay(job, weekdayIndexAtAbsoluteHour(this.state.nextShiftStartAbsHour, calendar), calendar)) {
      this.state.nextShiftStartAbsHour = firstShiftStartAtOrAfter(time, job, calendar);
      if (this.state.nextShiftStartAbsHour === null) return events;
    }

    const now = absoluteGameHour(time);
    const duration = workWindowDuration(job.hours);
    // B7-5: a missed DEPARTURE window registers its skip at the window's close (start +
    // departureWindowHours), not at the shift's end. Callers that don't pass departureWindowHours
    // keep the old "miss registers at shift end" behavior (closeOffset = full shift duration).
    const closeOffset = departureWindowHours === undefined
      ? duration
      : departureWindowCloseOffset(job.hours, departureWindowHours);
    const nextStart = this.state.nextShiftStartAbsHour;
    if (now + EPSILON >= nextStart
      && now < nextStart + closeOffset - EPSILON
      && this.state.attendedShiftStartAbsHour !== nextStart
      && this.state.notifiedShiftStartAbsHour !== nextStart) {
      this.state.notifiedShiftStartAbsHour = nextStart;
      events.push({
        type: 'due',
        jobId: job.id,
        endHour: normalizeGameHour(job.hours.endHour),
        departByHour: normalizeGameHour(normalizeGameHour(job.hours.startHour) + closeOffset),
      });
    }
    while (this.state.nextShiftStartAbsHour + closeOffset <= now + EPSILON) {
      const shiftStart = this.state.nextShiftStartAbsHour;
      const attended = this.state.attendedShiftStartAbsHour !== null
        && Math.abs(this.state.attendedShiftStartAbsHour - shiftStart) <= EPSILON;
      this.state.nextShiftStartAbsHour = nextShiftStartAfter(shiftStart, job, calendar);
      if (attended) {
        this.state.attendedShiftStartAbsHour = null;
        if (this.state.nextShiftStartAbsHour === null) break;
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
      if (this.state.nextShiftStartAbsHour === null) break;
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
      unhappyStreak: saved.unhappyStreak ?? 0, // H4: sparse in pre-batch-15 saves

      nextShiftStartAbsHour: saved.nextShiftStartAbsHour,
      attendedShiftStartAbsHour: saved.attendedShiftStartAbsHour,
      notifiedShiftStartAbsHour: saved.notifiedShiftStartAbsHour ?? null,
      activeShift: cloneActive(saved.activeShift),
      jobLevels: { ...(saved.jobLevels ?? {}) },
    };
  }
}
