// world.ts — turns data (map + assets) into a three.js scene.
// Phase 0: procedural stand-in meshes sized by each asset's footprint.
// Phase 0/1: swap stand-ins for GLB loads from asset.mesh once the starter pack is imported.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import type { GameData, AssetDef, CharacterTuning } from './data';
import { classifyMeshPath, createSpriteInstance, preloadGif } from './sprites';
import { retargetTrackName, stripPositionTracks, resolveClipName, fileStem } from './fbxclips';
import { resolveWindowConfig, windowFacePositions, windowPaneRect } from './windows';
import { wallCutShownHeight } from './wallview';
import { resolveAssetLight } from './assetstate';
import { resolveMetersPerTile, effectiveMetersPerTile, textureRepeat, polygonBounds } from './textures';

// ------------------------------------------------------------------ GLB furniture
// Templates are cached per URL and cloned per placement; clones share geometry/materials
// with the template, so they're tagged sharedResource and skipped by disposal.
const gltfCache = new Map<string, Promise<THREE.Group>>();
export type TrackInitialLoad = <T>(promise: Promise<T>) => Promise<T>;

/** Exported for reuse by game/doors.ts (same cached-template-clone pattern for door panels). */
export function loadMeshTemplate(url: string): Promise<THREE.Group> {
  let p = gltfCache.get(url);
  if (!p) {
    p = new Promise((resolve, reject) => new GLTFLoader().load(url, (g) => resolve(g.scene), undefined, reject));
    gltfCache.set(url, p);
  }
  return p;
}

// ------------------------------------------------------------------ surface textures (B9-1)
// Loaded images are cached per URL (mirrors gltfCache) so a floor/wall texture decodes once
// even across hot-reload rebuilds. Each SURFACE clones the cached texture: `.repeat`/`.wrapS`
// live on the THREE.Texture, so walls of different lengths (or floors of different sizes) each
// need their own repeat — the clone shares the decoded `.image`, so it's cheap.
const textureCache = new Map<string, Promise<THREE.Texture>>();
function loadTexture(url: string): Promise<THREE.Texture> {
  let p = textureCache.get(url);
  if (!p) {
    p = new Promise((resolve, reject) => new THREE.TextureLoader().load(url, resolve, undefined, reject));
    textureCache.set(url, p);
  }
  return p;
}

/**
 * B9-1 keep-stand-in swap: the mesh renders with its flat color material immediately; once the
 * texture image loads it swaps in tiled (physically sized via `repeat`). Any load failure keeps
 * the color — same "instant stand-in, async swap, never leave it broken" philosophy as attachMesh.
 * The mesh MUST own a non-shared material (walls share one otherwise) so the swap is per-surface.
 */
function applySurfaceTexture(
  mesh: THREE.Mesh,
  url: string,
  repeat: [number, number],
  trackInitialLoad?: TrackInitialLoad,
) {
  const ready = loadTexture(url)
    .then((base) => {
      const tex = base.clone();
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(repeat[0], repeat[1]);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      const mat = mesh.material as THREE.MeshLambertMaterial;
      mat.map = tex;
      mat.color.setHex(0xffffff); // let the image show through instead of tinting it
      mat.needsUpdate = true;
    })
    .catch(() => console.warn(`Could not load texture "${url}" — keeping color fallback.`));
  void (trackInitialLoad ? trackInitialLoad(ready) : ready);
}

/** Normalize a ShapeGeometry's UVs (which come out in raw shape-space meters) to 0..1 across the
 *  polygon bounds, so a `repeat = spanMeters / metersPerTile` gives physical tiling exactly like a
 *  wall's 0..1 BoxGeometry face UVs. Only called for textured floors. */
function normalizeFloorUVs(geo: THREE.BufferGeometry, bounds: { minX: number; minY: number; w: number; h: number }) {
  const uv = geo.attributes.uv;
  if (!uv || bounds.w <= 0 || bounds.h <= 0) return;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (uv.getX(i) - bounds.minX) / bounds.w, (uv.getY(i) - bounds.minY) / bounds.h);
  }
  uv.needsUpdate = true;
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

/**
 * Designer escape hatch for mesh authoring quirks (AssetDef.meshFit, §7.1/§7.2): applied AFTER
 * normalizeModelToFootprint has already scaled/centered/grounded the model, so these are
 * intentional deviations from that automatic fit, not replacements for it.
 *  - scale: additional multiply on top of the footprint-fit scale (uniform or per-axis).
 *  - yawOffsetDeg: rotates the model in place — corrects a mesh not authored facing the
 *    game's local +Z convention. AssetDef.facingDeg (game/facing.ts) is then defined in terms
 *    of the model's orientation AFTER this correction, so the two fields compose cleanly.
 *  - yOffset: nudges the model vertically post-grounding (e.g. a door sitting flush in its frame).
 *
 * Exported for reuse by game/doors.ts, which applies the same correction to a door panel's GLB.
 */
export function applyMeshFit(model: THREE.Object3D, fit: AssetDef['meshFit']) {
  if (!fit) return;
  if (fit.scale !== undefined) {
    if (Array.isArray(fit.scale)) model.scale.set(model.scale.x * fit.scale[0], model.scale.y * fit.scale[1], model.scale.z * fit.scale[2]);
    else model.scale.multiplyScalar(fit.scale);
  }
  if (fit.yawOffsetDeg) model.rotation.y += THREE.MathUtils.degToRad(fit.yawOffsetDeg);
  if (fit.yOffset) model.position.y += fit.yOffset;
}

/** public/ serves at root — normalize "models/x.glb" → "/models/x.glb"; leave absolute/http(s) alone. */
export function normalizeMeshUrl(mesh: string): string {
  return /^(\/|https?:)/.test(mesh) ? mesh : '/' + mesh;
}

/**
 * Swap a stand-in group's contents for the asset's visual once it loads; keeps the stand-in box
 * on ANY failure (missing GLB, 404'd image, failed GIF decode) — same "instant box, async swap,
 * never leave the scene broken" philosophy for every mesh-loading call site.
 *
 * §7.5 extension detection lives HERE (not duplicated per call site): `def.mesh`'s extension
 * decides GLB vs. image via game/sprites.ts's classifyMeshPath, so world.ts (furniture),
 * doors.ts (door panels), and accidents.ts (accident instances) all agree on the same rule by
 * calling this ONE function instead of three copies of the same loader.
 *
 * `allowSprite: false` (doors.ts only) explicitly REJECTS the image path: a billboard sprite
 * always faces the camera regardless of the hinge pivot's rotation, and a floor-flat plane
 * doesn't read as a door at all — neither sprite orientation can represent a swinging door
 * panel, so a door pointed at an image just keeps its GLB-only stand-in box with a console
 * warning, rather than silently rendering something that looks wrong. Every other call site
 * (furniture, accidents) defaults to `allowSprite: true` and gets sprite support for free.
 *
 * When a sprite is created, `group.userData.spriteUpdate` is set to its per-frame GIF-advance
 * callback — main.ts's render loop calls it via a single `world.traverse(...)` sweep each frame
 * (see main.ts), so any group anywhere in the scene graph gets its frames advanced with zero
 * additional per-call-site wiring.
 */
export function attachMesh(group: THREE.Group, def: AssetDef, opts: { allowSprite?: boolean; trackInitialLoad?: TrackInitialLoad } = {}) {
  if (!def.mesh) return;
  const url = normalizeMeshUrl(def.mesh);
  if (classifyMeshPath(url) === 'image') {
    if (opts.allowSprite === false) {
      console.warn(`Asset "${def.id}" mesh (${url}) is an image, but this attachment point doesn't support sprites (see world.ts's attachMesh doc comment) — keeping the stand-in.`);
      return;
    }
    const inst = createSpriteInstance(def, url);
    const ready = inst.ready
      .then(() => {
        const persistent = group.children.filter((child) => child.userData.assetPersistent);
        group.clear();
        group.add(inst.object, ...persistent);
        group.userData.spriteUpdate = (dt: number) => inst.update(dt);
      })
      .catch(() => console.warn(`Could not load sprite image for "${def.id}" (${url}) — keeping stand-in.`));
    void (opts.trackInitialLoad ? opts.trackInitialLoad(ready) : ready);
    return;
  }
  const ready = loadMeshTemplate(url)
    .then((template) => {
      const model = template.clone(true);
      normalizeModelToFootprint(model, def.footprint);
      if (def.wallMounted) {
        const box = new THREE.Box3().setFromObject(model);
        model.position.y -= box.getCenter(new THREE.Vector3()).y;
      }
      applyMeshFit(model, def.meshFit);
      model.traverse((o) => {
        if (o instanceof THREE.Mesh) { o.castShadow = true; o.userData.sharedResource = true; }
      });
      const persistent = group.children.filter((child) => child.userData.assetPersistent);
      group.clear();
      group.add(model, ...persistent);
    })
    .catch(() => console.warn(`Could not load mesh for "${def.id}" (${url}) — keeping stand-in.`));
  void (opts.trackInitialLoad ? opts.trackInitialLoad(ready) : ready);
}

/** B6-12 thin THREE layer: runtime state lives in the pure AssetStateRegistry. */
export function attachAssetLight(group: THREE.Group, def: AssetDef): THREE.PointLight | null {
  const cfg = resolveAssetLight(def);
  if (!cfg) return null;
  const light = new THREE.PointLight(cfg.color, cfg.intensity, cfg.distance);
  light.name = 'asset-point-light';
  light.position.y = cfg.yOffset;
  light.visible = cfg.defaultOn;
  light.userData.assetPersistent = true;
  light.userData.onIntensity = cfg.intensity;
  group.add(light);
  return light;
}

export function setAssetObjectOn(group: THREE.Object3D, on: boolean): void {
  const light = group.getObjectByName('asset-point-light') as THREE.PointLight | undefined;
  if (light) {
    light.visible = on;
    light.intensity = on ? ((light.userData.onIntensity as number | undefined) ?? light.intensity) : 0;
  }
  group.userData.assetOn = on;
}

export function applyAssetPlacement(group: THREE.Object3D, def: AssetDef, pos: [number, number], rotDeg: number): void {
  group.position.set(pos[0], def.wallMounted ? (def.wallMounted.heightY ?? 1.5) : 0, pos[1]);
  group.rotation.y = THREE.MathUtils.degToRad(rotDeg);
}

/**
 * ROADMAP_NEXT B3-1(b): warms the mesh/sprite caches for every transient-category asset (fire,
 * water_puddle, ash, dirty_dishes, pee_puddle, ...) at world-build time — BEFORE any of them are
 * ever actually spawned by accidents.ts/garbage.ts/bladder.ts. Transient assets are never in
 * `map.placedObjects` (they're runtime-only), so unlike ordinary furniture they'd otherwise never
 * hit `loadMeshTemplate`/the gif-decode cache until the moment a designer/player actually
 * triggered one — the classic "first spawn shows the stand-in box for a beat" symptom the brief
 * called out for fire specifically. GLB meshes reuse the existing `gltfCache` (loadMeshTemplate
 * already dedupes by URL, so this is just an eager cache-fill, same pattern as the ordinary
 * placed-object path); image/GIF meshes go through sprites.ts's own `preloadGif`. Fire-and-forget:
 * failures are swallowed here and re-reported (with a console.warn) the first time something
 * actually tries to attach that mesh for real. Called once per `buildWorld()` (i.e. also on every
 * hot-reload) — cheap no-op on repeats since both caches are keyed by URL.
 */
function warmTransientAssets(data: GameData, trackInitialLoad?: TrackInitialLoad) {
  for (const def of data.assets.assets) {
    if (def.category !== 'transient' || !def.mesh) continue;
    const url = normalizeMeshUrl(def.mesh);
    const ready = classifyMeshPath(url) === 'image'
      ? preloadGif(url).then(() => undefined).catch(() => undefined)
      : loadMeshTemplate(url).then(() => undefined).catch(() => undefined);
    void (trackInitialLoad ? trackInitialLoad(ready) : ready);
  }
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

export function buildWorld(data: GameData, trackInitialLoad?: TrackInitialLoad): THREE.Group {
  const root = new THREE.Group();
  root.name = 'world';
  const { map, assets } = data;
  const byId = new Map(assets.assets.map((a) => [a.id, a]));
  warmTransientAssets(data, trackInitialLoad); // B7-7 counts initial transient cache warmups too
  const metersPerTile = resolveMetersPerTile(data.tuning); // B9-1 physical texture tile size

  // --- floors ---
  for (const floor of map.floors) {
    const shape = new THREE.Shape(floor.polygon.map(([x, y]) => new THREE.Vector2(x, y)));
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(Math.PI / 2); // shape XY → world XZ
    // Textured floors need their own material (color fallback until the image loads).
    const mat = new THREE.MeshLambertMaterial({ color: FLOOR_COLORS[floor.material] ?? 0x999999, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    if (floor.texture) {
      const b = polygonBounds(floor.polygon);
      const mpt = effectiveMetersPerTile(metersPerTile, floor.textureScale); // per-surface scale follow-up
      normalizeFloorUVs(geo, b); // ShapeGeometry UVs are raw meters → 0..1 so repeat sizes physically
      applySurfaceTexture(mesh, normalizeMeshUrl(floor.texture), [textureRepeat(b.w, mpt), textureRepeat(b.h, mpt)], trackInitialLoad);
    }
    root.add(mesh);
  }

  // --- walls (with door gaps already encoded as separate segments in the data) ---
  const wallMat = new THREE.MeshLambertMaterial({ color: 0xf0ead9 });
  const WALL_H = 2.5, WALL_T = 0.12;
  for (const wall of map.walls) {
    const [x1, z1] = wall.from, [x2, z2] = wall.to;
    const len = Math.hypot(x2 - x1, z2 - z1);
    const geo = new THREE.BoxGeometry(len, WALL_H, WALL_T);
    // A textured wall gets its own material so the swap doesn't hit the shared color wallMat.
    const mat = wall.texture ? new THREE.MeshLambertMaterial({ color: 0xf0ead9 }) : wallMat;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((x1 + x2) / 2, WALL_H / 2, (z1 + z2) / 2);
    mesh.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
    mesh.userData.wallCutVisual = 'wall';
    mesh.userData.wallCutFullHeight = WALL_H;
    mesh.castShadow = true;
    if (wall.texture) {
      // v-repeat from FULL height (WALL_H); the wall-cut view scales the geometry down, which just
      // compresses the texture vertically with it — acceptable per B9-1 (documented, not re-mapped).
      const mpt = effectiveMetersPerTile(metersPerTile, wall.textureScale); // per-surface scale follow-up
      applySurfaceTexture(mesh, normalizeMeshUrl(wall.texture), [textureRepeat(len, mpt), textureRepeat(WALL_H, mpt)], trackInitialLoad);
    }
    root.add(mesh);
  }

  // --- doors: a bare frame-marker box UNLESS the door links to a door-capable asset (has an
  // `AssetDef.door` block, §7.1) — those are rendered + animated by game/doors.ts's buildDoors()
  // instead (main.ts adds its group into this same root). Doors without an assetId, or whose
  // assetId doesn't resolve to a door-capable asset, keep this exact old behavior unchanged —
  // old maps stay valid with zero visual/behavioral change.
  const doorMat = new THREE.MeshLambertMaterial({ color: 0x8a5a2b });
  for (const door of map.doors) {
    const doorDef = door.assetId ? byId.get(door.assetId) : undefined;
    if (doorDef?.door) continue; // handled by doors.ts
    const geo = door.orientation === 'vertical'
      ? new THREE.BoxGeometry(0.14, 2.1, 1.0)
      : new THREE.BoxGeometry(1.0, 2.1, 0.14);
    const mesh = new THREE.Mesh(geo, doorMat);
    mesh.position.set(door.at[0], 1.05, door.at[1]);
    mesh.userData.wallCutVisual = 'door-marker';
    mesh.userData.wallCutFullHeight = 2.1;
    root.add(mesh);
  }

  // --- windows: translucent glass-pane stand-in (ROADMAP_NEXT item 9, game/windows.ts) — purely
  // decorative, drawn ON TOP of the wall (the wall segment itself is never split/cut, unlike a
  // door's gap). No real window GLB exists yet, so `assetId` (if any) is carried on the map entry
  // for a future real-mesh consumer but isn't read here — same "data now, consumer later"
  // precedent as several other sparse fields in this codebase (e.g. AssetDef.combustibility
  // before ROADMAP item 6 landed).
  const windowPaneMat = new THREE.MeshPhysicalMaterial({ color: 0x9edff4, transparent: true, opacity: 0.58, roughness: 0.05, metalness: 0.05, side: THREE.DoubleSide, depthWrite: false });
  const windowFrameMat = new THREE.MeshLambertMaterial({ color: 0xe8e2d0 });
  for (const win of map.windows ?? []) {
    const config = resolveWindowConfig(win, data.tuning);
    const rect = windowPaneRect(win, config);
    const yaw = THREE.MathUtils.degToRad(rect.yawDeg);
    const windowGroup = new THREE.Group();
    windowGroup.name = 'window-visual';
    windowGroup.userData.wallCutVisual = 'window';
    for (const position of windowFacePositions(win, config, WALL_T)) {
      const face = new THREE.Group();
      face.position.set(...position);
      face.rotation.y = yaw;

      const pane = new THREE.Mesh(new THREE.BoxGeometry(rect.size[0], rect.size[1], 0.02), windowPaneMat);
      pane.renderOrder = 1;
      face.add(pane);

      // Four rails leave the pane visible. The previous solid frame box filled the rectangle.
      const rail = 0.07;
      const frameDepth = 0.035;
      for (const y of [-rect.size[1] / 2, rect.size[1] / 2]) {
        const horizontal = new THREE.Mesh(new THREE.BoxGeometry(rect.size[0] + rail * 2, rail, frameDepth), windowFrameMat);
        horizontal.position.y = y;
        face.add(horizontal);
      }
      for (const x of [-rect.size[0] / 2, rect.size[0] / 2]) {
        const vertical = new THREE.Mesh(new THREE.BoxGeometry(rail, rect.size[1], frameDepth), windowFrameMat);
        vertical.position.x = x;
        face.add(vertical);
      }
      windowGroup.add(face);
    }
    root.add(windowGroup);
  }

  // --- placed objects: instant stand-in, async GLB swap when asset.mesh is set ---
  // `placedIndex` (§7.6 Buy/Sell mode): the object's position in map.placedObjects, so
  // game/buymode.ts's BuyModeController can patch a designer-placed instance in-place (hide a
  // sold one, reposition a moved one) after each buildWorld() rebuild without needing its own
  // parallel rendering path for these objects — see BuyModeController.apply().
  map.placedObjects.forEach((placed, placedIndex) => {
    const def = byId.get(placed.asset);
    if (!def) { console.warn(`Unknown asset in map: ${placed.asset}`); return; }
    const obj = makeStandIn(def);
    applyAssetPlacement(obj, def, placed.pos, placed.rotDeg);
    obj.userData = { assetId: def.id, interactions: def.interactions, placedIndex, assetStateKey: `designer:${placedIndex}` };
    attachAssetLight(obj, def);
    attachMesh(obj, def, { trackInitialLoad });
    root.add(obj);
  });

  return root;
}

/** Apply the Sims-style wall-cut presentation without rebuilding nav or changing map data.
 * Walls and door visuals shrink from ground level; windows hide because their authored pane is
 * above the cut. Furniture, sim, collision, paths, and interactions remain unchanged. */
export function applyWallCutView(root: THREE.Group, active: boolean, requestedHeight: number) {
  root.traverse((object) => {
    const kind = object.userData.wallCutVisual as string | undefined;
    if (kind === 'window') {
      object.visible = !active;
      return;
    }
    const fullHeight = object.userData.wallCutFullHeight as number | undefined;
    if ((kind === 'wall' || kind === 'door-marker') && fullHeight) {
      const shownHeight = wallCutShownHeight(active, requestedHeight, fullHeight);
      object.scale.y = shownHeight / fullHeight;
      object.position.y = shownHeight / 2;
    } else if (kind === 'animated-door' && fullHeight) {
      object.scale.y = wallCutShownHeight(active, requestedHeight, fullHeight) / fullHeight;
    }
  });
}

/** Footprint-sized colored box + tiny label plate. Replaced by GLBs when the pack lands.
 *  Exported for reuse by game/buymode.ts (§7.6): a purchased instance gets the EXACT same
 *  stand-in-then-GLB-swap rendering as a designer-placed one via attachMesh. */
export function makeStandIn(def: AssetDef): THREE.Group {
  const g = new THREE.Group();
  g.name = `asset:${def.id}`;
  const [fw, fd] = def.footprint;
  const height = def.category === 'beds' ? 0.6 : def.category === 'seating' ? 0.9 : 1.1;
  const mat = new THREE.MeshLambertMaterial({ color: CATEGORY_COLORS[def.category] ?? 0xaaaaaa });
  const body = new THREE.Mesh(new THREE.BoxGeometry(fw * 0.9, height, fd * 0.9), mat);
  body.position.y = def.wallMounted ? 0 : height / 2;
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

// ------------------------------------------------------------------ FBX animation sources
// A downloaded rigged character sometimes ships as a GLB body with its animation clips as
// SEPARATE .fbx files (Mixamo-style exports). This section loads those and reuses game/fbxclips.ts
// for the pure Mixamo-quirk decisions (bone-name retargeting, root-translation drop, clip-name
// dedupe) — see that module's doc comments for the "why" of each rule. `loadFbxClips` and
// `isFbxPath` are exported so tools/animations.html's preview loader calls this SAME
// implementation instead of reimplementing FBX handling (never-reimplement rule, §5).
const fbxCache = new Map<string, Promise<THREE.Group>>();
function loadFbxTemplate(url: string): Promise<THREE.Group> {
  let p = fbxCache.get(url);
  if (!p) {
    p = new Promise((resolve, reject) => new FBXLoader().load(url, resolve, undefined, reject));
    fbxCache.set(url, p);
  }
  return p;
}

export function isFbxPath(url: string): boolean {
  return /\.fbx(\?|#|$)/i.test(url);
}

/** Every skinned bone name found under `root` — the "target skeleton" that FBX clip tracks are retargeted against. */
export function collectBoneNames(root: THREE.Object3D): string[] {
  const names = new Set<string>();
  root.traverse((o) => {
    const skinned = o as THREE.SkinnedMesh;
    if (skinned.isSkinnedMesh && skinned.skeleton) {
      for (const b of skinned.skeleton.bones) names.add(b.name);
    } else if ((o as THREE.Bone).isBone) {
      names.add(o.name);
    }
  });
  return [...names];
}

/**
 * Load the animation clip(s) from one .fbx source file and adapt them for the base character rig:
 *  - **bone retargeting**: FBX clips are often authored against `mixamorig:Bone`/`mixamorigBone`
 *    track names while the GLB base rig's bones may or may not carry that prefix. Each track is
 *    retargeted via game/fbxclips.ts's `retargetTrackName` (exact-name pass-through first, then
 *    mixamorig-prefix-stripped fallback); unresolved tracks are left alone (so playback degrades
 *    gracefully — a static bone, not a crash) and collected for a single console warning.
 *  - **scale / root translation**: Mixamo FBX is authored in centimeters, so root-bone position
 *    tracks can be ~100x the game's world scale. Rather than detect "which bone is the root" from
 *    the FBX hierarchy and rescale it, every position track is dropped outright (`stripPositionTracks`)
 *    — Mixamo skeletons only ever keyframe position on the root/hip bone in the first place
 *    (everything else is rotation-only), and the game's locomotion is already procedural (anim.ts
 *    scales the walk clip's timeScale off actual ground speed, not baked root motion), so an
 *    in-place idle/walk/sit/lie loop has no use for translation tracks regardless of their scale.
 *  - **clip naming**: Mixamo exports every clip embedded-named "mixamo.com" (or blank). `resolveClipName`
 *    falls back to the file's basename (no extension) whenever the embedded name is missing or
 *    already used, so multiple FBX sources stay distinguishable in the Animation Mapper's dropdowns.
 */
export async function loadFbxClips(
  url: string,
  targetBoneNames: string[],
  usedClipNames: Set<string>,
): Promise<{ clips: THREE.AnimationClip[]; unmatchedTracks: string[] }> {
  const object = await loadFbxTemplate(url);
  const stem = fileStem(url);
  const boneSet = new Set(targetBoneNames);
  const unmatchedTracks: string[] = [];
  const clips = (object.animations ?? []).map((clip) => {
    const trackNames = clip.tracks.map((t) => t.name);
    const { kept } = stripPositionTracks(trackNames);
    const keptSet = new Set(kept);
    const tracks: THREE.KeyframeTrack[] = [];
    for (const track of clip.tracks) {
      if (!keptSet.has(track.name)) continue; // root/position track dropped
      const r = retargetTrackName(track.name, boneSet);
      if (!r.matched) unmatchedTracks.push(track.name);
      if (r.trackName === track.name) { tracks.push(track); continue; }
      const renamed = track.clone();
      renamed.name = r.trackName;
      tracks.push(renamed);
    }
    const name = resolveClipName(clip.name, stem, usedClipNames);
    usedClipNames.add(name);
    return new THREE.AnimationClip(name, clip.duration, tracks, clip.blendMode);
  });
  return { clips, unmatchedTracks };
}

/**
 * Load the rigged character GLB (single sim → no template caching / SkeletonUtils cloning
 * needed) and normalize it to the tuned height. Rejects on load failure — the caller
 * keeps the capsule stand-in, same philosophy as furniture placeholders.
 */
export function loadRiggedCharacter(character: CharacterTuning, trackInitialLoad?: TrackInitialLoad): Promise<LoadedCharacter> {
  const task = (async (): Promise<LoadedCharacter> => {
  const norm = (p: string) => (/^(\/|https?:)/.test(p) ? p : '/' + p);
  const loader = new GLTFLoader();
  const load = (u: string) =>
    new Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>(
      (resolve, reject) => loader.load(u, resolve, undefined, reject),
    );
  const gltf = await load(norm(character.meshPath));
  const targetBoneNames = collectBoneNames(gltf.scene);
  const usedClipNames = new Set<string>(gltf.animations.map((c) => c.name).filter(Boolean));
  const unmatchedTracks: string[] = [];
  // Mixamo-style workflows ship each animation as its own file (same skeleton) — merge their
  // clips. `.fbx` sources go through loadFbxClips (Mixamo-quirk handling, see its doc comment
  // above); every other extension keeps the exact original GLB merge path, unchanged.
  const extras = await Promise.all(
    (character.animationPaths ?? []).map((p) => {
      const u = norm(p);
      if (isFbxPath(u)) {
        return loadFbxClips(u, targetBoneNames, usedClipNames)
          .then(({ clips, unmatchedTracks: unmatched }) => { unmatchedTracks.push(...unmatched); return clips; })
          .catch((err) => { console.warn(`animation source failed to load: ${p}`, err); return [] as THREE.AnimationClip[]; });
      }
      return load(u).then(
        (g) => { for (const c of g.animations) if (c.name) usedClipNames.add(c.name); return g.animations; },
        (err) => { console.warn(`animation source failed to load: ${p}`, err); return [] as THREE.AnimationClip[]; },
      );
    }),
  );
  if (unmatchedTracks.length) {
    console.warn(`FBX animation source(s) had ${unmatchedTracks.length} bone track(s) that didn't match the character rig (game/fbxclips.ts) — those tracks will be static in-game: ${unmatchedTracks.join(', ')}`);
  }
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
  })();
  // One tracked unit spans the base rig and every dependent animation source. The dependent
  // requests begin only after the skeleton arrives, so this keeps boot sealing race-free.
  return trackInitialLoad ? trackInitialLoad(task) : task;
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
