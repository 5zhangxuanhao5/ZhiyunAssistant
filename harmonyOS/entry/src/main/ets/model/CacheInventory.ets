export function catalogueCacheFile(name: string): boolean {
  return /^(?:catalogue-|plaza-|search-|chapters-)[a-f0-9-]+\.json$/.test(name) || ['permissions-v1.json', 'attendance-history.json', 'my-attendance-v1.json', 'my-attendance-batch-v1.json', 'school-terms.json'].includes(name);
}
export interface ExtraCacheEntry { id: string; label: string; paths: string[]; bytes: number; protected?: boolean }

export function legacyCacheFile(name: string): boolean { return /^(?:summary-)?[a-f0-9]+\.json(?:\.tmp)?$/.test(name) || /^vision-v[12]\.json(?:\.tmp)?$/.test(name); }
