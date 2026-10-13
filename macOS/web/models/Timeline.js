// Generated from shared HarmonyOS sources by sync-harmony-models.cjs.
export function pageHasContent(group) { return group.skipContent ?? group.lines.length > 0; }
export function copyStringMap(source) {
    const result = {};
    Object.keys(source).forEach((key) => { result[key] = source[key]; });
    return result;
}
export function phase(c, now) {
    if (now >= c.end)
        return 'ended';
    if (now >= c.start)
        return 'live';
    return c.start - now <= 1800 ? 'soon' : 'later';
}
export function shanghaiDate(seconds) {
    return new Date((seconds + 8 * 3600) * 1000).toISOString().slice(0, 10);
}
export function clockTime(seconds) {
    return new Date((seconds + 8 * 3600) * 1000).toISOString().slice(11, 16);
}
export function stamp(t) {
    const n = Math.max(0, Math.floor(t));
    return `${Math.floor(n / 60).toString().padStart(2, '0')}:${(n % 60).toString().padStart(2, '0')}`;
}
export function plain(value) {
    return value.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
}
export function imageUrl(value) {
    // HTTPS only; the original full-resolution URL is retained, never the thumbnail.
    const m = /^https?:\/\/([^/:?#]+)(?::\d+)?(\/[^\s]*)?$/i.exec(value);
    if (!m || value.indexOf('@') >= 0)
        return '';
    const host = m[1].toLowerCase();
    if (!['.zju.edu.cn', '.chinamcloud.com', '.chinamcloud.cn', '.chinamcache.com'].some((s) => host.endsWith(s)))
        return '';
    return value.replace(/^http:/i, 'https:');
}
export function mergeSlides(old, incoming) {
    const map = new Map();
    old.concat(incoming).forEach((s) => {
        if (Number.isFinite(s.t) && s.t >= 0 && imageUrl(s.url)) {
            const previous = map.get(s.id);
            map.set(s.id, previous?.url === s.url && !s.duplicateOf ? { id: s.id, t: s.t, url: s.url, thumb: s.thumb, note: s.note, duplicateOf: previous.duplicateOf, duplicateUrl: previous.duplicateUrl } : s);
        }
    });
    return Array.from(map.values()).sort((a, b) => a.t - b.t || a.id.localeCompare(b.id));
}
export function mergeLines(old, incoming) {
    const map = new Map();
    old.concat(incoming).forEach((s) => {
        if (Number.isFinite(s.t) && s.t >= 0 && s.text.trim())
            map.set(s.id, s);
    });
    return Array.from(map.values()).sort((a, b) => a.t - b.t || a.id.localeCompare(b.id));
}
export function distinctSlides(slides) {
    const sorted = slides.slice().sort((a, b) => a.t - b.t || a.id.localeCompare(b.id));
    return sorted.filter((slide, index) => index === 0 || !(slide.duplicateOf === sorted[index - 1].id && slide.duplicateUrl === sorted[index - 1].url));
}
export function groupPages(slides, lines, mergeDuplicates = true) {
    const sorted = mergeDuplicates ? distinctSlides(slides) : slides.slice().sort((a, b) => a.t - b.t);
    const orderedLines = mergeLines([], lines);
    let cursor = 0;
    return sorted.map((s, i) => {
        const next = i + 1 < sorted.length ? sorted[i + 1].t : Number.POSITIVE_INFINITY;
        // A sentence belongs to the page at its source start time. The next page owns its boundary.
        while (cursor < orderedLines.length && orderedLines[cursor].t < s.t)
            cursor++;
        const start = cursor;
        while (cursor < orderedLines.length && orderedLines[cursor].t < next)
            cursor++;
        return { slide: s, lines: orderedLines.slice(start, cursor) };
    });
}
export function pageCapacity(width, height, screenWidth, screenHeight, transcript, singlePage = false) {
    if (singlePage || width * height <= screenWidth * screenHeight / 4 || width < 600)
        return 1;
    const card = 520;
    return Math.max(1, Math.min(2, Math.floor(width / card)));
}
export function selectedAfterUpdate(old, next, index, following) {
    if (!next.length)
        return 0;
    if (following)
        return next.length - 1;
    const id = old[index]?.id;
    const found = next.findIndex((s) => s.id === id);
    if (found >= 0)
        return found;
    const at = old[index]?.t;
    if (at !== undefined) {
        let target = 0;
        next.forEach((slide, i) => { if (slide.t <= at)
            target = i; });
        return target;
    }
    return Math.min(index, next.length - 1);
}
export function glueMessage(frame) {
    if (!frame.startsWith('cd'))
        return '';
    const body = frame.slice(2), separator = body.indexOf('&');
    if (separator < 1)
        return '';
    const length = Number(body.slice(0, separator));
    if (!Number.isInteger(length) || length < 1 || length > body.length - separator - 1)
        return '';
    const channel = body.slice(separator + 1, separator + 1 + length);
    return channel === 'm' ? body.slice(separator + 1 + length) : '';
}
export function reconcileLines(old, historical) {
    const aligned = historical.map((h) => {
        const captured = old.find((l) => l.timing === 'source' && h.t >= l.t - 2 && h.t <= l.end + 2 && (h.text.includes(l.text) || l.text.includes(h.text)));
        return captured ? { id: captured.id, t: captured.t, end: Math.max(captured.end, h.end), text: h.text, timing: 'history' } : h;
    });
    const source = mergeLines(old.filter((l) => l.timing !== 'received'), aligned);
    const approximate = old.filter((l) => l.timing === 'received').filter((l) => {
        return !source.some((s) => Math.abs(s.t - l.t) < 120 && (s.text.includes(l.text) || l.text.includes(s.text)));
    });
    return mergeLines(source, approximate);
}
export function visiblePageGroups(groups, skipEmpty, live) {
    // Do not hide the entire lesson before captions arrive. Keep the pending live page.
    if (!skipEmpty || !groups.some((g) => pageHasContent(g)))
        return groups;
    return groups.filter((g, i) => pageHasContent(g) || (live && i === groups.length - 1));
}
export function spreadStart(index, capacity) {
    return Math.floor(Math.max(0, index) / Math.max(1, capacity)) * Math.max(1, capacity);
}
export function plainTranscript(text) { return text.replace(/\s+/g, ' ').trim(); }
