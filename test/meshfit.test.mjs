// Headless test for normalizeModelToFootprint: any authoring scale must end up
// fitting the asset footprint in XZ, centered, and grounded at y = 0.
import * as THREE from 'three';
import { normalizeModelToFootprint, applyMeshFit } from '../game/world';

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

// --- applyMeshFit: 3-axis position offset (sparse — absent axis = 0), applied post-grounding
{
  const g = new THREE.Group();
  applyMeshFit(g, { xOffset: 1.5, yOffset: -0.25, zOffset: 2 });
  approx(g.position.x, 1.5, '3-axis offset: x nudged');
  approx(g.position.y, -0.25, '3-axis offset: y nudged');
  approx(g.position.z, 2, '3-axis offset: z nudged');
}
// sparse: only one axis set leaves the others untouched at 0
{
  const g = new THREE.Group();
  applyMeshFit(g, { zOffset: 0.4 });
  approx(g.position.x, 0, 'sparse offset: absent x stays 0');
  approx(g.position.y, 0, 'sparse offset: absent y stays 0');
  approx(g.position.z, 0.4, 'sparse offset: z applied');
}
// backward-compat: legacy single-axis yOffset form behaves exactly as before (y only)
{
  const g = new THREE.Group();
  applyMeshFit(g, { yOffset: 0.9 });
  approx(g.position.x, 0, 'legacy yOffset: x untouched');
  approx(g.position.y, 0.9, 'legacy yOffset: y applied');
  approx(g.position.z, 0, 'legacy yOffset: z untouched');
}
// offsets compose with scale/yaw without clobbering them
{
  const g = new THREE.Group();
  g.scale.set(2, 2, 2);
  applyMeshFit(g, { scale: 3, xOffset: 1 });
  approx(g.scale.x, 6, 'offset + scale: scale still multiplied');
  approx(g.position.x, 1, 'offset + scale: x offset applied alongside scale');
}

// --- ITEM 1 root cause: meshFit.scale must NOT drift the mesh off the footprint center when the
//     GLB's local origin is not its bounding-box center. normalize() centers on the footprint;
//     applyMeshFit(scale) must re-anchor so the footprint center stays put.
{
  const g = new THREE.Group();
  // geometry whose local origin is far from its own center (off-center authoring, like a real GLB)
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  mesh.position.set(5, 0.5, -3); // origin nowhere near the box center
  g.add(mesh);
  normalizeModelToFootprint(g, [1, 1]); // fit + center + ground
  applyMeshFit(g, { scale: 2 });        // 2x: naive scale-about-origin would slide it sideways
  const b = boundsOf(g);
  approx(b.center.x, 0, 'scale keeps footprint-centered x (no drift)');
  approx(b.center.z, 0, 'scale keeps footprint-centered z (no drift)');
  approx(b.min.y, 0, 'scale keeps mesh grounded (no sink)');
  approx(b.size.x, 2, 'scale doubles footprint width');
}
// --- yawOffsetDeg must also re-anchor (rotation about an off-center origin drifts too)
{
  const g = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 1));
  mesh.position.set(4, 0.5, 4);
  g.add(mesh);
  normalizeModelToFootprint(g, [2, 1]);
  applyMeshFit(g, { yawOffsetDeg: 90 });
  const b = boundsOf(g);
  approx(b.center.x, 0, 'yaw keeps footprint-centered x');
  approx(b.center.z, 0, 'yaw keeps footprint-centered z');
  approx(b.min.y, 0, 'yaw keeps mesh grounded');
}
// --- offsets nudge the mesh FROM the re-anchored footprint center (scale + offset compose cleanly)
{
  const g = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  mesh.position.set(5, 0.5, -3);
  g.add(mesh);
  normalizeModelToFootprint(g, [1, 1]);
  applyMeshFit(g, { scale: 2, xOffset: 0.3, zOffset: -0.4, yOffset: 0.1 });
  const b = boundsOf(g);
  approx(b.center.x, 0.3, 'offset nudges x from re-anchored center');
  approx(b.center.z, -0.4, 'offset nudges z from re-anchored center');
  approx(b.min.y, 0.1, 'offset nudges y from ground');
}

console.log('ALL MESH-NORMALIZE TESTS PASSED');

function approx(a, b, msg, eps = 1e-6) {
  if (Math.abs(a - b) > eps) { console.error(`FAIL: ${msg} (${a} !== ${b})`); process.exit(1); }
}
