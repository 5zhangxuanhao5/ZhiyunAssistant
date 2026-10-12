import '../../src/shared/bridge';
import { test, expect, _electron, ElectronApplication, Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
let app: ElectronApplication, page: Page, folder: string;
const month = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 7);
const base = { courseId: 'calendar-selection-course', title: '日历与选区测试课程', teacher: '测试教师', room: '测试教室', status: '6' };
const courses = [8, 10].map(day => ({ ...base, subId: 'calendar-' + day, start: Date.parse(month + '-' + String(day).padStart(2, '0') + 'T08:00:00+08:00') / 1000, end: Date.parse(month + '-' + String(day).padStart(2, '0') + 'T09:00:00+08:00') / 1000 }));
test.beforeAll(async () => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), '智云助手 日历选择 '));
  app = await _electron.launch({ args: [path.resolve('.')], env: { ...process.env, ZHIYUN_TEST_DATA: folder }, timeout: 30000 });
  page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('body')).toContainText('隐私与数据');
  await app.evaluate(({ ipcMain }, rows) => {
    const store = new Map(); (globalThis as any).__selectionCopied = null;
    ipcMain.removeHandler('zhiyun:call');
    ipcMain.handle('zhiyun:call', async (_event, method, payload: any = {}) => {
      switch (method) {
        case 'session.restore': return { id: 'calendar-test', name: '测试同学', tenantId: 112 };
        case 'storage.get': return payload.key === 'privacy-consent' ? true : payload.key === 'pane-preferences' ? { regular: { slides: false, transcript: true, video: false, notes: false, ai: false, summary: false }, missing: {} } : store.get(payload.key) || null;
        case 'storage.set': store.set(payload.key, payload.value); return null;
        case 'courses.schedule': case 'courses.chapters': return rows;
        case 'courses.history': return { courses: rows, complete: true };
        case 'courses.permissions': return Object.fromEntries(rows.map(row => [row.subId, 'allowed']));
        case 'collection.get': return { favorite: [], later: [] };
        case 'lesson.open': return { course: payload.course, slides: [], lines: [{ id: 'first', t: 0, end: 30, text: '第一句课堂讲解。' }, { id: 'second', t: 30, end: 60, text: '第二句讲解与数字123。' }], live: false, sources: [] };
        case 'progress.get': return null;
        case 'clipboard.write': (globalThis as any).__selectionCopied = payload; return true;
        default: return null;
      }
    });
  }, courses);
});
test.afterAll(async () => { if (app) { const process = app.process(); await Promise.race([app.close().catch(() => {}), new Promise(resolve => setTimeout(resolve, 5000))]); if (process.exitCode === null) process.kill('SIGTERM'); } if (folder) fs.rmSync(folder, { recursive: true, force: true }); });
test('calendar keeps only current-month dates, marks known records, permits empty dates and changes complete month/year grids', async () => {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '所有课程', exact: true }).click();
  await page.getByRole('button', { name: '按日期', exact: true }).click();
  await page.getByRole('button', { name: /选择日期/ }).click();
  await expect(page.locator('.zy-calendar')).toBeVisible();
  expect(await page.locator('.zy-calendar-days > *').count()).toBe(42);
  const actualDates = await page.locator('.zy-calendar-day').evaluateAll(elements => elements.map(element => element.getAttribute('aria-label')));
  expect(actualDates.every(value => value?.startsWith(month + '-'))).toBe(true);
  await expect(page.locator('.zy-calendar-day.has-record')).toHaveCount(2);
  const original = await page.locator('.zy-calendar-navigation strong').innerText();
  await page.locator('.zy-calendar').getByRole('button', { name: '下一年', exact: true }).click();
  expect(await page.locator('.zy-calendar-navigation strong').innerText()).not.toBe(original);
  await page.locator('.zy-calendar').getByRole('button', { name: '上一年', exact: true }).click();
  await expect(page.locator('.zy-calendar-navigation strong')).toHaveText(original);
  await page.dispatchEvent('.zy-calendar-days', 'pointerdown', { pointerType: 'touch', pointerId: 82, clientX: 220, clientY: 220 });
  await page.dispatchEvent('.zy-calendar-days', 'pointermove', { pointerType: 'touch', pointerId: 82, clientX: 80, clientY: 225 });
  await page.dispatchEvent('.zy-calendar-days', 'pointerup', { pointerType: 'touch', pointerId: 82, clientX: 80, clientY: 225 });
  expect(await page.locator('.zy-calendar-navigation strong').innerText()).not.toBe(original);
  expect(await page.locator('.zy-calendar-days > *').count()).toBe(42);
  await page.locator('.zy-calendar').getByRole('button', { name: '上个月', exact: true }).click();
  await expect(page.locator('.zy-calendar-navigation strong')).toHaveText(original);
  await page.locator('.zy-calendar').getByRole('button', { name: month + '-03', exact: true }).click();
  await expect(page.locator('.zy-calendar')).toHaveCount(0);
  await expect(page.locator('.page-main')).toContainText('暂无课程');
});
test('transcript blank focus selects body without timestamps, copies one plain paragraph and outside tapping dismisses it', async () => {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '近两周课程', exact: true }).click();
  await page.getByRole('button', { name: '进入学习', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: '课堂转写', exact: true })).toBeVisible();
  await page.locator('.transcript-pane .pane-title').click();
  await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c');
  await expect.poll(async () => (await app.evaluate(() => (globalThis as any).__selectionCopied))?.text).toBe('第一句课堂讲解。 第二句讲解与数字123。');
  const copied = await app.evaluate(() => (globalThis as any).__selectionCopied);
  expect(copied.text).not.toMatch(/00:00|00:30|\n/);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() || '')).toBe('');
});
