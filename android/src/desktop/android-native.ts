/** The only entry to privileged Android operations; never installed on remote login pages. */
export interface AndroidNative { call<T = any>(method: string, payload?: any): Promise<T>; sync<T = any>(method: string, payload?: any): T; on(name: string, listener: (value: any) => void): () => void }
declare global { interface Window { androidNative: AndroidNative; NativeBridge?: { sync(method: string, payload: string): string; post(id: string, method: string, payload: string): void }; __androidReceive?: (value: any) => void; __androidEvent?: (value: any) => void } }
export function installNativeBridge(target: Window = window): AndroidNative {
  if (target.androidNative) return target.androidNative;
  const native = target.NativeBridge; if (!native) throw new Error('Android 系统组件不可用，请重新打开应用');
  let sequence = 0;
  const pending = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const events = new Map<string, Set<(value: any) => void>>();
  target.__androidReceive = packet => { const job = pending.get(String(packet?.id)); if (!job) return; pending.delete(String(packet.id)); clearTimeout(job.timer); packet.error ? job.reject(new Error(String(packet.error))) : job.resolve(packet.value); };
  target.__androidEvent = packet => { for (const listener of Array.from(events.get(String(packet?.name)) || [])) { try { listener(packet.value); } catch (error) { console.error('Android event listener failed', error); } } };
  const bridge: AndroidNative = {
    call(method, payload = {}) { const id = 'android-' + Date.now().toString(36) + '-' + (++sequence); return new Promise((resolve, reject) => { const timeout = method === 'http.stream' ? 24 * 3600000 : method === 'app.login' || method === 'picker.image' || method === 'export.share' || method === 'picker.save' ? 15 * 60000 : Math.max(60000, (Number(payload?.timeout) || 0) + 15000); const timer = setTimeout(() => { pending.delete(id); reject(new Error('操作超时，请重试')); }, timeout); pending.set(id, { resolve, reject, timer }); try { native.post(id, method, JSON.stringify(payload)); } catch (error) { pending.delete(id); clearTimeout(timer); reject(error); } }); },
    sync(method, payload = {}) { const response = JSON.parse(native.sync(method, JSON.stringify(payload))); if (response.error) throw new Error(String(response.error)); return response.value; },
    on(name, listener) { let listeners = events.get(name); if (!listeners) { listeners = new Set(); events.set(name, listeners); } listeners.add(listener); return () => { listeners!.delete(listener); if (!listeners!.size) events.delete(name); }; }
  };
  target.androidNative = bridge; return bridge;
}
export function nativeBridge(): AndroidNative { return window.androidNative || installNativeBridge(); }
