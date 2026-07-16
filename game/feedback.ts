// feedback.ts — B6-16 pure decisions for skill/funds floating feedback.

export interface SkillLevelUp { id: string; levels: number }

/** Reports integer boundaries crossed; fractional gains within a level intentionally stay silent. */
export function skillLevelUps(before: Readonly<Record<string, number>>, after: Readonly<Record<string, number>>): SkillLevelUp[] {
  const result: SkillLevelUp[] = [];
  for (const [id, next] of Object.entries(after)) {
    const levels = Math.floor(next) - Math.floor(before[id] ?? next);
    if (levels > 0) result.push({ id, levels });
  }
  return result;
}

export function formatSkillUp(name: string, levels = 1): string { return `${name}: +${Math.max(1, Math.floor(levels))}!`; }

export function formatMoneyChange(delta: number, currencyName: string): string {
  const amount = Math.abs(Math.round(delta)).toLocaleString('en-US');
  return `${delta >= 0 ? '+' : '-'}${currencyName}${amount}`;
}
