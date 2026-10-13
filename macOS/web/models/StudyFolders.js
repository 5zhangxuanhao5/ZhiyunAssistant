// Generated from shared HarmonyOS sources by sync-harmony-models.cjs.
import { shanghaiDate, clockTime } from './Timeline.js';
export function studyFolders(courses) {
    const folders = [];
    courses.forEach((course) => { const id = course.courseId || course.title; let folder = folders.find((entry) => entry.id === id); if (!folder) {
        folder = { id, title: course.title, lessons: [] };
        folders.push(folder);
    } if (!folder.lessons.some((lesson) => lesson.subId === course.subId))
        folder.lessons.push(course); });
    folders.forEach((folder) => folder.lessons.sort((a, b) => b.start - a.start));
    return folders.sort((a, b) => b.lessons[0].start - a.lessons[0].start);
}
export function lessonLabel(course) { return shanghaiDate(course.start) + ' ' + clockTime(course.start); }
export function safeFilename(value) { return value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/^\.+|[ .]+$/g, '').trim().slice(0, 90) || '未命名'; }
export function selectedUnion(selected, ids, checked) { return checked ? Array.from(new Set(selected.concat(ids))) : selected.filter((id) => !ids.includes(id)); }
