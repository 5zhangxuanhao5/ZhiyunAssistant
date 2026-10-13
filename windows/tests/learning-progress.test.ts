import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readLearningProgress, readTranscriptProgressAnchor, restorableTranscriptAnchor } from '../src/shared/model/LearningProgress';
import type { LearningProgress } from '../src/shared/model/LearningProgress';
import type { Course } from '../src/shared/model/Timeline';

const course = { subId: 'reading-lesson', courseId: 'reading-course' } as unknown as Course;
const progress: LearningProgress = { schema: 1, subId: course.subId, courseId: course.courseId, seconds: 660, slideId: 'slide-2', slideSeconds: 600, video: false, followVideo: false, savedAt: 1 };
const anchor = { id: 'line-33', t: 669, offset: -11.5, browsing: true };
test('legacy schema1 progress remains unchanged and valid without a transcript bookmark', () => {
  assert.deepEqual(readLearningProgress(JSON.stringify(progress), course), progress);
});
test('transcript bookmark preserves sentence, timestamp, fractional viewport offset and manual browsing on round trip', () => {
  const loaded = readLearningProgress(JSON.stringify({ ...progress, transcriptAnchor: anchor }), course)!;
  assert.deepEqual(loaded.transcriptAnchor, anchor);
  assert.deepEqual(restorableTranscriptAnchor(loaded), anchor);
});
test('malformed optional transcript bookmark is ignored without discarding valid existing progress', () => {
  for (const value of [null, [], { ...anchor, id: '' }, { ...anchor, id: 'x'.repeat(513) }, { ...anchor, t: -1 }, { ...anchor, t: NaN }, { ...anchor, offset: Infinity }, { ...anchor, offset: 1000001 }]) {
    assert.equal(readTranscriptProgressAnchor(value), undefined);
    assert.deepEqual(readLearningProgress(JSON.stringify({ ...progress, transcriptAnchor: value }), course), progress);
  }
});
test('explicit time links including zero take priority over an old bookmark', () => {
  const loaded = { ...progress, transcriptAnchor: anchor };
  assert.equal(restorableTranscriptAnchor(loaded, 0), undefined);
  assert.equal(restorableTranscriptAnchor(loaded, 1300), undefined);
});
test('automatic following positions never become manual live replay bookmarks', () => {
  assert.equal(restorableTranscriptAnchor({ ...progress, transcriptAnchor: { ...anchor, browsing: false } }), undefined);
  assert.deepEqual(restorableTranscriptAnchor({ ...progress, transcriptAnchor: anchor }), anchor);
});
test('a bookmark is scoped to its original course and lesson through progress validation', () => {
  const raw = JSON.stringify({ ...progress, transcriptAnchor: anchor });
  assert.equal(readLearningProgress(raw, { ...course, subId: 'other-lesson' }), undefined);
  assert.equal(readLearningProgress(raw, { ...course, courseId: 'other-course' }), undefined);
});
