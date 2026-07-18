import { AssetStateRegistry } from '../game/assetstate';
import {
  crossedNightWindowBoundary, inspectAmbience, isNightHour, nightEnvironmentBonus, nightEnvironmentContribution,
  sameRoom, sleepBlockDecision,
  type AmbienceAssetInstance, type AmbienceRoomGeometry,
} from '../game/ambience';
import type { AssetDef } from '../game/data';

let passed = 0;
function check(name: string, ok: boolean) {
  if (!ok) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
  passed++;
}

const asset = (id: string, extra: Partial<AssetDef>): AssetDef => ({
  id, name: id === 'tv' ? 'TV' : id, category: 'decor', mesh: '', buyPrice: 0, sellPrice: 0,
  environmentScore: 0, footprint: [1, 1], interactions: ['turn_on', 'turn_off'], ...extra,
});
const lamp = asset('lamp', { light: { defaultOn: true, environmentBonus: 0.75 } });
const tv = asset('tv', { sound: '/tv.mp3', light: { defaultOn: true } });
const stereo = asset('stereo', { sound: '/radio.mp3' });
const wall = { from: [5, 0] as [number, number], to: [5, 10] as [number, number] };
const door = { at: [5, 5] as [number, number], orientation: 'vertical' as const, width: 1 };
const room = (doorOpen = false): AmbienceRoomGeometry => ({
  walls: [wall], doors: [door], isDoorOpen: () => doorOpen,
});
const instance = (def: AssetDef, position: [number, number], key = def.id): AmbienceAssetInstance => ({ key, def, position });

check('same side of wall is the same room', sameRoom([2, 2], [3, 8], room()));
check('wall-mounted source at the ray endpoint remains in the room', sameRoom([2, 5], [5, 5], { walls: [wall], doors: [] }));
check('straight wall crossing is a different room', !sameRoom([2, 5], [8, 5], { walls: [wall], doors: [] }));
check('closed on-wall door blocks the room ray', !sameRoom([2, 5], [8, 5], room(false)));
check('open on-wall aperture passes the room ray', sameRoom([2, 5], [8, 5], room(true)));

const gapRoom = (open: boolean): AmbienceRoomGeometry => ({
  walls: [
    { from: [5, 0], to: [5, 4.5] },
    { from: [5, 5.5], to: [5, 10] },
  ],
  doors: [door],
  isDoorOpen: () => open,
});
check('closed door blocks a legacy physical wall gap', !sameRoom([2, 5], [8, 5], gapRoom(false)));
check('open door connects a legacy physical wall gap', sameRoom([2, 5], [8, 5], gapRoom(true)));

const states = new AssetStateRegistry();
const nearby = inspectAmbience([0, 0], instance(lamp, [3, 0]), states, { walls: [], doors: [] }, 3);
check('radius edge is included', nearby.withinRadius && nearby.active);
const outside = inspectAmbience([0, 0], instance(lamp, [3.01, 0]), states, { walls: [], doors: [] }, 3);
check('outside radius is inactive', !outside.active);
check('same-room result remains independent of radius', outside.sameRoom);
check('wall-separated source is inactive', !inspectAmbience([2, 5], instance(lamp, [8, 5]), states, room(false), 10).active);
check('open doorway activates source', inspectAmbience([2, 5], instance(lamp, [8, 5]), states, room(true), 10).active);

states.setOn('off-lamp', false);
check('OFF source is inactive', !inspectAmbience([0, 0], instance(lamp, [1, 0], 'off-lamp'), states, { walls: [], doors: [] }, 3).active);
states.setOn('stereo', true);
const soundMatch = inspectAmbience([0, 0], instance(stereo, [1, 0]), states, { walls: [], doors: [] }, 3);
check('sound-only asset is an emitter', soundMatch.active && !soundMatch.emitsLight && soundMatch.emitsSound);
const tvMatch = inspectAmbience([0, 0], instance(tv, [2, 0]), states, { walls: [], doors: [] }, 3);
check('TV emits both light and sound', tvMatch.active && tvMatch.emitsLight && tvMatch.emitsSound);

check('night starts inclusively', isNightHour(22, 22, 6));
check('hour before midnight is night', isNightHour(23.999, 22, 6));
check('night ends exclusively', !isNightHour(6, 22, 6));
check('day before night start is not night', !isNightHour(21.999, 22, 6));
check('non-wrapping night window edges work', isNightHour(2, 1, 4) && !isNightHour(4, 1, 4));

check('lit nearby same-room asset adds its sparse night Environment bonus', nightEnvironmentBonus(23, 22, 6, [nearby]) === 0.75);
check('night Environment bonus is zero during day', nightEnvironmentBonus(12, 22, 6, [nearby]) === 0);
check('OFF light adds no night Environment bonus', nightEnvironmentBonus(23, 22, 6, [
  inspectAmbience([0, 0], instance(lamp, [1, 0], 'off-lamp'), states, { walls: [], doors: [] }, 3),
]) === 0);
check('other-room light adds no night Environment bonus', nightEnvironmentBonus(23, 22, 6, [
  inspectAmbience([2, 5], instance(lamp, [8, 5]), states, room(false), 10),
]) === 0);
check('absent environmentBonus resolves to zero', nightEnvironmentBonus(23, 22, 6, [tvMatch]) === 0);
check('sound-only emitters do not add light Environment', nightEnvironmentBonus(23, 22, 6, [soundMatch]) === 0);
check('night darkness penalty is applied as its authored signed delta', nightEnvironmentContribution(
  23, 22, 6, [], { nightEnvironmentPenalty: -7 },
) === -7);
check('a positive authored night delta raises Environment without sign coercion', nightEnvironmentContribution(
  23, 22, 6, [], { nightEnvironmentPenalty: 4 },
) === 4);
check('day has neither darkness penalty nor lamp bonus', nightEnvironmentContribution(
  12, 22, 6, [nearby], { nightEnvironmentPenalty: -7 },
) === 0);
check('ON lamps claw back part of the night penalty', nightEnvironmentContribution(
  23, 22, 6, [nearby], { nightEnvironmentPenalty: -7 },
) === -6.25);
check('night Environment master switch disables penalty and lamp bonuses together', nightEnvironmentContribution(
  23, 22, 6, [nearby], { nightEnvironmentEnabled: false, nightEnvironmentPenalty: -7 },
) === 0);
check('absent nightEnvironmentPenalty defaults to zero for old tuning fixtures', nightEnvironmentContribution(
  23, 22, 6, [nearby], { nightEnvironmentEnabled: true },
) === 0.75);
check('night start crossing requests an Environment recompute', crossedNightWindowBoundary(21.99, 22, 22, 6));
check('night end crossing requests an Environment recompute', crossedNightWindowBoundary(5.99, 6, 22, 6));
check('night-boundary recompute changes the full penalty-plus-lamps contribution',
  nightEnvironmentContribution(21.99, 22, 6, [nearby], { nightEnvironmentPenalty: -7 }) === 0
  && nightEnvironmentContribution(22, 22, 6, [nearby], { nightEnvironmentPenalty: -7 }) === -6.25
  && crossedNightWindowBoundary(21.99, 22, 22, 6));
check('ordinary hour advancement does not request a recompute', !crossedNightWindowBoundary(23, 0, 22, 6));

const blocked = sleepBlockDecision([nearby, tvMatch]);
check('sleep is blocked by active emitter', blocked.blocked && blocked.blocker?.def.id === 'tv');
check('sleep blocker names the nearest device', blocked.reason === "Can't sleep - the TV is on");
check('master switch disables sleep blocking', !sleepBlockDecision([tvMatch], false).blocked);
check('inactive candidates do not block sleep', !sleepBlockDecision([{ ...tvMatch, active: false }]).blocked);

console.log(`\n${passed} ambience assertions passed.`);
