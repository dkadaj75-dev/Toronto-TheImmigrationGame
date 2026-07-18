// save.ts — pure, versioned runtime-save orchestration. No storage, DOM, or game-module coupling.

export const SAVE_VERSION = 1;
export const FUNDS_SYSTEM_ID = 'quests';

export interface SaveEnvelope {
  version: number;
  savedAt: string;
  name?: string;
  mapId: string;
  gameHour: number;
  playSeconds?: number;
  systems: Record<string, unknown>;
}

export interface SaveEnvelopeMeta {
  savedAt?: string;
  name?: string;
  mapId: string;
  gameHour: number;
  playSeconds?: number;
}

export interface Saveable {
  serialize(): unknown;
  restore(payload: unknown): void;
  defaults?: unknown | (() => unknown);
}

export type Migration = (envelope: SaveEnvelope) => SaveEnvelope;
export type MigrationTable = Readonly<Record<number, Migration>>;

export interface SaveCore {
  currentVersion: number;
  migrations?: MigrationTable;
}

export const DEFAULT_SAVE_CORE: SaveCore = { currentVersion: SAVE_VERSION, migrations: {} };

export interface SaveSlotMeta {
  name?: string;
  savedAt: string;
  mapId: string;
  gameHour: number;
  playSeconds?: number;
  funds?: number;
}

export type EnvelopeValidationResult =
  | { ok: true; envelope: SaveEnvelope; warnings: string[] }
  | { ok: false; reason: string; warnings: string[] };

export type ApplyEnvelopeResult = EnvelopeValidationResult;

export class SaveRegistry {
  private readonly saveables = new Map<string, Saveable>();

  registerSaveable(id: string, saveable: Saveable): () => void {
    const normalized = id.trim();
    if (!normalized) throw new Error('Saveable id must not be empty');
    if (this.saveables.has(normalized)) throw new Error(`Saveable id already registered: ${normalized}`);
    this.saveables.set(normalized, saveable);
    return () => { if (this.saveables.get(normalized) === saveable) this.saveables.delete(normalized); };
  }

  entries(): IterableIterator<[string, Saveable]> { return this.saveables.entries(); }
  has(id: string): boolean { return this.saveables.has(id); }
}

export function registerSaveable(registry: SaveRegistry, id: string, saveable: Saveable): () => void {
  return registry.registerSaveable(id, saveable);
}

export function assembleEnvelope(registry: SaveRegistry, meta: SaveEnvelopeMeta, core: SaveCore = DEFAULT_SAVE_CORE): SaveEnvelope {
  const systems: Record<string, unknown> = {};
  for (const [id, saveable] of registry.entries()) systems[id] = saveable.serialize();
  return {
    version: core.currentVersion,
    savedAt: meta.savedAt ?? new Date().toISOString(),
    ...(meta.name === undefined ? {} : { name: meta.name }),
    mapId: meta.mapId,
    gameHour: meta.gameHour,
    ...(meta.playSeconds === undefined ? {} : { playSeconds: meta.playSeconds }),
    systems,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function structuralEnvelope(value: unknown): value is SaveEnvelope {
  if (!isRecord(value) || !Number.isInteger(value.version) || (value.version as number) < 1) return false;
  if (typeof value.savedAt !== 'string' || Number.isNaN(Date.parse(value.savedAt))) return false;
  if (typeof value.mapId !== 'string' || !Number.isFinite(value.gameHour) || !isRecord(value.systems)) return false;
  if (value.name !== undefined && typeof value.name !== 'string') return false;
  return value.playSeconds === undefined || (typeof value.playSeconds === 'number' && Number.isFinite(value.playSeconds));
}

export function validateEnvelope(input: unknown, core: SaveCore = DEFAULT_SAVE_CORE): EnvelopeValidationResult {
  const warnings: string[] = [];
  if (!structuralEnvelope(input)) return { ok: false, reason: 'Invalid save envelope', warnings };
  if (input.version > core.currentVersion) {
    return { ok: false, reason: `Save version ${input.version} is newer than supported version ${core.currentVersion}`, warnings };
  }

  let envelope = input;
  while (envelope.version < core.currentVersion) {
    const fromVersion = envelope.version;
    const migration = core.migrations?.[fromVersion];
    if (!migration) return { ok: false, reason: `No migration available from save version ${fromVersion}`, warnings };
    try {
      envelope = migration(envelope);
    } catch (error) {
      return { ok: false, reason: `Migration from save version ${fromVersion} failed: ${errorMessage(error)}`, warnings };
    }
    if (!structuralEnvelope(envelope) || envelope.version !== fromVersion + 1) {
      return { ok: false, reason: `Migration from save version ${fromVersion} did not produce version ${fromVersion + 1}`, warnings };
    }
  }
  return { ok: true, envelope, warnings };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function defaultPayload(saveable: Saveable): unknown {
  return typeof saveable.defaults === 'function'
    ? (saveable.defaults as () => unknown)()
    : saveable.defaults;
}

function restoreDefault(id: string, saveable: Saveable, warnings: string[]): void {
  if (saveable.defaults === undefined) return;
  try { saveable.restore(defaultPayload(saveable)); }
  catch (error) { warnings.push(`System "${id}" defaults failed to restore: ${errorMessage(error)}`); }
}

export function applyEnvelope(registry: SaveRegistry, input: unknown, core: SaveCore = DEFAULT_SAVE_CORE): ApplyEnvelopeResult {
  const validated = validateEnvelope(input, core);
  if (!validated.ok) return validated;
  const { envelope, warnings } = validated;

  for (const id of Object.keys(envelope.systems)) {
    if (!registry.has(id)) warnings.push(`Unknown save system "${id}" ignored`);
  }
  for (const [id, saveable] of registry.entries()) {
    if (!Object.prototype.hasOwnProperty.call(envelope.systems, id)) {
      warnings.push(`Save system "${id}" missing; restored defaults`);
      restoreDefault(id, saveable, warnings);
      continue;
    }
    try { saveable.restore(envelope.systems[id]); }
    catch (error) {
      warnings.push(`Save system "${id}" failed to restore: ${errorMessage(error)}; restored defaults`);
      restoreDefault(id, saveable, warnings);
    }
  }
  return { ok: true, envelope, warnings };
}

export const disassembleEnvelope = applyEnvelope;

export function extractSlotMeta(envelope: SaveEnvelope): SaveSlotMeta {
  const fundsPayload = envelope.systems[FUNDS_SYSTEM_ID];
  const funds = isRecord(fundsPayload) && typeof fundsPayload.funds === 'number' && Number.isFinite(fundsPayload.funds)
    ? fundsPayload.funds
    : undefined;
  return {
    ...(envelope.name === undefined ? {} : { name: envelope.name }),
    savedAt: envelope.savedAt,
    mapId: envelope.mapId,
    gameHour: envelope.gameHour,
    ...(envelope.playSeconds === undefined ? {} : { playSeconds: envelope.playSeconds }),
    ...(funds === undefined ? {} : { funds }),
  };
}
