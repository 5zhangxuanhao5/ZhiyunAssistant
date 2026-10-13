const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path');
const { pathToFileURL } = require('node:url');
const loaded = import(pathToFileURL(path.resolve(__dirname, '../web/mac-api.js')));
const account = id => ({ id, tenantId: 112, name: 'Sensitive name never retained' });
const epoch = date => Date.parse(date + 'T09:00:00+08:00') / 1000;
const lesson = (id, date = '2020-01-02') => ({ courseId: 'c', subId: id, title: id, start: epoch(date), end: epoch(date) + 3600 });
function json(rows) { return JSON.stringify({ code: 0, result: { list: [{ course: rows.map(row => ({ course_id: row.courseId, sub_id: row.subId, course_title: row.title, start_at: row.start, end_at: row.end })) }] } }); }
async function fixture(options = {}) {
  const { MacZhiyun } = await loaded, api = new MacZhiyun(options); let response = [], failure = false; const calls = [];
  api.request = async path => { calls.push(path); if (failure) throw new Error('网络暂时无法访问'); return json(response); };
  api.schoolTerms = async () => [{ start: '2020-01-01', end: '2020-01-07', label: '2020学期' }];
  return { api, calls, rows(value) { response = value; }, fail(value = true) { failure = value; } };
}

test('complete cache gains newly attended courses and removes only verified absent rows', async () => {
  const f = await fixture(), old = lesson('deleted'), unverified = lesson('old-unverified', '2019-11-10'), added = lesson('new'); f.rows([added]); await f.api.schedules(account('A'), '2020-01-01', '2020-01-07');
  const state = await f.api.attendanceHistory(account('A'), () => {}, { courses: [old, unverified], cursor: '2019-01-01', complete: true }); assert.deepEqual(state.courses.map(c => c.subId), ['new', 'old-unverified']); assert.equal(state.complete, true); assert.equal(f.calls.length, 1); assert.equal(state.scheduleOwner, 'A:112');
});

test('history progress and final result both remove deleted cache and keep fresh metadata', async () => {
  const f = await fixture(), retained = { ...lesson('keep'), title: 'Fresh name' }, outside = lesson('outside', '2019-10-10'); f.rows([retained, lesson('new', '2020-01-03')]); const updates = [];
  const state = await f.api.attendanceHistory(account('A'), (_, __, state) => updates.push(state), { courses: [lesson('deleted'), { ...retained, title: 'Old name' }, outside], cursor: '2020-01-07', complete: false }); assert.equal(updates.length, 1); assert.ok(updates[0].courses.every(c => c.subId !== 'deleted')); assert.equal(state.courses.find(c => c.subId === 'keep').title, 'Fresh name'); assert.ok(state.courses.some(c => c.subId === 'outside')); assert.ok(state.courses.some(c => c.subId === 'new'));
});

test('a failed official request never deletes cached attendance records', async () => {
  const f = await fixture(); f.fail(); const old = lesson('keep-on-error'); const state = await f.api.attendanceHistory(account('A'), () => {}, { courses: [old], cursor: '2020-01-07', complete: false }); assert.equal(state.failed, true); assert.deepEqual(state.courses.map(c => c.subId), ['keep-on-error']); assert.equal(f.api.verifiedSchedules[0].ok, false);
});

test('a newer failed overlapping request cancels deletion authority from an older empty response', async () => {
  const f = await fixture(); await f.api.schedules(account('A'), '2020-01-01', '2020-01-07'); f.fail(); const state = await f.api.attendanceHistory(account('A'), () => {}, { courses: [lesson('retain')], cursor: '2020-01-07', complete: false }); assert.equal(state.failed, true); assert.deepEqual(state.courses.map(c => c.subId), ['retain']);
});

test('switching account clears verified private records rather than adding the previous user courses', async () => {
  const f = await fixture(); f.rows([lesson('A-private')]); await f.api.schedules(account('A'), '2020-01-01', '2020-01-07'); const state = await f.api.attendanceHistory(account('B'), () => {}, { courses: [lesson('B-cache', '2019-01-01')], complete: true }); assert.deepEqual(state.courses.map(c => c.subId), ['B-cache']); assert.equal(f.api.verifiedSchedules.length, 0); assert.equal(f.api.scheduleScope, 'B:112'); assert.equal(Object.values(f.api).some(v => v === account('A').name), false);
});

test('tagged history from another account is rejected and rescanned', async () => {
  const f = await fixture(); f.rows([lesson('B-new')]); const state = await f.api.attendanceHistory(account('B'), () => {}, { courses: [lesson('A-private')], scheduleOwner: 'A:112', complete: true }); assert.deepEqual(state.courses.map(c => c.subId), ['B-new']); assert.equal(state.scheduleOwner, 'B:112');
});

test('snapshot storage is bounded and evicted windows stay unverified', async () => {
  const f = await fixture({ maxSnapshots: 2 }); await f.api.schedules(account('A'), '2020-01-01', '2020-01-07'); await f.api.schedules(account('A'), '2020-01-08', '2020-01-14'); await f.api.schedules(account('A'), '2020-01-15', '2020-01-21'); assert.equal(f.api.verifiedSchedules.length, 2); const state = await f.api.attendanceHistory(account('A'), () => {}, { courses: [lesson('old-window')], complete: true }); assert.equal(state.courses[0].subId, 'old-window'); f.api.reset(); assert.equal(f.api.verifiedSchedules.length, 0); assert.equal(f.api.scheduleScope, '');
});

test('per-run ledger keeps deleted courses removed even when global snapshots are evicted', async () => {
  const f = await fixture({ maxSnapshots: 1 }); f.api.schoolTerms = async () => [{ start: '2020-01-01', end: '2020-01-21', label: '学期' }]; const old = lesson('deleted-latest', '2020-01-20'), updates = [];
  const state = await f.api.attendanceHistory(account('A'), (_, __, state) => updates.push(state), { courses: [old], cursor: '2020-01-21', complete: false }); assert.equal(updates.length, 3); assert.ok(updates.every(state => !state.courses.some(c => c.subId === old.subId))); assert.equal(state.courses.length, 0); assert.equal(f.api.verifiedSchedules.length, 1);
});

test('a late response from the previous account cannot repopulate current snapshots', async () => {
  const f = await fixture(); let finish; const pending = new Promise(resolve => finish = resolve); f.api.request = async path => new URL('https://classroom.zju.edu.cn' + path).searchParams.get('user_id') === 'A' ? pending : json([lesson('B')]); const old = f.api.schedules(account('A'), '2020-01-01', '2020-01-07'); await f.api.schedules(account('B'), '2020-01-01', '2020-01-07'); finish(json([lesson('A')])); await assert.rejects(old, /账号已更换/); assert.deepEqual(f.api.verifiedSchedules[0].rows.map(c => c.subId), ['B']);
});

test('oversized truncated snapshots never falsely claim cached pages vanished', async () => {
  const f = await fixture({ maxRecords: 1 }); f.rows([lesson('first'), lesson('second')]); await f.api.schedules(account('A'), '2020-01-01', '2020-01-07'); const state = await f.api.attendanceHistory(account('A'), () => {}, { courses: [lesson('unknown')], complete: true }); assert.ok(state.courses.some(c => c.subId === 'unknown')); assert.equal(f.api.verifiedSchedules[0].authoritative, false);
});
