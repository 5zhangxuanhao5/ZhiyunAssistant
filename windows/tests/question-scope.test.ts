import { test } from 'node:test';
import assert from 'node:assert/strict';
import { questionScope, questionAllowsFuture } from '../src/shared/model/QuestionScope';
import { materialForQuestion } from '../src/renderer/panesLogic';
import type { Course, Slide, Transcript } from '../src/shared/model/Timeline';
import { AiClient } from '../src/shared/services/AiClient';
import type { QuestionViewingMode } from '../src/shared/model/QuestionScope';
import type { LocalStore } from '../src/shared/services/LocalStore';

const course: Course = { subId: 'scope-lesson', courseId: 'scope-course', title: '合成范围测试', teacher: '测试', room: '测试', start: 1000, end: 1300, status: 'ended' };
const slides: Slide[] = [0, 60, 120].map((t, i) => ({ id: 'page-' + i, t, url: 'https://classroom.zju.edu.cn/synthetic-' + i + '.png', thumb: '', note: '' }));
const lines: Transcript[] = [{ id: 'first', t: 5, end: 10, text: '前页合成资料' }, { id: 'later-current', t: 95, end: 100, text: '本页后段合成资料' }, { id: 'early-current', t: 65, end: 70, text: '本页前段合成资料' }, { id: 'next-page', t: 130, end: 140, text: '下一页合成资料' }];

test('relative current-page wording resolves the displayed id rather than the asking clock page', () => {
  for (const question of ['这一页讲了什么', '这页的图如何理解', '本页老师怎么解释', '当前页的公式', '此页的例子', '这张PPT是什么意思', 'Explain this page']) {
    const scope = questionScope(question, slides, false, [], 'page-1');
    assert.deepEqual(scope.selectedIds, ['page-1'], question);
    assert.equal(scope.currentPageOnly, true, question);
    assert.equal(scope.whole, false);
  }
});
test('reading a current page includes its full available narration, retains real asking timestamp and saves unrelated tokens', () => {
  const context = materialForQuestion(course, slides, lines, '这一页老师讲了什么', 60, false, [], 'page-1', 'reading');
  assert.equal(context.at, 60);
  assert.deepEqual(context.selectedIds, ['page-1']);
  assert.deepEqual(context.includedPageIds, ['page-1']);
  assert.deepEqual(context.lines.map(line => line.id), ['early-current', 'later-current']);
  assert.equal(context.viewingMode, 'reading');
});
test('video current-page inference never sends narration later than the actual playhead', () => {
  const context = materialForQuestion(course, slides, lines, '当前页老师讲了什么', 80, false, [], 'page-1', 'playback');
  assert.equal(context.at, 80);
  assert.deepEqual(context.selectedIds, ['page-1']);
  assert.deepEqual(context.lines.map(line => line.id), ['early-current']);
  assert.ok(context.lines.every(line => line.t <= context.at));
});
test('browsing a future page during video permits that image without leaking future narration or substituting the first slide', () => {
  const context = materialForQuestion(course, slides, lines, '解释本页图片', 20, false, [], 'page-2', 'playback');
  assert.deepEqual(context.includedPageIds, ['page-2']);
  assert.deepEqual(context.lines, []);
  assert.equal(context.at, 20);
  assert.equal(questionAllowsFuture(questionScope('解释本页图片', slides, false, [], 'page-2'), 'playback'), false);
});
test('omitted viewing mode defaults to playback boundary protection', () => {
  const context = materialForQuestion(course, slides, lines, '这一页老师讲了什么', 60, false, [], 'page-1');
  assert.deepEqual(context.lines, []);
  assert.equal(context.viewingMode, 'playback');
});
test('current page request overrides unrelated picker selection and whole-course toggle', () => {
  const scope = questionScope('只解释这一页', slides, true, ['page-0', 'page-2'], 'page-1');
  assert.deepEqual(scope, { whole: false, selectedIds: ['page-1'], currentPageOnly: true });
});
test('an explicit whole-course request keeps its existing expansion instead of narrowing to the relative page', () => {
  const context = materialForQuestion(course, slides, lines, '结合整节课解释这一页', 60, false, [], 'page-1', 'playback');
  assert.equal(context.whole, true);
  assert.deepEqual(context.selectedIds, []);
  assert.deepEqual(context.lines.map(line => line.id), ['first', 'early-current', 'later-current', 'next-page']);
});
test('explicit numbered pages can expand narration and combine with the displayed relative page in time order', () => {
  const context = materialForQuestion(course, slides, lines, '第1页和这一页有什么关系', 20, false, [], 'page-1', 'playback');
  assert.deepEqual(context.selectedIds, ['page-0', 'page-1']);
  assert.deepEqual(context.lines.map(line => line.id), ['first', 'early-current', 'later-current']);
  assert.equal(context.currentPageOnly, undefined);
});
test('until-this-page requests keep the full preceding timeline rather than collapsing to one page', () => {
  for (const question of ['截至这一页讲了哪些内容', '截止本页的内容概括', '这一页之前讲了什么']) {
    const context = materialForQuestion(course, slides, lines, question, 80, true, ['page-2'], 'page-1', 'reading');
    assert.deepEqual(context.selectedIds, []);
    assert.equal(context.whole, false);
    assert.deepEqual(context.lines.map(line => line.id), ['first', 'early-current']);
  }
});
test('negated current-page wording and missing page ids do not silently infer a different page', () => {
  assert.deepEqual(questionScope('不要参考这一页', slides, false, [], 'page-1'), { whole: false, selectedIds: [] });
  assert.deepEqual(questionScope('不仅仅看本页', slides, false, [], 'page-1'), { whole: false, selectedIds: [] });
  assert.deepEqual(questionScope('这一页讲了什么', slides, false, [], 'deleted-page'), { whole: false, selectedIds: [] });
});
test('generic current-time questions are unchanged and never select a future displayed page', () => {
  const context = materialForQuestion(course, slides, lines, '截止目前讲了什么', 80, false, [], 'page-2', 'reading');
  assert.deepEqual(context.includedPageIds, ['page-0', 'page-1']);
  assert.deepEqual(context.lines.map(line => line.id), ['first', 'early-current']);
});
test('legacy summary callers without current-page inference retain before and whole scope behavior', () => {
  assert.deepEqual(questionScope('概括当前这页的实际知识，说明与已学内容联系', slides, false, []), { whole: false, selectedIds: [] });
  assert.deepEqual(questionScope('概括当前这页的实际知识，说明与整节课联系', slides, true, []), { whole: true, selectedIds: [] });
});

async function capturedAsk(options: { question: string; at: number; mode?: QuestionViewingMode; currentId?: string; whole?: boolean; toolScope?: string }) {
  const savedKey = AiClient.savedKey, requests: any[] = [], images: string[] = [];
  let contextLoads = 0;
  AiClient.savedKey = async () => 'synthetic-test-credential';
  try {
    const client: any = new AiClient();
    client.readSlide = async (slide: Slide) => { images.push(slide.id); return { text: '合成图像解释 ' + slide.id, version: 'synthetic' }; };
    client.stream = async (_credential: string, body: any) => {
      requests.push(structuredClone(body));
      return requests.length === 1 && options.toolScope ? { answer: '', calls: [{ id: 'scope-call', type: 'function', function: { name: 'read_course_context', arguments: JSON.stringify({ scope: options.toolScope, pages: [2] }) } }] } : { answer: '合成回答', calls: [] };
    };
    const store = { activeCourse: course } as LocalStore;
    const answer = await client.ask(store, slides.slice().reverse(), lines.slice().reverse(), options.question, options.at, !!options.whole, 'synthetic-model', [], () => {}, 'always', options.currentId || 'page-1', () => {}, [], undefined, async () => { contextLoads++; return { slides, lines }; }, undefined, options.mode);
    return { answer, requests, images, contextLoads };
  } finally { AiClient.savedKey = savedKey; }
}
function materials(request: any): string { return request.messages.filter((message: any) => message.role === 'system' && message.content.startsWith('本节课程资料')).map((message: any) => message.content).join('\n'); }
test('actual AiClient reading request uses only current page image and full aligned narration without rewriting asking time', async () => {
  const result = await capturedAsk({ question: '这一页老师讲了什么', at: 60, mode: 'reading' });
  assert.deepEqual(result.images, ['page-1']);
  const text = materials(result.requests[0]);
  assert.ok(text.indexOf('本页前段') < text.indexOf('本页后段'));
  assert.ok(text.includes('本页后段'));
  assert.ok(!text.includes('前页合成') && !text.includes('下一页合成'));
  assert.ok(result.requests[0].messages.some((message: any) => message.content.includes('提问发生在课程 01:00（60 秒）')));
});
test('actual AiClient future displayed page image is available but no future video narration is sent', async () => {
  const result = await capturedAsk({ question: '解释本页图片', at: 20, mode: 'playback', currentId: 'page-2' });
  assert.deepEqual(result.images, ['page-2']);
  assert.ok(!materials(result.requests[0]).includes('下一页合成'));
  assert.ok(result.requests[0].messages.some((message: any) => message.content.includes('真实播放时点')));
});
test('actual AiClient tool cannot turn an implicit video current-page request into whole-lesson future exposure', async () => {
  const result = await capturedAsk({ question: '本页老师讲了什么', at: 80, mode: 'playback', toolScope: 'whole' });
  assert.equal(result.contextLoads, 0);
  assert.equal(result.requests.length, 2);
  assert.ok(result.requests[1].messages.some((message: any) => message.role === 'tool' && message.content.includes('未请求扩展到未播放')));
  assert.ok(!JSON.stringify(result.requests).includes('本页后段合成资料'));
});
test('actual AiClient same-page context tool reuses grouped display snapshot and preserves video cutoff', async () => {
  const result = await capturedAsk({ question: '本页老师讲了什么', at: 80, mode: 'playback', toolScope: 'pages' });
  assert.equal(result.contextLoads, 0);
  const tool = result.requests[1].messages.find((message: any) => message.role === 'tool').content;
  assert.ok(tool.includes('本页前段合成资料'));
  assert.ok(!tool.includes('本页后段合成资料') && !tool.includes('下一页合成资料'));
});
test('actual summary before-scope caller does not infer a single current page from its stock prompt', async () => {
  const result = await capturedAsk({ question: '概括当前这页的实际知识，说明与已学内容联系', at: 80 });
  const text = materials(result.requests[0]);
  assert.ok(text.includes('前页合成资料') && text.includes('本页前段合成资料'));
  assert.ok(!text.includes('本页后段合成资料'));
});
