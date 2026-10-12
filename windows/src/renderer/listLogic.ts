import type { Course } from '../shared/model/Timeline';
import { shanghaiDate } from '../shared/model/Timeline';

export type BatchScope = 'attendance' | 'course' | 'plaza' | 'search';
export function stableCourseIds(rows: Course[]): string { return [...new Set(rows.map(row => row.subId))].sort().join('|'); }
export function mergePermissionStates(previous: Record<string, string>, update: Record<string, string>, rows: Course[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const row of rows) { const value = update[row.subId] ?? previous[row.subId]; if (['allowed', 'denied', 'unknown'].includes(value)) result[row.subId] = value; }
  return result;
}
export function permittedRows(rows: Course[], states: Record<string, string>): Course[] { return rows.filter(row => states[row.subId] === 'allowed'); }
export function uniqueCourses(rows: Course[]): Course[] { return [...new Map(rows.map(row => [row.subId, row])).values()]; }
export function scopedBatchRows(rows: Course[], scope: BatchScope, groups: Array<{ courseId: string }> = [], now = Date.now() / 1000): Course[] {
  const ids = new Set(groups.map(group => group.courseId));
  return uniqueCourses(rows).filter(row => scope === 'attendance' ? row.end <= now : scope === 'course' || scope === 'search' ? ids.has(row.courseId) : true);
}
export function mergeDownloadEvent(previous: any, update: any): any {
  const oldTasks = previous.tasks || previous.jobs || [];
  const tasks = update.taskUpdates ? (() => { const byId = new Map(update.taskUpdates.map((task: any) => [task.id, task])); return oldTasks.map((task: any) => byId.get(task.id) || task); })() : update.tasks || update.jobs || oldTasks;
  // Incremental progress never adds an unknown/deleted job or rebuilds saved rows.
  return { ...previous, ...update, tasks, entries: update.entries || update.courses || previous.entries || previous.courses || [] };
}
export function groupedOffline(entries: any[], mode: string): Array<{ key: string; title: string; items: any[] }> {
  const groups = new Map<string, { key: string; title: string; items: any[] }>();
  for (const entry of entries.slice().sort((a, b) => b.course.start - a.course.start)) {
    const key = mode === 'date' ? shanghaiDate(entry.course.start) : entry.course.courseId;
    const group: { key: string; title: string; items: any[] } = groups.get(key) || { key, title: mode === 'date' ? key : entry.course.title, items: [] }; group.items.push(entry); groups.set(key, group);
  }
  return [...groups.values()];
}
