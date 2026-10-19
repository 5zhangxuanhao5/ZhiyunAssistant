export const CAMPUS_MODEL = 'deepseek-v4-flash-780k-local';
export const CAMPUS_NOTICE = '仅在浙大内网环境下可用 · 校内服务有效期截至 2026 年 11 月 1 日';
export const CAMPUS_FIRST_USE = '这是校内 AI，需要连接浙江大学校园网，效果可能不佳。想获得更佳效果，请在 API 设置中添加自己的 DeepSeek API。校内课件通过 OCR 提取文字，图示关系、公式或表格可能识别不完整。校内服务使用期限截至 2026 年 11 月 1 日，到期后可配置个人 DeepSeek API。';
export const CAMPUS_LIMITS = '校内模型不能直接看图，课件需要先经 OCR 识别。图示关系可能遗漏，公式、表格及模糊文字可能误识；复杂课件的理解效果可能弱于直接识图。';
export class AIConnection {
  constructor(native, preferences) { this.native = native; this.preferences = preferences; this.status = { personalReady: false, campusReady: false }; }
  async refresh() {
    const status = await this.native.call('aiStatus');
    // Compatibility with older shells and isolated fixtures, never persist credentials.
    this.status = status && typeof status.personalReady === 'boolean' ? status : { personalReady: !!(await this.native.call('secret')), campusReady: false };
    return this.available();
  }
  provider() { return ['personal', 'campus'].includes(this.preferences().aiProvider) ? this.preferences().aiProvider : 'auto'; }
  effective() { return this.provider() === 'auto' ? this.status.personalReady ? 'personal' : 'campus' : this.provider(); }
  available() { return this.effective() === 'personal' ? this.status.personalReady : this.status.campusReady; }
  request() { return { provider: this.provider() }; }
  description() { return this.effective() === 'campus' ? '浙大校内网关 · ' + CAMPUS_NOTICE : '个人 DeepSeek API'; }
}
