import { DropdownLabel } from './DropdownLabel';
import { PaneFrame } from './PaneFrame';
import { PaneRect, alterPane, paneTitle, recoverPane } from '../model/PaneLayout';
@Component
export struct LayoutPanel {
  @Prop rects: PaneRect[] = [];
  @Prop activeIds: string[] = [];
  @Prop locked: boolean = false;
  @State selected: string = '';
  @State boardWidth: number = 480;
  @State boardHeight: number = 320;
  private start: PaneRect | undefined = undefined;
  onChange: (rect: PaneRect) => void = () => {};
  onPreset: (preset: string) => void = () => {};
  onClose: () => void = () => {};
  onSave: () => void = () => {};
  onLayer: (id: string, action: string) => void = () => {};
  onLock: () => void = () => {};
  onSelect: (id: string) => void = () => {};
  private begin(rect: PaneRect): void { if (this.locked) return; this.start = { id: rect.id, x: rect.x, y: rect.y, w: rect.w, h: rect.h, z: rect.z }; this.selected = rect.id; }
  private rect(id: string): PaneRect { return this.rects.find((rect: PaneRect) => rect.id === id) || { id, x: 0, y: 0, w: 1, h: 1, z: 0 }; }
  private move(event: GestureEvent, resize: boolean): void { if (!this.locked && this.start) this.onChange(alterPane(this.start, event.offsetX / this.boardWidth, event.offsetY / this.boardHeight, resize)); }
  @Builder
  private preview(id: string) {
    Column() { Text(paneTitle(id)).fontSize(14).fontColor('#526B83').maxLines(1) }.width('100%').height('100%').justifyContent(FlexAlign.Center).backgroundColor('#FFFFFF')
  }
  @Builder
  private box(id: string) {
    PaneFrame({ namespace: 'layout-', backgroundFocus: false, rect: this.rect(id), canvasWidth: this.boardWidth, canvasHeight: this.boardHeight, adjustable: !this.locked, selected: this.selected === id,
      onActivate: () => this.onSelect(id), onSelect: () => this.selected = id, onChange: this.onChange, content: () => { this.preview(id); } })
      .width(Math.max(1, this.rect(id).w * this.boardWidth - 8)).height(Math.max(1, this.rect(id).h * this.boardHeight - 8)).position({ x: this.rect(id).x * this.boardWidth + 4, y: this.rect(id).y * this.boardHeight + 4 }).zIndex(this.rect(id).z).visibility(this.activeIds.includes(id) ? Visibility.Visible : Visibility.None)
  }

  build() {
    Column({ space: 12 }) {
      Row() { Text('自由布局').fontSize(19).fontWeight(FontWeight.Bold).fontColor('#20344D'); Blank(); Button(this.locked ? '解锁布局' : '锁定布局').height(32).fontSize(12).fontColor('#168BEE').backgroundColor(this.locked ? '#DDEEFF' : '#EAF4FF').margin({ right: 8 }).onClick(() => this.onLock()); Button('保存布局').id('save-layout').height(32).fontSize(12).fontColor('#FFFFFF').backgroundColor('#168BEE').margin({ right: 8 }).onClick(() => this.onSave()); Button('完成').height(32).fontSize(12).fontColor('#FFFFFF').backgroundColor('#168BEE').onClick(() => this.onClose()) }.width('100%')
      Text('点击顶部横条选中，拖动横条移动、拖动边缘缩放。完成只用于本次，保存后复用。').fontSize(12).fontColor('#71839A').width('100%')
      Stack({ alignContent: Alignment.TopStart }) {
        Column().width('100%').height('100%').backgroundColor('#E3EAF2').onClick(() => this.selected = '')
        this.box('video')
        this.box('slides')
        this.box('transcript')
        this.box('notes')
        this.box('ai')
        this.box('summary')
      }.width('100%').height(320).backgroundColor('#E3EAF2').borderRadius(10).clip(true).onAreaChange((oldArea: Area, area: Area) => { this.boardWidth = Number(area.width); this.boardHeight = Number(area.height); })
      Row({ space: 6 }) {
        Button('自动排布').height(30).fontSize(11).fontColor('#168BEE').backgroundColor('#EAF4FF').enabled(!this.locked).onClick(() => this.onPreset('auto'))
        Button('横向排列').height(30).fontSize(11).fontColor('#168BEE').backgroundColor('#EAF4FF').enabled(!this.locked).onClick(() => this.onPreset('columns'))
        Button('纵向排列').height(30).fontSize(11).fontColor('#168BEE').backgroundColor('#EAF4FF').enabled(!this.locked).onClick(() => this.onPreset('rows'))
        Button('移回窗口').height(30).fontSize(11).fontColor('#168BEE').backgroundColor('#EAF4FF').enabled(!!this.selected && !this.locked).onClick(() => this.onChange(recoverPane(this.rect(this.selected))))
      }.width('100%')
      Row({ space: 6 }) {
        Button() { DropdownLabel({ label: this.selected ? paneTitle(this.selected) + '' : '选择功能区', labelSize: 11 }) }.padding(0).height(30).fontSize(11).fontColor('#168BEE').backgroundColor('#EAF4FF').bindMenu(this.activeIds.map((id: string): MenuElement => { return { value: paneTitle(id), action: () => this.selected = id }; }))
        Blank()
        Button('置底').height(30).fontSize(11).fontColor('#168BEE').backgroundColor('#EAF4FF').enabled(!!this.selected && !this.locked).onClick(() => this.onLayer(this.selected, 'bottom'))
        Button('下移').height(30).fontSize(11).fontColor('#168BEE').backgroundColor('#EAF4FF').enabled(!!this.selected && !this.locked).onClick(() => this.onLayer(this.selected, 'down'))
        Button('上移').height(30).fontSize(11).fontColor('#168BEE').backgroundColor('#EAF4FF').enabled(!!this.selected && !this.locked).onClick(() => this.onLayer(this.selected, 'up'))
        Button('置顶').height(30).fontSize(11).fontColor('#168BEE').backgroundColor('#EAF4FF').enabled(!!this.selected && !this.locked).onClick(() => this.onLayer(this.selected, 'top'))
      }.width('100%')
      if (!this.activeIds.length) { Text('先打开一个功能区').fontSize(13).fontColor('#71839A') }
    }.id('layout-panel-content').width('100%').padding(16).backgroundColor('#FFFFFF').borderRadius(18).clip(true)
  }
}
