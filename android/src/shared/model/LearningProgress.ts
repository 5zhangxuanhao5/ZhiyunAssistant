import { Course, PageGroup } from './Timeline';

export interface TranscriptProgressAnchor {
  id: string;
  t: number;
  offset: number;
  browsing: boolean;
}
export function readTranscriptProgressAnchor(raw: unknown): TranscriptProgressAnchor | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const value = raw as TranscriptProgressAnchor;
  if (typeof value.id !== 'string' || !value.id || value.id.length > 512 || !Number.isFinite(value.t) || value.t < 0 || !Number.isFinite(value.offset) || Math.abs(value.offset) > 1000000) return undefined;
  return { id: value.id, t: value.t, offset: value.offset, browsing: value.browsing === true };
}

export interface LearningProgress {
  schema: number;
  subId: string;
  courseId: string;
  seconds: number;
  slideId: string;
  slideSeconds: number;
  video: boolean;
  followVideo: boolean;
  savedAt: number;
  transcriptAnchor?: TranscriptProgressAnchor;
}

export function readLearningProgress(text: string, course: Course): LearningProgress | undefined {
  try {
    const value = JSON.parse(text) as LearningProgress;
    if (value.schema !== 1 || value.subId !== course.subId || value.courseId !== course.courseId || !Number.isFinite(value.seconds) || value.seconds < 0 || !Number.isFinite(value.slideSeconds) || value.slideSeconds < 0) return undefined;
    const result: LearningProgress = { schema: 1, subId: course.subId, courseId: course.courseId, seconds: value.seconds, slideId: typeof value.slideId === 'string' ? value.slideId : '', slideSeconds: value.slideSeconds, video: value.video === true, followVideo: value.followVideo !== false, savedAt: Number(value.savedAt) || 0 };
    const anchor = readTranscriptProgressAnchor(value.transcriptAnchor);
    if (anchor) result.transcriptAnchor = anchor;
    return result;
  } catch (_) { return undefined; }
}

export function restorableTranscriptAnchor(progress: LearningProgress | undefined, explicitAt?: number): TranscriptProgressAnchor | undefined {
  if (explicitAt !== undefined) return undefined;
  const anchor = readTranscriptProgressAnchor(progress?.transcriptAnchor);
  return anchor?.browsing ? anchor : undefined;
}

export function progressPage(groups: PageGroup[], progress: LearningProgress): number {
  const time = progress.video && progress.followVideo ? progress.seconds : progress.slideSeconds;
  const exact = groups.findIndex((group: PageGroup) => group.slide.id === progress.slideId);
  if ((!progress.video || !progress.followVideo) && exact >= 0) return exact;
  let index = 0;
  groups.forEach((group: PageGroup, i: number) => { if (group.slide.t <= time) index = i; });
  return index;
}
