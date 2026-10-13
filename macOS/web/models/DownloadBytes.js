// Generated from shared HarmonyOS sources by sync-harmony-models.cjs.
export function downloadBytes(parts) {
    let received = 0, total = 0, unknown = 0;
    parts.forEach((part) => { const saved = Math.max(0, part.received || 0); received += part.total >= 0 ? Math.min(saved, part.total) : saved; if (part.total >= 0)
        total += part.total;
    else if (!part.done)
        unknown++; });
    return { received, total, unknown, progress: unknown ? 0 : total > 0 ? Math.min(1, received / total) : parts.length && parts.every((part) => part.done) ? 1 : 0 };
}
export function utf8Bytes(text) { let size = 0; for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 128)
        size++;
    else if (code < 2048)
        size += 2;
    else if (code >= 0xD800 && code <= 0xDBFF && i + 1 < text.length && text.charCodeAt(i + 1) >= 0xDC00 && text.charCodeAt(i + 1) <= 0xDFFF) {
        size += 4;
        i++;
    }
    else
        size += 3;
} return size; }
export function downloadSize(bytes) { return bytes < 1048576 ? (bytes / 1024).toFixed(1) + ' KB' : (bytes / 1048576).toFixed(1) + ' MB'; }
// A partial HLS export keeps only the continuous playable prefix; do not shift later captions across missing segments.
export function availablePlaylist(text, missing) {
    const rows = text.split('\n'), output = [];
    let segmentStart = -1, segments = 0;
    for (const row of rows) {
        if (row.startsWith('#EXTINF:'))
            segmentStart = output.length;
        if (missing.some((name) => row === name || row.includes('URI="' + name + '"'))) {
            if (segmentStart >= 0)
                output.splice(segmentStart);
            break;
        }
        if (row === '#EXT-X-ENDLIST')
            continue;
        output.push(row);
        if (row && !row.startsWith('#')) {
            segments++;
            segmentStart = -1;
        }
    }
    return segments ? output.join('\n').trim() + '\n#EXT-X-ENDLIST\n' : '';
}
