export interface Account { id: string; name: string; tenantId: number; username?: string }
export interface Course {
  subId: string; courseId: string; title: string; teacher: string; room: string;
  start: number; end: number; status: string; term?: string;
}
export interface Slide { id: string; t: number; url: string; thumb: string; note: string; duplicateOf?: string; duplicateUrl?: string }
export interface Transcript { id: string; t: number; end: number; text: string; timing?: string }
export interface PageGroup { slide: Slide; lines: Transcript[]; skipContent?: boolean }
export function pageHasContent(group: PageGroup): boolean { return group.skipContent ?? group.lines.length > 0; }
export function copyStringMap(source: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  Object.keys(source).forEach((key: string) => { result[key] = source[key]; });
  return result;
}
export type CoursePhase = 'live' | 'soon' | 'later' | 'ended';
export function phase(c: Course, now: number): CoursePhase {
  if (now >= c.end) return 'ended';
  if (now >= c.start) return 'live';
  return c.start - now <= 1800 ? 'soon' : 'later';
}
export function shanghaiDate(seconds: number): string {
  return new Date((seconds + 8 * 3600) * 1000).toISOString().slice(0, 10);
}
export function clockTime(seconds: number): string {
  return new Date((seconds + 8 * 3600) * 1000).toISOString().slice(11, 16);
}
export function stamp(t: number): string {
  const n = Math.max(0, Math.floor(t));
  return `${Math.floor(n / 60).toString().padStart(2, '0')}:${(n % 60).toString().padStart(2, '0')}`;
}
export function plain(value: string): string {
  return value.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
}
export function imageUrl(value: string): string {
  // HTTPS only; the original full-resolution URL is retained, never the thumbnail.
  const m = /^https?:\/\/([^/:?#]+)(?::\d+)?(\/[^\s]*)?$/i.exec(value);
  if (!m || value.indexOf('@') >= 0) return '';
  const host = m[1].toLowerCase();
  if (!['.zju.edu.cn', '.chinamcloud.com', '.chinamcloud.cn', '.chinamcache.com'].some((s: string) => host.endsWith(s))) return '';
  return value.replace(/^http:/i, 'https:');
}
export function mergeSlides(old: Slide[], incoming: Slide[]): Slide[] {
  const map = new Map<string, Slide>();
  old.concat(incoming).forEach((s: Slide) => {
    if (Number.isFinite(s.t) && s.t >= 0 && imageUrl(s.url)) { const previous = map.get(s.id); map.set(s.id, previous?.url === s.url && !s.duplicateOf ? { id: s.id, t: s.t, url: s.url, thumb: s.thumb, note: s.note, duplicateOf: previous.duplicateOf, duplicateUrl: previous.duplicateUrl } : s); }
  });
  return Array.from(map.values()).sort((a: Slide, b: Slide) => a.t - b.t || a.id.localeCompare(b.id));
}
export function mergeLines(old: Transcript[], incoming: Transcript[]): Transcript[] {
  const map = new Map<string, Transcript>();
  old.concat(incoming).forEach((s: Transcript) => {
    if (Number.isFinite(s.t) && s.t >= 0 && s.text.trim()) map.set(s.id, s);
  });
  return Array.from(map.values()).sort((a: Transcript, b: Transcript) => a.t - b.t || a.id.localeCompare(b.id));
}
export function distinctSlides(slides: Slide[]): Slide[] {
  const sorted = slides.slice().sort((a: Slide, b: Slide) => a.t - b.t || a.id.localeCompare(b.id));
  return sorted.filter((slide: Slide, index: number) => index === 0 || !(slide.duplicateOf === sorted[index - 1].id && slide.duplicateUrl === sorted[index - 1].url));
}
export function groupPages(slides: Slide[], lines: Transcript[], mergeDuplicates: boolean = true): PageGroup[] {
  const sorted = mergeDuplicates ? distinctSlides(slides) : slides.slice().sort((a: Slide, b: Slide) => a.t - b.t);
  const orderedLines = mergeLines([], lines);
  let cursor = 0;
  return sorted.map((s: Slide, i: number): PageGroup => {
    const next = i + 1 < sorted.length ? sorted[i + 1].t : Number.POSITIVE_INFINITY;
    // A sentence belongs to the page at its source start time. The next page owns its boundary.
    while (cursor < orderedLines.length && orderedLines[cursor].t < s.t) cursor++;
    const start = cursor;
    while (cursor < orderedLines.length && orderedLines[cursor].t < next) cursor++;
    return { slide: s, lines: orderedLines.slice(start, cursor) };
  });
}
export function pageCapacity(width: number, height: number, screenWidth: number, screenHeight: number, transcript: boolean, singlePage: boolean = false): number {
  if (singlePage || width * height <= screenWidth * screenHeight / 4 || width < 600) return 1;
  const card = 520;
  return Math.max(1, Math.min(2, Math.floor(width / card)));
}
export function selectedAfterUpdate(old: Slide[], next: Slide[], index: number, following: boolean): number {
  if (!next.length) return 0;
  if (following) return next.length - 1;
  const id = old[index]?.id;
  const found = next.findIndex((s: Slide) => s.id === id);
  if (found >= 0) return found;
  const at = old[index]?.t;
  if (at !== undefined) { let target = 0; next.forEach((slide: Slide, i: number) => { if (slide.t <= at) target = i; }); return target; }
  return Math.min(index, next.length - 1);
}
export function glueMessage(frame: string): string {
  if (!frame.startsWith('cd')) return '';
  const body = frame.slice(2), separator = body.indexOf('&');
  if (separator < 1) return '';
  const length = Number(body.slice(0, separator));
  if (!Number.isInteger(length) || length < 1 || length > body.length - separator - 1) return '';
  const channel = body.slice(separator + 1, separator + 1 + length);
  return channel === 'm' ? body.slice(separator + 1 + length) : '';
}
export function reconcileLines(old: Transcript[], historical: Transcript[]): Transcript[] {
  const aligned = historical.map((h: Transcript): Transcript => {
    const captured = old.find((l: Transcript) => l.timing === 'source' && h.t >= l.t - 2 && h.t <= l.end + 2 && (h.text.includes(l.text) || l.text.includes(h.text)));
    return captured ? { id: captured.id, t: captured.t, end: Math.max(captured.end, h.end), text: h.text, timing: 'history' } : h;
  });
  const source = mergeLines(old.filter((l: Transcript) => l.timing !== 'received'), aligned);
  const approximate = old.filter((l: Transcript) => l.timing === 'received').filter((l: Transcript) => {
    return !source.some((s: Transcript) => Math.abs(s.t - l.t) < 120 && (s.text.includes(l.text) || l.text.includes(s.text)));
  });
  return mergeLines(source, approximate);
}

export function visiblePageGroups(groups: PageGroup[], skipEmpty: boolean, live: boolean): PageGroup[] {
  // Do not hide the entire lesson before captions arrive. Keep the pending live page.
  if (!skipEmpty || !groups.some((g: PageGroup) => pageHasContent(g))) return groups;
  return groups.filter((g: PageGroup, i: number) => pageHasContent(g) || (live && i === groups.length - 1));
}
export function spreadStart(index: number, capacity: number): number {
  return Math.floor(Math.max(0, index) / Math.max(1, capacity)) * Math.max(1, capacity);
}
export function plainTranscript(text: string): string { return text.replace(/\s+/g, ' ').trim(); }
