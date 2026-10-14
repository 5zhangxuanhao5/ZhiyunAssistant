const test = require('node:test');
const assert = require('node:assert/strict');
const { runtime } = require('./runtime-helper.cjs');

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
