// Generated from shared HarmonyOS sources by sync-harmony-models.cjs.
export function notStarted(course, now) { return course.start > now && course.status !== '1'; }
export function pendingCollection(entry, now) { const lessons = entry.lessons.filter((lesson) => !entry.excluded.includes(lesson.subId)); return lessons.length > 0 && lessons.every((lesson) => notStarted(lesson, now)); }
export function orderedCollections(entries, now) { return entries.slice().sort((a, b) => Number(pendingCollection(a, now)) - Number(pendingCollection(b, now)) || (pendingCollection(a, now) ? Math.min(...a.lessons.map((lesson) => lesson.start)) - Math.min(...b.lessons.map((lesson) => lesson.start)) : 0)); }
