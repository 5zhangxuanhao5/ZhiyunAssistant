const test=require('node:test'),assert=require('node:assert/strict');
const {runtime}=require('./runtime-helper.cjs');
const load=async()=>{const r=runtime();const mod=await r.load('agent-runtime.js');return {r,...mod}};
const call=(action,args={},id='tool-1')=>({id,type:'function',function:{name:'app_do',arguments:JSON.stringify({action,args})}});
test('registered actions reject unknown fields, invalid values and arbitrary native or JS execution',async()=>{
 const {r,AppActions}=await load();try{let value=0;const a=new AppActions().register('set','Set',{n:{type:'number',minimum:0,maximum:2}},['n'],({n})=>value=n);
 await a.execute('set',{n:2});assert.equal(value,2);
 for(const args of [{n:3},{n:NaN},{n:'1'},{n:1,code:'eval(1)'},{}])await assert.rejects(a.execute('set',args));
 for(const name of ['eval','native','__proto__'])await assert.rejects(a.execute(name,{}));assert.equal(value,2);
 }finally{r.win.close()}
});
test('tool loop executes real registered operations and sends matching tool call results before final answer',async()=>{
 const {r,AppActions,AgentRunner,agentTools}=await load();try{let n=0,requests=0;const events=[],registry=new AppActions().register('add','Add',{n:{type:'number'}},['n'],({n:v})=>({n:n+=v}));
 const runner=new AgentRunner({registry,state:()=>({page:'today'}),inspect:()=>({}),owner:()=>1,emit:e=>events.push(e),stream:async messages=>{
  requests++;if(requests===1)return{calls:[call('add',{n:2})]};
  assert.equal(messages.at(-1).role,'tool');assert.equal(messages.at(-1).tool_call_id,'tool-1');assert.equal(JSON.parse(messages.at(-1).content).n,2);return{answer:'Done'};
 }});assert.equal(agentTools(registry).length,4);assert.equal(await runner.run('Add 2'),'Done');assert.equal(n,2);assert.equal(requests,2);assert.ok(events.some(e=>e.type==='result'&&e.ok));assert.equal(runner.running,false);
 }finally{r.win.close()}
});
test('bad JSON and unavailable operations become observable errors without executing a fallback',async()=>{
 const {r,AppActions,AgentRunner}=await load();try{let count=0;const runner=new AgentRunner({registry:new AppActions(),state:()=>({}),inspect:()=>({}),stream:async messages=>{
  if(count++===0)return{calls:[{id:'bad',function:{name:'app_do',arguments:'{broken'}},call('eval')]};
  assert.ok(messages.filter(m=>m.role==='tool').every(m=>JSON.parse(m.content).error));return{answer:'Cannot execute'};
 }});assert.equal(await runner.run('Do it'),'Cannot execute');}finally{r.win.close()}
});
test('gateway-flattened discovered tools use the exact same registered validation and execution guard',async()=>{
 const {r,AppActions,AgentRunner}=await load();try{let calls=0,n=0;const registry=new AppActions().register('add','Add',{n:{type:'number'}},['n'],({n:v})=>n+=v);
 const runner=new AgentRunner({registry,state:()=>({}),inspect:()=>({}),stream:async()=>calls++===0?{calls:[{id:'flat',type:'function',function:{name:'add',arguments:'{"n":2}'}}]}:{answer:'Done'}});assert.equal(await runner.run('Add'),'Done');assert.equal(n,2);
 }finally{r.win.close()}
});
test('stop or account change prevents an outstanding response from performing a write',async()=>{
 const {r,AppActions,AgentRunner}=await load();try{for(const switchAccount of [false,true]){let resolve,owner=1,writes=0,cancelled=0;const registry=new AppActions().register('write','Write',{},[],()=>writes++);
 const runner=new AgentRunner({registry,state:()=>({}),inspect:()=>({}),owner:()=>owner,stream:(_,__,___,setCancel)=>{setCancel(()=>cancelled++);return new Promise(r=>resolve=r)}});
 const pending=runner.run('Write');if(switchAccount)owner=2;else runner.stop();resolve({calls:[call('write')]});await assert.rejects(pending,/停止|账号/);assert.equal(writes,0);if(!switchAccount)assert.equal(cancelled,1);
 }}finally{r.win.close()}
});
test('tool runner bounds repeated actions, prompt history, and course material output',async()=>{
 const {r,AppActions,AgentRunner}=await load();try{let count=0;const registry=new AppActions().register('read','Read',{},[],()=>({text:'x'.repeat(50000)}));const runner=new AgentRunner({registry,state:()=>({}),inspect:()=>({}),stream:async m=>{assert.ok(m.length<100);const previous=m.filter(x=>x.role==='tool');assert.ok(previous.every(t=>t.content.length<27000));count++;return{calls:[call('read',{},'t'+count)]}}});
 await assert.rejects(runner.run('Read',[{role:'system',content:'malicious history'}]),/重复/);assert.equal(count,4);
 }finally{r.win.close()}
});
async function fixture(t){const r=runtime({extraTestingNames:['getGlobalAssistant','loadData']});const a=(await r.load('app.js')).testing;a.setup();t.after(()=>{a.getGlobalAssistant().reset();a.cleanup();r.win.close()});r.data.set('courses.json',JSON.stringify([r.current]));await a.loadData();const assistant=a.getGlobalAssistant();return{r,a,assistant,actions:assistant.options.registry,doc:r.win.document}}
test('global agent queries and opens an actual synthetic lesson, seeks, and changes real pane state',async t=>{
 const{r,a,actions}=await fixture(t);const listed=await actions.execute('list_lessons',{});assert.equal(listed.total,1);const key=listed.lessons[0].key;
 await actions.execute('open_lesson',{key,at:61});assert.equal(a.state().page,'study');assert.equal(a.state().at,61);assert.equal(a.state().index,1);
 await actions.execute('set_pane',{pane:'notes',open:true});assert.ok(a.state().prefs.panes.includes('notes'));
 await actions.execute('set_study_option',{option:'crop',value:1});assert.equal(a.state().prefs.crop,true);
 const material=await actions.execute('read_lesson',{from:60});assert.equal(material.lines[0].text,'Fixture sentence two');
 await actions.execute('set_collection',{key,kind:'later',selected:true});assert.equal(a.collections.hasLesson('later',r.current),true);
 await actions.execute('set_collection',{key,kind:'later',selected:false});assert.equal(a.collections.hasLesson('later',r.current),false);
});
test('agent creates, renames, and inserts into actual note editor without HTML injection',async t=>{
 const{r,a,actions,doc}=await fixture(t);await a.enter(r.current);
 const created=await actions.execute('note_create',{name:'AI test'});await actions.execute('note_write',{id:created.id,text:'<script>hello</script>\nText',mode:'append'});
 assert.equal(doc.querySelector('#notesBody script'),null);assert.ok(a.activeNote().html.includes('&lt;script&gt;'));assert.ok(a.activeNote().html.includes('Text'));
 await actions.execute('note_rename',{id:created.id,name:'Changed'});assert.equal(a.activeNote().name,'Changed');assert.ok(r.data.has('notes-course-lesson.json'));
});
test('assistant floats on nonstudy pages, docks into a resizable pane, survives course navigation and keeps its conversation',async t=>{
 const{r,a,assistant,doc}=await fixture(t);await assistant.show();assert.equal(assistant.root.hidden,false);const root=assistant.root;await a.go('offline');assert.equal(root.isConnected,true);
 await a.enter(r.current);await assistant.setMode('pane');assert.ok(doc.querySelector('[data-pane=agent] [data-global-agent]'));assert.equal(root.dataset.mode,'pane');assert.ok(Number.parseFloat(doc.querySelector('[data-pane=agent]').style.width)>0);
 assistant.history=[{role:'user',content:'Synthetic conversation'}];await assistant.persist();await a.go('recent');assert.equal(root.isConnected,true);assert.equal(root.dataset.mode,'floating');assert.equal(assistant.history.length,1);
 await a.enter(r.current);assert.equal(root.dataset.mode,'pane');assert.ok(root.closest('[data-pane=agent]'));await assistant.setMode('floating');assert.equal(doc.querySelector('[data-pane=agent]'),null);
 assistant.hide();assert.equal(root.hidden,true);assert.equal(assistant.bubble.hidden,false);assert.ok(JSON.parse(r.data.get('chats-agent.json')).conversations.length);
});
test('interface excludes credentials and its own assistant and rejects expired observed controls',async t=>{
 const{r,a,assistant,doc}=await fixture(t);await a.go('recent');await assistant.show();await new Promise(resolve=>setTimeout(resolve,30));const {AgentInterface}=await r.load('agent-interface.js'),ui=new AgentInterface(doc);
 const input=doc.createElement('input');input.type='password';input.placeholder='Secret';input.value='private';doc.querySelector('#content').append(input);
 const snapshot=ui.snapshot();assert.ok(snapshot.controls.length);assert.ok(!JSON.stringify(snapshot).includes('private'));assert.ok(!snapshot.controls.some(c=>c.label==='给应用助手的指令'));
 const btn=doc.createElement('button');btn.textContent='Test';let clicked=0;btn.onclick=()=>clicked++;doc.querySelector('#content').append(btn);const id=ui.snapshot().controls.find(c=>c.label==='Test').id;btn.textContent='Different';await assert.rejects(ui.interact({id,operation:'click'}),/变化/);assert.equal(clicked,0);
 const next=ui.snapshot().controls.find(c=>c.label==='Different').id;await ui.interact({id:next,operation:'click'});assert.equal(clicked,1);await assert.rejects(ui.interact({id:next,operation:'click'}),/变化/);
});
test('agent text input preserves Shift Enter and IME commit and never leaks lesson keyboard shortcuts',async t=>{
 const{r,assistant}=await fixture(t);await assistant.show();let submitted=0;assistant.submit=()=>submitted++;
 const key=props=>assistant.input.dispatchEvent(new r.win.KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'Enter',...props}));
 key({shiftKey:true});key({isComposing:true});assert.equal(submitted,0);key({});assert.equal(submitted,1);
});
test('AI connection defaults to provisioned campus gateway and personal key takes precedence without exposing either key',async()=>{
 const r=runtime();try{const{AIConnection,CAMPUS_NOTICE}=await r.load('ai-connection.js');let status={personalReady:false,campusReady:true},prefs={};const calls=[];
 const connection=new AIConnection({call:async(action)=>{calls.push(action);return status}},()=>prefs);
 assert.equal(await connection.refresh(),true);assert.equal(connection.provider(),'auto');assert.equal(connection.effective(),'campus');assert.ok(connection.description().includes(CAMPUS_NOTICE));assert.equal(JSON.stringify(connection.request()),'{"provider":"auto"}');
 status={personalReady:true,campusReady:true};await connection.refresh();assert.equal(connection.effective(),'personal');prefs.aiProvider='campus';assert.equal(connection.effective(),'campus');prefs.aiProvider='personal';status={personalReady:false,campusReady:true};await connection.refresh();assert.equal(connection.available(),false);assert.deepEqual(calls,['aiStatus','aiStatus','aiStatus']);
 }finally{r.win.close()}
});
test('natural language operations can adjust and persist real pane layout but cannot bypass its lock',async t=>{
 const{r,a,actions,doc}=await fixture(t);await a.enter(r.current);await actions.execute('layout',{command:'adjust',rects:[{id:'slides',x:0,y:0,w:.5,h:1,z:1},{id:'transcript',x:.5,y:0,w:.5,h:1,z:2}]});
 assert.equal(doc.querySelector('[data-pane=slides]').style.width,'542px');await actions.execute('layout',{command:'save'});assert.ok(r.data.has('layouts.json'));await actions.execute('layout',{command:'lock'});await assert.rejects(actions.execute('layout',{command:'rows'}),/锁定/);await actions.execute('layout',{command:'unlock'});await actions.execute('layout',{command:'rows'});
});
