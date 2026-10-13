import { Course } from './Timeline';
export interface PageSummaryRecord { id?: string; references?: Course[]; answer: string; signature: string; savedAt: number; completed?: boolean; contextAt?: number; priorKey?: string }
export function summaryDue(live: boolean, finished: boolean, manual: boolean, cached: PageSummaryRecord | undefined, signature: string, now: number): boolean {
  if (live && !finished && !manual) return false;
  if (manual || !cached || (finished || !live) && cached.completed !== true) return true;
  return false;
}
