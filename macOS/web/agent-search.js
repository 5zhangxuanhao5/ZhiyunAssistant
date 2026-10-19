import { userMessage } from './user-errors.js';
import { clockTime } from './models/Timeline.js';

const keyOf = c => c.courseId + '-' + c.subId;
const clock = t => {
  const n = Math.max(0, Math.floor(t));
  return [Math.floor(n / 3600), Math.floor(n / 60) % 60, n % 60].map(v => String(v).padStart(2, '0')).join(':');
};
const controller = () => new (typeof AbortController === 'function' ? AbortController : window.AbortController)();

/** One bounded operation for the whole scope. Cached lessons are inspected first;
 * only missing transcripts require permission checks and network traffic.
 * Cancellation belongs to this search, never to the visible lesson or downloads.
 */
export async function searchCourseMaterial({ query, candidates, cached, discover, permissions, transcript, persist,
  date, guard = () => {}, signal, budgetMs = 8000, concurrency = 2, limit = 60, hitsPerLesson = 3 }) {
  const terms = query.toLowerCase().split(/[\s,，、]+/).filter(Boolean);
  if (!terms.length) throw new Error('请说明要查找的内容');
  const scope = controller(), began = Date.now(), all = new Map(candidates.map(c => [keyOf(c), c]));
  const completed = new Set(), results = new Map(), skipped = new Map();
  let fetched = 0, expired = false, catalogueComplete = true, closed = false, release;
  const aborted = new Promise(resolve => release = resolve);
  const abort = () => { scope.abort(); release(); };
  const externalAbort = () => abort();
  signal?.addEventListener('abort', externalAbort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(() => { expired = true; abort(); }, budgetMs);
  const check = () => { guard(); if (closed || scope.signal.aborted) throw new Error('检索已停止'); };
  // A guard may represent an account change even when no AbortSignal was supplied.
  let guardError;
  const guardTimer = setInterval(() => { try { guard(); } catch (e) { guardError = e; abort(); } }, 80);
  const matches = value => terms.every(t => String(value || '').toLowerCase().includes(t));
  const excerpt = text => {
    const value = String(text || '').replace(/\s+/g, ' ').trim();
    const first = Math.min(...terms.map(t => value.toLowerCase().indexOf(t)).filter(n => n >= 0));
    const start = Math.max(0, (Number.isFinite(first) ? first : 0) - 20);
    return (start ? '…' : '') + value.slice(start, start + 72) + (start + 72 < value.length ? '…' : '');
  };
  const inspect = (c, material) => {
    check(); const rows = [...(material.data.lines || [])].sort((a, b) => a.t - b.t), hits = [];
    for (let i = 0; i < rows.length && hits.length < hitsPerLesson; i++) {
      const row = rows[i];
      if (!Number.isFinite(row.t) || !matches(row.text) && !(terms.length > 1 && matches((rows[i - 1]?.text || '') + row.text + (rows[i + 1]?.text || '')) && terms.some(t => String(row.text).toLowerCase().includes(t)))) continue;
      if (hits.some(h => Math.abs(h.t - row.t) < 45)) continue;
      hits.push({ t: Math.floor(row.t), clock: clock(row.t), from: '转写', text: excerpt(row.text + (String(row.text).length < 40 && rows[i + 1] ? ' ' + rows[i + 1].text : '')) });
    }
    for (const slide of material.data.slides || []) {
      if (hits.length >= hitsPerLesson) break;
      if (Number.isFinite(slide.t) && slide.note && matches(slide.note) && !hits.some(h => Math.abs(h.t - slide.t) < 45)) hits.push({ t: Math.floor(slide.t), clock: clock(slide.t), from: '课件', text: excerpt(slide.note) });
    }
    const key = keyOf(c); completed.add(key);
    if (material.missing?.length) skipped.set(key, { key, date: date(c), reason: userMessage(material.missing.join('；')) });
    if (hits.length) results.set(key, { key, courseId: c.courseId, title: c.title, date: date(c), start: clockTime(c.start), hits: hits.sort((a, b) => a.t - b.t) });
  };
  const map = async (rows, fn) => {
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, async () => {
      while (cursor < rows.length) { check(); await fn(rows[cursor++]); }
    }));
  };
  const work = (async () => {
    const missing = [];
    const readCache = async c => { const material = await cached(c); check(); if (material) inspect(c, material); else missing.push(c); };
    await map([...all.values()], readCache);
    if (discover) {
      const discovered = await discover(scope.signal); check(); catalogueComplete = discovered.complete;
      const added = [];
      for (const c of discovered.courses) if (!all.has(keyOf(c))) { all.set(keyOf(c), c); added.push(c); }
      await map(added, readCache);
    }
    if (!missing.length) return;
    const allowed = await permissions(missing, scope.signal); check();
    await map(missing, async c => {
      const key = keyOf(c);
      if (allowed[key] !== 'allowed') { completed.add(key); skipped.set(key, { key, date: date(c), reason: allowed[key] === 'denied' ? '当前账号没有这节课的访问权限' : '课程权限暂时未能确认，请稍后重试' }); return; }
      try {
        fetched++;
        const rows = await transcript(c, scope.signal); check();
        const material = { data: { lines: rows, slides: [] }, source: 'online', missing: [] };
        inspect(c, material); check(); await persist(c, material.data); check();
      } catch (error) {
        check(); completed.add(key); skipped.set(key, { key, date: date(c), reason: userMessage(error) });
      }
    });
  })();
  try {
    await Promise.race([work, aborted]);
    if (guardError) throw guardError;
    guard(); if (signal?.aborted) throw new Error('任务已停止或账号已切换');
    const ordered = [...results.values()].sort((a, b) => all.get(b.key).start - all.get(a.key).start);
    const pending = [...all.values()].filter(c => !completed.has(keyOf(c))).map(c => ({ key: keyOf(c), date: date(c) }));
    const result = { query, candidates: all.size, scanned: completed.size, fetched, found: ordered.reduce((n, l) => n + l.hits.length, 0),
      lessons: ordered.slice(0, limit), omittedLessons: Math.max(0, ordered.length - limit), skipped: [...skipped.values()].slice(0, 20), skippedCount: skipped.size, pending: pending.slice(0, 20), pendingCount: pending.length,
      complete: !expired && !pending.length && catalogueComplete && !skipped.size, budgetExceeded: expired, catalogueComplete,
      elapsedMs: Date.now() - began, next: null,
      hint: expired || pending.length || !catalogueComplete ? '已达到本次检索时限，请先列出已有命中并说明尚未完成的范围；不要自动逐课重试，用户要求继续时再查。' : skipped.size ? '已汇总可读取课次的命中，部分课次无权限或读取失败；请说明此范围，不要反复重试。' : ordered.length ? '本次已一次检索完整范围，请直接按日期列出课次和前几个时间点，不需要逐节再次搜索。' : '已检索的资料没有命中，可调整关键词。' };
    // Preserve every returned date/time rather than letting the runner truncate JSON.
    if (JSON.stringify(result).length > 22000) for (const row of result.lessons) for (const hit of row.hits) delete hit.text;
    return result;
  } finally {
    closed = true; clearTimeout(timer); clearInterval(guardTimer); signal?.removeEventListener('abort', externalAbort); abort();
    // Observe late rejections from canceled native requests without caching their results.
    work.catch(() => {});
  }
}
