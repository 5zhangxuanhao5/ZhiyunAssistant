import { Course, shanghaiDate } from './Timeline';
export interface CourseSection { id: string; title: string; courses: Course[] }
export interface CalendarCell { key: string; date: string; day: string; inMonth: boolean; count: number }
export function courseSections(courses: Course[], byCourse: boolean): CourseSection[] {
  const sections = new Map<string, CourseSection>();
  courses.slice().sort((a: Course, b: Course) => b.start - a.start).forEach((course: Course) => {
    const id = byCourse ? course.courseId : shanghaiDate(course.start);
    let section = sections.get(id);
    if (!section) { section = { id, title: byCourse ? course.title : id, courses: [] }; sections.set(id, section); }
    if (!section.courses.some((c: Course) => c.subId === course.subId)) section.courses.push(course);
  });
  return Array.from(sections.values());
}
export function shiftCalendarMonth(month: string, amount: number): string {
  const parts = month.split('-');
  const year = Number(parts[0]), number = Number(parts[1]);
  const date = new Date(Date.UTC(year, number - 1 + amount, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}
export function calendarMonthGrid(month: string, courses: Course[]): CalendarCell[] {
  const parts = month.split('-');
  const year = Number(parts[0]), number = Number(parts[1]);
  const offset = (new Date(Date.UTC(year, number - 1, 1)).getUTCDay() + 6) % 7;
  const counts: Record<string, number> = {};
  courses.forEach((course: Course) => { const date = shanghaiDate(course.start); counts[date] = (counts[date] || 0) + 1; });
  const cells: CalendarCell[] = [];
  for (let index = 0; index < 42; index++) {
    const date = new Date(Date.UTC(year, number - 1, index - offset + 1));
    const dateKey = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    const inMonth = date.getUTCMonth() === number - 1;
    cells.push({ key: month + ':' + dateKey, date: inMonth ? dateKey : '', day: inMonth ? String(date.getUTCDate()) : '', inMonth, count: inMonth ? counts[dateKey] || 0 : 0 });
  }
  return cells;
}

export function scopeSelected(chosen: string[], courses: Course[]): boolean {
  return courses.length > 0 && courses.every((course: Course) => chosen.includes(course.subId));
}
export function toggleScopedSelection(chosen: string[], courses: Course[]): string[] {
  const ids = new Set(courses.map((course: Course) => course.subId));
  return scopeSelected(chosen, courses) ? chosen.filter((id: string) => !ids.has(id)) : Array.from(new Set(chosen.concat(Array.from(ids))));
}
