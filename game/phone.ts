// phone.ts — pure smartphone/job/application logic (PROJECT_CONTEXT.md §7.20 V2).
// No DOM or three.js dependency: cadence, requirement gates, and state effects are headless-tested.

import type { Condition, JobDef, JobsData, VisaDef, VisasData } from './data';
import { evaluate, type EvalContext, type VarValue } from './quests';
import { pendingMoveLabel, type RentalListing } from './rental';

export const DEFAULT_PHONE_JOB_LIST_SIZE = 3;

export interface RequirementView {
  text: string;
  met: boolean;
}

export interface JobListingView {
  job: JobDef;
  requirementsMet: boolean;
  requirements: RequirementView[];
}

export interface VisaApplicationView {
  visa: VisaDef;
  requirementsMet: boolean;
  requirements: RequirementView[];
}

export type PhoneApplyResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'not_found' | 'requirements_unmet' | 'application_rejected' };

/** Copy used by the runtime confirmation seam; null means no switch confirmation is needed. */
export function jobSwitchPrompt(current: JobDef | null, next: JobDef): string | null {
  if (!current || current.id === next.id) return null;
  return `You already work as ${current.name}. Switch to ${next.name}?`;
}

/** A day-aware hour key: 08:00 on consecutive days must count as two distinct roll windows. */
export function gameHourKey(time: { hour: number; day: number }): number {
  return time.day * 24 + Math.floor(time.hour);
}

/** Random subset without replacement. Exported for deterministic headless coverage. */
export function randomSubset<T>(items: readonly T[], requestedSize: number, rng: () => number = Math.random): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const raw = rng();
    const bounded = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 0.9999999999999999) : 0;
    const j = Math.floor(bounded * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.min(copy.length, Math.max(0, Math.floor(requestedSize))));
}

/** Owns only the search-result roll and its once-per-in-game-hour cadence. */
export class PhoneJobSearch {
  private defs: JobDef[];
  private listSize: number;
  private resultIds: string[] = [];
  private lastRollHour: number | null = null;

  constructor(data: JobsData, listSize = DEFAULT_PHONE_JOB_LIST_SIZE, private rng: () => number = Math.random) {
    this.defs = data.jobs;
    this.listSize = listSize;
  }

  /** Hot-reload adopts definitions/tuning without manufacturing an extra roll in the same hour. */
  retune(data: JobsData, listSize = DEFAULT_PHONE_JOB_LIST_SIZE) {
    this.defs = data.jobs;
    this.listSize = listSize;
    const liveIds = new Set(this.defs.map((job) => job.id));
    this.resultIds = this.resultIds.filter((id) => liveIds.has(id));
  }

  /** Clicking Search repeatedly in one game hour returns the exact same result. */
  search(time: { hour: number; day: number }): readonly JobDef[] {
    const hour = gameHourKey(time);
    if (this.lastRollHour !== hour) {
      this.resultIds = randomSubset(this.defs, this.listSize, this.rng).map((job) => job.id);
      this.lastRollHour = hour;
    }
    return this.current();
  }

  current(): readonly JobDef[] {
    const byId = new Map(this.defs.map((job) => [job.id, job]));
    return this.resultIds.map((id) => byId.get(id)).filter((job): job is JobDef => !!job);
  }

  get lastRolledHour(): number | null { return this.lastRollHour; }
}

export function requirementsMet(requirements: Condition | undefined, ctx: EvalContext): boolean {
  return !requirements || evaluate(requirements, ctx);
}

/** Sparse F3 job gate. A score is required only when the job authors a minimum. */
export function jobCreditRequirementMet(job: Pick<JobDef, 'minCreditScore'>, creditScore?: number): boolean {
  return job.minCreditScore === undefined
    || (Number.isFinite(creditScore) && creditScore! >= job.minCreditScore);
}

function titleCase(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function pathLabel(path: string): string {
  if (path === 'funds') return 'Funds';
  if (path === 'time.hour') return 'Current hour';
  if (path === 'time.day') return 'Current day';
  const dot = path.indexOf('.');
  if (dot < 0) return titleCase(path);
  const namespace = path.slice(0, dot);
  const id = path.slice(dot + 1).replace(/\.state$/, '');
  if (namespace === 'skills') return `${titleCase(id)} skill`;
  if (namespace === 'needs') return `${titleCase(id)} need`;
  if (namespace === 'vars') return titleCase(id);
  if (namespace === 'quests') return `${titleCase(id)} quest`;
  return titleCase(path);
}

function valueLabel(value: VarValue): string {
  return typeof value === 'string' ? titleCase(value) : String(value);
}

/** Compact human-readable rendering of the same condition tree evaluate() consumes. */
export function describeCondition(condition: Condition): string {
  if ('all' in condition) return condition.all.map((entry) => describeCondition(entry)).join(' and ') || 'No requirements';
  if ('any' in condition) return `(${condition.any.map((entry) => describeCondition(entry)).join(' or ') || 'no alternatives'})`;
  if (condition.gte !== undefined) return `${pathLabel(condition.var)} ≥ ${condition.gte}`;
  if (condition.lte !== undefined) return `${pathLabel(condition.var)} ≤ ${condition.lte}`;
  if (condition.eq !== undefined) return `${pathLabel(condition.var)} is ${valueLabel(condition.eq)}`;
  if (condition.neq !== undefined) return `${pathLabel(condition.var)} is not ${valueLabel(condition.neq)}`;
  return `${pathLabel(condition.var)} has an invalid requirement`;
}

export function requirementViews(requirements: Condition | undefined, ctx: EvalContext): RequirementView[] {
  if (!requirements) return [{ text: 'No requirements', met: true }];
  return [{ text: describeCondition(requirements), met: evaluate(requirements, ctx) }];
}

export function jobListingViews(jobs: readonly JobDef[], ctx: EvalContext, creditScore?: number): JobListingView[] {
  return jobs.map((job) => {
    const conditionMet = requirementsMet(job.requirements, ctx);
    const creditMet = jobCreditRequirementMet(job, creditScore);
    const requirements = requirementViews(job.requirements, ctx);
    if (job.minCreditScore !== undefined) requirements.push({
      text: `Credit score ≥ ${job.minCreditScore}`,
      met: creditMet,
    });
    return { job, requirementsMet: conditionMet && creditMet, requirements };
  });
}

/** Apply side effects are deliberately explicit/injected so this remains a pure-logic module. */
export function applyForJob(
  jobId: string,
  data: JobsData,
  ctx: EvalContext,
  vars: Record<string, VarValue>,
  grantVisa: (statusId: string, day: number) => void,
  creditScore?: number,
): PhoneApplyResult {
  const job = data.jobs.find((entry) => entry.id === jobId);
  if (!job) return { ok: false, reason: 'not_found' };
  if (!requirementsMet(job.requirements, ctx)) return { ok: false, reason: 'requirements_unmet' };
  if (!jobCreditRequirementMet(job, creditScore)) return { ok: false, reason: 'requirements_unmet' };
  vars.job = job.id;
  if (job.grantsVisa) grantVisa(job.grantsVisa, ctx.time.day);
  return { ok: true, id: job.id };
}

export function visaApplicationViews(data: VisasData, ctx: EvalContext): VisaApplicationView[] {
  return data.visas
    .filter((visa) => visa.obtainedVia === 'application')
    .map((visa) => ({
      visa,
      requirementsMet: requirementsMet(visa.requirements, ctx),
      requirements: requirementViews(visa.requirements, ctx),
    }));
}

export function applyForVisa(
  statusId: string,
  data: VisasData,
  ctx: EvalContext,
  apply: (statusId: string, day: number) => boolean,
): PhoneApplyResult {
  const visa = data.visas.find((entry) => entry.id === statusId && entry.obtainedVia === 'application');
  if (!visa) return { ok: false, reason: 'not_found' };
  if (!requirementsMet(visa.requirements, ctx)) return { ok: false, reason: 'requirements_unmet' };
  if (!apply(statusId, ctx.time.day)) return { ok: false, reason: 'application_rejected' };
  return { ok: true, id: statusId };
}

export function pendingDaysRemaining(pending: { resolvesAtDay: number } | null, day: number): number | null {
  return pending ? Math.max(0, pending.resolvesAtDay - day) : null;
}

// ================================================================ ROADMAP_APT R3 (Kijiji rental tab)

/** Per-ad view-model the phone's Kijiji tab renders. Pure DOM-free massaging of R2's
 *  RentalListing (game/rental.ts): keeps the UI layer dumb (it just paints fields) and keeps the
 *  formatting/gating decisions here where they're headless-tested (test/phone.test.ts).
 *  Design rules straight from ROADMAP_APT §2/R3: m² shows on EVERY ad; the rent price + an ENABLED
 *  Rent button appear ONLY on an available, non-current, no-move-pending listing; an unavailable ad
 *  shows the "Not available yet" chip with NO price and NO conditions. The current home is flagged
 *  and never rentable. NOTE: for R3 the Rent button is present but always DISABLED (R4 wires the
 *  actual rent flow) — `rentEnabled` still encodes the eventual gating so R4 need only flip one
 *  guard, not reshape this view. */
export interface RentalCardView {
  mapId: string;
  title: string;
  text: string;
  image?: string;
  /** Always present — e.g. "45 m2". Shown on every ad regardless of availability. */
  areaLabel: string;
  /** Present (formatted with the currency) ONLY when the listing is available; null otherwise. */
  priceLabel: string | null;
  /** Themeable status text supplied by R2 ("Available" / "Not available yet"). */
  statusLabel: string;
  /** This map is the sim's current home — flag it "current" and never offer to rent it. */
  isCurrentHome: boolean;
  /** Whether the Rent action is permitted for this ad (R4 wires the flow: available AND not the
   *  current home AND no move already pending). The UI renders the button disabled otherwise. */
  rentEnabled: boolean;
  /** R4: true when THIS ad is the destination of the currently pending move — the card shows the
   *  countdown + cancel control instead of the Rent button. Sparse for pre-R4 fixtures. */
  pendingHere?: boolean;
  /** R4: countdown copy for the pending card ("Moving in 3h..."); null on every other card.
   *  Sparse for pre-R4 fixtures. */
  pendingLabel?: string | null;
}

export interface RentalCardOptions {
  /** tuning.economy.currencyName — no hardcoded "§" (design pillar). */
  currencyName: string;
  /** True when a move-in is already pending (R4). Disables renting anything meanwhile. */
  movePending?: boolean;
  /** R4: the live pending move (mapId + remaining sim-time hours). Presence implies movePending
   *  (either signal disables renting everywhere); additionally flags/labels the destination card. */
  pendingMove?: { mapId: string; remainingHours: number } | null;
}

/** Formats R2's listings into rent-card view-models. Deterministic/DOM-free — safe to call every
 *  tab refresh from the thin UI layer (game/ui.ts renderPhone). */
export function rentalCardViews(listings: readonly RentalListing[], opts: RentalCardOptions): RentalCardView[] {
  const pending = opts.pendingMove ?? null;
  const movePending = (opts.movePending ?? false) || pending !== null;
  return listings.map((listing) => {
    const available = listing.available;
    const priceLabel = available && listing.rentPrice !== undefined
      ? `${opts.currencyName}${Math.round(listing.rentPrice).toLocaleString()}`
      : null;
    const pendingHere = pending !== null && pending.mapId === listing.mapId;
    return {
      mapId: listing.mapId,
      title: listing.title,
      text: listing.text,
      image: listing.image,
      areaLabel: `${Math.round(listing.areaM2)} m2`,
      priceLabel,
      statusLabel: listing.statusLabel,
      isCurrentHome: listing.isCurrentHome,
      rentEnabled: available && !listing.isCurrentHome && !movePending,
      pendingHere,
      pendingLabel: pendingHere ? pendingMoveLabel(pending!.remainingHours) : null,
    };
  });
}
