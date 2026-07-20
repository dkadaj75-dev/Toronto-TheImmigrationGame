// social.ts — pure social core for the NPC / relationship / visit system (ROADMAP_SOCIAL.md §3 S1).
//
// PURE, HEADLESS logic only: no DOM, no three.js. Import-safe for both the game runtime and the
// jsdom tool suites (Social Editor, S2). Precedent: game/quests.ts / game/doors.ts — a dedicated
// module whose gameplay math is fully unit-testable (test/social.test.ts), with the three.js/UI
// layer living elsewhere in later slices.
//
// Design pillars honoured here:
//   - Everything tunable comes from data/social.json (+ data/npcs.json). NO magic numbers in code:
//     thresholds, weights, multipliers, decay rate, cooldowns and the compatibility trait range are
//     all data fields. The only literals below are structural identities (0 as the decay attractor,
//     1 as the neutral "nothing to disagree on" score) that are documented where they appear.
//   - Never throw on bad/stale ids — resolve to a safe neutral, mirroring quests.ts's "unknown id →
//     false, never crash" convention. A renamed trait / level / npc id degrades gracefully.
//   - serialize()/restore() from day one (in-memory until the save system lands, same as every other
//     runtime container in the repo).

// ---------------------------------------------------------------------------------------------------
// Schema types (data/npcs.json + data/social.json). Kept in this module rather than game/data.ts so
// the social core is a single self-contained import for S2's tool page; game/data.ts's loader can
// re-export these when the runtime wiring slice needs them.
// ---------------------------------------------------------------------------------------------------

// AUDIT overlap 29 (2026-07-20): the NpcDef/NpcsData interfaces that used to live here were a
// stale, never-imported duplicate of game/npc.ts's runtime truth (clipMap had drifted to `string`
// vs the real Record<state, clip>, and visitorActions was missing) — deleted. game/npc.ts is the
// single owner; import NPC types from there.

/** A named relationship status (Sims-style). `atLeast` is the INCLUSIVE lower score bound. */
export interface RelationshipLevel { id: string; atLeast: number; }

export interface RelationshipConfig {
  min: number;
  max: number;
  start: number;
  /** slow drift toward 0 per sim-day; 0 disables decay entirely */
  decayPerDay: number;
  /** designer-ordered low→high; order (index) is the canonical ranking used by gating + visits */
  levels: RelationshipLevel[];
}

export interface CompatibilityConfig {
  /** per-trait importance; only traits listed here influence compatibility */
  traitWeights: Record<string, number>;
  /** the maximum meaningful per-trait difference — normalises |a-b| into [0,1]. Data-driven (not a
   *  code literal) because it depends on the personality trait scale in stats.json (0..10 today). */
  traitRange: number;
  /** relationship-gain multiplier bounds. A great match scales gains up, a poor match scales down;
   *  for NEGATIVE gains the mapping reflects so a poor match cuts DEEPER (see scaleGain). */
  minMultiplier: number;
  maxMultiplier: number;
}

/** A sim-to-sim interaction (data/social.json). Shares fields with ActionDef where they fit. */
export interface InteractionDef {
  id: string;
  name?: string;
  animation?: string;
  /** Sparse per-role overrides. `animation` remains the both-role fallback. */
  playerAnimation?: string;
  npcAnimation?: string;
  /** Sparse asset id OR category. Present routes both Sims to one matching live asset. */
  targetAsset?: string;
  /** Designer request (2026-07-19): MULTIPLE acceptable target ids/categories — any one placed
   *  match qualifies (nearest wins). Superset of targetAsset; both merge via socialTargetList. */
  targetAssets?: string[];
  /** Sparse action loop, using the same lifecycle as ActionDef.sound. */
  sound?: string;
  durationSeconds?: number;
  needGains?: Record<string, number>;
  /** BEFORE the compatibility multiplier is applied */
  relationshipGain?: number;
  /** contextual gate: current level must rank >= this level id (null/absent = no lower bound) */
  requiresLevelAtLeast?: string | null;
  /** contextual gate: current level must rank <= this level id (null/absent = no upper bound) */
  requiresLevelAtMost?: string | null;
  autonomyEligible?: boolean;
  censor?: boolean;
  /** engine-recognised side effect flag, e.g. "endVisit" for ask_to_leave */
  special?: string;
}

export interface PhoneActionDef {
  durationSeconds: number;
  needGains: Record<string, number>;
  /** BEFORE the compatibility multiplier */
  relationshipGain: number;
  /** sim-time minutes that must elapse before this channel can be used again with the same NPC */
  cooldownMinutes: number;
}
export interface PhoneConfig { text: PhoneActionDef; call: PhoneActionDef; }
export type PhoneChannel = 'text' | 'call';

export interface VisitTheirPlaceConfig {
  awayHours: number;
  /** base need restore amounts, scaled by relationship level + compatibility on return */
  needsRestored: Record<string, number>;
  /** base relationship gain, also level + compatibility scaled */
  relationshipGain: number;
  /** can't invite yourself below this level id */
  minLevel: string;
}

export interface SocialData {
  relationship: RelationshipConfig;
  /** Sparse relationship-level multipliers for an NPC's authored base visit duration. */
  visitDuration?: { byLevel?: Record<string, number> };
  compatibility: CompatibilityConfig;
  /** H3 (ROADMAP_HAPPY, sparse): player-happiness relationship scaling. The factor lerps
   *  atMin→atMax over happiness 0→100 (absent ends = 1) and multiplies into the compatibility
   *  multiplier at every scaleGain seam — the existing love/hate flip then makes low happiness
   *  cut negative gains deeper, symmetrically with how it boosts positive ones when happy. */
  happinessScaling?: { atMin?: number; atMax?: number };
  interactions: InteractionDef[];
  phone: PhoneConfig;
  visitTheirPlace: VisitTheirPlaceConfig;
}

/** Resolve an NPC's authored BASE stay once at arrival. Missing curve/level entries are neutral x1. */
export function resolveVisitDurationHours(baseHours: number, levelId: string | null, data: SocialData): number {
  const base = Number.isFinite(baseHours) && baseHours > 0 ? baseHours : 0;
  const authored = levelId == null ? undefined : data.visitDuration?.byLevel?.[levelId];
  const multiplier = typeof authored === 'number' && Number.isFinite(authored) && authored >= 0 ? authored : 1;
  return base * multiplier;
}

// ---------------------------------------------------------------------------------------------------
// Compatibility (symmetric, static — traits don't change; the mutable score lives in RelationshipState)
// ---------------------------------------------------------------------------------------------------

export interface CompatibilityResult {
  /** raw similarity: 1 - Σ (w_t/Σw)·(|a_t - b_t| / traitRange). Weights normalised over the traits
   *  present in BOTH sims. 1 = identical on every weighted trait; can dip below 0 if a trait pair
   *  differs by more than traitRange (misconfigured range), which is what the multiplier clamp guards. */
  score: number;
  /** score mapped affinely onto [minMultiplier, maxMultiplier] then clamped into that band. */
  multiplier: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Symmetric compatibility between two trait maps.
 *
 * Formula (per ROADMAP_SOCIAL §2 comment): `score = 1 - Σ w_t · |a_t - b_t| / range`, with the
 * weights NORMALISED (divided by Σw over the traits that both sims actually define). Only traits
 * listed in `traitWeights` with a positive weight and a numeric value on BOTH sims contribute; a
 * trait missing from one sim is skipped rather than assumed 0 (skipping never fabricates a
 * disagreement). If no weighted trait overlaps, there is nothing to disagree on → score 1 (the sole
 * literal here, an identity: an empty weighted sum leaves `1 - 0`).
 *
 * Symmetric because |a-b| == |b-a|. Static because it reads only traits, never relationship score.
 *
 * The multiplier maps score linearly: minMultiplier at score 0 → maxMultiplier at score 1, then
 * clamps into [minMultiplier, maxMultiplier]. Because a similarity score can never exceed 1 but CAN
 * fall below 0 (see above), the lower clamp is the one real inputs can trip; the upper bound is a
 * defensive rail reached exactly at a perfect match.
 */
export function compatibility(
  traitsA: Record<string, number>,
  traitsB: Record<string, number>,
  data: SocialData,
): CompatibilityResult {
  const { traitWeights, traitRange, minMultiplier, maxMultiplier } = data.compatibility;
  let weightSum = 0;
  let weightedDiff = 0;
  for (const trait of Object.keys(traitWeights)) {
    const w = traitWeights[trait];
    const a = traitsA[trait];
    const b = traitsB[trait];
    if (!(w > 0) || typeof a !== 'number' || typeof b !== 'number') continue;
    weightSum += w;
    weightedDiff += (w * Math.abs(a - b)) / traitRange;
  }
  const score = weightSum === 0 ? 1 : 1 - weightedDiff / weightSum;
  const rawMultiplier = minMultiplier + score * (maxMultiplier - minMultiplier);
  const multiplier = clamp(rawMultiplier, minMultiplier, maxMultiplier);
  return { score, multiplier };
}

/**
 * Scale a base relationship gain by the compatibility multiplier, honouring the doc's asymmetry:
 * "a great match drifts toward love with the same actions that leave a bad match stuck, and negative
 * interactions cut deeper between incompatible sims."
 *
 *   - POSITIVE gain → `gain · multiplier`. A good match (high multiplier) gains more; a poor match
 *     (low multiplier) gains little.
 *   - NEGATIVE gain → `gain · reflectedMultiplier`, where `reflectedMultiplier =
 *     (minMultiplier + maxMultiplier) - multiplier` mirrors the multiplier across the mid-band. A
 *     poor match (low multiplier → HIGH reflected) therefore takes MORE damage from an argument,
 *     while a great match (high multiplier → LOW reflected) shrugs it off. Both branches stay inside
 *     [minMultiplier, maxMultiplier], so the magnitude is bounded either way.
 *
 * A zero base gain returns 0. This is the single scaling seam shared by applyGain, phone gains and
 * visit outcomes so the love/hate asymmetry can never drift between call sites.
 */
/** H3 (ROADMAP_HAPPY): pure happiness→relationship factor; 1 when unconfigured or ends absent. */
export function happinessSocialFactor(data: Pick<SocialData, 'happinessScaling'>, happiness: number): number {
  const lo = Number.isFinite(data.happinessScaling?.atMin) ? data.happinessScaling!.atMin! : 1;
  const hi = Number.isFinite(data.happinessScaling?.atMax) ? data.happinessScaling!.atMax! : 1;
  const t = Math.min(100, Math.max(0, Number.isFinite(happiness) ? happiness : 0)) / 100;
  return Math.max(0, lo + (hi - lo) * t);
}

export function scaleGain(baseGain: number, multiplier: number, data: SocialData): number {
  if (baseGain === 0) return 0;
  const { minMultiplier, maxMultiplier } = data.compatibility;
  const effective = baseGain > 0 ? multiplier : minMultiplier + maxMultiplier - multiplier;
  return baseGain * effective;
}

// ---------------------------------------------------------------------------------------------------
// Level resolution + interaction gating (order-based, so renaming/re-thresholding is data-only)
// ---------------------------------------------------------------------------------------------------

/** Rank (array index) of a level id within the designer-ordered levels list; -1 if unknown. */
export function levelIndex(levelId: string | null | undefined, data: SocialData): number {
  if (levelId == null) return -1;
  return data.relationship.levels.findIndex((l) => l.id === levelId);
}

/**
 * Resolve a score to a level id. `atLeast` bounds are INCLUSIVE and the HIGHEST matching level wins
 * (the level with the greatest `atLeast` that is still <= score). Order-independent w.r.t. the array
 * (picks by `atLeast`, not position), and never throws: if no level matches (score below every
 * bound, only possible with a misconfigured levels list) it falls back to the level with the lowest
 * `atLeast`. Returns null only for an empty levels list.
 */
export function levelFor(score: number, data: SocialData): string | null {
  const levels = data.relationship.levels;
  if (levels.length === 0) return null;
  let best: RelationshipLevel | null = null;
  let lowest: RelationshipLevel = levels[0];
  for (const lvl of levels) {
    if (lvl.atLeast < lowest.atLeast) lowest = lvl;
    if (score >= lvl.atLeast && (best === null || lvl.atLeast > best.atLeast)) best = lvl;
  }
  return (best ?? lowest).id;
}

/**
 * Contextual gating for a sim-to-sim interaction at a given current level, compared by level ORDER
 * (index) in the levels array — NOT by score — so designers can reorder/rename freely.
 *   - requiresLevelAtLeast null/absent → no lower bound.
 *   - requiresLevelAtMost  null/absent → no upper bound.
 * Bounds referencing an unknown level id are treated as absent (never throw). If the CURRENT level id
 * is unknown (index -1) it ranks below everything, so any lower bound blocks it and any upper bound
 * allows it — a stale saved level degrades to "most restricted", which is the safe direction.
 */
export function levelAllows(interaction: InteractionDef, levelId: string | null, data: SocialData): boolean {
  const idx = levelIndex(levelId, data);
  const atLeast = interaction.requiresLevelAtLeast;
  const atMost = interaction.requiresLevelAtMost;
  if (atLeast != null) {
    const lo = levelIndex(atLeast, data);
    if (lo >= 0 && idx < lo) return false;
  }
  if (atMost != null) {
    const hi = levelIndex(atMost, data);
    if (hi >= 0 && idx >= 0 && idx > hi) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------------
// RelationshipState — the mutable per-NPC score container (serialize/restore)
// ---------------------------------------------------------------------------------------------------

export interface RelationshipSaveState { scores: Record<string, number>; }

export class RelationshipState {
  private scores: Record<string, number> = {};
  private data: SocialData;

  constructor(data: SocialData) { this.data = data; }

  /** Hot-reload: adopt edited tuning (bounds/levels/decay). Runtime scores are left untouched —
   *  same "keep STATE, adopt DEFINITIONS" contract as QuestRunner.retune. */
  retune(data: SocialData): void { this.data = data; }

  /** Current score for an NPC; unset NPCs read the configured starting score. */
  get(npcId: string): number {
    return npcId in this.scores ? this.scores[npcId] : this.data.relationship.start;
  }

  /** Set an explicit score, clamped into [min, max]. */
  set(npcId: string, score: number): void {
    const { min, max } = this.data.relationship;
    this.scores[npcId] = clamp(score, min, max);
  }

  /** Current relationship level id for an NPC (via levelFor on its score). */
  levelFor(npcId: string): string | null {
    return levelFor(this.get(npcId), this.data);
  }

  /**
   * Apply an interaction's base gain, scaled by the compatibility multiplier (via scaleGain — so a
   * poor match makes a negative interaction cut deeper), then clamp into [min, max]. Returns the new
   * score. Side-effect application is the caller's responsibility to fire ONLY on completed actions
   * (repo rule); this method just does the math + storage.
   */
  applyGain(npcId: string, baseGain: number, multiplier: number): number {
    const delta = scaleGain(baseGain, multiplier, this.data);
    this.set(npcId, this.get(npcId) + delta);
    return this.get(npcId);
  }

  /**
   * Advance decay over a sim-time span (fractional days allowed). Every score drifts toward 0 by
   * `decayPerDay · simDays`, never crossing 0 (a positive score can't go negative from decay and
   * vice-versa). decayPerDay 0 disables decay (drift 0). 0 is the attractor by design — "no contact
   * cools every relationship back toward neutral", not toward the min/max extremes.
   */
  decay(simDays: number): void {
    const rate = this.data.relationship.decayPerDay;
    const drift = rate * simDays;
    if (!(drift > 0)) return; // decay disabled or non-positive span → no-op
    for (const npcId of Object.keys(this.scores)) {
      const s = this.scores[npcId];
      if (s > 0) this.scores[npcId] = Math.max(0, s - drift);
      else if (s < 0) this.scores[npcId] = Math.min(0, s + drift);
    }
  }

  serialize(): RelationshipSaveState { return { scores: { ...this.scores } }; }
  restore(s: RelationshipSaveState): void { this.scores = { ...s.scores }; }
}

// ---------------------------------------------------------------------------------------------------
// Phone — per-NPC per-channel cooldowns (sim-time minutes) + gain computation
// ---------------------------------------------------------------------------------------------------

export interface PhoneGainResult {
  /** relationship delta after the compatibility multiplier (via scaleGain) */
  relationshipDelta: number;
  /** the interaction's need gains, passed through unchanged (need fills aren't compat-scaled) */
  needGains: Record<string, number>;
}

/** Pure phone gain math: relationship delta is compatibility-scaled; need fills are as authored. */
export function phoneGain(channel: PhoneChannel, multiplier: number, data: SocialData): PhoneGainResult {
  const def = data.phone[channel];
  return {
    relationshipDelta: scaleGain(def.relationshipGain, multiplier, data),
    needGains: { ...def.needGains },
  };
}

export interface PhoneSaveState {
  /** npcId → channel → sim-time minute of last use */
  lastUsed: Record<string, Partial<Record<PhoneChannel, number>>>;
}

export class PhoneState {
  private lastUsed: Record<string, Partial<Record<PhoneChannel, number>>> = {};
  private data: SocialData;

  constructor(data: SocialData) { this.data = data; }

  retune(data: SocialData): void { this.data = data; }

  /** Sim-time minutes remaining before this channel is usable again with this NPC (0 = ready now). */
  remainingCooldown(npcId: string, channel: PhoneChannel, nowMinutes: number): number {
    const last = this.lastUsed[npcId]?.[channel];
    if (last === undefined) return 0;
    const elapsed = nowMinutes - last;
    const remaining = this.data.phone[channel].cooldownMinutes - elapsed;
    return remaining > 0 ? remaining : 0;
  }

  /** True once the per-NPC per-channel cooldown window has fully elapsed. */
  isReady(npcId: string, channel: PhoneChannel, nowMinutes: number): boolean {
    return this.remainingCooldown(npcId, channel, nowMinutes) <= 0;
  }

  /** Record a use at the given sim-time minute (call ONLY on a completed text/call — repo rule). */
  markUsed(npcId: string, channel: PhoneChannel, nowMinutes: number): void {
    (this.lastUsed[npcId] ??= {})[channel] = nowMinutes;
  }

  serialize(): PhoneSaveState {
    const lastUsed: PhoneSaveState['lastUsed'] = {};
    for (const npcId of Object.keys(this.lastUsed)) lastUsed[npcId] = { ...this.lastUsed[npcId] };
    return { lastUsed };
  }

  restore(s: PhoneSaveState): void {
    this.lastUsed = {};
    for (const npcId of Object.keys(s.lastUsed)) this.lastUsed[npcId] = { ...s.lastUsed[npcId] };
  }
}

// ---------------------------------------------------------------------------------------------------
// Visit-their-place outcome (needs + relationship deltas from level + compatibility)
// ---------------------------------------------------------------------------------------------------

export interface VisitOutcome {
  /** the level id used for scaling (current relationship level with this NPC) */
  levelId: string | null;
  /** scaling factor from that level's rank: (levelIndex + 1) / levelCount ∈ (0, 1]. Higher
   *  relationship → a fuller visit. -1 index (unknown level) collapses to 0 → no restore. */
  levelFactor: number;
  /** the compatibility multiplier that was applied */
  multiplier: number;
  /** per-need restore amounts (base · levelFactor · multiplier), for the caller to add + clamp */
  needsRestored: Record<string, number>;
  /** relationship delta (compat-scaled base · levelFactor), for the caller to apply on RETURN only */
  relationshipDelta: number;
}

/**
 * Compute the outcome of visiting an NPC's place (they "disappear for a few hours"). The visit
 * quality scales with BOTH the current relationship level and compatibility:
 *
 *   levelFactor = (levelIndex + 1) / levelCount   — a clear, documented "level index factor": each
 *                 rung up the ladder adds 1/levelCount, so `beloved` (top) restores the full base and
 *                 the lowest rung restores 1/levelCount of it. An unknown current level → index -1 →
 *                 factor 0 → nothing restored (safe).
 *   needsRestored[n] = base_n · levelFactor · multiplier
 *   relationshipDelta = scaleGain(base, multiplier) · levelFactor
 *
 * PURE: reads the current score from relState but mutates nothing. The caller applies needs + the
 * relationship delta on the sim's RETURN (completion), never on departure/cancel (repo side-effect
 * rule). `compat` is the CompatibilityResult from `compatibility(player, npc, data)`.
 */
export function visitOutcome(
  npcId: string,
  relState: RelationshipState,
  compat: CompatibilityResult,
  data: SocialData,
): VisitOutcome {
  const cfg = data.visitTheirPlace;
  const levelId = relState.levelFor(npcId);
  const levelCount = data.relationship.levels.length;
  const idx = levelIndex(levelId, data);
  const levelFactor = levelCount > 0 && idx >= 0 ? (idx + 1) / levelCount : 0;

  const needsRestored: Record<string, number> = {};
  for (const need of Object.keys(cfg.needsRestored)) {
    needsRestored[need] = cfg.needsRestored[need] * levelFactor * compat.multiplier;
  }
  const relationshipDelta = scaleGain(cfg.relationshipGain, compat.multiplier, data) * levelFactor;

  return { levelId, levelFactor, multiplier: compat.multiplier, needsRestored, relationshipDelta };
}
