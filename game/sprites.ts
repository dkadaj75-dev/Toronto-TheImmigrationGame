// sprites.ts — image/GIF asset visuals (PROJECT_CONTEXT.md §7.5). Split like doors.ts/accidents.ts:
// pure logic (extension classification, sprite-config resolution, GIF frame-timing math) is
// headless-tested in test/sprites.test.ts with zero THREE/browser dependency; the thin three.js
// layer below (createSpriteInstance) turns an image path into a textured plane/camera-facing
// sprite, wired into game/world.ts's shared `attachMesh` so furniture, accidents, and (optionally)
// any other mesh-loading call site get sprite support through the SAME extension-detection point
// rather than three separate copies of the same check.
//
// EXTENSION DETECTION: the mesh-loading path already only ever sees a single `AssetDef.mesh`
// string — classifyMeshPath(path) is the one place that decides GLB-vs-image, so world.ts's
// attachMesh, doors.ts, and accidents.ts all agree on the same rule with no drift.
//
// BILLBOARD MECHANISM (documented choice): "billboard" orientation uses a real THREE.Sprite —
// three.js's built-in always-faces-the-camera primitive (full billboarding, not just a Y-axis
// spin) — rather than a manually-rotated plane, since that's exactly the "fire/smoke always
// faces the camera" behavior §7.5 asks for and needs no per-frame orientation bookkeeping beyond
// what three.js already does when rendering a Sprite. "flat" orientation is a normal PlaneGeometry
// rotated to lie on the XZ plane (a real mesh, so it reads correctly as debris/a puddle from any
// angle, including top-down).
//
// GIF DECODE PATH: prefers the browser `ImageDecoder` (WebCodecs) API — decodes every frame once
// up front into an array of small canvases + that frame's delay (ms), then during playback draws
// the current frame into a SINGLE shared `THREE.CanvasTexture`'s backing canvas and flips
// `needsUpdate` only when the frame index actually changes (not every render tick) — "keep the
// per-frame cost cheap" per §7.5. Where `ImageDecoder` doesn't exist (or decoding fails), falls
// back to a plain `THREE.TextureLoader` load, which — for an animated GIF — the browser's own
// <img> decoding naturally renders as a static first frame; this fallback is also what a plain
// .png/.jpg/.webp always takes. BROWSER-ONLY, NOT HEADLESS-TESTABLE: jsdom has neither WebGL nor
// ImageDecoder, so decodeGifFrames()/createSpriteInstance() are exercised only by the manual
// `npm run dev` sanity check documented in PROJECT_CONTEXT.md §7.5's as-built note, never by
// test/sprites.test.ts (which covers exactly the pure functions below).

import * as THREE from 'three';
import type { AssetDef } from './data';

// ==================================================================== pure logic (headless-tested)

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);

/** Lower-cased file extension (no dot), ignoring a trailing query string or hash. Empty string
 *  if the path has none (e.g. an extensionless URL — classified as a model, see below). */
export function extensionOf(path: string): string {
  const m = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(path.trim());
  return m ? m[1].toLowerCase() : '';
}

export type MeshKind = 'model' | 'image';

/** §7.5's extension-detection rule: `.glb`/`.gltf` (or anything unrecognized, e.g. an empty/
 *  extensionless path) keeps going through the existing GLB flow; `.png`/`.jpg`/`.jpeg`/`.webp`/
 *  `.gif` become the image flow. Unknown extensions default to 'model' rather than 'image' so a
 *  typo'd or as-yet-unsupported format still attempts the pre-existing (safe, catch-guarded) GLB
 *  loader rather than silently doing nothing. */
export function classifyMeshPath(path: string): MeshKind {
  return IMAGE_EXTENSIONS.has(extensionOf(path)) ? 'image' : 'model';
}

export function isGifPath(path: string): boolean {
  return extensionOf(path) === 'gif';
}

export interface SpriteConfig { orientation: 'billboard' | 'flat'; fps?: number }

/** Sparse `AssetDef.sprite` resolved with its one default: orientation absent = 'billboard'
 *  (§7.5). `fps` stays undefined (meaning "use the GIF's own per-frame delays") unless set. */
export function resolveSpriteConfig(def: Pick<AssetDef, 'sprite'>): SpriteConfig {
  return { orientation: def.sprite?.orientation ?? 'billboard', fps: def.sprite?.fps };
}

/** Per-frame durations in ms actually used for playback: `fps`, if set, overrides the GIF's own
 *  per-frame delays UNIFORMLY (every frame gets the same 1000/fps duration) — §7.5: "fps
 *  overrides the GIF's own frame delays if set." Without an fps override, the GIF's native
 *  per-frame delays pass through unchanged. */
export function frameDurationsMs(gifDelaysMs: number[], fps?: number): number[] {
  if (fps && fps > 0) return gifDelaysMs.map(() => 1000 / fps);
  return gifDelaysMs;
}

/**
 * Which frame index is showing at `elapsedMs` of accumulated SIM time (not wall time — pausing
 * freezes this, 2x/3x speeds it up, exactly like game/doors.ts's swing timing and the animation
 * mixer), given each frame's duration in ms. Loops via modulo over the total duration — an
 * animated GIF just keeps cycling for as long as the asset exists. Zero frames or a
 * zero-or-negative total duration (e.g. every delay is 0) is defined as frame 0 rather than
 * dividing by zero or looping forever on the first frame.
 */
export function frameIndexAtTime(durationsMs: number[], elapsedMs: number): number {
  if (durationsMs.length === 0) return 0;
  const total = durationsMs.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  let t = elapsedMs % total;
  if (t < 0) t += total; // defensive: elapsedMs is only ever accumulated forward, but stay correct if a caller ever rewinds
  for (let i = 0; i < durationsMs.length; i++) {
    if (t < durationsMs[i]) return i;
    t -= durationsMs[i];
  }
  return durationsMs.length - 1; // floating-point fallback — lands on the last frame, never throws
}

/** Plane dimensions (world meters) for an image-backed visual: the asset's footprint, scaled by
 *  `meshFit.scale` exactly like a GLB's automatic footprint-fit is further adjusted by it (§7.1/
 *  §7.2) — uniform number or per-axis [x,y,z] (only x/y are meaningful for a 2D plane; z is
 *  ignored, there being no depth to scale). footprint[1] doubles as either the "flat" plane's
 *  floor-depth or the "billboard" sprite's vertical height, whichever orientation is active. */
export function spritePlaneSize(def: Pick<AssetDef, 'footprint' | 'meshFit'>): [number, number] {
  const [fw, fd] = def.footprint;
  const scale = def.meshFit?.scale;
  if (Array.isArray(scale)) return [fw * scale[0], fd * scale[1]];
  if (typeof scale === 'number') return [fw * scale, fd * scale];
  return [fw, fd];
}

function clamp(v: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, v)); }

// ==================================================================== three.js layer

/** Small gap above the floor for a "flat" plane, avoiding z-fighting with the floor mesh
 *  underneath — the same purpose as any other "epsilon above ground" trick, just named here. */
const FLAT_EPSILON = 0.005;

export interface SpriteInstance {
  /** The plane (flat) or THREE.Sprite (billboard) to add into the scene graph. */
  readonly object: THREE.Object3D;
  /** Resolves once the FIRST frame/texture is actually showing — callers (world.ts's attachMesh)
   *  swap the stand-in for `object` only on success, matching the GLB flow's "keep the stand-in
   *  until the async load succeeds" rule; rejects if even the static-first-frame fallback fails
   *  (e.g. a 404), so a caller's `.catch()` can keep the stand-in exactly like a missing GLB does. */
  readonly ready: Promise<void>;
  /** Advances GIF frame playback by `dtSeconds` of SIM time; a no-op for a static image (nothing
   *  to advance) or before the first successful decode. Cheap: only redraws the canvas texture
   *  when the computed frame index actually changes. */
  update(dtSeconds: number): void;
  dispose(): void;
}

/**
 * Builds the image-backed visual for `def` (mesh already known to classify as 'image' by the
 * caller). `url` is the already-normalized (leading-slash) path.
 */
export function createSpriteInstance(def: AssetDef, url: string): SpriteInstance {
  const cfg = resolveSpriteConfig(def);
  const [w, h] = spritePlaneSize(def);
  const yOff = def.meshFit?.yOffset ?? 0;

  let object: THREE.Object3D;
  let material: THREE.SpriteMaterial | THREE.MeshBasicMaterial;
  if (cfg.orientation === 'flat') {
    const geo = new THREE.PlaneGeometry(Math.max(w, 1e-3), Math.max(h, 1e-3));
    geo.rotateX(-Math.PI / 2); // lie flat on the XZ plane
    material = new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, depthWrite: false });
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.y = FLAT_EPSILON + yOff;
    object = mesh;
  } else {
    material = new THREE.SpriteMaterial({ transparent: true, alphaTest: 0.5 });
    const sprite = new THREE.Sprite(material);
    sprite.center.set(0.5, 0); // bottom-anchored, matching a GLB's y=0 grounding
    sprite.scale.set(Math.max(w, 1e-3), Math.max(h, 1e-3), 1);
    sprite.position.y = yOff;
    object = sprite;
  }

  let canvas: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let canvasTexture: THREE.CanvasTexture | null = null;
  let frames: CanvasImageSource[] = [];
  let durationsMs: number[] = [];
  let lastIndex = -1;
  let elapsedMs = 0;

  const applyTexture = (tex: THREE.Texture) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    material.map = tex;
    material.needsUpdate = true;
  };

  const loadStatic = (): Promise<void> =>
    new Promise((resolve, reject) => {
      new THREE.TextureLoader().load(url, (tex) => { applyTexture(tex); resolve(); }, undefined, reject);
    });

  const canTryGifDecode = isGifPath(url) && typeof (globalThis as { ImageDecoder?: unknown }).ImageDecoder !== 'undefined';

  const ready: Promise<void> = canTryGifDecode
    ? cachedDecodeGifFrames(url)
        .then(({ frames: decoded, delaysMs }) => {
          frames = decoded;
          durationsMs = frameDurationsMs(delaysMs, cfg.fps);
          const first = decoded[0];
          canvas = document.createElement('canvas');
          canvas.width = (first as HTMLCanvasElement).width ?? w;
          canvas.height = (first as HTMLCanvasElement).height ?? h;
          ctx = canvas.getContext('2d');
          ctx?.drawImage(first, 0, 0);
          canvasTexture = new THREE.CanvasTexture(canvas);
          applyTexture(canvasTexture);
        })
        .catch((err) => {
          console.warn(`GIF frame decode failed for "${def.id}" (${url}) — falling back to a static first frame.`, err);
          return loadStatic();
        })
    : loadStatic();

  return {
    object,
    ready,
    update(dtSeconds) {
      if (!ctx || !canvas || !canvasTexture || durationsMs.length < 2) return; // static image, or not yet decoded
      elapsedMs += dtSeconds * 1000;
      const idx = clamp(frameIndexAtTime(durationsMs, elapsedMs), 0, frames.length - 1);
      if (idx === lastIndex) return;
      lastIndex = idx;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(frames[idx], 0, 0);
      canvasTexture.needsUpdate = true;
    },
    dispose() {
      material.map?.dispose();
      material.dispose();
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    },
  };
}

/**
 * Decodes every frame of an animated GIF via the WebCodecs `ImageDecoder` API into an array of
 * small canvases plus that frame's delay (ms). Browser-only (uses `fetch`, `ImageDecoder`,
 * `VideoFrame`, `document.createElement('canvas')`) — not exercised by the headless suite; see
 * the module doc comment. `VideoFrame.duration` is in MICROSECONDS per the WebCodecs spec, hence
 * the /1000; a codec that reports no duration falls back to a 100ms default per frame rather
 * than throwing.
 */
// ROADMAP_NEXT B3-1(b): decoded GIF frames are cached per URL (mirrors world.ts's gltfCache for
// GLB templates) — without this, every spawned instance of the same transient asset (e.g. a
// second stove fire) re-fetched and re-decoded the SAME gif from scratch, which is also why the
// FIRST spawn ever always showed the stand-in box for a beat (async decode with nothing warm to
// reuse). `preloadGif`/`warmSpriteCache` (below) kick this cache off eagerly at world-build time
// so by the time anything actually spawns, decode is already done or in flight.
const gifDecodeCache = new Map<string, Promise<{ frames: HTMLCanvasElement[]; delaysMs: number[] }>>();

function cachedDecodeGifFrames(url: string): Promise<{ frames: HTMLCanvasElement[]; delaysMs: number[] }> {
  let p = gifDecodeCache.get(url);
  if (!p) {
    p = decodeGifFrames(url);
    gifDecodeCache.set(url, p);
  }
  return p;
}

/** Eagerly warms the GIF-decode cache for one URL — fire-and-forget, errors swallowed (the real
 *  consumer, createSpriteInstance's `ready` promise, still runs its own decode-then-fallback path
 *  and reports failures there; this is purely a "get a head start" call). No-op for a non-gif URL
 *  or when `ImageDecoder` isn't available — callers should gate on the same conditions
 *  `createSpriteInstance` itself uses (see `warmSpriteCache` below, world.ts's one caller). */
export function preloadGif(url: string): Promise<void> {
  if (!isGifPath(url) || typeof (globalThis as { ImageDecoder?: unknown }).ImageDecoder === 'undefined') return Promise.resolve();
  return cachedDecodeGifFrames(url).then(() => undefined).catch(() => {}); // failure is handled by the real decode attempt later
}

async function decodeGifFrames(url: string): Promise<{ frames: HTMLCanvasElement[]; delaysMs: number[] }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const buf = await res.arrayBuffer();
  const ImageDecoderCtor = (globalThis as { ImageDecoder?: new (init: unknown) => any }).ImageDecoder!;
  const decoder = new ImageDecoderCtor({ data: buf, type: 'image/gif' });
  await decoder.tracks.ready;
  const track = decoder.tracks.selectedTrack;
  const frameCount: number = track?.frameCount ?? 1;
  const frames: HTMLCanvasElement[] = [];
  const delaysMs: number[] = [];
  for (let i = 0; i < frameCount; i++) {
    const { image } = await decoder.decode({ frameIndex: i });
    const w = image.displayWidth as number, h = image.displayHeight as number;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const cctx = c.getContext('2d')!;
    cctx.drawImage(image, 0, 0, w, h); // VideoFrame implements CanvasImageSource
    const durationUs = image.duration as number | null;
    delaysMs.push(durationUs ? durationUs / 1000 : 100);
    image.close();
    frames.push(c);
  }
  decoder.close?.();
  return { frames, delaysMs };
}
