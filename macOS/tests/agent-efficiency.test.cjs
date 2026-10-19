const test=require('node:test'),assert=require('node:assert/strict');
const {runtime}=require('./runtime-helper.cjs');
const wait=(ms=10)=>new Promise(resolve=>setTimeout(resolve,ms));
const call=(action,args={},extra={},id='tool-1')=>({id,type:'function',function:{name:'app_do',arguments:JSON.stringify({action,args,...extra})}});
const load=async()=>{const r=runtime();const mod=await r.load('agent-runtime.js');return {r,...mod}};
async function start(t){const r=runtime({extraTestingNames:['getGlobalAssistant','loadData']});const app=(await r.load('app.js')).testing;app.setup();t.after(async()=>{await wait(40);app.getGlobalAssistant?.()?.reset();app.cleanup();r.win.close()});return{r,app,doc:r.win.document,actions:app.getGlobalAssistant().options.registry}}

test('a one-step task finishes in a single model round when the action carries the reply',async()=>{
 const{r,AppActions,AgentRunner}=await load();try{let requests=0,mode='light';const events=[];
 const registry=new AppActions().register('set_theme','设置外观',{mode:{type:'string',enum:['system','light','dark']}},[],({mode:m})=>({mode:mode=m}));
 const runner=new AgentRunner({registry,state:()=>({}),inspect:()=>({}),emit:e=>events.push(e),stream:async messages=>{requests++;assert.match(messages[0].content,/set_theme\(mode\?:system\|light\|dark\)/);return{calls:[call('set_theme',{mode:'system'},{reply:'已改为跟随系统。'})]}}});
 assert.equal(await runner.run('变成系统色'),'已改为跟随系统。');assert.equal(requests,1);assert.equal(mode,'system');assert.equal(events.filter(e=>e.type==='done').length,1);
 }finally{r.win.close()}
});
test('a reply is ignored when an operation in the round failed, so the model can recover',async()=>{
 const{r,AppActions,AgentRunner}=await load();try{let requests=0;
 const registry=new AppActions().register('fail','Fail',{},[],()=>{throw new Error('不行')});
 const runner=new AgentRunner({registry,state:()=>({}),inspect:()=>({}),stream:async messages=>{requests++;if(requests===1)return{calls:[call('fail',{},{reply:'完成了'})]};assert.ok(JSON.parse(messages.at(-1).content).error);return{answer:'没能完成：不行'}}});
 assert.equal(await runner.run('做'),'没能完成：不行');assert.equal(requests,2);
 }finally{r.win.close()}
});
test('a timed-out round is retried once; other failures and a second timeout end the task',async()=>{
 const{r,AppActions,AgentRunner}=await load();try{
 let attempts=0;const events=[];const ok=new AgentRunner({registry:new AppActions(),state:()=>({}),inspect:()=>({}),emit:e=>events.push(e),stream:async()=>{if(attempts++===0)throw new Error('校园网关：请求超时。仅在浙大内网环境下可用');return{answer:'好了'}}});
 assert.equal(await ok.run('你好'),'好了');assert.equal(attempts,2);assert.equal(events.filter(e=>e.type==='retry').length,1);
 attempts=0;const twice=new AgentRunner({registry:new AppActions(),state:()=>({}),inspect:()=>({}),stream:async()=>{attempts++;throw new Error('The request timed out.')}});
 await assert.rejects(twice.run('你好'),/timed out/);assert.equal(attempts,2);
 attempts=0;const denied=new AgentRunner({registry:new AppActions(),state:()=>({}),inspect:()=>({}),stream:async()=>{attempts++;throw new Error('身份验证未通过（401）')}});
 await assert.rejects(denied.run('你好'),/401/);assert.equal(attempts,1);
 }finally{r.win.close()}
});
test('the catalogue gives every registered action with its parameters, so no lookup round is needed',async t=>{
 const{r,actions}=await start(t);const{actionCatalogue}=await r.load('agent-runtime.js');const text=actionCatalogue(actions);
 assert.equal(text.split('\n').length,actions.actions.size);
 for(const line of ['set_theme(theme?:str, mode?:system|light|dark, list?:bool)','search_material(query:str','notes_edit(key:str, mode:append|create|replace|rename','ui(operation:click|fill|select|focus|scroll, label:str'])assert.ok(text.includes(line),line);
});
test('ui operates a control by its visible name in one step and reports the page that results',async t=>{
 const{r,app,doc,actions}=await start(t);await app.loadData();await app.go('today');
 const result=await actions.execute('ui',{operation:'click',label:'近两周'});assert.equal(app.state().page,'recent');assert.equal(result.page,'我的课堂');
 await assert.rejects(actions.execute('ui',{operation:'click',label:'不存在的按钮'}),/没有“不存在的按钮”.*近两周/);
 const input=doc.createElement('input');input.type='password';input.setAttribute('aria-label','校园密码');doc.querySelector('#content').append(input);
 await assert.rejects(actions.execute('ui',{operation:'fill',label:'校园密码',value:'x'}),/没有/);
});
test('notes_edit writes, creates and renames notes of another lesson in the background',async t=>{
 const{r,app,actions}=await start(t);const other={...r.current,subId:'other',courseId:'c-other',title:'另一门课'},key=app.courseKey(other);app.put({courses:[r.current,other]});
 r.data.set('notes-'+key+'.json',JSON.stringify([{id:'n1',name:'第一篇',html:'<div>旧内容</div>',updatedAt:1,course:other}]));
 await actions.execute('notes_edit',{key,mode:'append',text:'新要点\n第二行 <b>'});await wait(20);
 let saved=JSON.parse(r.data.get('notes-'+key+'.json'));assert.ok(saved[0].html.includes('旧内容'));assert.ok(saved[0].html.includes('新要点<br>第二行 &lt;b&gt;'));assert.equal(app.state().page,'recent');
 const created=await actions.execute('notes_edit',{key,mode:'create',name:'复习提纲',text:'一、概念'});await wait(20);saved=JSON.parse(r.data.get('notes-'+key+'.json'));assert.equal(saved.length,2);assert.equal(saved[0].name,'复习提纲');
 await actions.execute('notes_edit',{key,mode:'rename',note:created.id,name:'期末复习'});await wait(20);assert.equal(JSON.parse(r.data.get('notes-'+key+'.json'))[0].name,'期末复习');
 await assert.rejects(actions.execute('notes_edit',{key,mode:'replace',text:'全新'}),/confirm:true/);
 assert.ok(JSON.parse(r.data.get('notes-index.json')).some(row=>row.key===key&&row.count===2),'the notes index lists the lesson');
});
