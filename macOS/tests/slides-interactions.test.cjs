const test = require('node:test'), assert = require('node:assert/strict');
const { runtime } = require('./runtime-helper.cjs');
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+kLioAAAAASUVORK5CYII=';
const DATA = 'data:image/png;base64,' + PNG;
const tick = () => new Promise(resolve => setImmediate(resolve));
async function waitFor(fn, message) { for (let i = 0; i < 100; i++) { const result = fn(); if (result) return result; await new Promise(resolve => setTimeout(resolve, 2)); } throw new Error(message); }
async function start(t) {
  let r; const fetched = [];
  r = runtime({
    extraTestingNames: ['regroup', 'renderSlides', 'renderTranscript', 'fullImage', 'copySlides', 'prepareSlideImage', 'slideImageBytes'],
    replies: { prepareImageDrag: { token: 'native-image-token' } },
    fetch: async address => { fetched.push(String(address)); return { ok: true, blob: async () => new r.win.Blob([Buffer.from(PNG, 'base64')], { type: 'image/png' }) }; },
  });
  let clearDragCache; const nativeOn = r.win.native.on;
  r.win.native.on = (name, listener) => { if (name === 'imageDragCacheCleared') clearDragCache = listener; return nativeOn(name, listener); };
  const app = (await r.load('app.js')).testing; app.setup(); await app.enter(r.current);
  const slides = [0, 60, 120].map((time, i) => ({ id: 'page' + i, t: time, url: 'https://cmc.zju.edu.cn/page' + i + '.png' })), lines = slides.map(s => ({ id: 'line' + s.id, t: s.t, end: s.t + 59, text: s.id }));
  app.put({ slides, lines, index: 0, at: 0, prefs: { crop: false, duplicates: false, count: 2 } }); app.regroup(); app.renderSlides(); app.renderTranscript();
  t.after(() => { app.closeModal(); app.cleanup(); r.dom.window.close(); });
  const pointer = (node, type, pointerType = 'mouse') => { const event = new r.win.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 40, clientY: 30 }); Object.defineProperty(event, 'pointerType', { value: pointerType }); node.dispatchEvent(event); return event; };
  return { r, app, doc: r.win.document, fetched, pointer, clearDragCache: () => clearDragCache() };
}

test('focused clicked screenshot Cmd C copies actual PNG and contains no remote links', async t => {
  const { r, doc, fetched, pointer } = await start(t), image = doc.querySelectorAll('.slide-image')[1]; pointer(image, 'pointerdown'); image.click();
  const event = new r.win.KeyboardEvent('keydown', { key: 'c', metaKey: true, bubbles: true, cancelable: true }); image.dispatchEvent(event); assert.equal(event.defaultPrevented, true);
  const copied = await waitFor(() => r.calls.find(([action]) => action === 'copy'), 'image clipboard copy'); assert.equal(copied[1].image, DATA); assert.equal(copied[1].text, ''); assert.equal((copied[1].html.match(/<img /g) || []).length, 1); assert.ok(!copied[1].html.includes('http')); assert.ok(fetched.some(url => decodeURIComponent(url).includes('page1.png')));
});

test('native Edit Copy event and awaitable menu hook copy without a text selection', async t => {
  const { r, doc, pointer } = await start(t), image = doc.querySelector('.slide-image'); pointer(image, 'pointerdown'); const clipboard = {};
  const event = new r.win.Event('copy', { bubbles: true, cancelable: true }); Object.defineProperty(event, 'clipboardData', { value: { setData: (type, value) => clipboard[type] = value } }); doc.dispatchEvent(event); assert.equal(event.defaultPrevented, true); await waitFor(() => r.calls.some(([action]) => action === 'copy'), 'menu image copy'); assert.equal(clipboard['text/plain'], '');
  const handled = await r.win.zhiyunCopyImage(); assert.equal(handled, true); assert.equal(r.calls.filter(([action]) => action === 'copy').at(-1)[1].image, DATA);
});

test('full preview arrows and latest browse independently from lesson and transcript', async t => {
  const { r, app, doc } = await start(t), before = app.state(), transcript = [...doc.querySelectorAll('.caption-line')].map(n => n.dataset.t); app.fullImage(0); const body = doc.querySelector('#modalBody');
  const right = new r.win.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }); body.dispatchEvent(right); assert.equal(right.defaultPrevented, true); assert.equal(doc.querySelector('.slide-full-image').dataset.page, '1');
  const copy = new r.win.KeyboardEvent('keydown', { key: 'c', metaKey: true, bubbles: true, cancelable: true }); body.dispatchEvent(copy); const result = await waitFor(() => r.calls.find(([action]) => action === 'copy'), 'preview PNG copy'); assert.equal(result[1].image, DATA); assert.ok(result[1].html.includes('第 2 页课件'));
  const latest = [...doc.querySelectorAll('#modalToolbar button')].find(b => b.textContent === '回到最新'); latest.click(); await tick(); assert.equal(doc.querySelector('.slide-full-image').dataset.page, '2'); assert.equal(app.state().index, before.index); assert.equal(app.state().at, before.at); assert.deepEqual([...doc.querySelectorAll('.caption-line')].map(n => n.dataset.t), transcript);
  const left = new r.win.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }); body.dispatchEvent(left); assert.equal(doc.querySelector('.slide-full-image').dataset.page, '1');
});

test('full preview controls share one row and toolbar is restored on return', async t => {
  const { app, doc } = await start(t); app.fullImage(0); const toolbar = doc.querySelector('#modalToolbar'), close = doc.querySelector('#modalClose'); assert.equal(toolbar.parentElement, close.parentElement); assert.equal(close.textContent, '返回'); assert.deepEqual([...toolbar.querySelectorAll('button')].map(b => b.textContent), ['上一页', '下一页', '回到最新']); close.click(); assert.equal(toolbar.parentElement, doc.querySelector('.modal-shell')); assert.equal(close.textContent, '完成'); assert.equal(doc.querySelector('#modal').hidden, true);
});

test('page and time labels sit beside navigation controls rather than above each image', async t => {
  const { doc } = await start(t), mini = doc.querySelector('[data-pane=slides] .mini'); assert.equal(mini.querySelectorAll('.slide-page-meta').length, 2); assert.match(mini.querySelector('.slide-page-meta').textContent, /^第 1 页\s+00:00$/); assert.equal(doc.querySelectorAll('.slide-card .slide-meta').length, 0); assert.ok([...mini.querySelectorAll('button')].some(b => b.textContent === '最新'));
});

test('Ctrl A keeps all visible screenshot bytes while direct copy chooses one', async t => {
  const { r, doc, pointer } = await start(t), image = doc.querySelector('.slide-image'); pointer(image, 'pointerdown');
  image.dispatchEvent(new r.win.KeyboardEvent('keydown', { key: 'a', metaKey: true, bubbles: true, cancelable: true })); image.dispatchEvent(new r.win.KeyboardEvent('keydown', { key: 'c', metaKey: true, bubbles: true, cancelable: true })); const result = await waitFor(() => r.calls.find(([action]) => action === 'copy'), 'all page image copy'); assert.equal((result[1].html.match(/<img /g) || []).length, 2); assert.ok(!result[1].html.includes('http'));
});

test('native image hook leaves editor copy alone even after a slide had focus', async t => {
  const { r, doc, pointer } = await start(t); pointer(doc.querySelector('.slide-image'), 'pointerdown'); const input = doc.createElement('textarea'); doc.body.append(input); input.focus(); const before = r.calls.filter(([action]) => action === 'copy').length; assert.equal(await r.win.zhiyunCopyImage(), false); assert.equal(r.calls.filter(([action]) => action === 'copy').length, before);
});

test('ordinary and full preview drag expose binary File and cached native token without URLs', async t => {
  const { r, app, doc, pointer } = await start(t);
  for (const preview of [false, true]) {
    if (preview) app.fullImage(1); const image = preview ? doc.querySelector('.slide-full-image') : doc.querySelector('.slide-image'); await app.prepareSlideImage(image); await app.slideImageBytes.get(image).task.dragReady; pointer(image, 'pointerdown');
    const flavors = {}, files = [], transfer = { effectAllowed: '', clearData() { for (const key of Object.keys(flavors)) delete flavors[key]; }, setData(type, value) { flavors[type] = value; }, items: { add(file) { files.push(file); } } };
    flavors['text/uri-list'] = image.src; const event = new r.win.MouseEvent('dragstart', { bubbles: true, cancelable: true, clientX: 40, clientY: 30 }); Object.defineProperty(event, 'dataTransfer', { value: transfer }); image.dispatchEvent(event); assert.equal(event.defaultPrevented, true); assert.equal(files.length, 1); assert.equal(files[0].type, 'image/png'); assert.equal(files[0].size, Buffer.from(PNG, 'base64').length); assert.ok(flavors['text/html'].includes(DATA)); assert.ok(!flavors['text/html'].includes('http')); assert.equal(flavors['text/uri-list'], undefined);
    const drag = r.calls.filter(([action]) => action === 'dragImage').at(-1); assert.ok(drag); assert.equal(drag[1].token, 'native-image-token'); assert.equal(drag[1].image, undefined); assert.deepEqual([drag[1].x, drag[1].y], [40, 30]); const prepare = r.calls.filter(([action]) => action === 'prepareImageDrag').at(-1); assert.equal(prepare[1].image, DATA);
  }
});

test('touch swiping cannot begin an AppKit image drag or trigger note insertion', async t => {
  const { r, app, doc, pointer } = await start(t), image = doc.querySelector('.slide-image'); await app.prepareSlideImage(image); await app.slideImageBytes.get(image).task.dragReady; pointer(image, 'pointerdown', 'touch'); const event = new r.win.Event('dragstart', { bubbles: true, cancelable: true }); image.dispatchEvent(event); assert.equal(event.defaultPrevented, true); assert.equal(r.calls.some(([action]) => action === 'dragImage'), false);
});

test('native image cache clear invalidates displayed image tokens and prepares fresh bytes', async t => {
  const { r, app, doc, clearDragCache, pointer } = await start(t), image = doc.querySelector('.slide-image');
  await app.prepareSlideImage(image); await app.slideImageBytes.get(image).task.dragReady;
  const before = r.calls.filter(([action]) => action === 'prepareImageDrag').length;
  clearDragCache(); await app.prepareSlideImage(image);
  await waitFor(() => r.calls.filter(([action]) => action === 'prepareImageDrag').length === before + 1, 'fresh native image token'); await tick();
  pointer(image, 'pointerdown'); image.dispatchEvent(new r.win.Event('dragstart', { bubbles: true, cancelable: true }));
  assert.equal(r.calls.filter(([action]) => action === 'dragImage').at(-1)[1].token, 'native-image-token');
});
