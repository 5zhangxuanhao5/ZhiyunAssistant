import '../../src/shared/bridge';
import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
let app: ElectronApplication, page: Page, folder: string;
const course = { subId: 'panes-fixture', courseId: 'panes-course', title: '功能区测试课程', teacher: '测试教师', room: '测试教室', start: 1791508800, end: 1791516000, status: '6' };
test.beforeEach(async () => { folder = fs.mkdtempSync(path.join(os.tmpdir(), '智云助手功能区 ')); app = await electron.launch({ args: [path.resolve('.')], env: { ...process.env, ZHIYUN_TEST_DATA: folder }, timeout: 30000 }); page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await expect(page.locator('body')).toContainText('隐私与数据'); });
test.afterEach(async ({}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus && page && !page.isClosed()) {
    await page.screenshot({ path: testInfo.outputPath('pane-failure.png') }).catch(() => {});
    await fs.promises.writeFile(testInfo.outputPath('pane-failure.txt'), await page.locator('body').innerText().catch(() => ''));
  }
  if (app) {
    const child = app.process();
    await Promise.race([app.close().catch(() => {}), new Promise(resolve => setTimeout(resolve, 5000))]);
    if (child.exitCode === null) child.kill('SIGTERM');
  }
  if (folder) fs.rmSync(folder, { recursive: true, force: true });
});
async function start(kind: string, configured = true) {
  await app.evaluate(({ ipcMain }, options) => {
    const { course: currentCourse, kind, configured } = options;
    const store = new Map<string, any>();
    const atom = (value: string) => ({ id: 'a1', kind: 'text', value, at: 10, end: 10, sourceId: '', bold: false, italic: false, underline: false });
    let notes: any[] = [{ id: 'n1', title: '课堂笔记', course: currentCourse, atoms: [atom('前半后半')], anchors: [], savedAt: 123, blocks: [{ id: 'b1', source: 'notes', at: 10, end: 10, sourceId: '', atoms: [atom('前半后半')] }] }];
    if (kind === 'notes-missing') {
      const reference = { kind: 'question', courseId: currentCourse.subId, sessionId: 'deleted-conversation', turn: 0, at: 30 };
      const quote = { ...atom('保留在笔记中的原回答'), kind: 'question', reference };
      notes[0].blocks.push({ id: 'missing-source', source: 'question', at: 30, end: 30, sourceId: '', atoms: [quote] });
      notes[0].atoms.push(quote);
    }
    const sessions: any[] = [], summaries: any = { records: {}, positions: {}, scope: 'page' };
    const counters: any = { starts: 0, clipboard: [], inserts: [] }; (globalThis as any).__panesCounters = counters;
    const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=';
    const slides = [0, 60, 120].map((t, i) => ({ id: 'slide-' + i, t, url: 'https://cmc.zju.edu.cn/fixture-' + i + '.png', thumb: '', note: '' }));
    const lines = [{ id: 'line-0', t: 0, end: 55, text: '第一段课堂讲解。' }, { id: 'line-1', t: 60, end: 115, text: '第二段课堂讲解。' }, { id: 'line-2', t: 120, end: 175, text: '第三段课堂讲解。' }];
    const regular = { slides: false, transcript: kind === 'transcript', video: false, notes: ['notes', 'mixed', 'notes-missing'].includes(kind), ai: ['ai', 'mixed'].includes(kind), summary: kind === 'summary' };
    ipcMain.removeHandler('zhiyun:call');
    ipcMain.handle('zhiyun:call', async (event, method, payload: any = {}) => {
      switch (method) {
        case 'session.restore': return { id: 'panes-account', name: '测试同学', tenantId: 112 };
        case 'storage.get': return payload.key === 'privacy-consent' ? true : payload.key === 'pane-preferences' ? { regular, missing: {} } : store.get(payload.key) || null;
        case 'storage.set': store.set(payload.key, payload.value); return null;
        case 'courses.schedule': case 'courses.chapters': return [currentCourse];
        case 'courses.permissions': return { 'panes-fixture': 'allowed' };
        case 'courses.history': return { courses: [currentCourse], complete: true };
        case 'collection.get': return { favorite: [], later: [] };
        case 'lesson.open': return { course: currentCourse, slides, lines, live: false, sources: [] };
        case 'resource.image': return image;
        case 'progress.get': return null;
        case 'notes.list': return structuredClone(notes);
        case 'notes.save': notes = notes.filter(n => n.id !== payload.note.id); notes.push(payload.note); return payload.note;
        case 'ai.settings': return { configured, model: 'deepseek-flash', models: ['deepseek-flash', 'deepseek-pro'] };
        case 'ai.chatSessions': return structuredClone(sessions);
        case 'ai.saveChat': { const i = sessions.findIndex(s => s.id === payload.session.id); if (i < 0) sessions.push(payload.session); else sessions[i] = payload.session; return null; }
        case 'ai.start': {
          counters.starts++;
          const answer = '**核心知识**\n第一项 [00:05]。第二项 [01:10]。';
          for (let i = 1; i <= answer.length; i += 2) { event.sender.send('zhiyun:ai.stream', { requestId: payload.requestId, text: answer.slice(0, i) }); await new Promise(resolve => setTimeout(resolve, 5)); }
          return { answer, record: payload.kind === 'summary' ? { id: 'record-' + payload.currentId, answer, signature: 'test', savedAt: Date.now(), completed: true } : undefined };
        }
        case 'summary.get': return structuredClone(summaries);
        case 'summary.save': if (payload.record) summaries.records[payload.scope + ':' + payload.pageId] = payload.record; if (payload.position !== undefined) summaries.positions[payload.scope + ':' + payload.pageId + ':' + payload.recordId] = payload.position; return null;
        case 'clipboard.write': counters.clipboard.push(payload); return null;
        case 'download.list': return { entries: [], tasks: [], concurrency: 1 };
        default: return null;
      }
    });
  }, { course, kind, configured });
  await page.reload({waitUntil:'domcontentloaded'});
  await expect(page.getByRole('heading', { name: '我的课堂', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '进入学习', exact: true }).click();
  await expect(page.locator('.study-canvas')).toBeVisible();
}
test('notes type digits and arrows natively, preserve cursor and formatting', async () => {
  await start('notes');
  const editor = page.locator('.note-editor').first();
  await expect(editor).toHaveText('前半后半');
  await editor.click();
  await page.keyboard.press('End'); await page.keyboard.type('123'); await page.keyboard.press('ArrowLeft'); await page.keyboard.type('4');
  await expect(editor).toHaveText('前半后半1243');
  await editor.evaluate(element => { const selection=window.getSelection(),range=document.createRange();(element as HTMLElement).focus();range.setStart(element.firstChild!,0);range.collapse(true);selection!.removeAllRanges();selection!.addRange(range);document.dispatchEvent(new Event('selectionchange')); }); await page.keyboard.press('Shift+ArrowRight'); await page.keyboard.press('Shift+ArrowRight');
  await page.getByRole('button', { name: '加粗', exact: true }).click();
  await expect(editor.locator('b,strong')).toHaveText('前半');
  await editor.click(); await page.keyboard.press('End'); await page.keyboard.press('Enter');
  await expect(page.locator('.note-editor')).toHaveCount(2);
  await page.locator('.note-editor').last().pressSequentially('新的一行');
  await expect(page.locator('.note-editor').last()).toHaveText('新的一行');
});
test('notes second Ctrl+A cancels prior single-block range and selects the whole note', async () => {
  await start('notes');
  const editor = page.locator('.note-editor').first(); await editor.click();
  await page.keyboard.press('Control+a'); await page.keyboard.press('Control+a');
  await expect(page.locator('.notes-whole-selected')).toHaveCount(1);
  await page.getByRole('heading', { name: '课堂笔记', exact: true }).click();
  await expect(page.locator('.notes-whole-selected')).toHaveCount(0);
});
test('question Shift+Enter adds newline, IME confirmation does not send, normal Enter streams answer', async () => {
  await start('ai');
  const input = page.getByRole('textbox', { name: '问问这节课', exact: true });
  await input.fill('第一行 123'); await input.press('Shift+Enter'); await input.pressSequentially('第二行456');
  await expect(input).toHaveValue('第一行 123\n第二行456');
  await input.evaluate(element => { element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true })); });
  expect(await app.evaluate(() => (globalThis as any).__panesCounters.starts)).toBe(0);
  await input.evaluate(element => element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
  await input.press('Enter');
  await expect(page.locator('.answer-content')).toContainText('第二项');
  await expect(page.locator('.answer-content')).not.toContainText('**');
  expect(await app.evaluate(() => (globalThis as any).__panesCounters.starts)).toBe(1);
  const answerBox = await page.locator('.ai-pane .answer-content').boundingBox();
  await page.mouse.move(answerBox!.x + 2, answerBox!.y + 12); await page.mouse.down();
  await page.mouse.move(answerBox!.x + 220, answerBox!.y + 46, { steps: 12 }); await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString().length || 0)).toBeGreaterThan(5);
  await input.click();
  await page.getByRole('link').filter({ hasText: '00:05' }).click();
  await expect(page.getByRole('button', { name: '回到刚刚', exact: true })).toBeVisible();
});
test('mouse native answer selection preserves independent timestamps when inserting into note middle', async () => {
  await start('mixed');
  const editor = page.locator('.note-editor').first();
  await expect(editor).toHaveText('前半后半');
  await editor.evaluate(element => { const selection=window.getSelection(), range=document.createRange(); (element as HTMLElement).focus(); range.setStart(element.firstChild!,2); range.collapse(true); selection!.removeAllRanges(); selection!.addRange(range); document.dispatchEvent(new Event('selectionchange')); });
  const input = page.getByRole('textbox', { name: '问问这节课', exact: true });
  await input.fill('解释本页'); await input.press('Enter');
  await expect(page.locator('.answer-content')).toContainText('第二项');
  await page.locator('.ai-pane .answer-content').evaluate(element => { const range = document.createRange(); range.selectNodeContents(element); window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range); });
  await page.getByRole('button', { name: '插入到笔记', exact: true }).click();
  await expect(page.locator('.note-block')).toHaveCount(3);
  await expect(page.locator('.note-block').nth(0)).toContainText('前半');
  await expect(page.locator('.note-block').nth(1)).toContainText('核心知识');
  await expect(page.locator('.note-block').nth(2)).toContainText('后半');
  await expect(page.locator('.note-block').nth(1).locator('.time-link')).toHaveCount(2);
  await expect(page.locator('.note-block').nth(1).locator('.answer-content span').filter({ hasText: '核心知识' })).toHaveCSS('font-weight', '650');
});
test('unconfigured summary presents matching API setup without redundant controls', async () => {
  await start('summary', false);
  await expect(page.getByRole('heading', { name: '启用 AI 辅助学习', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: '速览范围', exact: true })).toHaveCount(0);
});
test('summary source times stay individually clickable and scope defaults single-page', async () => {
  await start('summary');
  await expect(page.locator('.summary-pane .answer-content')).toContainText('第二项');
  await expect(page.getByRole('button', { name: '所有页面速览', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.summary-pane .time-link')).toHaveCount(2);
  await page.locator('.summary-pane .time-link').last().click();
  await expect(page.getByRole('button', { name: '回到刚刚', exact: true })).toBeVisible();
});

test('cleared AI cache is explained before opening its source pane or changing selected features', async () => {
  await start('notes-missing');
  await page.getByRole('button', { name: '课程问答 · 00:30', exact: true }).click();
  await expect(page.getByText('相关缓存已被清理', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: '课程问答', exact: true })).toHaveCount(0);
  await expect(page.locator('.note-block').last()).toContainText('保留在笔记中的原回答');
});
