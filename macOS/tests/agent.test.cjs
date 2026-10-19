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
 assistant.floatingControl.select(true);await a.enter(r.current);assert.equal(root.dataset.mode,'pane');assert.equal(assistant.floatingControl.selected,false);assert.ok(root.closest('[data-pane=agent]'));await assistant.setMode('floating');assert.equal(doc.querySelector('[data-pane=agent]'),null);
 assistant.hide();assert.equal(root.hidden,true);assert.equal(assistant.bubble.hidden,true,'an idle minimised assistant leaves no floating entry');assert.ok(JSON.parse(r.data.get('chats-agent.json')).conversations.length);
 await assistant.show();assert.equal(assistant.history.length,1);
});
test('a task minimised mid-run shows its progress in a small status bubble until the result is read',async t=>{
 const{r,assistant}=await fixture(t);await assistant.show();
 r.win.native.call=((call)=>(action,params)=>action==='aiStatus'?Promise.resolve({personalReady:true,campusReady:false}):call(action,params))(r.win.native.call.bind(r.win.native));
 let release,requests=0;assistant.runner.stream=async()=>{if(requests++===0)return{calls:[call('list_lessons',{limit:1})]};await new Promise(resolve=>release=resolve);return{answer:'找到了'}};
 assistant.input.value='找课程';const running=assistant.submit();await new Promise(resolve=>setTimeout(resolve,30));
 assistant.hide();assert.equal(assistant.bubble.hidden,false);assert.match(assistant.bubble.textContent,/正在执行 · 1 步/);assert.ok(assistant.bubble.querySelector('.agent-spinner'));
 release();await running;assert.equal(assistant.bubble.hidden,false);assert.match(assistant.bubble.textContent,/已完成/);
 assistant.bubble.click();await new Promise(resolve=>setTimeout(resolve,20));assert.equal(assistant.root.hidden,false);assert.equal(assistant.bubble.hidden,true);
 assistant.hide();assert.equal(assistant.bubble.hidden,true,'a read result does not bring the bubble back');
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
test('action discovery understands Chinese intent, returns all capability summaries and paginates exact schemas',async()=>{
 const{r,AppActions,findActions}=await load();try{const registry=new AppActions();for(let i=0;i<25;i++)registry.register('action_'+i,i===22?'设置笔记颜色背景。':'读取课程 '+i,{},[],()=>{});
 const found=findActions(registry,{search:'帮我修改笔记颜色'});assert.equal(found.actions[0].action,'action_22');const index=findActions(registry,{});assert.equal(index.overview.length,25);assert.equal(index.actions.length,10);assert.equal(index.next,10);assert.equal(findActions(registry,{names:['action_22']}).actions.length,1);
 }finally{r.win.close()}
});
test('thinking tool protocol retains every reasoning fragment without exposing it as visible output',async()=>{
 const{r,AppActions,AgentRunner}=await load();try{let n=0;const events=[],registry=new AppActions().register('read','Read',{},[],()=>({ok:true}));const runner=new AgentRunner({registry,state:()=>({page:'today'}),inspect:()=>({}),emit:e=>events.push(e),stream:async messages=>{if(n++===0)return{calls:[call('read')],reasoning_content:'private-protocol-fragment'};assert.equal(messages.find(m=>m.tool_calls)?.reasoning_content,'private-protocol-fragment');return{answer:'完成'};}});assert.equal(await runner.run('读取'),'完成');assert.ok(!JSON.stringify(events).includes('private-protocol-fragment'));
 }finally{r.win.close()}
});
test('truncated model output cannot execute a partially generated action',async()=>{
 const{r,AppActions,AgentRunner}=await load();try{let writes=0;const registry=new AppActions().register('write','Write',{},[],()=>writes++);const runner=new AgentRunner({registry,state:()=>({}),inspect:()=>({}),stream:async()=>({finish_reason:'length',calls:[call('write')]})});await assert.rejects(runner.run('写入'),/达到上限/);assert.equal(writes,0);}finally{r.win.close()}
});
test('assistant collapses intermediate narration into one expandable activity and preserves the final result',async t=>{
 const{assistant,doc}=await fixture(t);await assistant.show();assistant.addTurn('user','整理');assistant.startProgress();assistant.event({type:'delta',text:'长篇中间叙述'});assistant.event({type:'step',action:'note_write'});assistant.event({type:'result',ok:true});assistant.event({type:'delta',text:'已整理。'});assistant.event({type:'done',text:'已整理。'});
 assert.equal(doc.querySelectorAll('.agent-progress').length,1);assert.equal(doc.querySelector('.agent-progress').open,false);assert.ok(!assistant.log.textContent.includes('长篇中间叙述'));assert.ok(assistant.log.textContent.includes('已整理。'));assert.equal(assistant.activity().steps[0].ok,true);
 assistant.history=[{role:'assistant',content:'已整理。',activity:assistant.activity()}];assistant.renderHistory();assert.equal(doc.querySelector('.agent-progress').open,false);
});
test('AI settings render thinking choices and keep an explicit campus provider when provisioning a key',async t=>{
 const{r,assistant,doc}=await fixture(t);await assistant.show();await assistant.settings();assert.equal(doc.querySelector('[aria-label="助手思考强度"]')?.options.length,3);const source=doc.querySelector('[aria-label="AI服务来源"]');source.value='campus';source.dispatchEvent(new r.win.Event('change'));await new Promise(resolve=>setTimeout(resolve,10));assert.equal(doc.querySelector('[aria-label="助手思考强度"]').closest('label').hidden,true);
 const entry=doc.querySelector('[aria-label="校园网关密钥"]');entry.value='synthetic-campus-local-key';[...doc.querySelectorAll('.agent-gateway-config button')].find(b=>b.textContent.includes('保存到本机')).click();await new Promise(resolve=>setTimeout(resolve,20));assert.equal(assistant.options.provider(),'campus');
});
test('expanded commands operate notes, colour and common feature order through production handlers',async t=>{
 const{a,actions}=await fixture(t);await a.enter({courseId:'course',subId:'lesson',title:'Synthetic Course',start:1700000000,end:1700003600,status:'6'});const note=await actions.execute('note_create',{name:'第二篇'});await actions.execute('note_open',{id:note.id});assert.equal(a.activeNote().id,note.id);await actions.execute('note_palette',{source:'mine',color:'#EAF5ED'});assert.equal(a.state().prefs.notePalette.mine,'#EAF5ED');await actions.execute('set_common_features',{order:['notes','transcript','summary']});assert.deepEqual(Array.from(a.state().prefs.commonOrder),['notes','transcript','summary']);await actions.execute('note_insert_transcript',{from:0,to:59});assert.ok(a.activeNote().html.includes('Fixture sentence one'));await actions.execute('note_delete',{id:note.id});assert.ok(!a.state().notes.some(n=>n.id===note.id));
});
test('interface can open disclosure controls and paginate without making hidden credentials available',async t=>{
 const{r,doc}=await fixture(t);const{AgentInterface}=await r.load('agent-interface.js');const details=doc.createElement('details');details.innerHTML='<summary>更多选项</summary><button>测试按钮</button>';doc.querySelector('#content').append(details);const ui=new AgentInterface(doc),snapshot=ui.snapshot({offset:0,limit:1});assert.equal(snapshot.controls.length,1);const item=ui.snapshot({limit:150}).controls.find(c=>c.label==='更多选项');assert.ok(item);await ui.interact({id:item.id,operation:'click'});assert.equal(details.open,true);
});
test('course index and background materials avoid navigating away from the user lesson',async t=>{
 const{a,actions}=await fixture(t);const before=a.state().page,list=await actions.execute('list_courses',{});assert.equal(list.total,1);const key=list.courses[0].keys[0];const result=await actions.execute('read_material',{key,from:60,limit:1});assert.equal(result.lines[0].text,'Fixture sentence two');assert.equal(a.state().page,before);assert.ok(result.pages.length);
});

test('floating assistant requires its grip, resizes from all eight directions and deselects on content or outside press',async t=>{
 const{r,assistant,doc}=await fixture(t);await assistant.show();const root=assistant.root,control=assistant.floatingControl,grip=assistant.dragHandle;
 root.getBoundingClientRect=()=>({left:parseFloat(root.style.left),top:parseFloat(root.style.top),width:parseFloat(root.style.width),height:parseFloat(root.style.height)});
 const initial={left:200,top:100,width:450,height:400},pointer=(node,type,x,y,kind='mouse')=>{const e=new r.win.MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientX:x,clientY:y});Object.defineProperties(e,{pointerId:{value:18},pointerType:{value:kind}});node.dispatchEvent(e);};
 const drag=(node,dx,dy,kind)=>{pointer(node,'pointerdown',300,200,kind);pointer(root,'pointermove',300+dx,200+dy,kind);pointer(root,'pointerup',300+dx,200+dy,kind);};
 control.apply(initial);drag(root.querySelector('.agent-head'),30,20);assert.deepEqual(root.getBoundingClientRect(),initial);assert.equal(control.selected,false);
 drag(root.querySelector('[data-agent-edge=e]'),30,20);assert.deepEqual(root.getBoundingClientRect(),initial);
 drag(grip,30,20,'touch');assert.equal(control.selected,true);assert.equal(root.getBoundingClientRect().left,230);assert.equal(root.getBoundingClientRect().top,120);
 for(const edge of ['n','s','w','e','nw','ne','sw','se']){control.apply(initial);drag(root.querySelector('[data-agent-edge='+edge+']'),20,15);const box=root.getBoundingClientRect();assert.equal(box.left,200+(edge.includes('w')?20:0),edge);assert.equal(box.top,100+(edge.includes('n')?15:0),edge);assert.equal(box.width,450+(edge.includes('e')?20:edge.includes('w')?-20:0),edge);assert.equal(box.height,400+(edge.includes('s')?15:edge.includes('n')?-15:0),edge);}
 pointer(assistant.input,'pointerdown',310,210);assert.equal(control.selected,false);const before=root.getBoundingClientRect();drag(root.querySelector('[data-agent-edge=e]'),30,0);assert.deepEqual(root.getBoundingClientRect(),before);
 pointer(grip,'pointerdown',300,200);pointer(root,'pointerup',300,200);pointer(doc.body,'pointerdown',10,10);assert.equal(control.selected,false);assert.equal(grip.getAttribute('aria-pressed'),'false');
 await assistant.persistDisplay();assert.deepEqual(JSON.parse(r.data.get('agent-display.json')).geometry,root.getBoundingClientRect());assert.equal(doc.querySelector('.agent-suggestion'),null);assert.equal(r.calls.filter(c=>c[0]==='ai').length,0);
});
test('floating assistant geometry keeps the opposite resize edge fixed and its top grip reachable',async()=>{
 const r=runtime();try{const{resizeFloatingPane,floatingPaneBounds}=await r.load('parity-interactions.js');const base={left:200,top:100,width:450,height:400};
 const minimum=resizeFloatingPane(base,1000,1000,'nw',1200,900);assert.equal(minimum.width,300);assert.equal(minimum.height,250);assert.equal(minimum.left+minimum.width,650);assert.equal(minimum.top+minimum.height,500);
 const offscreen=floatingPaneBounds({...base,left:-1000,top:-1000},1200,900);assert.equal(offscreen.top,0);assert.equal(offscreen.left+offscreen.width,40);
 const small=floatingPaneBounds(base,280,220);assert.equal(small.width,264);assert.equal(small.height,204);
 }finally{r.win.close()}
});
test('docking and minimising cancel floating adjustment and preserve the saved frame',async t=>{
 const{r,a,assistant}=await fixture(t);await assistant.show();const control=assistant.floatingControl;control.select(true);await a.enter(r.current);await assistant.setMode('pane');assert.equal(control.selected,false);control.select(true);assert.equal(control.selected,false);await assistant.setMode('floating');control.select(true);assistant.hide();assert.equal(control.selected,false);assert.equal(assistant.root.hidden,true);
});
test('agent run stays folded with one live status, never shows interim model text, then shows only the final reply',async t=>{
 const{r,assistant,doc}=await fixture(t);await assistant.show();assistant.addTurn('user','打开设计心理学');assistant.startProgress();
 const progress=doc.querySelector('.agent-progress');assert.equal(progress.open,false);assert.equal(progress.dataset.state,'running');
 assistant.event({type:'turn',index:0});assistant.event({type:'delta',text:'我先找课程。'});assert.equal(progress.querySelector('.agent-progress-label').textContent,'正在思考…');assert.ok(!assistant.log.textContent.includes('我先找课程'));
 assistant.event({type:'step',name:'app_do',action:'list_lessons',args:{query:'设计'}});const running=doc.querySelector('.agent-step[data-state=running]');assert.ok(running);assert.match(running.textContent,/查找课次.*设计/);
 assistant.event({type:'result',ok:true,action:'list_lessons',output:{total:3,lessons:[]}});assert.equal(doc.querySelector('.agent-step[data-ok=true] .agent-step-result').textContent,'3 节');
 assistant.event({type:'turn',index:1});assert.equal(progress.querySelector('.agent-progress-label').textContent,'正在思考下一步…');
 assistant.event({type:'delta',text:'我再看看。'});assert.equal(progress.querySelector('.agent-progress-label').textContent,'正在思考下一步…');
 const musing='页码时间戳超过了视频长度，也许课程时间与视频时间不同，我再跳转一次看看。\n继续核对第二页的时间。'.repeat(3);assistant.event({type:'delta',text:musing});assert.equal(progress.querySelector('.agent-progress-label').textContent,'正在整理回答…');assert.equal(doc.querySelectorAll('.agent-turn.assistant .agent-message').length,0);assert.ok(!assistant.log.textContent.includes('页码时间戳'));
 assistant.event({type:'step',name:'app_do',action:'open_lesson',args:{key:'course-lesson',at:61}});assert.match(doc.querySelectorAll('.agent-step')[1].textContent,/进入课程.*Synthetic Course.*1:01/);
 assistant.event({type:'result',ok:false,action:'open_lesson',error:'没有权限'});assistant.event({type:'done',text:'已找到 **3 节**，但无法进入。'});
 assert.equal(progress.open,false);assert.equal(progress.dataset.state,'done');assert.match(progress.querySelector('.agent-progress-meta').textContent,/2 步 · 1 项未成功/);
 assert.equal(doc.querySelector('.agent-step[data-ok=false] .agent-step-error').textContent,'没有权限');assert.equal(doc.querySelector('.agent-turn.assistant .agent-message strong').textContent,'3 节');assert.ok(!assistant.log.textContent.includes('我先找课程'));assert.ok(!assistant.log.textContent.includes('页码时间戳'));assert.equal(doc.querySelectorAll('.agent-turn.assistant .agent-message').length,1);assert.ok(doc.querySelector('.agent-turn.assistant .agent-message').classList.contains('arrived'));
 const activity=assistant.activity();assert.equal(activity.steps[0].result,'3 节');assert.match(activity.steps[1].detail,/Synthetic Course/);assert.equal(activity.steps[1].ok,false);
 assistant.history=[{role:'assistant',content:'已找到。',activity}];assistant.renderHistory();assert.equal(doc.querySelectorAll('.agent-step').length,2);assert.equal(doc.querySelector('.agent-progress').open,false);assert.equal(r.calls.filter(c=>c[0]==='ai').length,0);
});
test('stopping during a step marks it unfinished and keeps one stopped summary',async t=>{
 const{assistant,doc}=await fixture(t);await assistant.show();assistant.addTurn('user','写笔记');assistant.startProgress();assistant.event({type:'step',name:'app_do',action:'note_write',args:{text:'abc',mode:'append'}});
 assert.match(doc.querySelector('.agent-step[data-state=running]').textContent,/写入笔记.*追加 3 字/);assistant.stop();
 const progress=doc.querySelector('.agent-progress');assert.equal(progress.dataset.state,'stopped');assert.equal(doc.querySelectorAll('.agent-step[data-state=running]').length,0);assert.equal(doc.querySelectorAll('.agent-step[data-ok=false]').length,1);assert.equal(assistant.status.textContent,'已停止');assert.equal(assistant.sendButton.hidden,false);
});
test('runtime reports each model round and the validated arguments and output of every step',async()=>{
 const{r,AppActions,AgentRunner}=await load();try{const events=[];let requests=0;const registry=new AppActions().register('add','Add',{n:{type:'number'}},['n'],({n})=>({n}));
 const runner=new AgentRunner({registry,state:()=>({}),inspect:()=>({}),emit:e=>events.push(e),stream:async()=>requests++===0?{calls:[call('add',{n:2})]}:{answer:'Done'}});await runner.run('Add');
 assert.equal(events.filter(e=>e.type==='turn').length,2);assert.deepEqual(events.find(e=>e.type==='step').args,{n:2});assert.deepEqual(events.find(e=>e.type==='result').output,{n:2});
 }finally{r.win.close()}
});
