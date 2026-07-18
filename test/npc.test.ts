import { VisitLifecycle, isNpcAvailable, type NpcDef, type NpcsData } from '../game/npc';
import type { SocialData } from '../game/social';

let checks = 0;
function check(label: string, ok: boolean, detail = ''): void {
  checks++;
  if (!ok) throw new Error(`${label}${detail ? ` — ${detail}` : ''}`);
  console.log(`  ✓ ${label}`);
}

const amara: NpcDef = {
  id: 'amara', name: 'Amara', mesh: '/models/character.glb', tint: '#d9a066', clipMap: null,
  personality: { cleanliness: 7, intelligence: 6 }, availableHours: { from: 10, to: 22 },
  visitDurationHours: 2, arrivalDelayMinutes: 5, visitorActions: ['sit', 'watch_tv'],
};
const npcs: NpcsData = { npcs: [amara] };
const social: SocialData = {
  relationship: { min: -100, max: 100, start: 0, decayPerDay: 0, levels: [] },
  compatibility: { traitWeights: {}, traitRange: 10, minMultiplier: 0.25, maxMultiplier: 1.75 },
  interactions: [],
  phone: {
    text: { durationSeconds: 10, needGains: { social: 1 }, relationshipGain: 1, cooldownMinutes: 60 },
    call: { durationSeconds: 45, needGains: { social: 2.5 }, relationshipGain: 2, cooldownMinutes: 120 },
  },
  visitTheirPlace: { awayHours: 4, needsRestored: {}, relationshipGain: 0, minLevel: 'friend' },
};

const make = () => new VisitLifecycle(() => npcs, () => social);
const reachable = { beginArrival: () => true };
// scale 60 means one sdt second advances one authored game minute.
const tickMinutes = (visits: VisitLifecycle, minutes: number, hour: number, hooks = reachable) =>
  visits.tick(minutes, 60, hour, hooks);

console.log('npc.test — pending arrival and one-visitor gating');
{
  const visits = make();
  check('idle can invite', visits.canInvite());
  check('known NPC invite accepted', visits.invite('amara'));
  check('pending visit blocks a second invite', !visits.canInvite() && !visits.invite('amara'));
  tickMinutes(visits, 4.99, 12);
  check('arrival does not fire before authored delay', visits.state.phase === 'pending');
  tickMinutes(visits, 0.01, 12);
  check('arrival fires at inclusive delay boundary', visits.state.phase === 'entering');
  check('entering visitor still blocks invites', !visits.canInvite());
  check('runtime arrival completion starts visiting', visits.markEntered() && visits.state.phase === 'visiting');
}

console.log('npc.test — duration, asked and availability leave triggers');
{
  const duration = make();
  duration.invite('amara'); tickMinutes(duration, 5, 12); duration.markEntered();
  tickMinutes(duration, 119.99, 13);
  check('visitor stays until full authored duration', duration.state.phase === 'visiting');
  tickMinutes(duration, 0.01, 14);
  check('duration completion starts leaving', duration.state.phase === 'leaving' && duration.state.leaveReason === 'duration');
  check('exit completion returns to idle', duration.markExited() && duration.canInvite());

  const asked = make();
  asked.invite('amara'); tickMinutes(asked, 5, 12); asked.markEntered();
  check('cancelled ask-to-leave has no side effect', !asked.endVisit(false) && asked.state.phase === 'visiting');
  check('completed ask-to-leave starts leaving', asked.endVisit(true) && asked.state.leaveReason === 'asked');

  const hours = make();
  hours.invite('amara'); tickMinutes(hours, 5, 21.5); hours.markEntered();
  tickMinutes(hours, 1, 21.99);
  check('visitor remains before availableHours.to', hours.state.phase === 'visiting');
  tickMinutes(hours, 1, 22);
  check('availableHours.to is an inclusive leave boundary', hours.state.leaveReason === 'availability');
  check('cross-midnight availability helper includes both sides',
    isNpcAvailable(23, { from: 20, to: 2 }) && isNpcAvailable(1.5, { from: 20, to: 2 }));
  check('cross-midnight availability ends exactly at to', !isNpcAvailable(2, { from: 20, to: 2 }));
}

console.log('npc.test — unreachable exterior door converts to completed call outcome');
{
  const visits = make();
  let arrivalAttempts = 0;
  let fallbackCalls = 0;
  let relationshipDelta = 0;
  let socialGain = 0;
  visits.invite('amara', 1.5);
  const hooks = {
    beginArrival: () => { arrivalAttempts++; return false; },
    onCallFallback: (_npc: NpcDef, outcome: { relationshipDelta: number; needGains: Record<string, number> }) => {
      fallbackCalls++;
      relationshipDelta = outcome.relationshipDelta;
      socialGain = outcome.needGains.social;
    },
  };
  tickMinutes(visits, 4.9, 12, hooks);
  check('failure side effects do not run before delay completes', arrivalAttempts === 0 && fallbackCalls === 0);
  tickMinutes(visits, 0.1, 12, hooks);
  check('unreachable arrival is attempted exactly once', arrivalAttempts === 1);
  check('unreachable arrival emits exactly one call outcome', fallbackCalls === 1);
  check('call outcome uses social.ts phoneGain compatibility math', relationshipDelta === 3 && socialGain === 2.5);
  check('failed arrival clears occupancy instead of sticking', visits.state.phase === 'idle' && visits.canInvite());
  tickMinutes(visits, 30, 13, hooks);
  check('cleared fallback cannot apply twice', fallbackCalls === 1);
}

console.log('npc.test — serialize/restore round trip');
{
  const original = make();
  original.invite('amara', 1.25);
  tickMinutes(original, 5, 12); original.markEntered(); tickMinutes(original, 37, 13);
  original.adjustSocialMeter(0.1);
  const saved = original.serialize();
  const restored = make();
  restored.restore(saved);
  check('visit state round-trips exactly', JSON.stringify(restored.serialize()) === JSON.stringify(saved));
  tickMinutes(restored, 83, 14);
  check('restored duration continues from saved elapsed time', restored.state.phase === 'leaving');

  const bad = make();
  bad.restore({ ...saved, npcId: 'deleted_npc' });
  check('stale saved NPC degrades safely to idle', bad.canInvite() && bad.state.npcId === null);
}

console.log(`npc.test — ${checks} assertions passed`);
