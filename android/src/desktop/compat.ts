/** Harmony algorithms run unchanged against Android's sandbox and system services. */
import { Buffer, decodeBase64, encodeBase64, filePath, path } from './android-tools';
import { nativeBridge } from './android-native';
export interface DesktopAdapters {}
export interface AndroidCookie { name: string; value: string; domain?: string; path?: string; secure?: boolean; httpOnly?: boolean; hostOnly?: boolean; sameSite?: string; expirationDate?: number }
export interface AndroidSession { cookies: { get(filter: any): Promise<AndroidCookie[]>; set(cookie: any): Promise<void>; remove(url: string, name: string): Promise<void>; flushStore(): Promise<void> }; clearStorageData(options: any): Promise<void>; clearCache(): Promise<void>; clearCodeCaches?(options: any): Promise<void>; getStoragePath(): string }
let root = '', session: AndroidSession;
export function configureCompat(value: AndroidSession, userData: string, _adapters?: DesktopAdapters): void { session = value; root = userData; }
export function desktopSession(): AndroidSession { if (!session) throw new Error('登录会话尚未初始化'); return session; }
export function browserSessions(): AndroidSession[] { return session ? [session] : []; }
export function storageRoot(): string { if (!root) throw new Error('本机存储尚未初始化'); return root; }
export function createAndroidSession(cacheDir: string): AndroidSession { return { cookies: { get: filter => nativeBridge().call('cookies.get', filter), set: cookie => nativeBridge().call('cookies.set', cookie), remove: (url, name) => nativeBridge().call('cookies.remove', { url, name }), flushStore: () => nativeBridge().call('cookies.flush') }, getStoragePath: () => cacheDir, clearStorageData: options => options.storages?.includes('cookies') ? nativeBridge().call('cookies.clear', { origin: options.origin }) : nativeBridge().call('app.cacheClear'), clearCache: () => nativeBridge().call('app.cacheClear'), clearCodeCaches: () => nativeBridge().call('app.cacheClear') }; }
export function allowedNetworkUrl(address: string): URL { const url = new URL(address); if (url.username || url.password || url.protocol !== 'https:' || url.port && url.port !== '443') throw new Error('资源地址无效'); const host = url.hostname.toLowerCase(); if (host !== 'api.deepseek.com' && !['zju.edu.cn', 'chinamcloud.com', 'chinamcloud.cn', 'chinamcache.com'].some(domain => host === domain || host.endsWith('.' + domain))) throw new Error('资源地址不属于课程服务'); return url; }
export async function credentialledFetch(address: string, options: RequestInit = {}): Promise<Response> { allowedNetworkUrl(address); if (options.signal?.aborted) throw new Error('已取消'); const value = await nativeBridge().call('http.request', { url: address, method: options.method || 'GET', headers: Object.fromEntries(new Headers(options.headers).entries()), body: options.body, maxBytes: 12 * 1024 * 1024 }); if (options.signal?.aborted) throw new Error('已取消'); return new Response(value.base64 ? decodeBase64(value.body) : value.body, { status: value.status, headers: value.headers }); }
class Emitter { private values = new Map<string, Set<(...args: any[]) => void>>(); on(name: string, fn: (...args: any[]) => void) { let set = this.values.get(name); if (!set) { set = new Set(); this.values.set(name, set); } set.add(fn); } off(name: string) { this.values.delete(name); } emit(name: string, ...args: any[]) { for (const fn of Array.from(this.values.get(name) || [])) fn(...args); } }
function lowerHeaders(value: Record<string, string>): Record<string, string> { return Object.fromEntries(Object.entries(value).map(([name, data]) => [name.toLowerCase(), data])); }
let requestSequence = 0;
export namespace http {
 export enum RequestMethod { GET = 'GET', POST = 'POST', HEAD = 'HEAD' }
 export enum HttpDataType { STRING = 'STRING', ARRAY_BUFFER = 'ARRAY_BUFFER' }
 export interface Options { method?: RequestMethod; header?: Record<string, string>; extraData?: string; expectDataType?: HttpDataType; connectTimeout?: number; readTimeout?: number; usingCache?: boolean; maxLimit?: number }
 export interface HttpResponse { responseCode: number; result: string | ArrayBuffer; header: Record<string, string> }
 export class HttpRequest {
  private events = new Emitter(); private id = ''; private canceled = false; private listeners: Array<() => void> = []; private rejectStream?: (error: Error) => void; private idleTimer?: ReturnType<typeof setTimeout>;
  on(name: string, fn: (...args: any[]) => void) { this.events.on(name, fn); } off(name: string) { this.events.off(name); }
  destroy(): void { this.canceled = true; if (this.id) void nativeBridge().call('http.cancel', { requestId: this.id }).catch(() => {}); this.rejectStream?.(new Error('已取消')); this.cleanup(); }
  private cleanup(): void { clearTimeout(this.idleTimer); this.listeners.splice(0).forEach(off => off()); this.rejectStream = undefined; }
  private payload(address: string, options: Options): any { allowedNetworkUrl(address); if (this.canceled) throw new Error('已取消'); return { url: address, method: options.method || 'GET', headers: options.header || {}, body: options.method === RequestMethod.POST ? options.extraData : undefined, timeout: (options.readTimeout || 30000) + (options.connectTimeout || 8000), maxBytes: options.maxLimit || 12 * 1024 * 1024, expectDataType: options.expectDataType, requestId: this.id }; }
  async request(address: string, options: Options = {}): Promise<HttpResponse> { this.id = 'http-' + (++requestSequence); const response = await nativeBridge().call('http.request', this.payload(address, options)); if (this.canceled) throw new Error('已取消'); const bytes = response.base64 ? decodeBase64(response.body) : new globalThis.TextEncoder().encode(response.body || ''); return { responseCode: response.status, header: lowerHeaders(response.headers || {}), result: options.expectDataType === HttpDataType.ARRAY_BUFFER ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer : new globalThis.TextDecoder().decode(bytes) }; }
  async requestInStream(address: string, options: Options = {}): Promise<number> {
   this.id = 'stream-' + (++requestSequence); const bridge = nativeBridge(), payload = { ...this.payload(address, options), maxBytes: options.maxLimit || 64 * 1024 * 1024 * 1024, backpressure: true }; let length = 0, ended = false;
   let resolveEnd!: () => void; const end = new Promise<void>((resolve, reject) => { resolveEnd = resolve; this.rejectStream = reject; });
   const armIdle = () => { clearTimeout(this.idleTimer); this.idleTimer = setTimeout(() => { this.rejectStream?.(new Error('网络响应超时')); this.destroy(); }, payload.timeout); }; armIdle();
   // Attach all handlers before requesting: headers/data/end may arrive before the post result.
   this.listeners.push(bridge.on('http.headers', value => { if (value.requestId === this.id && !this.canceled) try { armIdle(); this.events.emit('headersReceive', lowerHeaders(value.headers || {})); } catch (error) { this.rejectStream?.(error as Error); this.destroy(); } }), bridge.on('http.data', value => { if (value.requestId !== this.id) return; try { if (this.canceled || ended) return; armIdle(); const bytes = decodeBase64(value.base64); length += bytes.byteLength; if (length > payload.maxBytes) throw new Error('资源超过允许大小'); this.events.emit('dataReceive', bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)); } catch (error) { this.rejectStream?.(error as Error); this.destroy(); } finally { if (typeof value.sequence === 'number') void bridge.call('http.ack', { requestId: this.id, sequence: value.sequence }).catch(() => {}); } }), bridge.on('http.end', value => { if (value.requestId !== this.id || ended) return; ended = true; clearTimeout(this.idleTimer); if (value.error) this.rejectStream?.(new Error(String(value.error))); else { try { this.events.emit('dataEnd'); resolveEnd(); } catch (error) { this.rejectStream?.(error as Error); } } }), bridge.on('http.error', value => { if (value.requestId === this.id && !ended) { ended = true; clearTimeout(this.idleTimer); this.rejectStream?.(new Error(String(value.error || '网络连接中断'))); } }));
   // Observe an early rejected stream immediately; wait for completion rather than trusting status alone.
   void end.catch(() => {});
   try { const response = await bridge.call<any>('http.stream', payload); if (this.canceled) throw new Error('已取消'); await end; return typeof response === 'number' ? response : Number(response.status); } finally { this.cleanup(); }
  }
 }
 export function createHttp(): HttpRequest { return new HttpRequest(); }
}
export namespace fileIo {
 export interface File { fd: number } export enum OpenMode { READ_ONLY = 0, WRITE_ONLY = 1, READ_WRITE = 2, CREATE = 64, TRUNC = 512, APPEND = 1024 }
 export const local = filePath;
 export function openSync(value: string, flags = OpenMode.READ_ONLY): File { return nativeBridge().sync('fs.open', { path: local(value), flags }); }
 export function closeSync(value: File | number): void { nativeBridge().sync('fs.close', { fd: typeof value === 'number' ? value : value.fd }); }
 export function accessSync(value: string): boolean { return nativeBridge().sync('fs.exists', { path: local(value) }); }
 export function mkdirSync(value: string, recursive = false): void { nativeBridge().sync('fs.mkdir', { path: local(value), recursive }); }
 export function listFileSync(value: string): string[] { return nativeBridge().sync('fs.list', { path: local(value) }); }
 export function readTextSync(value: string): string { return nativeBridge().sync('fs.readText', { path: local(value) }); }
 export function statSync(value: string | number): any { const stat = nativeBridge().sync('fs.stat', typeof value === 'number' ? { fd: value } : { path: local(value) }); return { size: stat.size, mtime: stat.mtime, isDirectory: () => stat.directory === true }; }
 export function writeSync(fd: number, value: string | ArrayBuffer | Uint8Array): number { const bytes = typeof value === 'string' ? new globalThis.TextEncoder().encode(value) : value instanceof ArrayBuffer ? new Uint8Array(value) : value; let count = 0; for (let at = 0; at < bytes.byteLength; at += 256 * 1024) { const chunk = bytes.subarray(at, at + 256 * 1024), written = nativeBridge().sync<number>('fs.write', { fd, base64: encodeBase64(chunk) }); count += written; if (written !== chunk.byteLength) return count; } return count; }
 export function readSync(fd: number, value: ArrayBuffer): number { const out = new Uint8Array(value); let at = 0; while (at < out.byteLength) { const bytes = decodeBase64(nativeBridge().sync('fs.read', { fd, length: Math.min(256 * 1024, out.byteLength - at) })); out.set(bytes, at); at += bytes.byteLength; if (bytes.byteLength === 0) break; } return at; }
 export function renameSync(from: string, to: string): void { nativeBridge().sync('fs.rename', { from: local(from), to: local(to) }); }
 export function unlinkSync(value: string): void { nativeBridge().sync('fs.remove', { path: local(value), recursive: false }); }
 export function rmdirSync(value: string): void { if (accessSync(value)) nativeBridge().sync('fs.remove', { path: local(value), recursive: true }); }
 export function truncateSync(fd: number, length: number): void { nativeBridge().sync('fs.truncate', { fd, length }); }
 export function copyFileSync(from: string | number, to: string | number): void { nativeBridge().sync('fs.copy', { from: typeof from === 'string' ? local(from) : from, to: typeof to === 'string' ? local(to) : to }); }
}
export namespace fileUri { export class FileUri { path: string; constructor(value: string) { this.path = filePath(value); } } export function getUriFromPath(value: string): string { return new URL('file://' + filePath(value).split('/').map(encodeURIComponent).join('/')).href; } }
export namespace common { export interface UIAbilityContext { filesDir: string; cacheDir: string; tempDir: string; androidExport?: boolean } }
export type BusinessError = Error;
export const webview = { WebCookieManager: { fetchCookieSync: (url: string) => nativeBridge().sync<AndroidCookie[]>('cookies.get', { url }).map(cookie => cookie.name + '=' + cookie.value).join('; ') } };
export namespace util { export class TextEncoder { encodeInto(value: string): Uint8Array { return new globalThis.TextEncoder().encode(value); } } export class TextDecoder { private decoder: globalThis.TextDecoder; constructor(encoding = 'utf-8') { this.decoder = new globalThis.TextDecoder(encoding); } static create(encoding: string): TextDecoder { return new TextDecoder(encoding); } decodeToString(value: Uint8Array, options?: { stream: boolean }): string { return this.decoder.decode(value, options); } } export class Base64Helper { encodeToStringSync(value: Uint8Array): string { return encodeBase64(value); } } }
export namespace taskpool { export async function execute(fn: (...args: any[]) => any, ...args: any[]): Promise<any> { await new Promise<void>(resolve => setTimeout(resolve, 0)); return fn(...args); } }
export namespace image {
 export enum PixelMapFormat { RGBA_8888 }
 export class PixelMap {
  constructor(private bytes: Uint8Array, private width: number, private height: number, private stride: number) {}
  getPixelBytesNumber(): number { return this.stride * this.height; } getBytesNumberPerRow(): number { return this.stride; }
  async getImageInfo(): Promise<{ size: { width: number; height: number } }> { return { size: { width: this.width, height: this.height } }; }
  async readPixelsToBuffer(destination: ArrayBuffer): Promise<void> { new Uint8Array(destination).set(this.bytes); }
  async crop(rect: { x: number; y: number; size: { width: number; height: number } }): Promise<void> { const { width, height } = rect.size; if (rect.x < 0 || rect.y < 0 || rect.x + width > this.width || rect.y + height > this.height || width <= 0 || height <= 0) throw new Error('课件裁切范围无效'); const output = new Uint8Array(width * height * 4); for (let y = 0; y < height; y++) output.set(this.bytes.subarray((rect.y + y) * this.stride + rect.x * 4, (rect.y + y) * this.stride + (rect.x + width) * 4), y * width * 4); this.bytes = output; this.width = width; this.height = height; this.stride = width * 4; }
  async packed(format: string, quality: number): Promise<ArrayBuffer> { const value = await nativeBridge().call<string>('image.pack', { base64: encodeBase64(this.bytes), width: this.width, height: this.height, format, quality }); const bytes = decodeBase64(value); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer; }
  async release(): Promise<void> { this.bytes = new Uint8Array(0); }
 }
 export class ImageSource {
  private path: string;
  constructor(value: string | number) { this.path = typeof value === 'number' ? nativeBridge().sync('fs.fdPath', { fd: value }) : filePath(value); }
  async getImageInfo(): Promise<{ size: { width: number; height: number } }> { const value = await nativeBridge().call('image.info', { path: this.path }); return { size: { width: value.width, height: value.height } }; }
  async createPixelMap(options: { desiredSize?: { width: number; height: number }; desiredPixelFormat?: PixelMapFormat; editable?: boolean } = {}): Promise<PixelMap> { const value = await nativeBridge().call('image.pixels', { path: this.path, ...options.desiredSize }); return new PixelMap(decodeBase64(value.base64), value.width, value.height, value.stride || value.width * 4); }
  async cropToPath(rect: { x: number; y: number; width: number; height: number }, destination: string): Promise<void> { await nativeBridge().call('image.crop', { path: this.path, ...rect, destination }); }
  async release(): Promise<void> {}
 }
 export class ImagePacker { async packing(value: PixelMap, options: { format: string; quality: number }): Promise<ArrayBuffer> { return value.packed(options.format, options.quality); } async release(): Promise<void> {} }
 export function createImageSource(value: string | number): ImageSource { return new ImageSource(value); } export function createImagePacker(): ImagePacker { return new ImagePacker(); }
}
export namespace asset {
 export enum Tag { ALIAS, SECRET, ACCESSIBILITY, CONFLICT_RESOLUTION, DATA_LABEL_NORMAL_LOCAL_1, RETURN_TYPE } export enum ReturnType { ALL } export enum Accessibility { DEVICE_UNLOCKED } export enum ConflictResolution { OVERWRITE } export type AssetMap = Map<Tag, any>;
 function alias(query: AssetMap): string { const value = new globalThis.TextDecoder().decode(query.get(Tag.ALIAS)); if (!/^zhiyun-[a-zA-Z0-9-]+$/.test(value)) throw new Error('密钥标识无效'); return value; }
 export async function query(query: AssetMap): Promise<AssetMap[]> { const value = await nativeBridge().call<string | null>('secret.get', { alias: alias(query) }); return value === null ? [] : [new Map([[Tag.SECRET, new globalThis.TextEncoder().encode(value)]])]; }
 export async function add(query: AssetMap): Promise<void> { await nativeBridge().call('secret.set', { alias: alias(query), value: new globalThis.TextDecoder().decode(query.get(Tag.SECRET)) }); }
 export async function remove(query: AssetMap): Promise<void> { await nativeBridge().call('secret.remove', { alias: alias(query) }); }
}
export namespace webSocket {
 export class WebSocket {
  private id = 'ws-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2); private emitter = new Emitter(); private listeners: Array<() => void> = [];
  on(name: string, fn: (...args: any[]) => void): void { this.emitter.on(name, fn); } off(name: string): void { this.emitter.off(name); }
  async connect(url: string): Promise<void> { const bridge = nativeBridge(); for (const name of ['open', 'message', 'error', 'close']) this.listeners.push(bridge.on('websocket.' + name, value => { if (value.socketId !== this.id) return; if (name === 'message') this.emitter.emit(name, undefined, value.base64 ? decodeBase64(value.data).buffer : String(value.data || '')); else this.emitter.emit(name, value.error ? new Error(value.error) : undefined); })); try { await bridge.call('websocket.connect', { socketId: this.id, url }); } catch (error) { this.listeners.splice(0).forEach(off => off()); throw error; } }
  async send(text: string): Promise<void> { await nativeBridge().call('websocket.send', { socketId: this.id, text }); }
  async close(): Promise<void> { this.listeners.splice(0).forEach(off => off()); await nativeBridge().call('websocket.close', { socketId: this.id }); }
 }
 export function createWebSocket(): WebSocket { return new WebSocket(); }
}
export namespace picker { export class DocumentViewPicker { constructor(_context?: common.UIAbilityContext) {} async save(options: { newFileNames: string[] }): Promise<string[]> { return nativeBridge().call('picker.save', { name: options.newFileNames[0] }); } } }
export namespace zlib { export async function compressFile(folder: string, destination: string, _options: unknown): Promise<void> { await nativeBridge().call('zip.create', { folder, destination }); } }
