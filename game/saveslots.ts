// saveslots.ts — shared, headless save-slot presentation and decisions for phone + title.

import type { SaveConfig } from './data';
import type { SaveEnvelope } from './save';
import { buildExportBlob, parseImport, type SaveStore, type StoreResult } from './savestore';

export type SlotKind = 'manual' | 'autosave';
export type SlotStatus = 'empty' | 'corrupt' | 'ok';

export interface SlotCardView {
  slotId: string;
  kind: SlotKind;
  status: SlotStatus;
  name: string;
  savedAtLabel: string;
  mapName: string;
  funds: number | null;
  gameClockLabel: string;
  error?: string;
}

export interface SlotViewConfig extends SaveConfig {
  mapNames?: Readonly<Record<string, string>>;
  locale?: string;
}

export type SlotDecision = 'proceed' | 'confirm' | 'blocked';

function manualSlotIds(config: Pick<SaveConfig, 'slots'>): string[] {
  return Array.from({ length: Math.max(0, Math.floor(config.slots)) }, (_, index) => `slot-${index + 1}`);
}

export function configuredSlotIds(config: SaveConfig): string[] {
  return [...manualSlotIds(config), config.autosaveSlotId];
}

export function formatPlayClock(seconds: number | undefined): string {
  const totalMinutes = Math.max(0, Math.floor((Number.isFinite(seconds) ? seconds! : 0) / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}

function savedAtLabel(savedAt: string, locale?: string): string {
  const date = new Date(savedAt);
  return Number.isNaN(date.getTime()) ? 'Unknown date' : date.toLocaleString(locale);
}

/** Always returns every configured manual slot followed by the autosave slot. */
export function slotCardViews(store: SaveStore, config: SlotViewConfig): SlotCardView[] {
  const listed = new Map(store.listSlots(config).map((entry) => [entry.slotId, entry]));
  return configuredSlotIds(config).map((slotId, index) => {
    const kind: SlotKind = slotId === config.autosaveSlotId ? 'autosave' : 'manual';
    const fallbackName = kind === 'autosave' ? 'Autosave' : `Slot ${index + 1}`;
    const entry = listed.get(slotId);
    if (!entry) return {
      slotId, kind, status: 'empty', name: fallbackName, savedAtLabel: 'Empty', mapName: '—',
      funds: null, gameClockLabel: '0h 00m',
    };
    if (entry.corrupt || !entry.meta) return {
      slotId, kind, status: 'corrupt', name: fallbackName, savedAtLabel: 'Corrupt save', mapName: '—',
      funds: null, gameClockLabel: '—', ...(entry.error ? { error: entry.error } : {}),
    };
    const meta = entry.meta;
    return {
      slotId, kind, status: 'ok', name: meta.name?.trim() || fallbackName,
      savedAtLabel: savedAtLabel(meta.savedAt, config.locale),
      mapName: config.mapNames?.[meta.mapId] ?? meta.mapId,
      funds: meta.funds ?? null,
      gameClockLabel: formatPlayClock(meta.playSeconds),
    };
  });
}

export function overwriteDecision(card: SlotCardView): SlotDecision {
  if (card.kind === 'autosave') return 'blocked';
  return card.status === 'empty' ? 'proceed' : 'confirm';
}

export function loadDecision(card: SlotCardView, runActive: boolean): SlotDecision {
  if (card.status !== 'ok') return 'blocked';
  return runActive ? 'confirm' : 'proceed';
}

export function deleteDecision(card: SlotCardView): SlotDecision {
  return card.kind === 'manual' && card.status !== 'empty' ? 'confirm' : 'blocked';
}

export function renameDecision(card: SlotCardView): SlotDecision {
  return card.kind === 'manual' && card.status === 'ok' ? 'proceed' : 'blocked';
}

export function renameSlot(store: SaveStore, config: SaveConfig, slotId: string, name: string): StoreResult {
  if (slotId === config.autosaveSlotId) return { ok: false, reason: 'Autosave cannot be renamed' };
  const read = store.readSlot(config, slotId);
  if (!read.ok) return { ok: false, reason: read.reason };
  const envelope: SaveEnvelope = { ...read.envelope, name: name.trim() || undefined };
  return store.writeSlot(config, slotId, envelope);
}

export function exportSlot(store: SaveStore, config: SaveConfig, slotId: string) {
  const read = store.readSlot(config, slotId);
  return read.ok
    ? { ok: true as const, ...buildExportBlob(read.envelope, slotId) }
    : { ok: false as const, error: read.reason };
}

export function importIntoSlot(store: SaveStore, config: SaveConfig, slotId: string, jsonText: string): StoreResult {
  if (slotId === config.autosaveSlotId) return { ok: false, reason: 'Autosave cannot be replaced manually' };
  const parsed = parseImport(jsonText);
  if (!parsed.ok) return { ok: false, reason: parsed.error };
  return store.writeSlot(config, slotId, parsed.envelope);
}
