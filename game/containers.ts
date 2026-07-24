// containers.ts - pure generalized per-instance container bookkeeping and selection.

import type { AssetDef } from './data';

/** Intentionally retains the old save envelope so existing `garbage` saves restore unchanged. */
export interface ContainerSaveState { fills: [string, number][]; }

export class ContainerRegistry {
  private fill = new Map<string, number>();

  fillOf(key: string): number { return this.fill.get(key) ?? 0; }

  remainingSpace(key: string, capacity: number): number {
    if (!(capacity > 0) || !Number.isFinite(capacity)) return 0;
    return Math.max(0, capacity - this.fillOf(key));
  }

  isFull(key: string, capacity: number): boolean {
    return this.remainingSpace(key, capacity) <= 0;
  }

  /** Atomic variable-size deposit. Rejected deposits never partially fill a container. */
  deposit(key: string, capacity: number, amount = 1): boolean {
    if (!(amount > 0) || !Number.isFinite(amount)) return false;
    if (this.remainingSpace(key, capacity) < amount) return false;
    this.fill.set(key, this.fillOf(key) + amount);
    return true;
  }

  /** Clears one exact live container instance. */
  empty(key: string): boolean {
    const hadFill = this.fillOf(key) > 0;
    this.fill.delete(key);
    return hadFill;
  }

  /** Legacy compatibility for the former global garbage-emptying path. */
  emptyAll() { this.fill.clear(); }

  serialize(): ContainerSaveState { return { fills: [...this.fill.entries()] }; }

  restore(state: ContainerSaveState | null | undefined) {
    this.fill = new Map(
      (state?.fills ?? []).filter((entry): entry is [string, number] =>
        Array.isArray(entry) && typeof entry[0] === 'string'
          && typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] > 0),
    );
  }
}

export interface ContainerCandidate {
  key: string;
  assetId?: string;
  pos: [number, number];
  capacity: number;
  y?: number;
}

export interface NearestContainer {
  key: string;
  pos: [number, number];
  dist: number;
}

/** New generic capacity wins; legacy garbage capacity remains readable without data migration. */
export function containerCapacity(def: Pick<AssetDef, 'container' | 'garbage'> | null | undefined): number | null {
  const capacity = def?.container?.capacity ?? def?.garbage?.capacity;
  return typeof capacity === 'number' && Number.isFinite(capacity) && capacity > 0 ? capacity : null;
}

/** Absent is deliberately off, rather than silently making every transient occupy one unit. */
export function transientContainerSpace(def: Pick<AssetDef, 'containerSpace'> | null | undefined): number | null {
  const space = def?.containerSpace;
  return typeof space === 'number' && Number.isFinite(space) && space > 0 ? space : null;
}

/** Nearest compatible container that can accept the entire item (no partial deposits). */
export function findNearestContainerWithSpace(
  simPos: [number, number],
  containers: readonly ContainerCandidate[],
  fillOf: (key: string) => number,
  requiredSpace = 1,
  containerAssetId?: string,
): NearestContainer | null {
  if (!(requiredSpace > 0) || !Number.isFinite(requiredSpace)) return null;
  let best: NearestContainer | null = null;
  for (const container of containers) {
    if (containerAssetId !== undefined && container.assetId !== containerAssetId) continue;
    if (container.capacity - fillOf(container.key) < requiredSpace) continue;
    const dist = Math.hypot(container.pos[0] - simPos[0], container.pos[1] - simPos[1]);
    if (!best || dist < best.dist) best = { key: container.key, pos: container.pos, dist };
  }
  return best;
}

/** Resolves and deposits as one operation; useful for completion-time capacity rechecks. */
export function depositAtNearestContainer(
  registry: ContainerRegistry,
  simPos: [number, number],
  containers: readonly ContainerCandidate[],
  requiredSpace = 1,
  containerAssetId?: string,
): string | null {
  const nearest = findNearestContainerWithSpace(simPos, containers, (key) => registry.fillOf(key), requiredSpace, containerAssetId);
  const container = nearest ? containers.find((entry) => entry.key === nearest.key) : undefined;
  if (!nearest || !container || !registry.deposit(nearest.key, container.capacity, requiredSpace)) return null;
  return nearest.key;
}
