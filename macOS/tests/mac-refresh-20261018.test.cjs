const test=require('node:test');
const assert=require('node:assert/strict');
const {runtime}=require('./runtime-helper.cjs');
test('every study feature uses one matching icon including active buttons',async t=>{
 const r=runtime({extraTestingNames:['renderTools','showSettings','loadData']});const a=(await r.load('app.js')).testing;a.setup();t.after(()=>{a.cleanup();r.win.close()});await a.enter(r.current);
 const all=['slides','transcript','video','notes','question','summary','agent','crop','duplicates','skip','smartSkip','follow','overview','time','page','download','layout'];
 a.put({prefs:{commonOrder:all}});a.renderTools();
 for(const id of all){const b=r.win.document.querySelector('#studyTools [data-feature="'+id+'"]');assert.ok(b,id);assert.equal(b.querySelectorAll('.ui-icon').length,1,id);assert.equal(b.querySelector('.ui-icon').dataset.uiIcon,id)}
 a.showSettings();assert.ok(r.win.document.querySelector('.modal-shell.learning-settings'));assert.equal(r.win.document.querySelectorAll('.common-row').length,all.length);
});
test('one sidebar keeps the classroom first, the plaza last and settings apart',async t=>{
 const r=runtime();const a=(await r.load('app.js')).testing;a.setup();t.after(()=>{a.cleanup();r.win.close()});await a.go('recent');
 const nav=r.win.document.querySelector('#navigation'),labels=[...nav.querySelectorAll(':scope > button')].map(n=>n.textContent);
 assert.deepEqual(labels,['我的课堂','课程收藏','稍后再看','离线课程','笔记管理','课程广场','外观','缓存设置']);
 assert.ok(nav.querySelector('.nav-spacer').compareDocumentPosition(nav.querySelector('[title=课程广场]'))&r.win.Node.DOCUMENT_POSITION_PRECEDING);
 assert.equal(nav.querySelector('button.active').textContent,'我的课堂');assert.equal(nav.querySelector('.nav-brand,.nav-footer'),null);await new Promise(resolve=>setTimeout(resolve,40));
});
test('saved retired model choices migrate once to current documented identifiers',async t=>{
 const r=runtime({extraTestingNames:['loadData']});const a=(await r.load('app.js')).testing;a.setup();t.after(()=>{a.cleanup();r.win.close()});
 for(const [old,current] of [['deepseek-chat','deepseek-flash'],['deepseek-v4-flash','deepseek-flash'],['deepseek-v4-flash-vision-exp','deepseek-flash'],['deepseek-reasoner','deepseek-v4-pro'],['deepseek-pro','deepseek-v4-pro']]){
  r.data.set('prefs.json',JSON.stringify({model:old}));await a.loadData();assert.equal(a.state().prefs.model,current);assert.equal(JSON.parse(r.data.get('prefs.json')).model,current);
 }
});

test('an expired recovered session proceeds to official authentication without logging out',async t=>{
 const r=runtime({extraTestingNames:['updateSessionRecovery','restoreSignedInSession']});const a=(await r.load('app.js')).testing;a.setup();t.after(()=>{a.cleanup();r.win.close()});
 const original=r.win.native.call.bind(r.win.native);r.win.native.call=(action,params)=>action==='authorizeCredentials'?Promise.resolve({ready:true,authorizationRequired:false}):original(action,params);
 a.api.account=async()=>{throw new Error('登录失效，请重新登录')};a.updateSessionRecovery(true);await a.restoreSignedInSession();
 assert.equal(r.calls.filter(([action])=>action==='login').length,1);assert.equal(r.calls.filter(([action])=>action==='logout').length,0);
});
