// buymode.ts — Buy/Sell mode (PROJECT_CONTEXT.md §7.6). Split like doors.ts/accidents.ts: pure
// logic (catalog filtering, placement validity, the runtime overlay registry incl.
// serialize()/restore(), buy/sell/move flows) is headless-tested in test/buymode.test.ts with
// zero THREE dependency; a thin three.js layer (BuyModeController) below turns that into ghost
// placement, live meshes for purchased furniture, and the designer-object override patching that
// main.ts wires into the tap/HUD/nav-rebake code paths.
//
// OVERLAY MODEL (§7.6: "must NOT be written back into the designer's data/maps/*.json"): runtime
// state layered OVER map.placedObjects, never mutating it. Two halves:
//   - `additions`: player-purchased instances (asset id + pos + rotDeg), keyed by a generated
//     `buy#N` string — these don't exist in map data at all, so they need their own live groups
//     (mirrors AccidentRegistry's instances — pure runtime, rendered by a controller-owned Map).
//   - `overrides`: keyed by a designer object's INDEX into map.placedObjects (stable for the
//     lifetime of one loaded map — the array is never reordered by anything in this repo), either
//     `{type:'moved', pos, rotDeg}` or `{type:'sold'}`. world.ts's buildWorld() tags each placed
//     object's userData with that same index (`placedIndex`) specifically so BuyModeController can
//     find "the live Object3D for designer object #i" after every buildWorld() rebuild (hot-reload
//     rebuilds `world` from scratch on every data poll, exactly like AccidentsController.reattach
//     has to re-parent its own groups) and patch it: hide it if sold, reposition it if moved.
//
// NAV REBAKE (§7.6: "Confirm: ... spawn into the world, rebake nav" / "Sell: ... rebakes nav"):
// `effectiveInstances()`/`effectivePlacedObjects()` below produce the SAME `{asset,pos,rotDeg}[]`
// shape MapData.placedObjects uses (designer objects with overrides applied, minus sold ones,
// plus player additions) — main.ts's nav-rebake callback feeds this straight into
// `bakeNavGrid({ ...data.map, placedObjects: effective }, data.assets)`, no changes to nav.ts
// needed. Placement-validity checks reuse this exact same list as the "existing objects" to test
// footprint overlap against, so what you can't walk through is exactly what blocks a new purchase.
//
// SIM-TIME FREEZE: implemented in main.ts's render loop as an `sdt` override
// (`buyMode.active ? 0 : dt * hud.speed`), not by mutating `hud.speed` — see main.ts's comment
// for why (the player's chosen speed selection is completely undisturbed by entering/exiting buy
// mode). Nothing in this module needs to know about game time at all.

import * as THREE from 'three';
import type { AssetDef, AssetsData, GameData } from './data';
import { footprintRect, rectsOverlap, type Rect } from './accidents';
import { attachMesh, makeStandIn } from './world';

// ==================================================================== catalog (pure)

/** §7.6 catalog rule, verbatim: purchasable iff not explicitly unbuyable, not an accident
 *  (belt-and-braces — accidents already ship buyable:false, but never rely on that alone), and
 *  either not quest-gated or already unlocked. Doors are excluded purely because door_basic ships
 *  `buyable:false` — no category special-case, per spec ("no special-casing"). */
export function isPurchasable(def: AssetDef, isUnlocked: (assetId: string) => boolean): boolean {
  if (def.category === 'accident') return false;
  if (def.buyable === false) return false;
  if (def.requiresQuestUnlock && !isUnlocked(def.id)) return false;
  return true;
}

export function isAffordable(def: AssetDef, funds: number): boolean {
  return funds >= def.buyPrice;
}

export interface CatalogFilter { category?: string; search?: string; }

/** Every purchasable asset, independent of affordability (affordability governs graying-out a
 *  card, not whether it's offered at all — an item the player can't afford yet is still "in the
 *  catalog", per the Sims reference). */
export function purchasableCatalog(assets: AssetDef[], isUnlocked: (assetId: string) => boolean): AssetDef[] {
  return assets.filter((a) => isPurchasable(a, isUnlocked));
}

/** Category tabs: only categories with at least one purchasable item, in the data's own order. */
export function catalogCategories(assets: AssetsData, isUnlocked: (assetId: string) => boolean): string[] {
  const purchasable = purchasableCatalog(assets.assets, isUnlocked);
  return assets.categories.filter((c) => purchasable.some((a) => a.category === c));
}

export function filterCatalog(assets: AssetDef[], isUnlocked: (assetId: string) => boolean, filter: CatalogFilter): AssetDef[] {
  const q = (filter.search ?? '').trim().toLowerCase();
  return purchasableCatalog(assets, isUnlocked).filter((a) => {
    if (filter.category && a.category !== filter.category) return false;
    if (q && !a.name.toLowerCase().includes(q) && !a.id.toLowerCase().includes(q)) return false;
    return true;
  });
}

// ==================================================================== placement math (pure)

export function snapToHalfCell(v: number, gridSize: number): number {
  const step = gridSize / 2;
  return Math.round(v / step) * step;
}

export function snapPos(pos: [number, number], gridSize: number): [number, number] {
  return [snapToHalfCell(pos[0], gridSize), snapToHalfCell(pos[1], gridSize)];
}

export function normalizeRotDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** 90°-step rotate, same convention as the Map Editor's own object rotate control (§2b). */
export function rotateStep(deg: number, stepDeg = 90): number {
  return normalizeRotDeg(deg + stepDeg);
}

export interface WallSeg { from: [number, number]; to: [number, number]; }

/** Matches world.ts's WALL_T (0.12m) — the wall render/collision thickness. */
export const WALL_THICKNESS = 0.12;

/**
 * Axis-aligned bounding rect for a wall segment, thickened by WALL_THICKNESS on its perpendicular
 * axis. The Map Editor draws walls "axis-locked and snapped" (§2b) and every wall in the shipped
 * map is exactly horizontal or vertical, so this — rather than an oriented-rect test — is the
 * simplest correct check for this codebase's walls; a wall drawn off-axis (not possible through
 * the Map Editor today) would get a slightly generous (but still safe, never under-sized) rect.
 */
export function wallRect(wall: WallSeg, thickness = WALL_THICKNESS): Rect {
  const [x1, z1] = wall.from, [x2, z2] = wall.to;
  const half = thickness / 2;
  if (Math.abs(x2 - x1) >= Math.abs(z2 - z1)) {
    return { x0: Math.min(x1, x2), x1: Math.max(x1, x2), z0: Math.min(z1, z2) - half, z1: Math.max(z1, z2) + half };
  }
  return { x0: Math.min(x1, x2) - half, x1: Math.max(x1, x2) + half, z0: Math.min(z1, z2), z1: Math.max(z1, z2) };
}

export interface OtherInstance { key: string; pos: [number, number]; rotDeg: number; footprint: [number, number]; }

export interface PlacementCheckInput {
  pos: [number, number];
  rotDeg: number;
  footprint: [number, number];
  bounds: { w: number; h: number };
  walls: WallSeg[];
  others: OtherInstance[];
  /** exclude this key from the overlap check — moving/rotating an instance shouldn't collide with itself */
  excludeKey?: string;
}

/** In-bounds + no wall overlap + no overlap with any other placed instance (§7.6: "green = in
 *  bounds + no footprint overlap with placed objects/walls; red = invalid"). Reuses
 *  accidents.ts's footprintRect/rectsOverlap — same 90°-step width/depth swap rule as nav.ts's
 *  bakeNavGrid and facing.ts's placedHalfExtents, so "what you can walk through" and "what you can
 *  place on top of" agree exactly. */
export function isValidPlacement(input: PlacementCheckInput): boolean {
  const rect = footprintRect(input.pos, input.rotDeg, input.footprint);
  if (rect.x0 < 0 || rect.z0 < 0 || rect.x1 > input.bounds.w || rect.z1 > input.bounds.h) return false;
  for (const w of input.walls) if (rectsOverlap(rect, wallRect(w))) return false;
  for (const o of input.others) {
    if (input.excludeKey && o.key === input.excludeKey) continue;
    if (rectsOverlap(rect, footprintRect(o.pos, o.rotDeg, o.footprint))) return false;
  }
  return true;
}

// ==================================================================== overlay (pure runtime state)

export interface PlacedLike { asset: string; pos: [number, number]; rotDeg: number; }

export interface OverlayAddition { key: string; asset: string; pos: [number, number]; rotDeg: number; }

export type DesignerOverride =
  | { type: 'moved'; pos: [number, number]; rotDeg: number }
  | { type: 'sold' };

export interface BuyOverlaySaveState {
  additions: OverlayAddition[];
  /** Map serialized as entries — designer object index → override. */
  overrides: [number, DesignerOverride][];
  seq: number;
}

/**
 * Pure runtime overlay — no THREE dependency, headless-testable (test/buymode.test.ts). Mirrors
 * AccidentRegistry's/QuestRunner's serialize()/restore() convention (§3.3/§7.3) so a future save
 * system is a direct `JSON.stringify(overlay.serialize())` / `overlay.restore(parsed)` call; until
 * then, purchases/moves/sells are runtime-only and reset on reload, same as needs/skills/quests.
 */
export class BuyOverlay {
  private additions: OverlayAddition[] = [];
  private overrides = new Map<number, DesignerOverride>();
  private seq = 0;

  get allAdditions(): readonly OverlayAddition[] { return this.additions; }

  overrideFor(designerIndex: number): DesignerOverride | undefined { return this.overrides.get(designerIndex); }
  isSold(designerIndex: number): boolean { return this.overrides.get(designerIndex)?.type === 'sold'; }

  addPurchase(asset: string, pos: [number, number], rotDeg: number): OverlayAddition {
    const rec: OverlayAddition = { key: `buy#${this.seq++}`, asset, pos, rotDeg };
    this.additions.push(rec);
    return rec;
  }

  removeAddition(key: string): OverlayAddition | null {
    const idx = this.additions.findIndex((a) => a.key === key);
    if (idx === -1) return null;
    return this.additions.splice(idx, 1)[0];
  }

  moveAddition(key: string, pos: [number, number], rotDeg: number): boolean {
    const a = this.additions.find((x) => x.key === key);
    if (!a) return false;
    a.pos = pos; a.rotDeg = rotDeg;
    return true;
  }

  moveDesigner(designerIndex: number, pos: [number, number], rotDeg: number) {
    this.overrides.set(designerIndex, { type: 'moved', pos, rotDeg });
  }

  /** §7.6: selling a designer-placed object is destructive (refund + removed) — there is no
   *  "un-sell". A later purchase of the same asset id from the catalog is a brand-new addition,
   *  not a restoration of the original. */
  sellDesigner(designerIndex: number) {
    this.overrides.set(designerIndex, { type: 'sold' });
  }

  serialize(): BuyOverlaySaveState {
    return {
      additions: this.additions.map((a) => ({ ...a })),
      overrides: [...this.overrides.entries()].map(([k, v]) => [k, { ...v }]),
      seq: this.seq,
    };
  }

  restore(s: BuyOverlaySaveState) {
    this.additions = s.additions.map((a) => ({ ...a }));
    this.overrides = new Map(s.overrides.map(([k, v]) => [k, { ...v }]));
    this.seq = s.seq;
  }
}

/** One live instance, designer-placed or player-bought, after the overlay is applied — the
 *  common shape both nav-rebake and placement-validity/selection code work with. */
export interface EffectiveInstance {
  key: string;
  asset: string;
  pos: [number, number];
  rotDeg: number;
  footprint: [number, number];
  source: 'designer' | 'player';
  /** only set for source:'designer' — its index into map.placedObjects */
  designerIndex?: number;
}

/** Designer objects (minus sold, with moved overrides applied) + player additions, resolved
 *  against `assets.json` for footprint. Used for: placement-validity's "others" list, buy-mode
 *  object selection, and (via `toPlacedList` below) the nav-rebake feed. */
export function effectiveInstances(
  designerObjects: PlacedLike[],
  overlay: BuyOverlay,
  byId: Map<string, AssetDef>,
): EffectiveInstance[] {
  const out: EffectiveInstance[] = [];
  designerObjects.forEach((p, i) => {
    const ov = overlay.overrideFor(i);
    if (ov?.type === 'sold') return;
    const def = byId.get(p.asset);
    if (!def) return;
    const pos = ov?.type === 'moved' ? ov.pos : p.pos;
    const rotDeg = ov?.type === 'moved' ? ov.rotDeg : p.rotDeg;
    out.push({ key: `designer#${i}`, asset: p.asset, pos, rotDeg, footprint: def.footprint, source: 'designer', designerIndex: i });
  });
  for (const a of overlay.allAdditions) {
    const def = byId.get(a.asset);
    if (!def) continue;
    out.push({ key: a.key, asset: a.asset, pos: a.pos, rotDeg: a.rotDeg, footprint: def.footprint, source: 'player' });
  }
  return out;
}

/** The same list, in `MapData.placedObjects`'s own element shape — drops straight into
 *  `bakeNavGrid({ ...data.map, placedObjects: effective }, data.assets)` with zero nav.ts changes. */
export function effectivePlacedObjects(instances: EffectiveInstance[]): PlacedLike[] {
  return instances.map((i) => ({ asset: i.asset, pos: i.pos, rotDeg: i.rotDeg }));
}

/** §7.6: "Accident instances and door-category assets are not selectable/sellable in buy mode."
 *  Accident instances never appear in `effectiveInstances` at all (they're never in
 *  map.placedObjects, only AccidentRegistry's own separate runtime list) — this covers the
 *  door-category half of the rule, belt-and-braces against a future designer placing one via
 *  placedObjects instead of map.doors[]. */
export function isSelectableForSell(def: AssetDef): boolean {
  return def.category !== 'accident' && def.category !== 'door';
}

// ==================================================================== buy/sell/move flows (pure)

export type BuyFailReason = 'insufficient_funds' | 'invalid_placement';
export interface BuyResult { ok: boolean; reason?: BuyFailReason; addition?: OverlayAddition; }

/** Validates funds + placement and, if both pass, records the purchase in the overlay. Does NOT
 *  touch funds itself — funds live in QuestRunner (§7.6: "single source of truth"); the caller
 *  (BuyModeController) deducts `def.buyPrice` from `quests.funds` only after `ok` comes back true,
 *  so a failed attempt never touches the balance. */
export function attemptBuy(overlay: BuyOverlay, def: AssetDef, pos: [number, number], rotDeg: number, funds: number, valid: boolean): BuyResult {
  // defensive: shouldn't be reachable from the catalog UI (which already filters via isPurchasable),
  // but never let a stale reference to an unbuyable/accident asset slip a purchase through.
  if (def.buyable === false || def.category === 'accident') return { ok: false, reason: 'invalid_placement' };
  if (funds < def.buyPrice) return { ok: false, reason: 'insufficient_funds' };
  if (!valid) return { ok: false, reason: 'invalid_placement' };
  const addition = overlay.addPurchase(def.id, pos, rotDeg);
  return { ok: true, addition };
}

export interface SellResult { ok: boolean; refund: number; }

/** Refunds `def.sellPrice` and marks the instance removed (player addition → deleted outright;
 *  designer object → sold override). Caller applies the refund to `quests.funds`. */
export function attemptSell(overlay: BuyOverlay, inst: EffectiveInstance, def: AssetDef): SellResult {
  if (!isSelectableForSell(def)) return { ok: false, refund: 0 };
  if (inst.source === 'player') overlay.removeAddition(inst.key);
  else if (inst.designerIndex !== undefined) overlay.sellDesigner(inst.designerIndex);
  return { ok: true, refund: def.sellPrice };
}

/** Applies a validated move (player addition or designer object) to the overlay. Validity must be
 *  checked by the caller via `isValidPlacement` (excluding the instance's own key) BEFORE calling. */
export function attemptMove(overlay: BuyOverlay, inst: EffectiveInstance, pos: [number, number], rotDeg: number, valid: boolean): boolean {
  if (!valid) return false;
  if (inst.source === 'player') return overlay.moveAddition(inst.key, pos, rotDeg);
  if (inst.designerIndex !== undefined) { overlay.moveDesigner(inst.designerIndex, pos, rotDeg); return true; }
  return false;
}

// ==================================================================== icon fallback (pure)

/** Category-colored fallback tile info for the catalog card when `AssetDef.icon` is absent —
 *  "never a broken image" (§7.6). Actual DOM/CSS rendering lives in ui.ts; this just picks the
 *  color + initials so the decision is unit-testable and shared with any other icon consumer. */
const CATEGORY_TILE_COLORS: Record<string, string> = {
  seating: '#6fae5c', beds: '#8a6fd1', appliances: '#c8cdd4', plumbing: '#7ec8e3',
  surfaces: '#c9a06a', electronics: '#4a5568', decor: '#d17a9e',
};

export function iconFallbackColor(category: string): string {
  return CATEGORY_TILE_COLORS[category] ?? '#5f6f93';
}

/** First 1-2 letters of each significant word, uppercased ("Dining chair" → "DC", "Sofa" → "SO"). */
export function iconFallbackInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function clampRect(v: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, v)); }

// ==================================================================== three.js layer

const GHOST_VALID_COLOR = 0x6fe36f;
const GHOST_INVALID_COLOR = 0xe35a5a;
const GHOST_OPACITY = 0.55;

function disposeGroupLocal(g: THREE.Object3D) {
  g.traverse((o) => {
    if (o instanceof THREE.Mesh && !o.userData.sharedResource) {
      o.geometry.dispose();
      const m = o.material;
      (Array.isArray(m) ? m : [m]).forEach((mm) => mm.dispose());
    }
  });
}

/** Tints every mesh under `group` a flat validity color (green/red), independent of whatever
 *  material the stand-in/GLB actually uses — a cheap, robust "ghost" look without needing a
 *  dedicated ghost material per asset. */
function tintGhost(group: THREE.Object3D, valid: boolean) {
  const color = valid ? GHOST_VALID_COLOR : GHOST_INVALID_COLOR;
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if ('color' in m) (m as THREE.MeshBasicMaterial).color.setHex(color);
        m.transparent = true;
        m.opacity = GHOST_OPACITY;
        m.depthWrite = false;
      }
    }
  });
}

export type BuyModeSelection =
  | { kind: 'placing'; def: AssetDef; pos: [number, number]; rotDeg: number; valid: boolean }
  | { kind: 'selected'; inst: EffectiveInstance; def: AssetDef }
  | { kind: 'moving'; inst: EffectiveInstance; def: AssetDef; pos: [number, number]; rotDeg: number; valid: boolean }
  | null;

/**
 * Thin three.js-aware wrapper around BuyOverlay: renders purchased-instance meshes (same
 * stand-in-then-GLB-swap pipeline as furniture, via world.ts's makeStandIn/attachMesh), patches
 * designer-object overrides onto freshly-built world children, drives the placement ghost, and
 * re-parents everything across main.ts's hot-reload world rebuilds (mirrors
 * AccidentsController.reattach — buildWorld() has no notion of this runtime overlay).
 */
export class BuyModeController {
  readonly overlay = new BuyOverlay();
  private additionGroups = new Map<string, THREE.Group>();
  private ghost: THREE.Group | null = null;
  private gridOverlay: THREE.GridHelper | null = null;

  active = false;
  selection: BuyModeSelection = null;

  constructor(
    private getData: () => GameData,
    private getWorld: () => THREE.Group,
  ) {}

  // -------------------------------------------------------------- mode toggle

  enter() {
    this.active = true;
    this.selection = null;
    this.ensureGridOverlay();
  }

  exit() {
    this.active = false;
    this.selection = null;
    this.clearGhost();
    this.removeGridOverlay();
  }

  private ensureGridOverlay() {
    if (this.gridOverlay) return;
    const { bounds, gridSize } = this.getData().map;
    const size = Math.max(bounds.w, bounds.h);
    const divisions = Math.max(1, Math.round(size / gridSize));
    const grid = new THREE.GridHelper(size, divisions, 0x6fa0ff, 0x3a4a6a);
    grid.position.set(bounds.w / 2, 0.02, bounds.h / 2);
    // GridHelper is square (size×size) centered at origin — non-square maps just show extra
    // grid beyond the shorter dimension, which is harmless (floors/walls still bound the room).
    this.gridOverlay = grid;
    this.getWorld().add(grid);
  }

  private removeGridOverlay() {
    if (!this.gridOverlay) return;
    this.gridOverlay.parent?.remove(this.gridOverlay);
    this.gridOverlay = null;
  }

  // -------------------------------------------------------------- effective instances / nav feed

  private byId(): Map<string, AssetDef> {
    return new Map(this.getData().assets.assets.map((a) => [a.id, a]));
  }

  instances(): EffectiveInstance[] {
    return effectiveInstances(this.getData().map.placedObjects, this.overlay, this.byId());
  }

  /** Feed this into bakeNavGrid via `{ ...data.map, placedObjects: effectivePlacedObjectsList() }`. */
  effectivePlacedObjectsList(): PlacedLike[] {
    return effectivePlacedObjects(this.instances());
  }

  // -------------------------------------------------------------- placement validity helper

  private checkValidity(pos: [number, number], rotDeg: number, footprint: [number, number], excludeKey?: string): boolean {
    const { map } = this.getData();
    const others = this.instances().map((i): OtherInstance => ({ key: i.key, pos: i.pos, rotDeg: i.rotDeg, footprint: i.footprint }));
    return isValidPlacement({ pos, rotDeg, footprint, bounds: map.bounds, walls: map.walls, others, excludeKey });
  }

  // -------------------------------------------------------------- starting a purchase (ghost)

  startPlacing(def: AssetDef) {
    this.clearGhost();
    const { map } = this.getData();
    const pos: [number, number] = [clampRect(map.bounds.w / 2, 0, map.bounds.w), clampRect(map.bounds.h / 2, 0, map.bounds.h)];
    const rotDeg = 0;
    const valid = this.checkValidity(pos, rotDeg, def.footprint);
    this.selection = { kind: 'placing', def, pos, rotDeg, valid };
    this.buildGhost(def, pos, rotDeg, valid);
  }

  /** Ground tap while placing/moving repositions the ghost (snapped, revalidated). Mobile-first
   *  tap-only interaction, consistent with every other placement/movement gesture already in this
   *  game (tap-to-go, tap-to-act) — a live drag-follow is a possible future enhancement, not
   *  required by any test here. */
  moveGhostTo(worldX: number, worldZ: number) {
    if (!this.selection || this.selection.kind === 'selected') return;
    const gridSize = this.getData().map.gridSize;
    const pos = snapPos([worldX, worldZ], gridSize);
    const footprint = this.selection.def.footprint;
    const excludeKey = this.selection.kind === 'moving' ? this.selection.inst.key : undefined;
    const valid = this.checkValidity(pos, this.selection.rotDeg, footprint, excludeKey);
    this.selection = { ...this.selection, pos, valid };
    if (this.ghost) { this.ghost.position.set(pos[0], 0, pos[1]); tintGhost(this.ghost, valid); }
  }

  rotateGhost() {
    if (!this.selection || this.selection.kind === 'selected') return;
    const rotDeg = rotateStep(this.selection.rotDeg);
    const footprint = this.selection.def.footprint;
    const excludeKey = this.selection.kind === 'moving' ? this.selection.inst.key : undefined;
    const valid = this.checkValidity(this.selection.pos, rotDeg, footprint, excludeKey);
    this.selection = { ...this.selection, rotDeg, valid };
    if (this.ghost) { this.ghost.rotation.y = THREE.MathUtils.degToRad(rotDeg); tintGhost(this.ghost, valid); }
  }

  /** Confirms the pending placement (new purchase) or move. Returns the result so the caller
   *  (main.ts) can deduct funds / refresh the catalog / re-render the HUD. `funds` is read from
   *  the caller's QuestRunner and passed in — this class never touches funds directly. */
  confirm(funds: number): { kind: 'bought'; def: AssetDef; cost: number } | { kind: 'moved' } | { kind: 'failed'; reason: BuyFailReason } | null {
    if (!this.selection) return null;
    if (this.selection.kind === 'placing') {
      const { def, pos, rotDeg, valid } = this.selection;
      const result = attemptBuy(this.overlay, def, pos, rotDeg, funds, valid);
      if (!result.ok) { this.clearGhost(); this.selection = null; return { kind: 'failed', reason: result.reason! }; }
      this.buildAdditionGroup(result.addition!, def);
      this.clearGhost();
      this.selection = null;
      return { kind: 'bought', def, cost: def.buyPrice };
    }
    if (this.selection.kind === 'moving') {
      const { inst, def, pos, rotDeg, valid } = this.selection;
      const ok = attemptMove(this.overlay, inst, pos, rotDeg, valid);
      this.clearGhost();
      this.selection = ok ? { kind: 'selected', inst: { ...inst, pos, rotDeg }, def } : { kind: 'selected', inst, def };
      this.applyOverridesToWorld();
      return ok ? { kind: 'moved' } : { kind: 'failed', reason: 'invalid_placement' };
    }
    return null;
  }

  /** Cancels a pending placement/move, discarding the ghost (moving reverts to the plain
   *  selection/chips state; placing clears the selection entirely). */
  cancel() {
    if (this.selection?.kind === 'moving') {
      const { inst, def } = this.selection;
      this.selection = { kind: 'selected', inst, def };
    } else {
      this.selection = null;
    }
    this.clearGhost();
  }

  // -------------------------------------------------------------- selecting a placed instance

  /** Finds the selectable effective instance (if any) behind a tapped Object3D — walks up via
   *  userData like input.ts's own tap resolution. Returns null for accidents/doors/unknown hits. */
  instanceForObject(obj: THREE.Object3D): EffectiveInstance | null {
    let o: THREE.Object3D | null = obj;
    while (o && o.userData?.assetId === undefined) o = o.parent;
    if (!o) return null;
    const byId = this.byId();
    const placedIndex = o.userData.placedIndex as number | undefined;
    const buyKey = o.userData.buyKey as string | undefined;
    for (const inst of this.instances()) {
      if (placedIndex !== undefined && inst.designerIndex === placedIndex) return inst;
      if (buyKey !== undefined && inst.key === buyKey) return inst;
    }
    return null;
  }

  select(inst: EffectiveInstance): boolean {
    const def = this.byId().get(inst.asset);
    if (!def || !isSelectableForSell(def)) return false;
    this.clearGhost();
    this.selection = { kind: 'selected', inst, def };
    return true;
  }

  deselect() {
    this.clearGhost();
    this.selection = null;
  }

  /** "Move" chip: switches the current selection into a repositionable ghost seeded at the
   *  instance's current pos/rot. */
  beginMoveSelected() {
    if (this.selection?.kind !== 'selected') return;
    const { inst, def } = this.selection;
    const valid = this.checkValidity(inst.pos, inst.rotDeg, def.footprint, inst.key);
    this.selection = { kind: 'moving', inst, def, pos: inst.pos, rotDeg: inst.rotDeg, valid };
    this.buildGhost(def, inst.pos, inst.rotDeg, valid);
  }

  /** "Rotate" chip: rotates the selected instance in place immediately (no ghost/confirm step),
   *  same 90°-step convention as everywhere else. No-ops (leaves the rotation alone) if the turn
   *  would make it overlap something — the object simply doesn't spin, rather than glitching into
   *  furniture. */
  rotateSelectedInPlace(): boolean {
    if (this.selection?.kind !== 'selected') return false;
    const { inst, def } = this.selection;
    const rotDeg = rotateStep(inst.rotDeg);
    const valid = this.checkValidity(inst.pos, rotDeg, def.footprint, inst.key);
    if (!valid) return false;
    attemptMove(this.overlay, inst, inst.pos, rotDeg, true);
    this.selection = { kind: 'selected', inst: { ...inst, rotDeg }, def };
    this.applyOverridesToWorld();
    return true;
  }

  /** "Sell" chip. Returns the refund (0 if the sell was rejected, e.g. a door/accident somehow
   *  reached this path). Caller applies the refund to funds and refreshes the catalog. */
  sellSelected(): number {
    if (this.selection?.kind !== 'selected') return 0;
    const { inst, def } = this.selection;
    const result = attemptSell(this.overlay, inst, def);
    if (result.ok) {
      if (inst.source === 'player') this.removeAdditionGroup(inst.key);
      else this.applyOverridesToWorld();
    }
    this.selection = null;
    return result.ok ? result.refund : 0;
  }

  // -------------------------------------------------------------- rendering

  private buildGhost(def: AssetDef, pos: [number, number], rotDeg: number, valid: boolean) {
    const ghost = makeStandIn(def);
    ghost.position.set(pos[0], 0, pos[1]);
    ghost.rotation.y = THREE.MathUtils.degToRad(rotDeg);
    tintGhost(ghost, valid);
    this.ghost = ghost;
    this.getWorld().add(ghost);
  }

  private clearGhost() {
    if (!this.ghost) return;
    this.ghost.parent?.remove(this.ghost);
    disposeGroupLocal(this.ghost);
    this.ghost = null;
  }

  private buildAdditionGroup(addition: OverlayAddition, def: AssetDef) {
    const group = makeStandIn(def);
    group.position.set(addition.pos[0], 0, addition.pos[1]);
    group.rotation.y = THREE.MathUtils.degToRad(addition.rotDeg);
    group.userData = { assetId: def.id, interactions: def.interactions, buyKey: addition.key };
    attachMesh(group, def);
    this.additionGroups.set(addition.key, group);
    this.getWorld().add(group);
  }

  private removeAdditionGroup(key: string) {
    const group = this.additionGroups.get(key);
    if (!group) return;
    group.parent?.remove(group);
    disposeGroupLocal(group);
    this.additionGroups.delete(key);
  }

  /** Repositions/hides already-built groups (designer overrides via world.ts's `placedIndex`
   *  tagging, player additions via their own group map) to match the current overlay state —
   *  called after a move/rotate/sell so the live scene matches the overlay without a full rebuild. */
  private applyOverridesToWorld() {
    const world = this.getWorld();
    for (const child of world.children) {
      const idx = child.userData?.placedIndex as number | undefined;
      if (idx === undefined) continue;
      const ov = this.overlay.overrideFor(idx);
      if (ov?.type === 'sold') { child.visible = false; continue; }
      if (ov?.type === 'moved') {
        child.position.set(ov.pos[0], 0, ov.pos[1]);
        child.rotation.y = THREE.MathUtils.degToRad(ov.rotDeg);
      }
    }
    for (const [key, group] of this.additionGroups) {
      const a = this.overlay.allAdditions.find((x) => x.key === key);
      if (!a) continue;
      group.position.set(a.pos[0], 0, a.pos[1]);
      group.rotation.y = THREE.MathUtils.degToRad(a.rotDeg);
    }
  }

  /**
   * Hot-reload hook: main.ts's `buildWorld(data)` rebuilds `world` from scratch on every data
   * poll with no notion of this runtime overlay (designer overrides/player additions are never in
   * map data) — call this right after `scene.add(world)`, same convention as
   * AccidentsController.reattach: patches the fresh designer-object children (hide sold,
   * reposition moved) and re-parents every live player-addition group into the new world.
   */
  reattach(world: THREE.Group) {
    for (const child of world.children) {
      const idx = child.userData?.placedIndex as number | undefined;
      if (idx === undefined) continue;
      const ov = this.overlay.overrideFor(idx);
      if (ov?.type === 'sold') child.visible = false;
      else if (ov?.type === 'moved') {
        child.position.set(ov.pos[0], 0, ov.pos[1]);
        child.rotation.y = THREE.MathUtils.degToRad(ov.rotDeg);
      }
    }
    for (const group of this.additionGroups.values()) world.add(group);
    if (this.gridOverlay && this.active) world.add(this.gridOverlay);
    // a pending ghost (placing/moving) also lived under the OLD world group — reattach it too,
    // e.g. a designer tuning/asset edit landing while the player has a ghost mid-placement.
    if (this.ghost) world.add(this.ghost);
  }

  serialize(): BuyOverlaySaveState { return this.overlay.serialize(); }

  /** Full restore (future save system): rebuilds both the pure overlay and every live group. */
  restore(s: BuyOverlaySaveState) {
    for (const group of this.additionGroups.values()) { group.parent?.remove(group); disposeGroupLocal(group); }
    this.additionGroups.clear();
    this.overlay.restore(s);
    const byId = this.byId();
    for (const a of this.overlay.allAdditions) {
      const def = byId.get(a.asset);
      if (def) this.buildAdditionGroup(a, def);
    }
    this.applyOverridesToWorld();
  }
}
