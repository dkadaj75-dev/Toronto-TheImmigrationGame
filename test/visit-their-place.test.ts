// visit-their-place.test.ts — headless coverage for game/visit.ts (ROADMAP_SOCIAL.md §3 S6).
// Run: npx tsx test/visit-their-place.test.ts
//
// Style mirrors test/work.test.ts / test/social.test.ts: plain asserts, console summary, nonzero
// exit on failure.

import {
  canVisitTheirPlace,
  visitGate,
  visitGateReasonLabel,
  VisitAwayTracker,
  type VisitAwaySaveState,
} from '../game/visit';
import { compatibility, RelationshipState, visitOutcome, type SocialData } from '../game/social';
import type { NpcDef } from '../game/npc';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name} ${detail}`); }
}
function approx(a: number, b: number, eps = 1e-9): boolean { return Math.abs(a - b) <= eps; }

/** Mirrors test/social.test.ts's fixture shape (kept in sync deliberately — same data/social.json
 *  contract both suites exercise). */
function socialData(overrides: Partial<SocialData> = {}): SocialData {
  return {
    relationship: {
      min: -100, max: 100, start: 0, decayPerDay: 0.5,
      levels: [
        { id: 'enemy', atLeast: -100 },
        { id: 'disliked', atLeast: -40 },
        { id: 'acquaintance', atLeast: 0 },
        { id: 'friend', atLeast: 30 },
        { id: 'good_friend', atLeast: 60 },
        { id: 'beloved', atLeast: 85 },
      ],
    },
    compatibility: {
      traitWeights: { cleanliness: 0.5, intelligence: 1.0 },
      traitRange: 10,
      minMultiplier: 0.25, maxMultiplier: 1.75,
    },
    interactions: [],
    phone: {
      text: { durationSeconds: 10, needGains: { social: 1 }, relationshipGain: 1, cooldownMinutes: 60 },
      call: { durationSeconds: 45, needGains: { social: 2.5 }, relationshipGain: 2, cooldownMinutes: 120 },
    },
    visitTheirPlace: { awayHours: 4, needsRestored: { social: 60, fun: 30 }, relationshipGain: 8, minLevel: 'friend' },
    ...overrides,
  };
}

const amara: NpcDef = {
  id: 'amara', name: 'Amara', personality: { cleanliness: 5, intelligence: 5 },
  availableHours: { from: 9, to: 22 }, visitDurationHours: 3, arrivalDelayMinutes: 15,
  visitorActions: [],
};

const returnPoint = { pos: [1, 2] as [number, number], facingDeg: 45 };

// ---- visitGate / canVisitTheirPlace: minLevel + hours + exclusivity gating ------------------------
console.log('visit-their-place.test — minLevel gating (level ORDER, not raw score)');
{
  const d = socialData();
  const rel = new RelationshipState(d);
  const ctxBase = { hourNow: 12, relationships: rel, data: d, visitorBusy: false, playerAway: false };

  rel.set('amara', 0); // acquaintance (index 2) — below 'friend' (index 3)
  check('below minLevel is blocked', visitGate(amara, ctxBase) === 'below_min_level');
  check('canVisitTheirPlace mirrors visitGate below minLevel', !canVisitTheirPlace(amara, ctxBase));

  rel.set('amara', 30); // exactly 'friend' — inclusive atLeast bound
  check('at minLevel is allowed', visitGate(amara, ctxBase) === null);
  check('canVisitTheirPlace mirrors visitGate at minLevel', canVisitTheirPlace(amara, ctxBase));

  rel.set('amara', 62); // good_friend — above minLevel
  check('above minLevel is allowed', visitGate(amara, ctxBase) === null);

  // Unknown minLevel id degrades to "no lower bound" (levelAllows convention) rather than blocking
  // everyone — mirrors social.ts's own documented behavior for a stale/typo'd designer id.
  const dUnknownMin = socialData({ visitTheirPlace: { ...d.visitTheirPlace, minLevel: 'nonexistent_level' } });
  rel.set('amara', -90); // enemy — would fail any real bound, but the bound itself is unknown
  check('unknown minLevel id never blocks (levelAllows convention)',
    visitGate(amara, { ...ctxBase, data: dUnknownMin }) === null);
}

console.log('visit-their-place.test — availableHours gating');
{
  const d = socialData();
  const rel = new RelationshipState(d);
  rel.set('amara', 62); // well above minLevel so only hours matter
  check('inside available hours allowed', visitGate(amara, { hourNow: 10, relationships: rel, data: d, visitorBusy: false, playerAway: false }) === null);
  check('outside available hours blocked', visitGate(amara, { hourNow: 3, relationships: rel, data: d, visitorBusy: false, playerAway: false }) === 'outside_hours');
  check('exactly at the exclusive end hour is blocked', visitGate(amara, { hourNow: 22, relationships: rel, data: d, visitorBusy: false, playerAway: false }) === 'outside_hours');
}

console.log('visit-their-place.test — exclusivity: visitor present/pending, player already away');
{
  const d = socialData();
  const rel = new RelationshipState(d);
  rel.set('amara', 62);
  const ok = { hourNow: 12, relationships: rel, data: d, visitorBusy: false, playerAway: false };
  check('sanity: otherwise-allowed baseline passes', visitGate(amara, ok) === null);
  check('a guest present/pending blocks visiting', visitGate(amara, { ...ok, visitorBusy: true }) === 'visitor_present');
  check('already away (work or another visit) blocks visiting', visitGate(amara, { ...ok, playerAway: true }) === 'player_away');
  // playerAway is checked before visitorBusy/hours — most-restrictive-first, matches the module doc.
  check('playerAway short-circuits ahead of other reasons', visitGate(amara, { ...ok, playerAway: true, visitorBusy: true }) === 'player_away');
  check('every blocked reason has a human label', typeof visitGateReasonLabel('below_min_level') === 'string'
    && typeof visitGateReasonLabel('outside_hours') === 'string'
    && typeof visitGateReasonLabel('visitor_present') === 'string'
    && typeof visitGateReasonLabel('player_away') === 'string');
}

// ---- VisitAwayTracker: away-duration timing --------------------------------------------------------
console.log('visit-their-place.test — away duration timing (mirrors work.ts absolute-hour math)');
{
  const tracker = new VisitAwayTracker();
  check('not away before begin()', !tracker.isAway);
  check('begin() succeeds', tracker.begin('amara', { day: 1, hour: 10 }, 4, returnPoint));
  check('isAway true once begun', tracker.isAway);
  check('activeNpcId reflects the visited npc', tracker.activeNpcId === 'amara');
  check('a second begin() while away fails (exactly one visit at a time)', !tracker.begin('other', { day: 1, hour: 10 }, 4, returnPoint));

  check('no return before awayHours elapses', tracker.tick({ day: 1, hour: 13.999 }) === null);
  check('still away mid-window', tracker.isAway);
  const event = tracker.tick({ day: 1, hour: 14 }); // exactly awayHours later — inclusive, like decideWorkReturn
  check('returns exactly at the away deadline', event !== null && event.npcId === 'amara');
  check('return point matches what was passed to begin()', event !== null
    && event.returnPoint.pos[0] === 1 && event.returnPoint.pos[1] === 2 && event.returnPoint.facingDeg === 45);
  check('no longer away after the return fires', !tracker.isAway);
  check('tick after return is idempotent (no double-fire)', tracker.tick({ day: 1, hour: 20 }) === null);
}

console.log('visit-their-place.test — away duration crossing a day boundary');
{
  const tracker = new VisitAwayTracker();
  tracker.begin('amara', { day: 1, hour: 22 }, 4, returnPoint);
  check('not yet due before midnight rollover', tracker.tick({ day: 1, hour: 23.999 }) === null);
  const event = tracker.tick({ day: 2, hour: 2 });
  check('fires after crossing midnight at the right absolute hour', event !== null);
}

// ---- cancel-before-departure applies nothing -------------------------------------------------------
console.log('visit-their-place.test — cancel before departure applies nothing');
{
  // The tracker's contract is that begin() is the ONLY entry point that creates an away state; a
  // walk-to-door action interrupted before completion (main.ts's ordinary cancel path) simply never
  // calls begin() at all. There is therefore nothing to "undo" — verify the tracker itself never
  // reports away/returns anything when begin() was never invoked, which is the whole of what
  // "cancel applies nothing" means for this module.
  const tracker = new VisitAwayTracker();
  check('never began → never away', !tracker.isAway);
  check('never began → tick never returns an event', tracker.tick({ day: 1, hour: 999 }) === null);
}

// ---- completion applies visitOutcome exactly (hand-computed) ---------------------------------------
console.log('visit-their-place.test — completion applies visitOutcome exactly (level + compat scaling)');
{
  const d = socialData();
  const rel = new RelationshipState(d);
  rel.set('amara', 62); // good_friend, index 4 of 6 → levelFactor 5/6
  const playerTraits = { cleanliness: 5, intelligence: 5 };
  const compat = compatibility(playerTraits, amara.personality, d); // identical traits → multiplier 1.75 (max)
  check('sanity: perfect compat hits the max multiplier', approx(compat.multiplier, 1.75));

  const tracker = new VisitAwayTracker();
  tracker.begin('amara', { day: 1, hour: 10 }, d.visitTheirPlace.awayHours, returnPoint);
  const event = tracker.tick({ day: 1, hour: 10 + d.visitTheirPlace.awayHours });
  check('away fires at completion', event !== null);

  // Exactly main.ts's handleVisitReturn: recompute compat + visitOutcome fresh, apply on RETURN only.
  const outcome = visitOutcome(event!.npcId, rel, compat, d);
  const lf = 5 / 6;
  check('hand-computed levelFactor', approx(outcome.levelFactor, lf));
  check('hand-computed social restore = 60 · levelFactor · 1.75', approx(outcome.needsRestored.social, 60 * lf * 1.75));
  check('hand-computed fun restore = 30 · levelFactor · 1.75', approx(outcome.needsRestored.fun, 30 * lf * 1.75));
  check('hand-computed relationship delta = scaleGain(8,1.75)·levelFactor', approx(outcome.relationshipDelta, 8 * 1.75 * lf));

  const before = rel.get('amara');
  rel.set('amara', rel.get('amara') + outcome.relationshipDelta); // main.ts's exact apply line
  check('relationship score advances by exactly the computed delta', approx(rel.get('amara'), before + outcome.relationshipDelta));

  // Needs restored for an id the stats system doesn't recognize degrade gracefully: main.ts guards
  // with `stats.needs.get(needId) !== undefined` before writing, so an unknown id is simply skipped
  // rather than throwing. Simulate that guard here against a needs map missing 'fun'.
  const playerNeeds = new Map<string, number>([['social', 40]]);
  for (const [needId, delta] of Object.entries(outcome.needsRestored)) {
    const current = playerNeeds.get(needId);
    if (current !== undefined) playerNeeds.set(needId, Math.min(100, current + delta));
  }
  check('known need id (social) is restored', approx(playerNeeds.get('social')!, Math.min(100, 40 + outcome.needsRestored.social)));
  check('unknown need id (fun) never throws and is silently skipped', playerNeeds.get('fun') === undefined);
}

// ---- serialize / restore round-trip ------------------------------------------------------------
console.log('visit-their-place.test — serialize/restore round-trip');
{
  const tracker = new VisitAwayTracker();
  tracker.begin('amara', { day: 2, hour: 9 }, 5, returnPoint);
  const saved = tracker.serialize();
  check('serialize captures the active npc', saved.npcId === 'amara');
  check('serialize captures the computed end hour', saved.endAbsHour === 2 * 24 + 9 + 5);

  const restored = new VisitAwayTracker();
  restored.restore(saved);
  check('restore reproduces isAway', restored.isAway);
  check('restore reproduces activeNpcId', restored.activeNpcId === 'amara');
  check('restore reproduces the same return event at the same time', (() => {
    const event = restored.tick({ day: 2, hour: 14 });
    return event !== null && event.npcId === 'amara' && event.returnPoint.pos[0] === 1;
  })());

  // Serialized state must be a defensive copy — mutating the tracker after serialize() must not
  // reach back into the snapshot (matches WorkTracker's cloneActive contract).
  const tracker2 = new VisitAwayTracker();
  tracker2.begin('amara', { day: 1, hour: 1 }, 1, returnPoint);
  const snap = tracker2.serialize();
  tracker2.tick({ day: 1, hour: 2 }); // consumes the away state
  check('serialized snapshot is unaffected by later mutation', snap.npcId === 'amara' && snap.endAbsHour !== null);

  // Malformed/partial saved state degrades to idle rather than throwing (npc.ts's own restore
  // convention for a stale/corrupt save).
  const idleTracker = new VisitAwayTracker();
  idleTracker.restore({ npcId: 'amara', endAbsHour: null, returnPoint: null } as VisitAwaySaveState);
  check('malformed saved state (missing endAbsHour) restores to idle', !idleTracker.isAway);
  idleTracker.restore(null as unknown as VisitAwaySaveState);
  check('null saved state restores to idle without throwing', !idleTracker.isAway);
}

console.log(`\nvisit-their-place.test — ${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
