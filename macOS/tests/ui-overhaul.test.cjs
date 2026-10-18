const test=require('node:test'),assert=require('node:assert/strict');
const {runtime}=require('./runtime-helper.cjs');
const wait=(ms=10)=>new Promise(resolve=>setTimeout(resolve,ms));
// Course permission checks finish asynchronously; let them settle before the window closes.
async function start(t,names=[]){const r=runtime({extraTestingNames:names});const app=(await r.load('app.js')).testing;app.setup();t.after(async()=>{await wait(40);app.getGlobalAssistant?.()?.reset();app.cleanup();r.win.close()});return{r,app,doc:r.win.document}}
const lessonAt=(r,offsetDays,id)=>{const now=Math.floor(Date.now()/1000)+offsetDays*86400;return{...r.current,subId:id,courseId:'c-'+id,title:'课次 '+id,start:now-600,end:now+3000}};

test('近两周 lists the past two weeks and today, never tomorrow',async t=>{
 const{r,app,doc}=await start(t);app.put({courses:[lessonAt(r,-3,'past'),lessonAt(r,0,'today'),lessonAt(r,1,'tomorrow')]});
 await app.go('recent');const titles=[...doc.querySelectorAll('.course-card h3')].map(n=>n.textContent);
 assert.ok(titles.includes('课次 past')&&titles.includes('课次 today'));assert.ok(!titles.includes('课次 tomorrow'));
 assert.equal(doc.querySelector('.classroom-intro .intro-count').textContent,'2');
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
test('campus AI limits are explained once per account at first use, then never again',async t=>{
 const{r,app,doc}=await start(t,['notifyCampusAI']);app.put({prefs:{aiProvider:'campus'}});
 app.notifyCampusAI();assert.match(doc.querySelector('#toast').textContent,/校内 AI.*内网.*OCR/);assert.equal(app.state().prefs.campusLimitsSeen,true);await wait();
 assert.equal(JSON.parse(r.data.get('prefs.json')).campusLimitsSeen,true);
 doc.querySelector('#toast').textContent='';app.notifyCampusAI();assert.equal(doc.querySelector('#toast').textContent,'');
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
 r.win.__confirm=()=>true;const result=await actions.execute('assistant_history',{command:'clear'});assert.equal(result.cleared,true);
 assert.equal(assistant.runner.running,true);assert.ok(!assistant.log.textContent.includes('旧回答'));assert.ok(assistant.log.textContent.includes('清空助手聊天记录'));
 release();await running;const saved=JSON.parse(r.data.get('chats-agent.json')).conversations;assert.equal(saved.length,1);assert.deepEqual(saved[0].turns.map(t=>t.content).join('|'),'清空助手聊天记录|已清空');
 assert.equal(doc.querySelector('#modal').hidden,true);
});
test('background operations read notes and clear caches without navigating',async t=>{
 const{r,app}=await start(t,['getGlobalAssistant']);const actions=app.getGlobalAssistant().options.registry,key=app.courseKey(r.current);
 r.data.set('notes-index.json',JSON.stringify([{key,course:r.current,count:1,updatedAt:5}]));r.data.set('notes-'+key+'.json',JSON.stringify([{id:'n',name:'第一篇',html:'<div>要点</div>'}]));
 await app.go('recent');const index=await actions.execute('notes_index',{});assert.equal(index[0].key,key);const notes=await actions.execute('notes_read',{key});assert.equal(notes[0].text,'要点');assert.equal(app.state().page,'recent');
 r.win.__confirm=()=>true;await actions.execute('cache_clear',{category:'question'});assert.ok(r.calls.some(([a,p])=>a==='cache'&&p.clear&&p.category==='question'));assert.equal(app.state().page,'recent');
 r.win.__confirm=()=>false;await assert.rejects(actions.execute('cache_clear',{category:'all'}),/取消/);
});
test('privacy opens as a compact sheet with the four data topics',async t=>{
 const{app,doc}=await start(t,['privacy']);app.privacy();
 assert.equal(doc.querySelector('#modalTitle').textContent,'隐私与数据');assert.ok(doc.querySelector('.modal-shell').classList.contains('compact'));
 assert.equal(doc.querySelectorAll('.privacy-card').length,4);assert.match(doc.querySelector('.privacy-page').textContent,/不保存密码.*钥匙串.*API 费用.*断网不会自动退出登录/s);
});
