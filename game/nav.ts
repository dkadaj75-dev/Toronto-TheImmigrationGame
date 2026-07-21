// nav.ts — grid navigation (roadmap §5: "grid A* over the map's baked navigation grid").
// Phase 1 interim: the grid is baked at load time from floors/walls until the Map Editor
// (Phase 2) bakes and ships it inside the map JSON. Walls already contain door gaps as
// separate segments, so door cells come out walkable with no special casing.
// No gameplay numbers live here — cell size comes from map.gridSize.

import type { MapData, AssetsData } from './data';
import { resolveStateOverrides } from './assetstate';

export interface NavGrid {
  cols: number;
  rows: number;
  cellSize: number;
  /** walkable[row * cols + col] */
  walkable: Uint8Array;
}

export interface Cell { col: number; row: number; }

// ---------------------------------------------------------------- baking

/** `stateFor` (New.txt 2026-07-20 generalized states) reports a placed object's CURRENT state id
 *  so per-state footprint/nav overrides bake correctly — an open murphy bed blocks floor a closed
 *  one leaves walkable. Omitting it keeps the pre-state behaviour exactly. */
export function bakeNavGrid(
  map: MapData,
  assets?: AssetsData,
  stateFor?: (placedIndex: number, asset: string) => string | undefined,
): NavGrid {
  const cellSize = map.gridSize;
  const cols = Math.ceil(map.bounds.w / cellSize);
  const rows = Math.ceil(map.bounds.h / cellSize);
  const walkable = new Uint8Array(cols * rows);

  // 1) a cell is walkable if its center lies on any floor polygon
  const onFloor = new Uint8Array(cols * rows); // remembered for door carving
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = (c + 0.5) * cellSize;
      const cz = (r + 0.5) * cellSize;
      for (const floor of map.floors) {
        if (pointInPolygon(cx, cz, floor.polygon)) {
          walkable[r * cols + c] = 1;
          onFloor[r * cols + c] = 1;
          break;
        }
      }
    }
  }

  // 2) any cell a wall segment passes through is blocked
  //    (walls in the data already have door gaps, so doorways stay open)
  const wallBlocked = new Uint8Array(cols * rows); // remembered for door carving
  for (const wall of map.walls) {
    const [x1, z1] = wall.from, [x2, z2] = wall.to;
    const len = Math.hypot(x2 - x1, z2 - z1);
    const steps = Math.max(2, Math.ceil((len / cellSize) * 4)); // 4 samples per cell
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const col = Math.floor((x1 + (x2 - x1) * t) / cellSize);
      const row = Math.floor((z1 + (z2 - z1) * t) / cellSize);
      if (col >= 0 && col < cols && row >= 0 && row < rows) {
        walkable[row * cols + col] = 0;
        wallBlocked[row * cols + col] = 1;
      }
    }
  }

  // 3) placed-object footprints block cells (sims don't walk through couches).
  //    Footprint sizes come from assets.json; rotation handled in 90° steps.
  if (assets) {
    const byId = new Map(assets.assets.map((a) => [a.id, a]));
    map.placedObjects.forEach((p, placedIndex) => {
      const def = byId.get(p.asset);
      if (!def) return;
      const stateId = stateFor?.(placedIndex, p.asset);
      const view = stateId === undefined
        ? { blocksNav: def.blocksNav !== false, footprint: def.footprint }
        : resolveStateOverrides(def, stateId);
      if (!view.blocksNav) return; // walkable flat sprites (puddles, scorch) — absent still blocks
      let [w, d] = view.footprint;
      if ((((Math.round(p.rotDeg) % 180) + 180) % 180) === 90) [w, d] = [d, w];
      const x0 = p.pos[0] - w / 2, x1 = p.pos[0] + w / 2;
      const z0 = p.pos[1] - d / 2, z1 = p.pos[1] + d / 2;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const cx = (c + 0.5) * cellSize, cz = (r + 0.5) * cellSize;
          if (cx >= x0 && cx <= x1 && cz >= z0 && cz <= z1) walkable[r * cols + c] = 0;
        }
      }
    });
  }

  // 4) doors carve their opening walkable — LAST, so a doorway is sacred.
  //    Two rings: the doorway itself (across ≤ 1 cell) opens unconditionally, beating
  //    wall-endpoint sampling bleed AND furniture parked in the frame; the approach
  //    apron (across ≤ 2 cells) clears furniture footprints only, never genuine walls,
  //    so a couch overlapping a doorway can't seal the room but real geometry holds.
  //    Opening length = door.width from the map data (default 1.0 m, matching the
  //    rendered door).
  //    D1 (door-in-plain-wall): an ON-WALL door needs NO nav change — the wall blocks its cells
  //    in step 2 and this carve re-opens the doorway ring unconditionally, exactly like a gap
  //    door. Only `cutsWall: false` (a decorative door that cuts no hole) skips the carve, so a
  //    sim can never walk through a visually solid wall.
  for (const door of map.doors) {
    if (door.cutsWall === false) continue; // D1: decorative door — no pass-through
    const half = (door.width ?? 1.0) / 2;
    const [ax, az] = door.at;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (!onFloor[i]) continue;
        const cx = (c + 0.5) * cellSize, cz = (r + 0.5) * cellSize;
        const along = door.orientation === 'vertical' ? Math.abs(cz - az) : Math.abs(cx - ax);
        const across = door.orientation === 'vertical' ? Math.abs(cx - ax) : Math.abs(cz - az);
        if (along > half) continue;
        if (across <= cellSize) walkable[i] = 1;                      // the doorway itself
        else if (across <= cellSize * 2 && !wallBlocked[i]) walkable[i] = 1; // furniture apron
      }
    }
  }

  return { cols, rows, cellSize, walkable };
}

function pointInPolygon(x: number, z: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------- queries

export function worldToCell(grid: NavGrid, x: number, z: number): Cell {
  return { col: Math.floor(x / grid.cellSize), row: Math.floor(z / grid.cellSize) };
}

export function cellCenter(grid: NavGrid, cell: Cell): [number, number] {
  return [(cell.col + 0.5) * grid.cellSize, (cell.row + 0.5) * grid.cellSize];
}

export function isWalkable(grid: NavGrid, cell: Cell): boolean {
  if (cell.col < 0 || cell.col >= grid.cols || cell.row < 0 || cell.row >= grid.rows) return false;
  return grid.walkable[cell.row * grid.cols + cell.col] === 1;
}

/** Nearest walkable cell to a target (spiral search) — lets a tap on a wall/object land beside it. */
export function nearestWalkable(grid: NavGrid, from: Cell, maxRadius = 6): Cell | null {
  if (isWalkable(grid, from)) return from;
  for (let radius = 1; radius <= maxRadius; radius++) {
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== radius) continue; // ring only
        const cell = { col: from.col + dc, row: from.row + dr };
        if (isWalkable(grid, cell)) return cell;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------- A*

/** 8-connected A* with corner-cut prevention. Returns world-space waypoints (smoothed), or null. */
export function findPath(grid: NavGrid, startW: [number, number], goalW: [number, number]): [number, number][] | null {
  const start = nearestWalkable(grid, worldToCell(grid, startW[0], startW[1]));
  const goal = nearestWalkable(grid, worldToCell(grid, goalW[0], goalW[1]));
  if (!start || !goal) return null;

  const { cols, rows } = grid;
  const idx = (c: Cell) => c.row * cols + c.col;
  const open = new MinHeap();
  const g = new Float64Array(cols * rows).fill(Infinity);
  const cameFrom = new Int32Array(cols * rows).fill(-1);
  const closed = new Uint8Array(cols * rows);

  const h = (c: Cell) => {
    const dx = Math.abs(c.col - goal.col), dz = Math.abs(c.row - goal.row);
    return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz); // octile
  };

  g[idx(start)] = 0;
  open.push(idx(start), h(start));

  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

  while (open.size > 0) {
    const currentIdx = open.pop();
    if (closed[currentIdx]) continue;
    closed[currentIdx] = 1;
    const current: Cell = { col: currentIdx % cols, row: Math.floor(currentIdx / cols) };

    if (current.col === goal.col && current.row === goal.row) {
      return smoothPath(grid, reconstruct(grid, cameFrom, currentIdx));
    }

    for (const [dc, dr] of DIRS) {
      const nb: Cell = { col: current.col + dc, row: current.row + dr };
      if (!isWalkable(grid, nb)) continue;
      // no cutting corners diagonally past a blocked cell
      if (dc !== 0 && dr !== 0) {
        if (!isWalkable(grid, { col: current.col + dc, row: current.row }) ||
            !isWalkable(grid, { col: current.col, row: current.row + dr })) continue;
      }
      const nIdx = idx(nb);
      if (closed[nIdx]) continue;
      const cost = g[currentIdx] + (dc !== 0 && dr !== 0 ? Math.SQRT2 : 1);
      if (cost < g[nIdx]) {
        g[nIdx] = cost;
        cameFrom[nIdx] = currentIdx;
        open.push(nIdx, cost + h(nb));
      }
    }
  }
  return null;
}

function reconstruct(grid: NavGrid, cameFrom: Int32Array, endIdx: number): [number, number][] {
  const out: [number, number][] = [];
  let i = endIdx;
  while (i !== -1) {
    out.push(cellCenter(grid, { col: i % grid.cols, row: Math.floor(i / grid.cols) }));
    i = cameFrom[i];
  }
  return out.reverse();
}

/** String-pulling: drop waypoints that a straight walkable line can skip. */
function smoothPath(grid: NavGrid, pts: [number, number][]): [number, number][] {
  if (pts.length <= 2) return pts;
  const out: [number, number][] = [pts[0]];
  let anchor = 0;
  for (let i = 2; i < pts.length; i++) {
    if (!lineWalkable(grid, pts[anchor], pts[i])) {
      out.push(pts[i - 1]);
      anchor = i - 1;
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function lineWalkable(grid: NavGrid, a: [number, number], b: [number, number]): boolean {
  const dist = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const steps = Math.max(2, Math.ceil((dist / grid.cellSize) * 3));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cell = worldToCell(grid, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
    if (!isWalkable(grid, cell)) return false;
  }
  return true;
}

// ---------------------------------------------------------------- tiny binary heap

class MinHeap {
  private keys: number[] = [];
  private prios: number[] = [];
  get size() { return this.keys.length; }
  push(key: number, prio: number) {
    this.keys.push(key); this.prios.push(prio);
    let i = this.keys.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.prios[p] <= this.prios[i]) break;
      this.swap(i, p); i = p;
    }
  }
  pop(): number {
    const top = this.keys[0];
    const lastK = this.keys.pop()!, lastP = this.prios.pop()!;
    if (this.keys.length > 0) {
      this.keys[0] = lastK; this.prios[0] = lastP;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let s = i;
        if (l < this.keys.length && this.prios[l] < this.prios[s]) s = l;
        if (r < this.keys.length && this.prios[r] < this.prios[s]) s = r;
        if (s === i) break;
        this.swap(i, s); i = s;
      }
    }
    return top;
  }
  private swap(a: number, b: number) {
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
    [this.prios[a], this.prios[b]] = [this.prios[b], this.prios[a]];
  }
}
