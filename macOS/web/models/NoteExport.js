// Generated from shared HarmonyOS sources by sync-harmony-models.cjs.
import { safeFilename, studyFolders } from './StudyFolders.js';
import { shanghaiDate } from './Timeline.js';
export function noteOpenedAt(note) { return note.openedAt || note.savedAt || 0; }
export function recentNoteFolders(notes) { const recent = (id) => Math.max(0, ...notes.filter((note) => note.course.subId === id).map(noteOpenedAt)); const folders = studyFolders(notes.map((note) => note.course)); folders.forEach((folder) => folder.lessons.sort((a, b) => recent(b.subId) - recent(a.subId))); return folders.sort((a, b) => recent(b.lessons[0].subId) - recent(a.lessons[0].subId)); }
export function noteExportCourse(note) { return safeFilename(note.course.title) + '_' + safeFilename(note.course.teacher || '教师未标注') + '_' + safeFilename(note.course.term || '学期未标注'); }
export function noteExportDate(note) { return shanghaiDate(note.course.start); }
export function noteExportName(note) { return safeFilename(note.title || '课堂笔记'); }
export function notePictureName(name, index, extension) { return safeFilename(name) + '_图片' + index + '.' + extension; }
export function uniqueExportName(name, used) { let next = name, index = 2; while (used.has(next))
    next = name + ' (' + index++ + ')'; used.add(next); return next; }
