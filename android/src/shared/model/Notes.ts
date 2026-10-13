import { NoteBlock } from './NoteBlocks';
import { Course } from './Timeline';
import { CourseAnswerPart } from './CourseReference';
export interface NoteContentReference { kind: string; courseId: string; sessionId?: string; turn?: number; pageId?: string; scope?: string; summaryId?: string; at: number }
export interface NoteAtom { id: string; kind: string; value: string; at: number; end: number; sourceId: string; bold: boolean; italic: boolean; underline: boolean; strikethrough?: boolean; code?: boolean; linkAt?: number; linkCourse?: Course; paragraphAlign?: string; reference?: NoteContentReference }
export interface NoteAnchor { offset: number; at: number }
export interface LessonNote { id?: string; title?: string; namedByUser?: boolean; openedAt?: number; course: Course; atoms: NoteAtom[]; anchors: NoteAnchor[]; savedAt: number; blocks?: NoteBlock[] }
export interface NoteReference { offset: number; atom: NoteAtom }
export interface NoteInsertion { formatted?: CourseAnswerPart[]; sourceText?: string; kind: string; value: string; at: number; end: number; sourceId: string; reference?: NoteContentReference }
export function movedOffset(offset: number, beforeStart: number, beforeEnd: number, afterEnd: number): number { return offset < beforeStart ? offset : offset >= beforeEnd ? offset + afterEnd - beforeEnd : beforeStart; }
export function insertionBreaks(text: string, caret: number): string[] {
  const before = text.slice(0, Math.max(0, caret)), after = text.slice(Math.max(0, caret));
  const left = before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const right = after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  return [left, right];
}
export function notePlain(note: LessonNote): string { return note.atoms.map((atom: NoteAtom) => atom.kind === 'image' ? `[课件图片 ${atom.at.toFixed(1)}秒]` : atom.value).join(''); }
export class NotesController {
  private receiver: (value: NoteInsertion) => void = () => {};
  bind(receiver: (value: NoteInsertion) => void): void { this.receiver = receiver; }
  unbind(): void { this.receiver = () => {}; }
  insert(value: NoteInsertion): void { this.receiver(value); }
}
