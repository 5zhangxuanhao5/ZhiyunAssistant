import { resolveMedia, mediaIdentity } from './models/Media.js';

const TYPES = { slides: '课件', transcript: '转写', video: '视频' };
const finite = n => Math.max(0, Number(n) || 0);
const clone = value => JSON.parse(JSON.stringify(value));
const byteLength = text => new TextEncoder().encode(text).length;
const courseKey = course => String(course.courseId) + '-' + String(course.subId);
const safeName = value => String(value).replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 100);
function hash(value) { let a = 2166136261, b = 5381; for (const char of String(value)) { a = Math.imul(a ^ char.charCodeAt(0), 16777619); b = Math.imul(b, 33) ^ char.charCodeAt(0); } return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0'); }
function attributes(line) { const values = {}; for (const match of line.matchAll(/([A-Z0-9-]+)=("(?:[^"\\]|\\.)*"|[^,]*)/g)) values[match[1]] = match[2].replace(/^"|"$/g, ''); return values; }
function remote(value, base) {
  try { let address = new URL(value, base); if (['127.0.0.1', 'localhost'].includes(address.hostname) && address.pathname.endsWith('/remote') && address.searchParams.has('url')) address = new URL(address.searchParams.get('url')); const result = resolveMedia(address.href, base); if (!result) throw new Error(); return result; }
  catch { throw new Error('视频资源地址不受支持'); }
}
function extension(url, fallback = 'bin') { try { return /\.([a-zA-Z0-9]{1,6})$/.exec(new URL(url).pathname)?.[1].toLowerCase() || fallback; } catch { return fallback; } }

/** Build an actual local HLS graph, including independent audio/subtitle tracks.
 * readText(url) must use the application's authenticated resource proxy.
 * Never changes a rolling live manifest into a fictitious complete recording.
 */
export async function buildOfflineHLS(address, { readText, courseStart = 0, prefix = 'video' }) {
  const assets = new Map(), lists = new Map(), visiting = new Set(); let offset = 0;
  const addAsset = (url, suffix) => { const name = 'asset-' + hash(mediaIdentity(url)) + '.' + suffix; if (!assets.has(name)) assets.set(name, { name, url, type: 'video', role: 'asset' }); return name; };
  const visit = async (url, depth = 0, root = false) => {
    if (depth > 6 || visiting.has(url)) throw new Error('视频清单循环或嵌套过深');
    const name = root ? safeName(prefix) + '.m3u8' : 'playlist-' + hash(mediaIdentity(url)) + '.m3u8'; if (lists.has(name)) return name;
    visiting.add(url);
    try {
      const source = await readText(url); if (!source.trim().startsWith('#EXTM3U')) throw new Error('平台未返回有效的视频清单');
      const lines = source.trim().split(/\r?\n/).map(x => x.trim()), streamIndex = lines.findIndex(x => x.startsWith('#EXT-X-STREAM-INF:')); const output = [];
      const rewriteKey = line => {
        const a = attributes(line); if (a.METHOD && a.METHOD !== 'NONE' && (a.METHOD !== 'AES-128' || a.KEYFORMAT && a.KEYFORMAT !== 'identity')) throw new Error('此视频的版权保护格式不支持离线下载');
        if (a.URI) return line.replace(/URI="[^"]+"/, 'URI="' + addAsset(remote(a.URI, url), /KEY/.test(line) ? 'key' : 'mp4') + '"');
        if (a.METHOD && a.METHOD !== 'NONE') throw new Error('视频密钥地址缺失'); return line;
      };
      if (streamIndex >= 0) {
        const stream = lines[streamIndex], a = attributes(stream), child = lines[streamIndex + 1]; if (!child || child.startsWith('#')) throw new Error('视频画面清单地址缺失');
        output.push(...lines.filter(x => /^#EXTM3U$|^#EXT-X-(VERSION|INDEPENDENT-SEGMENTS):?/.test(x)));
        for (const line of lines.filter(x => x.startsWith('#EXT-X-SESSION-KEY:'))) output.push(rewriteKey(line));
        for (const [type, group] of [['AUDIO', a.AUDIO], ['SUBTITLES', a.SUBTITLES], ['VIDEO', a.VIDEO]]) {
          if (!group) continue; const matching = lines.filter(x => x.startsWith('#EXT-X-MEDIA:') && attributes(x).TYPE === type && attributes(x)['GROUP-ID'] === group);
          const selected = matching.find(x => attributes(x).DEFAULT === 'YES') || matching[0]; if (!selected) throw new Error('视频关联音轨或画面清单缺失'); const attr = attributes(selected);
          if (attr.URI) { const local = await visit(remote(attr.URI, url), depth + 1); output.push(selected.replace(/URI="[^"]+"/, 'URI="' + local + '"')); } else output.push(selected);
        }
        output.push(stream, await visit(remote(child, url), depth + 1));
      } else {
        if (!lines.includes('#EXT-X-ENDLIST')) throw new Error('平台仅提供滚动直播流，尚未提供可下载的完整回放快照');
        for (const line of lines) {
          if (line.startsWith('#EXT-X-PROGRAM-DATE-TIME:') && !offset) { const t = Date.parse(line.slice(25)) / 1000; if (Number.isFinite(t)) offset = Math.max(0, t - courseStart); }
          if (/^#EXT-X-(KEY|MAP|SESSION-KEY):/.test(line)) output.push(rewriteKey(line));
          else if (line && !line.startsWith('#')) { const urlAsset = remote(line, url); output.push(addAsset(urlAsset, extension(urlAsset, 'ts'))); }
          else output.push(line);
        }
      }
      lists.set(name, { name, text: output.join('\n') + '\n', type: 'video', role: 'playlist' }); return name;
    } finally { visiting.delete(url); }
  };
  const entry = await visit(remote(address, address), 0, true);
  return { entry, offset, files: [...assets.values(), ...lists.values()], dependencies: [...assets.keys(), ...lists.keys()] };
}

class Stopped extends Error { constructor() { super('已暂停'); } }
/** Canonical jobs: rows and tasks share the same objects; restored jobs are paused.
 * read(key)/write(key,value) operate on the currently bound account's saved JSON.
 * onChange({type:'list'|'progress',key,row}, rows) separates cheap progress updates.
 * Call await dispose() before logging out/switching owner so old async writes finish.
 */
export class OfflineDownloads {
  constructor({ native, api, read, write, resource = url => url, offlineURL = (key, name) => name, onChange = () => {}, onError = () => {}, owner = '', fetchText = null, readManifest = null, retryDelay = n => 350 * n } = {}) {
    Object.assign(this, { native, api, read, write, resource, offlineURL, onChange, onError, owner: String(owner), retryDelay });
    this.readManifest = readManifest || (async key => { const response = await fetch(this.offlineURL(key, 'manifest.json')); if (!response.ok) throw new Error('本机下载清单无法读取'); return response.json(); });
    this.fetchText = fetchText || (async url => { const response = await fetch(this.resource(url)); if (!response.ok) throw new Error('视频清单无法访问（' + response.status + '）'); return response.text(); });
    this.rows = []; this.tasks = []; this.active = new Map(); this.commits = new Map(); this.removing = new Map(); this._maxConcurrent = 2; this.writeChain = Promise.resolve(); this.disposed = false;
    this.headActive = 0; this.headWaiting = []; this.progressTimers = new Map(); this.persistTimer = null;
  }
  get maxConcurrent() { return this._maxConcurrent; }
  set maxConcurrent(value) { this._maxConcurrent = Math.max(1, Math.min(4, Math.round(Number(value) || 1))); this.pump(); }
  async load(rows = null) {
    if (!rows) rows = await this.read('offline-index.json') || [];
    const seen = new Set(); this.rows = (Array.isArray(rows) ? rows : []).filter(row => row && row.course?.courseId != null && row.course?.subId != null && (!row.owner || row.owner === this.owner) && !seen.has(courseKey(row.course)) && !!seen.add(courseKey(row.course))).map(raw => {
      const row = clone(raw); row.key = courseKey(row.course); row.version = 2; row.owner = this.owner; row.generation = finite(row.generation); row.options = { slides: false, transcript: false, video: false, ...row.options };
      if (['downloading', 'waiting'].includes(row.state)) row.state = 'paused'; row.inFlight = 0; row.inFlightTotal = 0; row.missing ||= []; row.completed ||= {}; row.files ||= []; row.planErrors ||= {};
      row.files = row.files.map(task => ({ ...task, type: task.type === '课件' ? 'slides' : task.type === '转写' ? 'transcript' : task.type === '视频' ? 'video' : task.type, state: row.completed[task.name] != null ? 'complete' : task.state || (row.state === 'failed' ? 'failed' : 'waiting'), error: task.error || (row.state === 'failed' && row.completed[task.name] == null ? '此前资源未完成' : ''), size: finite(task.size) }));
      row.bytes = row.manifestAvailable && !row.files.length ? finite(row.bytes) : Object.values(row.completed).reduce((n, bytes) => n + finite(bytes), 0); row.done = row.manifestAvailable && !row.files.length ? finite(row.done) : row.files.filter(f => f.state === 'complete').length; row.total = Math.max(row.bytes, finite(row.total)); return row;
    });
    this.tasks = this.rows.filter(row => ['paused', 'waiting', 'downloading'].includes(row.state)).sort((a, b) => finite(a.queueOrder) - finite(b.queueOrder)); this.notify('list'); return this.rows;
  }
  find(key) { return this.rows.find(row => row.key === key); }
  current(row, generation) { return !this.disposed && this.find(row.key) === row && row.generation === generation && row.state === 'downloading'; }
  assert(row, generation) { if (!this.current(row, generation)) throw new Stopped(); }
  notify(type, row) {
    if (type === 'progress') { if (this.progressTimers.has(row.key)) return; this.progressTimers.set(row.key, setTimeout(() => { this.progressTimers.delete(row.key); if (this.find(row.key) === row) this.onChange({ type, key: row.key, row }, this.rows); }, 80)); }
    else this.onChange({ type, key: row?.key, row }, this.rows);
  }
  serialRows() { return this.rows.map(row => {
    const { data, files, completed, ...summary } = row, stored = row.manifestAvailable && ['complete', 'partial', 'failed'].includes(row.state);
    // The index is a list, not a second copy of every lecture's entire resources.
    const result = clone({ ...summary, files: stored ? [] : files.map(task => { const copy = { ...task }; if (row.completed[task.name] != null) delete copy.text; return copy; }), completed: stored ? {} : completed });
    result.queueOrder = this.tasks.indexOf(row); delete result.operation; result.inFlight = 0; result.inFlightTotal = 0; return result;
  }); }
  persist() { const snapshot = this.serialRows(); this.writeChain = this.writeChain.catch(() => {}).then(() => this.write('offline-index.json', snapshot)); return this.writeChain; }
  schedulePersist() { if (!this.persistTimer) this.persistTimer = setTimeout(() => { this.persistTimer = null; this.persist().catch(this.onError); }, 500); }
  async enqueue(course, options) {
    if (this.disposed) throw new Error('下载队列已关闭'); if (course?.courseId == null || course?.subId == null) throw new Error('课程课次标识不完整'); const key = courseKey(course); if (this.removing.has(key)) await this.removing.get(key);
    options = { slides: !!options.slides, transcript: !!options.transcript, video: !!options.video }; if (!Object.values(options).some(Boolean)) throw new Error('请选择要下载的内容');
    let row = this.find(key);
    if (row && ['waiting', 'downloading'].includes(row.state)) return row;
    if (!row) { row = { key, course: clone(course), owner: this.owner, version: 2, generation: 0, state: 'waiting', options, completed: {}, files: [], planErrors: {}, data: null, missing: [], bytes: 0, total: 0, done: 0, count: 0 }; this.rows.unshift(row); }
    else { row.course = clone(course); for (const type of Object.keys(options)) row.options[type] ||= options[type]; row.state = 'waiting'; row.retryOnly = false; }
    if (!this.tasks.includes(row)) this.tasks.push(row); this.notify('list', row); await this.persist(); this.pump(); return row;
  }
  pause(key) { const row = this.find(key); if (!row || !['waiting', 'downloading'].includes(row.state)) return; row.generation++; row.state = 'paused'; row.message = '已暂停'; row.inFlight = 0; row.inFlightTotal = 0; this.cancelActive(key); this.notify('list', row); this.schedulePersist(); this.pump(); }
  resume(key) { const row = this.find(key); if (!row || row.state !== 'paused') return; row.state = 'waiting'; row.retryOnly = true; row.message = '等待下载'; if (!this.tasks.includes(row)) this.tasks.push(row); this.notify('list', row); this.schedulePersist(); this.pump(); }
  move(key, direction) { const row = this.find(key), i = this.tasks.indexOf(row); if (i < 0 || row.state === 'downloading') return; this.tasks.splice(i, 1); const next = direction === 'first' ? 0 : direction === 'last' ? this.tasks.length : Math.max(0, Math.min(this.tasks.length, i + (direction === 'up' || direction === -1 ? -1 : 1))); this.tasks.splice(next, 0, row); this.notify('list', row); this.schedulePersist(); }
  pauseAll() { this.rows.forEach(row => this.pause(row.key)); }
  resumeAll() { this.rows.forEach(row => this.resume(row.key)); }
  cancelActive(key) { const active = this.active.get(key); if (!active) return; for (const id of active.operations) this.native.call('cancelDownload', { id }).catch(() => {}); active.cancel?.(); }
  async retry(key) { const row = this.find(key); if (!row || !['failed', 'partial'].includes(row.state)) return row; row.retryOnly = true; row.state = 'waiting'; row.generation++; row.message = '等待重试失败内容'; for (const task of row.files) if (task.state === 'failed') task.state = 'waiting'; if (!this.tasks.includes(row)) this.tasks.push(row); this.notify('list', row); await this.persist(); this.pump(); return row; }
  async remove(key) {
    if (this.removing.has(key)) return this.removing.get(key); const row = this.find(key); if (!row) return;
    row.generation++; row.state = 'deleted'; this.rows = this.rows.filter(x => x !== row); this.tasks = this.tasks.filter(x => x !== row); this.cancelActive(key); this.notify('list', row);
    const pending = this.active.get(key)?.promise, commit = this.commits.get(key);
    const operation = (async () => { await pending?.catch(() => {}); await commit?.catch(() => {}); await this.native.call('deleteOffline', { lesson: key }); await this.write('lesson-' + key + '.json', null); await this.persist(); })().finally(() => { this.removing.delete(key); this.pump(); });
    this.removing.set(key, operation); return operation;
  }
  async preserve(key) { const row = this.find(key); if (!row || !['failed', 'partial'].includes(row.state)) return; await this.hydrate(row); const data = this.usableData(row); if (!(data.slides.length || data.lines.length || data.videos.length)) throw new Error('没有可以保存的内容：' + (row.missing.join('；') || '资源未下载成功')); row.state = 'partial'; row.message = row.missing.join('；'); const commit = (async () => { await this.write('lesson-' + key + '.json', data); await this.saveManifest(row); await this.persist(); if (this.find(key) === row) this.notify('list', row); return data; })(); this.commits.set(key, commit); try { return await commit; } finally { if (this.commits.get(key) === commit) this.commits.delete(key); } }
  pump() {
    if (this.disposed) return;
    for (const row of this.tasks) {
      if (this.active.size >= this.maxConcurrent) break; if (row.state !== 'waiting' || this.active.has(row.key) || this.removing.has(row.key)) continue;
      row.state = 'downloading'; row.message = '确认课程权限'; const active = { generation: row.generation, operations: new Set(), promise: null };
      this.active.set(row.key, active); this.notify('list', row);
      active.promise = this.run(row, active).catch(error => this.onError(error)).finally(() => { if (this.active.get(row.key) === active) this.active.delete(row.key); this.tasks = this.tasks.filter(task => !['complete', 'failed', 'partial', 'deleted'].includes(task.state)); this.notify('list', row); this.pump(); });
    }
  }
  async run(row, active) {
    const gen = active.generation;
    try {
      await this.api.checkCurrentPermission(row.course); this.assert(row, gen); // Cached permissions never authorize a download.
      await this.plan(row, gen); this.assert(row, gen); this.recount(row); await this.saveManifest(row); this.assert(row, gen);
      // HEAD work proceeds alongside the first GET; total scans never block downloading.
      this.measure(row, gen).catch(() => {});
      for (const task of row.files) {
        this.assert(row, gen); if (row.completed[task.name] != null) { task.state = 'complete'; continue; }
        row.message = '正在下载' + TYPES[task.type]; row.currentFile = task.name; this.notify('progress', row);
        try { await this.file(row, task, active); } catch (error) { if (error instanceof Stopped || !this.current(row, gen)) throw new Stopped(); task.state = 'failed'; task.error = error.message || String(error); }
        this.recount(row); this.schedulePersist();
      }
      this.assert(row, gen); this.missing(row); row.state = row.missing.length ? 'failed' : 'complete'; row.message = row.missing.length ? row.missing.join('；') : '下载完成'; row.currentFile = ''; row.inFlight = 0; row.inFlightTotal = 0;
      // Save only playable/available material, never remote placeholders in partial content.
      await this.write('lesson-' + row.key + '.json', this.usableData(row)); await this.saveManifest(row); this.releaseOlderDetails(); await this.persist();
    } catch (error) {
      if (error instanceof Stopped || this.disposed || this.find(row.key) !== row || row.generation !== gen) return;
      row.state = 'failed'; row.inFlight = 0; row.inFlightTotal = 0; row.missing = [...new Set([...row.missing, error.message || String(error)])]; row.message = row.missing.join('；'); await this.persist();
    }
  }
  async hydrate(row, gen) {
    if (!row.manifestAvailable || row.data && row.files.length) return;
    try { const manifest = await this.readManifest(row.key); if (gen === undefined) { if (this.disposed || this.find(row.key) !== row) throw new Stopped(); } else this.assert(row, gen); if (manifest?.key !== row.key || manifest.owner && manifest.owner !== this.owner) return;
      row.data ||= manifest.sourceData || manifest.data;
      if (!row.files.length) { row.files = clone(manifest.resources || []); row.completed = { ...manifest.completed, ...row.completed }; row.planErrors = { ...manifest.planErrors, ...row.planErrors }; }
    } catch (error) { if (error instanceof Stopped) throw error; }
  }
  releaseOlderDetails() { let retained = 0; for (const row of this.rows) if (row.manifestAvailable && ['complete', 'partial', 'failed'].includes(row.state) && row.data) { if (++retained > 6) { row.data = null; row.files = []; row.completed = {}; } } }
  async plan(row, gen) {
    await this.hydrate(row, gen); this.assert(row, gen);
    row.data ||= await this.read('lesson-' + row.key + '.json') || { course: row.course, slides: [], lines: [], videos: [] }; this.assert(row, gen);
    row.data.course = clone(row.course); row.data.slides ||= []; row.data.lines ||= []; row.data.videos ||= [];
    const old = new Map(row.files.map(file => [file.name, file])), required = Object.keys(row.options).filter(type => row.options[type] && (!row.retryOnly || row.planErrors[type] || !row.files.some(file => file.type === type) || row.files.some(file => file.type === type && file.error)));
    // Successfully planned resource lists remain intact for file-only retry.
    for (const type of required) {
      try {
        let tasks = [];
        if (type === 'slides') {
          const values = await this.api.slides(row.course); this.assert(row, gen); if (!values.length) throw new Error('平台未提供课件'); row.data.slides = clone(values);
          tasks = values.map((slide, i) => ({ name: 'slide-' + safeName(slide.id || i) + '-' + hash(mediaIdentity(slide.url)) + '.' + extension(slide.url, 'jpg'), url: slide.url, type, role: 'slide', slideId: slide.id }));
          row.data.slides.forEach((slide, i) => slide.offlineName = tasks[i].name);
        } else if (type === 'transcript') {
          const values = await this.api.transcripts(row.course); this.assert(row, gen); if (!values.length) throw new Error('平台未提供转写'); row.data.lines = clone(values); tasks = [{ name: 'transcript.json', text: JSON.stringify(values), size: byteLength(JSON.stringify(values)), type, role: 'transcript' }];
        } else {
          row.message = '读取视频清单'; this.notify('progress', row); const values = await this.api.videos(row.course); this.assert(row, gen); const source = values.find(item => !item.live && item.url) || values.find(item => item.url); if (!source) throw new Error('平台未提供课程视频');
          if (source.hls || /\.m3u8(?:\?|$)/i.test(source.url)) {
            const graph = await buildOfflineHLS(source.url, { readText: url => this.fetchText(url), courseStart: row.course.start }); this.assert(row, gen); tasks = graph.files;
            row.data.videos = [{ ...source, live: false, offset: graph.offset || source.offset || 0, offlineName: graph.entry, dependencies: graph.dependencies }];
          } else { const name = 'video-' + hash(mediaIdentity(source.url)) + '.' + extension(source.url, 'mp4'); tasks = [{ name, url: source.url, type, role: 'video' }]; row.data.videos = [{ ...source, offlineName: name, dependencies: [name] }]; }
        }
        const next = tasks.map(task => { const previous = old.get(task.name); if (task.text != null && previous?.text !== task.text) delete row.completed[task.name]; return { ...task, size: finite(task.size || previous?.size), state: row.completed[task.name] != null ? 'complete' : 'waiting', error: '' }; });
        row.files = row.files.filter(file => file.type !== type).concat(next); delete row.planErrors[type];
      } catch (error) { if (error instanceof Stopped || !this.current(row, gen)) throw new Stopped(); row.planErrors[type] = error.message || String(error); }
    }
    row.retryOnly = false;
    // v1 metadata didn't write a transcript resource. Keep existing local successful content.
    if (row.options.transcript && row.data.lines.length && !row.files.some(task => task.type === 'transcript') && !row.planErrors.transcript) row.files.push({ name: 'transcript.json', text: JSON.stringify(row.data.lines), type: 'transcript', role: 'transcript', state: 'waiting', size: byteLength(JSON.stringify(row.data.lines)) });
    this.missing(row);
  }
  async file(row, task, active) {
    const gen = active.generation; let last;
    for (let attempt = 1; attempt <= 3; attempt++) {
      this.assert(row, gen); task.state = 'downloading'; task.attempts = finite(task.attempts) + 1;
      try {
        let result;
        if (task.text != null) { await this.native.call('writeOffline', { lesson: row.key, name: task.name, text: task.text }); result = { size: byteLength(task.text) }; }
        else {
          const promise = this.native.call('saveResource', { lesson: row.key, name: task.name, url: task.url }); if (promise.id) active.operations.add(promise.id);
          const off = this.native.on('download', event => { if (event.id !== promise.id || !this.current(row, gen)) return; row.inFlight = finite(event.bytes); row.inFlightTotal = finite(event.total); if (row.inFlightTotal) task.size = row.inFlightTotal; this.recount(row); this.notify('progress', row); });
          try { result = await promise; } finally { off(); if (promise.id) active.operations.delete(promise.id); }
        }
        this.assert(row, gen); if (!task.text && !finite(result?.size)) throw new Error('资源文件为空'); row.completed[task.name] = finite(result?.size); task.size = finite(result?.size); task.state = 'complete'; task.error = ''; row.inFlight = 0; row.inFlightTotal = 0; this.recount(row); this.notify('progress', row); return;
      } catch (error) { if (error instanceof Stopped || !this.current(row, gen)) throw new Stopped(); last = error; row.inFlight = 0; row.inFlightTotal = 0; if (attempt < 3) await new Promise(resolve => setTimeout(resolve, this.retryDelay(attempt))); }
    }
    throw last || new Error('下载失败');
  }
  async head(task) {
    if (this.headActive >= 2) await new Promise(resolve => this.headWaiting.push(resolve)); else this.headActive++;
    try { return finite(await this.native.call('resourceSize', { url: task.url })); } finally { const next = this.headWaiting.shift(); if (next) next(); else this.headActive--; }
  }
  async measure(row, gen) {
    const files = row.files.filter(task => task.url && !task.size && row.completed[task.name] == null); let cursor = 0;
    await Promise.all([0, 1].map(async () => { while (cursor < files.length && this.current(row, gen)) { const task = files[cursor++]; try { const size = await this.head(task); if (this.current(row, gen) && task.state !== 'complete') { task.size = size; this.recount(row); this.notify('progress', row); } } catch {} } }));
  }
  recount(row) { row.bytes = row.files.reduce((sum, task) => sum + finite(row.completed[task.name]), 0); row.done = row.files.filter(task => row.completed[task.name] != null).length; row.count = row.files.length; row.total = row.files.reduce((sum, task) => sum + finite(row.completed[task.name] ?? task.size), 0); row.totalKnown = row.files.every(task => row.completed[task.name] != null || task.size > 0); }
  missing(row) { row.missing = [...new Set([...Object.entries(row.planErrors).map(([type, error]) => TYPES[type] + '：' + error), ...row.files.filter(task => task.state === 'failed').map(task => TYPES[task.type] + ' ' + task.name + '：' + task.error)])]; }
  usableData(row) {
    const data = clone(row.data || { course: row.course, slides: [], lines: [], videos: [] }); data.course = clone(row.course);
    const present = name => name && row.completed[name] != null;
    data.slides = row.options.slides && !row.planErrors.slides ? (data.slides || []).filter((slide, i) => present(slide.offlineName || slide.local?.split('/').pop() || row.files.filter(t => t.type === 'slides')[i]?.name)).map(slide => ({ ...slide, local: this.offlineURL(row.key, slide.offlineName || slide.local?.split('/').pop()) })) : [];
    data.lines = row.options.transcript && !row.planErrors.transcript && (present('transcript.json') || !row.files.some(task => task.type === 'transcript')) ? data.lines || [] : [];
    data.videos = row.options.video && !row.planErrors.video ? (data.videos || []).filter(source => (source.dependencies || row.files.filter(task => task.type === 'video').map(task => task.name)).every(present)).map(source => ({ ...source, local: this.offlineURL(row.key, source.offlineName || source.local?.split('/').pop()) })) : [];
    return data;
  }
  async saveManifest(row) { await this.native.call('writeOffline', { lesson: row.key, name: 'manifest.json', text: JSON.stringify({ version: 2, key: row.key, owner: this.owner, course: row.course, options: row.options, resources: row.files, completed: row.completed, planErrors: row.planErrors, missing: row.missing, sourceData: row.data, data: this.usableData(row) }) }); row.manifestAvailable = true; }
  async idle() { while (this.active.size || this.tasks.some(row => row.state === 'waiting')) { this.pump(); await Promise.all([...this.active.values()].map(active => active.promise)); } await this.writeChain.catch(() => {}); }
  async dispose() { this.pauseAll(); this.disposed = true; if (this.persistTimer) { clearTimeout(this.persistTimer); this.persistTimer = null; } await Promise.all([...this.active.values()].map(active => active.promise)); for (const timer of this.progressTimers.values()) clearTimeout(timer); this.progressTimers.clear(); await this.persist(); }
}
