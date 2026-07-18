import {
  AssetStateRegistry, isAssetStateActionAvailable, isStatefulAsset,
  powerStateForAction, resolveAssetLight,
} from '../game/assetstate';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name} ${detail}`); }
}

console.log('assetstate.test — B6-12 light defaults and serializable state');
const offDef = { interactions: ['turn_on', 'turn_off'], light: {} };
const onDef = { interactions: ['turn_on', 'turn_off'], light: { defaultOn: true, intensity: 4 } };
{
  const resolved = resolveAssetLight(offDef);
  check('sparse light resolves defaults', !!resolved && resolved.intensity === 2 && resolved.distance === 5 && resolved.yOffset === 1.2 && !resolved.defaultOn);
  check('absent light emits nothing', resolveAssetLight({}) === null);
  check('power actions make an asset stateful', isStatefulAsset(offDef));
  check('ordinary interactions remain legacy/non-stateful', !isStatefulAsset({ interactions: ['shower'] }));

  const registry = new AssetStateRegistry();
  check('instance seeds OFF from sparse default', registry.isOn('designer:1', offDef) === false);
  check('another instance seeds ON independently', registry.isOn('designer:2', onDef) === true);
  registry.setOn('designer:1', true);
  const saved = registry.serialize();
  const restored = new AssetStateRegistry(); restored.restore(saved);
  check('serialize/restore preserves per-instance ON', restored.isOn('designer:1', offDef) === true);
  check('serialize/restore preserves independent instance', restored.isOn('designer:2', onDef) === true);
}

console.log('assetstate.test — contextual actions and Sims-like TV auto-on');
{
  check('Turn On shown only while OFF', isAssetStateActionAvailable('turn_on', false) && !isAssetStateActionAvailable('turn_on', true));
  check('Turn Off shown only while ON', isAssetStateActionAvailable('turn_off', true) && !isAssetStateActionAvailable('turn_off', false));
  check('ordinary actions ignore state', isAssetStateActionAvailable('watch_tv', false));
  check('powersOnTarget action auto-powers ON (B13-2 data-driven)', powerStateForAction('watch_tv', { powersOnTarget: true }) === true);
  check('any powersOnTarget id works, not just watch_tv', powerStateForAction('watch_colombian_telenovelas', { powersOnTarget: true }) === true);
  check('without the flag no auto-power (old hardcoded watch_tv gone)', powerStateForAction('watch_tv', {}) === null);
  check('turn_on still powers ON without any flag', powerStateForAction('turn_on') === true);
  check('Turn Off powers OFF', powerStateForAction('turn_off') === false);
  check('turn_off wins even if mistakenly flagged powersOnTarget', powerStateForAction('turn_off', { powersOnTarget: true }) === false);
  check('unrelated action has no power side effect', powerStateForAction('shower') === null);
}

if (failures) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
console.log('\nall assetstate.test checks passed');
