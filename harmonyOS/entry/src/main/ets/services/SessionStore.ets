import { Account } from '../model/Timeline';
import { asset } from '@kit.AssetStoreKit';
import { util } from '@kit.ArkTS';
import { webview } from '@kit.ArkWeb';

const CLASSROOM = 'https://classroom.zju.edu.cn';
const INTERACTIVE = 'https://interactivemeta.cmc.zju.edu.cn';
const PREFIX = 'zhiyun-official-session-v2';
const PIECE_SIZE = 960;
interface SavedSession { classroom: string; interactive: string; savedAt: number }
interface SessionManifest { slot: number; count: number }
export class SessionStore {
  private static current: SavedSession | undefined = undefined;
  private static restoring: Promise<void> | undefined = undefined;
  private static queue: Promise<void> = Promise.resolve();
  private static epoch: number = 0;
  private static activeSlot: number = 1;
  private static encode(value: string): Uint8Array { return new util.TextEncoder().encodeInto(value); }
  private static decode(value: Uint8Array): string { return util.TextDecoder.create('utf-8').decodeToString(value); }
  private static async read(alias: string): Promise<Uint8Array | undefined> {
    const query: asset.AssetMap = new Map();
    query.set(asset.Tag.ALIAS, SessionStore.encode(alias)); query.set(asset.Tag.RETURN_TYPE, asset.ReturnType.ALL);
    try {
      const records = await asset.query(query);
      return records[0]?.get(asset.Tag.SECRET) as Uint8Array;
    } catch (_) { return undefined; }
  }
  private static async write(alias: string, bytes: Uint8Array): Promise<void> {
    const attrs: asset.AssetMap = new Map();
    attrs.set(asset.Tag.ALIAS, SessionStore.encode(alias)); attrs.set(asset.Tag.SECRET, bytes);
    attrs.set(asset.Tag.ACCESSIBILITY, asset.Accessibility.DEVICE_UNLOCKED);
    attrs.set(asset.Tag.CONFLICT_RESOLUTION, asset.ConflictResolution.OVERWRITE);
    attrs.set(asset.Tag.DATA_LABEL_NORMAL_LOCAL_1, SessionStore.encode(PREFIX));
    await asset.add(attrs);
  }
  static async rememberAccount(account: Account): Promise<void> { const gen = SessionStore.epoch, bytes = SessionStore.encode(JSON.stringify(account)); if (bytes.length > PIECE_SIZE) throw new Error('账户信息过长'); const task = SessionStore.queue.catch(() => {}).then(async () => { if (gen === SessionStore.epoch) await SessionStore.write(PREFIX + '-account', bytes); }); SessionStore.queue = task; await task; }
  static async savedAccount(): Promise<Account | undefined> { const gen = SessionStore.epoch; const bytes = await SessionStore.read(PREFIX + '-account'); if (!bytes || gen !== SessionStore.epoch) return undefined; try { const value = JSON.parse(SessionStore.decode(bytes)) as Account; return value && typeof value.id === 'string' && !!value.id && typeof value.name === 'string' && Number.isFinite(value.tenantId) ? value : undefined; } catch (_) { return undefined; } }
  static async restore(): Promise<void> {
    if (!SessionStore.restoring) SessionStore.restoring = SessionStore.load();
    await SessionStore.restoring;
  }
  private static async load(): Promise<void> {
    const gen = SessionStore.epoch;
    try {
      const manifestBytes = await SessionStore.read(PREFIX);
      let value: Uint8Array | undefined;
      if (manifestBytes) {
        const manifest = JSON.parse(SessionStore.decode(manifestBytes)) as SessionManifest;
        if ((manifest.slot !== 0 && manifest.slot !== 1) || !Number.isInteger(manifest.count) || manifest.count < 1 || manifest.count > 64) return;
        const chunks: Uint8Array[] = [];
        let length = 0;
        for (let i = 0; i < manifest.count; i++) {
          const piece = await SessionStore.read(`${PREFIX}-${manifest.slot}-${i}`);
          if (!piece || piece.length > PIECE_SIZE) return;
          chunks.push(piece); length += piece.length;
        }
        value = new Uint8Array(length);
        let offset = 0;
        chunks.forEach((chunk: Uint8Array) => { value!.set(chunk, offset); offset += chunk.length; });
        SessionStore.activeSlot = manifest.slot;
      } else {
        try { value = await SessionStore.read('zhiyun-official-session-v1'); } catch (_) {}
      }
      if (!value || gen !== SessionStore.epoch) return;
      const session = JSON.parse(SessionStore.decode(value)) as SavedSession;
      if (typeof session.classroom !== 'string' || typeof session.interactive !== 'string' || /[\r\n]/.test(session.classroom + session.interactive) || !Number.isFinite(session.savedAt) || Date.now() - session.savedAt > 30 * 86400000) return;
      SessionStore.current = session;
    } catch (_) {}
  }
  private static webCookie(origin: string): string {
    try { return webview.WebCookieManager.fetchCookieSync(origin); } catch (_) { return ''; }
  }
  static cookie(origin: string): string {
    const saved = origin === CLASSROOM ? SessionStore.current?.classroom : origin === INTERACTIVE ? SessionStore.current?.interactive : '';
    // Guest-page preloading must never replace a restored, authenticated cookie.
    return saved || SessionStore.webCookie(origin);
  }
  static beginLogin(): void { SessionStore.epoch++; SessionStore.current = undefined; }
  static async saveCurrent(): Promise<void> {
    // Only called after the school's account endpoint confirms authentication.
    const classroom = SessionStore.cookie(CLASSROOM);
    if (!classroom.trim() || /[\r\n]/.test(classroom)) return;
    const session: SavedSession = { classroom, interactive: SessionStore.cookie(INTERACTIVE), savedAt: Date.now() };
    const gen = SessionStore.epoch;
    SessionStore.current = session;
    const bytes = SessionStore.encode(JSON.stringify(session));
    if (bytes.length > PIECE_SIZE * 64) throw new Error('会话凭据过长');
    const job = SessionStore.queue.catch(() => {}).then(async () => {
      if (gen !== SessionStore.epoch) return;
      const slot = SessionStore.activeSlot === 0 ? 1 : 0;
      const count = Math.ceil(bytes.length / PIECE_SIZE);
      // Asset secrets are limited to 1024 bytes. Commit the manifest after every encrypted piece is saved.
      for (let i = 0; i < count; i++) {
        if (gen !== SessionStore.epoch) return;
        await SessionStore.write(`${PREFIX}-${slot}-${i}`, bytes.slice(i * PIECE_SIZE, (i + 1) * PIECE_SIZE));
      }
      if (gen !== SessionStore.epoch) return;
      const manifest: SessionManifest = { slot, count };
      await SessionStore.write(PREFIX, SessionStore.encode(JSON.stringify(manifest)));
      SessionStore.activeSlot = slot;
    });
    SessionStore.queue = job; await job;
  }
  static async clear(): Promise<void> {
    SessionStore.epoch++; SessionStore.current = undefined; SessionStore.restoring = undefined;
    const job = SessionStore.queue.catch(() => {}).then(async () => {
      const query: asset.AssetMap = new Map(); query.set(asset.Tag.DATA_LABEL_NORMAL_LOCAL_1, SessionStore.encode(PREFIX));
      try { await asset.remove(query); } catch (_) {}
      const legacy: asset.AssetMap = new Map(); legacy.set(asset.Tag.ALIAS, SessionStore.encode('zhiyun-official-session-v1'));
      try { await asset.remove(legacy); } catch (_) {}
    });
    SessionStore.queue = job; await job;
  }
}
