// Generated from shared HarmonyOS sources by sync-harmony-models.cjs.
export function paneTitle(id) { return id === 'video' ? '视频' : id === 'slides' ? '课件' : id === 'transcript' ? '课堂转写' : id === 'notes' ? '课堂笔记' : id === 'summary' ? '本页速览' : '课程问答'; }
function bounded(value, min, max) { return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min)); }
export function normalizePane(value) {
    const w = bounded(value.w, 0.12, 1), h = bounded(value.h, 0.12, 1);
    return { id: value.id, x: bounded(value.x, 0.04 - w, 0.96), y: bounded(value.y, 0, 0.96), w, h, z: bounded(value.z, 0, 100) };
}
export function alterPane(value, dx, dy, resize) {
    return normalizePane({ id: value.id, x: resize ? value.x : value.x + dx, y: resize ? value.y : value.y + dy,
        w: resize ? bounded(value.w + dx, 0.12, 1) : value.w,
        h: resize ? bounded(value.h + dy, 0.12, 1) : value.h, z: value.z });
}
export function defaultPanes(ids, narrow, preset = 'auto') {
    if (!ids.length)
        return [];
    if (narrow || preset === 'rows')
        return ids.map((id, i) => { return { id, x: 0, y: i / ids.length, w: 1, h: 1 / ids.length, z: i }; });
    if (preset === 'columns')
        return ids.map((id, i) => { return { id, x: i / ids.length, y: 0, w: 1 / ids.length, h: 1, z: i }; });
    if (ids.length === 1)
        return [{ id: ids[0], x: 0, y: 0, w: 1, h: 1, z: 0 }];
    if (ids.length === 2 && ids.includes('slides') && ids.includes('transcript'))
        return [
            { id: 'slides', x: 0, y: 0, w: 1, h: 0.62, z: 0 },
            { id: 'transcript', x: 0, y: 0.62, w: 1, h: 0.38, z: 1 }
        ];
    const dock = ids.filter((id) => id === 'notes' || id === 'ai' || id === 'summary'), study = ids.filter((id) => id !== 'notes' && id !== 'ai' && id !== 'summary');
    const width = dock.length && study.length ? 0.62 : 1;
    const output = [];
    if (study.includes('video')) {
        const rest = study.filter((id) => id !== 'video');
        output.push({ id: 'video', x: 0, y: 0, w: width, h: rest.length ? 0.55 : 1, z: 0 });
        rest.forEach((id, i) => output.push({ id, x: i * width / rest.length, y: 0.55, w: width / rest.length, h: 0.45, z: i + 1 }));
    }
    else
        study.forEach((id, i) => output.push({ id, x: i * width / study.length, y: 0, w: width / study.length, h: 1, z: i }));
    dock.forEach((id, i) => output.push({ id, x: study.length ? width : 0, y: i / dock.length, w: study.length ? 1 - width : 1, h: 1 / dock.length, z: i + 3 }));
    return output;
}
export function validPanes(raw) {
    const seen = new Set();
    return raw.filter((rect) => !!rect && ['video', 'slides', 'transcript', 'notes', 'ai', 'summary'].includes(rect.id) && !seen.has(rect.id) && [rect.x, rect.y, rect.w, rect.h, rect.z].every((n) => Number.isFinite(n)) && !!seen.add(rect.id)).map(normalizePane);
}
// Opposite edges stay fixed; all eight resize handles share these bounds.
export function resizePane(value, dx, dy, edge) {
    if (edge === 'move')
        return alterPane(value, dx, dy, false);
    let left = value.x, top = value.y, right = value.x + value.w, bottom = value.y + value.h;
    if (edge.includes('w'))
        left = bounded(left + dx, right - 1, right - 0.12);
    if (edge.includes('e'))
        right = bounded(right + dx, left + 0.12, left + 1);
    if (edge.includes('n'))
        top = bounded(top + dy, Math.max(0, bottom - 1), bottom - 0.12);
    if (edge.includes('s'))
        bottom = bounded(bottom + dy, top + 0.12, top + 1);
    return normalizePane({ id: value.id, x: left, y: top, w: right - left, h: bottom - top, z: value.z });
}
export function layoutKey(ids, width, height) {
    return Array.from(new Set(ids)).sort().join('+') + '@' + Math.round(width) + 'x' + Math.round(height);
}
export function matchingLayout(raw, ids) {
    const rects = validPanes(raw || []);
    return rects.length === ids.length && ids.every((id) => rects.some((rect) => rect.id === id)) ? rects : [];
}
export function reorderPanes(rects, id, action) {
    const ordered = rects.slice().sort((a, b) => a.z - b.z);
    const index = ordered.findIndex((rect) => rect.id === id);
    if (index < 0)
        return rects.slice();
    const target = action === 'top' ? ordered.length - 1 : action === 'bottom' ? 0 : bounded(index + (action === 'up' ? 1 : -1), 0, ordered.length - 1);
    const chosen = ordered.splice(index, 1)[0];
    ordered.splice(target, 0, chosen);
    return ordered.map((rect, z) => { return { id: rect.id, x: rect.x, y: rect.y, w: rect.w, h: rect.h, z }; });
}
export function recoverPane(value) {
    const rect = normalizePane(value);
    return { id: rect.id, x: bounded(rect.x, 0, 1 - rect.w), y: bounded(rect.y, 0, 1 - rect.h), w: rect.w, h: rect.h, z: rect.z };
}
