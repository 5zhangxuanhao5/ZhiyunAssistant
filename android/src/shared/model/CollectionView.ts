import { Course } from './Timeline';
import { CollectionEntry } from './CourseCollections';
export function notStarted(course: Course, now: number): boolean { return course.start > now && course.status !== '1'; }
export function pendingCollection(entry: CollectionEntry, now: number): boolean { const lessons = entry.lessons.filter((lesson: Course) => !entry.excluded.includes(lesson.subId)); return lessons.length > 0 && lessons.every((lesson: Course) => notStarted(lesson, now)); }
export function orderedCollections(entries: CollectionEntry[], now: number): CollectionEntry[] { return entries.slice().sort((a: CollectionEntry, b: CollectionEntry) => Number(pendingCollection(a, now)) - Number(pendingCollection(b, now)) || (pendingCollection(a, now) ? Math.min(...a.lessons.map((lesson: Course) => lesson.start)) - Math.min(...b.lessons.map((lesson: Course) => lesson.start)) : 0)); }
