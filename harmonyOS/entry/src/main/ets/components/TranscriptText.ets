import { MarkerPosition, spacedMarkers, readingMarker } from '../model/TranscriptMarkers';
import { SelectionKeys } from '../model/SelectionKeys';
import { pointerSelection } from '../model/PointerInput';
import { NativeSelections } from '../model/NativeSelections';
import { FrameCallback } from '@kit.ArkUI';
import { MouseTextRange } from '../model/MouseTextRange';
import { TranscriptRun, transcriptRuns, visibleTranscriptMarkers, offsetLine } from '../model/TranscriptRender';
import { pointer } from '@kit.InputKit';
import { InsertNoteAction } from './InsertNoteAction';
import { spokenLineIndex, currentSpokenLineIndex } from '../model/TranscriptPlayback';
import { NoteInsertion } from '../model/Notes';
import { deviceInfo } from '@kit.BasicServicesKit';
import { pasteboard } from '@kit.BasicServicesKit';
import { unifiedDataChannel } from '@kit.ArkData';
import { text } from '@kit.ArkGraphics2D';
import { Transcript, stamp, plainTranscript } from '../model/Timeline';

class CopyModifier implements AttributeModifier<TextAttribute> {
  copied: (value: string) => void = () => {};
  applyNormalAttribute(attribute: TextAttribute): void {
    if (deviceInfo.apiAvailable('26.0.0')) attribute.onWillCopy((value: string): boolean => { this.copied(value); return false; });
  }
}
class TranscriptLayoutFrame extends FrameCallback {
  private completed: () => void;
  constructor(completed: () => void) { super(); this.completed = completed; }
  onFrame(_time: number): void {}
  onIdle(_time: number): void { this.completed(); }
}
interface TimeMarker { index: number; id: string; label: string; top: number; bottom: number }

@Component
export struct TranscriptText {
  @Prop @Watch('contentChanged') continuous: boolean = false;
  @Prop bottomInset: number = 0;
  @Prop locateAt: number = -1;
  @Prop @Watch('locateRequested') locateRevision: number = 0;
  @Prop @Watch('viewportChanged') trackSourceId: string = '';
  onAnchor: (at: number, sourceId: string, offset: number) => void = () => {};
  onTrackPosition: (top: number, bottom: number) => void = () => {};
  onHeld: (active: boolean) => void = () => {};
  private locateRequested(): void { this.locatePending = true; this.viewportChanged(); }
  private locatePending: boolean = true;
  onLocatePosition: (top: number) => void = () => {};
  onReadingPosition: (at: number, offset: number) => void = () => {};
  @Prop @Watch('pageChanged') pageKey: string = '';
  @Prop pageStart: number = -1;
  @Prop @Watch('contentChanged') lines: Transcript[] = [];
  @Prop @Watch('contentChanged') compact: boolean = false;
  @Prop @Watch('contentChanged') playbackColored: boolean = false;
  @Prop @Watch('contentChanged') highlightRevision: number = 0;
  private reportedHighlight: string = '';
  onHold: () => void = () => {};
  @Prop @Watch('playbackChanged') playbackAt: number = -1;
  @State activeIndex: number = -1;
  private reportedActiveId: string = '';
  onPlaybackPosition: (top: number, bottom: number) => void = () => {};
  @Prop notesOpen: boolean = false;
  @Prop @Watch('viewportChanged') visibleTop: number = 0;
  @Prop @Watch('viewportChanged') visibleHeight: number = 100000;
  @Prop @Watch('contentChanged') highlightAt: number = -1;
  @Prop @Watch('contentChanged') highlightSource: string = '';
  onHighlightPosition: (top: number) => void = () => {};
  onJump: (at: number, sourceId: string, excerpt: string) => void = () => {};
  onDragging: (active: boolean) => void = () => {};
  onSelecting: (active: boolean) => void = () => {};
  onInsert: (value: NoteInsertion) => void = () => {};
  @State markers: TimeMarker[] = [];
  @State runs: TranscriptRun[] = [];
  private offsets: number[] = [];
  private renderedText: string = '';
  private copyModifier: CopyModifier = new CopyModifier();
  private controller: TextController = new TextController();
  @State shownLines: Transcript[] = [];
  private pointerHeld: boolean = false;
  private pointerSelecting: boolean = false;
  private mouseRange: MouseTextRange = new MouseTextRange();
  private mouseTicket: number = 0;
  private selectionOwner: string = 'transcript-selection-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  private dismissSelection(): void { this.mouseTicket++; this.mouseRange.cancel(); this.holdPointer(false); this.select(0, 0, true); this.controller.setTextSelection(0, 0); }
  private downX: number = 0;
  private downY: number = 0;
  private movedUntil: number = 0;
  @State selectionVisible: boolean = false;
  @State selectionTop: number = 0;
  @State selectionLeft: number = 44;
  @State textWidth: number = 300;
  private releaseTimer: number = -1;
  private selectionStart: number = 0;
  private selectionEnd: number = 0;
  private layoutTicket: number = 0;
  private measureTimer: number = -1;
  private text(): string { return this.renderedText; }
  private lineHeight(): number { return this.compact ? 24 : 27; }
  aboutToAppear(): void { NativeSelections.bind(this.selectionOwner, () => this.dismissSelection(), 'transcript', (event: KeyEvent): boolean => this.selectionKey(event)); this.copyModifier.copied = (value: string) => this.copy(value); this.contentChanged(); this.playbackChanged(); }
  aboutToDisappear(): void { clearTimeout(this.selectionDismissTimer); this.selectionTicket++; NativeSelections.unbind(this.selectionOwner); this.layoutTicket++; this.mouseTicket++; this.mouseRange.cancel(); clearTimeout(this.measureTimer); clearTimeout(this.releaseTimer); this.onDragging(false); this.onSelecting(false); }
  private pageChanged(): void {
    this.locatePending = true; this.markers = []; this.activeIndex = -1;
    this.mouseTicket++; this.mouseRange.cancel();
    this.selectionStart = this.selectionEnd = 0; this.selectionVisible = false; this.onHeld(false); this.pointerHeld = false; this.pointerSelecting = false; this.onDragging(false); this.onSelecting(false);
    this.reportedHighlight = ''; this.reportedActiveId = '';
    try { this.controller.setTextSelection(0, 0); } catch (_) {}
    this.contentChanged();
  }
  private spokenIndex(): number { return this.continuous ? currentSpokenLineIndex(this.shownLines, this.playbackAt) : spokenLineIndex(this.shownLines, this.playbackAt, this.pageStart); }
  private playbackChanged(): void {
    if (this.pointerHeld || this.selectionEnd > this.selectionStart) return;
    const index = this.spokenIndex(); if (index !== this.activeIndex) { this.activeIndex = index; this.reportedActiveId = ''; this.updateRuns(); this.measureMarkers(); }
  }
  private reportPlayback(): void {
    const marker = this.markers.find((item: TimeMarker) => item.index === this.activeIndex);
    if (!marker || marker.id === this.reportedActiveId || this.selectionEnd > this.selectionStart) return;
    this.reportedActiveId = marker.id; this.onPlaybackPosition(marker.top, marker.bottom);
  }
  private contentChanged(): void {
    if (this.pointerHeld || this.selectionEnd > this.selectionStart) return;
    const previous = this.shownLines;
    this.shownLines = this.lines.slice();
    // Retain measured labels until the replacement layout is ready. Highlight and
    // playback updates do not temporarily remove the timestamp column.
    const retained = this.markers.filter((marker: TimeMarker) => { const line = this.shownLines[marker.index], old = previous[marker.index]; return !!line && line.id === marker.id && line.t === old?.t && line.text === old?.text; }); if (retained.length !== this.markers.length) this.markers = retained;
    this.offsets = []; let at = 0; const parts = this.shownLines.map((line: Transcript) => { this.offsets.push(at); const value = plainTranscript(line.text); at += value.length + 1; return value; }); this.renderedText = parts.join('\n');
    this.activeIndex = this.spokenIndex(); this.reportedActiveId = ''; this.updateRuns();
    clearTimeout(this.measureTimer);
    const ticket = ++this.layoutTicket; this.measureTimer = setTimeout(() => { try { this.getUIContext().postFrameCallback(new TranscriptLayoutFrame(() => { if (ticket === this.layoutTicket) this.measureMarkers(); })); } catch (_) { if (ticket === this.layoutTicket) this.measureMarkers(); } }, 32);
  }
  private viewportChanged(): void { clearTimeout(this.measureTimer); this.measureTimer = setTimeout(() => this.measureMarkers(), 32); }
  private updateRuns(): void { const indices: number[] = [], sources = new Set(this.highlightSource.split('|')); if (this.highlightAt >= 0) this.shownLines.forEach((line: Transcript, index: number) => { if ( (this.highlightSource ? sources.has(line.id) : line.t <= this.highlightAt && (index === this.shownLines.length - 1 || this.shownLines[index + 1].t > this.highlightAt))) indices.push(index); }); this.runs = transcriptRuns(this.renderedText, this.offsets, this.playbackColored ? this.activeIndex : -1, indices); }
  private measureMarkers(): void {
    try {
      const layout = this.controller.getLayoutManager();
      let indices: number[] = [];
      const highlightIndex = this.highlightAt < 0 ? -1 : this.shownLines.findIndex((line: Transcript, index: number) => this.highlighted(line, index));
      if (this.continuous && this.shownLines.length > 80) { const top = layout.getGlyphPositionAtCoordinate(0, this.getUIContext().vp2px(Math.max(0, this.visibleTop))).position, bottom = layout.getGlyphPositionAtCoordinate(this.getUIContext().vp2px(this.textWidth), this.getUIContext().vp2px(this.visibleTop + this.visibleHeight)).position; indices = visibleTranscriptMarkers(this.offsets, top, bottom, this.activeIndex, highlightIndex); } else indices = this.shownLines.map((line: Transcript, index: number) => index);
      const trackedIndex = this.trackSourceId ? this.shownLines.findIndex((line: Transcript) => line.id === this.trackSourceId) : -1;
      if (trackedIndex >= 0 && !indices.includes(trackedIndex)) indices.push(trackedIndex);
      let locateIndex = -1; if ((this.continuous || this.locateRevision > 0 && this.shownLines.some((line: Transcript) => Math.abs(line.t - this.locateAt) < 0.01)) && this.locatePending && this.locateAt >= 0 && this.shownLines.length) { locateIndex = 0; this.shownLines.forEach((line: Transcript, index: number) => { if (line.t <= this.locateAt) locateIndex = index; }); }
      if (locateIndex >= 0 && !indices.includes(locateIndex)) indices.push(locateIndex); indices.sort((a: number, b: number) => a - b);
      const positions: MarkerPosition[] = [];
      indices.forEach((index: number) => {
        const line = this.shownLines[index], start = this.offsets[index], end = start + Math.max(1, plainTranscript(line.text).length);
        const rect = layout.getRectsForRange({ start, end: Math.min(this.text().length, start + 1) }, text.RectWidthStyle.TIGHT, text.RectHeightStyle.MAX)[0]?.rect, last = layout.getRectsForRange({ start: Math.max(start, end - 1), end: Math.min(end, this.text().length) }, text.RectWidthStyle.TIGHT, text.RectHeightStyle.MAX)[0]?.rect;
        if (!rect || rect.bottom <= rect.top) return;
        const top = this.getUIContext().px2vp((rect.top + rect.bottom) / 2) - this.lineHeight() / 2;
        positions.push({ index, top, bottom: last ? this.getUIContext().px2vp(last.bottom) : top + this.lineHeight() });
      });
      const markers = spacedMarkers(positions, this.lineHeight()).map((position: MarkerPosition): TimeMarker => { const line = this.shownLines[position.index]; return { index: position.index, id: line.id, label: stamp(line.t) + (line.timing === 'received' ? '≈' : ''), top: position.top, bottom: position.bottom }; });
      if ((markers.length || !this.shownLines.length) && JSON.stringify(markers) !== JSON.stringify(this.markers)) this.markers = markers;
      const tracked = positions.find((position: MarkerPosition) => position.index === trackedIndex);
      if (tracked) this.onTrackPosition(tracked.top, tracked.bottom);
      const index = highlightIndex;
      const highlight = this.highlightRevision + ':' + this.highlightAt + ':' + this.highlightSource;
      const marker = markers.find((item: TimeMarker) => item.index === index); if (marker && this.reportedHighlight !== highlight) { this.reportedHighlight = highlight; this.onHighlightPosition(marker.top); }
      const located = markers.find((item: TimeMarker) => item.index === locateIndex);
      if (located && this.locatePending) { this.locatePending = false; this.onLocatePosition(located.top); }
      else { const reading = readingMarker(markers, this.visibleTop, this.visibleHeight); if (reading) this.onReadingPosition(this.shownLines[reading.index].t, this.visibleTop - reading.top); }
      this.reportPlayback();
    } catch (_) {}
  }
  private copy(value: string): void {
    const text = plainTranscript(value);
    if (text) pasteboard.getSystemPasteboard().setData(pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, text));
  }
  private insertSelection(start: number, end: number): void {
    if (end <= start) return;
    let offset = 0; const covered: Transcript[] = [];
    this.shownLines.forEach((line: Transcript) => { const length = plainTranscript(line.text).length; if (end > offset && start < offset + length) covered.push(line); offset += length + 1; });
    if (covered.length) this.onInsert({ kind: 'quote', value: plainTranscript(this.text().slice(start, end)), at: covered[0].t, end: covered[covered.length - 1].end, sourceId: covered.map((l: Transcript) => l.id).join('|') });
  }
  private highlighted(line: Transcript, index: number): boolean { return this.highlightAt >= 0 && (this.highlightSource ? this.highlightSource.split('|').includes(line.id) : line.t <= this.highlightAt && (index === this.shownLines.length - 1 || this.shownLines[index + 1].t > this.highlightAt)); }
  private holdPointer(active: boolean, selecting: boolean = false): void {
    NativeSelections.hold(this.selectionOwner, active); this.onHeld(active); this.pointerHeld = active; this.pointerSelecting = active && selecting; this.onDragging(this.pointerSelecting); this.onSelecting(this.pointerSelecting || this.selectionEnd > this.selectionStart); clearTimeout(this.releaseTimer);
    if (active) this.onHold();
    else this.releaseTimer = setTimeout(() => { if (!this.pointerHeld && this.selectionEnd <= this.selectionStart) { this.onSelecting(false); this.contentChanged(); } }, 48);
  }
  private selectionDismissTimer: number = -1;
  private selectionTicket: number = 0;
  private select(start: number, end: number, force: boolean = false): void {
    clearTimeout(this.selectionDismissTimer); const ticket = ++this.selectionTicket;
    if (!force && end <= start && this.selectionEnd > this.selectionStart && !this.pointerHeld) {
      this.selectionDismissTimer = setTimeout(() => { if (ticket === this.selectionTicket && !this.pointerHeld) { this.selectionStart = this.selectionEnd = 0; this.selectionVisible = false; this.onSelecting(false); this.contentChanged(); } }, 180); return;
    }
    this.selectionStart = Math.max(0, start); this.selectionEnd = Math.max(0, end);
    this.selectionVisible = end > start;
    if (end > start) try { const rects = this.controller.getLayoutManager().getRectsForRange({ start, end }, text.RectWidthStyle.TIGHT, text.RectHeightStyle.MAX); const rect = rects[rects.length - 1]?.rect; if (rect) { const top = this.getUIContext().px2vp(rect.top), below = this.getUIContext().px2vp(rect.bottom) + 6; this.selectionTop = Math.max(this.visibleTop + 4, Math.min(this.visibleTop + Math.max(4, this.visibleHeight - 38), below + 38 <= this.visibleTop + this.visibleHeight ? below : top - 40)); this.selectionLeft = Math.max(8, Math.min(this.textWidth - 120, 44 + this.getUIContext().px2vp((rect.left + rect.right) / 2) - 56)); } } catch (_) {}
    this.onSelecting(this.pointerSelecting || end > start);
    if (!this.pointerHeld && end <= start) this.contentChanged();
  }
  private selectedPoint(x: number, y: number): boolean {
    if (this.selectionEnd <= this.selectionStart) return false;
    try { const px = this.getUIContext().vp2px(x), py = this.getUIContext().vp2px(y); return this.controller.getLayoutManager().getRectsForRange({ start: this.selectionStart, end: this.selectionEnd }, text.RectWidthStyle.TIGHT, text.RectHeightStyle.MAX).some((box: text.TextBox) => px >= box.rect.left && px <= box.rect.right && py >= box.rect.top && py <= box.rect.bottom); } catch (_) { return false; }
  }
  private mouse(event: MouseEvent): void {
    try {
      const at = Math.max(0, Math.min(this.text().length, this.controller.getLayoutManager().getGlyphPositionAtCoordinate(this.getUIContext().vp2px(event.x), this.getUIContext().vp2px(event.y)).position));
      if (event.action === MouseAction.Press && event.button === MouseButton.Left) { this.mouseTicket++; this.getUIContext().getFocusController().requestFocus('transcript-text-' + this.pageKey); this.downX = event.windowX; this.downY = event.windowY; this.holdPointer(true, true); this.mouseRange.begin(at, event.windowX, event.windowY); if (!this.selectedPoint(event.x, event.y)) { this.select(0, 0, true); this.controller.setTextSelection(0, 0); } }
      else if (event.action === MouseAction.Move && this.pointerHeld) { const range = this.mouseRange.move(at, event.windowX, event.windowY); if (range) { this.movedUntil = Date.now() + 350; this.controller.setTextSelection(range.start, range.end, { menuPolicy: MenuPolicy.HIDE }); this.select(range.start, range.end); } }
      else if (event.action === MouseAction.Press && event.button === MouseButton.Right) this.movedUntil = Date.now() + 500;
      else if (event.action === MouseAction.Release && event.button === MouseButton.Left) { const range = this.mouseRange.end(), ticket = this.mouseTicket; this.holdPointer(false); if (range && range.end > range.start) setTimeout(() => { if (ticket === this.mouseTicket && !this.pointerHeld) { this.controller.setTextSelection(range.start, range.end, { menuPolicy: MenuPolicy.HIDE }); this.select(range.start, range.end); } }, 0); }
    } catch (_) { this.holdPointer(false); }
    event.stopPropagation();
  }
  private focusText(): void { NativeSelections.clearExcept('transcript'); try { this.getUIContext().getFocusController().requestFocus('transcript-text-' + this.pageKey); } catch (_) {} }
  private clicked(event: ClickEvent): void {
    this.focusText();
    if (this.selectionEnd > this.selectionStart || Date.now() < this.movedUntil) return;
    try {
      const position = this.controller.getLayoutManager().getGlyphPositionAtCoordinate(this.getUIContext().vp2px(event.x), this.getUIContext().vp2px(event.y)).position;
      const index = offsetLine(this.offsets, position), line = this.shownLines[index];
      if (line) {
        const rect = this.controller.getLayoutManager().getRectsForRange({ start: this.offsets[index], end: Math.min(this.text().length, this.offsets[index] + 1) }, text.RectWidthStyle.TIGHT, text.RectHeightStyle.MAX)[0]?.rect;
        const top = rect ? this.getUIContext().px2vp((rect.top + rect.bottom) / 2) - this.lineHeight() / 2 : this.markers.find((marker: TimeMarker) => marker.id === line.id)?.top || 0;
        this.onAnchor(line.t, line.id, this.visibleTop - top);
        this.onJump(line.t, line.id, plainTranscript(line.text));
      }
    } catch (_) {}
  }
  private selectionKey(event: KeyEvent): boolean {
    const key = SelectionKeys.command(event);
    if (key === 'a') { this.controller.setTextSelection(0, this.text().length, { menuPolicy: MenuPolicy.HIDE }); this.select(0, this.text().length); return true; }
    if (key === 'c' && this.selectionEnd > this.selectionStart) { this.copy(this.text().slice(this.selectionStart, this.selectionEnd)); return true; }
    return false;
  }
  build() {
    Stack({ alignContent: Alignment.TopStart }) {
      // One native text node makes the selection continuous across timestamp boundaries.
      Text(undefined, { controller: this.controller }) {
        ForEach(this.runs, (run: TranscriptRun) => { Span(run.value).fontColor(run.active ? '#168BEE' : '#2E4054').textBackgroundStyle({ color: run.highlight ? '#DDEEFF' : Color.Transparent }) }, (run: TranscriptRun) => run.key + ':' + run.active + ':' + run.highlight)
      }.id('transcript-text-' + this.pageKey).fontSize(this.compact ? 13 : 14).fontColor('#2E4054').lineHeight(this.lineHeight())
        .width('calc(100% - 44vp)').margin({ left: 44 }).textAlign(TextAlign.Start)
        .copyOption(CopyOptions.LocalDevice).textSelectable(TextSelectableMode.SELECTABLE_FOCUSABLE).focusable(true).focusOnTouch(true).onHover((active: boolean) => { if (active) this.getUIContext().getCursorController().setCursor(pointer.PointerStyle.TEXT_CURSOR); else this.getUIContext().getCursorController().restoreDefault(); })
        .onAreaChange(() => this.measureMarkers())
        .onClick((event: ClickEvent) => this.clicked(event))
        .onTouch((event: TouchEvent) => { const point = event.changedTouches[0] || event.touches[0]; if (event.type === TouchType.Down) { this.focusText(); this.mouseTicket++; this.downX = point?.windowX || 0; this.downY = point?.windowY || 0; this.holdPointer(true, (this.pointerSelecting || pointerSelection(event.source, event.sourceTool)) && event.touches.length <= 1); event.stopPropagation(); try { const at = this.controller.getLayoutManager().getGlyphPositionAtCoordinate(this.getUIContext().vp2px(point?.x || 0), this.getUIContext().vp2px(point?.y || 0)).position; this.mouseRange.begin(at, this.downX, this.downY); if (this.selectionEnd > this.selectionStart && point && !this.selectedPoint(point.x, point.y)) { this.select(0, 0, true); this.controller.setTextSelection(0, 0); } } catch (_) {} } else if (event.type === TouchType.Move && point) { if (Math.hypot(point.windowX - this.downX, point.windowY - this.downY) > 8 || event.touches.length > 1) this.movedUntil = Date.now() + 350; if (this.pointerHeld && this.pointerSelecting && event.touches.length <= 1) event.stopPropagation(); if (this.pointerHeld && this.pointerSelecting && event.touches.length <= 1) try { const at = this.controller.getLayoutManager().getGlyphPositionAtCoordinate(this.getUIContext().vp2px(point.x), this.getUIContext().vp2px(point.y)).position, range = this.mouseRange.move(at, point.windowX, point.windowY); if (range) { this.controller.setTextSelection(range.start, range.end, { menuPolicy: MenuPolicy.HIDE }); this.select(range.start, range.end); } } catch (_) {} } else if (event.type === TouchType.Up || event.type === TouchType.Cancel) { const range = event.type === TouchType.Up ? this.mouseRange.end() : undefined, ticket = this.mouseTicket; this.holdPointer(false); if (range && range.end > range.start) setTimeout(() => { if (ticket === this.mouseTicket && !this.pointerHeld) { this.controller.setTextSelection(range.start, range.end, { menuPolicy: MenuPolicy.HIDE }); this.select(range.start, range.end); } }, 0); } })
        .onMouse((event: MouseEvent) => this.mouse(event))
        .onTextSelectionChange((start: number, end: number) => this.select(start, end))
        .attributeModifier(this.copyModifier)
        .editMenuOptions({ onCreateMenu: (items: TextMenuItem[]): TextMenuItem[] => this.notesOpen ? items.concat([{ content: '插入到笔记', id: TextMenuItemId.of('insert-note') }]) : items, onMenuItemClick: (item: TextMenuItem, range: TextRange): boolean => { if (item.id.equals(TextMenuItemId.of('insert-note'))) { this.insertSelection(range.start, range.end); return true; } if (item.id.equals(TextMenuItemId.COPY)) { this.copy(this.text().slice(range.start, range.end)); return true; } return false; } })
        .onKeyPreIme((event: KeyEvent): boolean => this.selectionKey(event))
        .onKeyEvent((event: KeyEvent): boolean => this.selectionKey(event))
        .onDragStart((event: DragEvent) => {
          if (this.selectionEnd <= this.selectionStart) return;
          const record = new unifiedDataChannel.PlainText(); record.textContent = plainTranscript(this.text().slice(this.selectionStart, this.selectionEnd));
          event.setData(new unifiedDataChannel.UnifiedData(record));
        })
      if (this.notesOpen && this.selectionVisible && this.selectionEnd > this.selectionStart) {
        InsertNoteAction({ onInsert: () => { this.insertSelection(this.selectionStart, this.selectionEnd); this.select(0, 0, true); this.controller.setTextSelection(0, 0); } }).id('insert-transcript-note').width(112).position({ x: this.selectionLeft, y: this.selectionTop })
      }
      ForEach(this.markers, (marker: TimeMarker) => {
        Text(marker.label).fontSize(10).fontColor('#889AAF').width(36).height(this.lineHeight()).textAlign(TextAlign.Start)
          .position({ x: 0, y: marker.top }).hitTestBehavior(HitTestMode.None)
      }, (marker: TimeMarker) => marker.id)
    }.width('100%').onAreaChange((oldArea: Area, area: Area) => this.textWidth = Number(area.width)).padding({ bottom: this.bottomInset + (this.notesOpen && this.selectionVisible ? 40 : 0) })
  }
}
