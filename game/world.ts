// world.ts — turns data (map + assets) into a three.js scene.
// Phase 0: procedural stand-in meshes sized by each asset's footprint.
// Phase 0/1: swap stand-ins for GLB loads from asset.mesh once the starter pack is imported.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import type { GameData, AssetDef, CharacterTuning, MapData } from './data';
import { resolveExterior, DEFAULT_BACKDROP_DISTANCE, type ResolvedBackdrop } from './exterior';
import { classifyMeshPath, createSpriteInstance, preloadGif } from './sprites';
import { retargetTrackName, stripPositionTracks, resolveClipName, fileStem } from './fbxclips';
import { resolveWindowConfig, windowFacePositions, windowPaneRect } from './windows';
import { wallCutShownHeight } from './wallview';
import { resolveAssetLight } from './assetstate';
import { resolveMetersPerTile, effectiveMetersPerTile, textureRepeat, polygonBounds } from './textures';
import { aperturesForWall, wallSegments, lintelVisibleUnderCut, isCurtainWall, resolveMullionSpacing, mullionPositions } from './wallaperture';

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
  mat: THREE.MeshLambertMaterial,
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
 *  - xOffset/yOffset/zOffset: nudge the model along each world axis post-grounding (e.g. a door
 *    sitting flush in its frame). Each is sparse — an absent axis is 0. yOffset predates the
 *    other two (single-axis vertical nudge) and is unchanged; xOffset/zOffset are a backward-
 *    compatible superset, so data carrying only yOffset behaves exactly as before.
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
  // Re-anchor to the footprint center + ground plane AFTER scale/yaw. Both of those transform
  // about the model's LOCAL origin, which for most GLBs is NOT its bounding-box center — so either
  // one drifts the mesh off the footprint center normalizeModelToFootprint just established (a
  // scaled/rotated model slides sideways and can sink through the floor). Recentering here keeps
  // the FOOTPRINT put (it drives placement/nav) and makes the offsets below a clean nudge of the
  // MESH relative to that center — identical in-game and in the Asset Editor preview, since both
  // call this one function. Skipped when the object has no measurable bounds (e.g. the pure-offset
  // unit tests pass a geometry-less Group): offsets then apply directly, unchanged.
  const box = new THREE.Box3().setFromObject(model);
  if (!box.isEmpty()) {
    const center = box.getCenter(new THREE.Vector3());
    model.position.x -= center.x;
    model.position.z -= center.z;
    model.position.y -= box.min.y;
  }
  if (fit.xOffset) model.position.x += fit.xOffset;
  if (fit.yOffset) model.position.y += fit.yOffset;
  if (fit.zOffset) model.position.z += fit.zOffset;
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
      applyMeshFit(model, def.meshFit);
      if (def.wallMounted) {
        // Center the (already scale/offset-corrected) mesh vertically on its mount point; runs
        // AFTER applyMeshFit so a wall asset carrying meshFit.scale still centers on its final size.
        const box = new THREE.Box3().setFromObject(model);
        model.position.y -= box.getCenter(new THREE.Vector3()).y;
      }
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
      applySurfaceTexture(mat, normalizeMeshUrl(floor.texture), [textureRepeat(b.w, mpt), textureRepeat(b.h, mpt)], trackInitialLoad);
    }
    root.add(mesh);
  }

  // --- walls: either door gaps encoded as separate segments in the data (legacy form), or
  // continuous walls that D1 ON-WALL doors cut apertures through (game/wallaperture.ts). A wall
  // with no cutting doors produces exactly ONE full-size segment — byte-identical to the pre-D1
  // single-box path; a cut wall is rebuilt from left/right solid segments + a lintel above each
  // aperture, pure box arithmetic (no CSG). EVERY segment carries the wall's full material
  // behavior: per-side texture/textureB, the shared black top, and the wall-cut view userData.
  const wallMat = new THREE.MeshLambertMaterial({ color: 0xf0ead9 });
  // Designer request (B9-1 follow-up): every wall's TOP face renders flat black — no texture, no
  // lighting shading — for an "architecture plan" look in the wall-cut view. MeshBasicMaterial is
  // unlit so it can't be shaded; one shared instance across all walls (never mutated per-wall).
  const wallTopMat = new THREE.MeshBasicMaterial({ color: data.tuning.view?.wallTopColor ?? '#000000' });
  // D3 curtain-wall façade: a translucent glazed pane (windowPane material precedent) plus vertical
  // mullion boxes. Both shared across all curtain walls (never mutated per-wall). KIND WINS OVER
  // TEXTURE — a curtainWall's texture/textureB/textureScale are ignored (glazing has no texture);
  // its top face still gets the shared black wallTopMat (B10-1), and it still composes with D1 door
  // apertures (wallSegments below cuts it) and the wall-cut view (same 'wall' userData tags).
  const curtainGlazingMat = new THREE.MeshPhysicalMaterial({ color: 0x9edff4, transparent: true, opacity: 0.34, roughness: 0.05, metalness: 0.05, side: THREE.DoubleSide, depthWrite: false });
  const mullionMat = new THREE.MeshLambertMaterial({ color: 0x555a60 });
  const WALL_H = 2.5, WALL_T = 0.12;
  const MULLION_W = 0.06, MULLION_D = WALL_T + 0.02; // slightly proud of the glazing so it reads
  const mullionSpacing = resolveMullionSpacing(data.tuning.facade?.mullionSpacingMeters);
  const doorDefFor = (assetId: string | undefined) => (assetId ? byId.get(assetId) : undefined);
  for (const wall of map.walls) {
    const [x1, z1] = wall.from, [x2, z2] = wall.to;
    const len = Math.hypot(x2 - x1, z2 - z1);
    const dx = x2 - x1, dz = z2 - z1;
    const ux = len > 0 ? dx / len : 0, uz = len > 0 ? dz / len : 0;
    const curtain = isCurtainWall(wall);
    const mpt = effectiveMetersPerTile(metersPerTile, wall.textureScale); // per-surface scale follow-up
    // Which local face (+z or -z) is "side A" depends on the wall's actual placement, not on
    // from/to point order: local +z's world-space outward normal, after mesh.rotation.y below,
    // is (-dz/len, dx/len) in the world XZ plane (see game/data.ts walls doc for the A/B
    // convention). Horizontal wall (runs mostly along X) → normal is mostly along Z, A = the
    // face pointing world +Z ("south"). Vertical wall (runs mostly along Z) → normal is mostly
    // along X, A = the face pointing world +X ("east"). Shared by every segment of this wall.
    const horizontal = Math.abs(dx) >= Math.abs(dz);
    const localPlusZFacesA = horizontal ? ux > 0 : -uz > 0;
    const apertures = aperturesForWall(wall, map.doors, doorDefFor, WALL_H);
    for (const seg of wallSegments(len, WALL_H, apertures)) {
      const geo = new THREE.BoxGeometry(seg.alongLength, seg.height, WALL_T);
      if (curtain) {
        // D3: glazed segment — translucent panes on the four side faces, the shared black top
        // (index 2), plain glazing bottom. Texture fields are deliberately NOT read (kind wins).
        // Tagged exactly like a solid/lintel wall segment so the wall-cut view scales/hides it the
        // same way (D1 lintels above a balcony door still HIDE under the cut).
        const glassMats: THREE.Material[] = [curtainGlazingMat, curtainGlazingMat, wallTopMat, curtainGlazingMat, curtainGlazingMat, curtainGlazingMat];
        const glassMesh = new THREE.Mesh(geo, glassMats);
        glassMesh.position.set(x1 + ux * seg.alongCenter, seg.yCenter, z1 + uz * seg.alongCenter);
        glassMesh.rotation.y = -Math.atan2(dz, dx);
        glassMesh.userData.wallCutVisual = seg.kind === 'lintel' ? 'lintel' : 'wall';
        glassMesh.userData.wallCutFullHeight = WALL_H;
        root.add(glassMesh);
        continue;
      }
      // A textured segment gets its own material so the swap doesn't hit the shared color wallMat
      // (and each segment's repeat differs with its dimensions, so materials are per-SEGMENT).
      // Every segment always gets a 6-entry material array — BoxGeometry's default face groups are
      // [+x,-x,+y,-y,+z,-z] (indices 0..5); the wall's two BIG faces are the local +z/-z ones
      // (index 4/5), since the box is long in x (length) and thin in z (WALL_T). Index 2 (+y, top)
      // is always the shared flat-black wallTopMat regardless of texture/textureB; index 3 (-y,
      // bottom) stays side A, same as the edge faces.
      let matA: THREE.MeshLambertMaterial | undefined;
      let matB: THREE.MeshLambertMaterial | undefined;
      let sideA: THREE.Material;
      // textureB semantics: undefined = same as side A (single material); a path = that texture on
      // side B; null = side B stays PLAIN COLOR even though side A is textured ("(none)" in the tool).
      if (wall.textureB !== undefined) {
        matA = new THREE.MeshLambertMaterial({ color: 0xf0ead9 });
        matB = new THREE.MeshLambertMaterial({ color: 0xf0ead9 });
        sideA = matA;
      } else {
        sideA = wall.texture ? new THREE.MeshLambertMaterial({ color: 0xf0ead9 }) : wallMat;
        if (wall.texture) matA = sideA as THREE.MeshLambertMaterial;
      }
      const materials: THREE.Material[] = [sideA, sideA, wallTopMat, sideA, sideA, sideA];
      if (matB) {
        materials[4] = localPlusZFacesA ? matA! : matB; // local +z
        materials[5] = localPlusZFacesA ? matB : matA!; // local -z
      }
      const mesh = new THREE.Mesh(geo, materials);
      mesh.position.set(x1 + ux * seg.alongCenter, seg.yCenter, z1 + uz * seg.alongCenter);
      mesh.rotation.y = -Math.atan2(dz, dx);
      // Wall-cut view: solid segments are ground-to-top boxes and scale exactly like a whole wall
      // (same 'wall' tag + full height). A lintel hangs above the aperture, so it HIDES under the
      // cut instead (window precedent) — see wallaperture.ts's lintelVisibleUnderCut.
      mesh.userData.wallCutVisual = seg.kind === 'lintel' ? 'lintel' : 'wall';
      mesh.userData.wallCutFullHeight = WALL_H;
      mesh.castShadow = true;
      if (wall.texture || wall.textureB) {
        // Repeat comes from THIS SEGMENT's dimensions so tiling stays physical on every box; a
        // solid segment's v-repeat still spans the FULL height (its height IS WALL_H) and the
        // wall-cut view just compresses it vertically with the geometry — acceptable per B9-1
        // (documented, not re-mapped). A lintel's v-repeat spans its own (shorter) height.
        const repeat: [number, number] = [textureRepeat(seg.alongLength, mpt), textureRepeat(seg.height, mpt)];
        if (wall.texture && matA) applySurfaceTexture(matA, normalizeMeshUrl(wall.texture), repeat, trackInitialLoad);
        if (wall.textureB && matB) applySurfaceTexture(matB, normalizeMeshUrl(wall.textureB), repeat, trackInitialLoad);
      }
      root.add(mesh);
    }
    if (curtain) {
      // D3: vertical mullion posts at the tuned spacing, skipping door-aperture spans (pure
      // mullionPositions). Full-height boxes tagged as ordinary wall so the wall-cut view scales
      // them with the glazing.
      for (const along of mullionPositions(len, mullionSpacing, apertures)) {
        const mullion = new THREE.Mesh(new THREE.BoxGeometry(MULLION_W, WALL_H, MULLION_D), mullionMat);
        mullion.position.set(x1 + ux * along, WALL_H / 2, z1 + uz * along);
        mullion.rotation.y = -Math.atan2(dz, dx);
        mullion.userData.wallCutVisual = 'wall';
        mullion.userData.wallCutFullHeight = WALL_H;
        mullion.castShadow = true;
        root.add(mullion);
      }
    }
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

  // --- D4 simplified exterior: a ground plane + optional distant backdrop, built INTO the world so
  // a map switch / hot-reload rebuilds & disposes it with everything else. These carry NO
  // wallCutVisual userData (excluded from the wall-cut view) and NO nav footprint (bakeNavGrid reads
  // map data, never the world group), and their `raycast` is disabled so they are never tap/hover
  // targets. Sky color + fog live on the SCENE (applyExteriorScene, called from main.ts) since they
  // are scene-level; the day/night tint of sky + this ground is applied by applyDayNight.
  buildExteriorInto(root, map, trackInitialLoad);

  return root;
}

// D4 constants: how dark the custom sky / ground go at night (multiplied into the day color, the
// same "lerp between a dim and a bright value by the daylight factor" idea the sun/ambient use).
const EXTERIOR_SKY_NIGHT_SCALE = 0.32;
const EXTERIOR_GROUND_NIGHT_SCALE = 0.4;

/** Build the D4 exterior visuals (ground plane + backdrop) into the world root. No-op when the map
 *  has no exterior block (today's void). Pure config resolution is game/exterior.ts. */
function buildExteriorInto(root: THREE.Group, map: MapData, trackInitialLoad?: TrackInitialLoad) {
  const resolved = resolveExterior(map.exterior);
  if (!resolved.present) return;
  const cx = map.bounds.w / 2, cz = map.bounds.h / 2; // map center in world XZ
  const distance = resolved.backdrop?.distance ?? DEFAULT_BACKDROP_DISTANCE;

  if (resolved.groundColor) {
    // One big plane, well beyond the backdrop distance so the horizon reads as solid ground.
    const size = Math.max(2 * distance + Math.max(map.bounds.w, map.bounds.h) + 40, 200);
    const geo = new THREE.PlaneGeometry(size, size);
    geo.rotateX(-Math.PI / 2);
    const day = new THREE.Color(resolved.groundColor);
    const mat = new THREE.MeshLambertMaterial({ color: day.clone() });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'exteriorGround';
    mesh.position.set(cx, -0.05, cz); // just below the floor so it never z-fights the interior
    mesh.receiveShadow = true;
    mesh.userData.exteriorDayColor = day; // applyDayNight tints the material from this base color
    mesh.raycast = () => {}; // cosmetic environment — never a tap/hover target
    root.add(mesh);
  }

  if (resolved.backdrop) buildBackdropInto(root, resolved.backdrop, cx, cz, trackInitialLoad);
}

/** A single distant backdrop: a GLB mesh, or (for an image path) a large wraparound billboard ring
 *  (open cylinder textured on the inside). Keep-stand-in: the ring/GLB group is added immediately;
 *  a load failure warns ONCE and leaves the sky/ground colors intact. */
function buildBackdropInto(root: THREE.Group, backdrop: ResolvedBackdrop, cx: number, cz: number, trackInitialLoad?: TrackInitialLoad) {
  const url = normalizeMeshUrl(backdrop.path);
  if (backdrop.kind === 'mesh') {
    const group = new THREE.Group();
    group.name = 'exteriorBackdrop';
    group.position.set(cx, 0, cz);
    group.raycast = () => {};
    root.add(group);
    const ready = loadMeshTemplate(url)
      .then((tpl) => {
        const clone = tpl.clone(true);
        clone.traverse((o) => {
          o.raycast = () => {};
          if (o instanceof THREE.Mesh) {
            o.userData.sharedResource = true; // shares the cached template's buffers — skip disposal
            const m = o.material as THREE.Material | THREE.Material[];
            (Array.isArray(m) ? m : [m]).forEach((mm) => { if (mm) (mm as { fog?: boolean }).fog = false; });
          }
        });
        group.add(clone);
      })
      .catch(() => console.warn(`Could not load exterior backdrop "${backdrop.path}" — keeping sky/ground colors.`));
    void (trackInitialLoad ? trackInitialLoad(ready) : ready);
    return;
  }
  // image → wraparound billboard ring surrounding the map at the backdrop distance.
  const r = backdrop.distance;
  const h = Math.max(r * 0.85, 8);
  const geo = new THREE.CylinderGeometry(r, r, h, 48, 1, true);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide, fog: false });
  const ring = new THREE.Mesh(geo, mat);
  ring.name = 'exteriorBackdrop';
  ring.position.set(cx, h * 0.28, cz); // centered a little above the horizon
  ring.raycast = () => {};
  root.add(ring);
  const ready = loadTexture(url)
    .then((base) => {
      const tex = base.clone();
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      mat.map = tex;
      mat.needsUpdate = true;
    })
    .catch(() => console.warn(`Could not load exterior backdrop image "${backdrop.path}" — keeping sky/ground colors.`));
  void (trackInitialLoad ? trackInitialLoad(ready) : ready);
}

/** Apply the SCENE-level parts of the D4 exterior: sky background color, fog, and a cached ground
 *  reference for the per-frame day/night tint. Called at boot and on every hot-reload / map switch
 *  (after buildWorld rebuilds the world), so the exterior swaps with the map. The ground plane and
 *  backdrop themselves live in the world (buildExteriorInto). Absent sky/fog reverts to the default
 *  sky and no fog, so switching from an exterior map back to a void map cleans up. */
export function applyExteriorScene(scene: THREE.Scene, world: THREE.Group, map: MapData) {
  const resolved = resolveExterior(map.exterior);
  if (resolved.skyColor) {
    const day = new THREE.Color(resolved.skyColor);
    scene.userData.exteriorSky = { day, night: day.clone().multiplyScalar(EXTERIOR_SKY_NIGHT_SCALE) };
    if (scene.background instanceof THREE.Color) scene.background.copy(day);
    else scene.background = day.clone();
  } else {
    delete scene.userData.exteriorSky;
    if (scene.background instanceof THREE.Color) scene.background.setHex(0x2a3346);
  }
  scene.fog = resolved.fog ? new THREE.Fog(new THREE.Color(resolved.fog.color).getHex(), resolved.fog.near, resolved.fog.far) : null;
  // O(1) ground handle for applyDayNight (avoids a full scene traversal every frame).
  scene.userData.exteriorGround = resolved.groundColor ? (world.getObjectByName('exteriorGround') ?? null) : null;
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
    // D1: a lintel segment hangs entirely above its door aperture — scaling it from the ground
    // would drop a floating slab into the doorway, so it hides like a window instead (pure
    // decision in game/wallaperture.ts's lintelVisibleUnderCut, headless-tested).
    if (kind === 'lintel') {
      object.visible = lintelVisibleUnderCut(active);
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
  // Sky: a D4 exterior map supplies its own day/night pair (applyExteriorScene); otherwise the
  // default interior sky pair is used — same lerp-by-daylight-factor as the lights above.
  const exSky = scene.userData.exteriorSky as { day: THREE.Color; night: THREE.Color } | undefined;
  if (scene.background instanceof THREE.Color) {
    if (exSky) scene.background.lerpColors(exSky.night, exSky.day, f);
    else scene.background.lerpColors(SKY_NIGHT, SKY_DAY, f);
  }
  // D4 ground plane: tint its material between a dimmed night value and its authored day color,
  // exactly like the sky. The handle is cached on the scene so this stays O(1) per frame.
  const ground = scene.userData.exteriorGround as THREE.Mesh | null | undefined;
  if (ground) {
    const day = ground.userData.exteriorDayColor as THREE.Color | undefined;
    const mat = ground.material as THREE.MeshLambertMaterial | undefined;
    if (day && mat && mat.color) mat.color.copy(day).multiplyScalar(THREE.MathUtils.lerp(EXTERIOR_GROUND_NIGHT_SCALE, 1, f));
  }
}
