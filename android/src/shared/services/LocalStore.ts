import { ExtraCacheEntry, catalogueCacheFile, legacyCacheFile } from '../model/CacheInventory';
import { FeatureCache } from './FeatureCache';
import { common } from '../../desktop/compat';
import { fileIo as fs, fileUri } from '../../desktop/compat';
import { image } from '../../desktop/compat';
import { blackBorderRegionAsync } from '../../desktop/image-jobs';
import { SessionStore } from './SessionStore';
import { http } from '../../desktop/compat';
import { PermissionRecord, PermissionStorage } from '../model/PermissionRecord';
import { Course, Slide, Transcript, imageUrl } from '../model/Timeline';

interface ImageCacheMeta { path: string; etag: string; modified: string; checkedAt: number }
interface CatalogueCache { schema?: number; courses: Course[]; savedAt: number }
interface AttendanceHistoryCache { schema?: number; courses: Course[]; savedAt: number; cursor?: string; emptyWindows?: number; complete?: boolean }
interface DisplayPreferences { trimBorders: boolean; transcription?: boolean; slides?: boolean; singlePage?: boolean; skipEmpty?: boolean }
export interface AttendanceHistoryState { courses: Course[]; cursor: string; emptyWindows: number; complete: boolean; savedAt: number }
export interface Snapshot { course: Course; slides: Slide[]; lines: Transcript[]; savedAt: number }
export function key(value: string): string {
  let a = 2166136261, b = 5381;
  for (let i = 0; i < value.length; i++) { a = Math.imul(a ^ value.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ value.charCodeAt(i); }
  return (a >>> 0).toString(16) + (b >>> 0).toString(16);
}
export class LocalStore implements PermissionStorage {
  // Retain only the current snapshot, never all courses' arrays. Cache revisions invalidate this guard after clearing/toggling.
  private savedCourse: string = '';
  private savedSlides: Slide[] | undefined = undefined;
  private savedLines: Transcript[] | undefined = undefined;
  private savedSlidesRevision: number = -1;
  private savedLinesRevision: number = -1;
  private folder: string;
  private imageFolder: string;
  private sessionFolder: string;
  readonly cache: FeatureCache;
  private currentCourse: Course | undefined = undefined;
  onImageUpdated: (url: string) => void = () => {};
  private checkedImages: Map<string, number> = new Map();
  useCourse(course: Course): void { this.currentCourse = course; }
  get activeCourse(): Course | undefined { return this.currentCourse; }
  readFeature(kind: string, name: string): string { return this.currentCourse ? this.cache.read(kind, this.currentCourse, name) : ''; }
  saveFeature(kind: string, name: string, value: string, revision: number = this.cache.revision(kind)): void { if (this.currentCourse) this.cache.save(kind, this.currentCourse, name, value, revision); }
  private registerImage(url: string, uri: string, course: Course | undefined): void { if (course && uri) { this.cache.remember('slides', course, new fileUri.FileUri(uri).path); const meta = this.imageFolder + '/' + key(url) + '.meta.json'; if (fs.accessSync(meta)) this.cache.remember('slides', course, meta); } }
  get dataFolder(): string { return this.folder; }
  private permissions: Map<string, PermissionRecord> = new Map();
  private pending: Set<http.HttpRequest> = new Set();
  private cancelVersion: number = 0;
  private abortDownloads: Set<() => void> = new Set();
  cancel(): void { this.cancelVersion++; this.abortDownloads.forEach((abort: () => void) => abort()); this.abortDownloads.clear(); this.pending.forEach((r: http.HttpRequest) => r.destroy()); this.pending.clear(); }
  private cropQueue: Promise<void> = Promise.resolve();
  private cropResults: Map<string, string> = new Map();
  private cropInflight: Map<string, Promise<string>> = new Map();
  private imageProgress: Map<string, Set<(received: number, total: number) => void>> = new Map();
  private inflight: Map<string, Promise<string>> = new Map();
  private static activeTransfers: Set<string> = new Set();
  private static activeExports: Set<string> = new Set();
  static protectExport(path: string): void { LocalStore.activeExports.add(path); }
  static releaseExport(path: string): void { LocalStore.activeExports.delete(path); }
  private transferScope: string = '';
  private context: common.UIAbilityContext;
  private accountId: string;
  releaseDownloadTemporary(): void { if (this.transferScope) { LocalStore.activeTransfers.delete(this.sessionFolder); try { fs.rmdirSync(this.sessionFolder); } catch (_) {} } }
  forkForDownload(): LocalStore { return new LocalStore(this.context, this.accountId, true, this.cache); }
  constructor(context: common.UIAbilityContext, accountId: string, isolated: boolean = false, sharedCache?: FeatureCache) {
    this.context = context; this.accountId = accountId; this.transferScope = isolated ? '-worker-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9) : '';
    this.folder = context.filesDir + '/account-' + key(accountId);
    this.imageFolder = this.folder + '/resource-cache/slides/assets';
    this.sessionFolder = context.cacheDir + '/temporary-slides-' + key(accountId) + this.transferScope;
    if (isolated) LocalStore.activeTransfers.add(this.sessionFolder);
    else try { fs.listFileSync(context.cacheDir).filter((name: string) => name.startsWith('temporary-slides-' + key(accountId) + '-worker-')).forEach((name: string) => { const path = context.cacheDir + '/' + name; if (!LocalStore.activeTransfers.has(path)) try { fs.rmdirSync(path); } catch (_) {} }); } catch (_) {}
    try { if (!isolated && fs.accessSync(this.sessionFolder)) fs.rmdirSync(this.sessionFolder); } catch (_) {} this.ensureDirectory(this.sessionFolder);
    this.ensureDirectory(this.folder); this.ensureDirectory(this.imageFolder); this.ensureDirectory(this.folder + '/saved-images');
    this.cache = sharedCache || new FeatureCache(this.folder);
    const legacy = context.cacheDir + '/slides-' + key(accountId);
    try { if (fs.accessSync(legacy)) fs.listFileSync(legacy).filter((n: string) => /\.(jpg|png|webp)$/.test(n)).forEach((n: string) => { const target = this.imageFolder + '/' + n; if (!fs.accessSync(target)) fs.copyFileSync(legacy + '/' + n, target); }); fs.rmdirSync(legacy); } catch (_) {}
    if (!isolated) this.migrateCaches();
    try {
      const records = JSON.parse(this.readJson('permissions-v1.json')) as PermissionRecord[];
      if (Array.isArray(records)) records.forEach((r: PermissionRecord) => {
        if (r && typeof r.courseId === 'string' && typeof r.subId === 'string' && r.permission &&
          Number.isFinite(r.checkedAt) && r.checkedAt <= Date.now() / 1000 + 60 && Date.now() / 1000 - r.checkedAt < 30 * 86400) {
          this.permissions.set(r.courseId + ':' + r.subId, r);
        }
      });
    } catch (_) {}

  }
  private migrateCaches(): void {
    const legacyBatch = 'desktop-' + key('my-attendance-batch-v1') + '.json', namedBatch = 'my-attendance-batch-v1.json';
    const savedBatch = this.readJson(legacyBatch); if (savedBatch) { if (!fs.accessSync(this.folder + '/' + namedBatch)) this.writeJson(namedBatch, savedBatch); this.deleteJson(legacyBatch); }
    let vision: Record<string, string> = {}; try { vision = JSON.parse(this.readJson('vision-v1.json')) as Record<string, string>; } catch (_) {}
    try {
      fs.listFileSync(this.folder).filter((name: string) => /^[a-f0-9]+\.json$/.test(name)).forEach((name: string) => {
        try {
          const snapshot = JSON.parse(this.readJson(name)) as Snapshot; if (!snapshot.course?.subId || !Array.isArray(snapshot.slides) || !Array.isArray(snapshot.lines)) return;
          this.save(snapshot);
          const courseVision: Record<string, string> = {};
          snapshot.slides.forEach((slide: Slide) => { ['jpg', 'png', 'webp'].forEach((extension: string) => { const path = this.imageFolder + '/' + key(slide.url) + '.' + extension; if (fs.accessSync(path)) this.cache.remember('slides', snapshot.course, path); }); const crop = this.imageFolder + '/' + key(slide.url) + '-trim-v3.png'; if (fs.accessSync(crop)) this.cache.remember('slides', snapshot.course, crop); if (vision[key(slide.url)]) courseVision[key(slide.url)] = vision[key(slide.url)]; });
          if (Object.keys(courseVision).length) this.cache.save('chat', snapshot.course, 'vision-v1.json', JSON.stringify(courseVision));
          const oldSummary = 'summary-' + key(snapshot.course.subId) + '.json', summary = this.readJson(oldSummary); if (summary) { this.cache.save('summary', snapshot.course, 'summary-before.json', summary); this.deleteJson(oldSummary); }
          this.deleteJson(name);
        } catch (_) {}
      });
      if (Object.keys(vision).length) this.deleteJson('vision-v1.json');
    } catch (_) {}
  }
  releaseTemporary(): void { this.cache.clearTransient(); this.cropResults.clear(); try { if ( fs.accessSync(this.sessionFolder)) fs.rmdirSync(this.sessionFolder); } catch (_) {} this.ensureDirectory(this.sessionFolder); }
  private ensureDirectory(path: string): void {
    try { if (fs.accessSync(path)) return; } catch (_) {}
    fs.mkdirSync(path, true);
  }
  permissionRecord(courseId: string, subId: string): PermissionRecord | undefined {
    return this.permissions.get(courseId + ':' + subId);
  }
  savePermissions(records: PermissionRecord[]): void {
    records.forEach((r: PermissionRecord) => this.permissions.set(r.courseId + ':' + r.subId, r));
    const recent = Array.from(this.permissions.values()).filter((r: PermissionRecord) => Date.now() / 1000 - r.checkedAt < 30 * 86400)
      .sort((a: PermissionRecord, b: PermissionRecord) => b.checkedAt - a.checkedAt).slice(0, 5000);
    this.writeJson('permissions-v1.json', JSON.stringify(recent));
  }
  private metadataTransient: Map<string, string> = new Map();
  catalogueCacheEnabled(): boolean { return this.readJson('cache-catalogue-save.txt') !== 'false'; }
  runtimeCacheEnabled(): boolean { return this.readJson('cache-runtime-save.txt') !== 'false'; }
  setCatalogueCacheEnabled(value: boolean): void { this.saveJson('cache-catalogue-save.txt', String(value)); }
  setRuntimeCacheEnabled(value: boolean): void { this.saveJson('cache-runtime-save.txt', String(value)); }
  private treeBytes(path: string): number { try { const stat = fs.statSync(path); if (!stat.isDirectory()) return stat.size; return fs.listFileSync(path).reduce((bytes: number, name: string) => bytes + this.treeBytes(path + '/' + name), 0); } catch (_) { return 0; } }
  extraCaches(kind: string): ExtraCacheEntry[] {
    const rows: ExtraCacheEntry[] = [];
    if (kind === 'catalogue') { try { fs.listFileSync(this.folder).filter((name: string) => catalogueCacheFile(name)).forEach((name: string) => rows.push({ id: name, label: name === 'permissions-v1.json' ? '访问权限记录' : name.includes('attendance') ? '已上课程目录' : name.startsWith('plaza-') ? '课程广场列表' : '课次目录', paths: [this.folder + '/' + name], bytes: this.treeBytes(this.folder + '/' + name) })); } catch (_) {} }
    if (kind === 'runtime') {
      const directories = [this.context.cacheDir, this.context.tempDir].filter((directory: string, index: number, all: string[]) => !!directory && all.indexOf(directory) === index);
      directories.forEach((directory: string) => { try { fs.listFileSync(directory).forEach((name: string) => { const path = directory + '/' + name; const protectedTransfer = Array.from(LocalStore.activeTransfers).some((active: string) => path === active || active.startsWith(path + '/')), protectedExport = Array.from(LocalStore.activeExports).some((active: string) => path === active || active.startsWith(path + '/'));
        rows.push({ id: path, label: protectedTransfer ? '正在下载的暂存文件' : protectedExport ? '正在导出的笔记暂存（保存完成后可清理）' : name === 'clipboard-images' ? '剪贴板图片暂存（清理后已复制的图片可能不可用）' : name.startsWith('notes-export-') ? '笔记导出暂存' : name.startsWith('temporary-slides-') || name.startsWith('slides-') ? '课件临时文件' : /web|cache|ark/i.test(name) ? '网页运行缓存' : '其他运行临时文件', paths: [path], bytes: this.treeBytes(path), protected: protectedTransfer || protectedExport });
      }); } catch (_) {} });
    }
    if (kind === 'legacy') {
      try { fs.listFileSync(this.context.filesDir).filter((name: string) => /^account-[a-f0-9]+$/.test(name)).forEach((name: string) => { const directory = this.context.filesDir + '/' + name;
        fs.listFileSync(directory).filter((file: string) => legacyCacheFile(file) || directory !== this.folder && (file === 'resource-cache' || catalogueCacheFile(file))).forEach((file: string) => { const path = directory + '/' + file; rows.push({ id: path, label: directory === this.folder ? '旧版课程缓存' : '其他账号课程缓存', paths: [path], bytes: this.treeBytes(path) }); });
      }); } catch (_) {}
    } return rows;
  }
  clearExtraCaches(kind: string, ids: string[] = []): void {
    if (kind === 'catalogue') { this.permissions.clear(); this.metadataTransient.clear(); }
    if (kind === 'runtime') { this.cancel(); this.cropResults.clear(); }
    let failed = false;
    this.extraCaches(kind).filter((entry: ExtraCacheEntry) => !ids.length || ids.includes(entry.id)).forEach((entry: ExtraCacheEntry) => {
      if (entry.protected) return;
      entry.paths.forEach((path: string) => { try { if (fs.statSync(path).isDirectory()) fs.rmdirSync(path); else fs.unlinkSync(path); } catch (_) { try { if (fs.accessSync(path)) failed = true; } catch (_) { failed = true; } } });
    });
    if (failed) throw new Error('部分运行文件正在使用，稍后可继续清理');
  }
  clearAllCaches(): void { this.cancel(); ['slides', 'transcript', 'video', 'chat', 'summary', 'vision', 'smartSkip'].forEach((kind: string) => this.cache.clear(kind)); this.cache.clearTransient(); this.cropResults.clear(); this.checkedImages.clear(); let failed = false; ['catalogue', 'legacy', 'runtime'].forEach((kind: string) => { try { this.clearExtraCaches(kind); } catch (_) { failed = true; } }); if (['slides', 'transcript', 'video', 'chat', 'summary', 'vision', 'smartSkip'].some((kind: string) => this.cache.bytes(kind) > 0)) failed = true; if (failed) throw new Error('部分缓存未能清理'); }
  private writeJson(name: string, value: string): void {
    if (!/^[A-Za-z0-9._-]+$/.test(name) || name.includes('..')) throw new Error('保存名称无效');
    if (catalogueCacheFile(name) && !this.catalogueCacheEnabled()) { this.metadataTransient.set(name, value); return; }
    const path = this.folder + '/' + name;
    const file = fs.openSync(path + '.tmp', fs.OpenMode.CREATE | fs.OpenMode.WRITE_ONLY | fs.OpenMode.TRUNC);
    try { fs.writeSync(file.fd, value); } finally { fs.closeSync(file); }
    fs.renameSync(path + '.tmp', path);
  }
  loadCatalogue(courseId: string): Course[] | undefined {
    try {
      const data = JSON.parse(this.readJson('catalogue-' + key(courseId) + '.json')) as CatalogueCache;
      if (data.schema === 2 && Array.isArray(data.courses) && data.courses.length > 0 && Date.now() - data.savedAt < 86400000) return data.courses;
    } catch (_) {}
    return undefined;
  }
  saveCatalogue(courseId: string, courses: Course[]): void {
    const data: CatalogueCache = { schema: 2, courses, savedAt: Date.now() };
    this.writeJson('catalogue-' + key(courseId) + '.json', JSON.stringify(data));
  }
  loadAttendanceHistory(): Course[] | undefined {
    try {
      const data = JSON.parse(this.readJson('attendance-history.json')) as AttendanceHistoryCache;
      if (Array.isArray(data.courses)) return data.courses;
    } catch (_) {}
    return undefined;
  }
  loadAttendanceHistoryState(): AttendanceHistoryState | undefined {
    try {
      const data = JSON.parse(this.readJson('attendance-history.json')) as AttendanceHistoryCache;
      if (!Array.isArray(data.courses)) return undefined;
      return { courses: data.courses, cursor: data.schema === 2 ? data.cursor || '' : '', emptyWindows: 0,
        complete: data.schema === 2 && data.complete === true, savedAt: data.savedAt || 0 };
    } catch (_) { return undefined; }
  }
  saveAttendanceHistory(courses: Course[], cursor: string = '', emptyWindows: number = 0, complete: boolean = false): void {
    this.writeJson('attendance-history.json', JSON.stringify({ schema: 2, courses, cursor, emptyWindows, complete, savedAt: Date.now() } as AttendanceHistoryCache));
  }
  loadMyAttendance(): AttendanceHistoryState | undefined {
    try { const data = JSON.parse(this.readJson('my-attendance-v1.json')) as AttendanceHistoryCache; if (data.schema !== 1 || !Array.isArray(data.courses)) return undefined; return { courses: data.courses, cursor: data.cursor || '', emptyWindows: 0, complete: data.complete === true, savedAt: data.savedAt || 0 }; } catch (_) { return undefined; }
  }
  saveMyAttendance(courses: Course[], cursor: string, complete: boolean): void { this.writeJson('my-attendance-v1.json', JSON.stringify({ schema: 1, courses, cursor, complete, savedAt: Date.now() } as AttendanceHistoryCache)); }
  private displayPreferences(): DisplayPreferences {
    try { return JSON.parse(fs.readTextSync(this.folder + '/display.json')) as DisplayPreferences; }
    catch (_) { return { trimBorders: true, transcription: true }; }
  }
  trimBorders(): boolean { return this.displayPreferences().trimBorders !== false; }
  transcription(): boolean { return this.displayPreferences().transcription !== false; }
  slides(): boolean { return this.displayPreferences().slides !== false; }
  singlePage(): boolean { return this.displayPreferences().singlePage === true; }
  skipEmpty(): boolean { return this.displayPreferences().skipEmpty === true; }
  saveTrimBorders(trimBorders: boolean): void {
    const data = this.displayPreferences(); data.trimBorders = trimBorders;
    this.writeJson('display.json', JSON.stringify(data));
  }
  saveTranscription(transcription: boolean): void {
    const data = this.displayPreferences(); data.transcription = transcription;
    this.writeJson('display.json', JSON.stringify(data));
  }
  saveSlides(slides: boolean): void {
    const data = this.displayPreferences(); data.slides = slides;
    this.writeJson('display.json', JSON.stringify(data));
  }
  savePageOptions(singlePage: boolean, skipEmpty: boolean): void {
    const data = this.displayPreferences(); data.singlePage = singlePage; data.skipEmpty = skipEmpty;
    this.writeJson('display.json', JSON.stringify(data));
  }
  loadPlaza(date: string, live: boolean): Course[] | undefined {
    try {
      const data = JSON.parse(this.readJson('plaza-' + key(date + ':' + live) + '.json')) as CatalogueCache;
      if (data.schema === 2 && Array.isArray(data.courses) && data.courses.length > 0 && Date.now() - data.savedAt < 86400000) return data.courses;
    } catch (_) {}
    return undefined;
  }
  savePlaza(date: string, live: boolean, courses: Course[]): void {
    const data: CatalogueCache = { schema: 2, courses, savedAt: Date.now() };
    this.writeJson('plaza-' + key(date + ':' + live) + '.json', JSON.stringify(data));
  }
  save(snapshot: Snapshot): void {
    const metadata = JSON.stringify(snapshot.course), changed = metadata !== this.savedCourse;
    const slideRevision = this.cache.revision('slides'), lineRevision = this.cache.revision('transcript');
    if (changed || this.savedSlides !== snapshot.slides || this.savedSlidesRevision !== slideRevision) {
      this.cache.save('slides', snapshot.course, 'timeline.json', JSON.stringify({ course: snapshot.course, slides: snapshot.slides, savedAt: snapshot.savedAt } as Snapshot)); this.savedSlides = snapshot.slides; this.savedSlidesRevision = slideRevision;
    }
    if (changed || this.savedLines !== snapshot.lines || this.savedLinesRevision !== lineRevision) {
      this.cache.save('transcript', snapshot.course, 'timeline.json', JSON.stringify({ course: snapshot.course, lines: snapshot.lines, savedAt: snapshot.savedAt } as Snapshot)); this.savedLines = snapshot.lines; this.savedLinesRevision = lineRevision;
    }
    this.savedCourse = metadata;
  }
  load(subId: string): Snapshot | undefined {
    const course = this.currentCourse?.subId === subId ? this.currentCourse : this.cache.list('slides').concat(this.cache.list('transcript')).find((entry) => entry.course.subId === subId)?.course;
    if (!course) return undefined;
    let slides: Snapshot | undefined, lines: Snapshot | undefined;
    try { slides = JSON.parse(this.cache.read('slides', course, 'timeline.json')) as Snapshot; } catch (_) {}
    try { lines = JSON.parse(this.cache.read('transcript', course, 'timeline.json')) as Snapshot; } catch (_) {}
    if (!slides && !lines) {
      try { const legacy = JSON.parse(this.readJson(key(subId) + '.json')) as Snapshot; this.save(legacy); this.deleteJson(key(subId) + '.json'); return { course, slides: this.cache.enabled('slides') ? legacy.slides : [], lines: this.cache.enabled('transcript') ? legacy.lines : [], savedAt: legacy.savedAt }; } catch (_) { return undefined; }
    }
    return { course, slides: slides?.slides || [], lines: lines?.lines || [], savedAt: Math.max(slides?.savedAt || 0, lines?.savedAt || 0) };
  }
  private imageMeta(url: string): ImageCacheMeta | undefined {
    try { const meta = JSON.parse(fs.readTextSync(this.imageFolder + '/' + key(url) + '.meta.json')) as ImageCacheMeta; if (meta.path.startsWith(this.imageFolder + '/' + key(url)) && !meta.path.includes('/../') && fs.accessSync(meta.path)) return meta; } catch (_) {} return undefined;
  }
  private saveImageMeta(url: string, meta: ImageCacheMeta): void { this.ensureDirectory(this.imageFolder); const file = fs.openSync(this.imageFolder + '/' + key(url) + '.meta.json', fs.OpenMode.CREATE | fs.OpenMode.WRITE_ONLY | fs.OpenMode.TRUNC); try { fs.writeSync(file.fd, JSON.stringify(meta)); } finally { fs.closeSync(file); } }
  imageVersion(url: string, uri: string = this.cachedImage(url)): string { if (!uri) return ''; try { const stat = fs.statSync(new fileUri.FileUri(uri).path); return key(url + '|' + uri + '|' + stat.size + '|' + stat.mtime); } catch (_) { return key(url + '|' + uri); } }
  cachedImage(url: string): string {
    if (this.cache.enabled('slides')) { const meta = this.imageMeta(url); if (meta) return fileUri.getUriFromPath(meta.path); }
    for (const extension of ['jpg', 'png', 'webp']) {
      const saved = this.folder + '/saved-images/' + key(url) + '.' + extension;
      const path = this.imageFolder + '/' + key(url) + '.' + extension;
      try { if (this.cache.enabled('slides') && fs.accessSync(path)) return fileUri.getUriFromPath(path); } catch (_) {}
      try { if (fs.accessSync(saved)) return fileUri.getUriFromPath(saved); } catch (_) {}
    }
    return '';
  }
  private reportImage(url: string, received: number, total: number): void { this.imageProgress.get(url)?.forEach((report: (received: number, total: number) => void) => report(received, total)); }
  async image(url: string, report: (received: number, total: number) => void = () => {}, course: Course | undefined = this.currentCourse): Promise<string> {
    const cached = this.cachedImage(url);
    if (cached) {
      let uri = cached; const path = new fileUri.FileUri(cached).path;
      // Offline originals are retained separately; avoid an identical ordinary-cache copy.
      report(1, 1); this.registerImage(url, uri, course);
      const meta = this.imageMeta(url), checkedAt = Math.max(this.checkedImages.get(url) || 0, meta?.checkedAt || 0);
      if (this.cache.enabled('slides') && Date.now() - checkedAt > 3600000 && !this.inflight.has(url)) {
        this.checkedImages.set(url, Date.now()); const prior = uri, task = this.download(url, prior); this.inflight.set(url, task);
        task.then((latest: string) => { this.registerImage(url, latest, course); if (latest !== prior) { this.cropResults.delete(url); this.onImageUpdated(url); } }).catch(() => {}).finally(() => { if (this.inflight.get(url) === task) this.inflight.delete(url); });
      }
      return uri;
    }
    let listeners = this.imageProgress.get(url);
    if (!listeners) { listeners = new Set(); this.imageProgress.set(url, listeners); }
    listeners.add(report);
    let promise = this.inflight.get(url);
    if (!promise) { promise = this.download(url); this.inflight.set(url, promise); }
    try { const uri = await promise; this.registerImage(url, uri, course); return uri; }
    finally { listeners.delete(report); if (!listeners.size) this.imageProgress.delete(url); if (this.inflight.get(url) === promise) this.inflight.delete(url); }
  }
  async pinImage(url: string, report: (received: number, total: number) => void = () => {}): Promise<string> {
    const original = await this.image(url, report), source = new fileUri.FileUri(original).path;
    const extension = /\.(png|webp)$/.exec(source)?.[1] || 'jpg';
    const destination = this.folder + '/saved-images/' + key(url) + '.' + extension;
    if (source !== destination) fs.copyFileSync(source, destination);
    return fileUri.getUriFromPath(destination);
  }
  readJson(name: string): string { if (!/^[A-Za-z0-9._-]+$/.test(name) || name.includes('..')) return '';  if (catalogueCacheFile(name) && !this.catalogueCacheEnabled()) return this.metadataTransient.get(name) || ''; try { return fs.readTextSync(this.folder + '/' + name); } catch (_) { return ''; } }
  saveJson(name: string, value: string): void { this.writeJson(name, value); }
  deleteJson(name: string): void { if (!/^[A-Za-z0-9._-]+$/.test(name) || name.includes('..')) throw new Error('保存名称无效');  try { fs.unlinkSync(this.folder + '/' + name); } catch (_) {} }
  async trimmedImage(url: string, course: Course | undefined = this.currentCourse): Promise<string> {
    const original = await this.image(url, () => {}, course);
    const known = this.cropResults.get(url + '|' + original);
    if (known) try { if (fs.accessSync(new fileUri.FileUri(known).path)) return known; } catch (_) {}
    const path = (this.cache.enabled('slides') ? this.imageFolder : this.sessionFolder) + '/' + key(url + original) + '-trim-v4.png';
    try { if (this.cache.enabled('slides') && fs.accessSync(path)) { const uri = fileUri.getUriFromPath(path); this.registerImage(url, uri, course); return uri; } } catch (_) {}
    const running = this.cropInflight.get(url);
    if (running) return running;
    const prior = this.cropQueue;
    const task = (async (): Promise<string> => {
      await prior;
      const gen = this.cancelVersion, revision = this.cache.revision('slides');
      const uri = await this.cropImage(original, path, gen, revision);
      this.cropResults.set(url + '|' + original, uri); this.registerImage(url, uri, course); return uri;
    })();
    this.cropQueue = task.then(() => {}, () => {});
    this.cropInflight.set(url, task);
    try { return await task; } finally { this.cropInflight.delete(url); }
  }
  private async cropImage(original: string, path: string, gen: number, revision: number): Promise<string> {
    const source = image.createImageSource(new fileUri.FileUri(original).path);
    let pixels: image.PixelMap | undefined = undefined;
    try {
      const info = await source.getImageInfo();
      if (info.size.width * info.size.height > 16000000) return original;
      const ratio = Math.min(1, 1440 / info.size.width, 1440 / info.size.height);
      pixels = await source.createPixelMap({ desiredSize: { width: Math.max(1, Math.round(info.size.width * ratio)), height: Math.max(1, Math.round(info.size.height * ratio)) }, desiredPixelFormat: image.PixelMapFormat.RGBA_8888, editable: true });
      const buffer = new ArrayBuffer(pixels.getPixelBytesNumber());
      await pixels.readPixelsToBuffer(buffer);
      const decoded = await pixels.getImageInfo();
      const region = await blackBorderRegionAsync(buffer, decoded.size.width, decoded.size.height, pixels.getBytesNumberPerRow());
      if (!region) return original;
      const scaleX = info.size.width / decoded.size.width, scaleY = info.size.height / decoded.size.height;
      const x = Math.floor(region.x * scaleX), y = Math.floor(region.y * scaleY);
      const right = Math.min(info.size.width, Math.ceil((region.x + region.width) * scaleX)), bottom = Math.min(info.size.height, Math.ceil((region.y + region.height) * scaleY));
      await pixels.release(); pixels = undefined;
      if (gen !== this.cancelVersion || revision !== this.cache.revision('slides')) return original;
      this.ensureDirectory(path.slice(0, path.lastIndexOf('/')));
      // Analyze a bounded preview, then crop the original natively: clarity is retained without large RGBA bridge copies.
      await source.cropToPath({ x, y, width: right - x, height: bottom - y }, path + '.tmp');
      if (gen !== this.cancelVersion || revision !== this.cache.revision('slides')) { try { fs.unlinkSync(path + '.tmp'); } catch (_) {} return original; }
      fs.renameSync(path + '.tmp', path); 
      return fileUri.getUriFromPath(path);
    } catch (_) { try { if (fs.accessSync(path + '.tmp')) fs.unlinkSync(path + '.tmp'); } catch (_) {} return original; }
    finally { if (pixels) await pixels.release(); await source.release(); }
  }
  private async download(url: string, existing: string = ''): Promise<string> {
    if (!imageUrl(url)) throw new Error('课件图片地址无效');
    const req = http.createHttp(), gen = this.cancelVersion; this.pending.add(req);
    const destination = !this.transferScope && this.cache.enabled('slides') ? this.imageFolder : this.sessionFolder; this.ensureDirectory(destination);
    const cacheRevision = this.cache.revision('slides');
    const temporary = destination + '/' + key(url) + this.transferScope + '.tmp';
    const file = fs.openSync(temporary, fs.OpenMode.CREATE | fs.OpenMode.WRITE_ONLY | fs.OpenMode.TRUNC);
    let etag = '', modified = '', mime = '', bytes = 0, total = -1, reportedAt = 0, closed = false; let watchdog: any = -1;
    let finish: () => void = () => {}, fail: (error: Error) => void = () => {};
    const ended = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; }); ended.catch(() => {});
    const abort = (): void => { fail(new Error('已取消')); req.destroy(); };
    this.abortDownloads.add(abort);
    try {
      const reset = (): void => { clearTimeout(watchdog); watchdog = setTimeout(() => { fail(new Error('课件接收超时，请重试')); req.destroy(); }, 45000); };
      req.on('headersReceive', (received: Object) => { const header = received as Record<string, string>; etag = header['etag'] || header['ETag'] || ''; modified = header['last-modified'] || header['Last-Modified'] || ''; mime = header['content-type'] || header['Content-Type'] || ''; total = Number(header['content-length'] || header['Content-Length'] || '-1'); });
      req.on('dataReceive', (data: ArrayBuffer) => {
        reset();
        try {
          bytes += data.byteLength; if (bytes > 100 * 1024 * 1024) throw new Error('课件原图过大');
          let offset = 0;
          while (offset < data.byteLength) {
            const written = fs.writeSync(file.fd, data.slice(offset));
            if (written <= 0) throw new Error('课件文件写入失败'); offset += written;
          }
          if (Date.now() - reportedAt > 120) { reportedAt = Date.now(); this.reportImage(url, bytes, total); }
        } catch (err) { fail(err as Error); req.destroy(); }
      });
      req.on('dataEnd', () => { clearTimeout(watchdog); finish(); });
      const headers: Record<string, string> = {}; headers['Referer'] = 'https://classroom.zju.edu.cn/';
      const origin = /^https:\/\/[^/]+/.exec(url)?.[0] || '';
      if (/^https:\/\/(?:[A-Za-z0-9-]+\.)*zju\.edu\.cn$/.test(origin)) headers['Cookie'] = SessionStore.cookie(origin);
      const metadata = existing ? this.imageMeta(url) : undefined;
      if (metadata?.etag) headers['If-None-Match'] = metadata.etag; else if (metadata?.modified) headers['If-Modified-Since'] = metadata.modified;
      reset();
      const code = await req.requestInStream(url, { header: headers, usingCache: false, connectTimeout: 8000, readTimeout: 45000 });
      if (gen !== this.cancelVersion || cacheRevision !== this.cache.revision('slides')) throw new Error('已取消');
      if (code === 304 && metadata) { this.saveImageMeta(url, { path: metadata.path, etag: metadata.etag, modified: metadata.modified, checkedAt: Date.now() }); try { fs.unlinkSync(temporary); } catch (_) {} return fileUri.getUriFromPath(metadata.path); }
      if (code !== 200 || !/^image\/(jpeg|png|webp)/i.test(mime)) throw new Error('课件图片暂时无法下载');
      await ended; if (gen !== this.cancelVersion || destination === this.imageFolder && cacheRevision !== this.cache.revision('slides')) throw new Error('已取消'); if (!bytes) throw new Error('课件原图为空'); this.reportImage(url, bytes, bytes);
      fs.closeSync(file); closed = true;
      const extension = /image\/png/i.test(mime) ? 'png' : /image\/webp/i.test(mime) ? 'webp' : 'jpg';
      const path = destination + '/' + key(url) + (destination === this.imageFolder ? '-' + key(etag || modified || String(Date.now())) : '') + '.' + extension;
      fs.renameSync(temporary, path); if (destination === this.imageFolder) { this.saveImageMeta(url, { path, etag, modified, checkedAt: Date.now() }); this.checkedImages.set(url, Date.now()); if (existing) { const old = new fileUri.FileUri(existing).path; if (old !== path && old.startsWith(this.imageFolder + '/')) { this.cache.forgetFile(old); const crop = this.imageFolder + '/' + key(url + existing) + '-trim-v4.png'; this.cache.forgetFile(crop); try { fs.unlinkSync(old); } catch (_) {} try { fs.unlinkSync(crop); } catch (_) {} } } } return fileUri.getUriFromPath(path);
    } catch (err) { try { fs.unlinkSync(temporary); } catch (_) {} throw err as Error; }
    finally { clearTimeout(watchdog); this.abortDownloads.delete(abort); req.destroy(); this.pending.delete(req); if (!closed) fs.closeSync(file); }
  }
}
