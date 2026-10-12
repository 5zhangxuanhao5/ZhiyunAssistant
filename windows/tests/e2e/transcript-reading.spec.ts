import '../../src/shared/bridge';
import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

let app: ElectronApplication, page: Page, folder: string;
const course = { subId: 'reading-lesson', courseId: 'reading-course', title: '转写阅读测试课程', teacher: '测试教师', room: '测试教室', start: 1791508800, end: 1791511800, status: '6' };

test.beforeEach(async () => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), '智云助手 转写锚点 '));
  app = await electron.launch({ args: [path.resolve('.')], env: { ...process.env, ZHIYUN_TEST_DATA: folder }, timeout: 30000 });
  page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded');
  await expect(page.getByRole('heading', { name: '隐私与数据', exact: true })).toBeVisible();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1360, 920));
});
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus && page && !page.isClosed()) await page.screenshot({ path: info.outputPath('reading-failure.png'), timeout: 3000 }).catch(() => {});
  if (app) { const child = app.process(); await Promise.race([app.close().catch(() => {}), new Promise(resolve => setTimeout(resolve, 5000))]); if (child.exitCode === null) child.kill('SIGTERM'); }
  if (folder) fs.rmSync(folder, { recursive: true, force: true });
});

async function start(summary = false) {
  await app.evaluate(({ ipcMain }, { course, summary }) => {
    const slides = Array.from({ length: 6 }, (_, i) => ({ id: 'slide-' + i, t: i * 300, url: 'https://cmc.zju.edu.cn/reading-fixture-' + i + '.png', thumb: '', note: '' }));
    const lines = slides.flatMap((slide, p) => Array.from({ length: 90 }, (_, i) => ({ id: `line-${p}-${i}`, t: slide.t + i * 3, end: slide.t + i * 3 + 2, text: `第${p + 1}页第${i + 1}句测试讲解，阅读位置应在切换功能组合后保持不变。` })));
    const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=';
    const regular = { slides: !summary, transcript: true, video: false, notes: false, ai: false, summary };
    const store = new Map<string, any>(); (globalThis as any).__readingProgress = null;
    ipcMain.removeHandler('zhiyun:call');
    ipcMain.handle('zhiyun:call', async (_event, method, payload: any = {}) => {
      switch (method) {
        case 'session.restore': return { id: 'reading-account', name: '测试同学', tenantId: 112 };
        case 'storage.get': return payload.key === 'privacy-consent' ? true : payload.key === 'pane-preferences' ? { regular, missing: {} } : payload.key === 'study-options' ? { common: ['slides', 'transcript', 'summary'] } : store.get(payload.key) || null;
        case 'storage.set': store.set(payload.key, payload.value); return null;
        case 'courses.schedule': case 'courses.chapters': return [course];
        case 'courses.permissions': return { 'reading-lesson': 'allowed' };
        case 'courses.history': return { courses: [course], complete: true };
        case 'collection.get': return { favorite: [], later: [] };
        case 'lesson.open': return { course, slides, lines, live: false, sources: [] };
        case 'resource.image': return image;
        case 'progress.get': return { seconds: 660, slideId: 'slide-2', followVideo: true };
        case 'progress.set': (globalThis as any).__readingProgress = payload; return null;
        case 'ai.settings': return { configured: false, model: 'deepseek-flash', models: [] };
        case 'summary.get': return { records: {}, positions: {}, scope: 'page' };
        case 'download.list': return { entries: [], tasks: [], concurrency: 1 };
        default: return null;
      }
    });
  }, { course, summary });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: '我的课堂', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '进入学习', exact: true }).click();
  await expect(page.locator('.transcript-page-label').first()).toContainText('第 3 页');
  await expect(page.locator('.transcript-scroll')).toBeVisible();
}

async function readSentence(id: string) {
  const scroll = page.locator('.transcript-scroll');
  await scroll.evaluate((element, lineId) => {
    const line = element.querySelector<HTMLElement>(`[data-line-id="${lineId}"]`)!;
    element.scrollTop += line.getBoundingClientRect().top - element.getBoundingClientRect().top + 8;
  }, id);
  const box = (await scroll.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 3);
  await expect.poll(() => scroll.evaluate(e => e.scrollTop)).toBeGreaterThan(200);
  await page.waitForTimeout(120);
  return readingLocation();
}
async function readingLocation() {
  return page.locator('.transcript-scroll').evaluate(element => {
    const viewport = element.getBoundingClientRect();
    const line = [...element.querySelectorAll<HTMLElement>('.transcript-line')].find(line => { const box = line.getBoundingClientRect(); return box.bottom > viewport.top && box.top < viewport.bottom; })!;
    return { id: line.dataset.lineId, offset: line.getBoundingClientRect().top - viewport.top, time: Number(line.dataset.time), scroll: element.scrollTop };
  });
}
async function expectLocation(location: Awaited<ReturnType<typeof readingLocation>>) {
  await expect.poll(async () => (await readingLocation()).id).toBe(location.id);
  await expect.poll(async () => Math.abs((await readingLocation()).offset - location.offset)).toBeLessThan(4);
}

test('paginated and continuous transcript keep sentence, pixel offset, manual browsing and global page labels', async () => {
  await start();
  const initial = await readSentence('line-2-23');
  await page.getByRole('button', { name: '✓ 课件', exact: true }).click();
  await expect(page.locator('.transcript-page-label')).toHaveCount(0);
  await expect(page.locator('.transcript-line')).toHaveCount(540);
  await expectLocation(initial);
  const later = await readSentence('line-3-42');
  await page.getByRole('button', { name: '课件', exact: true }).click();
  await expect(page.locator('.transcript-page-label').first()).toContainText('第 4 页');
  await expect(page.locator('.slide-meta').first()).toContainText('第 4 页');
  await expectLocation(later);
  await page.evaluate(async () => { const tasks: Promise<unknown>[] = []; window.dispatchEvent(new CustomEvent('zhiyun-flush', { detail: { tasks } })); await Promise.all(tasks); });
  expect((await app.evaluate(() => (globalThis as any).__readingProgress)).followVideo).toBe(false);
});

test('closing and reopening summary preserves the same prior reading point instead of resetting continuous text', async () => {
  await start(true);
  const location = await readSentence('line-2-19');
  await page.getByRole('button', { name: '✓ 本页速览', exact: true }).click();
  await expect(page.locator('.transcript-page-label')).toHaveCount(0);
  await expectLocation(location);
  await page.getByRole('button', { name: '本页速览', exact: true }).click();
  await expect(page.locator('.transcript-page-label').first()).toContainText('第 3 页');
  await expectLocation(location);
});
