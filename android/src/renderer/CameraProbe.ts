import Hls from 'hls.js';
import type { Course } from '../shared/bridge';
import { cameraFrame, CameraFrame, courseVideoBounds, playbackHlsConfig, timelineAnchor } from './videoLogic';

function aborted(): DOMException { return new DOMException('机位比较已取消', 'AbortError'); }
function waitFor(video: HTMLVideoElement, signal: AbortSignal, predicate: () => boolean, timeout = 5500): Promise<void> {
  if (signal.aborted) return Promise.reject(aborted());
  if (predicate()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (error?: Error): void => { if (finished) return; finished = true; clearTimeout(timer); clearInterval(poll); events.forEach(event => video.removeEventListener(event, changed)); video.removeEventListener('error', failed); signal.removeEventListener('abort', cancelled); error ? reject(error) : resolve(); };
    const changed = (): void => { if (predicate()) finish(); }, failed = (): void => finish(new Error('机位无法解码')), cancelled = (): void => finish(aborted());
    const events = ['loadedmetadata', 'loadeddata', 'canplay', 'seeked', 'progress', 'durationchange'], timer = setTimeout(() => finish(new Error('机位比较超时')), timeout), poll = setInterval(changed, 80);
    events.forEach(event => video.addEventListener(event, changed)); video.addEventListener('error', failed); signal.addEventListener('abort', cancelled, { once: true }); changed();
  });
}

/** Tiny paused frames from the same lesson-local times; never seek the visible player. */
export async function probeCamera(source: any, course: Course, points: [number, number], signal: AbortSignal, resolve: (source: any) => Promise<any>): Promise<CameraFrame[] | undefined> {
  const video = document.createElement('video'), canvas = document.createElement('canvas'); let player: Hls | undefined, offset = Number(source.offset) || 0;
  video.muted = true; video.playsInline = true; video.preload = 'metadata'; video.crossOrigin = 'anonymous'; canvas.width = 64; canvas.height = 36;
  const stop = (): void => { player?.destroy(); player = undefined; video.pause(); video.removeAttribute('src'); video.load(); }; signal.addEventListener('abort', stop, { once: true });
  try {
    const result = await resolve(source); if (signal.aborted) throw aborted(); offset = Number.isFinite(result.offset) ? result.offset : offset;
    const address = String(result.url || '');
    if ((source.hls || result.hls || /\.m3u8(?:\?|$)/i.test(address)) && Hls.isSupported()) {
      player = new Hls({ ...playbackHlsConfig(!!source.live), enableWorker: false, backBufferLength: 0, maxBufferLength: 3, maxMaxBufferLength: 6, maxBufferSize: 4 * 1024 * 1024 });
      player.on(Hls.Events.LEVEL_LOADED, (_event, details) => { const anchor = timelineAnchor(details.details.fragments, course.start, !!source.live, details.details.edge, Date.now() / 1000); if (anchor !== undefined) offset = anchor; });
      player.attachMedia(video); player.loadSource(address);
    } else video.src = address;
    await waitFor(video, signal, () => video.readyState >= 1 && video.videoWidth > 0);
    const frames: CameraFrame[] = [];
    for (const at of points) {
      if (signal.aborted) throw aborted();
      await waitFor(video, signal, () => courseVideoBounds(Array.from({ length: video.seekable.length }, (_, index) => ({ start: video.seekable.start(index), end: video.seekable.end(index) })), video.duration, offset).seekable);
      const bounds = courseVideoBounds(Array.from({ length: video.seekable.length }, (_, index) => ({ start: video.seekable.start(index), end: video.seekable.end(index) })), video.duration, offset);
      if (at < bounds.start + .1 || at > bounds.end - .3) return undefined;
      const target = at - offset; if (target < 0) return undefined;
      if (player && source.live) { player.stopLoad(); video.currentTime = target; player.startLoad(target); } else video.currentTime = target;
      await waitFor(video, signal, () => !video.seeking && video.readyState >= 2 && Math.abs(video.currentTime - target) <= .3);
      const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) return undefined;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push(cameraFrame(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, video.videoWidth / video.videoHeight, video.currentTime + offset));
    }
    return frames;
  } catch (_) { return undefined; }
  finally { signal.removeEventListener('abort', stop); stop(); canvas.width = 0; canvas.height = 0; }
}
