import { SlideGridPager } from './SlideGridPager';
import { gesturePage, navigationGroups } from '../model/StudyNavigation';
import { NoteInsertion } from '../model/Notes';
import { PageGroup, Slide } from '../model/Timeline';
import { dragPageOffset, releasedPage } from '../model/PageNavigation';
import { PageCard } from './PageCard';

@Component
export struct SlidePager {
  @Prop gridMode: boolean = false;
  @Prop groups: PageGroup[] = [];
  @Prop slides: Slide[] = [];
  @Prop skipEmpty: boolean = false;
  @Prop manual: boolean = false;
  onJump: (at: number, id: string) => void = () => {};
  onExpand: (slide: Slide) => void = () => {};
  @Link @Watch('positionChanged') selected: number;
  @Prop @Watch('positionChanged') capacity: number = 2;
  @Prop imageUris: Record<string, string> = {};
  @Prop transcription: boolean = false;
  @Prop transcriptState: string = '';
  @Prop stacked: boolean = false;
  @Prop slideShare: number = 0.64;
  @Prop notesOpen: boolean = false;
  @Prop highlightAt: number = -1;
  @Prop imageHighlightId: string = '';
  @Prop highlightSource: string = '';
  onInsert: (value: NoteInsertion) => void = () => {};
  @Prop demo: boolean = false;
  onSkipBlocked: (direction: number) => void = () => {};
  onTurn: (direction: number) => void = () => {};
  onBrowse: () => void = () => {};
  onPosition: () => void = () => {};
  onPreview: (index: number) => void = () => {};
  @State pagerWidth: number = 1000;
  @State dragOffset: number = 0;
  private epoch: number = 0;
  private previewIndex: number = -1;
  private wheelAt: number = 0;
  private step(): number { return (this.pagerWidth + 12) / this.capacity; }
  private pages(): PageGroup[] { return navigationGroups(this.groups, this.selected, this.skipEmpty && this.manual); }
  private pagePosition(): number { return Math.max(0, this.pages().findIndex((g: PageGroup) => g.slide.id === this.groups[this.selected]?.slide.id)); }
  private start(): number { return Math.max(0, this.pagePosition() - this.capacity * 3); }
  private visible(): PageGroup[] { return this.pages().slice(this.start(), this.pagePosition() + this.capacity * 4); }
  private positionChanged(): void { this.epoch++; this.dragOffset = 0; this.previewIndex = -1; }
  private wheel(horizontal: number, vertical: number = 0): void {
    const value = Math.abs(horizontal) > 0.1 ? horizontal : vertical;
    if (Math.abs(value) < 0.1 || Date.now() - this.wheelAt < 220) return;
    this.wheelAt = Date.now(); this.onTurn(value < 0 ? 1 : -1);
  }
  private move(event: GestureEvent): void {
    const pages = this.pages(), position = this.pagePosition();
    this.dragOffset = dragPageOffset(position, pages.length, this.capacity, this.step(), event.offsetX);
    const at = releasedPage(position, pages.length, this.capacity, this.step(), this.dragOffset, 0);
    const preview = this.groups.findIndex((g: PageGroup) => g.slide.id === pages[at]?.slide.id);
    if (preview !== this.previewIndex) { this.previewIndex = preview; this.onPreview(preview); }
  }
  private settle(event?: GestureEvent): void {
    const pages = this.pages(), position = this.pagePosition();
    const at = event ? releasedPage(position, pages.length, this.capacity, this.step(), this.dragOffset, event.velocityX) : position;
    const raw = this.groups.findIndex((g: PageGroup) => g.slide.id === pages[at]?.slide.id);
    const next = gesturePage(this.groups, raw, this.selected, this.skipEmpty);
    if (event && next === this.selected && event.offsetX > 35) this.onSkipBlocked(-1);
    const gen = ++this.epoch;
    this.getUIContext().animateTo({ duration: 150, curve: Curve.EaseOut, onFinish: () => {
      if (gen !== this.epoch) return;
      this.selected = next; this.dragOffset = 0; this.onPosition();
    } }, () => { this.dragOffset = (position - Math.max(0, pages.findIndex((g: PageGroup) => g.slide.id === this.groups[next]?.slide.id))) * this.step(); });
  }
  build() {
    if (this.gridMode) { SlideGridPager({ groups: this.groups, slides: this.slides, imageUris: this.imageUris, selected: $selected, capacity: this.capacity, skipEmpty: this.skipEmpty, manual: this.manual, notesOpen: this.notesOpen, imageHighlightId: this.imageHighlightId, onExpand: this.onExpand, onJump: this.onJump, onInsert: this.onInsert, onBrowse: this.onBrowse, onPosition: this.onPosition, onTurn: this.onTurn }).width('100%').height('100%') } else {
    Stack({ alignContent: Alignment.TopStart }) {
      Row({ space: 12 }) {
        ForEach(this.visible(), (g: PageGroup) => {
          PageCard({ imageHighlightId: this.imageHighlightId, group: g, onJump: () => this.onJump(g.slide.t, g.slide.id), onExpand: () => this.onExpand(g.slide), notesOpen: this.notesOpen, highlightAt: this.highlightAt, highlightSource: this.highlightSource, onInsert: (value: NoteInsertion) => this.onInsert(value), uri: this.imageUris[g.slide.id] || '', index: this.slides.findIndex((s: Slide) => s.id === g.slide.id), cardWidth: this.step() - 12, showTranscript: this.transcription, transcriptState: this.transcriptState, demo: this.demo, slideShare: this.slideShare, stacked: this.stacked || this.capacity > 1, onPictureWheel: (horizontal: number, vertical: number) => this.wheel(horizontal, vertical) })
            .width(this.step() - 12).height('100%')
        }, (g: PageGroup) => g.slide.id)
      }.height('100%').width(this.visible().length * this.step() - 12)
        .translate({ x: (this.start() - this.pagePosition()) * this.step() + this.dragOffset })
    }.width('100%').height('100%').clip(true).focusable(true).defaultFocus(true)
      .onAreaChange((oldArea: Area, newArea: Area) => { this.pagerWidth = Number(newArea.width); })
      .onAxisEvent((event: AxisEvent) => { this.wheel(event.getHorizontalAxisValue()); })
      .onGestureJudgeBegin((info: GestureInfo, event: BaseGestureEvent) => event.source === SourceType.Mouse && info.type === GestureControl.GestureType.PAN_GESTURE ? GestureJudgeResult.REJECT : GestureJudgeResult.CONTINUE)
      .parallelGesture(PanGesture({ direction: PanDirection.Horizontal, distance: 8 })
        .onActionStart(() => { this.epoch++; this.onBrowse(); })
        .onActionUpdate((event: GestureEvent) => this.move(event))
        .onActionEnd((event: GestureEvent) => this.settle(event))
        .onActionCancel(() => this.settle()))
    }
  }
}
