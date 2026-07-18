// assetstate.ts — B6-12 runtime ON/OFF state for placed assets.
// Pure/headless-testable: the registry stores only stable instance keys and booleans. The thin
// THREE/audio synchronization lives in world.ts/main.ts.

import type { AssetDef } from './data';

export interface ResolvedAssetLight {
  color: string | number;
  intensity: number;
  distance: number;
  yOffset: number;
  defaultOn: boolean;
}

export interface AssetStateSaveState { on: Record<string, boolean> }

export function resolveAssetLight(def: Pick<AssetDef, 'light'>): ResolvedAssetLight | null {
  if (!def.light) return null;
  return {
    color: def.light.color ?? '#fff4d6',
    intensity: Math.max(0, def.light.intensity ?? 2),
    distance: Math.max(0, def.light.distance ?? 5),
    yOffset: def.light.yOffset ?? 1.2,
    defaultOn: def.light.defaultOn ?? false,
  };
}

/** An asset is explicitly stateful when it offers either generic power action. Light-only assets
 * may still have a default visual state, but their legacy action-target sound semantics are kept
 * unless the designer actually gives the player a power toggle. */
export function isStatefulAsset(def: Pick<AssetDef, 'interactions'>): boolean {
  return def.interactions.includes('turn_on') || def.interactions.includes('turn_off');
}

export function defaultAssetOn(def: Pick<AssetDef, 'light'>): boolean {
  return def.light?.defaultOn ?? false;
}

/** Context-menu half of action availability. Quest conditions remain a separate shared filter;
 * this helper only owns the per-instance ON/OFF dimension. */
export function isAssetStateActionAvailable(actionId: string, on: boolean): boolean {
  if (actionId === 'turn_on') return !on;
  if (actionId === 'turn_off') return on;
  return true;
}

/** Power side effect at action start. B13-2: data-driven — any action with the sparse
 * `powersOnTarget` flag switches its stateful target ON and leaves it on, Sims-style (every
 * Watch-TV channel, not just the one that happened to carry the `watch_tv` id).
 * `turn_on`/`turn_off` stay the generic explicit toggles. */
export function powerStateForAction(
  actionId: string,
  action?: { powersOnTarget?: boolean } | null,
): boolean | null {
  if (actionId === 'turn_off') return false;
  if (actionId === 'turn_on' || action?.powersOnTarget) return true;
  return null;
}

export class AssetStateRegistry {
  private readonly on = new Map<string, boolean>();

  isOn(key: string, def: Pick<AssetDef, 'light'>): boolean {
    if (!this.on.has(key)) this.on.set(key, defaultAssetOn(def));
    return this.on.get(key)!;
  }

  setOn(key: string, value: boolean): void { this.on.set(key, value); }

  serialize(): AssetStateSaveState { return { on: Object.fromEntries(this.on) }; }

  restore(state: AssetStateSaveState): void {
    this.on.clear();
    for (const [key, value] of Object.entries(state.on ?? {})) this.on.set(key, !!value);
  }
}
