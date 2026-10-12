import { Course, shanghaiDate, clockTime } from './Timeline';
export interface CourseFolder { id: string; title: string; lessons: Course[] }
export function studyFolders(courses: Course[]): CourseFolder[] {
  const folders: CourseFolder[] = [];
  courses.forEach((course: Course) => { const id = course.courseId || course.title; let folder = folders.find((entry: CourseFolder) => entry.id === id); if (!folder) { folder = { id, title: course.title, lessons: [] }; folders.push(folder); } if (!folder.lessons.some((lesson: Course) => lesson.subId === course.subId)) folder.lessons.push(course); });
  folders.forEach((folder: CourseFolder) => folder.lessons.sort((a: Course, b: Course) => b.start - a.start));
  return folders.sort((a: CourseFolder, b: CourseFolder) => b.lessons[0].start - a.lessons[0].start);
}
export function lessonLabel(course: Course): string { return shanghaiDate(course.start) + ' ' + clockTime(course.start); }
export function filenameWithinBytes(value: string, maximum: number): string {
  let result = '', bytes = 0;
  for (const point of value) { const code = point.codePointAt(0)!, size = code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4; if (bytes + size > maximum) break; result += point; bytes += size; }
  return result.replace(/[ .]+$/g, '') || '未命名';
}
export function safeFilename(value: string): string {
  let name = filenameWithinBytes(Array.from(value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/^\.+|[ .]+$/g, '').trim()).slice(0, 90).join(''), 200);
  // Windows treats these as devices even when followed by an extension.
  if (/^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³]|CONIN\$|CONOUT\$)\s*(?:\.|$)/i.test(name)) name = '_' + name;
  return name;
}
export function selectedUnion(selected: string[], ids: string[], checked: boolean): string[] { return checked ? Array.from(new Set(selected.concat(ids))) : selected.filter((id: string) => !ids.includes(id)); }
