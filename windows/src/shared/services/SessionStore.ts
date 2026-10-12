import fs from 'node:fs';
import path from 'node:path';
import type { Cookie } from 'electron';
import { asset, desktopSession, storageRoot, util } from '../../desktop/compat';
import { Account } from '../model/Timeline';
const alias = new util.TextEncoder().encodeInto('zhiyun-official-session-v3');
const accountAlias = new util.TextEncoder().encodeInto('zhiyun-last-account-v1');
const origins = ['https://classroom.zju.edu.cn', 'https://interactivemeta.cmc.zju.edu.cn'];
export class SessionStore {
  private static values = new Map<string, string>();
  private static epoch = 0;
  static async refresh(): Promise<void> { await Promise.all(origins.map(async origin => { const cookies = await desktopSession().cookies.get({ url: origin }); SessionStore.values.set(origin, cookies.map(cookie => cookie.name + '=' + cookie.value).join('; ')); })); }
  static cookie(origin: string): string { return SessionStore.values.get(origin) || ''; }
  static async restore(): Promise<void> {
    const gen = SessionStore.epoch;
    const rows = await asset.query(new Map([[asset.Tag.ALIAS, alias]]));
    try {
      const value = JSON.parse(new util.TextDecoder().decodeToString(rows[0]?.get(asset.Tag.SECRET))) as { cookies: Cookie[]; savedAt: number };
      if (gen !== SessionStore.epoch || !Array.isArray(value.cookies) || Date.now() - value.savedAt > 30 * 86400000) return;
      for (const cookie of value.cookies) {
        if (!/^(?:\.?[\w-]+\.)*zju\.edu\.cn$/.test(cookie.domain || '') || /[\r\n]/.test(cookie.name + cookie.value)) continue;
        if (cookie.expirationDate && cookie.expirationDate < Date.now() / 1000) continue;
        const domain = cookie.domain?.replace(/^\./, '') || ''; if (!domain) continue;
        try { await desktopSession().cookies.set({ url: 'https://' + domain + (cookie.path || '/'), name: cookie.name, value: cookie.value, path: cookie.path, domain: cookie.hostOnly ? undefined : cookie.domain, secure: cookie.secure, httpOnly: cookie.httpOnly, sameSite: cookie.sameSite, expirationDate: cookie.expirationDate }); } catch (_) {}
      }
    } catch (_) {}
    await SessionStore.refresh();
  }
  static async rememberAccount(account: Account): Promise<void> { await asset.add(new Map([[asset.Tag.ALIAS, accountAlias], [asset.Tag.SECRET, new util.TextEncoder().encodeInto(JSON.stringify(account))]])); fs.rmSync(path.join(storageRoot(), 'last-account.json'), { force: true }); }
  static async savedAccount(): Promise<Account | undefined> { try { const rows = await asset.query(new Map([[asset.Tag.ALIAS, accountAlias]])), secret = rows[0]?.get(asset.Tag.SECRET); const account = JSON.parse(secret ? new util.TextDecoder().decodeToString(secret) : fs.readFileSync(path.join(storageRoot(), 'last-account.json'), 'utf8')) as Account; if (!(account && typeof account.id === 'string' && account.id && typeof account.name === 'string' && Number.isFinite(account.tenantId))) return undefined; if (!secret) await SessionStore.rememberAccount(account); return account; } catch (_) { return undefined; } }
  static beginLogin(): void { SessionStore.epoch++; SessionStore.values.clear(); }
  static async saveCurrent(): Promise<void> {
    await SessionStore.refresh();
    if (!SessionStore.cookie(origins[0])) return;
    const cookies = (await desktopSession().cookies.get({})).filter(cookie => /^(?:\.?[\w-]+\.)*zju\.edu\.cn$/.test(cookie.domain || ''));
    const value = JSON.stringify({ cookies, savedAt: Date.now() }); if (value.length > 128 * 1024) throw new Error('登录会话过长');
    await asset.add(new Map([[asset.Tag.ALIAS, alias], [asset.Tag.SECRET, new util.TextEncoder().encodeInto(value)]]));
    await desktopSession().cookies.flushStore();
  }
  static async clear(): Promise<void> { SessionStore.epoch++; SessionStore.values.clear(); await asset.remove(new Map([[asset.Tag.ALIAS, alias]])); await asset.remove(new Map([[asset.Tag.ALIAS, accountAlias]])); fs.rmSync(path.join(storageRoot(), 'last-account.json'), { force: true }); const cookies = await desktopSession().cookies.get({}); for (const cookie of cookies) { if (/^(?:\.?[\w-]+\.)*zju\.edu\.cn$/.test(cookie.domain || '')) { try { await desktopSession().cookies.remove('https://' + cookie.domain!.replace(/^\./, '') + (cookie.path || '/'), cookie.name); } catch (_) {} } } await desktopSession().clearStorageData({ storages: ['cookies'], origin: 'https://classroom.zju.edu.cn' }); await desktopSession().clearStorageData({ storages: ['cookies'], origin: 'https://interactivemeta.cmc.zju.edu.cn' }); }
}
