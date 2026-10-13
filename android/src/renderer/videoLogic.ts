import type { HlsConfig } from 'hls.js';
export interface VideoRange { start: number; end: number }
export interface VideoBounds extends VideoRange { seekable: boolean }
export interface DatedFragment { start: number; programDateTime?: number | string | null }
export interface CameraFrame { pixels: Uint8Array; contrast: number; aspect: number; at: number }
export function courseVideoBounds(ranges: VideoRange[], duration: number, offset: number): VideoBounds {
  const valid = ranges.filter(range => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start).sort((a, b) => a.start - b.start);
  if (valid.length) return { start: Math.max(0, valid[0].start + offset), end: Math.max(0, valid[valid.length - 1].end + offset), seekable: true };
  if (Number.isFinite(duration) && duration > 0) return { start: Math.max(0, offset), end: Math.max(0, duration + offset), seekable: true };
  return { start: Math.max(0, offset), end: Math.max(0, offset), seekable: false };
}
export function courseSeekTarget(at: number, bounds: VideoBounds, live: boolean): number | undefined {
  if (!Number.isFinite(at) || !bounds.seekable || bounds.end <= bounds.start) return undefined;
  const margin = live ? Math.min(0.25, (bounds.end - bounds.start) / 4) : 0;
  const tail = Math.min(live ? 0.25 : 0.15, (bounds.end - bounds.start) / 4);
  return Math.max(bounds.start + margin, Math.min(bounds.end - tail, at));
}
export function timelineAnchor(fragments: DatedFragment[], courseStart: number, live: boolean, edge: number, now: number): number | undefined {
  if (!Number.isFinite(courseStart) || courseStart <= 0) return undefined;
  for (const fragment of fragments) {
    const date = typeof fragment.programDateTime === 'number' ? fragment.programDateTime : fragment.programDateTime ? Date.parse(fragment.programDateTime) : NaN;
    if (Number.isFinite(date) && Number.isFinite(fragment.start)) return Math.max(0, date / 1000 - courseStart - fragment.start);
  }
  return live && Number.isFinite(edge) && edge > 0 && Number.isFinite(now) ? Math.max(0, now - courseStart - edge) : undefined;
}
export function replayAvailable(recordings: number, bounds: VideoBounds): boolean { return recordings > 0 || bounds.seekable && bounds.end - bounds.start >= 30; }
export function boundedRate(rate: number): number { return Number.isFinite(rate) ? Math.max(0.1, Math.min(16, rate)) : 1; }
export function playbackHlsConfig(live: boolean): Partial<HlsConfig> {
  // Keep the matched default live duration-count configuration. Overriding only
  // one member is rejected by hls.js before any manifest can be loaded.
  return { enableWorker: true, backBufferLength: 1800, maxBufferLength: 40, maxMaxBufferLength: 90, lowLatencyMode: live, liveSyncOnStallIncrease: 0, maxLiveSyncPlaybackRate: 1 };
}
export function draggedVideoTarget(start: number, dx: number, width: number, bounds: VideoBounds, live: boolean): number | undefined {
  const ratio = Math.max(0.18, Math.min(0.8, 120 / Math.max(320, width)));
  return courseSeekTarget(start + dx * ratio, bounds, live);
}
export function cameraSampleTimes(bounds: VideoBounds, live: boolean): [number, number] | undefined {
  const span = bounds.end - bounds.start;
  if (!bounds.seekable || !Number.isFinite(span) || span < 12) return undefined;
  const points = live ? [bounds.end - Math.min(24, span * .75), bounds.end - Math.min(6, span * .25)] : [bounds.start + Math.min(30, span * .25), bounds.start + Math.min(90, span * .7)];
  return [Math.round(points[0] * 1000) / 1000, Math.round(points[1] * 1000) / 1000];
}
export function cameraFrame(bytes: Uint8ClampedArray | Uint8Array, width: number, height: number, aspect: number, at: number): CameraFrame {
  if (width < 16 || height < 9 || bytes.length < width * height * 4 || !Number.isFinite(aspect) || aspect <= 0) return { pixels: new Uint8Array(), contrast: 0, aspect, at };
  const pixels = new Uint8Array(width * height * 3); let sum = 0, squares = 0;
  for (let pixel = 0; pixel < width * height; pixel++) { const source = pixel * 4, target = pixel * 3; pixels[target] = bytes[source]; pixels[target + 1] = bytes[source + 1]; pixels[target + 2] = bytes[source + 2]; const light = bytes[source] * .2126 + bytes[source + 1] * .7152 + bytes[source + 2] * .0722; sum += light; squares += light * light; }
  const count = width * height, mean = sum / count;
  return { pixels, contrast: Math.sqrt(Math.max(0, squares / count - mean * mean)), aspect, at };
}
export function sameCameraFrames(left: CameraFrame[], right: CameraFrame[]): boolean {
  if (left.length !== 2 || right.length !== 2 || Math.abs(left[1].at - left[0].at) < 4) return false;
  return left.every((frame, index) => {
    const other = right[index]; if (!frame.pixels.length || frame.pixels.length !== other.pixels.length || frame.contrast < 12 || other.contrast < 12 || Math.abs(frame.aspect - other.aspect) > .015 || Math.abs(frame.at - other.at) > .3) return false;
    let error = 0, different = 0; for (let pixel = 0; pixel < frame.pixels.length; pixel++) { const delta = Math.abs(frame.pixels[pixel] - other.pixels[pixel]); error += delta; if (delta > 12) different++; }
    return error / frame.pixels.length <= 2.5 && different / frame.pixels.length <= .01;
  });
}
export function collapseCameraSources<T extends { id: string; identity: string }>(sources: T[], groups: string[][], selectedId: string): T[] {
  const removed = new Set<string>();
  for (const group of groups) { const matched = sources.filter(source => group.includes(source.identity)); if (matched.length < 2) continue; const keep = matched.find(source => source.id === selectedId) || matched[0]; matched.forEach(source => { if (source.identity !== keep.identity) removed.add(source.identity); }); }
  return sources.filter(source => !removed.has(source.identity));
}
