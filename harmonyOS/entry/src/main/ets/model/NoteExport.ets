import { LessonNote } from './Notes';
import { safeFilename, studyFolders, CourseFolder } from './StudyFolders';
import { shanghaiDate } from './Timeline';
export function noteOpenedAt(note: LessonNote): number { return note.openedAt || note.savedAt || 0; }
export function recentNoteFolders(notes: LessonNote[]): CourseFolder[] { const recent = (id: string): number => Math.max(0, ...notes.filter((note: LessonNote) => note.course.subId === id).map(noteOpenedAt)); const folders = studyFolders(notes.map((note: LessonNote) => note.course)); folders.forEach((folder: CourseFolder) => folder.lessons.sort((a, b) => recent(b.subId) - recent(a.subId))); return folders.sort((a, b) => recent(b.lessons[0].subId) - recent(a.lessons[0].subId)); }
export function noteExportCourse(note: LessonNote): string { return safeFilename(note.course.title) + '_' + safeFilename(note.course.teacher || '教师未标注') + '_' + safeFilename(note.course.term || '学期未标注'); }
export function noteExportDate(note: LessonNote): string { return shanghaiDate(note.course.start); }
export function noteExportName(note: LessonNote): string { return safeFilename(note.title || '课堂笔记'); }
export function notePictureName(name: string, index: number, extension: string): string { return safeFilename(name) + '_图片' + index + '.' + extension; }
export function uniqueExportName(name: string, used: Set<string>): string { let next = name, index = 2; while (used.has(next)) next = name + ' (' + index++ + ')'; used.add(next); return next; }
