// food.ts — B4-2 carried-food lifecycle. Pure logic only: main.ts owns navigation/animation and
// AccidentsController owns transient visuals, while this registry decides spawn timing, carried /
// eating / dropped transitions, completion-only hunger, and in-game-hour perishing.

export type FoodSpawnEvent = 'start' | 'completion';
export type FoodPhase = 'carried' | 'eating' | 'dropped';

export interface FoodConfig { hungerGain: number; perishHours: number; }
export interface FoodItem extends FoodConfig {
  key: string;
  assetId: string;
  phase: FoodPhase;
  pos: [number, number];
  droppedAtHour?: number;
}

/** The source-action timing is intentionally explicit: fridge Eat produces immediately, while a
 * cooked meal does not exist unless Cook genuinely completes. */
export function foodAssetForActionEvent(actionId: string, event: FoodSpawnEvent): string | null {
  if (actionId === 'eat' && event === 'start') return 'snack';
  if (actionId === 'cook' && event === 'completion') return 'meal';
  return null;
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
