const test=require('node:test'),assert=require('node:assert/strict');
const {runtime}=require('./runtime-helper.cjs');
const wait=(ms=10)=>new Promise(resolve=>setTimeout(resolve,ms));
async function start(t){const r=runtime({extraTestingNames:['getGlobalAssistant','seek']});const app=(await r.load('app.js')).testing;app.setup();t.after(async()=>{await wait(40);app.getGlobalAssistant?.()?.reset();app.cleanup();r.win.close()});return{r,app,actions:app.getGlobalAssistant().options.registry}}
const past=(r,days,id)=>{const start=Math.floor(Date.now()/1000)-days*86400;return{...r.current,subId:id,courseId:'c-'+id,title:'信号与系统 '+id,start,end:start+3600,status:'6'}};
// The recording runs past its 60-minute timetable slot.
const signals=a=>({course:a,slides:[{id:'s1',t:0,url:'https://cmc.zju.edu.cn/1.png',note:'第一章 信号'},{id:'s2',t:4000,url:'https://cmc.zju.edu.cn/2.png',note:'傅里叶变换的性质'}],lines:[{t:30,end:40,text:'今天先讲信号'},{t:4010,end:4020,text:'接下来是傅里叶变换'},{t:4021,end:4030,text:'它的线性性质'}]});

test('the assistant finds where content was taught from the cache, without opening any lesson',async t=>{
 const{r,app,actions}=await start(t),a=past(r,2,'fourier'),b=past(r,1,'laplace');app.put({courses:[a,b]});
 r.data.set('lesson-'+app.courseKey(a)+'.json',JSON.stringify(signals(a)));
 r.data.set('lesson-'+app.courseKey(b)+'.json',JSON.stringify({course:b,slides:[],lines:[{t:5,end:9,text:'拉普拉斯变换'}]}));
 const before=r.calls.length;
 const found=await actions.execute('search_material',{query:'傅里叶'});
 assert.equal(app.state().page,'recent');assert.equal(app.state().lesson,null);
 assert.ok(!r.calls.slice(before).some(([action])=>action==='request'),'cached lessons need no network');
 assert.equal(found.lessons.length,1);assert.equal(found.lessons[0].key,app.courseKey(a));
 assert.deepEqual({t:found.lessons[0].hits[0].t,clock:found.lessons[0].hits[0].clock,from:found.lessons[0].hits[0].from},{t:4010,clock:'01:06:50',from:'转写'});
 assert.match(found.time,/课程时间/);assert.equal(found.next,null);
 // Keywords may fall on neighbouring caption lines.
 assert.equal((await actions.execute('search_material',{query:'傅里叶 线性'})).found,1);
 const none=await actions.execute('search_material',{query:'卷积'});assert.equal(none.found,0);assert.ok(none.hint);
 const slideOnly=await actions.execute('search_material',{query:'第一章'});assert.equal(slideOnly.lessons[0].hits[0].from,'课件');
 const scoped=await actions.execute('search_material',{query:'变换',course:'laplace'});assert.deepEqual(scoped.lessons.map(l=>l.key).join(),app.courseKey(b));
 const material=await actions.execute('read_material',{key:app.courseKey(a)});assert.equal(material.length,4030);assert.equal(material.pages[1].clock,'01:06:40');assert.equal(material.pages[1].text,'傅里叶变换的性质');
});
test('uncached lessons are searched together with one fresh permission batch and bounded transcript concurrency',async t=>{
 const{r,app,actions}=await start(t),rows=Array.from({length:12},(_,i)=>past(r,i+1,'l'+i));app.put({courses:rows});
 let allow=false,batches=0,active=0,peak=0,transcripts=0,slides=0;
 app.api.background=signal=>({
  async permissions(values,progress,force){assert.equal(force,true);batches++;const state=Object.fromEntries(values.map(c=>[c.subId,allow?'allowed':'denied']));progress(state,values.map(c=>c.subId));return state},
  async transcripts(c){transcripts++;active++;peak=Math.max(peak,active);await wait(8);active--;return [{t:30,end:40,text:'Fixture keyword'}]},
  async slides(){slides++;return []},dispose(){},
 });
 const denied=await actions.execute('search_material',{query:'Fixture'});
 assert.equal(denied.found,0);assert.equal(denied.skippedCount,12);assert.match(denied.skipped[0].reason,/权限/);assert.equal(transcripts,0);
 allow=true;const first=await actions.execute('search_material',{query:'Fixture'});
 assert.equal(first.fetched,12);assert.equal(first.next,null);assert.equal(first.lessons.length,12);assert.equal(first.complete,true);assert.equal(app.state().page,'recent');assert.equal(peak,2);assert.equal(slides,0);assert.equal(batches,2);
 assert.ok(r.data.has('search-transcript-'+app.courseKey(rows[0])+'.json'),'search transcripts have a separate cache, not an incomplete lesson cache');
 const again=await actions.execute('search_material',{query:'Fixture'});assert.equal(again.fetched,0);assert.equal(again.lessons.length,12);assert.equal(batches,2);
});
test('without a course name only the own timetable is searched, not browsed plaza courses',async t=>{
 const{r,app,actions}=await start(t),mine=past(r,1,'mine'),plaza={...past(r,1,'plaza'),title:'别人的课'};app.put({courses:[mine]});
 r.data.set('lesson-'+app.courseKey(mine)+'.json',JSON.stringify(signals(mine)));r.data.set('lesson-'+app.courseKey(plaza)+'.json',JSON.stringify(signals(plaza)));
 // A plaza search makes another course's lesson known to the assistant.
 app.api.searchCourses=async()=>({list:[plaza],total:1});await actions.execute('search_courses',{query:'别人的课',kind:'course'});
 assert.ok((await actions.execute('list_lessons',{})).lessons.some(l=>l.key===app.courseKey(plaza)));
 const found=await actions.execute('search_material',{query:'傅里叶'});assert.deepEqual(found.lessons.map(l=>l.key).join(),app.courseKey(mine));
 const named=await actions.execute('search_material',{query:'傅里叶',course:'别人的课'});assert.deepEqual(named.lessons.map(l=>l.key).join(),app.courseKey(plaza));
});
test('lessons that have not happened yet are not searched',async t=>{
 const{r,app,actions}=await start(t),later={...past(r,0,'soon'),start:Math.floor(Date.now()/1000)+86400,end:Math.floor(Date.now()/1000)+90000};app.put({courses:[later]});
 r.data.set('lesson-'+app.courseKey(later)+'.json',JSON.stringify(signals(later)));
 assert.equal((await actions.execute('search_material',{query:'傅里叶'})).candidates,0);
});
test('a jump reaches material recorded past the scheduled end of the lesson',async t=>{
 const{r,app}=await start(t),a=past(r,2,'fourier');app.put({courses:[a]});
 await app.enter(a);const data=signals(a);app.put({slides:data.slides,lines:data.lines});
 app.seek(4010,'agent');assert.equal(app.state().at,4010);
 app.seek(9000,'agent');assert.equal(app.state().at,4030);
});
