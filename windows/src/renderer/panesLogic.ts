import type { Course, Slide, Transcript } from '../shared/model/Timeline';
import type { NoteAtom, NoteInsertion, LessonNote } from '../shared/model/Notes';
import type { NoteBlock } from '../shared/model/NoteBlocks';
import { emptyNoteBlock, insertNoteBlock, cleanNoteBlocks, blockText, sliceNoteAtoms } from '../shared/model/NoteBlocks';
import { referenceAtoms } from '../shared/model/NoteFormatting';
import { questionScope } from '../shared/model/QuestionScope';

export interface DesktopBridge {
  call<T = unknown>(method: string, payload?: unknown): Promise<T>;
  on(event: string, callback: (payload: any) => void): () => void;
}
export function bridge(): DesktopBridge {
  const value = (window as Window & { zhiyun?: DesktopBridge }).zhiyun;
  if (!value) throw new Error('桌面服务未启动，请重新打开应用');
  return value;
}
export function ipc<T = unknown>(method: string, payload?: unknown): Promise<T> { return bridge().call<T>(method, payload); }
export function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error || '操作失败，请重试'); }
export function enterAction(event: { key: string; shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; isComposing?: boolean; keyCode?: number }, composing: boolean): 'send' | 'newline' | 'none' {
  if (event.key !== 'Enter' || composing || event.isComposing || event.keyCode === 229) return 'none';
  return event.shiftKey ? 'newline' : event.ctrlKey || event.metaKey ? 'none' : 'send';
}
export function commandKey(event: { key: string; ctrlKey: boolean; metaKey?: boolean }): string { return event.ctrlKey || event.metaKey ? event.key.toLowerCase() : ''; }
export function newNote(course: Course, title = '课堂笔记'): LessonNote { return { id: crypto.randomUUID(), title, course, namedByUser: false, atoms: [], anchors: [], blocks: [emptyNoteBlock(0)], savedAt: Date.now(), openedAt: Date.now() }; }
export function prepareNote(note: LessonNote): LessonNote { const blocks = note.blocks || []; return { ...note, blocks, atoms: blocks.flatMap((block, i) => i ? [{ id: 'separator-' + block.id, kind: 'text', value: '\n\n', at: block.at, end: block.end, sourceId: '', bold: false, italic: false, underline: false } as NoteAtom, ...block.atoms] : block.atoms), savedAt: Date.now() }; }
export function applyInsertion(blocks: NoteBlock[], activeId: string, caret: number, insertion: NoteInsertion, at: number) {
  const inserted: NoteBlock = { id: crypto.randomUUID(), source: insertion.kind === 'image' ? insertion.sourceId ? 'slides' : 'image' : insertion.kind === 'quote' ? 'transcript' : insertion.kind, at: insertion.at, end: insertion.end, sourceId: insertion.sourceId, atoms: insertion.kind === 'image' ? [{ id: crypto.randomUUID(), kind: 'image', value: insertion.value, at: insertion.at, end: insertion.end, sourceId: insertion.sourceId, bold: false, italic: false, underline: false, reference: insertion.reference }] : referenceAtoms(insertion) };
  return insertNoteBlock(blocks, activeId, caret, inserted, at);
}
export function splitOwnBlock(blocks: NoteBlock[], activeId: string, caret: number, at: number) {
  const target = blocks.find(block => block.id === activeId);
  if (!target || target.source !== 'notes') return { blocks, activeId, caret };
  const length = blockText(target).length, bounded = Math.max(0, Math.min(length, caret));
  const next = emptyNoteBlock(at); next.atoms = sliceNoteAtoms(target.atoms, bounded, length);
  const result = blocks.slice(), index = result.findIndex(block => block.id === activeId);
  result.splice(index, 1, { ...target, atoms: sliceNoteAtoms(target.atoms, 0, bounded) }, next);
  return { blocks: result, activeId: next.id, caret: 0 };
}
export function cleanedBlocks(blocks: NoteBlock[], activeId = '') { return cleanNoteBlocks(blocks, activeId); }
export function materialForQuestion(course: Course, slides: Slide[], lines: Transcript[], question: string, at: number, whole: boolean, selectedIds: string[]) {
  const scope = questionScope(question, slides, whole, selectedIds);
  const ordered = slides.slice().sort((a, b) => a.t - b.t);
  const include = scope.selectedIds.length ? ordered.filter(slide => scope.selectedIds.includes(slide.id)) : ordered.filter(slide => scope.whole || slide.t <= at);
  const selected = new Set(include.map(slide => slide.id));
  const captions = lines.filter(line => scope.selectedIds.length ? ordered.some((slide, index) => selected.has(slide.id) && line.t >= slide.t && line.t < (ordered[index + 1]?.t ?? Infinity)) : scope.whole || line.t <= at).slice().sort((a, b) => a.t - b.t || a.id.localeCompare(b.id));
  return { course, slides: ordered, lines: captions, at, whole: scope.whole, selectedIds: scope.selectedIds, includedPageIds: include.map(slide => slide.id) };
}
export function summaryRecordKey(scope: string, pageId: string) { return scope + ':' + pageId; }
export function summaryContext(scope: string, pageId: string, slides: Slide[], now: number) {
  const index = slides.findIndex(slide => slide.id === pageId), page = slides[index], end = slides[index + 1]?.t;
  const whole = scope === 'whole' || scope === 'courseAll';
  const at = whole || end === undefined ? now : Math.min(now, Math.max(page?.t || 0, end - 0.001));
  return { at, selectedIds: scope === 'page' ? [pageId] : [], whole };
}
export function summaryEligible(live: boolean, pageId: string, slides: Slide[], manual: boolean) { return manual || !live || slides.some((slide, index) => slide.id === pageId && index < slides.length - 1); }
export function selectAllPhase(previous: { target: string; at: number } | null, target: string, now: number): 1 | 2 { return previous?.target === target && now - previous.at < 1800 ? 2 : 1; }
