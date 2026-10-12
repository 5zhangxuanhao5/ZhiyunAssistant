import { LessonNote, NoteAtom } from './Notes';
export interface NoteBlock { id: string; source: string; at: number; end: number; sourceId: string; atoms: NoteAtom[] }
export interface BlockInsertion { blocks: NoteBlock[]; activeId: string; caret: number }
export interface NotePalette { notes: string; transcript: string; slides: string; image: string; question?: string; summary?: string }
export const noteColors: string[] = ['#EAF4FF', '#FFF5D9', '#FCECF2', '#EAF5ED', '#FFF0E4', '#F1EDFA'];
export function defaultNotePalette(): NotePalette { return { notes: '#FFF5D9', transcript: '#EAF4FF', slides: '#EAF5ED', image: '#FCECF2', question: '#F1EDFA', summary: '#FFF0E4' }; }
export function validNotePalette(raw?: NotePalette): NotePalette { const fallback = defaultNotePalette(); return { notes: noteColors.includes(raw?.notes || '') ? raw!.notes : fallback.notes, transcript: noteColors.includes(raw?.transcript || '') ? raw!.transcript : fallback.transcript, slides: noteColors.includes(raw?.slides || '') ? raw!.slides : fallback.slides, image: noteColors.includes(raw?.image || '') ? raw!.image : fallback.image, question: noteColors.includes(raw?.question || '') ? raw!.question : fallback.question, summary: noteColors.includes(raw?.summary || '') ? raw!.summary : fallback.summary }; }
export function blockTitle(source: string): string { return source === 'question' ? '课程问答' : source === 'summary' ? '本页速览' : source === 'transcript' ? '转写' : source === 'slides' ? '课件' : source === 'image' ? '图片' : '我的笔记'; }
export function blockId(): string { return 'block-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9); }
export function emptyNoteBlock(at: number): NoteBlock { return { id: blockId(), source: 'notes', at, end: at, sourceId: '', atoms: [] }; }
export function blockText(block: NoteBlock): string { return block.atoms.map((atom: NoteAtom) => atom.value).join(''); }
export function sliceNoteAtoms(atoms: NoteAtom[], start: number, end: number): NoteAtom[] {
  let offset = 0; const result: NoteAtom[] = [];
  atoms.forEach((atom: NoteAtom) => { const left = Math.max(0, start - offset), right = Math.min(atom.value.length, end - offset); if (right > left) result.push({ id: atom.id, kind: atom.kind, value: atom.value.slice(left, right), at: atom.at, end: atom.end, sourceId: atom.sourceId, bold: atom.bold, italic: atom.italic, underline: atom.underline, strikethrough: atom.strikethrough, code: atom.code, linkAt: atom.linkAt, linkCourse: atom.linkCourse, paragraphAlign: atom.paragraphAlign, reference: atom.reference }); offset += atom.value.length; });
  return result;
}
export function noteBlocks(note: LessonNote): NoteBlock[] {
  if (note.blocks?.length) return note.blocks;
  const blocks: NoteBlock[] = []; let offset = 0;
  note.atoms.forEach((atom: NoteAtom) => {
    if (atom.kind !== 'text') { blocks.push({ id: blockId(), source: atom.kind === 'question' || atom.kind === 'summary' ? atom.kind : atom.kind === 'quote' ? 'transcript' : atom.sourceId ? 'slides' : 'image', at: atom.at, end: atom.end, sourceId: atom.sourceId, atoms: [atom] }); offset++; return; }
    let consumed = 0;
    atom.value.split('\n').forEach((line: string) => {
      if (line) {
        const at = note.anchors.filter((anchor) => anchor.offset <= offset + consumed).slice(-1)[0]?.at ?? atom.at;
        const previous = blocks[blocks.length - 1]; const part = sliceNoteAtoms([atom], consumed, consumed + line.length)[0];
        if (consumed === 0 && previous?.source === 'notes' && previous.end === -1) previous.atoms.push(part);
        else blocks.push({ id: blockId(), source: 'notes', at, end: -1, sourceId: '', atoms: [part] });
      }
      if (consumed + line.length < atom.value.length && blocks.length) blocks[blocks.length - 1].end = blocks[blocks.length - 1].at;
      consumed += line.length + 1;
    }); offset += atom.value.length;
  });
  return blocks.map((block: NoteBlock): NoteBlock => { return { id: block.id, source: block.source, at: block.at, end: block.end < 0 ? block.at : block.end, sourceId: block.sourceId, atoms: block.atoms }; });
}
export function insertNoteBlock(blocks: NoteBlock[], activeId: string, offset: number, inserted: NoteBlock, at: number): BlockInsertion {
  const result = blocks.slice(); let index = result.findIndex((block: NoteBlock) => block.id === activeId);
  if (index < 0) index = result.length - 1;
  const active = result[index]; const next = emptyNoteBlock(at);
  if (active?.source === 'notes') {
    const length = blockText(active).length, caret = Math.max(0, Math.min(length, offset));
    const before = sliceNoteAtoms(active.atoms, 0, caret), after = sliceNoteAtoms(active.atoms, caret, length);
    const prefix: NoteBlock = { id: active.id, source: active.source, at: active.at, end: active.end, sourceId: active.sourceId, atoms: before };
    const suffix: NoteBlock = { id: next.id, source: 'notes', at: after.length ? active.at : at, end: after.length ? active.end : at, sourceId: '', atoms: after };
    result.splice(index, 1, ...(before.length ? [prefix, inserted, suffix] : [inserted, suffix]));
    const following = result.slice(index + (before.length ? 3 : 2)).find((block: NoteBlock) => block.source === 'notes' && !!blockText(block).trim());
    const focus = !blockText(suffix).trim() && following ? following.id : suffix.id;
    return { blocks: cleanNoteBlocks(result, focus), activeId: focus, caret: 0 };
  }
  result.splice(index + 1, 0, inserted, next); return { blocks: cleanNoteBlocks(result, next.id), activeId: next.id, caret: 0 };
}
export interface NoteEditorBinding { caret: () => number; focus: (offset: number) => void; format: (bold: boolean, italic: boolean, underline: boolean, strike: boolean) => void; align: (value: string) => void }
export class NoteEditingController {
  private bindings: Map<string, NoteEditorBinding> = new Map();
  bind(id: string, value: NoteEditorBinding): void { this.bindings.set(id, value); }
  unbind(id: string): void { this.bindings.delete(id); }
  has(id: string): boolean { return this.bindings.has(id); }
  caret(id: string): number { return this.bindings.get(id)?.caret() || 0; }
  focus(id: string, offset: number): void { this.bindings.get(id)?.focus(offset); }
  format(id: string, bold: boolean, italic: boolean, underline: boolean, strike: boolean): void { this.bindings.get(id)?.format(bold, italic, underline, strike); }
  align(id: string, value: string): void { this.bindings.get(id)?.align(value); }
}

export function cleanNoteBlocks(blocks: NoteBlock[], activeId: string): NoteBlock[] { return blocks.filter((block: NoteBlock) => block.source !== 'notes' || block.id === activeId || !!blockText(block).trim()); }

export function updateNoteBlock(block: NoteBlock, atoms: NoteAtom[], now: number): NoteBlock {
  const at = block.atoms.some((atom: NoteAtom) => !!atom.value.trim()) || !atoms.some((atom: NoteAtom) => !!atom.value.trim()) ? block.at : now;
  return { id: block.id, source: block.source, at, end: at, sourceId: block.sourceId, atoms: atoms.map((atom: NoteAtom): NoteAtom => { return { id: atom.id, kind: atom.kind, value: atom.value, at, end: at, sourceId: atom.sourceId, bold: atom.bold, italic: atom.italic, underline: atom.underline, strikethrough: atom.strikethrough, code: atom.code, linkAt: atom.linkAt, linkCourse: atom.linkCourse, paragraphAlign: atom.paragraphAlign, reference: atom.reference }; }) };
}
