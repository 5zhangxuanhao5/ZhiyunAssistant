const test=require('node:test'),assert=require('node:assert/strict');
const {runtime}=require('./runtime-helper.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const row=i=>({courseId:'86206-fixture',subId:'l'+i,title:'Synthetic Theory',teacher:'Fixture',start:1700000000+i*3600,end:1700003600+i*3600,status:'6'});
async function appFixture(t){const r=runtime({extraTestingNames:['getGlobalAssistant','seek','toast']});const app=(await r.load('app.js')).testing;app.setup();t.after(async()=>{await wait(40);app.getGlobalAssistant().reset();app.cleanup();r.win.close()});return{r,app,actions:app.getGlobalAssistant().options.registry};}
async function searchFixture(t,extra={}){const r=runtime();t.after(()=>r.win.close());const{searchCourseMaterial}=await r.load('agent-search.js');return options=>searchCourseMaterial({query:'媒介',candidates:[],cached:async()=>null,permissions:async rows=>Object.fromEntries(rows.map(c=>[c.courseId+'-'+c.subId,'allowed'])),transcript:async()=>[],persist:async()=>{},date:c=>String(c.start),...extra,...options});}

test('a broad cached keyword searches over sixty lessons in one bounded action without new requests',async t=>{
 const search=await searchFixture(t);const courses=Array.from({length:120},(_,i)=>row(i));let reads=0,permissions=0;
 const start=performance.now();const result=await search({candidates:courses,cached:async()=>{reads++;return{data:{lines:Array.from({length:9},(_,i)=>({t:i*60,text:'媒介概念'+i}))}}},permissions:async()=>{permissions++;throw Error('not needed')}});
 assert.equal(reads,120);assert.equal(result.scanned,120);assert.equal(result.found,360);assert.equal(result.lessons.length,60);assert.equal(result.omittedLessons,60);assert.equal(result.complete,true);assert.equal(result.next,null);assert.equal(permissions,0);assert.ok(performance.now()-start<1000);assert.ok(JSON.stringify(result).length<26000);assert.equal(result.lessons[0].hits.length,3);
});
test('a slow uncached lesson cannot hide older cached matches, and the deadline cancels only its own work',async t=>{
 const search=await searchFixture(t);let late,aborted=false,writes=0;
 const result=await search({candidates:[row(1),row(2)],budgetMs:45,cached:async c=>c.subId==='l2'?{data:{lines:[{t:90,text:'媒介理论'}]}}:null,
  transcript:async(c,signal)=>{signal.addEventListener('abort',()=>aborted=true);return new Promise(r=>late=r)},persist:async()=>writes++});
 assert.equal(result.lessons[0].key,'86206-fixture-l2');assert.equal(result.budgetExceeded,true);assert.equal(result.pendingCount,1);assert.equal(result.complete,false);assert.equal(aborted,true);assert.ok(result.elapsedMs<500);late([{t:300,text:'媒介'}]);await wait(15);assert.equal(writes,0);
});
test('failed or unverified permissions never authorize transcript requests or masquerade as empty matches',async t=>{
 const search=await searchFixture(t);let fetches=0;
 const result=await search({candidates:[row(1),row(2)],permissions:async()=>({'86206-fixture-l1':'denied'}),transcript:async()=>fetches++});
 assert.equal(fetches,0);assert.equal(result.skippedCount,2);assert.equal(result.complete,false);assert.match(result.skipped[1].reason,/未能确认/);
});
test('one search discovers missing lessons in the same course and caches their catalogue without opening a page',async t=>{
 const{r,app,actions}=await appFixture(t);const a=row(1),b=row(2);app.put({courses:[a]});let catalogues=0,batches=0;
 app.api.background=signal=>({async chapters(c,hydrate){catalogues++;assert.equal(hydrate,false);return[a,b]},async permissions(rows,progress){batches++;const states=Object.fromEntries(rows.map(c=>[c.subId,'allowed']));progress(states,rows.map(c=>c.subId));return states},async transcripts(){return[{t:890,text:'媒介历史'}]},dispose(){}});
 const first=await actions.execute('search_material',{courseId:a.courseId,query:'媒介'});assert.equal(first.candidates,2);assert.equal(first.lessons.length,2);assert.equal(first.complete,true);assert.equal(app.state().page,'recent');assert.equal(catalogues,1);assert.equal(batches,1);
 const known=await actions.execute('list_lessons',{query:'Synthetic Theory'});assert.ok(known.lessons.some(c=>c.key===b.courseId+'-'+b.subId),'discovered hits remain addressable by open_lesson');
 const second=await actions.execute('search_material',{courseId:a.courseId,query:'媒介'});assert.equal(second.lessons.length,2);assert.equal(second.fetched,0);assert.equal(catalogues,1);assert.equal(batches,1);
});
test('fresh permission failure does not reuse an old allowed result from the permissions adapter',async t=>{
 const{app,actions}=await appFixture(t);app.put({courses:[row(1)]});let fetches=0;
 app.api.background=()=>({async permissions(rows,progress){progress({l1:'allowed'},[]);return{l1:'allowed'}},async transcripts(){fetches++;return[]},dispose(){}});
 const result=await actions.execute('search_material',{query:'媒介'});assert.equal(fetches,0);assert.equal(result.skippedCount,1);assert.match(result.skipped[0].reason,/未能确认/);
});
test('opening the already-open lesson seeks without requests, a new history entry or editor replacement',async t=>{
 const{r,app,actions}=await appFixture(t);await app.enter(r.current);app.togglePane('notes');const editor=app.state().notesEditor,panes=[...app.state().prefs.panes];
 await actions.execute('note_write',{text:'Keep this draft',mode:'append'});const before=r.calls.length;
 await actions.execute('open_lesson',{key:app.courseKey(r.current),at:61});assert.equal(app.state().at,61);assert.equal(app.state().index,1);assert.equal(app.state().notesEditor,editor);assert.deepEqual([...app.state().prefs.panes],panes);assert.ok(app.activeNote().html.includes('Keep this draft'));assert.ok(!r.calls.slice(before).some(([a])=>a==='request'));
 await actions.execute('open_lesson',{key:app.courseKey(r.current)});assert.equal(app.state().at,61);await app.back();assert.equal(app.state().page,'recent');
});
test('background search cancellation never cancels the main client and no fallback starts after abort',async t=>{
 const r=runtime();t.after(()=>r.win.close());const{MacZhiyun}=await r.load('mac-api.js');const main=new MacZhiyun(),controller=new r.win.AbortController(),background=main.background(controller.signal);const pending=new Map(),cancels=[];let n=0;
 r.win.native.call=(action,p)=>{if(action==='cancelRequest'){cancels.push(p.id);pending.get(p.id)?.reject(Error('The operation was cancelled.'));return Promise.resolve(true)}const id='request-'+(++n);const promise=new Promise((resolve,reject)=>pending.set(id,{resolve,reject}));promise.id=id;return promise};
 const visible=main.request('/visible');const search=background.transcripts(row(1));await wait(1);const stopped=assert.rejects(search,/已取消/);controller.abort();await stopped;assert.deepEqual(cancels,['request-2']);pending.get('request-1').resolve({status:200,text:'{"code":0}'});await visible;assert.equal(n,2);background.dispose();
});
test('search stop signals reach pending actions and repeated identical searches reuse their result within the run',async t=>{
 const r=runtime();t.after(()=>r.win.close());const{AppActions,AgentRunner}=await r.load('agent-runtime.js');let scans=0,turns=0;
 const call=id=>({id,function:{name:'app_do',arguments:JSON.stringify({action:'search_material',args:turns===2?{query:'媒介',offset:6}:{query:'媒介'}})}});
 const registry=new AppActions().register('search_material','Search',{query:{type:'string'},offset:{type:'number'}},['query'],async()=>{scans++;return{complete:true,next:null,omittedLessons:0,lessons:[{date:'2000-01-01',hits:[{clock:'00:14:50'}]}]}});
 const runner=new AgentRunner({registry,state:()=>({}),inspect:()=>({}),stream:async()=>++turns<3?{calls:[call('t'+turns)]}:{answer:'14:50'}});assert.equal(await runner.run('查找媒介'),'14:50');assert.equal(scans,1);
 let started,aborted=false;const active=new AppActions().register('slow','Slow',{},[],(_,guard)=>new Promise(resolve=>{guard.signal.addEventListener('abort',()=>{aborted=true;resolve({})});started?.()}));
 const slow=new AgentRunner({registry:active,state:()=>({}),inspect:()=>({}),stream:async()=>({calls:[{id:'slow',function:{name:'app_do',arguments:'{"action":"slow","args":{}}'}}]})});
 const ready=new Promise(resolve=>started=resolve),running=slow.run('运行');await ready;slow.stop();await assert.rejects(running,/停止/);assert.equal(aborted,true);
});
test('English timeout and old offline errors are Chinese on every displayed surface; expected cancellation stays quiet',async t=>{
 const{r,app}=await appFixture(t);const{userMessage}=await r.load('user-errors.js');
 for(const text of ['The request timed out.','The Internet connection appears to be offline.','The network connection was lost.','Failed to fetch','Load failed','Error Domain=NSURLErrorDomain Code=-1001'])assert.ok(/[\u4e00-\u9fff]/.test(userMessage(text)));
 app.toast('The request timed out.');assert.equal(r.win.document.querySelector('#toast').textContent,'网络请求超时，请稍后重试');r.win.document.querySelector('#toast').classList.remove('show');app.toast('请求已取消');assert.equal(r.win.document.querySelector('#toast').classList.contains('show'),false);
 const assistant=app.getGlobalAssistant();await assistant.show();assistant.notice('The request timed out.','error');assert.ok(!assistant.log.textContent.includes('timed out'));assert.match(assistant.log.textContent,/网络请求超时/);
 const{OfflineDownloads}=await r.load('parity-library.js');const manager=new OfflineDownloads({owner:'fixture',native:r.win.native,api:app.api,write:async()=>{}});await manager.load([{course:row(1),state:'failed',message:'The request timed out.',missing:['课件：The request timed out.'],planErrors:{slides:'Load failed'},files:[{name:'x.png',error:'The network connection was lost.'}]}]);
 const restored=manager.rows[0];assert.match(restored.message,/网络请求超时/);assert.match(restored.missing[0],/^课件：网络请求超时/);assert.match(restored.files[0].error,/网络连接中断/);assert.match(restored.planErrors.slides,/网络请求失败/);await manager.dispose();
});
