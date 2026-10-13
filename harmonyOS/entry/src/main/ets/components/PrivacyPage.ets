import { common } from '@kit.AbilityKit';
import { PrivacyService } from '../services/PrivacyService';
@Component
export struct PrivacyPage {
  @Prop consentRequired: boolean = false;
  onAccept: () => void = () => {};
  onClose: () => void = () => {};
  onWithdraw: () => void = () => {};
  @State error: string = '';
  @State managed: boolean = false;
  aboutToAppear(): void { this.managed = new PrivacyService(this.getUIContext().getHostContext() as common.UIAbilityContext).managed(); }
  private async accept(): Promise<void> { try { if (await new PrivacyService(this.getUIContext().getHostContext() as common.UIAbilityContext).consent()) this.onAccept(); } catch (_) { this.error = '暂时无法读取隐私签署状态，请重试'; } }
  private openOfficial(): void { const context = this.getUIContext().getHostContext() as common.UIAbilityContext, links = new PrivacyService(context).links(); if (links.length) context.startAbility({ action: 'ohos.want.action.viewData', uri: links[0], entities: ['entity.system.browsable'] }).catch(() => this.error = '无法打开隐私声明'); }
  build() {
    Column({ space: 14 }) {
      Row({ space: 8 }) { if (!this.consentRequired) { Button('返回').height(32).fontSize(12).fontColor('#168BEE').backgroundColor('#EAF4FF').onClick(() => this.onClose()) } Text('隐私与数据').fontSize(22).fontWeight(FontWeight.Bold).fontColor('#20344D').layoutWeight(1) }.width('100%')
      Scroll() {
        Column({ space: 18 }) {
          Text('智云助手是独立的学习辅助工具。课程内容由智云课堂提供，能否访问由你的校园账号权限决定。').fontSize(15).lineHeight(26).fontColor('#20344D').width('100%')
          Text('登录与课程\n校园账号和密码仅用于向浙江大学官方认证页面提交登录，不发送给开发者，不保存密码。登录会话和账户身份使用系统安全资产库加密保存。断网不会自动退出，可查看当前账号已下载的课程；主动退出后清除身份与会话并隐藏下载入口。课程名、上课时间、课件、转写和视频由官方服务提供，学习内容缓存在本机应用沙箱。每节课的学习进度、课程收藏和稍后再看记录也只保存在本机，不上传给开发者。').fontSize(14).lineHeight(25).fontColor('#425F7D').width('100%')
          Text('笔记、图片与设备互联\n笔记保存在本机。选择图片、拍摄、设备互联和导出文件只在你主动操作时调用系统界面，不扫描相册或其他文件。设备互联的图片由系统受控通道传入，插入的图片会复制到笔记中。').fontSize(14).lineHeight(25).fontColor('#425F7D').width('100%')
          Text('DeepSeek 问答与速览\nAI 功能由你自行配置并启用。提问或生成速览时，选定范围的课件内容、对应转写、问题和有关对话将发送至 api.deepseek.com，API 费用由你的账户承担。问答默认以转写为依据，需要时才读取相关课件；整课和所有页模式会发送更多内容。“结合整门课之前的内容”和“结合整门课”还会发送这门课其他可访问课次的转写和课件时间索引，后者包括本节之后已经上过的课次，相关课件按需读取。API 密钥使用系统安全资产库加密保存。AI 回答可能有误，请结合课程原文判断。').fontSize(14).lineHeight(25).fontColor('#425F7D').width('100%')
          Text('缓存与删除\n在缓存设置中可以关闭各类内容的保存、清理全部或选择课程清理。离线下载和笔记独立管理；清理缓存不会删除它们或学习进度、收藏、稍后再看记录。退出登录会清除登录凭据；问答设置可删除 API 密钥。撤回隐私同意后停止联网服务，可保留本机笔记和下载。没有广告 SDK 或行为追踪服务。').fontSize(14).lineHeight(25).fontColor('#425F7D').width('100%')
          Text('第三方组件\n视频使用开源 hls.js（Apache-2.0 许可）；文本和图像处理使用鸿蒙系统能力。课程、学校名称及课件内容的权利属于其权利人。下载仅供获得权限的个人学习使用。').fontSize(14).lineHeight(25).fontColor('#425F7D').width('100%')
          if (this.managed) { Button('查看正式隐私声明').height(36).fontColor('#168BEE').backgroundColor('#EAF4FF').onClick(() => this.openOfficial()) }
        }.width('100%').alignItems(HorizontalAlign.Start)
      }.layoutWeight(1).width('100%').align(Alignment.TopStart)
      if (this.consentRequired) {
        Button(this.managed ? '阅读并确认隐私声明' : '同意并继续').width('100%').height(44).backgroundColor('#168BEE').fontColor('#FFFFFF').onClick(() => this.accept())
        Button('暂不使用联网功能').width('100%').height(36).backgroundColor('#EAF4FF').fontColor('#168BEE').onClick(() => this.onClose())
      } else { Button('撤回隐私同意').height(36).fontColor('#B44747').backgroundColor('#FCEEEE').onClick(() => this.onWithdraw()) }
      if (this.error) { Text(this.error).fontSize(12).fontColor('#AE6B41') }
    }.padding(20).width('100%').height('100%').backgroundColor('#F1F3F5')
  }
}
