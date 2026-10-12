import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileIo, configureCompat, credentialledFetch, http, allowedNetworkUrl, fileUri } from '../src/desktop/compat';
import { LocalStore } from '../src/shared/services/LocalStore';
import { OfflineLibrary } from '../src/shared/services/OfflineLibrary';
import { key } from '../src/shared/services/LocalStore';
import { Course, groupPages } from '../src/shared/model/Timeline';
import { CourseCollections } from '../src/shared/model/CourseCollections';
import { SummaryCache } from '../src/shared/services/SummaryCache';
import { createServices } from '../src/desktop/services';
import JSZip from 'jszip';
import { blackBorderRegionAsync, compareScreenshotsAsync, disposeImageJobs } from '../src/desktop/image-jobs';
import { safeFilename } from '../src/shared/model/StudyFolders';
import { noteExportCourse, uniqueExportName } from '../src/shared/model/NoteExport';
const securityAdapters = { safeStorage: { isEncryptionAvailable: () => true, encryptString: (value: string) => { const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', Buffer.alloc(32, 41), iv); const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), body]); }, decryptString: (value: Buffer) => { const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.alloc(32, 41), value.subarray(0, 12)); decipher.setAuthTag(value.subarray(12, 28)); return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8'); } } };
const course: Course = { courseId: 'course-1', subId: 'lesson-1', title: '测试课程', teacher: '测试教师', room: '教室', start: 1791767700, end: 1791770700, status: '3' };
function fixture() { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyun-desktop-test-')); const context = { filesDir: path.join(root, 'data'), cacheDir: path.join(root, 'cache'), tempDir: path.join(root, 'cache') }; fs.mkdirSync(context.filesDir); fs.mkdirSync(context.cacheDir); return { root, context, store: new LocalStore(context, 'account-1'), cleanup: () => fs.rmSync(root, { recursive: true, force: true }) }; }
test('file adapters use runtime OS flags, preserve binary data, append and truncate correctly', () => {
 const { root, cleanup } = fixture(); try { const destination = path.join(root, '文件 with spaces.bin'); let file = fileIo.openSync(destination, fileIo.OpenMode.CREATE | fileIo.OpenMode.WRITE_ONLY | fileIo.OpenMode.TRUNC); fileIo.writeSync(file.fd, Uint8Array.from([0, 1, 254, 255])); fileIo.closeSync(file); file = fileIo.openSync(destination, fileIo.OpenMode.APPEND | fileIo.OpenMode.WRITE_ONLY); fileIo.writeSync(file.fd, Uint8Array.from([17])); fileIo.closeSync(file); assert.deepEqual([...fs.readFileSync(destination)], [0, 1, 254, 255, 17]); file = fileIo.openSync(destination, fileIo.OpenMode.WRITE_ONLY | fileIo.OpenMode.TRUNC); fileIo.writeSync(file.fd, '中文'); fileIo.closeSync(file); assert.equal(fs.readFileSync(destination, 'utf8'), '中文'); } finally { cleanup(); }
});
test('existing-only truncate preserves missing-file and read-only semantics with Unicode file URLs and binary read-write',()=>{
 const {root,cleanup}=fixture();try{
  const destination=path.join(root,'仅现存文件 读写.bin'),missing=path.join(root,'不可凭空创建.bin');
  assert.equal(fileIo.OpenMode.WRITE_ONLY,fs.constants.O_WRONLY);assert.equal(fileIo.OpenMode.READ_WRITE,fs.constants.O_RDWR);assert.equal(fileIo.OpenMode.TRUNC,fs.constants.O_TRUNC);assert.equal(fileIo.OpenMode.APPEND,fs.constants.O_APPEND);
  assert.throws(()=>fileIo.openSync(missing,fileIo.OpenMode.WRITE_ONLY|fileIo.OpenMode.TRUNC),(error:any)=>error.code==='ENOENT');assert.equal(fs.existsSync(missing),false);
  fs.writeFileSync(destination,Uint8Array.from([9,8,7,6]));
  assert.throws(()=>fileIo.openSync(destination,fileIo.OpenMode.READ_ONLY|fileIo.OpenMode.TRUNC));assert.deepEqual([...fs.readFileSync(destination)],[9,8,7,6]);
  const uri=fileUri.getUriFromPath(destination);let file=fileIo.openSync(uri,fileIo.OpenMode.READ_WRITE|fileIo.OpenMode.TRUNC);
  assert.equal(fileIo.statSync(file.fd).size,0);fileIo.writeSync(file.fd,Uint8Array.from([0,255,12]));fileIo.closeSync(file);
  file=fileIo.openSync(uri,fileIo.OpenMode.READ_ONLY);const bytes=new ArrayBuffer(3);assert.equal(fileIo.readSync(file.fd,bytes),3);fileIo.closeSync(file);assert.deepEqual([...new Uint8Array(bytes)],[0,255,12]);
 }finally{cleanup()}
});
test('download append descriptors can truncate a stale partial response and continue appending at the new end',()=>{
 const {root,cleanup}=fixture();try{const destination=path.join(root,'续传 partial.bin');fs.writeFileSync(destination,Uint8Array.from([1,2,3,4]));const file=fileIo.openSync(destination,fileIo.OpenMode.CREATE|fileIo.OpenMode.WRITE_ONLY|fileIo.OpenMode.APPEND);try{fileIo.truncateSync(file.fd,2);fileIo.writeSync(file.fd,Uint8Array.from([8,9]));}finally{fileIo.closeSync(file)}assert.deepEqual([...fs.readFileSync(destination)],[1,2,8,9]);}finally{cleanup()}
});
test('append truncation preserves write-only access, validates length and can reset a response to zero',()=>{
 const {root,cleanup}=fixture();try{
  const destination=path.join(root,'追加 权限.bin');fs.writeFileSync(destination,Uint8Array.from([1,2,3,4]));
  const file=fileIo.openSync(fileUri.getUriFromPath(destination),fileIo.OpenMode.WRITE_ONLY|fileIo.OpenMode.APPEND);
  try{
   assert.throws(()=>fileIo.readSync(file.fd,new ArrayBuffer(1)));
   assert.throws(()=>fileIo.truncateSync(file.fd,Number.NaN));assert.deepEqual([...fs.readFileSync(destination)],[1,2,3,4]);
   fileIo.truncateSync(file.fd,0);fileIo.writeSync(file.fd,Uint8Array.from([0,255,17]));
   assert.throws(()=>fileIo.readSync(file.fd,new ArrayBuffer(1)));
   assert.deepEqual([...fs.readFileSync(destination)],[0,255,17]);
  }finally{fileIo.closeSync(file)}
  const reader=fileIo.openSync(destination,fileIo.OpenMode.READ_ONLY);
  try{assert.throws(()=>fileIo.truncateSync(reader.fd,0));assert.deepEqual([...fs.readFileSync(destination)],[0,255,17]);}finally{fileIo.closeSync(reader)}
 }finally{cleanup()}
});
test('append truncation refuses a replaced path and leaves both files intact',()=>{
 const {root,cleanup}=fixture();try{
  const destination=path.join(root,'原文件.bin'),moved=path.join(root,'已移走 原文件.bin');fs.writeFileSync(destination,Uint8Array.from([1,2,3,4]));
  const file=fileIo.openSync(destination,fileIo.OpenMode.WRITE_ONLY|fileIo.OpenMode.APPEND);
  try{
   fs.renameSync(destination,moved);fs.writeFileSync(destination,Uint8Array.from([9,8,7]));
   assert.throws(()=>fileIo.truncateSync(file.fd,0),(error:any)=>error.code==='ESTALE');
   assert.deepEqual([...fs.readFileSync(destination)],[9,8,7]);assert.deepEqual([...fs.readFileSync(moved)],[1,2,3,4]);
   fileIo.writeSync(file.fd,Uint8Array.from([5]));assert.deepEqual([...fs.readFileSync(moved)],[1,2,3,4,5]);
  }finally{fileIo.closeSync(file)}
 }finally{cleanup()}
});
test('append truncation never creates a deleted destination and the existing descriptor stays usable',()=>{
 const {root,cleanup}=fixture();try{
  const destination=path.join(root,'失去路径的部分下载.bin');fs.writeFileSync(destination,Uint8Array.from([1,2,3]));
  const file=fileIo.openSync(destination,fileIo.OpenMode.CREATE|fileIo.OpenMode.WRITE_ONLY|fileIo.OpenMode.APPEND);
  try{
   fs.unlinkSync(destination);
   assert.throws(()=>fileIo.truncateSync(file.fd,0),(error:any)=>error.code==='ENOENT');assert.equal(fs.existsSync(destination),false);
   fileIo.writeSync(file.fd,Uint8Array.from([4]));assert.equal(fileIo.statSync(file.fd).size,4);
  }finally{fileIo.closeSync(file)}
 }finally{cleanup()}
});
test('persistent account isolation and permission freshness records survive reopening', () => {
 const { context, store, cleanup } = fixture(); try { store.saveJson('settings.json', '{"slides":false}'); store.savePermissions([{ courseId: course.courseId, subId: course.subId, permission: { live: true, video: false }, checkedAt: Date.now() / 1000 }]); const restored = new LocalStore(context, 'account-1'), other = new LocalStore(context, 'account-2'); assert.equal(restored.readJson('settings.json'), '{"slides":false}'); assert.equal(restored.permissionRecord(course.courseId, course.subId)?.permission.video, false); assert.equal(other.readJson('settings.json'), ''); assert.equal(other.permissionRecord(course.courseId, course.subId), undefined); } finally { cleanup(); }
});
test('storage rejects traversal and cache names cannot escape account folders', () => {
 const { store, cleanup } = fixture(); try { assert.throws(() => store.saveJson('../outside.json', 'secret')); assert.equal(store.readJson('../outside.json'), ''); assert.throws(() => store.cache.file('slides', course, '../outside.json')); assert.throws(() => store.cache.file('../slides', course, 'x.json')); } finally { cleanup(); }
});
test('cache clearing preserves offline download metadata, notes and learning progress', () => {
 const { store, cleanup } = fixture(); try { store.saveJson('offline-v1.json', '[{"course":{}}]'); store.saveJson('notes-' + key(course.subId) + '.json', '{"atoms":[]}'); store.saveJson('progress-' + key(course.subId) + '.json', '{"seconds":33}'); store.cache.save('transcript', course, 'timeline.json', '{"lines":[]}'); store.cache.flush(); assert.ok(store.cache.bytes('transcript') > 0); store.cache.clear('transcript'); assert.equal(store.cache.bytes('transcript'), 0); assert.ok(store.readJson('offline-v1.json')); assert.ok(store.readJson('notes-' + key(course.subId) + '.json')); assert.ok(store.readJson('progress-' + key(course.subId) + '.json')); } finally { cleanup(); }
});
test('cache revision prevents a completed in-flight answer from resurrecting cleared data', () => {
 const { store, cleanup } = fixture(); try { const revision = store.cache.revision('summary'); store.cache.clear('summary'); store.cache.save('summary', course, 'answer.json', 'stale answer', revision); assert.equal(store.cache.read('summary', course, 'answer.json'), ''); } finally { cleanup(); }
});
test('downloads interrupted by closing restart paused, retaining completed parts and queue order', () => {
 const { store, cleanup } = fixture(); try { const parts = [{ id: 'one', kind: 'video', total: 32, received: 32, done: true, path: 'test-part' }]; store.saveJson('download-jobs-v1.json', JSON.stringify([{ id: 'job', course, options: { video: true, slides: false, transcript: false }, state: 'running', progress: 0.5, message: '', parts }])); const library = new OfflineLibrary(store, () => {}); assert.equal(library.tasks()[0].state, 'paused'); assert.equal(library.tasks()[0].progress, 0.5); library.setConcurrency(4); assert.equal(library.concurrency(), 4); assert.equal(JSON.parse(store.readJson('download-jobs-v1.json'))[0].parts[0].done, true); library.pause(); } finally { cleanup(); }
});
test('deleting offline course removes its snapshots/video folder and preserves another course', async () => {
 const { store, cleanup } = fixture(); try { const other = { ...course, subId: 'lesson-2' }; const options = { video: true, slides: false, transcript: true }; store.saveJson('offline-v1.json', JSON.stringify([{ course, options, videoUri: '', savedAt: 1 }, { course: other, options, videoUri: '', savedAt: 2 }])); for (const row of [course, other]) { const folder = path.join(store.dataFolder, 'video-' + key(row.subId)); fs.mkdirSync(folder); fs.writeFileSync(path.join(folder, 'segment.ts'), 'data'); store.saveJson('offline-snapshot-' + key(row.subId) + '.json', JSON.stringify({ course: row, slides: [], lines: [], savedAt: 1 })); } const library = new OfflineLibrary(store, () => {}); await library.remove(course.subId); assert.equal(library.list().length, 1); assert.equal(library.list()[0].course.subId, other.subId); assert.equal(fs.existsSync(path.join(store.dataFolder, 'video-' + key(course.subId))), false); assert.equal(library.snapshot(course.subId), undefined); assert.ok(library.snapshot(other.subId)); } finally { cleanup(); }
});
test('adjacent duplicate slides combine transcript in chronological order; later repeats stay separate', () => {
 const slides = ['a', 'b', 'c', 'd'].map((id, i) => ({ id, t: i * 10, url: 'https://x.zju.edu.cn/' + id + '.jpg', thumb: '', note: '', duplicateOf: i === 1 ? 'a' : undefined, duplicateUrl: i === 1 ? 'https://x.zju.edu.cn/a.jpg' : undefined })); const lines = [15, 1, 35, 25].map(t => ({ id: String(t), t, end: t + 1, text: String(t) })); const groups = groupPages(slides, lines, true); assert.deepEqual(groups.map(group => group.slide.id), ['a', 'c', 'd']); assert.deepEqual(groups[0].lines.map(line => line.t), [1, 15]); assert.equal(groupPages(slides, lines, false).length, 4);
});
test('course favorites and watch later are independent and individual exclusion survives persistence', () => {
 const { store, cleanup } = fixture(); try { const collections = new CourseCollections(); collections.bind(store); collections.toggleCourse('favorite', course, [course, { ...course, subId: 'lesson-2' }]); collections.toggleLesson('later', course); collections.toggleLesson('favorite', course); const restored = new CourseCollections(); restored.bind(store); assert.equal(restored.hasLesson('favorite', course), false); assert.equal(restored.hasLesson('favorite', { ...course, subId: 'lesson-2' }), true); assert.equal(restored.hasLesson('later', course), true); assert.equal(restored.hasCourse('favorite', course.courseId), false); } finally { cleanup(); }
});
test('summary archive and reading position preserve referenced answer after later generation', () => {
 const { store, cleanup } = fixture(); try { const cache = new SummaryCache(store, course), revision = store.cache.revision('summary'); const first = cache.save('course', 'page', { answer: '第一版', signature: 'a', savedAt: 1 }, {}, revision); cache.savePosition('course', 'page', first.id!, 77); cache.save('course', 'page', { answer: '第二版', signature: 'b', savedAt: 2 }, { page: first }, revision); const restored = new SummaryCache(store, course); assert.equal(restored.record('course', 'page', first.id!)?.answer, '第一版'); assert.equal(restored.position('course', 'page', first.id!), 77); assert.equal(restored.lastScope(), 'course'); store.cache.flush(); } finally { cleanup(); }
});
test('network allowlist rejects local addresses, userinfo, insecure transports and unrelated services', () => {
 for (const url of ['http://classroom.zju.edu.cn/x', 'https://classroom.zju.edu.cn.evil.test/x', 'https://user@x.zju.edu.cn/x', 'https://127.0.0.1/x', 'file:///etc/passwd', 'https://x.zju.edu.cn:8443/x']) assert.throws(() => allowedNetworkUrl(url)); assert.equal(allowedNetworkUrl('https://api.deepseek.com/models').host, 'api.deepseek.com');
});
test('cross-origin official redirect strips authorization/cookies and cannot redirect to outside service', async () => {
 const calls: Array<{ url: string; headers: Headers }> = []; configureCompat({ fetch: async (url: string, options: any) => { calls.push({ url, headers: new Headers(options.headers) }); return calls.length === 1 ? new Response(null, { status: 302, headers: { location: 'https://assets.chinamcloud.com/file.jpg' } }) : new Response('ok'); } } as any, os.tmpdir()); await credentialledFetch('https://classroom.zju.edu.cn/file', { headers: { Authorization: 'Bearer secret', Cookie: 'secret=1' } }); assert.equal(calls[1].headers.get('authorization'), null); assert.equal(calls[1].headers.get('cookie'), null); configureCompat({ fetch: async () => new Response(null, { status: 302, headers: { location: 'https://evil.test/file' } }) } as any, os.tmpdir()); await assert.rejects(credentialledFetch('https://classroom.zju.edu.cn/file'));
});
test('stream events preserve Unicode split across chunks and propagate interrupted transfer failures', async () => {
 const bytes = new TextEncoder().encode('课堂内容'); configureCompat({ fetch: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes.slice(0, 4)); controller.enqueue(bytes.slice(4)); controller.close(); } })) } as any, os.tmpdir()); const request = http.createHttp(), received: Uint8Array[] = []; request.on('dataReceive', (buffer: ArrayBuffer) => received.push(new Uint8Array(buffer))); assert.equal(await request.requestInStream('https://classroom.zju.edu.cn/file'), 200); assert.equal(Buffer.concat(received).toString('utf8'), '课堂内容'); request.destroy(); configureCompat({ fetch: async () => new Response(new ReadableStream({ start(controller) { controller.error(new Error('interrupted')); } })) } as any, os.tmpdir()); const interrupted = http.createHttp(); await assert.rejects(interrupted.requestInStream('https://classroom.zju.edu.cn/file'), /interrupted/); interrupted.destroy();
});

function sessionFixture(root: string, fetcher: (url: string, options?: any) => Promise<Response>) {
 fs.writeFileSync(path.join(root, 'last-account.json'), JSON.stringify({ id: 'account-1', name: '测试账户', tenantId: 112 }));
 return { fetch: fetcher, cookies: { get: async () => [], set: async () => {}, remove: async () => {}, flushStore: async () => {} }, clearStorageData: async () => {}, clearCache: async () => {} } as any;
}
function apiFixture(url: string, permission = true): Response {
 const pathname = new URL(url).pathname;
 if (pathname.endsWith('/infosimple')) return Response.json({ params: { id: 'account-1', realname: '测试账户', tenant_id: 112 } });
 if (pathname.endsWith('/get-sub-info')) return Response.json({ code: 0, data: { sub_status: 3, start_at: course.start, end_at: course.end } });
 if (pathname.endsWith('/video-and-live-promission-by-user-id')) return Response.json({ code: 200, data: { [course.subId]: { live: permission, video: permission } } });
 if (pathname.endsWith('/search-ppt')) return Response.json({ code: 0, list: [{ id: 1, created_sec: 0, content: JSON.stringify({ pptimgurl: 'https://images.zju.edu.cn/page.png' }) }], total: 1 });
 if (pathname.endsWith('/search-trans-result')) return Response.json({ code: 0, list: [{ all_content: [{ BeginSec: 3, EndSec: 6, Text: '有序课堂转写' }] }] });
 return new Response('not found', { status: 404 });
}
test('desktop lesson respects fresh denial and never requests resource or alternate endpoint', async () => {
 const { root, cleanup } = fixture(); const calls: string[] = []; const backend = createServices(sessionFixture(root, async url => { calls.push(url); return apiFixture(url, false); }), root, () => {}, securityAdapters);
 try { await backend.handle('session.restore'); await assert.rejects(backend.handle('lesson.open', { course }), /访问权限/); assert.equal(calls.filter(url => /search-ppt|search-trans-result/.test(url)).length, 0); assert.equal(calls.some(url => url.includes('interactivemeta')), false); } finally { await backend.dispose(); cleanup(); }
});
test('offline network error retains logged-in account and exposes account-scoped downloads', async () => {
 const { root, cleanup } = fixture(); const backend = createServices(sessionFixture(root, async () => { throw new Error('network offline'); }), root, () => {}, securityAdapters);
 try { const account = await backend.handle('session.restore'); assert.equal(account.id, 'account-1'); assert.equal(account.offline, true); await backend.handle('storage.set', { key: 'preference', value: { video: false } }); assert.deepEqual(await backend.handle('storage.get', { key: 'preference' }), { video: false }); assert.deepEqual((await backend.handle('download.list')).entries, []); } finally { await backend.dispose(); cleanup(); }
});
test('authorized lesson obtains full server-side slide and transcript history and emits time-aligned data', async () => {
 const { root, cleanup } = fixture(); const events: any[] = []; const backend = createServices(sessionFixture(root, async url => apiFixture(url)), root, (name, value) => events.push({ name, value }), securityAdapters);
 try { await backend.handle('session.restore'); const lesson = await backend.handle('lesson.open', { course }); assert.equal(lesson.slides.length, 1); assert.equal(lesson.lines.length, 1); assert.equal(lesson.lines[0].t, 3); assert.equal(lesson.lines[0].timing, 'history'); assert.equal(events.some(event => event.name === 'lesson'), true); } finally { await backend.dispose(); cleanup(); }
});
test('resource protocol protects files and serves official HLS children through opaque tokens', async () => {
 const { root, cleanup } = fixture(); const backend = createServices(sessionFixture(root, async url => url.endsWith('index.m3u8') ? new Response('#EXTM3U\n#EXTINF:4,\nsegment.ts\n#EXT-X-ENDLIST\n', { headers: { 'content-type': 'application/vnd.apple.mpegurl' } }) : apiFixture(url)), root, () => {}, securityAdapters);
 try { await backend.handle('session.restore'); const resolved = await backend.handle('video.resolve', { course, source: { id: 'recording', title: '课程回放', live: false, offset: 0, url: 'https://videos.zju.edu.cn/index.m3u8' } }); assert.match(resolved.url, /^zhiyun-resource:\/\/asset\/[a-f0-9]{48}\//); const response = await backend.resolveResource(new Request(resolved.url)); const text = await response.text(); assert.match(text, /zhiyun-resource:\/\/asset\/[a-f0-9]{48}\/segment\.ts/); assert.equal(text.includes('videos.zju.edu.cn'), false); assert.equal((await backend.resolveResource(new Request('zhiyun-resource://asset/missing/file'))).status, 404); } finally { await backend.dispose(); cleanup(); }
});
test('privacy consent persists before login without permitting account-scoped storage', async () => {
 const { root, cleanup } = fixture(); const backend = createServices(sessionFixture(root, async url => apiFixture(url)), root, () => {}, securityAdapters);
 try { assert.equal(await backend.handle('storage.get', { key: 'privacy-consent' }), false); await backend.handle('storage.set', { key: 'privacy-consent', value: true }); assert.equal(await backend.handle('storage.get', { key: 'privacy-consent' }), true); await assert.rejects(backend.handle('storage.get', { key: 'notes' }), /登录/); } finally { await backend.dispose(); cleanup(); }
});
test('corrupt cache index and offline library metadata recover without crashing startup', () => {
 const { context, store, cleanup } = fixture(); try { store.saveJson('cache-index-v1.json', '{"not":"an array"}'); store.saveJson('cache-preferences.json', 'null'); store.saveJson('offline-v1.json', '{}'); store.saveJson('download-jobs-v1.json', '[null,{}, {"course":null}]'); const restored = new LocalStore(context, 'account-1'); assert.equal(restored.cache.enabled('slides'), true); assert.deepEqual(restored.cache.list('slides'), []); const library = new OfflineLibrary(restored, () => {}); assert.deepEqual(library.list(), []); assert.deepEqual(library.tasks(), []); } finally { cleanup(); }
});
test('note image blocks survive restart as fresh protected URLs and Markdown bundle keeps folder/picture names', async () => {
 const { root, cleanup } = fixture(); const picture = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQEBAEbGKTQAAAAASUVORK5CYII=', 'base64'); const session = sessionFixture(root, async url => url.endsWith('/page.png') ? new Response(picture, { headers: { 'content-type': 'image/png', 'content-length': String(picture.length) } }) : apiFixture(url)); let backend = createServices(session, root, () => {}, securityAdapters);
 try {
  await backend.handle('session.restore'); const uri = await backend.handle('resource.image', { url: 'https://images.zju.edu.cn/page.png', trim: false, course });
  const atom = { id: 'image', kind: 'image', value: uri, at: 0, end: 0, sourceId: '1', bold: false, italic: false, underline: false };
  const note = { id: 'default', title: '课堂笔记1', course: { ...course, term: '测试学期' }, atoms: [atom], blocks: [{ id: 'image-block', source: 'slides', at: 0, end: 0, sourceId: '1', atoms: [atom] }], anchors: [], savedAt: Date.now() };
  await backend.handle('notes.save', { note }); await backend.dispose(); backend = createServices(session, root, () => {}, securityAdapters); await backend.handle('session.restore'); const restored = (await backend.handle('notes.list', { course }))[0]; assert.match(restored.blocks[0].atoms[0].value, /^zhiyun-resource:/); assert.notEqual(restored.blocks[0].atoms[0].value, uri); const response = await backend.resolveResource(new Request(restored.blocks[0].atoms[0].value)); assert.equal(response.headers.get('content-type'), 'image/png'); assert.deepEqual(Buffer.from(await response.arrayBuffer()), picture);
  const exported = await backend.handle('notes.export', { noteIds: [course.subId + ':default'], format: 'markdown', bundle: true }), zip = await JSZip.loadAsync(exported.data), filenames = Object.keys(zip.files); assert.ok(filenames.includes('测试课程_测试教师_测试学期/2026-10-12/课堂笔记1.md')); assert.ok(filenames.some(name => name.endsWith('images/课堂笔记1_图片1.png')));
 } finally { await backend.dispose(); cleanup(); }
});
test('image worker handles black margins and conservative equality away from the main thread', async () => {
 try { const width = 128, height = 96, pixels = new Uint8Array(width * height * 4); for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const offset = (y * width + x) * 4; const brightness = x < 8 || x >= width - 8 ? 0 : 255; pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = brightness; pixels[offset + 3] = 255; } assert.deepEqual(await blackBorderRegionAsync(pixels.slice().buffer, width, height, width * 4), { x: 8, y: 0, width: 112, height }); assert.equal(await compareScreenshotsAsync(pixels.slice().buffer, pixels.slice().buffer, width, height, width * 4, width * 4), true); const changed = pixels.slice(); for (let y = 30; y < 55; y++) for (let x = 30; x < 55; x++) changed[(y * width + x) * 4] = 0; assert.equal(await compareScreenshotsAsync(pixels.slice().buffer, changed.buffer, width, height, width * 4, width * 4), false); } finally { await disposeImageJobs(); }
});
test('account restoration migrates plain legacy metadata into encrypted safe storage', async () => {
 const { root, cleanup } = fixture(); const backend = createServices(sessionFixture(root, async url => apiFixture(url)), root, () => {}, securityAdapters);
 try { await backend.handle('session.restore'); assert.equal(fs.existsSync(path.join(root, 'last-account.json')), false); const protectedData = fs.readFileSync(path.join(root, 'secrets', 'zhiyun-last-account-v1.bin')); assert.equal(protectedData.includes(Buffer.from('测试账户')), false); assert.equal(protectedData.includes(Buffer.from('account-1')), false); } finally { await backend.dispose(); cleanup(); }
});
test('cached local video implements normal/suffix ranges, invalid ranges, HEAD, zero size and cancellation', async () => {
 const { root, cleanup } = fixture(), saved = new LocalStore({ filesDir: path.join(root, 'data'), cacheDir: path.join(root, 'cache'), tempDir: path.join(root, 'cache') }, 'account-1'); saved.saveJson('offline-snapshot-' + key(course.subId) + '.json', JSON.stringify({ course, slides: [], lines: [], savedAt: 1 })); const destination = path.join(saved.dataFolder, 'video-' + key(course.subId)); fs.mkdirSync(destination); const video = path.join(destination, 'video.mp4'); fs.writeFileSync(video, Buffer.from('0123456789')); saved.saveJson('offline-v1.json', JSON.stringify([{ course, options: { video: true, slides: false, transcript: false }, videoUri: fileUri.getUriFromPath(video), videoOffset: 0, savedAt: 1, partial: false, bytes: 10 }])); const backend = createServices(sessionFixture(root, async url => apiFixture(url)), root, () => {}, securityAdapters);
 try { await backend.handle('session.restore'); const lesson = await backend.handle('lesson.open', { course, offline: true }), url = lesson.sources[0].url;
  const range = await backend.resolveResource(new Request(url, { headers: { range: 'bytes=2-5' } })); assert.equal(range.status, 206); assert.equal(range.headers.get('content-range'), 'bytes 2-5/10'); assert.equal(await range.text(), '2345'); const suffix = await backend.resolveResource(new Request(url, { headers: { range: 'bytes=-3' } })); assert.equal(await suffix.text(), '789'); assert.equal((await backend.resolveResource(new Request(url, { headers: { range: 'bytes=20-' } }))).status, 416); const head = await backend.resolveResource(new Request(url, { method: 'HEAD' })); assert.equal(await head.text(), ''); assert.equal(head.headers.get('content-length'), '10'); const controller = new AbortController(); controller.abort(); assert.equal((await backend.resolveResource(new Request(url, { signal: controller.signal }))).status, 499); fs.writeFileSync(video, ''); const zero = await backend.resolveResource(new Request(url)); assert.equal(zero.status, 200); assert.equal(await zero.text(), '');
 } finally { await backend.dispose(); cleanup(); }
});
test('runtime inventory includes Chromium caches and clear-all retains secure session and offline files', async () => {
 const { root, cleanup } = fixture(); const target = path.join(root, 'Partitions', 'zhiyun-campus'); for (const folder of [path.join(root, 'GPUCache'), path.join(root, 'Code Cache'), path.join(target, 'Cache')]) { fs.mkdirSync(folder, { recursive: true }); fs.writeFileSync(path.join(folder, 'data.bin'), 'cache payload'); } fs.mkdirSync(path.join(target, 'Network')); fs.writeFileSync(path.join(target, 'Network', 'Cookies'), 'protected cookies'); const backend = createServices(sessionFixture(root, async url => apiFixture(url)), root, () => {}, securityAdapters);
 try { await backend.handle('session.restore'); const list = await backend.handle('cache.list'), runtime = list.find((entry: any) => entry.kind === 'runtime'); assert.ok(runtime.bytes >= 39); const detail = await backend.handle('cache.detail', { kind: 'runtime' }); assert.ok(detail.some((entry: any) => entry.label.includes('网页脚本缓存'))); await backend.handle('cache.clearAll'); assert.equal(fs.existsSync(path.join(root, 'GPUCache')), false); assert.equal(fs.existsSync(path.join(target, 'Cache')), false); assert.equal(fs.existsSync(path.join(target, 'Network', 'Cookies')), true); assert.equal(fs.existsSync(path.join(root, 'secrets', 'zhiyun-last-account-v1.bin')), true);
 } finally { await backend.dispose(); cleanup(); }
});
test('schedule range splits into seven-day authorized requests and deduplicates lessons', async () => {
 const { root, cleanup } = fixture(), windows: string[] = []; const backend = createServices(sessionFixture(root, async url => { if (url.includes('get-week-schedules')) { const query = new URL(url).searchParams; windows.push(query.get('start_at')! + ':' + query.get('end_at')!); return Response.json({ code: 0, result: { list: [{ course: [{ course_id: course.courseId, sub_id: course.subId, start_at: course.start, end_at: course.end, course_title: course.title }] }] } }); } return apiFixture(url); }), root, () => {}, securityAdapters);
 try { await backend.handle('session.restore'); const rows = await backend.handle('courses.schedule', { start: '2026-09-20', end: '2026-10-04' }); assert.equal(rows.length, 1); assert.deepEqual(windows.sort(), ['2026-09-20:2026-09-26', '2026-09-27:2026-10-03', '2026-10-04:2026-10-04']); await assert.rejects(backend.handle('courses.schedule', { start: '2024-01-01', end: '2026-10-04' }), /一年内/); } finally { await backend.dispose(); cleanup(); }
});
test('history responds with saved records immediately while official scan remains pending', async () => {
 const { root, cleanup } = fixture(), cached = new LocalStore({ filesDir: path.join(root, 'data'), cacheDir: path.join(root, 'cache'), tempDir: path.join(root, 'cache') }, 'account-1'); cached.saveMyAttendance([course], '2026-10-01', true); let release: (() => void) | undefined; const backend = createServices(sessionFixture(root, async url => { if (url.includes('get-week-schedules')) { await new Promise<void>(resolve => { release = resolve; }); return Response.json({ code: 0, result: { list: [] } }); } return apiFixture(url); }), root, () => {}, securityAdapters);
 try { await backend.handle('session.restore'); const state = await backend.handle('courses.history'); assert.equal(state.scanning, true); assert.equal(state.courses[0].subId, course.subId); } finally { release?.(); await backend.dispose(); cleanup(); }
});
test('original course image URL insertion copies the already displayed asset into persistent note images', async () => {
 const { root, cleanup } = fixture(), picture = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQEBAEbGKTQAAAAASUVORK5CYII=', 'base64'); let imageRequests = 0; const backend = createServices(sessionFixture(root, async url => { if (url.endsWith('/page.png')) { imageRequests++; return new Response(picture, { headers: { 'content-type': 'image/png', 'content-length': String(picture.length) } }); } return apiFixture(url); }), root, () => {}, securityAdapters);
 try { await backend.handle('session.restore'); await backend.handle('resource.image', { url: 'https://images.zju.edu.cn/page.png', trim: false, course }); const atom = { id: 'image', kind: 'image', value: 'https://images.zju.edu.cn/page.png', at: 1, end: 1, sourceId: 'page', bold: false, italic: false, underline: false }; const note = { id: 'url-insert', title: '图片引用', course, atoms: [atom], blocks: [{ id: 'block', source: 'slides', at: 1, end: 1, sourceId: 'page', atoms: [atom] }], anchors: [], savedAt: 1 }; const saved = await backend.handle('notes.save', { note }); assert.match(saved.blocks[0].atoms[0].value, /^zhiyun-resource:/); const image = await backend.resolveResource(new Request(saved.blocks[0].atoms[0].value)); assert.deepEqual(Buffer.from(await image.arrayBuffer()), picture); assert.equal(imageRequests, 1); const dragged = await backend.handle('resource.drag', { url: 'https://images.zju.edu.cn/page.png', trim: false, course }); assert.ok(fs.existsSync(dragged.path)); assert.equal(fs.readdirSync(path.join(root, 'data', 'account-' + key('account-1'), 'saved-images')).length, 0); } finally { await backend.dispose(); cleanup(); }
});
test('batch course index is transparently listed, migrates old hashed cache and clears without removing preferences', async () => {
 const { root, cleanup } = fixture(), cached = new LocalStore({ filesDir: path.join(root, 'data'), cacheDir: path.join(root, 'cache'), tempDir: path.join(root, 'cache') }, 'account-1'); const legacy = 'desktop-' + key('my-attendance-batch-v1') + '.json', state = { records: [course.subId], courses: [course] }; cached.saveJson(legacy, JSON.stringify(state)); cached.saveJson('desktop-' + key('pane-preferences') + '.json', JSON.stringify({ video: false })); const backend = createServices(sessionFixture(root, async url => apiFixture(url)), root, () => {}, securityAdapters);
 try { await backend.handle('session.restore'); assert.deepEqual(await backend.handle('storage.get', { key: 'my-attendance-batch-v1' }), state); const filename = path.join(cached.dataFolder, 'my-attendance-batch-v1.json'); assert.equal(fs.existsSync(filename), true); assert.equal(fs.existsSync(path.join(cached.dataFolder, legacy)), false); const detail = await backend.handle('cache.detail', { kind: 'catalogue' }); assert.ok(detail.some((entry: any) => entry.id === 'my-attendance-batch-v1.json' && entry.bytes > 0)); await backend.handle('cache.clear', { kind: 'catalogue' }); assert.equal(fs.existsSync(filename), false); assert.equal(await backend.handle('storage.get', { key: 'my-attendance-batch-v1' }), null); assert.deepEqual(await backend.handle('storage.get', { key: 'pane-preferences' }), { video: false }); await backend.handle('storage.set', { key: 'my-attendance-batch-v1', value: state }); assert.equal(fs.existsSync(filename), true); await backend.handle('cache.clearAll'); assert.equal(fs.existsSync(filename), false); assert.equal(await backend.handle('storage.get', { key: 'my-attendance-batch-v1' }), null); await backend.handle('cache.toggle', { kind: 'catalogue', enabled: false }); await backend.handle('storage.set', { key: 'my-attendance-batch-v1', value: state }); assert.equal(fs.existsSync(filename), false); assert.deepEqual(await backend.handle('storage.get', { key: 'my-attendance-batch-v1' }), state); await backend.handle('cache.clear', { kind: 'catalogue' }); assert.equal(await backend.handle('storage.get', { key: 'my-attendance-batch-v1' }), null);
 } finally { await backend.dispose(); cleanup(); }
});
test('export names avoid Windows devices, case-insensitive collisions and oversized Unicode path components', () => {
 for (const name of ['CON', 'con.txt', 'NUL.tar.gz', 'PRN', 'AUX', 'COM1', 'com².md', 'LPT9', 'LPT³', 'CONIN$']) assert.ok(safeFilename(name).startsWith('_')); assert.equal(safeFilename('普通课程笔记'), '普通课程笔记'); assert.equal(safeFilename('CONference'), 'CONference'); const mixed = safeFilename('课'.repeat(100) + '😀'); assert.ok(Buffer.byteLength(mixed) <= 200); assert.equal(mixed.endsWith('\ud83d'), false); assert.equal(/[ .]$/.test(safeFilename('x'.repeat(89) + '.middle')), false); const names = new Set<string>(); assert.equal(uniqueExportName('Note', names), 'Note'); assert.equal(uniqueExportName('note', names), 'note (2)'); const folder = noteExportCourse({ id: 'note', title: '课堂笔记', course: { ...course, title: '课'.repeat(100), teacher: '师'.repeat(100), term: '期'.repeat(100) }, atoms: [], anchors: [], savedAt: 1 }); assert.ok(Buffer.byteLength(folder) <= 230); assert.equal(folder.split('_').length, 3);
});
test('clearing course cache cancels an in-flight history writer instead of recreating cleared records', async () => {
 const { root, cleanup } = fixture(); const cached = new LocalStore({ filesDir: path.join(root, 'data'), cacheDir: path.join(root, 'cache'), tempDir: path.join(root, 'cache') }, 'account-1'); cached.saveMyAttendance([course], '', true); const releases: Array<() => void> = []; const backend = createServices(sessionFixture(root, async url => { if (url.includes('get-week-schedules')) { await new Promise<void>(resolve => releases.push(resolve)); return Response.json({ code: 0, result: { list: [] } }); } return apiFixture(url); }), root, () => {}, securityAdapters);
 try { await backend.handle('session.restore'); await backend.handle('courses.history'); await backend.handle('cache.clear', { kind: 'catalogue' }); releases.splice(0).forEach(release => release()); await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(fs.existsSync(path.join(cached.dataFolder, 'my-attendance-v1.json')), false); assert.equal((await backend.handle('cache.detail', { kind: 'catalogue' })).length, 0); } finally { releases.splice(0).forEach(release => release()); await backend.dispose(); cleanup(); }
});
test('detailed runtime cleanup deletes only selected cache category rather than every browser cache', async () => {
 const { root, cleanup } = fixture(); for (const name of ['Code Cache', 'GPUCache']) { fs.mkdirSync(path.join(root, name)); fs.writeFileSync(path.join(root, name, 'data'), 'cached'); } const backend = createServices(sessionFixture(root, async url => apiFixture(url)), root, () => {}, securityAdapters);
 try { await backend.handle('session.restore'); const detail = await backend.handle('cache.detail', { kind: 'runtime' }); const code = detail.find((entry: any) => entry.label.includes('网页脚本缓存')); assert.ok(code); await backend.handle('cache.clear', { kind: 'runtime', ids: [code.id] }); assert.equal(fs.existsSync(path.join(root, 'Code Cache')), false); assert.equal(fs.existsSync(path.join(root, 'GPUCache', 'data')), true); } finally { await backend.dispose(); cleanup(); }
});
