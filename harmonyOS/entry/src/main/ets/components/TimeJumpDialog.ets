import { stamp } from '../model/Timeline';
@CustomDialog
export struct TimeJumpDialog {
  controller: CustomDialogController;
  initialSeconds: number = 0;
  maxSeconds: number = 0;
  onJump: (seconds: number) => void = () => {};
  @State hour: number = 0;
  @State minute: number = 0;
  @State second: number = 0;
  private limit(): number { return Math.max(0, Math.floor(this.maxSeconds)); }
  private values(end: number): string[] { const values: string[] = []; for (let i = 0; i <= end; i++) values.push(String(i).padStart(2, '0')); return values; }
  private minutes(): number { return this.hour === Math.floor(this.limit() / 3600) ? Math.floor(this.limit() / 60) % 60 : 59; }
  private seconds(): number { return this.hour === Math.floor(this.limit() / 3600) && this.minute === Math.floor(this.limit() / 60) % 60 ? this.limit() % 60 : 59; }
  private clamp(): void { this.minute = Math.min(this.minute, this.minutes()); this.second = Math.min(this.second, this.seconds()); }
  aboutToAppear(): void { const value = Math.max(0, Math.min(this.limit(), Math.floor(this.initialSeconds))); this.hour = Math.floor(value / 3600); this.minute = Math.floor(value / 60) % 60; this.second = value % 60; }
  build() {
    Column({ space: 18 }) {
      Text('跳转时间').fontSize(20).fontWeight(FontWeight.Medium).fontColor('#20344D')
      Text('可跳转至 ' + stamp(this.limit())).fontSize(12).fontColor('#7C899A')
      Row({ space: 4 }) {
        TextPicker({ range: this.values(Math.floor(this.limit() / 3600)), selected: this.hour }).canLoop(false).layoutWeight(1).height(180).selectedTextStyle({ color: '#168BEE', font: { size: 20 } }).onChange((value: string | string[], index: number | number[]) => { this.hour = Number(value); this.clamp(); })
        Text('时').fontSize(13).fontColor('#7C899A')
        TextPicker({ range: this.values(this.minutes()), selected: this.minute }).canLoop(false).layoutWeight(1).height(180).selectedTextStyle({ color: '#168BEE', font: { size: 20 } }).onChange((value: string | string[], index: number | number[]) => { this.minute = Number(value); this.clamp(); })
        Text('分').fontSize(13).fontColor('#7C899A')
        TextPicker({ range: this.values(this.seconds()), selected: this.second }).canLoop(false).layoutWeight(1).height(180).selectedTextStyle({ color: '#168BEE', font: { size: 20 } }).onChange((value: string | string[], index: number | number[]) => this.second = Number(value))
        Text('秒').fontSize(13).fontColor('#7C899A')
      }.width('100%')
      Row({ space: 12 }) {
        Button('取消').layoutWeight(1).height(38).backgroundColor('#EAF4FF').fontColor('#168BEE').onClick(() => this.controller.close())
        Button('跳转').layoutWeight(1).height(38).backgroundColor('#168BEE').fontColor('#FFFFFF').onClick(() => { this.onJump(Math.min(this.limit(), this.hour * 3600 + this.minute * 60 + this.second)); this.controller.close(); })
      }.width('100%')
    }.width('100%').padding(24)
  }
}
