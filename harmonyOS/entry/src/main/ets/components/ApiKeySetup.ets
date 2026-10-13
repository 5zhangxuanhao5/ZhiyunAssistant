import { PhysicalInput } from '../services/PhysicalInput';
import { common } from '@kit.AbilityKit';
import { AiClient } from '../services/AiClient';
@Component
export struct ApiKeySetup {
  private apiInput: PhysicalInput = new PhysicalInput();

  onEnabled: () => void = () => {};
  onEditingFocus: (focused: boolean) => void = () => {};
  @State keyInput: string = '';
  @State busy: boolean = false;
  @State error: string = '';
  private ai: AiClient = new AiClient();
  private epoch: number = 0;
  aboutToDisappear(): void { this.epoch++; this.ai.cancel(); this.keyInput = ''; }
  private async save(): Promise<void> {
    if (this.busy) return; this.busy = true; this.error = ''; const gen = this.epoch;
    try { await this.ai.models(this.keyInput.trim()); if (gen !== this.epoch) return; await AiClient.saveKey(this.keyInput); this.keyInput = ''; this.onEnabled(); }
    catch (err) { if (gen === this.epoch) this.error = (err as Error).message; }
    finally { if (gen === this.epoch) this.busy = false; }
  }
  build() {
    Scroll() {
      Column({ space: 14 }) {
        Text('使用 DeepSeek API').fontSize(20).fontWeight(FontWeight.Medium).fontColor('#20344D').width('100%')
        Text('在 DeepSeek 开放平台创建 API 密钥。启用问答或速览后，相关课件和转写会发送给 DeepSeek；请求费用由你的 API 账户承担。密钥加密保存在本机。').fontSize(13).fontColor('#71839A').lineHeight(22).width('100%')
        TextInput({ controller: this.apiInput.controller, text: this.keyInput, placeholder: '输入 API 密钥' }).onKeyPreIme((event: KeyEvent): boolean => this.apiInput.digit(event, this.keyInput, (value: string) => this.keyInput = value)).type(InputType.Password).onTouch((event: TouchEvent) => event.stopPropagation()).onMouse((event: MouseEvent) => event.stopPropagation()).height(44).onFocus(() => this.onEditingFocus(true)).onBlur(() => { this.apiInput.reset(); this.onEditingFocus(false); }).onChange((value: string) => this.keyInput = value)
        Button(this.busy ? '正在连接' : '保存并启用').width('100%').height(40).backgroundColor('#168BEE').fontColor('#FFFFFF').enabled(!this.busy && !!this.keyInput.trim()).onClick(() => this.save())
        Button('前往 DeepSeek 开放平台').height(30).fontSize(12).backgroundColor(Color.Transparent).fontColor('#168BEE').onClick(() => { const context = this.getUIContext().getHostContext() as common.UIAbilityContext; context.startAbility({ action: 'ohos.want.action.viewData', uri: 'https://platform.deepseek.com/api_keys', entities: ['entity.system.browsable'] }).catch(() => this.error = '请在浏览器打开 platform.deepseek.com'); })
        if (this.error) { Text(this.error).fontSize(12).fontColor('#B44747').width('100%') }
      }.width('100%').padding({ top: 14, bottom: 14 })
    }.width('100%').height('100%').align(Alignment.Center).scrollBar(BarState.Auto)
  }
}
