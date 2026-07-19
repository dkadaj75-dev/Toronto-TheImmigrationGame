import assert from 'node:assert/strict';
import { shouldWatchData } from '../game/data';
import { publicUrl } from '../game/urls';

assert.equal(shouldWatchData(false), true, 'development enables the hot-reload poll');
assert.equal(shouldWatchData(true), false, 'production disables the hot-reload poll');
assert.equal(publicUrl('/data/tuning.json', 'https://example.test/condo-life/'), '/condo-life/data/tuning.json');
assert.equal(publicUrl('icons/phone.svg', 'https://example.test/condo-life/'), '/condo-life/icons/phone.svg');
assert.equal(publicUrl('https://cdn.test/model.glb', 'https://example.test/condo-life/'), 'https://cdn.test/model.glb');

console.log('all 5 static-hosting tests passed');
