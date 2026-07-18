import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { BehaviorData } from '../game/data';
import type { NpcDef, NpcsData } from '../game/npc';
import type { EvalContext } from '../game/quests';
import { pickBest } from '../game/behavior';
import { PhoneState, RelationshipState, type SocialData } from '../game/social';
import {
  contactViews,
  PhoneContactSession,
  phoneAutonomyCandidates,
} from '../game/contacts';

let assertions = 0;
function check(label: string, condition: unknown): void {
  assertions++;
  assert.ok(condition, label);
}
const approx = (a: number, b: number) => Math.abs(a - b) < 1e-9;

const social = JSON.parse(readFileSync('data/social.json', 'utf8')) as SocialData;
const npcs = JSON.parse(readFileSync('data/npcs.json', 'utf8')) as NpcsData;
const behavior = JSON.parse(readFileSync('data/behavior.json', 'utf8')) as BehaviorData;
const amara = npcs.npcs[0];

console.log('contacts.test — authored listing and relationship view');
{
  const relationships = new RelationshipState(social);
  const phone = new PhoneState(social);
  relationships.set(amara.id, 40);
  const rows = contactViews(npcs.npcs, {
    relationships, phone, data: social, nowMinutes: 0, hourNow: 12,
    canInvite: true, activeAction: null, playerAway: false,
  });
  check('listing contains every authored NPC', rows.length === npcs.npcs.length);
  check('listing preserves NPC id, name, and portrait', rows[0].npcId === amara.id && rows[0].name === amara.name && rows[0].portrait === amara.portrait);
  check('level label derives from the shared relationship store', rows[0].levelId === 'friend' && rows[0].levelLabel === 'Friend');
  check('score bar normalizes relationship min..max', approx(rows[0].scoreFraction, 0.7));
}

console.log('contacts.test — invite and availability gating');
{
  const relationships = new RelationshipState(social);
  const phone = new PhoneState(social);
  const overnight: NpcDef = { ...amara, availableHours: { from: 22, to: 6 } };
  const viewAt = (hourNow: number, canInvite: boolean, playerAway = false) => contactViews([overnight], {
    relationships, phone, data: social, nowMinutes: 0, hourNow, canInvite, activeAction: null, playerAway,
  })[0];
  check('cross-midnight availability includes late evening', viewAt(23, true).inviteEnabled);
  check('cross-midnight availability includes early morning', viewAt(5, true).inviteEnabled);
  check('cross-midnight availability excludes daytime', !viewAt(12, true).inviteEnabled && viewAt(12, true).inviteDisabledReason === 'Outside available hours');
  check('canInvite false communicates visitor occupancy', !viewAt(23, false).inviteEnabled && viewAt(23, false).inviteDisabledReason === 'Visitor already present');
}

console.log('contacts.test — S6 visit gating (minLevel, hours, visitor busy, player away)');
{
  const relationships = new RelationshipState(social);
  const phone = new PhoneState(social);
  const overnight: NpcDef = { ...amara, availableHours: { from: 22, to: 6 } };
  const viewAt = (hourNow: number, canInvite: boolean, playerAway = false) => contactViews([overnight], {
    relationships, phone, data: social, nowMinutes: 0, hourNow, canInvite, activeAction: null, playerAway,
  })[0];

  const minIdx = social.relationship.levels.findIndex((l) => l.id === social.visitTheirPlace.minLevel);
  const belowLevel = minIdx > 0 ? social.relationship.levels[minIdx - 1].atLeast : social.relationship.min;
  const atLevel = social.relationship.levels[minIdx]?.atLeast ?? social.relationship.start;

  relationships.set(amara.id, belowLevel);
  check('below the authored minLevel, visit is disabled', !viewAt(23, true).visitEnabled);
  check('below-minLevel reason is surfaced', typeof viewAt(23, true).visitDisabledReason === 'string' && viewAt(23, true).visitDisabledReason !== null);

  relationships.set(amara.id, atLevel);
  check('at the authored minLevel, visit is enabled (within hours, no guest, not away)', viewAt(23, true).visitEnabled);
  check('outside available hours disables visit even at a high enough level', !viewAt(12, true).visitEnabled && viewAt(12, true).visitDisabledReason === 'Outside available hours');
  check('a guest present/pending disables visit', !viewAt(23, false).visitEnabled && viewAt(23, false).visitDisabledReason === 'Visitor already present');
  check('player already away (at work or mid-visit) disables visit', !viewAt(23, true, true).visitEnabled);
}

function makeSession() {
  const relationships = new RelationshipState(social);
  const phone = new PhoneState(social);
  const needs = new Map([['social', 10]]);
  const session = new PhoneContactSession(relationships, phone, () => social, {
    applyPlayerNeed: (id, delta) => {
      const current = needs.get(id);
      if (current !== undefined) needs.set(id, Math.max(0, Math.min(100, current + delta)));
    },
  });
  return { relationships, phone, needs, session };
}

console.log('contacts.test — timed completion, compatibility, cooldown, and cancel');
{
  const h = makeSession();
  const order = h.session.begin(amara, 'call', amara.personality, 12, 100);
  check('ready in-hours call begins with authored duration', order?.action.duration?.baseSeconds === social.phone.call.durationSeconds);
  check('begin applies no need, relationship, or cooldown effect', h.needs.get('social') === 10 && h.relationships.get(amara.id) === social.relationship.start && h.phone.isReady(amara.id, 'call', 100));
  check('completion reports success', h.session.finish(true, 100));
  check('completion applies authored need gain', h.needs.get('social') === 10 + social.phone.call.needGains.social);
  check('perfect compatibility scales relationship through applyGain', approx(h.relationships.get(amara.id), social.phone.call.relationshipGain * social.compatibility.maxMultiplier));
  check('completion marks the per-NPC channel cooldown', !h.phone.isReady(amara.id, 'call', 100) && approx(h.phone.remainingCooldown(amara.id, 'call', 100), social.phone.call.cooldownMinutes));
  const coolingView = contactViews([amara], {
    relationships: h.relationships, phone: h.phone, data: social, nowMinutes: 101, hourNow: 12,
    canInvite: true, activeAction: null, playerAway: false,
  })[0];
  check('cooldown view shows remaining sim time', !coolingView.call.enabled && coolingView.call.disabledReason?.startsWith('Ready in '));
  check('cooldown blocks a new call', h.session.begin(amara, 'call', amara.personality, 12, 101) === null);

  const cancelled = makeSession();
  cancelled.session.begin(amara, 'text', amara.personality, 12, 50);
  check('cancel reports no completion', !cancelled.session.finish(false, 50));
  check('cancel applies nothing', cancelled.needs.get('social') === 10 && cancelled.relationships.get(amara.id) === 0 && cancelled.phone.isReady(amara.id, 'text', 50));
  const outside = makeSession();
  check('outside available hours blocks phone action', outside.session.begin(amara, 'text', amara.personality, 23, 50) === null);

  const missingNeed = new Map<string, number>();
  const missingRelationships = new RelationshipState(social);
  const missingPhone = new PhoneState(social);
  const graceful = new PhoneContactSession(missingRelationships, missingPhone, () => social, {
    applyPlayerNeed: (id, delta) => {
      const current = missingNeed.get(id);
      if (current !== undefined) missingNeed.set(id, current + delta);
    },
  });
  graceful.begin(amara, 'text', amara.personality, 12, 10);
  graceful.finish(true, 10);
  check('missing social need is a no-op while relationship/cooldown still complete',
    !missingNeed.has('social') && missingRelationships.get(amara.id) > 0 && !missingPhone.isReady(amara.id, 'text', 10));
}

function evalContext(socialNeed: number): EvalContext {
  return {
    needs: { social: socialNeed }, skills: {}, personality: {}, funds: 0,
    time: { hour: 12, day: 1 }, vars: {}, quests: {},
  };
}

console.log('contacts.test — autonomy eligibility and shared behavior scorer');
{
  const phone = new PhoneState(social);
  const candidates = (socialNeed: number, selectedBehavior = behavior, visitorBusy = false) => phoneAutonomyCandidates(npcs.npcs, {
    phone, data: social, behavior: selectedBehavior, eval: evalContext(socialNeed),
    nowMinutes: 100, hourNow: 12, visitorBusy, canInvite: true, actionBusy: false,
  });
  const low = candidates(10);
  check('low social with no visitor emits rule-enabled phone candidates', low.some((candidate) => candidate.kind === 'text') && low.some((candidate) => candidate.kind === 'call'));
  check('high social emits no phone candidates', candidates(80).length === 0);
  check('missing social need degrades to no autonomy candidate', phoneAutonomyCandidates(npcs.npcs, {
    phone, data: social, behavior, eval: { ...evalContext(0), needs: {} },
    nowMinutes: 100, hourNow: 12, visitorBusy: false, canInvite: true, actionBusy: false,
  }).length === 0);
  check('visitor presence suppresses all phone autonomy', candidates(10, behavior, true).length === 0);
  const disabled: BehaviorData = {
    ...behavior,
    rules: behavior.rules.map((rule) => rule.action?.startsWith('phone_') ? { ...rule, enabled: false } : rule),
  };
  check('disabling the authored phone rules disables phone autonomy', candidates(10, disabled).length === 0);
  const ranked = pickBest(low.map((candidate) => ({
    asset: candidate.target, action: candidate.action, distance: 0, value: candidate,
  })), { behavior, eval: evalContext(10) });
  check('phone candidates are selected by the existing behavior scorer', ranked?.candidate.value?.kind === 'text');
}

console.log(`contacts.test — ${assertions} assertions passed`);
