import { Course } from './Timeline';
export interface AttendanceBatchCache { schema: number; attendanceIds: string[]; allowedIds: string[]; savedAt: number }
// Reuse only if every attendance record from the cached snapshot still exists.
// New records are safe additions; deletions invalidate the entire candidate list.
export function reusableAttendanceBatch(courses: Course[], cached?: AttendanceBatchCache): Course[] {
  if (!cached || cached.schema !== 1 || !Array.isArray(cached.attendanceIds) || !Array.isArray(cached.allowedIds)) return [];
  const current = new Set(courses.map((course: Course) => course.subId));
  if (cached.attendanceIds.some((id: string) => !current.has(id))) return [];
  const allowed = new Set(cached.allowedIds.filter((id: string) => cached.attendanceIds.includes(id)));
  return courses.filter((course: Course) => allowed.has(course.subId));
}
export function attendanceBatch(courses: Course[], allowed: Course[]): AttendanceBatchCache { const ids = new Set(courses.map((course: Course) => course.subId)); return { schema: 1, attendanceIds: Array.from(ids), allowedIds: allowed.filter((course: Course) => ids.has(course.subId)).map((course: Course) => course.subId), savedAt: Date.now() }; }
