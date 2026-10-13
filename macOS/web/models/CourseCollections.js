// Generated from shared HarmonyOS sources by sync-harmony-models.cjs.
export class CourseCollections {
    constructor() {
        this.data = { schema: 1, favourites: [], later: [] };
        this.storage = undefined;
        this.onChange = () => { };
    }
    bind(storage) {
        this.storage = storage;
        this.data = { schema: 1, favourites: [], later: [] };
        try {
            const saved = JSON.parse(storage?.readJson('course-collections-v1.json') || '');
            if (saved.schema === 1) {
                this.data.favourites = this.valid(saved.favourites);
                this.data.later = this.valid(saved.later);
            }
        }
        catch (_) { }
        this.onChange();
    }
    valid(rows) { return Array.isArray(rows) ? rows.filter((entry) => !!entry?.course?.courseId && Array.isArray(entry.lessons) && Array.isArray(entry.excluded)).map((entry) => { return { course: entry.course, whole: entry.whole === true, excluded: Array.from(new Set(entry.excluded)), lessons: entry.lessons.filter((lesson) => lesson.courseId === entry.course.courseId && !!lesson.subId), complete: entry.complete === true, updatedAt: Number(entry.updatedAt) || 0 }; }) : []; }
    entries(kind) { return (kind === 'later' ? this.data.later : this.data.favourites).slice().sort((a, b) => b.updatedAt - a.updatedAt); }
    entry(kind, courseId) { return this.entries(kind).find((entry) => entry.course.courseId === courseId); }
    clear(kind) { if (kind === 'later')
        this.data.later = [];
    else
        this.data.favourites = []; this.persist(); }
    hasSelection(kind, courseId) { const entry = this.entry(kind, courseId); return !!entry && (entry.whole || entry.lessons.length > 0); }
    toggleSelection(kind, course, known, whole) {
        if (this.hasSelection(kind, course.courseId)) {
            this.put(kind, course.courseId, undefined);
            return;
        }
        if (whole) {
            this.toggleCourse(kind, course, known);
            return;
        }
        const map = new Map();
        known.filter((lesson) => lesson.courseId === course.courseId).forEach((lesson) => map.set(lesson.subId, lesson));
        if (map.size)
            this.put(kind, course.courseId, { course, whole: false, excluded: [], lessons: Array.from(map.values()), complete: false, updatedAt: Date.now() });
    }
    hasCourse(kind, courseId) { const entry = this.entry(kind, courseId); return !!entry?.whole && !entry.excluded.length; }
    hasLesson(kind, course) { const entry = this.entry(kind, course.courseId); return !!entry && (entry.whole ? !entry.excluded.includes(course.subId) : entry.lessons.some((lesson) => lesson.subId === course.subId)); }
    put(kind, courseId, entry) { const rows = this.entries(kind).filter((item) => item.course.courseId !== courseId); if (entry)
        rows.unshift(entry); if (kind === 'later')
        this.data.later = rows;
    else
        this.data.favourites = rows; this.persist(); }
    persist() { try {
        this.storage?.saveJson('course-collections-v1.json', JSON.stringify(this.data));
    }
    catch (_) { } this.onChange(); }
    toggleCourse(kind, course, known = []) {
        if (this.hasCourse(kind, course.courseId)) {
            this.put(kind, course.courseId, undefined);
            return;
        }
        const previous = this.entry(kind, course.courseId), map = new Map();
        (previous?.lessons || []).concat(known).filter((lesson) => lesson.courseId === course.courseId).forEach((lesson) => map.set(lesson.subId, lesson));
        this.put(kind, course.courseId, { course, whole: true, excluded: [], lessons: Array.from(map.values()), complete: previous?.complete || false, updatedAt: Date.now() });
    }
    toggleLesson(kind, course) {
        const previous = this.entry(kind, course.courseId), selected = this.hasLesson(kind, course);
        if (previous?.whole) {
            const excluded = selected ? previous.excluded.concat(course.subId) : previous.excluded.filter((id) => id !== course.subId);
            const lessons = previous.lessons.filter((lesson) => lesson.subId !== course.subId).concat([course]);
            this.put(kind, course.courseId, previous.complete && lessons.length > 0 && lessons.every((lesson) => excluded.includes(lesson.subId)) ? undefined : { course: previous.course, whole: true, excluded, lessons, complete: previous.complete, updatedAt: Date.now() });
        }
        else {
            const lessons = (previous?.lessons || []).filter((lesson) => lesson.subId !== course.subId);
            if (!selected)
                lessons.push(course);
            this.put(kind, course.courseId, lessons.length ? { course, whole: false, excluded: [], lessons, complete: false, updatedAt: Date.now() } : undefined);
        }
    }
    catalogue(course, rows, complete = false) {
        let changed = false;
        ['favourite', 'later'].forEach((kind) => {
            const entry = this.entry(kind, course.courseId);
            if (!entry)
                return;
            const map = new Map();
            entry.lessons.concat(rows).filter((lesson) => lesson.courseId === course.courseId && (entry.whole || entry.lessons.some((old) => old.subId === lesson.subId))).forEach((lesson) => map.set(lesson.subId, lesson));
            const next = { course, whole: entry.whole, excluded: entry.excluded, lessons: Array.from(map.values()), complete: entry.complete || complete, updatedAt: entry.updatedAt };
            const list = kind === 'later' ? this.data.later : this.data.favourites;
            const index = list.findIndex((item) => item.course.courseId === course.courseId);
            if (index >= 0 && JSON.stringify(list[index]) !== JSON.stringify(next)) {
                list[index] = next;
                changed = true;
            }
        });
        if (changed)
            this.persist();
    }
}
