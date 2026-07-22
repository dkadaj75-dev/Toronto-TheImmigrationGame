import { nearestFreeSurfaceSocket, retainedSurfaceSocket, surfaceOccupantId, surfaceSocketWorld } from '../game/surfaces';

let failures = 0;
function eq(name: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
}

console.log('surfaces.test - elevated placement sockets');
eq('local socket rotates with host', surfaceSocketWorld(
  { pos: [10, 20], rotDeg: 90 }, { offset: [1, 2], y: 0.9, rotationDeg: 45 },
), { pos: [12, 0.9, 19], rotDeg: 135 });

const hosts = [
  { key: 'counter:a', pos: [2, 2] as [number, number], rotDeg: 0, sockets: [
    { offset: [0, 0] as [number, number], y: 0.9 },
    { offset: [1, 0] as [number, number], y: 0.9 },
  ] },
  { key: 'table:b', pos: [5, 2] as [number, number], rotDeg: 0, sockets: [
    { offset: [0, 0] as [number, number], y: 0.8 },
  ] },
];
eq('nearest free socket chosen', nearestFreeSurfaceSocket(hosts, [1.8, 2], 5, () => false)?.index, 0);
eq('occupied nearest socket skipped', nearestFreeSurfaceSocket(hosts, [1.8, 2], 5, (key, i) => key === 'counter:a' && i === 0)?.index, 1);
eq('radius excludes distant sockets', nearestFreeSurfaceSocket(hosts, [20, 20], 2, () => false), null);
eq('zero radius includes exact socket', nearestFreeSurfaceSocket(hosts, [2, 2], 0, () => false)?.hostKey, 'counter:a');
eq('stable occupant token', surfaceOccupantId('transient', 'accident#3'), 'transient:accident#3');
const plateId = surfaceOccupantId('transient', 'plate#1');
eq('interrupted item retains its own exact socket', retainedSurfaceSocket(
  hosts, { hostKey: 'counter:a', index: 0 }, plateId,
  (key, index) => key === 'counter:a' && index === 0 ? plateId : undefined,
)?.index, 0);
eq('cannot retain a socket now owned by somebody else', retainedSurfaceSocket(
  hosts, { hostKey: 'counter:a', index: 0 }, plateId, () => 'transient:other',
), null);
eq('missing host invalidates a stale retained reference', retainedSurfaceSocket(
  hosts, { hostKey: 'gone', index: 0 }, plateId, () => plateId,
), null);

if (failures) process.exit(1);
console.log('\nall surface tests passed');
