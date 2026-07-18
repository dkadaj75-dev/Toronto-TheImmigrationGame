import assert from 'node:assert/strict';
import { applyVolumes, defaultPreferences, mostRecentSlotId, PreferencesStore, resolveMenu, resolveOptions } from '../game/title';
import type { TitleOptionDef } from '../game/data';

const options: TitleOptionDef[] = [
  { id: 'masterVolume', type: 'slider', label: 'Master', min: 0, max: 1, step: .05, default: .8 },
  { id: 'musicVolume', type: 'slider', label: 'Music', min: 0, max: 1, step: .05, default: .6 },
  { id: 'feedbackVolume', type: 'slider', label: 'Feedback', min: 0, max: 1, step: .05, default: 1 },
];
const menu = { menu: [{ id: 'new', label: 'New' }, { id: 'load', label: 'Load' }, { id: 'options', label: 'Options' }] };

assert.equal(resolveMenu(menu, { hasSaves: false }).find((entry) => entry.id === 'load')?.enabled, false);
assert.equal(resolveMenu(menu, { hasSaves: false }).find((entry) => entry.id === 'load')?.disabledReason, 'No saved games yet');
assert.equal(resolveMenu(menu, { hasSaves: true }).find((entry) => entry.id === 'load')?.enabled, true);
assert.equal(mostRecentSlotId([
  { slotId: 'old', meta: { savedAt: '2026-01-01T00:00:00.000Z', mapId: 'condo', gameHour: 8, funds: 10 } },
  { slotId: 'broken', corrupt: true },
  { slotId: 'newest', meta: { savedAt: '2026-07-18T00:00:00.000Z', mapId: 'condo', gameHour: 9, funds: 20 } },
]), 'newest');
assert.deepEqual(defaultPreferences(options), { masterVolume: .8, musicVolume: .6, feedbackVolume: 1 });
assert.deepEqual(resolveOptions(options, { masterVolume: 5, musicVolume: -2 }).map((entry) => entry.value), [1, 0, 1]);

const memory = new Map<string, string>();
const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value); } };
const store = new PreferencesStore(storage);
assert.deepEqual(store.read(options), { masterVolume: .8, musicVolume: .6, feedbackVolume: 1 });
store.write(options, { masterVolume: .25, musicVolume: .4, feedbackVolume: .7 });
assert.deepEqual(store.read(options), { masterVolume: .25, musicVolume: .4, feedbackVolume: .7 });

const applied: number[] = [];
applyVolumes(store.read(options), {
  setMasterVolume: (value) => applied.push(value), setMusicVolume: (value) => applied.push(value), setFeedbackVolume: (value) => applied.push(value),
});
assert.deepEqual(applied, [.25, .4, .7]);
console.log('title core: menu, clamping, defaults, prefs round-trip, save gating, and volume contract passed');
