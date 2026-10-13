import '../../src/shared/bridge';
import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
let app: ElectronApplication, page: Page, folder: string;
const course = { subId: 'bookmark-lesson', courseId: 'bookmark-course', title: '阅读位置合成课程', teacher: '测试教师', room: '测试教室', start: 1791508800, end: 1791511800, status: '6' };
const media = pathToFileURL(path.resolve('tests/fixtures/media/test-pattern.mp4')).href;
const book = { id: 'line-3-42', t: 1026, offset: -9, browsing: true };
test.beforeEach(async () => { folder = fs.mkdtempSync(path.join(os.tmpdir(), '智云助手 阅读进度 ')); await launch(); });
test.afterEach(async ({}, info) => {
 if (info.status !== info.expectedStatus && page && !page.isClosed()) await page.screenshot({ path: info.outputPath('bookmark-failure.png') }).catch(() => {});
 if (app) await app.evaluate(() => (globalThis as any).__allowBookmarkSave = true).catch(() => {});
 await close(); fs.rmSync(folder, { recursive: true, force: true });
});
async function close() { if (app) { const child = app.process(); await Promise.race([app.close().catch(() => {}), new Promise(resolve => setTimeout(resolve, 5000))]); if (child.exitCode === null) child.kill('SIGTERM'); } }
async function launch() {
 app = await electron.launch({ args: [path.resolve('.')], env: { ...process.env, ZHIYUN_TEST_DATA: folder }, timeout: 30000 }); page = await app.firstWindow();
 await page.addInitScript(() => { const mute = () => document.querySelectorAll('video').forEach(video => video.muted = true); new MutationObserver(mute).observe(document, { childList: true, subtree: true }); mute(); });
 await page.waitForLoadState('domcontentloaded'); await expect(page.getByRole('heading', { name: '隐私与数据', exact: true })).toBeVisible(); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1360, 920));
}
async function fixture(options: { withSlides?: boolean; video?: boolean; live?: boolean; origin?: boolean; notes?: boolean; rejectSave?: boolean } = {}) {
 await app.evaluate(({ ipcMain, protocol, net }, setup) => {
  const fs = process.getBuiltinModule('node:fs'), path = process.getBuiltinModule('node:path'), filename = path.join(setup.folder, 'reading-progress.json');
  const selectedCourse = setup.options.live ? { ...setup.course, start: Date.now() / 1000 - 1800, end: Date.now() / 1000 + 1800, status: 'live' } : setup.course;
  const origin = { ...setup.course, subId: 'origin-lesson', title: '跳转来源合成课程', start: setup.course.start + 86400, end: setup.course.end + 86400 };
  const courses = setup.options.origin ? [selectedCourse, origin] : [selectedCourse];
  const slides = Array.from({ length: 6 }, (_, p) => ({ id: 'slide-' + p, t: p * 300, url: 'https://cmc.zju.edu.cn/reading-' + p + '.png', thumb: '', note: '' }));
  const lines = slides.flatMap((slide, p) => Array.from({ length: 90 }, (_, i) => ({ id: `line-${p}-${i}`, t: slide.t + i * 3, end: slide.t + i * 3 + 2, text: `第${p + 1}段第${i + 1}句合成阅读资料，进度应按句子和视口偏移保存。` })));
  const regular = { slides: false, transcript: true, video: !!setup.options.video, notes: !!setup.options.notes, ai: !!setup.options.origin, summary: false };
  const store = new Map<string, any>(); (globalThis as any).__bookmarkProgress = []; (globalThis as any).__bookmarkEvents = []; (globalThis as any).__allowBookmarkSave = false; let loggedOut = false;
  const recording = { id: 'recording', title: '合成教师画面', url: 'https://cmc.zju.edu.cn/synthetic-bookmark.mp4', live: false, offset: 0 };
  protocol.unhandle('zhiyun-resource'); protocol.handle('zhiyun-resource', async request => {
   if (!request.url.includes('/bookmark-fixture/')) return new Response(null, { status: 404 });
   const response = await net.fetch(setup.media), bytes = Buffer.from(await response.arrayBuffer());
   const headers = new Headers({ 'Content-Type': 'video/mp4', 'Access-Control-Allow-Origin': 'zhiyun://app', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
   const match = /^bytes=(\d+)-(\d*)$/.exec(request.headers.get('range') || '');
   if (match) { const start = Number(match[1]), end = match[2] ? Math.min(bytes.length - 1, Number(match[2])) : bytes.length - 1; if (start > end) return new Response(null, { status: 416, headers }); headers.set('Content-Range', `bytes ${start}-${end}/${bytes.length}`); headers.set('Content-Length', String(end - start + 1)); return new Response(bytes.subarray(start, end + 1), { status: 206, headers }); }
   headers.set('Content-Length', String(bytes.length));
   return new Response(bytes, { headers });
  });
  ipcMain.removeHandler('zhiyun:call'); ipcMain.handle('zhiyun:call', async (_event, method, payload: any = {}) => {
   switch (method) {
    case 'session.restore': return loggedOut ? null : { id: 'bookmark-account', name: '测试同学', tenantId: 112 };
    case 'session.logout': (globalThis as any).__bookmarkEvents.push({ method }); loggedOut = true; return null;
    case 'storage.get': return payload.key === 'privacy-consent' ? true : payload.key === 'pane-preferences' ? { regular, missing: {} } : store.get(payload.key) || null;
    case 'storage.set': store.set(payload.key, payload.value); return null;
    case 'courses.schedule': case 'courses.chapters': return courses;
    case 'courses.permissions': return Object.fromEntries(courses.map(course => [course.subId, 'allowed']));
    case 'courses.history': return { courses, complete: true };
    case 'collection.get': return { favorite: [], later: [] };
    case 'lesson.open': return { course: payload.course, slides: setup.options.withSlides ? slides : [], lines, live: !!setup.options.live, sources: setup.options.video ? [recording] : [] };
    case 'progress.get': return fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, 'utf8'))[payload.course.subId] || null : null;
    case 'progress.set': { if (loggedOut) throw new Error('合成账号已注销'); const all = fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, 'utf8')) : {}; all[payload.course.subId] = { ...payload, schema: 1, courseId: payload.course.courseId, subId: payload.course.subId }; fs.writeFileSync(filename, JSON.stringify(all)); (globalThis as any).__bookmarkProgress.push(payload); (globalThis as any).__bookmarkEvents.push({ method, payload }); return null; }
    case 'notes.list': return [];
    case 'notes.save': if (loggedOut) throw new Error('合成账号已注销'); if (setup.options.rejectSave && !(globalThis as any).__allowBookmarkSave) throw new Error('合成保存失败'); await new Promise(resolve => setTimeout(resolve, 150)); (globalThis as any).__bookmarkEvents.push({ method, note: payload.note }); return payload.note;
    case 'video.sources': return [recording];
    case 'video.resolve': return { ...recording, url: 'zhiyun-resource://asset/bookmark-fixture/video.mp4' };
    case 'ai.settings': return { configured: !!setup.options.origin, model: 'synthetic', models: ['synthetic'] };
    case 'ai.chatSessions': { const date = new Date((selectedCourse.start + 8 * 3600) * 1000).toISOString(); return payload.course.subId === origin.subId ? [{ id: 'source-question', title: '合成时间引用', savedAt: 1, turns: [{ question: '回到指定时点', at: 0, answer: `【${date.slice(0, 10)} ${date.slice(11, 16)}课次 · 00:00】`, references: [selectedCourse] }] }] : []; }
    case 'ai.saveChat': return null;
    case 'download.list': return { entries: [], tasks: [], concurrency: 1 };
    default: return null;
   }
  });
 }, { folder, course, media, options });
 await page.reload({ waitUntil: 'domcontentloaded' }); await expect(page.getByRole('heading', { name: '我的课堂', exact: true })).toBeVisible();
}
async function enter(title = course.title) { await page.locator('.course-card').filter({ hasText: title }).getByRole('button', { name: '进入学习', exact: true }).click(); await expect(page.locator('.transcript-scroll')).toBeVisible(); }
async function location() { return page.locator('.transcript-scroll').evaluate(root => { const box = root.getBoundingClientRect(), line = Array.from(root.querySelectorAll<HTMLElement>('.transcript-line')).find(line => { const rect = line.getBoundingClientRect(); return rect.bottom > box.top && rect.top < box.bottom; })!; return { id: line.dataset.lineId, t: Number(line.dataset.time), offset: line.getBoundingClientRect().top - box.top }; }); }
async function scrollToSentence(id: string) {
 const root = page.locator('.transcript-scroll'); await root.evaluate((root, id) => { const line = root.querySelector<HTMLElement>(`[data-line-id="${id}"]`)!; root.scrollTop += line.getBoundingClientRect().top - root.getBoundingClientRect().top + 9; }, id);
 const box = (await root.boundingBox())!; await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.wheel(0, 7);
 await expect.poll(() => root.evaluate(root => root.scrollTop)).toBeGreaterThan(300); await page.waitForTimeout(180); return location();
}
async function sameLocation(saved: Awaited<ReturnType<typeof location>>) { await expect.poll(async () => (await location()).id).toBe(saved.id); await expect.poll(async () => Math.abs((await location()).offset - saved.offset)).toBeLessThan(4); }
async function flush() { await page.evaluate(async () => { const tasks: Promise<unknown>[] = []; window.dispatchEvent(new CustomEvent('zhiyun-flush', { detail: { tasks } })); await Promise.all(tasks); }); }
for (const withSlides of [false, true]) test(`continuous transcript scroll restores after leaving and full app restart (${withSlides ? 'slides hidden' : 'slides unavailable'})`, async () => {
 await fixture({ withSlides }); await enter(); await expect(page.locator('.transcript-page-label')).toHaveCount(0);
 const reading = await scrollToSentence('line-3-42'); await flush();
 const saved = JSON.parse(fs.readFileSync(path.join(folder, 'reading-progress.json'), 'utf8'))[course.subId]; expect(saved.transcriptAnchor.id).toBe(reading.id); expect(saved.seconds).toBe(reading.t);
 await page.getByRole('button', { name: '返回', exact: true }).click(); await expect(page.getByRole('heading', { name: '我的课堂', exact: true })).toBeVisible(); await enter(); await sameLocation(reading);
 await close(); await launch(); await fixture({ withSlides }); await enter(); await sameLocation(reading);
});
test('manual transcript scrolling during real video keeps playback seconds independent', async () => {
 await fixture({ video: true }); await enter(); const video = page.locator('video'); await expect.poll(() => video.evaluate(video => video.readyState)).toBeGreaterThanOrEqual(2);
 await expect.poll(() => video.evaluate(video => video.currentTime)).toBeGreaterThan(.1);
 await video.evaluate(video => { video.pause(); video.currentTime = 7; }); await expect.poll(() => video.evaluate(video => video.currentTime)).toBeGreaterThan(6.8);
 await expect.poll(async () => { await flush(); return JSON.parse(fs.readFileSync(path.join(folder, 'reading-progress.json'), 'utf8'))[course.subId].seconds; }).toBeGreaterThan(6.8);
 const before = JSON.parse(fs.readFileSync(path.join(folder, 'reading-progress.json'), 'utf8'))[course.subId].seconds;
 const reading = await scrollToSentence('line-3-42'); await flush(); const saved = JSON.parse(fs.readFileSync(path.join(folder, 'reading-progress.json'), 'utf8'))[course.subId];
 expect(Math.abs(saved.seconds - before)).toBeLessThan(.3); expect(saved.transcriptAnchor.id).toBe(reading.id); expect(saved.transcriptAnchor.t).toBeGreaterThan(900); expect(saved.video).toBe(true); expect(saved.followVideo).toBe(false);
});
test('live default following ignores automatic old bookmark and displays the latest caption', async () => {
 fs.writeFileSync(path.join(folder, 'reading-progress.json'), JSON.stringify({ [course.subId]: { seconds: 0, slideId: '', followVideo: true, transcriptAnchor: { id: 'line-0-0', t: 0, offset: 0, browsing: false } } }));
 await fixture({ live: true }); await enter(); await expect(page.locator('.transcript-line').last()).toBeInViewport(); await flush();
 const saved = JSON.parse(fs.readFileSync(path.join(folder, 'reading-progress.json'), 'utf8'))[course.subId]; expect(saved.seconds).toBeGreaterThan(1700); expect(saved.followVideo).toBe(true); expect(saved.transcriptAnchor?.browsing).toBe(false);
});
test('cross-course explicit zero-time reference overrides the target lesson old bookmark', async () => {
 fs.writeFileSync(path.join(folder, 'reading-progress.json'), JSON.stringify({ [course.subId]: { seconds: book.t, slideId: 'slide-3', followVideo: false, transcriptAnchor: book } }));
 await fixture({ origin: true, withSlides: true }); await enter('跳转来源合成课程'); await expect(page.locator('.ai-pane .time-link')).toHaveCount(1); await page.locator('.ai-pane .time-link').click();
 await expect(page.locator('header.app-header')).toContainText(course.title); await expect.poll(async () => (await location()).id).toBe('line-0-0'); await flush();
 const saved = JSON.parse(fs.readFileSync(path.join(folder, 'reading-progress.json'), 'utf8'))[course.subId]; expect(saved.seconds).toBe(0); expect(saved.transcriptAnchor.id).toBe('line-0-0');
});
test('immediately logging out after typing saves latest note and reading progress before account removal once', async () => {
 await fixture({ notes: true }); await enter(); const editor = page.locator('.note-editor').first(); await expect(editor).toBeVisible();
 await editor.click(); await editor.pressSequentially('退出前最新笔记123'); page.on('dialog', dialog => dialog.accept());
 await page.getByRole('button', { name: '退出登录', exact: true }).dblclick(); await expect(page.getByRole('button', { name: '登录智云课堂', exact: true })).toBeVisible();
 const events = await app.evaluate(() => (globalThis as any).__bookmarkEvents), logout = events.findIndex((event: any) => event.method === 'session.logout');
 expect(logout).toBeGreaterThan(0); expect(events.filter((event: any) => event.method === 'session.logout')).toHaveLength(1);
 expect(events.slice(0, logout).some((event: any) => event.method === 'notes.save' && event.note.atoms.some((atom: any) => atom.value.includes('退出前最新笔记123')))).toBe(true);
 expect(events.slice(0, logout).some((event: any) => event.method === 'progress.set')).toBe(true);
});
test('failed final note flush retains account and note rather than logging out', async () => {
 await fixture({ notes: true, rejectSave: true }); await enter(); const editor = page.locator('.note-editor').first(); await editor.click(); await editor.pressSequentially('不能丢失的笔记456');
 page.on('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: '退出登录', exact: true }).click();
 await expect(page.getByText(/合成保存失败/).first()).toBeVisible(); await expect(page.getByRole('heading', { name: '课堂笔记', exact: true })).toBeVisible(); await expect(editor).toHaveText('不能丢失的笔记456');
 expect((await app.evaluate(() => (globalThis as any).__bookmarkEvents)).some((event: any) => event.method === 'session.logout')).toBe(false);
 await app.evaluate(() => (globalThis as any).__allowBookmarkSave = true);
});
