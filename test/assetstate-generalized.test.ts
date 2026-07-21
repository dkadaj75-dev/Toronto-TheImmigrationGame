// assetstate-generalized.test.ts — New.txt (2026-07-20) generalized asset states: authored state
// lists, per-state interaction gating, transitions via ActionDef.setsState, the BFS that lets
// autonomy "read through" states (open the murphy bed, then sleep), per-state mesh/nav overrides,
// and save round-tripping BOTH directions against the legacy boolean format.
// Run: npx tsx test/assetstate-generalized.test.ts

import {
  AssetStateRegistry, LEGACY_OFF, LEGACY_ON, actionsForState, assetStates, defaultStateId,
  hasCustomStates, isActionAvailableInState, planToReachAction, resolveStateOverrides, stateAfterAction,
} from '../game/assetstate';
import type { AssetDef } from '../game/data';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name} ${detail}`); }
}

const base = {
  name: 'x', category: 'furniture', buyPrice: 0, sellPrice: 0, environmentScore: 0,
} as unknown as AssetDef;

// The designer's own example: a murphy bed that must be opened before it can be slept on.
const murphy: AssetDef = {
  ...base,
  id: 'murphy_bed', mesh: 'models/murphy_closed.glb', footprint: [1.2, 0.4],
  interactions: ['open_bed', 'close_bed', 'sleep', 'nap'],
  states: [
    { id: 'closed', default: true, interactions: ['open_bed'] },
    { id: 'open', mesh: 'models/murphy_open.glb', interactions: ['close_bed', 'sleep', 'nap'], footprint: [1.2, 2], blocksNav: true },
  ],
};
// Legacy asset: no `states` at all — must behave exactly as before generalization.
const tv: AssetDef = {
  ...base, id: 'tv', mesh: 'models/tv.glb', footprint: [1.5, 0.25],
  interactions: ['watch_tv', 'turn_on', 'turn_off'],
  light: { defaultOn: false },
};

const actions = new Map<string, { setsState?: string; powersOnTarget?: boolean }>([
  ['open_bed', { setsState: 'open' }],
  ['close_bed', { setsState: 'closed' }],
  ['sleep', {}],
  ['nap', {}],
  ['watch_tv', { powersOnTarget: true }],
  ['turn_on', {}],
  ['turn_off', {}],
]);

// --- authoring + defaults
check('authored states are read', assetStates(murphy).length === 2 && hasCustomStates(murphy));
check('a legacy asset reports no custom states', !hasCustomStates(tv) && assetStates(tv).length === 0);
check('the flagged default state starts the instance', defaultStateId(murphy) === 'closed');
check('first state wins when none is flagged',
  defaultStateId({ ...murphy, states: [{ id: 'a' }, { id: 'b' }] }) === 'a');
check('a legacy asset still defaults from light.defaultOn',
  defaultStateId(tv) === LEGACY_OFF && defaultStateId({ ...tv, light: { defaultOn: true } }) === LEGACY_ON);
check('blank state ids are ignored', assetStates({ ...murphy, states: [{ id: '  ' }, { id: 'ok' }] }).length === 1);

// --- per-state interaction gating
check('closed offers only opening', JSON.stringify(actionsForState(murphy, 'closed')) === JSON.stringify(['open_bed']));
check('open offers sleeping and closing',
  JSON.stringify(actionsForState(murphy, 'open')) === JSON.stringify(['close_bed', 'sleep', 'nap']));
check('sleep is unavailable while closed', !isActionAvailableInState(murphy, 'closed', 'sleep'));
check('sleep is available once open', isActionAvailableInState(murphy, 'open', 'sleep'));
check('a state without an interactions list offers everything',
  actionsForState({ ...murphy, states: [{ id: 'any' }] }, 'any').length === murphy.interactions.length);
// Legacy gating is untouched: turn_on only while off, turn_off only while on.
check('legacy OFF offers turn_on but not turn_off',
  actionsForState(tv, LEGACY_OFF).includes('turn_on') && !actionsForState(tv, LEGACY_OFF).includes('turn_off'));
check('legacy ON offers turn_off but not turn_on',
  actionsForState(tv, LEGACY_ON).includes('turn_off') && !actionsForState(tv, LEGACY_ON).includes('turn_on'));

// --- transitions
check('setsState drives the transition', stateAfterAction(murphy, 'open_bed', actions.get('open_bed')) === 'open');
check('an action with no transition changes nothing', stateAfterAction(murphy, 'sleep', actions.get('sleep')) === null);
check('an unknown setsState id is ignored, never stranding the instance',
  stateAfterAction(murphy, 'open_bed', { setsState: 'nonexistent' }) === null);
check('legacy turn_on/turn_off still map to on/off',
  stateAfterAction(tv, 'turn_on', actions.get('turn_on')) === LEGACY_ON
  && stateAfterAction(tv, 'turn_off', actions.get('turn_off')) === LEGACY_OFF);
check('legacy powersOnTarget still switches ON', stateAfterAction(tv, 'watch_tv', actions.get('watch_tv')) === LEGACY_ON);

// --- read-through planning (the headline behaviour)
check('an already-available goal needs no steps',
  JSON.stringify(planToReachAction(murphy, 'open', 'sleep', actions)) === JSON.stringify([]));
check('sleeping on a closed bed plans the opening first',
  JSON.stringify(planToReachAction(murphy, 'closed', 'sleep', actions)) === JSON.stringify(['open_bed']));
check('an action the asset does not offer is unreachable',
  planToReachAction(murphy, 'closed', 'cook', actions) === null);
// A three-state chain proves the walk is breadth-first rather than one-step-only.
const safe: AssetDef = {
  ...base, id: 'safe', mesh: 'm.glb', footprint: [1, 1],
  interactions: ['unlock', 'open_safe', 'take_cash'],
  states: [
    { id: 'locked', default: true, interactions: ['unlock'] },
    { id: 'unlocked', interactions: ['open_safe'] },
    { id: 'opened', interactions: ['take_cash'] },
  ],
};
const safeActions = new Map<string, { setsState?: string }>([
  ['unlock', { setsState: 'unlocked' }], ['open_safe', { setsState: 'opened' }], ['take_cash', {}],
]);
check('a multi-step chain is planned in order',
  JSON.stringify(planToReachAction(safe, 'locked', 'take_cash', safeActions)) === JSON.stringify(['unlock', 'open_safe']));
check('an unreachable goal returns null (no transition leads there)',
  planToReachAction(
    { ...safe, states: [{ id: 'locked', default: true, interactions: ['unlock'] }, { id: 'opened', interactions: ['take_cash'] }] },
    'locked', 'take_cash', new Map([['unlock', {}], ['take_cash', {}]]),
  ) === null);
// Cycles must terminate rather than hang.
const revolving: AssetDef = {
  ...base, id: 'rev', mesh: 'm.glb', footprint: [1, 1], interactions: ['spin', 'use'],
  states: [{ id: 'a', default: true, interactions: ['spin'] }, { id: 'b', interactions: ['spin'] }],
};
check('a cyclic transition graph terminates',
  planToReachAction(revolving, 'a', 'use', new Map([['spin', { setsState: 'b' }], ['use', {}]])) === null);

// --- per-state overrides
const closedView = resolveStateOverrides(murphy, 'closed');
const openView = resolveStateOverrides(murphy, 'open');
check('a state without a mesh keeps the base mesh', closedView.mesh === 'models/murphy_closed.glb');
check('a state mesh overrides the base', openView.mesh === 'models/murphy_open.glb');
check('a state footprint overrides the base', JSON.stringify(openView.footprint) === JSON.stringify([1.2, 2])
  && JSON.stringify(closedView.footprint) === JSON.stringify([1.2, 0.4]));
check('nav blocking defaults to true and is per-state overridable',
  closedView.blocksNav === true && resolveStateOverrides({ ...murphy, states: [{ id: 'closed', blocksNav: false }] }, 'closed').blocksNav === false);

// --- registry + save round-trip
const registry = new AssetStateRegistry();
check('an unseen instance reports its default state', registry.stateOf('designer:0', murphy) === 'closed');
check('setState reports a real change', registry.setState('designer:0', 'open') === true);
check('setting the same state reports no change', registry.setState('designer:0', 'open') === false);
check('the legacy isOn facade still works',
  registry.setOn('designer:1', true) && registry.isOn('designer:1', tv) && registry.stateOf('designer:1', tv) === LEGACY_ON);

const saved = registry.serialize();
check('generalized states serialize', saved.states?.['designer:0'] === 'open');
check('legacy boolean map is still written for older builds', saved.on['designer:1'] === true && !('designer:0' in saved.on));
const restored = new AssetStateRegistry();
restored.restore(saved);
check('a generalized save round-trips', restored.stateOf('designer:0', murphy) === 'open' && restored.isOn('designer:1', tv));
// A pre-generalization save carries only `on` — it must still restore.
const legacyOnly = new AssetStateRegistry();
legacyOnly.restore({ on: { 'designer:5': true, 'designer:6': false } });
check('a pre-generalization save still restores',
  legacyOnly.stateOf('designer:5', tv) === LEGACY_ON && legacyOnly.stateOf('designer:6', tv) === LEGACY_OFF);

if (failures > 0) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
console.log('\nall generalized asset-state checks passed');
