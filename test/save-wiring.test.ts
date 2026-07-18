// save-wiring.test.ts — V3 headless registration and real-system round trips.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BillsData, FinanceData, GameData, JobDef, SimStateData, StatsData } from '../game/data';
import { SimStats } from '../game/stats';
import { QuestRunner } from '../game/quests';
import { VisaMachine } from '../game/visas';
import { WorkTracker } from '../game/work';
import { FinanceState } from '../game/bills';
import { HydroMeter } from '../game/hydro';
import { BuyOverlay } from '../game/buymode';
import { AssetStateRegistry } from '../game/assetstate';
import { GarbageRegistry } from '../game/garbage';
import { FoodRegistry } from '../game/food';
import { AccidentRegistry } from '../game/accidents';
import { RelationshipState, PhoneState, type SocialData } from '../game/social';
import { SocialRuntime } from '../game/socialruntime';
import { VisitLifecycle, type NpcsData } from '../game/npc';
import { VisitAwayTracker } from '../game/visit';
import { PendingMoveTracker } from '../game/rental';
import { applyEnvelope, assembleEnvelope, SaveRegistry } from '../game/save';
import { homeMapIdFromEnvelope, registerRuntimeSaveSystems, SAVE_SYSTEM_IDS } from '../game/savewiring';

let failures = 0;
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name} ${detail}`); }
}
function json<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as T;
}

const data = {
  stats: json<StatsData>('data/stats.json'),
  quests: json<GameData['quests']>('data/quests.json'),
  simstate: json<SimStateData>('data/simstate.json'),
  visas: json<GameData['visas']>('data/visas.json'),
  bills: json<BillsData>('data/bills.json'),
  finance: json<FinanceData>('data/finance.json'),
  social: json<SocialData>('data/social.json'),
  npcs: json<NpcsData>('data/npcs.json'),
};

function makeRuntime() {
  const registry = new SaveRegistry();
  const stats = new SimStats(data.stats);
  const quests = new QuestRunner(data.quests, data.simstate, 500);
  const visa = new VisaMachine(data.visas, data.visas.visas[0]?.id ?? 'visitor', 1);
  const work = new WorkTracker();
  const finance = new FinanceState(data.bills, data.finance, 3, 1);
  const hydro = new HydroMeter();
  const buyMode = new BuyOverlay();
  const assetStates = new AssetStateRegistry();
  const garbage = new GarbageRegistry();
  const food = new FoodRegistry();
  const accidents = new AccidentRegistry();
  const social = new SocialRuntime(data.social);
  const npcVisit = new VisitLifecycle(() => data.npcs, () => data.social);
  const visitAway = new VisitAwayTracker();
  const pendingMove = new PendingMoveTracker();
  let simClockSeconds = 0;
  let homeMap = 'condo';
  registerRuntimeSaveSystems(registry, {
    stats,
    clock: {
      getSimClockSeconds: () => simClockSeconds,
      setSimClockSeconds: (value) => { simClockSeconds = value; },
    },
    quests, visa, work, finance, hydro, buyMode, assetStates, garbage, food, accidents,
    social, npcVisit, visitAway, pendingMove,
    homeMap: {
      getMapId: () => homeMap,
      setMapId: (mapId) => { homeMap = mapId; },
    },
  });
  return {
    registry, stats, quests, visa, work, finance, hydro, buyMode, assetStates, garbage,
    food, accidents, social, npcVisit, visitAway, pendingMove,
    getClock: () => simClockSeconds,
    setClock: (value: number) => { simClockSeconds = value; },
    getHome: () => homeMap,
    setHome: (value: string) => { homeMap = value; },
  };
}

console.log('save-wiring.test — stable registration and real system round-trip');
const source = makeRuntime();
source.stats.needs.set(source.stats.needDefs[0].id, 17);
source.stats.skills.set(source.stats.skillDefs[0].id, 4.25);
if (source.stats.personalityDefs[0]) source.stats.personality.set(source.stats.personalityDefs[0].id, 8);
source.quests.funds = 1234;
source.quests.vars.homeMap = 'apartment';
source.visa.grantVisa(data.visas.visas.at(-1)?.id ?? data.visas.visas[0].id, 3);
const job: JobDef = { id: 'saved-job', name: 'Saved Job', hours: { startHour: 9, endHour: 17 }, payPerShift: 100, maxSkips: 2 };
source.work.syncJob(job, { day: 2, hour: 8 });
source.work.beginShift(job, { day: 2, hour: 9 }, { pos: [1, 2], facingDeg: 90 });
source.finance.outstanding.push({ id: 'rent', name: 'Rent', amount: 222, key: 'saved-rent', arrivalDay: 2 });
source.finance.observeFunds(2, -25);
source.hydro.accrue(3, 2.5);
source.buyMode.addPurchase('chair', [2, 3], 45);
source.assetStates.setOn('designer:1', true);
source.garbage.deposit('designer:can', 5);
source.food.startCarrying('food#1', 'snack', { hungerGain: 20, perishHours: 6 }, [2, 2]);
source.food.interruptActive([3, 4], 28);
source.accidents.spawn({ accidentId: 'fire', pos: [1, 1], rotDeg: 0, footprint: [1, 1], placement: 'on', baseKey: 'designer:0', bornAt: 10 });
source.social.relationships.set(data.npcs.npcs[0].id, 44);
source.social.phone.markUsed(data.npcs.npcs[0].id, 'call', 180);
source.npcVisit.invite(data.npcs.npcs[0].id, 1.2);
source.visitAway.begin(data.npcs.npcs[0].id, { day: 2, hour: 10 }, 3, { pos: [4, 5], facingDeg: 180 });
source.pendingMove.start('apartment', 2, 24);
source.setClock(987.5);
source.setHome('apartment');

const envelope = assembleEnvelope(source.registry, { mapId: 'apartment', gameHour: 34.5, savedAt: '2026-07-18T12:00:00.000Z' });
const target = makeRuntime();
const applied = applyEnvelope(target.registry, envelope);
check('all inventory systems are registered', Object.values(SAVE_SYSTEM_IDS).every((id) => target.registry.has(id)));
check('round-trip applies cleanly', applied.ok && applied.warnings.length === 0, applied.ok ? applied.warnings.join('; ') : applied.reason);
check('stats round-trip', target.stats.needs.get(target.stats.needDefs[0].id) === 17 && target.stats.skills.get(target.stats.skillDefs[0].id) === 4.25);
check('quests/funds round-trip under metadata id', target.quests.funds === 1234 && envelope.systems[SAVE_SYSTEM_IDS.quests] !== undefined);
check('work schedule/attendance cursor state round-trips', target.work.isAtWork && target.work.activeShift?.returnPoint.pos[1] === 2);
check('finance + hydro round-trip', target.finance.outstanding[0]?.amount === 222 && target.hydro.accruedCharge === 7.5);
check('buy/asset/garbage round-trip', target.buyMode.allAdditions.length === 1 && target.assetStates.isOn('designer:1') && target.garbage.fillOf('designer:can') === 1);
check('dropped food and accident round-trip', target.food.all[0]?.phase === 'dropped' && target.accidents.all.length === 1);
check('SocialRuntime owns real relationship and phone states', target.social.relationships instanceof RelationshipState && target.social.phone instanceof PhoneState);
check('social values round-trip', target.social.relationships.get(data.npcs.npcs[0].id) === 44 && target.social.phone.remainingCooldown(data.npcs.npcs[0].id, 'call', 181) > 0);
check('NPC/away/pending trackers round-trip', target.npcVisit.state.phase === 'pending' && target.visitAway.isAway && target.pendingMove.pending?.mapId === 'apartment');
check('clock system round-trips', target.getClock() === 987.5);
check('envelope mapId and homeMap payload agree', envelope.mapId === 'apartment' && homeMapIdFromEnvelope(envelope) === 'apartment' && target.getHome() === 'apartment');

console.log('save-wiring.test — corrupt payload isolation');
const corrupt = structuredClone(envelope);
corrupt.systems[SAVE_SYSTEM_IDS.social] = null;
const isolated = makeRuntime();
const isolatedResult = applyEnvelope(isolated.registry, corrupt);
check('corrupt system produces warning without aborting load', isolatedResult.ok && isolatedResult.warnings.some((warning) => warning.includes(SAVE_SYSTEM_IDS.social)));
check('corrupt social system restores fresh defaults', isolated.social.relationships.get(data.npcs.npcs[0].id) === data.social.relationship.start);
check('other systems still restore', isolated.quests.funds === 1234 && isolated.hydro.accruedCharge === 7.5);

console.log('save-wiring.test — envelope map fallback');
const missingHome = structuredClone(envelope);
delete missingHome.systems[SAVE_SYSTEM_IDS.homeMap];
check('missing homeMap payload falls back to envelope mapId', homeMapIdFromEnvelope(missingHome) === 'apartment');

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall save wiring tests passed');
