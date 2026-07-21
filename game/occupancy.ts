// occupancy.ts — pure per-instance seat/lie LOCATION occupancy (New.txt #5).
//
// An asset can offer MULTIPLE sit/lie locations (a couch's three cushions, a two-person bed's two
// sides). Any character — player OR NPC — claims the CLOSEST AVAILABLE location when it sits/lies;
// a claimed location is unavailable to everyone else until released. This module is the pure core:
// no DOM, no three.js. It stores only stable instance keys and occupant ids, so it is
// headless-testable and save-serializable. The thin runtime layer (sim.ts/main.ts) resolves world
// positions, calls claim/release around the sit/lie action, and feeds the chosen offset into the
// existing usePose/applyPose path.
//
// Backward compatibility: an asset with no authored location list has exactly ONE location (its
// single usePose entry, index 0), so the whole system collapses to today's behaviour — the closest
// "free" of one location is always index 0 when nobody else holds it.

/** A candidate location resolved to WORLD space by the caller (offsets already rotated by the
 *  placed instance's yaw). `index` is its position in the asset's authored location list, which is
 *  the stable id an occupant holds. */
export interface LocationCandidate {
  index: number;
  pos: [number, number];
}

/**
 * The closest FREE location to `fromPos`, or null when every location is already claimed.
 * Ties break toward the lower index for determinism (matters for tests and for two sims arriving
 * on the same frame). Claimed indices are skipped entirely — a taken cushion is never offered.
 */
export function pickClosestFreeLocation(
  candidates: readonly LocationCandidate[],
  fromPos: readonly [number, number],
  claimed: ReadonlySet<number>,
): number | null {
  let bestIndex: number | null = null;
  let bestDist = Infinity;
  for (const candidate of candidates) {
    if (claimed.has(candidate.index)) continue;
    const dx = candidate.pos[0] - fromPos[0];
    const dz = candidate.pos[1] - fromPos[1];
    const dist = dx * dx + dz * dz; // squared — ranking only, no need for the sqrt
    if (dist < bestDist - 1e-9 || (Math.abs(dist - bestDist) <= 1e-9 && (bestIndex === null || candidate.index < bestIndex))) {
      bestDist = dist;
      bestIndex = candidate.index;
    }
  }
  return bestIndex;
}

export interface OccupancySaveState {
  /** instanceKey -> { locationIndex -> occupantId } */
  claims: Record<string, Record<string, string>>;
}

/**
 * Tracks which location index of which placed instance each occupant holds. Occupant ids are the
 * caller's own stable ids (e.g. "player", or an npc id) so the registry never needs to know what a
 * character is. An occupant may hold at most one location per instance (claiming a second on the
 * same instance releases the first — a sim can't sit in two cushions of one couch).
 */
export class OccupancyRegistry {
  // instanceKey -> (locationIndex -> occupantId)
  private readonly byInstance = new Map<string, Map<number, string>>();
  // occupantId -> set of "instanceKey#index" for O(1) release-all on stop/despawn
  private readonly byOccupant = new Map<string, Set<string>>();

  private slot(key: string): Map<number, string> {
    let map = this.byInstance.get(key);
    if (!map) { map = new Map(); this.byInstance.set(key, map); }
    return map;
  }

  /** Indices currently taken on this instance — what pickClosestFreeLocation must skip. */
  claimedIndices(key: string): Set<number> {
    return new Set(this.byInstance.get(key)?.keys() ?? []);
  }

  occupantAt(key: string, index: number): string | undefined {
    return this.byInstance.get(key)?.get(index);
  }

  isFree(key: string, index: number): boolean {
    return !this.byInstance.get(key)?.has(index);
  }

  /** Claim a location for an occupant. Idempotent for the same occupant; steals nothing from
   *  another occupant (returns false if the slot is held by someone else). Releases any other
   *  slot this occupant held ON THE SAME INSTANCE first. */
  claim(key: string, index: number, occupantId: string): boolean {
    const slot = this.slot(key);
    const holder = slot.get(index);
    if (holder !== undefined && holder !== occupantId) return false;
    // one location per instance per occupant
    for (const [otherIndex, otherOccupant] of slot) {
      if (otherOccupant === occupantId && otherIndex !== index) this.release(key, otherIndex);
    }
    slot.set(index, occupantId);
    let held = this.byOccupant.get(occupantId);
    if (!held) { held = new Set(); this.byOccupant.set(occupantId, held); }
    held.add(`${key}#${index}`);
    return true;
  }

  release(key: string, index: number): void {
    const slot = this.byInstance.get(key);
    const occupantId = slot?.get(index);
    if (slot) { slot.delete(index); if (!slot.size) this.byInstance.delete(key); }
    if (occupantId) {
      const held = this.byOccupant.get(occupantId);
      held?.delete(`${key}#${index}`);
      if (held && !held.size) this.byOccupant.delete(occupantId);
    }
  }

  /** Release everything an occupant holds — called when its sit/lie action stops for ANY reason
   *  (completion, cancel, interrupt) or when an NPC despawns, so a claim can never leak. */
  releaseOccupant(occupantId: string): void {
    const held = this.byOccupant.get(occupantId);
    if (!held) return;
    for (const token of [...held]) {
      const hash = token.lastIndexOf('#');
      this.release(token.slice(0, hash), Number(token.slice(hash + 1)));
    }
  }

  serialize(): OccupancySaveState {
    const claims: Record<string, Record<string, string>> = {};
    for (const [key, slot] of this.byInstance) {
      claims[key] = {};
      for (const [index, occupantId] of slot) claims[key][String(index)] = occupantId;
    }
    return { claims };
  }

  restore(state: OccupancySaveState | undefined): void {
    this.byInstance.clear();
    this.byOccupant.clear();
    for (const [key, slot] of Object.entries(state?.claims ?? {})) {
      for (const [index, occupantId] of Object.entries(slot)) {
        if (typeof occupantId === 'string' && occupantId) this.claim(key, Number(index), occupantId);
      }
    }
  }
}
