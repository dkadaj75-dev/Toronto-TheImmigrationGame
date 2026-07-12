// world.ts — turns data (map + assets) into a three.js scene.
// Phase 0: procedural stand-in meshes sized by each asset's footprint.
// Phase 0/1: swap stand-ins for GLB loads from asset.mesh once the starter pack is imported.

import * as THREE from 'three';
import type { GameData, AssetDef } from './data';

const FLOOR_COLORS: Record<string, number> = {
  wood: 0xb08a5a,
  tile: 0xc8cdd4,
  carpet: 0x8a9bb4,
};

const CATEGORY_COLORS: Record<string, number> = {
  seating: 0x6fae5c,
  beds: 0x8a6fd1,
  appliances: 0xd1d5db,
  plumbing: 0x7ec8e3,
  surfaces: 0xc9a06a,
  electronics: 0x4a5568,
  decor: 0xd17a9e,
};

export function buildWorld(data: GameData): THREE.Group {
  const root = new THREE.Group();
  root.name = 'world';
  const { map, assets } = data;
  const byId = new Map(assets.assets.map((a) => [a.id, a]));

  // --- floors ---
  for (const floor of map.floors) {
    const shape = new THREE.Shape(floor.polygon.map(([x, y]) => new THREE.Vector2(x, y)));
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(Math.PI / 2); // shape XY → world XZ
    const mat = new THREE.MeshLambertMaterial({ color: FLOOR_COLORS[floor.material] ?? 0x999999, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    root.add(mesh);
  }

  // --- walls (with door gaps already encoded as separate segments in the data) ---
  const wallMat = new THREE.MeshLambertMaterial({ color: 0xf0ead9 });
  const WALL_H = 2.5, WALL_T = 0.12;
  for (const wall of map.walls) {
    const [x1, z1] = wall.from, [x2, z2] = wall.to;
    const len = Math.hypot(x2 - x1, z2 - z1);
    const geo = new THREE.BoxGeometry(len, WALL_H, WALL_T);
    const mesh = new THREE.Mesh(geo, wallMat);
    mesh.position.set((x1 + x2) / 2, WALL_H / 2, (z1 + z2) / 2);
    mesh.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
    mesh.castShadow = true;
    root.add(mesh);
  }

  // --- doors (frame markers for now; animated doors in Phase 1) ---
  const doorMat = new THREE.MeshLambertMaterial({ color: 0x8a5a2b });
  for (const door of map.doors) {
    const geo = door.orientation === 'vertical'
      ? new THREE.BoxGeometry(0.14, 2.1, 1.0)
      : new THREE.BoxGeometry(1.0, 2.1, 0.14);
    const mesh = new THREE.Mesh(geo, doorMat);
    mesh.position.set(door.at[0], 1.05, door.at[1]);
    root.add(mesh);
  }

  // --- placed objects: procedural stand-ins sized by footprint ---
  for (const placed of map.placedObjects) {
    const def = byId.get(placed.asset);
    if (!def) { console.warn(`Unknown asset in map: ${placed.asset}`); continue; }
    const obj = makeStandIn(def);
    obj.position.set(placed.pos[0], 0, placed.pos[1]);
    obj.rotation.y = THREE.MathUtils.degToRad(placed.rotDeg);
    obj.userData = { assetId: def.id, interactions: def.interactions };
    root.add(obj);
  }

  return root;
}

/** Footprint-sized colored box + tiny label plate. Replaced by GLBs when the pack lands. */
function makeStandIn(def: AssetDef): THREE.Group {
  const g = new THREE.Group();
  g.name = `asset:${def.id}`;
  const [fw, fd] = def.footprint;
  const height = def.category === 'beds' ? 0.6 : def.category === 'seating' ? 0.9 : 1.1;
  const mat = new THREE.MeshLambertMaterial({ color: CATEGORY_COLORS[def.category] ?? 0xaaaaaa });
  const body = new THREE.Mesh(new THREE.BoxGeometry(fw * 0.9, height, fd * 0.9), mat);
  body.position.y = height / 2;
  body.castShadow = true;
  g.add(body);
  return g;
}

export function makeSimStandIn(): THREE.Group {
  // Placeholder character until the rigged GLB (Mixamo/Quaternius) is imported.
  const g = new THREE.Group();
  g.name = 'sim';
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0xf2c94c });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.9, 4, 12), bodyMat);
  body.position.y = 0.67;
  body.castShadow = true;
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.18, 8), bodyMat);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 1.15, 0.24);
  g.add(body, nose);
  return g;
}

export function makeLights(): THREE.Group {
  const g = new THREE.Group();
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(8, 14, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -12; sun.shadow.camera.right = 12;
  sun.shadow.camera.top = 12; sun.shadow.camera.bottom = -12;
  const ambient = new THREE.AmbientLight(0xbfd0e8, 0.9);
  g.add(sun, ambient);
  return g;
}
