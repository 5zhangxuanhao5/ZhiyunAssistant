import { InsertNoteAction } from './InsertNoteAction';
import { ImageAccentStore } from '../services/ImageAccentStore';
import { NoteInsertion } from '../model/Notes';
import { unifiedDataChannel } from '@kit.ArkData';
import { pasteboard } from '@kit.BasicServicesKit';
import { TranscriptText } from './TranscriptText';
import { PageGroup, Transcript, stamp, plainTranscript } from '../model/Timeline';

@Component
export struct PageCard {
  @Prop @Watch('pageChanged') group: PageGroup;
  private lastPageId: string = '';
  private pageChanged(): void { if (this.lastPageId !== this.group.slide.id) this.insertOpen = false; this.lastPageId = this.group.slide.id; }
  private jumpIfTap(): void { if (this.moved || Date.now() < this.suppressedUntil) return; this.insertOpen = false; this.onJump(); }
  private downX: number = 0;
  private downY: number = 0;
  private moved: boolean = false;
  private suppressedUntil: number = 0;
  private pictureTouch(event: TouchEvent): void {
    const point = event.changedTouches[0] || event.touches[0];
    if (event.type === TouchType.Down && point) { this.downX = point.windowX; this.downY = point.windowY; this.moved = false; }
    if (event.type === TouchType.Move && point && Math.hypot(point.windowX - this.downX, point.windowY - this.downY) > 8 || event.touches.length > 1) { this.moved = true; this.insertOpen = false; }
    if ((event.type === TouchType.Cancel || event.type === TouchType.Up) && this.moved) { this.insertOpen = false; this.suppressedUntil = Date.now() + 400; }
  }
  @Prop @Watch('accentChanged') uri: string = '';
  @Prop @Watch('accentChanged') imageHighlightId: string = '';
  @State accent: string = '#7C3AED';
  private accentChanged(): void { const uri = this.uri; if (!uri || this.imageHighlightId !== this.group.slide.id) return; ImageAccentStore.color(uri).then((color: string) => { if (this.uri === uri) this.accent = color; }).catch(() => {}); }
  aboutToAppear(): void { this.accentChanged(); }
  @Prop index: number = 0;
  @Prop showTranscript: boolean = false;
  @Prop cardWidth: number = 800;
  @Prop transcriptState: string = '';
  @Prop demo: boolean = false;
  @Prop stacked: boolean = false;
  @Prop slideShare: number = 0.64;
  @Prop notesOpen: boolean = false;
  @Prop highlightAt: number = -1;
  @Prop highlightSource: string = '';
  onJump: () => void = () => {};
  onExpand: () => void = () => {};
  onRatio: (ratio: number) => void = () => {};
  onInsert: (value: NoteInsertion) => void = () => {};
  @State insertOpen: boolean = false;
  @State pictureRatio: number = 16 / 9;
  @State cardHeight: number = 600;
  private pictureHeight(): number { return Math.max(1, Math.min((this.cardHeight - 52) * this.slideShare, Math.max(1, this.cardWidth - 20) / this.pictureRatio)); }
  onPictureWheel: (horizontal: number, vertical: number) => void = () => {};
  private transcriptScroller: Scroller = new Scroller();
  private copyPage(): void {
    const text = plainTranscript(this.group.lines.map((l: Transcript) => l.text).join(''));
    if (text) pasteboard.getSystemPasteboard().setData(pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, text));
  }
  @Builder
  private insertPopup() {
    InsertNoteAction({ onInsert: () => { this.insertOpen = false; this.onInsert({ kind: 'image', value: this.uri, at: this.group.slide.t, end: this.group.slide.t, sourceId: this.group.slide.id }); } }).id('insert-slide-note').width(Math.min(112, Math.max(40, this.imageWidth() - 16)))
  }
  private imageHeight(): number { const height = this.showTranscript && this.stacked ? this.pictureHeight() : Math.max(1, this.cardHeight - 42); return Math.min(height, Math.max(1, this.cardWidth - 20) / this.pictureRatio); }
  private imageWidth(): number { return this.imageHeight() * this.pictureRatio; }
  @Builder
  private pictureBox() {
    Column() {
      Blank().height(Math.max(0, ((this.showTranscript && this.stacked ? this.pictureHeight() : this.cardHeight - 42) - this.imageHeight()) / 2)).width('100%').onClick(() => this.jumpIfTap())
      Row() {
        Blank().layoutWeight(1).height('100%').onClick(() => this.jumpIfTap())
        this.picture()
        Blank().layoutWeight(1).height('100%').onClick(() => this.jumpIfTap())
      }.width('100%').height(this.imageHeight())
      Blank().layoutWeight(1).width('100%').onClick(() => this.jumpIfTap())
    }.width('100%').height('100%').alignItems(HorizontalAlign.Center)
  }
  @Builder
  private picture() {
    if (this.uri) {
      Stack({ alignContent: Alignment.TopStart }) {
      Image(this.uri).objectFit(ImageFit.Contain).width(this.imageWidth()).height(this.imageHeight()).draggable(!this.demo)
        .id('slide-image-' + this.group.slide.id)
        .priorityGesture(GestureGroup(GestureMode.Exclusive,
          TapGesture({ count: 2 }).onAction(() => { if (!this.moved && Date.now() >= this.suppressedUntil) { this.insertOpen = false; this.onExpand(); } }),
          TapGesture({ count: 1 }).onAction(() => { if (this.notesOpen && !this.moved && Date.now() >= this.suppressedUntil) this.insertOpen = !this.insertOpen; })
        ))
        .onTouch((event: TouchEvent) => this.pictureTouch(event))
        .onComplete((event) => { if (event && event.width > 0 && event.height > 0) this.pictureRatio = event.width / event.height; this.onRatio(this.pictureRatio); })
        .onDragStart((event: DragEvent) => {
          if (!this.uri.startsWith('file://')) return;
          const record = new unifiedDataChannel.Image(); record.imageUri = this.uri;
          event.setData(new unifiedDataChannel.UnifiedData(record));
          return { extraInfo: `第 ${this.index + 1} 页课件` };
        })
        .onAxisEvent((event: AxisEvent) => { this.insertOpen = false; this.onPictureWheel(event.getHorizontalAxisValue(), event.getVerticalAxisValue()); })
      if (this.imageHighlightId === this.group.slide.id) { Column().width(this.imageWidth() + 8).height(this.imageHeight() + 8).position({ x: -4, y: -4 }).border({ width: 4, color: this.accent }).borderRadius(4).hitTestBehavior(HitTestMode.None) }
      if (this.insertOpen && this.notesOpen) { Column() { this.insertPopup() }.position({ x: Math.max(4, (this.imageWidth() - Math.min(112, Math.max(40, this.imageWidth() - 16))) / 2), y: Math.max(4, this.imageHeight() - 44) }) }
      }.width(this.imageWidth()).height(this.imageHeight())
    } else {
      Column() { LoadingProgress().width(28).height(28).color('#168BEE') }
        .width('100%').height('100%').justifyContent(FlexAlign.Center)
    }
  }
  @Builder
  private transcript() {
    Column() {
      Row() {
        Text('课堂转写').fontSize(13).fontWeight(FontWeight.Medium).fontColor('#294765')
        Blank()
        Button('复制').fontSize(11).fontColor('#168BEE').backgroundColor('#E5F1FF').height(26)
          .enabled(this.group.lines.length > 0).onClick(() => this.copyPage())
      }.width('100%').height(34)
      Scroll(this.transcriptScroller) {
        Column({ space: 7 }) {
          if (!this.group.lines.length) { Text(this.transcriptState || '暂无转写').fontSize(13).fontColor('#7C899A').lineHeight(22) }
          if (this.group.lines.length) { TranscriptText({ pageKey: this.group.slide.id, pageStart: this.group.slide.t, lines: this.group.lines, compact: this.cardWidth < 480, notesOpen: this.notesOpen, highlightAt: this.highlightAt, highlightSource: this.highlightSource, onHighlightPosition: (top: number): void => { this.transcriptScroller.scrollTo({ xOffset: 0, yOffset: Math.max(0, top - 20), animation: { duration: 120 } }); }, onInsert: (value: NoteInsertion) => this.onInsert(value) }) }
        }.width('100%').alignItems(HorizontalAlign.Start).padding({ top: 8, bottom: 12 })
      }.layoutWeight(1).scrollBar(BarState.Auto).align(Alignment.TopStart).width('100%')
    }.width('100%').height('100%').padding({ left: 12, right: 12 }).backgroundColor('#F1F7FE').borderRadius(10)
  }
  build() {
    Column() {
      Row() {
        Text(`第 ${this.index + 1} 页`).fontSize(12).fontColor('#74869A')
        Blank()
        Text(stamp(this.group.slide.t)).fontSize(12).fontColor('#74869A')
      }.id('slide-caption-' + this.group.slide.id).width('100%').height(32).padding({ left: 16, right: 16 }).focusable(true).focusOnTouch(true).onClick(() => {})
      if (this.showTranscript && this.stacked) {
        Column({ space: 10 }) {
          Column() { this.pictureBox() }.width('100%').height(this.pictureHeight()).backgroundColor(Color.Transparent)
          Column() { this.transcript() }.width('100%').layoutWeight(1)
        }.layoutWeight(1).width('100%').padding({ left: 10, right: 10, bottom: 10 })
      } else {
        Row({ space: 10 }) {
          Column() { this.pictureBox() }.layoutWeight(this.slideShare).height('100%').backgroundColor(Color.Transparent)
          if (this.showTranscript) {
            Column() { this.transcript() }.layoutWeight(1 - this.slideShare).height('100%')
          }
        }.layoutWeight(1).padding({ left: 10, right: 10, bottom: 10 }).width('100%')
      }
    }.width('100%').height('100%').backgroundColor('#FFFFFF').borderRadius(14).onTouch((event: TouchEvent) => this.pictureTouch(event)).onAreaChange((oldArea: Area, newArea: Area) => this.cardHeight = Number(newArea.height))
  }
}
