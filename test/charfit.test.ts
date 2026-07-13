// charfit.test.ts — normalizeModelToHeight: any authoring scale lands at the tuned
// character height, centered in XZ and grounded at y = 0.
// Run: npx tsx test/charfit.test.ts

import * as THREE from 'three';
import { normalizeModelToHeight } from '../game/world';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name} ${detail}`); }
}
function approx(a: number, b: number, eps = 1e-3) { return Math.abs(a - b) <= eps; }

function boxModel(w: number, h: number, d: number, offset = new THREE.Vector3()): THREE.Group {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d));
  m.position.copy(offset);
  g.add(m);
  return g;
}

function bounds(model: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(model);
  return { size: box.getSize(new THREE.Vector3()), min: box.min, center: box.getCenter(new THREE.Vector3()) };
}

console.log('charfit.test — cm-scale Mixamo-style model (180 units tall)');
{
  const model = boxModel(40, 180, 30, new THREE.Vector3(5, 90, -3)); // feet at y=0 in cm space, off-center
  normalizeModelToHeight(model, 1.55);
  const b = bounds(model);
  check('height = 1.55', approx(b.size.y, 1.55), `got ${b.size.y}`);
  check('grounded at y=0', approx(b.min.y, 0), `got ${b.min.y}`);
  check('centered X', approx(b.center.x, 0), `got ${b.center.x}`);
  check('centered Z', approx(b.center.z, 0), `got ${b.center.z}`);
  check('uniform scale (width ratio preserved)', approx(b.size.x / b.size.y, 40 / 180), `got ${b.size.x / b.size.y}`);
}

console.log('charfit.test — tiny model scales up');
{
  const model = boxModel(0.02, 0.09, 0.015);
  normalizeModelToHeight(model, 1.55);
  const b = bounds(model);
  check('height = 1.55', approx(b.size.y, 1.55), `got ${b.size.y}`);
  check('grounded', approx(b.min.y, 0), `got ${b.min.y}`);
}

console.log('charfit.test — meter-scale model is a near-no-op');
{
  const model = boxModel(0.45, 1.55, 0.3, new THREE.Vector3(0, 0.775, 0));
  normalizeModelToHeight(model, 1.55);
  const b = bounds(model);
  check('height stays 1.55', approx(b.size.y, 1.55), `got ${b.size.y}`);
  check('grounded', approx(b.min.y, 0), `got ${b.min.y}`);
}

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall charfit tests passed');
