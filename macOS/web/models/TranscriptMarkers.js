// Generated from shared HarmonyOS sources by sync-harmony-models.cjs.
export function spacedMarkers(markers, lineHeight) {
    const ordered = markers.filter((marker) => Number.isFinite(marker.top) && Number.isFinite(marker.bottom) && marker.bottom > marker.top).slice().sort((a, b) => a.index - b.index);
    let last = -Infinity;
    return ordered.map((marker) => { const top = Math.max(0, marker.top, last + lineHeight); last = top; return { index: marker.index, top, bottom: Math.max(top + lineHeight, marker.bottom) }; });
}
export function readingMarker(markers, top, height) { return markers.find((marker) => marker.bottom > top + 1 && marker.top < top + height); }
