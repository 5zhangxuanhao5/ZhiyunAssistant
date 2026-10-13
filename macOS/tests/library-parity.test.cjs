const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { resolve } = require('node:path');
const modulePromise = import(pathToFileURL(resolve(__dirname, '../web/parity-library.js')));
const course = (subId = '1') => ({ courseId: '100', subId, title: '课程', start: 1000, end: 2000 });
const delay = ms => new Promise(r => setTimeout(r, ms));
const gate = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
class FakeNative {
  constructor() { this.calls = []; this.files = new Map(); this.listeners = new Set(); this.sequence = 0; this.fail = new Set(); this.downloadGate = null; this.headGate = null; this.heads = 0; this.peakHeads = 0; }
  on(name, fn) { if (name === 'download') this.listeners.add(fn); return () => this.listeners.delete(fn); }
  call(action, p) {
    const id = 'op' + ++this.sequence; this.calls.push({ action, p, id });
    const result = (async () => {
      if (action === 'saveResource') {
        if (this.fail.has(p.url)) throw new Error('测试资源不可用');
        await Promise.resolve(); this.listeners.forEach(fn => fn({ id, bytes: 5, total: 10 }));
        if (this.downloadGate) await this.downloadGate.promise;
        this.files.set(p.lesson + '/' + p.name, 'downloaded'); return { name: p.name, size: 10 };
      }
      if (action === 'resourceSize') { this.heads++; this.peakHeads = Math.max(this.peakHeads, this.heads); try { if (this.headGate) await this.headGate.promise; return 10; } finally { this.heads--; } }
      if (action === 'writeOffline') { this.files.set(p.lesson + '/' + p.name, p.text); return true; }
      if (action === 'deleteOffline') { for (const key of this.files.keys()) if (key.startsWith(p.lesson + '/')) this.files.delete(key); return true; }
      if (action === 'cancelDownload') return true;
      throw new Error('unsupported: ' + action);
    })(); result.id = id; return result;
  }
}
async function harness(overrides = {}) {
  const { OfflineDownloads } = await modulePromise, native = overrides.native || new FakeNative(), store = new Map(), calls = { slides: 0, transcripts: 0, videos: 0, permission: 0 };
  const api = {
    async checkCurrentPermission() { calls.permission++; },
    async slides() { calls.slides++; return [{ id: 'a', t: 0, url: 'https://classroom.zju.edu.cn/a.jpg' }, { id: 'b', t: 10, url: 'https://classroom.zju.edu.cn/b.jpg' }]; },
    async transcripts() { calls.transcripts++; return [{ id: 't', t: 0, end: 10, text: '有效讲解' }]; },
    async videos() { calls.videos++; return [{ id: 'v', url: 'https://classroom.zju.edu.cn/v.mp4', live: false }]; },
    ...overrides.api,
  };
  const manager = new OfflineDownloads({ native, api, read: async key => store.get(key) || null, write: async (key, value) => store.set(key, structuredClone(value)), offlineURL: (key, name) => 'local/' + key + '/' + name, readManifest: async key => JSON.parse(native.files.get(key + '/manifest.json') || 'null'), retryDelay: () => 0, ...overrides.options });
  await manager.load([]); return { manager, native, store, calls };
}
async function close(t, manager) { t.after(() => manager.dispose()); }

test('restored queue uses canonical row and resumes that row', async t => {
  const { manager, store } = await harness(); await close(t, manager);
  await manager.load([{ key: '100-1', course: course(), options: { slides: true }, state: 'downloading', completed: {}, files: [] }]);
  const row = manager.rows[0]; assert.equal(row.state, 'paused'); assert.equal(manager.tasks[0], row); manager.resume(row.key); await manager.idle(); assert.equal(row.state, 'complete'); assert.equal(store.get('offline-index.json')[0].state, 'complete');
});

test('a fresh permission check occurs before any resource download', async t => {
  const { manager, native, calls } = await harness({ api: { async checkCurrentPermission() { throw new Error('没有课程访问权限'); } } }); await close(t, manager);
  const row = await manager.enqueue(course(), { slides: true }); await manager.idle(); assert.equal(row.state, 'failed'); assert.match(row.message, /没有课程访问权限/); assert.equal(native.calls.filter(c => c.action === 'saveResource').length, 0);
});

test('retry fetches only failed file and keeps successful transcript and image', async t => {
  const { manager, native, calls, store } = await harness(); await close(t, manager);
  native.fail.add('https://classroom.zju.edu.cn/b.jpg'); const row = await manager.enqueue(course(), { slides: true, transcript: true }); await manager.idle();
  assert.equal(row.state, 'failed'); const a = row.files.find(f => f.slideId === 'a'), transcript = row.files.find(f => f.type === 'transcript'), before = row.completed[a.name];
  assert.equal(native.calls.filter(c => c.action === 'saveResource' && c.p.name === a.name).length, 1); assert.ok(row.completed[transcript.name]); assert.match(row.missing.join(' '), /课件 .*测试资源不可用/);
  native.fail.clear(); await manager.retry(row.key); await manager.idle(); assert.equal(row.state, 'complete'); assert.equal(row.completed[a.name], before); assert.equal(calls.slides, 2); assert.equal(calls.transcripts, 1);
  assert.equal(native.calls.filter(c => c.action === 'saveResource' && c.p.name === a.name).length, 1); assert.equal(native.calls.filter(c => c.action === 'writeOffline' && c.p.name === 'transcript.json').length, 1); assert.equal(store.get('lesson-' + row.key + '.json').lines[0].text, '有效讲解');
});

test('partial save records the exact absent component and excludes failed slide', async t => {
  const { manager, native, store } = await harness({ api: { async videos() { return []; } } }); await close(t, manager);
  native.fail.add('https://classroom.zju.edu.cn/b.jpg'); const row = await manager.enqueue(course(), { slides: true, transcript: true, video: true }); await manager.idle(); const data = await manager.preserve(row.key);
  assert.equal(row.state, 'partial'); assert.equal(data.slides.length, 1); assert.equal(data.lines.length, 1); assert.equal(data.videos.length, 0); assert.match(row.missing.join(' '), /视频：平台未提供课程视频/); assert.match(row.missing.join(' '), /课件/); assert.equal(store.get('lesson-' + row.key + '.json').slides.length, 1);
});

test('deleting an in-flight resource waits for old commit before final cleanup', async t => {
  const native = new FakeNative(); native.downloadGate = gate(); const { manager, store } = await harness({ native }); await close(t, manager);
  const row = await manager.enqueue(course(), { slides: true }); while (!native.calls.some(c => c.action === 'saveResource')) await delay(1);
  const removal = manager.remove(row.key); native.downloadGate.resolve(); await removal; await manager.idle(); assert.equal(manager.rows.length, 0); assert.equal([...native.files.keys()].filter(k => k.startsWith(row.key + '/')).length, 0); assert.equal(store.get('lesson-' + row.key + '.json'), null);
});

test('pause immediately invalidates old completion and resume keeps canonical identity', async t => {
  const native = new FakeNative(); native.downloadGate = gate(); const { manager } = await harness({ native }); await close(t, manager);
  const row = await manager.enqueue(course(), { slides: true }); while (!native.calls.some(c => c.action === 'saveResource')) await delay(1);
  manager.pause(row.key); manager.resume(row.key); native.downloadGate.resolve(); await manager.idle(); assert.equal(manager.find(row.key), row); assert.equal(row.state, 'complete'); assert.equal(manager.active.size, 0);
});

test('download begins while HEAD work is pending and never exceeds two HEAD calls', async t => {
  const native = new FakeNative(); native.headGate = gate(); const { manager } = await harness({ native }); await close(t, manager);
  await manager.enqueue(course('1'), { slides: true }); await manager.enqueue(course('2'), { slides: true });
  while (!native.calls.some(c => c.action === 'saveResource')) await delay(1); assert.ok(native.heads > 0); assert.ok(native.peakHeads <= 2); native.headGate.resolve(); await manager.idle(); await delay(10); assert.ok(native.peakHeads <= 2);
});

test('lesson concurrency and queue order remain adjustable independently', async t => {
  const native = new FakeNative(); native.downloadGate = gate(); const { manager } = await harness({ native }); await close(t, manager); manager.maxConcurrent = 1;
  const first = await manager.enqueue(course('1'), { slides: true }); const second = await manager.enqueue(course('2'), { slides: true }); const third = await manager.enqueue(course('3'), { slides: true });
  assert.equal(first.state, 'downloading'); assert.equal(second.state, 'waiting'); assert.equal(third.state, 'waiting'); manager.move(third.key, 'first'); assert.equal(manager.tasks[0], third); manager.pause(second.key); assert.equal(second.state, 'paused');
  native.downloadGate.resolve(); await manager.idle(); assert.equal(first.state, 'complete'); assert.equal(third.state, 'complete'); assert.equal(second.state, 'paused'); manager.resume(second.key); await manager.idle(); assert.equal(second.state, 'complete');
});

test('byte progress reflects actual completed resource sizes', async t => {
  const { manager } = await harness(); await close(t, manager); const row = await manager.enqueue(course(), { slides: true, transcript: true }); await manager.idle(); const transcript = row.files.find(f => f.type === 'transcript'); assert.equal(row.bytes, 20 + transcript.size); assert.equal(row.total, row.bytes); assert.equal(row.totalKnown, true);
});

test('account mismatches and duplicate legacy rows are not loaded', async t => {
  const { manager } = await harness({ options: { owner: 'user-A' } }); await close(t, manager);
  await manager.load([{ course: course(), owner: 'user-B', state: 'complete' }, { course: course('2'), owner: 'user-A', state: 'complete' }, { course: course('2'), owner: 'user-A', state: 'complete' }]); assert.equal(manager.rows.length, 1); assert.equal(manager.rows[0].key, '100-2');
});

test('HLS master stores independent audio and all references remain local', async () => {
  const { buildOfflineHLS } = await modulePromise; const base = 'https://classroom.zju.edu.cn/lecture/master.m3u8';
  const sources = new Map([[base, '#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="老师",DEFAULT=YES,URI="audio/list.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,AUDIO="audio"\nvideo/list.m3u8\n'], [new URL('audio/list.m3u8', base).href, '#EXTM3U\n#EXT-X-TARGETDURATION:5\n#EXTINF:5,\na.aac\n#EXT-X-ENDLIST\n'], [new URL('video/list.m3u8', base).href, '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXT-X-TARGETDURATION:5\n#EXTINF:5,\nv.m4s\n#EXT-X-ENDLIST\n']]);
  const graph = await buildOfflineHLS(base, { readText: async url => sources.get(url) }); const names = new Set(graph.files.map(f => f.name)); assert.equal(graph.entry, 'video.m3u8'); assert.ok(graph.files.some(f => /a\.aac$/.test(f.url || ''))); assert.ok(graph.files.some(f => /init\.mp4$/.test(f.url || '')));
  for (const file of graph.files.filter(f => f.text)) { assert.ok(!/https?:/.test(file.text)); for (const match of file.text.matchAll(/URI="([^"]+)"/g)) assert.ok(names.has(match[1])); for (const line of file.text.split('\n').filter(line => line && !line.startsWith('#'))) assert.ok(names.has(line)); }
});

test('rolling live playlist is refused rather than forged into ENDLIST', async () => { const { buildOfflineHLS } = await modulePromise; await assert.rejects(buildOfflineHLS('https://classroom.zju.edu.cn/live.m3u8', { readText: async () => '#EXTM3U\n#EXTINF:5,\na.ts\n' }), /滚动直播流/); });

test('DRM SAMPLE-AES is refused and AES-128 keys stay explicit local dependencies', async () => {
  const { buildOfflineHLS } = await modulePromise; const url = 'https://classroom.zju.edu.cn/secure.m3u8';
  await assert.rejects(buildOfflineHLS(url, { readText: async () => '#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="key"\n#EXTINF:5,\na.ts\n#EXT-X-ENDLIST' }), /版权保护/);
  const graph = await buildOfflineHLS(url, { readText: async () => '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key",IV=0x00000000000000000000000000000001\n#EXTINF:5,\na.ts\n#EXT-X-ENDLIST' }); assert.ok(graph.files.some(f => f.name.endsWith('.key'))); assert.match(graph.files.find(f => f.text).text, /IV=0x/);
});

test('HLS byte ranges retain directives while repeated backing files download once', async () => { const { buildOfflineHLS } = await modulePromise; const graph = await buildOfflineHLS('https://classroom.zju.edu.cn/range.m3u8', { readText: async () => '#EXTM3U\n#EXT-X-BYTERANGE:100@0\n#EXTINF:5,\na.mp4\n#EXT-X-BYTERANGE:100@100\n#EXTINF:5,\na.mp4\n#EXT-X-ENDLIST' }); assert.equal(graph.files.filter(f => f.url).length, 1); assert.match(graph.files.find(f => f.text).text, /100@100/); });

test('HLS rejects unrelated resource hosts and nested circular manifests', async () => {
  const { buildOfflineHLS } = await modulePromise; await assert.rejects(buildOfflineHLS('https://classroom.zju.edu.cn/video.m3u8', { readText: async () => '#EXTM3U\n#EXTINF:5,\nhttps://unrelated.example/a.ts\n#EXT-X-ENDLIST' }), /地址不受支持/);
  await assert.rejects(buildOfflineHLS('https://classroom.zju.edu.cn/video.m3u8', { readText: async () => '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nvideo.m3u8' }), /循环/);
});

test('terminal download index is lightweight and retry restores local manifest lazily', async t => {
  const { manager, native, store, calls } = await harness(); await close(t, manager); native.fail.add('https://classroom.zju.edu.cn/b.jpg'); const row = await manager.enqueue(course(), { slides: true, transcript: true }); await manager.idle();
  const index = store.get('offline-index.json'); assert.equal(index[0].data, undefined); assert.equal(index[0].files.length, 0); assert.equal(Object.keys(index[0].completed).length, 0); assert.equal(index[0].manifestAvailable, true);
  const a = row.files.find(f => f.slideId === 'a'), downloaded = native.calls.filter(c => c.action === 'saveResource' && c.p.name === a.name).length; native.fail.clear();
  await manager.load(index); const restored = manager.rows[0]; assert.equal(restored.bytes, row.bytes); await manager.retry(restored.key); await manager.idle(); assert.equal(restored.state, 'complete'); assert.equal(native.calls.filter(c => c.action === 'saveResource' && c.p.name === a.name).length, downloaded); assert.equal(calls.transcripts, 1);
});
