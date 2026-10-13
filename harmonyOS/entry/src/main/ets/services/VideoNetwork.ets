import { LocalStore, key } from './LocalStore';
import { Course } from '../model/Timeline';
import { fileIo as fs } from '@kit.CoreFileKit';
import { media } from '@kit.MediaKit';
import { FrameSignature, frameSignature, sameFrames } from '../model/VideoFingerprint';
import { image } from '@kit.ImageKit';
import { http } from '@kit.NetworkKit';
import { util } from '@kit.ArkTS';
import { MediaSource, mediaIdentity, hlsPlan, mediaUrl } from '../model/Media';
import { SessionStore } from './SessionStore';
export interface MediaReply { data?: ArrayBuffer; id: string; status: number; text: string; base64: string; size: number; mime: string; error: string; contentRange: string }
interface VideoCacheMeta { status: number; mime: string; contentRange: string; etag: string; modified: string; savedAt: number }
export class VideoNetwork {
  private store: LocalStore | undefined = undefined;
  private course: Course | undefined = undefined;
  useCache(store: LocalStore | undefined): void { this.store = store; this.course = store?.activeCourse; }
  private epoch: number = 0;
  private extractors: Set<media.AVMetadataExtractor> = new Set();
  private pending: Set<http.HttpRequest> = new Set();
  cancel(): void { this.epoch++; this.extractors.forEach((extractor: media.AVMetadataExtractor) => extractor.release().catch(() => {})); this.extractors.clear(); this.pending.forEach((r: http.HttpRequest) => r.destroy()); this.pending.clear(); }
  async available(address: string): Promise<boolean> {
    if (!mediaUrl(address)) return false;
    const req = http.createHttp(); this.pending.add(req);
    try {
      const result = await req.request(address, { method: http.RequestMethod.HEAD, header: { Referer: 'https://classroom.zju.edu.cn/' }, usingCache: false, connectTimeout: 4000, readTimeout: 5000 });
      const headers = result.header as Record<string, string>, type = headers['content-type'] || headers['Content-Type'] || '', size = headers['content-length'] || headers['Content-Length'];
      return (result.responseCode === 200 || result.responseCode === 206) && !/html|json/i.test(type) && size !== '0';
    } catch (_) { return false; } finally { req.destroy(); this.pending.delete(req); }
  }
  private async frame(address: string, at: number): Promise<FrameSignature> {
    const extractor = await media.createAVMetadataExtractor(); this.extractors.add(extractor);
    let timer = -1, expired = false, pixels: image.PixelMap | undefined;
    try {
      const origin = /^https:\/\/[^/]+/.exec(address)?.[0] || '';
      const headers: Record<string, string> = {}; headers['Referer'] = 'https://classroom.zju.edu.cn/';
      if (/^https:\/\/(?:[A-Za-z0-9-]+\.)*zju\.edu\.cn$/.test(origin)) headers['Cookie'] = SessionStore.cookie(origin);
      extractor.setUrlSource(address, headers);
      const timed = new Promise<image.PixelMap>((resolve, reject) => { timer = setTimeout(() => { expired = true; reject(new Error('画面比较超时')); }, 6000); extractor.fetchFrameByTime(at * 1000000, media.AVImageQueryOptions.AV_IMAGE_QUERY_CLOSEST_SYNC, { width: 64, height: 36 }).then((pixel: image.PixelMap) => { if (expired) pixel.release().catch(() => {}); else resolve(pixel); }, reject); });
      pixels = await timed; const info = await pixels.getImageInfo();
      const buffer = new ArrayBuffer(pixels.getPixelBytesNumber()); await pixels.readPixelsToBuffer(buffer);
      return frameSignature(new Uint8Array(buffer), info.size.width, info.size.height, pixels.getBytesNumberPerRow());
    } finally { clearTimeout(timer); if (pixels) await pixels.release(); if (this.extractors.delete(extractor)) await extractor.release().catch(() => {}); }
  }
  private async fingerprints(source: MediaSource): Promise<FrameSignature[]> {
    if (!source.hls && !/\.m3u8(?:\?|$)/i.test(source.url)) return [await this.frame(source.url, 30), await this.frame(source.url, 90)];
    let reply = await this.read('compare', source.url);
    if (reply.status !== 200 || !reply.text) return [];
    let plan = hlsPlan(reply.text, source.url);
    if (plan.variant) { reply = await this.read('compare-variant', plan.variant); if (reply.status !== 200) return []; plan = hlsPlan(reply.text, plan.variant); }
    const segments = plan.files.filter((file) => file.name.startsWith('segment-'));
    if (segments.length < 2) return [];
    const indexes = source.live ? [Math.max(0, segments.length - 4), segments.length - 1] : [Math.min(5, segments.length - 2), Math.min(15, segments.length - 1)];
    if (indexes[0] === indexes[1]) return [];
    return [await this.frame(segments[indexes[0]].url, 0), await this.frame(segments[indexes[1]].url, 0)];
  }
  async uniqueSources(sources: MediaSource[]): Promise<MediaSource[]> {
    const gen = this.epoch, result: MediaSource[] = [], samples: FrameSignature[][] = [];
    for (let i = 0; i < Math.min(8, sources.length); i++) {
      const source = sources[i];
      if (gen !== this.epoch) return result;
      if (result.some((item: MediaSource) => mediaIdentity(item.url) === mediaIdentity(source.url))) continue;
      if (i && !await this.available(source.url)) continue;
      let frames: FrameSignature[] = []; try { frames = await this.fingerprints(source); } catch (_) {}
      if (gen !== this.epoch) return result;
      if (samples.some((previous: FrameSignature[]) => sameFrames(previous, frames))) continue;
      result.push(source); samples.push(frames);
    }
    return result;
  }
  async read(id: string, address: string, start: number = -1, end: number = -1, binary: boolean = false): Promise<MediaReply> {
    if (!mediaUrl(address)) throw new Error('视频地址不受支持');
    const headers: Record<string, string> = {}; headers['Referer'] = 'https://classroom.zju.edu.cn/'; headers['Accept'] = '*/*';
    const origin = /^https:\/\/[^/]+/.exec(address)?.[0] || '';
    if (/^https:\/\/(?:[A-Za-z0-9-]+\.)*zju\.edu\.cn$/.test(origin)) headers['Cookie'] = SessionStore.cookie(origin);
    if (start >= 0) headers['Range'] = `bytes=${start}-${end > start ? end - 1 : ''}`;
    const store = this.store, course = this.course, revision = store?.cache.revision('video') || 0;
    const name = key(address + ':' + start + ':' + end), enabled = !!store && !!course && store.cache.enabled('video') && !/\.m3u8(?:\?|$)/i.test(address);
    let cached: VideoCacheMeta | undefined, path = '';
    if (enabled && store && course) { try { path = store.cache.file('video', course, name + '.bin'); cached = JSON.parse(store.cache.read('video', course, name + '.json')) as VideoCacheMeta; if (!fs.accessSync(path)) cached = undefined; } catch (_) {} }
    const readCached = async (): Promise<MediaReply> => { const file = await fs.open(path, fs.OpenMode.READ_ONLY); try { const size = fs.statSync(file.fd).size, data = new ArrayBuffer(size); const read = await fs.read(file.fd, data); if (read !== size) throw new Error('缓存不完整'); return { id, status: cached!.status, text: '', base64: binary ? '' : await new util.Base64Helper().encodeToString(new Uint8Array(data)), data: binary ? data : undefined, size, mime: cached!.mime, contentRange: cached!.contentRange, error: '' }; } finally { fs.closeSync(file); } };
    if (cached && Date.now() - cached.savedAt < 1800000) try { return await readCached(); } catch (_) { cached = undefined; }
    if (cached?.etag) headers['If-None-Match'] = cached.etag; else if (cached?.modified) headers['If-Modified-Since'] = cached.modified;
    const req = http.createHttp(); this.pending.add(req);
    try {
      const result = await req.request(address, { header: headers, expectDataType: http.HttpDataType.ARRAY_BUFFER, usingCache: false, connectTimeout: 12000, readTimeout: 40000, maxLimit: 96 * 1024 * 1024 });
      if (result.responseCode === 304 && cached) { cached.savedAt = Date.now(); if (store && course) store.cache.save('video', course, name + '.json', JSON.stringify(cached), revision); return await readCached(); }
      const received = result.header as Record<string, string>;
      let data = result.result as ArrayBuffer;
      // HLS byte ranges have an exclusive end. Some servers ignore Range and return the whole object.
      let status = result.responseCode, contentRange = received['content-range'] || received['Content-Range'] || '';
      if (start >= 0 && end > start && result.responseCode === 200 && data.byteLength > end - start) { const total = data.byteLength; data = data.slice(start, end); status = 206; contentRange = `bytes ${start}-${Math.min(end, total) - 1}/${total}`; }
      const mime = received['content-type'] || received['Content-Type'] || '';
      const prefix = String.fromCharCode(...Array.from(new Uint8Array(data.slice(0, 32))));
      const playlist = /\.m3u8(?:\?|$)/i.test(address) || /mpegurl/i.test(mime) || prefix.trim().startsWith('#EXTM3U');
      if (enabled && path && !playlist && (status === 200 || status === 206) && data.byteLength && store && course && revision === store.cache.revision('video') && store.cache.enabled('video')) { try { const file = await fs.open(path + '.tmp', fs.OpenMode.CREATE | fs.OpenMode.WRITE_ONLY | fs.OpenMode.TRUNC); try { await fs.write(file.fd, data); } finally { fs.closeSync(file); } if (revision !== store.cache.revision('video') || !store.cache.enabled('video')) { try { fs.unlinkSync(path + '.tmp'); } catch (_) {} } else { fs.renameSync(path + '.tmp', path); store.cache.remember('video', course, path); const meta: VideoCacheMeta = { status, mime, contentRange, etag: received['etag'] || received['ETag'] || '', modified: received['last-modified'] || received['Last-Modified'] || '', savedAt: Date.now() }; store.cache.save('video', course, name + '.json', JSON.stringify(meta), revision); } } catch (_) {} }
      console.info(`[ZhiyunVideo] status=${result.responseCode} bytes=${data.byteLength} playlist=${playlist}`);
      return { id, status, text: playlist ? util.TextDecoder.create('utf-8').decodeToString(new Uint8Array(data)) : '', base64: playlist || binary ? '' : await new util.Base64Helper().encodeToString(new Uint8Array(data)), data: binary && !playlist ? data : undefined, size: data.byteLength, mime, contentRange, error: result.responseCode === 200 || result.responseCode === 206 ? '' : `视频请求失败（${result.responseCode}）` };
    } finally { req.destroy(); this.pending.delete(req); }
  }
}
