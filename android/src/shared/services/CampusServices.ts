import { LocalStore } from './LocalStore';
interface CampusConfiguration { modelKey: string; ocrKey: string; validUntil?: string }
interface CampusBody { model: string; thinking?: Object }
interface OCRMarkdown { text?: string }
interface OCRPage { markdown?: OCRMarkdown }
interface OCRResult { layoutParsingResults?: OCRPage[] }
interface OCRReply { errorCode?: number; result?: OCRResult }
export const CAMPUS_MODEL = 'deepseek-v4-flash-780k-local';
export const CAMPUS_CHAT = 'https://modelgateway.zju.edu.cn/v1/chat/completions';
export const CAMPUS_OCR = 'https://mcp.zju.edu.cn/api/protal/proxy/system/layout-parsing';
export const CAMPUS_NOTICE = '这是校内 AI，需要连接浙江大学校园网，效果可能不佳。想获得更佳效果，请在 API 设置中添加自己的 DeepSeek API。校内课件通过 OCR 提取文字，图示关系、公式或表格可能识别不完整。校内服务使用期限截至 2026 年 11 月 1 日，到期后可配置个人 DeepSeek API。';
export class CampusServices {
  private static modelKey: string = '';
  private static ocrKey: string = '';
  static ready: Promise<void> = Promise.resolve();
  static onNotice: ((message: string) => Promise<void>) | undefined = undefined;
  private static noticePending: Promise<void> | undefined = undefined;
  static configure(raw: Promise<string>): void {
    CampusServices.ready = raw.then((text: string) => {
      const value = JSON.parse(text) as CampusConfiguration;
      if (!/^[A-Za-z0-9_-]{16,256}$/.test(value.modelKey || '') || !/^pk_[A-Za-z0-9_-]{16,256}$/.test(value.ocrKey || '')) return;
      CampusServices.modelKey = value.modelKey; CampusServices.ocrKey = value.ocrKey;
    }).catch(() => {});
  }
  static key(): string { return CampusServices.modelKey; }
  static ocr(): string { return CampusServices.ocrKey; }
  static isCampus(value: string): boolean { return !!value && !!CampusServices.modelKey && value === CampusServices.modelKey; }
  static body(raw: string): string { const body = JSON.parse(raw) as CampusBody; body.model = CAMPUS_MODEL; body.thinking = undefined; return JSON.stringify(body); }
  static text(raw: string): string {
    const reply = JSON.parse(raw) as OCRReply;
    if (reply.errorCode !== 0) throw new Error('校园 OCR 暂不可用，请检查校园网或配置个人 DeepSeek API');
    const text = (reply.result?.layoutParsingResults || []).slice(0,12).map((page: OCRPage) => page.markdown?.text || '').filter((value: string) => !!value.trim()).join('\n\n').slice(0,30000);
    if (!text.trim()) throw new Error('校园 OCR 未识别出课件文字，不能据此推测图片内容');
    return '【校内 OCR 提取；可能遗漏图示关系或误识公式、表格】\n' + text;
  }
  static async notify(store: LocalStore, key: string): Promise<void> {
    if (!CampusServices.isCampus(key) || store.readJson('campus-notice-20261101.json') === 'seen' || !CampusServices.onNotice) return;
    if (CampusServices.noticePending) { await CampusServices.noticePending; return; }
    CampusServices.noticePending = CampusServices.onNotice(CAMPUS_NOTICE).then(() => { store.saveJson('campus-notice-20261101.json','seen'); });
    try { await CampusServices.noticePending; } finally { CampusServices.noticePending = undefined; }
  }
}
