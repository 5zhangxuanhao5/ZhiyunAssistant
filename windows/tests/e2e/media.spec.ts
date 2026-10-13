import '../../src/shared/bridge';
import { test, expect, _electron as electron, ElectronApplication, Page, Locator } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// These self-generated color bars/sine samples contain no campus course or user material.
// This tests actual Electron/Chromium decoding + application controls, not official server availability.
let app: ElectronApplication, page: Page, folder: string;
const fixtureRoot = fs.realpathSync(path.resolve('tests/fixtures/media'));
const fixtureFiles: Record<string, { url: string; type: string }> = {};
function registerFiles(directory: string) { for (const entry of fs.readdirSync(directory, { withFileTypes: true })) { const resolved = fs.realpathSync(path.join(directory, entry.name)); if (!resolved.startsWith(fixtureRoot + path.sep)) throw new Error('合成样本超出受控目录'); if (entry.isDirectory()) registerFiles(resolved); else if (entry.isFile() && /\.(mp4|m3u8|ts)$/.test(entry.name)) fixtureFiles[path.relative(fixtureRoot, resolved).split(path.sep).join('/')] = { url: pathToFileURL(resolved).href, type: entry.name.endsWith('.mp4') ? 'video/mp4' : entry.name.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t' }; } }
registerFiles(fixtureRoot);
const course = { subId: 'synthetic-media', courseId: 'synthetic-media-course', title: '合成媒体测试课程', teacher: '测试数据', room: '测试环境', term: '自生成测试资料', start: 1791508800, end: 1791508824, status: '6' };

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), '智云助手 合成媒体 '));
  app = await electron.launch({ args: [path.resolve('.')], env: { ...process.env, ZHIYUN_TEST_DATA: folder }, timeout: 30000 });
  page = await app.firstWindow();
  await page.addInitScript(() => {
    // Audio is present and decoded but synthetic testing should not produce sound on the user's Mac.
    const mute = () => document.querySelectorAll('video').forEach(video => { video.muted = true; });
    new MutationObserver(mute).observe(document, { childList: true, subtree: true }); mute();
  });
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('body')).toContainText('隐私与数据');
});
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus && page && !page.isClosed()) {
    await page.screenshot({ path: info.outputPath('synthetic-media-failure.png') }).catch(() => {});
    await fs.promises.writeFile(info.outputPath('synthetic-media-failure.json'), JSON.stringify(await page.evaluate(() => {
      const video = document.querySelector('video');
      return { text: document.body.innerText, video: video ? { source: video.currentSrc, time: video.currentTime, duration: video.duration, paused: video.paused, readyState: video.readyState, networkState: video.networkState, error: video.error?.message, rate: video.playbackRate, width: video.videoWidth, height: video.videoHeight } : null };
    }).catch(() => ({})), null, 2));
  }
});
test.afterAll(async () => {
  if (app) { const child = app.process(); await Promise.race([app.close().catch(() => {}), new Promise(resolve => setTimeout(resolve, 5000))]); if (child.exitCode === null) child.kill('SIGTERM'); }
  fs.rmSync(folder, { recursive: true, force: true });
});

async function start(format: 'mp4' | 'hls', resume?: number, waitReady=true,scheduledSeconds=24) {
  await app.evaluate(({ ipcMain, protocol, net }, setup) => {
    const { files, course: currentCourse, format, resume } = setup;
    const requests: string[] = []; (globalThis as any).__syntheticMediaRequests = requests;
    protocol.unhandle('zhiyun-resource');
    protocol.handle('zhiyun-resource', async request => {
      const url = new URL(request.url);
      if (url.hostname !== 'asset' || !url.pathname.startsWith('/synthetic-media/')) return new Response(null, { status: 404 });
      const relative = decodeURIComponent(url.pathname.slice('/synthetic-media/'.length));
      const entry = files[relative]; if (!entry) return new Response(null, { status: 404 });
      requests.push(relative);
      const fileResponse = await net.fetch(entry.url), bytes = Buffer.from(await fileResponse.arrayBuffer()), contentType = entry.type;
      const headers = new Headers({ 'Content-Type': contentType, 'Access-Control-Allow-Origin': 'zhiyun://app', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
      const range = request.headers.get('range');
      if (range) {
        const match = /^bytes=(\d+)-(\d*)$/.exec(range); if (!match) return new Response(null, { status: 416, headers });
        const begin = Number(match[1]), end = match[2] ? Math.min(bytes.length - 1, Number(match[2])) : bytes.length - 1;
        if (begin > end) return new Response(null, { status: 416, headers });
        headers.set('Content-Range', `bytes ${begin}-${end}/${bytes.length}`); headers.set('Content-Length', String(end - begin + 1));
        return new Response(bytes.subarray(begin, end + 1), { status: 206, headers });
      }
      headers.set('Content-Length', String(bytes.length)); return new Response(bytes, { headers });
    });
    const store = new Map<string, any>();
    const chosen = { id: format, title: format === 'mp4' ? 'MP4 合成教师画面' : 'HLS 合成教师画面', url: 'https://cmc.zju.edu.cn/synthetic-' + format, live: false, offset: 0, hls: format === 'hls' };
    const slides = [0, 6, 12, 18].map((t, i) => ({ id: 'synthetic-slide-' + i, t, url: 'https://cmc.zju.edu.cn/synthetic-' + i + '.png', thumb: '', note: '' }));
    const lines = slides.map((slide, i) => ({ id: 'synthetic-line-' + i, t: slide.t, end: slide.t + 5, text: '第 ' + (i + 1) + ' 段自生成测试转写。' }));
    const image = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#dcefff"/><text x="55" y="175" font-size="30">Synthetic media fixture</text></svg>').toString('base64');
    ipcMain.removeHandler('zhiyun:call');
    ipcMain.handle('zhiyun:call', async (_event, method, payload: any = {}) => {
      switch (method) {
        case 'session.restore': return { id: 'synthetic-account', name: '测试账户', tenantId: 112 };
        case 'storage.get': return payload.key === 'privacy-consent' ? true : payload.key === 'pane-preferences' ? { regular: { slides: true, transcript: true, video: true, notes: false, ai: false, summary: false }, missing: {} } : store.get(payload.key) || null;
        case 'storage.set': store.set(payload.key, payload.value); return null;
        case 'courses.schedule': case 'courses.chapters': return [currentCourse];
        case 'courses.permissions': return { [currentCourse.subId]: 'allowed' };
        case 'courses.history': return { courses: [currentCourse], complete: true };
        case 'collection.get': return { favorite: [], later: [] };
        case 'lesson.open': (globalThis as any).__savedMediaProgress=[];return { course: currentCourse, slides, lines, live: false, sources: [chosen, { ...chosen, id: 'duplicate-source' }] };
        case 'video.sources': return [chosen, { ...chosen, id: 'duplicate-source' }];
        case 'video.resolve': return { ...payload.source, url: 'zhiyun-resource://asset/synthetic-media/' + (format === 'mp4' ? 'test-pattern.mp4' : 'hls/index.m3u8'), hls: format === 'hls', offset: 0 };
        case 'resource.image': return image;
        case 'progress.get': if(resume!==undefined){await new Promise(resolve=>setTimeout(resolve,1200));return {seconds:resume,slideId:'synthetic-slide-2',followVideo:true}} return null;
        case 'progress.set': (globalThis as any).__savedMediaProgress.push(payload);return null;
        case 'ai.settings': return { configured: false, models: [] };
        case 'notes.list': return [];
        default: return null;
      }
    });
  }, { files: fixtureFiles, course:{...course,end:course.start+scheduledSeconds}, format, resume });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: '我的课堂', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '进入学习', exact: true }).click();
  if(!waitReady)return;
  await expect(page.locator('.video-pane video')).toBeVisible();
  await expect.poll(() => page.locator('.video-pane video').evaluate((element: HTMLVideoElement) => ({ ready: element.readyState >= 3, width: element.videoWidth, height: element.videoHeight, error: element.error?.code || 0 }))).toEqual({ ready: true, width: 640, height: 360, error: 0 });
}
async function videoTime() { return page.locator('.video-pane video').evaluate((video: HTMLVideoElement) => video.currentTime); }
async function pause() { const button = page.getByRole('button', { name: '暂停', exact: true }); if (await button.count()) await button.click(); await expect.poll(() => page.locator('.video-pane video').evaluate((video: HTMLVideoElement) => video.paused)).toBe(true); }
async function nativeRange(locator: Locator, fraction: number) {
  const box = await locator.boundingBox(); if (!box) throw new Error('范围控件不可见');
  await page.mouse.move(box.x + 8 + (box.width - 16) * fraction, box.y + box.height / 2); await page.mouse.down(); await page.waitForTimeout(120); await page.mouse.up();
}

test('MP4 really decodes video/audio, advances time, seeks by native range and uses continuous speed', async () => {
  await start('mp4');
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  const before = await videoTime(); await expect.poll(videoTime).toBeGreaterThan(before + .5);
  const quality = await page.locator('.video-pane video').evaluate((video: HTMLVideoElement) => ({ frames: video.getVideoPlaybackQuality().totalVideoFrames, audioBytes: (video as any).webkitAudioDecodedByteCount })); expect(quality.frames).toBeGreaterThan(0); if (typeof quality.audioBytes === 'number') expect(quality.audioBytes).toBeGreaterThan(0);
  await expect(page.getByRole('combobox', { name: '视频机位', exact: true })).toHaveCount(0);
  await pause(); await nativeRange(page.getByRole('slider', { name: '播放进度', exact: true }), .25);
  await expect.poll(videoTime).toBeGreaterThan(5); await expect.poll(videoTime).toBeLessThan(7);
  await page.locator('.speed-control > button').click(); const speed = page.getByRole('slider', { name: '播放速度', exact: true });
  await speed.focus(); await speed.press('Home'); await expect.poll(() => page.locator('.video-pane video').evaluate((video: HTMLVideoElement) => video.playbackRate)).toBe(.1);
  await speed.press('End'); await expect.poll(() => page.locator('.video-pane video').evaluate((video: HTMLVideoElement) => video.playbackRate)).toBe(16);
  await nativeRange(speed, (2 - .1) / (16 - .1)); await expect.poll(() => page.locator('.video-pane video').evaluate((video: HTMLVideoElement) => video.playbackRate)).toBeGreaterThan(1.7);
  await page.locator('.speed-control > button').click(); await page.getByRole('button', { name: '播放', exact: true }).click(); const atTwo = await videoTime(); await expect.poll(videoTime).toBeGreaterThan(atTwo + 1);
  await expect(page.locator('.video-error')).toHaveCount(0);
});

test('HLS actually loads transport-stream fragments through the protocol and keeps playing behind overview', async () => {
  await start('hls'); const before = await videoTime(); await expect.poll(videoTime).toBeGreaterThan(before + .5);
  const requests = await app.evaluate(() => (globalThis as any).__syntheticMediaRequests as string[]); expect(requests).toContain('hls/index.m3u8'); expect(requests.some(value => value.endsWith('.ts'))).toBe(true);
  await page.getByRole('button', { name: '概览', exact: true }).click(); await expect(page.getByRole('dialog', { name: '课程概览', exact: true })).toBeVisible();
  const behind = await videoTime(); await expect.poll(videoTime).toBeGreaterThan(behind + .5); await expect.poll(() => page.locator('.video-pane video').evaluate((video: HTMLVideoElement) => video.paused)).toBe(false);
  await page.getByRole('button', { name: '完成', exact: true }).click(); await expect(page.getByRole('dialog', { name: '课程概览', exact: true })).toHaveCount(0);
  await pause(); await nativeRange(page.getByRole('slider', { name: '播放进度', exact: true }), .55); await expect.poll(videoTime).toBeGreaterThan(12); await expect.poll(videoTime).toBeLessThan(14.5); await expect(page.locator('.video-error')).toHaveCount(0);
});

test('video keyboard focus seeks fifteen seconds and Space pauses/resumes the real player', async () => {
  await start('mp4'); await pause(); await nativeRange(page.getByRole('slider', { name: '播放进度', exact: true }), .12); const initial = await videoTime();
  await page.locator('.video-picture').click({ position: { x: 20, y: 20 } }); await page.keyboard.press('ArrowRight'); await expect.poll(videoTime).toBeGreaterThan(initial + 14.5); await expect.poll(videoTime).toBeLessThan(initial + 15.5);
  await page.keyboard.press('ArrowLeft'); await expect.poll(videoTime).toBeLessThan(initial + .5);
  await page.keyboard.press('Space'); await expect.poll(() => page.locator('.video-pane video').evaluate((video: HTMLVideoElement) => video.paused)).toBe(false);
  await page.keyboard.press('Space'); await expect.poll(() => page.locator('.video-pane video').evaluate((video: HTMLVideoElement) => video.paused)).toBe(true);
});

test('full screen covers the entire window, uses a black surround, hides controls and restores clean pane bounds', async () => {
  await start('mp4');
  const before = await page.locator('.video-pane').evaluate(element => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height }));
  await page.getByRole('button', { name: '全屏', exact: true }).click(); const full = page.locator('.free-pane.video-fullscreen'); await expect(full).toBeVisible();
  const geometry = await full.evaluate(element => { const box = element.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height, windowWidth: innerWidth, windowHeight: innerHeight }; });
  expect(Math.abs(geometry.x)).toBeLessThan(1.5); expect(Math.abs(geometry.y)).toBeLessThan(1.5); expect(Math.abs(geometry.width - geometry.windowWidth)).toBeLessThan(1.5); expect(Math.abs(geometry.height - geometry.windowHeight)).toBeLessThan(1.5);
  await expect(page.locator('.video-is-fullscreen .video-picture')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
  await expect(page.locator('.video-is-fullscreen .video-controls')).toHaveCSS('opacity', '0', { timeout: 6000 });
  await page.locator('.video-picture').click({ position: { x: 20, y: 60 } }); await expect(page.locator('.video-is-fullscreen .video-controls')).toHaveCSS('opacity', '1');
  await page.getByRole('button', { name: '退出全屏', exact: true }).click(); await expect(full).toHaveCount(0);
  const after = await page.locator('.video-pane').evaluate(element => { const box = element.getBoundingClientRect(), canvas = element.closest('.study-canvas')!.getBoundingClientRect(); return { width: box.width, height: box.height, inside: box.left >= canvas.left - 1 && box.top >= canvas.top - 1 && box.right <= canvas.right + 1 && box.bottom <= canvas.bottom + 1 }; });
  expect(Math.abs(after.width - before.width)).toBeLessThan(1.5); expect(Math.abs(after.height - before.height)).toBeLessThan(1.5); expect(after.inside).toBe(true);
  await expect(page.locator('.slides-pane .pane-title')).toHaveCSS('background-color', 'rgb(255, 255, 255)'); await expect(page.locator('.transcript-pane .pane-title')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  const blank = await page.locator('.study-canvas').evaluate(canvas => { const box = canvas.getBoundingClientRect(); for (let y = box.top + 2; y < box.bottom; y += 14) for (let x = box.left + 2; x < box.right; x += 14) { let element = document.elementFromPoint(x, y); if (!element || element.closest('.free-pane')) continue; while (element) { const color = getComputedStyle(element).backgroundColor; if (color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') return color; element = element.parentElement; } } return null; });
  expect(blank).not.toBeNull(); expect(blank).not.toBe('rgb(0, 0, 0)');
});

test('delayed saved progress is restored before the first decoded video frame can overwrite it', async()=>{
 await start('mp4',12);
 expect(await videoTime()).toBeGreaterThanOrEqual(11.9);
 await pause();
 await expect(page.locator('.slide-meta').first()).toContainText('第 3 页');
});

test('leaving before saved progress arrives does not replace it with the default zero position',async()=>{
 await start('mp4',12,false);
 await page.getByRole('button',{name:'返回',exact:true}).click();
 await expect(page.getByRole('heading',{name:'我的课堂',exact:true})).toBeVisible();
 await page.waitForTimeout(1400);
 expect(await app.evaluate(()=>(globalThis as any).__savedMediaProgress)).toEqual([]);
});


test('real video duration controls time navigation even when the timetable is shorter or longer',async()=>{
 await start('mp4',undefined,true,8);await pause();
 await nativeRange(page.getByRole('slider',{name:'播放进度',exact:true}),.12);
 const initial=await videoTime();await page.locator('.video-picture').click({position:{x:20,y:20}});
 await page.keyboard.press('ArrowRight');await expect.poll(videoTime).toBeGreaterThan(initial+14.5);
 await page.getByRole('button',{name:'跳转时间',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'跳转时间',exact:true})).toContainText('总时长 00:24');
 await page.getByRole('button',{name:'完成',exact:true}).click();
 await start('mp4',undefined,true,1200);await pause();
 await page.getByRole('button',{name:'跳转时间',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'跳转时间',exact:true})).toContainText('总时长 00:24');
 await page.getByRole('button',{name:'完成',exact:true}).click();
});

test('reading without video updates saved question and lesson time when jumping to another page',async()=>{
 await start('mp4');await pause();
 await page.locator('.study-toolbar').getByRole('button',{name:'✓ 视频',exact:true}).click();
 await expect(page.locator('video')).toHaveCount(0);
 await page.getByRole('button',{name:'跳转页数',exact:true}).click();
 await page.getByRole('dialog',{name:'跳转页数',exact:true}).getByRole('spinbutton').fill('3');
 await page.getByRole('button',{name:'跳转',exact:true}).click();
 await expect(page.locator('.slide-meta').first()).toContainText('第 3 页');
 await page.getByRole('button',{name:'返回',exact:true}).click();
 await expect(page.getByRole('heading',{name:'我的课堂',exact:true})).toBeVisible();
 const saved=await app.evaluate(()=>(globalThis as any).__savedMediaProgress);
 expect(saved.at(-1).seconds).toBe(12);expect(saved.at(-1).slideId).toBe('synthetic-slide-2');
});
