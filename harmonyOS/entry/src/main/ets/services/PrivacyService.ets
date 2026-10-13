import { privacyManager } from '@kit.AppGalleryKit';
import { common } from '@kit.AbilityKit';
import { fileIo as fs } from '@kit.CoreFileKit';
export class PrivacyService {
  private context: common.UIAbilityContext;
  constructor(context: common.UIAbilityContext) { this.context = context; }
  managed(): boolean { try { return privacyManager.getAppPrivacyMgmtInfo().type === privacyManager.AppPrivacyMgmtType.FULL_MODE; } catch (_) { return false; } }
  accepted(): boolean {
    if (this.managed()) { try { const results = privacyManager.getAppPrivacyResult(); return results.length > 0 && results.every((result: privacyManager.AppPrivacyResult) => result.result === privacyManager.AppPrivacyResultType.FULL_MODE_AGREED); } catch (_) { return false; } }
    try { return fs.readTextSync(this.context.filesDir + '/privacy-consent-v1') === 'accepted'; } catch (_) { return false; }
  }
  async consent(): Promise<boolean> {
    if (this.managed()) { const reply = await privacyManager.requestAppPrivacyConsent(this.context); return reply.results.length > 0 && reply.results.every((result: privacyManager.AppPrivacyResult) => result.result === privacyManager.AppPrivacyResultType.FULL_MODE_AGREED); }
    const file = fs.openSync(this.context.filesDir + '/privacy-consent-v1', fs.OpenMode.CREATE | fs.OpenMode.WRITE_ONLY | fs.OpenMode.TRUNC); try { fs.writeSync(file.fd, 'accepted'); } finally { fs.closeSync(file); } return true;
  }
  withdraw(): void { if (this.managed()) privacyManager.disableService(); else try { fs.unlinkSync(this.context.filesDir + '/privacy-consent-v1'); } catch (_) {} }
  links(): string[] { try { return privacyManager.getAppPrivacyMgmtInfo().privacyInfo.map((link: privacyManager.AppPrivacyLink) => link.url).filter((url: string) => url.startsWith('https://')); } catch (_) { return []; } }
}
