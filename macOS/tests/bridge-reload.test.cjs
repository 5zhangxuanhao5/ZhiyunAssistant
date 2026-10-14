const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const source = fs.readFileSync(path.join(__dirname, '../web/bridge.js'), 'utf8');

function documentBridge() {
  const messages = [], window = { crypto: { randomUUID }, webkit: { messageHandlers: { native: { postMessage: message => messages.push(message) } } } };
  vm.runInNewContext(source, { window });
  return { bridge: window.native, messages };
}

test('a late reply from an old WebKit document cannot complete the new identity request', async () => {
  const before = documentBridge(), after = documentBridge();
  const oldRequest = before.bridge.call('identity'), newRequest = after.bridge.call('identity');
  let completed = false;
  newRequest.then(() => { completed = true; });
  assert.notEqual(oldRequest.id, newRequest.id);
  after.bridge.receive({ id: oldRequest.id, value: 'Old identity' });
  await Promise.resolve();
  assert.equal(completed, false);
  after.bridge.receive({ id: newRequest.id, value: 'New identity' });
  assert.equal(await newRequest, 'New identity');
  before.bridge.receive({ id: oldRequest.id, value: 'Old identity' });
  assert.equal(await oldRequest, 'Old identity');
});

test('request cancellation uses the exact document-scoped id', async () => {
  const f = documentBridge(), task = f.bridge.call('request', { url: 'https://classroom.zju.edu.cn/fixture' });
  const cancel = f.bridge.call('cancelRequest', { id: task.id });
  assert.equal(f.messages[1].params.id, f.messages[0].id);
  assert.notEqual(cancel.id, task.id);
  f.bridge.receive({ id: cancel.id, value: true });
  f.bridge.receive({ id: task.id, error: 'Cancelled' });
  assert.equal(await cancel, true);
  await assert.rejects(task, /Cancelled/);
});
