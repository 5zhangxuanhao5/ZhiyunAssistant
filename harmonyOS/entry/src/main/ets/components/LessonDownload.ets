import { Course, shanghaiDate, clockTime } from '../model/Timeline';
import { DownloadOptions } from '../services/OfflineLibrary';
@Component
export struct LessonDownload {
  @Prop course: Course | undefined = undefined;
  onClose: () => void = () => {};
  onDownload: (options: DownloadOptions) => void = () => {};
  @State video: boolean = true;
  @State slides: boolean = true;
  @State transcript: boolean = true;
  build() {
    Column({ space: 18 }) {
      Row({ space: 8 }) { Button('返回').height(32).fontSize(12).fontColor('#168BEE').backgroundColor('#EAF4FF').onClick(() => this.onClose()); Text('下载本节课').fontSize(22).fontWeight(FontWeight.Bold).fontColor('#20344D') }.width('100%')
      Text(this.course?.title || '').fontSize(18).fontColor('#20344D').width('100%')
      Text(this.course ? shanghaiDate(this.course.start) + ' ' + clockTime(this.course.start) : '').fontSize(13).fontColor('#71839A').width('100%')
      Column({ space: 14 }) {
        Row({ space: 12 }) { Checkbox().select(this.video).onChange((value: boolean) => this.video = value); Text('视频').fontSize(16).fontColor('#20344D') }.width('100%')
        Row({ space: 12 }) { Checkbox().select(this.slides).onChange((value: boolean) => this.slides = value); Text('课件').fontSize(16).fontColor('#20344D') }.width('100%')
        Row({ space: 12 }) { Checkbox().select(this.transcript).onChange((value: boolean) => this.transcript = value); Text('转写').fontSize(16).fontColor('#20344D') }.width('100%')
      }.padding(16).width('100%').backgroundColor('#FFFFFF').borderRadius(14)
      Text('仅下载当前这次上课的可用内容。直播尚未结束时，保存平台当前提供的部分。').fontSize(13).fontColor('#71839A').width('100%')
      Button('开始下载').height(44).width('100%').fontColor('#FFFFFF').backgroundColor('#168BEE').enabled(this.video || this.slides || this.transcript).onClick(() => this.onDownload({ video: this.video, slides: this.slides, transcript: this.transcript }))
      Blank()
    }.id('lesson-download-content').padding(20).width('100%').height('100%').backgroundColor('#F1F3F5')
  }
}
