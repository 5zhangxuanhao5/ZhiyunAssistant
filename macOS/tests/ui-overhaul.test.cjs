const test=require('node:test'),assert=require('node:assert/strict');
const {runtime}=require('./runtime-helper.cjs');
const wait=(ms=10)=>new Promise(resolve=>setTimeout(resolve,ms));
// Course permission checks finish asynchronously; let them settle before the window closes.
async function start(t,names=[]){const r=runtime({extraTestingNames:names});const app=(await r.load('app.js')).testing;app.setup();t.after(async()=>{await wait(40);app.getGlobalAssistant?.()?.reset();app.cleanup();r.win.close()});return{r,app,doc:r.win.document}}
const lessonAt=(r,offsetDays,id)=>{const now=Math.floor(Date.now()/1000)+offsetDays*86400;return{...r.current,subId:id,courseId:'c-'+id,title:'课次 '+id,start:now-600,end:now+3000}};

test('近两周 lists only the days before today; today and tomorrow are left to 今日课表',async t=>{
 const{r,app,doc}=await start(t);app.put({courses:[lessonAt(r,-3,'past'),lessonAt(r,0,'today'),lessonAt(r,1,'tomorrow')]});
 await app.go('recent');const titles=[...doc.querySelectorAll('.course-card h3')].map(n=>n.textContent);
 assert.deepEqual(titles.join(),'课次 past');
 assert.equal(doc.querySelector('.classroom-intro .intro-count').textContent,'1');
 await app.go('today');assert.deepEqual([...doc.querySelectorAll('.course-card h3')].map(n=>n.textContent).join(),'课次 today');
 assert.match(doc.querySelector('.section-heading').dataset.day,/^今天 · 周/);
});
test('study tools share the header row and leave with the lesson',async t=>{
 const{r,app,doc}=await start(t);await app.enter(r.current);
 assert.ok(doc.querySelector('#topbar > #studyTools'));assert.equal(doc.querySelector('#content #studyTools'),null);assert.ok(doc.querySelector('#topbar > #studyTools').nextElementSibling===doc.querySelector('#topActions'));
 await app.go('recent');assert.equal(doc.querySelector('#studyTools'),null);
});
test('summary and question options sit in their pane header instead of an extra row',async t=>{
 const{r,app,doc}=await start(t);await app.enter(r.current);app.togglePane('summary');app.togglePane('question');
 assert.ok(doc.querySelector('[data-pane=summary] > .pane-header > .summary-options'));assert.ok(doc.querySelector('[data-pane=question] > .pane-header > .question-options'));
 assert.equal(doc.querySelector('[data-pane=summary] > .summary-options, [data-pane=question] > .question-options'),null);
 assert.equal(doc.querySelector('.ai-service-note'),null);
});
test('campus AI first use shows a persistent notice with network, expiry and personal API advice',async t=>{
 const{r,app,doc}=await start(t,['notifyCampusAI']);app.put({prefs:{aiProvider:'campus',campusLimitsSeen:true}});
 app.notifyCampusAI();let notice=doc.querySelector('.campus-welcome');assert.ok(notice);assert.match(notice.textContent,/校园网.*效果可能不佳.*(?:自己的|个人).*DeepSeek.*2026 年 11 月 1 日/s);
 assert.notEqual(app.state().prefs.campusOnboarding20261101,true);app.notifyCampusAI();assert.equal(doc.querySelectorAll('.campus-welcome').length,1);
 notice.querySelector('button').click();await wait();assert.equal(JSON.parse(r.data.get('prefs.json')).campusOnboarding20261101,true);assert.equal(doc.querySelector('.campus-welcome'),null);app.notifyCampusAI();assert.equal(doc.querySelector('.campus-welcome'),null);
});
test('assistant history drops empty chats, deletes one chat and clears all with confirmation',async t=>{
 const{r,app,doc}=await start(t,['getGlobalAssistant','loadData']);const assistant=app.getGlobalAssistant();await assistant.show();
 await assistant.newConversation();assert.equal(JSON.parse(r.data.get('chats-agent.json')).conversations.length,0);
 assistant.history=[{role:'user',content:'第一段'},{role:'assistant',content:'好的'}];await assistant.persist();const first=assistant.currentId;
 await assistant.newConversation();assistant.history=[{role:'user',content:'第二段'}];await assistant.persist();
 assistant.showHistory();assert.equal(doc.querySelectorAll('.agent-history-item').length,2);assert.ok([...doc.querySelectorAll('.agent-subhead button')].some(b=>b.textContent==='清空记录'));
 assert.equal(await assistant.deleteConversation(first),true);assert.equal(JSON.parse(r.data.get('chats-agent.json')).conversations.length,1);assert.equal(doc.querySelectorAll('.agent-history-item').length,1);
 r.win.__confirm=()=>false;assert.equal(await assistant.clearHistory(),false);assert.equal(assistant.messages.length,1);
 r.win.__confirm=()=>true;assert.equal(await assistant.clearHistory(),true);assert.equal(JSON.parse(r.data.get('chats-agent.json')).conversations.length,0);assert.ok(doc.querySelector('.agent-welcome'));
});
test('clearing assistant records in the background keeps the running task and its request',async t=>{
 const{r,app,doc}=await start(t,['getGlobalAssistant','loadData']);const assistant=app.getGlobalAssistant(),actions=assistant.options.registry;await assistant.show();
 assistant.history=[{role:'user',content:'旧对话'},{role:'assistant',content:'旧回答'}];assistant.renderHistory();await assistant.persist();
 let release;r.win.native.call=((call)=>(action,params)=>action==='aiStatus'?Promise.resolve({personalReady:true,campusReady:false}):call(action,params))(r.win.native.call.bind(r.win.native));
 assistant.runner.stream=async()=>{await new Promise(resolve=>release=resolve);return{answer:'已清空',calls:[]}};
 assistant.input.value='清空助手聊天记录';const running=assistant.submit();await wait(20);
 let asked=0;r.win.__confirm=()=>{asked++;return true};await assert.rejects(actions.execute('assistant_history',{command:'clear'}),/confirm:true/);const result=await actions.execute('assistant_history',{command:'clear',confirm:true});assert.equal(result.cleared,true);assert.equal(asked,0,'an explicit request needs no dialog');
 assert.equal(assistant.runner.running,true);assert.ok(!assistant.log.textContent.includes('旧回答'));assert.ok(assistant.log.textContent.includes('清空助手聊天记录'));
 release();await running;const saved=JSON.parse(r.data.get('chats-agent.json')).conversations;assert.equal(saved.length,1);assert.deepEqual(saved[0].turns.map(t=>t.content).join('|'),'清空助手聊天记录|已清空');
 assert.equal(doc.querySelector('#modal').hidden,true);
});
test('background operations read notes and clear caches without navigating',async t=>{
 const{r,app}=await start(t,['getGlobalAssistant']);const actions=app.getGlobalAssistant().options.registry,key=app.courseKey(r.current);
 r.data.set('notes-index.json',JSON.stringify([{key,course:r.current,count:1,updatedAt:5}]));r.data.set('notes-'+key+'.json',JSON.stringify([{id:'n',name:'第一篇',html:'<div>要点</div>'}]));
 await app.go('recent');const index=await actions.execute('notes_index',{});assert.equal(index[0].key,key);const notes=await actions.execute('notes_read',{key});assert.equal(notes[0].text,'要点');assert.equal(app.state().page,'recent');
 let asked=0;r.win.__confirm=()=>{asked++;return true};await actions.execute('cache_clear',{category:'question',confirm:true});assert.ok(r.calls.some(([a,p])=>a==='cache'&&p.clear&&p.category==='question'));assert.equal(app.state().page,'recent');assert.equal(asked,0);
 const before=r.calls.filter(([a,p])=>a==='cache'&&p.clear).length;await assert.rejects(actions.execute('cache_clear',{category:'all'}),/不可撤销/);assert.equal(r.calls.filter(([a,p])=>a==='cache'&&p.clear).length,before,'nothing is cleared without the user\'s explicit request');
});
test('privacy opens as a compact sheet with the four data topics',async t=>{
 const{app,doc}=await start(t,['privacy']);app.privacy();
 assert.equal(doc.querySelector('#modalTitle').textContent,'隐私与数据');assert.ok(doc.querySelector('.modal-shell').classList.contains('compact'));
 assert.equal(doc.querySelectorAll('.privacy-card').length,4);assert.match(doc.querySelector('.privacy-page').textContent,/不保存密码.*加密快照.*API 费用.*断网不会自动退出登录/s);
});
test('a course page lists its lessons from the first to the last, upcoming ones at the end',async t=>{
 const{r,app,doc}=await start(t,['openGroup']);const rows=[lessonAt(r,7,'next'),lessonAt(r,-14,'first'),lessonAt(r,-7,'second')].map(c=>({...c,courseId:'same'}));
 app.api.chapters=async()=>rows;await app.openGroup(rows[0],rows);await wait(20);
 assert.equal(app.state().page,'chapters');assert.deepEqual([...doc.querySelectorAll('.course-card h3')].map(n=>n.textContent).join(),'课次 first,课次 second,课次 next');
});
test('course tiles have no artwork and lesson rows always show their favourite and later marks',async t=>{
 const{r,app,doc}=await start(t);app.put({courses:[lessonAt(r,-1,'one')]});await app.go('recent');
 const row=doc.querySelector('.lesson-row');const marks=[...row.querySelectorAll('.actions > button.icon')];assert.equal(marks.length,2);
 const css=require('node:fs').readFileSync(require('node:path').join(__dirname,'../web/app.css'),'utf8');assert.ok(!/lesson-row[^{]*\.icon[^{]*\{[^}]*opacity:\s*0/.test(css),'inactive marks are never hidden');
 assert.ok(!/course-art/.test(css));assert.equal(doc.querySelector('.course-art'),null);
});
test('lessons that have not started cannot be downloaded from the batch list, the queue or the assistant',async t=>{
 const{r,app,doc}=await start(t,['getGlobalAssistant','batchDownload','states']);const past=lessonAt(r,-1,'done'),future=lessonAt(r,2,'future');app.put({courses:[past,future]});
 for(const c of [past,future])app.states[c.subId]='allowed';
 app.batchDownload([past,future]);await wait(20);const labels=[...doc.querySelectorAll('#modalBody label')].map(n=>n.textContent).join('|');
 assert.ok(labels.includes('课次 done'));assert.ok(!labels.includes('课次 future'));app.closeModal();
 const actions=app.getGlobalAssistant().options.registry;await assert.rejects(actions.execute('download_lesson',{key:app.courseKey(future),slides:true,transcript:true,video:false}),/尚未开始/);
});
