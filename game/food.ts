// food.ts — B4-2 carried-food lifecycle. Pure logic only: main.ts owns navigation/animation and
// AccidentsController owns transient visuals, while this registry decides spawn timing, carried /
// eating / dropped transitions, completion-only hunger, and in-game-hour perishing.

/** `arrival` is SimAgent.onActionStart: after the source asset's route reaches its use spot. */
export type FoodSpawnEvent = 'arrival' | 'completion';
export type FoodPhase = 'carried' | 'eating' | 'dropped';

export interface FoodConfig { hungerGain: number; perishHours: number; rottenAssetId?: string; }
export interface FoodItem extends FoodConfig {
  key: string;
  assetId: string;
  phase: FoodPhase;
  pos: [number, number];
  droppedAtHour?: number;
  /** ROADMAP item 1 fix: the clearable WASTE asset id (e.g. "dirty_dishes") this food becomes when
   *  abandoned mid-carry/eat, so a dropped item is a proper cleanable transient instead of an
   *  uncleanable, self-perishing snack/meal. Recorded at startCarrying from the Eat action's
   *  producesWaste. Absent = no waste recorded (older items / test doubles). */
  wasteAssetId?: string;
}

export interface FoodSaveState { items: FoodItem[]; }
export interface FoodInterruption { item: FoodItem; consumedGain: number; }
export interface PerishedFood { key: string; assetId: string; rottenAssetId?: string; pos: [number, number]; }

/** ROADMAP item 2: an action id belongs to a carried-food FAMILY when it is the base id or a
 *  `base_` variant. This lets the designer author meal-tier variants (`cook_light_meal`,
 *  `cook_large_meal`) that all spawn the same `meal` transient and differ only through their sparse
 *  ActionDef.food override — without any code change per new action. */
function inActionFamily(actionId: string, base: string): boolean {
  return actionId === base || actionId.startsWith(`${base}_`);
}

/** The source-action timing is intentionally explicit: an eat-family action (fridge) produces a
 *  `snack` on use-spot arrival, while a cook-family action (stove) produces a `meal` only if Cook
 *  genuinely completes. */
export function foodAssetForActionEvent(actionId: string, event: FoodSpawnEvent): string | null {
  if (event === 'arrival' && inActionFamily(actionId, 'eat')) return 'snack';
  if (event === 'completion' && inActionFamily(actionId, 'cook')) return 'meal';
  return null;
}

/** ROADMAP item 2: a source ACTION's sparse override of the spawned food transient's own food block
 *  (AssetDef.food). Present fields win; absent fields fall back to the asset default. */
export interface FoodOverride { hungerGain?: number; perishHours?: number; }

/** Merge a food transient's default food block with an optional per-action override. The result's
 *  hungerGain is the value the B7-2 cooking-skill scaling (cookedMealHungerGain) then multiplies —
 *  the override changes the BASE, the skill proportionality still applies on top. */
export function resolveFoodConfig(base: FoodConfig, override?: FoodOverride | null): FoodConfig {
  return {
    hungerGain: override?.hungerGain ?? base.hungerGain,
    perishHours: override?.perishHours ?? base.perishHours,
    rottenAssetId: base.rottenAssetId,
  };
}

/** ROADMAP item 1 fix: the clearable waste an abandoned carried-food item turns into (or null if
 *  none was recorded). Pulled out as its own pure function so main.ts's drop-to-waste conversion is
 *  independently unit-tested. */
/** @deprecated Current interruptions preserve edible food; retained for old callers/save fixtures. */
export function wasteAssetForDroppedFood(item: { wasteAssetId?: string }): string | null {
  return item.wasteAssetId ?? null;
}

/** ROADMAP_NEXT B7-4: true when performing this action at its SOURCE asset spawns a carried-food item
 *  that the sim then walks to a seat to eat (fridge Eat → snack on arrival, stove Cook → meal on
 *  completion). Such an action's FIRST leg MUST walk to the food source, so its order must NOT resolve
 *  a seat up front even if the action is `seatAware` — otherwise the sim beelines to a chair near the
 *  fridge and never visits it (the carried snack then spawns at the seat: no fridge trip at all). The
 *  seat is chosen only for the SECOND leg (main.ts startCarriedFood → its own nearestFoodSeat). The
 *  two-leg decision at both order sites is therefore `seatAware && !actionSpawnsCarriedFood(id)`. */
export function actionSpawnsCarriedFood(actionId: string): boolean {
  return foodAssetForActionEvent(actionId, 'arrival') !== null
    || foodAssetForActionEvent(actionId, 'completion') !== null;
}

/** ROADMAP_NEXT B7-4: the two-leg order decision — whether the FIRST leg of ordering `action` should
 *  resolve a seat (walk to the seat) rather than to the target asset. Food-source actions defer their
 *  seat to the carry/eat second leg; generic fetchBeforeSeat actions use the same source-first
 *  decision. Every other seat-aware action keeps sitting in front of its target as before. Used
 *  at both order sites (main.ts tap menu + autonomy). */
export interface TwoLegSeatAction { id: string; seatAware?: boolean; fetchBeforeSeat?: boolean; }

/** Whether a seat-aware action deliberately visits its source before resolving a seat. Food
 *  sources imply this from their lifecycle; other actions opt in sparsely through ActionDef. */
export function defersSeatToSecondLeg(action: TwoLegSeatAction): boolean {
  return action.fetchBeforeSeat === true || actionSpawnsCarriedFood(action.id);
}

export function firstLegSeatAware(action: TwoLegSeatAction): boolean {
  return !!action.seatAware && !defersSeatToSecondLeg(action);
}

/** Clone used after a generic source fetch. Clearing the flag prevents the arrival callback from
 *  starting a third leg while retaining the action id, gains, duration, animation, and facing. */
export function actionAfterSourceFetch<T extends TwoLegSeatAction>(action: T): T {
  const { fetchBeforeSeat: _completedFetch, ...secondLeg } = action;
  return secondLeg as T;
}

export interface CookHungerTuning { cookHungerAtSkill0: number; cookHungerAtSkillMax: number; }

/** ROADMAP_NEXT B7-2: a COOKED meal's hunger fulfillment scales with the sim's cooking skill — a
 *  novice's meal barely fills, a master's overfills. Snacks (fridge) never call this. Pure lerp:
 *  factor = lerp(atSkill0, atSkillMax, clamp(cookingSkill/skillMax, 0..1)); effective = base * factor. */
export function cookedMealHungerGain(baseHungerGain: number, cookingSkill: number, skillMax: number, tuning: CookHungerTuning): number {
  const t = skillMax > 0 ? Math.min(1, Math.max(0, cookingSkill / skillMax)) : 0;
  const factor = tuning.cookHungerAtSkill0 + (tuning.cookHungerAtSkillMax - tuning.cookHungerAtSkill0) * t;
  return baseHungerGain * factor;
}

export class FoodRegistry {
  private items = new Map<string, FoodItem>();
  private activeKey: string | null = null;

  get all(): readonly FoodItem[] { return [...this.items.values()]; }
  get active(): FoodItem | null { return this.activeKey ? this.items.get(this.activeKey) ?? null : null; }

  startCarrying(key: string, assetId: string, config: FoodConfig, pos: [number, number], wasteAssetId?: string): FoodItem {
    const item: FoodItem = { key, assetId, hungerGain: config.hungerGain, perishHours: config.perishHours, rottenAssetId: config.rottenAssetId, phase: 'carried', pos: [...pos], wasteAssetId };
    this.items.set(key, item);
    this.activeKey = key;
    return item;
  }

  /** ROADMAP item 1 fix: remove an item outright (once main.ts has converted a dropped item into
   *  clearable waste), clearing the active pointer if it was the one. Unlike `tick`'s perish path,
   *  this leaves nothing behind to silently self-despawn. */
  /** Removes an item outright; current interruption handling does not use this to make waste. */
  discard(key: string): boolean {
    const existed = this.items.delete(key);
    if (this.activeKey === key) this.activeKey = null;
    return existed;
  }

  beginEating(key: string): boolean {
    const item = this.items.get(key);
    if (!item || (item.phase !== 'carried' && item.phase !== 'dropped')) return false;
    if (this.activeKey !== null && this.activeKey !== key) return false;
    item.phase = 'eating';
    delete item.droppedAtHour;
    this.activeKey = key;
    return true;
  }

  /** Interrupting either leg drops the food at the sim, beginning its in-game-hour perish timer. */
  interruptActive(pos: [number, number], nowHour: number): FoodItem | null {
    return this.interruptActiveWithProgress(pos, nowHour, 0)?.item ?? null;
  }

  /** Preserve the uneaten fraction and report the already-consumed gain. Progress is clamped and
   * applied only while eating; interrupting the carry leg consumes nothing. */
  interruptActiveWithProgress(pos: [number, number], nowHour: number, progress: number): FoodInterruption | null {
    const item = this.active;
    if (!item || item.phase === 'dropped') return null;
    const fraction = item.phase === 'eating' && Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
    const consumedGain = item.hungerGain * fraction;
    item.hungerGain = Math.max(0, item.hungerGain - consumedGain);
    item.phase = 'dropped';
    item.pos = [...pos];
    item.droppedAtHour = nowHour;
    this.activeKey = null;
    return { item, consumedGain };
  }

  /** Only a food item that reached its eating phase grants hunger. The item is consumed atomically. */
  completeEating(key: string, currentHunger: number, maxHunger = 100): { hunger: number; gain: number } | null {
    const item = this.items.get(key);
    if (!item || item.phase !== 'eating' || this.activeKey !== key) return null;
    const hunger = Math.min(maxHunger, Math.max(0, currentHunger + item.hungerGain));
    const gain = hunger - currentHunger;
    this.items.delete(key);
    this.activeKey = null;
    return { hunger, gain };
  }

  /** Despawns dropped food at the inclusive perish boundary. Carried/eating food never perishes. */
  tick(nowHour: number): string[] {
    return this.tickDetailed(nowHour).map((item) => item.key);
  }

  tickDetailed(nowHour: number): PerishedFood[] {
    const perished: PerishedFood[] = [];
    for (const item of this.items.values()) {
      if (item.phase !== 'dropped' || item.droppedAtHour === undefined) continue;
      if (nowHour - item.droppedAtHour < Math.max(0, item.perishHours)) continue;
      perished.push({ key: item.key, assetId: item.assetId, rottenAssetId: item.rottenAssetId, pos: [...item.pos] });
      this.items.delete(item.key);
    }
    return perished;
  }

  /** A dropped food transient selected in-world becomes the active item for a designer-authored
   * consumesFood action. */
  activateDropped(key: string): FoodItem | null {
    const item = this.items.get(key);
    if (!item || item.phase !== 'dropped' || this.activeKey !== null) return null;
    this.activeKey = key;
    return item;
  }

  serialize(): FoodSaveState {
    return { items: this.all.map((item) => ({ ...item, pos: [...item.pos] })) };
  }

  /** Active carry/eat phases belong to the deliberately-unsaved in-flight action. They are
   * discarded on load; only already-dropped food is stable, world-independent runtime state. */
  restore(saved: FoodSaveState): void {
    this.items.clear();
    this.activeKey = null;
    for (const item of saved?.items ?? []) {
      if (item?.phase !== 'dropped' || !item.key || !item.assetId || !Array.isArray(item.pos)) continue;
      this.items.set(item.key, { ...item, pos: [item.pos[0], item.pos[1]] });
    }
  }
}
