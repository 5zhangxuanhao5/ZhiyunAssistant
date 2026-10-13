import { SelectionKeys } from '../model/SelectionKeys';
import { pointerSelection } from '../model/PointerInput';
import { NativeSelections } from '../model/NativeSelections';
import { MouseTextRange } from '../model/MouseTextRange';
import { text } from '@kit.ArkGraphics2D';
import { pointer } from '@kit.InputKit';
import { pasteboard } from '@kit.BasicServicesKit';
import { Course, plainTranscript } from '../model/Timeline';
import { CourseAnswerPart } from '../model/CourseReference';
import { selectedAnswerParts } from '../model/NoteFormatting';
import { NoteInsertion, NoteContentReference } from '../model/Notes';
import { InsertNoteAction } from './InsertNoteAction';
@Component
export struct AnswerText {
  @Prop @Watch('partsChanged') parts: CourseAnswerPart[] = [];
  @State shownParts: CourseAnswerPart[] = [];
  aboutToAppear(): void { NativeSelections.bind(this.textId, () => this.dismissSelection(), this.selectionGroup, (event: KeyEvent): boolean => this.selectionKey(event)); this.partsChanged(); this.sourceChanged(); }
  private partsChanged(): void { if (!this.pointerHeld && this.selectedEnd <= this.selectedStart) this.shownParts = this.parts.slice(); }
  @Prop notesOpen: boolean = false;
  @Prop selectionGroup: string = '';
  @Prop selectionOffset: number = 0;
  @Prop externalSelection: boolean = false;
  @State wholeCopyMenu: boolean = false;
  private externalWhole(): boolean { return this.externalSelection && this.selectionRequest > 0; }
  @Prop @Watch('selectRequested') selectionRequest: number = 0;
  private selectRequested(): void { this.wholeCopyMenu = false; if (this.externalWhole()) { this.dismissSelection(); return; } if (this.selectionRequest > 0) { this.controller.setTextSelection(this.selectionOffset, this.text().length, { menuPolicy: MenuPolicy.HIDE }); this.selection(this.selectionOffset, this.text().length); } else this.dismissSelection(); }
  @Prop @Watch('sourceChanged') reference: NoteContentReference | undefined = undefined;
  onActivate: () => void = () => {};
  onPointer: () => void = () => {};
  onInteract: () => void = () => {};
  onDragging: (active: boolean) => void = () => {};
  onSelecting: (active: boolean) => void = () => {};
  onSelectAll: (already: boolean) => boolean = () => false;
  onCopyAll: () => boolean = () => false;
  onJump: (seconds: number, course?: Course) => void = () => {};
  onInsert: (value: NoteInsertion) => void = () => {};
  private controller: TextController = new TextController();
  @State selectedStart: number = 0;
  @State selectedEnd: number = 0;
  @State menuTop: number = 0;
  @State textHeight: number = 0;
  private selectionDismissTimer: number = -1;
  private menuTimer: number = -1;
  private selectionTicket: number = 0;
  private referenceKey: string = '';
  private sourceChanged(): void { const ref = this.reference, key = ref ? [ref.kind, ref.courseId, ref.sessionId || '', String(ref.turn ?? ''), ref.pageId || '', ref.scope || '', ref.summaryId || ''].join('|') : ''; if (key !== this.referenceKey) { NativeSelections.hold(this.textId, false); this.referenceKey = key; this.mouseTicket++; this.mouseRange.cancel(); this.pointerHeld = false; this.pointerSelecting = false; this.onDragging(false); this.pointerMoved = false; this.selectedStart = this.selectedEnd = 0; this.onSelecting(false); try { this.controller.setTextSelection(0, 0); } catch (_) {} this.partsChanged(); } }
  private textId: string = 'answer-text-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  private mouseRange: MouseTextRange = new MouseTextRange();
  private mouseTicket: number = 0;
  aboutToDisappear(): void { clearTimeout(this.menuTimer); clearTimeout(this.selectionDismissTimer); this.selectionTicket++; NativeSelections.unbind(this.textId); this.onDragging(false); this.onSelecting(false); this.mouseTicket++; this.mouseRange.cancel(); }
  private dismissSelection(): void { NativeSelections.hold(this.textId, false); this.wholeCopyMenu = false; this.mouseTicket++; this.mouseRange.cancel(); this.pointerHeld = false; this.pointerSelecting = false; this.onDragging(false); this.pointerMoved = false; this.selection(0, 0, true); this.controller.setTextSelection(0, 0); }
  private pointerHeld: boolean = false;
  private pointerSelecting: boolean = false;
  private pointerMoved: boolean = false;
  private pointerX: number = 0;
  private pointerY: number = 0;
  private text(): string { return this.shownParts.map((part: CourseAnswerPart) => part.value).join(''); }
  private insert(start: number, end: number): void { const value = this.text().slice(start, end); if (!value.trim() || !this.reference) return; this.onInsert({ formatted: selectedAnswerParts(this.shownParts, start, end), sourceText: this.text(), kind: this.reference.kind, value, at: this.reference.at, end: this.reference.at, sourceId: '', reference: this.reference }); this.selectedStart = this.selectedEnd = 0; this.onSelecting(false); this.controller.setTextSelection(0, 0); this.partsChanged(); }
  private selection(start: number, end: number, force: boolean = false): void {
    clearTimeout(this.selectionDismissTimer); const ticket = ++this.selectionTicket;
    if (!force && end <= start && this.selectedEnd > this.selectedStart && !this.pointerHeld) {
      this.selectionDismissTimer = setTimeout(() => { if (ticket === this.selectionTicket && !this.pointerHeld) { this.selectedStart = this.selectedEnd = 0; this.onSelecting(false); this.partsChanged(); } }, 180); return;
    }
    this.selectedStart = start; this.selectedEnd = end; this.onSelecting(this.pointerSelecting || end > start); if (end <= start) this.partsChanged(); try { const rect = this.controller.getLayoutManager().getRectsForRange({ start, end }, text.RectWidthStyle.TIGHT, text.RectHeightStyle.MAX)[0]?.rect; this.menuTop = rect ? Math.max(0, this.getUIContext().px2vp(rect.bottom) + 4) : 0; } catch (_) {} }
  private hover(active: boolean): void { try { if (active) this.getUIContext().getCursorController().setCursor(pointer.PointerStyle.TEXT_CURSOR); else this.getUIContext().getCursorController().restoreDefault(); } catch (_) {} }
  private insideSelection(at: number): boolean { return this.selectedEnd > this.selectedStart && at >= this.selectedStart && at <= this.selectedEnd; }
  private selectedPoint(x: number, y: number, at: number): boolean {
    if (!this.insideSelection(at)) return false;
    try { const boxes = this.controller.getLayoutManager().getRectsForRange({ start: this.selectedStart, end: this.selectedEnd }, text.RectWidthStyle.TIGHT, text.RectHeightStyle.MAX); if (!boxes.length) return this.insideSelection(at); const px = this.getUIContext().vp2px(x), py = this.getUIContext().vp2px(y); return boxes.some((box: text.TextBox) => px >= box.rect.left && px <= box.rect.right && py >= box.rect.top && py <= box.rect.bottom); } catch (_) { return this.insideSelection(at); }
  }
  private touchSelection(at: number, x: number, y: number): void { if (!this.selectedPoint(x, y, at)) { this.onPointer(); if (this.selectedEnd > this.selectedStart) { this.controller.setTextSelection(0, 0); this.selection(0, 0, true); } } }
  private showSelectionMenu(): void { clearTimeout(this.menuTimer); if (this.externalWhole()) { this.wholeCopyMenu = true; return; } const start = this.selectedStart, end = this.selectedEnd, ticket = this.mouseTicket; if (end > start) this.menuTimer = setTimeout(() => { if (!this.pointerHeld && ticket === this.mouseTicket && this.selectedEnd > this.selectedStart) this.controller.setTextSelection(start, end, { menuPolicy: MenuPolicy.SHOW }); }, 16); }
  private touch(event: TouchEvent): void {
        const point = event.changedTouches[0] || event.touches[0];
    if (event.type === TouchType.Down && point) { NativeSelections.hold(this.textId, true); this.onInteract(); NativeSelections.clearExcept(this.selectionGroup); this.mouseTicket++; this.pointerHeld = true; this.pointerSelecting = (this.pointerSelecting || pointerSelection(event.source, event.sourceTool)) && event.touches.length <= 1 && !this.externalWhole(); this.onDragging(this.pointerSelecting); if (this.pointerSelecting) this.onSelecting(true); this.pointerMoved = false; this.pointerX = point.windowX; this.pointerY = point.windowY; event.stopPropagation(); try { const at = this.controller.getLayoutManager().getGlyphPositionAtCoordinate(this.getUIContext().vp2px(point.x), this.getUIContext().vp2px(point.y)).position; this.touchSelection(at, point.x, point.y); this.mouseRange.begin(at, point.windowX, point.windowY); } catch (_) {} }
    else if (event.type === TouchType.Move && point) {
      if (Math.hypot(point.windowX - this.pointerX, point.windowY - this.pointerY) > 8) this.pointerMoved = true;
      if (!this.externalWhole() && this.pointerHeld && this.pointerSelecting && event.touches.length <= 1) { event.stopPropagation(); }
      if (!this.externalWhole() && this.pointerHeld && this.pointerSelecting && event.touches.length <= 1) try { const at = this.controller.getLayoutManager().getGlyphPositionAtCoordinate(this.getUIContext().vp2px(point.x), this.getUIContext().vp2px(point.y)).position, range = this.mouseRange.move(at, point.windowX, point.windowY); if (range) { this.pointerMoved = true; this.controller.setTextSelection(range.start, range.end, { menuPolicy: MenuPolicy.HIDE }); this.selection(range.start, range.end); } } catch (_) {}
    }
    else if (event.type === TouchType.Up || event.type === TouchType.Cancel) { NativeSelections.hold(this.textId, false); const range = event.type === TouchType.Up ? this.mouseRange.end() : undefined, ticket = this.mouseTicket; this.pointerHeld = false; this.pointerSelecting = false; this.onDragging(false); if (!this.pointerMoved && (this.externalWhole() || this.selectedEnd > this.selectedStart)) { event.stopPropagation(); this.showSelectionMenu(); return; } if (range && range.end > range.start) setTimeout(() => { if (ticket === this.mouseTicket && !this.pointerHeld) { this.controller.setTextSelection(range.start, range.end, { menuPolicy: MenuPolicy.HIDE }); this.selection(range.start, range.end); } }, 0); else { this.partsChanged(); if (this.selectedEnd <= this.selectedStart) this.onSelecting(false); } }
  }
  private mouse(event: MouseEvent): void {
        try {
      const at = Math.max(0, Math.min(this.text().length, this.controller.getLayoutManager().getGlyphPositionAtCoordinate(this.getUIContext().vp2px(event.x), this.getUIContext().vp2px(event.y)).position));
      if (event.action === MouseAction.Press && event.button === MouseButton.Left) { NativeSelections.hold(this.textId, true); this.onInteract(); NativeSelections.clearExcept(this.selectionGroup); this.touchSelection(at, event.x, event.y); this.mouseTicket++; this.pointerHeld = true; this.pointerSelecting = !this.externalWhole(); this.onDragging(this.pointerSelecting); if (this.pointerSelecting) this.onSelecting(true); this.pointerMoved = false; this.pointerX = event.windowX; this.pointerY = event.windowY; this.mouseRange.begin(at, event.windowX, event.windowY); if (this.selectedEnd <= this.selectedStart) this.selection(0, 0); }
      else if (event.action === MouseAction.Move && this.pointerHeld && !this.externalWhole()) { const range = this.mouseRange.move(at, event.windowX, event.windowY); if (range) { this.pointerMoved = true; this.controller.setTextSelection(range.start, range.end, { menuPolicy: MenuPolicy.HIDE }); this.selection(range.start, range.end); } }
      else if (event.action === MouseAction.Press && event.button === MouseButton.Right) this.pointerMoved = true;
      else if (event.action === MouseAction.Release && event.button === MouseButton.Left) { NativeSelections.hold(this.textId, false); const range = this.mouseRange.end(), ticket = this.mouseTicket; this.pointerHeld = false; this.pointerSelecting = false; this.onDragging(false); if (!this.pointerMoved && (this.externalWhole() || this.selectedEnd > this.selectedStart)) { this.showSelectionMenu(); return; } if (range && range.end > range.start) setTimeout(() => { if (ticket === this.mouseTicket && !this.pointerHeld) { this.controller.setTextSelection(range.start, range.end, { menuPolicy: MenuPolicy.HIDE }); this.selection(range.start, range.end); } }, 0); else { this.partsChanged(); if (this.selectedEnd <= this.selectedStart) this.onSelecting(false); } }
    } catch (_) { NativeSelections.hold(this.textId, false); this.pointerHeld = false; this.pointerSelecting = false; this.onDragging(false); this.onSelecting(this.selectedEnd > this.selectedStart); }
    event.stopPropagation();
  }
  private selectionKey(event: KeyEvent): boolean {
    const key = SelectionKeys.command(event);
    if (key === 'a') { if (this.externalWhole() && this.onSelectAll(true)) return true; const all = this.selectedStart === 0 && this.selectedEnd === this.text().length && this.text().length > 0; if (this.onSelectAll(all)) return true; this.controller.setTextSelection(0, this.text().length, { menuPolicy: MenuPolicy.HIDE }); this.selection(0, this.text().length); return true; }
    if (key === 'c' && this.onCopyAll()) return true;
    if (key === 'c' && this.selectedEnd > this.selectedStart) { pasteboard.getSystemPasteboard().setData(pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, plainTranscript(this.text().slice(this.selectedStart, this.selectedEnd)))).catch(() => {}); return true; }
    return false;
  }
  build() {
    Stack({ alignContent: Alignment.TopStart }) {
      Text(undefined, { controller: this.controller }) {
        ForEach(this.shownParts, (part: CourseAnswerPart) => {
          Span(part.value).fontColor(part.seconds >= 0 ? '#168BEE' : '#2E4054').fontWeight(part.bold ? FontWeight.Bold : FontWeight.Normal).fontStyle(part.italic ? FontStyle.Italic : FontStyle.Normal).fontFamily(part.code ? 'monospace' : 'sans-serif').onClick(() => { if (part.seconds >= 0 && !this.pointerMoved && this.selectedEnd <= this.selectedStart) this.onJump(part.seconds, part.course); })
        }, (part: CourseAnswerPart, index: number) => index + ':' + part.value)
      }.id(this.textId).onAreaChange((oldArea: Area, area: Area) => { const height = Number(area.height); if (height !== this.textHeight) this.textHeight = height; }).onClick(() => { if (!this.pointerMoved && (this.externalWhole() || this.selectedEnd > this.selectedStart)) this.showSelectionMenu(); else if (!this.pointerMoved) this.onActivate(); }).fontSize(14).lineHeight(24).width('100%').copyOption(CopyOptions.LocalDevice).textSelectable(this.externalWhole() ? TextSelectableMode.UNSELECTABLE : TextSelectableMode.SELECTABLE_FOCUSABLE).focusable(true).focusOnTouch(true).onHover((active: boolean) => this.hover(active))
        .onTouch((event: TouchEvent) => this.touch(event)).onMouse((event: MouseEvent) => this.mouse(event))
        .onKeyPreIme((event: KeyEvent): boolean => this.selectionKey(event))
        .onKeyEvent((event: KeyEvent): boolean => this.selectionKey(event))
        .onTextSelectionChange((start: number, end: number) => this.selection(start, end))
        .editMenuOptions({ onCreateMenu: (items: TextMenuItem[]): TextMenuItem[] => this.notesOpen ? items.concat([{ content: '插入到笔记', id: TextMenuItemId.of('insert-answer-note') }]) : items, onMenuItemClick: (item: TextMenuItem, range: TextRange): boolean => { if (item.id.equals(TextMenuItemId.of('insert-answer-note'))) { this.insert(range.start, range.end); return true; } if (item.id.equals(TextMenuItemId.COPY)) { if (this.onCopyAll()) return true; pasteboard.getSystemPasteboard().setData(pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, plainTranscript(this.text().slice(range.start, range.end)))); return true; } return false; } })
      if (this.notesOpen && this.selectedEnd > this.selectedStart) { InsertNoteAction({ onInsert: () => this.insert(this.selectedStart, this.selectedEnd) }).width(112).position({ x: 8, y: this.menuTop }) }
          if (this.externalWhole()) { Column().id('whole-answer-' + this.textId).width('100%').height(this.textHeight).backgroundColor(Color.Transparent).onTouch((event: TouchEvent) => { if (event.type === TouchType.Down) NativeSelections.hold(this.textId, true); else if (event.type === TouchType.Up || event.type === TouchType.Cancel) NativeSelections.hold(this.textId, false); event.stopPropagation(); }).onMouse((event: MouseEvent) => event.stopPropagation()).onClick(() => this.wholeCopyMenu = true) }
    }.width('100%').bindMenu(this.wholeCopyMenu, [{ value: '复制', action: () => { this.wholeCopyMenu = false; this.onCopyAll(); } }], { placement: Placement.Top, onDisappear: () => this.wholeCopyMenu = false })
  }
}
