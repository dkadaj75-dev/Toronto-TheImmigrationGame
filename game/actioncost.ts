// actioncost.ts — one affordability rule shared by action start, the action menu, and autonomy.

/** Invalid and negative authored costs behave as free actions. */
export function actionCost(amount: number | undefined): number {
  return Number.isFinite(amount) ? Math.max(0, amount as number) : 0;
}

/** A debt balance permits free actions, but cannot cover any positive charge. */
export function canAffordActionCost(funds: number, amount: number | undefined): boolean {
  const cost = actionCost(amount);
  return cost === 0 || funds >= cost;
}
