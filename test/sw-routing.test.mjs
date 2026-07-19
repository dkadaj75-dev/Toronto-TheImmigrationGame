// test/sw-routing.test.mjs — headless test for public/sw-routing.js's pure
// routing predicate (PROJECT_CONTEXT.md §8: the SW must never serve /data/ or
// /api/ from cache). Plain `node test/sw-routing.test.mjs`.
import assert from 'node:assert/strict';
import { isDataOrApiPath } from '../public/sw-routing.js';

let n = 0;
function ok(desc, cond) {
  n++;
  assert.ok(cond, desc);
  console.log(`  ok  ${desc}`);
}

ok('/data/*.json matches', isDataOrApiPath('/data/tuning.json'));
ok('/data/maps/*.json matches', isDataOrApiPath('/data/maps/condo.json'));
ok('/api/data/*.json matches', isDataOrApiPath('/api/data/assets.json'));
ok('/api/maps matches', isDataOrApiPath('/api/maps'));
ok('/api/fonts matches', isDataOrApiPath('/api/fonts'));
ok('/api/icons matches', isDataOrApiPath('/api/icons'));
ok('root / does not match', !isDataOrApiPath('/'));
ok('/index.html does not match', !isDataOrApiPath('/index.html'));
ok('/tools/assets.html does not match', !isDataOrApiPath('/tools/assets.html'));
ok('/game/main.ts does not match', !isDataOrApiPath('/game/main.ts'));
ok('/manifest.webmanifest does not match', !isDataOrApiPath('/manifest.webmanifest'));
ok('/icons/icon-192.png does not match', !isDataOrApiPath('/icons/icon-192.png'));
ok('subpath /repo/data matches inside SW scope', isDataOrApiPath('/repo/data/tuning.json', '/repo/'));
ok('subpath /repo/api matches inside SW scope', isDataOrApiPath('/repo/api/maps', '/repo/'));
ok('similarly-prefixed sibling is outside scope', !isDataOrApiPath('/repository/data/tuning.json', '/repo/'));
ok('a path that merely contains "data" is not a false positive', !isDataOrApiPath('/metadata.json'));
ok('a path that merely contains "api" is not a false positive', !isDataOrApiPath('/rapid.js'));

console.log(`\nall ${n} sw-routing tests passed`);
