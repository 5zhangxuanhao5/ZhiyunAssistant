import { ReturnAction } from './ReturnAction';
import { NativeSelections } from '../model/NativeSelections';
import { SelectionKeys } from '../model/SelectionKeys';
import { NoteClipboard } from '../services/NoteClipboard';
import { AnswerText } from './AnswerText';
import { referenceAtoms, noteAnswerParts } from '../model/NoteFormatting';
import { pointer } from '@kit.InputKit';
import { PhysicalInput } from '../services/PhysicalInput';
import { DropdownLabel } from './DropdownLabel';
import { Account } from '../model/Timeline';
import { STUDY_TITLE_SIZE, STUDY_TITLE_COLOR, STUDY_SURFACE, STUDY_RADIUS } from '../model/StudyStyle';
import { shanghaiDate } from '../model/Timeline';
import { NoteBlock, NotePalette, noteColors, blockTitle, blockId, defaultNotePalette, validNotePalette, emptyNoteBlock, blockText, sliceNoteAtoms, noteBlocks, insertNoteBlock, cleanNoteBlocks, updateNoteBlock, NoteEditingController } from '../model/NoteBlocks';
import { NoteTextEditor } from './NoteTextEditor';
import { CollaborationServiceFilter, CollaborationServiceStateDialog, createCollaborationServiceMenuItems } from '@kit.ServiceCollaborationKit';
import { common } from '@kit.AbilityKit';
import { photoAccessHelper } from '@kit.MediaLibraryKit';
import { camera, cameraPicker } from '@kit.CameraKit';
import { image } from '@kit.ImageKit';
import { LocalStore } from '../services/LocalStore';
import { NotesStore } from '../services/NotesStore';
import { Course, stamp, plainTranscript } from '../model/Timeline';
import { LessonNote, NoteAtom, NoteContentReference, NoteAnchor, NoteInsertion, NotesController } from '../model/Notes';
@Component
export struct NotesPane {
  @Prop returnVisible: boolean = false;
  onReturn: () => void = () => {};
  onDismissReturn: () => void = () => {};
  private renameInput: PhysicalInput = new PhysicalInput();

  @Prop @Watch('requestedNoteChanged') requestedNoteId: string = '';
  private handledRequest: string = '';
  private requestedNoteChanged(): void { if (this.requestedNoteId && this.ready && this.requestedNoteId !== this.handledRequest) { this.handledRequest = this.requestedNoteId; this.managerOpen = false; this.switchNote(this.requestedNoteId); } }
  @Prop account: Account | undefined = undefined;
  @Prop @Watch('courseChanged') course: Course | undefined = undefined;
  store: LocalStore | undefined = undefined;
  notes: NotesController = new NotesController();
  currentTime: () => number = () => 0;
  onJump: (at: number, sourceId: string, excerpt: string) => void = () => {};
  onCourseJump: (course: Course, at: number) => void = () => {};
  onEditingFocus: (focused: boolean) => void = () => {};
  onClose: () => void = () => {};
  onContentJump: (reference: NoteContentReference) => void = () => {};
  @State bold: boolean = false;
  @State italic: boolean = false;
  @State underline: boolean = false;
  @State strikethrough: boolean = false;
  @State alignment: string = 'left';
  @State editorWidth: number = 340;
  @State noteList: LessonNote[] = [];
  @State activeNoteId: string = 'default';
  @State activeNoteTitle: string = '课堂笔记';
  @State renameId: string = '';
  @State renameText: string = '';
  @State managerOpen: boolean = false;
  @State hasContent: boolean = false;
  @State message: string = '';
  @State editRevision: number = 0;
  @State blocks: NoteBlock[] = [];
  @State palette: NotePalette = defaultNotePalette();
  @State colorsOpen: boolean = false;
  @State imageRatios: Record<string, number> = {};
  private activeBlockId: string = '';
  private blockCaret: number = 0;
  private editing: NoteEditingController = new NoteEditingController();
  private repository: NotesStore | undefined = undefined;
  private boundCourseId: string = '';
  private editingCourse: Course | undefined = undefined;
  private noteScroller: Scroller = new Scroller();
  private ready: boolean = false;
  private timer: number = -1;
  private focusTicket: number = 0;
  private noteEpoch: number = 0;
  private focusedBlockId: string = '';
  @State draggingText: boolean = false;
  onDragging: (active: boolean) => void = () => {};
  @State wholeSelection: number = 0;
  @State selectedImageId: string = '';
  private imageKey(event: KeyEvent, block: NoteBlock): boolean { const key = SelectionKeys.command(event); if (key === 'a') { if (this.wholeSelection || this.selectedImageId === block.id) this.selectWhole(true); else this.selectedImageId = block.id; return true; } if (key === 'c') { if (!this.copyWhole() && this.selectedImageId === block.id) NoteClipboard.copy([block]).catch(() => this.message = '复制未完成，请重试'); return true; } return false; }
  private selectionOwner: string = 'note-whole-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  @State copySurface: string = '';
  @State rowHeights: Record<string, number> = {};
  private rowMeasured(id: string, height: number): void { if (Math.abs((this.rowHeights[id] || 0) - height) < 1) return; const values: Record<string, number> = {}; Object.keys(this.rowHeights).forEach((key: string) => values[key] = this.rowHeights[key]); values[id] = height; this.rowHeights = values; }
  private unselectedPointer(): void { if (NativeSelections.isHeld('notes')) return; if (this.wholeSelection) { this.dismissWhole(); NativeSelections.clear(); } }
  private dismissWhole(): void { this.copySurface = ''; this.wholeSelection = 0; this.selectedImageId = ''; this.fromGap = false; }
  private fromGap: boolean = false;
  private selectWhole(already: boolean): boolean { if (!already && !this.fromGap) return false; this.fromGap = false; this.selectedImageId = ''; this.wholeSelection = this.wholeSelection + 1; return true; }
  private copyWhole(): boolean { if (!this.wholeSelection) return false; NoteClipboard.copy(this.blocks).catch(() => this.message = '复制未完成，请重试'); return true; }
  private selectBlock(id: string): void {
    this.onDismissReturn(); if (this.wholeSelection) return; this.selectedImageId = ''; this.wholeSelection = 0; this.fromGap = false; this.activeBlockId = id; }
  private gapBeforeId: string = '';
  aboutToAppear(): void { NativeSelections.bind(this.selectionOwner, () => this.dismissWhole(), 'notes'); this.boundCourseId = this.course?.subId || ''; this.editingCourse = this.course; if (this.store) this.repository = new NotesStore(this.store); this.notes.bind((value: NoteInsertion) => this.insert(value)); try { this.palette = validNotePalette(JSON.parse(this.store?.readJson('note-colors.json') || '{}') as NotePalette); } catch (_) {} this.ready = true; this.refreshNotes(); this.requestedNoteChanged(); }
  aboutToDisappear(): void { NativeSelections.unbind(this.selectionOwner); this.noteEpoch++; clearTimeout(this.timer); this.focusTicket++; this.persist(); this.ready = false; this.focusedBlockId = ''; this.notes.unbind(); this.onEditingFocus(false); }
  private courseChanged(): void { const id = this.course?.subId || ''; if (id === this.boundCourseId) return; this.noteEpoch++; clearTimeout(this.timer); this.persist(); this.focusTicket++; this.focusedBlockId = ''; this.onEditingFocus(false); this.editingCourse = this.course; this.boundCourseId = id; this.handledRequest = ''; this.activeNoteId = 'default'; this.managerOpen = false; this.renameId = ''; this.refreshNotes(); }
  private refreshNotes(): void {
    if (!this.course || !this.repository) return;
    let entries = this.repository.listFor(this.course);
    if (!entries.length) { this.noteList = []; this.activeNoteId = 'default'; this.activeNoteTitle = '新建笔记'; if (this.ready) this.restore(); return; }
    this.noteList = entries;
    if (this.requestedNoteId && !this.handledRequest && entries.some((note: LessonNote) => (note.id || 'default') === this.requestedNoteId)) this.activeNoteId = this.requestedNoteId;
    if (!entries.some((note: LessonNote) => (note.id || 'default') === this.activeNoteId)) this.activeNoteId = entries[0].id || 'default';
    const current = entries.find((note: LessonNote) => note.id === this.activeNoteId) || entries[0];
    this.activeNoteTitle = current.title || '课堂笔记';
    if (this.ready) this.restore();
  }
  private switchNote(id: string): void { if (id === this.activeNoteId) return; this.persist(); this.activeNoteId = id; this.restore(); }
  private createNote(): void {
    if (!this.course || !this.repository) return;
    this.persist();
    if (this.noteList.length === 1 && this.noteList[0].title === '课堂笔记' && !this.noteList[0].namedByUser) { this.noteList[0].title = '课堂笔记1'; this.repository.save(this.noteList[0]); }
    const note = this.repository.create(this.course, `课堂笔记${this.noteList.length + 1}`);
    this.repository.save(note); this.noteList = this.noteList.concat([note]); this.activeNoteId = note.id || 'default'; this.activeNoteTitle = note.title || '新建笔记'; this.restore();
  }
  private openManager(): void { if (!this.managerOpen) { clearTimeout(this.timer); this.persist(); if (this.course && this.repository) this.noteList = this.repository.listFor(this.course); } this.managerOpen = !this.managerOpen; }
  private deleteNote(id: string): void {
    if (!this.course || !this.repository) return;
    const target = this.noteList.find((note: LessonNote) => (note.id || 'default') === id);
    if (!target) return;
    const deletingActive = id === this.activeNoteId;
    if (deletingActive) clearTimeout(this.timer);
    this.repository.delete(target);
    const remaining = this.repository.listFor(this.course);
    if (deletingActive) {
      if (!remaining.length) { this.activeNoteId = 'default'; this.noteList = []; this.managerOpen = false; }
      else { this.noteList = remaining; this.activeNoteId = remaining[0].id || 'default'; }
      this.restore();
    } else this.noteList = remaining.length ? remaining : [this.repository.load(this.course, 'default')];
    this.message = '';
  }
  private restore(): void {
    this.noteEpoch++; clearTimeout(this.timer); this.focusedBlockId = ''; this.onEditingFocus(false);
    if (!this.course || !this.repository) return;
    const note = this.repository.opened(this.course, this.activeNoteId);
    this.noteList = this.repository.listFor(this.course);
    this.activeNoteTitle = note.title || '新建笔记'; this.gapBeforeId = ''; this.focusTicket++;  this.blocks = cleanNoteBlocks(noteBlocks(note), '');
    if (!this.blocks.length || this.blocks[this.blocks.length - 1].source !== 'notes') this.blocks = this.blocks.concat([emptyNoteBlock(this.currentTime())]);
    this.activeBlockId = this.blocks[this.blocks.length - 1].id; this.blockCaret = blockText(this.blocks[this.blocks.length - 1]).length;
    this.editRevision++; this.hasContent = this.blocks.some((block: NoteBlock) => block.atoms.length > 0); this.bold = false; this.italic = false; this.underline = false; this.strikethrough = false; this.alignment = 'left';
  }
  private snapshot(): LessonNote | undefined {
    if (!this.editingCourse) return undefined;
    const atoms: NoteAtom[] = [], anchors: NoteAnchor[] = []; let offset = 0;
    cleanNoteBlocks(this.blocks, '').forEach((block: NoteBlock, index: number) => {
      if (index) { atoms.push({ id: 'gap-' + block.id, kind: 'text', value: '\n\n', at: block.at, end: block.at, sourceId: '', bold: false, italic: false, underline: false }); offset += 2; }
      if (block.source === 'notes' && block.atoms.length) anchors.push({ offset, at: block.at });
      block.atoms.forEach((atom: NoteAtom) => { atoms.push(atom); offset += atom.kind === 'text' ? atom.value.length : 1; });
    });
    return { id: this.activeNoteId, title: this.activeNoteTitle, openedAt: this.noteList.find((note: LessonNote) => note.id === this.activeNoteId)?.openedAt, namedByUser: this.noteList.find((note: LessonNote) => note.id === this.activeNoteId)?.namedByUser, course: this.editingCourse, atoms, anchors, blocks: cleanNoteBlocks(this.blocks, ''), savedAt: Date.now() };
  }
  private persist(): void {
    const note = this.snapshot(); if (!note || !this.repository) return;
    if (!this.blocks.some((block: NoteBlock) => block.atoms.some((atom: NoteAtom) => atom.kind !== 'text' || !!atom.value)) && !this.noteList.some((entry: LessonNote) => entry.id === note.id)) return;
    this.repository.save(note); const index = this.noteList.findIndex((entry: LessonNote) => entry.id === note.id);
    if (index < 0) this.noteList = this.noteList.concat([note]); else { const entries = this.noteList.slice(); entries[index] = note; this.noteList = entries; }
  }
  private edited(id: string, atoms: NoteAtom[]): void {
    if (!this.ready || !this.blocks.some((block: NoteBlock) => block.id === id)) return;
    if (JSON.stringify(this.blocks.find((block: NoteBlock) => block.id === id)?.atoms) === JSON.stringify(atoms)) return;
    this.dismissWhole();
    this.blocks = this.blocks.map((block: NoteBlock): NoteBlock => block.id === id ? updateNoteBlock(block, atoms, this.currentTime()) : block);
    if (atoms.some((atom: NoteAtom) => !!atom.value.trim())) this.gapBeforeId = '';
    clearTimeout(this.timer); this.timer = setTimeout(() => this.persist(), 650);
  }
  private focusBlock(id: string, caret: number): void {
    this.activeBlockId = id; this.blockCaret = caret;
    const ticket = ++this.focusTicket;
    setTimeout(() => {
      if (!this.ready || ticket !== this.focusTicket) return;
      const index = this.blocks.findIndex((block: NoteBlock) => block.id === id);
      if (index < 0) return;
      this.noteScroller.scrollToIndex(index, false, ScrollAlign.AUTO);
      setTimeout(() => { if (this.ready && ticket === this.focusTicket) this.editing.focus(id, caret); }, 32);
    }, 32);
  }
  private goToEnd(): void {
    let last = this.blocks[this.blocks.length - 1];
    if (!last || last.source !== 'notes') { last = emptyNoteBlock(this.currentTime()); this.blocks = this.blocks.concat([last]); }
    this.focusBlock(last.id, blockText(last).length);
  }
  private editingFocus(id: string, focused: boolean): void {
    if (focused) { this.focusedBlockId = id; this.activeBlockId = id; }
    else {
      if (this.focusedBlockId === id) this.focusedBlockId = '';
      const ticket = this.focusTicket, courseId = this.boundCourseId;
      setTimeout(() => {
        if (!this.ready || ticket !== this.focusTicket || courseId !== this.boundCourseId) return;
        const tail = this.blocks[this.blocks.length - 1];
        const keep = this.focusedBlockId || (tail?.source === 'notes' ? tail.id : '');
        const cleaned = cleanNoteBlocks(this.blocks, keep);
        if (cleaned.length !== this.blocks.length) { this.blocks = cleaned; this.persist(); }
      }, 120);
    }
    this.onEditingFocus(!!this.focusedBlockId);
  }
  private breakBlock(id: string, atoms: NoteAtom[], offset: number): void {
    const index = this.blocks.findIndex((block: NoteBlock) => block.id === id), original = this.blocks[index]; if (!original) return;
    const length = atoms.map((atom: NoteAtom) => atom.value).join('').length, caret = Math.max(0, Math.min(length, offset)), next = emptyNoteBlock(this.currentTime());
    next.atoms = sliceNoteAtoms(atoms, caret, length);
    const previous: NoteBlock = { id, source: 'notes', at: original.at, end: original.end, sourceId: '', atoms: sliceNoteAtoms(atoms, 0, caret) };
    const blocks = this.blocks.slice(); blocks.splice(index, 1, previous, next); this.blocks = blocks; this.editRevision++; this.persist(); this.focusBlock(next.id, 0);
  }
  private multiline(id: string, atoms: NoteAtom[], caret: number): void {
    const index = this.blocks.findIndex((block: NoteBlock) => block.id === id), original = this.blocks[index]; if (!original) return;
    const value = atoms.map((atom: NoteAtom) => atom.value).join(''), parts: NoteBlock[] = []; let offset = 0, activeId = id, activeCaret = 0;
    value.split('\n').forEach((line: string, i: number) => { const block = emptyNoteBlock(i ? this.currentTime() : original.at); if (!i) block.id = id; block.atoms = sliceNoteAtoms(atoms, offset, offset + line.length); parts.push(block); if (caret >= offset) { activeId = block.id; activeCaret = Math.min(line.length, caret - offset); } offset += line.length + 1; });
    const blocks = this.blocks.slice(); blocks.splice(index, 1, ...parts); this.blocks = blocks; this.editRevision++; this.persist(); this.focusBlock(activeId, activeCaret);
  }
  private boundary(id: string, direction: number): void {
    const index = this.blocks.findIndex((block: NoteBlock) => block.id === id); let next = index + direction;
    while (next >= 0 && next < this.blocks.length) { const block = this.blocks[next]; if (block.source === 'notes') { this.focusBlock(block.id, direction < 0 ? blockText(block).length : 0); return; } next += direction; }
  }
  private insert(value: NoteInsertion): void {
    this.wholeSelection = 0; this.fromGap = false;
    if (!this.ready || !this.repository) return;
    try {
      const atom: NoteAtom = { id: 'insert-' + Date.now(), kind: value.kind, value: value.kind === 'image' ? this.repository.picture(value.value) : plainTranscript(value.value), at: value.at, end: value.end, sourceId: value.sourceId, bold: false, italic: false, underline: false, reference: value.reference };
      const block: NoteBlock = { id: blockId(), source: value.kind === 'question' || value.kind === 'summary' ? value.kind : value.kind === 'quote' ? 'transcript' : value.sourceId ? 'slides' : 'image', at: value.at, end: value.end, sourceId: value.sourceId, atoms: value.kind === 'question' || value.kind === 'summary' ? referenceAtoms(value) : [atom] };
      if (!this.blocks.some((item: NoteBlock) => item.id === this.activeBlockId) && this.gapBeforeId) {
        const slot = emptyNoteBlock(this.currentTime()), items = this.blocks.slice(), index = this.gapBeforeId === '$end' ? items.length : items.findIndex((item: NoteBlock) => item.id === this.gapBeforeId);
        items.splice(index < 0 ? items.length : index, 0, slot); this.blocks = items; this.activeBlockId = slot.id; this.blockCaret = 0;
      }
      this.gapBeforeId = '';
      const caret = this.editing.has(this.activeBlockId) ? this.editing.caret(this.activeBlockId) : this.blockCaret;
      const result = insertNoteBlock(this.blocks, this.activeBlockId, caret, block, this.currentTime());
      this.blocks = result.blocks; this.editRevision++; this.message = ''; this.persist(); this.focusBlock(result.activeId, result.caret);
    } catch (_) { this.message = '图片或引用插入失败，请重试'; }
  }
  private insertGap(beforeId: string): void {
    const next = this.blocks.findIndex((item: NoteBlock) => item.id === beforeId);
    const previous = this.blocks[next - 1];
    this.wholeSelection = 0; this.fromGap = true; this.gapBeforeId = beforeId || '$end';
    if (previous?.source === 'notes' && !blockText(previous).trim()) { this.focusBlock(previous.id, 0); return; }
    const slot = emptyNoteBlock(this.currentTime()), items = this.blocks.slice(); items.splice(next < 0 ? items.length : next, 0, slot);
    this.blocks = items; this.editRevision++; this.focusBlock(slot.id, 0);
  }
  @Builder
  private gap(beforeId: string) {
    Row() { Blank().height(1).backgroundColor('#EDF1F5'); Text('＋').fontSize(12).fontColor('#9AA9BA').margin({ left: 6, right: 6 }); Blank().height(1).backgroundColor('#EDF1F5') }.id('note-gap-' + beforeId).width('100%').height(18).onClick(() => { if (!this.wholeSelection) this.insertGap(beforeId); else this.copySurface = 'gap-' + beforeId; }).bindMenu(this.copySurface === 'gap-' + beforeId, [{ value: '复制', action: () => this.copyWhole() }], { onDisappear: () => this.copySurface = '' })
  }
  private color(source: string): string { return source === 'question' ? this.palette.question || '#F1EDFA' : source === 'summary' ? this.palette.summary || '#FFF0E4' : source === 'transcript' ? this.palette.transcript : source === 'slides' ? this.palette.slides : source === 'image' ? this.palette.image : this.palette.notes; }
  private chooseColor(source: string, color: string): void {
    this.palette = { notes: source === 'notes' ? color : this.palette.notes, transcript: source === 'transcript' ? color : this.palette.transcript, slides: source === 'slides' ? color : this.palette.slides, image: source === 'image' ? color : this.palette.image, question: source === 'question' ? color : this.palette.question, summary: source === 'summary' ? color : this.palette.summary }; this.store?.saveJson('note-colors.json', JSON.stringify(this.palette));
  }
  @Builder
  private colorSettings() {
    Column({ space: 12 }) {
      ForEach(['transcript', 'slides', 'notes', 'image', 'question', 'summary'], (source: string) => {
        Column({ space: 6 }) {
          Text(blockTitle(source)).fontSize(12).fontColor('#425F7D').width('100%')
          Scroll() { Row({ space: 8 }) { ForEach(noteColors, (color: string) => { Button(this.color(source) === color ? '✓' : '').width(28).height(28).padding(0).fontSize(12).fontColor('#425F7D').backgroundColor(color).border({ width: this.color(source) === color ? 1 : 0, color: '#9CAABD' }).onClick(() => this.chooseColor(source, color)) }, (color: string) => color) } }.width('100%').height(28).scrollable(ScrollDirection.Horizontal).scrollBar(BarState.Off)
        }.width('100%')
      }, (source: string) => source)
      Button('完成').width('100%').height(32).backgroundColor('#F1F3F5').fontColor('#168BEE').onClick(() => this.colorsOpen = false)
    }.padding(10).width('100%').backgroundColor('#FFFFFF').borderRadius(10)
  }
  private jumpBlock(block: NoteBlock): void { const reference = block.atoms[0]?.reference; if (reference) this.onContentJump(reference); else this.onJump(block.at, block.sourceId, block.source === 'transcript' ? blockText(block) : ''); }
  @Builder
  private blockCard(block: NoteBlock) {
    Column({ space: 6 }) {
      Row({ space: 6 }) {
        Text(blockTitle(block.source) + ' · ' + stamp(this.blocks.find((item: NoteBlock) => item.id === block.id)?.at ?? block.at)).fontSize(11).fontColor('#60738B').layoutWeight(1).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).height(26).onClick(() => { if (!this.wholeSelection) this.jumpBlock(this.blocks.find((item: NoteBlock) => item.id === block.id) || block); else this.copySurface = 'header-' + block.id; }).bindMenu(this.copySurface === 'header-' + block.id, [{ value: '复制', action: () => this.copyWhole() }], { onDisappear: () => this.copySurface = '' })
        Button('×').height(22).width(22).padding(0).fontSize(14).fontColor('#8190A3').backgroundColor(Color.Transparent).onClick(() => { this.blocks = this.blocks.filter((item: NoteBlock) => item.id !== block.id); if (!this.blocks.length) this.blocks = [emptyNoteBlock(this.currentTime())]; if (this.activeBlockId === block.id) this.activeBlockId = this.blocks[this.blocks.length - 1].id; this.persist(); })
      }.width('100%')
      if (block.source === 'notes') {
        NoteTextEditor({ onDragging: (active: boolean) => { this.draggingText = active; this.onDragging(active); }, selectionRequest: this.wholeSelection, onSelectAll: (already: boolean) => this.selectWhole(already), onCopyAll: () => this.copyWhole(), revision: this.editRevision, block: this.blocks.find((item: NoteBlock) => item.id === block.id) || block, editing: this.editing, onFormat: (which: string) => this.format(which), onChange: (atoms: NoteAtom[]) => this.edited(block.id, atoms), onPointer: () => { this.focusTicket++; this.selectBlock(block.id); }, onCaret: (offset: number) => { this.activeBlockId = block.id; this.blockCaret = offset; }, onEditingFocus: (focused: boolean) => this.editingFocus(block.id, focused), onBreak: (atoms: NoteAtom[], offset: number) => this.breakBlock(block.id, atoms, offset), onMultiline: (atoms: NoteAtom[], offset: number) => this.multiline(block.id, atoms, offset), onBoundary: (direction: number) => this.boundary(block.id, direction), onMedia: (value: RichEditorChangeValue) => this.importInterconnectImages(value) })
      } else if (['transcript', 'question', 'summary'].includes(block.source)) {
        AnswerText({ onDragging: (active: boolean) => { this.draggingText = active; this.onDragging(active); }, externalSelection: true, onInteract: this.onDismissReturn, selectionRequest: this.wholeSelection, onSelectAll: (already: boolean) => this.selectWhole(already), onCopyAll: () => this.copyWhole(), onPointer: () => this.selectBlock(block.id), selectionGroup: 'notes', parts: noteAnswerParts(block), onJump: (at: number, course?: Course) => { if (course && course.subId !== this.course?.subId) this.onCourseJump(course, at); else this.onJump(at, '', ''); } }).width('100%')
      } else {
        Image(block.atoms[0]?.value || '').id('note-image-' + block.id).focusable(true).focusOnTouch(true).onTouch((event: TouchEvent) => { if (event.type === TouchType.Down) this.selectBlock(block.id); }).onKeyEvent((event: KeyEvent): boolean => this.imageKey(event, block)).width('100%').aspectRatio(this.imageRatios[block.id] || 16 / 9).objectFit(ImageFit.Contain).borderRadius(6).onComplete((event) => { if (event && event.width > 0 && event.height > 0) { const ratio = event.width / event.height; if (this.imageRatios[block.id] !== ratio) { const values: Record<string, number> = {}; Object.keys(this.imageRatios).forEach((id: string) => values[id] = this.imageRatios[id]); values[block.id] = ratio; this.imageRatios = values; } } }).onClick(() => { if (!this.wholeSelection) this.onJump(block.at, block.sourceId, ''); else this.copySurface = 'image-' + block.id; }).bindMenu(this.copySurface === 'image-' + block.id, [{ value: '复制', action: () => this.copyWhole() }], { onDisappear: () => this.copySurface = '' })
      }
    }.padding(10).width('100%').backgroundColor(this.selectedImageId === block.id ? '#DDEEFF' : this.color(block.source)).borderRadius(12)
  }
  @Builder
  private compactMenu() {
    Menu() {
      MenuItem({ content: '回到末尾' }).onClick(() => this.goToEnd())
      MenuItem({ content: '新建笔记' }).onClick(() => this.createNote())
      MenuItem({ content: '图片' }) { this.mediaMenu() }
      MenuItem({ content: '导出' }) {
        Menu() { MenuItem({ content: 'HTML（含图片）' }).onClick(() => this.export('html')); MenuItem({ content: 'Markdown（含图片 ZIP）' }).onClick(() => this.export('md')); MenuItem({ content: '纯文本' }).onClick(() => this.export('txt')); }
      }
      MenuItem({ content: '设置颜色' }).onClick(() => this.colorsOpen = !this.colorsOpen)
    }
  }
  private format(which: string): void {
    if (which === 'bold') this.bold = !this.bold; if (which === 'italic') this.italic = !this.italic; if (which === 'underline') this.underline = !this.underline; if (which === 'strikethrough') this.strikethrough = !this.strikethrough;
    this.editing.format(this.activeBlockId, this.bold, this.italic, this.underline, this.strikethrough);
  }
  private alignParagraph(value: string): void { this.alignment = value; this.editing.align(this.activeBlockId, value); }
  private async photo(): Promise<void> { const epoch = this.noteEpoch; try { const selected = await new photoAccessHelper.PhotoViewPicker().select({ MIMEType: photoAccessHelper.PhotoViewMIMETypes.IMAGE_TYPE, maxSelectNumber: 1 }); if (this.ready && epoch === this.noteEpoch && selected.photoUris.length) this.insert({ kind: 'image', value: selected.photoUris[0], at: this.currentTime(), end: this.currentTime(), sourceId: '' }); } catch (_) { if (this.ready && epoch === this.noteEpoch) this.message = '未能插入图片'; } }
  private async takePhoto(): Promise<void> {
    const epoch = this.noteEpoch;
    try {
      const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
      const result = await cameraPicker.pick(context, [cameraPicker.PickerMediaType.PHOTO], { cameraPosition: camera.CameraPosition.CAMERA_POSITION_BACK });
      if (this.ready && epoch === this.noteEpoch && result.resultCode === 0 && result.resultUri) this.insert({ kind: 'image', value: result.resultUri, at: this.currentTime(), end: this.currentTime(), sourceId: '' });
    } catch (_) { if (this.ready && epoch === this.noteEpoch) this.message = '未能打开系统相机'; }
  }
  private collaborationState(code: number, type: string, buffer: ArrayBuffer): void {
    if (code === 0 && type.startsWith('general.image') && buffer && this.repository) {
      try { const uri = this.repository.pictureData(buffer); this.insert({ kind: 'image', value: uri, at: this.currentTime(), end: this.currentTime(), sourceId: '' }); }
      catch (_) { this.message = '互联设备图片插入失败，请重试'; }
    } else if (code === 1001202002) this.message = '互联设备连接失败，请检查设备网络和华为账号';
  }
  @Builder
  private mediaMenu() {
    Menu() {
      MenuItem({ content: '选择照片' }).onClick(() => this.photo())
      MenuItem({ content: '拍照' }).onClick(() => this.takePhoto())
      createCollaborationServiceMenuItems([CollaborationServiceFilter.TAKE_PHOTO, CollaborationServiceFilter.SCAN_DOCUMENT, CollaborationServiceFilter.IMAGE_PICKER], 10)
    }
  }
  private formatWidth(): number { return Math.max(20, Math.min(28, (this.editorWidth - 14) / 7)); }
  private async importInterconnectImages(value: RichEditorChangeValue): Promise<void> {
    const epoch = this.noteEpoch;
    const spans = (value.replacedImageSpans || []).filter((span) => Number(span.imageStyle.objectFit) === 0 && !!span.valuePixelMap);
    if (!spans.length) return;
    const range = value.rangeBefore;
    this.blockCaret = Math.max(0, range.start ?? this.blockCaret);
    for (const span of spans) {
      if (!span.valuePixelMap || !this.repository) continue;
      try {
        const packer = image.createImagePacker();
        let data: ArrayBuffer;
        try { data = await packer.packToData(span.valuePixelMap, { format: 'image/jpeg', quality: 92 }); }
        finally { await packer.release(); }
        if (!this.ready || epoch !== this.noteEpoch) return;
        const uri = this.repository.pictureData(data);
        this.insert({ kind: 'image', value: uri, at: this.currentTime(), end: this.currentTime(), sourceId: '' });
      } catch (_) { if (this.ready && epoch === this.noteEpoch) this.message = '设备互联图片插入失败，请重试'; }
    }
  }
  private async export(format: string): Promise<void> { const note = this.snapshot(); if (!note || !note.atoms.length) { this.message = '先记录一些笔记'; return; } try { await this.repository?.export([note], format, this.getUIContext().getHostContext() as common.UIAbilityContext, false, this.account); this.message = ''; } catch (_) { this.message = '导出失败，请重试'; } }
  @Builder
  private noteManager() {
    Column({ space: 10 }) {
      Row() { Text('本节课的笔记').fontSize(16).fontWeight(FontWeight.Medium).fontColor('#20344D'); Blank(); Text(`${this.noteList.length} 条`).fontSize(12).fontColor('#71839A') }.width('100%')
      if (this.noteList.length) {
        List({ space: 8 }) {
          ForEach(this.noteList, (note: LessonNote) => {
            ListItem() {
              Row({ space: 8 }) {
                Column({ space: 4 }) { Text(note.course.title + '_' + shanghaiDate(note.course.start) + '_' + (note.title || '课堂笔记')).fontSize(14).fontColor('#20344D').maxLines(1); Text(`${note.atoms.length} 项内容`).fontSize(11).fontColor('#71839A') }.layoutWeight(1).alignItems(HorizontalAlign.Start)
                if ((note.id || 'default') === this.activeNoteId) { Text('当前').fontSize(11).fontColor('#168BEE') }
                Button('重命名').height(30).fontSize(11).fontColor('#168BEE').backgroundColor('#EAF4FF').onClick(() => { this.persist(); this.renameId = note.id || 'default'; this.renameText = note.title || '课堂笔记'; })
                Button('删除').height(30).fontSize(11).fontColor('#B44747').backgroundColor('#FCEEEE').onClick(() => this.deleteNote(note.id || 'default'))
              }.padding(10).width('100%').backgroundColor('#F4F7FB').borderRadius(10)
            }
          }, (note: LessonNote) => (note.id || 'default') + ':' + note.title + ':' + note.savedAt)
        }.layoutWeight(1).width('100%')
      } else { Text('还没有课堂笔记').layoutWeight(1).fontSize(13).fontColor('#71839A').width('100%').textAlign(TextAlign.Center) }
      if (this.renameId) {
        TextInput({ controller: this.renameInput.controller, text: this.renameText, placeholder: '笔记名称' }).onTouch((event: TouchEvent) => event.stopPropagation()).onMouse((event: MouseEvent) => event.stopPropagation()).onKeyPreIme((event: KeyEvent): boolean => this.renameInput.digit(event, this.renameText, (value: string) => this.renameText = value)).height(40).onChange((value: string) => this.renameText = value).onFocus(() => this.onEditingFocus(true)).onBlur(() => { this.renameInput.reset(); this.onEditingFocus(false); })
        Row({ space: 8 }) { Button('取消').height(32).onClick(() => this.renameId = ''); Button('保存名称').height(32).fontColor('#FFFFFF').backgroundColor('#168BEE').onClick(() => { const note = this.noteList.find((entry: LessonNote) => (entry.id || 'default') === this.renameId); if (note && this.repository) { this.repository.rename(note, this.renameText); if (this.activeNoteId === this.renameId) this.activeNoteTitle = note.title || '课堂笔记'; this.noteList = this.repository.listFor(note.course); } this.renameId = ''; }) }.width('100%')
      }
      Button('返回编辑').height(36).width('100%').backgroundColor('#168BEE').fontColor('#FFFFFF').onClick(() => this.managerOpen = false)
    }.layoutWeight(1).width('100%').padding(12).backgroundColor('#FFFFFF').borderRadius(10)
  }
  build() {
    Column({ space: 10 }) {
      Row({ space: 8 }) {
        Text('课堂笔记').fontSize(STUDY_TITLE_SIZE).fontWeight(FontWeight.Medium).fontColor(STUDY_TITLE_COLOR).maxLines(1)
        Scroll() { Row({ space: 6 }) {
          Button() { DropdownLabel({ label: this.activeNoteTitle + '', labelSize: 11 }) }.padding(0).fontSize(11).height(30).backgroundColor('#EAF4FF').fontColor('#168BEE').bindMenu(this.noteList.map((note: LessonNote): MenuElement => { return { value: note.title || '课堂笔记', action: () => this.switchNote(note.id || 'default') }; }))
          Button('新建').height(30).fontSize(11).backgroundColor('#EAF4FF').fontColor('#168BEE').onClick(() => this.createNote())
          Button('管理').id('notes-manager').height(30).fontSize(11).backgroundColor(this.managerOpen ? '#DDEEFF' : '#EAF4FF').fontColor('#168BEE').onClick(() => this.openManager())
          Button('导出').height(30).fontSize(11).backgroundColor('#EAF4FF').fontColor('#168BEE').bindMenu([{ value: 'HTML（含图片）', action: () => this.export('html') }, { value: 'Markdown（含图片 ZIP）', action: () => this.export('md') }, { value: '纯文本', action: () => this.export('txt') }])
          Button('图片').height(30).fontSize(11).backgroundColor('#EAF4FF').fontColor('#168BEE').bindMenu(this.mediaMenu)
          Button('设置').height(30).fontSize(11).backgroundColor('#EAF4FF').fontColor('#168BEE').onClick(() => this.colorsOpen = !this.colorsOpen)
        } }.layoutWeight(1).height(32).align(Alignment.End).scrollable(ScrollDirection.Horizontal).scrollBar(BarState.Off)
      }.width('100%').onTouch((event: TouchEvent) => { if (event.type === TouchType.Down) { this.dismissWhole(); NativeSelections.clear(); } })
      if (this.managerOpen) { this.noteManager() }
      if (this.colorsOpen && !this.managerOpen) { Scroll() { this.colorSettings() }.layoutWeight(1).width('100%').align(Alignment.TopStart).scrollBar(BarState.Auto) }
      Column({ space: 10 }) {
        Scroll() {
        Row({ space: 2 }) {
          Button('B').fontWeight(FontWeight.Bold).height(30).width(this.formatWidth()).padding(0).fontSize(12).fontColor('#168BEE').backgroundColor(this.bold ? '#DDEEFF' : '#EAF4FF').onClick(() => this.format('bold'))
          Button('I').fontStyle(FontStyle.Italic).height(30).width(this.formatWidth()).padding(0).fontSize(12).fontColor('#168BEE').backgroundColor(this.italic ? '#DDEEFF' : '#EAF4FF').onClick(() => this.format('italic'))
          Button('U').height(30).width(this.formatWidth()).padding(0).fontSize(12).fontColor('#168BEE').backgroundColor(this.underline ? '#DDEEFF' : '#EAF4FF').onClick(() => this.format('underline'))
          Button('S̶').height(30).width(this.formatWidth()).padding(0).fontSize(12).fontColor('#168BEE').backgroundColor(this.strikethrough ? '#DDEEFF' : '#EAF4FF').onClick(() => this.format('strikethrough'))
          Button('末尾').id('notes-end').height(30).width(46).padding(0).fontSize(11).backgroundColor('#EAF4FF').fontColor('#168BEE').onClick(() => this.goToEnd())
          if (this.returnVisible) { ReturnAction({ owner: 'notes', onReturn: this.onReturn }) }
          Blank()
          Button('左').height(30).width(this.formatWidth()).padding(0).fontSize(11).backgroundColor(this.alignment === 'left' ? '#DDEEFF' : '#EAF4FF').fontColor('#168BEE').onClick(() => this.alignParagraph('left'))
          Button('中').height(30).width(this.formatWidth()).padding(0).fontSize(11).backgroundColor(this.alignment === 'center' ? '#DDEEFF' : '#EAF4FF').fontColor('#168BEE').onClick(() => this.alignParagraph('center'))
          Button('右').height(30).width(this.formatWidth()).padding(0).fontSize(11).backgroundColor(this.alignment === 'right' ? '#DDEEFF' : '#EAF4FF').fontColor('#168BEE').onClick(() => this.alignParagraph('right'))
        }.width('100%').constraintSize({ minWidth: this.formatWidth() * 7 + 62 + (this.returnVisible ? 100 : 0) })
        }.height(32).width('100%').scrollable(ScrollDirection.Horizontal).scrollBar(BarState.Off)
        Stack({ alignContent: Alignment.TopStart }) {
        List({ space: 0, scroller: this.noteScroller }) {
          ForEach(this.blocks, (block: NoteBlock, index: number) => { ListItem() {
            Stack({ alignContent: Alignment.TopStart }) {
              Column({ space: 2 }) { this.gap(block.id); this.blockCard(block); }.width('100%').padding({ bottom: index < this.blocks.length - 1 ? 10 : 0 }).onAreaChange((oldArea: Area, area: Area) => this.rowMeasured(block.id, Number(area.height)))
              if (this.wholeSelection) { Column().width('100%').height(this.rowHeights[block.id] || 0).backgroundColor('#168BEE26').borderRadius(8).position({ x: 0, y: 0 }).hitTestBehavior(HitTestMode.None) }
            }.width('100%').onTouch((event: TouchEvent) => { if (this.wholeSelection) event.stopPropagation(); }).onMouse((event: MouseEvent) => { if (this.wholeSelection) event.stopPropagation(); })
          } }, (block: NoteBlock) => block.id)
        }.layoutWeight(1).width('100%').align(Alignment.TopStart).enableScrollInteraction(!this.draggingText).onGestureJudgeBegin((info: GestureInfo, event: BaseGestureEvent) => this.draggingText && info.type === GestureControl.GestureType.PAN_GESTURE ? GestureJudgeResult.REJECT : GestureJudgeResult.CONTINUE).scrollBar(BarState.Auto).onAreaChange((oldArea: Area, area: Area) => this.editorWidth = Number(area.width))
        }.layoutWeight(1).width('100%')
        if (this.message) { Text(this.message).fontSize(12).fontColor('#AE6B41').width('100%') }
      }.layoutWeight(1).width('100%').visibility(this.managerOpen || this.colorsOpen ? Visibility.None : Visibility.Visible)
      CollaborationServiceStateDialog({ onState: (code: number, type: string, buffer: ArrayBuffer) => this.collaborationState(code, type, buffer) })
    }.padding(12).width('100%').height('100%').backgroundColor(STUDY_SURFACE).borderRadius(STUDY_RADIUS).onTouch((event: TouchEvent) => { if (event.type === TouchType.Down) this.unselectedPointer(); }).onKeyPreIme((event: KeyEvent): boolean => { if (event.type === KeyType.Down && event.keyCode === 2082 && !!event.getModifierKeyState?.(['Ctrl'])) { this.goToEnd(); return true; } return false; })
  }
}
