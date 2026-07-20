// social.test.ts — headless tests for the pure social core (ROADMAP_SOCIAL §3 S1).
// Run: npx tsx test/social.test.ts
//
// Style mirrors test/quests.test.ts: plain asserts, console summary, nonzero exit on failure.

import {
  compatibility,
  scaleGain,
  levelFor,
  levelIndex,
  levelAllows,
  phoneGain,
  visitOutcome,
  resolveVisitDurationHours,
  RelationshipState,
  PhoneState,
  type SocialData,
  type InteractionDef,
} from '../game/social';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name} ${detail}`); }
}

function approx(a: number, b: number, eps = 1e-9): boolean { return Math.abs(a - b) <= eps; }

/** A self-contained SocialData fixture mirroring the shipped data/social.json shape. */
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
    interactions: [
      { id: 'chat', relationshipGain: 4, requiresLevelAtLeast: 'acquaintance', requiresLevelAtMost: null },
      { id: 'argue', relationshipGain: -6, requiresLevelAtLeast: null, requiresLevelAtMost: 'acquaintance' },
      { id: 'ask_to_leave', special: 'endVisit', requiresLevelAtLeast: null, requiresLevelAtMost: null },
    ],
    phone: {
      text: { durationSeconds: 10, needGains: { social: 1 }, relationshipGain: 1, cooldownMinutes: 60 },
      call: { durationSeconds: 45, needGains: { social: 2.5 }, relationshipGain: 2, cooldownMinutes: 120 },
    },
    visitTheirPlace: { awayHours: 4, needsRestored: { social: 60, fun: 30 }, relationshipGain: 8, minLevel: 'friend' },
    ...overrides,
  };
}

console.log('social.test - relationship-scaled visit duration');
{
  const curved = socialData({ visitDuration: { byLevel: { enemy: 0.25, beloved: 2 } } });
  check('enemy multiplier scales the NPC base', approx(resolveVisitDurationHours(8, 'enemy', curved), 2));
  check('beloved multiplier scales the NPC base', approx(resolveVisitDurationHours(8, 'beloved', curved), 16));
  check('absent level entry is sparse x1', approx(resolveVisitDurationHours(8, 'friend', curved), 8));
  check('absent curve is sparse x1', approx(resolveVisitDurationHours(8, 'enemy', socialData()), 8));
  check('invalid multiplier safely falls back to x1', approx(resolveVisitDurationHours(8, 'enemy', socialData({ visitDuration: { byLevel: { enemy: Number.NaN } } })), 8));
}

// ---- compatibility: symmetry ----------------------------------------------------------------------
console.log('social.test — compatibility symmetry + formula');
{
  const d = socialData();
  const A = { cleanliness: 7, intelligence: 6 };
  const B = { cleanliness: 3, intelligence: 9 };
  const ab = compatibility(A, B, d);
  const ba = compatibility(B, A, d);
  check('compatibility symmetric: score', approx(ab.score, ba.score));
  check('compatibility symmetric: multiplier', approx(ab.multiplier, ba.multiplier));

  // hand-computed: weights {0.5,1.0} sum 1.5; diffs |7-3|=4, |6-9|=3; weightedDiff = (0.5*4 + 1.0*3)/10 = 0.5
  // score = 1 - 0.5/1.5 = 1 - 0.3333.. = 0.66666..
  check('compatibility formula matches hand calc', approx(ab.score, 1 - (0.5 * 4 + 1.0 * 3) / 10 / 1.5));

  // identical traits → score 1 → multiplier at the max bound
  const same = compatibility(A, { ...A }, d);
  check('identical traits → score 1', approx(same.score, 1));
  check('identical traits → multiplier == maxMultiplier', approx(same.multiplier, 1.75));

  // no overlapping weighted traits → score 1 (nothing to disagree on), never throws
  const none = compatibility({ someOtherTrait: 5 }, { anotherTrait: 2 }, d);
  check('no overlapping weighted traits → score 1', approx(none.score, 1));

  // a trait present in only one sim is skipped (not assumed 0): here only cleanliness overlaps
  const partial = compatibility({ cleanliness: 5, intelligence: 8 }, { cleanliness: 5 }, d);
  check('non-overlapping trait skipped → perfect on the shared trait', approx(partial.score, 1));
}

// ---- compatibility: multiplier clamping at both ends ----------------------------------------------
console.log('social.test — multiplier clamping (both ends)');
{
  // Upper end: a perfect match maps exactly to maxMultiplier and never exceeds it.
  const dHi = socialData();
  const hi = compatibility({ cleanliness: 5, intelligence: 5 }, { cleanliness: 5, intelligence: 5 }, dHi);
  check('upper end: perfect match clamps to maxMultiplier', approx(hi.multiplier, 1.75));
  check('upper end: multiplier never exceeds maxMultiplier', hi.multiplier <= 1.75 + 1e-12);

  // Lower end: shrink traitRange so a max-difference pair drives the RAW score below 0; the raw
  // multiplier would go under minMultiplier and must be clamped UP to it (clamp genuinely fires).
  const dLo = socialData({
    compatibility: { traitWeights: { intelligence: 1 }, traitRange: 5, minMultiplier: 0.25, maxMultiplier: 1.75 },
  });
  const lo = compatibility({ intelligence: 10 }, { intelligence: 0 }, dLo);
  // score = 1 - (1*10/5)/1 = 1 - 2 = -1; raw mult = 0.25 + (-1)*1.5 = -1.25 → clamps to 0.25
  check('lower end: raw score below 0', lo.score < 0);
  check('lower end: multiplier clamps up to minMultiplier', approx(lo.multiplier, 0.25));
  check('lower end: multiplier never below minMultiplier', lo.multiplier >= 0.25 - 1e-12);
}

// ---- level thresholds: inclusive edges, highest matching wins -------------------------------------
console.log('social.test — levelFor thresholds (inclusive edges, highest wins)');
{
  const d = socialData();
  check('score exactly at atLeast is INCLUSIVE (0 → acquaintance)', levelFor(0, d) === 'acquaintance');
  check('just below a threshold falls to the lower level (-1 → disliked)', levelFor(-1, d) === 'disliked');
  check('exact friend edge (30 → friend)', levelFor(30, d) === 'friend');
  check('just below friend (29 → acquaintance)', levelFor(29, d) === 'acquaintance');
  check('exact top edge (85 → beloved)', levelFor(85, d) === 'beloved');
  check('above top stays top (100 → beloved)', levelFor(100, d) === 'beloved');
  check('bottom edge (-100 → enemy)', levelFor(-100, d) === 'enemy');
  check('mid band (60 → good_friend)', levelFor(60, d) === 'good_friend');
  check('mid band (59 → friend)', levelFor(59, d) === 'friend');
  // highest matching wins even if the array were unordered — build a scrambled copy
  const scrambled = socialData({ relationship: { ...d.relationship, levels: [...d.relationship.levels].reverse() } });
  check('highest matching wins regardless of array order', levelFor(45, scrambled) === 'friend');
}

// ---- gating by min/max level incl. nulls ---------------------------------------------------------
console.log('social.test — levelAllows gating (min/max, nulls, order-based)');
{
  const d = socialData();
  const chat = d.interactions[0];   // requiresLevelAtLeast: acquaintance
  const argue = d.interactions[1];  // requiresLevelAtMost: acquaintance
  const askLeave = d.interactions[2]; // both null → unrestricted

  check('chat blocked below acquaintance (disliked)', levelAllows(chat, 'disliked', d) === false);
  check('chat allowed AT acquaintance (inclusive)', levelAllows(chat, 'acquaintance', d) === true);
  check('chat allowed above acquaintance (friend)', levelAllows(chat, 'friend', d) === true);

  check('argue allowed at/below acquaintance', levelAllows(argue, 'acquaintance', d) === true);
  check('argue allowed at enemy (below)', levelAllows(argue, 'enemy', d) === true);
  check('argue blocked above acquaintance (friend)', levelAllows(argue, 'friend', d) === false);

  check('both-null interaction always allowed (beloved)', levelAllows(askLeave, 'beloved', d) === true);
  check('both-null interaction always allowed (enemy)', levelAllows(askLeave, 'enemy', d) === true);

  // a bound referencing an unknown level id is treated as absent (never throws)
  const bogusLo: InteractionDef = { id: 'x', requiresLevelAtLeast: 'nonexistent', requiresLevelAtMost: null };
  check('unknown requiresLevelAtLeast id → treated as no lower bound', levelAllows(bogusLo, 'enemy', d) === true);
  const bogusHi: InteractionDef = { id: 'y', requiresLevelAtLeast: null, requiresLevelAtMost: 'nonexistent' };
  check('unknown requiresLevelAtMost id → treated as no upper bound', levelAllows(bogusHi, 'beloved', d) === true);

  // an unknown CURRENT level ranks below everything: lower bound blocks, upper bound allows
  check('unknown current level blocked by a lower bound', levelAllows(chat, 'ghost', d) === false);
  check('unknown current level allowed by an upper bound', levelAllows(argue, 'ghost', d) === true);

  // levelIndex sanity
  check('levelIndex ordering', levelIndex('enemy', d) === 0 && levelIndex('beloved', d) === 5);
  check('levelIndex unknown → -1', levelIndex('nope', d) === -1 && levelIndex(null, d) === -1);
}

// ---- decay drifts toward 0 from both signs, no overshoot -----------------------------------------
console.log('social.test — decay toward 0 (both signs, no overshoot, disable)');
{
  const d = socialData(); // decayPerDay 0.5
  const rel = new RelationshipState(d);
  rel.set('pos', 20);
  rel.set('neg', -20);
  rel.decay(10); // 0.5 * 10 = 5 drift
  check('positive score drifts down toward 0', approx(rel.get('pos'), 15));
  check('negative score drifts up toward 0', approx(rel.get('neg'), -15));

  // overshoot guard: large span cannot cross 0 from either sign
  rel.set('pos', 3);
  rel.set('neg', -3);
  rel.decay(100); // drift 50 >> 3
  check('positive does not overshoot past 0', rel.get('pos') === 0);
  check('negative does not overshoot past 0', rel.get('neg') === 0);

  // exact-to-zero lands on 0, not negative
  const rel2 = new RelationshipState(d);
  rel2.set('a', 5);
  rel2.decay(10); // drift exactly 5
  check('exact drift lands on 0', rel2.get('a') === 0);

  // decayPerDay 0 disables decay
  const noDecay = new RelationshipState(socialData({ relationship: { ...d.relationship, decayPerDay: 0 } }));
  noDecay.set('a', 42);
  noDecay.decay(1000);
  check('decayPerDay 0 disables decay', noDecay.get('a') === 42);

  // fractional days
  const rel3 = new RelationshipState(d);
  rel3.set('a', 10);
  rel3.decay(0.5); // 0.5 * 0.5 = 0.25
  check('fractional sim-days decay', approx(rel3.get('a'), 9.75));
}

// ---- applyGain: positive scaling + negative cutting deeper on bad matches -------------------------
console.log('social.test — applyGain + scaleGain asymmetry (bad match cuts deeper)');
{
  const d = socialData();
  // scaleGain positive: good match (mult 1.75) gains more than bad match (mult 0.25)
  check('positive gain: good match gains more', approx(scaleGain(4, 1.75, d), 7));
  check('positive gain: bad match gains less', approx(scaleGain(4, 0.25, d), 1));

  // scaleGain negative: reflection (min+max - mult) = 2 - mult → bad match cuts DEEPER
  // argue -6, bad match mult 0.25 → reflected 1.75 → -10.5 ; good match mult 1.75 → reflected 0.25 → -1.5
  const badArgue = scaleGain(-6, 0.25, d);
  const goodArgue = scaleGain(-6, 1.75, d);
  check('negative gain: bad match cuts deeper than good match', badArgue < goodArgue);
  check('negative gain: bad-match argue == -10.5', approx(badArgue, -10.5));
  check('negative gain: good-match argue == -1.5', approx(goodArgue, -1.5));
  check('zero base gain → 0', scaleGain(0, 1.75, d) === 0);

  // through RelationshipState.applyGain with clamping
  const rel = new RelationshipState(d);
  const after = rel.applyGain('amara', 4, 1.75); // +7
  check('applyGain returns clamped new score', approx(after, 7));
  check('applyGain stored the score', approx(rel.get('amara'), 7));

  // clamp at max
  rel.set('amara', 98);
  rel.applyGain('amara', 4, 1.75); // +7 → 105 clamps to 100
  check('applyGain clamps to relationship.max', rel.get('amara') === 100);

  // clamp at min with a deep negative on a bad match
  rel.set('amara', -96);
  rel.applyGain('amara', -6, 0.25); // -10.5 → -106.5 clamps to -100
  check('applyGain clamps to relationship.min', rel.get('amara') === -100);

  // levelFor via state
  rel.set('amara', 62);
  check('RelationshipState.levelFor resolves via score', rel.levelFor('amara') === 'good_friend');
  check('unset NPC reads start score → its level', new RelationshipState(d).levelFor('stranger') === 'acquaintance');
}

// ---- phone cooldown windows ----------------------------------------------------------------------
console.log('social.test — phone cooldown windows + gain');
{
  const d = socialData();
  const phone = new PhoneState(d);
  check('ready before any use', phone.isReady('amara', 'text', 0) === true);
  check('remaining cooldown is 0 when never used', phone.remainingCooldown('amara', 'text', 0) === 0);

  phone.markUsed('amara', 'text', 100); // text cooldown 60 min
  check('blocked immediately after use', phone.isReady('amara', 'text', 100) === false);
  check('blocked inside the window (100→140, <60 elapsed)', phone.isReady('amara', 'text', 140) === false);
  check('remaining cooldown inside window', phone.remainingCooldown('amara', 'text', 130) === 30);
  check('blocked at the last minute before expiry (159)', phone.isReady('amara', 'text', 159) === false);
  check('ready exactly at the window edge (160, 60 elapsed)', phone.isReady('amara', 'text', 160) === true);
  check('ready after the window (200)', phone.isReady('amara', 'text', 200) === true);

  // channels are independent; call cooldown 120
  check('call still ready while text is cooling', phone.isReady('amara', 'call', 100) === true);
  phone.markUsed('amara', 'call', 100);
  check('call blocked at 200 (100 elapsed < 120)', phone.isReady('amara', 'call', 200) === false);
  check('call ready at 220 (120 elapsed)', phone.isReady('amara', 'call', 220) === true);

  // per-NPC independence
  check('other NPC unaffected by amara cooldown', phone.isReady('bob', 'text', 100) === true);

  // phoneGain applies the compatibility multiplier to the relationship delta, need fills untouched
  const g = phoneGain('call', 1.75, d); // call gain 2 * 1.75 = 3.5
  check('phoneGain relationship delta is compat-scaled', approx(g.relationshipDelta, 3.5));
  check('phoneGain passes need gains through unchanged', approx(g.needGains.social, 2.5));
}

// ---- visitOutcome: needs + relationship scaled by level + compatibility --------------------------
console.log('social.test — visitOutcome (level + compatibility scaling)');
{
  const d = socialData();
  const rel = new RelationshipState(d);
  rel.set('amara', 62); // good_friend, index 4, levelCount 6 → levelFactor 5/6
  const compat = compatibility({ cleanliness: 5, intelligence: 5 }, { cleanliness: 5, intelligence: 5 }, d); // mult 1.75
  const out = visitOutcome('amara', rel, compat, d);
  const lf = 5 / 6;
  check('visit uses current level', out.levelId === 'good_friend');
  check('levelFactor = (index+1)/count', approx(out.levelFactor, lf));
  check('social restore = base·levelFactor·mult', approx(out.needsRestored.social, 60 * lf * 1.75));
  check('fun restore = base·levelFactor·mult', approx(out.needsRestored.fun, 30 * lf * 1.75));
  check('relationship delta = scaleGain(base,mult)·levelFactor', approx(out.relationshipDelta, 8 * 1.75 * lf));

  // higher level restores more than a lower level for the same compatibility
  rel.set('amara', 0); // acquaintance, index 2 → factor 3/6
  const outLow = visitOutcome('amara', rel, compat, d);
  check('lower relationship level restores less', outLow.needsRestored.social < out.needsRestored.social);

  // beloved (top) → full base at perfect compat
  rel.set('amara', 90); // beloved, index 5 → factor 6/6 = 1
  const outTop = visitOutcome('amara', rel, compat, d);
  check('top level → levelFactor 1', approx(outTop.levelFactor, 1));
  check('top level + perfect compat → full base · maxMultiplier', approx(outTop.needsRestored.social, 60 * 1.75));

  // visitOutcome is pure — it must not mutate the relationship score
  const before = rel.get('amara');
  visitOutcome('amara', rel, compat, d);
  check('visitOutcome does not mutate relationship score', rel.get('amara') === before);
}

// ---- serialize / restore round-trips -------------------------------------------------------------
console.log('social.test — serialize/restore round-trips');
{
  const d = socialData();
  const rel = new RelationshipState(d);
  rel.set('amara', 42);
  rel.set('bob', -13);
  const saved = rel.serialize();
  const rel2 = new RelationshipState(d);
  rel2.restore(saved);
  check('relationship restore reproduces amara', rel2.get('amara') === 42);
  check('relationship restore reproduces bob', rel2.get('bob') === -13);
  // deep copy: mutating the restored container doesn't touch the saved snapshot or the original
  rel2.set('amara', 0);
  check('restore is a deep copy (original untouched)', rel.get('amara') === 42);

  const phone = new PhoneState(d);
  phone.markUsed('amara', 'text', 500);
  phone.markUsed('amara', 'call', 600);
  phone.markUsed('bob', 'text', 700);
  const psaved = phone.serialize();
  const phone2 = new PhoneState(d);
  phone2.restore(psaved);
  check('phone restore blocks amara text at 520', phone2.isReady('amara', 'text', 520) === false);
  check('phone restore preserves amara call time', phone2.remainingCooldown('amara', 'call', 600) === 120);
  check('phone restore preserves bob text time', phone2.remainingCooldown('bob', 'text', 700) === 60);
  phone2.markUsed('amara', 'text', 9999);
  check('phone restore is a deep copy (original untouched)', phone.remainingCooldown('amara', 'text', 500) === 60);
}

// --- H3 (ROADMAP_HAPPY): happiness relationship factor
{
  const { happinessSocialFactor } = await import('../game/social');
  check('unconfigured scaling is x1', happinessSocialFactor({}, 0) === 1 && happinessSocialFactor({}, 100) === 1);
  const cfg = { happinessScaling: { atMin: 0.5, atMax: 1.5 } };
  check('scaling lerps over happiness', happinessSocialFactor(cfg, 0) === 0.5 && happinessSocialFactor(cfg, 100) === 1.5 && happinessSocialFactor(cfg, 50) === 1);
  check('sparse atMax defaults to 1', happinessSocialFactor({ happinessScaling: { atMin: 0.5 } }, 100) === 1);
  check('factor clamps at 0', happinessSocialFactor({ happinessScaling: { atMin: -2 } }, 0) === 0);
}

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall social tests passed');
