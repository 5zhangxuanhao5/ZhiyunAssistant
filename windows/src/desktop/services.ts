import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import type { Session } from 'electron';
import { disposeImageJobs } from './image-jobs';
import { configureCompat, credentialledFetch, allowedNetworkUrl, common, fileUri, image, DesktopAdapters, browserSessions } from './compat';
import { Zhiyun, courseIsLive, AccessDenied } from '../shared/services/Zhiyun';
import { LocalStore, key, Snapshot } from '../shared/services/LocalStore';
import { SessionStore } from '../shared/services/SessionStore';
import { LiveTranscript } from '../shared/services/LiveTranscript';
import { OfflineLibrary } from './downloads';
import { AiClient } from '../shared/services/AiClient';
import { NotesStore } from '../shared/services/NotesStore';
import { ChatStore } from '../shared/services/ChatStore';
import { SummaryCache } from '../shared/services/SummaryCache';
import { CourseContextLoader } from '../shared/services/CourseContextLoader';
import { SlideSimilarityStore } from '../shared/services/SlideSimilarityStore';
import { SmartSkipService } from '../shared/services/SmartSkipService';
import { CACHE_KINDS, cacheLabel } from '../shared/services/FeatureCache';
import { Account, Course, Slide, Transcript, reconcileLines, mergeSlides, groupPages, shanghaiDate, imageUrl } from '../shared/model/Timeline';
import { CourseCollections } from '../shared/model/CourseCollections';
import { LearningProgress, readLearningProgress } from '../shared/model/LearningProgress';
import { LessonNote } from '../shared/model/Notes';
import { MediaSource, mediaUrl } from '../shared/model/Media';
import { PageSummaryRecord } from '../shared/model/SummaryPolicy';
import { PriorCourseContext } from '../shared/model/CourseContext';
import type { LessonData } from '../shared/bridge';

type Emit = (event: string, value: any) => void;
interface Resource { local?: string; remote?: string; kind: 'image' | 'video' | 'attachment' }
function checkedCourse(raw: unknown): Course {
  const value = raw as Course;
  if (!value || typeof value.courseId !== 'string' || !value.courseId || typeof value.subId !== 'string' || !value.subId || typeof value.title !== 'string' || !Number.isFinite(value.start) || !Number.isFinite(value.end)) throw new Error('课程信息无效');
  return value;
}
function validName(value: unknown): string { if (typeof value !== 'string' || !/^[a-zA-Z0-9_.:-]{1,160}$/.test(value) || value.includes('..')) throw new Error('保存键无效'); return value; }
function mime(filename: string): string { const ext = path.extname(filename.split('?')[0]).toLowerCase(); return ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.m3u8': 'application/vnd.apple.mpegurl', '.ts': 'video/mp2t', '.m4s': 'video/iso.segment', '.aac': 'audio/aac', '.key': 'application/octet-stream' } as Record<string, string>)[ext] || 'application/octet-stream'; }
function readObject<T>(value: string, fallback: T): T { try { return JSON.parse(value) as T; } catch (_) { return fallback; } }

export function createServices(session: Session, userData: string, emit: Emit, adapters?: DesktopAdapters) {
  configureCompat(session, userData, adapters);
  const context: common.UIAbilityContext = { filesDir: path.join(userData, 'data'), cacheDir: path.join(userData, 'runtime'), tempDir: path.join(userData, 'runtime') };
  fs.mkdirSync(context.filesDir, { recursive: true, mode: 0o700 }); fs.mkdirSync(context.cacheDir, { recursive: true, mode: 0o700 });
  const api = new Zhiyun(), liveSocket = new LiveTranscript(), similarity = new SlideSimilarityStore(), collections = new CourseCollections(), smartSkip = new SmartSkipService();
  const resources = new Map<string, Resource>(), displayedImages = new Map<string, string>(), resourceKeys = new Map<string, string>(), clients = new Map<string, AiClient>(), contextLoaders = new Map<string, CourseContextLoader>();
  let account: Account | undefined, store: LocalStore | undefined, downloads: OfflineLibrary | undefined, lesson: LessonData | undefined;
  let catalogueEpoch = 0;
  let lessonEpoch = 0, liveTimer: ReturnType<typeof setTimeout> | undefined, historyPromise: Promise<any> | undefined;
  let lessonRefresh: Promise<LessonData> | undefined;
  let liveEmitTimer: ReturnType<typeof setTimeout> | undefined, lastLivePersist = 0; const pendingLive = new Map<string, Transcript>();
  let browserCacheInventory: { at: number; entries: Array<{ id: string; label: string; path: string; bytes: number }> } | undefined;
  function requiredStore(): LocalStore { if (!store || !account) throw new Error('请先登录智云课堂'); return store; }
  function bind(value: Account): Account {
    if (account?.id !== value.id || !store) {
      closeLesson(); resources.clear(); displayedImages.clear(); resourceKeys.clear(); downloads?.pause(); api.cancel(); liveSocket.close(); smartSkip.cancel(); clients.forEach(client => client.cancel()); clients.clear(); contextLoaders.forEach(loader => loader.cancel()); contextLoaders.clear(); store?.cache.flush();
      account = value; store = new LocalStore(context, value.id); api.usePermissionStorage(store); collections.bind(store);
      downloads = new OfflineLibrary(store, (progressOnly) => emit('downloads', progressOnly ? { taskUpdates: downloads?.progressTasks() || [], concurrency: downloads?.concurrency() || 1 } : { entries: downloads?.list() || [], tasks: downloads?.tasks() || [], concurrency: downloads?.concurrency() || 1 }));
    } else account = value;
    return value;
  }
  function localResource(local: string, kind: Resource['kind'] = 'image'): string {
    const full = local.startsWith('file://') ? fileURLToPath(local) : path.resolve(local), root = path.resolve(requiredStore().dataFolder);
    const temporaryPrefix = path.resolve(context.cacheDir, 'temporary-slides-' + key(account!.id));
    if (full !== root && !full.startsWith(root + path.sep) && !(full.startsWith(temporaryPrefix) && (full[temporaryPrefix.length] === path.sep || full[temporaryPrefix.length] === '-'))) throw new Error('本机资源位置无效');
    const identity = 'local:' + full, prior = resourceKeys.get(identity); if (prior) return prior;
    const token = crypto.randomBytes(24).toString('hex'), url = 'zhiyun-resource://asset/' + token + '/' + encodeURIComponent(path.basename(full));
    resources.set(token, { local: full, kind }); resourceKeys.set(identity, url); return url;
  }
  function remoteResource(address: string, kind: Resource['kind'] = 'video'): string {
    const remote = allowedNetworkUrl(address).href, identity = 'remote:' + remote, prior = resourceKeys.get(identity); if (prior) return prior;
    const token = crypto.randomBytes(24).toString('hex'), url = 'zhiyun-resource://asset/' + token + '/' + encodeURIComponent(new URL(remote).pathname.split('/').pop() || 'resource');
    resources.set(token, { remote, kind }); resourceKeys.set(identity, url); return url;
  }
  function resource(value: string): Resource | undefined { try { const url = new URL(value); if (url.protocol !== 'zhiyun-resource:' || url.hostname !== 'asset') return undefined; return resources.get(url.pathname.split('/')[1]); } catch (_) { return undefined; } }
  function resolveNoteImage(value: string): string {
    const entry = resource(value); if (entry?.local) return fileUri.getUriFromPath(entry.local);
    if (value.startsWith('file://')) { localResource(value); return value; }
    throw new Error('笔记图片来源不可用，请重新选择图片');
  }
  function mapNoteImages(note: LessonNote, convert: (value: string) => string): LessonNote { const atom = (item: any): any => item.kind === 'image' ? { ...item, value: convert(item.value) } : item; return { ...note, atoms: note.atoms.map(atom), blocks: note.blocks?.map(block => ({ ...block, atoms: block.atoms.map(atom) })) }; }
  async function canonicalNoteImages(note: LessonNote): Promise<LessonNote> {
    const originals = new Set(note.atoms.concat(note.blocks?.flatMap(block => block.atoms) || []).filter(atom => atom.kind === 'image').map(atom => atom.value));
    const sources = new Map<string, string>();
    for (const value of originals) {
      const official = imageUrl(value); let uri: string;
      if (official) { const shown = displayedImages.get(official), original = shown && fs.existsSync(shown) ? fileUri.getUriFromPath(shown) : await requiredStore().image(official, () => {}, note.course); uri = noteStore().picture(original); }
      else uri = noteStore().picture(resolveNoteImage(value));
      sources.set(value, uri);
    }
    return mapNoteImages(note, value => sources.get(value)!);
  }
  function displayNote(note: LessonNote): LessonNote { return mapNoteImages(note, value => localResource(value)); }
  function noteStore(): NotesStore { return new NotesStore(requiredStore()); }
  function summaryStore(course: Course): SummaryCache { return new SummaryCache(requiredStore(), course); }
  function closeLesson(): void { if (lesson && store) try { store.save({ course: lesson.course, slides: lesson.slides, lines: reconcileLines(lesson.lines, Array.from(pendingLive.values())), savedAt: Date.now() }); } catch (_) { emit('lesson.status', { message: '本机缓存未能保存，请检查存储空间' }); } lessonEpoch++; clearTimeout(liveEmitTimer); liveEmitTimer = undefined; pendingLive.clear(); similarity.cancel(); store?.cancel(); clearTimeout(liveTimer); liveSocket.close(); smartSkip.cancel(); lesson = undefined; lessonRefresh = undefined; }
  async function refreshLesson(generation = lessonEpoch): Promise<LessonData> {
    const active = lesson; if (!active || active.offline) { if (active) return active; throw new Error('请先进入课程'); }
    const currentStore = requiredStore(), course = active.course;
    // A definitive denial never falls back to a second endpoint or stored content.
    await api.checkCurrentPermission(course); if (generation !== lessonEpoch) throw new Error('已切换课程');
    const [slidesResult, linesResult] = await Promise.allSettled([api.slides(course), api.transcripts(course)]);
    if (generation !== lessonEpoch) throw new Error('已切换课程');
    for (const result of [slidesResult, linesResult]) if (result.status === 'rejected' && result.reason instanceof AccessDenied) { lesson = { ...active, slides: [], lines: [], historyStatus: '平台拒绝课程访问' }; emit('lesson', lesson); throw result.reason; }
    const slides = slidesResult.status === 'fulfilled' ? mergeSlides(active.slides, slidesResult.value) : active.slides;
    const lines = linesResult.status === 'fulfilled' ? reconcileLines(active.lines, linesResult.value) : active.lines;
    const historyLines = lines.some(line => line.timing === 'history');
    const historyStatus = active.live && !historyLines ? '平台暂未提供进入直播前的历史转写；当前仅显示本机已接收的内容。历史转写会继续同步。' : linesResult.status === 'rejected' ? '转写暂未同步，保留已接收内容并继续重试。' : '';
    lesson = { ...active, slides, lines, historyStatus }; currentStore.save({ course, slides, lines, savedAt: Date.now() }); emit('lesson', lesson);
    return lesson;
  }
  function scheduleLive(generation: number): void {
    clearTimeout(liveTimer);
    if (!lesson?.live || lesson.offline || generation !== lessonEpoch) return;
    liveTimer = setTimeout(async () => { try { await refreshLesson(generation); } catch (error) { if (generation === lessonEpoch) emit('lesson.status', { message: (error as Error).message }); } if (generation === lessonEpoch) scheduleLive(generation); }, 7000);
  }
  async function openLesson(course: Course, offline: boolean): Promise<LessonData> {
    closeLesson(); const generation = lessonEpoch, currentStore = requiredStore(); currentStore.useCourse(course);
    if (offline) {
      const entry = downloads?.entry(course.subId), saved = downloads?.snapshot(course.subId); if (!entry || !saved) throw new Error('没有这节课的离线内容');
      lesson = { course: saved.course, slides: saved.slides, lines: saved.lines, offline: true, live: false, missing: entry.missing || [], sources: entry.videoUri ? [{ id: 'offline', title: '离线视频', url: localResource(entry.videoUri, 'video'), live: false, offset: entry.videoOffset }] as any : [] }; emit('lesson', lesson); return lesson;
    }
    await SessionStore.refresh(); await api.checkCurrentPermission(course); if (generation !== lessonEpoch) throw new Error('已切换课程');
    const cached = currentStore.load(course.subId);
    lesson = { course, slides: cached?.slides || [], lines: cached?.lines || [], live: courseIsLive(course), sources: [], historyStatus: '' };
    if (cached && (cached.slides.length || cached.lines.length)) { emit('lesson', lesson); void refreshLesson(generation).catch(error => { if (generation === lessonEpoch) emit('lesson.status', { message: (error as Error).message }); }); }
    else await refreshLesson(generation);
    if (generation !== lessonEpoch || !lesson) throw new Error('已切换课程');
    if (lesson.live) {
      try { const info = await api.info(course), address = await api.liveCaptionAddress(course, info); if (generation === lessonEpoch) liveSocket.connect(address, course.start, line => { if (generation !== lessonEpoch || !lesson) return; pendingLive.set(line.id, line); if (liveEmitTimer) return; liveEmitTimer = setTimeout(() => { liveEmitTimer = undefined; if (generation !== lessonEpoch || !lesson) return; const added = Array.from(pendingLive.values()); pendingLive.clear(); lesson = { ...lesson, lines: reconcileLines(lesson.lines, added) }; if (Date.now() - lastLivePersist > 2000) { currentStore.save({ course, slides: lesson.slides, lines: lesson.lines, savedAt: Date.now() }); lastLivePersist = Date.now(); } emit('lesson.transcript', { course, added }); }, 120); }, message => { if (generation === lessonEpoch) emit('lesson.status', { message }); }); } catch (_) {}
      scheduleLive(generation);
    }
    return lesson;
  }
  async function runHistory(payload: any): Promise<any> {
    if (historyPromise) { const cached = requiredStore().loadMyAttendance(); return { courses: cached?.courses || [], cursor: cached?.cursor || '', complete: cached?.complete || false, scanning: true }; }
    const currentStore = requiredStore(), currentAccount = account!, generation = catalogueEpoch;
    let initial = currentStore.loadMyAttendance();
    if (payload.refresh && initial) initial = { ...initial, cursor: '', complete: false };
    historyPromise = (async () => {
      let state = initial ? { courses: initial.courses, cursor: initial.cursor, complete: initial.complete, emptyWindows: 0 } : undefined;
      if (state) emit('courses.history', state);
      // Fresh recent records are always compared; old permissions never decide entry access.
      const recent = await api.courses(currentAccount); if (generation !== catalogueEpoch) throw new Error('课程目录缓存已清理'); const map = new Map((payload.refresh ? [] : state?.courses || []).filter(course => course.end < Date.now() / 1000).map(course => [course.subId, course])); recent.filter(course => course.end < Date.now() / 1000).forEach(course => map.set(course.subId, course));
      state = { courses: Array.from(map.values()), cursor: state?.cursor || '', complete: state?.complete || false, emptyWindows: 0 };
      let result: any;
      do { result = await api.attendanceHistory(currentAccount, (_done, _total, next) => { if (next && generation === catalogueEpoch) { currentStore.saveMyAttendance(next.courses, next.cursor, next.complete); emit('courses.history', next); } }, state); if (generation !== catalogueEpoch) throw new Error('课程目录缓存已清理'); state = result; if (result.failed) break; } while (!result.complete);
      currentStore.saveMyAttendance(result.courses, result.cursor, result.complete); emit('courses.history', result); return result;
    })().finally(() => { historyPromise = undefined; });
    void historyPromise.catch(error => { if (generation === catalogueEpoch) emit('courses.history.error', { message: (error as Error).message }); });
    return { courses: initial?.courses || [], cursor: initial?.cursor || '', complete: initial?.complete || false, scanning: true };
  }
  async function priorContext(course: Course, whole: boolean, status: (message: string) => void, requestId: string): Promise<PriorCourseContext> {
    const loader = new CourseContextLoader(); contextLoaders.set(requestId, loader); try { return await loader.load(course, requiredStore(), lesson?.offline === true, downloads?.list().map(item => downloads!.snapshot(item.course.subId)).filter((value): value is Snapshot => !!value) || [], status, whole); } finally { loader.cancel(); if (contextLoaders.get(requestId) === loader) contextLoaders.delete(requestId); }
  }
  async function startAi(payload: any): Promise<any> {
    const requestId = validName(payload.requestId), currentStore = requiredStore(), course = checkedCourse(payload.course); currentStore.useCourse(course);
    if (clients.has(requestId)) throw new Error('请求已在处理');
    const client = new AiClient(), startedSummaryRevision = currentStore.cache.revision('summary'); clients.set(requestId, client);
    const status = (message: string) => emit('ai.stream', { requestId, status: message });
    const changed = (text: string) => emit('ai.stream', { requestId, text, status: '' });
    try {
      const slides: Slide[] = payload.slides || [], lines: Transcript[] = payload.lines || [], at = Math.max(0, Number(payload.at) || 0), scope = payload.scope || 'page';
      const prior = ['course', 'courseAll'].includes(scope) ? await priorContext(course, scope === 'courseAll', status, requestId) : undefined;
      const whole = payload.whole === true || scope === 'whole' || scope === 'courseAll';
      let question = String(payload.question || '');
      if (payload.kind === 'summary') question = '请用简洁中文概括当前这页的实际知识与老师讲解，帮助我迅速理解这一页。说明与已学内容的联系及它在课程中的作用；没有新知识不必强行列新增点。不要描述页面左侧右侧等无助于学习的布局，不写冗余免责声明。保留可点击的讲解时间引用；引用其他课次时每个时间点分别引用，不把多个时间合并到同一个链接。';
      if (!question.trim()) throw new Error('请输入问题');
      const answer = await client.ask(currentStore, slides, lines, question, at, whole, payload.model || currentStore.readJson('ai-model.txt') || 'deepseek-flash', payload.history || [], status, payload.kind === 'summary' ? 'always' : payload.mode || 'auto', payload.currentId || payload.pageId || '', changed, payload.selectedIds || (payload.kind === 'summary' && scope === 'page' ? [payload.currentId || payload.pageId].filter(Boolean) : []), prior, async () => { const saved = currentStore.load(course.subId); return { slides: saved?.slides || slides, lines: saved?.lines || lines }; }, undefined, payload.kind === 'summary' ? undefined : payload.viewingMode === 'reading' ? 'reading' : 'playback');
      const references = prior?.lessons.map(item => item.course) || [];
      if (payload.kind === 'summary') {
        if (currentStore.cache.revision('summary') !== startedSummaryRevision) { emit('ai.stream', { requestId, text: answer, done: true }); return { answer, references }; }
        const pageId = payload.pageId || payload.currentId, summary = summaryStore(course), records = summary.latest(scope), revision = currentStore.cache.revision('summary');
        const record = summary.save(scope, pageId, { answer, signature: key(JSON.stringify({ slides, lines, scope, at })), savedAt: Date.now(), completed: !lesson?.live || slides[slides.length - 1]?.id !== pageId, contextAt: at, references }, records, revision);
        emit('ai.stream', { requestId, text: answer, done: true, record }); return { answer, references, record };
      }
      emit('ai.stream', { requestId, text: answer, done: true }); return { answer, references };
    } catch (error) { emit('ai.stream', { requestId, error: (error as Error).message, done: true }); throw error; }
    finally { client.cancel(); clients.delete(requestId); }
  }

  async function directoryBytes(directory: string): Promise<number> {
    let total = 0; const directories = [directory];
    while (directories.length) { const current = directories.pop()!; let entries: fs.Dirent[]; try { entries = await fsp.readdir(current, { withFileTypes: true }); } catch (_) { continue; } for (const entry of entries) { if (entry.isSymbolicLink()) continue; const filename = path.join(current, entry.name); if (entry.isDirectory()) directories.push(filename); else if (entry.isFile()) try { total += (await fsp.stat(filename)).size; } catch (_) {} } }
    return total;
  }
  async function browserCacheEntries(): Promise<Array<{ id: string; label: string; path: string; bytes: number }>> {
    if (browserCacheInventory && Date.now() - browserCacheInventory.at < 5000) return browserCacheInventory.entries;
    const bases = [userData, session.getStoragePath?.() || path.join(userData, 'Partitions', 'zhiyun-campus')];
    const names = ['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'GrShaderCache', 'ShaderCache', 'Crashpad'];
    const entries = []; for (let index = 0; index < bases.length; index++) for (const name of names) { const directory = path.join(bases[index], name), bytes = await directoryBytes(directory); if (bytes > 0) entries.push({ id: 'browser-' + index + '-' + name, label: (index === 0 ? '应用界面 · ' : '登录与课程网页 · ') + (name === 'Cache' ? '网络资源缓存' : name === 'Code Cache' ? '网页脚本缓存' : name === 'Crashpad' ? '崩溃诊断暂存' : '图形运行缓存'), path: directory, bytes }); }
    browserCacheInventory = { at: Date.now(), entries }; return entries;
  }
  async function clearBrowserCaches(ids: string[] = []): Promise<void> {
    if (ids.length) { const selected = (await browserCacheEntries()).filter(entry => ids.includes(entry.id)); browserCacheInventory = undefined; const active = browserSessions(); for (const entry of selected) { const owner = active.find(target => { const base = target.getStoragePath?.(); return !!base && path.resolve(base) === path.dirname(entry.path); }) || (entry.id.startsWith('browser-1-') ? session : undefined); if (entry.path.endsWith(path.sep + 'Cache')) await owner?.clearCache(); else if (entry.path.endsWith(path.sep + 'Code Cache')) await owner?.clearCodeCaches?.({}); else if (!entry.path.endsWith(path.sep + 'Crashpad')) await owner?.clearStorageData?.({ storages: ['shadercache'] }); await fsp.rm(entry.path, { recursive: true, force: true }); } return; }
    browserCacheInventory = undefined;
    for (const target of browserSessions()) { await target.clearCache(); if (target.clearCodeCaches) await target.clearCodeCaches({}); if (target.clearStorageData) await target.clearStorageData({ storages: ['cachestorage', 'shadercache'] }); }
    // Only explicit cache directories, never Cookies, Local Storage, secure assets or offline folders.
    const bases = [userData, session.getStoragePath?.() || path.join(userData, 'Partitions', 'zhiyun-campus')]; let failed = false;
    for (const base of bases) for (const label of ['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'GrShaderCache', 'ShaderCache', 'Crashpad']) { const directory = path.join(base, label); try { await fsp.rm(directory, { recursive: true, force: true }); } catch (_) { failed = true; } }
    if (failed) throw new Error('部分图形或网页缓存仍在使用，退出登录窗口后可再清理');
  }
  async function handle(method: string, payload: any = {}): Promise<any> {
    payload ||= {};
    if (method.startsWith('courses.') || method.startsWith('video.') || method === 'download.enqueue') await SessionStore.refresh();
    switch (method) {
      case 'session.restore': {
        await SessionStore.restore(); const saved = await SessionStore.savedAccount();
        if (!saved) return null; bind(saved);
        try { const fresh = await api.account(); bind(fresh); await SessionStore.rememberAccount(fresh); await SessionStore.saveCurrent(); return fresh; }
        catch (error) { if (!await SessionStore.savedAccount()) { closeLesson(); account = undefined; store = undefined; return null; } return { ...saved, offline: true }; }
      }
      case 'session.account': { await SessionStore.refresh(); const value = bind(await api.account()); await SessionStore.rememberAccount(value); await SessionStore.saveCurrent(); return value; }
      case 'session.logout': { closeLesson(); downloads?.pause(); clients.forEach(client => client.cancel()); clients.clear(); contextLoaders.forEach(loader => loader.cancel()); contextLoaders.clear(); api.cancel(); store?.cache.flush(); await SessionStore.clear(); account = undefined; store = undefined; downloads = undefined; resources.clear(); displayedImages.clear(); resourceKeys.clear(); collections.bind(undefined); return null; }
      case 'courses.schedule': { requiredStore(); const values = payload.start && payload.end ? await api.coursesBetween(account!, payload.start, payload.end) : await api.courses(account!); await api.refreshToday(values); return values; }
      case 'courses.history': return runHistory(payload);
      case 'courses.plaza': { const currentStore = requiredStore(), date = payload.date || shanghaiDate(Date.now() / 1000), values = await api.plaza(account!, date, payload.live === true); currentStore.savePlaza(date, payload.live === true, values); return values; }
      case 'courses.search': { requiredStore(); return api.searchCourses(account!, String(payload.title || ''), String(payload.teacher || ''), Math.max(1, Number(payload.page) || 1)); }
      case 'courses.chapters': { const currentStore = requiredStore(), value = payload.searchCourse || payload.course, rows = await api.chapters(value); currentStore.saveCatalogue(value.courseId, rows); collections.catalogue(value, rows, true); return rows; }
      case 'courses.permissions': { requiredStore(); return api.permissions(payload.courses.map(checkedCourse), (states, confirmed) => emit('permissions', { states: { ...states }, confirmed }), payload.force !== false); }
      case 'lesson.open': return openLesson(checkedCourse(payload.course), payload.offline === true);
      case 'lesson.close': closeLesson(); return null;
      case 'lesson.refresh': { if (!lessonRefresh) lessonRefresh = refreshLesson().finally(() => { lessonRefresh = undefined; }); return lessonRefresh; }
      case 'resource.image': {
        const currentStore = requiredStore(), resourceCourse = payload.course ? checkedCourse(payload.course) : lesson?.course;
        const value = payload.trim ? await currentStore.trimmedImage(payload.url, resourceCourse) : await currentStore.image(payload.url, () => {}, resourceCourse); const rendered = localResource(value); displayedImages.set(payload.url, fileURLToPath(value));
        const active = lesson; if (active && resourceCourse?.subId === active.course.subId) {
          const index = active.slides.findIndex(slide => slide.url === payload.url), generation = lessonEpoch;
          void (async () => { let changed = false; for (const at of [index, index + 1]) { if (at <= 0 || at >= active.slides.length) continue; const previous = active.slides[at - 1], current = active.slides[at], first = currentStore.cachedImage(previous.url), second = currentStore.cachedImage(current.url); if (!first || !second) continue; const same = await similarity.same(first, second); if (generation !== lessonEpoch) return; if (same && current.duplicateOf !== previous.id) { current.duplicateOf = previous.id; current.duplicateUrl = previous.url; changed = true; } } if (changed && generation === lessonEpoch) { currentStore.save({ course: active.course, slides: active.slides.slice(), lines: active.lines, savedAt: Date.now() }); emit('lesson', { ...active, slides: active.slides.slice() }); } })().catch(() => {});
        }
        return rendered;
      }
      case 'resource.drag': { const entry = resource(payload.url), resourceCourse = payload.course ? checkedCourse(payload.course) : lesson?.course; const value = entry?.local ? entry.local : fileURLToPath(payload.trim ? await requiredStore().trimmedImage(payload.url, resourceCourse) : await requiredStore().image(payload.url, () => {}, resourceCourse)); return { path: value }; }
      case 'video.sources': { requiredStore(); return api.videos(checkedCourse(payload.course)); }
      case 'video.resolve': { const source = payload.source as MediaSource; if (!source || !source.url) throw new Error('视频来源无效'); const existing = resource(source.url); if (existing) return { ...source }; await api.checkCurrentPermission(checkedCourse(payload.course)); if (!mediaUrl(source.url)) throw new Error('视频地址无效'); return { ...source, url: remoteResource(source.url, 'video') }; }
      case 'storage.get': { const name = validName(payload.key); if (name === 'privacy-consent') { try { return JSON.parse(await fsp.readFile(path.join(userData, 'privacy-consent.json'), 'utf8')); } catch (_) { return false; } } if (name === 'my-attendance-batch-v1') return readObject(requiredStore().readJson('my-attendance-batch-v1.json'), null); if (name === 'ai-model' || name === 'ai-model.txt') return requiredStore().readJson('ai-model.txt') || 'deepseek-flash'; return readObject(requiredStore().readJson('desktop-' + key(name) + '.json'), null); }
      case 'storage.set': { const name = validName(payload.key); if (name === 'privacy-consent') { await fsp.writeFile(path.join(userData, 'privacy-consent.json.tmp'), JSON.stringify(payload.value === true), { mode: 0o600 }); await fsp.rename(path.join(userData, 'privacy-consent.json.tmp'), path.join(userData, 'privacy-consent.json')); return null; } if (name === 'my-attendance-batch-v1') { requiredStore().saveJson('my-attendance-batch-v1.json', JSON.stringify(payload.value)); return null; } if (name === 'ai-model' || name === 'ai-model.txt') { if (typeof payload.value !== 'string' || !/^[a-zA-Z0-9_.-]{1,100}$/.test(payload.value)) throw new Error('模型名称无效'); requiredStore().saveJson('ai-model.txt', payload.value); return null; } requiredStore().saveJson('desktop-' + key(name) + '.json', JSON.stringify(payload.value)); return null; }
      case 'notes.list': return (payload.course ? noteStore().listFor(checkedCourse(payload.course)) : noteStore().list()).map(displayNote);
      case 'notes.save': { const raw = payload.note as LessonNote; checkedCourse(raw?.course); if (!Array.isArray(raw.atoms) || raw.atoms.length > 100000) throw new Error('笔记内容无效'); const note = await canonicalNoteImages(raw); noteStore().save(note); return displayNote(note); }
      case 'notes.delete': { if (payload.noteIds) { const available = noteStore().list(); for (const id of payload.noteIds) { const found = available.filter(note => note.course.subId + ':' + note.id === id || note.id === id); if (found.length > 1) throw new Error('笔记标识重复，请在对应课次中操作'); if (found[0]) noteStore().delete(found[0]); } } else { const value = noteStore().load(checkedCourse(payload.course), payload.id); noteStore().delete(value); } return null; }
      case 'notes.pickImage': { if (!payload.filePath || typeof payload.filePath !== 'string') return null; const info = await fsp.stat(payload.filePath); if (!info.isFile() || info.size > 30 * 1024 * 1024 || !/\.(png|jpe?g|webp|gif|bmp)$/i.test(payload.filePath)) throw new Error('请选择 30MB 内的图片'); const uri = noteStore().picture(fileUri.getUriFromPath(payload.filePath)); return { uri: localResource(uri) }; }
      case 'notes.saveImage': { const match = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec(String(payload.data || '')); if (!match || match[2].length > 40 * 1024 * 1024) throw new Error('图片数据无效或超过 30MB'); const bytes = Buffer.from(match[2], 'base64'); if (bytes.length > 30 * 1024 * 1024 || bytes.length < 16) throw new Error('图片数据无效'); const extension = match[1] === 'jpeg' ? 'jpg' : match[1], directory = path.join(requiredStore().dataFolder, 'note-images'); await fsp.mkdir(directory, { recursive: true }); const destination = path.join(directory, 'photo-' + crypto.randomBytes(12).toString('hex') + '.' + extension); await fsp.writeFile(destination, bytes, { mode: 0o600 }); try { const source = image.createImageSource(destination); try { const info = await source.getImageInfo(); if (info.size.width * info.size.height > 64000000) throw new Error('图片分辨率过大'); } finally { await source.release(); } } catch (error) { await fsp.rm(destination, { force: true }); throw error; } return { uri: localResource(destination) }; }
      case 'notes.export': { const available = payload.noteIds ? noteStore().list() : [], rawNotes = payload.noteIds ? payload.noteIds.map((id: string) => { const found = available.filter(note => note.course.subId + ':' + note.id === id || note.id === id); if (found.length !== 1) throw new Error('笔记标识不可用或重复，请重新选择'); return found[0]; }) : payload.notes; if (!Array.isArray(rawNotes)) throw new Error('请选择笔记'); const selected: LessonNote[] = []; for (const raw of rawNotes) selected.push(await canonicalNoteImages(raw)); return noteStore().export(selected, payload.format === 'markdown' ? 'md' : payload.format, context, payload.bundle === true, account); }
      case 'ai.settings': { const currentStore = requiredStore(); return { configured: !!await AiClient.savedKey(), model: currentStore.readJson('ai-model.txt') || 'deepseek-flash', models: readObject(currentStore.readJson('ai-models.json'), ['deepseek-flash', 'deepseek-pro']), usage: AiClient.usage(currentStore) }; }
      case 'ai.models': { const secret = await AiClient.savedKey(); if (!secret) return []; const client = new AiClient(); try { const models = await client.models(secret); requiredStore().saveJson('ai-models.json', JSON.stringify(models)); return models; } finally { client.cancel(); } }
      case 'ai.saveKey': { const currentStore = requiredStore(), value = String(payload.key || '').trim(); if (!/^sk-[A-Za-z0-9_-]{16,200}$/.test(value)) throw new Error('请输入有效的 DeepSeek API 密钥'); const verifier = new AiClient(); let models: string[]; try { models = await verifier.models(value); if (!models.length) throw new Error('API 未提供可用模型'); } finally { verifier.cancel(); } await AiClient.saveKey(value); currentStore.saveJson('ai-models.json', JSON.stringify(models)); const model = models.includes(payload.model) ? payload.model : models.includes(currentStore.readJson('ai-model.txt')) ? currentStore.readJson('ai-model.txt') : models.includes('deepseek-flash') ? 'deepseek-flash' : models[0]; currentStore.saveJson('ai-model.txt', model); emit('ai.settings', { configured: true, model, models }); return { configured: true, model, models }; }
      case 'ai.deleteKey': contextLoaders.forEach(loader => loader.cancel()); clients.forEach(client => client.cancel()); await AiClient.clearKey(); emit('ai.settings', { configured: false }); return { configured: false };
      case 'ai.chatSessions': { const currentStore = requiredStore(); currentStore.useCourse(checkedCourse(payload.course)); return new ChatStore(currentStore).list(); }
      case 'ai.saveChat': { const currentStore = requiredStore(); currentStore.useCourse(checkedCourse(payload.course)); new ChatStore(currentStore).save(payload.session); return null; }
      case 'ai.deleteChat': { const currentStore = requiredStore(); currentStore.useCourse(checkedCourse(payload.course)); new ChatStore(currentStore).delete(payload.id); return null; }
      case 'ai.start': return startAi(payload);
      case 'ai.cancel': if (payload.requestId) { clients.get(payload.requestId)?.cancel(); contextLoaders.get(payload.requestId)?.cancel(); } else { clients.forEach(client => client.cancel()); contextLoaders.forEach(loader => loader.cancel()); } return null;
      case 'summary.get': { const summary = summaryStore(checkedCourse(payload.course)), records: Record<string, PageSummaryRecord> = {}, positions: Record<string, number> = {}; for (const scope of ['page', 'before', 'whole', 'course', 'courseAll']) { const values = summary.latest(scope); for (const [pageId, record] of Object.entries(values)) { records[scope + ':' + pageId] = record; positions[scope + ':' + pageId + ':' + (record.id || '')] = summary.position(scope, pageId, record.id || ''); } } return { records, positions, scope: summary.lastScope(), archived: payload.recordId ? summary.record(payload.scope || 'page', payload.pageId, payload.recordId) : undefined }; }
      case 'summary.save': { const currentStore = requiredStore(), summary = summaryStore(checkedCourse(payload.course)); if (payload.record) summary.save(payload.scope, payload.pageId, payload.record, summary.latest(payload.scope), currentStore.cache.revision('summary')); if (Number.isFinite(payload.position)) summary.savePosition(payload.scope, payload.pageId, payload.record?.id || payload.recordId || summary.latest(payload.scope)[payload.pageId]?.id || '', payload.position); return null; }
      case 'download.list': requiredStore(); return { entries: downloads!.list(), tasks: downloads!.tasks(), concurrency: downloads!.concurrency() };
      case 'download.enqueue': { requiredStore(); const parts = payload.parts || {}, options = Array.isArray(parts) ? { video: parts.includes('video'), slides: parts.includes('slides'), transcript: parts.includes('transcript') } : { video: parts.video === true, slides: parts.slides === true, transcript: parts.transcript === true }; if (!Object.values(options).some(Boolean)) throw new Error('请选择要下载的内容'); downloads!.enqueue(payload.courses.map(checkedCourse), options); return null; }
      case 'download.pause': requiredStore(); payload.subId ? downloads!.pauseJob(payload.subId) : downloads!.pause(); return null;
      case 'download.resume': requiredStore(); payload.subId ? downloads!.resumeJob(payload.subId) : downloads!.resume(); return null;
      case 'download.reorder': requiredStore(); downloads!.moveJob(payload.subId, Number(payload.direction) < 0 ? -1 : 1); return null;
      case 'download.delete': requiredStore(); await downloads!.removeMany(payload.subIds || [payload.subId]); return null;
      case 'download.retry': requiredStore(); downloads!.retryJob(payload.subId); return null;
      case 'download.savePartial': requiredStore(); downloads!.saveAvailable(payload.subId); return null;
      case 'download.concurrency': requiredStore(); if (payload.count !== undefined) downloads!.setConcurrency(Number(payload.count)); return downloads!.concurrency();
      case 'cache.list': { const currentStore = requiredStore(), browserEntries = await browserCacheEntries(); return CACHE_KINDS.map(kind => ({ kind, label: cacheLabel(kind), enabled: currentStore.cache.enabled(kind), bytes: currentStore.cache.bytes(kind), count: currentStore.cache.list(kind).length })).concat([{ kind: 'catalogue', label: '课程目录与权限记录', enabled: currentStore.catalogueCacheEnabled(), bytes: currentStore.extraCaches('catalogue').reduce((n, entry) => n + entry.bytes, 0), count: currentStore.extraCaches('catalogue').length }, { kind: 'runtime', label: '网页与运行临时文件', enabled: currentStore.runtimeCacheEnabled(), bytes: currentStore.extraCaches('runtime').reduce((n, entry) => n + entry.bytes, 0) + browserEntries.reduce((n, entry) => n + entry.bytes, 0), count: currentStore.extraCaches('runtime').length + browserEntries.length }]); }
      case 'cache.detail': { const currentStore = requiredStore(); if (CACHE_KINDS.includes(payload.kind)) return currentStore.cache.list(payload.kind).map(entry => ({ ...entry, bytes: currentStore.cache.bytes(payload.kind, [entry.course.subId]) })); const entries = currentStore.extraCaches(payload.kind).map(({ paths, ...entry }) => entry); if (payload.kind === 'runtime') entries.push(...(await browserCacheEntries()).map(({ path, ...entry }) => ({ ...entry, protected: false }))); return entries; }
      case 'cache.toggle': { const currentStore = requiredStore(); if (payload.kind === 'catalogue') currentStore.setCatalogueCacheEnabled(payload.enabled); else if (payload.kind === 'runtime') currentStore.setRuntimeCacheEnabled(payload.enabled); else if (CACHE_KINDS.includes(payload.kind)) currentStore.cache.setEnabled(payload.kind, payload.enabled); else throw new Error('缓存分类无效'); return null; }
      case 'cache.clear': { const currentStore = requiredStore(); if (payload.kind === 'catalogue') { catalogueEpoch++; api.cancel(); api.usePermissionStorage(undefined); api.usePermissionStorage(currentStore); } if (CACHE_KINDS.includes(payload.kind)) currentStore.cache.clear(payload.kind, payload.subIds || payload.ids || []); else if (['runtime', 'catalogue', 'legacy'].includes(payload.kind)) currentStore.clearExtraCaches(payload.kind, payload.ids || []); else throw new Error('缓存分类无效'); if (payload.kind === 'runtime') await clearBrowserCaches(payload.ids || []); return null; }
      case 'cache.clearAll': catalogueEpoch++; api.cancel(); api.usePermissionStorage(undefined); api.usePermissionStorage(requiredStore()); requiredStore().clearAllCaches(); await clearBrowserCaches(); return null;
      case 'collection.get': requiredStore(); return payload.kind ? collections.entries(payload.kind) : { favorite: collections.entries('favorite'), later: collections.entries('later') };
      case 'collection.toggle': { requiredStore(); if (!['favorite', 'favourite', 'later'].includes(payload.kind)) throw new Error('收藏类型无效'); if (payload.selection) collections.toggleSelection(payload.kind,payload.course,payload.known||payload.courses||[],payload.whole===true); else if (payload.whole) collections.toggleCourse(payload.kind, payload.course, payload.known || payload.courses || []); else collections.toggleLesson(payload.kind, checkedCourse(payload.course)); return collections.entries(payload.kind); }
      case 'collection.clear': requiredStore(); collections.clear(payload.kind); return [];
      case 'progress.get': { const course = checkedCourse(payload.course); return readLearningProgress(requiredStore().readJson('progress-' + key(course.subId) + '.json'), course) || null; }
      case 'progress.set': { const course = checkedCourse(payload.course); const value: LearningProgress = { schema: 1, courseId: course.courseId, subId: course.subId, seconds: Math.max(0, Number(payload.seconds ?? payload.progress?.seconds) || 0), slideId: payload.slideId || payload.progress?.slideId || '', slideSeconds: Math.max(0, Number(payload.slideSeconds ?? payload.progress?.slideSeconds) || 0), video: payload.video === true || payload.progress?.video === true, followVideo: payload.followVideo !== false && payload.progress?.followVideo !== false, savedAt: Date.now() }; requiredStore().saveJson('progress-' + key(course.subId) + '.json', JSON.stringify(value)); return value; }
      case 'smartSkip.start': { const currentStore = requiredStore(), course = checkedCourse(payload.course); smartSkip.update(currentStore, course, groupPages(payload.slides || lesson?.slides || [], payload.lines || lesson?.lines || [], payload.mergeDuplicates !== false), Math.max(0, course.end - course.start), lesson?.live === true, !!lesson?.historyStatus, Number(payload.selected) || 0, (ranges, message) => emit('smartSkip', { ranges, message }), progress => emit('smartSkip', { progress }), payload.lines || lesson?.lines || []); return null; }
      case 'smartSkip.cancel': smartSkip.cancel(); return null;
      default: throw new Error('不支持的操作');
    }
  }
  async function resolveResource(request: Request | string): Promise<Response> {
    const value = typeof request === 'string' ? request : request.url, entry = resource(value); if (!entry || !account) return new Response('资源不可用', { status: 404 });
    const headers = new Headers({ 'Access-Control-Allow-Origin': 'zhiyun://app', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    const requestedRange = typeof request === 'string' ? '' : request.headers.get('range') || '';
    if (entry.local) {
      try {
        const stat = await fsp.stat(entry.local); if (!stat.isFile()) return new Response(null, { status: 404 });
        if (entry.local.endsWith('.m3u8')) {
          const text = await fsp.readFile(entry.local, 'utf8'), base = path.dirname(entry.local);
          const rewritten = text.split(/\r?\n/).map(line => { const replace = (part: string) => { const next = path.resolve(base, part); return localResource(next, 'video'); }; return line.startsWith('#') ? line.replace(/URI="([^"]+)"/g, (_all, part) => 'URI="' + replace(part) + '"') : line.trim() ? replace(line.trim()) : line; }).join('\n'); headers.set('Content-Type', mime(entry.local)); return new Response(rewritten, { headers });
        }
        let start = 0, end = stat.size - 1, partial = false;
        if (requestedRange) { const match = /^bytes=(\d*)-(\d*)$/.exec(requestedRange); if (!match || !stat.size) { headers.set('Content-Range', 'bytes */' + stat.size); return new Response(null, { status: 416, headers }); } if (!match[1]) start = Math.max(0, stat.size - Number(match[2])); else start = Number(match[1]); if (match[2] && match[1]) end = Math.min(end, Number(match[2])); if (start > end || start >= stat.size) { headers.set('Content-Range', 'bytes */' + stat.size); return new Response(null, { status: 416, headers }); } partial = true; }
        let contentType = mime(entry.local); if (contentType === 'application/octet-stream' && entry.kind === 'image') { const file = await fsp.open(entry.local, 'r'); try { const prefix = Buffer.alloc(12); await file.read(prefix, 0, 12, 0); contentType = prefix[0] === 0x89 && prefix[1] === 0x50 ? 'image/png' : prefix[0] === 0xff && prefix[1] === 0xd8 ? 'image/jpeg' : prefix[0] === 0x52 && prefix[8] === 0x57 ? 'image/webp' : prefix[0] === 0x47 && prefix[1] === 0x49 ? 'image/gif' : contentType; } finally { await file.close(); } } headers.set('Content-Type', contentType); headers.set('Accept-Ranges', 'bytes'); headers.set('Content-Length', String(Math.max(0, end - start + 1))); if (partial) headers.set('Content-Range', `bytes ${start}-${end}/${stat.size}`);
        if (typeof request !== 'string' && request.signal.aborted) return new Response(null, { status: 499, headers });
        let body: ReadableStream | null = null; if (!(typeof request !== 'string' && request.method === 'HEAD') && stat.size > 0) { const stream = fs.createReadStream(entry.local, { start, end }); if (typeof request !== 'string') { const cancel = () => stream.destroy(); request.signal.addEventListener('abort', cancel, { once: true }); stream.once('close', () => request.signal.removeEventListener('abort', cancel)); } body = Readable.toWeb(stream) as ReadableStream; }
        return new Response(body, { status: partial ? 206 : 200, headers });
      } catch (_) { return new Response(null, { status: 404, headers }); }
    }
    const remoteHeaders: Record<string, string> = { Referer: 'https://classroom.zju.edu.cn/' }; if (requestedRange) remoteHeaders.Range = requestedRange;
    const response = await credentialledFetch(entry.remote!, { headers: remoteHeaders, signal: typeof request === 'string' ? undefined : request.signal });
    for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges']) { const value = response.headers.get(name); if (value) headers.set(name, value); }
    if (response.ok && (/\.m3u8(?:\?|$)/i.test(entry.remote!) || /mpegurl/i.test(headers.get('content-type') || ''))) {
      const text = await response.text(); if (text.length > 4 * 1024 * 1024 || !text.startsWith('#EXTM3U')) return new Response('视频清单无效', { status: 502, headers });
      const replace = (part: string): string => remoteResource(new URL(part, entry.remote).href, 'video');
      const rewritten = text.split(/\r?\n/).map(line => line.startsWith('#') ? line.replace(/URI="([^"]+)"/g, (_all, part) => 'URI="' + replace(part) + '"') : line.trim() ? replace(line.trim()) : line).join('\n'); headers.delete('content-length'); headers.set('Content-Type', 'application/vnd.apple.mpegurl'); return new Response(rewritten, { headers });
    }
    return new Response(response.body, { status: response.status, headers });
  }
  async function dispose(): Promise<void> { closeLesson(); await disposeImageJobs(); downloads?.pause(); contextLoaders.forEach(loader => loader.cancel()); clients.forEach(client => client.cancel()); api.cancel(); store?.cache.flush(); try { if (account) await SessionStore.saveCurrent(); } catch (_) {} }
  return { handle, resolveResource, dispose };
}
