import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { NpcDef } from '../game/npc';
import type { TuningData } from '../game/data';
import type { NavGrid } from '../game/nav';
import { SimAgent } from '../game/sim';
import {
  availableSocialInteractions,
  matchesSocialTarget,
  pairedAssetPositions,
  SocialInteractionSession,
  socialAnimationFor,
  socialAutonomyCandidates,
  socialNpcActionDef,
  socialRoutingDecision,
  socialSoundDecision,
} from '../game/social-interactions';
import { RelationshipState, type InteractionDef, type SocialData } from '../game/social';
import { SocialRuntime } from '../game/socialruntime';

let assertions = 0;
function check(label: string, condition: unknown): void {
  assertions++;
  assert.ok(condition, label);
}
const approx = (a: number, b: number) => Math.abs(a - b) < 1e-9;

const chat: InteractionDef = {
  id: 'chat', name: 'Chat', animation: 'stand_talk', durationSeconds: 20,
  needGains: { social: 3, deleted_need: 9 }, relationshipGain: 4,
  requiresLevelAtLeast: 'acquaintance', autonomyEligible: true,
};
const argue: InteractionDef = {
  id: 'argue', name: 'Argue', animation: 'stand_talk', durationSeconds: 20,
  needGains: { social: 1 }, relationshipGain: -6,
  requiresLevelAtMost: 'acquaintance', autonomyEligible: false,
};
const askLeave: InteractionDef = {
  id: 'ask_to_leave', name: 'Ask to Leave', animation: 'stand_talk', durationSeconds: 8,
  needGains: {}, relationshipGain: 0, special: 'endVisit',
  // Deliberately impossible at enemy: the engine special must still remain visible.
  requiresLevelAtLeast: 'beloved', autonomyEligible: false,
};
const cuddle: InteractionDef = {
  id: 'cuddle', name: 'Cuddle', animation: 'lie_idle', playerAnimation: 'lie_player', npcAnimation: 'lie_npc',
  targetAsset: 'beds', sound: '/sounds/cuddle.wav', durationSeconds: 30,
  needGains: { social: 5 }, relationshipGain: 6, requiresLevelAtLeast: 'beloved', censor: true,
};
const social: SocialData = {
  relationship: {
    min: -100, max: 100, start: 0, decayPerDay: 0.5,
    levels: [
      { id: 'enemy', atLeast: -100 }, { id: 'disliked', atLeast: -40 },
      { id: 'acquaintance', atLeast: 0 }, { id: 'friend', atLeast: 30 },
      { id: 'beloved', atLeast: 85 },
    ],
  },
  compatibility: {
    traitWeights: { cleanliness: 1 }, traitRange: 10,
    minMultiplier: 0.25, maxMultiplier: 1.75,
  },
  interactions: [chat, argue, askLeave],
  phone: {
    text: { durationSeconds: 10, needGains: { social: 1 }, relationshipGain: 1, cooldownMinutes: 60 },
    call: { durationSeconds: 45, needGains: { social: 2 }, relationshipGain: 2, cooldownMinutes: 120 },
  },
  visitTheirPlace: { awayHours: 4, needsRestored: {}, relationshipGain: 8, minLevel: 'friend' },
};
const amara: NpcDef = {
  id: 'amara', name: 'Amara', mesh: '', tint: '#fff', personality: { cleanliness: 7 },
  availableHours: { from: 10, to: 22 }, visitDurationHours: 3, arrivalDelayMinutes: 30,
  visitorActions: [],
};

console.log('social-interactions.test — current-level contextual menu');
{
  const relationships = new RelationshipState(social);
  relationships.set('amara', -50);
  check('disliked menu contains argue', availableSocialInteractions('amara', relationships, social).some((x) => x.id === 'argue'));
  check('disliked menu hides chat', !availableSocialInteractions('amara', relationships, social).some((x) => x.id === 'chat'));
  check('ask_to_leave ignores an authored level gate', availableSocialInteractions('amara', relationships, social).some((x) => x.id === 'ask_to_leave'));
  relationships.set('amara', 40);
  check('friend menu contains chat after score changes', availableSocialInteractions('amara', relationships, social).some((x) => x.id === 'chat'));
  check('friend menu hides argue after score changes', !availableSocialInteractions('amara', relationships, social).some((x) => x.id === 'argue'));
}

console.log('social-interactions.test - paired routing, roles, bed halves, and sound decisions');
{
  const bed = { id: 'bed', category: 'beds' };
  check('targetAsset category selects a paired live asset', matchesSocialTarget(cuddle, bed));
  check('unrelated asset is rejected', !matchesSocialTarget(cuddle, { id: 'sofa', category: 'seating' }));
  const route = socialRoutingDecision(cuddle, bed);
  check('paired bed decision routes both and forces the shared lie pose machinery', route.paired && route.matches && route.pose === 'lie');
  check('per-role animation overrides win', socialAnimationFor(cuddle, 'player') === 'lie_player' && socialAnimationFor(cuddle, 'npc') === 'lie_npc');
  check('blank/missing role override sparsely falls back to base', socialAnimationFor({ id: 'wave', animation: 'stand_wave' }, 'npc') === 'stand_wave');
  check('NPC adapter uses NPC clip and never starts a second audio loop', socialNpcActionDef(cuddle).animation === 'lie_npc' && socialNpcActionDef(cuddle).sound === undefined);
  const halves = pairedAssetPositions([10, 20], 0, [2, 3]);
  check('double bed positions use stable opposite local-X halves', halves.player[0] === 9.5 && halves.npc[0] === 10.5 && halves.player[1] === 20 && halves.npc[1] === 20);
  check('sound starts only on start decision', socialSoundDecision(cuddle, 'start').startPath === '/sounds/cuddle.wav' && !socialSoundDecision(cuddle, 'start').stop);
  check('sound stops on every terminal decision', socialSoundDecision(cuddle, 'stop').stop && socialSoundDecision({ id: 'silent' }, 'stop').stop === false);
}

function harness() {
  const relationships = new RelationshipState(social);
  const needs = new Map([['social', 20]]);
  let meter = 0.5;
  let endVisits = 0;
  let npcStops = 0;
  const pauses: boolean[] = [];
  const session = new SocialInteractionSession(relationships, () => social, {
    setNpcAutonomyPaused: (paused) => pauses.push(paused),
    stopNpcAction: () => { npcStops++; },
    applyPlayerNeed: (id, delta) => {
      const current = needs.get(id);
      if (current !== undefined) needs.set(id, Math.min(100, Math.max(0, current + delta)));
    },
    adjustNpcMeter: (delta) => { meter += delta; },
    endVisit: (completed) => { if (completed) endVisits++; },
  });
  return { relationships, needs, session, pauses, get meter() { return meter; }, get endVisits() { return endVisits; }, get npcStops() { return npcStops; } };
}

console.log('social-interactions.test — atomic completion and cancellation');
{
  const h = harness();
  h.session.begin(amara, chat, { cleanliness: 7 }); // perfect match => 1.75 multiplier
  check('begin pauses NPC autonomy', h.pauses.join(',') === 'true');
  check('no side effects occur at begin', h.needs.get('social') === 20 && h.relationships.get('amara') === 0 && h.meter === 0.5);
  check('completed interaction reports completion', h.session.finish(true));
  check('completion applies known player need only and ignores a deleted need', h.needs.get('social') === 23 && !h.needs.has('deleted_need'));
  check('completion mirrors social gain to normalized NPC meter', approx(h.meter, 0.53));
  check('completion applies compatibility-scaled relationship gain', approx(h.relationships.get('amara'), 7));
  check('completion stops NPC action and resumes autonomy', h.npcStops === 1 && h.pauses.join(',') === 'true,false');

  const cancelled = harness();
  cancelled.session.begin(amara, chat, { cleanliness: 7 });
  check('cancel reports no completion', !cancelled.session.finish(false));
  check('cancel applies no needs, meter, relationship, or visit effect',
    cancelled.needs.get('social') === 20 && cancelled.meter === 0.5
      && cancelled.relationships.get('amara') === 0 && cancelled.endVisits === 0);
  check('cancel cleans NPC action and autonomy state', cancelled.npcStops === 1 && cancelled.pauses.join(',') === 'true,false' && cancelled.session.active === null);
}

console.log('social-interactions.test — ask-to-leave completion seam');
{
  const h = harness();
  h.session.begin(amara, askLeave, { cleanliness: 7 });
  h.session.finish(false);
  check('cancelled ask_to_leave does not end visit', h.endVisits === 0);
  h.session.begin(amara, askLeave, { cleanliness: 7 });
  h.session.finish(true);
  check('completed ask_to_leave ends visit exactly once', h.endVisits === 1);
}

console.log('social-interactions.test — queued interruption leaves both agents idle/clean');
{
  const h = harness();
  const grid: NavGrid = { cols: 5, rows: 5, cellSize: 0.5, walkable: new Uint8Array(25).fill(1) };
  const tuning = {
    movement: { walkSpeed: 1, arrivalRadius: 0.1 },
    interaction: { useSpotClearance: 0.4, seatViewDistance: 2.5 },
  } as TuningData;
  const player = new THREE.Group(); player.position.set(0.25, 0, 0.25);
  const visitor = new THREE.Group(); visitor.position.set(1.25, 0, 0.25); visitor.userData.npcId = 'amara';
  const agent = new SimAgent(player, grid, tuning);
  const order = h.session.begin(amara, chat, { cleanliness: 7 });
  agent.onActionStop = (active, completed) => {
    if (h.session.active?.action === active.action) {
      h.session.finish(completed);
      if (!completed) agent.halt();
    }
  };
  check('social order queues through the ordinary SimAgent target flow', agent.orderAction(order.action, visitor));
  check('queued approach is busy before interruption', agent.isBusy && agent.pendingActionId === 'chat');
  agent.stopAction(false);
  check('queued cancel applies no relationship effect', h.relationships.get('amara') === 0);
  check('queued cancel leaves player idle', !agent.isBusy && agent.pendingActionId === null);
  check('queued cancel stops NPC presentation and resumes autonomy', h.npcStops === 1 && h.pauses.join(',') === 'true,false');
}

console.log('social-interactions.test - paired cancel cleans both SimAgents and applies nothing');
{
  const relationships = new RelationshipState(social);
  const grid: NavGrid = { cols: 5, rows: 5, cellSize: 0.5, walkable: new Uint8Array(25).fill(1) };
  const tuning = { movement: { walkSpeed: 1, arrivalRadius: 0.1 }, interaction: { useSpotClearance: 0.4 } } as TuningData;
  const playerRoot = new THREE.Group(); playerRoot.position.set(0.25, 0, 0.25);
  const npcRoot = new THREE.Group(); npcRoot.position.set(1.25, 0, 0.25);
  const target = new THREE.Group(); target.position.set(1.25, 0, 1.25); target.userData.assetId = 'bed';
  const playerAgent = new SimAgent(playerRoot, grid, tuning);
  const npcAgent = new SimAgent(npcRoot, grid, tuning);
  let session!: SocialInteractionSession;
  session = new SocialInteractionSession(relationships, () => social, {
    setNpcAutonomyPaused: () => {},
    stopNpcAction: () => { npcAgent.stopAction(false); npcAgent.halt(); },
    applyPlayerNeed: () => {}, adjustNpcMeter: () => {}, endVisit: () => {},
  });
  const order = session.begin(amara, cuddle, { cleanliness: 7 });
  const npcAction = socialNpcActionDef(cuddle);
  playerAgent.onActionStop = (_active, completed) => { session.finish(completed); if (!completed) playerAgent.halt(); };
  check('both paired routes queue through ordinary agents', playerAgent.orderAction(order.action, target) && npcAgent.orderAction(npcAction, target));
  playerAgent.stopAction(false);
  check('paired cancel leaves both agents idle and clears the shared session', !playerAgent.isBusy && !npcAgent.isBusy && session.active === null);
  check('paired cancel applies no relationship effect', relationships.get('amara') === 0);
}

console.log('social-interactions.test — autonomy candidate generation');
{
  const relationships = new RelationshipState(social);
  check('no visitor produces no social autonomy candidates', socialAutonomyCandidates(null, relationships, social).length === 0);
  const present = socialAutonomyCandidates(amara, relationships, social);
  check('present visitor includes eligible chat', present.length === 1 && present[0].interaction.id === 'chat');
  check('social action keeps needGains for the shared behavior scorer', present[0].action.needGains.social === 3);
  relationships.set('amara', -50);
  check('current level can gate away all eligible social candidates', socialAutonomyCandidates(amara, relationships, social).length === 0);
}

console.log('social-interactions.test — shared runtime persistence');
{
  const runtime = new SocialRuntime(social);
  runtime.relationships.set('amara', 33);
  runtime.phone.markUsed('amara', 'text', 120);
  const restored = new SocialRuntime(social);
  restored.restore(runtime.serialize());
  check('relationship and phone state serialize/restore together',
    restored.relationships.get('amara') === 33 && restored.phone.remainingCooldown('amara', 'text', 130) === 50);
}

console.log(`social-interactions.test — ${assertions} assertions passed`);
