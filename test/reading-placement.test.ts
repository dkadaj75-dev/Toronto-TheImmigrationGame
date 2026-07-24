import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { seatLocationCandidates, usePoseFor, usePoseForEntry, useSpotFor } from '../game/facing';
import { bakeNavGrid } from '../game/nav';
import { SimAgent, findSeatFor } from '../game/sim';
import type { ActionDef, AssetDef, AssetsData, GameData, MapData, TuningData } from '../game/data';

const readJson = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as T;
const assets = readJson<AssetsData>('../data/assets.json');
const interactions = readJson<{ actions: ActionDef[] }>('../data/interactions.json');
const map = readJson<MapData>('../data/maps/condo.json');
const tuning = readJson<TuningData>('../data/tuning.json');
const byId = new Map(assets.assets.map((asset) => [asset.id, asset]));
const world = new THREE.Group();
for (const [index, placed] of (map.placedObjects ?? []).entries()) {
  const object = new THREE.Group();
  object.position.set(placed.pos[0], 0, placed.pos[1]);
  object.rotation.y = THREE.MathUtils.degToRad(placed.rotDeg ?? 0);
  object.userData = { assetId: placed.asset, placedIndex: index };
  world.add(object);
}

const source = world.children.find((object) => object.userData.assetId === 'bookshelf');
const sourceDef = byId.get('bookshelf');
const bookDef = byId.get('book');
const read = interactions.actions.find((action) => action.id === 'read');
if (!source || !sourceDef || !bookDef || !read) throw new Error('live reading fixtures are missing');
if (read.pose !== 'sit') throw new Error('Read must explicitly declare its physical sit pose');
const sourceInstance = { pos: [source.position.x, source.position.z] as [number, number], rotDeg: THREE.MathUtils.radToDeg(source.rotation.y) };
const productPos = useSpotFor(sourceInstance, sourceDef, tuning);
const bookTarget = new THREE.Group();
bookTarget.position.set(productPos[0], 0, productPos[1]);
bookTarget.userData = { assetId: 'book', accidentKey: 'book#test' };
const data = { assets, interactions, map, tuning } as GameData;
const seat = findSeatFor(world, data, bookTarget, read.seatSearch);
if (!seat) throw new Error('Read failed to resolve a seat in the live condo');
const seatDef = byId.get(seat.userData.assetId as string)!;
const seatInstance = { pos: [seat.position.x, seat.position.z] as [number, number], rotDeg: THREE.MathUtils.radToDeg(seat.rotation.y) };

const sim = new THREE.Group(); sim.position.set(productPos[0], 0, productPos[1]);
const agent = new SimAgent(sim, bakeNavGrid(map, assets), tuning, byId);
let claimedEntry: ReturnType<typeof seatLocationCandidates>[number]['entry'] | undefined;
agent.onClaimSeat = (_action, claimedSeat, fromPos) => {
  const def = byId.get(claimedSeat.userData.assetId as string)!;
  const instance = { pos: [claimedSeat.position.x, claimedSeat.position.z] as [number, number], rotDeg: THREE.MathUtils.radToDeg(claimedSeat.rotation.y) };
  const candidates = seatLocationCandidates(def, 'sit', instance, def, tuning);
  const selected = candidates.sort((a, b) => Math.hypot(a.pos[0] - fromPos[0], a.pos[1] - fromPos[1]) - Math.hypot(b.pos[0] - fromPos[0], b.pos[1] - fromPos[1]))[0]?.entry;
  claimedEntry = candidates.length >= 2 ? selected : undefined;
  return claimedEntry;
};
if (!agent.orderAction(read, bookTarget, seat, bookDef, true)) throw new Error('Read could not route to its resolved seat');
for (let frame = 0; frame < 3000 && !agent.current; frame++) agent.update(1 / 30);
if (!agent.current) throw new Error('Read did not reach its seat');
const expected = claimedEntry
  ? usePoseForEntry('sit', claimedEntry, seatInstance, seatDef, tuning)
  : usePoseFor('sit', seatInstance, seatDef, tuning);
const distance = Math.hypot(sim.position.x - expected.pos[0], sim.position.z - expected.pos[1]);
if (agent.current.seat !== seat || agent.current.groundSit || distance > 1e-6) {
  throw new Error(`Read placement mismatch: seat=${seatDef.id}, ground=${!!agent.current.groundSit}, sim=${sim.position.x},${sim.position.z}, expected=${expected.pos}`);
}
console.log(`reading-placement.test: Read reaches ${seatDef.name} at authored seat position ${expected.pos.join(', ')}`);
