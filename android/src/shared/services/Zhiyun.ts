import { LocalStore } from './LocalStore';
import { captionSeconds } from '../model/CaptionTime';
import { ClassroomMedia, MediaSource, mediaSources } from '../model/Media';
import { SessionStore } from './SessionStore';
import { http } from '../../desktop/compat';
import { webview } from '../../desktop/compat';
import { PermissionRecord, PermissionStorage, PermissionValue } from '../model/PermissionRecord';
import { Account, Course, Slide, Transcript, imageUrl, plain, shanghaiDate } from '../model/Timeline';

export class AccessDenied extends Error {}
const ORIGIN = 'https://classroom.zju.edu.cn';
const INTERACTIVE = 'https://interactivemeta.cmc.zju.edu.cn';
interface UserRaw { id?: string | number; name?: string; realname?: string; account?: string; tenant_id?: number }
interface UserResponse { params?: UserRaw }
interface ScheduleRaw {
  id?: string | number; sub_id?: string | number; class_id?: string | number; course_id?: string | number; course_title?: string; title?: string;
  term_name?: string; teacher_name?: string; lecturer_name?: string; room_name?: string; status_label?: string; status?: string | number; sub_status?: string | number; start_at?: string | number; end_at?: string | number;
}
interface ScheduleDay { course?: ScheduleRaw[]; courses?: ScheduleRaw[]; list?: ScheduleRaw[] }
interface ScheduleResult { list?: ScheduleDay[]; data?: ScheduleResult }
interface ScheduleResponse { code?: number; result?: ScheduleResult }
interface PptContent { created?: number; pptimgurl?: string; pptthumb?: string; content?: string }
interface PptRaw { id?: string | number; ppt_id?: string | number; content?: string; ppt?: PptContent; created_sec?: number }
interface PptResponse { code?: number; list?: PptRaw[]; total?: number }
interface AsrRaw {
  BeginSec?: number | string; EndSec?: number | string; Text?: string; time?: string | number; zhtext?: string; originzhtext?: string; sourcetext?: string; startTime?: number; endTime?: number; text_begin_time?: number | string; text_end_time?: number | string;
}
interface AsrBlock { trans_type?: string; all_content?: AsrRaw[] | string }
interface AsrResponse { code?: number; msg?: string; list?: AsrBlock[] }
interface SubContent { trans_socket_url?: string }
export interface SubInfo { start_at?: number | string; end_at?: number | string; sub_status?: number | string; content?: SubContent; sub_content?: string; resource_id?: string | number }
interface SubResponse { code?: number; data?: SubInfo }
type Permission = PermissionValue;
interface PermissionResponse { code?: number; data?: Record<string, Permission> }
interface ResourcePpt { timestamp: number; imgurl: string; describe?: string }
interface ResourceResponse { state?: number; data?: ResourcePpt[] }
export interface SearchCourse { courseId: string; title: string; teacher: string; room: string; type: string; term?: string; year?: string }
export interface CourseSearchResult { list: SearchCourse[]; total: number }
interface HistoryRange { start: string; end: string; label?: string }
interface SchoolTerm { begin_date?: string; end_date?: string; term_name?: string; name?: string }
interface SchoolYearsResponse { result?: SchoolYearsResult }
interface SchoolYearsResult { data?: Record<string, Record<string, SchoolTerm>> }
interface HistoryRangeResult { rows: Course[]; error: boolean }
export interface HistoryState { courses: Course[]; cursor: string; emptyWindows: number; complete: boolean }
export interface HistoryResult extends HistoryState { windowsDone: number; failed: boolean }
export type PermissionState = 'allowed' | 'denied' | 'unknown';

export function permissionState(value: boolean | number | string | undefined): PermissionState {
  if (value === true || value === 1 || value === '1') return 'allowed';
  if (value === false || value === 0 || value === '0') return 'denied';
  return 'unknown';
}
export function courseIsLive(course: Course, now: number = Date.now() / 1000): boolean { const status = Number(course.status); return status === 1 || status === 2 || (!status && now < course.end); }
export function permissionForCourse(course: Course, permission: Permission, now: number): PermissionState { return permissionState(courseIsLive(course, now) ? permission.live : permission.video); }
export function aggregatePermissions(values: string[]): PermissionState {
  if (values.some((v: string) => v === 'allowed')) return 'allowed';
  if (values.length && values.every((v: string) => v === 'denied')) return 'denied';
  return 'unknown';
}
interface PlazaRaw extends ClassroomMedia {
  term?: string | number; term_name?: string; type?: string; room?: string;
  id?: string | number; course_id?: string | number; sub_id?: string | number;
  title?: string; course_title?: string; sub_title?: string; realname?: string; lecturer_name?: string;
  room_name?: string; sub_status?: string | number; status?: string | number;
  course_begin?: string | number; course_over?: string | number; start_at?: string | number; end_at?: string | number;
  c_type?: string; list?: PlazaRaw[]; children?: PlazaRaw[];
}
interface PlazaResponse { code?: number; list?: PlazaRaw[]; total?: number }
interface SearchPayload { list?: PlazaRaw[]; total?: number }
interface SearchResponse { code?: number; total?: SearchPayload }
interface CatalogueResult { data?: PlazaRaw[] }
interface CatalogueResponse { code?: number; result?: CatalogueResult }

export class Zhiyun {
  private pending: Set<http.HttpRequest> = new Set();
  private permissionCache: Map<string, PermissionRecord> = new Map();
  private permissionStorage: PermissionStorage | undefined = undefined;
  private permissionInflight: Map<string, Promise<PermissionResponse>> = new Map();
  private permissionActive: number = 0;
  private permissionWaiters: Array<() => void> = [];
  private stopped: number = 0;
  private historyTerms: HistoryRange[] | undefined = undefined;
  usePermissionStorage(storage: PermissionStorage | undefined): void {
    if (storage !== this.permissionStorage) this.permissionCache.clear();
    this.permissionStorage = storage;
  }
  cancel(): void { this.stopped++; this.pending.forEach((r: http.HttpRequest) => r.destroy()); this.pending.clear(); }
  private cachedPermission(course: Course): PermissionRecord | undefined {
    return this.permissionStorage?.permissionRecord(course.courseId, course.subId) || this.permissionCache.get(course.courseId + ':' + course.subId);
  }
  cachedPermissions(courses: Course[]): Record<string, string> {
    const states: Record<string, string> = {};
    courses.forEach((c: Course) => {
      const record = this.cachedPermission(c);
      states[c.subId] = record ? permissionForCourse(c, record.permission, Date.now() / 1000) : 'unknown';
    });
    return states;
  }
  private remember(group: Course[], data: PermissionResponse): void {
    if (data.code !== 200) return;
    const records: PermissionRecord[] = [];
    group.forEach((course: Course) => {
      const value = data.data?.[course.subId];
      if (!value || (permissionState(value.live) === 'unknown' && permissionState(value.video) === 'unknown')) return;
      const record: PermissionRecord = { courseId: course.courseId, subId: course.subId, permission: value, checkedAt: Date.now() / 1000 };
      this.permissionCache.set(course.courseId + ':' + course.subId, record); records.push(record);
    });
    if (records.length) { try { this.permissionStorage?.savePermissions(records); } catch (_) {} }
  }
  private async permissionRequest(group: Course[], gen: number): Promise<PermissionResponse> {
    const key = gen + ':' + group[0].courseId + ':' + group.map((c: Course) => c.subId).sort().join(',');
    const existing = this.permissionInflight.get(key);
    if (existing) return existing;
    const task = this.fetchPermissions(group, gen);
    this.permissionInflight.set(key, task);
    try { return await task; } finally { this.permissionInflight.delete(key); }
  }
  private async fetchPermissions(group: Course[], gen: number): Promise<PermissionResponse> {
    if (this.permissionActive >= 2) await new Promise<void>((resolve) => this.permissionWaiters.push(resolve));
    else this.permissionActive++;
    try {
      if (gen !== this.stopped) throw new Error('已取消');
      const payload = JSON.stringify({ course_id: group[0].courseId, sub_ids: group.map((c: Course) => c.subId) });
      return JSON.parse(await this.request('/courseapi/v2/course/video-and-live-promission-by-user-id', payload)) as PermissionResponse;
    } finally {
      const next = this.permissionWaiters.shift();
      if (next) next(); else this.permissionActive--;
    }
  }
  async permissions(courses: Course[], progress: (states: Record<string, string>, confirmed?: string[]) => void = () => {}, force: boolean = false): Promise<Record<string, string>> {
    const gen = this.stopped, now = Date.now() / 1000;
    const states = this.cachedPermissions(courses);
    const groups = new Map<string, Course[]>();
    courses.forEach((course: Course) => {
      const cache = this.cachedPermission(course);
      if (!force && cache && now - cache.checkedAt < (states[course.subId] === 'denied' ? 15 : 60) && states[course.subId] !== 'unknown') return;
      const group = groups.get(course.courseId) || [];
      if (!group.some((c: Course) => c.subId === course.subId)) group.push(course);
      groups.set(course.courseId, group);
    });
    const confirmed: string[] = [];
    progress(states, confirmed.slice());
    const batches: Course[][] = [];
    Array.from(groups.values()).forEach((group: Course[]) => {
      for (let i = 0; i < group.length; i += 100) batches.push(group.slice(i, i + 100));
    });
    const priority = (group: Course[]): number => Math.min(...group.map((course: Course) => states[course.subId] === 'allowed' ? 0 : states[course.subId] === 'unknown' ? 1 : 2));
    batches.sort((a: Course[], b: Course[]) => priority(a) - priority(b));
    console.info(`[ZhiyunPermissions] lessons=${courses.length} requests=${batches.length} refresh=${force}`);
    let cursor = 0, failures = 0;
    const worker = async (): Promise<void> => {
      while (cursor < batches.length && gen === this.stopped && failures < 3) {
        const group = batches[cursor++];
        try {
          const data = await this.permissionRequest(group, gen);
          if (gen !== this.stopped) return;
          failures = data.code === 200 ? 0 : failures + 1;
          this.remember(group, data);
          group.forEach((c: Course) => {
            const value = data.code === 200 ? data.data?.[c.subId] : undefined;
            if (value) { states[c.subId] = permissionForCourse(c, value, now); if (states[c.subId] !== 'unknown') confirmed.push(c.subId); }
          });
        } catch (_) { failures++; }
        if (gen !== this.stopped) return;
        progress(states, confirmed.slice());
      }
    };
    await Promise.all([worker(), worker()]);
    return states;
  }
  private async request(path: string, post: string = '', origin: string = ORIGIN): Promise<string> {
    const gen = this.stopped;
    const req = http.createHttp();
    this.pending.add(req);
    const cookie = SessionStore.cookie(ORIGIN);
    const raw = decodeURIComponent((/(?:^|;\s*)_token=([^;]*)/.exec(cookie) || [])[1] || '');
    const token = (/{i:\d+;s:\d+:"_token";i:\d+;s:\d+:"(.+?)";}/.exec(raw) || [])[1] || '';
    const headers: Record<string, string> = { 'Cookie': origin === ORIGIN ? cookie : SessionStore.cookie(origin), 'Accept': 'application/json', 'Referer': ORIGIN + '/', 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    try {
      const response = await req.request(origin + path, {
        method: post ? http.RequestMethod.POST : http.RequestMethod.GET,
        header: headers, extraData: post, expectDataType: http.HttpDataType.STRING,
        connectTimeout: 8000, readTimeout: 12000, usingCache: false, maxLimit: 12 * 1024 * 1024
      });
      if (gen !== this.stopped) throw new Error('已取消');
      if (response.responseCode === 403) throw new AccessDenied('当前账号没有这节课的访问权限');
      if (response.responseCode === 401) {
        // A room-specific or interactive-ASR credential may fail while the main account is still valid.
        if (origin === ORIGIN && path === '/userapi/v1/infosimple') await SessionStore.clear();
        throw new Error('登录失效，请重新登录');
      }
      if (response.responseCode !== 200) throw new Error(`智云暂时无法访问（${response.responseCode}）`);
      const result = response.result as string;
      if (!result.trim().startsWith('{')) throw new Error('智云返回了登录页面，请重新登录');
      return result;
    } finally { req.destroy(); this.pending.delete(req); }
  }
  async account(): Promise<Account> {
    const data = JSON.parse(await this.request('/userapi/v1/infosimple')) as UserResponse;
    if (!data.params?.id) throw new Error('请先登录浙江大学统一身份认证');
    return { id: String(data.params.id), name: data.params.realname || data.params.name || '同学', tenantId: data.params.tenant_id || 112, username: data.params.account || '' };
  }
  async plaza(account: Account, date: string, live: boolean): Promise<Course[]> {
    const path = `/courseapi/v2/course-live/search-live-course-list?need_time_quantum=1&unique_course=1&with_sub_duration=1&with_sub_data=1&tenant=${account.tenantId}&search_time=${encodeURIComponent(date)}&sub_live_status=${live ? '1' : ''}&sub_public=&course_student_type=`;
    const data = JSON.parse(await this.request(path)) as PlazaResponse;
    if (data.code !== 0) throw new Error('课程广场暂时无法读取');
    const result: Course[] = [];
    (data.list || []).forEach((group: PlazaRaw) => {
      (group.list || [group]).forEach((r: PlazaRaw) => {
        const item = this.plazaCourse(r, String(r.course_id || r.id || ''), false);
        if (item) result.push(item);
      });
    });
    return result.sort((a: Course, b: Course) => a.start - b.start);
  }
  async searchCourses(account: Account, title: string, teacher: string, page: number): Promise<CourseSearchResult> {
    const path = `/pptnote/v1/searchlist?tenant_id=${account.tenantId}&user_id=${encodeURIComponent(account.id)}&user_name=${encodeURIComponent(account.username || '')}&title=${encodeURIComponent(title.trim())}&realname=${encodeURIComponent(teacher.trim())}&trans=&page=${page}&per_page=20`;
    const data = JSON.parse(await this.request(path)) as SearchResponse;
    if (data.code !== 0) throw new Error('课程搜索暂时不可用');
    const result: SearchCourse[] = [];
    (data.total?.list || []).forEach((r: PlazaRaw) => {
      const id = r.course_id || r.id;
      if (id && r.c_type !== 'recommend') result.push({ courseId: String(id), title: plain(r.title || r.course_title || '未命名课程'), teacher: r.realname || r.lecturer_name || '', room: r.room_name || '', type: r.c_type || '', term: this.termLabel(r.term_name || ''), year: /\d{4}[-—]\d{4}/.exec(r.term_name || '')?.[0] || '' });
    });
    return { list: result, total: Number(data.total?.total || 0) };
  }
  async chapters(hit: SearchCourse, hydrateDetails: boolean = true): Promise<Course[]> {
    const data = JSON.parse(await this.request(`/courseapi/v2/course/catalogue?course_id=${encodeURIComponent(hit.courseId)}`)) as CatalogueResponse;
    if (!data.result?.data) throw new Error('暂时无法读取这门课的课次');
    const result: Course[] = [];
    const visit = (rows: PlazaRaw[]): void => {
      rows.forEach((r: PlazaRaw) => {
        if (r.children?.length) visit(r.children);
        else if (r.list?.length) visit(r.list);
        else {
          const item = this.plazaCourse(r, hit.courseId, true);
          if (item) { item.title = hit.title; item.term = item.term || hit.term; item.teacher = item.teacher || hit.teacher; item.room = item.room || hit.room; result.push(item); }
        }
      });
    };
    visit(data.result.data);
    if (!hydrateDetails) return result.filter((item: Course) => item.start > 0).sort((a: Course, b: Course) => b.start - a.start);
    const gen = this.stopped;
    if (result.some((item: Course) => item.end <= item.start)) {
      try {
        const metadata = JSON.parse(await this.request('/courseapi/v2/course-live/search-live-course-list?all=1&course_id=' + encodeURIComponent(hit.courseId) + '&with_sub_data=1&show_all=1')) as PlazaResponse;
        const apply = (rows: PlazaRaw[]): void => rows.forEach((row: PlazaRaw) => { if (row.list?.length) apply(row.list); else { const item = result.find((course: Course) => course.subId === String(row.sub_id || row.id)); if (!item) return; const end = this.epochSeconds(row.course_over || row.end_at); if (end > item.start) item.end = end; if (row.sub_status !== undefined || row.status !== undefined) item.status = String(row.sub_status ?? row.status); } });
        if (metadata.code === 0) apply(metadata.list || []);
      } catch (err) { if (err instanceof AccessDenied) throw err; }
    }
    let cursor = 0;
    const hydrate = async (): Promise<void> => { while (cursor < result.length && gen === this.stopped) { const item = result[cursor++]; if (item.end > item.start) continue; try { const info = await this.info(item); if (gen !== this.stopped) return; item.start = this.epochSeconds(info.start_at) || item.start; item.end = this.epochSeconds(info.end_at); if (info.sub_status !== undefined) item.status = String(info.sub_status); } catch (_) {} } };
    await Promise.all([hydrate(), hydrate()]);
    if (gen !== this.stopped) throw new Error('已取消');
    return result.filter((item: Course) => item.end > item.start).sort((a: Course, b: Course) => b.start - a.start);
  }
  private termLabel(value: string): string { return value.replace(/spring/gi, '春').replace(/summer/gi, '夏').replace(/autumn|fall/gi, '秋').replace(/winter/gi, '冬').split(/[,，]/).map((part: string): string => { const match = /^(\d{4})-(\d{4})([1-4]|春|夏|秋|冬)$/.exec(part.trim()); return match ? match[1] + '—' + match[2] + '学年 · ' + (/^[1-4]$/.test(match[3]) ? '第' + match[3] + '学期' : match[3] + '季学期') : part.trim(); }).join('，'); }
  private plazaCourse(r: PlazaRaw, courseId: string, catalogue: boolean): Course | undefined {
    const subId = r.sub_id || (catalogue ? r.id : undefined);
    const start = this.epochSeconds(r.course_begin || r.start_at), end = this.epochSeconds(r.course_over || r.end_at);
    if (!subId || !courseId || !Number.isFinite(start) || !Number.isFinite(end) || (end <= start && !catalogue)) return undefined;
    return { courseId, subId: String(subId), title: plain(r.course_title || r.title || r.sub_title || '未命名课程'),
      teacher: r.realname || r.lecturer_name || '', room: r.room_name || (/^\d+$/.test(r.room || '') ? '' : r.room || ''), term: this.termLabel(r.term_name || ''), start, end, status: String(r.sub_status || r.status || '') };
  }
  async coursesBetween(account: Account, start: string, end: string): Promise<Course[]> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || new Date(start).toISOString().slice(0, 10) !== start || new Date(end).toISOString().slice(0, 10) !== end || end < start || Date.parse(end) - Date.parse(start) > 366 * 86400000) throw new Error('请选择一年内的有效课表日期');
    const ranges: HistoryRange[] = [];
    for (let cursor = start; cursor <= end; cursor = this.offsetDate(cursor, 7)) { const last = this.offsetDate(cursor, 6); ranges.push({ start: cursor, end: last > end ? end : last }); }
    const unique = new Map<string, Course>(); let cursor = 0;
    const worker = async (): Promise<void> => { while (cursor < ranges.length) { const range = ranges[cursor++]; const rows = await this.schedules(account, range.start, range.end); rows.forEach(course => unique.set(course.subId, course)); } };
    await Promise.all([worker(), worker()]); return Array.from(unique.values()).sort((a, b) => a.start - b.start);
  }
  async courses(account: Account): Promise<Course[]> {
    const now = Date.now() / 1000;
    const start = shanghaiDate(now - 14 * 86400), end = shanghaiDate(now + 86400);
    const ranges: HistoryRange[] = [];
    for (let cursor = start; cursor <= end; cursor = this.offsetDate(cursor, 7)) {
      const last = this.offsetDate(cursor, 6); ranges.push({ start: cursor, end: last > end ? end : last });
    }
    const weeks = await Promise.all(ranges.map((range: HistoryRange) => this.schedules(account, range.start, range.end)));
    const unique = new Map<string, Course>(); weeks.forEach((rows: Course[]) => rows.forEach((item: Course) => unique.set(item.subId, item)));
    return Array.from(unique.values()).sort((a: Course, b: Course) => a.start - b.start);
  }
  async refreshToday(courses: Course[]): Promise<void> {
    const now = Date.now() / 1000, today = shanghaiDate(now);
    await Promise.all(courses.filter((course: Course) => shanghaiDate(course.start) === today && course.start - now <= 1800 && course.end >= now - 600).map(async (course: Course) => { try { const info = await this.info(course); if (info.sub_status !== undefined) course.status = String(info.sub_status); } catch (_) {} }));
  }
  private async schedules(account: Account, start: string, end: string): Promise<Course[]> {
    const path = `/courseapi/v2/schedule/get-week-schedules?user_id=${encodeURIComponent(account.id)}&tenant_id=${account.tenantId}&start_at=${start}&end_at=${end}`;
    const data = JSON.parse(await this.request(path)) as ScheduleResponse;
    if (data.code !== 0 && !data.result) throw new Error('课表同步失败，请稍后重试');
    const result: Course[] = [];
    const days = data.result?.list || data.result?.data?.list || [];
    days.forEach((day: ScheduleDay) => {
      (day.course || day.courses || day.list || []).forEach((c: ScheduleRaw) => {
        const startTime = this.epochSeconds(c.start_at), endTime = this.epochSeconds(c.end_at);
        const subId = c.sub_id || c.class_id || c.id;
        if (subId && c.course_id && startTime > 0 && endTime > startTime) {
          result.push({ subId: String(subId), courseId: String(c.course_id), title: c.course_title || c.title || '未命名课程',
            term: this.termLabel(c.term_name || ''), teacher: c.teacher_name || c.lecturer_name || '', room: c.room_name || '', status: String(c.status || c.sub_status || c.status_label || ''), start: startTime, end: endTime });
        }
      });
    });
    return result.sort((a: Course, b: Course) => a.start - b.start);
  }
  private epochSeconds(value: string | number | undefined): number {
    if (value === undefined || value === '') return 0;
    const number = Number(value);
    if (Number.isFinite(number)) return number > 1000000000000 ? Math.floor(number / 1000) : number;
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
  }
  private offsetDate(date: string, days: number): string {
    const value = Date.parse(date + 'T00:00:00+08:00') + days * 86400000;
    return shanghaiDate(value / 1000);
  }
  private async schoolTerms(account: Account): Promise<HistoryRange[]> {
    if (this.historyTerms) return this.historyTerms;
    const response = JSON.parse(await this.request(`/courseapi/index.php/v2/course/get-term-years?tenant=${account.tenantId}`)) as SchoolYearsResponse;
    const years = response.result?.data;
    if (!years) throw new Error('校历暂时无法读取');
    const terms: HistoryRange[] = [];
    Object.keys(years).forEach((year: string) => {
      Object.keys(years[year]).forEach((id: string) => {
        const term = years[year][id], start = String(term.begin_date || '').slice(0, 10), end = String(term.end_date || '').slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(start) && end >= start) terms.push({ start, end, label: this.termLabel(/\d{4}/.test(term.term_name || term.name || '') ? term.term_name || term.name || '' : year + (term.term_name || term.name || id)) });
      });
    });
    if (!terms.length) throw new Error('校历暂时没有可用日期');
    this.historyTerms = terms.sort((a: HistoryRange, b: HistoryRange) => b.end.localeCompare(a.end));
    return this.historyTerms;
  }
  async annotateTerms(account: Account, courses: Course[], store?: LocalStore): Promise<void> {
    let terms: HistoryRange[] = []; try { terms = JSON.parse(store?.readJson('school-terms.json') || '[]') as HistoryRange[]; } catch (_) {}
    const assign = (): void => { courses.forEach((course: Course) => { if (course.term && !/[，,]/.test(course.term)) return; const date = shanghaiDate(course.start), term = terms.find((range: HistoryRange) => range.start <= date && date <= range.end); if (term?.label) course.term = term.label; }); };
    assign(); if (courses.every((course: Course) => !!course.term && !/[，,]/.test(course.term))) return;
    terms = await this.schoolTerms(account); try { store?.saveJson('school-terms.json', JSON.stringify(terms)); } catch (_) {} assign();
  }
  async attendanceHistory(account: Account, progress: (done: number, total: number, state?: HistoryState) => void = () => {}, initial?: HistoryState): Promise<HistoryResult> {
    let cursor = initial?.cursor || shanghaiDate(Date.now() / 1000);
    const unique = new Map<string, Course>();
    (initial?.courses || []).forEach((item: Course) => unique.set(item.subId, item));
    let windowsDone = 0, failed = false, complete = initial?.complete === true;
    const limit = 24, now = Date.now() / 1000;
    if (complete) return { courses: Array.from(unique.values()).sort((a: Course, b: Course) => b.start - a.start), cursor, emptyWindows: 0, complete, windowsDone, failed };
    let terms: HistoryRange[];
    try { terms = await this.schoolTerms(account); }
    catch (_) { return { courses: Array.from(unique.values()).sort((a: Course, b: Course) => b.start - a.start), cursor, emptyWindows: 0, complete: false, windowsDone, failed: true }; }
    while (windowsDone < limit) {
      const ranges: HistoryRange[] = [];
      let end = cursor;
      for (let i = 0; i < 3 && windowsDone + i < limit; i++) {
        const term = terms.find((item: HistoryRange) => item.start <= end);
        if (!term) break;
        if (end > term.end) end = term.end;
        const start = this.offsetDate(end, -6);
        ranges.push({ start: start < term.start ? term.start : start, end });
        end = this.offsetDate(ranges[ranges.length - 1].start, -1);
      }
      if (!ranges.length) { complete = true; break; }
      const results = await Promise.all(ranges.map(async (range: HistoryRange): Promise<HistoryRangeResult> => {
        try { return { rows: await this.schedules(account, range.start, range.end), error: false }; }
        catch (_) { return { rows: [], error: true }; }
      }));
      for (let i = 0; i < ranges.length; i++) {
        if (results[i].error) { failed = true; break; }
        windowsDone++;
        results[i].rows.filter((item: Course) => item.end < now).forEach((item: Course) => { if (!item.term) item.term = terms.find((term: HistoryRange) => term.start <= shanghaiDate(item.start) && shanghaiDate(item.start) <= term.end)?.label || ''; unique.set(item.subId, item); });
        cursor = this.offsetDate(ranges[i].start, -1);
        complete = !terms.some((term: HistoryRange) => term.start <= cursor);
        const state: HistoryState = { courses: Array.from(unique.values()).sort((a: Course, b: Course) => b.start - a.start), cursor, emptyWindows: 0, complete };
        progress(windowsDone, limit, state);
      }
      if (failed || complete) break;
    }
    return { courses: Array.from(unique.values()).sort((a: Course, b: Course) => b.start - a.start), cursor, emptyWindows: 0, complete, windowsDone, failed };
  }
  async info(course: Course): Promise<SubInfo> {
    const data = JSON.parse(await this.request(`/courseapi/v3/portal-home-setting/get-sub-info?course_id=${encodeURIComponent(course.courseId)}&sub_id=${encodeURIComponent(course.subId)}`)) as SubResponse;
    if (data.code !== 0 || !data.data) throw new Error('这节课的信息暂时无法读取');
    if (!data.data.content && data.data.sub_content) { try { data.data.content = JSON.parse(data.data.sub_content) as SubContent; } catch (_) {} }
    return data.data;
  }
  async liveCaptionAddress(course: Course, info: SubInfo): Promise<string> {
    if (info.content?.trans_socket_url) return info.content.trans_socket_url;
    const query = `all=1&course_id=${encodeURIComponent(course.courseId)}&sub_id=${encodeURIComponent(course.subId)}&with_sub_data=1&show_all=1`;
    const data = JSON.parse(await this.request('/courseapi/v2/course-live/search-live-course-list?' + query)) as PlazaResponse;
    if (data.code !== 0) return '';
    const item = data.list?.find((row: PlazaRaw) => String(row.sub_id || row.id) === course.subId) || data.list?.[0];
    if (item?.content?.trans_socket_url) return item.content.trans_socket_url;
    try { return (JSON.parse(item?.sub_content || '{}') as SubContent).trans_socket_url || ''; } catch (_) { return ''; }
  }
  async checkPermission(course: Course, live: boolean): Promise<void> {
    const gen = this.stopped;
    const payload = JSON.stringify({ course_id: course.courseId, sub_ids: [course.subId] });
    const data = JSON.parse(await this.request('/courseapi/v2/course/video-and-live-promission-by-user-id', payload)) as PermissionResponse;
    if (gen !== this.stopped) throw new Error('已取消');
    this.remember([course], data);
    const permission = data.data?.[course.subId];
    const allowed = live ? permission?.live : permission?.video;
    if (data.code !== 200 || permissionState(allowed) === 'unknown') throw new Error('课程权限暂时未能确认，请稍后重试');
    if (permissionState(allowed) === 'denied') throw new AccessDenied('当前账号没有这节课的访问权限');
  }
  async checkCurrentPermission(course: Course): Promise<void> {
    const info = await this.info(course);
    if (info.sub_status !== undefined) course.status = String(info.sub_status);
    await this.checkPermission(course, courseIsLive(course));
  }
  async videos(course: Course): Promise<MediaSource[]> {
    await this.checkCurrentPermission(course);
    const query = `all=1&course_id=${encodeURIComponent(course.courseId)}&sub_id=${encodeURIComponent(course.subId)}&with_sub_data=1&with_room_data=1&show_all=1`;
    const data = JSON.parse(await this.request('/courseapi/v2/course-live/search-live-course-list?' + query)) as PlazaResponse;
    if (data.code !== 0) throw new Error('视频信息读取失败');
    const row = data.list?.find((r: PlazaRaw) => String(r.sub_id || r.id) === course.subId) || (data.list?.length === 1 && !data.list[0].sub_id ? data.list[0] : undefined);
    if (!row) throw new Error('平台暂未提供这节课的视频');
    return mediaSources(row);
  }
  private slideOrigins: Map<string, string> = new Map();
  async slides(course: Course): Promise<Slide[]> {
    // Both are official classroom backends. A denied response is final, never a fallback trigger.
    const known = this.slideOrigins.get(course.subId);
    if (known) return this.slidesFrom(course, known);
    let primary: Slide[] = [];
    let primaryError: Error | undefined = undefined;
    try { primary = await this.slidesFrom(course, ORIGIN); }
    catch (err) { if (err instanceof AccessDenied) throw err; primaryError = err as Error; }
    if (primary.length) { this.slideOrigins.set(course.subId, ORIGIN); return primary; }
    try {
      const secondary = await this.slidesFrom(course, INTERACTIVE);
      if (secondary.length) this.slideOrigins.set(course.subId, INTERACTIVE);
      return secondary;
    } catch (err) { if (err instanceof AccessDenied) throw err; if (primaryError) throw primaryError; return primary; }
  }
  private async slidesFrom(course: Course, origin: string): Promise<Slide[]> {
    const all: Slide[] = [];
    // Fetch every page so joining midway recovers server-side earlier slides.
    let page = 1, received = 0;
    while (page <= 200) {
      const prefix = origin === INTERACTIVE ? '/pptnoteapi' : '/pptnote';
      const path = `${prefix}/v1/schedule/search-ppt?course_id=${encodeURIComponent(course.courseId)}&sub_id=${encodeURIComponent(course.subId)}&page=${page}&per_page=100`;
      const data = JSON.parse(await this.request(path, '', origin)) as PptResponse;
      if (data.code !== 0) throw new Error('课件列表同步失败');
      const list = data.list || [];
      list.forEach((p: PptRaw) => {
        try {
          const content = p.content ? JSON.parse(p.content) as PptContent : p.ppt || {} as PptContent;
          const url = imageUrl(content.pptimgurl || '');
          const created = Number(content.created || 0);
          const absolute = created >= 1e9 ? captionSeconds(created, course.start) : Number.NaN;
          const t = Number.isFinite(absolute) ? Math.max(0, absolute) : Number(p.created_sec);
          if (url && Number.isFinite(t) && t >= 0) all.push({ id: String(p.id || p.ppt_id || `${t}:${url}`), t, url, thumb: imageUrl(content.pptthumb || '') || url, note: plain(content.content || '') });
        } catch (_) { /* Ignore a malformed record without losing the other pages. */ }
      });
      received += list.length;
      if (!list.length || received >= Number(data.total || received)) return all;
      page++;
    }
    throw new Error('课件超过 20000 页，暂时无法完整同步');
  }
  async resourceSlides(resourceId: string): Promise<Slide[]> {
    const data = JSON.parse(await this.request(`/spidermaterial/spider-material/web/aitask/async/getPPTData?id=${encodeURIComponent(resourceId)}`)) as ResourceResponse;
    if (data.state !== 200) return [];
    return (data.data || []).filter((p: ResourcePpt) => !!imageUrl(p.imgurl)).map((p: ResourcePpt): Slide => {
      return { id: `resource:${p.timestamp}:${p.imgurl}`, t: Math.floor(p.timestamp / 1000), url: imageUrl(p.imgurl), thumb: imageUrl(p.imgurl), note: plain(p.describe || '') };
    });
  }
  private transcriptOrigins: Map<string, string> = new Map();
  async transcripts(course: Course): Promise<Transcript[]> {
    const known = this.transcriptOrigins.get(course.subId);
    if (known) return this.transcriptsFrom(course, known);
    const origin = this.slideOrigins.get(course.subId) === INTERACTIVE ? INTERACTIVE : ORIGIN;
    let primary: Transcript[] = [], failure: Error | undefined = undefined;
    try { primary = await this.transcriptsFrom(course, origin); } catch (err) { if (err instanceof AccessDenied) throw err; failure = err as Error; }
    if (primary.length) { this.transcriptOrigins.set(course.subId, origin); return primary; }
    const alternate = origin === INTERACTIVE ? ORIGIN : INTERACTIVE;
    try { const rows = await this.transcriptsFrom(course, alternate); if (rows.length) this.transcriptOrigins.set(course.subId, alternate); return rows; }
    catch (err) { if (err instanceof AccessDenied) throw err; if (failure) throw failure; return primary; }
  }
  private async transcriptsFrom(course: Course, origin: string): Promise<Transcript[]> {
    const data = JSON.parse(await this.request(`/courseapi/v3/web-socket/search-trans-result?sub_id=${encodeURIComponent(course.subId)}&format=json`, '', origin)) as AsrResponse;
    if (data.code === 10002 && (data.msg || '').includes('未查询到语音数据')) return [];
    if (data.code !== 0) throw new Error('转写同步失败，平台可能尚未提供该课程转写');
    const result: Transcript[] = [];
    (data.list || []).forEach((block: AsrBlock) => {
      let rows: AsrRaw[] = [];
      try { rows = typeof block.all_content === 'string' ? JSON.parse(block.all_content) as AsrRaw[] : block.all_content || []; } catch (_) { return; }
      if (!Array.isArray(rows)) return;
      rows.forEach((r: AsrRaw, i: number) => {
        let t = captionSeconds(r.BeginSec ?? r.text_begin_time ?? r.startTime, course.start), end = captionSeconds(r.EndSec ?? r.text_end_time ?? r.endTime, course.start);
        let content = r.Text || r.originzhtext || r.zhtext || r.sourcetext || '';
        if (!Number.isFinite(t) && r.time !== undefined) {
          t = captionSeconds(r.time, course.start);
          const nextTime = rows[i + 1]?.time;
          end = nextTime !== undefined ? captionSeconds(nextTime, course.start) : t;
          content = r.originzhtext || r.zhtext || r.Text || r.sourcetext || '';
        }
        const text = plain(content);
        if (Number.isFinite(t) && t >= 0 && text) result.push({ id: `asr:${t}`, t, end: Number.isFinite(end) ? Math.max(t, end) : t, text, timing: 'history' });
      });
    });
    return result;
  }
}
