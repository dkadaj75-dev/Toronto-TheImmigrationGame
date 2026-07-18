import assert from 'node:assert/strict';
import type { SaveConfig } from '../game/data';
import type { SaveEnvelope } from '../game/save';
import { SaveStore } from '../game/savestore';
import {
  deleteDecision, exportSlot, importIntoSlot, loadDecision, overwriteDecision, renameDecision,
  renameSlot, slotCardViews,
} from '../game/saveslots';

class MemoryStorage {
  values = new Map<string, string>();
  get length() { return this.values.size; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
}

const config: SaveConfig = { slots: 2, autosaveSlotId: 'autosave', autosaveIntervalHours: 12, autosaveOnEvents: [], storageKeyPrefix: 'test-save' };
const storage = new MemoryStorage();
const store = new SaveStore(storage);
const envelope: SaveEnvelope = {
  version: 1, savedAt: '2026-07-18T12:34:00.000Z', name: 'My Condo', mapId: 'condo', gameHour: 30,
  playSeconds: 7380, systems: { quests: { funds: 1234 } },
};
assert.equal(store.writeSlot(config, 'slot-1', envelope).ok, true);
storage.setItem('test-save:slot-2', '{bad json');

let cards = slotCardViews(store, { ...config, mapNames: { condo: 'Downtown Condo' }, locale: 'en-CA' });
assert.deepEqual(cards.map((card) => [card.slotId, card.kind, card.status]), [
  ['slot-1', 'manual', 'ok'], ['slot-2', 'manual', 'corrupt'], ['autosave', 'autosave', 'empty'],
]);
assert.equal(cards[0].name, 'My Condo');
assert.equal(cards[0].mapName, 'Downtown Condo');
assert.equal(cards[0].funds, 1234);
assert.equal(cards[0].gameClockLabel, '2h 03m');
assert.equal(cards[2].name, 'Autosave');

assert.equal(overwriteDecision(cards[0]), 'confirm');
assert.equal(overwriteDecision(cards[2]), 'blocked');
assert.equal(loadDecision(cards[0], true), 'confirm');
assert.equal(loadDecision(cards[0], false), 'proceed');
assert.equal(loadDecision(cards[1], false), 'blocked');
assert.equal(deleteDecision(cards[0]), 'confirm');
assert.equal(deleteDecision(cards[2]), 'blocked');
assert.equal(renameDecision(cards[0]), 'proceed');
assert.equal(renameDecision(cards[1]), 'blocked');

assert.equal(renameSlot(store, config, 'slot-1', 'Renamed').ok, true);
cards = slotCardViews(store, config);
assert.equal(cards[0].name, 'Renamed');
assert.equal(renameSlot(store, config, 'autosave', 'Nope').ok, false);

const exported = exportSlot(store, config, 'slot-1');
assert.equal(exported.ok, true);
if (exported.ok) {
  assert.match(exported.filename, /^condo-life-save-slot-1-2026-07-18\.json$/);
  assert.equal(importIntoSlot(store, config, 'slot-2', exported.json).ok, true);
}
assert.equal(importIntoSlot(store, config, 'autosave', JSON.stringify(envelope)).ok, false);
assert.equal(importIntoSlot(store, config, 'slot-2', 'not json').ok, false);

console.log('save slots: cards, autosave rules, decisions, rename, export, and import passed');
