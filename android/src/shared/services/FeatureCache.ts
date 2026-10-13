import { fileIo as fs } from '../../desktop/compat';
import { Course } from '../model/Timeline';
export interface CacheEntry { category: string; course: Course; files: string[]; savedAt: number }
interface CachePreferences { slides?: boolean; transcript?: boolean; video?: boolean; chat?: boolean; summary?: boolean; smartSkip?: boolean; vision?: boolean }
export const CACHE_KINDS: string[] = ['slides', 'transcript', 'video', 'chat', 'summary', 'vision', 'smartSkip'];
export function cacheLabel(kind: string): string { return kind === 'slides' ? '课件' : kind === 'transcript' ? '转写' : kind === 'video' ? '视频' : kind === 'chat' ? '课程问答' : kind === 'smartSkip' ? '无效内容识别记录' : kind === 'vision' ? '课件文字与图表识别' : '本页速览'; }
export function cacheHash(value: string): string { let a = 2166136261, b = 5381; for (let i = 0; i < value.length; i++) { a = Math.imul(a ^ value.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ value.charCodeAt(i); } return (a >>> 0).toString(16) + (b >>> 0).toString(16); }
export class FeatureCache {
  private root: string;
  private transient: Map<string, string> = new Map();
  clearTransient(): void { this.transient.clear(); }
  private entries: CacheEntry[] = [];
  private preferences: CachePreferences = {};
  private flushTimer: any = -1;
  flush(): void { clearTimeout(this.flushTimer); this.flushTimer = -1; try { this.write('cache-index-v1.json', JSON.stringify(this.entries)); } catch (_) {} }
  private scheduleFlush(): void { if (this.flushTimer < 0) this.flushTimer = setTimeout(() => this.flush(), 200); }
  private revisions: Map<string, number> = new Map();
  constructor(root: string) { this.root = root; try { const value = JSON.parse(fs.readTextSync(root + '/cache-index-v1.json')); if (Array.isArray(value)) this.entries = value.filter(entry => entry && CACHE_KINDS.includes(entry.category) && entry.course?.subId && Array.isArray(entry.files)).map(entry => ({ ...entry, files: entry.files.filter((file: unknown) => typeof file === 'string' && file.startsWith(this.root + '/resource-cache/')) })); } catch (_) {} try { const value = JSON.parse(fs.readTextSync(root + '/cache-preferences.json')); if (value && typeof value === 'object' && !Array.isArray(value)) this.preferences = value; } catch (_) {} }
  private write(name: string, text: string): void { const file = fs.openSync(this.root + '/' + name + '.tmp', fs.OpenMode.CREATE | fs.OpenMode.WRITE_ONLY | fs.OpenMode.TRUNC); try { fs.writeSync(file.fd, text); } finally { fs.closeSync(file); } fs.renameSync(this.root + '/' + name + '.tmp', this.root + '/' + name); }
  enabled(category: string): boolean { return (this.preferences as Record<string, boolean>)[category] !== false; }
  setEnabled(category: string, enabled: boolean): void { this.revisions.set(category, this.revision(category) + 1); (this.preferences as Record<string, boolean>)[category] = enabled; this.write('cache-preferences.json', JSON.stringify(this.preferences)); }
  revision(category: string): number { return this.revisions.get(category) || 0; }
  file(category: string, course: Course, name: string): string { if (!CACHE_KINDS.includes(category) || !/^[A-Za-z0-9._-]+$/.test(name) || name.includes('..')) throw new Error('缓存分类或名称无效'); const directory = this.root + '/resource-cache/' + category + '/' + cacheHash(course.subId); if (!fs.accessSync(directory)) fs.mkdirSync(directory, true); return directory + '/' + name; }
  forgetFile(path: string): void { this.entries.forEach((entry: CacheEntry) => entry.files = entry.files.filter((file: string) => file !== path)); this.scheduleFlush(); }
  remember(category: string, course: Course, path: string): void {
    if (!this.enabled(category) || !path.startsWith(this.root + '/resource-cache/')) return;
    const index = this.entries.findIndex((entry: CacheEntry) => entry.category === category && entry.course.subId === course.subId);
    if (index < 0) this.entries.push({ category, course, files: [path], savedAt: Date.now() });
    else { const entry = this.entries[index]; entry.course = course; if (!entry.files.includes(path)) entry.files.push(path); entry.savedAt = Date.now(); }
    this.scheduleFlush();
  }
  read(category: string, course: Course, name: string): string { if (!this.enabled(category)) return this.transient.get(category + ':' + course.subId + ':' + name) || ''; try { return this.transient.get(category + ':' + course.subId + ':' + name) || fs.readTextSync(this.file(category, course, name)); } catch (_) { return ''; } }
  save(category: string, course: Course, name: string, text: string, revision: number = this.revision(category)): void {
    if (revision !== this.revision(category)) return;
    if (!this.enabled(category)) { this.transient.set(category + ':' + course.subId + ':' + name, text); return; }
    try { const path = this.file(category, course, name), file = fs.openSync(path + '.tmp', fs.OpenMode.CREATE | fs.OpenMode.WRITE_ONLY | fs.OpenMode.TRUNC);
      try { fs.writeSync(file.fd, text); } finally { fs.closeSync(file); } fs.renameSync(path + '.tmp', path); this.transient.delete(category + ':' + course.subId + ':' + name); this.remember(category, course, path);
    } catch (_) { this.transient.set(category + ':' + course.subId + ':' + name, text); }
  }
  list(category: string): CacheEntry[] { return this.entries.filter((entry: CacheEntry) => entry.category === category && entry.files.length > 0).sort((a: CacheEntry, b: CacheEntry) => b.course.start - a.course.start); }
  private treeBytes(path: string): number { try { const stat = fs.statSync(path); if (!stat.isDirectory()) return stat.size; return fs.listFileSync(path).reduce((bytes: number, name: string) => bytes + this.treeBytes(path + '/' + name), 0); } catch (_) { return 0; } }
  bytes(category: string, subIds: string[] = []): number {
    if (!subIds.length) return this.treeBytes(this.root + '/resource-cache/' + category);
    const files = new Set<string>(); this.list(category).filter((entry: CacheEntry) => subIds.includes(entry.course.subId)).forEach((entry: CacheEntry) => entry.files.forEach((path: string) => files.add(path))); let total = 0; files.forEach((path: string) => { try { total += fs.statSync(path).size; } catch (_) {} }); return total;
  }
  clear(category: string, subIds: string[] = []): void {
    Array.from(this.transient.keys()).filter((id: string) => id.startsWith(category + ':') && (!subIds.length || subIds.some((subId: string) => id.startsWith(category + ':' + subId + ':')))).forEach((id: string) => this.transient.delete(id));
    this.revisions.set(category, this.revision(category) + 1);
    const removed = this.entries.filter((entry: CacheEntry) => entry.category === category && (!subIds.length || subIds.includes(entry.course.subId)));
    this.entries = this.entries.filter((entry: CacheEntry) => !removed.includes(entry));
    removed.forEach((entry: CacheEntry) => { entry.files.forEach((path: string) => { if (path.startsWith(this.root + '/resource-cache/') && !this.entries.some((other: CacheEntry) => other.files.includes(path))) try { fs.unlinkSync(path); } catch (_) {} }); try { fs.rmdirSync(this.root + '/resource-cache/' + category + '/' + cacheHash(entry.course.subId)); } catch (_) {} });
    if (!subIds.length) try { fs.rmdirSync(this.root + '/resource-cache/' + category); } catch (_) {}
    this.flush();
  }
}
