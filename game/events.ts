// events.ts — New.txt #6 event manager, PURE half (ROADMAP_EVENTS.md).
//
// An "event" is a designer-authored BUNDLE OF EFFECTS with an id, callable from anywhere: an
// interaction completing, an asset entering a state, a quest finishing, an accident spawning. The
// key architectural rule (ROADMAP_EVENTS §2) is that this module implements NO gameplay: it
// evaluates the optional gate + chance roll and returns a typed, ordered effect list. main.ts's
// applier maps each effect onto the subsystem that already implements it (funds -> QuestRunner,
// needs -> SimStats, visas -> VisaMachine, transients -> AccidentRegistry, …), so events are pure
// WIRING over existing systems rather than a second implementation of them.
//
// Headless-testable: no DOM, no three.js. Malformed data degrades to "no effects" instead of
// throwing, matching resolveVar's never-throw precedent.

import type { EventDef, EventEffect, EventsData } from './data';
import { evaluate, type EvalContext } from './quests';

/** Where an effect applies. `target` = the asset instance that fired the event, `sim` = the player
 *  sim; an explicit asset id is resolved by the caller. Absent = `target` when one exists. */
export type EventTargetScope = 'target' | 'sim' | string;

export interface EventFireContext {
  /** Shared condition evaluator context — the SAME namespace quests/interactions/behavior use. */
  eval: EvalContext;
  /** Deterministic in tests; Math.random in the game. */
  rng?: () => number;
}

/** One effect resolved for application, with its scope defaulted. */
export interface ResolvedEventEffect {
  effect: EventEffect;
  scope: EventTargetScope;
}

export interface EventResolution {
  /** Empty when the event did not fire (unknown id, failed gate, lost roll) — never null, so the
   *  applier can stay a plain for-of with no special cases. */
  effects: ResolvedEventEffect[];
  fired: boolean;
  /** Why it did not fire — surfaced by the Event Editor preview, never shown in-game. */
  reason?: 'unknown' | 'conditions' | 'chance' | 'empty';
}

const NOT_FIRED = (reason: EventResolution['reason']): EventResolution => ({ effects: [], fired: false, reason });

export function findEvent(data: EventsData | undefined, id: string): EventDef | undefined {
  return data?.events?.find((event) => event.id === id);
}

/**
 * Decide whether `id` fires and, if so, what it does. Order is preserved exactly as authored, so a
 * designer can rely on "notify, then damage, then change state" reading top to bottom.
 *
 * `chancePercent` is sparse: absent (or >= 100) always fires; <= 0 never does. The roll is taken
 * ONCE per call so a 50% event cannot half-apply.
 */
export function resolveEvent(
  data: EventsData | undefined,
  id: string,
  ctx: EventFireContext,
): EventResolution {
  const def = findEvent(data, id);
  if (!def) return NOT_FIRED('unknown');
  if (def.conditions && !evaluate(def.conditions, ctx.eval)) return NOT_FIRED('conditions');
  const chance = def.chancePercent;
  if (typeof chance === 'number' && Number.isFinite(chance)) {
    if (chance <= 0) return NOT_FIRED('chance');
    if (chance < 100) {
      const rawRoll = (ctx.rng ?? Math.random)();
      const roll = Number.isFinite(rawRoll) ? Math.min(0.999999999999, Math.max(0, rawRoll)) : 1;
      if (roll * 100 >= chance) return NOT_FIRED('chance');
    }
  }
  const effects = (def.effects ?? [])
    .filter((effect): effect is EventEffect => !!effect && typeof effect.type === 'string')
    .map((effect) => ({ effect, scope: (effect.at?.trim() || 'target') as EventTargetScope }));
  if (!effects.length) return NOT_FIRED('empty');
  return { effects, fired: true };
}

/**
 * Composition guard (ROADMAP_EVENTS §4 "infinite loops"): an event may fire another event, but the
 * applier must refuse to recurse past this depth. Returning a decision instead of throwing keeps
 * the never-throw rule; the caller logs the chain so the designer can see what looped.
 */
export const MAX_EVENT_DEPTH = 8;

export function canFireAtDepth(depth: number): boolean {
  return Number.isFinite(depth) && depth >= 0 && depth < MAX_EVENT_DEPTH;
}

/** Every event id this event can reach, following `fireEvent` effects. Pure graph walk used by the
 *  Event Editor to warn about cycles BEFORE the designer ships one. Cycles terminate. */
export function reachableEvents(data: EventsData | undefined, id: string): string[] {
  const seen = new Set<string>();
  const queue = [id];
  const out: string[] = [];
  while (queue.length) {
    const current = queue.shift()!;
    const def = findEvent(data, current);
    if (!def) continue;
    for (const effect of def.effects ?? []) {
      if (effect?.type !== 'fireEvent') continue;
      const next = effect.event?.trim();
      if (!next || seen.has(next)) continue;
      seen.add(next);
      out.push(next);
      queue.push(next);
    }
  }
  return out;
}

/** True when following `fireEvent` effects from `id` leads back to `id`. */
export function eventCycles(data: EventsData | undefined, id: string): boolean {
  return reachableEvents(data, id).includes(id);
}

export interface EventFiringSaveState {
  /** event id -> sim-time seconds it last fired (drives cooldownSeconds). */
  lastFired: Record<string, number>;
  /** event ids that have fired and carry onceOnly (must never fire again). */
  firedOnce: string[];
}

/**
 * New.txt #6 E4 throttle: tracks WHEN each event last fired and which onceOnly events are spent, so
 * a leak cannot re-fire every second and a one-time event stays spent across save/load. Unlike
 * occupancy (which is action-derived and correctly transient), this IS persisted — a once-only
 * event that already fired must stay fired after a reload. Pure/headless; the applier consults
 * `canFire` before applying and calls `markFired` after.
 */
export class EventFiringRegistry {
  private readonly lastFired = new Map<string, number>();
  private readonly firedOnce = new Set<string>();

  /** May `def` fire now (sim-time `nowSeconds`)? False if onceOnly-spent or still in cooldown. */
  canFire(def: Pick<EventDef, 'id' | 'cooldownSeconds' | 'onceOnly'>, nowSeconds: number): boolean {
    if (def.onceOnly && this.firedOnce.has(def.id)) return false;
    const cooldown = def.cooldownSeconds;
    if (typeof cooldown === 'number' && Number.isFinite(cooldown) && cooldown > 0) {
      const last = this.lastFired.get(def.id);
      if (last !== undefined && Number.isFinite(nowSeconds) && nowSeconds - last < cooldown) return false;
    }
    return true;
  }

  /** Record a fire. Call ONLY after the event actually fired (resolveEvent.fired && canFire). */
  markFired(def: Pick<EventDef, 'id' | 'onceOnly'>, nowSeconds: number): void {
    if (Number.isFinite(nowSeconds)) this.lastFired.set(def.id, nowSeconds);
    if (def.onceOnly) this.firedOnce.add(def.id);
  }

  serialize(): EventFiringSaveState {
    return { lastFired: Object.fromEntries(this.lastFired), firedOnce: [...this.firedOnce] };
  }

  restore(state: EventFiringSaveState | undefined): void {
    this.lastFired.clear();
    this.firedOnce.clear();
    for (const [id, when] of Object.entries(state?.lastFired ?? {})) {
      if (typeof when === 'number' && Number.isFinite(when)) this.lastFired.set(id, when);
    }
    for (const id of state?.firedOnce ?? []) if (typeof id === 'string') this.firedOnce.add(id);
  }
}
