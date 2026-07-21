// assetstate.ts — B6-12 runtime ON/OFF state for placed assets.
// Pure/headless-testable: the registry stores only stable instance keys and booleans. The thin
// THREE/audio synchronization lives in world.ts/main.ts.

import type { AssetDef, AssetStateDef } from './data';

export interface ResolvedAssetLight {
  color: string | number;
  intensity: number;
  distance: number;
  yOffset: number;
  defaultOn: boolean;
}

/** `on` is the pre-generalization boolean map, still written so an older build can read new saves;
 *  `states` is the generalized per-instance state id map and wins on restore. */
export interface AssetStateSaveState { on: Record<string, boolean>; states?: Record<string, string> }

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

// ---------------------------------------------------------------------------------------------
// New.txt (2026-07-20) — GENERALIZED STATES.
//
// The ON/OFF pair above is now just the built-in special case. An asset may declare its own
// `states` (closed/open, shut/ajar, …); each state chooses the mesh, which interactions it offers,
// and optional nav/footprint overrides, while an action's `setsState` names the state it leaves the
// asset in. Those two fields form a transition GRAPH, which is what lets autonomy "read through"
// states: wanting to sleep on a closed murphy bed resolves to open-then-sleep.
//
// Backward compatibility is absolute: an asset WITHOUT `states` behaves exactly as before, modelled
// as the implicit pair below so one code path serves both.
export const LEGACY_ON = 'on';
export const LEGACY_OFF = 'off';

/** The asset's authored states, or [] when it uses the implicit legacy ON/OFF pair. */
export function assetStates(def: Pick<AssetDef, 'states'>): AssetStateDef[] {
  return (def.states ?? []).filter((state) => !!state?.id?.trim());
}

export function hasCustomStates(def: Pick<AssetDef, 'states'>): boolean {
  return assetStates(def).length > 0;
}

/** The state a freshly placed instance starts in: the flagged default, else the first authored
 *  state, else the legacy pair's ON/OFF derived from `light.defaultOn`. */
export function defaultStateId(def: Pick<AssetDef, 'states' | 'light'>): string {
  const states = assetStates(def);
  if (states.length) return (states.find((state) => state.default) ?? states[0]).id;
  return defaultAssetOn(def) ? LEGACY_ON : LEGACY_OFF;
}

export function stateDef(def: Pick<AssetDef, 'states'>, stateId: string): AssetStateDef | undefined {
  return assetStates(def).find((state) => state.id === stateId);
}

/** Which of the asset's interactions are offered in `stateId`. A state with no `interactions`
 *  list offers everything the asset lists; the legacy pair keeps the turn_on/turn_off rule. */
export function actionsForState(
  def: Pick<AssetDef, 'states' | 'interactions'>,
  stateId: string,
): string[] {
  if (!hasCustomStates(def)) {
    return def.interactions.filter((id) => isAssetStateActionAvailable(id, stateId === LEGACY_ON));
  }
  const state = stateDef(def, stateId);
  const allowed = state?.interactions;
  if (!allowed) return [...def.interactions];
  return def.interactions.filter((id) => allowed.includes(id));
}

export function isActionAvailableInState(
  def: Pick<AssetDef, 'states' | 'interactions'>,
  stateId: string,
  actionId: string,
): boolean {
  return actionsForState(def, stateId).includes(actionId);
}

/** The state this action leaves the asset in, or null when it changes nothing. `setsState` wins;
 *  otherwise the legacy turn_on/turn_off/powersOnTarget mapping still applies. An unknown
 *  `setsState` id is ignored rather than stranding the instance in a state that does not exist. */
export function stateAfterAction(
  def: Pick<AssetDef, 'states'>,
  actionId: string,
  action?: { setsState?: string; powersOnTarget?: boolean } | null,
): string | null {
  const target = action?.setsState?.trim();
  if (target) {
    if (!hasCustomStates(def)) return target === LEGACY_ON || target === LEGACY_OFF ? target : null;
    return stateDef(def, target) ? target : null;
  }
  if (hasCustomStates(def)) return null; // custom-state assets transition only through setsState
  const power = powerStateForAction(actionId, action);
  return power === null ? null : power ? LEGACY_ON : LEGACY_OFF;
}

/**
 * "Read through the states": the ordered action ids that take this asset from `fromStateId` to a
 * state where `goalActionId` is available. Returns [] when the goal is already available, and null
 * when no sequence of transitions reaches it (unreachable, or the goal is not an asset action).
 *
 * A breadth-first walk over the transition graph, so the SHORTEST route wins and cycles terminate.
 * Only actions actually offered in the state being expanded are considered, so a designer cannot
 * accidentally plan through a transition the sim could never perform.
 */
export function planToReachAction(
  def: Pick<AssetDef, 'states' | 'interactions'>,
  fromStateId: string,
  goalActionId: string,
  actionsById: ReadonlyMap<string, { setsState?: string; powersOnTarget?: boolean }>,
): string[] | null {
  if (!def.interactions.includes(goalActionId)) return null;
  if (isActionAvailableInState(def, fromStateId, goalActionId)) return [];
  const seen = new Set<string>([fromStateId]);
  const queue: { state: string; path: string[] }[] = [{ state: fromStateId, path: [] }];
  while (queue.length) {
    const { state, path } = queue.shift()!;
    for (const actionId of actionsForState(def, state)) {
      const next = stateAfterAction(def, actionId, actionsById.get(actionId) ?? null);
      if (!next || seen.has(next)) continue;
      const nextPath = [...path, actionId];
      if (isActionAvailableInState(def, next, goalActionId)) return nextPath;
      seen.add(next);
      queue.push({ state: next, path: nextPath });
    }
  }
  return null;
}

/** Per-state overrides the world/nav layers consume; absent fields fall back to the asset's own. */
export function resolveStateOverrides(
  def: Pick<AssetDef, 'states' | 'mesh' | 'blocksNav' | 'footprint'>,
  stateId: string,
): { mesh: string; blocksNav: boolean; footprint: [number, number] } {
  const state = stateDef(def, stateId);
  return {
    mesh: state?.mesh?.trim() || def.mesh,
    blocksNav: state?.blocksNav ?? def.blocksNav ?? true,
    footprint: state?.footprint ?? def.footprint,
  };
}

export class AssetStateRegistry {
  /** Per-instance CURRENT state id. Legacy on/off assets store the implicit 'on'/'off' ids, so a
   *  single map serves both models (isOn/setOn below stay as the legacy façade). */
  private readonly states = new Map<string, string>();

  stateOf(key: string, def: Pick<AssetDef, 'states' | 'light'>): string {
    if (!this.states.has(key)) this.states.set(key, defaultStateId(def));
    return this.states.get(key)!;
  }

  /** Set one instance's state; returns whether observers need to recompute derived state. */
  setState(key: string, stateId: string): boolean {
    const previous = this.states.get(key);
    this.states.set(key, stateId);
    return previous !== stateId;
  }

  isOn(key: string, def: Pick<AssetDef, 'light' | 'states'>): boolean {
    return this.stateOf(key, def) === LEGACY_ON;
  }

  setOn(key: string, value: boolean): boolean {
    return this.setState(key, value ? LEGACY_ON : LEGACY_OFF);
  }

  serialize(): AssetStateSaveState {
    const on: Record<string, boolean> = {};
    const states: Record<string, string> = {};
    for (const [key, stateId] of this.states) {
      states[key] = stateId;
      // Keep writing the legacy boolean map so an older build can still load this save.
      if (stateId === LEGACY_ON || stateId === LEGACY_OFF) on[key] = stateId === LEGACY_ON;
    }
    return { on, states };
  }

  restore(state: AssetStateSaveState): void {
    this.states.clear();
    // Pre-generalization saves carry only `on`; newer ones carry `states` and win where both exist.
    for (const [key, value] of Object.entries(state.on ?? {})) this.states.set(key, value ? LEGACY_ON : LEGACY_OFF);
    for (const [key, value] of Object.entries(state.states ?? {})) {
      if (typeof value === 'string' && value) this.states.set(key, value);
    }
  }
}
