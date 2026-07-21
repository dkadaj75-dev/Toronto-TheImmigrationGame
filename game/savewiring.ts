// savewiring.ts — thin, headless runtime adapters for the V3 save registry.

import type { SimStats } from './stats';
import { FUNDS_SYSTEM_ID, type SaveEnvelope, type Saveable, type SaveRegistry } from './save';

export const SAVE_SYSTEM_IDS = {
  simStats: 'simStats',
  clock: 'clock',
  quests: FUNDS_SYSTEM_ID,
  visa: 'visa',
  work: 'work',
  finance: 'finance',
  hydro: 'hydro',
  buyMode: 'buyMode',
  assetStates: 'assetStates',
  garbage: 'garbage',
  food: 'food',
  accidents: 'accidents',
  social: 'social',
  npcVisit: 'npcVisit',
  visitAway: 'visitAway',
  pendingMove: 'pendingMove',
  eventFiring: 'eventFiring',
  homeMap: 'homeMap',
} as const;

export type RuntimeSystemId = typeof SAVE_SYSTEM_IDS[keyof typeof SAVE_SYSTEM_IDS];

export interface ClockAccess {
  getSimClockSeconds(): number;
  setSimClockSeconds(value: number): void;
}

export interface HomeMapAccess {
  getMapId(): string;
  setMapId(mapId: string): void;
}

export interface RuntimeSaveSystems {
  stats: SimStats;
  clock: ClockAccess;
  quests: Saveable;
  visa: Saveable;
  work: Saveable;
  finance: Saveable;
  hydro: Saveable;
  buyMode: Saveable;
  assetStates: Saveable;
  garbage: Saveable;
  food: Saveable;
  accidents: Saveable;
  social: Saveable;
  npcVisit: Saveable;
  visitAway: Saveable;
  pendingMove: Saveable;
  eventFiring: Saveable;
  homeMap: HomeMapAccess;
}

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function snapshotDefault(saveable: Saveable): unknown {
  return clone(saveable.serialize());
}

function restoreStatMap(target: Map<string, number>, payload: unknown): void {
  if (!isRecord(payload)) throw new Error('stat map must be an object');
  for (const key of target.keys()) {
    const value = payload[key];
    // A stat authored after this save was created keeps its current-data default.
    if (value === undefined) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`stat "${key}" must be finite`);
  }
  for (const key of target.keys()) {
    const value = payload[key];
    if (typeof value === 'number' && Number.isFinite(value)) target.set(key, value);
  }
}

export function createStatsSaveable(stats: SimStats): Saveable {
  return {
    serialize: () => ({
      needs: Object.fromEntries(stats.needs),
      skills: Object.fromEntries(stats.skills),
      personality: Object.fromEntries(stats.personality),
    }),
    restore: (payload) => {
      if (!isRecord(payload)) throw new Error('stats payload must be an object');
      restoreStatMap(stats.needs, payload.needs);
      restoreStatMap(stats.skills, payload.skills);
      restoreStatMap(stats.personality, payload.personality);
    },
  };
}

export function createClockSaveable(clock: ClockAccess): Saveable {
  return {
    serialize: () => ({ simClockSeconds: clock.getSimClockSeconds() }),
    restore: (payload) => {
      if (!isRecord(payload) || typeof payload.simClockSeconds !== 'number'
        || !Number.isFinite(payload.simClockSeconds) || payload.simClockSeconds < 0) {
        throw new Error('clock payload must contain non-negative simClockSeconds');
      }
      clock.setSimClockSeconds(payload.simClockSeconds);
    },
  };
}

export function createHomeMapSaveable(homeMap: HomeMapAccess): Saveable {
  return {
    serialize: () => ({ mapId: homeMap.getMapId() }),
    restore: (payload) => {
      if (!isRecord(payload) || typeof payload.mapId !== 'string' || !payload.mapId.trim()) {
        throw new Error('homeMap payload must contain a mapId');
      }
      homeMap.setMapId(payload.mapId);
    },
  };
}

/** The envelope map is authoritative for reconstruction; the system payload keeps homeMap as a
 * normal registered runtime value and supplies compatibility if a future envelope uses it. */
export function homeMapIdFromEnvelope(envelope: SaveEnvelope): string {
  const payload = envelope.systems[SAVE_SYSTEM_IDS.homeMap];
  return isRecord(payload) && typeof payload.mapId === 'string' && payload.mapId.trim()
    ? payload.mapId
    : envelope.mapId;
}

/** Register each runtime owner exactly once. Defaults are snapshots of the fresh instances at
 * registration time, so one corrupt payload resets only that system without disturbing others. */
export function registerRuntimeSaveSystems(registry: SaveRegistry, systems: RuntimeSaveSystems): void {
  const stats = createStatsSaveable(systems.stats);
  const clock = createClockSaveable(systems.clock);
  const homeMap = createHomeMapSaveable(systems.homeMap);
  const entries: [RuntimeSystemId, Saveable, boolean][] = [
    [SAVE_SYSTEM_IDS.simStats, stats, true],
    [SAVE_SYSTEM_IDS.clock, clock, true],
    [SAVE_SYSTEM_IDS.quests, systems.quests, true],
    [SAVE_SYSTEM_IDS.visa, systems.visa, true],
    [SAVE_SYSTEM_IDS.work, systems.work, true],
    [SAVE_SYSTEM_IDS.finance, systems.finance, true],
    [SAVE_SYSTEM_IDS.hydro, systems.hydro, true],
    [SAVE_SYSTEM_IDS.buyMode, systems.buyMode, true],
    [SAVE_SYSTEM_IDS.assetStates, systems.assetStates, true],
    [SAVE_SYSTEM_IDS.garbage, systems.garbage, true],
    [SAVE_SYSTEM_IDS.food, systems.food, true],
    [SAVE_SYSTEM_IDS.accidents, systems.accidents, true],
    [SAVE_SYSTEM_IDS.social, systems.social, true],
    [SAVE_SYSTEM_IDS.npcVisit, systems.npcVisit, true],
    [SAVE_SYSTEM_IDS.visitAway, systems.visitAway, true],
    [SAVE_SYSTEM_IDS.pendingMove, systems.pendingMove, true],
    [SAVE_SYSTEM_IDS.eventFiring, systems.eventFiring, true], // E4: persist onceOnly/cooldown state
    // The envelope map remains the fallback if this payload is missing/corrupt.
    [SAVE_SYSTEM_IDS.homeMap, homeMap, false],
  ];
  for (const [id, saveable, withDefaults] of entries) {
    registry.registerSaveable(id, withDefaults ? {
      serialize: () => saveable.serialize(),
      restore: (payload) => saveable.restore(payload),
      defaults: snapshotDefault(saveable),
    } : saveable);
  }
}
