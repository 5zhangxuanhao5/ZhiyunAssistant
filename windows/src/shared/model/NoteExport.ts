import { LessonNote } from './Notes';
import { safeFilename, filenameWithinBytes, studyFolders, CourseFolder } from './StudyFolders';
import { shanghaiDate } from './Timeline';
export function noteOpenedAt(note: LessonNote): number { return note.openedAt || note.savedAt || 0; }
export function recentNoteFolders(notes: LessonNote[]): CourseFolder[] { const recent = (id: string): number => Math.max(0, ...notes.filter((note: LessonNote) => note.course.subId === id).map(noteOpenedAt)); const folders = studyFolders(notes.map((note: LessonNote) => note.course)); folders.forEach((folder: CourseFolder) => folder.lessons.sort((a, b) => recent(b.subId) - recent(a.subId))); return folders.sort((a, b) => recent(b.lessons[0].subId) - recent(a.lessons[0].subId)); }
export function noteExportCourse(note: LessonNote): string { const parts = [safeFilename(note.course.title), safeFilename(note.course.teacher || '教师未标注'), safeFilename(note.course.term || '学期未标注')], joined = parts.join('_'); return new TextEncoder().encode(joined).byteLength <= 230 ? joined : parts.map(part => filenameWithinBytes(part, 72)).join('_'); }
export function noteExportDate(note: LessonNote): string { return shanghaiDate(note.course.start); }
export function noteExportName(note: LessonNote): string { return safeFilename(note.title || '课堂笔记'); }
export function notePictureName(name: string, index: number, extension: string): string { return safeFilename(name) + '_图片' + index + '.' + extension; }
export function uniqueExportName(name: string, used: Set<string>): string { let next = name, index = 2; const occupied = new Set(Array.from(used).map(value => value.normalize('NFC').toLowerCase())); while (occupied.has(next.normalize('NFC').toLowerCase())) next = name + ' (' + index++ + ')'; used.add(next); return next; }
