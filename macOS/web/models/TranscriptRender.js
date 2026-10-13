// Generated from shared HarmonyOS sources by sync-harmony-models.cjs.
export function offsetLine(offsets, at) { if (!offsets.length)
    return -1; let low = 0, high = offsets.length - 1; while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (offsets[mid] <= at)
        low = mid;
    else
        high = mid - 1;
} return low; }
export function transcriptRuns(value, offsets, active, highlights) { const marked = new Set(highlights), cuts = new Set([0, value.length]); [active].concat(highlights).forEach((index) => { if (index >= 0 && index < offsets.length) {
    cuts.add(offsets[index]);
    cuts.add(offsets[index + 1] ?? value.length);
} }); const positions = Array.from(cuts).sort((a, b) => a - b), result = []; for (let i = 0; i < positions.length - 1; i++) {
    const start = positions[i], end = positions[i + 1], index = offsetLine(offsets, start);
    if (end > start) {
        const current = { key: start + ':' + end, value: value.slice(start, end), active: index === active, highlight: marked.has(index) }, previous = result[result.length - 1];
        if (previous && previous.active === current.active && previous.highlight === current.highlight) {
            previous.value += current.value;
            previous.key = previous.key.split(':')[0] + ':' + end;
        }
        else
            result.push(current);
    }
} return result; }
export function visibleTranscriptMarkers(offsets, start, end, active, highlight = -1) { const visible = new Set(), first = Math.max(0, offsetLine(offsets, start) - 2), last = Math.min(offsets.length - 1, offsetLine(offsets, end) + 2); for (let index = first; index <= last; index++)
    visible.add(index); if (active >= 0 && active < offsets.length)
    visible.add(active); if (highlight >= 0 && highlight < offsets.length)
    visible.add(highlight); return Array.from(visible).sort((a, b) => a - b); }
