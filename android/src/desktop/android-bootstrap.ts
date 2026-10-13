import { installNativeBridge } from './android-native';
import { createAndroidSession, fileIo } from './compat';
import { LocalStore } from '../shared/services/LocalStore';
import { createServices } from './services';
import { fs, path, crypto } from './android-tools';

/** Install before React mounts. Services and renderer communicate without an Electron process. */
export function installAndroidServices(): void {
 const native = installNativeBridge(), paths = native.sync<any>('app.paths');
 const events = new Map<string, Set<(value: any) => void>>();
 let lastDownloadsActive = false, lastDownloadCount = 0;
 const downloadTasks = new Map<string, any>();
 const emit = (name: string, value: any) => {
  if (name === 'downloads') { if (value.tasks) { downloadTasks.clear(); value.tasks.forEach((row: any) => downloadTasks.set(row.id, row)); } else (value.taskUpdates || []).forEach((row: any) => downloadTasks.set(row.id, { ...downloadTasks.get(row.id), ...row })); const rows = Array.from(downloadTasks.values()), active = rows.some((row: any) => row.state === 'running' || row.state === 'queued'), count = rows.filter((row: any) => row.state === 'running').length; if (active !== lastDownloadsActive || count !== lastDownloadCount) { lastDownloadsActive = active; lastDownloadCount = count; void native.call('app.downloads', { active, count }).catch(() => {}); } }
  for (const listener of Array.from(events.get(name) || [])) { try { listener(value); } catch (error) { console.error('Study event listener failed', error); } }
 };
 const services = createServices(createAndroidSession(paths.cacheDir), paths.root || paths.filesDir, emit);
 let login: Promise<any> | undefined;
 window.zhiyun = {
  async call<T = any>(method: string, payload: any = {}): Promise<T> {
   if (method === 'login.open' || method === 'app.login') {
    if (!login) login = (async () => { let result: any; try { result = await native.call<any>('app.login'); } catch (error) { if (/已取消登录/.test((error as Error).message)) return null; throw error; } if (result === false || result?.cancelled) return null; const account = await services.handle('session.account'); emit('session', account); return account; })().finally(() => { login = undefined; });
    return login as Promise<T>;
   }
   if (method === 'app.info') return { version: '0.1.0-beta.1', platform: 'android', arch: 'universal', packaged: true } as T;
   if (method === 'app.external') return native.call('app.openExternal', payload);
   if (method === 'clipboard.write') return native.call('app.clipboard', payload);
   if (method === 'clipboard.read') return native.call('app.clipboardRead');
   if (method === 'app.fullscreen') return native.call('app.fullscreen', payload);
   if (method === 'notes.pickImage') { const filePath = await native.call<string | null>('picker.image', payload); if (!filePath) return null as T; try { return await services.handle(method, { ...payload, filePath }); } finally { if (filePath.startsWith(path.join(paths.filesDir, 'imports') + '/')) fs.rmSync(filePath, { force: true }); } }
   if (method === 'notes.export') {
    const result = await services.handle(method, payload); if (!result?.data && !result?.path) return result;
    const destination = result.path || path.join(paths.tempDir, 'export-' + crypto.randomBytes(10).toString('hex') + '.' + result.extension);
    LocalStore.protectExport(destination);
    try {
     if (!result.path) { const file = fileIo.openSync(destination, fileIo.OpenMode.CREATE | fileIo.OpenMode.WRITE_ONLY | fileIo.OpenMode.TRUNC); try { fileIo.writeSync(file.fd, result.data); } finally { fileIo.closeSync(file); } }
     const saved = await native.call<any>('export.share', { path: destination, name: result.filename }); return (saved ? { saved: true, path: saved } : { cancelled: true }) as T;
    } finally { LocalStore.releaseExport(destination); fs.rmSync(destination, { force: true }); }
   }
   if (method === 'resource.drag') { const result = await services.handle(method, payload); const started = await native.call('app.drag', result); if (!started) await native.call('export.share', { path: result.path, name: path.basename(result.path) }); return true as T; }
   return services.handle(method, payload);
  },
  on(name, listener) { let listeners = events.get(name); if (!listeners) { listeners = new Set(); events.set(name, listeners); } listeners.add(listener); return () => { listeners!.delete(listener); if (!listeners!.size) events.delete(name); }; }
 };
 native.on('app.lifecycle', value => { void services.lifecycle(value.active === true).catch(() => {}); if (value.active === false) { const flush = (window as any).__zhiyunFlush; if (typeof flush === 'function') void Promise.resolve(flush()).catch(() => {}); } });
 (window as any).__zhiyunDispose = () => services.dispose();
}
