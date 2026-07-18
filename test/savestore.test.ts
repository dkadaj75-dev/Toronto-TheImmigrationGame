// Run: npx tsx test/savestore.test.ts

import type { SaveConfig } from '../game/data';
import type { SaveCore, SaveEnvelope } from '../game/save';
import { buildExportBlob, deleteSlot, listSlots, parseImport, readSlot, SaveStore, slotKey, writeSlot, type StorageAdapter } from '../game/savestore';

class FakeStorage implements StorageAdapter {
  readonly values = new Map<string, string>();
  failWrites = false;
  get length(): number { return this.values.size; }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error('QuotaExceededError');
    this.values.set(key, value);
  }
  removeItem(key: string): void { this.values.delete(key); }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
}

const config: SaveConfig = {
  slots: 3, autosaveSlotId: 'autosave', autosaveIntervalHours: 12,
  autosaveOnEvents: ['moveIn', 'dayRollover'], storageKeyPrefix: 'condo-life-save',
};
const envelope: SaveEnvelope = {
  version: 1, savedAt: '2026-07-18T09:30:00.000Z', name: 'Slot One', mapId: 'condo', gameHour: 12,
  systems: { quests: { funds: 500 } },
};

let failures = 0;
let checks = 0;
function check(name: string, condition: boolean): void {
  checks++;
  if (condition) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name}`); }
}

console.log('savestore.test — slots');
{
  const storage = new FakeStorage();
  check('write succeeds', writeSlot(storage, config, '1', envelope).ok);
  check('storage key uses configured prefix', storage.values.has('condo-life-save:1'));
  const read = readSlot(storage, config, '1');
  check('read round-trips an envelope', read.ok && read.envelope.systems.quests !== undefined);
  const listed = listSlots(storage, config);
  check('list returns stored slot', listed.length === 1 && listed[0].slotId === '1');
  check('list extracts slot metadata', listed[0].meta?.funds === 500 && listed[0].meta?.name === 'Slot One');
  check('delete succeeds', deleteSlot(storage, config, '1').ok);
  check('deleted slot reads empty', !readSlot(storage, config, '1').ok);
  const bound = new SaveStore(storage);
  check('bound SaveStore exposes config-first API', bound.writeSlot(config, '2', envelope).ok && bound.listSlots(config)[0].slotId === '2');
}

console.log('savestore.test — corruption and quota');
{
  const storage = new FakeStorage();
  storage.values.set(slotKey(config, 'broken'), '{not json');
  storage.values.set('another-prefix:1', JSON.stringify(envelope));
  const listed = listSlots(storage, config);
  check('corrupt slot is listed and flagged', listed.length === 1 && listed[0].slotId === 'broken' && listed[0].corrupt === true);
  storage.failWrites = true;
  const write = writeSlot(storage, config, '2', envelope);
  check('quota failure returns failure result', !write.ok);
  check('quota failure reason is useful', !write.ok && write.reason.includes('storage may be full'));
  check('different prefix is ignored', !listed.some((slot) => slot.slotId === '1'));
}

console.log('savestore.test — export/import');
{
  const exported = buildExportBlob(envelope, 'autosave');
  check('export filename has slot and ISO date', exported.filename === 'condo-life-save-autosave-2026-07-18.json');
  check('export JSON contains envelope', JSON.parse(exported.json).mapId === 'condo');
  const imported = parseImport(exported.json);
  check('valid import returns validated envelope', imported.ok && imported.envelope.gameHour === 12);
  const badJson = parseImport('{oops');
  check('invalid import JSON returns error', !badJson.ok && badJson.error.includes('Invalid JSON'));
  const future = parseImport(JSON.stringify({ ...envelope, version: 99 }));
  check('future import follows V1 refusal path', !future.ok && future.error.includes('newer'));

  const core: SaveCore = { currentVersion: 2, migrations: { 1: (old) => ({ ...old, version: 2 }) } };
  const migrated = parseImport(exported.json, core);
  check('import runs configured migrations', migrated.ok && migrated.envelope.version === 2);
}

console.log('savestore.test — alternate prefix');
{
  const storage = new FakeStorage();
  const alternate = { ...config, storageKeyPrefix: 'custom-prefix' };
  writeSlot(storage, alternate, 'autosave', envelope);
  check('alternate prefix is respected end-to-end', storage.values.has('custom-prefix:autosave') && listSlots(storage, alternate).length === 1);
}

if (failures) { console.error(`\n${failures}/${checks} checks failed`); process.exit(1); }
console.log(`\nall ${checks} savestore tests passed`);
