import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialReadingIndex, knownLessonEnd, lessonDuration, liveReadingTime } from '../src/renderer/studyLogic';

const slides = [0, 60, 180].map((t, i) => ({ id: 'page-' + i, t, url: 'https://example.test/' + i, thumb: '', note: '' }));
const lines = [{ id: 'last', t: 190, end: 215, text: 'Synthetic lesson explanation.' }];

test('lesson navigation uses real media bounds instead of the scheduled length', () => {
  assert.equal(knownLessonEnd(slides, lines), 215);
  assert.equal(lessonDuration(120, slides, lines), 215);
  assert.equal(lessonDuration(400, slides, lines, { start: 0, end: 240, seekable: true }), 240);
  assert.equal(lessonDuration(120, slides, lines, { start: 0, end: 280, seekable: true }), 280);
  assert.equal(lessonDuration(400, slides, lines, { start: 0, end: 0, seekable: false }), 400);
});

test('live reading follows current lesson time and retains all arrived material in the context', () => {
  assert.equal(liveReadingTime(1000, 1300, slides, lines), 300);
  assert.equal(liveReadingTime(1000, 1100, slides, lines), 215);
  assert.equal(liveReadingTime(1400, 1300, [], []), 0);
});

test('explicit references override saved page identity while ordinary reopen preserves the reading page', () => {
  assert.equal(initialReadingIndex(slides, 185, 'page-0', true, false), 2);
  assert.equal(initialReadingIndex(slides, 185, 'page-0', false, false), 0);
  assert.equal(initialReadingIndex(slides, 0, 'page-0', false, true), 2);
  assert.equal(initialReadingIndex(slides, 65, 'page-0', true, true), 1);
});
