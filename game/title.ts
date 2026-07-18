// title.ts — pure title-menu/options models and injected player-preference storage.
import type { TitleConfig, TitleMenuDef, TitleOptionDef } from './data';
import type { SlotEntry } from './savestore';

export const TITLE_PREFS_KEY = 'condo-life-prefs';
export interface PreferencesStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; }
export type TitlePreferences = Record<string, number | boolean>;
export type ResolvedMenuEntry = TitleMenuDef & { enabled: boolean; disabledReason?: string };
export type ResolvedOption = TitleOptionDef & { value: number | boolean };
export interface VolumeAudioTarget {
  setMasterVolume(value: number): void;
  setMusicVolume(value: number): void;
  setFeedbackVolume(value: number): void;
}

export const DEFAULT_TITLE_CONFIG: TitleConfig = {
  logoText: 'Condo Life', logoImage: null, background: null, music: null,
  menu: [{ id: 'new', label: 'New Game' }, { id: 'load', label: 'Load Game' }, { id: 'options', label: 'Options' }],
  options: [
    { id: 'masterVolume', type: 'slider', label: 'Master volume', min: 0, max: 1, step: 0.05, default: 1 },
    { id: 'musicVolume', type: 'slider', label: 'Music volume', min: 0, max: 1, step: 0.05, default: 1 },
    { id: 'feedbackVolume', type: 'slider', label: 'Feedback volume', min: 0, max: 1, step: 0.05, default: 1 },
  ], credits: null,
};

export function resolveMenu(data: Pick<TitleConfig, 'menu'>, state: { hasSaves: boolean }): ResolvedMenuEntry[] {
  return data.menu.map((entry) => {
    const enabled = entry.enabled !== false && (entry.id !== 'load' || state.hasSaves);
    return { ...entry, enabled, disabledReason: enabled ? undefined : entry.id === 'load' && !state.hasSaves ? 'No saved games yet' : 'Unavailable' };
  });
}

export function mostRecentSlotId(slots: readonly SlotEntry[]): string | undefined {
  return slots.filter((slot) => slot.meta).reduce<SlotEntry | undefined>((latest, slot) => {
    if (!latest?.meta) return slot;
    const time = Date.parse(slot.meta!.savedAt); const latestTime = Date.parse(latest.meta.savedAt);
    return (Number.isFinite(time) ? time : -Infinity) > (Number.isFinite(latestTime) ? latestTime : -Infinity) ? slot : latest;
  }, undefined)?.slotId;
}

function finite(value: unknown, fallback: number): number { return typeof value === 'number' && Number.isFinite(value) ? value : fallback; }
export function clampOptionValue(def: TitleOptionDef, value: unknown): number | boolean {
  if (def.type === 'toggle') return typeof value === 'boolean' ? value : Boolean(def.default);
  const min = finite(def.min, 0); const max = Math.max(min, finite(def.max, 1));
  return Math.min(max, Math.max(min, finite(value, finite(def.default, min))));
}
export function resolveOptions(definitions: readonly TitleOptionDef[], prefs: TitlePreferences = {}): ResolvedOption[] {
  return definitions.map((def) => ({ ...def, value: clampOptionValue(def, prefs[def.id]) }));
}
export function defaultPreferences(definitions: readonly TitleOptionDef[]): TitlePreferences {
  return Object.fromEntries(resolveOptions(definitions).map((option) => [option.id, option.value]));
}

export class PreferencesStore {
  constructor(private readonly storage: PreferencesStorage, private readonly key = TITLE_PREFS_KEY) {}
  read(definitions: readonly TitleOptionDef[]): TitlePreferences {
    let parsed: unknown = {};
    try { parsed = JSON.parse(this.storage.getItem(this.key) ?? '{}'); } catch { parsed = {}; }
    const raw = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    return Object.fromEntries(definitions.map((def) => [def.id, clampOptionValue(def, raw[def.id])]));
  }
  write(definitions: readonly TitleOptionDef[], prefs: TitlePreferences): TitlePreferences {
    const clean = Object.fromEntries(resolveOptions(definitions, prefs).map((option) => [option.id, option.value]));
    try { this.storage.setItem(this.key, JSON.stringify(clean)); } catch { /* preferences never block play */ }
    return clean;
  }
}
export function applyVolumes(prefs: TitlePreferences, audio: VolumeAudioTarget): void {
  audio.setMasterVolume(Number(prefs.masterVolume ?? 1));
  audio.setMusicVolume(Number(prefs.musicVolume ?? 1));
  audio.setFeedbackVolume(Number(prefs.feedbackVolume ?? 1));
}
