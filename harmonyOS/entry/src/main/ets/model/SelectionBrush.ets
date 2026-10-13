export function brushRange(ids: string[], initial: string[], anchor: number, target: number, add: boolean): string[] {
  const chosen = new Set<string>(initial), left = Math.max(0, Math.min(anchor, target)), right = Math.min(ids.length - 1, Math.max(anchor, target));
  for (let i = left; i <= right; i++) { if (add) chosen.add(ids[i]); else chosen.delete(ids[i]); }
  return ids.filter((id: string) => chosen.has(id));
}
