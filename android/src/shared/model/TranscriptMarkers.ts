export interface MarkerPosition { index: number; top: number; bottom: number }
export function spacedMarkers(markers: MarkerPosition[], lineHeight: number): MarkerPosition[] {
  const ordered = markers.filter((marker: MarkerPosition) => Number.isFinite(marker.top) && Number.isFinite(marker.bottom) && marker.bottom > marker.top).slice().sort((a: MarkerPosition, b: MarkerPosition) => a.index - b.index);
  let last = -Infinity;
  return ordered.map((marker: MarkerPosition): MarkerPosition => { const top = Math.max(0, marker.top, last + lineHeight); last = top; return { index: marker.index, top, bottom: Math.max(top + lineHeight, marker.bottom) }; });
}
export function readingMarker(markers: MarkerPosition[], top: number, height: number): MarkerPosition | undefined { return markers.find((marker: MarkerPosition) => marker.bottom > top + 1 && marker.top < top + height); }
