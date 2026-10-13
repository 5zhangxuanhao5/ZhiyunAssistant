import { ReturnAction } from './ReturnAction';
import { STUDY_SURFACE, STUDY_RADIUS, STUDY_RETURN_SCROLL_SPACE } from '../model/StudyStyle';
import { PageGroup, Slide, Transcript } from '../model/Timeline';
import { NoteInsertion } from '../model/Notes';
import { TranscriptColumn } from './TranscriptColumn';
@Component
export struct TranscriptPane {
  @Prop @Watch('lessonChanged') lessonId: string = '';
  @Prop readingMode: boolean = false;
  @Prop restoreRevision: number = 0;
  @State anchorId: string = '';
  private anchorAt: number = -1;
  private anchorOffset: number = 0;
  @State departed: boolean = false;
  private restoringAnchor: boolean = false;
  private readingAt: number = -1;
  private readingOffset: number = 0;
  onRestore: (at: number, offset: number) => void = () => {};
  private lessonChanged(): void { this.anchorId = ''; this.anchorAt = -1; this.departed = false; this.restoringAnchor = false; this.readingAt = -1; }
  private anchor(at: number, sourceId: string, offset: number): void { if (!this.readingMode) return; this.anchorAt = at; this.anchorId = sourceId; this.anchorOffset = offset; this.departed = false; this.restoringAnchor = false; }
  private anchorFromReading(at: number, offset: number, lines: Transcript[] = this.lines): void {
    if (!this.readingMode || this.anchorId || at < 0 || !lines.length) return;
    let line = lines[0]; lines.forEach((item: Transcript) => { if (item.t <= at) line = item; }); this.anchor(at, line.id, offset);
  }
  private readingPosition(at: number, offset: number): void { this.readingAt = at; this.readingOffset = offset; this.onReadingPosition(at, offset); }
  private contentChanged(): void {
    if (this.readingMode && this.anchorId && !this.lines.some((line: Transcript) => line.id === this.anchorId)) this.departed = true;
  }
  private anchorVisible(visible: boolean): void { if (!this.readingMode || !this.anchorId) return; if (this.restoringAnchor && !visible) return; this.restoringAnchor = false; this.departed = !visible; }
  private browse(at: number, offset: number): void { this.anchorFromReading(at, offset); this.onBrowse(); }
  private turn(direction: number, at: number, offset: number): void { this.anchorFromReading(at, offset); this.onTurn(direction); }
  private returnToReading(): void { if (!this.readingMode) { this.onReturn(); return; } if (!this.anchorId || this.anchorAt < 0) return; this.departed = false; this.restoringAnchor = true; this.onRestore(this.anchorAt, this.anchorOffset); }
  @Prop continuous: boolean = false;
  @Prop showReturn: boolean = false;
  @Prop resumeAt: number = -1;
  @Prop resumeOffset: number = 0;
  onReadingPosition: (at: number, offset: number) => void = () => {};
  @Prop @Watch('contentChanged') lines: Transcript[] = [];
  @Prop groups: PageGroup[] = [];
  @Prop slides: Slide[] = [];
  @Prop historicalMissing: boolean = false;
  @Prop slots: number = 1;
  @Prop playbackColored: boolean = false;
  @Prop highlightRevision: number = 0;
  @Prop playbackAt: number = -1;
  @Prop following: boolean = true;
  @Prop canFollow: boolean = true;
  @Prop notesOpen: boolean = false;
  @Prop highlightAt: number = -1;
  @Prop highlightSource: string = '';
  @Prop status: string = '';
  onBrowse: () => void = () => {};
  onDragging: (active: boolean) => void = () => {};
  onSelecting: (active: boolean) => void = () => {};
  onReturn: () => void = () => {};
  onJump: (at: number, sourceId: string, excerpt: string) => void = () => {};
  onTurn: (direction: number) => void = () => {};
  onInsert: (value: NoteInsertion) => void = () => {};
  @State paneWidth: number = 300;
  private pageStatus(group: PageGroup): string { return this.historicalMissing && group.slide.id !== this.slides[this.slides.length - 1]?.id ? '平台暂未提供直播历史转写，无法补齐进入前的内容。' : this.status; }
  build() {
    Stack({ alignContent: Alignment.Bottom }) {
    Column({ space: 4 }) {
      if (!this.continuous && this.groups.length > 0 && this.slots > 1 && this.paneWidth >= 600) {
        Row({ space: 12 }) {
          ForEach(this.groups, (group: PageGroup) => {
            TranscriptColumn({ returnSpace: (this.readingMode ? this.departed : this.showReturn) ? STUDY_RETURN_SCROLL_SPACE : 0, trackSourceId: this.anchorId, restoreRevision: this.restoreRevision, resumeAt: this.resumeAt, resumeOffset: this.resumeOffset, onAnchor: (at: number, sourceId: string, offset: number) => this.anchor(at, sourceId, offset), onAnchorVisible: (visible: boolean) => this.anchorVisible(visible), onDragging: this.onDragging, onReadingPosition: (at: number, offset: number) => this.readingPosition(at, offset), pageKey: group.slide.id, pageStart: group.slide.t, highlightRevision: this.highlightRevision, playbackColored: this.playbackColored, title: '第 ' + (this.slides.findIndex((s: Slide) => s.id === group.slide.id) + 1) + ' 页转写', lines: group.lines, playbackAt: this.playbackAt, following: this.following, canFollow: this.canFollow, notesOpen: this.notesOpen, highlightAt: this.highlightAt, highlightSource: this.highlightSource, status: this.pageStatus(group), onBrowse: (at: number, offset: number) => this.browse(at, offset), onSelecting: this.onSelecting, onReturn: this.onReturn, onJump: this.onJump, onTurn: (direction: number, at: number, offset: number) => this.turn(direction, at, offset), onInsert: this.onInsert }).width((this.paneWidth - 12 * (this.slots - 1)) / this.slots).height('100%')
          }, (group: PageGroup) => group.slide.id)
          if (this.groups.length < this.slots) { Blank().layoutWeight(1) }
        }.layoutWeight(1).width('100%')
      } else {
        TranscriptColumn({ returnSpace: (this.readingMode ? this.departed : this.showReturn) ? STUDY_RETURN_SCROLL_SPACE : 0, trackSourceId: this.anchorId, restoreRevision: this.restoreRevision, resumeAt: this.resumeAt, resumeOffset: this.resumeOffset, onAnchor: (at: number, sourceId: string, offset: number) => this.anchor(at, sourceId, offset), onAnchorVisible: (visible: boolean) => this.anchorVisible(visible), onDragging: this.onDragging, onReadingPosition: (at: number, offset: number) => this.readingPosition(at, offset), continuous: this.continuous, pageKey: this.continuous ? 'continuous' : this.groups.map((group: PageGroup) => group.slide.id).join('|'), pageStart: this.groups[0]?.slide.t ?? -1, highlightRevision: this.highlightRevision, playbackColored: this.playbackColored, lines: this.lines, playbackAt: this.playbackAt, following: this.following, canFollow: this.canFollow, notesOpen: this.notesOpen, highlightAt: this.highlightAt, highlightSource: this.highlightSource, status: this.status, onBrowse: (at: number, offset: number) => this.browse(at, offset), onSelecting: this.onSelecting, onReturn: this.onReturn, onJump: this.onJump, onTurn: (direction: number, at: number, offset: number) => this.turn(direction, at, offset), onInsert: this.onInsert }).layoutWeight(1).width('100%')
      }
    }.width('100%').height('100%')
      if (this.readingMode ? this.departed : this.showReturn) { ReturnAction({ owner: 'transcript', onReturn: () => this.returnToReading() }).margin({ bottom: 8 }).zIndex(2) }
    }.width('100%').height('100%').backgroundColor(STUDY_SURFACE).borderRadius(STUDY_RADIUS).onAreaChange((oldArea: Area, area: Area) => this.paneWidth = Number(area.width))
  }
}
