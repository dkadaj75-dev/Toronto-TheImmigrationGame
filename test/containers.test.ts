import {
  ContainerRegistry, containerCapacity, transientContainerSpace,
  findNearestContainerWithSpace, depositAtNearestContainer,
  type ContainerCandidate,
} from '../game/containers';
import { containerFillRatio, containerFillBarGeometry } from '../game/garbage';

let failures = 0;
function check(name: string, condition: boolean, detail = '') {
  if (condition) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name} ${detail}`); }
}

console.log('containers.test - registry and save compatibility');
{
  const registry = new ContainerRegistry();
  check('variable-size deposit fits remaining capacity', registry.deposit('box', 5, 3) && registry.fillOf('box') === 3);
  check('oversize deposit is atomic', !registry.deposit('box', 5, 3) && registry.fillOf('box') === 3);
  check('exact remaining-space deposit succeeds', registry.deposit('box', 5, 2) && registry.isFull('box', 5));
  registry.deposit('other', 10, 4);
  check('empty clears only one container', registry.empty('box') && registry.fillOf('box') === 0 && registry.fillOf('other') === 4);

  const oldGarbageSave = { fills: [['old-can-uuid', 7]] as [string, number][] };
  registry.restore(oldGarbageSave);
  check('old garbage fills envelope restores unchanged', registry.fillOf('old-can-uuid') === 7);
  check('serialize retains the legacy envelope shape', JSON.stringify(registry.serialize()) === JSON.stringify(oldGarbageSave));
  registry.restore({ fills: undefined as any });
  check('missing legacy fills restores as empty', registry.fillOf('old-can-uuid') === 0);
}

console.log('containers.test - sparse asset schema compatibility');
{
  check('new container capacity resolves', containerCapacity({ container: { capacity: 8 } }) === 8);
  check('new container capacity wins over legacy alias', containerCapacity({ container: { capacity: 8 }, garbage: { capacity: 2 } }) === 8);
  check('legacy garbage capacity remains readable', containerCapacity({ garbage: { capacity: 6 } }) === 6);
  check('non-container stays off', containerCapacity({}) === null);
  check('transient space is off by default', transientContainerSpace({}) === null);
  check('positive authored transient space resolves', transientContainerSpace({ containerSpace: 2.5 }) === 2.5);
  check('invalid capacity and space are rejected', containerCapacity({ container: { capacity: 0 } }) === null
    && transientContainerSpace({ containerSpace: -1 }) === null);
}

console.log('containers.test - compatible remaining-space selection');
{
  const registry = new ContainerRegistry();
  const containers: ContainerCandidate[] = [
    { key: 'near-wrong', assetId: 'hamper', pos: [1, 0], capacity: 10 },
    { key: 'near-tight', assetId: 'bin', pos: [2, 0], capacity: 5 },
    { key: 'far-fit', assetId: 'bin', pos: [7, 0], capacity: 8 },
  ];
  registry.deposit('near-tight', 5, 4);
  const found = findNearestContainerWithSpace([0, 0], containers, (key) => registry.fillOf(key), 2, 'bin');
  check('skips wrong type and insufficient remaining space', found?.key === 'far-fit', JSON.stringify(found));
  check('deposit mutates only selected compatible container', depositAtNearestContainer(registry, [0, 0], containers, 2, 'bin') === 'far-fit'
    && registry.fillOf('far-fit') === 2 && registry.fillOf('near-tight') === 4);
  const before = JSON.stringify(registry.serialize());
  check('no fitting container refuses without mutation', depositAtNearestContainer(registry, [0, 0], containers, 99, 'bin') === null
    && JSON.stringify(registry.serialize()) === before);
}

console.log('containers.test - generic fill-bar compatibility');
{
  check('generic ratio uses capacity units', containerFillRatio(2.5, 5) === 0.5);
  const half = containerFillBarGeometry(0.4, 0.06, 0.5);
  const full = containerFillBarGeometry(0.4, 0.06, 1);
  check('generic bar geometry grows with container fill', half.scaleX < full.scaleX);
}

if (failures) process.exit(1);
console.log('\nALL CONTAINER TESTS PASSED');
