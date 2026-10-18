const test = require('node:test');
const assert = require('node:assert/strict');
const { runtime } = require('./runtime-helper.cjs');

async function waitFor(predicate, label) {
  const deadline = performance.now() + 2000;
  while (performance.now() < deadline) {
    const result = predicate();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail('Timed out waiting for ' + label);
}
function deferred() { let resolve; const promise = new Promise(done => resolve = done); return { promise, resolve }; }
async function authorizationFixture(t, { sessionBlocked = false, apiBlocked = false, holdIdentity = false, identityReadable = false } = {}) {
  const r = runtime({ extraTestingNames: ['boot', 'apiSetup', 'renderTools', 'refreshAccount'] });
  const original = r.win.native.call.bind(r.win.native);
  const originalOn = r.win.native.on.bind(r.win.native), loginListeners = new Set();
  r.win.native.on = (name, callback) => {
    const off = originalOn(name, callback);
    if (name === 'login') loginListeners.add(callback);
    return () => { off(); loginListeners.delete(callback); };
  };
  const identity = { id: 'fixture', name: 'Fixture', tenantId: 112, username: 'synthetic-account' };
  const gate = deferred(), authorizations = [];
  let apiAccountCalls = 0;
  r.win.native.call = (action, params = {}) => {
    if (action === 'keychainStatus') {
      original(action, params);
      return Promise.resolve({ authorizationRequired: sessionBlocked || apiBlocked, sessionAuthorizationRequired: sessionBlocked, apiAuthorizationRequired: apiBlocked });
    }
    if (action === 'identity') {
      original(action, params);
      if (params.text !== undefined) return Promise.resolve(true);
      const read = () => sessionBlocked && !identityReadable ? '' : JSON.stringify(identity);
      return holdIdentity ? gate.promise.then(read) : Promise.resolve(read());
    }
    if (action === 'authorizeCredentials') {
      original(action, params);
      const next = deferred();
      authorizations.push({ ...next, purpose: params.purpose });
      return next.promise.then(result => {
        if (result.ready) { if (params.purpose === 'api') apiBlocked = false; else sessionBlocked = false; }
        return result;
      });
    }
    if (action === 'secret' && params.text === undefined && !params.remove) {
      original(action, params);
      return Promise.resolve(apiBlocked ? '' : 'sk-synthetic-local-only-secret-123456');
    }
    return original(action, params);
  };
  const app = (await r.load('app.js')).testing;
  app.api.account = async () => { apiAccountCalls++; return identity; };
  t.after(async () => {
    gate.resolve();
    for (const pending of authorizations) pending.resolve({ ready: false, authorizationRequired: true });
    await new Promise(resolve => setImmediate(resolve));
    app.cleanup();
    await app.saveNotes();
    await new Promise(resolve => setImmediate(resolve));
    r.dom.window.close();
  });
  return { r, app, doc: r.win.document, gate, authorizations, accountCalls: () => apiAccountCalls, loginEvent: async () => { for (const callback of loginListeners) await callback({ ready: true }); } };
}
function findButton(doc, name, root = doc) { return [...root.querySelectorAll('button')].find(button => button.textContent === name); }

async function fixture(t, freshAccount, failure = false, saveFailure = false) {
  const r = runtime({ extraTestingNames: ['boot', 'renderTools'] });
  const original = r.win.native.call.bind(r.win.native);
  const stale = { id: 'fixture', name: 'Cached name', tenantId: 112, username: 'old-account' };
  let savedIdentity = stale;
  r.win.native.call = (action, params = {}) => {
    if (action === 'identity') {
      if (params.text !== undefined) { if (saveFailure) return Promise.reject(new Error('登录状态无法写入钥匙串')); savedIdentity = JSON.parse(params.text); return Promise.resolve(true); }
      return Promise.resolve(JSON.stringify(stale));
    }
    return original(action, params);
  };
  const app = (await r.load('app.js')).testing;
  app.api.account = async () => { if (failure) throw new Error('Offline'); return freshAccount; };
  t.after(() => { app.cleanup(); r.dom.window.close(); });
  return { r, app, identity: () => savedIdentity };
}

test('restored identity is refreshed even when the user id did not change', async t => {
  const real = { id: 'fixture', name: 'Fresh name', tenantId: 112, username: 'fresh-account' };
  const f = await fixture(t, real);
  await f.app.boot();
  assert.deepEqual(f.identity(), real);
  assert.deepEqual(JSON.parse(JSON.stringify(f.r.calls.filter(c => c[0] === 'toolbar').at(-1)[1])), { name: 'Fresh name', loggedIn: true });
  assert.ok(f.r.calls.some(([action, params]) => action === 'request' && params.url.includes('get-week-schedules')));
  assert.equal(f.r.calls.some(([action]) => action === 'logout'), false);
});

test('offline launch retains the account and local classroom instead of logging out', async t => {
  const f = await fixture(t, null, true);
  await f.app.boot();
  assert.equal(f.r.calls.some(([action]) => action === 'logout'), false);
  assert.equal(f.r.calls.filter(c => c[0] === 'toolbar').at(-1)[1].loggedIn, true);
  assert.equal(f.r.win.document.querySelector('.welcome'), null);
  assert.match(f.r.win.document.querySelector('#toast').textContent, /保留登录状态/);
  await f.app.go('offline');
  assert.equal(f.app.state().page, 'offline');
});

test('a keychain save failure is reported without preventing authenticated course reads', async t => {
  const f = await fixture(t, { id: 'fixture', name: 'Fresh name', tenantId: 112, username: 'fresh-account' }, false, true);
  await f.app.boot();
  assert.ok(f.r.calls.some(([action, params]) => action === 'request' && params.url.includes('get-week-schedules')));
  assert.match(f.r.win.document.querySelector('#toast').textContent, /钥匙串/);
  assert.equal(f.r.calls.some(([action]) => action === 'logout'), false);
});

test('a horizontal function row keeps its scroll position and mouse wheel never triggers page navigation', async t => {
  const f = await fixture(t, { id: 'fixture', tenantId: 112, name: 'Fixture' });
  f.app.setup();
  await f.app.enter(f.r.current);
  const tools = f.r.win.document.querySelector('#studyTools');
  Object.defineProperty(tools, 'scrollWidth', { value: 1600 });
  tools.scrollLeft = 150;
  f.app.renderTools();
  assert.equal(tools.scrollLeft, 150);
  const before = f.app.state().index;
  const wheel = new f.r.win.WheelEvent('wheel', { deltaY: 40, bubbles: true, cancelable: true });
  tools.dispatchEvent(wheel);
  assert.equal(tools.scrollLeft, 190);
  assert.equal(f.app.state().index, before);
  assert.equal(wheel.defaultPrevented, true);
});

test('a protected saved session renders immediate launch status and waits for an explicit restore click', async t => {
  const f = await authorizationFixture(t, { sessionBlocked: true, holdIdentity: true });
  const launching = f.app.boot();
  assert.match(f.doc.querySelector('.welcome').textContent, /正在恢复登录/);
  assert.equal(f.authorizations.length, 0);
  f.gate.resolve();
  await launching;
  assert.ok(findButton(f.doc, '恢复登录'));
  assert.ok(findButton(f.doc, '登录智云课堂'));
  assert.equal(f.accountCalls(), 0);
  assert.equal(f.r.calls.some(([action]) => action === 'authorizeCredentials'), false);
});

test('unavailable official session restoration opens official login once without guest probes or logout', async t => {
  const f = await authorizationFixture(t, { sessionBlocked: true });
  await f.app.boot();
  const restore = findButton(f.doc, '恢复登录');
  restore.click();
  await waitFor(() => f.authorizations.length === 1, 'one user-requested session authorization');
  assert.equal(restore.disabled, true);
  assert.equal(restore.textContent, '恢复中…');
  restore.click();
  assert.equal(f.authorizations.length, 1);
  f.authorizations[0].resolve({ ready: false, authorizationRequired: true });
  await waitFor(() => !restore.disabled && restore.textContent === '恢复登录', 'restore button after refusal');
  assert.equal(f.accountCalls(), 0);
  assert.equal(f.authorizations.length, 1);
  assert.equal(f.r.calls.filter(([action])=>action==='login').length,1);
  assert.equal(f.r.calls.some(([action])=>action==='logout'),false);
});

test('successful session restoration resumes the saved classroom without logout or a document reload', async t => {
  const f = await authorizationFixture(t, { sessionBlocked: true });
  await f.app.boot();
  const address = f.r.win.location.href;
  findButton(f.doc, '恢复登录').click();
  await waitFor(() => f.authorizations.length === 1, 'session restore request');
  assert.equal(f.authorizations[0].purpose, 'session');
  f.authorizations[0].resolve({ ready: true, authorizationRequired: false });
  await waitFor(() => f.r.calls.some(([action, params]) => action === 'request' && params.url.includes('get-week-schedules')), 'restored course request');
  assert.equal(f.doc.querySelector('.welcome'), null);
  assert.equal(f.r.win.location.href, address);
  assert.equal(f.r.calls.filter(([action]) => action === 'toolbar').at(-1)[1].loggedIn, true);
  assert.equal(f.authorizations.length, 1);
  assert.equal(f.r.calls.some(([action]) => action === 'logout' || action === 'login'), false);
});

test('blocked old API keys show in-app reconfiguration without any system authorization request', async t => {
  const f = await authorizationFixture(t, { apiBlocked: true });
  f.app.setup(); await f.app.enter(f.r.current); f.app.togglePane('notes');
  const editor=f.app.state().notesEditor;editor.insertFragment('Synthetic local note',true);
  f.app.togglePane('question');f.app.togglePane('summary');
  const input=await waitFor(()=>f.doc.querySelector('#questionBody input[type=password]'),'in-app key form');
  assert.match(f.doc.querySelector('#questionBody').textContent,/不会要求输入 Mac 密码/);
  assert.equal(findButton(f.doc,'恢复已保存的密钥'),undefined);
  const course=f.app.state().lesson.subId,page=f.app.state().index;
  input.value='sk-synthetic-reconfigured-key-123456';findButton(f.doc,'保存密钥',f.doc.querySelector('#questionBody')).click();
  await waitFor(()=>f.doc.querySelector('#questionBody').textContent.includes('Shift＋Enter'),'conversation after key save');
  assert.equal(f.app.state().lesson.subId,course);assert.equal(f.app.state().index,page);assert.equal(f.app.state().notesEditor,editor);
  assert.equal(f.authorizations.length,0);
  assert.equal(f.r.calls.some(([action,params])=>action==='secret'&&params.text===input.value),true);
});

test('closing and reopening a blocked API pane never starts interactive credential recovery',async t=>{
  const f=await authorizationFixture(t,{apiBlocked:true});f.app.setup();await f.app.enter(f.r.current);f.app.togglePane('question');
  await waitFor(()=>f.doc.querySelector('#questionBody input[type=password]'),'key form');
  f.app.togglePane('question');f.app.togglePane('question');
  await waitFor(()=>f.doc.querySelector('#questionBody input[type=password]'),'reopened key form');assert.equal(f.authorizations.length,0);
});

test('a readable identity with protected cookies keeps local pages available, blocks guest probes and still permits a new official login', async t => {
  const f = await authorizationFixture(t, { sessionBlocked: true, identityReadable: true });
  f.r.data.set('courses.json', JSON.stringify([f.r.current]));
  await f.app.boot();
  assert.equal(f.doc.querySelector('.welcome'), null);
  assert.equal(f.accountCalls(), 0);
  assert.equal(f.r.calls.some(([action]) => action === 'request'), false);
  assert.ok(f.doc.querySelector('#topActions [data-session-recovery]'));
  await f.app.go('offline');
  assert.equal(f.app.state().page, 'offline');
  assert.ok(f.doc.querySelector('#topActions [data-session-recovery]'));
  await f.app.go('cache');
  assert.equal(f.app.state().page, 'cache');
  assert.ok(f.doc.querySelector('#topActions [data-session-recovery]'));
  assert.equal(f.r.calls.some(([action]) => action === 'request'), false);
  await f.app.refreshAccount();
  await waitFor(() => f.r.calls.some(([action]) => action === 'request'), 'fresh official login requests');
  assert.equal(f.accountCalls(), 1);
  assert.equal(f.authorizations.length, 0);
  assert.equal(f.doc.querySelector('#topActions [data-session-recovery]'), null);
  assert.equal(f.r.calls.some(([action]) => action === 'logout'), false);
});

test('restoring only protected cookies refreshes online courses without changing the same-account study, player, notes or progress', async t => {
  const f = await authorizationFixture(t, { sessionBlocked: true, identityReadable: true });
  const key = f.app.courseKey(f.r.current);
  f.r.data.set('courses.json', JSON.stringify([f.r.current]));
  f.r.data.set('lesson-' + key + '.json', JSON.stringify({
    course: f.r.current,
    slides: [{ id: 'cached-a', t: 0, local: 'a.png' }, { id: 'cached-b', t: 60, local: 'b.png' }],
    lines: [{ id: 'local-line', t: 60, end: 100, text: 'Synthetic cached transcript', timing: 'history' }],
    videos: [{ id: 'cached-video', local: 'video.mp4', live: false, label: '课堂画面' }],
  }));
  await f.app.boot();
  await f.app.enter(f.r.current, { local: true });
  f.app.togglePane('notes');
  f.app.togglePane('video');
  const editor = f.app.state().notesEditor, stage = f.doc.querySelector('#stage'), player = f.doc.querySelector('#videoBody video');
  assert.ok(player);
  editor.insertFragment('Preserved study note', true);
  f.app.put({ at: 75, index: 1 });
  player.currentTime = 17;
  const restore = f.doc.querySelector('#topActions [data-session-recovery]');
  assert.ok(restore);
  restore.click();
  await waitFor(() => f.authorizations.length === 1, 'one protected-cookie recovery');
  assert.equal(f.doc.querySelector('#topActions [data-session-recovery]').disabled, true);
  assert.equal(f.authorizations[0].purpose, 'session');
  f.authorizations[0].resolve({ ready: true, authorizationRequired: false });
  await waitFor(() => !f.doc.querySelector('#topActions [data-session-recovery]'), 'restored online classroom');
  assert.equal(f.app.state().page, 'study');
  assert.equal(f.app.state().lesson.subId, f.r.current.subId);
  assert.equal(f.app.state().index, 1);
  assert.equal(f.app.state().at, 75);
  assert.equal(f.doc.querySelector('#stage'), stage);
  assert.equal(f.doc.querySelector('#videoBody video'), player);
  assert.equal(player.currentTime, 17);
  assert.equal(f.app.state().notesEditor, editor);
  assert.match(f.doc.querySelector('#notesBody').textContent, /Preserved study note/);
  assert.equal(f.accountCalls(), 1);
  assert.ok(f.r.calls.some(([action, params]) => action === 'request' && params.url.includes('get-week-schedules')));
  assert.equal(f.r.calls.some(([action]) => action === 'logout' || action === 'login'), false);
});

test('an expired but unprotected login offers official reauthentication without logout or repeated keychain authorization', async t => {
  const f = await authorizationFixture(t);
  f.app.api.account = async () => { throw new Error('登录失效，请重新登录'); };
  await f.app.boot();
  assert.equal(f.doc.querySelector('.welcome'), null);
  assert.ok(f.doc.querySelector('#topActions [data-session-recovery]'));
  f.doc.querySelector('#topActions [data-session-recovery]').click();
  await waitFor(()=>f.authorizations.length===1,'official session resume attempt');
  f.authorizations[0].resolve({ready:false,authorizationRequired:false,officialLoginRequired:true});
  await waitFor(() => f.r.calls.some(([action]) => action === 'login'), 'official reauthentication window');
  await waitFor(() => !f.doc.querySelector('#topActions [data-session-recovery]').disabled, 'restore control after official login opens');
  assert.equal(f.authorizations.length, 1);
  assert.equal(f.r.calls.some(([action]) => action === 'logout'), false);
  assert.equal(f.r.calls.filter(([action]) => action === 'toolbar').at(-1)[1].loggedIn, true);
});

test('a same-account official login event preserves the current study, video, note editor and learning position', async t => {
  const f = await authorizationFixture(t);
  const key = f.app.courseKey(f.r.current);
  f.r.data.set('lesson-' + key + '.json', JSON.stringify({
    course: f.r.current,
    slides: [{ id: 'cached-a', t: 0, local: 'a.png' }, { id: 'cached-b', t: 60, local: 'b.png' }],
    lines: [{ id: 'local-line', t: 60, end: 100, text: 'Synthetic cached transcript', timing: 'history' }],
    videos: [{ id: 'cached-video', local: 'video.mp4', live: false, label: '课堂画面' }],
  }));
  await f.app.boot();
  await f.app.enter(f.r.current, { local: true });
  f.app.togglePane('notes');
  f.app.togglePane('video');
  const editor = f.app.state().notesEditor, stage = f.doc.querySelector('#stage'), player = f.doc.querySelector('#videoBody video');
  editor.insertFragment('Keep this official-login note', true);
  f.app.put({ at: 75, index: 1 });
  player.currentTime = 17;
  const calls = f.r.calls.length;
  await f.loginEvent();
  assert.equal(f.app.state().page, 'study');
  assert.equal(f.app.state().lesson.subId, f.r.current.subId);
  assert.equal(f.app.state().index, 1);
  assert.equal(f.app.state().at, 75);
  assert.equal(f.doc.querySelector('#stage'), stage);
  assert.equal(f.doc.querySelector('#videoBody video'), player);
  assert.equal(player.currentTime, 17);
  assert.equal(f.app.state().notesEditor, editor);
  assert.match(f.doc.querySelector('#notesBody').textContent, /Keep this official-login note/);
  assert.equal(f.r.calls.slice(calls).some(([action]) => action === 'account' || action === 'read'), false);
  assert.equal(f.r.calls.slice(calls).some(([action]) => action === 'loginDone'), true);
  assert.equal(f.authorizations.length, 0);
});

test('the request guard distinguishes authentication expiry from network failures and course denial', async t => {
  const f = await authorizationFixture(t);
  await f.app.boot();
  const original = f.r.win.native.call.bind(f.r.win.native);
  let status = 403, networkError = false;
  f.r.win.native.call = (action, params) => action === 'request'
    ? networkError ? Promise.reject(new Error('网络暂时无法访问')) : Promise.resolve({ status, text: '{}' })
    : original(action, params);
  await assert.rejects(f.app.api.request('/synthetic-forbidden'), /访问权限/);
  assert.equal(f.doc.querySelector('#topActions [data-session-recovery]'), null);
  networkError = true;
  await assert.rejects(f.app.api.request('/synthetic-offline'), /网络暂时无法访问/);
  assert.equal(f.doc.querySelector('#topActions [data-session-recovery]'), null);
  networkError = false;
  status = 401;
  await assert.rejects(f.app.api.request('/synthetic-expired'), /登录失效/);
  assert.ok(f.doc.querySelector('#topActions [data-session-recovery]'));
  assert.equal(f.authorizations.length, 0);
});
