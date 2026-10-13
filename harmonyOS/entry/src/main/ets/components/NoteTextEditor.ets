import { SelectionKeys } from '../model/SelectionKeys';
import { pasteboard } from '@kit.BasicServicesKit';
import { pointerSelection } from '../model/PointerInput';
import { NativeSelections } from '../model/NativeSelections';
import { MouseTextRange } from '../model/MouseTextRange';
import { pointer } from '@kit.InputKit';
import { KeyCode } from '@kit.InputKit';
import { text, common2D } from '@kit.ArkGraphics2D';
import { NoteAtom } from '../model/Notes';
import { NoteBlock, NoteEditingController, blockText } from '../model/NoteBlocks';
import { physicalDigit } from '../model/KeyboardInput';
import { cursorStep } from '../model/NoteCursor';
@Component
export struct NoteTextEditor {
  @Prop block: NoteBlock = { id: '', source: 'notes', at: 0, end: 0, sourceId: '', atoms: [] };
  @Prop @Watch('sync') revision: number = 0;
  editing: NoteEditingController = new NoteEditingController();
  @Prop @Watch('selectRequested') selectionRequest: number = 0;
  onSelectAll: (already: boolean) => boolean = () => false;
  onCopyAll: () => boolean = () => false;
  private selectRequested(): void { if (this.selectionRequest <= 0) this.emptyCopyMenu = false; if (!this.ready || !this.focused) return; this.editor.setCaretOffset(Math.max(0, Math.min(this.caret, this.plain().length)));  }
  onFormat: (which: string) => void = () => {};
  onChange: (atoms: NoteAtom[]) => void = () => {};
  onPointer: () => void = () => {};
  onCaret: (offset: number) => void = () => {};
  onEditingFocus: (focused: boolean) => void = () => {};
  onBreak: (atoms: NoteAtom[], offset: number) => void = () => {};
  onMultiline: (atoms: NoteAtom[], offset: number) => void = () => {};
  onDragging: (active: boolean) => void = () => {};
  onBoundary: (direction: number) => void = () => {};
  onMedia: (value: RichEditorChangeValue) => void = () => {};
  @State editorHeight: number = 32;
  @State empty: boolean = true;
  private editor: RichEditorController = new RichEditorController();
  private ready: boolean = false;
  private changing: boolean = false;
  private focused: boolean = false;
  private caret: number = 0;
  private rendered: string = '';
  private verticalX: number = -1;
  private shiftAnchor: number = -1;
  private lastKeyAt: number = 0;
  private mouseRange: MouseTextRange = new MouseTextRange();
  private mouseTicket: number = 0;
  private pointerSelecting: boolean = false;
  private pointerActive: boolean = false;
  private stableUntil: number = 0;
  private measureTimer: number = -1;
  private caretTimer: number = -1;
  private focusTicket: number = 0;
  private bold: boolean = false;
  private italic: boolean = false;
  private underline: boolean = false;
  private strike: boolean = false;
  private alignment: string = 'left';
  private selectionOwner: string = 'note-selection-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  private dismissSelection(): void { this.emptyCopyMenu = false; this.mouseTicket++; this.mouseRange.cancel(); this.pointer(false); if (this.ready && this.focused) { this.remember(); const range = this.editor.getSelection().selection; if (range[1] > range[0]) this.editor.setCaretOffset(this.caret); } }
  aboutToAppear(): void {
    NativeSelections.bind(this.selectionOwner, () => this.dismissSelection(), 'notes');
    this.editing.bind(this.block.id, { caret: () => { this.remember(); return this.caret; }, focus: (at: number) => this.focus(at), format: (b: boolean, i: boolean, u: boolean, s: boolean) => this.format(b, i, u, s), align: (value: string) => this.alignParagraph(value) });
  }
  aboutToDisappear(): void { this.onDragging(false); this.pointerSelecting = false; this.mouseRange.cancel(); NativeSelections.unbind(this.selectionOwner); this.mouseTicket++; this.mouseRange.cancel(); this.ready = false; this.focused = false; this.onEditingFocus(false); clearTimeout(this.measureTimer); clearTimeout(this.caretTimer); this.focusTicket++; this.editing.unbind(this.block.id); }
  private style(atom?: NoteAtom): RichEditorTextStyle { return { fontSize: 14, fontColor: '#20344D', lineHeight: 24, fontWeight: (atom?.bold ?? this.bold) ? FontWeight.Bold : FontWeight.Normal, fontStyle: (atom?.italic ?? this.italic) ? FontStyle.Italic : FontStyle.Normal, decoration: { type: (atom?.strikethrough ?? this.strike) ? TextDecorationType.LineThrough : (atom?.underline ?? this.underline) ? TextDecorationType.Underline : TextDecorationType.None } }; }
  private paragraph(value: string = this.alignment): RichEditorParagraphStyle { return { textAlign: value === 'center' ? TextAlign.Center : value === 'right' ? TextAlign.End : TextAlign.Start, textVerticalAlign: TextVerticalAlign.BASELINE }; }
  private plain(): string { return this.editor.getSpans().map((span: RichEditorSpan) => (span as RichEditorTextSpanResult).value || '').join(''); }
  private sync(): void {
    if (!this.ready || blockText(this.block) === this.rendered) return;
    this.changing = true; this.editor.deleteSpans(); let offset = 0;
    this.block.atoms.forEach((atom: NoteAtom) => { this.editor.addTextSpan(atom.value, { offset, style: this.style(atom), paragraphStyle: this.paragraph(atom.paragraphAlign || 'left') }); offset += atom.value.length; });
    this.rendered = this.plain(); this.empty = !this.rendered; this.caret = Math.min(this.caret, offset); this.editor.setCaretOffset(this.caret); this.changing = false; this.measure();
  }
  private snapshot(): NoteAtom[] {
    return this.editor.getSpans().map((span: RichEditorSpan): NoteAtom => {
      const result = span as RichEditorTextSpanResult;
      return { id: this.block.id + '-' + result.spanPosition.spanRange[0], kind: 'text', value: result.value, at: this.block.at, end: this.block.at, sourceId: '', bold: result.textStyle.fontWeight >= 600, italic: result.textStyle.fontStyle === FontStyle.Italic, underline: result.textStyle.decoration.type === TextDecorationType.Underline, strikethrough: result.textStyle.decoration.type === TextDecorationType.LineThrough, paragraphAlign: result.paragraphStyle?.textAlign === TextAlign.Center ? 'center' : result.paragraphStyle?.textAlign === TextAlign.End ? 'right' : 'left' };
    });
  }
  private emit(offset: number = -1): void {
    if (!this.ready || this.changing || this.editor.getPreviewText()?.value) return;
    const previous = this.rendered; this.rendered = this.plain(); if (previous !== this.rendered) this.selectAllPressed = false; this.empty = !this.rendered; if (offset >= 0) { this.caret = Math.max(0, Math.min(this.rendered.length, offset)); this.onCaret(this.caret); this.stableUntil = Date.now() + 40; } else this.remember(); this.scheduleMeasure();
    if (this.rendered.includes('\n')) this.onMultiline(this.snapshot(), this.caret);
    else this.onChange(this.snapshot());
  }
  private scheduleMeasure(): void { clearTimeout(this.measureTimer); this.measureTimer = setTimeout(() => this.measure(), 32); }
  private measure(): void {
    try { const value = this.plain(), rect = value.length ? this.editor.getLayoutManager().getRectsForRange({ start: value.length - 1, end: value.length }, text.RectWidthStyle.TIGHT, text.RectHeightStyle.MAX)[0]?.rect : undefined; this.editorHeight = rect ? Math.max(32, this.getUIContext().px2vp(rect.bottom) + 8) : 32; } catch (_) {}
  }
  private remember(): void { if (!this.ready || !this.focused || this.changing) return; const offset = this.editor.getCaretOffset(); if (offset >= 0) { this.caret = Math.min(this.plain().length, offset); this.onCaret(this.caret); } }
  private focus(at: number): void { const ticket = ++this.focusTicket; setTimeout(() => { if (ticket !== this.focusTicket || !this.ready) return; this.getUIContext().getFocusController().requestFocus('note-edit-' + this.block.id); this.caret = Math.max(0, Math.min(this.plain().length, at)); this.editor.setCaretOffset(this.caret); this.onCaret(this.caret); }, 16); }
  @State emptyCopyMenu: boolean = false;
  private selectionMenu(): void { if (this.selectionRequest > 0 && this.ready) setTimeout(() => { if (this.ready && this.selectionRequest > 0) { this.emptyCopyMenu = true; } }, 16); }
  private selectAllPressed: boolean = false;
  private pointer(down: boolean): void { NativeSelections.hold(this.selectionOwner, down); this.pointerActive = down; if (down) { this.selectAllPressed = false; this.stableUntil = 0; this.focusTicket++; this.onPointer(); } this.verticalX = -1; this.shiftAnchor = -1; if (!down) { this.pointerSelecting = false; this.onDragging(false); setTimeout(() => this.remember(), 16); } }
  private mouse(event: MouseEvent): void {
        if (!this.ready) return;
    try {
      const at = Math.max(0, Math.min(this.plain().length, this.editor.getLayoutManager().getGlyphPositionAtCoordinate(this.getUIContext().vp2px(event.x), this.getUIContext().vp2px(event.y)).position));
      if (event.action === MouseAction.Press && event.button === MouseButton.Left) { this.mouseTicket++; this.pointerSelecting = true; this.onDragging(true); this.pointer(true); this.mouseRange.begin(at, event.windowX, event.windowY); }
      else if (event.action === MouseAction.Move && this.pointerActive) { const range = this.mouseRange.move(at, event.windowX, event.windowY); if (range) this.editor.setSelection(range.start, range.end, { menuPolicy: MenuPolicy.HIDE }); }
      else if (event.action === MouseAction.Release && event.button === MouseButton.Left) { const range = this.mouseRange.end(), ticket = this.mouseTicket; this.pointer(false); if (range && range.end > range.start) setTimeout(() => { if (ticket === this.mouseTicket && this.ready && !this.pointerActive) this.editor.setSelection(range.start, range.end, { menuPolicy: MenuPolicy.HIDE }); }, 0); }
    } catch (_) { this.pointer(false); }
    event.stopPropagation();
  }
  private format(b: boolean, i: boolean, u: boolean, s: boolean): void { this.bold = b; this.italic = i; this.underline = u; this.strike = s; const range = this.editor.getSelection().selection, style = this.style(); if (range[1] > range[0]) this.editor.updateSpanStyle({ start: range[0], end: range[1], textStyle: style }); this.editor.setTypingStyle(style); this.emit(); }
  private alignParagraph(value: string): void { this.alignment = value; const length = this.plain().length; if (length) this.editor.updateParagraphStyle({ start: 0, end: length, style: this.paragraph(value) }); this.editor.setTypingParagraphStyle(this.paragraph(value)); this.emit(); }
  private handleKey(event: KeyEvent): boolean {
    SelectionKeys.update(event);
    if (!this.ready || event.type !== KeyType.Down) return false;
    this.lastKeyAt = Date.now();
    if (this.editor.getPreviewText()?.value) return false;
    const control = !!event.metaKey || !!event.getModifierKeyState?.(['Ctrl']) || !!event.getModifierKeyState?.(['Alt']), shift = !!event.getModifierKeyState?.(['Shift']);
    if (event.getModifierKeyState?.(['Ctrl'])) { const key = event.keyText.toLowerCase(); if (key === 'b' || key === 'i' || key === 'u') { this.onFormat(key === 'b' ? 'bold' : key === 'i' ? 'italic' : 'underline'); return true; } if (key === 'x' && shift) { this.onFormat('strikethrough'); return true; } }
    this.remember(); const value = this.plain(), selection = this.editor.getSelection().selection;
    const shortcut = SelectionKeys.command(event);
    if (shortcut === 'a') { const all = this.selectAllPressed || selection[0] === 0 && selection[1] === value.length && value.length > 0; this.selectAllPressed = true; if (!this.onSelectAll(all)) this.editor.setSelection(0, value.length, { menuPolicy: MenuPolicy.HIDE }); return true; }
    if (shortcut === 'c') { if (this.onCopyAll()) return true; if (selection[1] > selection[0]) pasteboard.getSystemPasteboard().setData(pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, value.slice(selection[0], selection[1]))).catch(() => {}); return true; }
    if (shortcut === 'v') { this.pasteText(); return true; }

    // Enter must reach the IME first: it may commit an English candidate rather than insert a line.
    // Only the native editor's committed newline in emit() creates the next note block.
    if (event.keyCode === KeyCode.KEYCODE_ENTER || event.keyCode === KeyCode.KEYCODE_NUMPAD_ENTER) return false;
    const digit = physicalDigit(event.keyCode, control || shift || !!event.metaKey || !!event.getModifierKeyState?.(['Alt']), event.keyText);
    if (digit) { const selected = selection[1] > selection[0], start = selected ? selection[0] : this.caret, end = selected ? selection[1] : start; this.changing = true; if (end > start) this.editor.deleteSpans({ start, end }); this.editor.addTextSpan(digit, { offset: start, style: this.style(), paragraphStyle: this.paragraph() }); this.caret = start + 1; this.editor.setCaretOffset(this.caret); this.changing = false; this.emit(); return true; }
    const left = event.keyCode === KeyCode.KEYCODE_DPAD_LEFT, right = event.keyCode === KeyCode.KEYCODE_DPAD_RIGHT, up = event.keyCode === KeyCode.KEYCODE_DPAD_UP, down = event.keyCode === KeyCode.KEYCODE_DPAD_DOWN;
    if (left || right || up || down) this.selectAllPressed = false;
    if (control || !(left || right || up || down)) { setTimeout(() => this.remember(), 16); return false; }
    if (!shift && (left && this.caret === 0 || right && this.caret === value.length)) { this.onBoundary(left ? -1 : 1); return true; }
    if (left || right) {
      this.verticalX = -1;
      const next = Math.max(0, Math.min(value.length, !shift && selection[1] > selection[0] ? (left ? selection[0] : selection[1]) : cursorStep(value, this.caret, right)));
      if (shift) { if (this.shiftAnchor < 0) this.shiftAnchor = this.caret; this.editor.setSelection(Math.min(this.shiftAnchor, next), Math.max(this.shiftAnchor, next)); }
      else { this.shiftAnchor = -1; this.editor.setCaretOffset(next); }
      this.caret = next; this.onCaret(next); return true;
    }
    // Both the line boxes and hit-test coordinates come from the same native layout.
    // Using the character rectangles avoids mixing caret vp and glyph px units.
    try {
      const layout = this.editor.getLayoutManager();
      if (!value.length) { this.onBoundary(down ? 1 : -1); return true; }
      const reference = Math.min(this.caret, value.length - 1);
      const rect = layout.getRectsForRange({ start: reference, end: reference + 1 }, text.RectWidthStyle.TIGHT, text.RectHeightStyle.MAX)[0]?.rect;
      const boxes = layout.getRectsForRange({ start: 0, end: value.length }, text.RectWidthStyle.TIGHT, text.RectHeightStyle.MAX).map((box: text.TextBox) => box.rect).sort((a: common2D.Rect, b: common2D.Rect) => a.top - b.top);
      const rows: common2D.Rect[] = [];
      boxes.forEach((box: common2D.Rect) => { if (!rows.some((row: common2D.Rect) => Math.abs((row.top + row.bottom) / 2 - (box.top + box.bottom) / 2) < 1)) rows.push(box); });
      if (rect && rows.length) {
        if (this.verticalX < 0) this.verticalX = this.caret < value.length ? rect.left : rect.right;
        const y = (rect.top + rect.bottom) / 2;
        let row = 0, distance = Number.POSITIVE_INFINITY;
        rows.forEach((item: common2D.Rect, i: number) => { const delta = Math.abs((item.top + item.bottom) / 2 - y); if (delta < distance) { row = i; distance = delta; } });
        const target = row + (down ? 1 : -1);
        if (target < 0 || target >= rows.length) { if (!shift) this.onBoundary(down ? 1 : -1); return true; }
        const targetRow = rows[target];
        const next = Math.max(0, Math.min(value.length, layout.getGlyphPositionAtCoordinate(this.verticalX, (targetRow.top + targetRow.bottom) / 2).position));
        if (shift) { if (this.shiftAnchor < 0) this.shiftAnchor = this.caret; this.editor.setSelection(Math.min(this.shiftAnchor, next), Math.max(this.shiftAnchor, next)); }
        else { this.shiftAnchor = -1; this.editor.setCaretOffset(next); }
        this.caret = next; this.onCaret(next); return true;
      }
    } catch (_) {}
    return false;
  }
  private async pasteText(): Promise<void> {
    const id = this.block.id, revision = this.rendered, ticket = this.focusTicket;
    try { const data = await pasteboard.getSystemPasteboard().getData(), value = data.getPrimaryText(); if (!value || !this.ready || !this.focused || this.block.id !== id || revision !== this.rendered || ticket !== this.focusTicket) return;
      const range = this.editor.getSelection().selection, start = range[1] > range[0] ? range[0] : this.editor.getCaretOffset(), end = range[1] > range[0] ? range[1] : start;
      this.changing = true; if (end > start) this.editor.deleteSpans({ start, end }); this.editor.addTextSpan(value, { offset: start, style: this.style(), paragraphStyle: this.paragraph() }); this.caret = start + value.length; this.editor.setCaretOffset(this.caret); this.changing = false; this.emit();
    } catch (_) { this.changing = false; }
  }
  build() {
    Stack({ alignContent: Alignment.TopStart }) {
      RichEditor({ controller: this.editor }).id('note-edit-' + this.block.id).width('100%').height(this.editorHeight).padding(0).caretColor(this.selectionRequest > 0 ? Color.Transparent : '#168BEE').backgroundColor(Color.Transparent).align(Alignment.TopStart).focusable(true).focusOnTouch(true).onHover((active: boolean) => { if (active) this.getUIContext().getCursorController().setCursor(pointer.PointerStyle.TEXT_CURSOR); else this.getUIContext().getCursorController().restoreDefault(); }).placeholder('记下笔记…', { font: { size: 14 }, fontColor: '#98A2B0' })
        .onReady(() => { this.ready = true; this.editor.setTypingStyle(this.style()); this.editor.setTypingParagraphStyle(this.paragraph()); this.rendered = '\u0000'; this.sync(); })
        .onFocus(() => { this.focused = true; this.onEditingFocus(true); this.remember(); }).onBlur(() => { this.remember(); this.focused = false; this.onEditingFocus(false); })
        .onKeyPreIme((event: KeyEvent): boolean => this.handleKey(event))
        .onTouch((event: TouchEvent) => { if (event.type === TouchType.Down) { this.mouseTicket++; this.pointerSelecting = this.pointerSelecting || pointerSelection(event.source, event.sourceTool); this.onDragging(this.pointerSelecting); this.pointer(true); event.stopPropagation(); const point = event.changedTouches[0] || event.touches[0]; if (point) try { const at = this.editor.getLayoutManager().getGlyphPositionAtCoordinate(this.getUIContext().vp2px(point.x), this.getUIContext().vp2px(point.y)).position; this.mouseRange.begin(at, point.windowX, point.windowY); } catch (_) {} } else if (event.type === TouchType.Move && this.pointerActive && this.pointerSelecting) { event.stopPropagation(); const point = event.changedTouches[0] || event.touches[0]; if (point) try { const at = this.editor.getLayoutManager().getGlyphPositionAtCoordinate(this.getUIContext().vp2px(point.x), this.getUIContext().vp2px(point.y)).position, range = this.mouseRange.move(at, point.windowX, point.windowY); if (range) this.editor.setSelection(range.start, range.end, { menuPolicy: MenuPolicy.HIDE }); } catch (_) {} } else if (event.type === TouchType.Up || event.type === TouchType.Cancel) { const range = event.type === TouchType.Up ? this.mouseRange.end() : undefined, ticket = this.mouseTicket; this.pointer(false); if (range && range.end > range.start) setTimeout(() => { if (ticket === this.mouseTicket && this.ready && !this.pointerActive) this.editor.setSelection(range.start, range.end, { menuPolicy: MenuPolicy.HIDE }); }, 0); } })
        .onMouse((event: MouseEvent) => this.mouse(event))
        .onClick(() => this.selectionMenu())
        .editMenuOptions({ onCreateMenu: (items: TextMenuItem[]): TextMenuItem[] => items, onMenuItemClick: (item: TextMenuItem, range: TextRange): boolean => item.id.equals(TextMenuItemId.COPY) && this.onCopyAll() })
        .onCopy((event: CopyEvent) => { if (this.onCopyAll()) event.preventDefault?.(); })
        .onDidChange(() => { this.emit(); clearTimeout(this.caretTimer); this.caretTimer = setTimeout(() => this.remember(), 0); })
        .onSelectionChange((range: RichEditorRange) => { if (!this.ready || !this.focused || this.changing) return; const offset = this.editor.getCaretOffset(); if (offset >= 0) { this.caret = offset; this.onCaret(offset); } })
        .onWillChange((value: RichEditorChangeValue): boolean => { if (!value.replacedImageSpans?.some((span) => !!span.valuePixelMap)) return true; this.onMedia(value); return false; })
        .onAreaChange(() => this.scheduleMeasure())
      if (this.selectionRequest > 0) { Column().id('whole-note-text-' + this.block.id).width('100%').height(this.editorHeight).backgroundColor(Color.Transparent).onTouch((event: TouchEvent) => { if (event.type === TouchType.Down) NativeSelections.hold(this.selectionOwner, true); else if (event.type === TouchType.Up || event.type === TouchType.Cancel) NativeSelections.hold(this.selectionOwner, false); event.stopPropagation(); }).onMouse((event: MouseEvent) => event.stopPropagation()).onClick(() => this.selectionMenu()) }

    }.width('100%').bindMenu(this.emptyCopyMenu, [{ value: '复制', action: () => { this.emptyCopyMenu = false; this.onCopyAll(); } }], { placement: Placement.Top, onDisappear: () => this.emptyCopyMenu = false })
  }
}
