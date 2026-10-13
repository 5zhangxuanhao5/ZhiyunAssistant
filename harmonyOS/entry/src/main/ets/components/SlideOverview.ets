import { OverviewSource } from '../model/OverviewSource';
import { brushRange } from '../model/SelectionBrush';
import { PageGroup, Slide, stamp } from '../model/Timeline';
interface OverviewBounds { left: number; top: number; right: number; bottom: number }
@Component
export struct SlideOverview {
  @Prop multiSelect: boolean = false;
  @Prop chosenIds: string[] = [];
  onToggle: (id: string) => void = () => {};
  onChoose: (ids: string[]) => void = () => {};
  @Prop @Watch('groupsChanged') groups: PageGroup[] = [];
  @Prop @Watch('indexSlides') slides: Slide[] = [];
  @Prop imageUris: Record<string, string> = {};
  @Prop mergeDuplicates: boolean = true;
  onMerge: () => void = () => {};
  @Prop skipEmpty: boolean = false;
  @Prop skipModes: boolean = false;
  @Prop selectedId: string = '';
  onSkip: () => void = () => {};
  onClose: () => void = () => {};
  onSelect: (slide: Slide) => void = () => {};
  onLoad: (slide: Slide) => void = () => {};
  @State columns: number = 4;
  @State panelWidth: number = 900;
  private source: OverviewSource = new OverviewSource();
  private groupsChanged(): void { const ids = new Set(this.groups.map((group: PageGroup) => group.slide.id)); this.itemBounds.forEach((_box: OverviewBounds, id: string) => { if (!ids.has(id)) this.itemBounds.delete(id); }); if (this.anchor >= this.groups.length) this.end(); this.source.replace(this.groups); }
  private slideIndexes: Map<string, number> = new Map();
  @State selectionMode: boolean = false;
  @State pinching: boolean = false;
  aboutToAppear(): void { this.indexSlides(); this.groupsChanged(); }
  private indexSlides(): void { this.slideIndexes.clear(); this.slides.forEach((slide: Slide, i: number) => this.slideIndexes.set(slide.id, i + 1)); }
  private zoomAt: number = 0;
  private pinchStart: number = 3;
  @State brushing: boolean = false;
  private anchor: number = -1;
  private initialIds: string[] = [];
  private adding: boolean = true;
  private suppressedUntil: number = 0;
  private itemBounds: Map<string, OverviewBounds> = new Map();
  private scroller: Scroller = new Scroller();
  private gridBounds: OverviewBounds = { left: 0, top: 0, right: 0, bottom: 0 };
  @State scrollOffset: number = 0;
  @State railHeight: number = 500;
  private railTop: number = 0;
  private railHeld: boolean = false;
  private railGrab: number = 0;
  private blankScroll: boolean = false;
  private blankStartY: number = 0;
  private blankOffset: number = 0;
  private bounds(area: Area): OverviewBounds { const left = Number(area.globalPosition.x), top = Number(area.globalPosition.y); return { left, top, right: left + Number(area.width), bottom: top + Number(area.height) }; }
  private begin(id: string): void {
    if (!this.multiSelect || !this.selectionMode || this.brushing) return;
    this.blankScroll = false; this.anchor = this.groups.findIndex((group: PageGroup) => group.slide.id === id); this.initialIds = this.chosenIds.slice(); this.adding = !this.initialIds.includes(id); this.brushing = true;
    this.onChoose(brushRange(this.groups.map((group: PageGroup) => group.slide.id), this.initialIds, this.anchor, this.anchor, this.adding));
  }
  private move(x: number, y: number): void {
    if (!this.brushing) return;
    const index = this.groups.findIndex((group: PageGroup) => { const box = this.itemBounds.get(group.slide.id); return !!box && x >= box.left && x <= box.right && y >= box.top && y <= box.bottom; });
    if (index >= 0) { const ids = brushRange(this.groups.map((group: PageGroup) => group.slide.id), this.initialIds, this.anchor, index, this.adding); if (ids.join('|') !== this.chosenIds.join('|')) this.onChoose(ids); }

  }
  private end(): void { if (this.brushing) { this.brushing = false; this.suppressedUntil = Date.now() + 300; } }
  private blankBegin(x: number, y: number): void { if (!this.selectionMode || this.brushing) return; const inside = Array.from(this.itemBounds.values()).some((box: OverviewBounds) => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom); this.blankScroll = !inside; this.blankStartY = y; this.blankOffset = this.scroller.currentOffset().yOffset; }
  private blankMove(y: number): void { this.scrollOffset = Math.max(0, Math.min(this.scrollExtent(), this.blankOffset + this.blankStartY - y)); this.scroller.scrollTo({ xOffset: 0, yOffset: this.scrollOffset, animation: false }); }
  private touch(event: TouchEvent): void {
    if (event.touches.length > 1) { this.suppressedUntil = Date.now() + 350; this.pinching = true; this.end(); return; }
    if (event.type === TouchType.Up || event.type === TouchType.Cancel) this.pinching = false;
    if (!this.multiSelect || !this.selectionMode) return;
    const point = event.changedTouches[0] || event.touches[0];
    if (event.type === TouchType.Down && point) this.blankBegin(point.windowX, point.windowY);
    if (event.type === TouchType.Move && point) { if (this.blankScroll) this.blankMove(point.windowY); else this.move(point.windowX, point.windowY); }
    if (event.type === TouchType.Up || event.type === TouchType.Cancel) { this.blankScroll = false; this.end(); }
  }

  private scrollExtent(): number { const width = Math.max(1, this.gridBounds.right - this.gridBounds.left), cell = Math.max(20, (width - 10 * (this.columns - 1)) / this.columns - 14) * 9 / 16 + 36; return Math.max(0, Math.ceil(this.groups.length / this.columns) * (cell + 10) - 10 - this.railHeight); }
  private thumbHeight(): number { return Math.max(44, Math.min(88, this.railHeight)); }
  private thumbTop(): number { return Math.max(0, Math.min(1, this.scrollOffset / Math.max(1, this.scrollExtent()))) * (this.railHeight - this.thumbHeight()); }
  private railStart(y: number): void { this.end(); this.railHeld = true; const relative = y - this.railTop; this.railGrab = relative >= this.thumbTop() && relative <= this.thumbTop() + this.thumbHeight() ? relative - this.thumbTop() : this.thumbHeight() / 2; this.railMove(y); }
  private railMove(y: number): void { if (!this.railHeld) return; const ratio = Math.max(0, Math.min(1, (y - this.railTop - this.railGrab) / Math.max(1, this.railHeight - this.thumbHeight()))); const offset = ratio * this.scrollExtent(); this.scrollOffset = offset; this.scroller.scrollTo({ xOffset: 0, yOffset: offset, animation: false }); }
  private columnTemplate(): string { const values: string[] = []; for (let i = 0; i < this.columns; i++) values.push('1fr'); return values.join(' '); }
  private zoom(scale: number): void { const next = Math.max(1, Math.min(8, Math.round(this.pinchStart / Math.max(0.3, scale)))); if (next !== this.columns && Date.now() - this.zoomAt > 140) { this.zoomAt = Date.now(); this.columns = next; } }
  build() {
    Column({ space: 10 }) {
      Row({ space: 8 }) {
        Text(this.multiSelect ? '选择问答课件' : '课件概览').fontSize(16).layoutWeight(1).maxLines(1).fontWeight(FontWeight.Medium).fontColor('#20344D')
        Scroll() { Row({ space: 6 }) { Button(this.mergeDuplicates ? '✓ 合并重复课件' : '合并重复课件').height(30).fontSize(11).backgroundColor(this.mergeDuplicates ? '#DDEEFF' : '#EAF4FF').fontColor('#168BEE').onClick(() => this.onMerge()); Button((this.skipEmpty ? '✓ 跳过无转写' : '跳过无转写') + (this.skipModes ? ' ▾' : '')).height(30).fontSize(11).backgroundColor(this.skipEmpty ? '#DDEEFF' : '#EAF4FF').fontColor('#168BEE').onClick(() => this.onSkip()) } }.constraintSize({ maxWidth: this.panelWidth > 600 ? 290 : 130 }).height(32).scrollable(ScrollDirection.Horizontal).scrollBar(BarState.Off)
        if (this.multiSelect) { Button(this.selectionMode ? '✓ 选择' : '选择').height(30).fontSize(12).backgroundColor(this.selectionMode ? '#DDEEFF' : '#EAF4FF').fontColor('#168BEE').onClick(() => { this.end(); this.selectionMode = !this.selectionMode; if (!this.selectionMode) this.onChoose([]); }) }
        Button('完成').height(30).fontSize(12).backgroundColor('#168BEE').fontColor('#FFFFFF').onClick(() => this.onClose())
      }.width('100%')
      Row({ space: 12 }) {
      Grid(this.scroller) {
        LazyForEach(this.source, (group: PageGroup) => {
          GridItem() {
            Column({ space: 4 }) {
              if (this.imageUris[group.slide.id]) { Image(this.imageUris[group.slide.id]).sourceSize({ width: 480, height: 270 }).draggable(false).width('100%').aspectRatio(16 / 9).objectFit(ImageFit.Contain) }
              else { Column() { LoadingProgress().width(24).height(24).color('#168BEE') }.width('100%').aspectRatio(16 / 9).justifyContent(FlexAlign.Center) }
              Row() {
                Text((this.multiSelect && this.chosenIds.includes(group.slide.id) ? '✓ ' : '') + String(this.slideIndexes.get(group.slide.id) || 1)).fontSize(11).fontColor('#425F7D')
                Blank()
                Text(stamp(group.slide.t)).fontSize(10).fontColor('#8A9CB0')
              }.width('100%').height(18).padding({ top: 4, left: 4, right: 4 })
            }.width('100%').padding(6).backgroundColor('#FFFFFF').borderRadius(8).border({ width: (this.multiSelect ? this.chosenIds.includes(group.slide.id) : group.slide.id === this.selectedId) ? 2 : 1, color: (this.multiSelect ? this.chosenIds.includes(group.slide.id) : group.slide.id === this.selectedId) ? '#168BEE' : '#E6EDF5' })
              .id('overview-' + group.slide.id).onAreaChange((old: Area, area: Area) => this.itemBounds.set(group.slide.id, this.bounds(area)))
              .onTouch((event: TouchEvent) => { if (event.type === TouchType.Down && event.touches.length === 1) this.begin(group.slide.id); })
              .onMouse((event: MouseEvent) => { if (event.action === MouseAction.Press && event.button === MouseButton.Left) this.begin(group.slide.id); })
              .onClick(() => { if (this.pinching || Date.now() < this.suppressedUntil) return; if (this.multiSelect) { if (this.selectionMode && Date.now() >= this.suppressedUntil) this.onToggle(group.slide.id); } else this.onSelect(group.slide); })
              .onVisibleAreaChange([0.1], (visible: boolean) => { if (visible) this.onLoad(group.slide); else this.itemBounds.delete(group.slide.id); })
          }
        }, (group: PageGroup) => group.slide.id)
      }.focusable(true).defaultFocus(true).cachedCount(1).columnsTemplate(this.columnTemplate()).columnsGap(10).rowsGap(10).layoutWeight(1).height('100%').scrollBar(BarState.Off).enableScrollInteraction(!this.selectionMode && !this.pinching)
        .onAreaChange((old: Area, area: Area) => this.gridBounds = this.bounds(area))
        .onScroll((offset: number, state: ScrollState) => { if (!this.railHeld) this.scrollOffset = this.scroller.currentOffset().yOffset; })
        .onTouch((event: TouchEvent) => this.touch(event))
        .onMouse((event: MouseEvent) => { if (event.action === MouseAction.Press && event.button === MouseButton.Left) this.blankBegin(event.windowX, event.windowY); else if (event.action === MouseAction.Move) { if (this.blankScroll) this.blankMove(event.windowY); else this.move(event.windowX, event.windowY); } else if (event.action === MouseAction.Release) { this.blankScroll = false; this.end(); } })
        .onGestureJudgeBegin((info: GestureInfo, event: BaseGestureEvent) => { if (info.type === GestureControl.GestureType.PINCH_GESTURE && this.selectionMode || info.type === GestureControl.GestureType.PAN_GESTURE && (this.selectionMode || event.fingerList.filter((finger: FingerInfo) => !!finger).length >= 2)) return GestureJudgeResult.REJECT; return GestureJudgeResult.CONTINUE; })
        .priorityGesture(PinchGesture().onActionStart(() => { this.pinching = true; this.pinchStart = this.columns; }).onActionUpdate((event: GestureEvent) => { if (!this.selectionMode) this.zoom(event.scale); }).onActionEnd((event: GestureEvent) => { this.zoomAt = 0; if (!this.selectionMode) this.zoom(event.scale); this.pinching = false; }).onActionCancel(() => this.pinching = false))
        .onAxisEvent((event: AxisEvent) => { if (!this.selectionMode && event.getModifierKeyState?.(['Ctrl'])) this.columns = Math.max(1, Math.min(8, this.columns + (event.getVerticalAxisValue() > 0 ? -1 : 1))); })
      Stack({ alignContent: Alignment.TopStart }) { Column().width(18).height(this.thumbHeight()).backgroundColor('#8FBCE5').borderRadius(9).position({ x: 3, y: this.thumbTop() }) }.id('overview-selection-scrollbar').width(24).height('100%').margin({ left: 4, right: 4 }).backgroundColor('#E5EDF5').borderRadius(12)
          .onAreaChange((old: Area, area: Area) => { this.railHeight = Number(area.height); this.railTop = Number(area.globalPosition.y); })
          .onTouch((event: TouchEvent) => { const point = event.changedTouches[0] || event.touches[0]; if (event.type === TouchType.Down && point) this.railStart(point.windowY); else if (event.type === TouchType.Move && point) this.railMove(point.windowY); else if (event.type === TouchType.Up || event.type === TouchType.Cancel) this.railHeld = false; })
          .onMouse((event: MouseEvent) => { if (event.action === MouseAction.Press && event.button === MouseButton.Left) this.railStart(event.windowY); else if (event.action === MouseAction.Move) this.railMove(event.windowY); else if (event.action === MouseAction.Release) this.railHeld = false; })
      }.layoutWeight(1).width('100%')
    }.onMouse((event: MouseEvent) => { if (event.action === MouseAction.Release) this.end(); }).id('slide-overview-content').padding(16).width('100%').height('100%').onAreaChange((oldArea: Area, area: Area) => { if (Math.abs(this.panelWidth - Number(area.width)) > 100) { this.panelWidth = Number(area.width); this.columns = Math.max(1, Math.min(6, Math.ceil(this.panelWidth / 190))); } })
  }
}
