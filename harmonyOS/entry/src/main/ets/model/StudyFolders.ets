import { Course, shanghaiDate, clockTime } from './Timeline';
export interface CourseFolder { id: string; title: string; lessons: Course[] }
export function studyFolders(courses: Course[]): CourseFolder[] {
  const folders: CourseFolder[] = [];
  courses.forEach((course: Course) => { const id = course.courseId || course.title; let folder = folders.find((entry: CourseFolder) => entry.id === id); if (!folder) { folder = { id, title: course.title, lessons: [] }; folders.push(folder); } if (!folder.lessons.some((lesson: Course) => lesson.subId === course.subId)) folder.lessons.push(course); });
  folders.forEach((folder: CourseFolder) => folder.lessons.sort((a: Course, b: Course) => b.start - a.start));
  return folders.sort((a: CourseFolder, b: CourseFolder) => b.lessons[0].start - a.lessons[0].start);
}
export function lessonLabel(course: Course): string { return shanghaiDate(course.start) + ' ' + clockTime(course.start); }
export function safeFilename(value: string): string { return value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/^\.+|[ .]+$/g, '').trim().slice(0, 90) || '未命名'; }
export function selectedUnion(selected: string[], ids: string[], checked: boolean): string[] { return checked ? Array.from(new Set(selected.concat(ids))) : selected.filter((id: string) => !ids.includes(id)); }
