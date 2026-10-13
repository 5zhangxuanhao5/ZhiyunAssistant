import { common } from '../../desktop/compat';
import { fileIo as fs, fileUri } from '../../desktop/compat';
import { http } from '../../desktop/compat';
import { Course, Slide, Transcript, stamp, reconcileLines } from '../model/Timeline';
import { MediaSource, HlsPlan, hlsPlan, mediaUrl } from '../model/Media';
import { LocalStore, key, Snapshot } from './LocalStore';
import { Zhiyun, AccessDenied } from './Zhiyun';
import { DownloadPart, downloadBytes, utf8Bytes, availablePlaylist } from '../model/DownloadBytes';
import { SessionStore } from './SessionStore';
export interface DownloadOptions { video: boolean; slides: boolean; transcript: boolean }
export interface OfflineCourse { course: Course; options: DownloadOptions; videoUri: string; videoOffset: number; savedAt: number; partial: boolean; bytes: number; incomplete?: boolean; missing?: string[] }
export interface DownloadJob { id: string; course: Course; options: DownloadOptions; state: string; progress: number; message: string; parts?: DownloadPart[]; transcriptComplete?: boolean; videoComplete?: boolean; downloadedBytes?: number; totalBytes?: number; unknownSizes?: number }
export class OfflineLibrary {
  private store: LocalStore;
  private api: Zhiyun = new Zhiyun();
  private epoch: number = 0;
  private running: boolean = false;
  private canceled: boolean = false;
  private deleting: boolean = false;
  private removalQueue: Promise<void> = Promise.resolve();
  private progressTimer: any = -1;
  private lastProgressPersist: number = 0;
  private stopped: (() => void)[] = [];
  private pending: Set<http.HttpRequest> = new Set();
  private abortStreams: Set<() => void> = new Set();
  private jobs: DownloadJob[] = [];
  private entries: OfflineCourse[] = [];
  private changed: (progressOnly?: boolean) => void;
  private owner: OfflineLibrary | undefined = undefined;
  private workers: Map<string, OfflineLibrary> = new Map();
  private parallelLimit: number = 1;
  concurrency(): number { return this.parallelLimit; }
  setConcurrency(count: number): void { this.parallelLimit = Math.max(1, Math.min(4, Math.floor(count) || 1)); this.store.saveJson('download-concurrency.json', String(this.parallelLimit)); this.publish(); this.drain(); }
  pauseJob(subId: string): void { const job = this.jobs.find((item: DownloadJob) => item.course.subId === subId); if (!job || !['running', 'queued'].includes(job.state)) return; this.workers.get(subId)?.pause(); job.state = 'paused'; job.message = '已暂停'; this.publish(); }
  resumeJob(subId: string): void { const job = this.jobs.find((item: DownloadJob) => item.course.subId === subId); if (!job || !['paused', 'error'].includes(job.state)) return; job.state = 'queued'; job.message = '等待下载'; this.canceled = false; this.publish(); this.drain(); }
  moveJob(subId: string, direction: number): void { const index = this.jobs.findIndex((job: DownloadJob) => job.course.subId === subId); if (index < 0 || this.jobs[index].state === 'running') return; const candidates = this.jobs.map((job: DownloadJob, i: number) => i).filter((i: number) => this.jobs[i].state === 'queued' || this.jobs[i].state === 'paused'); const next = candidates[candidates.indexOf(index) + direction]; if (next === undefined) return; const value = this.jobs[index]; this.jobs[index] = this.jobs[next]; this.jobs[next] = value; this.publish(); }
  constructor(store: LocalStore, changed: (progressOnly?: boolean) => void, owner?: OfflineLibrary) {
    this.store = store; this.changed = changed; this.owner = owner; this.api.usePermissionStorage(owner?.store || store);
    if (owner) { this.entries = owner.entries.slice(); return; }
    try { this.parallelLimit = Math.max(1, Math.min(4, Number(store.readJson('download-concurrency.json')) || 1)); } catch (_) {}
    try { const value = JSON.parse(store.readJson('offline-v1.json')); if (Array.isArray(value)) this.entries = value.filter(entry => entry?.course?.subId && entry.course.courseId && entry.options && typeof entry.videoUri === 'string'); } catch (_) {}
    try { const loaded = JSON.parse(store.readJson('download-jobs-v1.json')) as DownloadJob[]; const latest = new Map<string, DownloadJob>(); if (Array.isArray(loaded)) loaded.filter(job => job?.course?.subId && job.course.courseId && job.options && typeof job.state === 'string').forEach((job: DownloadJob) => { job.parts = Array.isArray(job.parts) ? job.parts : []; latest.set(job.course.subId, job); }); this.jobs = Array.from(latest.values()); this.jobs.forEach((j: DownloadJob) => { if (j.state === 'running' || j.state === 'queued') { j.state = 'paused'; j.message = '可继续下载'; } }); } catch (_) {}
  }
  static removeLegacyAccount(context: common.UIAbilityContext): void { try { fs.unlinkSync(context.filesDir + '/offline-account.json'); } catch (_) {} }
  private listedSource: OfflineCourse[] | undefined = undefined;
  private listed: OfflineCourse[] = [];
  list(): OfflineCourse[] { if (this.listedSource !== this.entries) { this.listedSource = this.entries; this.listed = this.entries.slice().sort((a: OfflineCourse, b: OfflineCourse) => b.savedAt - a.savedAt); } return this.listed; }
  progressTasks(): DownloadJob[] { return this.jobs.filter(job => job.state === 'running').map(job => ({ id: job.id, course: job.course, options: job.options, state: job.state, progress: job.progress, message: job.message, downloadedBytes: job.downloadedBytes, totalBytes: job.totalBytes, unknownSizes: job.unknownSizes })); }
  tasks(): DownloadJob[] { return this.jobs.map((job: DownloadJob): DownloadJob => { return { id: job.id, course: job.course, options: job.options, state: job.state, progress: job.progress, message: job.message, downloadedBytes: job.downloadedBytes, totalBytes: job.totalBytes, unknownSizes: job.unknownSizes }; }); }
  snapshot(subId: string): Snapshot | undefined { try { const value = JSON.parse(this.store.readJson('offline-snapshot-' + key(subId) + '.json')) as Snapshot; return value?.course?.subId === subId && Array.isArray(value.slides) && Array.isArray(value.lines) ? value : undefined; } catch (_) { return undefined; } }
  entry(subId: string): OfflineCourse | undefined { return this.entries.find((e: OfflineCourse) => e.course.subId === subId); }
  enqueue(courses: Course[], options: DownloadOptions): void {
    courses.forEach((course: Course) => {
      if (this.jobs.some((j: DownloadJob) => j.course.subId === course.subId && (j.state === 'running' || j.state === 'queued'))) return;
      const previous = this.jobs.find((job: DownloadJob) => job.course.subId === course.subId);
      this.jobs = this.jobs.filter((job: DownloadJob) => job.course.subId !== course.subId);
      const continuing = previous && previous.state !== 'done';
      this.jobs.push({ id: continuing ? previous.id : course.subId + '-' + Date.now(), course, options, state: 'queued', progress: continuing ? previous.progress : 0, message: '等待下载', parts: continuing ? previous.parts : [], transcriptComplete: continuing ? previous.transcriptComplete : false, videoComplete: continuing ? previous.videoComplete : false });
    });
    this.canceled = false; this.publish(); this.drain();
  }
  saveAvailable(subId: string): void {
    const job = this.jobs.find((item: DownloadJob) => item.course.subId === subId), entry = this.entry(subId);
    if (!job || job.state !== 'error' || !entry) return;
    this.keep({ course: entry.course, options: entry.options, videoUri: entry.videoUri, videoOffset: entry.videoOffset, savedAt: entry.savedAt, partial: entry.partial, bytes: entry.bytes, incomplete: true, missing: entry.missing?.length ? entry.missing : [job.message] });
    job.state = 'saved'; job.message = '已保存可用内容，缺失部分可单独重试'; this.publish();
  }
  retryJob(subId: string): void { const job = this.jobs.find((item: DownloadJob) => item.course.subId === subId); if (job) this.enqueue([job.course], job.options); }
  resume(): void { this.jobs.forEach((j: DownloadJob) => { if (j.state === 'paused' || j.state === 'error') { j.state = 'queued'; j.message = '等待下载'; } }); this.canceled = false; this.publish(); this.drain(); }
  pause(): void { this.workers.forEach((worker: OfflineLibrary) => worker.pause()); if (this.owner) this.store.cancel(); this.epoch++; this.canceled = true; this.api.cancel(); this.abortStreams.forEach((abort: () => void) => abort()); this.abortStreams.clear(); this.pending.forEach((r: http.HttpRequest) => r.destroy()); this.pending.clear(); this.jobs.forEach((j: DownloadJob) => { if (j.state === 'running' || j.state === 'queued') j.state = 'paused'; }); this.publish(); }
  async remove(subId: string): Promise<void> { await this.removeMany([subId]); }
  removeMany(subIds: string[]): Promise<void> {
    const ids = Array.from(new Set(subIds));
    const operation = this.removalQueue.then(() => this.performRemoveMany(ids));
    this.removalQueue = operation.catch(() => {}); return operation;
  }
  private async performRemoveMany(subIds: string[]): Promise<void> {
    const selected = new Set(subIds);
    const active = this.running;
    const queued = this.jobs.filter((j: DownloadJob) => !selected.has(j.course.subId) && (j.state === 'queued' || j.state === 'running')).map((j: DownloadJob) => j.id);
    if (active) { this.deleting = true; this.pause(); if (this.running) await new Promise<void>((resolve) => this.stopped.push(resolve)); }
    try {
      this.entries = this.entries.filter((e: OfflineCourse) => !selected.has(e.course.subId));
      this.jobs = this.jobs.filter((j: DownloadJob) => !selected.has(j.course.subId));
      subIds.forEach((subId: string) => { try { fs.rmdirSync(this.store.dataFolder + '/video-' + key(subId)); } catch (_) {} try { fs.unlinkSync(this.store.dataFolder + '/offline-snapshot-' + key(subId) + '.json'); } catch (_) {} });
      this.cleanImages(); this.store.saveJson('offline-v1.json', JSON.stringify(this.entries)); this.publish();
    } finally {
      if (active) { this.deleting = false; this.canceled = false; this.jobs.forEach((j: DownloadJob) => { if (queued.includes(j.id)) { j.state = 'queued'; j.message = '等待下载'; } }); this.publish(); this.drain(); }
    }
  }
  private cleanImages(): void {
    const retained = new Set<string>();
    this.entries.map((entry: OfflineCourse) => entry.course.subId).concat(this.jobs.map((job: DownloadJob) => job.course.subId)).forEach((subId: string) => { const snapshot = this.snapshot(subId); snapshot?.slides.forEach((slide: Slide) => ['jpg', 'png', 'webp'].forEach((extension: string) => retained.add(key(slide.url) + '.' + extension))); });
    const directory = this.store.dataFolder + '/saved-images';
    try { fs.listFileSync(directory).forEach((name: string) => { if (!retained.has(name)) fs.unlinkSync(directory + '/' + name); }); } catch (_) {}
  }
  private keep(item: OfflineCourse): void {
    if (this.owner) { this.owner.keep(item); this.entries = this.owner.entries.slice(); return; }
    this.entries = this.entries.filter((e: OfflineCourse) => e.course.subId !== item.course.subId).concat([item]);
    this.store.saveJson('offline-v1.json', JSON.stringify(this.entries)); this.changed();
  }
  private persistJobs(): void { try { this.store.saveJson('download-jobs-v1.json', JSON.stringify(this.jobs)); } catch (_) { this.jobs.filter((job: DownloadJob) => job.state === 'running').forEach((job: DownloadJob) => job.message = '进度暂未保存，请检查本机存储空间'); } }
  private publish(): void { if (this.owner) { this.owner.publish(); return; } clearTimeout(this.progressTimer); this.progressTimer = -1; this.persistJobs(); this.lastProgressPersist = Date.now(); this.changed(); }
  private publishProgress(): void {
    if (this.owner) { this.owner.publishProgress(); return; }
    if (this.progressTimer >= 0) return;
    this.progressTimer = setTimeout(() => { this.progressTimer = -1; if (Date.now() - this.lastProgressPersist >= 2000) { this.persistJobs(); this.lastProgressPersist = Date.now(); } this.changed(true); }, 160);
  }
  private async drain(): Promise<void> {
    if (this.deleting || this.canceled) return;
    const started: Promise<void>[] = [];
    while (this.workers.size < this.parallelLimit) {
      const job = this.jobs.find((item: DownloadJob) => item.state === 'queued' && !this.workers.has(item.course.subId));
      if (!job) break;
      let worker: OfflineLibrary;
      try { worker = this.createWorker(); } catch (error) { job.state = 'error'; job.message = '无法准备下载：' + this.reason(error as Error); this.publish(); continue; }
      worker.jobs = [job]; this.workers.set(job.course.subId, worker); this.running = true;
      job.state = 'running'; job.message = '正在读取课程'; this.publish();
      started.push(this.runJob(job, worker));
    }
    await Promise.all(started);
  }
  private createWorker(): OfflineLibrary { return new OfflineLibrary(this.store.forkForDownload(), () => {}, this); }
  private async runJob(job: DownloadJob, worker: OfflineLibrary): Promise<void> {
    const gen = worker.epoch;
    try { await worker.download(job); if (gen === worker.epoch) { job.state = 'done'; job.progress = 1; job.message = '已下载'; } }
    catch (error) { if (gen === worker.epoch) { job.state = 'error'; job.message = (error as Error).message; } }
    finally {
      worker.store.releaseDownloadTemporary(); this.workers.delete(job.course.subId); this.running = this.workers.size > 0;
      this.publish(); if (!this.running) this.stopped.splice(0).forEach((done: () => void) => done());
      this.drain();
    }
  }
  private reason(error: Error): string {
    if (error instanceof AccessDenied) return '当前账号没有资源访问权限';
    const message = error.message || '';
    if (/\b404\b/.test(message)) return '平台资源不存在或已移除（404）';
    if (/\b(401|403)\b/.test(message)) return '平台拒绝该资源访问（' + (/403/.test(message) ? '403' : '401') + '）';
    if (/\b5\d\d\b/.test(message)) return '平台服务暂时不可用';
    if (/timeout|timed out/i.test(message)) return '网络请求超时';
    if (/space|ENOSPC/i.test(message)) return '本机存储空间不足';
    return /[\u4e00-\u9fff]/.test(message) ? message : '网络连接或资源传输失败';
  }
  private async retry<T>(label: string, operation: () => Promise<T>, job?: DownloadJob): Promise<T> {
    const gen = this.epoch;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (this.canceled || gen !== this.epoch) throw new Error('已暂停');
      try { return await operation(); }
      catch (error) {
        const err = error as Error;
        if (this.canceled || gen !== this.epoch) throw new Error('已暂停');
        if (err instanceof AccessDenied || /\b(401|403|404)\b|地址无效|存储空间不足|ENOSPC|No space/i.test(err.message)) throw err;
        if (attempt === 2) throw new Error(this.reason(err) + '（重试 2 次仍失败）');
        if (job) { job.message = label + '正在重试 ' + (attempt + 1) + '/2'; this.publish(); }
        await this.retryWait(400 * (attempt + 1));
      }
    }
    throw new Error(label + '下载失败');
  }
  private async retryWait(milliseconds: number): Promise<void> { await new Promise<void>((resolve) => setTimeout(resolve, milliseconds)); }
  private part(job: DownloadJob, id: string, kind: string, url: string = '', path: string = ''): DownloadPart {
    if (!job.parts) job.parts = [];
    let item = job.parts.find((part: DownloadPart) => part.id === id);
    if (!item) { item = { id, kind, url, path, total: -1, received: 0, done: false }; job.parts.push(item); }
    if (url) item.url = url; if (path) item.path = path; return item;
  }
  private byteProgress(job: DownloadJob): void { const state = downloadBytes(job.parts || []); job.downloadedBytes = state.received; job.totalBytes = state.total; job.unknownSizes = state.unknown; job.progress = state.progress; this.publishProgress(); }
  private received(job: DownloadJob, item: DownloadPart, received: number, total: number): void { item.received = Math.max(0, received); if (total >= 0) item.total = total; this.byteProgress(job); }
  private completed(job: DownloadJob, item: DownloadPart, size: number): void { item.total = Math.max(0, size); item.received = item.total; item.done = true; item.blocked = ''; this.byteProgress(job); }
  private fileSize(path: string): number { try { return fs.statSync(path).size; } catch (_) { return 0; } }
  private savedPart(item: DownloadPart): boolean { return item.done && !!item.path && this.fileSize(item.path) > 0; }
  private async measure(job: DownloadJob, parts: DownloadPart[]): Promise<void> {
    const gen = this.epoch; let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < parts.length && !this.canceled && gen === this.epoch) {
        const item = parts[cursor++];
        if (this.savedPart(item)) { this.completed(job, item, this.fileSize(item.path)); continue; }
        if (item.done) item.received = item.path ? this.fileSize(item.path + '.part') : 0;
        if (item.kind === 'slides') item.received = 0; item.done = false; item.blocked = ''; if (!item.url || item.total >= 0) continue;
        const req = http.createHttp(); this.pending.add(req);
        try { const result = await req.request(item.url, { method: http.RequestMethod.HEAD, header: this.headers(item.url), usingCache: false, connectTimeout: 5000, readTimeout: 5000 });
          if (this.canceled || gen !== this.epoch) throw new Error('已暂停');
          const headers = result.header as Record<string, string>, size = Number(headers?.['content-length'] || headers?.['Content-Length'] || '-1');
          if (result.responseCode === 200 && Number.isFinite(size) && size >= 0) item.total = size;
          if (result.responseCode === 401 || result.responseCode === 403 || result.responseCode === 404) item.blocked = '平台资源不可访问（' + result.responseCode + '）';
        } catch (_) {} finally { req.destroy(); this.pending.delete(req); }
        this.byteProgress(job);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]); if (this.canceled || gen !== this.epoch) throw new Error('已暂停');
  }
  private async download(job: DownloadJob): Promise<void> {
    const course = job.course, gen = this.epoch;
    await this.retry('课程权限', () => this.api.checkCurrentPermission(course), job);
    const previous = this.snapshot(course.subId), existing = this.entry(course.subId);
    let slides: Slide[] = previous?.slides || [], lines: Transcript[] = reconcileLines(this.store.load(course.subId)?.lines || [], previous?.lines || []);
    const failures: string[] = [];
    const available: DownloadOptions = { slides: existing?.options.slides || false, transcript: existing?.options.transcript || false, video: existing?.options.video || false };
    let videoUri = existing?.videoUri || '', videoOffset = existing?.videoOffset || 0, partial = existing?.partial || false, bytes = existing?.bytes || 0;
    const valid = (): void => { if (this.canceled || gen !== this.epoch) throw new Error('已暂停'); };
    const save = (): void => { valid(); this.store.saveJson('offline-snapshot-' + key(course.subId) + '.json', JSON.stringify({ course, slides, lines, savedAt: Date.now() } as Snapshot)); if (available.slides || available.transcript || available.video) this.keep({ course, options: available, videoUri, videoOffset, partial, bytes, incomplete: failures.length > 0, missing: failures.slice(), savedAt: Date.now() }); };
    job.parts = (job.parts || []).filter((part: DownloadPart) => part.kind === 'slides' ? job.options.slides : part.kind === 'transcript' ? job.options.transcript : job.options.video);
    // Register selected directories before measuring, so no stage claims 100% while video sizes are still unknown.
    if (job.options.video && !job.videoComplete) this.part(job, 'video-directory', 'video');
    if (job.options.slides) this.part(job, 'slides-directory', 'slides');
    if (job.options.transcript && !job.transcriptComplete) this.part(job, 'transcript-directory', 'transcript');
    this.byteProgress(job);
    if (job.options.transcript) {
      if (lines.length) available.transcript = true;
      if (!job.transcriptComplete) try { const incoming = await this.retry('转写', () => this.api.transcripts(course), job); valid(); if (incoming.length) { lines = reconcileLines(lines, incoming); available.transcript = true; job.transcriptComplete = true; } else failures.push(lines.length ? '已保存本机转写，平台尚未提供历史转写' : '平台尚未提供转写'); }
      catch (err) { valid(); failures.push('转写下载失败：' + this.reason(err as Error)); }
      if (job.transcriptComplete) { job.parts = job.parts?.filter((part: DownloadPart) => part.id !== 'transcript-directory'); this.completed(job, this.part(job, 'transcript-content', 'transcript'), utf8Bytes(JSON.stringify(lines))); } save();
    }
    let incoming: Slide[] = [];
    if (job.options.slides) {
      try { incoming = await this.retry('课件目录', () => this.api.slides(course), job); valid(); if (incoming.length) { job.parts = job.parts?.filter((part: DownloadPart) => part.id !== 'slides-directory'); incoming.forEach((slide: Slide) => this.part(job, 'image-' + key(slide.url), 'slides', slide.url)); } else failures.push('平台尚未提供课件'); }
      catch (err) { valid(); failures.push('课件目录读取失败：' + this.reason(err as Error)); }
    }
    let source: MediaSource | undefined, prepared: PreparedPlaylist | undefined;
    const folder = this.store.dataFolder + '/video-' + key(course.subId);
    if (job.options.video && !job.videoComplete) {
      try { const sources = await this.retry('视频目录', () => this.api.videos(course), job); valid(); source = sources.find((item: MediaSource) => !item.live) || sources[0]; if (!source) throw new Error('平台尚未提供可下载的视频'); try { fs.mkdirSync(folder, true); } catch (_) {}
        if (source.hls || /\.m3u8(?:\?|$)/i.test(source.url)) prepared = await this.preparePlaylist(source.url, folder, 'index.m3u8', course.start, job, 0);
        else this.part(job, 'video-' + key(folder + '/video.mp4'), 'video', source.url, folder + '/video.mp4');
        job.parts = job.parts?.filter((part: DownloadPart) => part.id !== 'video-directory');
      } catch (err) { valid(); source = undefined; failures.push('视频目录读取失败：' + this.reason(err as Error)); }
    }
    job.message = '正在确认文件大小'; this.publish();
    await this.measure(job, (job.parts || []).filter((part: DownloadPart) => !!part.url)); valid();
    const saved = new Map<string, Slide>(); slides.forEach((slide: Slide) => saved.set(slide.id, slide));
    let completed = 0;
    for (const slide of incoming) {
      valid(); const item = this.part(job, 'image-' + key(slide.url), 'slides', slide.url);
      try {
        if (item.blocked) throw new Error(item.blocked);
        if (!this.savedPart(item)) { const uri = await this.retry('课件 ' + (completed + 1), () => this.store.pinImage(slide.url, (received: number, total: number) => { if (this.canceled || gen !== this.epoch) return; this.received(job, item, received, total); job.message = `课件 ${completed + 1}/${incoming.length}`; }), job); valid(); item.path = new fileUri.FileUri(uri).path; this.completed(job, item, this.fileSize(item.path) || item.received); }
        saved.set(slide.id, slide); slides = Array.from(saved.values()).sort((a: Slide, b: Slide) => a.t - b.t); available.slides = true; save();
      } catch (err) { valid(); failures.push('课件第 ' + (completed + 1) + ' 页（' + stamp(slide.t) + '）下载失败：' + this.reason(err as Error)); }
      completed++; job.message = `课件 ${completed}/${incoming.length}`; this.byteProgress(job); this.publish();
    }
    if (source) try {
      if (prepared) { const downloaded = await this.writePlaylist(prepared, job); if (downloaded.playable) { videoOffset = downloaded.offset; partial = !downloaded.complete; bytes = downloaded.bytes; videoUri = fileUri.getUriFromPath(folder + '/index.m3u8'); available.video = true; } if (downloaded.failures.length) failures.push(downloaded.failures.join('；')); job.videoComplete = !downloaded.failures.length; }
      else { const destination = folder + '/video.mp4', item = this.part(job, 'video-' + key(destination), 'video', source.url, destination); if (item.blocked) throw new Error(item.blocked); await this.file(source.url, destination, (received: number, total: number) => { if (this.canceled || gen !== this.epoch) return; this.received(job, item, received, total); job.message = '正在下载视频'; }); valid(); bytes = this.fileSize(destination); this.completed(job, item, bytes); videoUri = fileUri.getUriFromPath(destination); available.video = true; job.videoComplete = true; }
    } catch (err) { valid(); failures.push('视频下载失败：' + this.reason(err as Error)); }
    valid(); this.byteProgress(job); save();
    if (failures.length) throw new Error((available.slides || available.transcript || available.video ? '已保存可用内容；' : '') + failures.join('；'));
  }
  private headers(address: string): Record<string, string> {
    const headers: Record<string, string> = {}; headers['Referer'] = 'https://classroom.zju.edu.cn/';
    const origin = /^https:\/\/[^/]+/.exec(address)?.[0] || '';
    if (/^https:\/\/(?:[A-Za-z0-9-]+\.)*zju\.edu\.cn$/.test(origin)) headers['Cookie'] = SessionStore.cookie(origin);
    return headers;
  }
  private async text(address: string): Promise<string> { return this.retry('视频清单', () => this.textOnce(address)); }
  private async textOnce(address: string): Promise<string> {
    if (!mediaUrl(address)) throw new Error('视频地址无效');
    const req = http.createHttp(); this.pending.add(req);
    try {
      const result = await req.request(address, { header: this.headers(address), expectDataType: http.HttpDataType.STRING, usingCache: false, readTimeout: 30000 });
      if (result.responseCode !== 200) throw new Error(`视频清单读取失败（${result.responseCode}）`);
      return result.result as string;
    } finally { req.destroy(); this.pending.delete(req); }
  }
  private async preparePlaylist(address: string, folder: string, name: string, start: number, job: DownloadJob, depth: number): Promise<PreparedPlaylist> {
    if (depth > 3) throw new Error('视频清单层级过多');
    const plan = hlsPlan(await this.text(address), address, start), prepared: PreparedPlaylist = { plan, folder, name, children: [] };
    if (plan.variant) {
      prepared.children.push(await this.preparePlaylist(plan.variant, folder, 'main.m3u8', start, job, depth + 1));
      if (plan.audio) { const directory = folder + '/audio'; try { fs.mkdirSync(directory, true); } catch (_) {} prepared.children.push(await this.preparePlaylist(plan.audio, directory, 'audio.m3u8', start, job, depth + 1)); }
    } else { if (!plan.files.length || !plan.text.split('\n').some((line: string) => !!line.trim() && !line.startsWith('#'))) throw new Error('平台尚未提供可下载的视频片段'); plan.files.forEach((item) => this.part(job, 'video-' + key(folder + '/' + item.name), 'video', item.url, folder + '/' + item.name)); }
    const part = this.part(job, 'playlist-' + key(folder + '/' + name), 'video', '', folder + '/' + name); part.total = utf8Bytes(this.playlistText(prepared));
    return prepared;
  }
  private playlistText(prepared: PreparedPlaylist): string { if (!prepared.children.length) return prepared.plan.text; return '#EXTM3U\n' + (prepared.plan.audio ? '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Audio",DEFAULT=YES,AUTOSELECT=YES,URI="audio/audio.m3u8"\n' : '') + '#EXT-X-STREAM-INF:BANDWIDTH=2000000' + (prepared.plan.audio ? ',AUDIO="audio"' : '') + '\nmain.m3u8\n'; }
  private async writePlaylist(prepared: PreparedPlaylist, job: DownloadJob): Promise<PlaylistSaved> {
    const gen = this.epoch, plan = prepared.plan, failures: string[] = [];
    const valid = (): void => { if (this.canceled || gen !== this.epoch) throw new Error('已暂停'); }; valid();
    if (prepared.children.length) {
      const main = await this.writePlaylist(prepared.children[0], job);
      if (prepared.children[1]) { const audio = await this.writePlaylist(prepared.children[1], job); main.bytes += audio.bytes; main.failures.push(...audio.failures); if (!audio.playable || audio.failures.length) main.playable = false; }
      let text = '#EXTM3U\n'; if (plan.audio) text += '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Audio",DEFAULT=YES,AUTOSELECT=YES,URI="audio/audio.m3u8"\n'; text += '#EXT-X-STREAM-INF:BANDWIDTH=2000000' + (plan.audio ? ',AUDIO="audio"' : '') + '\nmain.m3u8\n';
      if (main.playable) { this.write(prepared.folder + '/' + prepared.name, text); const part = this.part(job, 'playlist-' + key(prepared.folder + '/' + prepared.name), 'video', '', prepared.folder + '/' + prepared.name); this.completed(job, part, utf8Bytes(text)); main.bytes += utf8Bytes(text); } return main;
    }
    let bytes = 0; const missing: string[] = [];
    for (let i = 0; i < plan.files.length; i++) {
      valid(); const file = plan.files[i], destination = prepared.folder + '/' + file.name, item = this.part(job, 'video-' + key(destination), 'video', file.url, destination);
      if (this.savedPart(item)) { bytes += this.fileSize(destination); continue; }
      try { if (item.blocked) throw new Error(item.blocked); await this.file(file.url, destination, (received: number, total: number) => { if (this.canceled || gen !== this.epoch) return; this.received(job, item, received, total); job.message = `视频片段 ${i + 1}/${plan.files.length}`; }); valid(); const size = this.fileSize(destination); bytes += size; this.completed(job, item, size); }
      catch (err) { valid(); missing.push(file.name); failures.push('视频片段 ' + (i + 1) + '：' + this.reason(err as Error)); }
      job.message = `视频片段 ${i + 1}/${plan.files.length}`; this.publish();
    }
    const text = missing.length ? availablePlaylist(plan.text, missing) : plan.text;
    if (text) { this.write(prepared.folder + '/' + prepared.name, text); const part = this.part(job, 'playlist-' + key(prepared.folder + '/' + prepared.name), 'video', '', prepared.folder + '/' + prepared.name); if (missing.length) { part.received = utf8Bytes(text); part.done = false; this.byteProgress(job); } else this.completed(job, part, utf8Bytes(text)); bytes += utf8Bytes(text); }
    return { offset: plan.offset, complete: plan.endList && !missing.length, bytes, failures: failures.length ? [missing.length + ' 个视频文件未完成：' + failures[0]] : [], playable: !!text };
  }
  private write(path: string, text: string): void { const file = fs.openSync(path, fs.OpenMode.CREATE | fs.OpenMode.WRITE_ONLY | fs.OpenMode.TRUNC); try { fs.writeSync(file.fd, text); } finally { fs.closeSync(file); } }
  private async file(address: string, destination: string, progress: (received: number, total: number) => void = () => {}): Promise<void> { await this.retry('视频片段', () => this.fileOnce(address, destination, progress)); }
  private async fileOnce(address: string, destination: string, progress: (received: number, total: number) => void): Promise<void> {
    const gen = this.epoch; if (!mediaUrl(address)) throw new Error('视频片段地址无效');
    try { const size = fs.statSync(destination).size; if (size > 0) { progress(size, size); return; } } catch (_) {}
    let resumeAt = 0; try { resumeAt = fs.statSync(destination + '.part').size; } catch (_) {}
    const file = fs.openSync(destination + '.part', fs.OpenMode.CREATE | fs.OpenMode.WRITE_ONLY | fs.OpenMode.APPEND);
    const headers = this.headers(address); if (resumeAt > 0) headers['Range'] = 'bytes=' + resumeAt + '-';
    let expected = -1, received = 0, stored = 0, reportedAt = 0;
    const req = http.createHttp(); this.pending.add(req);
    let aborted: () => void = () => {};
    let watchdog: any = -1;
    try {
      let writeError: Error | undefined;
      let finish: () => void = () => {};
      let fail: (err: Error) => void = () => {};
      const ended = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
      ended.catch(() => {});
      aborted = () => fail(new Error('已暂停')); this.abortStreams.add(aborted);
      const reset = (): void => { clearTimeout(watchdog); watchdog = setTimeout(() => { fail(new Error('视频下载中断，可继续下载')); req.destroy(); }, 65000); };
      reset();
      req.on('headersReceive', (raw: Object) => {
        const values = raw as Record<string, string>, range = values['content-range'] || values['Content-Range'] || '', length = Number(values['content-length'] || values['Content-Length'] || '-1');
        const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range);
        if (match && Number(match[1]) !== resumeAt) { writeError = new Error('视频续传位置不一致，请重试'); fail(writeError); req.destroy(); return; }
        if (resumeAt > 0 && !match) { fs.truncateSync(file.fd, 0); resumeAt = 0; }
        expected = match ? Number(match[3]) - resumeAt : Number.isFinite(length) ? length : -1; progress(resumeAt, expected >= 0 ? expected + resumeAt : -1);
      });
      req.on('dataEnd', () => { clearTimeout(watchdog); finish(); });
      req.on('dataReceive', (data: ArrayBuffer) => {
        reset(); received += data.byteLength;
        try { let offset = 0; while (offset < data.byteLength) { const written = fs.writeSync(file.fd, data.slice(offset)); if (written <= 0) throw new Error('视频文件写入失败'); offset += written; stored += written; } }
        catch (err) { writeError = err as Error; fail(writeError); req.destroy(); }
        if (gen === this.epoch && !this.canceled && Date.now() - reportedAt > 120) { reportedAt = Date.now(); progress(stored + resumeAt, expected >= 0 ? expected + resumeAt : -1); }
      });
      const code = await req.requestInStream(address, { header: headers, usingCache: false, connectTimeout: 10000, readTimeout: 600000 });
      if (code !== 200 && code !== 206) { fs.truncateSync(file.fd, resumeAt); progress(resumeAt, -1); throw new Error(`视频下载失败（${code}）`); }
      await ended; if (writeError) throw writeError; if (expected >= 0 && received !== expected) throw new Error('视频接收不完整，可继续下载'); if (this.canceled || gen !== this.epoch) throw new Error('已暂停');
    } finally { clearTimeout(watchdog); this.abortStreams.delete(aborted); req.destroy(); this.pending.delete(req); fs.closeSync(file); }
    fs.renameSync(destination + '.part', destination); progress(received + resumeAt, received + resumeAt);
  }
}
interface PlaylistSaved { offset: number; complete: boolean; bytes: number; failures: string[]; playable: boolean }
interface PreparedPlaylist { plan: HlsPlan; folder: string; name: string; children: PreparedPlaylist[] }
