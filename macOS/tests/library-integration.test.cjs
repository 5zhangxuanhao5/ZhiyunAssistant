const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '../web');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function deferred() { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; }
async function runtime(t) {
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), { url: 'http://127.0.0.1:5000/token/index.html', pretendToBeVisual: true });
  const timers = new Set(); const timer = (fn, ms, ...args) => { const id = setTimeout(() => { timers.delete(id); fn(...args); }, ms); timers.add(id); return id; }; const cancelTimer = id => { clearTimeout(id); timers.delete(id); };
  const win = dom.window, storage = new Map(), files = new Map(), calls = [], events = new Map(); let sequence = 0, owner = 'fixture', blocked = null; const failedURLs = new Set();
  win.native = {
    call(action, p = {}) {
      const id = 'op-' + ++sequence; calls.push({ action, params: p, id }); const scope = owner;
      const promise = (async () => {
        if (action === 'read') return storage.get(scope + '|' + p.key) || '';
        if (action === 'write') { storage.set(scope + '|' + p.key, p.text); return true; }
        if (action === 'account') { owner = p.id; return true; }
        if (action === 'saveResource') {
          if (failedURLs.has(p.url)) throw new Error('测试资源不可用');
          await Promise.resolve(); for (const fn of events.get('download') || []) fn({ id, bytes: 512, total: 1024 });
          if (blocked) await blocked.promise; files.set(p.lesson + '/' + p.name, 'resource'); return { name: p.name, size: 1024 };
        }
        if (action === 'resourceSize') return 1024;
        if (action === 'writeOffline') { files.set(p.lesson + '/' + p.name, p.text); return true; }
        if (action === 'deleteOffline') { for (const key of files.keys()) if (key.startsWith(p.lesson + '/')) files.delete(key); return true; }
        if (action === 'secret' || action === 'identity') return '';
        return true;
      })(); promise.id = id; return promise;
    },
    on(name, fn) { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(fn); return () => events.get(name).delete(fn); },
  };
  Object.defineProperty(win.HTMLElement.prototype, 'clientWidth', { get() { return 1100; } }); Object.defineProperty(win.HTMLElement.prototype, 'clientHeight', { get() { return 680; } });
  win.HTMLElement.prototype.scrollIntoView = () => {}; win.HTMLMediaElement.prototype.pause = () => {}; win.HTMLMediaElement.prototype.load = () => {}; win.HTMLMediaElement.prototype.play = () => Promise.resolve(); win.document.execCommand = () => true;
  const context = vm.createContext({ window: win, document: win.document, location: win.location, console, Map, Set, URL, Array, Date, Error, Uint8Array, DataView, ArrayBuffer, TextEncoder, Number, JSON, Math, Promise, innerWidth: 1400, innerHeight: 900, confirm: () => true, prompt: () => null, clearTimeout: cancelTimer, setTimeout: timer, clearInterval, setInterval: () => 0, ResizeObserver: class { observe() {} disconnect() {} }, requestAnimationFrame: fn => timer(fn, 0), cancelAnimationFrame: cancelTimer, Image: class { set src(v) {} }, fetch: async () => ({ ok: true, text: async () => '', blob: async () => new win.Blob([]) }), FileReader: win.FileReader, CSS: { escape: x => x }, performance });
  const modules = new Map();
  function load(file) {
    if (modules.has(file)) return modules.get(file); let source = fs.readFileSync(file, 'utf8');
    if (file.endsWith('/app.js')) source = source.replace(/\nboot\(\);/, '') + `\nexport const fixture = { api, bindOfflineDownloads, enqueue, runQueue, pauseJob, resumeJob, deleteJob, showOffline, updateDownloadRow, manageOffline, logout, setup(owner='fixture'){account={id:owner};page='offline';prefs={panes:['slides','transcript'],downloadConcurrency:2};}, queue:()=>offlineDownloads,state:()=>({library,jobs,account,page}),setAccount(id){account={id};},setRows(rows){library=rows},setConcurrency(n){concurrency=n} };`;
    const module = new vm.SourceTextModule(source, { context, identifier: file }); modules.set(file, module); return module;
  }
  const module = load(path.join(root, 'app.js')); await module.link((specifier,parent)=>load(path.resolve(path.dirname(parent.identifier),specifier))); await module.evaluate(); const app = module.namespace.fixture; app.setup();
  const course = { courseId: '100', subId: '1', title: '测试课程', start: 1700000000, end: 1700003600, status: '6' };
  const bind = async rows => {
    const queue = await app.bindOfflineDownloads(rows || []); queue.retryDelay = () => 0;
    queue.api.checkCurrentPermission = async () => {};
    queue.api.slides = async () => [{ id: 'a', t: 0, url: 'https://classroom.zju.edu.cn/a.jpg' }, { id: 'b', t: 10, url: 'https://classroom.zju.edu.cn/b.jpg' }];
    queue.api.transcripts = async () => [{ id: 't', t: 0, end: 10, text: '转写完整保留' }]; queue.api.videos = async () => [];
    await delay(2); return queue;
  };
  t.after(async () => { if (blocked) blocked.resolve(); await app.queue()?.dispose(); await delay(3); for (const id of timers) cancelTimer(id); dom.window.close(); });
  return { win, app, bind, course, calls, storage, files, failedURLs, block() { blocked = deferred(); return blocked; }, async owner(id) { await win.native.call('account', { id }); app.setAccount(id); } };
}

test('app binding loads canonical paused jobs and uses an independent course API', async t => {
  const r = await runtime(t), queue = await r.bind([{ course: r.course, state: 'downloading', options: { slides: true }, files: [], completed: {} }]);
  assert.notEqual(queue.api, r.app.api); assert.equal(r.app.state().library[0], queue.rows[0]); assert.equal(r.app.state().jobs[0], queue.tasks[0]); assert.equal(queue.rows[0].state, 'paused');
});

test('actual offline buttons pause and resume the canonical queued course', async t => {
  const r = await runtime(t), queue = await r.bind(), hold = r.block(); const row = await r.app.enqueue(r.course, { slides: true });
  while (!r.calls.some(c => c.action === 'saveResource')) await delay(1); r.app.showOffline();
  const pause = [...r.win.document.querySelectorAll('[data-job] button')].find(button => button.textContent === '暂停本节'); pause.click(); await delay(1); assert.equal(row.state, 'paused');
  await delay(2); const resume = [...r.win.document.querySelectorAll('[data-job] button')].find(button => button.textContent === '继续本节'); assert.ok(resume); resume.click(); hold.resolve(); await queue.idle(); await delay(3); assert.equal(row.state, 'complete'); assert.ok(r.win.document.querySelector('[data-job] button.primary'));
});

test('offline file-size progress stays indeterminate until total is known', async t => {
  const r = await runtime(t), queue = await r.bind([{ course: r.course, state: 'paused', options: { slides: true }, completed: {}, files: [] }]); const row = queue.rows[0]; r.app.showOffline();
  row.bytes = 1024; row.inFlight = 512; row.total = 2048; row.totalKnown = false; r.app.updateDownloadRow(row); assert.equal(r.win.document.querySelector('progress').hasAttribute('value'), false); assert.match(r.win.document.querySelector('[data-job-bytes]').textContent, /已下载/);
  row.totalKnown = true; r.app.updateDownloadRow(row); assert.equal(r.win.document.querySelector('progress').value, 1536); assert.equal(r.win.document.querySelector('progress').max, 2048); assert.match(r.win.document.querySelector('[data-job-bytes]').textContent, /\//);
});

test('app queue concurrency choice reaches scheduler and persists setting', async t => {
  const r = await runtime(t), queue = await r.bind(); r.app.setConcurrency(4); await r.app.runQueue(); assert.equal(queue.maxConcurrent, 4); assert.equal(JSON.parse(r.storage.get('fixture|prefs.json')).downloadConcurrency, 4);
});

test('retry and partial-save UI preserve exact missing details and successful transcript', async t => {
  const r = await runtime(t), queue = await r.bind(); r.failedURLs.add('https://classroom.zju.edu.cn/b.jpg'); const row = await r.app.enqueue(r.course, { slides: true, transcript: true }); await queue.idle(); await delay(3);
  const save = [...r.win.document.querySelectorAll('[data-job] button')].find(button => button.textContent === '保存可用内容'); save.click(); await delay(5); assert.equal(row.state, 'partial'); assert.match(r.win.document.querySelector('.error-text').textContent, /课件 .*测试资源不可用/); assert.equal(JSON.parse(r.storage.get('fixture|lesson-100-1.json')).lines[0].text, '转写完整保留');
  const firstName = row.files.find(f => f.slideId === 'a').name; r.failedURLs.clear(); const retry = [...r.win.document.querySelectorAll('[data-job] button')].find(button => button.textContent === '重试失败内容'); retry.click(); await delay(3); await queue.idle(); assert.equal(row.state, 'complete'); assert.equal(r.calls.filter(c => c.action === 'saveResource' && c.params.name === firstName).length, 1);
});

test('actual delete button removes completed files and saved lesson atomically', async t => {
  const r = await runtime(t), queue = await r.bind(); const row = await r.app.enqueue(r.course, { slides: true }); await queue.idle(); r.app.showOffline(); const button = [...r.win.document.querySelectorAll('[data-job] button')].find(button => button.textContent === '删除'); button.click(); await delay(10); assert.equal(queue.rows.length, 0); assert.equal([...r.files.keys()].filter(key => key.startsWith('100-1/')).length, 0); assert.equal(JSON.parse(r.storage.get('fixture|lesson-100-1.json')), null);
});

test('logout closes scheduler before clearing account and hides offline data', async t => {
  const r = await runtime(t), queue = await r.bind(); await r.app.enqueue(r.course, { transcript: true }); await queue.idle(); await r.app.logout(); assert.equal(queue.disposed, true); assert.equal(r.app.state().account, null); assert.equal(r.app.state().library.length, 0); assert.equal(r.app.state().jobs.length, 0); assert.match(r.win.document.querySelector('.welcome').textContent, /登录智云课堂/); assert.ok(r.calls.some(c => c.action === 'logout'));
});

test('an old owner queue cannot write into a newly bound account', async t => {
  const r = await runtime(t), queue = await r.bind(); await r.owner('second'); await queue.write('offline-index.json', [{ secret: 'old owner course' }]); assert.equal(r.storage.has('second|offline-index.json'), false);
});
