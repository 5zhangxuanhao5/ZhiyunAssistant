import { Buffer } from 'buffer';
import { nativeBridge } from './android-native';
export { Buffer };
export function decodeBase64(value: string): Uint8Array { return new Uint8Array(Buffer.from(value || '', 'base64')); }
export function encodeBase64(value: Uint8Array | ArrayBuffer): string { return Buffer.from(value instanceof ArrayBuffer ? new Uint8Array(value) : value).toString('base64'); }
export function normalizePath(value: string): string { const absolute = value.startsWith('/'), parts: string[] = []; for (const part of value.split('/')) { if (!part || part === '.') continue; if (part === '..') { if (parts.length && parts[parts.length - 1] !== '..') parts.pop(); else if (!absolute) parts.push(part); } else parts.push(part); } return (absolute ? '/' : '') + parts.join('/') || (absolute ? '/' : '.'); }
export const path = { sep: '/', join: (...values: string[]) => normalizePath(values.filter(Boolean).join('/')), resolve: (...values: string[]) => { let out = ''; for (const value of values) out = value.startsWith('/') ? value : out + '/' + value; return normalizePath(out); }, dirname: (value: string) => normalizePath(value).replace(/\/[^/]*$/, '') || '/', basename: (value: string) => normalizePath(value).split('/').pop() || '', extname: (value: string) => { const name = value.split('/').pop() || '', index = name.lastIndexOf('.'); return index > 0 ? name.slice(index) : ''; } };
export function fileURLToPath(value: string): string { const parsed = new URL(value); if (parsed.protocol !== 'file:' || parsed.hostname && parsed.hostname !== 'localhost') throw new Error('本机资源地址无效'); return decodeURIComponent(parsed.pathname); }
export function filePath(value: string): string { return normalizePath(value.startsWith('file://') ? fileURLToPath(value) : value); }
export interface FileStats { size: number; mtimeMs: number; isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }
function stats(value: any): FileStats { return { size: value.size, mtimeMs: value.mtime, isDirectory: () => value.directory === true, isFile: () => value.directory !== true, isSymbolicLink: () => false }; }
let writeSequence = 0;
function writeAtomic(value: string, data: string | Uint8Array): void {
 const bridge = nativeBridge(), destination = filePath(value), temporary = destination + '.write-' + Date.now().toString(36) + '-' + (++writeSequence);
 const bytes = typeof data === 'string' ? new globalThis.TextEncoder().encode(data) : data;
 let opened: { fd: number } | undefined;
 try { opened = bridge.sync('fs.open', { path: temporary, flags: 64 | 1 | 512 });
  for (let at = 0; at < bytes.byteLength;) { const chunk = bytes.subarray(at, at + 256 * 1024), written = bridge.sync<number>('fs.write', { fd: opened!.fd, base64: encodeBase64(chunk) }); if (written <= 0 || written > chunk.byteLength) throw new Error('图片文件写入失败'); at += written; }
  bridge.sync('fs.close', { fd: opened!.fd }); opened = undefined; bridge.sync('fs.rename', { from: temporary, to: destination });
 } catch (error) { try { bridge.sync('fs.remove', { path: temporary, recursive: false }); } catch (_) {} throw error; }
 finally { if (opened) try { bridge.sync('fs.close', { fd: opened.fd }); } catch (_) {} }
}
export const fs = {
  existsSync: (value: string) => nativeBridge().sync<boolean>('fs.exists', { path: filePath(value) }),
  mkdirSync: (value: string, options: { recursive?: boolean; mode?: number } = {}) => nativeBridge().sync('fs.mkdir', { path: filePath(value), recursive: options.recursive === true }),
  statSync: (value: string) => stats(nativeBridge().sync('fs.stat', { path: filePath(value) })),
  readFileSync: (value: string, encoding?: string): any => encoding ? nativeBridge().sync<string>('fs.readText', { path: filePath(value) }) : Buffer.from(nativeBridge().sync<string>('fs.readBytes', { path: filePath(value) }), 'base64'),
  writeFileSync: (value: string, data: string | Uint8Array, _options?: unknown) => writeAtomic(value, data),
  rmSync: (value: string, options: { recursive?: boolean; force?: boolean } = {}) => { if (options.force && !nativeBridge().sync('fs.exists', { path: filePath(value) })) return; nativeBridge().sync('fs.remove', { path: filePath(value), recursive: options.recursive === true }); }
};
export const fsp = {
  mkdir: async (value: string, options?: any) => fs.mkdirSync(value, options),
  stat: async (value: string) => fs.statSync(value),
  readFile: async (value: string, encoding?: string) => fs.readFileSync(value, encoding),
  writeFile: async (value: string, data: string | Uint8Array, options?: any) => fs.writeFileSync(value, data, options),
  rename: async (from: string, to: string) => nativeBridge().sync('fs.rename', { from: filePath(from), to: filePath(to) }),
  rm: async (value: string, options?: any) => fs.rmSync(value, options),
  readdir: async (value: string, options?: { withFileTypes?: boolean }): Promise<any[]> => { const names = nativeBridge().sync<string[]>('fs.list', { path: filePath(value) }); return options?.withFileTypes ? names.map(name => ({ name, ...fs.statSync(path.join(value, name)) })) : names; }
};
export const crypto = { randomBytes(length: number): Buffer { const value = new Uint8Array(length); globalThis.crypto.getRandomValues(value); return Buffer.from(value); } };
