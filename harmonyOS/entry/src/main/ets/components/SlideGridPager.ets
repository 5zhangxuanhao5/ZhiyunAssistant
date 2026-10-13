import { SlideSpreadSource } from '../model/SlideSpreadSource';
import { navigationGroups } from '../model/StudyNavigation';
import { slideGridLayout } from '../model/SlideGrid';
import { PageGroup, Slide } from '../model/Timeline';
import { PageCard } from './PageCard';
import { NoteInsertion } from '../model/Notes';
@Component
export struct SlideGridPager {
  @Prop @Watch('refreshSpreads') groups: PageGroup[] = [];
  @Prop slides: Slide[] = [];
  @Prop imageUris: Record<string, string> = {};
  @Prop @Watch('refreshSpreads') capacity: number = 4;
  @Prop @Watch('refreshSpreads') skipEmpty: boolean = false;
  @Prop @Watch('refreshSpreads') manual: boolean = false;
  @Link @Watch('refreshSpreads') selected: number;
  @Prop notesOpen: boolean = false;
  @Prop imageHighlightId: string = '';
  onExpand: (slide: Slide) => void = () => {};
  onJump: (at: number, id: string) => void = () => {};
  onInsert: (value: NoteInsertion) => void = () => {};
  onBrowse: () => void = () => {};
  onPosition: () => void = () => {};
  onTurn: (direction: number) => void = () => {};
  @State paneWidth: number = 1000;
  @State paneHeight: number = 700;
  @State ratio: number = 16 / 9;
  private wheelAt: number = 0;
  private pages(): PageGroup[] { return navigationGroups(this.groups, this.selected, this.skipEmpty && this.manual); }
  private pagePosition(): number { return Math.max(0, this.pages().findIndex((group: PageGroup) => group.slide.id === this.groups[this.selected]?.slide.id)); }
  private source: SlideSpreadSource = new SlideSpreadSource();
  private refreshSpreads(): void { this.source.replace(Math.ceil(this.pages().length / this.capacity), this.capacity + ':' + this.pages().map((group: PageGroup) => group.slide.id).join('|')); }
  aboutToAppear(): void { this.refreshSpreads(); }
  private columnsTemplate(count: number): string { const values: string[] = []; for (let i = 0; i < count; i++) values.push('1fr'); return values.join(' '); }
  private dimensions(): number { return slideGridLayout(this.paneWidth, this.paneHeight, this.capacity, this.ratio).columns; }
  private selectSpread(index: number): void { const slide = this.pages()[index * this.capacity]?.slide; const next = this.groups.findIndex((group: PageGroup) => group.slide.id === slide?.id); if (next >= 0 && next !== this.selected) { this.selected = next; this.onBrowse(); this.onPosition(); } }
  build() {
    Swiper() {
      LazyForEach(this.source, (spread: number) => {
        Grid() {
          ForEach(this.pages().slice(spread * this.capacity, (spread + 1) * this.capacity), (group: PageGroup) => {
            GridItem() {
              PageCard({ group, uri: this.imageUris[group.slide.id] || '', index: this.slides.findIndex((slide: Slide) => slide.id === group.slide.id), cardWidth: slideGridLayout(this.paneWidth, this.paneHeight, this.capacity, this.ratio).width, notesOpen: this.notesOpen, imageHighlightId: this.imageHighlightId, onRatio: (ratio: number) => { if (group.slide.id === this.pages()[spread * this.capacity]?.slide.id && Math.abs(this.ratio - ratio) > 0.01) this.ratio = ratio; }, onExpand: () => this.onExpand(group.slide), onJump: () => this.onJump(group.slide.t, group.slide.id), onInsert: this.onInsert }).width('100%').height('100%')
            }
          }, (group: PageGroup) => group.slide.id)
        }.columnsTemplate(this.columnsTemplate(this.dimensions())).rowsTemplate(this.columnsTemplate(Math.ceil(this.capacity / this.dimensions()))).columnsGap(12).rowsGap(12).width('100%').height('100%')
      }, (spread: number) => String(spread))
    }.width('100%').height('100%').index(Math.floor(this.pagePosition() / this.capacity)).loop(false).indicator(false).cachedCount(1).onChange((index: number) => this.selectSpread(index)).onAreaChange((oldArea: Area, area: Area) => { this.paneWidth = Number(area.width); this.paneHeight = Number(area.height); }).onAxisEvent((event: AxisEvent) => { const x = event.getHorizontalAxisValue(); if (Math.abs(x) > 0.1 && Date.now() - this.wheelAt > 220) { this.wheelAt = Date.now(); this.onTurn(x < 0 ? 1 : -1); } })
  }
}
