import { CourseSection } from './CourseSections';
import { Course, shanghaiDate } from './Timeline';
import { OfflineCourse, DownloadJob } from '../services/OfflineLibrary';
export interface OfflineRow { id: string; kind: string; section?: CourseSection; entry?: OfflineCourse; job?: DownloadJob; queue?: number; revision?: number }
export function offlineRows(entries: OfflineCourse[], jobs: DownloadJob[], byCourse: boolean): OfflineRow[] {
  const groups = new Map<string, OfflineRow[]>(), sections = new Map<string, CourseSection>(), ids = new Map<string, Set<string>>();
  let queue = 0;
  const add = (course: Course, row: OfflineRow): void => {
    const id = byCourse ? course.courseId : shanghaiDate(course.start);
    if (!groups.has(id)) { groups.set(id, []); sections.set(id, { id, title: byCourse ? course.title : id, courses: [] }); ids.set(id, new Set()); }
    if (!ids.get(id)!.has(course.subId)) { sections.get(id)!.courses.push(course); ids.get(id)!.add(course.subId); } groups.get(id)!.push(row);
  };
  jobs.forEach((job: DownloadJob) => { if (job.state === 'queued' || job.state === 'paused') queue++; if (!['done', 'saved'].includes(job.state)) add(job.course, { id: 'job:' + job.id, kind: 'job', job, queue: job.state === 'queued' || job.state === 'paused' ? queue : 0 }); });
  const active = new Set(jobs.filter((job: DownloadJob) => !['done', 'saved'].includes(job.state)).map((job: DownloadJob) => job.course.subId));
  entries.forEach((entry: OfflineCourse) => { if (!active.has(entry.course.subId)) add(entry.course, { id: 'entry:' + entry.course.subId, kind: 'entry', entry }); });
  const result: OfflineRow[] = [];
  Array.from(sections.values()).sort((a: CourseSection, b: CourseSection) => Math.max(...b.courses.map((c: Course) => c.start)) - Math.max(...a.courses.map((c: Course) => c.start))).forEach((section: CourseSection) => {
    result.push({ id: 'section:' + section.id, kind: 'section', section });
    const rows = groups.get(section.id)!; rows.sort((a: OfflineRow, b: OfflineRow) => (a.kind === 'job' ? -1 : 1) - (b.kind === 'job' ? -1 : 1) || (b.entry?.course.start || 0) - (a.entry?.course.start || 0)); result.push(...rows);
  }); return result;
}
export class OfflineRows implements IDataSource {
  private rows: OfflineRow[] = [];
  private versions: string[] = [];
  private listeners: DataChangeListener[] = [];
  totalCount(): number { return this.rows.length; }
  getData(index: number): OfflineRow { return this.rows[index]; }
  registerDataChangeListener(listener: DataChangeListener): void { if (!this.listeners.includes(listener)) this.listeners.push(listener); }
  unregisterDataChangeListener(listener: DataChangeListener): void { this.listeners = this.listeners.filter((item: DataChangeListener) => item !== listener); }
  updateJobs(jobs: DownloadJob[]): boolean {
    const active = jobs.filter((job: DownloadJob) => !['done', 'saved'].includes(job.state));
    const shown = this.rows.filter((row: OfflineRow) => row.kind === 'job');
    const shownIds = new Set(shown.map((row: OfflineRow) => row.job!.id));
    if (active.length !== shown.length || active.some((job: DownloadJob) => !shownIds.has(job.id))) return false;
    const byId = new Map<string, DownloadJob>(); jobs.forEach((job: DownloadJob) => byId.set(job.id, job)); let queue = 0; const queues = new Map<string, number>(); jobs.forEach((job: DownloadJob) => { if (job.state === 'queued' || job.state === 'paused') queues.set(job.id, ++queue); });
    this.rows.forEach((row: OfflineRow, index: number) => { if (!row.job) return; const job = byId.get(row.job.id); if (!job) return; const updated: OfflineRow = { id: row.id, kind: row.kind, job, queue: queues.get(job.id) || 0 }; const version = JSON.stringify(updated); if (version === this.versions[index]) return; updated.revision = (row.revision || 0) + 1; this.rows[index] = updated; this.versions[index] = version; this.listeners.forEach((listener: DataChangeListener) => listener.onDataChanged(index)); });
    return true;
  }
  update(rows: OfflineRow[]): void {
    const structural = rows.length !== this.rows.length || rows.some((row: OfflineRow, index: number) => row.id !== this.rows[index]?.id);
    const versions = rows.map((row: OfflineRow) => JSON.stringify(row));
    const changed = versions.map((version: string, index: number) => version !== this.versions[index] ? index : -1).filter((index: number) => index >= 0);
    const changedSet = new Set(changed);
    rows.forEach((row: OfflineRow, index: number) => row.revision = this.rows[index]?.id === row.id ? (this.rows[index]?.revision || 0) + (changedSet.has(index) ? 1 : 0) : 0);
    this.rows = rows; this.versions = versions;
    this.listeners.forEach((listener: DataChangeListener) => { if (structural) listener.onDataReloaded(); else changed.forEach((index: number) => listener.onDataChanged(index)); });
  }
}
