// world.ts — turns data (map + assets) into a three.js scene.
// Phase 0: procedural stand-in meshes sized by each asset's footprint.
// Phase 0/1: swap stand-ins for GLB loads from asset.mesh once the starter pack is imported.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GameData, AssetDef, CharacterTuning } from './data';

// ------------------------------------------------------------------ GLB furniture
// Templates are cached per URL and cloned per placement; clones share geometry/materials
// with the template, so they're tagged sharedResource and skipped by disposal.
const gltfCache = new Map<string, Promise<THREE.Group>>();

function loadMeshTemplate(url: string): Promise<THREE.Group> {
  let p = gltfCache.get(url);
  if (!p) {
    p = new Promise((resolve, reject) => new GLTFLoader().load(url, (g) => resolve(g.scene), undefined, reject));
    gltfCache.set(url, p);
  }
  return p;
}

/**
 * Uniformly scale a model so its XZ bounds fit the asset footprint, center it, and
 * ground it at y = 0. Makes any authoring scale (meters, centimeters…) drop in cleanly
 * and keeps the visual matching the nav-grid footprint.
 */
export function normalizeModelToFootprint(model: THREE.Object3D, footprint: [number, number]) {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const [fw, fd] = footprint;
  const s = Math.min(fw / Math.max(size.x, 1e-6), fd / Math.max(size.z, 1e-6));
  model.scale.multiplyScalar(s);
  const box2 = new THREE.Box3().setFromObject(model);
  const center = box2.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= box2.min.y;
}

/** Swap a stand-in group's contents for the asset's GLB once it loads; keep the box on failure. */
function attachMesh(group: THREE.Group, def: AssetDef) {
  if (!def.mesh) return;
  const url = /^(\/|https?:)/.test(def.mesh) ? def.mesh : '/' + def.mesh; // public/ serves at root
  loadMeshTemplate(url)
    .then((template) => {
      const model = template.clone(true);
      normalizeModelToFootprint(model, def.footprint);
      model.traverse((o) => {
        if (o instanceof THREE.Mesh) { o.castShadow = true; o.userData.sharedResource = true; }
      });
      group.clear();
      group.add(model);
    })
    .catch(() => console.warn(`Could not load mesh for "${def.id}" (${url}) — keeping stand-in.`));
}

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

  // --- placed objects: instant stand-in, async GLB swap when asset.mesh is set ---
  for (const placed of map.placedObjects) {
    const def = byId.get(placed.asset);
    if (!def) { console.warn(`Unknown asset in map: ${placed.asset}`); continue; }
    const obj = makeStandIn(def);
    obj.position.set(placed.pos[0], 0, placed.pos[1]);
    obj.rotation.y = THREE.MathUtils.degToRad(placed.rotDeg);
    obj.userData = { assetId: def.id, interactions: def.interactions };
    attachMesh(obj, def);
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

/**
 * Uniformly scale a model so its bounding height equals `height`, center it in XZ, and
 * ground it at y = 0. The character counterpart of normalizeModelToFootprint — any
 * authoring scale (Mixamo cm, Quaternius m) drops in at the tuned character height.
 */
export function normalizeModelToHeight(model: THREE.Object3D, height: number) {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  model.scale.multiplyScalar(height / Math.max(size.y, 1e-6));
  const box2 = new THREE.Box3().setFromObject(model);
  const center = box2.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= box2.min.y;
}

export interface LoadedCharacter { model: THREE.Group; clips: THREE.AnimationClip[] }

/**
 * Load the rigged character GLB (single sim → no template caching / SkeletonUtils cloning
 * needed) and normalize it to the tuned height. Rejects on load failure — the caller
 * keeps the capsule stand-in, same philosophy as furniture placeholders.
 */
export async function loadRiggedCharacter(character: CharacterTuning): Promise<LoadedCharacter> {
  const norm = (p: string) => (/^(\/|https?:)/.test(p) ? p : '/' + p);
  const loader = new GLTFLoader();
  const load = (u: string) =>
    new Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>(
      (resolve, reject) => loader.load(u, resolve, undefined, reject),
    );
  const gltf = await load(norm(character.meshPath));
  // Mixamo-style workflows ship each animation as its own GLB (same skeleton) — merge their clips.
  const extras = await Promise.all(
    (character.animationPaths ?? []).map((p) =>
      load(norm(p)).then(
        (g) => g.animations,
        (err) => { console.warn(`animation source failed to load: ${p}`, err); return [] as THREE.AnimationClip[]; },
      ),
    ),
  );
  const clips = [...gltf.animations, ...extras.flat()];
  const model = gltf.scene;
  normalizeModelToHeight(model, character.heightMeters);
  if (character.yawOffsetDeg) {
    // wrap so the yaw is baked inside; the agent freely rotates the outer group
    const inner = new THREE.Group();
    inner.add(model);
    inner.rotation.y = THREE.MathUtils.degToRad(character.yawOffsetDeg);
    return finishCharacter(inner, clips);
  }
  return finishCharacter(model, clips);
}

function finishCharacter(model: THREE.Group, clips: THREE.AnimationClip[]): LoadedCharacter {
  model.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.frustumCulled = false; // skinned bounds don't track bones; never cull the one sim
    }
  });
  return { model, clips };
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
  sun.name = 'sun';
  sun.position.set(8, 14, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -12; sun.shadow.camera.right = 12;
  sun.shadow.camera.top = 12; sun.shadow.camera.bottom = -12;
  const ambient = new THREE.AmbientLight(0xbfd0e8, 0.9);
  ambient.name = 'ambient';
  g.add(sun, ambient);
  return g;
}

/**
 * 0 = full night, 1 = full day, with a 1-game-hour cosmetic ramp at dawn and dusk.
 * The night window itself comes from tuning.json (time.nightStartHour/nightEndHour).
 */
export function daylightFactor(hour: number, nightStartHour: number, nightEndHour: number): number {
  const RAMP = 1; // visual transition length (cosmetic, not gameplay)
  const h = ((hour % 24) + 24) % 24;
  // hours since dawn (nightEndHour), in a 24h wrap
  const sinceDawn = (h - nightEndHour + 24) % 24;
  const dayLength = (nightStartHour - nightEndHour + 24) % 24;
  if (sinceDawn >= dayLength) return 0;                    // night
  if (sinceDawn < RAMP) return sinceDawn / RAMP;           // dawn ramp
  if (sinceDawn > dayLength - RAMP) return (dayLength - sinceDawn) / RAMP; // dusk ramp
  return 1;                                                // day
}

const SKY_DAY = new THREE.Color(0x2a3346);
const SKY_NIGHT = new THREE.Color(0x0d1220);
const SUN_DAY = new THREE.Color(0xffffff);
const SUN_NIGHT = new THREE.Color(0x7a8fc4); // moonlight

/** Blend sun/ambient/background between day and night. Call per frame with the game hour. */
export function applyDayNight(lights: THREE.Group, scene: THREE.Scene, hour: number, nightStartHour: number, nightEndHour: number) {
  const f = daylightFactor(hour, nightStartHour, nightEndHour);
  const sun = lights.getObjectByName('sun') as THREE.DirectionalLight | null;
  const ambient = lights.getObjectByName('ambient') as THREE.AmbientLight | null;
  if (sun) {
    sun.intensity = THREE.MathUtils.lerp(0.35, 2.2, f);
    sun.color.lerpColors(SUN_NIGHT, SUN_DAY, f);
  }
  if (ambient) ambient.intensity = THREE.MathUtils.lerp(0.4, 0.9, f);
  if (scene.background instanceof THREE.Color) scene.background.lerpColors(SKY_NIGHT, SKY_DAY, f);
}
