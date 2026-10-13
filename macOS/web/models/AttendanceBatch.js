// Generated from shared HarmonyOS sources by sync-harmony-models.cjs.
// Reuse only if every attendance record from the cached snapshot still exists.
// New records are safe additions; deletions invalidate the entire candidate list.
export function reusableAttendanceBatch(courses, cached) {
    if (!cached || cached.schema !== 1 || !Array.isArray(cached.attendanceIds) || !Array.isArray(cached.allowedIds))
        return [];
    const current = new Set(courses.map((course) => course.subId));
    if (cached.attendanceIds.some((id) => !current.has(id)))
        return [];
    const allowed = new Set(cached.allowedIds.filter((id) => cached.attendanceIds.includes(id)));
    return courses.filter((course) => allowed.has(course.subId));
}
export function attendanceBatch(courses, allowed) { const ids = new Set(courses.map((course) => course.subId)); return { schema: 1, attendanceIds: Array.from(ids), allowedIds: allowed.filter((course) => ids.has(course.subId)).map((course) => course.subId), savedAt: Date.now() }; }
