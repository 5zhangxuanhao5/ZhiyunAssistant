import { AxisPaging } from '../model/AxisPaging';
import { pointerSelection } from '../model/PointerInput';
import { STUDY_TITLE_SIZE, STUDY_TITLE_COLOR, STUDY_SURFACE, STUDY_RADIUS } from '../model/StudyStyle';
import { Transcript } from '../model/Timeline';
import { NoteInsertion } from '../model/Notes';
import { TranscriptText } from './TranscriptText';
@Component
export struct TranscriptColumn {
  @Prop returnSpace: number = 0;
  @Prop continuous: boolean = false;
  @Prop resumeAt: number = -1;
  @Prop @Watch('restoreRequested') restoreRevision: number = 0;
  @Prop @Watch('trackChanged') trackSourceId: string = '';
  private trackChanged(): void { this.trackedTop = this.trackedBottom = -1; }
  onAnchor: (at: number, sourceId: string, offset: number) => void = () => {};
  onAnchorVisible: (visible: boolean) => void = () => {};
  private held: boolean = false;
  private readingAt: number = -1;
  private readingOffset: number = 0;
  private trackedTop: number = -1;
  private trackedBottom: number = -1;
  private restoreRequested(): void { this.restoringReading = this.continuous || this.lines.some((line: Transcript) => Math.abs(line.t - this.resumeAt) < 0.01); }
  private trackPosition(top: number, bottom: number): void { this.trackedTop = top; this.trackedBottom = bottom; this.reportAnchorVisible(); }
  private reportAnchorVisible(): void { if (this.trackSourceId && this.lines.some((line: Transcript) => line.id === this.trackSourceId) && this.trackedTop >= 0) this.onAnchorVisible(this.trackedBottom > this.scrollOffset + 1 && this.trackedTop < this.scrollOffset + this.viewportHeight - 1); }
  @Prop resumeOffset: number = 0;
  onReadingPosition: (at: number, offset: number) => void = () => {};
  private restoringReading: boolean = false;
  private readingActive: boolean = false;
  private browse(): void { this.readingActive = true; this.onBrowse(this.readingAt, this.readingOffset); }
  aboutToAppear(): void { this.restoringReading = this.continuous && this.resumeAt >= 0; }
  @Prop @Watch('pageChanged') pageKey: string = '';
  @Prop pageStart: number = -1;
  @Prop lines: Transcript[] = [];
  @Prop title: string = '课堂转写';
  @Prop playbackColored: boolean = false;
  @Prop highlightRevision: number = 0;
  @Prop playbackAt: number = -1;
  @Prop @Watch('followChanged') following: boolean = true;
  @Prop canFollow: boolean = true;
  onBrowse: (at: number, offset: number) => void = () => {};
  onDragging: (active: boolean) => void = () => {};
  onSelecting: (active: boolean) => void = () => {};
  onReturn: () => void = () => {};
  @Prop notesOpen: boolean = false;
  @Prop highlightAt: number = -1;
  @Prop highlightSource: string = '';
  @Prop status: string = '';
  onJump: (at: number, sourceId: string, excerpt: string) => void = () => {};
  private axisPaging: AxisPaging = new AxisPaging();
  onTurn: (direction: number, at: number, offset: number) => void = () => {};
  @State dragging: boolean = false;
  @State selecting: boolean = false;
  onInsert: (value: NoteInsertion) => void = () => {};
  private scroller: Scroller = new Scroller();
  @State scrollOffset: number = 0;
  @State viewportHeight: number = 300;
  private activeTop: number = -1;
  private activeBottom: number = -1;
  private pageChanged(): void { this.activeTop = -1; this.activeBottom = -1; this.trackedTop = this.trackedBottom = -1; this.selecting = false; this.restoringReading = this.continuous && this.resumeAt >= 0; this.scrollOffset = 0; this.scroller.scrollTo({ xOffset: 0, yOffset: 0, animation: false }); }
  private scrolled(): void { this.scrollOffset = this.scroller.currentOffset().yOffset; this.reportAnchorVisible(); }
  private followChanged(): void { if (this.following && this.activeTop >= 0) this.followSentence(this.activeTop, this.activeBottom); }
  private followSentence(top: number, bottom: number): void {
    this.activeTop = top; this.activeBottom = bottom;
    if (!this.following || this.selecting || this.held || this.restoringReading) return;
    const offset = this.scroller.currentOffset().yOffset, visible = Math.max(24, this.viewportHeight - 20);
    if (top < offset + 8 || bottom > offset + visible) this.scroller.scrollTo({ xOffset: 0, yOffset: Math.max(0, top - 10), animation: { duration: 180, curve: Curve.EaseOut } });
  }
  build() {
    Column({ space: 6 }) {
      Text(this.title).fontSize(STUDY_TITLE_SIZE).fontWeight(FontWeight.Medium).fontColor(STUDY_TITLE_COLOR).width('100%')
      Scroll(this.scroller) {
        TranscriptText({ bottomInset: this.returnSpace, locateRevision: this.restoreRevision, trackSourceId: this.trackSourceId, onAnchor: this.onAnchor, onTrackPosition: (top: number, bottom: number) => this.trackPosition(top, bottom), onHeld: (active: boolean) => this.held = active, onDragging: (active: boolean) => { this.dragging = active; this.onDragging(active); }, locateAt: this.resumeAt, onReadingPosition: (at: number, offset: number) => { this.readingAt = at; this.readingOffset = offset; this.onReadingPosition(at, offset); }, onLocatePosition: (top: number) => { this.restoringReading = true; this.scroller.scrollTo({ xOffset: 0, yOffset: Math.max(0, top + this.resumeOffset), animation: false }); this.scrollOffset = Math.max(0, top + this.resumeOffset); setTimeout(() => this.restoringReading = false, 32); }, continuous: this.continuous, visibleTop: this.scrollOffset, visibleHeight: this.viewportHeight, pageKey: this.pageKey, pageStart: this.pageStart, onHold: () => this.readingActive = true, highlightRevision: this.highlightRevision, playbackColored: this.playbackColored, lines: this.lines, playbackAt: this.playbackAt, notesOpen: this.notesOpen, highlightAt: this.highlightAt, highlightSource: this.highlightSource, onInsert: this.onInsert, onJump: this.onJump, onSelecting: (active: boolean) => { this.selecting = active; this.onSelecting(active); }, onPlaybackPosition: (top: number, bottom: number) => this.followSentence(top, bottom), onHighlightPosition: (top: number): void => { this.scroller.scrollTo({ xOffset: 0, yOffset: Math.max(0, top - 10) }); } }).width('100%')
      }.layoutWeight(1).width('100%').align(Alignment.TopStart).scrollable(ScrollDirection.Vertical).enableScrollInteraction(!this.dragging).scrollBar(BarState.Auto).onScroll(() => this.scrolled()).onAreaChange((oldArea: Area, area: Area) => { const changed = Math.abs(this.viewportHeight - Number(area.height)) > 1; this.viewportHeight = Number(area.height); if (changed && this.activeTop >= 0) setTimeout(() => this.followSentence(this.activeTop, this.activeBottom), 32); })
      if (!this.lines.length) { Text(this.status || '等待课程转写').fontSize(12).fontColor('#71839A') }
    }.width('100%').height('100%').padding(12).backgroundColor(STUDY_SURFACE).borderRadius(STUDY_RADIUS)
      .onAxisEvent((event: AxisEvent) => { if (this.dragging) return; if (Math.abs(event.getVerticalAxisValue()) > 0) this.browse(); const direction = this.axisPaging.move(event.getHorizontalAxisValue(), event.getVerticalAxisValue(), event.action); if (direction) this.onTurn(direction, this.readingAt, this.readingOffset); })
      .onGestureJudgeBegin((info: GestureInfo, event: BaseGestureEvent) => (this.dragging || pointerSelection(event.source, event.sourceTool) && !info.isSystemGesture) && info.type === GestureControl.GestureType.PAN_GESTURE ? GestureJudgeResult.REJECT : GestureJudgeResult.CONTINUE)
      .parallelGesture(PanGesture({ direction: PanDirection.Vertical, distance: 8 }).onActionStart(() => { if (!this.selecting) this.browse(); }))
      .parallelGesture(PanGesture({ direction: PanDirection.Horizontal, distance: 20 }).onActionEnd((event: GestureEvent) => { if (!this.selecting && Math.abs(event.offsetX) >= 48 && Math.abs(event.offsetX) > Math.abs(event.offsetY) * 1.5) this.onTurn(event.offsetX > 0 ? -1 : 1, this.readingAt, this.readingOffset); }))
  }
}
