// savestore.ts — injected-storage save slots plus pure import/export helpers.

import type { SaveConfig } from './data';
import {
  DEFAULT_SAVE_CORE,
  extractSlotMeta,
  type SaveCore,
  type SaveEnvelope,
  type SaveSlotMeta,
  validateEnvelope,
} from './save';

export interface StorageAdapter {
  readonly length: number;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
}

export interface SlotEntry {
  slotId: string;
  meta?: SaveSlotMeta;
  corrupt?: true;
  error?: string;
}

export type ReadSlotResult =
  | { ok: true; envelope: SaveEnvelope; warnings: string[] }
  | { ok: false; reason: string; corrupt?: boolean };

export type StoreResult = { ok: true } | { ok: false; reason: string };

/** Bound form used by runtime/UI wiring: inject storage once, then use the config-first slot API. */
export class SaveStore {
  constructor(
    private readonly storage: StorageAdapter,
    private readonly core: SaveCore = DEFAULT_SAVE_CORE,
  ) {}

  listSlots(config: SaveConfig): SlotEntry[] { return listSlots(this.storage, config, this.core); }
  readSlot(config: SaveConfig, slotId: string): ReadSlotResult { return readSlot(this.storage, config, slotId, this.core); }
  writeSlot(config: SaveConfig, slotId: string, envelope: SaveEnvelope): StoreResult {
    return writeSlot(this.storage, config, slotId, envelope);
  }
  deleteSlot(config: SaveConfig, slotId: string): StoreResult { return deleteSlot(this.storage, config, slotId); }
}

export function slotKey(config: Pick<SaveConfig, 'storageKeyPrefix'>, slotId: string): string {
  return `${config.storageKeyPrefix}:${slotId}`;
}

export function listSlots(storage: StorageAdapter, config: SaveConfig, core: SaveCore = DEFAULT_SAVE_CORE): SlotEntry[] {
  const prefix = `${config.storageKeyPrefix}:`;
  const ids = new Set<string>();
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(prefix) && key.length > prefix.length) ids.add(key.slice(prefix.length));
  }
  return [...ids].sort((a, b) => a.localeCompare(b)).map((slotId) => {
    const read = readSlot(storage, config, slotId, core);
    if (!read.ok) return { slotId, corrupt: true, error: read.reason };
    return { slotId, meta: extractSlotMeta(read.envelope) };
  });
}

export function readSlot(storage: StorageAdapter, config: SaveConfig, slotId: string, core: SaveCore = DEFAULT_SAVE_CORE): ReadSlotResult {
  let text: string | null;
  try { text = storage.getItem(slotKey(config, slotId)); }
  catch (error) { return { ok: false, reason: `Could not read slot: ${message(error)}` }; }
  if (text === null) return { ok: false, reason: 'Save slot is empty' };
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch (error) { return { ok: false, reason: `Save slot contains invalid JSON: ${message(error)}`, corrupt: true }; }
  const validated = validateEnvelope(parsed, core);
  if (!validated.ok) return { ok: false, reason: validated.reason, corrupt: true };
  return { ok: true, envelope: validated.envelope, warnings: validated.warnings };
}

export function writeSlot(storage: StorageAdapter, config: SaveConfig, slotId: string, envelope: SaveEnvelope): StoreResult {
  try {
    storage.setItem(slotKey(config, slotId), JSON.stringify(envelope));
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: `Could not write save slot (storage may be full): ${message(error)}` };
  }
}

export function deleteSlot(storage: StorageAdapter, config: SaveConfig, slotId: string): StoreResult {
  try { storage.removeItem(slotKey(config, slotId)); return { ok: true }; }
  catch (error) { return { ok: false, reason: `Could not delete save slot: ${message(error)}` }; }
}

export function buildExportBlob(envelope: SaveEnvelope, slotId: string): { filename: string; json: string } {
  const date = Number.isNaN(Date.parse(envelope.savedAt)) ? new Date().toISOString().slice(0, 10) : envelope.savedAt.slice(0, 10);
  const safeSlot = slotId.trim().replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'slot';
  return { filename: `condo-life-save-${safeSlot}-${date}.json`, json: JSON.stringify(envelope, null, 2) };
}

export type ImportResult =
  | { ok: true; envelope: SaveEnvelope; warnings: string[] }
  | { ok: false; error: string };

export function parseImport(jsonText: string, saveCore: SaveCore = DEFAULT_SAVE_CORE): ImportResult {
  let parsed: unknown;
  try { parsed = JSON.parse(jsonText); }
  catch (error) { return { ok: false, error: `Invalid JSON: ${message(error)}` }; }
  const validated = validateEnvelope(parsed, saveCore);
  return validated.ok
    ? { ok: true, envelope: validated.envelope, warnings: validated.warnings }
    : { ok: false, error: validated.reason };
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
