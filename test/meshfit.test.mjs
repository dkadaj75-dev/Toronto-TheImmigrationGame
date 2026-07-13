// Headless test for normalizeModelToFootprint: any authoring scale must end up
// fitting the asset footprint in XZ, centered, and grounded at y = 0.
import * as THREE from 'three';
import { normalizeModelToFootprint } from '../game/world';

function boundsOf(o) {
  const b = new THREE.Box3().setFromObject(o);
  return { size: b.getSize(new THREE.Vector3()), min: b.min, center: b.getCenter(new THREE.Vector3()) };
}

// --- centimeter-scale bed (200 × 90 × 160 units) into a 2×3 footprint
{
  const g = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(200, 90, 160));
  mesh.position.set(37, 45, -12); // sloppy authoring offset too
  g.add(mesh);
  normalizeModelToFootprint(g, [2, 3]);
  const b = boundsOf(g);
  // uniform scale = min(2/200, 3/160) = 0.01 → x=2, z=1.6, y=0.9
  approx(b.size.x, 2, 'cm bed: x fits footprint width');
  approx(b.size.z, 1.6, 'cm bed: z scaled uniformly (no squash)');
  approx(b.size.y, 0.9, 'cm bed: height follows uniform scale');
  approx(b.min.y, 0, 'cm bed: grounded at y=0');
  approx(b.center.x, 0, 'cm bed: centered x');
  approx(b.center.z, 0, 'cm bed: centered z');
}

// --- tiny model (0.02 units) scales UP into a 1×1 footprint
{
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.01)));
  normalizeModelToFootprint(g, [1, 1]);
  const b = boundsOf(g);
  approx(b.size.x, Math.min(1 / 0.02, 1 / 0.01) * 0.02, 'tiny model scales up');
  approx(b.min.y, 0, 'tiny model grounded');
}

// --- already-perfect meter-scale model is a near-no-op
{
  const g = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 0.6, 1));
  mesh.position.y = 0.3;
  g.add(mesh);
  normalizeModelToFootprint(g, [2, 1]);
  const b = boundsOf(g);
  approx(b.size.x, 2, 'meter model: unchanged width');
  approx(b.size.y, 0.6, 'meter model: unchanged height');
  approx(b.min.y, 0, 'meter model: grounded');
}

console.log('ALL MESH-NORMALIZE TESTS PASSED');

function approx(a, b, msg, eps = 1e-6) {
  if (Math.abs(a - b) > eps) { console.error(`FAIL: ${msg} (${a} !== ${b})`); process.exit(1); }
}
