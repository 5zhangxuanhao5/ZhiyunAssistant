// Generated from shared HarmonyOS sources by sync-harmony-models.cjs.
import { shanghaiDate } from './Timeline.js';
export function courseSections(courses, byCourse) {
    const sections = new Map();
    courses.slice().sort((a, b) => b.start - a.start).forEach((course) => {
        const id = byCourse ? course.courseId : shanghaiDate(course.start);
        let section = sections.get(id);
        if (!section) {
            section = { id, title: byCourse ? course.title : id, courses: [] };
            sections.set(id, section);
        }
        if (!section.courses.some((c) => c.subId === course.subId))
            section.courses.push(course);
    });
    return Array.from(sections.values());
}
export function shiftCalendarMonth(month, amount) {
    const parts = month.split('-');
    const year = Number(parts[0]), number = Number(parts[1]);
    const date = new Date(Date.UTC(year, number - 1 + amount, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}
export function calendarMonthGrid(month, courses) {
    const parts = month.split('-');
    const year = Number(parts[0]), number = Number(parts[1]);
    const offset = (new Date(Date.UTC(year, number - 1, 1)).getUTCDay() + 6) % 7;
    const counts = {};
    courses.forEach((course) => { const date = shanghaiDate(course.start); counts[date] = (counts[date] || 0) + 1; });
    const cells = [];
    for (let index = 0; index < 42; index++) {
        const date = new Date(Date.UTC(year, number - 1, index - offset + 1));
        const dateKey = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
        const inMonth = date.getUTCMonth() === number - 1;
        cells.push({ key: month + ':' + dateKey, date: inMonth ? dateKey : '', day: inMonth ? String(date.getUTCDate()) : '', inMonth, count: inMonth ? counts[dateKey] || 0 : 0 });
    }
    return cells;
}
export function scopeSelected(chosen, courses) {
    return courses.length > 0 && courses.every((course) => chosen.includes(course.subId));
}
export function toggleScopedSelection(chosen, courses) {
    const ids = new Set(courses.map((course) => course.subId));
    return scopeSelected(chosen, courses) ? chosen.filter((id) => !ids.has(id)) : Array.from(new Set(chosen.concat(Array.from(ids))));
}
