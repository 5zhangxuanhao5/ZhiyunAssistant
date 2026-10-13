// Generated from shared HarmonyOS sources by sync-harmony-models.cjs.
import { captionSeconds } from './CaptionTime.js';
import { mediaSources } from './Media.js';
import { imageUrl, plain, shanghaiDate } from './Timeline.js';
export class AccessDenied extends Error {
}
const ORIGIN = 'https://classroom.zju.edu.cn';
const INTERACTIVE = 'https://interactivemeta.cmc.zju.edu.cn';
export function permissionState(value) {
    if (value === true || value === 1 || value === '1')
        return 'allowed';
    if (value === false || value === 0 || value === '0')
        return 'denied';
    return 'unknown';
}
export function courseIsLive(course, now = Date.now() / 1000) { const status = Number(course.status); return status === 1 || status === 2 || (!status && now < course.end); }
export function permissionForCourse(course, permission, now) { return permissionState(courseIsLive(course, now) ? permission.live : permission.video); }
export function aggregatePermissions(values) {
    if (values.some((v) => v === 'allowed'))
        return 'allowed';
    if (values.length && values.every((v) => v === 'denied'))
        return 'denied';
    return 'unknown';
}
export class Zhiyun {
    constructor() {
        this.pending = new Set();
        this.permissionCache = new Map();
        this.permissionStorage = undefined;
        this.permissionInflight = new Map();
        this.permissionActive = 0;
        this.permissionWaiters = [];
        this.stopped = 0;
        this.historyTerms = undefined;
        this.slideOrigins = new Map();
        this.transcriptOrigins = new Map();
    }
    usePermissionStorage(storage) {
        if (storage !== this.permissionStorage)
            this.permissionCache.clear();
        this.permissionStorage = storage;
    }
    cancel() { this.stopped++; this.pending.forEach((r) => r.destroy()); this.pending.clear(); }
    cachedPermission(course) {
        return this.permissionStorage?.permissionRecord(course.courseId, course.subId) || this.permissionCache.get(course.courseId + ':' + course.subId);
    }
    cachedPermissions(courses) {
        const states = {};
        courses.forEach((c) => {
            const record = this.cachedPermission(c);
            states[c.subId] = record ? permissionForCourse(c, record.permission, Date.now() / 1000) : 'unknown';
        });
        return states;
    }
    remember(group, data) {
        if (data.code !== 200)
            return;
        const records = [];
        group.forEach((course) => {
            const value = data.data?.[course.subId];
            if (!value || (permissionState(value.live) === 'unknown' && permissionState(value.video) === 'unknown'))
                return;
            const record = { courseId: course.courseId, subId: course.subId, permission: value, checkedAt: Date.now() / 1000 };
            this.permissionCache.set(course.courseId + ':' + course.subId, record);
            records.push(record);
        });
        if (records.length) {
            try {
                this.permissionStorage?.savePermissions(records);
            }
            catch (_) { }
        }
    }
    async permissionRequest(group, gen) {
        const key = gen + ':' + group[0].courseId + ':' + group.map((c) => c.subId).sort().join(',');
        const existing = this.permissionInflight.get(key);
        if (existing)
            return existing;
        const task = this.fetchPermissions(group, gen);
        this.permissionInflight.set(key, task);
        try {
            return await task;
        }
        finally {
            this.permissionInflight.delete(key);
        }
    }
    async fetchPermissions(group, gen) {
        if (this.permissionActive >= 2)
            await new Promise((resolve) => this.permissionWaiters.push(resolve));
        else
            this.permissionActive++;
        try {
            if (gen !== this.stopped)
                throw new Error('已取消');
            const payload = JSON.stringify({ course_id: group[0].courseId, sub_ids: group.map((c) => c.subId) });
            return JSON.parse(await this.request('/courseapi/v2/course/video-and-live-promission-by-user-id', payload));
        }
        finally {
            const next = this.permissionWaiters.shift();
            if (next)
                next();
            else
                this.permissionActive--;
        }
    }
    async permissions(courses, progress = () => { }, force = false) {
        const gen = this.stopped, now = Date.now() / 1000;
        const states = this.cachedPermissions(courses);
        const groups = new Map();
        courses.forEach((course) => {
            const cache = this.cachedPermission(course);
            if (!force && cache && now - cache.checkedAt < (states[course.subId] === 'denied' ? 15 : 60) && states[course.subId] !== 'unknown')
                return;
            const group = groups.get(course.courseId) || [];
            if (!group.some((c) => c.subId === course.subId))
                group.push(course);
            groups.set(course.courseId, group);
        });
        const confirmed = [];
        progress(states, confirmed.slice());
        const batches = [];
        Array.from(groups.values()).forEach((group) => {
            for (let i = 0; i < group.length; i += 100)
                batches.push(group.slice(i, i + 100));
        });
        const priority = (group) => Math.min(...group.map((course) => states[course.subId] === 'allowed' ? 0 : states[course.subId] === 'unknown' ? 1 : 2));
        batches.sort((a, b) => priority(a) - priority(b));
        console.info(`[ZhiyunPermissions] lessons=${courses.length} requests=${batches.length} refresh=${force}`);
        let cursor = 0, failures = 0;
        const worker = async () => {
            while (cursor < batches.length && gen === this.stopped && failures < 3) {
                const group = batches[cursor++];
                try {
                    const data = await this.permissionRequest(group, gen);
                    if (gen !== this.stopped)
                        return;
                    failures = data.code === 200 ? 0 : failures + 1;
                    this.remember(group, data);
                    group.forEach((c) => {
                        const value = data.code === 200 ? data.data?.[c.subId] : undefined;
                        if (value) {
                            states[c.subId] = permissionForCourse(c, value, now);
                            if (states[c.subId] !== 'unknown')
                                confirmed.push(c.subId);
                        }
                    });
                }
                catch (_) {
                    failures++;
                }
                if (gen !== this.stopped)
                    return;
                progress(states, confirmed.slice());
            }
        };
        await Promise.all([worker(), worker()]);
        return states;
    }
    async request(path, post = '', origin = ORIGIN) {
        const generation = this.stopped;
        const task = window.native.call('request', { url: origin + path, body: post });
        const handle = { destroy: () => {
                if (task.id)
                    window.native.call('cancelRequest', { id: task.id }).catch(() => { });
            } };
        this.pending.add(handle);
        try {
            const result = await task;
            if (generation !== this.stopped)
                throw new Error('已取消');
            if (result.status === 403)
                throw new AccessDenied('当前账号没有这节课的访问权限');
            if (result.status === 401)
                throw new Error('登录失效，请重新登录');
            if (result.status !== 200)
                throw new Error('智云暂时无法访问（' + result.status + '）');
            if (!result.text.trim().startsWith('{'))
                throw new Error('请先登录智云课堂');
            return result.text;
        }
        finally {
            this.pending.delete(handle);
        }
    }
    async account() {
        const data = JSON.parse(await this.request('/userapi/v1/infosimple'));
        if (!data.params?.id)
            throw new Error('请先登录浙江大学统一身份认证');
        return { id: String(data.params.id), name: data.params.realname || data.params.name || '同学', tenantId: data.params.tenant_id || 112, username: data.params.account || '' };
    }
    async plaza(account, date, live) {
        const path = `/courseapi/v2/course-live/search-live-course-list?need_time_quantum=1&unique_course=1&with_sub_duration=1&with_sub_data=1&tenant=${account.tenantId}&search_time=${encodeURIComponent(date)}&sub_live_status=${live ? '1' : ''}&sub_public=&course_student_type=`;
        const data = JSON.parse(await this.request(path));
        if (data.code !== 0)
            throw new Error('课程广场暂时无法读取');
        const result = [];
        (data.list || []).forEach((group) => {
            (group.list || [group]).forEach((r) => {
                const item = this.plazaCourse(r, String(r.course_id || r.id || ''), false);
                if (item)
                    result.push(item);
            });
        });
        return result.sort((a, b) => a.start - b.start);
    }
    async searchCourses(account, title, teacher, page) {
        const path = `/pptnote/v1/searchlist?tenant_id=${account.tenantId}&user_id=${encodeURIComponent(account.id)}&user_name=${encodeURIComponent(account.username || '')}&title=${encodeURIComponent(title.trim())}&realname=${encodeURIComponent(teacher.trim())}&trans=&page=${page}&per_page=20`;
        const data = JSON.parse(await this.request(path));
        if (data.code !== 0)
            throw new Error('课程搜索暂时不可用');
        const result = [];
        (data.total?.list || []).forEach((r) => {
            const id = r.course_id || r.id;
            if (id && r.c_type !== 'recommend')
                result.push({ courseId: String(id), title: plain(r.title || r.course_title || '未命名课程'), teacher: r.realname || r.lecturer_name || '', room: r.room_name || '', type: r.c_type || '', term: this.termLabel(r.term_name || ''), year: /\d{4}[-—]\d{4}/.exec(r.term_name || '')?.[0] || '' });
        });
        return { list: result, total: Number(data.total?.total || 0) };
    }
    async chapters(hit, hydrateDetails = true) {
        const data = JSON.parse(await this.request(`/courseapi/v2/course/catalogue?course_id=${encodeURIComponent(hit.courseId)}`));
        if (!data.result?.data)
            throw new Error('暂时无法读取这门课的课次');
        const result = [];
        const visit = (rows) => {
            rows.forEach((r) => {
                if (r.children?.length)
                    visit(r.children);
                else if (r.list?.length)
                    visit(r.list);
                else {
                    const item = this.plazaCourse(r, hit.courseId, true);
                    if (item) {
                        item.title = hit.title;
                        item.term = item.term || hit.term;
                        item.teacher = item.teacher || hit.teacher;
                        item.room = item.room || hit.room;
                        result.push(item);
                    }
                }
            });
        };
        visit(data.result.data);
        if (!hydrateDetails)
            return result.filter((item) => item.start > 0).sort((a, b) => b.start - a.start);
        const gen = this.stopped;
        if (result.some((item) => item.end <= item.start)) {
            try {
                const metadata = JSON.parse(await this.request('/courseapi/v2/course-live/search-live-course-list?all=1&course_id=' + encodeURIComponent(hit.courseId) + '&with_sub_data=1&show_all=1'));
                const apply = (rows) => rows.forEach((row) => { if (row.list?.length)
                    apply(row.list);
                else {
                    const item = result.find((course) => course.subId === String(row.sub_id || row.id));
                    if (!item)
                        return;
                    const end = this.epochSeconds(row.course_over || row.end_at);
                    if (end > item.start)
                        item.end = end;
                    if (row.sub_status !== undefined || row.status !== undefined)
                        item.status = String(row.sub_status ?? row.status);
                } });
                if (metadata.code === 0)
                    apply(metadata.list || []);
            }
            catch (err) {
                if (err instanceof AccessDenied)
                    throw err;
            }
        }
        let cursor = 0;
        const hydrate = async () => { while (cursor < result.length && gen === this.stopped) {
            const item = result[cursor++];
            if (item.end > item.start)
                continue;
            try {
                const info = await this.info(item);
                if (gen !== this.stopped)
                    return;
                item.start = this.epochSeconds(info.start_at) || item.start;
                item.end = this.epochSeconds(info.end_at);
                if (info.sub_status !== undefined)
                    item.status = String(info.sub_status);
            }
            catch (_) { }
        } };
        await Promise.all([hydrate(), hydrate()]);
        if (gen !== this.stopped)
            throw new Error('已取消');
        return result.filter((item) => item.end > item.start).sort((a, b) => b.start - a.start);
    }
    termLabel(value) { return value.replace(/spring/gi, '春').replace(/summer/gi, '夏').replace(/autumn|fall/gi, '秋').replace(/winter/gi, '冬').split(/[,，]/).map((part) => { const match = /^(\d{4})-(\d{4})([1-4]|春|夏|秋|冬)$/.exec(part.trim()); return match ? match[1] + '—' + match[2] + '学年 · ' + (/^[1-4]$/.test(match[3]) ? '第' + match[3] + '学期' : match[3] + '季学期') : part.trim(); }).join('，'); }
    plazaCourse(r, courseId, catalogue) {
        const subId = r.sub_id || (catalogue ? r.id : undefined);
        const start = this.epochSeconds(r.course_begin || r.start_at), end = this.epochSeconds(r.course_over || r.end_at);
        if (!subId || !courseId || !Number.isFinite(start) || !Number.isFinite(end) || (end <= start && !catalogue))
            return undefined;
        return { courseId, subId: String(subId), title: plain(r.course_title || r.title || r.sub_title || '未命名课程'),
            teacher: r.realname || r.lecturer_name || '', room: r.room_name || (/^\d+$/.test(r.room || '') ? '' : r.room || ''), term: this.termLabel(r.term_name || ''), start, end, status: String(r.sub_status || r.status || '') };
    }
    async courses(account) {
        const now = Date.now() / 1000;
        const start = shanghaiDate(now - 14 * 86400), end = shanghaiDate(now + 86400);
        const ranges = [];
        for (let cursor = start; cursor <= end; cursor = this.offsetDate(cursor, 7)) {
            const last = this.offsetDate(cursor, 6);
            ranges.push({ start: cursor, end: last > end ? end : last });
        }
        const weeks = await Promise.all(ranges.map((range) => this.schedules(account, range.start, range.end)));
        const unique = new Map();
        weeks.forEach((rows) => rows.forEach((item) => unique.set(item.subId, item)));
        return Array.from(unique.values()).sort((a, b) => a.start - b.start);
    }
    async refreshToday(courses) {
        const now = Date.now() / 1000, today = shanghaiDate(now);
        await Promise.all(courses.filter((course) => shanghaiDate(course.start) === today && course.start - now <= 1800 && course.end >= now - 600).map(async (course) => { try {
            const info = await this.info(course);
            if (info.sub_status !== undefined)
                course.status = String(info.sub_status);
        }
        catch (_) { } }));
    }
    async schedules(account, start, end) {
        const path = `/courseapi/v2/schedule/get-week-schedules?user_id=${encodeURIComponent(account.id)}&tenant_id=${account.tenantId}&start_at=${start}&end_at=${end}`;
        const data = JSON.parse(await this.request(path));
        if (data.code !== 0 && !data.result)
            throw new Error('课表同步失败，请稍后重试');
        const result = [];
        const days = data.result?.list || data.result?.data?.list || [];
        days.forEach((day) => {
            (day.course || day.courses || day.list || []).forEach((c) => {
                const startTime = this.epochSeconds(c.start_at), endTime = this.epochSeconds(c.end_at);
                const subId = c.sub_id || c.class_id || c.id;
                if (subId && c.course_id && startTime > 0 && endTime > startTime) {
                    result.push({ subId: String(subId), courseId: String(c.course_id), title: c.course_title || c.title || '未命名课程',
                        term: this.termLabel(c.term_name || ''), teacher: c.teacher_name || c.lecturer_name || '', room: c.room_name || '', status: String(c.status || c.sub_status || c.status_label || ''), start: startTime, end: endTime });
                }
            });
        });
        return result.sort((a, b) => a.start - b.start);
    }
    epochSeconds(value) {
        if (value === undefined || value === '')
            return 0;
        const number = Number(value);
        if (Number.isFinite(number))
            return number > 1000000000000 ? Math.floor(number / 1000) : number;
        const parsed = Date.parse(String(value));
        return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
    }
    offsetDate(date, days) {
        const value = Date.parse(date + 'T00:00:00+08:00') + days * 86400000;
        return shanghaiDate(value / 1000);
    }
    async schoolTerms(account) {
        if (this.historyTerms)
            return this.historyTerms;
        const response = JSON.parse(await this.request(`/courseapi/index.php/v2/course/get-term-years?tenant=${account.tenantId}`));
        const years = response.result?.data;
        if (!years)
            throw new Error('校历暂时无法读取');
        const terms = [];
        Object.keys(years).forEach((year) => {
            Object.keys(years[year]).forEach((id) => {
                const term = years[year][id], start = String(term.begin_date || '').slice(0, 10), end = String(term.end_date || '').slice(0, 10);
                if (/^\d{4}-\d{2}-\d{2}$/.test(start) && end >= start)
                    terms.push({ start, end, label: this.termLabel(/\d{4}/.test(term.term_name || term.name || '') ? term.term_name || term.name || '' : year + (term.term_name || term.name || id)) });
            });
        });
        if (!terms.length)
            throw new Error('校历暂时没有可用日期');
        this.historyTerms = terms.sort((a, b) => b.end.localeCompare(a.end));
        return this.historyTerms;
    }
    async annotateTerms(account, courses, store) {
        let terms = [];
        try {
            terms = JSON.parse(store?.readJson('school-terms.json') || '[]');
        }
        catch (_) { }
        const assign = () => { courses.forEach((course) => { if (course.term && !/[，,]/.test(course.term))
            return; const date = shanghaiDate(course.start), term = terms.find((range) => range.start <= date && date <= range.end); if (term?.label)
            course.term = term.label; }); };
        assign();
        if (courses.every((course) => !!course.term && !/[，,]/.test(course.term)))
            return;
        terms = await this.schoolTerms(account);
        try {
            store?.saveJson('school-terms.json', JSON.stringify(terms));
        }
        catch (_) { }
        assign();
    }
    async attendanceHistory(account, progress = () => { }, initial) {
        let cursor = initial?.cursor || shanghaiDate(Date.now() / 1000);
        const unique = new Map();
        (initial?.courses || []).forEach((item) => unique.set(item.subId, item));
        let windowsDone = 0, failed = false, complete = initial?.complete === true;
        const limit = 24, now = Date.now() / 1000;
        if (complete)
            return { courses: Array.from(unique.values()).sort((a, b) => b.start - a.start), cursor, emptyWindows: 0, complete, windowsDone, failed };
        let terms;
        try {
            terms = await this.schoolTerms(account);
        }
        catch (_) {
            return { courses: Array.from(unique.values()).sort((a, b) => b.start - a.start), cursor, emptyWindows: 0, complete: false, windowsDone, failed: true };
        }
        while (windowsDone < limit) {
            const ranges = [];
            let end = cursor;
            for (let i = 0; i < 3 && windowsDone + i < limit; i++) {
                const term = terms.find((item) => item.start <= end);
                if (!term)
                    break;
                if (end > term.end)
                    end = term.end;
                const start = this.offsetDate(end, -6);
                ranges.push({ start: start < term.start ? term.start : start, end });
                end = this.offsetDate(ranges[ranges.length - 1].start, -1);
            }
            if (!ranges.length) {
                complete = true;
                break;
            }
            const results = await Promise.all(ranges.map(async (range) => {
                try {
                    return { rows: await this.schedules(account, range.start, range.end), error: false };
                }
                catch (_) {
                    return { rows: [], error: true };
                }
            }));
            for (let i = 0; i < ranges.length; i++) {
                if (results[i].error) {
                    failed = true;
                    break;
                }
                windowsDone++;
                results[i].rows.filter((item) => item.end < now).forEach((item) => { if (!item.term)
                    item.term = terms.find((term) => term.start <= shanghaiDate(item.start) && shanghaiDate(item.start) <= term.end)?.label || ''; unique.set(item.subId, item); });
                cursor = this.offsetDate(ranges[i].start, -1);
                complete = !terms.some((term) => term.start <= cursor);
                const state = { courses: Array.from(unique.values()).sort((a, b) => b.start - a.start), cursor, emptyWindows: 0, complete };
                progress(windowsDone, limit, state);
            }
            if (failed || complete)
                break;
        }
        return { courses: Array.from(unique.values()).sort((a, b) => b.start - a.start), cursor, emptyWindows: 0, complete, windowsDone, failed };
    }
    async info(course) {
        const data = JSON.parse(await this.request(`/courseapi/v3/portal-home-setting/get-sub-info?course_id=${encodeURIComponent(course.courseId)}&sub_id=${encodeURIComponent(course.subId)}`));
        if (data.code !== 0 || !data.data)
            throw new Error('这节课的信息暂时无法读取');
        if (!data.data.content && data.data.sub_content) {
            try {
                data.data.content = JSON.parse(data.data.sub_content);
            }
            catch (_) { }
        }
        return data.data;
    }
    async liveCaptionAddress(course, info) {
        if (info.content?.trans_socket_url)
            return info.content.trans_socket_url;
        const query = `all=1&course_id=${encodeURIComponent(course.courseId)}&sub_id=${encodeURIComponent(course.subId)}&with_sub_data=1&show_all=1`;
        const data = JSON.parse(await this.request('/courseapi/v2/course-live/search-live-course-list?' + query));
        if (data.code !== 0)
            return '';
        const item = data.list?.find((row) => String(row.sub_id || row.id) === course.subId) || data.list?.[0];
        if (item?.content?.trans_socket_url)
            return item.content.trans_socket_url;
        try {
            return JSON.parse(item?.sub_content || '{}').trans_socket_url || '';
        }
        catch (_) {
            return '';
        }
    }
    async checkPermission(course, live) {
        const gen = this.stopped;
        const payload = JSON.stringify({ course_id: course.courseId, sub_ids: [course.subId] });
        const data = JSON.parse(await this.request('/courseapi/v2/course/video-and-live-promission-by-user-id', payload));
        if (gen !== this.stopped)
            throw new Error('已取消');
        this.remember([course], data);
        const permission = data.data?.[course.subId];
        const allowed = live ? permission?.live : permission?.video;
        if (data.code !== 200 || permissionState(allowed) === 'unknown')
            throw new Error('课程权限暂时未能确认，请稍后重试');
        if (permissionState(allowed) === 'denied')
            throw new AccessDenied('当前账号没有这节课的访问权限');
    }
    async checkCurrentPermission(course) {
        const info = await this.info(course);
        if (info.sub_status !== undefined)
            course.status = String(info.sub_status);
        await this.checkPermission(course, courseIsLive(course));
    }
    async videos(course) {
        await this.checkCurrentPermission(course);
        const query = `all=1&course_id=${encodeURIComponent(course.courseId)}&sub_id=${encodeURIComponent(course.subId)}&with_sub_data=1&with_room_data=1&show_all=1`;
        const data = JSON.parse(await this.request('/courseapi/v2/course-live/search-live-course-list?' + query));
        if (data.code !== 0)
            throw new Error('视频信息读取失败');
        const row = data.list?.find((r) => String(r.sub_id || r.id) === course.subId) || (data.list?.length === 1 && !data.list[0].sub_id ? data.list[0] : undefined);
        if (!row)
            throw new Error('平台暂未提供这节课的视频');
        return mediaSources(row);
    }
    async slides(course) {
        // Both are official classroom backends. A denied response is final, never a fallback trigger.
        const known = this.slideOrigins.get(course.subId);
        if (known)
            return this.slidesFrom(course, known);
        let primary = [];
        let primaryError = undefined;
        try {
            primary = await this.slidesFrom(course, ORIGIN);
        }
        catch (err) {
            if (err instanceof AccessDenied)
                throw err;
            primaryError = err;
        }
        if (primary.length) {
            this.slideOrigins.set(course.subId, ORIGIN);
            return primary;
        }
        try {
            const secondary = await this.slidesFrom(course, INTERACTIVE);
            if (secondary.length)
                this.slideOrigins.set(course.subId, INTERACTIVE);
            return secondary;
        }
        catch (err) {
            if (err instanceof AccessDenied)
                throw err;
            if (primaryError)
                throw primaryError;
            return primary;
        }
    }
    async slidesFrom(course, origin) {
        const all = [];
        // Fetch every page so joining midway recovers server-side earlier slides.
        let page = 1, received = 0;
        while (page <= 200) {
            const prefix = origin === INTERACTIVE ? '/pptnoteapi' : '/pptnote';
            const path = `${prefix}/v1/schedule/search-ppt?course_id=${encodeURIComponent(course.courseId)}&sub_id=${encodeURIComponent(course.subId)}&page=${page}&per_page=100`;
            const data = JSON.parse(await this.request(path, '', origin));
            if (data.code !== 0)
                throw new Error('课件列表同步失败');
            const list = data.list || [];
            list.forEach((p) => {
                try {
                    const content = p.content ? JSON.parse(p.content) : p.ppt || {};
                    const url = imageUrl(content.pptimgurl || '');
                    const created = Number(content.created || 0);
                    const absolute = created >= 1e9 ? captionSeconds(created, course.start) : Number.NaN;
                    const t = Number.isFinite(absolute) ? Math.max(0, absolute) : Number(p.created_sec);
                    if (url && Number.isFinite(t) && t >= 0)
                        all.push({ id: String(p.id || p.ppt_id || `${t}:${url}`), t, url, thumb: imageUrl(content.pptthumb || '') || url, note: plain(content.content || '') });
                }
                catch (_) { /* Ignore a malformed record without losing the other pages. */ }
            });
            received += list.length;
            if (!list.length || received >= Number(data.total || received))
                return all;
            page++;
        }
        throw new Error('课件超过 20000 页，暂时无法完整同步');
    }
    async resourceSlides(resourceId) {
        const data = JSON.parse(await this.request(`/spidermaterial/spider-material/web/aitask/async/getPPTData?id=${encodeURIComponent(resourceId)}`));
        if (data.state !== 200)
            return [];
        return (data.data || []).filter((p) => !!imageUrl(p.imgurl)).map((p) => {
            return { id: `resource:${p.timestamp}:${p.imgurl}`, t: Math.floor(p.timestamp / 1000), url: imageUrl(p.imgurl), thumb: imageUrl(p.imgurl), note: plain(p.describe || '') };
        });
    }
    async transcripts(course) {
        const known = this.transcriptOrigins.get(course.subId);
        if (known)
            return this.transcriptsFrom(course, known);
        const origin = this.slideOrigins.get(course.subId) === INTERACTIVE ? INTERACTIVE : ORIGIN;
        let primary = [], failure = undefined;
        try {
            primary = await this.transcriptsFrom(course, origin);
        }
        catch (err) {
            if (err instanceof AccessDenied)
                throw err;
            failure = err;
        }
        if (primary.length) {
            this.transcriptOrigins.set(course.subId, origin);
            return primary;
        }
        const alternate = origin === INTERACTIVE ? ORIGIN : INTERACTIVE;
        try {
            const rows = await this.transcriptsFrom(course, alternate);
            if (rows.length)
                this.transcriptOrigins.set(course.subId, alternate);
            return rows;
        }
        catch (err) {
            if (err instanceof AccessDenied)
                throw err;
            if (failure)
                throw failure;
            return primary;
        }
    }
    async transcriptsFrom(course, origin) {
        const data = JSON.parse(await this.request(`/courseapi/v3/web-socket/search-trans-result?sub_id=${encodeURIComponent(course.subId)}&format=json`, '', origin));
        if (data.code === 10002 && (data.msg || '').includes('未查询到语音数据'))
            return [];
        if (data.code !== 0)
            throw new Error('转写同步失败，平台可能尚未提供该课程转写');
        const result = [];
        (data.list || []).forEach((block) => {
            let rows = [];
            try {
                rows = typeof block.all_content === 'string' ? JSON.parse(block.all_content) : block.all_content || [];
            }
            catch (_) {
                return;
            }
            if (!Array.isArray(rows))
                return;
            rows.forEach((r, i) => {
                let t = captionSeconds(r.BeginSec ?? r.text_begin_time ?? r.startTime, course.start), end = captionSeconds(r.EndSec ?? r.text_end_time ?? r.endTime, course.start);
                let content = r.Text || r.originzhtext || r.zhtext || r.sourcetext || '';
                if (!Number.isFinite(t) && r.time !== undefined) {
                    t = captionSeconds(r.time, course.start);
                    const nextTime = rows[i + 1]?.time;
                    end = nextTime !== undefined ? captionSeconds(nextTime, course.start) : t;
                    content = r.originzhtext || r.zhtext || r.Text || r.sourcetext || '';
                }
                const text = plain(content);
                if (Number.isFinite(t) && t >= 0 && text)
                    result.push({ id: `asr:${t}`, t, end: Number.isFinite(end) ? Math.max(t, end) : t, text, timing: 'history' });
            });
        });
        return result;
    }
}
