import { Course } from './Timeline';
export interface CollectionCourse { courseId: string; title: string; teacher: string; room: string; term?: string }
export interface CollectionEntry { course: CollectionCourse; whole: boolean; excluded: string[]; lessons: Course[]; complete: boolean; updatedAt: number }
interface CollectionData { schema: number; favourites: CollectionEntry[]; later: CollectionEntry[] }
export interface CollectionStorage { readJson(name: string): string; saveJson(name: string, value: string): void }
export class CourseCollections {
  private data: CollectionData = { schema: 1, favourites: [], later: [] };
  private storage: CollectionStorage | undefined = undefined;
  onChange: () => void = () => {};
  bind(storage: CollectionStorage | undefined): void {
    this.storage = storage; this.data = { schema: 1, favourites: [], later: [] };
    try { const saved = JSON.parse(storage?.readJson('course-collections-v1.json') || '') as CollectionData;
      if (saved.schema === 1) { this.data.favourites = this.valid(saved.favourites); this.data.later = this.valid(saved.later); }
    } catch (_) {}
    this.onChange();
  }
  private valid(rows: CollectionEntry[]): CollectionEntry[] { return Array.isArray(rows) ? rows.filter((entry: CollectionEntry) => !!entry?.course?.courseId && Array.isArray(entry.lessons) && Array.isArray(entry.excluded)).map((entry: CollectionEntry): CollectionEntry => { return { course: entry.course, whole: entry.whole === true, excluded: Array.from(new Set(entry.excluded)), lessons: entry.lessons.filter((lesson: Course) => lesson.courseId === entry.course.courseId && !!lesson.subId), complete: entry.complete === true, updatedAt: Number(entry.updatedAt) || 0 }; }) : []; }
  entries(kind: string): CollectionEntry[] { return (kind === 'later' ? this.data.later : this.data.favourites).slice().sort((a: CollectionEntry, b: CollectionEntry) => b.updatedAt - a.updatedAt); }
  entry(kind: string, courseId: string): CollectionEntry | undefined { return this.entries(kind).find((entry: CollectionEntry) => entry.course.courseId === courseId); }
  clear(kind: string): void { if (kind === 'later') this.data.later = []; else this.data.favourites = []; this.persist(); }
  hasSelection(kind: string, courseId: string): boolean { const entry = this.entry(kind, courseId); return !!entry && (entry.whole || entry.lessons.length > 0); }
  toggleSelection(kind: string, course: CollectionCourse, known: Course[], whole: boolean): void {
    if (this.hasSelection(kind, course.courseId)) { this.put(kind, course.courseId, undefined); return; }
    if (whole) { this.toggleCourse(kind, course, known); return; }
    const map = new Map<string, Course>(); known.filter((lesson: Course) => lesson.courseId === course.courseId).forEach((lesson: Course) => map.set(lesson.subId, lesson));
    if (map.size) this.put(kind, course.courseId, { course, whole: false, excluded: [], lessons: Array.from(map.values()), complete: false, updatedAt: Date.now() });
  }
  hasCourse(kind: string, courseId: string): boolean { const entry = this.entry(kind, courseId); return !!entry?.whole && !entry.excluded.length; }
  hasLesson(kind: string, course: Course): boolean { const entry = this.entry(kind, course.courseId); return !!entry && (entry.whole ? !entry.excluded.includes(course.subId) : entry.lessons.some((lesson: Course) => lesson.subId === course.subId)); }
  private put(kind: string, courseId: string, entry: CollectionEntry | undefined): void { const rows = this.entries(kind).filter((item: CollectionEntry) => item.course.courseId !== courseId); if (entry) rows.unshift(entry); if (kind === 'later') this.data.later = rows; else this.data.favourites = rows; this.persist(); }
  private persist(): void { try { this.storage?.saveJson('course-collections-v1.json', JSON.stringify(this.data)); } catch (_) {} this.onChange(); }
  toggleCourse(kind: string, course: CollectionCourse, known: Course[] = []): void {
    if (this.hasCourse(kind, course.courseId)) { this.put(kind, course.courseId, undefined); return; }
    const previous = this.entry(kind, course.courseId), map = new Map<string, Course>();
    (previous?.lessons || []).concat(known).filter((lesson: Course) => lesson.courseId === course.courseId).forEach((lesson: Course) => map.set(lesson.subId, lesson));
    this.put(kind, course.courseId, { course, whole: true, excluded: [], lessons: Array.from(map.values()), complete: previous?.complete || false, updatedAt: Date.now() });
  }
  toggleLesson(kind: string, course: Course): void {
    const previous = this.entry(kind, course.courseId), selected = this.hasLesson(kind, course);
    if (previous?.whole) {
      const excluded = selected ? previous.excluded.concat(course.subId) : previous.excluded.filter((id: string) => id !== course.subId);
      const lessons = previous.lessons.filter((lesson: Course) => lesson.subId !== course.subId).concat([course]);
      this.put(kind, course.courseId, previous.complete && lessons.length > 0 && lessons.every((lesson: Course) => excluded.includes(lesson.subId)) ? undefined : { course: previous.course, whole: true, excluded, lessons, complete: previous.complete, updatedAt: Date.now() });
    } else {
      const lessons = (previous?.lessons || []).filter((lesson: Course) => lesson.subId !== course.subId); if (!selected) lessons.push(course);
      this.put(kind, course.courseId, lessons.length ? { course, whole: false, excluded: [], lessons, complete: false, updatedAt: Date.now() } : undefined);
    }
  }
  catalogue(course: CollectionCourse, rows: Course[], complete: boolean = false): void {
    let changed = false;
    ['favourite', 'later'].forEach((kind: string) => {
      const entry = this.entry(kind, course.courseId); if (!entry) return;
      const map = new Map<string, Course>(); entry.lessons.concat(rows).filter((lesson: Course) => lesson.courseId === course.courseId && (entry.whole || entry.lessons.some((old: Course) => old.subId === lesson.subId))).forEach((lesson: Course) => map.set(lesson.subId, lesson));
      const next: CollectionEntry = { course, whole: entry.whole, excluded: entry.excluded, lessons: Array.from(map.values()), complete: entry.complete || complete, updatedAt: entry.updatedAt };
      const list = kind === 'later' ? this.data.later : this.data.favourites;
      const index = list.findIndex((item: CollectionEntry) => item.course.courseId === course.courseId);
      if (index >= 0 && JSON.stringify(list[index]) !== JSON.stringify(next)) { list[index] = next; changed = true; }
    });
    if (changed) this.persist();
  }
}
