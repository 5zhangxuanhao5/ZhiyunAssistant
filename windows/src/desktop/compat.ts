/** Desktop adapters for the existing classroom algorithms. Credentials stay in the main process. */
import * as fsNode from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EventEmitter } from 'node:events';
import * as electron from 'electron';
import type { Session, NativeImage } from 'electron';
import WebSocketNode from 'ws';
import JSZip from 'jszip';

export interface DesktopAdapters { safeStorage?: { isEncryptionAvailable(): boolean; encryptString(value: string): Buffer; decryptString(value: Buffer): string } }
interface DesktopContext { session: Session; userData: string; adapters?: DesktopAdapters }
let context: DesktopContext | undefined;
export function configureCompat(session: Session, userData: string, adapters?: DesktopAdapters): void { context = { session, userData, adapters }; }
export function desktopSession(): Session { if (!context) throw new Error('桌面会话尚未初始化'); return context.session; }
export function browserSessions(): Session[] { const selected = [context?.session, electron.session?.defaultSession].filter((value): value is Session => !!value); return Array.from(new Set(selected)); }
export function storageRoot(): string { if (!context) throw new Error('桌面存储尚未初始化'); return context.userData; }
export function allowedNetworkUrl(address: string): URL {
  const url = new URL(address);
  if (url.username || url.password || url.protocol !== 'https:' || (url.port && url.port !== '443')) throw new Error('资源地址无效');
  const host = url.hostname.toLowerCase();
  if (host !== 'api.deepseek.com' && !['zju.edu.cn', 'chinamcloud.com', 'chinamcloud.cn', 'chinamcache.com'].some(domain => host === domain || host.endsWith('.' + domain))) throw new Error('资源地址不属于课程服务');
  return url;
}
export async function credentialledFetch(address: string, options: RequestInit = {}): Promise<Response> {
  let current = allowedNetworkUrl(address), headers = new Headers(options.headers);
  const original = current.origin;
  for (let count = 0; count <= 5; count++) {
    if (current.origin !== original) { headers.delete('Cookie'); headers.delete('Authorization'); }
    const response = await desktopSession().fetch(current.href, { ...options, headers, cache: 'no-store', redirect: 'manual', credentials: current.hostname.endsWith('.zju.edu.cn') ? 'include' : 'omit' });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location'); if (!location) return response;
    await response.body?.cancel(); current = allowedNetworkUrl(new URL(location, current).href);
    if (count === 5) throw new Error('资源重定向过多');
  }
  throw new Error('资源无法访问');
}

export namespace http {
  export enum RequestMethod { GET = 'GET', POST = 'POST', HEAD = 'HEAD' }
  export enum HttpDataType { STRING = 'STRING', ARRAY_BUFFER = 'ARRAY_BUFFER' }
  export interface Options { method?: RequestMethod; header?: Record<string, string>; extraData?: string; expectDataType?: HttpDataType; connectTimeout?: number; readTimeout?: number; usingCache?: boolean; maxLimit?: number }
  export interface HttpResponse { responseCode: number; result: string | ArrayBuffer; header: Record<string, string> }
  export class HttpRequest {
    private events = new EventEmitter();
    private controller = new AbortController();
    private timer: ReturnType<typeof setTimeout> | undefined;
    on(event: string, handler: (...args: any[]) => void): void { this.events.on(event, handler); }
    off(event: string): void { this.events.removeAllListeners(event); }
    destroy(): void { clearTimeout(this.timer); this.controller.abort(); }
    private async response(address: string, options: Options): Promise<Response> {
      this.timer = setTimeout(() => this.controller.abort(new Error('网络请求超时')), (options.readTimeout || 30000) + (options.connectTimeout || 8000));
      return credentialledFetch(address, { method: options.method || 'GET', headers: options.header, body: options.method === RequestMethod.POST ? options.extraData : undefined, signal: this.controller.signal });
    }
    async request(address: string, options: Options = {}): Promise<HttpResponse> {
      const response = await this.response(address, options); const header = Object.fromEntries(response.headers.entries());
      const limit = options.maxLimit || 12 * 1024 * 1024, parts: Uint8Array[] = []; let length = 0;
      if (response.body) for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) { length += chunk.byteLength; if (length > limit) { this.destroy(); throw new Error('资源超过允许大小'); } parts.push(chunk); }
      clearTimeout(this.timer); const bytes = Buffer.concat(parts);
      return { responseCode: response.status, header, result: options.expectDataType === HttpDataType.ARRAY_BUFFER ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer : bytes.toString('utf8') };
    }
    async requestInStream(address: string, options: Options = {}): Promise<number> {
      const response = await this.response(address, options);
      this.events.emit('headersReceive', Object.fromEntries(response.headers.entries()));
      if (response.ok && response.body) {
        let total = 0;
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
          if (this.controller.signal.aborted) throw new Error('已取消');
          total += chunk.byteLength; if (options.maxLimit && total > options.maxLimit) throw new Error('资源超过允许大小');
          this.events.emit('dataReceive', chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength));
        }
      } else await response.body?.cancel();
      this.events.emit('dataEnd'); clearTimeout(this.timer); return response.status;
    }
  }
  export function createHttp(): HttpRequest { return new HttpRequest(); }
}

export namespace fileIo {
  export interface File { fd: number }
  export enum OpenMode { READ_ONLY = fsNode.constants.O_RDONLY, WRITE_ONLY = fsNode.constants.O_WRONLY, READ_WRITE = fsNode.constants.O_RDWR, CREATE = fsNode.constants.O_CREAT, TRUNC = fsNode.constants.O_TRUNC, APPEND = fsNode.constants.O_APPEND }
  interface OpenFile { path: string; flags: number; identity: fsNode.BigIntStats }
  const openedFiles = new Map<number, OpenFile>();
  function sameFile(first: fsNode.BigIntStats, second: fsNode.BigIntStats): boolean { return first.ino !== 0n && first.dev === second.dev && first.ino === second.ino && first.isFile() && second.isFile(); }
  function staleFile(): NodeJS.ErrnoException { return Object.assign(new Error('文件路径已变更，已停止截短以保护其他文件'), { code: 'ESTALE' }); }
  function rememberFile(fd: number, filename: string, flags: number): File {
    // Ordinary cache reads/writes do not need an additional stat or registry.
    if (!(flags & OpenMode.APPEND)) return { fd };
    try { openedFiles.set(fd, { path: filename, flags, identity: fsNode.fstatSync(fd, { bigint: true }) }); return { fd }; }
    catch (error) { try { fsNode.closeSync(fd); } catch (_) {} throw error; }
  }
  export function local(value: string): string { return value.startsWith('file://') ? fileURLToPath(value) : value; }
  export function openSync(value: string, flags = OpenMode.READ_ONLY): File {
    const filename = path.resolve(local(value));
    if ((flags & OpenMode.TRUNC) && !(flags & OpenMode.CREATE)) {
      // Windows/libuv's numeric TRUNCATE_EXISTING path can reject O_WRONLY
      // with EINVAL. Open the existing file using exactly the requested access,
      // then truncate that same descriptor. Never add CREATE or pre-check a path.
      const file = rememberFile(fsNode.openSync(filename, flags & ~OpenMode.TRUNC, 0o600), filename, flags);
      try { truncateSync(file.fd, 0); return file; }
      catch (error) { try { closeSync(file); } catch (_) {} throw error; }
    }
    return rememberFile(fsNode.openSync(filename, flags, 0o600), filename, flags);
  }
  export function closeSync(value: File | number): void { const fd = typeof value === 'number' ? value : value.fd; try { fsNode.closeSync(fd); } finally { openedFiles.delete(fd); } }
  export function accessSync(value: string): boolean { return fsNode.existsSync(local(value)); }
  export function mkdirSync(value: string, recursive = false): void { fsNode.mkdirSync(local(value), { recursive, mode: 0o700 }); }
  export function listFileSync(value: string): string[] { return fsNode.readdirSync(local(value)); }
  export function readTextSync(value: string): string { return fsNode.readFileSync(local(value), 'utf8'); }
  export function statSync(value: string | number): any { const stat = typeof value === 'number' ? fsNode.fstatSync(value) : fsNode.statSync(local(value)); return { size: stat.size, mtime: stat.mtimeMs, isDirectory: () => stat.isDirectory() }; }
  export function writeSync(fd: number, value: string | ArrayBuffer | Uint8Array): number { return typeof value === 'string' ? fsNode.writeSync(fd, value) : fsNode.writeSync(fd, value instanceof ArrayBuffer ? new Uint8Array(value) : value); }
  export function readSync(fd: number, value: ArrayBuffer): number { return fsNode.readSync(fd, new Uint8Array(value)); }
  export function renameSync(first: string, second: string): void { fsNode.renameSync(local(first), local(second)); }
  export function unlinkSync(value: string): void { fsNode.unlinkSync(local(value)); }
  export function rmdirSync(value: string): void { fsNode.rmSync(local(value), { recursive: true, force: true }); }
  export function truncateSync(fd: number, length: number): void {
    const opened = openedFiles.get(fd);
    if (!opened || !(opened.flags & OpenMode.APPEND)) { fsNode.ftruncateSync(fd, length); return; }
    // Windows append handles have FILE_APPEND_DATA but cannot set the file end.
    // Keep that handle (and its append position/permissions) unchanged. Acquire
    // write-only, existing-only access briefly; never request read access/create
    // or truncate a path before proving both handles refer to the original file.
    if (!(opened.flags & (OpenMode.WRITE_ONLY | OpenMode.READ_WRITE))) throw Object.assign(new Error('文件未以写入权限打开'), { code: 'EBADF' });
    const current = fsNode.fstatSync(fd, { bigint: true });
    if (!sameFile(current, opened.identity)) throw staleFile();
    const writer = fsNode.openSync(opened.path, OpenMode.WRITE_ONLY);
    try {
      if (!sameFile(current, fsNode.fstatSync(writer, { bigint: true }))) throw staleFile();
      fsNode.ftruncateSync(writer, length);
    } finally { fsNode.closeSync(writer); }
  }
  export function copyFileSync(first: string | number, second: string | number): void {
    if (typeof first === 'string' && typeof second === 'string') { fsNode.copyFileSync(local(first), local(second)); return; }
    const input = typeof first === 'number' ? first : fsNode.openSync(local(first), 'r'), output = typeof second === 'number' ? second : fsNode.openSync(local(second), 'w');
    try { const bytes = Buffer.allocUnsafe(256 * 1024); let at = 0, count; while ((count = fsNode.readSync(input, bytes, 0, bytes.length, at)) > 0) { let done = 0; while (done < count) done += fsNode.writeSync(output, bytes, done, count - done, at + done); at += count; } }
    finally { if (typeof first !== 'number') fsNode.closeSync(input); if (typeof second !== 'number') fsNode.closeSync(output); }
  }
}
export namespace fileUri {
  export class FileUri { path: string; constructor(value: string) { this.path = fileIo.local(value); } }
  export function getUriFromPath(value: string): string { return pathToFileURL(value).href; }
}
export namespace common { export interface UIAbilityContext { filesDir: string; cacheDir: string; tempDir: string } }
export type BusinessError = Error;
export const webview = { WebCookieManager: { fetchCookieSync: (_url: string) => '' } };

export namespace util {
  export class TextEncoder { encodeInto(value: string): Uint8Array { return new globalThis.TextEncoder().encode(value); } }
  export class TextDecoder {
    private decoder: globalThis.TextDecoder; constructor(encoding = 'utf-8') { this.decoder = new globalThis.TextDecoder(encoding); }
    static create(encoding: string): TextDecoder { return new TextDecoder(encoding); }
    decodeToString(value: Uint8Array, options?: { stream: boolean }): string { return this.decoder.decode(value, options); }
  }
  export class Base64Helper { encodeToStringSync(value: Uint8Array): string { return Buffer.from(value).toString('base64'); } }
}
export namespace taskpool { export async function execute(fn: (...args: any[]) => any, ...args: any[]): Promise<any> { await new Promise<void>(resolve => setImmediate(resolve)); return fn(...args); } }

export namespace image {
  export enum PixelMapFormat { RGBA_8888 }
  export class PixelMap {
    constructor(private value: NativeImage) {}
    getPixelBytesNumber(): number { const size = this.value.getSize(); return size.width * size.height * 4; }
    getBytesNumberPerRow(): number { return this.value.getSize().width * 4; }
    async getImageInfo(): Promise<{ size: { width: number; height: number } }> { return { size: this.value.getSize() }; }
    async readPixelsToBuffer(destination: ArrayBuffer): Promise<void> { const source = this.value.toBitmap(), target = new Uint8Array(destination); for (let i = 0; i < source.length; i += 4) { target[i] = source[i + 2]; target[i + 1] = source[i + 1]; target[i + 2] = source[i]; target[i + 3] = source[i + 3]; } }
    async crop(rect: { x: number; y: number; size: { width: number; height: number } }): Promise<void> { this.value = this.value.crop({ x: rect.x, y: rect.y, width: rect.size.width, height: rect.size.height }); }
    bytes(format: string, quality: number): Buffer { return format === 'image/jpeg' ? this.value.toJPEG(quality) : this.value.toPNG(); }
    async release(): Promise<void> { /* NativeImage is garbage collected. */ }
  }
  export class ImageSource {
    private value: NativeImage;
    constructor(value: string | number) { this.value = typeof value === 'number' ? electron.nativeImage.createFromBuffer(fsNode.readFileSync(value)) : electron.nativeImage.createFromPath(fileIo.local(value)); if (this.value.isEmpty()) throw new Error('无法读取图片'); }
    async getImageInfo(): Promise<{ size: { width: number; height: number } }> { return { size: this.value.getSize() }; }
    async createPixelMap(options: { desiredSize?: { width: number; height: number }; desiredPixelFormat?: PixelMapFormat; editable?: boolean } = {}): Promise<PixelMap> { return new PixelMap(options.desiredSize ? this.value.resize({ ...options.desiredSize, quality: 'good' }) : this.value); }
    async release(): Promise<void> {}
  }
  export class ImagePacker { async packing(value: PixelMap, options: { format: string; quality: number }): Promise<ArrayBuffer> { const bytes = value.bytes(options.format, options.quality); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer; } async release(): Promise<void> {} }
  export function createImageSource(value: string | number): ImageSource { return new ImageSource(value); }
  export function createImagePacker(): ImagePacker { return new ImagePacker(); }
}

function secureStorage() { const value = context?.adapters?.safeStorage || electron.safeStorage; if (!value) throw new Error('系统安全存储不可用'); return value; }
export namespace asset {
  export enum Tag { ALIAS, SECRET, ACCESSIBILITY, CONFLICT_RESOLUTION, DATA_LABEL_NORMAL_LOCAL_1, RETURN_TYPE }
  export enum ReturnType { ALL }
  export enum Accessibility { DEVICE_UNLOCKED }
  export enum ConflictResolution { OVERWRITE }
  export type AssetMap = Map<Tag, any>;
  function filename(query: AssetMap): string { const alias = Buffer.from(query.get(Tag.ALIAS) || '').toString('utf8'); if (!/^zhiyun-[a-zA-Z0-9-]+$/.test(alias)) throw new Error('密钥标识无效'); return path.join(storageRoot(), 'secrets', alias + '.bin'); }
  export async function query(query: AssetMap): Promise<AssetMap[]> { try { const value = secureStorage().decryptString(fsNode.readFileSync(filename(query))); return [new Map([[Tag.SECRET, new globalThis.TextEncoder().encode(value)]])]; } catch (_) { return []; } }
  export async function add(value: AssetMap): Promise<void> { if (!secureStorage().isEncryptionAvailable()) throw new Error('系统安全存储不可用，无法保存 API 密钥'); const file = filename(value); fsNode.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); const bytes = secureStorage().encryptString(Buffer.from(value.get(Tag.SECRET)).toString('utf8')); fsNode.writeFileSync(file + '.tmp', bytes, { mode: 0o600 }); fsNode.renameSync(file + '.tmp', file); }
  export async function remove(query: AssetMap): Promise<void> { fsNode.rmSync(filename(query), { force: true }); }
}

export namespace webSocket {
  export class WebSocket {
    private socket?: WebSocketNode; private emitter = new EventEmitter();
    on(name: string, listener: (...args: any[]) => void): void { this.emitter.on(name, listener); }
    off(name: string): void { this.emitter.removeAllListeners(name); }
    async connect(value: string): Promise<void> { const parsed = new URL(value); if (!['ws:', 'wss:'].includes(parsed.protocol) || parsed.username || parsed.password || /^(localhost|127\.|0\.|\[?::1)/.test(parsed.hostname)) throw new Error('实时转写地址无效'); this.socket = new WebSocketNode(value, { maxPayload: 2 * 1024 * 1024, handshakeTimeout: 10000 }); this.socket.on('open', () => this.emitter.emit('open')); this.socket.on('message', (data, binary) => this.emitter.emit('message', undefined, binary ? Uint8Array.from(data as Buffer).buffer : data.toString())); this.socket.on('error', error => { if (this.emitter.listenerCount('error')) this.emitter.emit('error', error); }); this.socket.on('close', () => this.emitter.emit('close')); }
    async send(value: string): Promise<void> { if (!this.socket || this.socket.readyState !== WebSocketNode.OPEN) throw new Error('实时转写尚未连接'); this.socket.send(value); }
    async close(): Promise<void> { this.socket?.terminate(); this.socket = undefined; }
  }
  export function createWebSocket(): WebSocket { return new WebSocket(); }
}

export namespace picker {
  export class DocumentViewPicker {
    constructor(_context?: common.UIAbilityContext) {}
    async save(options: { newFileNames: string[] }): Promise<string[]> { const result = await electron.dialog.showSaveDialog({ title: '导出课堂笔记', defaultPath: options.newFileNames[0] }); return result.canceled || !result.filePath ? [] : [fileUri.getUriFromPath(result.filePath)]; }
  }
}
export namespace zlib {
  export async function compressFile(folder: string, destination: string, _options: unknown): Promise<void> { const zip = new JSZip(); const visit = (directory: string): void => { for (const entry of fsNode.readdirSync(directory, { withFileTypes: true })) { const full = path.join(directory, entry.name); if (entry.isDirectory()) visit(full); else if (entry.isFile()) zip.file(path.relative(folder, full).split(path.sep).join('/'), fsNode.readFileSync(full)); } }; visit(folder); fsNode.writeFileSync(destination, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })); }
}
