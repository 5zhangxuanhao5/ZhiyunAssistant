import { Course, PageGroup } from './Timeline';

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
}

export function readLearningProgress(text: string, course: Course): LearningProgress | undefined {
  try {
    const value = JSON.parse(text) as LearningProgress;
    if (value.schema !== 1 || value.subId !== course.subId || value.courseId !== course.courseId || !Number.isFinite(value.seconds) || value.seconds < 0 || !Number.isFinite(value.slideSeconds) || value.slideSeconds < 0) return undefined;
    return { schema: 1, subId: course.subId, courseId: course.courseId, seconds: value.seconds, slideId: typeof value.slideId === 'string' ? value.slideId : '', slideSeconds: value.slideSeconds, video: value.video === true, followVideo: value.followVideo !== false, savedAt: Number(value.savedAt) || 0 };
  } catch (_) { return undefined; }
}

export function progressPage(groups: PageGroup[], progress: LearningProgress): number {
  const time = progress.video && progress.followVideo ? progress.seconds : progress.slideSeconds;
  const exact = groups.findIndex((group: PageGroup) => group.slide.id === progress.slideId);
  if ((!progress.video || !progress.followVideo) && exact >= 0) return exact;
  let index = 0;
  groups.forEach((group: PageGroup, i: number) => { if (group.slide.t <= time) index = i; });
  return index;
}
