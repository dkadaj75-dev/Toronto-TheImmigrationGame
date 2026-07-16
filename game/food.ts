// food.ts — B4-2 carried-food lifecycle. Pure logic only: main.ts owns navigation/animation and
// AccidentsController owns transient visuals, while this registry decides spawn timing, carried /
// eating / dropped transitions, completion-only hunger, and in-game-hour perishing.

/** `arrival` is SimAgent.onActionStart: after the source asset's route reaches its use spot. */
export type FoodSpawnEvent = 'arrival' | 'completion';
export type FoodPhase = 'carried' | 'eating' | 'dropped';

export interface FoodConfig { hungerGain: number; perishHours: number; }
export interface FoodItem extends FoodConfig {
  key: string;
  assetId: string;
  phase: FoodPhase;
  pos: [number, number];
  droppedAtHour?: number;
}

/** The source-action timing is intentionally explicit: fridge Eat produces on use-spot arrival, while a
 * cooked meal does not exist unless Cook genuinely completes. */
export function foodAssetForActionEvent(actionId: string, event: FoodSpawnEvent): string | null {
  if (actionId === 'eat' && event === 'arrival') return 'snack';
  if (actionId === 'cook' && event === 'completion') return 'meal';
  return null;
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
 *  seat to the carry/eat second leg; every other seat-aware action keeps sitting in front of its
 *  target as before. Used at both order sites (main.ts tap menu + autonomy). */
export function firstLegSeatAware(action: { id: string; seatAware?: boolean }): boolean {
  return !!action.seatAware && !actionSpawnsCarriedFood(action.id);
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

  startCarrying(key: string, assetId: string, config: FoodConfig, pos: [number, number]): FoodItem {
    const item: FoodItem = { key, assetId, hungerGain: config.hungerGain, perishHours: config.perishHours, phase: 'carried', pos: [...pos] };
    this.items.set(key, item);
    this.activeKey = key;
    return item;
  }

  beginEating(key: string): boolean {
    const item = this.items.get(key);
    if (!item || item.phase !== 'carried' || this.activeKey !== key) return false;
    item.phase = 'eating';
    return true;
  }

  /** Interrupting either leg drops the food at the sim, beginning its in-game-hour perish timer. */
  interruptActive(pos: [number, number], nowHour: number): FoodItem | null {
    const item = this.active;
    if (!item || item.phase === 'dropped') return null;
    item.phase = 'dropped';
    item.pos = [...pos];
    item.droppedAtHour = nowHour;
    this.activeKey = null;
    return item;
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
    const perished: string[] = [];
    for (const item of this.items.values()) {
      if (item.phase !== 'dropped' || item.droppedAtHour === undefined) continue;
      if (nowHour - item.droppedAtHour < Math.max(0, item.perishHours)) continue;
      perished.push(item.key);
      this.items.delete(item.key);
    }
    return perished;
  }
}
