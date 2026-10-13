import { Course } from '../model/Timeline';
import { PageSummaryRecord } from '../model/SummaryPolicy';
import { LocalStore, key } from './LocalStore';
interface SavedSummary { scope: string; pageId: string; record: PageSummaryRecord }
interface SummaryReading { scope: string; positions: Record<string, number> }
export class SummaryCache {
  private store: LocalStore;
  private course: Course;
  private revision: number;
  constructor(store: LocalStore, course: Course) { this.store = store; this.course = course; this.revision = store.cache.revision('summary'); }
  private read(name: string): string { return this.store.cache.read('summary', this.course, name); }
  private write(name: string, value: string, revision: number = this.revision): void { this.store.cache.save('summary', this.course, name, value, revision); }
  private valid(record: PageSummaryRecord | undefined): boolean { return !!record && typeof record.answer === 'string' && typeof record.signature === 'string' && Number.isFinite(record.savedAt); }
  latest(scope: string): Record<string, PageSummaryRecord> {
    const result: Record<string, PageSummaryRecord> = {};
    try { const saved = JSON.parse(this.read('summary-' + scope + '.json')) as Record<string, PageSummaryRecord>; Object.keys(saved).forEach((pageId: string) => { if (this.valid(saved[pageId])) result[pageId] = this.archive(scope, pageId, saved[pageId]); }); } catch (_) {}
    return result;
  }
  archive(scope: string, pageId: string, record: PageSummaryRecord): PageSummaryRecord {
    const stored: PageSummaryRecord = { id: record.id || key(this.course.subId + '|' + scope + '|' + pageId + '|' + record.savedAt + '|' + record.answer), answer: record.answer, signature: record.signature, savedAt: record.savedAt, completed: record.completed, contextAt: record.contextAt, priorKey: record.priorKey, references: record.references };
    const name = 'summary-record-' + key(stored.id!) + '.json', value = JSON.stringify({ scope, pageId, record: stored } as SavedSummary); if (this.read(name) !== value) this.write(name, value); return stored;
  }
  save(scope: string, pageId: string, record: PageSummaryRecord, records: Record<string, PageSummaryRecord>, revision: number): PageSummaryRecord {
    const previous = records[pageId]; if (this.valid(previous)) this.archive(scope, pageId, previous);
    const stored = this.archive(scope, pageId, record), next: Record<string, PageSummaryRecord> = {};
    Object.keys(records).forEach((id: string) => next[id] = records[id]); next[pageId] = stored;
    this.write('summary-' + scope + '.json', JSON.stringify(next), revision); return stored;
  }
  record(scope: string, pageId: string, id: string): PageSummaryRecord | undefined {
    try { const saved = JSON.parse(this.read('summary-record-' + key(id) + '.json')) as SavedSummary; if (saved.scope === scope && saved.pageId === pageId && saved.record?.id === id && this.valid(saved.record)) return saved.record; } catch (_) {}
    const latest = this.latest(scope)[pageId]; return latest?.id === id ? latest : undefined;
  }
  private reading(): SummaryReading { try { const value = JSON.parse(this.read('summary-reading-v1.json')) as SummaryReading; if (value.positions && typeof value.positions === 'object') return value; } catch (_) {} return { scope: 'page', positions: {} }; }
  lastScope(): string { const scope = this.reading().scope; return ['page', 'before', 'whole', 'course', 'courseAll'].includes(scope) ? scope : 'page'; }
  position(scope: string, pageId: string, id: string): number { const value = this.reading().positions[key(scope + '|' + pageId + '|' + id)]; return Number.isFinite(value) ? Math.max(0, value) : 0; }
  savePosition(scope: string, pageId: string, id: string, offset: number): void { if (!pageId || !Number.isFinite(offset)) return; const value = this.reading(); value.scope = scope; value.positions[key(scope + '|' + pageId + '|' + id)] = Math.max(0, offset); this.write('summary-reading-v1.json', JSON.stringify(value)); }
}
