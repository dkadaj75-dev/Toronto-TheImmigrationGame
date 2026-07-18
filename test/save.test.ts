// Run: npx tsx test/save.test.ts

import {
  SaveRegistry,
  applyEnvelope,
  assembleEnvelope,
  extractSlotMeta,
  registerSaveable,
  validateEnvelope,
  type SaveCore,
  type SaveEnvelope,
} from '../game/save';

let failures = 0;
let checks = 0;
function check(name: string, condition: boolean, detail = ''): void {
  checks++;
  if (condition) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name} ${detail}`); }
}

console.log('save.test — registry and round-trip');
{
  let restored: unknown;
  const registry = new SaveRegistry();
  const unregister = registerSaveable(registry, 'fake', {
    serialize: () => ({ score: 42 }),
    restore: (payload) => { restored = payload; },
  });
  const envelope = assembleEnvelope(registry, { savedAt: '2026-07-18T12:00:00.000Z', name: 'Home', mapId: 'condo', gameHour: 8, playSeconds: 90 });
  check('assembles current-version envelope', envelope.version === 1 && envelope.mapId === 'condo');
  check('collects opaque system payload', (envelope.systems.fake as { score: number }).score === 42);
  const result = applyEnvelope(registry, envelope);
  check('applies valid envelope', result.ok);
  check('round-trips payload unchanged', (restored as { score: number }).score === 42);
  unregister();
  check('registration disposer unregisters only its system', !registry.has('fake'));
}

console.log('save.test — corrupt isolation, unknown and missing systems');
{
  const registry = new SaveRegistry();
  let good = 0;
  let bad = 99;
  let missing = 99;
  registry.registerSaveable('good', { serialize: () => good, restore: (value) => { good = value as number; }, defaults: 0 });
  registry.registerSaveable('bad', {
    serialize: () => bad,
    restore: (value) => {
      if (value !== 0) throw new Error('corrupt payload');
      bad = value as number;
    },
    defaults: 0,
  });
  registry.registerSaveable('missing', { serialize: () => missing, restore: (value) => { missing = value as number; }, defaults: () => 0 });
  const envelope: SaveEnvelope = {
    version: 1, savedAt: '2026-07-18T12:00:00.000Z', mapId: 'condo', gameHour: 5,
    systems: { good: 7, bad: { broken: true }, removed_feature: { old: true } },
  };
  const result = applyEnvelope(registry, envelope);
  check('one corrupt payload does not abort load', result.ok && good === 7);
  check('corrupt system restores defaults', bad === 0);
  check('missing system restores defaults', missing === 0);
  check('corrupt payload produces warning', result.warnings.some((w) => w.includes('bad') && w.includes('failed')));
  check('unknown id is ignored with warning', result.warnings.some((w) => w.includes('removed_feature') && w.includes('ignored')));
  check('missing id produces warning', result.warnings.some((w) => w.includes('missing') && w.includes('defaults')));
}

console.log('save.test — migrations and refusal');
{
  const core: SaveCore = {
    currentVersion: 3,
    migrations: {
      1: (envelope) => ({ ...envelope, version: 2, systems: { ...envelope.systems, v2: true } }),
      2: (envelope) => ({ ...envelope, version: 3, systems: { ...envelope.systems, v3: true } }),
    },
  };
  const old: SaveEnvelope = { version: 1, savedAt: '2026-07-18T00:00:00.000Z', mapId: 'old', gameHour: 1, systems: {} };
  const migrated = validateEnvelope(old, core);
  check('migration chain reaches v3', migrated.ok && migrated.envelope.version === 3);
  check('ordered migrations both transform payload', migrated.ok && migrated.envelope.systems.v2 === true && migrated.envelope.systems.v3 === true);
  const future = validateEnvelope({ ...old, version: 4 }, core);
  check('future version is refused', !future.ok);
  check('future refusal gives clear version reason', !future.ok && future.reason.includes('newer') && future.reason.includes('4'));
  const missingMigration = validateEnvelope(old, { currentVersion: 2 });
  check('missing migration is refused rather than guessed', !missingMigration.ok && missingMigration.reason.includes('No migration'));
}

console.log('save.test — metadata');
{
  const envelope: SaveEnvelope = {
    version: 1, savedAt: '2026-07-18T09:30:00.000Z', name: 'My Condo', mapId: 'tower', gameHour: 21.5, playSeconds: 3600,
    systems: { quests: { funds: 1234, other: true } },
  };
  const meta = extractSlotMeta(envelope);
  check('extracts menu metadata', meta.name === 'My Condo' && meta.mapId === 'tower' && meta.gameHour === 21.5 && meta.playSeconds === 3600);
  check('extracts funds from well-known quests system', meta.funds === 1234);
  check('funds is absent when well-known payload has none', extractSlotMeta({ ...envelope, systems: {} }).funds === undefined);
}

if (failures) { console.error(`\n${failures}/${checks} checks failed`); process.exit(1); }
console.log(`\nall ${checks} save tests passed`);
