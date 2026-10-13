import type { Slide, Transcript } from '../shared/bridge';
import type { VideoBounds } from './videoLogic';

const seconds = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;

export function knownLessonEnd(slides: Slide[], lines: Transcript[]): number {
  let end = 0;
  for (const slide of slides) end = Math.max(end, seconds(slide.t));
  for (const line of lines) end = Math.max(end, seconds(line.t), seconds(line.end));
  return end;
}

// The timetable is only a fallback. A recording can be longer or shorter than it.
export function lessonDuration(scheduled: number, slides: Slide[], lines: Transcript[], video?: VideoBounds | null): number {
  if (video?.seekable && video.end > video.start) return seconds(video.end);
  return Math.max(seconds(scheduled), knownLessonEnd(slides, lines));
}

export function liveReadingTime(start: number, now: number, slides: Slide[], lines: Transcript[]): number {
  return Math.max(seconds(now - start), knownLessonEnd(slides, lines));
}

export function initialReadingIndex(slides: Slide[], at: number, savedId: string | undefined, explicit: boolean, live: boolean): number {
  if (!explicit && live) return Math.max(0, slides.length - 1);
  const saved = !explicit && savedId ? slides.findIndex(slide => slide.id === savedId) : -1;
  return saved >= 0 ? saved : Math.max(0, slides.findLastIndex(slide => slide.t <= at));
}
