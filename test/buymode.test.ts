// buymode.test.ts — game/buymode.ts pure logic (PROJECT_CONTEXT.md §7.6 Buy/Sell mode slice).
// Run: npx tsx test/buymode.test.ts
import * as THREE from 'three';
import {
  isPurchasable, isAffordable, purchasableCatalog, catalogCategories, filterCatalog,
  snapToStep, snapPos, normalizeRotDeg, rotateStep, wallRect, isValidPlacement, footprintOnFloor,
  snapWallMountedPlacement, isWallMountedPlacement,
  BuyOverlay, BuyModeController, effectiveInstances, effectivePlacedObjects, isSelectableForSell,
  attemptBuy, attemptSell, attemptMove, attemptDestroy,
  iconFallbackColor, iconFallbackInitials,
  ghostTransformFor, resolveGhostAppearance, DEFAULT_GHOST_OPACITY,
  type OtherInstance, type PlacedLike, type EffectiveInstance, type FloorDef, type WallSeg,
} from '../game/buymode';
import { footprintRect } from '../game/accidents';
import { readFileSync } from 'node:fs';
import type { AssetDef, AssetsData, GameData } from '../game/data';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name} ${detail}`); }
}

console.log('buymode.test — B6-13 wall-mounted snap + validity');
{
  const bounds = { w: 10, h: 10 };
  const walls: WallSeg[] = [{ from: [0, 0], to: [10, 0] }];
  const floors: FloorDef[] = [{ id: 'room', polygon: [[0, 0], [10, 0], [10, 10], [0, 10]] }];
  const def: Pick<AssetDef, 'footprint' | 'facingDeg' | 'wallMounted'> = { footprint: [1, 0.2], wallMounted: {} };
  const snapped = snapWallMountedPlacement([5, 0.4], def, walls, floors, 1);
  check('wall-adjacent request snaps', !!snapped);
  check('top-wall mount faces +Z into the room', snapped?.rotDeg === 0, JSON.stringify(snapped));
  check('footprint snaps flush outside wall thickness', !!snapped && approx(snapped.pos[1], 0.16), JSON.stringify(snapped));
  check('snapped wall placement passes pure wall rule', !!snapped && isWallMountedPlacement(snapped.pos, snapped.rotDeg, def, walls, floors, 1));
  check('mid-room placement fails pure wall rule', !isWallMountedPlacement([5, 5], 0, def, walls, floors, 1));
  check('wrong-facing placement fails pure wall rule', !!snapped && !isWallMountedPlacement(snapped.pos, 180, def, walls, floors, 1));
  check('full placement validity accepts snapped wall mount', !!snapped && isValidPlacement({
    pos: snapped.pos, rotDeg: snapped.rotDeg, footprint: def.footprint, def,
    bounds, walls, floors, gridSize: 1, others: [],
  }));
  check('full placement validity rejects wall asset in mid-room', !isValidPlacement({
    pos: [5, 5], rotDeg: 0, footprint: def.footprint, def,
    bounds, walls, floors, gridSize: 1, others: [],
  }));
}
function approx(a: number, b: number, eps = 1e-6) { return Math.abs(a - b) <= eps; }

function asset(over: Partial<AssetDef> = {}): AssetDef {
  return {
    id: 'sofa', name: 'Sofa', category: 'seating', mesh: 'models/sofa.glb',
    buyPrice: 450, sellPrice: 340, environmentScore: 3, footprint: [2, 1], interactions: [],
    ...over,
  };
}

const noUnlocks = () => false;
const allUnlocked = () => true;

console.log('buymode.test — B13-8 actual-asset ghost transform + appearance');
{
  const def = asset({
    wallMounted: { heightY: 1.8 },
    meshFit: { scale: [1.2, 0.8, 1.4], yawOffsetDeg: -30, xOffset: 0.1, yOffset: 0.2, zOffset: -0.3 },
  });
  const composed = ghostTransformFor(def, [2.25, 4.5], 90);
  check('ghost placement uses world position including wall mount height',
    JSON.stringify(composed.placement.position) === JSON.stringify([2.25, 1.8, 4.5]));
  check('ghost placement uses world yaw convention', approx(composed.placement.yawRadians, Math.PI / 2));
  check('ghost meshFit uses world non-uniform scale', JSON.stringify(composed.meshFit.scale) === JSON.stringify([1.2, 0.8, 1.4]));
  check('ghost meshFit uses world yaw correction', approx(composed.meshFit.yawRadians, -Math.PI / 6));
  check('ghost meshFit uses all world offsets', JSON.stringify(composed.meshFit.offset) === JSON.stringify([0.1, 0.2, -0.3]));

  const valid = resolveGhostAppearance(true, 0.42);
  check('valid ghost preserves real asset color', valid.tint === null);
  check('ghost opacity comes from tuning and disables depth writes', valid.opacity === 0.42 && valid.depthWrite === false);
  const invalid = resolveGhostAppearance(false, 0.42);
  check('invalid ghost gains red tint without changing opacity', invalid.tint === 0xe35a5a && invalid.opacity === 0.42);
  check('missing opacity uses documented default', resolveGhostAppearance(true).opacity === DEFAULT_GHOST_OPACITY);
  check('opacity is clamped low/high', resolveGhostAppearance(true, -2).opacity === 0 && resolveGhostAppearance(true, 3).opacity === 1);
  check('non-finite opacity falls back', resolveGhostAppearance(true, Number.NaN).opacity === DEFAULT_GHOST_OPACITY);
}

console.log('buymode.test — catalog: isPurchasable / isAffordable');
{
  check('plain asset (no flags) is purchasable', isPurchasable(asset(), noUnlocks) === true);
  check('buyable:false is never purchasable', isPurchasable(asset({ buyable: false }), allUnlocked) === false);
  check('category "accident" is never purchasable, even if buyable is absent', isPurchasable(asset({ category: 'transient' }), allUnlocked) === false);
  check('category "door" is purchasable unless buyable:false is also set (no special-casing)', isPurchasable(asset({ category: 'door' }), noUnlocks) === true);
  check('door_basic-style buyable:false door is excluded', isPurchasable(asset({ category: 'door', buyable: false }), allUnlocked) === false);

  const gated = asset({ requiresQuestUnlock: true });
  check('requiresQuestUnlock:true + not unlocked → not purchasable', isPurchasable(gated, noUnlocks) === false);
  check('requiresQuestUnlock:true + unlocked → purchasable', isPurchasable(gated, allUnlocked) === true);
  check('requiresQuestUnlock:false behaves like absent', isPurchasable(asset({ requiresQuestUnlock: false }), noUnlocks) === true);

  check('affordable: funds >= price', isAffordable(asset({ buyPrice: 100 }), 100) === true);
  check('affordable: funds < price is false', isAffordable(asset({ buyPrice: 100 }), 99) === false);
  check('affordable: free asset (price 0) always affordable', isAffordable(asset({ buyPrice: 0 }), 0) === true);
}

console.log('buymode.test — catalog: purchasableCatalog / catalogCategories / filterCatalog');
{
  const assets: AssetDef[] = [
    asset({ id: 'sofa', name: 'Sofa', category: 'seating', buyPrice: 450 }),
    asset({ id: 'armchair', name: 'Armchair', category: 'seating', buyPrice: 180 }),
    asset({ id: 'tv', name: 'TV', category: 'electronics', buyPrice: 800 }),
    asset({ id: 'fire', name: 'Fire', category: 'transient', buyPrice: 0, buyable: false }),
    asset({ id: 'door_basic', name: 'Basic door', category: 'door', buyPrice: 150, buyable: false }),
    asset({ id: 'safe', name: 'Safe', category: 'surfaces', buyPrice: 1000, requiresQuestUnlock: true }),
  ];
  const data: AssetsData = { categories: ['seating', 'electronics', 'door', 'surfaces', 'transient'], assets };

  const cat = purchasableCatalog(assets, noUnlocks);
  check('purchasableCatalog excludes accident + door(buyable:false) + locked quest-gated', cat.length === 3 && cat.every((a) => ['sofa', 'armchair', 'tv'].includes(a.id)), JSON.stringify(cat.map((a) => a.id)));

  const catUnlocked = purchasableCatalog(assets, allUnlocked);
  check('purchasableCatalog includes the quest-gated item once unlocked', catUnlocked.some((a) => a.id === 'safe'));

  const cats = catalogCategories(data, noUnlocks);
  check('catalogCategories only lists categories with >=1 purchasable item, in data order', JSON.stringify(cats) === JSON.stringify(['seating', 'electronics']), JSON.stringify(cats));
  const catsUnlocked = catalogCategories(data, allUnlocked);
  check('catalogCategories includes "surfaces" once the gated item unlocks it', catsUnlocked.includes('surfaces'));

  check('filterCatalog by category', filterCatalog(assets, noUnlocks, { category: 'seating' }).map((a) => a.id).sort().join(',') === 'armchair,sofa');
  check('filterCatalog by search (name, case-insensitive)', filterCatalog(assets, noUnlocks, { search: 'ARM' }).map((a) => a.id).join(',') === 'armchair');
  check('filterCatalog by search (id)', filterCatalog(assets, noUnlocks, { search: 'tv' }).map((a) => a.id).join(',') === 'tv');
  check('filterCatalog category+search combine', filterCatalog(assets, noUnlocks, { category: 'seating', search: 'sofa' }).map((a) => a.id).join(',') === 'sofa');
  check('filterCatalog search excludes non-purchasable even if it matches', filterCatalog(assets, noUnlocks, { search: 'fire' }).length === 0);
  check('filterCatalog with no filter returns the full purchasable set', filterCatalog(assets, noUnlocks, {}).length === 3);
}

console.log('buymode.test — placement math: independent 0.25m snap / rotate');
{
  check('snapToStep defaults to 0.25m', approx(snapToStep(1.12), 1.0) && approx(snapToStep(1.13), 1.25));
  check('explicit 0.25m step stays independent of 0.5m tiles', approx(snapToStep(2.25, 0.25), 2.25));
  const p = snapPos([1.24, 3.9], 0.25);
  check('snapPos snaps both axes to 0.25m', approx(p[0], 1.25) && approx(p[1], 4.0), JSON.stringify(p));

  check('normalizeRotDeg wraps negative angles into [0,360)', normalizeRotDeg(-90) === 270);
  check('normalizeRotDeg wraps >360', normalizeRotDeg(450) === 90);
  check('rotateStep default 90°', rotateStep(0) === 90 && rotateStep(270) === 0);
  check('rotateStep custom step', rotateStep(10, 45) === 55);
}

console.log('buymode.test — placement math: wallRect / isValidPlacement');
{
  const horizontalWall = wallRect({ from: [0, 0], to: [10, 0] });
  check('horizontal wall rect is thin in Z, spans X', approx(horizontalWall.x0, 0) && approx(horizontalWall.x1, 10) && approx(horizontalWall.z1 - horizontalWall.z0, 0.12));
  const verticalWall = wallRect({ from: [5, 0], to: [5, 8] });
  check('vertical wall rect is thin in X, spans Z', approx(verticalWall.z0, 0) && approx(verticalWall.z1, 8) && approx(verticalWall.x1 - verticalWall.x0, 0.12));

  const bounds = { w: 10, h: 10 };
  const walls = [{ from: [0, 0] as [number, number], to: [10, 0] as [number, number] }]; // wall along the top edge
  const noOthers: OtherInstance[] = [];
  const gridSize = 1;
  // a floor covering the entire bounds — existing in-bounds/wall/overlap tests shouldn't be
  // affected by the new floor requirement at all.
  const fullFloor: FloorDef[] = [{ id: 'f', polygon: [[0, 0], [10, 0], [10, 10], [0, 10]] }];

  check('in-bounds, clear of walls/objects → valid', isValidPlacement({ pos: [5, 5], rotDeg: 0, footprint: [1, 1], bounds, walls, others: noOthers, floors: fullFloor, gridSize }) === true);
  check('out of bounds (negative) → invalid', isValidPlacement({ pos: [-1, 5], rotDeg: 0, footprint: [1, 1], bounds, walls, others: noOthers, floors: fullFloor, gridSize }) === false);
  check('out of bounds (beyond w) → invalid', isValidPlacement({ pos: [9.6, 5], rotDeg: 0, footprint: [1, 1], bounds, walls, others: noOthers, floors: fullFloor, gridSize }) === false);
  check('overlapping the wall along the top edge → invalid', isValidPlacement({ pos: [5, 0.3], rotDeg: 0, footprint: [1, 1], bounds, walls, others: noOthers, floors: fullFloor, gridSize }) === false);
  check('clear of the wall further into the room → valid', isValidPlacement({ pos: [5, 2], rotDeg: 0, footprint: [1, 1], bounds, walls, others: noOthers, floors: fullFloor, gridSize }) === true);

  const others: OtherInstance[] = [{ key: 'designer#0', pos: [5, 5], rotDeg: 0, footprint: [1, 1] }];
  check('overlapping another placed object → invalid', isValidPlacement({ pos: [5.2, 5], rotDeg: 0, footprint: [1, 1], bounds, walls, others, floors: fullFloor, gridSize }) === false);
  check('excludeKey lets an instance overlap its OWN previous footprint (moving in place)', isValidPlacement({ pos: [5, 5], rotDeg: 0, footprint: [1, 1], bounds, walls, others, floors: fullFloor, gridSize, excludeKey: 'designer#0' }) === true);
  check('far from the other object → valid', isValidPlacement({ pos: [8, 8], rotDeg: 0, footprint: [1, 1], bounds, walls, others, floors: fullFloor, gridSize }) === true);
}

console.log('buymode.test — placement math: footprintOnFloor / isValidPlacement floor requirement (ROADMAP_NEXT.md item 8)');
{
  const bounds = { w: 10, h: 10 };
  const noWalls: WallSeg[] = [];
  const noOthers: OtherInstance[] = [];
  const gridSize = 1;
  // a partial floor — only the west half of the 10x10 room (x in [0,6]) — so the east half is
  // "outside the apartment" per ROADMAP_NEXT.md item 8, even though it's still within `bounds`.
  const partialFloor: FloorDef[] = [{ id: 'f', polygon: [[0, 0], [6, 0], [6, 10], [0, 10]] }];

  check('footprintOnFloor: fully within a floor polygon → true', footprintOnFloor({ x0: 1, x1: 3, z0: 1, z1: 3 }, partialFloor, gridSize) === true);
  check('footprintOnFloor: fully outside any floor polygon → false', footprintOnFloor({ x0: 7, x1: 9, z0: 1, z1: 3 }, partialFloor, gridSize) === false);
  check('footprintOnFloor: straddling the floor edge (partial overhang) → false', footprintOnFloor({ x0: 5, x1: 7, z0: 1, z1: 3 }, partialFloor, gridSize) === false);

  check('on-floor placement (footprint entirely on floor) → valid',
    isValidPlacement({ pos: [3, 3], rotDeg: 0, footprint: [2, 1], bounds, walls: noWalls, others: noOthers, floors: partialFloor, gridSize }) === true);
  check('partial-overhang placement (part of footprint off any floor, but still in bounds) → invalid',
    isValidPlacement({ pos: [5.5, 3], rotDeg: 0, footprint: [2, 1], bounds, walls: noWalls, others: noOthers, floors: partialFloor, gridSize }) === false);

  // rotated footprint: [2,1] at rotDeg 0 → x-extent 2 (would straddle the x=6 floor edge at pos.x=5.5);
  // the SAME footprint rotated 90° swaps to [1,2] (x-extent 1) so it fits entirely on the west
  // floor at the same position — exercises the same width/depth swap rule footprintRect already
  // applies for overlap, now feeding the floor check too.
  check('rotated footprint (90°) swaps width/depth so the same pos now fits on floor → valid',
    isValidPlacement({ pos: [5.5, 3], rotDeg: 90, footprint: [2, 1], bounds, walls: noWalls, others: noOthers, floors: partialFloor, gridSize }) === true);
  check('unrotated (0°) footprint at the same pos overhangs the floor edge → invalid',
    isValidPlacement({ pos: [5.5, 3], rotDeg: 0, footprint: [2, 1], bounds, walls: noWalls, others: noOthers, floors: partialFloor, gridSize }) === false);
}

console.log('buymode.test — B6-6 shipped placements remain valid at 0.5m floor-cell resolution');
{
  const condo = JSON.parse(readFileSync(new URL('../data/maps/condo.json', import.meta.url), 'utf8'));
  const assetData = JSON.parse(readFileSync(new URL('../data/assets.json', import.meta.url), 'utf8'));
  const byId = new Map(assetData.assets.map((asset: any) => [asset.id, asset]));
  const invalid = condo.placedObjects.filter((placed: any) => {
    const def: any = byId.get(placed.asset);
    return !def || !footprintOnFloor(footprintRect(placed.pos, placed.rotDeg, def.footprint), condo.floors, condo.gridSize);
  });
  check('all existing meter-space footprints remain fully on floor', invalid.length === 0, invalid.map((p: any) => p.asset).join(','));
}

console.log('buymode.test — icon fallback');
{
  check('iconFallbackColor known category', iconFallbackColor('seating') === '#6fae5c');
  check('iconFallbackColor unknown category has a safe default', iconFallbackColor('nonexistent') === '#5f6f93');
  check('iconFallbackInitials single word', iconFallbackInitials('Sofa') === 'SO');
  check('iconFallbackInitials two words', iconFallbackInitials('Dining chair') === 'DC');
  check('iconFallbackInitials empty string safe default', iconFallbackInitials('') === '?');
}

console.log('buymode.test — BuyOverlay / effectiveInstances / effectivePlacedObjects / isSelectableForSell');
{
  const designerObjects: PlacedLike[] = [
    { asset: 'sofa', pos: [1, 1], rotDeg: 0 },
    { asset: 'tv', pos: [3, 1], rotDeg: 180 },
    { asset: 'bed', pos: [5, 5], rotDeg: 90 },
  ];
  const byId = new Map<string, AssetDef>([
    ['sofa', asset({ id: 'sofa', footprint: [2, 1] })],
    ['tv', asset({ id: 'tv', category: 'electronics', footprint: [2, 1] })],
    ['bed', asset({ id: 'bed', category: 'beds', footprint: [2, 3] })],
    ['lamp', asset({ id: 'lamp', name: 'Lamp', category: 'decor', buyPrice: 50, sellPrice: 35, footprint: [1, 1] })],
  ]);

  const overlay = new BuyOverlay();
  check('empty overlay: effectiveInstances mirrors designer objects 1:1', effectiveInstances(designerObjects, overlay, byId).length === 3);

  // --- purchase (addition)
  const added = overlay.addPurchase('lamp', [8, 8], 0);
  check('addPurchase returns a generated key', added.key === 'buy#0');
  let insts = effectiveInstances(designerObjects, overlay, byId);
  check('addition appears in effectiveInstances as source:player', insts.some((i) => i.key === 'buy#0' && i.source === 'player'));
  check('effectivePlacedObjects includes the addition in MapData placedObjects shape', effectivePlacedObjects(insts).some((p) => p.asset === 'lamp' && p.pos[0] === 8 && p.pos[1] === 8));

  // --- move a designer object
  overlay.moveDesigner(1, [4, 4], 90);
  insts = effectiveInstances(designerObjects, overlay, byId);
  const movedTv = insts.find((i) => i.designerIndex === 1)!;
  check('moved designer object reflects the override position/rotation', movedTv.pos[0] === 4 && movedTv.pos[1] === 4 && movedTv.rotDeg === 90);
  check('moved designer object keeps its original asset id', movedTv.asset === 'tv');

  // --- sell a designer object
  overlay.sellDesigner(0);
  insts = effectiveInstances(designerObjects, overlay, byId);
  check('sold designer object is excluded from effectiveInstances entirely', !insts.some((i) => i.designerIndex === 0));
  check('the other two designer objects + the addition remain', insts.length === 3, JSON.stringify(insts.map((i) => i.key)));

  // --- selectability
  check('seating/electronics/beds/decor are selectable for sell', isSelectableForSell(asset({ category: 'seating' })) && isSelectableForSell(asset({ category: 'decor' })));
  check('accident category is never selectable for sell', isSelectableForSell(asset({ category: 'transient' })) === false);
  check('door category is never selectable for sell', isSelectableForSell(asset({ category: 'door' })) === false);

  // --- serialize/restore round-trip
  const snap = overlay.serialize();
  check('serialize is plain-JSON-cloneable', JSON.stringify(JSON.parse(JSON.stringify(snap))) === JSON.stringify(snap));
  const overlay2 = new BuyOverlay();
  overlay2.restore(snap);
  const insts2 = effectiveInstances(designerObjects, overlay2, byId);
  check('restore reproduces the exact same effective instances', JSON.stringify(insts2) === JSON.stringify(insts));
  // deep-copy check: mutate the restored overlay, original snapshot must be untouched
  const beforeLen = snap.additions.length;
  overlay2.addPurchase('lamp', [0, 0], 0);
  check('restore deep-copies — mutating overlay2 leaves the original snapshot untouched', snap.additions.length === beforeLen);
}

console.log('buymode.test — elevated-surface purchases');
{
  const overlay = new BuyOverlay();
  const def = asset({ id: 'coffee_machine', category: 'appliances', buyPrice: 75, footprint: [0.4, 0.4], placeableOnSurface: true });
  const result = attemptBuy(overlay, def, [2, 3], 90, 9999, true, { hostKey: 'designer#4', index: 1, y: 0.9 });
  check('surface purchase records host/socket/height', result.addition?.surface?.hostKey === 'designer#4'
    && result.addition.surface.index === 1 && result.addition.surface.y === 0.9);
  const resolved = effectiveInstances([], overlay, new Map([[def.id, def]]));
  check('effective instance preserves surface reference', resolved[0]?.surface?.index === 1);
  check('ordinary effective list includes stacked assets for value/environment', effectivePlacedObjects(resolved).length === 1);
  check('nav effective list excludes stacked assets from the host floor footprint', effectivePlacedObjects(resolved, false).length === 0);
  const saved = overlay.serialize(); const restored = new BuyOverlay(); restored.restore(saved);
  check('surface reference survives save round-trip', restored.allAdditions[0]?.surface?.hostKey === 'designer#4');
}

console.log('buymode.test — elevated purchase restore and world rebuild');
{
  const table = asset({
    id: 'table_restore', category: 'surfaces', footprint: [2, 1],
    surfaceSockets: [{ offset: [0, 0], y: 0.92 }],
  });
  const decor = asset({
    id: 'decor_restore', category: 'decor', footprint: [0.2, 0.2], placeableOnSurface: true, mesh: '',
  });
  const data = {
    map: { placedObjects: [{ asset: table.id, pos: [2, 3], rotDeg: 0 }] },
    assets: { categories: ['surfaces', 'decor'], assets: [table, decor] },
  } as unknown as GameData;
  let world = new THREE.Group();
  const host = new THREE.Group();
  host.userData = { assetId: table.id, placedIndex: 0 };
  world.add(host);
  const ctrl = new BuyModeController(() => data, () => world);
  ctrl.restore({
    additions: [{ key: 'buy#0', asset: decor.id, pos: [2, 3], rotDeg: 0, surface: { hostKey: 'designer#0', index: 0, y: 0.92 } }],
    overrides: [], seq: 1,
  });
  const restoredGroup = world.children.find((child) => child.userData?.buyKey === 'buy#0');
  check('surface purchase restore reapplies socket height after overlay refresh', !!restoredGroup && approx(restoredGroup.position.y, 0.92));

  // Reproduce a previously flattened group, then run the map/world rebuild hook.
  restoredGroup!.position.y = 0;
  const rebuilt = new THREE.Group();
  const rebuiltHost = new THREE.Group();
  rebuiltHost.userData = { assetId: table.id, placedIndex: 0 };
  rebuilt.add(rebuiltHost);
  world = rebuilt;
  ctrl.reattach(rebuilt);
  const reattachedGroup = rebuilt.children.find((child) => child.userData?.buyKey === 'buy#0');
  check('world rebuild reapplies socket height instead of leaving purchase below the plane', !!reattachedGroup && approx(reattachedGroup.position.y, 0.92));
}

console.log('buymode.test — attemptBuy / attemptSell / attemptMove (funds + overlay mutation)');
{
  const lamp = asset({ id: 'lamp', name: 'Lamp', buyPrice: 100, sellPrice: 70, footprint: [1, 1] });
  const overlay = new BuyOverlay();

  const insufficient = attemptBuy(overlay, lamp, [2, 2], 0, 50, true);
  check('insufficient funds → rejected with reason, no overlay mutation', insufficient.ok === false && insufficient.reason === 'insufficient_funds' && overlay.allAdditions.length === 0);

  const invalidPlacement = attemptBuy(overlay, lamp, [2, 2], 0, 1000, false);
  check('invalid placement → rejected even with enough funds, no mutation', invalidPlacement.ok === false && invalidPlacement.reason === 'invalid_placement' && overlay.allAdditions.length === 0);

  const bought = attemptBuy(overlay, lamp, [2, 2], 0, 1000, true);
  check('valid buy with enough funds → ok, records an addition', bought.ok === true && overlay.allAdditions.length === 1 && bought.addition?.asset === 'lamp');

  const accident = asset({ id: 'fire', category: 'transient', buyPrice: 0 });
  const boughtAccident = attemptBuy(overlay, accident, [3, 3], 0, 1000, true);
  check('accident-category asset can never be bought even if somehow called with valid=true', boughtAccident.ok === false);

  const unbuyableDoor = asset({ id: 'door_basic', category: 'door', buyPrice: 150, buyable: false });
  const boughtDoor = attemptBuy(overlay, unbuyableDoor, [3, 3], 0, 1000, true);
  check('buyable:false asset can never be bought', boughtDoor.ok === false);

  // --- attemptSell: player-added instance
  const boughtInst: EffectiveInstance = { key: bought.addition!.key, asset: 'lamp', pos: [2, 2], rotDeg: 0, footprint: [1, 1], source: 'player' };
  const sellResult = attemptSell(overlay, boughtInst, lamp);
  check('sell refunds sellPrice and removes the player addition', sellResult.ok === true && sellResult.refund === 70 && overlay.allAdditions.length === 0);

  // --- attemptSell: designer instance
  const designerInst: EffectiveInstance = { key: 'designer#0', asset: 'sofa', pos: [1, 1], rotDeg: 0, footprint: [2, 1], source: 'designer', designerIndex: 0 };
  const sofa = asset({ id: 'sofa', sellPrice: 340 });
  const sellDesigner = attemptSell(overlay, designerInst, sofa);
  check('sell refunds sellPrice and marks the designer object sold (not deleted from the array — it never existed there)', sellDesigner.ok === true && sellDesigner.refund === 340 && overlay.isSold(0) === true);

  // --- attemptSell rejects doors/accidents
  const doorInst: EffectiveInstance = { key: 'designer#1', asset: 'door_basic', pos: [9, 9], rotDeg: 0, footprint: [1, 0.12], source: 'designer', designerIndex: 1 };
  const doorDef = asset({ id: 'door_basic', category: 'door', sellPrice: 110 });
  const sellDoor = attemptSell(overlay, doorInst, doorDef);
  check('door-category instance cannot be sold (no refund, no mutation)', sellDoor.ok === false && sellDoor.refund === 0 && overlay.isSold(1) === false);

  // --- attemptMove
  const movedInst: EffectiveInstance = { key: 'designer#2', asset: 'bed', pos: [5, 5], rotDeg: 90, footprint: [2, 3], source: 'designer', designerIndex: 2 };
  check('attemptMove with valid=false is rejected, no overlay change', attemptMove(overlay, movedInst, [6, 6], 0, false) === false && overlay.overrideFor(2) === undefined);
  check('attemptMove with valid=true records a moved override for a designer instance', attemptMove(overlay, movedInst, [6, 6], 0, true) === true && overlay.overrideFor(2)?.type === 'moved');

  const playerInst: EffectiveInstance = { key: 'buy#5', asset: 'lamp', pos: [1, 1], rotDeg: 0, footprint: [1, 1], source: 'player' };
  const overlay2 = new BuyOverlay();
  overlay2.addPurchase('lamp', [1, 1], 0); // seed so moveAddition has something to find (key differs, that's fine — exercises the miss path too)
  check('attemptMove on an unknown player addition key returns false', attemptMove(overlay2, playerInst, [2, 2], 0, true) === false);
  const realAddition = overlay2.allAdditions[0];
  const realPlayerInst: EffectiveInstance = { key: realAddition.key, asset: 'lamp', pos: [1, 1], rotDeg: 0, footprint: [1, 1], source: 'player' };
  check('attemptMove on a real player addition succeeds', attemptMove(overlay2, realPlayerInst, [2, 2], 90, true) === true);
  check('moved player addition reflects new pos/rot in effectiveInstances', (() => {
    const byId = new Map<string, AssetDef>([['lamp', lamp]]);
    const i = effectiveInstances([], overlay2, byId).find((x) => x.key === realAddition.key);
    return !!i && i.pos[0] === 2 && i.pos[1] === 2 && i.rotDeg === 90;
  })());
}

console.log('buymode.test — attemptDestroy / isRemoved (ROADMAP_NEXT item 6 fire destruction, no refund)');
{
  const overlay = new BuyOverlay();

  // --- destroying a designer object: no refund concept at this layer (attemptDestroy is void),
  // marks a `destroyed` override distinct from `sold`.
  const designerInst: EffectiveInstance = { key: 'designer#0', asset: 'sofa', pos: [1, 1], rotDeg: 0, footprint: [2, 1], source: 'designer', designerIndex: 0 };
  check('isSold/isRemoved both false before anything happens', overlay.isSold(0) === false && overlay.isRemoved(0) === false);
  attemptDestroy(overlay, designerInst);
  check('destroyDesigner records a "destroyed" override, not "sold"', overlay.overrideFor(0)?.type === 'destroyed' && overlay.isSold(0) === false);
  check('isRemoved is true for a destroyed designer object (same "gone" semantics as sold)', overlay.isRemoved(0) === true);

  // --- destroying a player addition deletes it from the overlay outright (same as attemptSell's
  // player-addition path) — no "destroyed" marker needed since it never existed in map data.
  const overlay2 = new BuyOverlay();
  const addition = overlay2.addPurchase('lamp', [3, 3], 0);
  const playerInst: EffectiveInstance = { key: addition.key, asset: 'lamp', pos: [3, 3], rotDeg: 0, footprint: [1, 1], source: 'player' };
  check('player addition present before destroy', overlay2.allAdditions.some((a) => a.key === addition.key));
  attemptDestroy(overlay2, playerInst);
  check('player addition removed after destroy', !overlay2.allAdditions.some((a) => a.key === addition.key));

  // --- effectiveInstances excludes a destroyed designer object exactly like a sold one
  const byId = new Map<string, AssetDef>([['sofa', asset({ id: 'sofa' })]]);
  const designerObjects: PlacedLike[] = [{ asset: 'sofa', pos: [1, 1], rotDeg: 0 }];
  check('destroyed designer object is excluded from effectiveInstances', !effectiveInstances(designerObjects, overlay, byId).some((i) => i.designerIndex === 0));
}

console.log('buymode.test — re-buy after sell (a fresh addition, not a restoration)');
{
  const sofaDef = asset({ id: 'sofa', buyPrice: 450, sellPrice: 340, footprint: [2, 1] });
  const byId = new Map<string, AssetDef>([['sofa', sofaDef]]);
  const designerObjects: PlacedLike[] = [{ asset: 'sofa', pos: [1, 1], rotDeg: 0 }];
  const overlay = new BuyOverlay();

  const designerInst: EffectiveInstance = { key: 'designer#0', asset: 'sofa', pos: [1, 1], rotDeg: 0, footprint: [2, 1], source: 'designer', designerIndex: 0 };
  const sell = attemptSell(overlay, designerInst, sofaDef);
  check('sell the designer sofa', sell.ok && overlay.isSold(0));
  check('designer sofa now gone from effectiveInstances', !effectiveInstances(designerObjects, overlay, byId).some((i) => i.designerIndex === 0));

  const isUnlocked = () => false;
  check('sofa is still purchasable from the catalog after being sold', isPurchasable(sofaDef, isUnlocked) === true);

  const rebuy = attemptBuy(overlay, sofaDef, [9, 9], 0, 1000, true);
  check('re-buying places a brand-new addition, not a restoration', rebuy.ok === true && rebuy.addition?.key !== 'designer#0');
  const finalInsts = effectiveInstances(designerObjects, overlay, byId);
  check('final state: original designer sofa stays sold, new addition present, exactly 1 sofa total', finalInsts.filter((i) => i.asset === 'sofa').length === 1 && finalInsts[0].source === 'player');
}

// --- ITEM 2 (2026-07-17): selling an ORIGINAL designer-placed object must DESTROY it — detached
//     from the world graph, not merely hidden. Many consumers scan world.children by userData.assetId
//     WITHOUT checking `.visible` (input.ts raycast for tap/hover/contextmenu, sim.ts findSeatFor for
//     seat candidacy), so a hidden-but-present sold object still gets hit / counted. Regression: after
//     a sale the tagged child is gone from world.children entirely.
console.log('buymode.test — ITEM 2 sold original object detached from world graph');
{
  const sofaDef = {
    id: 'sofa', name: 'Sofa', category: 'seating', footprint: [2, 1] as [number, number],
    buyPrice: 100, sellPrice: 50, interactions: [],
  } as unknown as AssetDef;
  const data = {
    map: { placedObjects: [{ asset: 'sofa', pos: [1, 1], rotDeg: 0 }] },
    assets: { categories: ['seating'], assets: [sofaDef] },
  } as unknown as GameData;
  const world = new THREE.Group();
  const placed = new THREE.Group();
  placed.userData = { assetId: 'sofa', placedIndex: 0 };
  placed.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()));
  world.add(placed);

  const ctrl = new BuyModeController(() => data, () => world);
  const inst = ctrl.instances().find((i) => i.designerIndex === 0);
  check('controller resolves the designer sofa before sale', !!inst);
  check('designer sofa is in the world graph before sale', world.children.includes(placed));

  const refund = ctrl.sellInstance(inst!, sofaDef);
  check('sale refunds the sell price', refund === 50);
  check('sold designer object detached from world graph (not hidden)', !world.children.includes(placed));
  check('no placedIndex-tagged child survives the sale', !world.children.some((c) => c.userData?.placedIndex === 0));

  // reattach (hot-reload path): buildWorld rebuilds the sold object fresh; reattach must detach it again.
  const rebuilt = new THREE.Group();
  const placed2 = new THREE.Group();
  placed2.userData = { assetId: 'sofa', placedIndex: 0 };
  placed2.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()));
  rebuilt.add(placed2);
  ctrl.reattach(rebuilt);
  check('reattach re-detaches the sold object after a world rebuild', !rebuilt.children.includes(placed2));
}

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall buymode tests passed');
