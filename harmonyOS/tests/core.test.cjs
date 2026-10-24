const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require(process.env.SUIKE_TYPESCRIPT || 'typescript');
const root = path.resolve(__dirname, '../entry/src/main/ets');
function load(file, stubs = {}, globals = {}) {
  const filename = path.join(root, file + '.ets');
  const output = ts.transpileModule(fs.readFileSync(filename,'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, require: name => name.startsWith('.') ? load(path.join(path.dirname(file), name),stubs,globals) : (stubs[name] || (name==='@kit.ArkUI'?{FrameCallback:class {}}:{})), Date, Map, Set, Error, ArrayBuffer, setTimeout, clearTimeout, ...globals }, {filename});
  return exports;
}
const timeline = load('model/Timeline');
const {Zhiyun, AccessDenied} = load('services/Zhiyun');
const course = {subId:'sample',courseId:'example',title:'Fixture',start:Date.parse('2026-10-09T08:00:00+08:00')/1000,end:Date.parse('2026-10-09T10:00:00+08:00')/1000};
const slide = (id,t) => ({id,t,url:`https://cmc.zju.edu.cn/${id}.png`,thumb:'',note:''});
test('30-minute preparation and class start/end boundaries',()=>{
 for(const [now,expected] of [[course.start-1801,'later'],[course.start-1800,'soon'],[course.start,'live'],[course.end-1,'live'],[course.end,'ended']]) assert.equal(timeline.phase(course,now),expected);
});
test('transcript belongs to page at sentence start, exact next-page boundary moves to next page',()=>{
 const pages=timeline.groupPages([slide('b',60),slide('a',10)],[{id:'pre',t:9,text:'before'},{id:'a',t:10,end:65,text:'crossing'},{id:'b',t:60,text:'next'}]);
 assert.deepEqual(Array.from(pages,p=>Array.from(p.lines,l=>l.id)),[['a'],['b']]);
});
test('browsing stays on the same slide when earlier pages are backfilled',()=>{
 const old=[slide('b',60),slide('c',120)], next=timeline.mergeSlides(old,[slide('a',0),slide('d',180)]);
 assert.equal(timeline.selectedAfterUpdate(old,next,0,false),1);
 assert.equal(timeline.selectedAfterUpdate(old,next,0,true),3);
});
test('quarter-screen and narrow windows show exactly one slide',()=>{
 assert.equal(timeline.pageCapacity(1000,400,2000,1000,false),1);
 assert.equal(timeline.pageCapacity(580,1000,2000,1000,false),1);
 assert.equal(timeline.pageCapacity(1600,900,2000,1000,false),2);
 assert.equal(timeline.pageCapacity(1600,900,2000,1000,true),2);
});
test('authoritative history replaces matching approximate caption without losing unrelated text',()=>{
 const lines=timeline.reconcileLines([{id:'approx',t:65,text:'课堂讲解',timing:'received'},{id:'other',t:200,text:'下一句',timing:'received'}],[{id:'asr:60',t:60,text:'课堂讲解'}]);
 assert.deepEqual(Array.from(lines,l=>l.id),['asr:60','other']);
});
test('glue websocket accepts only well-formed default channel messages',()=>{
 assert.equal(timeline.glueMessage('cd1&m{"sourcetext":"课件"}'),'{"sourcetext":"课件"}');
 for(const v of ['cd99&m{}','cd1&x{}','cd-1&m{}','in{}','cd&m{}']) assert.equal(timeline.glueMessage(v),'');
});
test('image URLs reject external hosts and credentials',()=>{
 assert.equal(timeline.imageUrl('http://cmc.zju.edu.cn/a.png'),'https://cmc.zju.edu.cn/a.png');
 for(const u of ['https://zju.edu.cn.attacker.test/a','https://cmc.zju.edu.cn@attacker.test/a','file:///tmp/a','javascript:alert(1)']) assert.equal(timeline.imageUrl(u),'');
});
test('late join paginates through history, skips malformed records and uses full size URL',async()=>{
 const api=new Zhiyun(),calls=[];
 api.request=async p=>{calls.push(p); const page=Number(new URL('https://fixture.test'+p).searchParams.get('page'));return JSON.stringify({code:0,total:3,list:page===1?[{id:'a',created_sec:0,content:JSON.stringify({pptimgurl:'https://cmc.zju.edu.cn/full.png',pptthumb:'https://cmc.zju.edu.cn/thumb.png'})},{content:'invalid'}]:[{id:'b',created_sec:60,ppt:{pptimgurl:'https://cmc.zju.edu.cn/full2.png'}}]});};
 const result=await api.slides(course);
 assert.equal(calls.length,2);assert.equal(result.length,2);assert.match(result[0].url,/full.png$/);assert.equal(result[1].t,60);
});
test('both ainew relative seconds and local wall-clock transcription parse correctly',async()=>{
 const api=new Zhiyun();api.request=async()=>JSON.stringify({code:0,list:[{trans_type:'ainew',all_content:[{BeginSec:60,EndSec:65,Text:'<b>第一句</b>'}]},{trans_type:'legacy',all_content:[{time:'2026-10-09 08:02:00',zhtext:'第二句'},{time:'2026-10-09 08:03:00',originzhtext:'第三句'}]}]});
 const result=await api.transcripts(course);
 assert.deepEqual(Array.from(result,r=>[r.t,r.end,r.text]),[[60,65,'第一句'],[120,180,'第二句'],[180,180,'第三句']]);
});
test('permission never treats string zero as granted',async()=>{
 for(const value of [false,0,'0']){
 const api=new Zhiyun();api.request=async()=>JSON.stringify({code:200,data:{sample:{video:value}}});
 await assert.rejects(api.checkPermission(course,false),AccessDenied);
 }
 for(const value of [true,1,'1']){const api=new Zhiyun();api.request=async()=>JSON.stringify({code:200,data:{sample:{live:value}}});await api.checkPermission(course,true);}
});
test('PPT endpoint denial is propagated without an alternate permission path',async()=>{
 const api=new Zhiyun();let count=0;api.request=async()=>{count++;throw new AccessDenied('denied');};
 await assert.rejects(api.slides(course),AccessDenied);assert.equal(count,1);
});
test('websocket restart clears pending reconnect and sentence identity',()=>{
 const {LiveTranscript}=load('services/LiveTranscript');const live=new LiveTranscript();
 live.reconnect=setTimeout(()=>{},1000);live.heartbeat=setTimeout(()=>{},1000);live.sentenceId='old';live.close();
 assert.equal(live.reconnect,-1);assert.equal(live.heartbeat,-1);assert.equal(live.sentenceId,'');
});
test('missing cached image is a cache miss even when SDK throws for absent files',()=>{
 const {LocalStore}=load('services/LocalStore',{'@kit.CoreFileKit':{fileIo:{mkdirSync(){},accessSync(){throw new Error('missing')}},fileUri:{getUriFromPath:p=>'file://'+p}}});
 const store=new LocalStore({filesDir:'/fixtures',cacheDir:'/fixtures'},'fixture-user');assert.equal(store.cachedImage('https://cmc.zju.edu.cn/a.png'),'');
});
test('interactive room uses its official PPT route and reuses detected backend',async()=>{
 const api=new Zhiyun(),calls=[];
 api.request=async(p,body,origin)=>{calls.push([p,origin]);return JSON.stringify({code:0,list:origin?.includes('interactivemeta')?[{id:'room',created_sec:20,ppt:{pptimgurl:'https://cmc.zju.edu.cn/room.png'}}]:[],total:origin?.includes('interactivemeta')?1:0});};
 assert.equal((await api.slides(course))[0].t,20);
 assert.match(calls[1][0],/^\/pptnoteapi\//);assert.match(calls[1][1],/interactivemeta/);
 calls.length=0;await api.slides(course);assert.equal(calls.length,1);assert.match(calls[0][1],/interactivemeta/);
});
test('plaza flattens time groups and keeps the correct course and lesson identities',async()=>{
 const api=new Zhiyun(); let path;
 api.request=async p=>{path=p;return JSON.stringify({code:0,list:[{name:'morning',list:[{id:44,sub_id:77,title:'Lecture',course_begin:course.start,course_over:course.end,sub_status:1}]},{list:[{id:45,title:'no lesson'}]}]});};
 const result=await api.plaza({id:'u',tenantId:112},'2026-10-09',true);
 assert.equal(result.length,1);assert.equal(result[0].courseId,'44');assert.equal(result[0].subId,'77');assert.match(path,/sub_live_status=1/);
});
test('global search preserves total and escapes title and teacher query parameters',async()=>{
 const api=new Zhiyun(); let request;
 api.request=async p=>{request=new URL('https://fixture.test'+p);return JSON.stringify({code:0,total:{total:52,list:[{course_id:88,title:'<em>文</em>学',realname:'Teacher'},{course_id:89,title:'Recommendation',c_type:'recommend'}]}});};
 const result=await api.searchCourses({id:'u',tenantId:112},'文学&foo=1','',2);
 assert.equal(result.total,52);assert.equal(result.list.length,1);assert.equal(result.list[0].title,'文学');assert.equal(request.searchParams.get('title'),'文学&foo=1');assert.equal(request.searchParams.get('page'),'2');
});
test('catalogue turns nested lessons into dated entries with their original identifiers',async()=>{
 const api=new Zhiyun();api.request=async()=>JSON.stringify({result:{data:[{title:'chapter',children:[{id:7,start_at:course.start,end_at:course.end,status:'6'}]}]}});
 const result=await api.chapters({courseId:'88',title:'Literature',teacher:'Teacher',room:'Room'});
 assert.equal(result.length,1);assert.equal(result[0].subId,'7');assert.equal(result[0].courseId,'88');assert.equal(result[0].teacher,'Teacher');
});
test('download history scans only school-term weeks and normalizes timestamps',async()=>{
 const api=new Zhiyun(),requests=[];api.request=async p=>{
  if(p.includes('get-term-years'))return JSON.stringify({result:{data:{'2023-2024':{spring:{begin_date:'2024-02-26',end_date:'2024-03-31'}}}}});
  requests.push(p);const url=new URL('https://fixture.test'+p),start=url.searchParams.get('start_at'),end=url.searchParams.get('end_at');
  assert.ok(Date.parse(end)-Date.parse(start)<=6*86400000);
  const hit=start<='2024-03-01'&&end>='2024-03-01';return JSON.stringify({code:0,result:{list:hit?[{course:[{id:'old-class',course_id:'lit',course_title:'Literature',status:6,start_at:Date.parse('2024-03-01T08:00:00+08:00'),end_at:Date.parse('2024-03-01T10:00:00+08:00')}]}]:[]}});
 };
 const persisted=[];const result=await api.attendanceHistory({id:'student',tenantId:112,username:''},(done,total,state)=>{if(state)persisted.push(state);}, {courses:[],cursor:'2024-04-01',emptyWindows:0,complete:false});
 assert.equal(requests.length,5);assert.equal(result.failed,false);assert.equal(result.complete,true);assert.equal(result.courses.length,1);assert.equal(result.courses[0].status,'6');assert.equal(result.courses[0].start,Date.parse('2024-03-01T08:00:00+08:00')/1000);assert.ok(persisted.at(-1).complete);
});
test('failed history week keeps a resumable cursor and preserves prior records',async()=>{
 const api=new Zhiyun();let fail=true;const dates=[];
 api.request=async p=>{
  if(p.includes('get-term-years'))return JSON.stringify({result:{data:{year:{term:{begin_date:'2024-03-01',end_date:'2024-03-31'}}}}});
  const start=new URL('https://fixture.test'+p).searchParams.get('start_at');dates.push(start);
  if(start==='2024-03-18'&&fail)throw new Error('temporary');
  return JSON.stringify({code:0,result:{list:[]}});
 };
 const first=await api.attendanceHistory({id:'u',tenantId:112},()=>{}, {courses:[course],cursor:'2024-03-31',emptyWindows:0,complete:false});
 assert.equal(first.failed,true);assert.equal(first.cursor,'2024-03-24');assert.equal(first.courses.length,1);
 fail=false;dates.length=0;const second=await api.attendanceHistory({id:'u',tenantId:112},()=>{},first);
 assert.equal(second.complete,true);assert.equal(second.failed,false);assert.ok(!dates.includes('2024-03-25'));assert.equal(second.courses.length,1);
});
test('date download calendar marks only class dates and moves across year boundaries',()=>{
 const {calendarMonthGrid,shiftCalendarMonth}=load('model/CourseSections');const at=Date.parse('2026-10-09T08:00:00+08:00')/1000;const cells=calendarMonthGrid('2026-10',[{...course,start:at},{...course,subId:'second',start:at}]);
 assert.equal(cells.length,42);assert.equal(cells.find(c=>c.date==='2026-10-09').count,2);assert.equal(cells.find(c=>c.date==='2026-10-08').count,0);assert.equal(shiftCalendarMonth('2026-01',-1),'2025-12');assert.equal(shiftCalendarMonth('2025-12',1),'2026-01');
});
test('attendance cache survives reopening with records and resumable progress',()=>{
 const files=new Map();const io={OpenMode:{CREATE:1,WRITE_ONLY:2,TRUNC:4},accessSync:()=>true,mkdirSync(){},readTextSync:p=>{if(!files.has(p))throw Error('missing');return files.get(p)},openSync:p=>({fd:p}),writeSync:(p,v)=>{files.set(p,v);return v.length},closeSync(){},renameSync:(a,b)=>{files.set(b,files.get(a));files.delete(a)}};
 const {LocalStore}=load('services/LocalStore',{'@kit.CoreFileKit':{fileIo:io,fileUri:{}}});
 const context={filesDir:'/files',cacheDir:'/cache'};new LocalStore(context,'alice').saveAttendanceHistory([course],'2024-03-24',0,false);
 const reopened=new LocalStore(context,'alice').loadAttendanceHistoryState();assert.equal(reopened.courses[0].subId,course.subId);assert.equal(reopened.cursor,'2024-03-24');assert.equal(reopened.complete,false);
 assert.equal(new LocalStore(context,'bob').loadAttendanceHistoryState(),undefined);
});
test('reopening an existing account cache does not recreate its directories',()=>{
 const {LocalStore}=load('services/LocalStore',{'@kit.CoreFileKit':{fileIo:{accessSync(){return true},mkdirSync(){throw new Error('File exists')}},fileUri:{}}});
 assert.doesNotThrow(()=>new LocalStore({filesDir:'/fixtures',cacheDir:'/fixtures'},'existing-user'));
});
test('permission labels separate explicit grants and denials from missing or malformed values',()=>{
 const {permissionState,permissionForCourse,aggregatePermissions}=load('services/Zhiyun');
 for(const value of [undefined,null,'false','true',2,'']) assert.equal(permissionState(value),'unknown');
 for(const value of [true,1,'1']) assert.equal(permissionState(value),'allowed');
 for(const value of [false,0,'0']) assert.equal(permissionState(value),'denied');
 const split={live:1,video:0};
 assert.equal(permissionForCourse({...course,status:'1'},split,course.end+10),'allowed');
 assert.equal(permissionForCourse({...course,status:'2'},split,course.start-100),'allowed');
 assert.equal(permissionForCourse({...course,status:'6'},split,course.end+10),'denied');
 assert.equal(aggregatePermissions(['denied','unknown']),'unknown');
 assert.equal(aggregatePermissions([]),'unknown');
 assert.equal(aggregatePermissions(['denied','denied']),'denied');
 assert.equal(aggregatePermissions(['denied','allowed','unknown']),'allowed');
});
test('permission discovery batches lessons by course, caches both modes, and reports failures as unknown',async()=>{
 const api=new Zhiyun(),calls=[];
 const first={...course,status:'1'},second={...course,subId:'second',status:'6'},third={...course,subId:'third',courseId:'other',status:'6'};
 api.request=async(p,body)=>{const q=JSON.parse(body);calls.push(q);if(q.course_id==='other')throw new Error('network');return JSON.stringify({code:200,data:{sample:{live:1,video:0},second:{live:0,video:1}}});};
 const states=await api.permissions([first,second,third]);
 assert.deepEqual({...states},{sample:'allowed',second:'allowed',third:'unknown'});assert.equal(calls.length,2);assert.deepEqual(calls[0].sub_ids,['sample','second']);
 calls.length=0;const cached=await api.permissions([{...first,status:'6'},second]);
 assert.equal(cached.sample,'denied');assert.equal(calls.length,0);
});
test('permission lookup stops after repeated service failures and can be cancelled',async()=>{
 const api=new Zhiyun();let calls=0;api.request=async()=>{calls++;throw new Error('unavailable');};
 const courses=Array.from({length:5},(_,i)=>({...course,courseId:String(i),subId:String(i)}));
 const states=await api.permissions(courses);assert.equal(calls,4);assert.equal(Object.values(states).every(s=>s==='unknown'),true);
 const cancelled=new Zhiyun();let requests=0;cancelled.request=async()=>{requests++;return JSON.stringify({code:200,data:{sample:{video:1}}});};
 await cancelled.permissions([course],()=>cancelled.cancel());assert.equal(requests,0);
});

function memoryDisk() {
 const files=new Map();
 const io={OpenMode:{CREATE:1,WRITE_ONLY:2,TRUNC:4},accessSync:p=>files.has(p),mkdirSync:p=>files.set(p,'directory'),readTextSync:p=>{if(!files.has(p))throw Error('missing');return files.get(p)},openSync:p=>({fd:p}),writeSync:(fd,data)=>files.set(fd,data),closeSync:()=>{},renameSync:(a,b)=>{files.set(b,files.get(a));files.delete(a)}};
 const {LocalStore}=load('services/LocalStore',{'@kit.CoreFileKit':{fileIo:io,fileUri:{}}});
 return {files,LocalStore};
}
test('permission records and both border toggle states survive restart and stay isolated by account',async()=>{
 const {LocalStore}=memoryDisk(),context={filesDir:'/files',cacheDir:'/cache'};
 const store=new LocalStore(context,'112:alice'),api=new Zhiyun();api.usePermissionStorage(store);
 let calls=0;api.request=async()=>{calls++;return JSON.stringify({code:200,data:{sample:{live:0,video:1}}})};
 await api.permissions([course]);assert.equal(calls,1);
 store.saveTrimBorders(true);
 const reopened=new LocalStore(context,'112:alice'),second=new Zhiyun();second.usePermissionStorage(reopened);
 second.request=async()=>{throw Error('fresh cache must not request')};
 assert.equal((await second.permissions([course])).sample,'allowed');assert.equal(reopened.trimBorders(),true);
 reopened.saveTrimBorders(false);assert.equal(new LocalStore(context,'112:alice').trimBorders(),false);
 const other=new LocalStore(context,'112:bob');second.usePermissionStorage(other);
 assert.equal(second.cachedPermissions([course]).sample,'unknown');assert.equal(other.trimBorders(),true);
});
test('stale permission displays immediately then refreshes; explicit refresh and lesson entry revalidate grants',async()=>{
 const {LocalStore}=memoryDisk(),store=new LocalStore({filesDir:'/files',cacheDir:'/cache'},'alice');
 store.savePermissions([{courseId:course.courseId,subId:course.subId,permission:{video:1},checkedAt:Date.now()/1000-86401}]);
 const api=new Zhiyun();api.usePermissionStorage(store);let calls=0;
 api.request=async()=>{calls++;return JSON.stringify({code:200,data:{sample:{video:0}}})};
 const stages=[];const result=await api.permissions([course],states=>stages.push(states.sample));
 assert.equal(stages[0],'allowed');assert.equal(result.sample,'denied');assert.equal(calls,1);
 await api.permissions([course]);assert.equal(calls,1);
 await api.permissions([course],()=>{},true);assert.equal(calls,2);
 await assert.rejects(()=>api.checkPermission(course,false),AccessDenied);assert.equal(calls,3);
});
test('permission requests use two slots across concurrent searches and coalesce duplicate batches',async()=>{
 const api=new Zhiyun();let active=0,peak=0,calls=0;
 api.request=async(p,body)=>{const q=JSON.parse(body);calls++;active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,15));active--;return JSON.stringify({code:200,data:Object.fromEntries(q.sub_ids.map(id=>[id,{video:1}]))})};
 const courses=Array.from({length:6},(_,i)=>({...course,courseId:String(i),subId:String(i)}));
 await Promise.all([api.permissions(courses),api.permissions(courses.slice(0,1))]);
 assert.equal(peak,2);assert.equal(calls,6);
});
test('catalogues survive reopening and malformed permission files do not break startup',()=>{
 const {LocalStore,files}=memoryDisk(),context={filesDir:'/files',cacheDir:'/cache'};
 const store=new LocalStore(context,'alice');store.saveCatalogue(course.courseId,[course]);
 assert.equal(new LocalStore(context,'alice').loadCatalogue(course.courseId)[0].subId,course.subId);
 store.savePermissions([{courseId:'example',subId:'sample',permission:{video:1},checkedAt:Date.now()/1000}]);
 const permissionFile=[...files.keys()].find(p=>p.endsWith('permissions-v1.json'));files.set(permissionFile,'bad json');
 assert.doesNotThrow(()=>new LocalStore(context,'alice'));assert.equal(new LocalStore(context,'alice').permissionRecord('example','sample'),undefined);
});
const {blackBorderRegion}=load('model/BlackBorders');
function imageFixture(w,h,region,fill=255) {
 const pixels=new Uint8Array(w*h*4);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;const c=region&&x>=region.x&&x<region.x+region.width&&y>=region.y&&y<region.y+region.height?fill:0;pixels[i]=pixels[i+1]=pixels[i+2]=c;pixels[i+3]=255}
 return pixels;
}
test('black border detector handles vertical horizontal and all-sided letterboxing at original resolution',()=>{
 for(const region of [{x:16,y:0,width:128,height:90},{x:0,y:10,width:160,height:70},{x:16,y:10,width:128,height:70},{x:12,y:0,width:148,height:90}]) {
  assert.deepEqual({...blackBorderRegion(imageFixture(160,90,region),160,90)},region);
 }
});
test('black border detector preserves borderless black dark and transparent content',()=>{
 assert.equal(blackBorderRegion(imageFixture(160,90,{x:0,y:0,width:160,height:90}),160,90),undefined);
 assert.equal(blackBorderRegion(imageFixture(160,90,undefined),160,90),undefined);
 assert.equal(blackBorderRegion(imageFixture(160,90,{x:16,y:10,width:128,height:70},30),160,90),undefined);
 const transparent=imageFixture(160,90,{x:16,y:10,width:128,height:70});for(let i=3;i<transparent.length;i+=4)transparent[i]=0;
 assert.equal(blackBorderRegion(transparent,160,90),undefined);
 assert.equal(blackBorderRegion(new Uint8Array(20),160,90),undefined);
});

test('cancelled lesson checks cannot write an old account result into a newly bound store',async()=>{
 const api=new Zhiyun();let finish;
 api.request=()=>new Promise(resolve=>finish=resolve);
 const check=api.checkPermission(course,false);api.cancel();
 const writes=[];api.usePermissionStorage({permissionRecord(){return undefined},savePermissions(records){writes.push(records)}});
 finish(JSON.stringify({code:200,data:{sample:{video:1}}}));
 await assert.rejects(()=>check,/已取消/);assert.equal(writes.length,0);
});

test('JPEG grey transition strips on either side are removed without discarding the opposite margin',()=>{
 const region={x:16,y:10,width:128,height:70},w=160,h=90;
 const pixels=imageFixture(w,h,region);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const fringe=x>=15&&x<=144&&y>=9&&y<=80&&(x===15||x===144||y===9||y===80);
  if(fringe){const i=(y*w+x)*4;pixels[i]=pixels[i+1]=pixels[i+2]=27;}
 }
 assert.deepEqual({...blackBorderRegion(pixels,w,h)},region);
});
test('transcript visibility and border preference persist independently, with cached plaza courses',()=>{
 const {LocalStore}=memoryDisk(),context={filesDir:'/files',cacheDir:'/cache'};
 const store=new LocalStore(context,'alice');store.saveTranscription(true);store.saveTrimBorders(true);
 let reopened=new LocalStore(context,'alice');assert.equal(reopened.transcription(),true);assert.equal(reopened.trimBorders(),true);
 reopened.saveTrimBorders(false);reopened.savePlaza('2026-10-09',false,[course]);
 reopened=new LocalStore(context,'alice');assert.equal(reopened.transcription(),true);assert.equal(reopened.trimBorders(),false);
 assert.equal(reopened.loadPlaza('2026-10-09',false)[0].subId,course.subId);assert.equal(reopened.loadPlaza('2026-10-09',true),undefined);
 reopened.saveTranscription(false);assert.equal(new LocalStore(context,'alice').transcription(),false);
});

test('caption filtering waits for data, preserves live pending page and original page identities',()=>{
 const all=timeline.groupPages([slide('a',0),slide('b',60),slide('c',120),slide('d',180)],[{id:'b-line',t:70,text:'正文'}]);
 assert.deepEqual(Array.from(timeline.visiblePageGroups(all,true,false),g=>g.slide.id),['b']);
 assert.deepEqual(Array.from(timeline.visiblePageGroups(all,true,true),g=>g.slide.id),['b','d']);
 assert.equal(timeline.visiblePageGroups(all,false,false).length,4);
 assert.equal(timeline.visiblePageGroups(timeline.groupPages(all.map(g=>g.slide),[]),true,false).length,4);
 assert.equal(timeline.pageCapacity(1600,900,2000,1000,true,true),1);
 for(const [i,cap,expected] of [[0,2,0],[1,2,0],[2,2,2],[98,2,98],[99,1,99]])assert.equal(timeline.spreadStart(i,cap),expected);
 assert.equal(timeline.plainTranscript('第一句。\n  第二句。\r\n第三句。'),'第一句。 第二句。 第三句。');
});
test('page mode and skip filter persist independently of transcript visibility and crop',()=>{
 const {LocalStore}=memoryDisk(),context={filesDir:'/files',cacheDir:'/cache'};
 const store=new LocalStore(context,'alice');store.savePageOptions(true,true);store.saveTrimBorders(true);store.saveTranscription(true);
 const other=new LocalStore(context,'alice');assert.equal(other.singlePage(),true);assert.equal(other.skipEmpty(),true);assert.equal(other.trimBorders(),true);assert.equal(other.transcription(),true);
 other.savePageOptions(false,false);assert.equal(new LocalStore(context,'alice').skipEmpty(),false);assert.equal(new LocalStore(context,'alice').transcription(),true);
});
test('native login uses official submit handler, never submits captcha or untrusted pages',()=>{
 const {officialLoginUrl,submitLoginScript}=load('model/OfficialLogin');
 assert.equal(officialLoginUrl('https://zjuam.zju.edu.cn/cas/login?service=sample'),true);
 for(const url of ['http://zjuam.zju.edu.cn/cas/login','https://zjuam.zju.edu.cn.evil.test/cas/login','https://other.zju.edu.cn/cas/login'])assert.equal(officialLoginUrl(url),false);
 function run({captcha=false,origin='https://zjuam.zju.edu.cn',hiddenParent=false}={}) {
  let clicks=0;const nodes={username:{dispatchEvent(){}},password:{dispatchEvent(){}},dl:{click(){clicks++}},kaptcha:{getClientRects:()=>hiddenParent?[]:[{}]}};
  const result=vm.runInNewContext(submitLoginScript('fixture-user','fixture-password'),{location:{origin,pathname:'/cas/login'},document:{getElementById:id=>nodes[id]},window:{checkForm(){}},Event:class {},getComputedStyle:()=>({display:captcha?'block':'none'})});
  return {result,clicks,nodes};
 }
 assert.equal(run().clicks,1);assert.equal(run().nodes.password.value,'fixture-password');
 assert.equal(run({captcha:true}).clicks,0);assert.equal(run({captcha:true}).result,'verification');
 assert.equal(run({origin:'https://other.test'}).clicks,0);
 assert.equal(run({captcha:true,hiddenParent:true}).result,'submitted','a hidden captcha container should not force official verification');
});
test('long sessions use encrypted bounded pieces, atomic commit and survive guest preload',async()=>{
 const records=new Map(),cookies={};let queries=0,fail=false;
 const tags={ALIAS:1,RETURN_TYPE:2,SECRET:3,ACCESSIBILITY:4,CONFLICT_RESOLUTION:5,DATA_LABEL_NORMAL_LOCAL_1:6};
 const string=b=>Buffer.from(b).toString();
 const kit={asset:{Tag:tags,ReturnType:{ALL:0},Accessibility:{DEVICE_UNLOCKED:2},ConflictResolution:{OVERWRITE:0},
  query:async attrs=>{queries++;const record=records.get(string(attrs.get(tags.ALIAS)));return record?[record]:[]},
  add:async attrs=>{assert.ok(attrs.get(tags.SECRET).length<=1024);assert.equal(attrs.get(tags.ACCESSIBILITY),2);if(fail&&!string(attrs.get(tags.ALIAS)).endsWith('-v2'))throw new Error('interrupted');records.set(string(attrs.get(tags.ALIAS)),new Map(attrs))},
  remove:async attrs=>{if(attrs.has(tags.ALIAS))records.delete(string(attrs.get(tags.ALIAS)));else for(const [key,value] of records)if(string(value.get(tags.DATA_LABEL_NORMAL_LOCAL_1))===string(attrs.get(tags.DATA_LABEL_NORMAL_LOCAL_1)))records.delete(key)}
 }};
 const stubs={'@kit.AssetStoreKit':kit,'@kit.ArkTS':{util:{TextEncoder:class {encodeInto(s){return new Uint8Array(Buffer.from(s))}},TextDecoder:{create:()=>({decodeToString:string})}}},'@kit.ArkWeb':{webview:{WebCookieManager:{fetchCookieSync:url=>cookies[url]||''}}}};
 const {SessionStore}=load('services/SessionStore',stubs);await Promise.all([SessionStore.restore(),SessionStore.restore()]);assert.equal(queries,2);
 await SessionStore.rememberAccount({id:'fixture-user',name:'Fixture',tenantId:112});
 const savedIdentity=load('services/SessionStore',stubs).SessionStore;assert.equal((await savedIdentity.savedAccount()).id,'fixture-user');
 const token='PHPSESSID=fixture-'+ 'x'.repeat(4000);cookies['https://classroom.zju.edu.cn']=token;await SessionStore.saveCurrent();assert.ok(records.size>2);
 cookies['https://classroom.zju.edu.cn']='PHPSESSID=guest';const restored=load('services/SessionStore',stubs).SessionStore;await restored.restore();assert.equal(restored.cookie('https://classroom.zju.edu.cn'),token);assert.equal(restored.cookie('https://untrusted.test'),'');
 restored.beginLogin();cookies['https://classroom.zju.edu.cn']='PHPSESSID=new-login';fail=true;await assert.rejects(restored.saveCurrent());
 const afterInterruption=load('services/SessionStore',stubs).SessionStore;await afterInterruption.restore();assert.equal(afterInterruption.cookie('https://classroom.zju.edu.cn'),token);
 cookies['https://classroom.zju.edu.cn']='';await afterInterruption.clear();assert.equal(afterInterruption.cookie('https://classroom.zju.edu.cn'),'');assert.equal(records.size,0);assert.equal(await afterInterruption.savedAccount(),undefined);
});

test('touch follows finger at double distance, settles proportionally and respects both ends',()=>{
 const nav=load('model/PageNavigation');
 assert.equal(nav.dragPageOffset(4,99,2,500,-500),-1000);
 assert.equal(nav.releasedPage(4,99,2,500,-1000,0),6);
 assert.equal(nav.releasedPage(4,99,2,500,1000,0),2);
 assert.equal(nav.dragPageOffset(0,99,2,500,100),0);
 assert.equal(Math.abs(nav.dragPageOffset(98,99,2,500,-100)),0);
 assert.equal(nav.releasedPage(96,99,2,500,-2000,0),98);
 assert.equal(nav.releasedPage(0,2,2,500,-1000,-900),0);
 assert.equal(nav.releasedPage(4,99,2,500,-50,-800),5);
 assert.equal(nav.releasedPage(4,99,2,500,-10,-800),4);
 assert.equal(nav.courseSeconds('12:30'),750);
 assert.equal(nav.courseSeconds('1:12:30'),4350);
 for(const invalid of ['12:60','1:60:00','-1:20','abc','12'])assert.equal(nav.courseSeconds(invalid),-1);
});

const media=load('model/Media',{'@kit.ArkTS':{url:{URL}}});
test('media resolves live teacher, student, screen and existing replay without inventing URLs',()=>{
 const host='https://cmc.zju.edu.cn/';
 const sources=media.mediaSources({sub_status:1,sub_content:JSON.stringify({output:{m3u8:host+'live.m3u8'},output_student:{m3u8:host+'student.m3u8'},tts:{m3u8:host+'screen.m3u8'},save_playback:{contents:host+'archive.m3u8',play_addres_arr:{HD:host+'archive.m3u8'}}})});
 assert.deepEqual(Array.from(sources,s=>[s.id,s.live]),[['live',true],['student',true],['screen',true],['recording',false]]);
 assert.equal(media.mediaSources({sub_content:'malformed'}).length,0);
 assert.equal(media.mediaSources({sub_status:6,content:{save_playback:{mpc:'https://attacker.test/private.mp4'}}}).length,0);
});
test('video source names explain the view instead of exposing platform placeholders',()=>{
 const sources=media.mediaSources({sub_status:6,sub_content:JSON.stringify({save_playback:{contents:'https://cmc.zju.edu.cn/main.m3u8',play_addres_arr:{default:'https://cmc.zju.edu.cn/standard.m3u8'}}}),video_list:{room:{type:4,title:'画面 2',preview_url:'https://cmc.zju.edu.cn/room.mp4'},podium:{type:3,title:'北2-112 教师近景',preview_url:'https://cmc.zju.edu.cn/podium.mp4'}}});
 assert.deepEqual(Array.from(sources,s=>s.title),['教师主画面 · 课程回放','教室全景 · 课程录像','北2-112 教师近景']);
});
test('HLS downloads resolve relative segments, keys and initialization assets with time offset',()=>{
 const start=Date.parse('2026-10-09T08:00:00+08:00')/1000;
 const raw='#EXTM3U\n#EXT-X-TARGETDURATION:5\n#EXT-X-KEY:METHOD=AES-128,URI="../key.bin"\n#EXT-X-MAP:URI="init.mp4"\n#EXT-X-PROGRAM-DATE-TIME:2026-10-09T08:10:00+08:00\n#EXTINF:5,\n001.ts?token=fixture\n#EXTINF:5,\n002.ts\n';
 const plan=media.hlsPlan(raw,'https://cmc.zju.edu.cn/media/index.m3u8',start);
 assert.equal(plan.offset,600);assert.equal(plan.endList,false);assert.equal(plan.files.length,4);
 assert.equal(plan.files[0].url,'https://cmc.zju.edu.cn/key.bin');assert.match(plan.text,/#EXT-X-ENDLIST/);
 assert.ok(plan.files.every(f=>!f.name.includes('?')));
 const other=media.hlsPlan(raw.replace('001.ts','005.ts'),'https://cmc.zju.edu.cn/media/index.m3u8',start);
 assert.notEqual(plan.files[2].name,other.files[2].name,'refreshing a live snapshot must not reuse a different old segment');
});
test('HLS master keeps official video and audio variants, finite capture marks source completeness',()=>{
 const master=media.hlsPlan('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",URI="audio/index.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=1000,AUDIO="a"\nvideo.m3u8\n','https://cmc.zju.edu.cn/root/master.m3u8');
 assert.equal(master.variant,'https://cmc.zju.edu.cn/root/video.m3u8');assert.equal(master.audio,'https://cmc.zju.edu.cn/root/audio/index.m3u8');
 const complete=media.hlsPlan('#EXTM3U\n#EXTINF:4,\na.ts\n#EXT-X-ENDLIST\n','https://cmc.zju.edu.cn/index.m3u8');assert.equal(complete.endList,true);assert.equal(complete.text.match(/#EXT-X-ENDLIST/g).length,1);
});
test('HLS refuses unsupported protection, external segments and invalid successful HTML responses',()=>{
 for(const raw of ['<html>please login</html>','#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="key"\na.ts','#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,KEYFORMAT="vendor",URI="key"\na.ts','#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="https://attacker.test/key"\na.ts','#EXTM3U\nhttps://attacker.test/a.ts'])assert.throws(()=>media.hlsPlan(raw,'https://cmc.zju.edu.cn/index.m3u8'));
});
test('video access revalidates before reading addresses and stops on explicit denial',async()=>{
 const api=new Zhiyun();let addresses=0;api.info=async()=>({sub_status:6});api.checkPermission=async()=>{throw new AccessDenied('denied')};api.request=async()=>{addresses++;return '{}'};
 await assert.rejects(api.videos({...course,status:'6'}),AccessDenied);assert.equal(addresses,0);
});
function offlineFixture(stubs={}) {
 const files=new Map(),io={OpenMode:{CREATE:1,WRITE_ONLY:2,TRUNC:4},openSync:p=>({fd:p}),writeSync:(p,v)=>files.set(p,v),closeSync(){},renameSync:(a,b)=>{files.set(b,files.get(a));files.delete(a)},statSync:p=>{if(!files.has(p))throw Error('missing');return{size:files.get(p).length}},mkdirSync(){},rmdirSync(){},unlinkSync:p=>files.delete(p)};
 const store={dataFolder:'/offline',load:()=>files.get('cache'),readJson:p=>files.get(p)||'',saveJson:(p,v)=>files.set(p,v),save:v=>files.set('cache',v),pinImage:async(url)=>{const target='/saved/'+url.split('/').at(-1);files.set(target,'fixture');return'file://'+target},permissionRecord(){},savePermissions(){}};
 const {OfflineLibrary}=load('services/OfflineLibrary',{'@kit.CoreFileKit':{fileIo:io,fileUri:{getUriFromPath:p=>'file://'+p,FileUri:class{constructor(uri){this.path=uri.replace('file://','')}}}},'@kit.NetworkKit':{http:{RequestMethod:{HEAD:'HEAD'},createHttp:()=>({request:async()=>({responseCode:200,header:{'content-length':'7'}}),destroy(){}})}},'@kit.ArkTS':{url:{URL}},...stubs});
 const lib=new OfflineLibrary(store,()=>{});lib.retryWait=async()=>{};lib.api.checkPermission=async()=>{};lib.api.info=async()=>({sub_status:6});lib.api.slides=async()=>[slide('a',0)];lib.api.transcripts=async()=>[{id:'l',t:10,end:15,text:'fixture'}];
 return{files,lib};
}
test('offline download preserves selected slides/transcripts even when video is unavailable',async()=>{
 const {files,lib}=offlineFixture();lib.api.videos=async()=>[];
 await assert.rejects(lib.download({course,options:{slides:true,transcript:true,video:true},state:'running',progress:0}),/尚未提供/);
 assert.equal(lib.list().length,1);assert.equal(lib.list()[0].options.video,false);assert.equal(lib.list()[0].options.slides,true);assert.equal(lib.snapshot(course.subId).lines[0].text,'fixture');
 const snapshot=lib.snapshot(course.subId);files.set('cache',{course,slides:[],lines:[]});assert.equal(lib.snapshot(course.subId).slides.length,1,'online cache changes do not affect saved content');
});
test('offline library merges later asset choices instead of discarding prior downloads',async()=>{
 const {lib}=offlineFixture();await lib.download({course,options:{slides:true,transcript:false,video:false},progress:0});
 await lib.download({course,options:{slides:false,transcript:true,video:false},progress:0});
 assert.equal(lib.list()[0].options.slides,true);assert.equal(lib.list()[0].options.transcript,true);assert.equal(lib.snapshot(course.subId).slides.length,1);assert.equal(lib.snapshot(course.subId).lines.length,1);
});
test('interrupted streaming download rejects on pause instead of waiting forever for dataEnd',async()=>{
 const req={on(){},destroy(){},requestInStream:async()=>200};
 const {lib}=offlineFixture({'@kit.NetworkKit':{http:{createHttp:()=>req}}});
 const pending=lib.file('https://cmc.zju.edu.cn/video.mp4','/offline/video.mp4');
 await Promise.resolve();lib.pause();await assert.rejects(pending,/已暂停/);
});
test('AI cut-off respects exact question time and whole-course option',()=>{
 const slides=[slide('early',0),slide('later',60)],lines=[{id:'a',t:30,text:'已讲过'},{id:'b',t:70,text:'后面讲'}];
 const early=media.contextLines(slides,lines,40,false);assert.match(early,/已讲过/);assert.doesNotMatch(early,/后面讲|60.0秒/);
 const whole=media.contextLines(slides,lines,40,true);assert.match(whole,/后面讲/);assert.match(whole,/60.0秒/);
});
test('AI auto reads only requested images, groups captions by page and excludes future history',async()=>{
 const {AiClient}=load('services/AiClient');AiClient.savedKey=async()=> 'fixture-key';
 const ai=new AiClient(),data=new Map(),recognized=[],requests=[];
 const store={activeCourse:course,imageVersion:()=> 'v1',cache:{revision:()=>0,read:(kind,c,name)=>data.get(kind+name)||'',save:(kind,c,name,value)=>data.set(kind+name,value)},readJson:name=>data.get(name)||'',saveJson:(name,value)=>data.set(name,value)};
 ai.readSlideUncached=async slide=>{recognized.push(slide.id);return {text:'OCR '+slide.id,version:'v1'}};
 ai.stream=async(key,body,changed)=>{requests.push(JSON.parse(JSON.stringify(body)));if(requests.length===1)return {answer:'',calls:[{id:'tool1',type:'function',function:{name:'read_slides',arguments:JSON.stringify({pages:[2,3]})}}]};changed('partial');changed('fixture answer');return {answer:'fixture answer',calls:[]}};
 const slides=[slide('a',0),slide('b',20),slide('c',100)],lines=[{id:'x',t:5,text:'earlier caption'},{id:'y',t:40,text:'current caption'},{id:'z',t:110,text:'future caption'}];
 const history=[{question:'past',answer:'past evidence',at:10,whole:false},{question:'future',answer:'future secret evidence',at:120,whole:false},{question:'all',answer:'whole-course evidence',at:15,whole:true}];
 const partial=[];await ai.ask(store,slides,lines,'question',50,false,'fixture-model',history,()=>{},'auto','b',a=>partial.push(a));
 assert.deepEqual(recognized,['b']);const first=JSON.stringify(requests[0]);assert.match(first,/earlier caption/);assert.match(first,/current caption/);assert.doesNotMatch(first,/OCR |future caption|future secret evidence|whole-course evidence/);
 const payload=JSON.stringify(requests[1]);assert.match(payload,/OCR b/);assert.doesNotMatch(payload,/OCR a|OCR c/);assert.match(payload,/不在可引用时间范围内/);assert.deepEqual(partial,['partial','fixture answer']);
});
test('AI never mode exposes only transcript retrieval and never recognizes images; whole-course includes future lecture timing',async()=>{
 const {AiClient}=load('services/AiClient');AiClient.savedKey=async()=> 'fixture-key';const ai=new AiClient();let body;
 ai.readSlideUncached=async()=>{throw Error('must not OCR')};ai.stream=async(key,b)=>{body=b;return {answer:'ok',calls:[]}};
 const store={cache:{revision:()=>0},readJson:()=>'',saveJson:()=>{}};await ai.ask(store,[slide('a',0),slide('b',100)],[{id:'future',t:110,text:'future lecture'}],'question',50,true,'fixture-model',[{question:'image history',answer:'OCR secret',at:20,whole:false,mode:'auto'}],()=>{},'never','a');
 assert.deepEqual(Array.from(body.tools || [], tool=>tool.function.name),['read_course_context']);assert.match(JSON.stringify(body),/future lecture/);assert.doesNotMatch(JSON.stringify(body),/OCR secret/);assert.match(JSON.stringify(body),/提问前后/);
});
test('AI streaming parser handles fragmented SSE, ignores keepalive and joins tool arguments',()=>{
 const {AiStream,answerParts,shouldSubmitOnEnter}=load('model/AiStream'),parser=new AiStream(),received=[];
 const payload=':keepalive\n\ndata: '+JSON.stringify({choices:[{delta:{content:'你好'}}]})+'\n\n'+'data: '+JSON.stringify({choices:[{delta:{tool_calls:[{index:0,id:'call',function:{name:'read_slides',arguments:'{"pages":'}}]}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{tool_calls:[{index:0,function:{arguments:'[2]}'}}]}}]})+'\n\ndata: [DONE]\n\n';
 for(let i=0;i<payload.length;i+=7)parser.push(payload.slice(i,i+7),a=>received.push(a));parser.finish(()=>{});assert.equal(parser.done,true);assert.deepEqual(received,['你好']);assert.equal(parser.calls[0].function.arguments,'{"pages":[2]}');
 const parts=answerParts('请看 [02:35]，后面 [1:02:03]');assert.deepEqual(Array.from(parts,p=>p.seconds),[-1,155,-1,3723]);
 const markdown=answerParts('## 重点\n- **结论**：*成立*，看 [00:12]');
 assert.equal(markdown.map(p=>p.value).join(''),'重点\n• 结论：成立，看 [00:12]');
 assert.ok(markdown.some(p=>p.value==='结论'&&p.bold));assert.ok(markdown.some(p=>p.value==='成立'&&p.italic));assert.ok(markdown.some(p=>p.seconds===12));
 assert.equal(shouldSubmitOnEnter(false),true);assert.equal(shouldSubmitOnEnter(true),false);
});
test('notes insertions split text, retain blank-line caret and shift existing source offsets',()=>{
 const {insertionBreaks,movedOffset}=load('model/Notes');
 assert.deepEqual(Array.from(insertionBreaks('abc',3)),['\n\n','\n\n']);assert.deepEqual(Array.from(insertionBreaks('abc\n',4)),['\n','\n\n']);assert.deepEqual(Array.from(insertionBreaks('abc\n\n',5)),['','\n\n']);assert.deepEqual(Array.from(insertionBreaks('abc\nnext',4)),['\n','\n\n']);assert.deepEqual(Array.from(insertionBreaks('abc\nnext',3)),['\n\n','\n']);
 assert.deepEqual(Array.from(insertionBreaks('',0)),['\n\n','\n\n']);
 assert.equal(movedOffset(8,2,4,7),11);assert.equal(movedOffset(3,2,4,7),2);assert.equal(movedOffset(1,2,4,7),1);
});
test('a course can save and reopen multiple independent notes',()=>{
 const files=new Map(),io={listFileSync:()=>Array.from(files.keys()),accessSync:address=>files.has(address.split('/').pop()),unlinkSync:address=>files.delete(address.split('/').pop())};
 const store={dataFolder:'/fixture',readJson:name=>{if(!files.has(name))throw Error('missing');return files.get(name)},saveJson:(name,value)=>files.set(name,value),deleteJson:name=>files.delete(name)};
 const {NotesStore}=load('services/NotesStore',{'@kit.CoreFileKit':{fileIo:io,fileUri:{}},'@kit.ArkTS':{util:{}},'@kit.BasicServicesKit':{zlib:{}}});
 const repo=new NotesStore(store),first=repo.create(course,'提纲'),second=repo.create(course,'课堂问题');
 first.atoms=[{id:'a',kind:'text',value:'提纲内容',at:1,end:1,sourceId:'',bold:false,italic:false,underline:false}];second.atoms=[{id:'b',kind:'text',value:'问题内容',at:2,end:2,sourceId:'',bold:false,italic:false,underline:false}];repo.save(first);repo.save(second);
 assert.equal(repo.listFor(course).length,2);assert.equal(repo.load(course,first.id).atoms[0].value,'提纲内容');assert.equal(repo.load(course,second.id).atoms[0].value,'问题内容');assert.equal(repo.list().length,2);
 repo.delete(first);assert.equal(repo.listFor(course).length,1);assert.equal(repo.list()[0].id,second.id);
 repo.delete(second);assert.equal(repo.listFor(course).length,0);assert.equal(repo.list().length,0);assert.equal(repo.load(course).atoms.length,0);
});

test('download sections group all lessons of one course and deduplicate repeated lesson entries',()=>{
 const {courseSections}=load('model/CourseSections');
 const later={...course,subId:'second',start:course.start+86400},other={...course,courseId:'other',subId:'third'};
 const input=[course,later,other,course];
 const classes=courseSections(input,true);assert.equal(classes.length,2);assert.equal(classes.find(s=>s.id==='example').courses.length,2);
 const days=courseSections(input,false);assert.equal(days.length,2);assert.equal(days[0].courses[0].subId,'second');assert.equal(days[1].courses.length,2);
});
test('a failed PPT or transcript download keeps successful assets and retry fills only missing content',async()=>{
 const {lib}=offlineFixture();lib.api.slides=async()=>[slide('good',0),slide('bad',10)];
 lib.store.pinImage=async address=>{if(address.includes('bad'))throw Error('transfer failed');return 'file:///saved.jpg'};
 lib.api.transcripts=async()=>{throw Error('temporary ASR failure')};lib.api.videos=async()=>[];
 await assert.rejects(lib.download({course,options:{slides:true,transcript:true,video:true},progress:0}),/转写下载失败.*课件第 2 页（00:10）下载失败/);
 assert.equal(lib.list()[0].options.slides,true);assert.equal(lib.list()[0].options.transcript,false);assert.deepEqual(Array.from(lib.snapshot(course.subId).slides,s=>s.id),['good']);
 lib.store.pinImage=async()=> 'file:///saved.jpg';lib.api.transcripts=async()=>[{id:'l',t:1,text:'restored'}];
 await lib.download({course,options:{slides:true,transcript:true,video:false},progress:0});
 assert.equal(lib.snapshot(course.subId).slides.length,2);assert.equal(lib.snapshot(course.subId).lines[0].text,'restored');assert.equal(lib.list()[0].options.video,false);
});
function playerFixture(){
 const eventHandlers={},calls=[],reports=[],timers=new Map();let nextTimer=0;
 const video={duration:100,currentTime:0,paused:true,playbackRate:1,seekable:{length:1,start:()=>0,end:()=>100},addEventListener:(event,callback)=>eventHandlers[event]=callback,play(){this.paused=false;return Promise.resolve()},pause(){this.paused=true},removeAttribute(){this.src=''},load(){},canPlayType(){return 'probably'}};
 const box={style:{},textContent:''};
 class Hls {
  static Events={MEDIA_ATTACHED:'attached',LEVEL_LOADED:'level',ERROR:'error'};static isSupported(){return true}
  constructor(config){this.config=config;this.events={};Hls.latest=this}
  on(event,callback){this.events[event]=callback}attachMedia(){this.events.attached?.()}loadSource(url){this.url=url}destroy(){this.destroyed=true}stopLoad(){this.stopped=true}startLoad(at){this.loadedAt=at}
 }
 const context={document:{getElementById:id=>id==='v'?video:box},window:{Hls,innerWidth:1000},Hls,ClassroomBridge:{requestMedia(...args){calls.push(args)},update(raw){reports.push(JSON.parse(raw))},clicked(){}},performance:{now:()=>100},Date,Map,Uint8Array,ArrayBuffer,Number,atob:s=>Buffer.from(s,'base64').toString('binary'),setTimeout:(fn)=>{const id=++nextTimer;timers.set(id,fn);return id},clearTimeout:id=>timers.delete(id)};
 const html=fs.readFileSync(path.join(root,'../resources/rawfile/player.html'),'utf8');vm.runInNewContext(html.match(/<script>\s*([\s\S]*?)<\/script>/)[1],context);
 return{Player:context.window.Player,Hls,video,calls,reports,eventHandlers,timers,hint:box};
}
test('HLS uses credential-aware native loader even when Web claims native HLS support',()=>{
 const p=playerFixture();p.Player.load({url:'https://cmc.zju.edu.cn/index.m3u8',at:12,rate:1.5,courseStart:0});
 assert.equal(p.Hls.latest.url,'https://cmc.zju.edu.cn/index.m3u8','synchronous attach event must not race source loading');
 const loader=new p.Hls.latest.config.loader();let loaded;
 loader.load({url:'https://cmc.zju.edu.cn/a.ts',responseType:'arraybuffer',rangeStart:0,rangeEnd:3},{timeout:1000},{onSuccess:r=>loaded=r,onError(){},onTimeout(){}});
 assert.deepEqual(p.calls[0].slice(1),['https://cmc.zju.edu.cn/a.ts',0,3]);
 p.Player.mediaReply({id:p.calls[0][0],status:206,size:3,text:'',base64:Buffer.from([0,128,255]).toString('base64')});
 assert.deepEqual(Array.from(new Uint8Array(loaded.data)),[0,128,255]);assert.equal(p.timers.size,0);
 p.eventHandlers.loadedmetadata();assert.equal(p.video.currentTime,12);assert.equal(p.video.playbackRate,1.5);
});
test('video double tap toggles playback and horizontal swipe seeks in the expected direction',()=>{
 const p=playerFixture();p.Player.load({url:'https://cmc.zju.edu.cn/lesson.mp4'});
 const tap=(id,x)=>{p.eventHandlers.pointerdown({pointerId:id,button:0,clientX:x,clientY:30});p.eventHandlers.pointerup({pointerId:id})};
 tap(1,120);tap(2,120);assert.equal(p.video.paused,false,'double tap starts playback');
 p.eventHandlers.loadedmetadata();p.eventHandlers.pointerdown({pointerId:3,button:0,clientX:100,clientY:30});p.eventHandlers.pointermove({pointerId:3,clientX:200,clientY:30,cancelable:true,preventDefault(){}});p.eventHandlers.pointerup({pointerId:3});assert.ok(p.video.currentTime>0,'swipe to the right seeks forward');
});
test('switching video source ignores stale network replies, and explicit 403 remains a loader failure',()=>{
 const p=playerFixture();p.Player.load({url:'https://cmc.zju.edu.cn/a.m3u8'});let successes=0,failure;
 const make=()=>{const loader=new p.Hls.latest.config.loader();loader.load({url:'https://cmc.zju.edu.cn/a.m3u8'},{timeout:1000},{onSuccess:()=>successes++,onError:err=>failure=err,onTimeout(){}});return loader};
 make();const oldId=p.calls[0][0];p.Player.load({url:'https://cmc.zju.edu.cn/b.m3u8'});
 p.Player.mediaReply({id:oldId,status:200,text:'#EXTM3U',size:7});assert.equal(successes,0);
 make();p.Player.mediaReply({id:p.calls[1][0],status:403,error:'denied'});assert.equal(failure.code,403);assert.equal(successes,0);assert.equal(p.timers.size,0);
});
test('native video fetch sends exclusive byte ranges and handles a server ignoring Range',async()=>{
 let options;
 const request={request:async(url,o)=>{options=o;return{responseCode:200,header:{'content-type':'video/mp2t'},result:new Uint8Array([0,1,2,3,4]).buffer}},destroy(){}};
 const {VideoNetwork}=load('services/VideoNetwork',{'@kit.NetworkKit':{http:{createHttp:()=>request,HttpDataType:{ARRAY_BUFFER:1}}},'@kit.ArkTS':{util:{Base64Helper:class{encodeToStringSync(v){return Buffer.from(v).toString('base64')}async encodeToString(v){return Buffer.from(v).toString('base64')}}}}});
 const reply=await new VideoNetwork().read('id','https://cmc.zju.edu.cn/a.ts',1,4);
 assert.equal(options.header.Range,'bytes=1-3');assert.deepEqual(Array.from(Buffer.from(reply.base64,'base64')),[1,2,3]);assert.equal(reply.size,3);
});
test('original PPT transfer streams beyond the old 8 MiB limit and completes partial disk writes',async()=>{
 const files=new Map(),handlers={};let receivedSize=0;
 const io={OpenMode:{CREATE:1,WRITE_ONLY:2,TRUNC:4},accessSync:p=>!/\.(jpg|png|webp)$/.test(p),mkdirSync(){},readTextSync(){throw Error('missing')},openSync:p=>({fd:p}),closeSync(){},unlinkSync:p=>files.delete(p),writeSync:(p,data)=>{if(typeof data==='string'){files.set(p,data);return data.length}const count=Math.min(1024*1024,data.byteLength);receivedSize+=count;files.set(p,{size:receivedSize,mtime:1});return count},renameSync:(a,b)=>{files.set(b,files.get(a));files.delete(a)},statSync:p=>files.get(p),listFileSync:()=>[]};
 const req={on:(event,callback)=>handlers[event]=callback,destroy(){},requestInStream:async()=>{handlers.headersReceive({'Content-Type':'image/png'});handlers.dataReceive(new ArrayBuffer(9*1024*1024));handlers.dataEnd();return 200}};
 const {LocalStore}=load('services/LocalStore',{'@kit.NetworkKit':{http:{createHttp:()=>req}},'@kit.CoreFileKit':{fileIo:io,fileUri:{getUriFromPath:p=>'file://'+p}}});
 const result=await new LocalStore({filesDir:'/files',cacheDir:'/cache'},'alice').image('https://cmc.zju.edu.cn/a.png');assert.match(result,/\.png$/);assert.equal(receivedSize,9*1024*1024);
});

test('official object-shaped camera list and HLS addresses without file extensions are playable sources',()=>{
 const sources=media.mediaSources({sub_status:6,sub_content:JSON.stringify({save_playback:{contents:'https://classroom.zju.edu.cn/stream?id=fixture',is_m3u8:'yes'}}),video_list:{teacher:{type:4,preview_url:'https://cmc.zju.edu.cn/teacher.mp4'}}});
 assert.equal(sources.length,2);assert.equal(sources[0].hls,true);assert.equal(sources[1].title,'教室全景 · 课程录像');
 const p=playerFixture();p.Player.load({...sources[0],at:0,rate:1});assert.equal(p.Hls.latest.url,sources[0].url);
});

test('original image cache is still used when the persistent offline copy does not exist',()=>{
 const {LocalStore}=load('services/LocalStore',{'@kit.CoreFileKit':{fileIo:{mkdirSync(){},readTextSync(){throw Error('missing')},accessSync:p=>{if(p.includes('/saved-images/')||p.endsWith('.jpg'))throw Error('missing');return true}},fileUri:{getUriFromPath:p=>'file://'+p}}});
 const cached=new LocalStore({filesDir:'/files',cacheDir:'/cache'},'alice').cachedImage('https://cmc.zju.edu.cn/a.png');assert.match(cached,/\/files\/account-.*\/resource-cache\/slides\/assets\/.*\.png$/);
});

test('free-layout movement retains full panes beyond the visible workspace',()=>{
 const {alterPane,validPanes}=load('model/PaneLayout');
 const note={id:'notes',x:0.4,y:0.2,w:0.4,h:0.5,z:4},ai={id:'ai',x:0,y:0,w:0.3,h:0.7,z:1};
 const moved=alterPane(note,0.9,-1,false);assert.equal(moved.x,0.96);assert.equal(moved.y,0);assert.equal(moved.w,0.4);assert.equal(ai.x,0);
 const resized=alterPane(note,0.9,0.9,true);assert.equal(resized.w,1);assert.equal(resized.h,1);assert.equal(resized.x,0.4);assert.ok(Math.abs(resized.y-0.2)<1e-9);
 const minimum=alterPane(note,-1,-1,true);assert.equal(minimum.w,0.12);assert.equal(minimum.h,0.12);
 const restored=validPanes([note,ai,note,{...note,id:'unknown'},{...ai,x:NaN}]);assert.equal(restored.length,2);
});
test('layout presets distribute all five features without forcing notes and AI into columns',()=>{
 const {defaultPanes}=load('model/PaneLayout'),ids=['video','slides','transcript','notes','ai'];
 const rows=defaultPanes(ids,false,'rows'),columns=defaultPanes(ids,false,'columns');
 assert.equal(rows.length,5);assert.equal(columns.length,5);assert.ok(rows.every(p=>p.w===1));assert.ok(columns.every(p=>p.h===1));
 const automatic=defaultPanes(ids,false),notes=automatic.find(p=>p.id==='notes'),ai=automatic.find(p=>p.id==='ai');assert.equal(notes.x,ai.x);assert.notEqual(notes.y,ai.y);
 for(const pane of [...rows,...columns,...automatic]){assert.ok(pane.x>=0&&pane.y>=0);assert.ok(pane.x+pane.w<=1.00001&&pane.y+pane.h<=1.00001);}
});

test('physical login digits cover both keyboard rows without intercepting shortcuts or letters',()=>{
 const {physicalDigit}=load('model/KeyboardInput');
 for(let n=0;n<10;n++){assert.equal(physicalDigit(2000+n,false),String(n));assert.equal(physicalDigit(2103+n,false),String(n));assert.equal(physicalDigit(2000+n,true),'');}
 assert.equal(physicalDigit(2017,false,'a'),'');assert.equal(physicalDigit(999,false,'5'),'5');assert.equal(physicalDigit(999,false,'55'),'');
});
test('gravity rotation ignores flat and diagonal poses and handles both landscape directions',()=>{
 const {gravityOrientation}=load('model/GravityOrientation');
 assert.equal(gravityOrientation(9.8,0),'landscape');assert.equal(gravityOrientation(-9.8,1),'landscape');
 assert.equal(gravityOrientation(0,9.8),'portrait');assert.equal(gravityOrientation(1,-9.8),'portrait');
 for(const [x,y] of [[0,0],[6.8,6.8],[NaN,9.8],[9.8,Infinity]])assert.equal(gravityOrientation(x,y),'');
});

test('all resize edges keep opposite edges fixed and retain a recoverable visible portion',()=>{
 const {resizePane}=load('model/PaneLayout'),rect={id:'notes',x:0.2,y:0.25,w:0.5,h:0.5,z:2};
 const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9);
 for(const edge of ['n','s','w','e','nw','ne','sw','se']){
  const next=resizePane(rect,0.05,0.06,edge);
  if(edge.includes('w'))near(next.x+next.w,rect.x+rect.w);else near(next.x,rect.x);
  if(edge.includes('n'))near(next.y+next.h,rect.y+rect.h);else near(next.y,rect.y);
  if(!edge.includes('w')&&!edge.includes('e'))near(next.w,rect.w);
  if(!edge.includes('n')&&!edge.includes('s'))near(next.h,rect.h);
  for(const delta of [-5,5]){const bounded=resizePane(rect,delta,delta,edge);assert.ok(bounded.y>=0);assert.ok(bounded.w>=0.12-1e-9&&bounded.h>=0.12-1e-9&&bounded.w<=1&&bounded.h<=1);assert.ok(Math.min(1,bounded.x+bounded.w)-Math.max(0,bounded.x)>=0.04-1e-9);assert.ok(Math.min(1,bounded.y+bounded.h)-Math.max(0,bounded.y)>=0.04-1e-9);}
 }
});
test('saved layouts only match the exact feature set and window size',()=>{
 const {layoutKey,matchingLayout}=load('model/PaneLayout');
 assert.equal(layoutKey(['notes','slides'],1200,800),layoutKey(['slides','notes'],1200,800));
 assert.notEqual(layoutKey(['notes','slides'],1200,800),layoutKey(['notes','slides'],1200,801));
 assert.notEqual(layoutKey(['notes','slides'],1200,800),layoutKey(['ai','slides'],1200,800));
 const rects=[{id:'slides',x:0,y:0,w:0.6,h:1,z:0},{id:'notes',x:0.4,y:0,w:0.6,h:1,z:1}];
 assert.equal(matchingLayout(rects,['notes','slides']).length,2);assert.equal(matchingLayout(rects,['slides']).length,0);assert.equal(matchingLayout(rects,['slides','ai']).length,0);
});
test('layer controls reorder overlapping panes without moving or resizing them',()=>{
 const {reorderPanes}=load('model/PaneLayout');const panes=['slides','notes','ai'].map((id,z)=>({id,x:0.1,y:0.1,w:0.6,h:0.6,z}));
 const order=(action)=>Array.from(reorderPanes(panes,'notes',action),p=>p.id);
 assert.deepEqual(order('top'),['slides','ai','notes']);assert.deepEqual(order('bottom'),['notes','slides','ai']);assert.deepEqual(order('up'),order('top'));assert.deepEqual(order('down'),order('bottom'));
 let repeatedly=panes;for(let i=0;i<300;i++)repeatedly=reorderPanes(repeatedly,'notes','top');
 assert.deepEqual(Array.from(repeatedly,p=>p.z),[0,1,2]);assert.ok(repeatedly.every(p=>p.x===0.1&&p.y===0.1&&p.w===0.6&&p.h===0.6));assert.deepEqual(panes.map(p=>p.z),[0,1,2]);
});
test('official login digit insertion replaces selection and refuses unrelated or readonly fields',()=>{
 const {officialDigitScript}=load('model/OfficialLogin');
 function run({digit='7',origin='https://zjuam.zju.edu.cn',readonly=false,type='password'}={}){
  const events=[],input={tagName:'INPUT',type,value:'a12b',selectionStart:1,selectionEnd:3,readOnly:readonly,setSelectionRange(a,b){this.selectionStart=a;this.selectionEnd=b},dispatchEvent:e=>events.push(e)};
  const result=vm.runInNewContext(officialDigitScript(digit),{location:{origin,pathname:'/cas/login'},document:{activeElement:input},Event:class{constructor(type){this.type=type}}});return{result,input,events};
 }
 const inserted=run();assert.equal(inserted.result,'inserted');assert.equal(inserted.input.value,'a7b');assert.equal(inserted.input.selectionStart,2);assert.equal(inserted.events.length,1);
 assert.equal(run({readonly:true}).input.value,'a12b');assert.equal(run({origin:'https://other.test'}).input.value,'a12b');assert.equal(run({digit:'x'}).result,'ignored');
});

test('scoped select-all adds visible lessons and scoped deselection preserves other dates and courses',()=>{
 const {toggleScopedSelection,scopeSelected}=load('model/CourseSections');
 const rows=[{...course,subId:'a'},{...course,subId:'b'}];
 assert.equal(scopeSelected([],[]),false);
 assert.deepEqual(Array.from(toggleScopedSelection(['outside','a'],rows)),['outside','a','b']);
 assert.deepEqual(Array.from(toggleScopedSelection(['outside','a','b'],rows)),['outside']);
 assert.deepEqual(Array.from(toggleScopedSelection(['outside'],[])),['outside']);
 assert.deepEqual(Array.from(toggleScopedSelection([],rows)),['a','b']);
});

test('off-window coordinates survive save and restoring visibility preserves pane dimensions and layer',()=>{
 const {validPanes,matchingLayout,recoverPane}=load('model/PaneLayout');
 const pane={id:'notes',x:-0.3,y:0.8,w:0.6,h:0.5,z:4};
 assert.deepEqual(JSON.parse(JSON.stringify(validPanes([pane]))),[pane]);
 assert.deepEqual(JSON.parse(JSON.stringify(matchingLayout([pane],['notes']))),[pane]);
 const recovered=recoverPane(pane);assert.equal(recovered.x,0);assert.equal(recovered.y,0.5);assert.equal(recovered.w,pane.w);assert.equal(recovered.h,pane.h);assert.equal(recovered.z,pane.z);
});
test('notes arrows cross image placeholders and emoji without splitting characters',()=>{
 const {cursorStep,lineCaret}=load('model/NoteCursor');
 const text='A😀\uFFFCB';assert.equal(cursorStep(text,1,true),3);assert.equal(cursorStep(text,3,false),1);assert.equal(cursorStep(text,3,true),4);assert.equal(cursorStep(text,0,false),0);assert.equal(cursorStep(text,text.length,true),text.length);
 assert.equal(lineCaret('abc\nx\n1234',2,true),5);assert.equal(lineCaret('abc\nx\n1234',8,false),5);assert.equal(lineCaret('\na',0,true),1);assert.equal(lineCaret('\na',1,false),0);assert.equal(lineCaret('abc',2,false),2);
});
test('block notes migrate old rich spans and keep source times independent from insertions',()=>{
 const {noteBlocks,insertNoteBlock,blockText}=load('model/NoteBlocks');
 const atom=(value,bold=false)=>({id:value,kind:'text',value,at:12,end:12,sourceId:'',bold,italic:false,underline:false});
 const migrated=noteBlocks({atoms:[atom('ab',true),atom('cd\nnext'),{...atom('img'),kind:'image',sourceId:'slide-1',at:30},{...atom('quote'),kind:'quote',at:42}],anchors:[{offset:0,at:12},{offset:5,at:20}]});
 assert.deepEqual(Array.from(migrated,b=>[b.source,b.at]),[['notes',12],['notes',20],['slides',30],['transcript',42]]);assert.equal(blockText(migrated[0]),'abcd');assert.equal(migrated[0].atoms[0].bold,true);
 const inserted={id:'newimage',source:'image',at:80,end:80,sourceId:'',atoms:[{...atom('uri'),kind:'image',at:80}]};
 const result=insertNoteBlock(migrated,migrated[0].id,3,inserted,90);
 assert.deepEqual(Array.from(result.blocks,b=>[b.source,b.at]),[['notes',12],['image',80],['notes',12],['notes',20],['slides',30],['transcript',42]]);
 assert.equal(blockText(result.blocks[0]),'abc');assert.equal(blockText(result.blocks[2]),'d');assert.equal(result.activeId,result.blocks[2].id);assert.equal(result.caret,0);assert.equal(blockText(migrated[0]),'abcd');
});
test('insertion into an empty paragraph replaces it and colors are limited to the pastel palette',()=>{
 const {emptyNoteBlock,insertNoteBlock,defaultNotePalette,validNotePalette,noteColors}=load('model/NoteBlocks');
 const empty=emptyNoteBlock(10),quote={id:'quote',source:'transcript',at:50,end:52,sourceId:'caption',atoms:[]};const result=insertNoteBlock([empty],empty.id,0,quote,60);
 assert.deepEqual(Array.from(result.blocks,b=>b.source),['transcript','notes']);assert.equal(result.blocks[0].at,50);assert.equal(result.blocks[1].at,60);
 const palette=validNotePalette({...defaultNotePalette(),notes:'#FFFFFF',image:noteColors[4]});assert.equal(palette.notes,defaultNotePalette().notes);assert.equal(palette.image,noteColors[4]);
});
test('AI HTTP streaming exposes an incomplete answer before dataEnd or request completion',async()=>{
 const callbacks={};let end,first='';const waiting=new Promise(resolve=>end=resolve);
 const req={on:(name,fn)=>callbacks[name]=fn,destroy(){},requestInStream:async()=>200};
 req.requestInStream=async()=>{const bytes=Buffer.from('data: {"choices":[{"delta":{"content":"first"}}]}\n\n');callbacks.dataReceive(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));await waiting;const final=Buffer.from('data: [DONE]\n\n');callbacks.dataReceive(final.buffer.slice(final.byteOffset,final.byteOffset+final.byteLength));callbacks.dataEnd();return 200};
 const {AiClient}=load('services/AiClient',{'@kit.NetworkKit':{http:{createHttp:()=>req,RequestMethod:{POST:1}}},'@kit.ArkTS':{util:{TextDecoder:{create:()=>({decodeToString:data=>Buffer.from(data).toString('utf8')})}}}});
 const promise=new AiClient().stream('test',{model:'test',messages:[],stream:true},value=>first=value);await Promise.resolve();assert.equal(first,'first');end();const result=await promise;assert.equal(result.answer,'first');assert.equal(result.done,true);
});
test('inserting media removes obsolete blank positioning paragraphs but preserves written notes',()=>{
 const {emptyNoteBlock,insertNoteBlock}=load('model/NoteBlocks');
 const empty=emptyNoteBlock(1),blank=emptyNoteBlock(2),written=emptyNoteBlock(3);written.atoms=[{id:'text',kind:'text',value:'keep',at:3,end:3,sourceId:'',bold:false,italic:false,underline:false}];
 const image={id:'image',source:'image',at:9,end:9,sourceId:'',atoms:[]};const result=insertNoteBlock([empty,blank,written],blank.id,0,image,10);
 assert.deepEqual(Array.from(result.blocks,b=>b.id),['image',written.id]);assert.equal(result.activeId,written.id);assert.equal(result.blocks[1].atoms[0].value,'keep');
});
test('spoken sentence selection handles starts, ends, pauses and incomplete live timing',()=>{
 const {spokenLineIndex}=load('model/TranscriptPlayback');const rows=[{id:'a',t:10,end:14,text:'a'},{id:'b',t:20,end:35,text:'b'},{id:'c',t:30,end:30,text:'c'}];
 for(const [at,index] of [[9,-1],[10,0],[13.9,0],[14,-1],[19,-1],[20,1],[29.9,1],[30,2],[37.9,2],[38,-1],[NaN,-1]])assert.equal(spokenLineIndex(rows,at),index);
});
test('moving or resizing upwards never loses the pane header and does not cut content dimensions',()=>{
 const {alterPane,resizePane}=load('model/PaneLayout'),pane={id:'notes',x:0.2,y:0.2,w:0.5,h:0.4,z:1};
 const moved=alterPane(pane,-0.4,-2,false);assert.equal(moved.y,0);assert.equal(moved.x,-0.2);assert.equal(moved.h,0.4);
 const resized=resizePane(pane,0,-2,'n');assert.equal(resized.y,0);assert.ok(Math.abs(resized.h-0.6)<1e-9);
});
test('AI time-range citations link to the start of the quoted passage',()=>{
 const {answerParts}=load('model/AiStream');const linked=answerParts('讲解 [03:01—03:06]，补充 [1:02:03 - 1:03:00]。').filter(part=>part.seconds>=0);
 assert.deepEqual(Array.from(linked,part=>part.seconds),[181,3723]);assert.equal(linked[0].value,'[03:01—03:06]');
});
test('a new note paragraph captures the first typing time and retains it through later edits',()=>{
 const {emptyNoteBlock,updateNoteBlock}=load('model/NoteBlocks');const empty=emptyNoteBlock(1),atom={id:'text',kind:'text',value:'hello',at:1,end:1,sourceId:'',bold:true,italic:false,underline:false};
 const first=updateNoteBlock(empty,[atom],180),later=updateNoteBlock(first,[{...atom,value:'hello world'}],260);
 assert.equal(first.at,180);assert.equal(first.atoms[0].at,180);assert.equal(later.at,180);assert.equal(later.atoms[0].bold,true);
});

test('restored and exported notes discard positioning blanks without losing referenced media',()=>{
 const {cleanNoteBlocks,emptyNoteBlock}=load('model/NoteBlocks');
 const a=emptyNoteBlock(10),b=emptyNoteBlock(20),c=emptyNoteBlock(30);
 a.atoms=[{kind:'text',value:'   '}]; c.atoms=[{kind:'text',value:'typed',bold:true}];
 const image={id:'photo',source:'image',at:25,atoms:[{kind:'image',value:'file://photo'}]};
 const result=cleanNoteBlocks([a,b,image,c],'');
 assert.deepEqual(Array.from(result,x=>x.id),['photo',c.id]);assert.equal(result[1].atoms[0].bold,true);
 assert.deepEqual(Array.from(cleanNoteBlocks([a,b,image,c],b.id),x=>x.id),[b.id,'photo',c.id]);
});
test('middle insertions preserve the tail and reuse it instead of leaving an empty editor between cards',()=>{
 const {emptyNoteBlock,insertNoteBlock,blockText}=load('model/NoteBlocks');
 const written=(value)=>({...emptyNoteBlock(10),atoms:[{kind:'text',value,bold:true}]});
 const first=written('before'),position=emptyNoteBlock(20),tail=written('last');
 const quote={id:'quote',source:'transcript',at:50,end:52,sourceId:'spoken',atoms:[{kind:'quote',value:'reference'}]};
 const result=insertNoteBlock([first,position,tail],position.id,0,quote,60);
 assert.deepEqual(Array.from(result.blocks,blockText),['before','reference','last']);
 assert.equal(result.activeId,tail.id);assert.equal(result.caret,0);assert.equal(result.blocks[2].atoms[0].bold,true);
});

test('caption history discovers the official interactive backend independently and caches only successful routes',async()=>{
 const api=new Zhiyun(),calls=[];
 api.request=async(p,body,origin)=>{calls.push(origin);return JSON.stringify({code:0,list:origin.includes('interactivemeta')?[{all_content:[{BeginSec:10,EndSec:12,Text:'history'}]}]:[]})};
 assert.equal((await api.transcripts(course))[0].text,'history');assert.equal(calls.length,2);calls.length=0;
 assert.equal((await api.transcripts(course)).length,1);assert.equal(calls.length,1);assert.match(calls[0],/interactivemeta/);
});
test('caption history denial is final and never tries another backend',async()=>{
 const api=new Zhiyun();let calls=0;api.request=async()=>{calls++;throw new AccessDenied('denied')};
 await assert.rejects(api.transcripts(course),AccessDenied);assert.equal(calls,1);
});
test('live caption metadata reads the official media record when the portal omits the host',async()=>{
 const api=new Zhiyun();let calls=0;api.request=async()=>{calls++;return JSON.stringify({code:0,list:[{sub_id:course.subId,sub_content:JSON.stringify({trans_socket_url:'https://caption.cmc.zju.edu.cn'})}]})};
 assert.equal(await api.liveCaptionAddress(course,{}),'https://caption.cmc.zju.edu.cn');assert.equal(calls,1);
 assert.equal(await api.liveCaptionAddress(course,{content:{trans_socket_url:'https://other.zju.edu.cn'}}),'https://other.zju.edu.cn');assert.equal(calls,1);
});
test('official caption endpoints retain scheme, campus IP, full route and query without duplicate glue paths',()=>{
 const {captionSocketUrl}=load('services/LiveTranscript');
 for(const [raw,expected] of [['https://caption.zju.edu.cn','wss://caption.zju.edu.cn/glue/ws'],['ws://10.0.0.2:9001','ws://10.0.0.2:9001/glue/ws'],['wss://caption.zju.edu.cn/glue/ws?session=a','wss://caption.zju.edu.cn/glue/ws?session=a'],['//caption.zju.edu.cn?session=a','wss://caption.zju.edu.cn/glue/ws?session=a']])assert.equal(captionSocketUrl(raw),expected);
 for(const raw of ['file:///private','https://user:pass@host','javascript:test','https://host/#fragment'])assert.equal(captionSocketUrl(raw),'');
});
test('camera options collapse teacher qualities and signed mirrors while preserving distinct stream IDs',()=>{
 const sources=media.mediaSources({sub_status:6,content:{save_playback:{contents:'https://cmc.zju.edu.cn/main.mp4?token=a',play_addres_arr:{default:'https://cmc.zju.edu.cn/low.mp4',HD:'https://cmc.zju.edu.cn/high.mp4'}}},video_list:[{preview_url:'https://cmc.zju.edu.cn/main.mp4?token=b'},{preview_url:'https://classroom.zju.edu.cn/stream?id=room'},{preview_url:'https://classroom.zju.edu.cn/stream?id=teacher'}]});
 assert.equal(sources.length,3);assert.equal(sources.filter(s=>s.title.includes('教师主画面')).length,1);
});
test('live stream without a DVR range ignores slider and swipe seeks, DVR range allows rewind',()=>{
 const p=playerFixture();p.video.seekable={length:1,start:()=>90,end:()=>100};p.video.currentTime=98;
 p.Player.load({url:'https://cmc.zju.edu.cn/live.m3u8',live:true,courseStart:Date.now()/1000-100});p.Player.seek(91);assert.equal(p.video.currentTime,98);
 p.eventHandlers.pointerdown({pointerId:1,button:0,clientX:100,clientY:30});p.eventHandlers.pointermove({pointerId:1,clientX:200,clientY:30,cancelable:true,preventDefault(){}});assert.equal(p.video.currentTime,98);
 p.video.seekable={length:1,start:()=>0,end:()=>100};p.Player.seek(40);assert.equal(p.video.currentTime,40);
});

test('native live captions decode binary UTF8 glue frames and preserve server sentence timing',async()=>{
 const handlers={},sent=[],rows=[];const socket={on:(name,fn)=>handlers[name]=fn,off(){},send:async(value)=>sent.push(value),connect:async()=>{},close:async()=>{}};
 const {LiveTranscript}=load('services/LiveTranscript',{'@kit.NetworkKit':{webSocket:{createWebSocket:()=>socket}},'@kit.ArkTS':{util:{TextDecoder:{create:()=>({decodeToString:data=>Buffer.from(data).toString('utf8')})}}}});
 const live=new LiveTranscript();try{live.connect('wss://caption.zju.edu.cn',course.start,row=>rows.push(row),()=>{});handlers.open();
 const bytes=Buffer.from('cd1&m'+JSON.stringify({sourcetext:'课堂内容',BeginSec:60,EndSec:65,end_time:1}));handlers.message(null,bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
 assert.equal(rows[0].text,'课堂内容');assert.equal(rows[0].t,60);assert.equal(rows[0].end,65);assert.equal(rows[0].timing,'source');assert.equal(sent[0],'in{"version":"1.9.1"}');}finally{live.close()}
});


test('caption times parse numeric milliseconds, Unix seconds, relative seconds and China-local strings',()=>{
 const {captionSeconds}=load('model/CaptionTime'),start=1791597600;
 for(const [value,expected] of [[1791598413046,813.046],['1791598413046',813.046],[1791598413,813],['813',813],['2026-10-10 10:13:33',813],[0,0]])assert.ok(Math.abs(captionSeconds(value,start)-expected)<1e-6);
 for(const value of [undefined,'','invalid'])assert.ok(Number.isNaN(captionSeconds(value,start)));
});
test('live classroom numeric timestamps render partial sentences once and blank finals close the sentence',()=>{
 const handlers={},rows=[];const socket={on:(name,fn)=>handlers[name]=fn,off(){},send:async()=>{},connect:async()=>{},close:async()=>{}};
 const {LiveTranscript}=load('services/LiveTranscript',{'@kit.NetworkKit':{webSocket:{createWebSocket:()=>socket}}});const live=new LiveTranscript();
 try{live.connect('wss://caption.zju.edu.cn',1791597600,row=>rows.push(row),()=>{});
 const send=(raw)=>handlers.message(null,'cd1&m'+JSON.stringify(raw));
 send({sourcetext:'第一',time:1791598413046,end_time:0});send({sourcetext:'第一句话',time:1791598413316,end_time:0});
 assert.equal(rows.length,2);assert.equal(rows[0].id,rows[1].id);assert.equal(rows[0].t,rows[1].t);assert.ok(Math.abs(rows[0].t-813.046)<1e-6);
 send({sourcetext:'',time:1791598414000,end_time:1});send({sourcetext:'下一句话',time:1791598415000,end_time:0});assert.notEqual(rows[1].id,rows[2].id);
 }finally{live.close()}
});
test('numeric historical wall times include sourcetext and keep timeline intervals',async()=>{
 const api=new Zhiyun();api.request=async()=>JSON.stringify({code:0,list:[{all_content:[{time:1791598413046,sourcetext:'历史第一句'},{time:'1791598415000',sourcetext:'历史第二句'}]}]});
 const result=await api.transcripts({...course,start:1791597600});assert.equal(result.length,2);assert.ok(Math.abs(result[0].t-813.046)<1e-6);assert.equal(result[0].end,815);assert.equal(result[1].t,815);
});

test('PPT absolute capture time aligns with ASR rather than recording-start relative seconds',async()=>{
 const api=new Zhiyun();api.request=async()=>JSON.stringify({code:0,total:3,list:[
  {id:'pre',created_sec:1,ppt:{created:1791597368000,pptimgurl:'https://cmc.zju.edu.cn/pre.png'}},
  {id:'page',created_sec:272,ppt:{created:1791597641000,pptimgurl:'https://cmc.zju.edu.cn/page.png'}},
  {id:'legacy',created_sec:500,ppt:{pptimgurl:'https://cmc.zju.edu.cn/legacy.png'}}]});
 const pages=await api.slides({...course,start:1791597600});assert.deepEqual(Array.from(pages,s=>s.t),[0,41,500]);
 const groups=timeline.groupPages(pages,[{id:'sentence',t:50,end:60,text:'对应第二页'}]);assert.equal(groups[1].lines[0].id,'sentence');
});
test('manual two-page browsing skips empty pages while video still displays its actual page',()=>{
 const {manualPage,displayedGroups}=load('model/StudyNavigation');const groups=Array.from({length:7},(_,i)=>({slide:slide(String(i),i*60),lines:i%2===0?[{id:'l'+i,t:i*60,end:i*60+10,text:'讲解'}]:[]}));
 const ids=(pages)=>Array.from(pages,g=>g.slide.id);
 assert.deepEqual(ids(displayedGroups(groups,0,2,true,true)),['0','2']);assert.equal(manualPage(groups,0,2,1,true),4);assert.equal(manualPage(groups,4,2,-1,true),0);
 assert.deepEqual(ids(displayedGroups(groups,1,2,true,false)),['1','2']);
 assert.deepEqual(ids(displayedGroups(groups,1,2,true,true)),['1','2']);assert.equal(manualPage(groups,1,2,1,true),4);
});
test('live source start/end times keep a stable sentence ID and match archived sentence timing',async()=>{
 const handlers={},rows=[];const socket={on:(name,fn)=>handlers[name]=fn,off(){},send:async()=>{},connect:async()=>{},close:async()=>{}};
 const {LiveTranscript}=load('services/LiveTranscript',{'@kit.NetworkKit':{webSocket:{createWebSocket:()=>socket}}});const live=new LiveTranscript();
 const base=1791597600,first={sourcetext:'第一',time:1791598559000,text_begin_time:1791598552476,text_end_time:1791598559000,end_time:0},final={...first,sourcetext:'第一句话',time:1791598560000,text_end_time:1791598560000,end_time:1};
 try{live.connect('wss://caption.zju.edu.cn',base,row=>rows.push(row),()=>{});for(const raw of [first,final])handlers.message(null,'cd1&m'+JSON.stringify(raw));assert.equal(rows[0].id,rows[1].id);assert.ok(Math.abs(rows[0].t-952.476)<1e-6);assert.equal(rows[1].end,960);
 const api=new Zhiyun();api.request=async()=>JSON.stringify({code:0,list:[{all_content:[final]}]});const history=await api.transcripts({...course,start:base});assert.equal(history[0].id,rows[0].id);const combined=timeline.reconcileLines(rows,history);assert.equal(combined.length,1);assert.equal(combined[0].timing,'history');
 }finally{live.close()}
});
test('explicit no-live-history response stays empty and does not discard locally recorded captions',async()=>{
 const api=new Zhiyun();let calls=0;api.request=async()=>{calls++;return JSON.stringify({code:10002,msg:'未查询到语音数据',total:0,list:[]})};
 const history=await api.transcripts(course);assert.equal(calls,2);assert.equal(history.length,0);
 const saved=[{id:'local',t:900,end:905,text:'已保存的句子',timing:'source'}];assert.equal(timeline.reconcileLines(saved,history)[0].text,'已保存的句子');
});
test('source availability rejects missing/HTML/empty sources before exposing the selector',async()=>{
 let response={responseCode:200,header:{'Content-Type':'application/vnd.apple.mpegurl','Content-Length':'100'}};const req={request:async()=>response,destroy(){}};
 const {VideoNetwork}=load('services/VideoNetwork',{'@kit.NetworkKit':{http:{createHttp:()=>req,RequestMethod:{HEAD:1}}}});const network=new VideoNetwork(),url='https://cmc.zju.edu.cn/index.m3u8';
 assert.equal(await network.available(url),true);
 for(const r of [{responseCode:404,header:{}},{responseCode:200,header:{'content-type':'text/html'}},{responseCode:200,header:{'content-length':'0'}}]){response=r;assert.equal(await network.available(url),false)}
});

test('default full tablet layout leaves both slides wide enough and captions underneath',()=>{
 const {defaultPanes}=load('model/PaneLayout');const rects=defaultPanes(['slides','transcript'],false);const a=rects.find(r=>r.id==='slides'),b=rects.find(r=>r.id==='transcript');
 assert.equal(a.w,1);assert.equal(b.w,1);assert.equal(a.y+a.h,b.y);assert.equal(timeline.pageCapacity(a.w*1420,a.h*800,1420,945,false),2);
 const explicit=defaultPanes(['slides','transcript'],false,'columns');assert.equal(explicit[0].w,0.5);
});
test('explicit AI page selection includes future-page timing, excludes unrelated pages and stale chat context',async()=>{
 const {AiClient}=load('services/AiClient');AiClient.savedKey=async()=> 'test-fixture';const ai=new AiClient();let body;
 ai.stream=async(k,b,changed)=>{body=b;changed('回答');return {answer:'回答',calls:[]}};
 const store={cache:{revision:()=>0},readJson:()=>'',saveJson(){}};const slides=[slide('one',0),slide('two',60),slide('three',120)],lines=[{id:'l1',t:5,end:10,text:'第一页独有讲解'},{id:'l2',t:65,end:70,text:'第二页独有讲解',timing:'source'},{id:'l3',t:125,end:130,text:'第三页独有讲解'}];
 await ai.ask(store,slides,lines,'选中页讲了什么',30,false,'fixture',[{question:'之前另一页',answer:'不应混入',at:1,whole:false}],()=>{},'never','one',()=>{},['two']);
 const system=body.messages.filter(m=>m.role==='system').map(m=>m.content).join('\n');assert.ok(system.includes('第二页独有讲解'));assert.ok(!system.includes('第一页独有讲解'));assert.ok(!system.includes('第三页独有讲解'));assert.ok(system.includes('后续内容注明发生在提问之后'));assert.ok(!system.includes('只可引用提问时间及之前的材料'));assert.ok(system.includes('进入前或断开期间可能缺失'));assert.equal(body.messages.length,4);assert.deepEqual(Array.from(body.tools || [], tool=>tool.function.name),['read_course_context']);
});

test('offline export preserves received live captions when the platform has no archived transcript',async()=>{
 const {lib,files}=offlineFixture();files.set('cache',{course,slides:[],lines:[{id:'live',t:900,end:905,text:'已经收到的讲解',timing:'source'}]});lib.api.transcripts=async()=>[];
 await assert.rejects(lib.download({course,options:{slides:false,transcript:true,video:false},progress:0}),/已保存本机转写/);
 assert.equal(lib.snapshot(course.subId).lines[0].text,'已经收到的讲解');assert.equal(lib.list()[0].options.transcript,true);
});
test('archived final captions reconcile emission timestamps with the captured sentence start',()=>{
 const merged=timeline.reconcileLines([{id:'asr:10',t:10,end:18,text:'这是完整的一句话',timing:'source'}],[{id:'asr:18',t:18,end:18,text:'这是完整的一句话',timing:'history'}]);
 assert.equal(merged.length,1);assert.equal(merged[0].t,10);assert.equal(merged[0].timing,'history');
});

test('live page summaries wait for a manual request and replace provisional answers when the page ends',()=>{
 const {summaryDue}=load('model/SummaryPolicy');const partial={answer:'阶段结果',signature:'a',savedAt:1000,completed:false};
 assert.equal(summaryDue(true,false,false,undefined,'a',1000),false);
 assert.equal(summaryDue(true,false,true,undefined,'a',1000),true);
 assert.equal(summaryDue(true,false,false,partial,'b',1001),false);
 assert.equal(summaryDue(true,true,false,partial,'a',1001),true,'page change must regenerate even with no newly received caption');
 assert.equal(summaryDue(true,true,false,{answer:'旧版本速览',signature:'a',savedAt:1000},'a',1001),true,'legacy cache must receive a completed summary');
 const complete={...partial,completed:true};assert.equal(summaryDue(true,true,false,complete,'a',1001),false);
 assert.equal(summaryDue(true,true,false,complete,'b',47000),false,'completed cached answers remain stable until explicitly regenerated');
 assert.equal(summaryDue(false,false,false,undefined,'a',1000),true);
 assert.equal(summaryDue(false,false,false,partial,'a',1001),true,'the last provisional page also completes when the lesson ends');
});
test('overview brush supports range addition removal and moving backward without disturbing other pages',()=>{
 const {brushRange}=load('model/SelectionBrush'),ids=['a','b','c','d','e'];
 assert.deepEqual(Array.from(brushRange(ids,['e'],1,3,true)),['b','c','d','e']);
 assert.deepEqual(Array.from(brushRange(ids,['e'],1,2,true)),['b','c','e']);
 assert.deepEqual(Array.from(brushRange(ids,ids,3,1,false)),['a','e']);
});
test('compressed dark grey sidebars crop on both sides while black-background text slides are preserved',()=>{
 const w=160,h=90,region={x:20,y:0,width:120,height:90},pixels=imageFixture(w,h,region);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(x<20||x>=140){const i=(y*w+x)*4;pixels[i]=pixels[i+1]=pixels[i+2]=30+(x%3-1)}
 assert.deepEqual({...blackBorderRegion(pixels,w,h)},region);
 const dark=imageFixture(w,h,undefined);for(let y=25;y<30;y++)for(let x=35;x<120;x++){const i=(y*w+x)*4;dark[i]=dark[i+1]=dark[i+2]=255}
 assert.equal(blackBorderRegion(dark,w,h),undefined,'a black slide with sparse text is not a letterbox');
});
test('camera deduplication requires two matching nonblank frames and tolerates encoding noise',()=>{
 const {frameSignature,sameFrames}=load('model/VideoFingerprint');
 const bytes=imageFixture(64,36,{x:10,y:0,width:30,height:36}),base=frameSignature(bytes,64,36,256);
 const noise={samples:Array.from(base.samples,v=>Math.min(255,v+3)),contrast:base.contrast};
 assert.equal(sameFrames([base,base],[noise,noise]),true);
 const other=frameSignature(imageFixture(64,36,{x:30,y:0,width:30,height:36}),64,36,256);assert.equal(sameFrames([base,base],[base,other]),false);
 const blank=frameSignature(imageFixture(64,36,undefined),64,36,256);assert.equal(sameFrames([blank,blank],[blank,blank]),false);assert.equal(sameFrames([base],[base]),false);
});
test('live mode hides seek and speed behavior until replay is explicitly entered then returns to the live edge',()=>{
 const p=playerFixture();p.Player.load({url:'https://cmc.zju.edu.cn/live.m3u8',live:true,liveCourse:true,replay:false,at:10,rate:4,courseStart:Date.now()/1000-100});p.eventHandlers.loadedmetadata();
 assert.ok(p.video.currentTime>99);assert.equal(p.video.playbackRate,1);
 p.Player.seek(40);assert.ok(p.video.currentTime>99);p.Player.rate(3);assert.equal(p.video.playbackRate,1);
 p.Player.replay(true);p.Player.seek(40);p.Player.rate(3);assert.equal(p.video.currentTime,40);assert.equal(p.video.playbackRate,3);
 p.Player.replay(false);assert.ok(p.video.currentTime>99);assert.equal(p.video.playbackRate,1);
});
test('video drag displays signed delta seconds with stronger continuous distance mapping',()=>{
 const p=playerFixture();p.Player.load({url:'https://cmc.zju.edu.cn/lesson.mp4'});p.eventHandlers.loadedmetadata();p.video.currentTime=40;
 p.eventHandlers.pointerdown({pointerId:1,button:0,clientX:100,clientY:30});p.eventHandlers.pointermove({pointerId:1,clientX:200,clientY:30,cancelable:true,preventDefault(){}});
 assert.equal(p.video.currentTime,58);assert.equal(p.hint.textContent,'+18 秒');
 p.eventHandlers.pointermove({pointerId:1,clientX:50,clientY:30,cancelable:true,preventDefault(){}});assert.equal(p.video.currentTime,31);assert.equal(p.hint.textContent,'-9 秒');
});
test('server disconnect instruction schedules reconnect rather than permanently stopping live captions',()=>{
 const handlers={};const socket={on:(name,fn)=>handlers[name]=fn,off(){},send:async()=>{},connect:async()=>{},close:async()=>{}};
 const {LiveTranscript}=load('services/LiveTranscript',{'@kit.NetworkKit':{webSocket:{createWebSocket:()=>socket}}});const live=new LiveTranscript();try{live.connect('wss://caption.zju.edu.cn',course.start,()=>{},()=>{});handlers.message(null,'dr');assert.equal(live.stopped,false);assert.ok(live.reconnect>=0);}finally{live.close()}
});

function summaryFixture(){
 const timers=new Map(),calls=[];let counter=0;
 class AiClient { static async savedKey(){return 'fixture-key'} cancel(){} ask(...args){return new Promise(resolve=>calls.push({args,resolve}))} }
 let source=fs.readFileSync(path.join(root,'components/PageSummary.ets'),'utf8').split('  build() {')[0]+'\n}';
 source=source.replace(/@(?:Component|Builder)\s*/g,'').replace(/@(?:Prop|State)\s*/g,'').replace(/@Watch\([^)]*\)\s*/g,'').replace('export struct','export class');
 const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2021,module:ts.ModuleKind.CommonJS}}).outputText,exports={};
 vm.runInNewContext(output,{exports,require:name=>name.includes('AiClient')?{AiClient}:name.includes('AiStream')||name.includes('ApiKeySetup')||name.includes('DropdownLabel')?{}:load(path.join('components',name)),Date,Map,Set,Scroller:class {currentOffset(){return{yOffset:0}}scrollTo(){}},setTimeout(fn,ms){const id=++counter;timers.set(id,{fn,ms});return id},clearTimeout:id=>timers.delete(id)});
 const page=new exports.PageSummary();page.configured=true;page.configurationChecked=true;page.previousActive=true;page.active=true;page.opened=true;page.live=true;page.courseId='fixture';page.store={imageVersion:()=> 'v1',cache:{revision:()=>0},readJson:()=>'',saveJson(){},readFeature:()=>'',saveFeature(){}};
 return {page,timers,calls};
}
test('a live summary completing after the teacher changes page stays provisional then regenerates while another page is viewed',async()=>{
 const {page,calls}=summaryFixture();page.slides=[slide('a',0),slide('b',60)];page.lines=[{id:'a-line',t:10,end:20,text:'前页'},{id:'b-line',t:70,end:75,text:'本页前半段'}];page.currentId='b';
 page.allPages=true;page.results.a={answer:'已完成',signature:page.signature(page.slides[0]),savedAt:Date.now(),completed:true};
 page.requestCurrent();await new Promise(setImmediate);assert.equal(calls.length,1);
 page.slides.push(slide('c',120));page.lines.push({id:'b-final',t:110,end:118,text:'本页后半段'});page.currentId='a';calls[0].resolve('阶段概述');await new Promise(setImmediate);
 assert.equal(page.results.b.completed,false,'completion must refer to the captured input, not the page visible at HTTP completion');
 const update=page.next();await new Promise(setImmediate);assert.equal(calls.length,2);assert.ok(calls[1].args[2].some(line=>line.id==='b-final'));assert.ok(calls[1].args[4]<120);calls[1].resolve('完整概述');await update;
 assert.equal(page.results.b.answer,'完整概述');assert.equal(page.results.b.completed,true);page.cancel();
});
test('continuous incoming live captions cannot keep postponing scheduled summaries and manual generation starts immediately',async()=>{
 const {page,timers,calls}=summaryFixture();page.slides=[slide('a',0)];page.lines=[];page.currentId='a';page.refresh();
 page.refresh();const summaryTimers=()=>Array.from(timers.entries()).filter(([,v])=>v.ms===500).map(([id])=>id),first=summaryTimers()[0];for(let i=0;i<200;i++)page.refresh();assert.deepEqual(summaryTimers(),[first]);
 page.requestCurrent();await new Promise(setImmediate);assert.equal(calls.length,1);assert.equal(summaryTimers().length,0);calls[0].resolve('当前页');await new Promise(setImmediate);page.cancel();
});

function nativeDisk(rootPath) {
 const url=require('node:url'); const actual=p=>typeof p==='string'&&p.startsWith('file://')?url.fileURLToPath(p):p;
 const io={OpenMode:{CREATE:1,WRITE_ONLY:2,TRUNC:4,READ_ONLY:8,READ_WRITE:16},accessSync:p=>fs.existsSync(actual(p)),mkdirSync:p=>{if(fs.existsSync(actual(p)))throw Error('File exists');fs.mkdirSync(actual(p),{recursive:true})},rmdirSync:p=>fs.rmSync(actual(p),{recursive:true,force:true}),unlinkSync:p=>fs.unlinkSync(actual(p)),listFileSync:p=>fs.readdirSync(actual(p)),readTextSync:p=>fs.readFileSync(actual(p),'utf8'),openSync:(p,flags)=>({fd:fs.openSync(actual(p),flags&1?'w':flags&16?'r+':'r')}),closeSync:file=>fs.closeSync(file.fd),writeSync:(fd,data)=>fs.writeSync(fd,typeof data==='string'?data:Buffer.from(data)),renameSync:(a,b)=>fs.renameSync(actual(a),actual(b)),statSync:p=>fs.statSync(actual(p)),readSync:(fd,data,options={})=>fs.readSync(fd,Buffer.from(data),0,options.length||data.byteLength,options.offset||0),copyFileSync:(a,b)=>{const bytes=fs.readFileSync(actual(a));if(typeof b==='number')fs.writeFileSync(b,bytes);else fs.writeFileSync(actual(b),bytes)}};
 return {'@kit.CoreFileKit':{fileIo:io,fileUri:{getUriFromPath:p=>url.pathToFileURL(p).href,FileUri:class{constructor(p){this.path=actual(p)}}}}};
}
test('feature cache survives reopening, isolates lessons and clears without touching notes or offline downloads',()=>{
 const directory=fs.mkdtempSync('/tmp/zhiyun-cache-test-');try{
 const {FeatureCache}=load('services/FeatureCache',nativeDisk(directory));const cache=new FeatureCache(directory),second={...course,subId:'second'};
 cache.save('transcript',course,'timeline.json','first');cache.save('transcript',second,'timeline.json','second');cache.save('slides',course,'timeline.json','images');cache.flush();
 fs.mkdirSync(directory+'/saved-images');fs.writeFileSync(directory+'/saved-images/original.png','offline');fs.writeFileSync(directory+'/notes-fixture.json','note');
 const reopened=new FeatureCache(directory);assert.equal(reopened.read('transcript',course,'timeline.json'),'first');assert.equal(reopened.list('transcript').length,2);
 reopened.clear('transcript',[course.subId]);assert.equal(reopened.read('transcript',course,'timeline.json'),'');assert.equal(reopened.read('transcript',second,'timeline.json'),'second');assert.equal(reopened.read('slides',course,'timeline.json'),'images');
 reopened.clear('slides');assert.equal(fs.readFileSync(directory+'/saved-images/original.png','utf8'),'offline');assert.equal(fs.readFileSync(directory+'/notes-fixture.json','utf8'),'note');reopened.flush();
 }finally{fs.rmSync(directory,{recursive:true,force:true})}
});
test('cache-off keeps session content only, and clearing invalidates a pending generation',()=>{
 const directory=fs.mkdtempSync('/tmp/zhiyun-cache-off-');try{
 const {FeatureCache}=load('services/FeatureCache',nativeDisk(directory)),cache=new FeatureCache(directory);cache.setEnabled('summary',false);cache.save('summary',course,'summary.json','temporary');assert.equal(cache.read('summary',course,'summary.json'),'temporary');cache.flush();assert.equal(new FeatureCache(directory).read('summary',course,'summary.json'),'');
 cache.setEnabled('summary',true);const revision=cache.revision('summary');cache.clear('summary');cache.save('summary',course,'summary.json','late response',revision);assert.equal(cache.read('summary',course,'summary.json'),'');cache.flush();
 }finally{fs.rmSync(directory,{recursive:true,force:true})}
});
test('image shared by two lessons is deleted only after its final cache reference is cleared',()=>{
 const directory=fs.mkdtempSync('/tmp/zhiyun-cache-shared-');try{
 const {FeatureCache}=load('services/FeatureCache',nativeDisk(directory)),cache=new FeatureCache(directory),asset=directory+'/resource-cache/slides/assets/shared.png';fs.mkdirSync(path.dirname(asset),{recursive:true});fs.writeFileSync(asset,'image');
 cache.remember('slides',course,asset);cache.remember('slides',{...course,subId:'other'},asset);cache.clear('slides',[course.subId]);assert.equal(fs.existsSync(asset),true);cache.clear('slides',['other']);assert.equal(fs.existsSync(asset),false);cache.flush();
 }finally{fs.rmSync(directory,{recursive:true,force:true})}
});
test('lesson chat history persists and a late save remains bound to its originating lesson',()=>{
 const directory=fs.mkdtempSync('/tmp/zhiyun-chat-test-');try{
 const stubs=nativeDisk(directory),{LocalStore}=load('services/LocalStore',stubs),{ChatStore}=load('services/ChatStore',stubs),store=new LocalStore({filesDir:directory,cacheDir:directory},'alice');store.useCourse(course);const chats=new ChatStore(store),session=chats.create();session.turns=[{question:'目前讲了什么',answer:'课程概要',at:25,whole:false,complete:true}];chats.save(session);
 store.useCourse({...course,subId:'other'});chats.save({...session,title:'原课程更新'});assert.equal(new ChatStore(store).list().length,0);store.useCourse(course);assert.equal(new ChatStore(store).list()[0].title,'原课程更新');store.cache.flush();const reopened=new LocalStore({filesDir:directory,cacheDir:directory},'alice');reopened.useCourse(course);assert.equal(new ChatStore(reopened).list()[0].turns[0].answer,'课程概要');chats.delete(session.id);assert.equal(chats.list().length,0);store.cache.flush();
 }finally{fs.rmSync(directory,{recursive:true,force:true})}
});
test('note management folders include only lessons with notes and sort recent lessons first',()=>{
 const {studyFolders,safeFilename,selectedUnion}=load('model/StudyFolders'),later={...course,subId:'later',start:course.start+86400},other={...course,subId:'other',courseId:'other'};
 const folders=studyFolders([course,later,course,other]);assert.equal(folders.length,2);assert.deepEqual(Array.from(folders[0].lessons,c=>c.subId),['later','sample']);assert.equal(safeFilename('../unsafe/name:*?'),'unsafe name');assert.deepEqual(Array.from(selectedUnion(['outside'],['a','b'],true)),['outside','a','b']);
});
test('multi-note exports create independent files in course and lesson folders for every format',async()=>{
 const directory=fs.mkdtempSync('/tmp/zhiyun-export-test-');try{
 const stubs=nativeDisk(directory),outputs=[];stubs['@kit.CoreFileKit'].picker={DocumentViewPicker:class{async save(options){const output=directory+'/'+outputs.length+'-'+options.newFileNames[0];fs.writeFileSync(output,'');outputs.push(output);return[output]}}};stubs['@kit.BasicServicesKit']={zlib:{compressFile:async(source,destination)=>require('node:child_process').execFileSync('/usr/bin/python3',['-c','import zipfile,pathlib,sys; root=pathlib.Path(sys.argv[1]); z=zipfile.ZipFile(sys.argv[2],"w",zipfile.ZIP_DEFLATED); [z.write(p,str(p.relative_to(root))) for p in root.rglob("*") if p.is_file()]; z.close()',source,destination])}};
 const {NotesStore}=load('services/NotesStore',stubs),repo=new NotesStore({}),note=(id,title,text,lesson=course)=>({id,title,course:lesson,atoms:[{kind:'text',value:text,at:5,end:5}],anchors:[],savedAt:1}),notes=[note('a','笔记一','第一篇'),note('b','笔记二','第二篇',{...course,subId:'other',start:course.start+86400})];
 for(const format of ['txt','html','md']){await repo.export(notes,format,{cacheDir:directory},true);const file=outputs.at(-1);assert.ok(file.endsWith('.zip'));const names=require('node:child_process').execFileSync('/usr/bin/python3',['-c','import zipfile,sys; print(chr(10).join(zipfile.ZipFile(sys.argv[1]).namelist()))',file],{encoding:'utf8'}).split('\n').filter(n=>n.endsWith('.'+format));assert.equal(names.length,2);assert.ok(names.every(n=>n.split('/').length===3),'course/lesson/note.ext structure');const content=require('node:child_process').execFileSync('/usr/bin/python3',['-c','import zipfile,sys; print(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]).decode())',file,names[0]],{encoding:'utf8'});assert.ok(content.includes('第一篇')!==content.includes('第二篇'),'notes are not merged');}
 assert.equal(fs.readdirSync(directory).filter(n=>n.startsWith('notes-export-')).length,0,'temporary export directory is removed');
 }finally{fs.rmSync(directory,{recursive:true,force:true})}
});
test('live replay seeking its earliest available fragment starts there rather than at the live edge',()=>{
 const p=playerFixture();p.video.seekable.start=()=>30;p.video.seekable.end=()=>300;p.Player.load({url:'https://cmc.zju.edu.cn/live.m3u8',live:true,liveCourse:true,replay:false});p.eventHandlers.loadedmetadata();assert.ok(p.video.currentTime>299);p.Hls.latest.latestLevelDetails={fragments:[{start:30,duration:6}]};p.Player.replay(true);p.Player.seek(0);assert.equal(p.video.currentTime,30.25);assert.equal(p.Hls.latest.loadedAt,30.25);assert.equal(p.Hls.latest.config.liveMaxLatencyDurationCount,Infinity);
});
test('single-page summary mode generates only the viewed page and all-pages is opt-in',async()=>{
 const {page,calls}=summaryFixture();page.live=false;page.slides=[slide('a',0),slide('b',20),slide('c',40)];page.currentId='b';const first=page.next();await new Promise(setImmediate);assert.equal(calls.length,1);assert.equal(calls[0].args[10],'b');calls[0].resolve('本页概述');await first;await page.next();assert.equal(calls.length,1,'unviewed pages must not trigger API calls');page.allPages=true;const background=page.next();await new Promise(setImmediate);assert.equal(calls.length,2);calls[1].resolve('其他页');await background;page.active=false;page.opened=false;page.refresh();assert.equal(page.allPages,false,'every new opening starts in single-page mode');page.cancel();
});

test('default single-page mode finalizes an already requested live page without summarizing unseen pages',async()=>{
 const {page,calls}=summaryFixture();page.slides=[slide('unseen',0),slide('current',60)];page.currentId='current';page.lines=[{id:'early',t:70,end:80,text:'阶段讲解'}];
 page.requestCurrent();await new Promise(setImmediate);assert.equal(calls.length,1);
 page.slides.push(slide('latest',120));page.currentId='latest';page.lines.push({id:'final',t:110,end:119,text:'本页完整结论'});calls[0].resolve('阶段速览');await new Promise(setImmediate);
 assert.equal(page.results.current.completed,false);assert.equal(page.allPages,false);
 const finish=page.next();await new Promise(setImmediate);assert.equal(calls.length,2);assert.equal(calls[1].args[10],'current');assert.ok(calls[1].args[2].some(line=>line.id==='final'));calls[1].resolve('完整速览');await finish;
 assert.equal(page.results.current.completed,true);await page.next();assert.equal(calls.length,2);assert.equal(page.results.unseen,undefined);page.cancel();
});

test('ending a live lesson finalizes a requested last page even when the user is reading an earlier page',async()=>{
 const {page,calls}=summaryFixture();page.slides=[slide('first',0),slide('last',60)];page.currentId='first';page.live=false;
 page.results.first={answer:'完整',signature:page.signature(page.slides[0]),savedAt:Date.now(),completed:true};page.results.last={answer:'阶段',signature:'old',savedAt:Date.now(),completed:false};
 const finish=page.next();await new Promise(setImmediate);assert.equal(calls.length,1);assert.equal(calls[0].args[10],'last');calls[0].resolve('最后一页完整内容');await finish;assert.equal(page.results.last.completed,true);page.cancel();
});

test('summary cache identity changes when image bytes are updated at the same official URL',()=>{
 const {page}=summaryFixture(),s=slide('same',0);page.slides=[s];let version='old';page.store.imageVersion=()=>version;const before=page.signature(s);version='new';assert.notEqual(page.signature(s),before);page.cancel();
});

test('AI image cache reuses the same image version and rereads a replaced image without changing its URL',async()=>{
 const {AiClient}=load('services/AiClient');AiClient.savedKey=async()=> 'fixture';const ai=new AiClient(),values=new Map();let version='old',reads=0;
 const store={activeCourse:course,imageVersion:()=>version,cache:{revision:()=>0,read:(kind,c,name)=>values.get(c.subId+':'+name)||'',save:(kind,c,name,value)=>values.set(c.subId+':'+name,value)}};
 ai.readSlideUncached=async()=>{reads++;return {text:'内容 '+version,version}};ai.stream=async()=>({answer:'已回答',calls:[]});
 const ask=()=>ai.ask(store,[slide('same',0)],[],'本页讲什么',0,false,'fixture',[],()=>{},'always','same');
 await ask();await ask();assert.equal(reads,1);version='new';await ask();assert.equal(reads,2);assert.ok(Array.from(values.keys()).some(name=>name.startsWith(course.subId+':page-')));
});

test('late AI image reading stays in the originating course and cannot refill a cleared cache',async()=>{
 const {AiClient}=load('services/AiClient');AiClient.savedKey=async()=> 'fixture';const ai=new AiClient(),saved=[];let revision=0,resolveRead;
 const store={activeCourse:course,imageVersion:()=> 'v1',cache:{revision:()=>revision,read:()=>'',save:(kind,c,name,value,captured)=>{if(captured===revision)saved.push(c.subId)}}};
 ai.readSlideUncached=()=>new Promise(resolve=>resolveRead=resolve);ai.stream=async()=>({answer:'回答',calls:[]});
 const ask=()=>ai.ask(store,[slide('a',0)],[],'question',0,false,'fixture',[],()=>{},'always','a');
 const first=ask();await new Promise(setImmediate);store.activeCourse={...course,subId:'other'};resolveRead({text:'课件',version:'v1'});await first;assert.deepEqual(saved,['sample']);
 const second=ask();await new Promise(setImmediate);revision++;resolveRead({text:'课件',version:'v1'});await second;assert.deepEqual(saved,['sample']);
});

test('image version stays stable during reuse and changes after a new file is served at the same URL',()=>{
 const directory=fs.mkdtempSync('/tmp/zhiyun-version-');try {
  const {LocalStore}=load('services/LocalStore',nativeDisk(directory)),store=new LocalStore({filesDir:directory,cacheDir:directory},'fixture'),url='https://cmc.zju.edu.cn/same.png';
  const first=directory+'/first.png',second=directory+'/second.png';fs.writeFileSync(first,'first');fs.writeFileSync(second,'second');const uri=nativeDisk(directory)['@kit.CoreFileKit'].fileUri.getUriFromPath;
  const version=store.imageVersion(url,uri(first));assert.equal(store.imageVersion(url,uri(first)),version);assert.notEqual(store.imageVersion(url,uri(second)),version);assert.equal(store.imageVersion(url,''),'');
 } finally {fs.rmSync(directory,{recursive:true,force:true})}
});

test('cache storage exhaustion preserves current-session content without breaking playback or summaries',()=>{
 const directory=fs.mkdtempSync('/tmp/zhiyun-cache-full-');try{
 const stubs=nativeDisk(directory);stubs['@kit.CoreFileKit'].fileIo.openSync=()=>{throw Error('No space left')};
 const {FeatureCache}=load('services/FeatureCache',stubs),cache=new FeatureCache(directory);
 assert.doesNotThrow(()=>cache.save('summary',course,'page.json','current answer'));assert.equal(cache.read('summary',course,'page.json'),'current answer');assert.doesNotThrow(()=>cache.flush());
 cache.clearTransient();assert.equal(cache.read('summary',course,'page.json'),'');
 }finally{fs.rmSync(directory,{recursive:true,force:true})}
});
test('MP4 loopback cache only serves its random route and returns bounded byte ranges',async()=>{
 const sent=[],requests=[];
 const {MediaCacheProxy}=load('services/MediaCacheProxy',{'@kit.ArkTS':{util:{Base64Helper:class{decodeSync(v){return Uint8Array.from(Buffer.from(v,'base64'))}}}}});
 const proxy=new MediaCacheProxy({async read(...args){requests.push(args);return{status:206,base64:'AQID',contentRange:'bytes 100-102/1000'}}});
 const client={async send(value){sent.push(value.data)}};
 await proxy.respond(client,'GET /private/video.mp4 HTTP/1.1\r\nRange: bytes=100-\r\n\r\n','/private/video.mp4','https://video.zju.edu.cn/test.mp4',0);
 assert.deepEqual(requests[0].slice(2),[100,100+4*1024*1024,true]);assert.match(sent[0],/206 Partial Content/);assert.match(sent[0],/Content-Range: bytes 100-102\/1000/);assert.deepEqual(Array.from(new Uint8Array(sent[1])),[1,2,3]);
 requests.length=0;sent.length=0;
 await proxy.respond(client,'GET /other/video.mp4 HTTP/1.1\r\n\r\n','/private/video.mp4','https://video.zju.edu.cn/test.mp4',0);assert.equal(requests.length,0);assert.match(sent[0],/404 Not Found/);
});
test('stopping MP4 playback prevents a late range response reaching the old media engine',async()=>{
 let resolve;const sent=[];
 const {MediaCacheProxy}=load('services/MediaCacheProxy');const proxy=new MediaCacheProxy({read:()=>new Promise(done=>resolve=done)});
 const pending=proxy.respond({async send(v){sent.push(v)}},'GET /private HTTP/1.1\r\n\r\n','/private','https://video.zju.edu.cn/test.mp4',0);
 proxy.stop();resolve({status:206,base64:'AQID',contentRange:'bytes 0-2/3'});await pending;assert.equal(sent.length,0);
});

test('permission cache uses short live freshness and page entry bypasses even a recent denial',async()=>{
 const {LocalStore}=memoryDisk(),store=new LocalStore({filesDir:'/files',cacheDir:'/cache'},'alice'),api=new Zhiyun();api.usePermissionStorage(store);let calls=0;
 api.request=async()=>{calls++;return JSON.stringify({code:200,data:{sample:{video:1}}})};
 store.savePermissions([{courseId:course.courseId,subId:course.subId,permission:{video:0},checkedAt:Date.now()/1000-5}]);
 await api.permissions([course]);assert.equal(calls,0);await api.permissions([course],()=>{},true);assert.equal(calls,1);
 store.savePermissions([{courseId:course.courseId,subId:course.subId,permission:{video:0},checkedAt:Date.now()/1000-20}]);await api.permissions([course]);assert.equal(calls,2);
 store.savePermissions([{courseId:course.courseId,subId:course.subId,permission:{video:1},checkedAt:Date.now()/1000-90}]);await api.permissions([course]);assert.equal(calls,3);
});

test('a failed loopback MP4 transport retries the same authorized source only once',()=>{
 const source=fs.readFileSync(path.join(root,'components/VideoPane.ets'),'utf8'),method=source.slice(source.indexOf('  private recoverPlayer('),source.indexOf('  private web:'));
 const output=ts.transpileModule('class Fixture { fallbackLoad:any;ready=true;proxy:any;network:any;state:any;web:any;'+method+'}\nexports.Fixture=Fixture;',{compilerOptions:{target:ts.ScriptTarget.ES2021,module:ts.ModuleKind.CommonJS}}).outputText;
 const exports={},calls=[];vm.runInNewContext(output,{exports,JSON});const p=new exports.Fixture();p.fallbackLoad={url:'https://video.zju.edu.cn/authorized.mp4',at:0};p.proxy={stop(){}};p.network={cancel(){}};p.web={runJavaScript(s){calls.push(s);return Promise.resolve()}};
 assert.equal(p.recoverPlayer({error:'视频无法加载，请重试',time:12}),true);assert.match(calls[0],/authorized.mp4/);assert.match(calls[0],/"at":12/);assert.equal(p.recoverPlayer({error:'视频无法加载，请重试',time:12}),false);assert.equal(calls.length,1);
});

test('temporarily backgrounding a summary pauses work without changing the selected all-pages mode',()=>{
 const {page}=summaryFixture();page.allPages=true;page.active=false;page.refresh();assert.equal(page.allPages,true);page.opened=false;page.refresh();assert.equal(page.allPages,false);page.cancel();
});

test('linked course facets offer only combinations that still contain results',()=>{
 const {matchingSearchRows,searchFacetOptions}=load('model/SearchFacets');
 const rows=[{title:'课A',teacher:'甲',room:'101',term:'2025第1学期'},{title:'课A',teacher:'乙',room:'102',term:'2025第2学期'},{title:'课B',teacher:'甲',room:'101',term:'2025第2学期'}];
 let filters={counterpart:'甲',room:'',term:''};assert.deepEqual(Array.from(searchFacetOptions(rows,filters,false,'room')),['101']);
 filters={counterpart:'甲',room:'101',term:'2025第1学期'};assert.equal(matchingSearchRows(rows,filters,false).length,1);assert.deepEqual(Array.from(searchFacetOptions(rows,filters,false,'counterpart')),['甲']);
 assert.deepEqual(Array.from(searchFacetOptions(rows,{counterpart:'',room:'102',term:''},true,'counterpart')),['课A']);
 for(const field of ['counterpart','room','term'])for(const value of searchFacetOptions(rows,filters,false,field))assert.ok(matchingSearchRows(rows,{...filters,[field]:value},false).length>0);
});
test('official catalogue without end_at retains lessons by resolving official sub info',async()=>{
 const api=new Zhiyun();api.request=async p=>p.includes('/catalogue?')?JSON.stringify({success:true,result:{code:0,data:[{sub_id:77,course_id:88,start_at:course.start,status:1,type:'ilive',room:'西1-304'}]}}):JSON.stringify({code:0,data:{start_at:course.start,end_at:course.end,sub_status:6}});
 const rows=await api.chapters({courseId:'88',title:'公共关系学',teacher:'教师',room:'',type:''});
 assert.equal(rows.length,1);assert.equal(rows[0].subId,'77');assert.equal(rows[0].end,course.end);assert.equal(rows[0].status,'6');assert.equal(rows[0].room,'西1-304');
});
test('search results carry the official academic-year and semester label',async()=>{
 const api=new Zhiyun();api.request=async()=>JSON.stringify({code:0,total:{total:1,list:[{course_id:88,title:'公共关系学',term_name:'2025-20261',term:'_93_'}]}});
 const rows=await api.searchCourses({id:'student',tenantId:112},'公共关系学','',1);assert.equal(rows.list[0].year,'2025-2026');assert.equal(rows.list[0].term,'2025—2026学年 · 第1学期');
});
test('download rechecks the current official lesson state rather than a stale live flag',async()=>{
 const api=new Zhiyun(),modes=[];api.info=async()=>({sub_status:6});api.checkPermission=async(c,live)=>{modes.push(live);};
 const row={...course,status:'1'};await api.checkCurrentPermission(row);assert.deepEqual(modes,[false]);assert.equal(row.status,'6');
 api.info=async()=>({sub_status:1});await api.checkCurrentPermission(row);assert.deepEqual(modes,[false,true]);
});
test('missing permission is a retryable error and explicit false still denies access',async()=>{
 const api=new Zhiyun();api.request=async()=>JSON.stringify({code:200,data:{sample:{}}});await assert.rejects(api.checkPermission(course,false),error=>!(error instanceof AccessDenied)&&/暂时未能确认/.test(error.message));
 api.request=async()=>JSON.stringify({code:200,data:{sample:{video:'0'}}});await assert.rejects(api.checkPermission(course,false),AccessDenied);
});
test('a video seek to the page opening marks its first sentence even before its timestamp',()=>{
 const {spokenLineIndex}=load('model/TranscriptPlayback');const rows=[{id:'a',t:12,end:18,text:'第一句'}];assert.equal(spokenLineIndex(rows,10,10),0);assert.equal(spokenLineIndex(rows,9,10),-1);assert.equal(spokenLineIndex(rows,10),-1);assert.equal(spokenLineIndex(rows,18,10),-1);
});
function transcriptFixture(){
 let source=fs.readFileSync(path.join(root,'components/TranscriptText.ets'),'utf8').split('  build() {')[0]+'\n}';source=source.replace(/@(?:Component|Builder)\s*/g,'').replace(/@(?:Prop|State)\s*/g,'').replace(/@Watch\([^)]*\)\s*/g,'').replace('export struct','export class');
 const exports={},selection=[];class TextController {setTextSelection(a,b){selection.push([a,b]);}getLayoutManager(){throw Error('not laid out');}}
 const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2021,module:ts.ModuleKind.CommonJS}}).outputText;
 vm.runInNewContext(code,{exports,require:name=>name.startsWith('.')?load(path.join('components',name)): (name==='@kit.ArkUI'?{FrameCallback:class {}}:{}),TextController,MenuPolicy:{HIDE:0,SHOW:1},setTimeout,clearTimeout,Date,Map,Set});return {text:new exports.TranscriptText(),selection};
}
test('transcript selection survives same-page live append but is released when changing slide',()=>{
 const {text,selection}=transcriptFixture(),a={id:'a',t:0,end:5,text:'第一句转写'},b={id:'b',t:6,end:10,text:'新增转写'};text.lines=[a];text.contentChanged();text.select(0,3);text.lines=[a,b];text.contentChanged();assert.equal(text.shownLines.length,1);
 text.select(0,0,true);assert.equal(text.shownLines.length,2);text.select(0,3);text.lines=[{id:'next',t:20,end:25,text:'新页转写'}];text.pageKey='next-page';text.pageChanged();assert.equal(text.shownLines[0].id,'next');assert.equal(text.selectionVisible,false);assert.equal(text.selectionEnd,0);assert.deepEqual(selection.at(-1),[0,0]);text.aboutToDisappear();
});
test('multi-teacher and multi-semester hits contribute individual linked facet options',()=>{
 const {matchingSearchRows,searchFacetOptions}=load('model/SearchFacets');const rows=[{title:'公共关系学',teacher:'甲,乙',room:'101',term:'2024秋，2024冬'},{title:'公共关系学',teacher:'甲',room:'102',term:'2025春'}];
 assert.deepEqual(Array.from(searchFacetOptions(rows,{counterpart:'乙',room:'',term:''},false,'term')),['2024秋','2024冬'].sort((a,b)=>b.localeCompare(a)));
 assert.equal(matchingSearchRows(rows,{counterpart:'乙',room:'101',term:'2024冬'},false).length,1);
});
test('overview virtualization does not reload cells when only live captions change',()=>{
 const {OverviewSource}=load('model/OverviewSource');const source=new OverviewSource();let reloads=0;const observer={onDataReloaded(){reloads++}};source.registerDataChangeListener(observer);
 source.replace([{slide:slide('a',0),lines:[]}]);source.replace([{slide:slide('a',0),lines:[{id:'line',t:1,text:'new live text'}]}]);assert.equal(reloads,1);assert.equal(source.totalCount(),1);
 source.replace([{slide:slide('a',0),lines:[]},{slide:slide('b',10),lines:[]}]);assert.equal(reloads,2);assert.equal(source.totalCount(),2);assert.equal(source.getData(1).slide.id,'b');source.unregisterDataChangeListener(observer);
});
test('offline retry replaces an old denied task without deleting downloaded assets',()=>{
 const {files,lib}=offlineFixture();let drains=0;lib.drain=()=>{drains++};lib.jobs=[{id:'old',course,options:{video:true,slides:true,transcript:true},state:'error',progress:0,message:'denied'},{id:'other',course:{...course,subId:'other'},state:'paused',options:{slides:true}}];
 lib.keep({course,options:{slides:true,transcript:true,video:false},savedAt:1});lib.enqueue([course],{slides:true,transcript:true,video:false});
 assert.equal(lib.tasks().filter(job=>job.course.subId===course.subId).length,1);assert.equal(lib.tasks().find(job=>job.course.subId===course.subId).state,'queued');assert.equal(lib.tasks().find(job=>job.course.subId==='other').state,'paused');assert.equal(lib.entry(course.subId).options.slides,true);assert.equal(drains,1);
 lib.jobs[1].state='running';lib.enqueue([course],{video:true,slides:true,transcript:true});assert.equal(lib.tasks().filter(job=>job.course.subId===course.subId).length,1);
});
test('reopening offline library uses the newest attempt per lesson instead of stale denial records',()=>{
 const {files,lib}=offlineFixture();files.set('download-jobs-v1.json',JSON.stringify([{id:'old',course,state:'error',progress:0,message:'denied'},{id:'new',course,state:'done',progress:1,message:'已下载'}]));
 const reopened=new lib.constructor(lib.store,()=>{});assert.equal(reopened.tasks().length,1);assert.equal(reopened.tasks()[0].state,'done');
});

test('note management prioritizes the last opened note and its course and lesson folders',()=>{
 const {recentNoteFolders,noteOpenedAt}=load('model/NoteExport');
 const old={id:'old',course,openedAt:500,savedAt:1},newer={id:'new',course:{...course,subId:'new',start:course.start+86400},openedAt:300,savedAt:1000},other={id:'other',course:{...course,courseId:'other',subId:'third'},openedAt:700,savedAt:2};
 const folders=recentNoteFolders([old,newer,other]);assert.equal(folders[0].id,'other');assert.deepEqual(Array.from(folders[1].lessons,l=>l.subId),['sample','new']);assert.equal(noteOpenedAt({savedAt:12}),12);
});
test('opening a note persists recency without changing its content modification time',()=>{
 const dir=fs.mkdtempSync('/tmp/zhiyun-note-open-');try{
 const stubs=nativeDisk(dir),store={dataFolder:dir,readJson:p=>{try{return fs.readFileSync(path.join(dir,p),'utf8')}catch{return''}},saveJson:(p,v)=>fs.writeFileSync(path.join(dir,p),v),deleteJson:p=>fs.rmSync(path.join(dir,p),{force:true})};
 const {NotesStore}=load('services/NotesStore',stubs),repo=new NotesStore(store),note=repo.create(course,'复习');note.atoms=[{kind:'text',value:'保留内容',at:0}];repo.save(note);const original=note.savedAt;note.openedAt=1;store.saveJson(repo.noteName(course,note.id),JSON.stringify(note));const opened=repo.opened(course,note.id);assert.ok(opened.openedAt>1);assert.equal(opened.savedAt,original);assert.equal(repo.load(course,note.id).atoms[0].value,'保留内容');
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('archive naming preserves course teacher term and date with readable image names and collision protection',()=>{
 const {noteExportCourse,noteExportDate,noteExportName,notePictureName,uniqueExportName}=load('model/NoteExport');const note={title:'课堂笔记1',course:{...course,title:'公共关系学',teacher:'老师',term:'2026秋季学期'}};
 assert.equal(noteExportCourse(note),'公共关系学_老师_2026秋季学期');assert.equal(noteExportDate(note),'2026-10-09');assert.equal(noteExportName(note),'课堂笔记1');assert.equal(notePictureName('课堂笔记1',2,'png'),'课堂笔记1_图片2.png');const used=new Set();assert.equal(uniqueExportName('课堂笔记1',used),'课堂笔记1');assert.equal(uniqueExportName('课堂笔记1',used),'课堂笔记1 (2)');
});
test('Markdown archives reference the exported note image names without overwriting repeated note titles',async()=>{
 const dir=fs.mkdtempSync('/tmp/zhiyun-md-names-');try{
 const stubs=nativeDisk(dir);let archive='';stubs['@kit.CoreFileKit'].picker={DocumentViewPicker:class{async save(){archive=dir+'/out.zip';fs.writeFileSync(archive,'');return[archive]}}};stubs['@kit.BasicServicesKit']={zlib:{compressFile:async(source,destination)=>require('node:child_process').execFileSync('/usr/bin/python3',['-c','import zipfile,pathlib,sys; r=pathlib.Path(sys.argv[1]); z=zipfile.ZipFile(sys.argv[2],"w"); [z.write(p,str(p.relative_to(r))) for p in r.rglob("*") if p.is_file()]; z.close()',source,destination])}};
 const {NotesStore}=load('services/NotesStore',stubs),repo=new NotesStore({});repo.imageData=()=> 'data:image/png;base64,';const image=dir+'/image.png';fs.writeFileSync(image,'fixture');const lesson={...course,title:'课程',teacher:'教师',term:'秋学期'};const note=id=>({id,title:'课堂笔记1',course:lesson,atoms:[{kind:'image',value:image,at:1},{kind:'image',value:image,at:2}],anchors:[],savedAt:1});
 await repo.export([note('a'),note('b')],'md',{cacheDir:dir},true);const data=JSON.parse(require('node:child_process').execFileSync('/usr/bin/python3',['-c','import zipfile,json,sys; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps({"names":z.namelist(),"md":[z.read(n).decode() for n in z.namelist() if n.endswith(".md")]}))',archive],{encoding:'utf8'}));assert.ok(data.names.includes('课程_教师_秋学期/2026-10-09/课堂笔记1.md'));assert.ok(data.names.includes('课程_教师_秋学期/2026-10-09/课堂笔记1 (2).md'));assert.equal(data.names.filter(n=>n.endsWith('.png')).length,4);assert.ok(data.names.some(n=>n.endsWith('/课堂笔记1_图片2.png')));assert.ok(data.md[0].includes(encodeURIComponent('课堂笔记1_图片1.png')));
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('note export obtains official school term dates and uses cached dates while offline',async()=>{
 const api=new Zhiyun(),values=new Map(),store={readJson:k=>values.get(k)||'',saveJson:(k,v)=>values.set(k,v)};api.request=async()=>JSON.stringify({result:{data:{'2026-2027':{autumn:{begin_date:'2026-09-01',end_date:'2026-11-01'}}}}});const lesson={...course};await api.annotateTerms({tenantId:1},[lesson],store);assert.equal(lesson.term,'2026—2027学年 · 秋季学期');const offline=new Zhiyun();offline.request=async()=>{throw Error('offline')};const next={...course};await offline.annotateTerms({tenantId:1},[next],store);assert.equal(next.term,lesson.term);
});
test('partial downloads automatically retry transient assets but stop at permanent resource errors',async()=>{
 const {lib}=offlineFixture();let images=0,asr=0;lib.api.transcripts=async()=>{if(++asr<3)throw Error('timeout');return[{id:'line',t:1,text:'恢复'}]};lib.store.pinImage=async()=>{if(++images<3)throw Error('temporary network');return'file:///saved.png'};await lib.download({course,options:{slides:true,transcript:true,video:false},progress:0});assert.equal(images,3);assert.equal(asr,3);assert.equal(lib.list()[0].options.transcript,true);
 let permanent=0;lib.store.pinImage=async()=>{permanent++;throw Error('404')};await assert.rejects(lib.download({course,options:{slides:true,transcript:false,video:false},progress:0}),/课件第 1 页（00:00）下载失败：平台资源不存在或已移除/);assert.equal(permanent,1);
});
test('exhausted download retries report a cause while preserving successful assets',async()=>{
 const {lib}=offlineFixture();let attempts=0;lib.api.transcripts=async()=>{attempts++;throw Error('timeout')};await assert.rejects(lib.download({course,options:{slides:true,transcript:true,video:false},progress:0}),/已保存可用内容；转写下载失败：网络请求超时（重试 2 次仍失败）/);assert.equal(attempts,3);assert.equal(lib.list()[0].options.slides,true);
});
test('slide location accent adapts to bright and dark page backgrounds',()=>{
 const {imageAccent}=load('model/ImageAccent');const pixels=value=>{const out=new Uint8Array(32*32*4);for(let i=0;i<out.length;i+=4){out[i]=out[i+1]=out[i+2]=value;out[i+3]=255}return out};const light=imageAccent(pixels(255),32,32,128),dark=imageAccent(pixels(0),32,32,128);assert.notEqual(light,dark);assert.match(light,/^#[A-Fa-f0-9]{6}$/);assert.equal(imageAccent(new Uint8Array(),0,0,0),'#7C3AED');
});

test('duplicate screenshots merge consecutive transcript intervals, retaining original timeline records',()=>{
 const raw=[slide('a',0),slide('b',10),slide('c',20),slide('d',30)];
 raw[1].duplicateOf='a';raw[1].duplicateUrl=raw[0].url;
 raw[2].duplicateOf='b';raw[2].duplicateUrl=raw[1].url;
 const lines=[0,10,20,30].map((t,i)=>({id:String(i),t,end:t+5,text:'sentence '+i}));
 const groups=timeline.groupPages(raw,lines);
 assert.deepEqual(Array.from(groups,g=>g.slide.id),['a','d']);
 assert.deepEqual(Array.from(groups[0].lines,l=>l.t),[0,10,20]);
 assert.equal(raw.length,4); assert.equal(raw[2].t,20);
 assert.equal(timeline.selectedAfterUpdate(raw,groups.map(g=>g.slide),2,false),0);
});
test('duplicate annotations survive unchanged official refresh but invalidate when either source URL changes',()=>{
 const a=slide('a',0),b={...slide('b',10),duplicateOf:'a',duplicateUrl:a.url};
 const refresh=timeline.mergeSlides([a,b],[slide('a',0),slide('b',10)]);
 assert.equal(timeline.groupPages(refresh,[]).length,1);
 const changed=timeline.mergeSlides(refresh,[{...a,url:'https://cmc.zju.edu.cn/changed.png'}]);
 assert.equal(timeline.groupPages(changed,[]).length,2);
 const changedB=timeline.mergeSlides(refresh,[{...slide('b',10),url:'https://cmc.zju.edu.cn/changed.png'}]);
 assert.equal(timeline.groupPages(changedB,[]).length,2);
});
test('nonconsecutive repeated pages and unverified images are never merged',()=>{
 const a=slide('a',0),b=slide('b',10),c={...slide('c',20),duplicateOf:'a',duplicateUrl:a.url};
 assert.equal(timeline.groupPages([a,b,c],[]).length,3);
});
test('duplicate detector accepts compression noise but rejects a local changed number, alpha or dimensions',()=>{
 const {screenshotsEqual}=load('model/SlideSimilarity');
 const w=128,h=128,stride=w*4;
 const a=new Uint8Array(stride*h);for(let i=0;i<a.length;i+=4){a[i]=200;a[i+1]=210;a[i+2]=220;a[i+3]=255;}
 const noise=new Uint8Array(a);for(let i=0;i<noise.length;i+=4){noise[i]+=1;noise[i+1]-=1;noise[i+2]+=1;}
 assert.equal(screenshotsEqual(a,noise,w,h,stride,stride),true);
 const number=new Uint8Array(a);for(let y=20;y<24;y++)for(let x=20;x<24;x++){const p=y*stride+x*4;number[p]=0;number[p+1]=0;number[p+2]=0;}
 assert.equal(screenshotsEqual(a,number,w,h,stride,stride),false);
 const alpha=new Uint8Array(a);alpha[3]=0;assert.equal(screenshotsEqual(a,alpha,w,h,stride,stride),false);
 assert.equal(screenshotsEqual(a,noise,w,h+1,stride,stride),false);
});

class TestInputController {
 constructor(){this.value='';this.start=0;this.end=0;}
 getSelection(){return{start:this.start,end:this.end}} setTextSelection(start,end){this.start=start;this.end=end} clearPreviewText(){}
 deleteText({start,end}){this.value=this.value.slice(0,start)+this.value.slice(end)}
 addText(text,{offset}){this.value=this.value.slice(0,offset)+text+this.value.slice(offset)}
 caretPosition(offset){this.start=this.end=offset}
}
const inputGlobals={TouchType:{Down:0,Up:1,Move:2,Cancel:3},SourceType:{Touch:1,Mouse:2},SourceTool:{Finger:1,MOUSE:3,TOUCHPAD:4},TextInputController:TestInputController,KeyType:{Down:0,Up:1},MouseAction:{Press:1,Release:2,Move:3},MouseButton:{Left:1,Right:2}};
test('shared input handles top-row/numpad digits at selection without duplicating or intercepting shortcuts',()=>{
 const {PhysicalInput}=load('services/PhysicalInput',{},inputGlobals),field=new PhysicalInput();let value='abCD';field.controller.value=value;field.controller.start=1;field.controller.end=3;
 const event={type:0,keyCode:2007,keyText:'',getModifierKeyState:()=>false};
 assert.equal(field.digit(event,value,v=>value=v),true);assert.equal(value,'a7D');assert.equal(field.controller.value,value);assert.equal(field.controller.start,2);
 assert.equal(field.digit({...event,keyCode:2112},value,v=>value=v),true);assert.equal(value,'a79D');
 assert.equal(field.digit({...event,type:1},value,v=>value=v),false);
 assert.equal(field.digit({...event,getModifierKeyState:()=>true},value,v=>value=v),false);
 assert.equal(field.digit({...event,keyCode:2015},value,v=>value=v),false);
});
function componentFixture(file,external={}){
 let source=fs.readFileSync(path.join(root,'components',file+'.ets'),'utf8');const cut=source.indexOf('  @Builder');source=source.slice(0,cut>=0?cut:source.indexOf('  build() {'))+'\n}';
 source=source.replace(/@(?:Component|Prop|State)\s*/g,'').replace(/@(?:Watch|StorageLink)\([^)]*\)\s*/g,'').replace('export struct','export class');
 const exports={},output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2021,module:ts.ModuleKind.CommonJS}}).outputText;
 vm.runInNewContext(output,{exports,require:name=>external[name]||(name.startsWith('.')?load(path.join('components',name),{},inputGlobals):(name==='@kit.ArkUI'?{FrameCallback:class {}}:{})),Date,Map,Set,setTimeout,clearTimeout,MenuPolicy:{HIDE:0,SHOW:1},Scroller:class {},TextAreaController:class {},RichEditorController:class {},TextController:class {setTextSelection(){} getLayoutManager(){throw Error("fixture not laid out")}},...inputGlobals});return new exports[file]();
}
test('plaza enters batch immediately with confirmed lessons and reports newly allowed results while remaining requests are pending',async()=>{
 const p=componentFixture('Plaza');p.courses=[{...course,status:'6'},{...course,subId:'later',status:'6'}];p.generation=1;p.foreground=true;p.visibleLessons.add('sample');p.visibleLessons.add('later');
 const discovered=[];let release;
 p.api.cachedPermissions=rows=>Object.fromEntries(rows.map(c=>[c.subId,c.subId==='sample'?'allowed':'unknown']));
 p.api.permissions=async(rows,progress)=>{progress({sample:'allowed',later:'unknown'},['sample']);await new Promise(resolve=>release=resolve);progress({sample:'allowed',later:'allowed'},['sample','later']);};
 p.onDiscovered=(rows,checking)=>discovered.push({ids:Array.from(rows,c=>c.subId),checking});
 const task=p.classify(1);let entered;p.onDownload=rows=>entered=Array.from(rows,c=>c.subId);p.downloadScope();assert.deepEqual(entered,['sample']);assert.equal(p.checking,true);assert.equal(discovered.some(d=>d.ids.includes('sample')&&d.checking),true);
 p.api.cachedPermissions=rows=>Object.fromEntries(rows.map(c=>[c.subId,'allowed']));release();await task;assert.deepEqual(discovered.at(-1),{ids:['sample','later'],checking:false});
});
test('stale allowed cache is not a confirmed batch candidate, and empty scope opens with explanatory UI data',()=>{
 const p=componentFixture('Plaza');p.courses=[course];p.api.cachedPermissions=()=>({sample:'allowed'});p.checking=true;let entered;p.onDownload=rows=>entered=rows;
 p.downloadScope();assert.equal(entered.length,0);p.verifiedLessons.add('sample');assert.deepEqual(Array.from(p.permittedScope(),c=>c.subId),['sample']);
});
test('batch discovery remains pending until user updates, retains checked lessons and avoids rechecking newly confirmed ones',()=>{
 const p=componentFixture('DownloadSheet');p.scoped=true;p.available=[course];p.chosen=['sample'];p.accessStates={sample:'allowed'};
 p.discoveries=[course,{...course,subId:'later',courseId:'other'}];p.discoveriesChanged();assert.equal(p.newLessons,1);assert.equal(p.available.length,1);
 p.applyDiscoveries();assert.equal(p.newLessons,0);assert.equal(p.available.length,2);assert.deepEqual(Array.from(p.chosen),['sample']);assert.equal(p.verified.has('later'),true);clearTimeout(p.accessTimer);
});
test('permission progress distinguishes cached prefill from freshly confirmed result IDs',async()=>{
 const api=new Zhiyun(),progress=[];api.request=async()=>JSON.stringify({code:200,data:{sample:{video:1}}});
 await api.permissions([course],(states,confirmed)=>progress.push(Array.from(confirmed||[])),true);
 assert.deepEqual(progress,[[],['sample']]);
});
test('concurrent offline removals are serialized even while a download is being paused',async()=>{
 const {lib}=offlineFixture();let running=0,peak=0;const order=[];
 lib.performRemoveMany=async ids=>{running++;peak=Math.max(peak,running);order.push(ids[0]);await new Promise(r=>setTimeout(r,10));running--;};
 await Promise.all([lib.removeMany(['first']),lib.removeMany(['second'])]);assert.equal(peak,1);assert.deepEqual(order,['first','second']);
});
test('download progress updates are coalesced and state transitions flush the latest state immediately',async()=>{
 const {lib,files}=offlineFixture();let changes=0;lib.changed=()=>changes++;lib.jobs=[{id:'one',course,state:'running',progress:0,message:'下载中'}];
 for(let n=0;n<25;n++){lib.jobs[0].progress=n/25;lib.publishProgress();}
 assert.equal(changes,0);await new Promise(r=>setTimeout(r,210));assert.equal(changes,1);
 lib.jobs[0].state='paused';lib.publish();assert.equal(changes,2);assert.equal(JSON.parse(files.get('download-jobs-v1.json'))[0].state,'paused');
});

test('shared input explicitly supports Ctrl+A even when pre-IME modifier state is absent',()=>{
 const {PhysicalInput}=load('services/PhysicalInput',{},inputGlobals),field=new PhysicalInput();field.controller.value='123';
 const event={type:0,keyCode:2072,keyText:'',getModifierKeyState:()=>false};field.digit(event,'123',()=>{});
 assert.equal(field.digit({...event,keyCode:2017,keyText:'a'},'123',()=>{}),true);assert.equal(field.controller.start,0);assert.equal(field.controller.end,3);
 field.digit({...event,type:1},'123',()=>{});let changed='123';assert.equal(field.digit({...event,keyCode:2004},changed,v=>changed=v),true);assert.equal(changed,'4');
 field.reset();
});

test('offline rows resolve the latest progress and saved assets without changing their identity',()=>{
 const p=componentFixture('OfflineScreen');
 const first={id:'job',course,state:'running',progress:0,message:'读取中'};
 const oldEntry={course,options:{video:false,slides:false,transcript:true}};
 p.jobs=[{...first,state:'error',progress:0.45,message:'课件失败，可重试'}];
 p.entries=[{...oldEntry,options:{video:false,slides:true,transcript:true}}];
 assert.equal(p.currentJob(first).state,'error');assert.equal(p.currentJob(first).progress,0.45);
 assert.equal(p.currentEntry(oldEntry).options.slides,true);
});
test('repeated native checkbox callbacks do not unselect an offline course during progress refresh',()=>{
 const p=componentFixture('OfflineScreen');p.selectId('sample',true);p.selectId('sample',true);
 assert.deepEqual(Array.from(p.selected),['sample']);p.selectId('sample',false);p.selectId('sample',false);
 assert.equal(p.selected.length,0);
});

function indexLogicFixture(names,extra={}){
 names=Array.from(new Set(names.concat(names.some(n=>['rebuildGroups','displayedTranscript','context'].includes(n))?['cleanTranscript']:[],names.includes('restoreProgress')?['skipOpeningPages']:[],names.includes('openNoteReference')?['rememberJump']:[])));
 const source=fs.readFileSync(path.join(root,'pages/Index.ets'),'utf8');
 const methods=names.map(name=>{let start=source.indexOf('  private '+name+'(');if(start<0)start=source.indexOf('  private async '+name+'(');assert.ok(start>=0,name);const firstEnd=source.indexOf('\n',start);if(source.slice(start,firstEnd).trim().endsWith('}'))return source.slice(start,firstEnd);const end=source.indexOf('\n  }',start)+4;return source.slice(start,end)}).join('\n');
 const output=ts.transpileModule('export class IndexLogic {\n'+methods+'\n}',{compilerOptions:{target:ts.ScriptTarget.ES2021,module:ts.ModuleKind.CommonJS}}).outputText,exports={};
 vm.runInNewContext(output,{exports,...inputGlobals,KeyCode:{KEYCODE_DPAD_LEFT:2014,KEYCODE_DPAD_RIGHT:2015,KEYCODE_PAGE_UP:2068,KEYCODE_PAGE_DOWN:2069},...timeline,...load('model/StudyNavigation'),...load('model/SmartSkip'),...load('model/LearningProgress'),...load('model/PanePreferences'),...load('model/NativeSelections'),...load('model/SelectionKeys'),...load('services/ChatStore'),...load('services/SummaryCache'),key:load('services/LocalStore').key,Date,Map,Set,Math,Number,JSON,setTimeout,clearTimeout,...extra});const fixture=Object.assign(new exports.IndexLogic(),{summaryController:{capture:()=>undefined},paneRects:[],groups:[],activePane:'slides',videoOpenTicket:0}); for(const method of ['learningTime','prepareImages','rewind'])if(typeof fixture[method]!=='function')fixture[method]=()=>method==='learningTime'?0:undefined;return fixture;
}
test('merging can be switched off without destroying raw screenshots or transcription boundaries',()=>{
 const raw=[slide('a',0),{...slide('b',30),duplicateOf:'a',duplicateUrl:slide('a',0).url},slide('c',90)], lines=[{id:'first',t:10,text:'first'},{id:'second',t:50,text:'second'},{id:'third',t:100,text:'third'}];
 const merged=timeline.groupPages(raw,lines,true), original=timeline.groupPages(raw,lines,false);
 assert.deepEqual(Array.from(merged,g=>[g.slide.id,Array.from(g.lines,l=>l.id)]),[['a',['first','second']],['c',['third']]]);
 assert.deepEqual(Array.from(original,g=>[g.slide.id,Array.from(g.lines,l=>l.id)]),[['a',['first']],['b',['second']],['c',['third']]]);assert.equal(raw.length,3);
});
test('automatic reconciliation handles newly arriving captures and never merges across an intervening distinct page',async()=>{
 const p=indexLogicFixture(['reconcileSlideDuplicates']);Object.assign(p,{mergeDuplicateSlides:true,comparingSlides:false,compareAgain:false,imageRevision:0,generation:1,foreground:true,offlineViewing:false,course,screen:'lesson',aiSelectedIds:[],slides:[slide('a',0),slide('b',20)]});
 const contents={a:'A',b:'A',c:'B',d:'A',e:'A'},fetched=[];p.store={cachedImage:()=>'',image:async url=>{fetched.push(url);return url},save(){}};p.similarity={same:async(a,b)=>contents[a.split('/').at(-1).split('.')[0]]===contents[b.split('/').at(-1).split('.')[0]]};p.rebuildGroups=()=>{};
 await p.reconcileSlideDuplicates(1);assert.equal(p.slides[1].duplicateOf,'a');p.slides=p.slides.concat([slide('c',40),slide('d',60),slide('e',80)]);await p.reconcileSlideDuplicates(1);
 assert.deepEqual(Array.from(timeline.distinctSlides(p.slides),s=>s.id),['a','c','d']);assert.equal(p.slides[3].duplicateOf,undefined);assert.equal(p.slides[4].duplicateOf,'d');assert.ok(fetched.some(url=>url.endsWith('/e.png')));
 p.mergeDuplicateSlides=false;const count=fetched.length;await p.reconcileSlideDuplicates(1);assert.equal(fetched.length,count);
});
test('search permissions only inspect filtered visible hits and newly visible hits get their own check',async()=>{
 const p=componentFixture('Plaza');p.searching=true;p.generation=1;p.foreground=true;p.hits=[{courseId:'visible',title:'A',teacher:'T',room:'R',term:'one',type:''},{courseId:'hidden',title:'B',teacher:'T',room:'R',term:'one',type:''},{courseId:'filtered',title:'C',teacher:'U',room:'R',term:'two',type:''}];p.visibleHits.add('visible');p.visibleHits.add('filtered');p.filterTerm='one';
 const requests=[];p.api.cachedPermissions=rows=>Object.fromEntries(rows.map(c=>[c.subId,'allowed']));p.api.chapters=async(hit,hydrate)=>{requests.push([hit.courseId,hydrate]);return[{...course,courseId:hit.courseId,subId:hit.courseId}]};p.api.permissions=async(rows,progress)=>{const states=Object.fromEntries(rows.map(c=>[c.subId,'allowed']));progress(states,rows.map(c=>c.subId));return states};
 await p.classify(1);assert.deepEqual(requests,[['visible',false]]);p.visibleHits.add('hidden');await p.classify(1);assert.deepEqual(requests,[['visible',false],['hidden',false]]);assert.equal(p.verifiedLessons.has('hidden'),true);
});
test('permission-only course catalogue skips per-lesson metadata hydration',async()=>{
 const api=new Zhiyun(),calls=[];api.request=async route=>{calls.push(route);return JSON.stringify({result:{data:[{id:9,course_begin:course.start,course_over:0}]}})};
 const rows=await api.chapters({courseId:'88',title:'Test',teacher:'T',room:'R',type:''},false);assert.equal(rows.length,1);assert.equal(calls.length,1);assert.equal(rows[0].end,0);
});
test('all my courses history resumes its own attendance cursor and never imports the accessible-course batch catalogue',async()=>{
 const p=componentFixture('MyCourses');p.account={id:'u',tenantId:112};p.courses=[course];p.active=true;p.generation=1;let saved,cursor;
 p.store={loadMyAttendance:()=>({courses:[course],cursor:'2024-04-01',complete:false}),saveMyAttendance:(courses,c,done)=>saved={ids:Array.from(courses,x=>x.subId),cursor:c,done}};
 p.api.attendanceHistory=async(account,progress,state)=>{cursor=state.cursor;return {courses:[course,{...course,subId:'older',start:course.start-86400}],cursor:'2024-03-01',complete:true,windowsDone:4,failed:false}};
 await p.load();assert.equal(cursor,'2024-04-01');assert.deepEqual(saved.ids,['sample','older']);assert.equal(saved.done,true);assert.equal(p.byCourse,true);
});

test('all-my-courses bulk download opens immediately and publishes freshly allowed unseen lessons',async()=>{
 const p=componentFixture('MyCourses');p.courses=[course,{...course,subId:'unseen',courseId:'other'}];p.permissions={sample:'allowed',unseen:'allowed'};p.verified.add('sample');p.checked.add('sample');let opened,release;
 const publications=[];p.onDownload=rows=>opened=Array.from(rows,c=>c.subId);p.onDiscovered=(rows,checking)=>publications.push({ids:Array.from(rows,c=>c.subId),checking});
 p.accessApi.permissions=async(rows,progress)=>{assert.deepEqual(Array.from(rows,c=>c.subId),['unseen']);progress({unseen:'allowed'},[]);await new Promise(resolve=>release=resolve);progress({unseen:'allowed'},['unseen']);};
 p.download();assert.deepEqual(opened,['sample']);assert.equal(p.checking,true);assert.equal(p.permittedScope().length,1,'old cached allow must not count as a fresh confirmation');release();await new Promise(setImmediate);
 assert.deepEqual(publications.at(-1),{ids:['sample','unseen'],checking:false});
});

test('all-my-courses download refresh ignores permissions arriving from the cancelled request',async()=>{
 const p=componentFixture('MyCourses');p.courses=[course];p.checkingAll=true;p.permissions={sample:'allowed'};let oldProgress,release,requests=0;
 p.accessApi.permissions=async(rows,progress)=>{requests++;if(requests===1){oldProgress=progress;await new Promise(resolve=>release=resolve)}else progress({sample:'denied'},['sample']);};
 const first=p.checkVisible();p.refreshScope();await new Promise(setImmediate);oldProgress({sample:'allowed'},['sample']);release();await first;assert.equal(p.permissions.sample,'denied');assert.equal(p.permittedScope().length,0);assert.equal(p.checking,false);
});
test('dragging common features persists the new order and clamps the drop to the list edges',async()=>{
 const p=indexLogicFixture(['beginPinDrag','updatePinDrag','endPinDrag','savePins']);p.pinnedSettings=['slides','transcript','video'];let saved;p.store={saveJson:(name,value)=>saved=JSON.parse(value)};
 p.beginPinDrag('slides');p.updatePinDrag(10000);assert.equal(p.pinDragTarget,2);p.endPinDrag();await new Promise(r=>setTimeout(r,140));assert.deepEqual(Array.from(p.pinnedSettings),['transcript','video','slides']);assert.deepEqual(saved,['transcript','video','slides']);
 p.beginPinDrag('slides');p.updatePinDrag(-10000);p.endPinDrag();await new Promise(r=>setTimeout(r,140));assert.deepEqual(saved,['slides','transcript','video']);
});
test('lesson progress rejects another lesson, malformed state and invalid times',()=>{
 const {readLearningProgress}=load('model/LearningProgress');const saved={schema:1,subId:course.subId,courseId:course.courseId,seconds:72,slideId:'a',slideSeconds:60,video:true,followVideo:true,savedAt:1};
 assert.equal(readLearningProgress(JSON.stringify(saved),course).seconds,72);for(const extra of [{subId:'another'},{courseId:'another'},{seconds:-1},{seconds:null},{slideSeconds:-1},{schema:2}]) assert.equal(readLearningProgress(JSON.stringify({...saved,...extra}),course),undefined);assert.equal(readLearningProgress('bad',course),undefined);
});
test('progress resumes exact browsed page or playback time including when duplicate merging changes the page identity',()=>{
 const {progressPage}=load('model/LearningProgress'), groups=timeline.groupPages([slide('a',0),slide('b',60),slide('c',120)],[]), saved={seconds:137,slideId:'b',slideSeconds:60,video:true,followVideo:true};
 assert.equal(progressPage(groups,saved),2);assert.equal(progressPage(groups,{...saved,followVideo:false}),1);assert.equal(progressPage(groups,{...saved,video:false}),1);assert.equal(progressPage(groups,{...saved,slideId:'removed',slideSeconds:85,video:false}),1);
});
test('progress restoration resumes recorded video exactly once, while a running live lecture stays current',async()=>{
 const p=indexLogicFixture(['restoreProgress']);const saved={seconds:137,slideId:'b',slideSeconds:60,video:true,followVideo:false};Object.assign(p,{pendingProgress:saved,preferredVideo:true,progressReady:false,generation:1,info:{sub_status:6},groups:timeline.groupPages([slide('a',0),slide('b',60),slide('c',120)],[]),offlineViewing:false});
 let videoAt,calls=0;p.prepareImages=()=>{};p.lessonDuration=()=>500;p.toggleVideo=async at=>{videoAt=at;calls++};p.followPlayback=()=>{};await p.restoreProgress();assert.equal(p.selected,1);assert.equal(videoAt,137);assert.equal(p.followVideo,false);await p.restoreProgress();assert.equal(calls,1);
 p.pendingProgress=saved;p.progressReady=false;p.info={sub_status:1};p.selected=2;await p.restoreProgress();assert.equal(p.selected,2);assert.equal(calls,1);
});
test('progress writes are throttled during playback and flush immediately at exit without overwriting an unrestored lesson',()=>{
 const p=indexLogicFixture(['saveProgress']);let writes=[];Object.assign(p,{progressReady:true,progressSavedAt:0,course,screen:'lesson',demo:false,showVideo:true,followVideo:true,groups:timeline.groupPages([slide('a',0)],[]),selected:0});p.learningTime=()=>137;p.store={saveJson:(name,text)=>writes.push([name,JSON.parse(text)])};
 p.saveProgress();p.saveProgress();assert.equal(writes.length,1);p.saveProgress(true);assert.equal(writes.length,2);assert.equal(writes[1][1].seconds,137);assert.match(writes[1][0],/^progress-/);p.progressReady=false;p.saveProgress(true);assert.equal(writes.length,2);
});
test('whole-course collection covers future lessons, individual exclusions clear its filled star and leave other lessons selected',()=>{
 const {CourseCollections}=load('model/CourseCollections'), c=new CourseCollections(),second={...course,subId:'second'},future={...course,subId:'future'};
 c.toggleCourse('favourite',course,[course,second]);assert.equal(c.hasCourse('favourite',course.courseId),true);assert.equal(c.hasLesson('favourite',future),true);
 c.toggleLesson('favourite',course);assert.equal(c.hasCourse('favourite',course.courseId),false);assert.equal(c.hasLesson('favourite',course),false);assert.equal(c.hasLesson('favourite',second),true);
 c.toggleLesson('favourite',course);assert.equal(c.hasCourse('favourite',course.courseId),true);c.toggleCourse('favourite',course);assert.equal(c.entries('favourite').length,0);
});
test('single-lesson collections contain only the selected lessons and watch-later is independent from favourites',()=>{
 const {CourseCollections}=load('model/CourseCollections'), c=new CourseCollections(),other={...course,subId:'other'};
 c.toggleLesson('favourite',course);assert.equal(c.hasCourse('favourite',course.courseId),false);assert.equal(c.hasLesson('favourite',other),false);c.catalogue(course,[course,other],true);assert.equal(c.entry('favourite',course.courseId).lessons.length,1);
 c.toggleCourse('later',course,[course,other]);c.toggleLesson('later',course);assert.equal(c.hasLesson('favourite',course),true);assert.equal(c.hasLesson('later',course),false);assert.equal(c.hasLesson('later',other),true);c.toggleLesson('favourite',course);assert.equal(c.entries('favourite').length,0);assert.equal(c.entries('later').length,1);
});
test('collections persist per account and cancelling the last known selected lesson removes the empty folder',()=>{
 const {CourseCollections}=load('model/CourseCollections'), c=new CourseCollections();let disk='';const storage={readJson:()=>disk,saveJson:(name,value)=>disk=value};c.bind(storage);c.toggleCourse('later',course,[course]);c.catalogue(course,[course],true);
 const restored=new CourseCollections();restored.bind(storage);assert.equal(restored.hasLesson('later',course),true);restored.toggleLesson('later',course);assert.equal(restored.entries('later').length,0);restored.bind(undefined);assert.equal(restored.entries('favourite').length,0);assert.equal(c.hasLesson('later',course),true);
});
test('loading video cannot replace the restored learning time with a transient zero',()=>{
 const p=indexLogicFixture(['playbackChanged']);Object.assign(p,{videoTime:137,followVideo:true});let saves=0,followed=0;p.saveProgress=()=>saves++;p.followPlayback=()=>followed++;
 p.playbackChanged({time:0,rate:1,end:0,seekable:false,width:0,height:0,positionReady:false});assert.equal(p.videoTime,137);assert.equal(saves,0);assert.equal(followed,0);
 p.playbackChanged({time:137.2,rate:1,end:500,seekable:true,width:1920,height:1080,positionReady:true});assert.equal(p.videoTime,137.2);assert.equal(saves,1);assert.equal(followed,1);
});
test('overview and time/page jump close free layout before showing their own UI',()=>{
 const p=indexLogicFixture(['featureAction']);let opened=[];p.layoutOpen=true;p.overview=false;p.jumpDialog={open:()=>opened.push('time')};p.pageDialog={open:()=>opened.push('page')};p.featureAction('overview');assert.equal(p.layoutOpen,false);assert.equal(p.overview,true);
 for(const action of ['time','page']){p.layoutOpen=true;p.featureAction(action);assert.equal(p.layoutOpen,false)}assert.deepEqual(opened,['time','page']);
});

test('live notes without video use the writing moment; historical browsing and replay retain their selected positions',()=>{
 const p=indexLogicFixture(['learningTime']);Object.assign(p,{course:{...course,start:Date.now()/1000-120},info:{sub_status:1},following:true,showVideo:false,groups:timeline.groupPages([slide('page',30)],[]),selected:0});
 assert.ok(Math.abs(p.learningTime()-120)<2);p.following=false;assert.equal(p.learningTime(),30);p.showVideo=true;p.videoTime=85;assert.equal(p.learningTime(),85);p.showVideo=false;p.info.sub_status=6;p.following=true;assert.equal(p.learningTime(),30);
});

test('keyboard page jump closes layout through the same path as the toolbar',()=>{
 const p=indexLogicFixture(['keyboard','featureAction']);p.screen='lesson';p.layoutOpen=true;p.pageDialog={open:()=>assert.equal(p.layoutOpen,false)};
 assert.equal(p.keyboard({type:inputGlobals.KeyType.Down,keyText:'g',getModifierKeyState:keys=>keys.includes('Ctrl')}),true);
});

test('prior course context selects every earlier lesson in the same course, deduplicates and sorts oldest first',()=>{
 const {priorLessons}=load('model/CourseContext'),a={...course,subId:'a',start:course.start-200},b={...course,subId:'b',start:course.start-100};
 const rows=[b,{...course,subId:'future',start:course.start+1},a,{...a,courseId:'unrelated',subId:'wrong'},course,a,{...course,subId:'simultaneous'}];
 assert.deepEqual(Array.from(priorLessons(rows,course),c=>c.subId),['a','b']);
});
test('prior material preserves all sentences including before the first slide and separates lesson-local times',()=>{
 const {priorMaterial}=load('model/CourseContext');const content=priorMaterial({gaps:['目录可能缺失'],lessons:[{course:{...course,start:course.start-86400},slides:[slide('a',10),slide('b',50)],lines:[{id:'opening',t:0,text:'开场'},{id:'end',t:80,text:'最后一句'}],gaps:['课件未刷新']}]});
 assert.match(content,/2026-10-08 08:00/);assert.match(content,/开场/);assert.match(content,/最后一句/);assert.match(content,/00:10—00:50/);assert.match(content,/目录可能缺失/);assert.match(content,/课件未刷新/);
 assert.equal(load('model/AiStream').answerParts('关联【2026-10-08 08:00课次 · 12:30】与本页[01:10]').filter(p=>p.seconds>=0).length,1);
});
function priorFixture(){
 const {CourseContextLoader}=load('services/CourseContextLoader'),loader=new CourseContextLoader(),originalApi=loader.api,writes=[],values=new Map(),calls=[];
 const prior={...course,subId:'prior',start:course.start-86400,end:course.end-86400},revisions={slides:0,transcript:0};
 const store={activeCourse:course,loadCatalogue:()=>[prior],saveCatalogue(){},cache:{list:()=>[],revision:kind=>revisions[kind],read:(kind,c,name)=>values.get(kind+':'+c.subId+':'+name)||'',save(kind,c,name,value,revision){if(revision===revisions[kind]){writes.push([kind,c.subId]);values.set(kind+':'+c.subId+':'+name,value)}}}};
 loader.api={cancel(){},usePermissionStorage(){},chapters:async()=>[prior],permissions:async(rows,progress,force)=>{calls.push('permission:'+force);const states=Object.fromEntries(rows.map(c=>[c.subId,'allowed']));progress(states,rows.map(c=>c.subId));return states},slides:async c=>{calls.push('slides:'+c.subId);return[slide('prior-slide',10)]},transcripts:async c=>{calls.push('transcript:'+c.subId);return[{id:'history',t:20,end:30,text:'此前老师讲过',timing:'history'}]}};
 return{loader,originalApi,store,prior,writes,values,calls,revisions};
}
test('cross-lesson loading checks current permission again while reusing raw cached resources and never changes active course',async()=>{
 const {loader,store,prior,calls,writes}=priorFixture();const first=await loader.load(course,store,false,[],()=>{});assert.equal(first.lessons.length,1);assert.equal(first.lessons[0].lines[0].text,'此前老师讲过');assert.equal(store.activeCourse,course);assert.ok(writes.every(row=>row[1]===prior.subId));
 await loader.load(course,store,false,[],()=>{});assert.equal(calls.filter(c=>c.startsWith('permission')).length,2);assert.equal(calls.filter(c=>c.startsWith('slides')).length,1);assert.equal(calls.filter(c=>c.startsWith('transcript')).length,1);
});
test('fresh permission denial or unconfirmed cached allow excludes historical resources, including already downloaded material',async()=>{
 for(const state of ['denied','unknown']){const {loader,store,prior,calls}=priorFixture();loader.api.permissions=async(rows,progress)=>{progress({prior:state==='denied'?'denied':'allowed'},state==='denied'?['prior']:[]);return{prior:state==='denied'?'denied':'allowed'}};
 const result=await loader.load(course,store,false,[{course:prior,slides:[slide('saved',0)],lines:[{id:'saved',t:0,text:'不得混入'}]}],()=>{});assert.equal(result.lessons[0].lines.length,0);assert.equal(result.lessons[0].slides.length,0);assert.equal(calls.length,0);assert.ok(result.lessons[0].gaps.length);}
});
test('offline cross-lesson context uses saved material without network calls and explicitly states coverage limits',async()=>{
 const {loader,store,prior,calls}=priorFixture();loader.api.chapters=async()=>{throw Error('must not request')};loader.api.permissions=async()=>{throw Error('must not request')};
 const result=await loader.load(course,store,true,[{course:prior,slides:[slide('saved',0)],lines:[{id:'saved',t:0,text:'离线前序'}]}],()=>{});assert.equal(result.lessons[0].lines[0].text,'离线前序');assert.equal(calls.length,0);assert.match(result.gaps.join(''),/离线/);
});
test('a denial from a historical resource is final and does not request the next resource or use a cache fallback',async()=>{
 const {loader,originalApi,store,prior,calls}=priorFixture();originalApi.request=async()=>JSON.stringify({code:200,data:{prior:{video:false}}});loader.api.slides=async()=>{await originalApi.checkPermission(prior,false);return[]};
 const result=await loader.load(course,store,false,[],()=>{});assert.equal(result.lessons[0].lines.length,0);assert.ok(!calls.some(c=>c.startsWith('transcript')));assert.match(result.lessons[0].gaps.join(''),/拒绝/);
});
test('cross-lesson cancellation prevents late saves; clearing a cache also rejects late writes',async()=>{
 for(const cancel of [true,false]){const {loader,store,writes,revisions}=priorFixture();let resolve;loader.api.slides=()=>new Promise(r=>resolve=r);
 const pending=loader.load(course,store,false,[],()=>{});await new Promise(setImmediate);if(cancel)loader.cancel();else{revisions.slides++;revisions.transcript++}resolve([slide('late',0)]);
 if(cancel)await assert.rejects(pending,/已取消/);else await pending;assert.equal(writes.length,0);}
});
test('historical raw resource failures preserve known content with explicit missing or stale evidence labels',async()=>{
 const {loader,store,prior,values}=priorFixture();values.set('transcript:prior:timeline.json',JSON.stringify({course:prior,lines:[{id:'old',t:0,text:'旧证据'}],savedAt:0}));loader.api.transcripts=async()=>{throw Error('network')};
 const result=await loader.load(course,store,false,[],()=>{});assert.equal(result.lessons[0].lines[0].text,'旧证据');assert.match(result.lessons[0].gaps.join(''),/使用已保存版本/);
});
test('cross-lesson AI receives every previous sentence and current context independently; image tools remain bound to the older lesson',async()=>{
 const {AiClient}=load('services/AiClient');AiClient.savedKey=async()=> 'fixture';const ai=new AiClient(),bodies=[],recognized=[],saves=[];
 const old={...course,subId:'prior',start:course.start-86400};const store={activeCourse:course,imageVersion:()=> 'v1',cache:{revision:()=>0,read:()=>'',save:(kind,c)=>saves.push(c.subId)}};
 ai.readSlideUncached=async(s,store,key,c)=>{recognized.push([s.id,c?.subId]);return{text:'图像证据',version:'v1'}};
 ai.stream=async(key,body)=>{bodies.push(body);return bodies.length===1?{answer:'',calls:[{id:'tool',type:'function',function:{name:'read_course_slides',arguments:JSON.stringify({lesson:1,pages:[1]})}}]}:{answer:'关联前序知识',calls:[]}};
 await ai.ask(store,[slide('current',0)],[{id:'current',t:1,text:'当前材料'}],'概括',20,false,'test',[],()=>{},'always','current',()=>{},[],{gaps:[],lessons:[{course:old,slides:[slide('prior-slide',0)],lines:[{id:'old',t:100,text:'全部历史证据'}],gaps:[]}]});
 const material=bodies[0].messages.map(m=>m.content).join('\n');assert.match(material,/全部历史证据/);assert.match(material,/当前材料/);assert.match(material,/2026-10-08/);assert.ok(bodies[0].tools.some(t=>t.function.name==='read_course_slides'));assert.ok(recognized.some(row=>row[0]==='prior-slide'&&row[1]==='prior'));assert.ok(saves.includes('prior'));assert.equal(store.activeCourse,course);
});
test('cross-lesson summary is opt-in, respects the current time, and refreshes when historical evidence changes',async()=>{
 const {page,calls}=summaryFixture();page.live=false;page.scope='course';page.currentId='current';page.slides=[slide('opening',0),slide('current',50),slide('future',100)];page.contextTime=()=>70;page.lines=[{id:'past',t:10,end:20,text:'前面'},{id:'current',t:60,end:65,text:'目前'},{id:'future-in-page',t:90,end:95,text:'此刻还没讲'},{id:'future',t:110,end:120,text:'未来'}];
 page.store.activeCourse=course;let loads=0;const prior={lessons:[{course:{...course,subId:'prior'},slides:[],lines:[{id:'old',t:0,text:'前次课'}],gaps:[]}],gaps:[]};page.contextLoader={cancel(){},async load(){loads++;return prior}};
 const first=page.next();await new Promise(setImmediate);assert.equal(calls.length,1);assert.deepEqual(Array.from(calls[0].args[2],l=>l.id),['past','current']);assert.equal(calls[0].args[4],70);assert.equal(calls[0].args[5],false);assert.equal(calls[0].args[13],prior);calls[0].resolve('概述');await first;assert.equal(loads,1);
 const signature=page.signature(page.slides[1]);page.prior={...prior,lessons:[{...prior.lessons[0],lines:prior.lessons[0].lines.concat({id:'new',t:1,text:'补全前序'})}]};assert.notEqual(page.signature(page.slides[1]),signature);page.cancel();
 const ordinary=summaryFixture();ordinary.page.live=false;ordinary.page.slides=[slide('a',0)];ordinary.page.currentId='a';ordinary.page.contextLoader={cancel(){},load(){throw Error('ordinary scope must not fetch past lessons')}};const standard=ordinary.page.next();await new Promise(setImmediate);ordinary.calls[0].resolve('单页');await standard;ordinary.page.cancel();
});

test('cancelling while a historical image downloads prevents starting a later vision request',async()=>{
 const {AiClient}=load('services/AiClient');const ai=new AiClient();let resolve,requests=0;ai.request=async()=>{requests++;return'{}'};
 const reading=ai.readSlide(slide('a',0),{activeCourse:course,imageVersion:()=>'',cache:{revision:()=>0,read:()=>'',save(){}},image:()=>new Promise(r=>resolve=r)},'fixture',course);ai.cancel();resolve('file:///unused');await assert.rejects(reading,/已取消/);assert.equal(requests,0);
});
test('too much cross-lesson context is reported explicitly without quietly dropping older lessons',async()=>{
 const {AiClient}=load('services/AiClient');AiClient.savedKey=async()=> 'fixture';const ai=new AiClient();let requests=0;ai.stream=async()=>{requests++;return{answer:'no',calls:[]}};
 await assert.rejects(ai.ask({activeCourse:course,cache:{revision:()=>0,read:()=>''}},[],[],'summary',0,false,'test',[],()=>{},'never','',()=>{},[],{gaps:[],lessons:[{course:{...course,subId:'old'},slides:[],lines:[{id:'huge',t:0,text:'知识'.repeat(350001)}],gaps:[]}]}),/未自动删减课次/);assert.equal(requests,0);
});

test('prior-course summaries respect a newly rewound cutoff but cached answers survive historical metadata changes',()=>{
 const {page}=summaryFixture();page.scope='course';page.slides=[slide('current',0)];page.currentId='current';page.lines=[{id:'line',t:20,end:100,text:'讲解'}];page.contextTime=()=>70;page.prior={lessons:[],gaps:[]};
 page.results.current={answer:'旧回答',signature:'old',savedAt:Date.now(),completed:true,contextAt:100,priorKey:page.priorKey()};assert.equal(page.answer(),'');
 page.results.current.contextAt=50;assert.equal(page.answer(),'旧回答');page.prior={lessons:[],gaps:['访问权限已变化']};assert.equal(page.answer(),'旧回答');page.cancel();
});

test('collection folders show single-lesson favourites and watch-later as selected without claiming the whole course is selected',async()=>{
 const {CourseCollections}=load('model/CourseCollections'),collections=new CourseCollections();collections.toggleLesson('favourite',course);collections.toggleLesson('later',course);
 assert.equal(collections.hasCourse('favourite',course.courseId),false);assert.equal(collections.hasSelection('favourite',course.courseId),true);assert.equal(collections.hasSelection('later',course.courseId),true);
 const actions=componentFixture('CollectionActions');actions.collections=collections;actions.course=course;actions.folder=true;actions.known=[course];actions.folderWhole=false;actions.getUIContext=()=>({getPromptAction:()=>({showDialog:async()=>({index:1})})});
 assert.equal(actions.selected('favourite',0),true);assert.equal(actions.selected('later',0),true);await actions.toggle('favourite');assert.equal(collections.hasLesson('favourite',course),false);assert.equal(collections.hasLesson('later',course),true);await actions.toggle('favourite');assert.equal(collections.hasLesson('favourite',course),true);assert.equal(collections.hasCourse('favourite',course.courseId),false);
});
test('a collection folder toggles its listed lessons without accidentally subscribing the entire course',()=>{
 const {CourseCollections}=load('model/CourseCollections'),collections=new CourseCollections(),second={...course,subId:'second'},unselected={...course,subId:'third'};
 collections.toggleSelection('later',course,[course,second],false);assert.equal(collections.hasLesson('later',second),true);assert.equal(collections.hasLesson('later',unselected),false);collections.toggleSelection('later',course,[course,second],false);assert.equal(collections.entries('later').length,0);
 collections.toggleCourse('favourite',course,[course,second]);collections.toggleLesson('favourite',second);assert.equal(collections.hasCourse('favourite',course.courseId),false);assert.equal(collections.hasSelection('favourite',course.courseId),true);
});
test('plaza search-mode menu automatically reruns the entered query with the selected course or teacher field',async()=>{
 const p=componentFixture('Plaza'),searches=[];p.query='fixture query';p.account={id:'u',tenantId:112};p.api.searchCourses=async(a,title,teacher)=>{searches.push([title,teacher]);return{list:[],total:0}};p.classify=async()=>{};p.publishScope=()=>{};
 p.chooseSearchMode(true);await new Promise(setImmediate);assert.equal(p.teacherSearch,true);assert.equal(p.searchByTeacher,true);assert.deepEqual(searches[0],['','fixture query']);p.chooseSearchMode(false);await new Promise(setImmediate);assert.deepEqual(searches[1],['fixture query','']);
 const source=fs.readFileSync(path.join(root,'components/Plaza.ets'),'utf8');assert.match(source,/bindMenu\(\[\{ value: '课程'.*chooseSearchMode\(false\).*value: '教师'.*chooseSearchMode\(true\)/);
});
test('plaza back moves through calendar, course lessons, search results and plaza one level at a time',async()=>{
 const p=componentFixture('Plaza');p.active=true;p.calendarOpen=true;p.chapterTitle='课程';p.searching=true;p.query='查询';let parent=0,loads=0;p.onBack=()=>parent++;p.classify=()=>{};p.load=()=>{loads++;p.searching=false};
 p.navigateBack();assert.equal(p.calendarOpen,false);assert.equal(p.chapterTitle,'课程');assert.equal(parent,0);p.navigateBack();assert.equal(p.chapterTitle,'');assert.equal(p.searching,true);assert.equal(parent,0);p.navigateBack();assert.equal(p.query,'');assert.equal(loads,1);assert.equal(parent,0);p.navigateBack();assert.equal(parent,1);
 const source=fs.readFileSync(path.join(root,'components/Plaza.ets'),'utf8');assert.match(source,/Button\('‹ 返回'\).*onClick\(\(\) => this.navigateBack\(\)\)/);
});
test('all-courses back and the global my-courses shortcut reset only the intended navigation level',()=>{
 const p=componentFixture('MyCourses');p.active=true;p.calendarOpen=true;p.selectedCourse='course';p.selectedDate='2026-10-09';let backs=0;p.onBack=()=>backs++;
 p.goBack();assert.equal(p.calendarOpen,false);assert.equal(p.selectedCourse,'course');p.goBack();assert.equal(p.selectedCourse,'');assert.equal(p.selectedDate,'2026-10-09');p.goBack();assert.equal(p.selectedDate,'');p.goBack();assert.equal(backs,1);
 p.calendarOpen=true;p.selectedCourse='course';p.selectedDate='date';p.resetRoot();assert.equal(p.calendarOpen,false);assert.equal(p.selectedCourse,'');assert.equal(p.selectedDate,'');
});
test('my-courses shortcut restores the last tab, exits the lesson cleanly and preserves the previous base tab behind all-courses',()=>{
 const p=indexLogicFixture(['showMyCourses']);const saved=[];p.store={saveJson:(n,v)=>saved.push(v)};p.myCoursesTab='recent';p.myCoursesHomeSequence=0;p.screen='home';let resumed=0,left=0;p.resume=()=>resumed++;p.home=()=>{left++;p.screen='home'};
 p.plaza=true;p.collectionPage='later';p.showMyCourses();assert.equal(p.recent,true);assert.equal(p.plaza,false);assert.equal(p.collectionPage,'');assert.equal(resumed,1);assert.equal(saved.at(-1),'recent');
 p.showMyCourses('all');assert.equal(p.allCoursesOpen,true);assert.equal(p.recent,true);p.plaza=true;p.allCoursesOpen=false;p.screen='lesson';p.layoutOpen=true;p.overview=true;p.showMyCourses();assert.equal(left,1);assert.equal(p.screen,'home');assert.equal(p.allCoursesOpen,true);assert.equal(p.plaza,false);assert.equal(p.layoutOpen,false);assert.equal(p.overview,false);assert.equal(p.myCoursesHomeSequence,3);
 p.showMyCourses('today');assert.equal(p.recent,false);assert.equal(p.allCoursesOpen,false);assert.equal(saved.at(-1),'today');
});

test('cancel-all collection actions persist only the requested collection and keep the other list intact',()=>{
 const {CourseCollections}=load('model/CourseCollections'),c=new CourseCollections();let disk='',changes=0;c.onChange=()=>changes++;c.bind({readJson:()=>disk,saveJson:(n,v)=>disk=v});c.toggleLesson('favourite',course);c.toggleCourse('later',course,[course]);c.clear('favourite');assert.equal(c.entries('favourite').length,0);assert.equal(c.hasLesson('later',course),true);assert.equal(JSON.parse(disk).favourites.length,0);c.clear('later');assert.equal(c.entries('later').length,0);assert.ok(changes>=5);
});
test('download progress weighs exact bytes rather than page or fragment counts, including unequal file sizes',()=>{
 const {downloadBytes,utf8Bytes}=load('model/DownloadBytes');const part=(id,total,received,done=false)=>({id,total,received,done});
 const first=downloadBytes([part('small',100,100,true),part('large',900,0)]);assert.equal(first.received,100);assert.equal(first.total,1000);assert.equal(first.progress,.1);
 const half=downloadBytes([part('small',100,100,true),part('large',900,400)]);assert.equal(half.progress,.5);assert.equal(half.unknown,0);assert.equal(utf8Bytes('课a🙂'),8);
 const all=downloadBytes([part('small',100,100,true),part('large',900,900,true)]);assert.equal(all.progress,1);
});
test('unknown file size never produces a fabricated percent; confirmed bytes still stay visible',()=>{
 const {downloadBytes}=load('model/DownloadBytes');const state=downloadBytes([{id:'known',total:100,received:100,done:true},{id:'unknown',total:-1,received:300,done:false}]);assert.equal(state.received,400);assert.equal(state.unknown,1);assert.equal(state.progress,0);
});
test('partial HLS retains only the continuous playable prefix so missing intervals do not shift lecture time alignment',()=>{
 const {availablePlaylist}=load('model/DownloadBytes'),text='#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\na.ts\n#EXTINF:10,\nb.ts\n#EXTINF:10,\nc.ts\n#EXT-X-ENDLIST\n';
 const prefix=availablePlaylist(text,['b.ts']);assert.match(prefix,/a\.ts/);assert.doesNotMatch(prefix,/b\.ts|c\.ts/);assert.equal(prefix.match(/#EXTINF/g).length,1);assert.match(prefix,/#EXT-X-ENDLIST/);assert.equal(availablePlaylist(text,['a.ts']),'');
 assert.equal(availablePlaylist('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:10,\na.ts\n',['key.bin']),'');
});
test('retrying a failed PPT downloads only the missing page and reuses the successfully saved transcription',async()=>{
 const {lib,files}=offlineFixture();let fail=true;const pins=[],asr=[];lib.api.slides=async()=>[slide('a',0),slide('b',20)];lib.api.transcripts=async()=>{asr.push(1);return[{id:'l',t:1,end:10,text:'成功转写'}]};
 lib.measure=async(job,parts)=>{parts.forEach(p=>{p.total=100})};lib.store.pinImage=async(url,report)=>{pins.push(url);if(url.endsWith('/b.png')&&fail)throw Error('404 missing');const path='/saved/'+url.split('/').at(-1);files.set(path,'x'.repeat(100));report(100,100);return'file://'+path};
 const job={id:'retry',course,options:{slides:true,transcript:true,video:false},state:'running',progress:0,message:''};await assert.rejects(lib.download(job),/课件第 2 页（00:20）下载失败/);assert.equal(lib.snapshot(course.subId).slides.length,1);assert.equal(job.downloadedBytes,100+load('model/DownloadBytes').utf8Bytes(JSON.stringify(lib.snapshot(course.subId).lines)));
 fail=false;await lib.download(job);assert.equal(pins.filter(p=>p.endsWith('/a.png')).length,1);assert.equal(pins.filter(p=>p.endsWith('/b.png')).length,2);assert.equal(asr.length,1);assert.equal(lib.snapshot(course.subId).slides.length,2);assert.equal(job.progress,1);assert.equal(lib.list()[0].incomplete,false);clearTimeout(lib.progressTimer);
});
test('failed HLS keeps later successful fragments and retries only the failed fragment, producing a full playlist after recovery',async()=>{
 const {lib,files}=offlineFixture();let fail=true;const requests=[];lib.api.videos=async()=>[{id:'fixture',url:'https://cmc.zju.edu.cn/main.m3u8',hls:true,live:false}];lib.text=async()=>'#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\na.ts\n#EXTINF:10,\nb.ts\n#EXTINF:10,\nc.ts\n#EXT-X-ENDLIST\n';
 lib.measure=async(job,parts)=>parts.forEach(p=>p.total=100);lib.file=async(url,destination,report)=>{requests.push(url);if(fail&&url.endsWith('/b.ts'))throw Error('404');files.set(destination,'x'.repeat(100));report(100,100)};
 const job={id:'hls',course,options:{slides:false,transcript:false,video:true},state:'running',progress:0,message:''};await assert.rejects(lib.download(job),/1 个视频文件未完成/);assert.ok(job.downloadedBytes>=200);assert.ok(Math.abs(job.progress-job.downloadedBytes/job.totalBytes)<1e-9);assert.equal(lib.list()[0].partial,true);assert.equal(lib.list()[0].incomplete,true);
 const path=lib.list()[0].videoUri.replace('file://',''),prefix=files.get(path);assert.equal(prefix.match(/#EXTINF/g).length,1);
 fail=false;await lib.download(job);assert.equal(requests.filter(p=>p.endsWith('/a.ts')).length,1);assert.equal(requests.filter(p=>p.endsWith('/c.ts')).length,1);assert.equal(requests.filter(p=>p.endsWith('/b.ts')).length,2);assert.equal(files.get(path).match(/#EXTINF/g).length,3);assert.equal(job.progress,1);assert.equal(lib.list()[0].partial,false);clearTimeout(lib.progressTimer);
});
test('saving available content preserves the retry checkpoint and requeue keeps successful resource completion',async()=>{
 const {lib}=offlineFixture(),job={id:'same',course,options:{slides:true,transcript:true,video:false},state:'error',progress:.5,message:'1张未完成',parts:[{id:'a',kind:'slides',url:'a',path:'/a',received:50,total:50,done:true}],transcriptComplete:true};
 lib.jobs=[job];lib.entries=[{course,options:{slides:true,transcript:true,video:false},incomplete:true}];lib.saveAvailable(course.subId);assert.equal(lib.tasks()[0].state,'saved');assert.equal(lib.list()[0].incomplete,true);lib.drain=()=>{};lib.retryJob(course.subId);assert.equal(lib.jobs[0].id,'same');assert.equal(lib.jobs[0].state,'queued');assert.equal(lib.jobs[0].parts[0].done,true);assert.equal(lib.jobs[0].transcriptComplete,true);
});
test('successful download checkpoints survive application reopening and do not count as pending transfer again',()=>{
 const {lib}=offlineFixture();lib.jobs=[{id:'stored',course,options:{video:true,slides:false,transcript:false},state:'error',progress:.5,message:'部分失败',parts:[{id:'finished',kind:'video',url:'https://cmc.zju.edu.cn/a.ts',path:'/file',total:100,received:100,done:true}],transcriptComplete:true}];lib.publish();const restored=new lib.constructor(lib.store,()=>{});assert.equal(restored.jobs[0].parts[0].done,true);assert.equal(restored.jobs[0].transcriptComplete,true);assert.equal(restored.jobs[0].state,'error');
});
test('a cancelled byte-download attempt cannot continue to another fragment after quick resume',async()=>{
 const {lib}=offlineFixture();const requests=[];lib.file=async(url)=>{requests.push(url);lib.epoch++;lib.canceled=false;throw Error('stopped')};const prepared={folder:'/files',name:'index.m3u8',children:[],plan:{files:[{url:'a',name:'a.ts'},{url:'b',name:'b.ts'}],text:'#EXTM3U',endList:true,offset:0}};
 await assert.rejects(lib.writePlaylist(prepared,{course,options:{video:true},progress:0}),/已暂停/);assert.deepEqual(requests,['a']);clearTimeout(lib.progressTimer);
});
test('learning header keeps my-courses home shortcut on the left and one previous-page return on the right',()=>{
 const source=fs.readFileSync(path.join(root,'pages/Index.ets'),'utf8'),header=source.slice(source.indexOf('  private topBar()'),source.indexOf('  private welcome()'));const lesson=header.slice(0,header.indexOf('      } else {'));
 assert.equal((lesson.match(/Button\('返回'\)/g)||[]).length,1);assert.equal(lesson.includes("Button('我的课堂')"),true);assert.match(lesson,/onBackPress\(\)/);assert.match(header,/Button\('我的课堂'\).*showMyCourses\(\)/);
});
test('rejected video response bodies are discarded rather than retained as resumable media bytes',async()=>{
 const contents=new Map(),handlers={};
 const io={OpenMode:{CREATE:1,WRITE_ONLY:2,APPEND:8},openSync:p=>({fd:p}),statSync:p=>{if(!contents.has(p))throw Error('missing');return{size:contents.get(p).length}},writeSync:(p,data)=>{const bytes=Buffer.from(data);contents.set(p,Buffer.concat([contents.get(p)||Buffer.alloc(0),bytes]));return bytes.length},truncateSync:(p,size)=>contents.set(p,(contents.get(p)||Buffer.alloc(0)).subarray(0,size)),closeSync(){},renameSync(){throw Error('a denied body must not become a media file')}};
 const req={on:(event,fn)=>handlers[event]=fn,destroy(){},requestInStream:async()=>{handlers.headersReceive({'Content-Length':'3'});handlers.dataReceive(Uint8Array.from([101,114,114]).buffer);handlers.dataEnd();return 403}};
 const {lib}=offlineFixture({'@kit.CoreFileKit':{fileIo:io},'@kit.NetworkKit':{http:{createHttp:()=>req}}});const progress=[];
 await assert.rejects(lib.fileOnce('https://cmc.zju.edu.cn/file.ts','/file.ts',(a,b)=>progress.push([a,b])),/403/);
 assert.equal(contents.get('/file.ts.part').length,0);assert.deepEqual(progress.at(-1),[0,-1]);
});
test('whole-course context includes later recorded lessons but excludes unrelated, current and not-yet-started lessons',()=>{
 const {priorLessons}=load('model/CourseContext'),past={...course,subId:'past',start:course.start-100},later={...course,subId:'later',start:course.start+100},future={...course,subId:'notyet',start:Date.now()/1000+86400};
 assert.deepEqual(Array.from(priorLessons([future,later,course,past,{...past,subId:'wrong',courseId:'else'}],course,true),c=>c.subId),['past','later']);
 assert.deepEqual(Array.from(priorLessons([later,past],course),c=>c.subId),['past']);
});
test('cross-lesson citations resolve their own course and time while unknown or out-of-range citations stay plain text',()=>{
 const {courseAnswerParts}=load('model/CourseReference'),earlier={...course,subId:'earlier',start:course.start-86400,end:course.end-86400},context={lessons:[{course:earlier,slides:[],lines:[],gaps:[]}],gaps:[]};
 const parts=courseAnswerParts('参见**【2026-10-08 08:00课次 · 12:30】**，本节[01:10]，【2026-10-07 08:00课次 · 12:30】，【2026-10-08 08:00课次 · 999:30】',context);
 const links=parts.filter(p=>p.seconds>=0);assert.equal(links.length,2);assert.equal(links[0].course.subId,'earlier');assert.equal(links[0].seconds,750);assert.equal(links[0].bold,true);assert.equal(links[1].seconds,70);assert.equal(links[1].course,undefined);
});
test('live-following summary hides whole-lesson and whole-course scopes and safely switches away when catching up',()=>{
 const p=componentFixture('PageSummary');p.followingLive=true;assert.equal(p.scopeMenu().length,3);assert.ok(!p.scopeMenu().some(o=>o.value.startsWith('整课脉络')||o.value.startsWith('结合整门课 ·')));
 p.followingLive=false;assert.equal(p.scopeMenu().length,5);const scopes=[];p.changeScope=s=>scopes.push(s);p.refresh=()=>{};p.scope='courseAll';p.followingLive=true;p.availabilityChanged();p.scope='whole';p.availabilityChanged();assert.deepEqual(scopes,['course','before']);
});
test('whole-course loader requests and preserves a later recorded lesson with its separate timeline',async()=>{
 const {loader,store,prior}=priorFixture(),later={...course,subId:'later',start:course.start+86400,end:course.end+86400};loader.api.chapters=async()=>[course,prior,later];
 const result=await loader.load(course,store,false,[],()=>{},true);assert.equal(result.wholeCourse,true);assert.deepEqual(Array.from(result.lessons,l=>l.course.subId),['prior','later']);assert.equal(result.lessons[1].lines[0].t,20);
});
test('course reference navigation returns to the exact originating lesson and position through nested references',()=>{
 const p=indexLogicFixture(['jumpReferencedCourse','returnReferencedCourse']);const a=course,b={...course,subId:'b'},c={...course,subId:'c'},opened=[];Object.assign(p,{course:a,showVideo:true,offlineViewing:false,courseReturnStack:[]});p.saveProgress=()=>{};p.learningTime=()=>137;p.enter=(course,reference)=>{opened.push([course.subId,reference.at,reference.video]);p.course=course};
 p.jumpReferencedCourse(b,75);p.jumpReferencedCourse(c,12);p.returnReferencedCourse();p.returnReferencedCourse();assert.deepEqual(opened,[['b',75,true],['c',12,true],['b',137,true],['sample',137,true]]);assert.equal(p.courseReturnStack.length,0);
});
test('course reference position overrides saved progress without discarding the target lessons own checkpoint',async()=>{
 const p=indexLogicFixture(['restoreProgress']);Object.assign(p,{progressReady:false,pendingCourseJump:{course,at:75,video:false},pendingProgress:{seconds:500,video:true},generation:1,info:{sub_status:6}});const jumped=[];p.rewind=(at)=>jumped.push(at);p.toggleVideo=()=>assert.fail('reference should not open video when previously hidden');
 await p.restoreProgress();assert.deepEqual(jumped,[75]);assert.equal(p.pendingCourseJump,undefined);assert.equal(p.progressReady,true);
});
test('pinned-feature dragging translates the actual row and displaces neighbouring rows without persisting every frame',async()=>{
 const p=indexLogicFixture(['beginPinDrag','updatePinDrag','pinOffsetFor','endPinDrag']);p.pinnedSettings=['slides','transcript','video'];let saved=0;p.savePins=()=>saved++;p.beginPinDrag('slides');p.updatePinDrag(120);
 assert.equal(p.pinOffsetFor('slides'),120);assert.equal(p.pinOffsetFor('transcript'),-76);assert.equal(p.pinOffsetFor('video'),-76);assert.equal(saved,0);p.endPinDrag();await new Promise(r=>setTimeout(r,140));assert.equal(p.pinDragOffset,0);assert.deepEqual(Array.from(p.pinnedSettings),['transcript','video','slides']);assert.equal(saved,1);
});
test('duplicate detector tolerates dense capture compression noise without treating a changed glyph as duplicate',()=>{
 const {screenshotsEqual}=load('model/SlideSimilarity'),w=128,h=128,a=new Uint8Array(w*h*4),b=new Uint8Array(w*h*4);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;for(let c=0;c<3;c++){a[i+c]=100+(x+y+c)%80;b[i+c]=a[i+c]+((x+y)%2?12:-12)}a[i+3]=b[i+3]=255}
 assert.equal(screenshotsEqual(a,b,w,h,w*4,w*4),true);for(let y=50;y<57;y++)for(let x=50;x<57;x++){const i=(y*w+x)*4;b[i]=b[i+1]=b[i+2]=0}assert.equal(screenshotsEqual(a,b,w,h,w*4,w*4),false);
});
test('summary token hints compare available text size and explicitly defer estimates for unloaded cross-course context',()=>{
 const p=componentFixture('PageSummary');p.slides=[slide('a',0),slide('b',100)];p.currentId='a';p.lines=[{id:'a',t:10,text:'当前页'.repeat(10)},{id:'b',t:110,text:'后续页'.repeat(100)}];p.contextTime=()=>50;
 assert.match(p.scopeCost('page'),/文本约 \d+ Token/);assert.notEqual(p.scopeCost('page'),p.scopeCost('whole'));assert.match(p.scopeCost('course'),/加载后估算/);p.prior={lessons:[{course,slides:[],lines:[{t:0,text:'前节内容'.repeat(200)}],gaps:[]}],gaps:[]};assert.match(p.scopeCost('course'),/文本约 \d+ Token/);assert.match(p.scopeCost('courseAll'),/加载后估算/);
});
test('local changed glyphs are rejected even when they straddle four comparison tiles on a high-resolution slide',()=>{
 const {screenshotsEqual}=load('model/SlideSimilarity'),w=640,h=360,a=new Uint8Array(w*h*4);for(let i=0;i<a.length;i+=4){a[i]=a[i+1]=a[i+2]=200;a[i+3]=255}const b=new Uint8Array(a);
 for(let y=14;y<18;y++)for(let x=14;x<18;x++){const i=(y*w+x)*4;b[i]=b[i+1]=b[i+2]=0}assert.equal(screenshotsEqual(a,b,w,h,w*4,w*4),false);
});

test('transcript scrolling records absolute viewport position and a page switch clears old follow coordinates',()=>{
 const p=componentFixture('TranscriptColumn');let reset;p.scroller={currentOffset:()=>({yOffset:240}),scrollTo:v=>reset=v};p.scrolled();assert.equal(p.scrollOffset,240);p.activeTop=500;p.activeBottom=540;p.selecting=true;p.pageChanged();assert.equal(p.scrollOffset,0);assert.equal(p.activeTop,-1);assert.equal(p.selecting,false);assert.equal(reset.yOffset,0);
});
test('a swipe through slide padding suppresses navigation and the note insertion popup',()=>{
 const p=componentFixture('PageCard');let jumps=0;p.onJump=()=>jumps++;p.moved=true;p.insertOpen=true;p.jumpIfTap();assert.equal(jumps,0);p.moved=false;p.suppressedUntil=Date.now()+1000;p.jumpIfTap();assert.equal(jumps,0);p.suppressedUntil=0;p.jumpIfTap();assert.equal(jumps,1);assert.equal(p.insertOpen,false);
});
test('unmounted note editor ignores delayed caret reads',()=>{
 const p=componentFixture('NoteTextEditor');p.ready=false;p.controller={getSelection:()=>assert.fail('unmounted controller read')};p.remember();
});
test('switching courses flushes pending note edits to their original lesson instead of the destination',()=>{
 const p=componentFixture('NotesPane'),saved=[];p.ready=true;p.course={...course,subId:'new'};p.editingCourse=course;p.boundCourseId=course.subId;p.activeNoteId='default';p.activeNoteTitle='课堂笔记';p.noteList=[];
 p.blocks=[{id:'text',source:'notes',at:10,end:10,sourceId:'',atoms:[{id:'atom',kind:'text',value:'unsaved fixture note',at:10,end:10,sourceId:'',bold:false,italic:false,underline:false}]}];
 p.repository={save:note=>saved.push(note)};let refreshed=0;p.refreshNotes=()=>refreshed++;p.onEditingFocus=()=>{};p.courseChanged();assert.equal(saved.length,1);assert.equal(saved[0].course.subId,course.subId);assert.equal(p.editingCourse.subId,'new');assert.equal(refreshed,1);assert.equal(p.focusedBlockId,'');
});
test('note blur cleanup cannot mutate blocks restored for a different course',async()=>{
 const p=componentFixture('NotesPane');p.ready=true;p.boundCourseId='old';p.blocks=[];p.editingFocus('old-block',false);p.boundCourseId='new';const blocks=[{id:'empty-a',source:'notes',atoms:[]},{id:'empty-b',source:'notes',atoms:[]}];p.blocks=blocks;p.persist=()=>assert.fail('old callback saved destination note');await new Promise(r=>setTimeout(r,150));assert.equal(p.blocks,blocks);
});
test('overview discards bounds for removed slides and stops an out-of-range selection',()=>{
 const p=componentFixture('SlideOverview');p.groups=[{slide:slide('a',0),lines:[]}];p.itemBounds=new Map([['a',{}],['removed',{}]]);p.anchor=5;let ended=0,replaced;p.end=()=>ended++;p.source={replace:v=>replaced=v};p.groupsChanged();assert.equal(p.itemBounds.has('removed'),false);assert.equal(p.itemBounds.has('a'),true);assert.equal(ended,1);assert.equal(replaced,p.groups);
});
test('lesson shortcuts do not open another dialog beneath modal selection or download screens',()=>{
 const p=indexLogicFixture(['keyboard']);p.screen='lesson';let actions=0;p.featureAction=()=>actions++;const event={type:inputGlobals.KeyType.Down,keyText:'g',getModifierKeyState:()=>true};
 for(const flag of ['aiPagePicker','settingsCustomizeOpen','lessonDownloadOpen','privacyOpen','jumpingDialogOpen']){p[flag]=true;assert.equal(p.keyboard(event),false);p[flag]=false;}assert.equal(actions,0);
});
test('fullscreen slide navigation respects empty-transcript skipping and updates the displayed image',()=>{
 const p=indexLogicFixture(['turnExpandedSlide']);p.groups=timeline.groupPages([slide('a',0),slide('b',20),slide('c',40)],[{id:'a-line',t:10,text:'one'},{id:'c-line',t:50,text:'three'}]);p.expandedSlideId='a';p.skipEmpty=true;p.selected=0;p.chooseSlide=()=>assert.fail('fullscreen must not navigate the lecture');let image;p.queueImage=s=>image=s.id;p.skipHint=()=>{};p.turnExpandedSlide(1);assert.equal(image,'c');assert.equal(p.selected,0);assert.equal(p.expandedSlideId,'c');p.turnExpandedSlide(-1);assert.equal(p.expandedSlideId,'a');
});

 test('opening a slide fullscreen releases editor focus so arrows reach the displayed slide',()=>{
 const p=indexLogicFixture(['openExpandedSlide','keyboard']);let cleared=0,turned=0;p.getUIContext=()=>({getFocusController:()=>({clearFocus:()=>cleared++})});p.focusedEditors=new Set(['ai']);p.inputFocused=true;p.screen='lesson';p.chooseSlide=()=>{};p.turnExpandedSlide=()=>turned++;p.openExpandedSlide(slide('a',0));assert.equal(cleared,1);assert.equal(p.inputFocused,false);assert.equal(p.focusedEditors.size,0);assert.equal(p.slideFullscreen,true);assert.equal(p.keyboard({type:0,keyCode:2015,getModifierKeyState:()=>false}),true);assert.equal(turned,1);
 });

 test('single-line physical input deletes a selected range and edits ASCII digits without leaving a stale controlled value',()=>{
 const {PhysicalInput}=load('services/PhysicalInput',{},inputGlobals),field=new PhysicalInput();let value='1234';field.controller.value=value;field.controller.setTextSelection(0,4);const event={type:0,keyCode:2055,keyText:'',getModifierKeyState:()=>false};assert.equal(field.digit(event,value,v=>value=v),true);assert.equal(value,'');assert.equal(field.controller.value,'');
 field.controller.value=value='12';field.controller.caretPosition(1);assert.equal(field.digit({...event,keyCode:2071},value,v=>value=v),true);assert.equal(value,'1');assert.equal(field.digit(event,value,v=>value=v),true);assert.equal(value,'');
 field.controller.value=value='汉';field.controller.caretPosition(1);assert.equal(field.digit(event,value,()=>assert.fail('native Unicode deletion should be preserved')),false);
 });

 test('a late gallery result cannot insert into another lesson after course navigation',async()=>{
 let release;const photoAccessHelper={PhotoViewPicker:class {select(){return new Promise(resolve=>release=resolve)}},PhotoViewMIMETypes:{IMAGE_TYPE:'image'}};
 const method=fs.readFileSync(path.join(root,'components/NotesPane.ets'),'utf8').split('\n').find(line=>line.includes('private async photo()'));
 const exports={},output=ts.transpileModule('export class GalleryFixture {\n'+method+'\n}',{compilerOptions:{target:ts.ScriptTarget.ES2021,module:ts.ModuleKind.CommonJS}}).outputText;vm.runInNewContext(output,{exports,photoAccessHelper});
 const p=componentFixture('NotesPane');p.photo=exports.GalleryFixture.prototype.photo;p.ready=true;p.boundCourseId=course.subId;p.editingCourse=course;p.course=course;p.persist=()=>{};p.refreshNotes=()=>{};p.insert=()=>assert.fail('stale photo inserted');const task=p.photo();p.course={...course,subId:'new'};p.courseChanged();release({photoUris:['fixture-image']});await task;
 });

test('missing resource pane habits are isolated from regular lessons and reused for the same absence profile',()=>{
 const {defaultPaneChoices,chosenPanes,rememberPaneChoices,missingPaneKey}=load('model/PanePreferences');
 let preferences={regular:{...defaultPaneChoices(),video:true,notes:true},missing:{}};
 preferences=rememberPaneChoices(preferences,{slides:false,transcript:true,video:true,notes:false,ai:true,summary:true},['slides']);
 assert.equal(chosenPanes(preferences,[]).slides,true);assert.equal(chosenPanes(preferences,[]).notes,true);
 const missing=chosenPanes(preferences,['slides']);assert.equal(missing.slides,false);assert.equal(missing.ai,true);assert.equal(missing.notes,false);
 assert.equal(chosenPanes(preferences,['slides','video']).ai,false);assert.equal(chosenPanes(preferences,['slides','video']).video,false);
 assert.equal(missingPaneKey(['video','slides','slides']),missingPaneKey(['slides','video']));
 preferences=rememberPaneChoices(preferences,{...defaultPaneChoices(),notes:false,summary:true},[]);
 assert.equal(chosenPanes(preferences,[]).summary,true);assert.equal(chosenPanes(preferences,['slides']).ai,true);
});
test('completed missing lesson discovery preserves known video absence without resetting the regular habit',()=>{
 const p=indexLogicFixture(['updateMissingPanes','applyPaneChoices']);let resized=0,paused=0;
 Object.assign(p,{panePreferences:{regular:{slides:true,transcript:true,video:true,notes:false,ai:false,summary:false},missing:{'slides|video':{slides:false,transcript:true,video:false,notes:true,ai:true,summary:false}}},info:{sub_status:6},historyReady:true,slides:[],lines:[{t:0,text:'available'}],missingPanes:['video'],preferenceProfile:'video',showVideo:true,notesCreated:false,aiCreated:false,summaryCreated:false});p.resize=()=>resized++;p.playback={pause:()=>paused++};p.fullscreen=()=>{};
 p.updateMissingPanes();assert.equal(p.preferenceProfile,'slides|video');assert.equal(p.slidesEnabled,false);assert.equal(p.transcription,true);assert.equal(p.notesOpen,true);assert.equal(p.showVideo,false);assert.equal(paused,1);p.updateMissingPanes();assert.equal(resized,1);assert.equal(p.panePreferences.regular.slides,true);
 p.info.sub_status=1;p.slides=[];p.lines=[];p.updateMissingPanes();assert.equal(p.preferenceProfile,'slides|video');
});
test('merged adjacent slides keep a single chronologically ordered transcript including exact boundaries',()=>{
 const a=slide('a',0),b={...slide('b',30),duplicateOf:'a',duplicateUrl:a.url},c=slide('c',60),d={...slide('d',90),duplicateOf:'a',duplicateUrl:a.url};
 const lines=[{id:'late',t:50,text:'second'},{id:'next',t:60,text:'next'},{id:'early',t:10,text:'first'},{id:'later',t:90,text:'non-adjacent'}];
 const grouped=timeline.groupPages([a,b,c,d],lines,true);
 assert.deepEqual(Array.from(grouped,g=>[g.slide.id,Array.from(g.lines,l=>l.id)]),[['a',['early','late']],['c',['next']],['d',['later']]]);
});
test('AI page selection maps hidden duplicates to the retained page and removes skipped empty pages',()=>{
 const p=indexLogicFixture(['reconcileChosenPages']);const a=slide('a',0),b={...slide('b',30),duplicateOf:'a',duplicateUrl:a.url},c=slide('c',60),d=slide('d',90);
 Object.assign(p,{slides:[a,b,c,d],groups:timeline.groupPages([a,b,c,d],[{id:'x',t:40,text:'second'},{id:'y',t:95,text:'fourth'}],true),skipEmpty:true,info:{sub_status:6},aiSelectedIds:['b','a','c','d']});p.reconcileChosenPages();assert.deepEqual(Array.from(p.aiSelectedIds),['a','d']);
});
test('four widescreen slides choose a balanced grid and portrait slides retain more columns',()=>{
 const {slideGridLayout}=load('model/SlideGrid');assert.equal(slideGridLayout(1400,850,4,16/9).columns,2);assert.equal(slideGridLayout(1400,850,4,16/9).rows,2);assert.equal(slideGridLayout(1400,850,4,0.6).columns,4);
 const tall=slideGridLayout(500,1100,4,16/9);assert.ok(tall.rows>=2);assert.ok(tall.width>0&&tall.height>0);
});
test('continuous large transcripts have few native spans and only visible timestamp markers',()=>{
 const {transcriptRuns,visibleTranscriptMarkers,offsetLine}=load('model/TranscriptRender');const values=Array.from({length:10000},(_,i)=>'sentence-'+i),offsets=[];let offset=0;for(const value of values){offsets.push(offset);offset+=value.length+1;}const text=values.join('\n');
 const runs=transcriptRuns(text,offsets,9500,[200,201]);assert.equal(runs.map(r=>r.value).join(''),text);assert.ok(runs.length<=9);assert.equal(runs.filter(r=>r.active).map(r=>r.value).join('').trim(),'sentence-9500');
 const markers=visibleTranscriptMarkers(offsets,offsets[400],offsets[410],9500,200);assert.ok(markers.length<=17);assert.ok(markers.includes(9500));assert.ok(markers.includes(200));assert.equal(offsetLine(offsets,offsets[500]+3),500);
});
test('calendar hides adjacent months while still showing their classes in the correct month and supports year shifts',()=>{
 const {calendarMonthGrid,shiftCalendarMonth}=load('model/CourseSections');const record={...course,start:Date.parse('2026-09-28T08:00:00+08:00')/1000};
 const october=calendarMonthGrid('2026-10',[record]),september=calendarMonthGrid('2026-09',[record]);assert.equal(october.filter(c=>!c.inMonth).every(c=>c.date===''&&c.day===''&&c.count===0),true);assert.equal(october.filter(c=>c.inMonth).length,31);assert.equal(september.find(c=>c.date==='2026-09-28').count,1);assert.equal(shiftCalendarMonth('2026-10',12),'2027-10');assert.equal(shiftCalendarMonth('2026-10',-12),'2025-10');
});
test('refreshed schedule notice expires after two seconds and cannot erase a later failure',()=>{
 const p=componentFixture('DownloadSheet');let callback,delay;const source=fs.readFileSync(path.join(root,'components/DownloadSheet.ets'),'utf8').split('\n').find(l=>l.includes('private showUpdatedNotice()'));
 const exports={},output=ts.transpileModule('export class NoticeFixture {\n'+source+'\n}',{compilerOptions:{target:ts.ScriptTarget.ES2021,module:ts.ModuleKind.CommonJS}}).outputText;vm.runInNewContext(output,{exports,setTimeout:(fn,ms)=>{callback=fn;delay=ms;return 1},clearTimeout:()=>{}});p.showUpdatedNotice=exports.NoticeFixture.prototype.showUpdatedNotice;p.disposed=false;p.epoch=1;p.showUpdatedNotice();assert.equal(delay,2000);callback();assert.equal(p.notice,'');p.showUpdatedNotice();p.notice='later failure';callback();assert.equal(p.notice,'later failure');
});
test('AI and summary note sources preserve their return references through insertion, slicing and legacy restore',()=>{
 const {sliceNoteAtoms,noteBlocks,defaultNotePalette,validNotePalette,blockTitle}=load('model/NoteBlocks');const reference={kind:'question',courseId:course.subId,sessionId:'chat-1',turn:2,at:42},atom={id:'q',kind:'question',value:'selected fixture answer',at:42,end:42,sourceId:'',bold:false,italic:false,underline:false,reference};
 assert.equal(sliceNoteAtoms([atom],0,8)[0].reference.sessionId,'chat-1');assert.equal(noteBlocks({atoms:[atom],anchors:[]})[0].source,'question');assert.equal(noteBlocks({atoms:[{...atom,kind:'summary'}],anchors:[]})[0].source,'summary');assert.notEqual(defaultNotePalette().question,defaultNotePalette().summary);assert.equal(validNotePalette({notes:'#FFF5D9'}).question,defaultNotePalette().question);assert.equal(blockTitle('summary'),'本页速览');
});
test('opening a note citation activates its closed source pane and targets the original page',()=>{
 const p=indexLogicFixture(['openNoteReference']);let focused,page;
 Object.assign(p,{course,groups:timeline.groupPages([slide('a',0),slide('b',60)],[]),noteReferenceSequence:0,aiOpen:false,summaryOpen:false});p.resize=()=>{};p.focusPane=id=>focused=id;p.chooseSlide=s=>page=s.id;
 p.openNoteReference({kind:'question',courseId:course.subId,sessionId:'chat-1',turn:1,at:20});assert.equal(p.aiOpen,true);assert.equal(focused,'ai');
 p.openNoteReference({kind:'summary',courseId:course.subId,pageId:'b',scope:'whole',at:60});assert.equal(p.summaryOpen,true);assert.equal(p.selected,1);assert.equal(focused,'summary');assert.equal(p.noteReferenceSequence,2);
});
test('cross-course citations tolerate common formatting without turning unknown lessons into current-lesson links',()=>{
 const {courseAnswerParts}=load('model/CourseReference'),{lessonLabel}=load('model/CourseContext');const prior={...course,subId:'prior',start:course.start-86400,end:course.end-86400},label=lessonLabel(prior),context={lessons:[{course:prior,slides:[],lines:[]}],gaps:[]};
 for(const value of ['【'+label+' · 01:20】',label+'课次：01:20','**'+label+' · [01:20]**',label+' 的 01:20']){const parts=courseAnswerParts(value,context),link=parts.find(p=>p.course);assert.ok(link,value);assert.equal(link.course.subId,'prior');assert.equal(link.seconds,80);}
 assert.equal(courseAnswerParts('2026-01-01 08:00 · 01:20',context).some(p=>p.seconds>=0),false);assert.equal(courseAnswerParts(label+' · 01:80',context).some(p=>p.course),false);assert.equal(courseAnswerParts(label+' · 999:20',context).some(p=>p.course),false);
});
test('restoring encrypted identity permits offline use without cookies or a network login request',async()=>{
 const source=fs.readFileSync(path.join(root,'pages/Index.ets'),'utf8').split('\n').find(l=>l.includes('private async restoreAccount()')),exports={};let resumes=0,initialized=0;
 const output=ts.transpileModule('export class RestoreFixture {\n'+source+'\n}',{compilerOptions:{target:ts.ScriptTarget.ES2021,module:ts.ModuleKind.CommonJS}}).outputText;
 vm.runInNewContext(output,{exports,SessionStore:{restore:async()=>{},savedAccount:async()=>({id:'fixture',name:'Fixture',tenantId:112})}});
 const p=new exports.RestoreFixture();p.generation=1;p.privacyAccepted=true;p.initializeStore=()=>initialized++;p.resume=()=>resumes++;await p.restoreAccount();assert.equal(p.account.id,'fixture');assert.equal(p.screen,'home');assert.equal(initialized,1);assert.equal(resumes,1);
 p.privacyAccepted=false;p.account=undefined;await p.restoreAccount();assert.equal(p.account,undefined);assert.equal(initialized,1);
});

test('mouse selection has a movement threshold and supports backwards and multiline drag without selecting timestamps',()=>{
 const {MouseTextRange}=load('model/MouseTextRange'),range=new MouseTextRange();range.begin(20,100,100);assert.equal(range.move(21,102,102),undefined);assert.deepEqual({...range.move(3,60,60)},{start:3,end:20});assert.deepEqual({...range.end()},{start:3,end:20});assert.equal(range.move(80,200,200),undefined);range.begin(10,100,100);assert.deepEqual({...range.move(100,120,140)},{start:10,end:100});range.cancel();assert.equal(range.end(),undefined);
});
test('streaming answer text freezes while selected and preserves paragraphs with its originating conversation',()=>{
 const p=componentFixture('AnswerText');p.parts=[{value:'first\nsecond',seconds:-1}];p.partsChanged();p.selection(0,5);p.parts=[{value:'first\nsecond\nnew',seconds:-1}];p.partsChanged();assert.equal(p.text(),'first\nsecond');p.reference={kind:'question',courseId:course.subId,sessionId:'chat-1',turn:3,at:20};let insertion;p.onInsert=v=>insertion=v;p.insert(0,12);assert.equal(insertion.value,'first\nsecond');assert.equal(insertion.reference.sessionId,'chat-1');assert.equal(insertion.reference.turn,3);assert.equal(p.text(),'first\nsecond\nnew');assert.equal(p.selectedEnd,0);
});
test('exported question and page-summary note references retain their source labels and timestamps',()=>{
 const {NotesStore}=load('services/NotesStore'),repository=new NotesStore({});const note={course,title:'Fixture',atoms:['question','summary'].map((kind,i)=>({kind,value:'reference '+i,at:60+i,end:60+i})),anchors:[]};
 for(const rendered of [repository.textFile(note),repository.html(note),repository.markdown(note,'/fixture','fixture')]){assert.match(rendered,/课程问答/);assert.match(rendered,/本页速览/);assert.match(rendered,/01:00/);assert.match(rendered,/01:01/);}
});
test('network failures in a logged-in account do not clear its identity or cached course library',async()=>{
 const source=fs.readFileSync(path.join(root,'pages/Index.ets'),'utf8'),start=source.indexOf('  private async tick()'),end=source.indexOf('\n  }',start)+4,exports={};
 const output=ts.transpileModule('export class TickFixture {\n'+source.slice(start,end)+'\n}',{compilerOptions:{target:ts.ScriptTarget.ES2021,module:ts.ModuleKind.CommonJS}}).outputText;vm.runInNewContext(output,{exports,AccessDenied,Date,Math,Promise});
 const p=new exports.TickFixture(),identity={id:'fixture-user'};Object.assign(p,{account:identity,foreground:true,generation:1,screen:'home',catalogAt:0,failureCount:0,courses:[course],api:{courses:async()=>{throw Error('network unavailable')}}});let delay;p.schedule=v=>delay=v;await p.tick();assert.equal(p.account,identity);assert.equal(p.courses[0].subId,course.subId);assert.equal(p.screen,'home');assert.ok(delay>0);
});


test('text-only lessons persist sentence bookmarks and restore them without opening unavailable video',async()=>{
 const p=indexLogicFixture(['saveProgress','learningTime','restoreProgress']);let saved,restored;
 Object.assign(p,{progressReady:true,store:{saveJson:(name,value)=>saved=JSON.parse(value)},course,screen:'lesson',demo:false,showVideo:false,groups:[],lines:[{id:'a',t:0,text:'fixture'},{id:'b',t:120,text:'second'}],selected:0,textStudyTime:137,info:{sub_status:6},generation:1,preferredVideo:false});
 p.saveProgress(true);assert.equal(saved.seconds,137);assert.equal(saved.slideId,'');p.progressReady=false;p.pendingProgress=saved;p.prepareImages=()=>{};p.rewind=at=>restored=at;await p.restoreProgress();assert.equal(restored,137);assert.equal(p.textStudyTime,137);
});
test('touch cancellation without movement does not swallow subsequent slide double taps',()=>{
 const p=componentFixture('PageCard');const globals={TouchType:{Down:0,Up:1,Move:2,Cancel:3}};const source=fs.readFileSync(path.join(root,'components/PageCard.ets'),'utf8');const first=source.indexOf('  private pictureTouch('),end=source.indexOf('\n  }',first)+4;const code=ts.transpileModule('export class TouchFixture {\n'+source.slice(first,end)+'\n}',{compilerOptions:{target:ts.ScriptTarget.ES2021,module:ts.ModuleKind.CommonJS}}).outputText,exports={};vm.runInNewContext(code,{exports,...globals,Date,Math});p.pictureTouch=exports.TouchFixture.prototype.pictureTouch;
 p.moved=false;p.suppressedUntil=0;p.pictureTouch({type:3,touches:[],changedTouches:[]});assert.equal(p.suppressedUntil,0);p.pictureTouch({type:0,touches:[{windowX:10,windowY:10}],changedTouches:[]});p.pictureTouch({type:2,touches:[{windowX:30,windowY:10}],changedTouches:[]});p.pictureTouch({type:3,touches:[],changedTouches:[]});assert.ok(p.suppressedUntil>Date.now());
});

test('large continuous transcripts coalesce adjacent equal highlighting instead of creating thousands of text spans',()=>{
 const {transcriptRuns}=load('model/TranscriptRender'),offsets=Array.from({length:10000},(_,i)=>i*2),value='a\n'.repeat(10000),runs=transcriptRuns(value,offsets,-1,offsets.map((_,i)=>i));assert.equal(runs.length,1);assert.equal(runs[0].value,value);assert.equal(runs[0].highlight,true);const spoken=transcriptRuns(value,offsets,5000,offsets.map((_,i)=>i));assert.equal(spoken.length,3);assert.equal(spoken.map(r=>r.value).join(''),value);
});
test('continuous playback lookup handles large timelines, equal timestamps and silent gaps',()=>{
 const {spokenLineIndex}=load('model/TranscriptPlayback'),lines=Array.from({length:10000},(_,i)=>({id:String(i),t:i*10,end:i*10+5,text:'fixture'}));assert.equal(spokenLineIndex(lines,90001),9000);assert.equal(spokenLineIndex(lines,90007),-1);assert.equal(spokenLineIndex(lines,99995),-1);assert.equal(spokenLineIndex([{t:0,end:2},{t:0,end:3}],1),1);assert.equal(spokenLineIndex([],0),-1);
});
test('explicit logout from nested pages clears identity and navigation and hides offline entries immediately',async()=>{
 const source=fs.readFileSync(path.join(root,'pages/Index.ets'),'utf8'),start=source.indexOf('  private async logout('),end=source.indexOf('\n  }',start)+4,exports={};let cleared=0,cookies=0,paused=0;
 const code=ts.transpileModule('export class LogoutFixture {\n'+source.slice(start,end)+'\n}',{compilerOptions:{target:ts.ScriptTarget.ES2021,module:ts.ModuleKind.CommonJS}}).outputText;vm.runInNewContext(code,{exports,SessionStore:{clear:async()=>cleared++},webview:{WebCookieManager:{clearAllCookiesSync:()=>cookies++}},clearTimeout});
 const p=new exports.LogoutFixture();Object.assign(p,{account:{id:'fixture'},course,screen:'lesson',plaza:true,allCoursesOpen:true,collectionPage:'later',notesLibrary:true,cacheSettings:true,downloadsOpen:true,lessonDownloadOpen:true,offlineViewing:true,offlineOpen:true,offlineEntries:[{course}],downloadJobs:[{}],courseReturnStack:[{}],authOfficial:true,authPassword:'temporary-fixture',library:{pause:()=>paused++},api:{usePermissionStorage:()=>{}},collections:{bind:()=>{}},closeMedia:()=>{},stop:()=>{}});await p.logout();assert.equal(cleared,1);assert.equal(cookies,1);assert.equal(paused,1);assert.equal(p.screen,'home');assert.equal(p.account,undefined);assert.equal(p.store,undefined);assert.equal(p.course,undefined);assert.equal(p.offlineEntries.length,0);for(const flag of ['plaza','allCoursesOpen','notesLibrary','cacheSettings','downloadsOpen','lessonDownloadOpen','offlineOpen','authOfficial'])assert.equal(p[flag],false,flag);assert.equal(p.courseReturnStack.length,0);assert.equal(p.authPassword,'');
});


test('modal selection dismissal clears every mounted editor and never calls disposed editors',()=>{
 const {NativeSelections}=load('model/NativeSelections');let text=0,editor=0;NativeSelections.bind('text',()=>text++);NativeSelections.bind('broken',()=>{throw Error('disposed native controller')});NativeSelections.bind('editor',()=>editor++);NativeSelections.clear();assert.equal(text,1);assert.equal(editor,1);NativeSelections.unbind('text');NativeSelections.unbind('editor');NativeSelections.clear();assert.equal(text,1);assert.equal(editor,1);NativeSelections.unbind('broken');
});


test('transcription matches slides whenever slides or summary are visible; otherwise it is continuous',()=>{
 const p=indexLogicFixture(['continuousTranscript','displayedTranscript']);p.slides=[slide('a',0),slide('b',60)];p.lines=[{id:'one',t:10,text:'one'},{id:'two',t:70,text:'two'}];p.groups=timeline.groupPages(p.slides,p.lines);p.selected=0;p.capacity=1;p.visibleGroups=()=>[p.groups[0]];p.manualBrowsing=()=>false;
 p.slidesEnabled=p.summaryOpen=false;assert.equal(p.continuousTranscript(),true);assert.equal(p.displayedTranscript().length,2);
 for(const pair of [[false,true],[true,false],[true,true]]){[p.slidesEnabled,p.summaryOpen]=pair;assert.equal(p.continuousTranscript(),false);assert.equal(p.displayedTranscript().length,1);}p.slides=[];assert.equal(p.continuousTranscript(),true);assert.equal(p.displayedTranscript().length,2);
});
test('touchpad press-drag is pointer selection, finger swipes remain touch gestures',()=>{
 const globals={SourceType:{Touch:1,Mouse:2},SourceTool:{Finger:1,MOUSE:3,TOUCHPAD:4}}, {pointerSelection}=load('model/PointerInput',{},globals);
 assert.equal(pointerSelection(1,4),true);assert.equal(pointerSelection(2,3),true);assert.equal(pointerSelection(1,1),false);
});
test('video arrows seek fifteen seconds only when video was the last pane activated',()=>{
 const p=indexLogicFixture(['keyboard']);Object.assign(p,{screen:'lesson',activePane:'video',showVideo:true,videoTime:60,videoEnd:100});const seek=[],turn=[];p.playback={seek:t=>seek.push(t)};p.turnPages=t=>turn.push(t);
 const event={type:0,keyCode:2015,keyText:'',getModifierKeyState:()=>false};assert.equal(p.keyboard(event),true);assert.deepEqual(seek,[75]);p.keyboard({...event,keyCode:2014});assert.deepEqual(seek,[75,45]);p.videoTime=98;p.keyboard(event);assert.equal(seek.at(-1),100);
 p.activePane='slides';p.keyboard(event);assert.deepEqual(turn,[1]);p.activePane='notes';assert.equal(p.keyboard(event),false);assert.equal(turn.length,1);
});
test('multi-time cross-lesson citations link every clock to its own lesson, preserving answer text',()=>{
 const {courseAnswerParts}=load('model/CourseReference'),{lessonLabel}=load('model/CourseContext'),prior={...course,subId:'prior',start:course.start-86400,end:course.end-86400},context={lessons:[{course:prior,slides:[],lines:[]}],gaps:[]},label=lessonLabel(prior);
 for(const body of ['【'+label+'课次 · 01:20、12:30、20:40】',label+' · [01:20]、[12:30]、[20:40]','【'+label+'课次 · 01:20—12:30】']){
  const parts=courseAnswerParts(body,context),clocks=parts.filter(p=>p.seconds>=0);assert.equal(clocks.length,body.includes('20:40')?3:2);assert.equal(parts.map(p=>p.value).join(''),body);assert.equal(clocks.every(p=>p.course?.subId==='prior'),true);assert.deepEqual(Array.from(clocks,p=>p.seconds),body.includes('20:40')?[80,750,1240]:[80,750]);
 }
 const invalid=courseAnswerParts('【'+label+' · 01:20、999:30】',context);assert.equal(invalid.filter(p=>p.seconds>=0).length,1);assert.equal(invalid.filter(p=>p.seconds>=0)[0].course.subId,'prior');
});
test('month grid keys never overlap across swipe transitions',()=>{
 const {calendarMonthGrid}=load('model/CourseSections'),before=calendarMonthGrid('2026-10',[]),after=calendarMonthGrid('2026-11',[]),keys=new Set(before.map(c=>c.key));assert.equal(before.length,42);assert.equal(new Set(before.map(c=>c.key)).size,42);assert.equal(after.some(c=>keys.has(c.key)),false);assert.equal(after.filter(c=>c.inMonth).length,30);
});
test('summary restores original scope, page result, prior lesson context and scroll without resetting to page scope',async()=>{
 const p=componentFixture('PageSummary');p.courseId='sample';p.cancel=()=>p.epoch++;p.epoch=0;let offset;p.scroller={scrollTo:v=>offset=v.yOffset};p.restoredView={courseId:'other',scope:'courseAll'};p.restoreView();assert.equal(p.scope,'page');
 const results={a:{answer:'fixture',signature:'cached',savedAt:1,completed:true}},prior={lessons:[],gaps:[]};p.restoredView={courseId:'sample',pageId:'a',scope:'courseAll',allPages:true,scroll:147,results,prior,priorNotice:'ready',priorRevision:'1:2'};p.restoreView();assert.equal(p.scope,'courseAll');assert.equal(p.allPages,true);assert.equal(p.results,results);assert.equal(p.prior,prior);await new Promise(r=>setTimeout(r,100));assert.equal(offset,147);const epoch=p.epoch;p.restoreView();assert.equal(p.epoch,epoch);
});
function controlledDownloadQueue(){
 const {lib,files}=offlineFixture(),workers=[],finish=new Map();lib.store.forkForDownload=()=>({...lib.store,cancel(){},releaseDownloadTemporary(){}});const create=lib.createWorker.bind(lib);
 lib.createWorker=()=>{const worker=create();workers.push(worker);worker.download=job=>new Promise((resolve,reject)=>{finish.set(job.course.subId,resolve);worker.abortStreams.add(()=>reject(Error('paused')))});return worker};return{lib,files,workers,finish};
}
test('parallel course downloads preserve isolated cancellation and fill a slot when one course pauses',async()=>{
 const {lib,workers,finish}=controlledDownloadQueue();lib.setConcurrency(2);lib.enqueue(['a','b','c'].map(id=>({...course,subId:id})),{video:true,slides:true,transcript:true});assert.deepEqual(Array.from(lib.tasks(),j=>j.state),['running','running','queued']);assert.notEqual(workers[0].api,workers[1].api);assert.notEqual(workers[0].store,workers[1].store);
 lib.pauseJob('a');await new Promise(setImmediate);assert.deepEqual(Array.from(lib.tasks(),j=>j.state),['paused','running','running']);assert.equal(workers[1].canceled,false);finish.get('b')();finish.get('c')();await new Promise(setImmediate);assert.equal(lib.tasks().find(j=>j.course.subId==='a').state,'paused');assert.equal(lib.running,false);lib.resumeJob('a');assert.equal(lib.tasks()[0].state,'running');finish.get('a')();await new Promise(setImmediate);assert.equal(lib.tasks()[0].state,'done');
});
test('queued downloads follow user order and lowering concurrency waits for existing transfers',async()=>{
 const {lib,finish}=controlledDownloadQueue();lib.setConcurrency(2);lib.enqueue(['a','b','c','d'].map(id=>({...course,subId:id})),{video:true,slides:false,transcript:false});lib.moveJob('d',-1);assert.deepEqual(Array.from(lib.tasks(),j=>j.course.subId),['a','b','d','c']);lib.setConcurrency(1);finish.get('a')();await new Promise(setImmediate);assert.equal(lib.tasks().find(j=>j.course.subId==='d').state,'queued');finish.get('b')();await new Promise(setImmediate);assert.equal(lib.tasks().find(j=>j.course.subId==='d').state,'running');finish.get('d')();await new Promise(setImmediate);assert.equal(lib.tasks().find(j=>j.course.subId==='c').state,'running');finish.get('c')();await new Promise(setImmediate);assert.equal(lib.running,false);
});
test('removing a queued course during parallel downloads cannot resurrect removed resources',async()=>{
 const {lib,finish}=controlledDownloadQueue();lib.setConcurrency(2);lib.enqueue(['a','b','c'].map(id=>({...course,subId:id})),{video:true,slides:false,transcript:false});await lib.removeMany(['a']);assert.deepEqual(Array.from(lib.tasks(),j=>j.course.subId),['b','c']);assert.equal(lib.tasks().every(j=>j.state==='running'),true);finish.get('b')();finish.get('c')();await new Promise(setImmediate);assert.equal(lib.running,false);assert.equal(lib.tasks().some(j=>j.course.subId==='a'),false);
});

test('two-finger axis swipe turns only once per gesture and vertical scrolling never turns pages',()=>{
 const {AxisPaging}=load('model/AxisPaging'),axis=new AxisPaging();assert.equal(axis.move(0,10,1,1000),0);assert.equal(axis.move(2,50,2,1010),0);assert.equal(axis.move(0,0,3,1020),0);
 assert.equal(axis.move(15,0,1,1100),0);assert.equal(axis.move(20,0,2,1110),-1);assert.equal(axis.move(100,0,2,1120),0);assert.equal(axis.move(0,0,3,1130),0);assert.equal(axis.move(-35,0,1,1140),1);assert.equal(axis.move(0,0,4,1150),0);
});
test('question reference navigation cannot cancel independent API configuration initialization',async()=>{
 let release;class AiClient {static savedKey(){return new Promise(r=>release=r)}cancel(){}async models(){return ['fixture-model']}}
 const p=componentFixture('AiPanel',{'../services/AiClient':{AiClient}});
 p.ai={models:async()=>['fixture-model']};p.store={readJson:()=>''};p.configurationEpoch=0;const first=p.initialize();p.epoch++;release('fixture-key');await first;assert.equal(p.configured,true);assert.equal(p.model,'fixture-model');
});
test('reference time equal to lesson opening clock still links the relative timestamp, never the date heading',()=>{
 const {courseAnswerParts}=load('model/CourseReference'),prior={...course,subId:'prior',start:course.start-86400,end:course.end-86400},context={lessons:[{course:prior,slides:[],lines:[]}]};const body='【2026-10-08 08:00课次 · 08:00】',parts=courseAnswerParts(body,context);assert.equal(parts.map(p=>p.value).join(''),body);assert.equal(parts.filter(p=>p.seconds>=0).length,1);assert.equal(parts.filter(p=>p.seconds>=0)[0].seconds,480);
});

test('answer selection survives native blur long enough to insert its source reference, explicit dismissal is immediate',async()=>{
 const p=componentFixture('AnswerText');p.shownParts=[{value:'fixture answer',seconds:-1}];p.reference={kind:'question',courseId:'sample',sessionId:'chat',turn:0,at:80};p.selectedStart=0;p.selectedEnd=7;p.pointerHeld=false;let inserted;p.onInsert=value=>inserted=value;p.selection(0,0);assert.equal(p.selectedEnd,7);p.insert(p.selectedStart,p.selectedEnd);assert.equal(inserted.value,'fixture');assert.equal(inserted.reference.sessionId,'chat');assert.equal(p.selectedEnd,0);await new Promise(r=>setTimeout(r,200));assert.equal(p.selectedEnd,0);
 p.selectedEnd=7;p.dismissSelection();assert.equal(p.selectedEnd,0);clearTimeout(p.selectionDismissTimer);
});
test('transcript selection preserves insertion range across native blur and explicit modal dismissal clears streaming hold',()=>{
 const {text:p}=transcriptFixture();p.selectionStart=2;p.selectionEnd=9;p.pointerHeld=false;p.select(0,0);assert.equal(p.selectionStart,2);assert.equal(p.selectionEnd,9);p.dismissSelection();assert.equal(p.selectionEnd,0);assert.equal(p.selectionVisible,false);clearTimeout(p.releaseTimer);clearTimeout(p.selectionDismissTimer);
});

test('isolated download stores share cache revision but preserve independent temporary folders and remove abandoned session folders',()=>{
 const directory=fs.mkdtempSync('/tmp/zhiyun-worker-test-');try{
 const {LocalStore,key}=load('services/LocalStore',nativeDisk(directory)),context={filesDir:directory,cacheDir:directory},store=new LocalStore(context,'fixture'),worker=store.forkForDownload();assert.equal(worker.cache,store.cache);assert.notEqual(worker.sessionFolder,store.sessionFolder);store.cache.setEnabled('slides',false);assert.equal(worker.cache.enabled('slides'),false);fs.writeFileSync(worker.sessionFolder+'/asset.png','test');
 const orphan=directory+'/temporary-slides-'+key('fixture')+'-worker-orphan';fs.mkdirSync(orphan);fs.writeFileSync(orphan+'/asset.png','orphan');new LocalStore(context,'fixture');assert.equal(fs.existsSync(orphan),false);assert.equal(fs.existsSync(worker.sessionFolder+'/asset.png'),true);worker.releaseDownloadTemporary();assert.equal(fs.existsSync(worker.sessionFolder),false);
 }finally{fs.rmSync(directory,{recursive:true,force:true})}
});

test('unmounting an old summary cannot remove the next lesson snapshot reader',()=>{
 const {SummaryViewController}=load('model/SummaryView'),controller=new SummaryViewController(),old=()=>({courseId:'old'}),next=()=>({courseId:'new'});controller.bind(old);controller.bind(next);controller.unbind(old);assert.equal(controller.capture().courseId,'new');controller.unbind(next);assert.equal(controller.capture(),undefined);
});
test('summary view capture is safe before a native scroll layout exists',()=>{
 const p=componentFixture('PageSummary');p.scroller={currentOffset(){throw Error('not laid out')}};p.courseId='fixture';p.scope='course';const captured=p.captureView();assert.equal(captured.scroll,0);assert.equal(captured.scope,'course');
});

test('summary cache preserves completed answers, immutable note versions and per-version reading positions across restart and course changes',()=>{
 const directory=fs.mkdtempSync('/tmp/zhiyun-summary-test-');try{
 const stubs=nativeDisk(directory),{LocalStore}=load('services/LocalStore',stubs),{SummaryCache}=load('services/SummaryCache',stubs),store=new LocalStore({filesDir:directory,cacheDir:directory},'fixture');store.useCourse(course);const cache=new SummaryCache(store,course),old={answer:'original answer [01:20]',signature:'first',savedAt:10,completed:true,references:[{...course,subId:'prior',start:course.start-86400,end:course.end-86400}]};
 const first=cache.save('course','a',old,{},0);cache.savePosition('course','a',first.id,213);store.useCourse({...course,subId:'other'});const next=cache.save('course','a',{answer:'explicit regeneration',signature:'updated',savedAt:20,completed:true},{a:first},0);cache.savePosition('course','a',next.id,47);store.cache.flush();
 const reopened=new LocalStore({filesDir:directory,cacheDir:directory},'fixture'),reader=new SummaryCache(reopened,course);assert.equal(reader.lastScope(),'course');assert.equal(reader.latest('course').a.answer,'explicit regeneration');assert.equal(reader.record('course','a',first.id).answer,old.answer);assert.equal(reader.record('course','a',first.id).references[0].subId,'prior');assert.equal(reader.position('course','a',first.id),213);assert.equal(reader.position('course','a',next.id),47);assert.equal(reader.record('page','a',first.id),undefined);assert.equal(new SummaryCache(reopened,{...course,subId:'other'}).latest('course').a,undefined);reopened.cache.flush();
 }finally{fs.rmSync(directory,{recursive:true,force:true})}
});
test('clearing summary caches removes original versions and reading positions and stale writes cannot restore them',()=>{
 const directory=fs.mkdtempSync('/tmp/zhiyun-summary-clear-');try{
 const stubs=nativeDisk(directory),{LocalStore}=load('services/LocalStore',stubs),{SummaryCache}=load('services/SummaryCache',stubs),store=new LocalStore({filesDir:directory,cacheDir:directory},'fixture'),cache=new SummaryCache(store,course),record=cache.save('page','a',{answer:'fixture',signature:'a',savedAt:1,completed:true},{},0);cache.savePosition('page','a',record.id,80);store.cache.clear('summary');cache.archive('page','a',record);cache.savePosition('page','a',record.id,40);assert.equal(cache.record('page','a',record.id),undefined);assert.equal(cache.position('page','a',record.id),0);assert.deepEqual(Object.keys(cache.latest('page')),[]);store.cache.flush();
 }finally{fs.rmSync(directory,{recursive:true,force:true})}
});
test('summary cache-off respects session-only data instead of recreating saved copies',()=>{
 const directory=fs.mkdtempSync('/tmp/zhiyun-summary-off-');try{
 const stubs=nativeDisk(directory),{LocalStore}=load('services/LocalStore',stubs),{SummaryCache}=load('services/SummaryCache',stubs),store=new LocalStore({filesDir:directory,cacheDir:directory},'fixture');store.cache.setEnabled('summary',false);const cache=new SummaryCache(store,course),record=cache.save('page','a',{answer:'session',signature:'a',savedAt:1,completed:true},{},store.cache.revision('summary'));assert.equal(cache.record('page','a',record.id).answer,'session');store.cache.clearTransient();assert.equal(cache.record('page','a',record.id),undefined);store.cache.flush();
 }finally{fs.rmSync(directory,{recursive:true,force:true})}
});
test('returning to a completed cross-course summary neither reloads curriculum nor sends a new AI request',async()=>{
 const {page,calls}=summaryFixture();page.live=false;page.slides=[slide('a',0)];page.currentId='a';page.scope='courseAll';page.results.a={answer:'cached',signature:'older image version',savedAt:1,completed:true,references:[course]};page.prior=undefined;page.store.activeCourse=course;let materialCalls=0;page.contextLoader={cancel(){},load:async()=>{materialCalls++;throw Error('must not reload')}};await page.next();assert.equal(materialCalls,0);assert.equal(calls.length,0);assert.equal(page.answer(),'cached');assert.equal(page.answerContext().lessons[0].course.subId,course.subId);page.cancel();
});
test('summary note navigation pins the exact archived answer and original scroll even after a later regeneration',async()=>{
 const p=componentFixture('PageSummary'),original={id:'original',answer:'original',signature:'a',savedAt:1,completed:true};p.courseId='fixture';p.currentId='a';p.scope='page';p.results.a={id:'new',answer:'different',signature:'b',savedAt:2,completed:true};p.readingScope='page';p.readingPage='a';p.readingRecord='new';p.readingOffset=20;p.requestedReference={kind:'summary',courseId:'fixture',pageId:'a',scope:'page',summaryId:'original',at:0};let offset;p.summaryCache={record:()=>original,position:(scope,page,id)=>id==='original'?75:0,savePosition(){}};p.scroller={scrollTo:v=>offset=v.yOffset};p.referenceChanged();assert.equal(p.answer(),'original');await new Promise(r=>setTimeout(r,120));assert.equal(offset,75);p.pageChanged();assert.equal(p.pinnedResult,undefined);clearTimeout(p.referenceTimer);clearTimeout(p.restoreScrollTimer);p.cancel();
});
test('quoted in-progress summary text is archived separately so live completion does not break the note link',()=>{
 const p=componentFixture('PageSummary');p.courseId='fixture';p.currentId='a';p.scope='page';p.readingOffset=55;p.results.a={id:'latest',answer:'finished elsewhere',signature:'a',savedAt:1,completed:true};let stored,inserted;p.summaryCache={archive:(scope,page,record)=>{stored={...record,id:'quoted'};return stored},savePosition(){}};p.onInsert=value=>inserted=value;p.insertSummary({kind:'summary',value:'selected',sourceText:'visible partial answer',at:2,end:2,sourceId:''});assert.equal(stored.answer,'visible partial answer');assert.equal(inserted.reference.summaryId,'quoted');assert.equal(inserted.value,'selected');assert.equal(p.results.a.id,'latest');
});
test('AI Shift+Enter inserts newline at selection, plain Enter sends, Ctrl+Enter no longer inserts newline',async()=>{
 const keys={KEYCODE_SHIFT_LEFT:2047,KEYCODE_SHIFT_RIGHT:2048,KEYCODE_CTRL_LEFT:2072,KEYCODE_CTRL_RIGHT:2073,KEYCODE_ENTER:2054,KEYCODE_NUMPAD_ENTER:2115};
 const p=componentFixture('AiPanel',{'@kit.InputKit':{KeyCode:keys}});p.question='abCD';p.questionController=new TestInputController();p.questionController.value=p.question;p.questionController.setTextSelection(1,3);let sent=0;p.ask=()=>sent++;const event={type:0,keyCode:2054,keyText:'Enter',getModifierKeyState:()=>false};p.questionKey({...event,keyCode:2047,keyText:''});assert.equal(p.questionKey(event),true);assert.equal(p.question,'a\nD');assert.equal(p.questionController.value,p.question);p.questionSubmit();await new Promise(r=>setTimeout(r,5));assert.equal(sent,0);
 p.questionKey({...event,type:1,keyCode:2047,keyText:''});p.questionKey(event);await new Promise(r=>setTimeout(r,5));assert.equal(sent,1);p.questionKey({...event,keyCode:2072,keyText:''});p.questionKey(event);await new Promise(r=>setTimeout(r,5));assert.equal(sent,2);assert.equal(p.question,'a\nD');
 const modifier=componentFixture('AiPanel',{'@kit.InputKit':{KeyCode:keys}});modifier.question='x';modifier.questionController=new TestInputController();modifier.questionController.value='x';modifier.questionController.setTextSelection(1,1);modifier.questionKey({...event,getModifierKeyState:keys=>keys.includes('Shift')});assert.equal(modifier.question,'x\n');
});

test('selection shortcuts work when hardware modifier state is missing and reset on Ctrl release',()=>{
 const {SelectionKeys}=load('model/SelectionKeys');const event={type:0,keyCode:2072,keyText:'',getModifierKeyState:()=>false};SelectionKeys.update(event);
 for(const [code,command] of [[2017,'a'],[2019,'c'],[2038,'v']])assert.equal(SelectionKeys.command({...event,keyCode:code}),command);
 SelectionKeys.update({...event,type:1});assert.equal(SelectionKeys.command({...event,keyCode:2017}),'');assert.equal(SelectionKeys.command({...event,keyCode:2038,getModifierKeyState:()=>true}),'v');SelectionKeys.reset();
});
test('AI selection escalates from one question-answer turn to all turns and input focus clears the scope',()=>{
 const p=componentFixture('AiPanel');p.turns=[{question:'q1',answer:'**a1**',at:15},{question:'q2',answer:'a2',at:30}];
 assert.equal(p.selectTurn(0),true);assert.equal(p.turnSelection,0);assert.equal(p.conversationSelection,0);p.selectTurn(0);assert.equal(p.conversationSelection,1);assert.match(p.conversationText(),/00:15 · q1\na1/);assert.match(p.conversationText(),/00:30 · q2/);
 p.clearTextSelection();assert.equal(p.turnSelection,-1);assert.equal(p.conversationSelection,0);p.selectTurn(1);assert.equal(p.turnSelection,1);assert.equal(p.conversationSelection,0);
});
test('gap selection chooses the whole note while a text block first chooses only that block',()=>{
 const p=componentFixture('NotesPane');p.fromGap=false;assert.equal(p.selectWhole(false),false);assert.equal(p.wholeSelection,0);assert.equal(p.selectWhole(true),true);assert.equal(p.wholeSelection,1);
 p.selectBlock('second');assert.equal(p.wholeSelection,1);p.dismissWhole();assert.equal(p.wholeSelection,0);p.fromGap=true;assert.equal(p.selectWhole(false),true);assert.equal(p.wholeSelection,1);assert.equal(p.fromGap,false);
});
test('requested managed note is consumed once and does not override later note switching or creation',()=>{
 const p=componentFixture('NotesPane'),calls=[];p.ready=true;p.requestedNoteId='selected';p.switchNote=id=>calls.push(id);p.requestedNoteChanged();p.requestedNoteChanged();assert.deepEqual(calls,['selected']);
 p.requestedNoteId='another';p.requestedNoteChanged();assert.deepEqual(calls,['selected','another']);assert.equal(p.managerOpen,false);
});
test('managed note entry sets paused-video policy before asynchronous course loading begins',async()=>{
 const p=indexLogicFixture(['openManagedNote']);p.library={entry:()=>undefined};p.resize=()=>{};p.focusPane=id=>p.activePane=id;
 p.enter=async(c,reference,id)=>{assert.equal(id,'chosen');p.course=c;p.entryPaused=!!id;p.requestedNoteId=id};await p.openManagedNote({course,id:'chosen'});assert.equal(p.notesOpen,true);assert.equal(p.entryPaused,true);assert.equal(p.requestedNoteId,'chosen');assert.equal(p.activePane,'notes');
 const saved={course};p.library={entry:()=>saved};p.openOffline=(entry,reference,id)=>{assert.equal(entry,saved);assert.equal(id,'chosen');p.course=entry.course;p.entryPaused=!!id};await p.openManagedNote({course,id:'chosen'});assert.equal(p.entryPaused,true);
});
test('opening notes leaves recorded and live videos paused until the user explicitly plays',()=>{
 for(const live of [false,true]){const p=playerFixture();p.Player.load({url:'https://cmc.zju.edu.cn/video.m3u8',at:12,live,liveCourse:live,replay:false,autoplay:false});p.eventHandlers.loadedmetadata();assert.equal(p.video.paused,true);p.Player.toggle();assert.equal(p.video.paused,false);}
});
test('offline progress changes only affected lazy rows regardless of course grouping order',()=>{
 const {offlineRows,OfflineRows}=load('model/OfflineRows');const old={...course,courseId:'old',start:course.start-86400},jobs=[{id:'a',course:old,state:'running',progress:.1},{id:'b',course,state:'running',progress:.2}];
 const source=new OfflineRows(),changes=[];let reloads=0;source.registerDataChangeListener({onDataReloaded:()=>reloads++,onDataChanged:i=>changes.push(i)});source.update(offlineRows([],jobs,true));assert.equal(reloads,1);
 assert.equal(source.updateJobs(jobs.map(j=>({...j,progress:j.id==='a'?.9:j.progress}))),true);assert.equal(changes.length,1);assert.equal(source.getData(changes[0]).job.id,'a');assert.equal(reloads,1);
 assert.equal(source.updateJobs(jobs.filter(j=>j.id!=='a')),false);
});
test('large offline library updates one download without rebuilding thousands of saved rows',()=>{
 const {offlineRows,OfflineRows}=load('model/OfflineRows'),entries=Array.from({length:2500},(_,i)=>({course:{...course,subId:'saved-'+i,start:course.start-i*60},savedAt:i})),job={id:'active',course:{...course,subId:'active'},state:'running',progress:0},source=new OfflineRows();
 source.update(offlineRows(entries,[job],true));const saved=source.getData(2),changed=[];source.registerDataChangeListener({onDataReloaded:()=>assert.fail('progress must not reload list'),onDataChanged:i=>changed.push(i)});
 assert.equal(source.updateJobs([{...job,progress:.9}]),true);assert.equal(changed.length,1);assert.equal(source.getData(2),saved);assert.equal(source.totalCount(),2502);
});
test('AI precision filter rejects unknown evidence, useful short answers, discontinuous ids, live unfinished pages and missing history',()=>{
 const {conservativeRanges}=load('model/SmartSkip'),group={slide:slide('a',0),lines:[{id:'first',t:0,end:4,text:'嗯啊'},{id:'useful',t:5,end:8,text:'是'},{id:'last',t:9,end:15,text:'嗯'}]},noise={spans:[{ids:['first'],kind:'noise',confidence:1}],emptyPage:false,confidence:1,visual:'blank'};
 assert.equal(conservativeRanges(group,20,noise,false,false).length,0);assert.equal(conservativeRanges(group,20,noise,true,true).length,0);assert.equal(conservativeRanges(group,20,noise,true,false).length,1);
 for(const ids of [['useful'],['missing'],['first','last']])assert.equal(conservativeRanges(group,20,{...noise,spans:[{...noise.spans[0],ids}]},true,false).length,0);
 assert.equal(conservativeRanges(group,20,{...noise,emptyPage:true},true,false)[0].end,5,'meaningful short answer prevents skipping the entire page');
 assert.equal(conservativeRanges({slide:group.slide,lines:[]},20,{...noise,spans:[],emptyPage:true,visual:'slide'},true,false).length,0,'a black slide is not an empty page');
});
test('AI filtered pages retain raw transcription and exact-empty differs from sparse filtering',()=>{
 const {filteredTranscript,automaticSkip}=load('model/SmartSkip');const lines=[{id:'noise',t:0,text:'嗯啊'},{id:'lesson',t:8,text:'定义'}],ranges=[{start:0,end:8,ids:['noise'],pageId:'a'}];assert.deepEqual(Array.from(filteredTranscript(lines,ranges),l=>l.id),['lesson']);assert.equal(lines.length,2);assert.equal(automaticSkip(1,20,ranges),ranges[0]);assert.equal(automaticSkip(9,20,ranges),undefined);assert.equal(automaticSkip(1,5,ranges),undefined);
 const groups=[{slide:slide('a',0),lines:[],skipContent:true},{slide:slide('b',8),lines:[],skipContent:false}];assert.equal(timeline.pageHasContent(groups[0]),true);assert.equal(timeline.pageHasContent(groups[1]),false);
});
test('live AI filter never classifies pre-entry pages as empty when historical transcription was not supplied',()=>{
 const {SmartSkipService}=load('services/SmartSkipService'),service=new SmartSkipService();service.next=()=>{};const store={cache:{revision:()=>0,read:()=>''},imageVersion:()=>''};const groups=[{slide:slide('earlier',0),lines:[]},{slide:slide('joined',100),lines:[{id:'r',t:110,text:'新收到',timing:'source'}]},{slide:slide('latest',200),lines:[]}];
 service.update(store,course,groups,300,true,false,0,()=>{});assert.equal(service.jobs.length,0,'page that spans an unobserved prefix is also preserved');groups[1].slide.t=110;service.update(store,course,groups,300,true,false,0,()=>{});assert.deepEqual(Array.from(service.jobs,j=>j.group.slide.id),['joined']);service.cancel();
});
test('DeepSeek usage reports actual cache tokens, safely clamps invalid usage and parses streaming usage',()=>{
 const {addUsage}=load('model/AiUsage'),zero={requests:0,prompt:0,output:0,hit:0,miss:0};const totals=addUsage(zero,{prompt_tokens:100,completion_tokens:12,prompt_cache_hit_tokens:80});assert.equal(totals.hit,80);assert.equal(totals.miss,20);assert.equal(addUsage(zero,{prompt_tokens:100,prompt_cache_hit_tokens:Infinity}).hit,0);
 const {AiStream}=load('model/AiStream'),stream=new AiStream();stream.push('data: {"choices":[{"delta":{"content":"answer"}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":100,"prompt_cache_hit_tokens":80}}\n\ndata: [DONE]\n',()=>{});assert.equal(stream.usage.prompt_cache_hit_tokens,80);assert.equal(stream.done,true);
 const {AiClient}=load('services/AiClient');assert.equal(AiClient.usage({readJson:()=>'{"requests":1}'}).requests,0);
});
test('changing AI questions and time keeps fixed evidence before variable conditions without exposing later sentences',async()=>{
 const {AiClient}=load('services/AiClient');AiClient.savedKey=async()=> 'fixture';const ai=new AiClient(),bodies=[];ai.stream=async(k,b)=>{bodies.push(b);return{answer:'ok',calls:[]}};
 const store={cache:{revision:()=>0},readJson:()=>''},pages=[slide('a',0),slide('b',100)],lines=[{id:'early',t:5,text:'固定材料'},{id:'future',t:200,text:'禁止提前曝光'}];
 for(const [at,q] of [[30,'first'],[60,'second']])await ai.ask(store,pages,lines,q,at,false,'fixture',[],()=>{},'never','a');
 assert.deepEqual(JSON.parse(JSON.stringify(bodies[0].messages.slice(0,2))),JSON.parse(JSON.stringify(bodies[1].messages.slice(0,2))));assert.notEqual(bodies[0].messages[2].content,bodies[1].messages[2].content);assert.equal(JSON.stringify(bodies).includes('禁止提前曝光'),false);
});
test('vision requests are shared across AI features and concurrent consumers then invalidated by image updates',async()=>{
 const {AiClient}=load('services/AiClient'),ai=new AiClient(),values=new Map();let reads=0,version='v1';const store={dataFolder:'fixture',activeCourse:course,imageVersion:()=>version,cache:{revision:()=>0,read:(kind,c,n)=>values.get(kind+':'+n)||'',save:(kind,c,n,v)=>values.set(kind+':'+n,v)}};
 ai.readSlideUncached=async()=>{reads++;await new Promise(r=>setTimeout(r,5));return{text:'识别',version}};await Promise.all([ai.readSlide(slide('a',0),store,'fixture'),ai.readSlide(slide('a',0),store,'fixture')]);assert.equal(reads,1);await ai.readSlide(slide('a',0),store,'fixture');assert.equal(reads,1);version='v2';await ai.readSlide(slide('a',0),store,'fixture');assert.equal(reads,2);
});
test('cache inventory includes orphan files, legacy and other-account resources, runtime and temp folders while protecting user data',()=>{
 const directory=fs.mkdtempSync('/tmp/zhiyun-full-cache-');try{
 const files=directory+'/files',runtime=directory+'/cache',temp=directory+'/temp';[files,runtime,temp].forEach(d=>fs.mkdirSync(d));const {LocalStore}=load('services/LocalStore',nativeDisk(directory)),store=new LocalStore({filesDir:files,cacheDir:runtime,tempDir:temp},'fixture');store.useCourse(course);
 store.cache.save('summary',course,'answer.json','answer');store.cache.save('vision',course,'ocr.json','ocr');store.cache.flush();store.saveJson('school-terms.json','cached');store.saveJson('course-collections-v1.json','bookmarks');store.saveJson('notes-user.json','notes');fs.mkdirSync(store.dataFolder+'/saved-images',{recursive:true});fs.writeFileSync(store.dataFolder+'/saved-images/user.png','offline');
 fs.writeFileSync(store.dataFolder+'/resource-cache/summary/orphan.bin','orphan');fs.writeFileSync(store.dataFolder+'/vision-v1.json','legacy');fs.mkdirSync(files+'/account-abc/resource-cache/video',{recursive:true});fs.writeFileSync(files+'/account-abc/resource-cache/video/cache.bin','other');fs.writeFileSync(files+'/account-abc/notes-user.json','other note');fs.writeFileSync(runtime+'/web.tmp','web');fs.writeFileSync(temp+'/capture.tmp','temp');
 assert.ok(store.cache.bytes('summary')>=12);assert.equal(store.extraCaches('runtime').length,3);assert.equal(store.extraCaches('legacy').length,2);assert.ok(store.extraCaches('catalogue').some(r=>r.id==='school-terms.json'));store.clearAllCaches();
 assert.equal(store.cache.bytes('summary'),0);assert.equal(store.cache.bytes('vision'),0);assert.equal(store.extraCaches('runtime').length,0);assert.equal(store.extraCaches('legacy').length,0);assert.equal(store.readJson('notes-user.json'),'notes');assert.equal(fs.readFileSync(store.dataFolder+'/saved-images/user.png','utf8'),'offline');assert.equal(fs.readFileSync(files+'/account-abc/notes-user.json','utf8'),'other note');assert.equal(store.readJson('course-collections-v1.json'),'bookmarks');store.cache.flush();
 }finally{fs.rmSync(directory,{recursive:true,force:true})}
});
test('clearing runtime cache protects active isolated downloads and clears their temporary folder after completion',()=>{
 const directory=fs.mkdtempSync('/tmp/zhiyun-active-cache-');try{fs.mkdirSync(directory+'/files');fs.mkdirSync(directory+'/cache');const {LocalStore}=load('services/LocalStore',nativeDisk(directory)),store=new LocalStore({filesDir:directory+'/files',cacheDir:directory+'/cache'},'fixture'),worker=store.forkForDownload();fs.writeFileSync(worker.sessionFolder+'/part.tmp','active');assert.equal(store.extraCaches('runtime').some(e=>e.protected),true);store.clearExtraCaches('runtime');assert.equal(fs.existsSync(worker.sessionFolder+'/part.tmp'),true);worker.releaseDownloadTemporary();assert.equal(store.extraCaches('runtime').some(e=>e.protected),false);}finally{fs.rmSync(directory,{recursive:true,force:true})}
});
test('copying a whole note places text, HTML and every image on the clipboard and releases native resources',async()=>{
 let clipboard,released=0;const pixels=[];const stubs={'@kit.BasicServicesKit':{pasteboard:{MIMETYPE_TEXT_PLAIN:'text',MIMETYPE_TEXT_HTML:'html',MIMETYPE_PIXELMAP:'pixels',createData:(type,value)=>({records:[{type,value}],addRecord(type,value){this.records.push({type,value})}}),getSystemPasteboard:()=>({setData:async data=>{clipboard=data}})}},'@kit.CoreFileKit':{fileUri:{FileUri:class{constructor(value){this.path=value}}}},'@kit.ImageKit':{image:{createImageSource:path=>({getImageInfo:async()=>({size:{width:800,height:600}}),createPixelMap:async()=>{const pixel={release:async()=>released++};pixels.push(pixel);return pixel},release:async()=>released++}),createImagePacker:()=>({packToData:async()=>new ArrayBuffer(2),release:async()=>released++})}},'@kit.ArkTS':{util:{Base64Helper:class{encodeToStringSync(){return'AA=='}}}}};
 const {NoteClipboard}=load('services/NoteClipboard',stubs);await NoteClipboard.copy([{source:'notes',atoms:[{kind:'text',value:'first'}]},{source:'slides',atoms:[{kind:'image',value:'file:///one.png'}]},{source:'image',atoms:[{kind:'image',value:'file:///two.png'}]},{source:'transcript',atoms:[{kind:'quote',value:'quote'}]}]);
 assert.equal(clipboard.records.find(r=>r.type==='text').value,'first\nquote');assert.equal(clipboard.records.filter(r=>r.type==='pixels').length,2);assert.equal((clipboard.records.find(r=>r.type==='html').value.match(/<img /g)||[]).length,2);assert.equal(released,6);
});
test('transcript native shortcut handler selects the entire page and copies every sentence as one paragraph',()=>{
 const {text:p,selection}=transcriptFixture();p.lines=[{id:'a',t:0,text:'first sentence'},{id:'b',t:10,text:'second sentence'}];p.contentChanged();let copied='';p.copy=value=>copied=timeline.plainTranscript(value);const event={type:0,keyCode:2017,getModifierKeyState:()=>true};assert.equal(p.selectionKey(event),true);assert.deepEqual(selection.at(-1),[0,p.renderedText.length]);assert.equal(p.selectionKey({...event,keyCode:2019}),true);assert.equal(copied,'first sentence second sentence');p.aboutToDisappear();
});
test('answer native shortcut handler delegates scope expansion before copy and uses body-only selection otherwise',()=>{
 const p=componentFixture('AnswerText');p.shownParts=[{value:'actual body',seconds:-1}];const event={type:0,keyCode:2017,getModifierKeyState:()=>true};assert.equal(p.selectionKey(event),true);assert.equal(p.selectedStart,0);assert.equal(p.selectedEnd,11);
 let delegated=false;p.onSelectAll=all=>{delegated=all;return true};p.selectionKey(event);assert.equal(delegated,true);let copied=false;p.onCopyAll=()=>{copied=true;return true};assert.equal(p.selectionKey({...event,keyCode:2019}),true);assert.equal(copied,true);p.aboutToDisappear();
});
test('clipboard initialization failure unlocks future copy requests rather than leaving a busy latch',async()=>{
 let first=true,copies=0;const {NoteClipboard}=load('services/NoteClipboard',{'@kit.BasicServicesKit':{pasteboard:{MIMETYPE_TEXT_PLAIN:'text',MIMETYPE_TEXT_HTML:'html',createData:()=>{if(first){first=false;throw Error('unavailable')}return{addRecord(){}}},getSystemPasteboard:()=>({setData:async()=>copies++})}}});await assert.rejects(NoteClipboard.copy([]),/unavailable/);await NoteClipboard.copy([]);assert.equal(copies,1);
});
test('AI confidence must be a valid probability and invalid timing never produces a removable segment',()=>{
 const {conservativeRanges}=load('model/SmartSkip'),group={slide:slide('a',0),lines:[{id:'n',t:0,end:10,text:'嗯啊'}]},decision={spans:[{ids:['n'],kind:'noise',confidence:99}],emptyPage:true,confidence:99,visual:'blank'};assert.equal(conservativeRanges(group,20,decision,true,false).length,0);assert.equal(conservativeRanges({...group,lines:[{...group.lines[0],end:NaN}]},20,{...decision,confidence:1},true,false).length,0);
});

test('collections put only wholly upcoming folders last and ignore excluded lessons when classifying',()=>{
 const {pendingCollection,orderedCollections}=load('model/CollectionView'),now=course.end;
 const past={course,lessons:[course],excluded:[],whole:false},futureCourse={...course,subId:'f',courseId:'f',start:now+100,end:now+1000,status:'0'},future={course:futureCourse,lessons:[futureCourse],excluded:[],whole:false},mixed={course:{...course,courseId:'m'},lessons:[course,futureCourse],excluded:[],whole:true};
 assert.equal(pendingCollection(future,now),true);assert.equal(pendingCollection(mixed,now),false);assert.equal(pendingCollection({...mixed,excluded:[course.subId]},now),true);assert.equal(pendingCollection({...past,excluded:[course.subId]},now),false);
 assert.deepEqual(Array.from(orderedCollections([future,past,mixed],now),entry=>entry.course.courseId),[course.courseId,'m','f']);assert.equal(pendingCollection(future,now+200),false);
});
test('upcoming collection lessons form one trailing section without losing their permission states',()=>{
 const p=componentFixture('CourseList');p.separateUpcoming=true;p.now=course.end;p.courses=[course,{...course,subId:'f',start:course.end+100,status:'0'},{...course,subId:'live',start:course.end+100,status:'1'}];p.permissions={sample:'allowed',f:'denied',live:'allowed'};
 assert.deepEqual(Array.from(p.inSection('allowed'),row=>row.subId),['live','sample']);assert.deepEqual(Array.from(p.inSection('upcoming'),row=>row.subId),['f']);assert.equal(p.sectionTitle('upcoming'),'尚未开始');assert.equal(p.buttonTitle(p.courses[1],'denied'),'需申请');
});
test('new recorded lessons skip opening empty pages only once their transcription is known and preserve all-empty lessons',()=>{
 const p=indexLogicFixture(['skipOpeningPages']);p.skipEmpty=true;p.selected=0;p.info={sub_status:6};p.groups=timeline.groupPages([slide('a',0),slide('b',30),slide('c',60)],[{id:'l',t:65,text:'讲解'}]);let images=0;p.prepareImages=()=>images++;
 p.skipOpeningPages();assert.equal(p.selected,0);p.historyReady=true;p.skipOpeningPages();assert.equal(p.selected,2);assert.equal(images,1);
 p.selected=0;p.info={sub_status:1};p.skipOpeningPages();assert.equal(p.selected,0);p.info={sub_status:6};p.groups=timeline.groupPages([slide('a',0)],[]);p.skipOpeningPages();assert.equal(p.selected,0);
});
test('opening an offline lesson applies skip-empty even without a network history request',()=>{
 const p=indexLogicFixture(['skipOpeningPages']);Object.assign(p,{skipEmpty:true,offlineViewing:true,selected:0,info:{sub_status:6},groups:[{slide:slide('a',0),lines:[],skipContent:false},{slide:slide('b',60),lines:[{id:'b',t:65,text:'lesson'}],skipContent:true}]});p.skipOpeningPages();assert.equal(p.selected,1);
});
test('skip-empty has two explicit modes while AI skipping is enabled and cancellation preserves prior settings',async()=>{
 const p=indexLogicFixture(['toggleSkipEmpty','skipOpeningPages']);let index=2,menu;Object.assign(p,{smartSkip:true,skipEmpty:false,store:{saveJson(){},savePageOptions(){}},historyReady:true});p.getUIContext=()=>({getPromptAction:()=>({showActionMenu:async value=>{menu=value;if(index<0)throw Error('cancel');return {index}}})});p.resize=p.rebuildGroups=p.reconcileChosenPages=()=>{};
 await p.toggleSkipEmpty();assert.equal(menu.buttons.length,3);assert.equal(p.skipEmpty,true);assert.equal(p.skipSparse,true);index=1;await p.toggleSkipEmpty();assert.equal(p.skipSparse,false);index=-1;await p.toggleSkipEmpty();assert.equal(p.skipEmpty,true);index=0;await p.toggleSkipEmpty();assert.equal(p.skipEmpty,false);
});
test('AI skipping requires a cost confirmation every activation, reuses cached results and does not persist enabled by default',async()=>{
 const p=indexLogicFixture(['toggleSmartSkip'],{AiClient:{savedKey:async()=> 'test-key'}});let confirmed=1,dialogs=0,cancels=0,writes=[];Object.assign(p,{smartSkip:false,smartSkipConfiguring:false,generation:1,screen:'lesson',smartFilter:{cancel:()=>cancels++},store:{saveJson:(k,v)=>writes.push([k,v])}});p.rebuildGroups=p.resume=()=>{};p.getUIContext=()=>({getPromptAction:()=>({showDialog:async options=>{dialogs++;assert.match(options.message,/Token/);assert.match(options.message,/缓存/);return {index:confirmed}},showToast(){}})});
 await p.toggleSmartSkip();assert.equal(p.smartSkip,true);assert.equal(dialogs,1);assert.deepEqual(writes[0],['smart-skip-enabled.txt','false']);await p.toggleSmartSkip();assert.equal(p.smartSkip,false);await p.toggleSmartSkip();assert.equal(dialogs,2);await p.toggleSmartSkip();confirmed=0;await p.toggleSmartSkip();assert.equal(p.smartSkip,false);assert.equal(dialogs,3);assert.equal(cancels,4);
});
test('AI skip confirmation cannot enable the feature after changing lessons or open duplicate dialogs',async()=>{
 let finish,dialogs=0;const p=indexLogicFixture(['toggleSmartSkip'],{AiClient:{savedKey:async()=> 'test-key'}});Object.assign(p,{smartSkip:false,generation:1,screen:'lesson',smartFilter:{cancel(){}},store:{saveJson(){}}});p.rebuildGroups=()=>{};p.getUIContext=()=>({getPromptAction:()=>({showDialog:()=>{dialogs++;return new Promise(resolve=>finish=resolve)}})});const first=p.toggleSmartSkip();await new Promise(r=>setTimeout(r,0));await p.toggleSmartSkip();assert.equal(dialogs,1);p.generation=2;finish({index:1});await first;assert.equal(p.smartSkip,false);assert.equal(p.smartSkipConfiguring,false);
});
test('jump undo restores the original moment, slide and summary rather than the videos later current position',()=>{
 const p=indexLogicFixture(['rememberJump','undoStudy','clearStudyReturn']);const view={courseId:course.subId,scope:'courseAll',pageId:'a',scroll:400};Object.assign(p,{course,groups:timeline.groupPages([slide('a',0),slide('b',60)],[]),selected:0,following:false,followVideo:false,followTranscript:false,generation:1,noteReferenceSequence:0});p.learningTime=()=>33;p.summaryController={capture:()=>view};let time;p.jumpToTime=t=>time=t;
 p.rememberJump('notes');p.selected=1;p.videoTime=250;p.undoStudy();assert.equal(time,33);assert.equal(p.selected,0);assert.equal(p.summaryResume,view);assert.equal(p.returnOwner,'');assert.equal(p.followVideo,false);
});
test('browse-return resumes the current playback and only the pane used for browsing owns that button',()=>{
 const p=indexLogicFixture(['browsed','undoStudy','clearStudyReturn']);Object.assign(p,{course,showVideo:true,following:false,followVideo:true,followTranscript:true,selected:0,groups:[{slide:slide('a',0),lines:[]}]});let followed=0;p.saveProgress=()=>{};p.returnToLatest=()=>followed++;
 p.browsed('slides');assert.equal(p.returnOwner,'slides');assert.equal(p.returnKind,'browse');p.browsed('transcript');assert.equal(p.returnOwner,'transcript');p.videoTime=200;p.undoStudy();assert.equal(followed,1);assert.equal(p.returnOwner,'');
});
test('touching transcript text before a citation jump retains the original following policy for undo',()=>{
 const p=indexLogicFixture(['browsed','rememberJump']);Object.assign(p,{course,showVideo:true,followVideo:true,followTranscript:true,following:false,groups:[{slide:slide('a',0),lines:[]}],selected:0});p.saveProgress=()=>{};p.learningTime=()=>33;p.browsed('transcript');assert.equal(p.followVideo,false);p.rememberJump('transcript');assert.equal(p.returnPoint.followVideo,true);assert.equal(p.returnPoint.followTranscript,true);
});
test('a cleared note question reference shows the exact cache-cleared prompt without jumping or opening another pane',()=>{
 const p=indexLogicFixture(['openNoteReference']);let shown;Object.assign(p,{course,store:{activeCourse:course,cache:{revision:()=>0,read:()=>''}},aiOpen:false});p.getUIContext=()=>({getPromptAction:()=>({showDialog:options=>{shown=options.title;return Promise.resolve({index:0})}})});p.openNoteReference({kind:'question',courseId:course.subId,sessionId:'deleted',turn:0,at:33});assert.equal(shown,'相关缓存已被清理');assert.equal(p.aiOpen,false);assert.equal(p.returnOwner,undefined);
});
test('a cleared note summary version is not silently regenerated in place of the referenced answer',()=>{
 const p=indexLogicFixture(['openNoteReference']);let shown;Object.assign(p,{course,store:{activeCourse:course,cache:{revision:()=>0,read:()=>''}},summaryOpen:false});p.getUIContext=()=>({getPromptAction:()=>({showDialog:options=>{shown=options.title;return Promise.resolve({index:0})}})});p.openNoteReference({kind:'summary',courseId:course.subId,pageId:'a',scope:'whole',summaryId:'deleted',at:33});assert.equal(shown,'相关缓存已被清理');assert.equal(p.summaryOpen,false);
});
test('timestamps stay separated and invalid unmeasured positions never create overlapping placeholder timestamps',()=>{
 const {spacedMarkers,readingMarker}=load('model/TranscriptMarkers');const values=spacedMarkers([{index:1,top:27,bottom:54},{index:0,top:0,bottom:27},{index:2,top:27,bottom:54},{index:3,top:NaN,bottom:NaN},{index:4,top:0,bottom:0}],27);assert.deepEqual(Array.from(values,item=>item.top),[0,27,54]);assert.equal(readingMarker(values,40,200).index,1);assert.equal(readingMarker(values,100,20),undefined);
});
test('continuous transcript locates the prior reading sentence and reports its actual offset only after layout',()=>{
 const p=componentFixture('TranscriptText',{'@kit.ArkGraphics2D':{text:{RectWidthStyle:{TIGHT:0},RectHeightStyle:{MAX:0}}}});p.continuous=true;p.locateAt=1980;p.pageKey='continuous';p.lines=[{id:'a',t:0,text:'a'},{id:'b',t:1980,text:'b'},{id:'c',t:2000,text:'c'}];p.visibleTop=0;p.visibleHeight=100;p.playbackAt=-1;let located;p.onLocatePosition=y=>located=y;p.controller={setTextSelection(){},getLayoutManager:()=>({getRectsForRange:range=>[{rect:{top:Math.floor(range.start/2)*27,bottom:Math.floor(range.start/2)*27+27}}]})};p.getUIContext=()=>({px2vp:v=>v,vp2px:v=>v,postFrameCallback:()=>{}});p.contentChanged();p.measureMarkers();assert.equal(located,27);assert.equal(p.locatePending,false);let reading;p.visibleTop=34;p.onReadingPosition=(at,offset)=>reading=[at,offset];p.measureMarkers();assert.deepEqual(reading,[1980,7]);p.aboutToDisappear();
});
test('question prose overrides UI defaults for whole lesson and explicit page ranges, while ordinary questions keep before-only scope',()=>{
 const {questionScope}=load('model/QuestionScope'),slides=[slide('a',0),slide('b',60),slide('c',120),slide('d',180)];
 assert.deepEqual(JSON.parse(JSON.stringify(questionScope('总结整节课',slides,false,['b']))),{whole:true,selectedIds:[]});assert.deepEqual(Array.from(questionScope('结合第2、4页讲解',slides,false,[]).selectedIds),['b','d']);assert.deepEqual(Array.from(questionScope('第2-3页讲了什么',slides,true,['a']).selectedIds),['b','c']);assert.equal(questionScope('不要结合整节课，解释当前内容',slides,true,[]).whole,false);assert.equal(questionScope('截止目前讲了什么',slides,false,[]).whole,false);assert.equal(questionScope('第100-999999999页',slides,false,[]).selectedIds.length,0);
});
test('whole-lesson wording reads later materials despite the whole lesson button being off',async()=>{
 const {AiClient}=load('services/AiClient');AiClient.savedKey=async()=> 'fixture';const ai=new AiClient();let request;ai.stream=async(k,body)=>{request=body;return {answer:'done',calls:[]}};await ai.ask({cache:{revision:()=>0},readJson:()=>''},[slide('a',0),slide('b',60)],[{id:'x',t:65,text:'later teaching'}],'总结整节课',20,false,'fixture',[],()=>{},'never','a');assert.match(JSON.stringify(request.messages),/later teaching/);
});
test('model-directed material retrieval loads full lesson timestamps when a semantic request was not recognized locally',async()=>{
 const {AiClient}=load('services/AiClient');AiClient.savedKey=async()=> 'fixture';const ai=new AiClient();let calls=0,last,loaded=0,scope;ai.stream=async(k,body)=>{calls++;last=body;return calls===1?{answer:'',calls:[{id:'context',function:{name:'read_course_context',arguments:'{"scope":"whole"}'}}]}:{answer:'done',calls:[]}};
 const store={cache:{revision:()=>0},readJson:()=>''};await ai.ask(store,[slide('a',0)],[{id:'a',t:5,text:'earlier'}],'从开场到收尾梳理这堂讲解',10,false,'fixture',[],()=>{},'never','a',()=>{},[],undefined,async()=>{loaded++;return {slides:[slide('a',0),slide('b',60)],lines:[{id:'a',t:5,text:'earlier'},{id:'b',t:65,text:'later'}]}},(whole,expanded)=>scope=[whole,expanded]);assert.equal(loaded,1);assert.deepEqual(scope,[true,true]);assert.match(last.messages.find(m=>m.role==='tool').content,/01:05.*later/);assert.match(last.messages.find(m=>m.role==='tool').content,/第2页/);assert.equal(calls,2);
});
test('model-directed page retrieval returns only requested page intervals and does not run image OCR in never mode',async()=>{
 const {AiClient}=load('services/AiClient');AiClient.savedKey=async()=> 'fixture';const ai=new AiClient();let calls=0,last;ai.readSlideUncached=async()=>{throw Error('forbidden OCR')};ai.stream=async(k,body)=>{calls++;last=body;return calls===1?{answer:'',calls:[{id:'context',function:{name:'read_course_context',arguments:'{"scope":"pages","pages":[2]}'}}]}:{answer:'done',calls:[]}};
 await ai.ask({cache:{revision:()=>0},readJson:()=>''},[slide('a',0),slide('b',60),slide('c',120)],[{id:'a',t:5,text:'first-only'},{id:'b',t:65,text:'second-only'},{id:'c',t:125,text:'third-only'}],'讲解中间那一页',10,false,'fixture',[],()=>{},'never','a');const tool=last.messages.find(m=>m.role==='tool').content;assert.match(tool,/second-only/);assert.doesNotMatch(tool,/first-only|third-only/);assert.deepEqual(Array.from(last.tools,t=>t.function.name),['read_course_context']);
});
test('future-expanded historical answers are not reused for a new before-only question',async()=>{
 const {AiClient}=load('services/AiClient');AiClient.savedKey=async()=> 'fixture';const ai=new AiClient();let last;ai.stream=async(k,body)=>{last=body;return {answer:'done',calls:[]}};await ai.ask({cache:{revision:()=>0},readJson:()=>''},[slide('a',0)],[{id:'a',t:5,text:'lecture'}],'截止目前',30,false,'fixture',[{question:'earlier full',answer:'future-secret',at:10,whole:false,expanded:true,complete:true}],()=>{},'never','a');assert.doesNotMatch(JSON.stringify(last.messages),/future-secret/);
});
test('clearing selections outside one pane preserves that panes whole selection but dismisses every other editor',()=>{
 const {NativeSelections}=load('model/NativeSelections');let notes=0,ai=0,transcript=0;NativeSelections.bind('note',()=>notes++,'notes');NativeSelections.bind('ai',()=>ai++,'ai');NativeSelections.bind('transcript',()=>transcript++,'transcript');NativeSelections.clearExcept('notes');assert.deepEqual([notes,ai,transcript],[0,1,1]);NativeSelections.clear();assert.deepEqual([notes,ai,transcript],[1,2,2]);
});
test('one native question-answer text contains the question and answer without an external duplicate selection background',()=>{
 const p=componentFixture('AiPanel');p.turns=[{question:'question',answer:'**answer** [01:00]',at:20,whole:false,complete:true}];const parts=p.turnParts(0);assert.equal(parts.map(part=>part.value).join(''),'00:20 · 此刻之前\n\nquestion\n\nanswer [01:00]');assert.equal(parts.find(part=>part.seconds===60).value,'[01:00]');assert.equal(parts[1].bold,true);
});
test('keyboard-selected answers open a native selection menu on tap and selected note images retain their whole-note scope',async()=>{
 const p=componentFixture('AnswerText');p.shownParts=[{value:'selected',seconds:-1}];p.selectedStart=0;p.selectedEnd=8;let selection;p.controller={setTextSelection:(...args)=>selection=args};p.showSelectionMenu();await new Promise(resolve=>setTimeout(resolve,25));assert.deepEqual(JSON.parse(JSON.stringify(selection)),[0,8,{menuPolicy:1}]);const n=componentFixture('NotesPane');n.wholeSelection=1;n.selectBlock('image');assert.equal(n.wholeSelection,1);n.dismissWhole();assert.equal(n.wholeSelection,0);
});

test('mouse interaction dismisses its return action without clearing a selected native text range',()=>{
 const p=componentFixture('AnswerText');p.shownParts=[{value:'selected text',seconds:-1}];p.selectedStart=0;p.selectedEnd=8;p.selectionGroup='summary';let interacted=0,cleared=0;p.onInteract=()=>interacted++;p.onPointer=()=>cleared++;p.getUIContext=()=>({vp2px:n=>n,getFocusController:()=>({requestFocus:()=>{}})});p.controller={getLayoutManager:()=>({getGlyphPositionAtCoordinate:()=>({position:3})})};p.mouse({action:inputGlobals.MouseAction.Press,button:inputGlobals.MouseButton.Left,x:3,y:0,windowX:3,windowY:0,stopPropagation:()=>{}});assert.equal(interacted,1);assert.equal(cleared,0);assert.equal(p.selectedEnd,8);
});

test('an empty note editor extends the second Ctrl A to the whole note and resets after a new pointer interaction',async()=>{
 const p=componentFixture('NoteTextEditor',{'@kit.InputKit':{KeyCode:{}}});p.ready=true;p.block={id:'empty',source:'notes',at:0,atoms:[]};p.editor={setCaretOffset:()=>{},getSpans:()=>[],getPreviewText:()=>undefined,getSelection:()=>({selection:[0,0]}),setSelection:()=>{}};const seen=[];p.onSelectAll=all=>{seen.push(all);return all;};const event={type:0,keyCode:2017,keyText:'a',getModifierKeyState:keys=>keys.includes('Ctrl')};assert.equal(p.handleKey(event),true);assert.equal(p.handleKey({...event,keyCode:2072,keyText:''}),false);assert.equal(p.handleKey(event),true);assert.deepEqual(seen,[false,true]);p.pointer(true);p.handleKey(event);assert.deepEqual(seen,[false,true,false]);p.selectionRequest=1;p.selectionMenu();await new Promise(resolve=>setTimeout(resolve,25));assert.equal(p.emptyCopyMenu,true);p.selectionRequest=0;p.selectRequested();assert.equal(p.emptyCopyMenu,false);
});

test('same-page transcript repaint keeps timestamps visible while highlights or live content are updated',()=>{
 const p=componentFixture('TranscriptText');const line={id:'same',t:30,text:'sentence'};p.lines=[line];p.shownLines=[line];p.markers=[{index:0,id:'same',label:'00:30',top:0,bottom:27}];p.getUIContext=()=>({postFrameCallback(){}});p.contentChanged();assert.equal(p.markers.length,1);p.highlightAt=30;p.contentChanged();assert.equal(p.markers[0].label,'00:30');p.lines=[line,{id:'added',t:60,text:'more'}];p.contentChanged();assert.equal(p.markers[0].id,'same');p.pageChanged();assert.equal(p.markers.length,0);p.aboutToDisappear();
});
test('transient unmeasured transcript glyphs do not remove stable timestamps',()=>{
 const p=componentFixture('TranscriptText',{'@kit.ArkGraphics2D':{text:{RectWidthStyle:{TIGHT:0},RectHeightStyle:{MAX:0}}}});p.shownLines=[{id:'a',t:30,text:'sentence'}];p.renderedText='sentence';p.offsets=[0];p.markers=[{index:0,id:'a',label:'00:30',top:0,bottom:27}];p.controller={getLayoutManager:()=>({getRectsForRange:()=>[]})};p.measureMarkers();assert.equal(p.markers.length,1);
});
test('selected answer references preserve bold, italic, line breaks, code and separately clickable course times through persistence',()=>{
 const {selectedAnswerParts,referenceAtoms,noteAnswerParts}=load('model/NoteFormatting');const parts=[{value:'Heading\n',bold:true,italic:false,code:false,seconds:-1},{value:'explain ',bold:false,italic:true,code:false,seconds:-1},{value:'[01:00]',bold:false,italic:false,code:false,seconds:60,course},{value:'\nformula',bold:false,italic:false,code:true,seconds:-1}];const selected=selectedAnswerParts(parts,2,100);assert.equal(selected[0].value,'ading\n');assert.equal(selected[0].bold,true);const insertion={kind:'summary',formatted:selected,value:selected.map(p=>p.value).join(''),at:20,end:20,sourceId:'',reference:{kind:'summary',courseId:course.subId,pageId:'a',at:20}};const atoms=referenceAtoms(insertion),restored=noteAnswerParts({atoms:JSON.parse(JSON.stringify(atoms))});assert.equal(restored[0].bold,true);assert.equal(restored[1].italic,true);assert.equal(restored[2].seconds,60);assert.equal(restored[2].course.subId,course.subId);assert.equal(restored[3].code,true);assert.equal(restored.map(p=>p.value).join(''),insertion.value);
});
test('answer references exported to HTML and Markdown keep styles and paragraphs inside one reference block',()=>{
 const {referenceAtoms}=load('model/NoteFormatting'),{NotesStore}=load('services/NotesStore');const atoms=referenceAtoms({kind:'question',value:'Title\nbody',formatted:[{value:'Title',seconds:-1,bold:true,italic:false,code:false},{value:'\nbody',seconds:-1,bold:false,italic:true,code:false}],at:10,end:10,sourceId:''}),repo=new NotesStore({}),note={course,title:'note',atoms,anchors:[]};const html=repo.html(note),md=repo.markdown(note,'/fixture','note');assert.match(html,/<b>Title<\/b>/);assert.match(html,/<i><br>body<\/i>/);assert.equal((html.match(/<blockquote>/g)||[]).length,1);assert.match(md,/\*\*Title\*\*/);assert.match(md,/\n> body/);
});
test('switching collection navigation to the same tab clears nested course state and cancels pending requests',()=>{
 const p=componentFixture('CollectionsPage');p.selectedId='nested';p.courses=[course];p.busy=true;p.checked.add(course.subId);p.visible.add(course.subId);let canceled=0;p.api={cancel:()=>canceled++};p.accessApi={cancel:()=>canceled++};p.goRoot();assert.equal(p.selectedId,'');assert.equal(p.courses.length,0);assert.equal(p.visible.size,0);assert.equal(p.checked.size,0);assert.equal(p.busy,false);assert.equal(canceled,2);
 const page=indexLogicFixture(['openHomePage']);page.collectionRootSequence=4;page.openHomePage('favourite');page.openHomePage('favourite');assert.equal(page.collectionRootSequence,6);
});
test('whole note selection clears native block selection and taps offer only the whole-note copy menu',async()=>{
 const p=componentFixture('NoteTextEditor',{'@kit.InputKit':{KeyCode:{}}});p.ready=true;p.focused=true;p.caret=3;p.block={atoms:[{value:'local text'}]};let caret,selected=0;p.editor={setCaretOffset:v=>caret=v,setSelection:()=>selected++,getSpans:()=>[{value:'local text'}]};p.selectionRequest=1;p.selectRequested();assert.equal(caret,3);assert.equal(selected,0);p.selectionMenu();await new Promise(r=>setTimeout(r,25));assert.equal(p.emptyCopyMenu,true);assert.equal(selected,0);
 const answer=componentFixture('AnswerText');answer.externalSelection=true;answer.selectionRequest=2;answer.selectedStart=0;answer.selectedEnd=5;const changes=[];answer.controller={setTextSelection:(...args)=>changes.push(args)};answer.selectRequested();assert.equal(answer.selectedEnd,0);assert.deepEqual(Array.from(changes[0]),[0,0]);answer.showSelectionMenu();assert.equal(answer.wholeCopyMenu,true);
});
test('AI segment filtering removes breaks within a useful slide without deleting adjacent teaching or their timestamps',()=>{
 const {conservativeRanges,filteredTranscript}=load('model/SmartSkip');const lines=[{id:'teach',t:0,end:20,text:'概念讲解'},{id:'chat',t:30,end:36,text:'中午去食堂吃面'},{id:'noise',t:37,end:42,text:'嗯啊'},{id:'next',t:100,end:110,text:'继续讲课'}];const group={slide:slide('a',0),lines},decision={visual:'slide',emptyPage:false,confidence:1,spans:[{ids:['chat','noise'],kind:'break',confidence:1,reason:'已明确进入休息，内容与课程无关'}]};const ranges=conservativeRanges(group,150,decision,true,false);assert.equal(ranges.length,1);assert.deepEqual([ranges[0].start,ranges[0].end],[30,100]);assert.deepEqual(Array.from(filteredTranscript(lines,ranges),l=>l.id),['teach','next']);assert.equal(conservativeRanges(group,150,{...decision,spans:[{ids:['teach'],kind:'chatter',confidence:1,reason:'wrong'}]},true,false).length,0);
});
test('AI analysis progress counts completed cached and requested pages, reaches completion and records failures without deleting uncertain content',async()=>{
 const {SmartSkipService}=load('services/SmartSkipService'),service=new SmartSkipService();let finish;service.client={cancel(){},classifySkip:()=>new Promise(resolve=>finish=resolve)};const progress=[],groups=[{slide:slide('a',0),lines:[{id:'a',t:1,end:4,text:'嗯'}]}],store={cache:{revision:()=>0,read:()=>'',save(){}},imageVersion:()=>''};service.update(store,course,groups,10,false,false,0,()=>{},v=>progress.push({...v}));assert.equal(progress.at(-1).running,true);assert.equal(progress.at(-1).completed,0);finish({spans:[],emptyPage:false,confidence:1,visual:'slide'});await new Promise(r=>setTimeout(r,10));assert.deepEqual(progress.at(-1),{completed:1,total:1,failed:0,running:false});service.update(store,course,groups,10,false,false,0,()=>{},v=>progress.push({...v}));assert.equal(progress.at(-1).completed,1);service.cancel();groups[0].slide=slide('uncached',0);service.client={cancel(){},classifySkip:async()=>{throw Error('unavailable')}};service.update(store,course,groups,10,false,false,0,()=>{},v=>progress.push({...v}));await new Promise(r=>setTimeout(r,10));assert.equal(progress.at(-1).failed,1);assert.equal(progress.at(-1).running,false);assert.equal(service.ranges().length,0);service.cancel();
});
test('completed skip analysis opens the mode menu only once when skip-empty is enabled and ignores a different lesson',()=>{
 const p=indexLogicFixture(['skipProgressChanged']);Object.assign(p,{smartSkip:true,screen:'lesson',course,skipEmpty:true,skipModePrompted:false});let menus=0;p.toggleSkipEmpty=()=>menus++;const done={completed:3,total:3,failed:0,running:false};p.skipProgressChanged(course.subId,done);p.skipProgressChanged(course.subId,done);assert.equal(menus,1);p.skipModePrompted=false;p.skipProgressChanged('other',done);assert.equal(menus,1);p.skipEmpty=false;p.skipProgressChanged(course.subId,done);assert.equal(menus,1);
});
test('skip-empty reports no matching pages separately for exact and sparse modes without disabling the option',()=>{
 const p=indexLogicFixture(['reportNoSkipPages']);p.groups=[{slide:slide('a',0),lines:[{text:'teaching'}],skipContent:true}];p.skipEmpty=true;p.smartSkip=true;p.skipSparse=false;const messages=[];p.getUIContext=()=>({getPromptAction:()=>({showToast:v=>messages.push(v.message)})});p.reportNoSkipPages();p.skipSparse=true;p.reportNoSkipPages();assert.deepEqual(messages,['未发现无转写课件','未发现无转写或仅含杂音的课件']);assert.equal(p.skipEmpty,true);p.groups[0].skipContent=false;p.reportNoSkipPages();assert.equal(messages.length,2);
});
test('attendance batch cache reuses additions with current metadata but any removed attendance record invalidates the whole cache',()=>{
 const {attendanceBatch,reusableAttendanceBatch}=load('model/AttendanceBatch');const other={...course,subId:'second'},fresh={...course,title:'updated'},cache=attendanceBatch([course,other],[course]);assert.deepEqual(Array.from(reusableAttendanceBatch([fresh,other,{...course,subId:'new'}],cache),c=>c.title),['updated']);assert.equal(reusableAttendanceBatch([fresh],cache).length,0);assert.equal(reusableAttendanceBatch([fresh],{...cache,schema:99}).length,0);
});
test('all-course batch opens immediately from a valid snapshot while starting background permission checks, and newer denial removes the candidate',()=>{
 const p=componentFixture('MyCourses');p.courses=[course];const cache=load('model/AttendanceBatch').attendanceBatch([course],[course]);p.store={readJson:()=>JSON.stringify(cache)};p.permissions={};p.checked.clear();p.verified.clear();let list,checks=0;p.onDownload=rows=>list=Array.from(rows,c=>c.subId);p.publishScope=()=>{};p.checkVisible=()=>checks++;p.download();assert.deepEqual(list,['sample']);assert.equal(checks,1);p.permissions.sample='denied';assert.equal(p.permittedScope().length,0);
});
test('question citation jump retains its originating turn and pane focus does not dismiss the undo button created by a nested citation click',()=>{
 const ai=componentFixture('AiPanel');let jumped;ai.onJump=at=>jumped=at;ai.jumpAnswer(2,60);assert.equal(jumped,60);assert.equal(ai.returnTurn,2);const p=indexLogicFixture(['activatePane','rememberJump','clearStudyReturn']);Object.assign(p,{course,activePane:'ai'});p.paneFront=()=>true;p.rememberJump('ai');p.activatePane('ai');assert.equal(p.returnOwner,'ai');p.activatePane('ai');assert.equal(p.returnOwner,'ai');p.clearStudyReturn();assert.equal(p.returnOwner,'');
});
test('returning to an already-focused pane clears other panes selections even when a child text event had stopped bubbling',()=>{
 let cleared;const p=indexLogicFixture(['activatePane'],{NativeSelections:{clearExcept:group=>cleared=group}});p.activePane='slides';p.paneFront=()=>true;p.activatePane('slides');assert.equal(cleared,'slides');
});

test('merged transcript playback color is independent of page bounds and persists across sentence pauses',()=>{
 const {currentSpokenLineIndex}=load('model/TranscriptPlayback');const lines=[{id:'a',t:20,end:25,text:'第一句'},{id:'b',t:50,end:55,text:'第二句'}];
 for(const [at,index] of [[19,-1],[20,0],[35,0],[50,1],[60,1],[NaN,-1]])assert.equal(currentSpokenLineIndex(lines,at),index);
 const p=componentFixture('TranscriptText');p.lines=lines;p.continuous=true;p.playbackAt=35;p.playbackColored=true;p.contentChanged();assert.equal(p.runs.find(r=>r.active)?.value.trim(),'第一句');p.playbackAt=51;p.playbackChanged();assert.equal(p.runs.find(r=>r.active)?.value.trim(),'第二句');p.pageKey='continuous';p.pageChanged();assert.equal(p.runs.find(r=>r.active)?.value.trim(),'第二句');clearTimeout(p.measureTimer);
});
test('completed authoritative replay history skips a silent opening immediately and never treats missing live history as silence',()=>{
 const {untranscribedBoundaries,automaticSkip}=load('model/SmartSkip'),lines=[{id:'a',t:104,end:112,text:'正式上课'},{id:'b',t:1510,end:1518,text:'今天到这里'}];
 const ranges=untranscribedBoundaries(lines,2000,true,false);assert.deepEqual(Array.from(ranges,r=>[r.start,r.end]),[[0,104],[1518,2000]]);assert.equal(automaticSkip(0,2000,ranges).end,104);assert.equal(automaticSkip(1518,2000,ranges).end,2000);
 for(const bad of [[],[{...lines[0],timing:'received'}],[{...lines[0],t:NaN}]])assert.equal(untranscribedBoundaries(bad,2000,true,false).length,0);
 assert.equal(untranscribedBoundaries(lines,2000,false,false).length,0);assert.equal(untranscribedBoundaries(lines,2000,true,true).length,0);
 assert.equal(untranscribedBoundaries([{t:104,end:104,text:'no end'}],2000,true,false).length,1);
});
test('AI-confirmed fragments extend to the next valid sentence and merge across PPT boundaries without mutating raw lines',()=>{
 const {conservativeRanges,mergedSkipRanges,filteredTranscript}=load('model/SmartSkip');const lines=[{id:'valid',t:1505,end:1518,text:'继续进入你们小组'},{id:'fragment',t:1518,end:1528,text:'一个你'},{id:'n',t:1528,end:1545,text:'嗯'},{id:'number',t:1545,end:1700,text:'67哦'}];
 const decision={visual:'slide',emptyPage:false,confidence:.98,spans:[{ids:['fragment','n','number'],kind:'noise',confidence:.98,reason:'正式指导结束后的连续收音碎片与课件知识无关'}]};const first=conservativeRanges({slide:slide('a',1447),lines},1730,decision,true,false);assert.deepEqual([first[0].start,first[0].end],[1518,1730]);const ranges=mergedSkipRanges(first.concat([{start:1730,end:1735,ids:['later'],reason:'无实质讲解',pageId:'b'},{start:1735,end:5700,ids:['last'],reason:'非课堂闲聊',pageId:'c'}]));assert.equal(ranges.length,1);assert.deepEqual([ranges[0].start,ranges[0].end],[1518,5700]);assert.deepEqual(Array.from(filteredTranscript(lines,ranges),l=>l.id),['valid']);assert.equal(lines.length,4);
 const teaching={...lines[1],text:'例如这是一个案例'};assert.equal(conservativeRanges({slide:slide('a',1447),lines:[teaching]},1730,{...decision,spans:[{...decision.spans[0],ids:['fragment']}]},true,false).length,0);
});
test('smart skip publishes known replay opening silence before any AI page request finishes',()=>{
 const {SmartSkipService}=load('services/SmartSkipService'),s=new SmartSkipService();s.next=()=>{};const store={cache:{revision:()=>0,read:()=>''},imageVersion:()=>''},lines=[{id:'a',t:104,end:112,text:'讲解'}];let ranges;
 s.update(store,course,[{slide:slide('a',2),lines}],600,false,false,0,r=>ranges=r,()=>{},lines);assert.equal(ranges.find(r=>r.start===0)?.end,104);s.cancel();assert.equal(s.ranges().length,0);
});
test('playing seekable video jumps a merged invalid interval once while paused video and live edge stay untouched',()=>{
 const p=indexLogicFixture(['playbackChanged'],load('model/SmartSkip'));Object.assign(p,{smartSkip:true,videoTime:0,videoSource:{live:false},skipRanges:[{start:0,end:104,ids:[],pageId:'prefix',reason:'未开始'}],lastAutomaticRange:'',followVideo:true});const seeks=[],toasts=[];p.playback={seek:at=>seeks.push(at)};p.followPlayback=()=>{};p.saveProgress=()=>{};p.getUIContext=()=>({getPromptAction:()=>({showToast:v=>toasts.push(v.message)})});const state={time:0,rate:1,paused:false,seekable:true,end:600,width:0,height:0,positionReady:true};p.playbackChanged(state);p.playbackChanged({...state,time:1});assert.deepEqual(seeks,[104]);p.playbackChanged({...state,time:105});p.playbackChanged({...state,time:0,paused:true});assert.deepEqual(seeks,[104]);p.videoSource.live=true;p.liveReplay=false;p.playbackChanged(state);assert.deepEqual(seeks,[104]);p.liveReplay=true;p.playbackChanged(state);assert.deepEqual(seeks,[104,104]);
});

test('pointer press keeps native answer selection claimed even before the range becomes nonempty, then dragging reverses correctly',()=>{
 const p=componentFixture('AnswerText');p.shownParts=[{value:'01234567890123456789',seconds:-1}];const claims=[],ranges=[];p.onSelecting=active=>claims.push(active);p.getUIContext=()=>({vp2px:n=>n,getFocusController:()=>({requestFocus(){}})});p.controller={getLayoutManager:()=>({getGlyphPositionAtCoordinate:(x,y)=>({position:y}),getRectsForRange:()=>[]}),setTextSelection:(s,e)=>ranges.push([s,e])};const event=(action,y)=>({action,button:1,x:0,y,windowX:0,windowY:y,stopPropagation(){}});p.mouse(event(1,10));assert.equal(claims.at(-1),true,'empty native selection must not unlock the Scroll on press');p.mouse(event(3,18));assert.deepEqual([p.selectedStart,p.selectedEnd],[10,18]);p.mouse(event(3,2));assert.deepEqual([p.selectedStart,p.selectedEnd],[2,10]);assert.equal(claims.at(-1),true);p.mouse(event(2,2));p.dismissSelection();assert.equal(claims.at(-1),false);clearTimeout(p.selectionDismissTimer);
});
test('transcript drag hold and native selection changes do not unlock its parent scroll until release/dismiss',()=>{
 const p=componentFixture('TranscriptText');const claims=[];p.onSelecting=active=>claims.push(active);p.holdPointer(true,true);p.select(0,0);assert.equal(claims.at(-1),true);p.select(3,12);assert.equal(claims.at(-1),true);p.holdPointer(false);assert.equal(claims.at(-1),true);p.select(0,0,true);assert.equal(claims.at(-1),false);clearTimeout(p.releaseTimer);clearTimeout(p.measureTimer);
});
test('clicking unselected note space clears the whole-note overlay and native selection without changing note content',()=>{
 const p=componentFixture('NotesPane');p.wholeSelection=2;p.copySurface='quote';p.selectedImageId='old';p.blocks=[{id:'a',source:'notes',atoms:[{value:'saved'}]}];p.unselectedPointer();assert.equal(p.wholeSelection,0);assert.equal(p.copySurface,'');assert.equal(p.selectedImageId,'');assert.equal(p.blocks[0].atoms[0].value,'saved');p.rowMeasured('a',150);assert.equal(p.rowHeights.a,150);const same=p.rowHeights;p.rowMeasured('a',150);assert.equal(p.rowHeights,same);
});
test('focusing the transcript pane from its title or blank area does not jump the lesson timeline',()=>{
 const p=indexLogicFixture(['activatePane']);let jumps=0;p.rewind=()=>jumps++;p.paneFront=()=>true;p.activatePane('transcript');assert.equal(p.activePane,'transcript');assert.equal(jumps,0);
});

test('tiny AI-confirmed first-page noise joins its silent lead and the next confirmed fragment immediately, without waiting for all pages',()=>{
 const {conservativeRanges,mergedSkipRanges}=load('model/SmartSkip');const first={id:'first',t:18,end:28,text:'对。',timing:'history'},next={id:'next',t:28,end:34,text:'嗯。',timing:'history'},knowledge={id:'lecture',t:212,end:236,text:'我们进入18世纪启蒙运动',timing:'history'};
 const a=conservativeRanges({slide:slide('first',2),lines:[first]},20,{spans:[{ids:['first'],kind:'noise',confidence:.95,reason:'开课前无意义收音'}]},true,false);assert.equal(a.length,1);
 const initial=mergedSkipRanges(a,[first,next,knowledge],true);assert.deepEqual(Array.from(initial,r=>[r.start,r.end]),[[0,20]]);
 const partial=mergedSkipRanges(a.concat([{start:28,end:212,ids:['next'],reason:'无实质讲解',pageId:'second'}]),[first,next,knowledge],true);assert.deepEqual(Array.from(partial,r=>[r.start,r.end]),[[0,212]]);
 const live=mergedSkipRanges(a,[first,next,knowledge],false);assert.equal(live[0].start,18);const retained=mergedSkipRanges(a.concat([{start:28,end:212,ids:['next'],reason:'noise',pageId:'second'}]),[first,{id:'useful',t:21,text:'答案是传播学'},next,knowledge],true);assert.equal(retained.length,2);
});
test('identical resource polling does not rewrite snapshots; transcript corrections, changed metadata and cache clearing still persist',()=>{
 const {LocalStore}=load('services/LocalStore',{'@kit.CoreFileKit':{fileIo:{mkdirSync(){},accessSync(){return true}},fileUri:{getUriFromPath:p=>'file://'+p}}});const store=new LocalStore({filesDir:'/fixtures',cacheDir:'/fixtures'},'u'),writes=[];let revision=0;store.cache={revision:()=>revision,save:(kind,c,n,data)=>writes.push([kind,JSON.parse(data)])};const snapshot={course:{...course},slides:[slide('a',0)],lines:[{id:'a',t:10,text:'旧讲解'}],savedAt:1};store.save(snapshot);store.save({...snapshot,savedAt:2});assert.equal(writes.length,2);store.save({...snapshot,lines:[{id:'a',t:10,text:'纠正讲解'}]});assert.equal(writes.length,3);assert.equal(writes.at(-1)[0],'transcript');revision++;store.save(snapshot);assert.equal(writes.length,5);snapshot.course.status='ended';store.save(snapshot);assert.equal(writes.length,7);
});
test('unchanged grouping keeps visible objects and manual location stable while correcting time-aligned transcript rebuilds once',()=>{
 const p=indexLogicFixture(['rebuildGroups']);Object.assign(p,{slides:[slide('a',0),slide('b',60)],lines:[{id:'a',t:2,text:'first'}],mergeDuplicateSlides:true,skipRanges:[],selected:1,following:false,capacity:2,smartSkip:false});p.rebuildGroups();const groups=p.groups;p.rebuildGroups();assert.equal(p.groups,groups);assert.equal(p.selected,1);p.lines=[{id:'a',t:2,text:'corrected'},{id:'b',t:65,text:'second'}];p.rebuildGroups();assert.notEqual(p.groups,groups);assert.equal(p.groups[1].lines[0].text,'second');assert.equal(p.selected,1);
});
test('AI evidence prefixes retain all eligible text in order and image tools do not resend the same transcript',async()=>{
 const {AiClient}=load('services/AiClient');AiClient.savedKey=async()=> 'fixture';const ai=new AiClient(),requests=[];ai.stream=async(k,b)=>{requests.push(JSON.parse(JSON.stringify(b)));return{answer:'ok',calls:[]}};ai.readSlide=async()=>({text:'图像证据',version:'v1'});const pages=[slide('a',0),slide('b',60)],lines=[{id:'a',t:10,text:'唯一前页讲解'},{id:'b',t:70,text:'当前新讲解'},{id:'c',t:80,text:'尚未讲到'}],store={readJson:()=>''};await ai.ask(store,pages,lines,'本页图像',75,false,'fixture',[],()=>{},'always','b');await ai.ask(store,pages,lines,'本页公式',85,false,'fixture',[],()=>{},'always','b');const a=requests[0].messages,b=requests[1].messages;assert.deepEqual(a.slice(0,2),b.slice(0,2));assert.equal(JSON.stringify(a).split('当前新讲解').length-1,1);assert.equal(JSON.stringify(a).includes('尚未讲到'),false);assert.equal(JSON.stringify(b).includes('尚未讲到'),true);assert.match(JSON.stringify(a),/图像证据/);
});
test('paused player deduplicates bridge notifications without delaying a seek, play transition or playback tick',()=>{
 const p=playerFixture();p.Player.load({url:'https://cmc.zju.edu.cn/lesson.mp4',autoplay:false});p.eventHandlers.loadedmetadata();const before=p.reports.length;p.Player.position();p.Player.position();assert.equal(p.reports.length,before);p.Player.seek(30);assert.equal(p.reports.length,before+1);p.Player.toggle();p.Player.position();assert.equal(p.reports.at(-1).paused,false);p.video.currentTime=31;p.Player.position();assert.equal(p.reports.at(-1).time,31);
});

test('all four study panes cancel their own native and whole selections on blank focus without affecting another pane',()=>{
 const {NativeSelections}=load('model/NativeSelections'),cleared=[];for(const group of ['notes','transcript','ai','summary'])NativeSelections.bind(group,()=>cleared.push(group),group);for(const group of ['notes','transcript','ai','summary']){cleared.length=0;NativeSelections.clearGroup(group);assert.deepEqual(cleared,[group]);}NativeSelections.clear();assert.equal(cleared.length,5);for(const group of ['notes','transcript','ai','summary'])NativeSelections.unbind(group);
});
test('a duplicate mouse/touch down event during touchpad drag never changes the original selection anchor',()=>{
 const {MouseTextRange}=load('model/MouseTextRange'),range=new MouseTextRange();range.begin(10,10,100);range.move(30,10,140);range.begin(30,10,140);assert.deepEqual({...range.move(2,10,80)},{start:2,end:10});range.end();range.begin(50,10,200);assert.deepEqual({...range.move(65,10,250)},{start:50,end:65});range.cancel();
});
test('tap on empty space next to selected answer text cancels selection even when the nearest glyph belongs to the selected range',()=>{
 const p=componentFixture('AnswerText',{'@kit.ArkGraphics2D':{text:{RectWidthStyle:{TIGHT:0},RectHeightStyle:{MAX:0}}}});p.shownParts=[{value:'0123456789',seconds:-1}];p.selectedStart=0;p.selectedEnd=10;p.getUIContext=()=>({vp2px:n=>n});p.controller={getLayoutManager:()=>({getRectsForRange:()=>[{rect:{left:0,right:100,top:0,bottom:20}}]}),setTextSelection(){}};let reset=0;p.onPointer=()=>reset++;assert.equal(p.selectedPoint(50,10,5),true);p.touchSelection(9,140,10);assert.equal(p.selectedEnd,0);assert.equal(reset,1);clearTimeout(p.selectionDismissTimer);
});
test('touchpad selection preserves the pressed state across source changes and reverses vertically around its original anchor',()=>{
 const p=componentFixture('AnswerText'),ranges=[];p.shownParts=[{value:'012345678901234567890123456789',seconds:-1}];p.getUIContext=()=>({vp2px:n=>n,getFocusController:()=>({requestFocus(){}})});p.controller={getLayoutManager:()=>({getGlyphPositionAtCoordinate:(x,y)=>({position:y}),getRectsForRange:()=>[]}),setTextSelection:(s,e)=>ranges.push([s,e])};const ev=(type,y,tool=4)=>({type,source:1,sourceTool:tool,changedTouches:[{x:1,y,windowX:1,windowY:y}],touches:[{x:1,y,windowX:1,windowY:y}],stopPropagation(){}});p.touch(ev(0,10));p.touch(ev(2,22,1));assert.deepEqual([p.selectedStart,p.selectedEnd],[10,22]);p.touch(ev(2,2,1));assert.deepEqual([p.selectedStart,p.selectedEnd],[2,10]);p.touch(ev(3,2));p.dismissSelection();clearTimeout(p.selectionDismissTimer);
});

test('native MP4 transport sends bytes directly and never base64 encodes or decodes the media buffer',async()=>{
 let encoded=0;const bytes=new Uint8Array([0,1,128,255]).buffer;const {VideoNetwork}=load('services/VideoNetwork',{'@kit.NetworkKit':{http:{createHttp:()=>({request:async()=>({responseCode:206,header:{'content-type':'video/mp4','content-range':'bytes 0-3/4'},result:bytes}),destroy(){}}),HttpDataType:{ARRAY_BUFFER:1}}},'@kit.ArkTS':{util:{Base64Helper:class{async encodeToString(){encoded++;return''}}}}});const reply=await new VideoNetwork().read('id','https://cmc.zju.edu.cn/a.mp4',0,4,true);assert.equal(encoded,0);assert.equal(reply.base64,'');assert.deepEqual(Array.from(new Uint8Array(reply.data)),[0,1,128,255]);
 const {MediaCacheProxy}=load('services/MediaCacheProxy',{'@kit.ArkTS':{util:{Base64Helper:class{decodeSync(){throw Error('unnecessary decoding')}}}}});const sent=[],proxy=new MediaCacheProxy({read:async()=>reply});await proxy.respond({async send(v){sent.push(v.data)}},'GET /video HTTP/1.1\r\nRange: bytes=0-3\r\n\r\n','/video','https://cmc.zju.edu.cn/a.mp4',0);assert.deepEqual(Array.from(new Uint8Array(sent[1])),[0,1,128,255]);
});
test('opening video shows the first source without comparing frames and schedules comparisons only after metadata is ready',async()=>{
 const p=indexLogicFixture(['toggleVideo','probeReady','cancelCameraProbe']);Object.assign(p,{course,generation:1,foreground:true,groups:[{slide:slide('a',0),lines:[]}],selected:0,info:{sub_status:6},cameraCandidates:[],cameraProbeStarted:false});p.unavailablePane=()=>false;p.resize=()=>{};p.api={videos:async()=>[{id:'first',title:'默认',url:'https://cmc.zju.edu.cn/one.mp4',live:false},{id:'second',title:'教师',url:'https://cmc.zju.edu.cn/two.mp4',live:false}]};let probes=0,cancels=0;p.sourceProbe={uniqueSources:async()=>{probes++;return[]},cancel:()=>cancels++};await p.toggleVideo();assert.equal(p.showVideo,true);assert.equal(p.videoSources.length,1);assert.equal(probes,0);p.probeReady({positionReady:false,width:100});assert.equal(p.cameraProbeStarted,false);p.probeReady({positionReady:true,width:100});assert.equal(p.cameraProbeStarted,true);p.fullscreen=()=>{};p.playback={pause(){}};p.saveProgress=()=>{};await p.toggleVideo();await new Promise(r=>setTimeout(r,650));assert.equal(probes,0);assert.equal(cancels,1);assert.equal(p.cameraCandidates.length,0);
});

test('playback ticks reuse unchanged slide/transcript/visible-page inputs while new pages, corrections and skip changes invalidate them',()=>{
 const p=indexLogicFixture(['presentationSlides','cleanTranscript','visibleGroups','manualBrowsing']);Object.assign(p,{slides:[slide('a',0),slide('b',60)],mergeDuplicateSlides:true,lines:[{id:'a',t:1,text:'teaching'},{id:'noise',t:2,text:'嗯'}],smartSkip:true,skipRanges:[],groups:[{slide:slide('a',0),lines:[]},{slide:slide('b',60),lines:[]}],selected:0,capacity:1,following:false,showVideo:true,followVideo:true});const slides=p.presentationSlides(),lines=p.cleanTranscript(),groups=p.visibleGroups();for(let t=0;t<100;t++){p.videoTime=t/4;assert.equal(p.presentationSlides(),slides);assert.equal(p.cleanTranscript(),lines);assert.equal(p.visibleGroups(),groups);}p.skipRanges=[{start:2,end:3,ids:['noise']}];assert.notEqual(p.cleanTranscript(),lines);assert.equal(p.cleanTranscript().length,1);p.slides=p.slides.concat(slide('c',120));assert.notEqual(p.presentationSlides(),slides);p.selected=1;assert.notEqual(p.visibleGroups(),groups);assert.equal(p.visibleGroups()[0].slide.id,'b');
});


test('note Enter reaches the IME even when preview has not been published; committed newline alone creates a new block',()=>{
 const p=componentFixture('NoteTextEditor',{'@kit.InputKit':{KeyCode:{KEYCODE_ENTER:2054,KEYCODE_NUMPAD_ENTER:2114}}});p.ready=true;p.focused=false;p.block={id:'ime',source:'notes',at:0,atoms:[]};let value='english',preview='',changes=[],splits=[],breaks=0;
 p.editor={getPreviewText:()=>({value:preview}),getSelection:()=>({selection:[0,0]}),getSpans:()=>[{value,spanPosition:{spanRange:[0,value.length]},textStyle:{fontWeight:400,fontStyle:0,decoration:{type:0}}}]};p.snapshot=()=>[{value}];p.onChange=atoms=>changes.push(atoms);p.onMultiline=(atoms,offset)=>splits.push([atoms,offset]);p.onBreak=()=>breaks++;
 const event={type:0,keyCode:2054,keyText:'',getModifierKeyState:()=>false};assert.equal(p.handleKey(event),false);preview='english';assert.equal(p.handleKey(event),false);p.emit();assert.equal(changes.length,0);assert.equal(splits.length,0);
 preview='';p.emit(7);assert.equal(changes.length,1);assert.equal(splits.length,0);assert.equal(breaks,0);value='english\n';p.emit(8);assert.equal(splits.length,1);assert.equal(splits[0][1],8);clearTimeout(p.measureTimer);
});


test('pressed selection survives duplicate pane clear events; release restores clearing, forced exit always clears',()=>{
 const {NativeSelections}=load('model/NativeSelections'),cleared=[];NativeSelections.bind('editor',()=>cleared.push('editor'),'notes');NativeSelections.bind('whole',()=>cleared.push('whole'),'notes');NativeSelections.bind('other',()=>cleared.push('other'),'summary');NativeSelections.hold('editor',true);NativeSelections.clearGroup('notes');assert.equal(cleared.length,0);NativeSelections.clearExcept('summary');assert.equal(cleared.length,0);NativeSelections.hold('editor',false);NativeSelections.clearGroup('notes');assert.deepEqual(cleared,['editor','whole']);NativeSelections.hold('editor',true);NativeSelections.clear();assert.deepEqual(cleared.slice(2),['editor','whole','other']);NativeSelections.clearGroup('notes');assert.equal(cleared.length,7);for(const id of ['editor','whole','other'])NativeSelections.unbind(id);
});
test('canceling inactive note selections does not move the caret or acquire native focus',()=>{
 const p=componentFixture('NoteTextEditor');p.ready=true;p.focused=false;p.caret=5;let moved=0;p.editor={setCaretOffset:()=>moved++,getSelection:()=>({selection:[0,5]})};p.dismissSelection();p.selectionRequest=1;p.selectRequested();assert.equal(moved,0);p.focused=true;p.remember=()=>{};p.dismissSelection();assert.equal(moved,1);
});
test('background keyboard commands target only the chosen text group and ignore other panes',()=>{
 const {NativeSelections}=load('model/NativeSelections');let first=0,other=0;NativeSelections.bind('summary',()=>{},'summary',event=>{first++;return event.keyText==='a'});NativeSelections.bind('notes',()=>{},'notes',()=>{other++;return true});assert.equal(NativeSelections.keyGroup('summary',{keyText:'a'}),true);assert.equal(first,1);assert.equal(other,0);assert.equal(NativeSelections.keyGroup('missing',{keyText:'a'}),false);NativeSelections.unbind('summary');NativeSelections.unbind('notes');
});
test('video publishes a decoded first frame separately from metadata, including initially paused video, and resets it on source change',()=>{
 const p=playerFixture();p.video.videoWidth=1920;p.video.videoHeight=1080;p.video.readyState=1;p.Player.load({url:'https://cmc.zju.edu.cn/a.mp4',autoplay:false});p.eventHandlers.loadedmetadata();assert.equal(p.reports.at(-1).frameReady,false);p.video.readyState=2;p.eventHandlers.loadeddata();assert.equal(p.reports.at(-1).frameReady,true);assert.equal(p.video.paused,true);p.Player.load({url:'https://cmc.zju.edu.cn/b.mp4',autoplay:false});assert.equal(p.reports.at(-1).frameReady,false);
});
test('video source loading stays offscreen and a canceled source request cannot reopen its pane',async()=>{
 const p=indexLogicFixture(['toggleVideo','cancelCameraProbe']);Object.assign(p,{course,generation:1,showVideo:false,groups:[{slide:slide('a',60),lines:[]}],selected:0});p.unavailablePane=()=>false;p.resize=()=>{};let release;p.api={videos:()=>new Promise(r=>release=r)};p.sourceProbe={cancel(){}};p.fullscreen=()=>{};p.playback={pause(){}};p.saveProgress=()=>{};const opening=p.toggleVideo();assert.equal(p.showVideo,false);assert.equal(p.videoBusy,true);assert.equal(p.videoSource,undefined);assert.equal(p.videoInitialSeconds,60);p.videoTime=0;assert.equal(p.videoInitialSeconds,60);await p.toggleVideo();assert.equal(p.showVideo,false);release([{id:'first',url:'https://cmc.zju.edu.cn/a.mp4',live:false}]);await opening;assert.equal(p.showVideo,false);assert.equal(p.videoSource,undefined);assert.equal(p.videoBusy,false);
});


test('modal selection clearing and restored question focus preserve pane layers; an actual question touch still activates its pane',()=>{
 const {NativeSelections}=load('model/NativeSelections');const ai=componentFixture('AiPanel',{'../model/NativeSelections':{NativeSelections}});let raised=0,editing=0,stopped=0;ai.onDismissReturn=()=>{raised++};ai.onEditingFocus=()=>editing++;NativeSelections.bind('ai-modal-regression',()=>ai.clearTextSelection(),'ai');const p=indexLogicFixture(['featureAction'],{NativeSelections});const rects=[{id:'ai',x:0,y:0,w:1,h:1,z:1},{id:'video',x:0,y:0,w:1,h:1,z:2}];p.paneRects=rects;p.jumpDialog={open(){}};p.videoFullscreen=false;
 for(const action of ['overview','layout','time']){ai.conversationSelection=1;ai.turnSelection=0;p.featureAction(action);ai.questionFocused();assert.equal(ai.conversationSelection,0);assert.equal(ai.turnSelection,-1);assert.equal(raised,0,action+' must not raise AI');assert.equal(p.paneRects,rects);assert.equal(p.paneRects[1].z,2);}
 ai.questionTouched({type:0,stopPropagation:()=>stopped++});assert.equal(raised,1);assert.equal(editing,3);assert.equal(stopped,1);NativeSelections.unbind('ai-modal-regression');
});

test('reading-only transcript returns only after its anchored sentence leaves the viewport, and restores the exact vertical offset',()=>{
 const p=componentFixture('TranscriptPane');p.readingMode=true;p.lines=[{id:'a',t:20,text:'one'},{id:'b',t:30,text:'two'}];p.anchor(20,'a',-40);assert.equal(p.departed,false);p.anchorVisible(true);assert.equal(p.departed,false);p.anchorVisible(false);assert.equal(p.departed,true);let restored;p.onRestore=(at,offset)=>restored=[at,offset];p.returnToReading();assert.deepEqual(restored,[20,-40]);assert.equal(p.departed,false);p.anchorVisible(false);assert.equal(p.departed,false,'pending restoration must not flash the button');p.anchorVisible(true);p.anchorVisible(false);assert.equal(p.departed,true);p.anchor(30,'b',5);assert.equal(p.departed,false);p.lines=[{id:'a',t:20,text:'one'}];p.contentChanged();assert.equal(p.departed,true,'horizontal page change must retain its anchor');p.lessonChanged();assert.equal(p.anchorId,'');assert.equal(p.departed,false);
});
test('sentence partly visible stays in place; fully above or below the transcript viewport enables return, while another column cannot override it',()=>{
 const p=componentFixture('TranscriptColumn');p.trackSourceId='a';p.lines=[{id:'a',t:20,text:'one'}];p.scrollOffset=100;p.viewportHeight=100;const shown=[];p.onAnchorVisible=v=>shown.push(v);p.trackPosition(90,130);assert.equal(shown.at(-1),true);p.trackPosition(70,99);assert.equal(shown.at(-1),false);p.trackPosition(201,240);assert.equal(shown.at(-1),false);p.trackPosition(170,220);assert.equal(shown.at(-1),true);p.lines=[{id:'b',t:30,text:'other column'}];const count=shown.length;p.reportAnchorVisible();assert.equal(shown.length,count);p.held=true;p.following=true;p.scroller={currentOffset:()=>({yOffset:100}),scrollTo:()=>{throw Error('pointer hold must not auto-scroll')}};p.followSentence(500,530);
});
test('continuous transcript restoration is explicit even when the page key stays unchanged, with one offscreen anchor measured in long transcripts',()=>{
 const p=componentFixture('TranscriptText',{'@kit.ArkGraphics2D':{text:{RectWidthStyle:{TIGHT:0},RectHeightStyle:{MAX:0}}}});p.continuous=true;p.locateAt=30;p.visibleTop=200;p.visibleHeight=50;p.textWidth=300;p.shownLines=Array.from({length:100},(_,i)=>({id:'l'+i,t:i,text:'x'}));p.offsets=p.shownLines.map((_,i)=>i*2);p.renderedText=p.shownLines.map(()=> 'x').join('\n');p.trackSourceId='l30';p.getUIContext=()=>({vp2px:n=>n,px2vp:n=>n});p.controller={getLayoutManager:()=>({getGlyphPositionAtCoordinate:(x,y)=>({position:Math.floor(y/27)*2}),getRectsForRange:({start})=>[{rect:{top:Math.floor(start/2)*27,bottom:Math.floor(start/2)*27+27}}]})};let located=-1,tracked;p.onLocatePosition=top=>located=top;p.onTrackPosition=(top,bottom)=>tracked=[top,bottom];p.measureMarkers();assert.equal(located,810);assert.deepEqual(tracked,[810,837]);p.locateAt=70;p.locatePending=false;p.locateRequested();assert.equal(p.locatePending,true);p.measureMarkers();assert.equal(located,1890);assert.ok(p.markers.length<15);clearTimeout(p.measureTimer);
});
test('restoring reading-only transcript updates its lesson page and vertical position without seeking any video',()=>{
 const p=indexLogicFixture(['restoreTranscriptReading']);p.transcriptScrollSequence=3;p.returnOwner='transcript';let at,cleared=0;p.jumpToTime=v=>at=v;p.clearStudyReturn=()=>cleared++;p.followTranscript=true;p.restoreTranscriptReading(333,-12);assert.equal(at,333);assert.equal(p.transcriptReadingAt,333);assert.equal(p.transcriptReadingOffset,-12);assert.equal(p.transcriptScrollSequence,4);assert.equal(p.followTranscript,false);assert.equal(cleared,1);
});
test('batch calendar can navigate empty dates while permission checking continues and never admits unconfirmed courses to downloads',()=>{
 const p=componentFixture('DownloadSheet');p.byCourse=false;p.selectedDate='2026-10-10';p.available=[{...course,start:Date.parse('2026-10-10T08:00:00+08:00')/1000}];p.accessStates={};p.discovering=true;assert.equal(p.filteredCourses().length,0);assert.match(p.dateEmptyMessage(),/后台检查/);p.discovering=false;assert.match(p.dateEmptyMessage(),/选择其他日期/);p.accessStates={[course.subId]:'allowed'};assert.equal(p.dateEmptyMessage(),'');assert.equal(p.filteredCourses().length,1);const cells=load('model/CourseSections').calendarMonthGrid('2026-10',[]);assert.equal(cells.filter(c=>c.inMonth).length,31);assert.ok(cells.filter(c=>c.inMonth).every(c=>c.date && !c.count));
});

test('question timestamp navigation retains an undo point regardless of answer length or scroll position and undo restores the prior study state',()=>{
 const p=indexLogicFixture(['rememberJump','undoStudy','clearStudyReturn']);Object.assign(p,{course,selected:0,groups:[{slide:slide('a',0),lines:[]},{slide:slide('b',120),lines:[]}],following:false,followVideo:true,followTranscript:true,noteReferenceSequence:0});let position=45;p.learningTime=()=>position;p.jumpToTime=at=>{position=at;p.selected=at>=120?1:0};const ai=componentFixture('AiPanel');ai.turns=[{question:'本节内容',answer:'讲解。'.repeat(2000),at:45}];ai.scroller={currentOffset:()=>({yOffset:100})};ai.onJump=at=>{p.rememberJump('ai');p.jumpToTime(at);ai.returnVisible=p.returnOwner==='ai'};ai.onReturn=()=>{p.undoStudy();ai.returnVisible=p.returnOwner==='ai'};ai.jumpAnswer(0,125);assert.equal(position,125);assert.equal(ai.returnVisible,true);assert.equal(p.returnPoint.at,45);assert.equal(p.returnPoint.slideId,'a');ai.clearTextSelection();ai.questionFocused();assert.equal(ai.returnVisible,true,'focus restoration must not dismiss timestamp undo');ai.onReturn();assert.equal(position,45);assert.equal(p.selected,0);assert.equal(p.followVideo,true);assert.equal(p.followTranscript,true);assert.equal(ai.returnVisible,false);
});

const { PhotoViewport } = load('model/PhotoViewport');
test('photo pinch keeps off-centre content beneath the fingers and accumulates across gestures',()=>{
 const p=new PhotoViewport();p.resize(1000,800);p.image(1000,800);
 p.beginPinch(700,500);p.pinch(2,700,500);
 assert.equal(p.scale,2);assert.equal(p.x,-200);assert.equal(p.y,-100);
 assert.equal(500+p.x+200*p.scale,700);
 p.beginPinch(700,500);p.pinch(1.5,730,520);
 assert.equal(p.scale,3);assert.equal(500+p.x+200*p.scale,730);assert.equal(400+p.y+100*p.scale,520);
});
test('zoomed photo pans on both axes, clamps to actual letterboxed image and resets at fit',()=>{
 const p=new PhotoViewport();p.resize(1000,800);p.image(1600,900);p.beginPinch(500,400);p.pinch(2,500,400);
 p.beginPan();p.pan(9000,-9000);assert.equal(p.x,500);assert.equal(p.y,-162.5);
 p.beginPinch(500,400);p.pinch(.1,500,400);assert.equal(p.scale,1);assert.equal(p.x,0);assert.equal(p.y,0);
 p.beginPinch(500,400);p.pinch(99,500,400);assert.equal(p.scale,8);p.resize(800,1000);assert.equal(p.scale,1);
});
