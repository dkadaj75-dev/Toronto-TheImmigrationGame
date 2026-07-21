// events.test.ts — New.txt #6 event manager, pure core (game/events.ts).
// Covers: gating through the shared condition evaluator, the once-per-fire chance roll, effect
// ordering/scope defaulting, never-throw degradation, the composition depth guard, and cycle
// detection. Run: npx tsx test/events.test.ts

import { MAX_EVENT_DEPTH, canFireAtDepth, eventCycles, findEvent, reachableEvents, resolveEvent } from '../game/events';
import type { EventsData } from '../game/data';
import type { EvalContext } from '../game/quests';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name} ${detail}`); }
}

const ctx: EvalContext = {
  needs: { hygiene: 40 }, skills: { handiness: 2 }, funds: 100,
  time: { hour: 9, day: 3 }, happiness: 55, vars: {}, quests: {},
};

// The designer's own example from New.txt: a sink leak.
const data: EventsData = {
  events: [
    {
      id: 'sink_leak', name: 'Sink leak',
      conditions: { all: [{ var: 'skills.handiness', lte: 3 }] },
      effects: [
        { type: 'notification', event: 'sinkLeak', title: 'The sink is leaking!' },
        { type: 'spawnTransient', asset: 'water_puddle' },
        { type: 'needDelta', need: 'hygiene', amount: -10, at: 'sim' },
        { type: 'assetState', state: 'broken' },
      ],
    },
    { id: 'lucky', chancePercent: 50, effects: [{ type: 'funds', amount: 25 }] },
    { id: 'never', chancePercent: 0, effects: [{ type: 'funds', amount: 1 }] },
    { id: 'always', chancePercent: 100, effects: [{ type: 'funds', amount: 1 }] },
    { id: 'empty', effects: [] },
    { id: 'chain_a', effects: [{ type: 'fireEvent', event: 'chain_b' }] },
    { id: 'chain_b', effects: [{ type: 'fireEvent', event: 'chain_c' }] },
    { id: 'chain_c', effects: [{ type: 'funds', amount: 5 }] },
    { id: 'loop_a', effects: [{ type: 'fireEvent', event: 'loop_b' }] },
    { id: 'loop_b', effects: [{ type: 'fireEvent', event: 'loop_a' }] },
  ],
};

// --- lookup + firing
check('a known event is found', findEvent(data, 'sink_leak')?.name === 'Sink leak');
const leak = resolveEvent(data, 'sink_leak', { eval: ctx });
check('a gated event fires when its condition holds', leak.fired && leak.effects.length === 4);
check('effects keep their authored order',
  JSON.stringify(leak.effects.map((e) => e.effect.type)) === JSON.stringify(['notification', 'spawnTransient', 'needDelta', 'assetState']));
check('scope defaults to the firing target', leak.effects[0].scope === 'target' && leak.effects[1].scope === 'target');
check('an explicit scope is preserved', leak.effects[2].scope === 'sim');

const gated = resolveEvent(data, 'sink_leak', { eval: { ...ctx, skills: { handiness: 9 } } });
check('a failed condition does not fire', !gated.fired && gated.reason === 'conditions' && gated.effects.length === 0);

// --- never-throw degradation
const unknown = resolveEvent(data, 'nope', { eval: ctx });
check('an unknown id degrades instead of throwing', !unknown.fired && unknown.reason === 'unknown');
check('an empty effect list does not count as fired', resolveEvent(data, 'empty', { eval: ctx }).reason === 'empty');
check('missing events data degrades', resolveEvent(undefined, 'sink_leak', { eval: ctx }).reason === 'unknown');
check('a malformed effect is dropped, not thrown on',
  resolveEvent({ events: [{ id: 'bad', effects: [null as never, { type: 'funds', amount: 1 }] }] }, 'bad', { eval: ctx }).effects.length === 1);

// --- chance: rolled once, boundaries exact
check('chance 0 never fires', !resolveEvent(data, 'never', { eval: ctx, rng: () => 0 }).fired);
check('chance 100 always fires', resolveEvent(data, 'always', { eval: ctx, rng: () => 0.999 }).fired);
check('a roll under the chance fires', resolveEvent(data, 'lucky', { eval: ctx, rng: () => 0.49 }).fired);
check('a roll at the chance does not fire (strictly-below)', !resolveEvent(data, 'lucky', { eval: ctx, rng: () => 0.5 }).fired);
check('a lost roll reports why', resolveEvent(data, 'lucky', { eval: ctx, rng: () => 0.9 }).reason === 'chance');
check('a non-finite roll is treated as a miss rather than firing everything',
  !resolveEvent(data, 'lucky', { eval: ctx, rng: () => Number.NaN }).fired);

// --- composition guard
check('depth 0 may fire', canFireAtDepth(0));
check('depth below the cap may fire', canFireAtDepth(MAX_EVENT_DEPTH - 1));
check('the cap itself is refused', !canFireAtDepth(MAX_EVENT_DEPTH));
check('a nonsense depth is refused', !canFireAtDepth(Number.NaN) && !canFireAtDepth(-1));

// --- cycle detection (Event Editor warning, before the designer ships one)
check('a chain lists everything downstream',
  JSON.stringify(reachableEvents(data, 'chain_a')) === JSON.stringify(['chain_b', 'chain_c']));
check('a straight chain is not a cycle', !eventCycles(data, 'chain_a'));
check('a mutual pair is detected as a cycle', eventCycles(data, 'loop_a') && eventCycles(data, 'loop_b'));
check('cycle detection terminates and does not hang', reachableEvents(data, 'loop_a').length === 2);
check('an event that fires nothing reaches nothing', reachableEvents(data, 'chain_c').length === 0);

if (failures > 0) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
console.log('\nall event-manager core checks passed');
