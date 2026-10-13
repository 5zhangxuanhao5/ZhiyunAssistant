import { Slide, Transcript, imageUrl } from './Timeline';
const url = { URL };
export interface MediaSource { id: string; title: string; url: string; live: boolean; offset: number; hls?: boolean }
export interface StreamOutput { m3u8?: string; m3u8_lhd?: string; m3u8_lsd?: string }
export interface SavedPlayback { contents?: string; mpc?: string; pgc?: string; play_addres_arr?: Record<string, string>; is_m3u8?: string }
export interface MediaContent { save_playback?: SavedPlayback; output?: StreamOutput; output_student?: StreamOutput; tts?: StreamOutput; trans_socket_url?: string }
export interface VideoItem { type?: number; preview_url?: string; title?: string }
export interface ClassroomMedia { sub_content?: string; content?: MediaContent; sub_status?: number | string; video_list?: VideoItem[] | Record<string, VideoItem> }
export function mediaUrl(value: string): string { return imageUrl(value); }
export function resolveMedia(value: string, base: string): string {
  try { return mediaUrl(new url.URL(value, base).toString()); } catch (_) { return ''; }
}
export function mediaIdentity(value: string): string { const parts = value.split('?'); const query = (parts[1] || '').split('&').filter((part: string) => !!part && !/^(token|sign|signature|expires|auth_key|uuid)=/i.test(part)).sort().join('&'); return parts[0] + (query ? '?' + query : ''); }
export function mediaSources(raw: ClassroomMedia): MediaSource[] {
  let content = raw.content || {} as MediaContent;
  try { if (raw.sub_content) content = JSON.parse(raw.sub_content) as MediaContent; } catch (_) {}
  const result: MediaSource[] = [];
  const add = (id: string, title: string, address: string | undefined, live: boolean, hls: boolean = false): void => {
    const valid = mediaUrl(address || '');
    if (valid && !result.some((s: MediaSource) => mediaIdentity(s.url) === mediaIdentity(valid))) result.push({ id, title, url: valid, live, offset: 0, hls: hls || /\.m3u8(?:\?|$)/i.test(valid) });
  };
  if (Number(raw.sub_status) === 1) {
    add('live', '教师直播', content.output?.m3u8, true);
    add('student', '教室画面', content.output_student?.m3u8, true);
    add('screen', '课件画面', content.tts?.m3u8, true);
  }
  const save = content.save_playback;
  add('recording', Number(raw.sub_status) === 1 ? '教师主画面 · 直播回放' : '教师主画面 · 课程回放', save?.contents || save?.mpc || save?.pgc, false, save?.is_m3u8 === 'yes');
  const qualities: Record<string, string> = save?.play_addres_arr || {};
  if (!result.some((source: MediaSource) => source.id === 'recording')) { const key = Object.keys(qualities).find((quality: string) => !!mediaUrl(qualities[quality])); if (key) add('recording', '教师主画面 · 课程回放', mediaUrl(qualities.default || '') ? qualities.default : qualities[key], false, save?.is_m3u8 === 'yes'); }
  Object.values(raw.video_list || {} as Record<string, VideoItem>).forEach((item: VideoItem, i: number) => {
    const label = item.title?.trim() || '';
    const placeholder = /^(?:default|默认|课程回放|直播回放|教室回放|画面\s*\d+|camera\s*\d+)$/i.test(label);
    const meaning = item.type === 4 ? '教室全景 · 课程录像' : item.type === 3 ? '讲台机位 · 课程录像' : `备用机位 ${i + 1} · 课程录像`;
    add('track-' + i, label && !placeholder ? label : meaning, item.preview_url, false);
  });
  return result;
}
export function pageAtTime(slides: Slide[], seconds: number): number {
  let index = 0;
  slides.forEach((s: Slide, i: number) => { if (s.t <= seconds) index = i; });
  return index;
}
export function contextLines(slides: Slide[], lines: Transcript[], at: number, whole: boolean): string {
  const ppt = slides.filter((s: Slide) => whole || s.t <= at).map((s: Slide, i: number) => `[课件 ${i + 1}｜${s.t.toFixed(1)}秒] ${s.note || ''}`);
  const asr = lines.filter((l: Transcript) => whole || l.t <= at).map((l: Transcript) => `[讲解 ${l.t.toFixed(1)}秒] ${l.text}`);
  return ppt.concat(asr).join('\n');
}
export interface HlsSegment { url: string; name: string }
export interface HlsPlan { text: string; files: HlsSegment[]; variant: string; audio: string; offset: number; endList: boolean }
function assetName(address: string): string {
  let a = 2166136261, b = 5381;
  for (let i = 0; i < address.length; i++) { a = Math.imul(a ^ address.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ address.charCodeAt(i); }
  return (a >>> 0).toString(16) + (b >>> 0).toString(16);
}
export function hlsPlan(text: string, base: string, courseStart: number = 0): HlsPlan {
  if (!text.trim().startsWith('#EXTM3U')) throw new Error('平台未返回有效的视频清单');
  const lines = text.trim().split(/\r?\n/), files: HlsSegment[] = [];
  let variant = '', audio = '', offset = 0, extension = 'ts', dated = false;
  const output: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('#EXT-X-STREAM-INF:') && !variant) variant = resolveMedia(lines[i + 1]?.trim() || '', base);
    if (line.startsWith('#EXT-X-MEDIA:') && /TYPE=AUDIO/.test(line) && !audio) audio = resolveMedia(/URI="([^"]+)"/.exec(line)?.[1] || '', base);
    if (line.startsWith('#EXT-X-PROGRAM-DATE-TIME:') && !dated) { offset = Math.max(0, Date.parse(line.slice(25)) / 1000 - courseStart); dated = true; }
    if (/^#EXT-X-KEY:/.test(line) && !/METHOD=NONE/.test(line) && (!/METHOD=AES-128/.test(line) || /KEYFORMAT="(?!identity)/.test(line))) throw new Error('此视频的版权保护格式暂不支持离线下载');
    if (/^#EXT-X-(KEY|MAP):/.test(line)) {
      const remote = resolveMedia(/URI="([^"]+)"/.exec(line)?.[1] || '', base);
      if (remote) {
        const name = 'asset-' + assetName(remote) + (/^#EXT-X-KEY/.test(line) ? '.key' : '.mp4');
        files.push({ url: remote, name }); output.push(line.replace(/URI="[^"]+"/, `URI="${name}"`)); continue;
      }
      if (!/METHOD=NONE/.test(line)) throw new Error('此视频的密钥或初始化片段地址不受支持');
    }
    if (line && !line.startsWith('#') && !variant) {
      const remote = resolveMedia(line, base); if (!remote) throw new Error('视频片段地址无效');
      extension = /\.(m4s|mp4)(?:\?|$)/.test(remote) ? 'm4s' : 'ts';
      const name = 'segment-' + assetName(remote) + '.' + extension;
      files.push({ url: remote, name }); output.push(name);
    } else output.push(line);
  }
  if (!variant && !lines.includes('#EXT-X-ENDLIST')) output.push('#EXT-X-ENDLIST');
  return { text: output.join('\n') + '\n', files, variant, audio, offset, endList: lines.includes('#EXT-X-ENDLIST') };
}
