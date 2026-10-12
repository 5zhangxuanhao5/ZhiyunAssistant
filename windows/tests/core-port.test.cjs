// Inherited executable behavior checks from HarmonyOS 0.7.4.
// Tests exercise the Windows shared TS modules, not ArkUI source strings.
// No live credentials, paid API calls, external coursework or DevEco installation is required.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../src/shared');
const defaultCompat = {
 util: { TextEncoder: class { encodeInto(value) { return new TextEncoder().encode(value); } }, TextDecoder: class { constructor(encoding='utf-8'){ this.decoder=new TextDecoder(encoding); } static create(encoding){return new this(encoding);} decodeToString(value,opts){ return this.decoder.decode(value,opts); } }, Base64Helper: class { encodeToStringSync(bytes){return Buffer.from(bytes).toString('base64');} decodeSync(value){return new Uint8Array(Buffer.from(value,'base64'));} } },
 http: { RequestMethod:{GET:'GET',POST:'POST',HEAD:'HEAD'}, HttpDataType:{STRING:'STRING',ARRAY_BUFFER:'ARRAY_BUFFER'}, createHttp(){throw Error('This test must provide its isolated transport');} },
 webview:{WebCookieManager:{fetchCookieSync:()=>''}}, asset:{Tag:{ALIAS:'alias',SECRET:'secret'},query:async()=>[],add:async()=>{},remove:async()=>{}},
 fileIo:{}, fileUri:{}, common:{}, image:{}, webSocket:{}, taskpool:{}
};
function load(file, stubs={}, globals={}) {
 const filename=path.join(root,file+'.ts');
 const output=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const exports={};
 const compat=Object.assign({},defaultCompat,...Object.values(stubs));
 vm.runInNewContext(output,{exports,require:name=>name.includes('/desktop/compat')?compat:name.startsWith('.')?load(path.join(path.dirname(file),name),stubs,globals):stubs[name]||require(name),Date,Map,Set,Error,ArrayBuffer,Uint8Array,Buffer,URL,TextEncoder,TextDecoder,setTimeout,clearTimeout,console,...globals},{filename});
 return exports;
}
const timeline=load('model/Timeline');
const {Zhiyun,AccessDenied}=load('services/Zhiyun');
const course={subId:'sample',courseId:'example',title:'Fixture',teacher:'Fixture teacher',room:'Fixture room',status:'6',start:Date.parse('2026-10-09T08:00:00+08:00')/1000,end:Date.parse('2026-10-09T10:00:00+08:00')/1000};
const slide=(id,t)=>({id,t,url:`https://cmc.zju.edu.cn/${id}.png`,thumb:'',note:''});
const {blackBorderRegion}=load('model/BlackBorders');
const media=load('model/Media');
function rendererModule(name) {
 const filename=path.resolve(__dirname,'../src/renderer',name),exports={};
 const output=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 vm.runInNewContext(output,{exports,require:value=>value.endsWith('.css')?{}:require(value),Date,Set,Map,Error,Number,Array,Math,URL,TextEncoder,TextDecoder,console},{filename}); return exports;
}
test('desktop calendar uses only current month dates, stable six rows, leap years and bounded year navigation',()=>{
 const {monthCells,shiftMonth,validCalendarDate}=rendererModule('Calendar.tsx');
 for (const month of ['2026-09','2026-10','2024-02','2026-02','2027-01']) {
  const cells=monthCells(month);assert.equal(cells.length,42);const dates=cells.filter(cell=>cell.inMonth).map(cell=>cell.date);assert.equal(new Set(dates).size,dates.length);assert.ok(dates.every(date=>date.startsWith(month+'-')));assert.ok(cells.filter(cell=>!cell.inMonth).every(cell=>cell.date===''&&cell.day===0));
 }
 assert.equal(monthCells('2024-02').filter(cell=>cell.inMonth).length,29);assert.equal(monthCells('2026-02').filter(cell=>cell.inMonth).length,28);assert.equal(shiftMonth('2026-12',1),'2027-01');assert.equal(shiftMonth('2026-10',-12),'2025-10');assert.equal(shiftMonth('1900-01',-1),'1900-01');assert.equal(shiftMonth('9998-12',1),'9998-12');assert.equal(validCalendarDate('2026-02-29'),false);assert.equal(validCalendarDate('2024-02-29'),true);assert.throws(()=>monthCells('2026-13'));
});
test('desktop IME confirmation never sends a question, Shift Enter is newline and mouse/touchpad is not touch paging',()=>{
 const {shouldSendMessage,isComposingInput,isNativePointerSelection,normalizedWheel}=rendererModule('Selections.ts');
 assert.equal(shouldSendMessage({key:'Enter'}),true);assert.equal(shouldSendMessage({key:'Enter',shiftKey:true}),false);assert.equal(shouldSendMessage({key:'Enter',isComposing:true}),false);assert.equal(shouldSendMessage({key:'Enter',keyCode:229}),false);assert.equal(isComposingInput({key:'Process'}),true);assert.equal(shouldSendMessage({key:'Enter'},true),false);assert.equal(isNativePointerSelection({pointerType:'mouse'}),true);assert.equal(isNativePointerSelection({pointerType:'touch'}),false);assert.equal(normalizedWheel({deltaX:2,deltaY:3,deltaMode:1}).y,48);
});
test('desktop HLS absolute date-time anchors maintain the same course seconds across camera timeline offsets',()=>{
 const {timelineAnchor}=rendererModule('videoLogic.ts'),start=Date.parse('2026-10-12T08:00:00+08:00')/1000;
 const a=timelineAnchor([{start:12,programDateTime:(start+25)*1000}],start,true,90,start+300);
 const b=timelineAnchor([{start:3,programDateTime:new Date((start+25)*1000).toISOString()}],start,false,0,start+300);
 assert.equal(a+12,25);assert.equal(b+3,25);assert.equal(timelineAnchor([],start,true,90,start+300)+90,300);assert.equal(timelineAnchor([],start,false,90,start+300),undefined);
});
test('desktop production HLS configuration initializes live and replay players with matching duration-count defaults',()=>{
 const Hls=require('hls.js'),{playbackHlsConfig}=rendererModule('videoLogic.ts');
 for(const live of [false,true]) {const player=new Hls(playbackHlsConfig(live));assert.equal(player.config.lowLatencyMode,live);assert.equal(player.config.liveMaxLatencyDurationCount,Infinity);assert.equal(player.config.liveSyncDurationCount,3);assert.equal(player.config.maxLiveSyncPlaybackRate,1);assert.equal(player.config.backBufferLength,1800);player.destroy();}
});
test('desktop live DVR can rewind its retained range while live without history cannot fabricate a replay interval',()=>{
 const {courseVideoBounds,courseSeekTarget,replayAvailable}=rendererModule('videoLogic.ts');
 const dvr=courseVideoBounds([{start:100,end:400}],Infinity,620);assert.equal(dvr.start,720);assert.equal(dvr.end,1020);assert.equal(replayAvailable(0,dvr),true);assert.equal(courseSeekTarget(0,dvr,true),720.25);assert.equal(courseSeekTarget(9999,dvr,true),1019.75);
 const missing=courseVideoBounds([],Infinity,0);assert.equal(replayAvailable(0,missing),false);assert.equal(courseSeekTarget(10,missing,true),undefined);assert.equal(replayAvailable(1,missing),true);
});
test('desktop video gestures preserve direction, clamp actual range, and recorded end seeks stay before the ended restart boundary',()=>{
 const {courseVideoBounds,courseSeekTarget,draggedVideoTarget,boundedRate}=rendererModule('videoLogic.ts'),range=courseVideoBounds([],600,0);
 assert.equal(courseSeekTarget(900,range,false),599.85);assert.ok(draggedVideoTarget(300,-100,800,range,false)<300);assert.ok(draggedVideoTarget(300,100,800,range,false)>300);assert.equal(draggedVideoTarget(1,-500,800,range,false),0);assert.equal(boundedRate(NaN),1);assert.equal(boundedRate(99),16);assert.equal(boundedRate(0),.1);
});
test('release privacy scan rejects embedded credentials, developer paths, local account state and unapproved coursework images without echoing secrets',()=>{
 const {scanText,sensitiveEntry}=require('../scripts/package-audit.cjs');
 const credential='sk-'+ '0'.repeat(32),findings=scanText('prefix '+credential+' suffix');assert.equal(findings[0].kind,'private credential');assert.equal(JSON.stringify(findings).includes(credential),false);
 assert.equal(scanText(path.posix.join('/', 'Users', 'fixture-owner', 'Desktop', 'dev')).length,1);assert.equal(scanText("regex /^sk-[A-Za-z0-9]{16,200}$/").length,0);assert.equal(sensitiveEntry('resource-cache/slides/page.png'),'user or course resource directory');assert.equal(sensitiveEntry('last-account.json'),'private local state');assert.equal(sensitiveEntry('assets/course.png'),'unexpected course or user image');assert.equal(sensitiveEntry('dist/renderer/icon.png'),'');
});
test('release PE checks distinguish native x64 and ARM64 and reject truncated or unsupported executables',()=>{
 const {inspectPe}=require('../scripts/package-audit.cjs'),header=Buffer.alloc(256);header.writeUInt16LE(0x5a4d,0);header.writeUInt32LE(0x80,0x3c);header.writeUInt32LE(0x4550,0x80);header.writeUInt16LE(0x8664,0x84);assert.equal(inspectPe(header).arch,'x64');header.writeUInt16LE(0xaa64,0x84);assert.equal(inspectPe(header).arch,'arm64');assert.throws(()=>inspectPe(header.subarray(0,70)));header.writeUInt16LE(0xffff,0x84);assert.throws(()=>inspectPe(header));
});
function imageFixture(w,h,region,fill=255) {
 const pixels=new Uint8Array(w*h*4);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;const c=region&&x>=region.x&&x<region.x+region.width&&y>=region.y&&y<region.y+region.height?fill:0;pixels[i]=pixels[i+1]=pixels[i+2]=c;pixels[i+3]=255}
 return pixels;
}
class TestInputController {
 constructor(){this.value='';this.start=0;this.end=0;}
 getSelection(){return{start:this.start,end:this.end}} setTextSelection(start,end){this.start=start;this.end=end} clearPreviewText(){}
 deleteText({start,end}){this.value=this.value.slice(0,start)+this.value.slice(end)}
 addText(text,{offset}){this.value=this.value.slice(0,offset)+text+this.value.slice(offset)}
 caretPosition(offset){this.start=this.end=offset}
}
const inputGlobals={TouchType:{Down:0,Up:1,Move:2,Cancel:3},SourceType:{Touch:1,Mouse:2},SourceTool:{Finger:1,MOUSE:3,TOUCHPAD:4},TextInputController:TestInputController,KeyType:{Down:0,Up:1},MouseAction:{Press:1,Release:2,Move:3},MouseButton:{Left:1,Right:2}};
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
test('permission requests use two slots across concurrent searches and coalesce duplicate batches',async()=>{
 const api=new Zhiyun();let active=0,peak=0,calls=0;
 api.request=async(p,body)=>{const q=JSON.parse(body);calls++;active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,15));active--;return JSON.stringify({code:200,data:Object.fromEntries(q.sub_ids.map(id=>[id,{video:1}]))})};
 const courses=Array.from({length:6},(_,i)=>({...course,courseId:String(i),subId:String(i)}));
 await Promise.all([api.permissions(courses),api.permissions(courses.slice(0,1))]);
 assert.equal(peak,2);assert.equal(calls,6);
});
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
test('HLS refuses unsupported protection, external segments and invalid successful HTML responses',()=>{
 for(const raw of ['<html>please login</html>','#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="key"\na.ts','#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,KEYFORMAT="vendor",URI="key"\na.ts','#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="https://attacker.test/key"\na.ts','#EXTM3U\nhttps://attacker.test/a.ts'])assert.throws(()=>media.hlsPlan(raw,'https://cmc.zju.edu.cn/index.m3u8'));
});
test('video access revalidates before reading addresses and stops on explicit denial',async()=>{
 const api=new Zhiyun();let addresses=0;api.info=async()=>({sub_status:6});api.checkPermission=async()=>{throw new AccessDenied('denied')};api.request=async()=>{addresses++;return '{}'};
 await assert.rejects(api.videos({...course,status:'6'}),AccessDenied);assert.equal(addresses,0);
});
test('AI cut-off respects exact question time and whole-course option',()=>{
 const slides=[slide('early',0),slide('later',60)],lines=[{id:'a',t:30,text:'已讲过'},{id:'b',t:70,text:'后面讲'}];
 const early=media.contextLines(slides,lines,40,false);assert.match(early,/已讲过/);assert.doesNotMatch(early,/后面讲|60.0秒/);
 const whole=media.contextLines(slides,lines,40,true);assert.match(whole,/后面讲/);assert.match(whole,/60.0秒/);
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
test('download sections group all lessons of one course and deduplicate repeated lesson entries',()=>{
 const {courseSections}=load('model/CourseSections');
 const later={...course,subId:'second',start:course.start+86400},other={...course,courseId:'other',subId:'third'};
 const input=[course,later,other,course];
 const classes=courseSections(input,true);assert.equal(classes.length,2);assert.equal(classes.find(s=>s.id==='example').courses.length,2);
 const days=courseSections(input,false);assert.equal(days.length,2);assert.equal(days[0].courses[0].subId,'second');assert.equal(days[1].courses.length,2);
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
test('camera options collapse teacher qualities and signed mirrors while preserving distinct stream IDs',()=>{
 const sources=media.mediaSources({sub_status:6,content:{save_playback:{contents:'https://cmc.zju.edu.cn/main.mp4?token=a',play_addres_arr:{default:'https://cmc.zju.edu.cn/low.mp4',HD:'https://cmc.zju.edu.cn/high.mp4'}}},video_list:[{preview_url:'https://cmc.zju.edu.cn/main.mp4?token=b'},{preview_url:'https://classroom.zju.edu.cn/stream?id=room'},{preview_url:'https://classroom.zju.edu.cn/stream?id=teacher'}]});
 assert.equal(sources.length,3);assert.equal(sources.filter(s=>s.title.includes('教师主画面')).length,1);
});
test('caption times parse numeric milliseconds, Unix seconds, relative seconds and China-local strings',()=>{
 const {captionSeconds}=load('model/CaptionTime'),start=1791597600;
 for(const [value,expected] of [[1791598413046,813.046],['1791598413046',813.046],[1791598413,813],['813',813],['2026-10-10 10:13:33',813],[0,0]])assert.ok(Math.abs(captionSeconds(value,start)-expected)<1e-6);
 for(const value of [undefined,'','invalid'])assert.ok(Number.isNaN(captionSeconds(value,start)));
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
test('default full tablet layout leaves both slides wide enough and captions underneath',()=>{
 const {defaultPanes}=load('model/PaneLayout');const rects=defaultPanes(['slides','transcript'],false);const a=rects.find(r=>r.id==='slides'),b=rects.find(r=>r.id==='transcript');
 assert.equal(a.w,1);assert.equal(b.w,1);assert.equal(a.y+a.h,b.y);assert.equal(timeline.pageCapacity(a.w*1420,a.h*800,1420,945,false),2);
 const explicit=defaultPanes(['slides','transcript'],false,'columns');assert.equal(explicit[0].w,0.5);
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
test('note management folders include only lessons with notes and sort recent lessons first',()=>{
 const {studyFolders,safeFilename,selectedUnion}=load('model/StudyFolders'),later={...course,subId:'later',start:course.start+86400},other={...course,subId:'other',courseId:'other'};
 const folders=studyFolders([course,later,course,other]);assert.equal(folders.length,2);assert.deepEqual(Array.from(folders[0].lessons,c=>c.subId),['later','sample']);assert.equal(safeFilename('../unsafe/name:*?'),'unsafe name');assert.deepEqual(Array.from(selectedUnion(['outside'],['a','b'],true)),['outside','a','b']);
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
test('note management prioritizes the last opened note and its course and lesson folders',()=>{
 const {recentNoteFolders,noteOpenedAt}=load('model/NoteExport');
 const old={id:'old',course,openedAt:500,savedAt:1},newer={id:'new',course:{...course,subId:'new',start:course.start+86400},openedAt:300,savedAt:1000},other={id:'other',course:{...course,courseId:'other',subId:'third'},openedAt:700,savedAt:2};
 const folders=recentNoteFolders([old,newer,other]);assert.equal(folders[0].id,'other');assert.deepEqual(Array.from(folders[1].lessons,l=>l.subId),['sample','new']);assert.equal(noteOpenedAt({savedAt:12}),12);
});
test('archive naming preserves course teacher term and date with readable image names and collision protection',()=>{
 const {noteExportCourse,noteExportDate,noteExportName,notePictureName,uniqueExportName}=load('model/NoteExport');const note={title:'课堂笔记1',course:{...course,title:'公共关系学',teacher:'老师',term:'2026秋季学期'}};
 assert.equal(noteExportCourse(note),'公共关系学_老师_2026秋季学期');assert.equal(noteExportDate(note),'2026-10-09');assert.equal(noteExportName(note),'课堂笔记1');assert.equal(notePictureName('课堂笔记1',2,'png'),'课堂笔记1_图片2.png');const used=new Set();assert.equal(uniqueExportName('课堂笔记1',used),'课堂笔记1');assert.equal(uniqueExportName('课堂笔记1',used),'课堂笔记1 (2)');
});
test('note export obtains official school term dates and uses cached dates while offline',async()=>{
 const api=new Zhiyun(),values=new Map(),store={readJson:k=>values.get(k)||'',saveJson:(k,v)=>values.set(k,v)};api.request=async()=>JSON.stringify({result:{data:{'2026-2027':{autumn:{begin_date:'2026-09-01',end_date:'2026-11-01'}}}}});const lesson={...course};await api.annotateTerms({tenantId:1},[lesson],store);assert.equal(lesson.term,'2026—2027学年 · 秋季学期');const offline=new Zhiyun();offline.request=async()=>{throw Error('offline')};const next={...course};await offline.annotateTerms({tenantId:1},[next],store);assert.equal(next.term,lesson.term);
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
test('permission progress distinguishes cached prefill from freshly confirmed result IDs',async()=>{
 const api=new Zhiyun(),progress=[];api.request=async()=>JSON.stringify({code:200,data:{sample:{video:1}}});
 await api.permissions([course],(states,confirmed)=>progress.push(Array.from(confirmed||[])),true);
 assert.deepEqual(progress,[[],['sample']]);
});
test('merging can be switched off without destroying raw screenshots or transcription boundaries',()=>{
 const raw=[slide('a',0),{...slide('b',30),duplicateOf:'a',duplicateUrl:slide('a',0).url},slide('c',90)], lines=[{id:'first',t:10,text:'first'},{id:'second',t:50,text:'second'},{id:'third',t:100,text:'third'}];
 const merged=timeline.groupPages(raw,lines,true), original=timeline.groupPages(raw,lines,false);
 assert.deepEqual(Array.from(merged,g=>[g.slide.id,Array.from(g.lines,l=>l.id)]),[['a',['first','second']],['c',['third']]]);
 assert.deepEqual(Array.from(original,g=>[g.slide.id,Array.from(g.lines,l=>l.id)]),[['a',['first']],['b',['second']],['c',['third']]]);assert.equal(raw.length,3);
});
test('permission-only course catalogue skips per-lesson metadata hydration',async()=>{
 const api=new Zhiyun(),calls=[];api.request=async route=>{calls.push(route);return JSON.stringify({result:{data:[{id:9,course_begin:course.start,course_over:0}]}})};
 const rows=await api.chapters({courseId:'88',title:'Test',teacher:'T',room:'R',type:''},false);assert.equal(rows.length,1);assert.equal(calls.length,1);assert.equal(rows[0].end,0);
});
test('lesson progress rejects another lesson, malformed state and invalid times',()=>{
 const {readLearningProgress}=load('model/LearningProgress');const saved={schema:1,subId:course.subId,courseId:course.courseId,seconds:72,slideId:'a',slideSeconds:60,video:true,followVideo:true,savedAt:1};
 assert.equal(readLearningProgress(JSON.stringify(saved),course).seconds,72);for(const extra of [{subId:'another'},{courseId:'another'},{seconds:-1},{seconds:null},{slideSeconds:-1},{schema:2}]) assert.equal(readLearningProgress(JSON.stringify({...saved,...extra}),course),undefined);assert.equal(readLearningProgress('bad',course),undefined);
});
test('progress resumes exact browsed page or playback time including when duplicate merging changes the page identity',()=>{
 const {progressPage}=load('model/LearningProgress'), groups=timeline.groupPages([slide('a',0),slide('b',60),slide('c',120)],[]), saved={seconds:137,slideId:'b',slideSeconds:60,video:true,followVideo:true};
 assert.equal(progressPage(groups,saved),2);assert.equal(progressPage(groups,{...saved,followVideo:false}),1);assert.equal(progressPage(groups,{...saved,video:false}),1);assert.equal(progressPage(groups,{...saved,slideId:'removed',slideSeconds:85,video:false}),1);
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
test('a collection folder toggles its listed lessons without accidentally subscribing the entire course',()=>{
 const {CourseCollections}=load('model/CourseCollections'),collections=new CourseCollections(),second={...course,subId:'second'},unselected={...course,subId:'third'};
 collections.toggleSelection('later',course,[course,second],false);assert.equal(collections.hasLesson('later',second),true);assert.equal(collections.hasLesson('later',unselected),false);collections.toggleSelection('later',course,[course,second],false);assert.equal(collections.entries('later').length,0);
 collections.toggleCourse('favourite',course,[course,second]);collections.toggleLesson('favourite',second);assert.equal(collections.hasCourse('favourite',course.courseId),false);assert.equal(collections.hasSelection('favourite',course.courseId),true);
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
test('duplicate detector tolerates dense capture compression noise without treating a changed glyph as duplicate',()=>{
 const {screenshotsEqual}=load('model/SlideSimilarity'),w=128,h=128,a=new Uint8Array(w*h*4),b=new Uint8Array(w*h*4);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;for(let c=0;c<3;c++){a[i+c]=100+(x+y+c)%80;b[i+c]=a[i+c]+((x+y)%2?12:-12)}a[i+3]=b[i+3]=255}
 assert.equal(screenshotsEqual(a,b,w,h,w*4,w*4),true);for(let y=50;y<57;y++)for(let x=50;x<57;x++){const i=(y*w+x)*4;b[i]=b[i+1]=b[i+2]=0}assert.equal(screenshotsEqual(a,b,w,h,w*4,w*4),false);
});
test('local changed glyphs are rejected even when they straddle four comparison tiles on a high-resolution slide',()=>{
 const {screenshotsEqual}=load('model/SlideSimilarity'),w=640,h=360,a=new Uint8Array(w*h*4);for(let i=0;i<a.length;i+=4){a[i]=a[i+1]=a[i+2]=200;a[i+3]=255}const b=new Uint8Array(a);
 for(let y=14;y<18;y++)for(let x=14;x<18;x++){const i=(y*w+x)*4;b[i]=b[i+1]=b[i+2]=0}assert.equal(screenshotsEqual(a,b,w,h,w*4,w*4),false);
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
test('merged adjacent slides keep a single chronologically ordered transcript including exact boundaries',()=>{
 const a=slide('a',0),b={...slide('b',30),duplicateOf:'a',duplicateUrl:a.url},c=slide('c',60),d={...slide('d',90),duplicateOf:'a',duplicateUrl:a.url};
 const lines=[{id:'late',t:50,text:'second'},{id:'next',t:60,text:'next'},{id:'early',t:10,text:'first'},{id:'later',t:90,text:'non-adjacent'}];
 const grouped=timeline.groupPages([a,b,c,d],lines,true);
 assert.deepEqual(Array.from(grouped,g=>[g.slide.id,Array.from(g.lines,l=>l.id)]),[['a',['early','late']],['c',['next']],['d',['later']]]);
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
test('AI and summary note sources preserve their return references through insertion, slicing and legacy restore',()=>{
 const {sliceNoteAtoms,noteBlocks,defaultNotePalette,validNotePalette,blockTitle}=load('model/NoteBlocks');const reference={kind:'question',courseId:course.subId,sessionId:'chat-1',turn:2,at:42},atom={id:'q',kind:'question',value:'selected fixture answer',at:42,end:42,sourceId:'',bold:false,italic:false,underline:false,reference};
 assert.equal(sliceNoteAtoms([atom],0,8)[0].reference.sessionId,'chat-1');assert.equal(noteBlocks({atoms:[atom],anchors:[]})[0].source,'question');assert.equal(noteBlocks({atoms:[{...atom,kind:'summary'}],anchors:[]})[0].source,'summary');assert.notEqual(defaultNotePalette().question,defaultNotePalette().summary);assert.equal(validNotePalette({notes:'#FFF5D9'}).question,defaultNotePalette().question);assert.equal(blockTitle('summary'),'本页速览');
});
test('cross-course citations tolerate common formatting without turning unknown lessons into current-lesson links',()=>{
 const {courseAnswerParts}=load('model/CourseReference'),{lessonLabel}=load('model/CourseContext');const prior={...course,subId:'prior',start:course.start-86400,end:course.end-86400},label=lessonLabel(prior),context={lessons:[{course:prior,slides:[],lines:[]}],gaps:[]};
 for(const value of ['【'+label+' · 01:20】',label+'课次：01:20','**'+label+' · [01:20]**',label+' 的 01:20']){const parts=courseAnswerParts(value,context),link=parts.find(p=>p.course);assert.ok(link,value);assert.equal(link.course.subId,'prior');assert.equal(link.seconds,80);}
 assert.equal(courseAnswerParts('2026-01-01 08:00 · 01:20',context).some(p=>p.seconds>=0),false);assert.equal(courseAnswerParts(label+' · 01:80',context).some(p=>p.course),false);assert.equal(courseAnswerParts(label+' · 999:20',context).some(p=>p.course),false);
});
test('mouse selection has a movement threshold and supports backwards and multiline drag without selecting timestamps',()=>{
 const {MouseTextRange}=load('model/MouseTextRange'),range=new MouseTextRange();range.begin(20,100,100);assert.equal(range.move(21,102,102),undefined);assert.deepEqual({...range.move(3,60,60)},{start:3,end:20});assert.deepEqual({...range.end()},{start:3,end:20});assert.equal(range.move(80,200,200),undefined);range.begin(10,100,100);assert.deepEqual({...range.move(100,120,140)},{start:10,end:100});range.cancel();assert.equal(range.end(),undefined);
});
test('large continuous transcripts coalesce adjacent equal highlighting instead of creating thousands of text spans',()=>{
 const {transcriptRuns}=load('model/TranscriptRender'),offsets=Array.from({length:10000},(_,i)=>i*2),value='a\n'.repeat(10000),runs=transcriptRuns(value,offsets,-1,offsets.map((_,i)=>i));assert.equal(runs.length,1);assert.equal(runs[0].value,value);assert.equal(runs[0].highlight,true);const spoken=transcriptRuns(value,offsets,5000,offsets.map((_,i)=>i));assert.equal(spoken.length,3);assert.equal(spoken.map(r=>r.value).join(''),value);
});
test('continuous playback lookup handles large timelines, equal timestamps and silent gaps',()=>{
 const {spokenLineIndex}=load('model/TranscriptPlayback'),lines=Array.from({length:10000},(_,i)=>({id:String(i),t:i*10,end:i*10+5,text:'fixture'}));assert.equal(spokenLineIndex(lines,90001),9000);assert.equal(spokenLineIndex(lines,90007),-1);assert.equal(spokenLineIndex(lines,99995),-1);assert.equal(spokenLineIndex([{t:0,end:2},{t:0,end:3}],1),1);assert.equal(spokenLineIndex([],0),-1);
});
test('modal selection dismissal clears every mounted editor and never calls disposed editors',()=>{
 const {NativeSelections}=load('model/NativeSelections');let text=0,editor=0;NativeSelections.bind('text',()=>text++);NativeSelections.bind('broken',()=>{throw Error('disposed native controller')});NativeSelections.bind('editor',()=>editor++);NativeSelections.clear();assert.equal(text,1);assert.equal(editor,1);NativeSelections.unbind('text');NativeSelections.unbind('editor');NativeSelections.clear();assert.equal(text,1);assert.equal(editor,1);NativeSelections.unbind('broken');
});
test('touchpad press-drag is pointer selection, finger swipes remain touch gestures',()=>{
 const globals={SourceType:{Touch:1,Mouse:2},SourceTool:{Finger:1,MOUSE:3,TOUCHPAD:4}}, {pointerSelection}=load('model/PointerInput',{},globals);
 assert.equal(pointerSelection(1,4),true);assert.equal(pointerSelection(2,3),true);assert.equal(pointerSelection(1,1),false);
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
test('two-finger axis swipe turns only once per gesture and vertical scrolling never turns pages',()=>{
 const {AxisPaging}=load('model/AxisPaging'),axis=new AxisPaging();assert.equal(axis.move(0,10,1,1000),0);assert.equal(axis.move(2,50,2,1010),0);assert.equal(axis.move(0,0,3,1020),0);
 assert.equal(axis.move(15,0,1,1100),0);assert.equal(axis.move(20,0,2,1110),-1);assert.equal(axis.move(100,0,2,1120),0);assert.equal(axis.move(0,0,3,1130),0);assert.equal(axis.move(-35,0,1,1140),1);assert.equal(axis.move(0,0,4,1150),0);
});
test('reference time equal to lesson opening clock still links the relative timestamp, never the date heading',()=>{
 const {courseAnswerParts}=load('model/CourseReference'),prior={...course,subId:'prior',start:course.start-86400,end:course.end-86400},context={lessons:[{course:prior,slides:[],lines:[]}]};const body='【2026-10-08 08:00课次 · 08:00】',parts=courseAnswerParts(body,context);assert.equal(parts.map(p=>p.value).join(''),body);assert.equal(parts.filter(p=>p.seconds>=0).length,1);assert.equal(parts.filter(p=>p.seconds>=0)[0].seconds,480);
});
test('unmounting an old summary cannot remove the next lesson snapshot reader',()=>{
 const {SummaryViewController}=load('model/SummaryView'),controller=new SummaryViewController(),old=()=>({courseId:'old'}),next=()=>({courseId:'new'});controller.bind(old);controller.bind(next);controller.unbind(old);assert.equal(controller.capture().courseId,'new');controller.unbind(next);assert.equal(controller.capture(),undefined);
});
test('selection shortcuts work when hardware modifier state is missing and reset on Ctrl release',()=>{
 const {SelectionKeys}=load('model/SelectionKeys');const event={type:0,keyCode:2072,keyText:'',getModifierKeyState:()=>false};SelectionKeys.update(event);
 for(const [code,command] of [[2017,'a'],[2019,'c'],[2038,'v']])assert.equal(SelectionKeys.command({...event,keyCode:code}),command);
 SelectionKeys.update({...event,type:1});assert.equal(SelectionKeys.command({...event,keyCode:2017}),'');assert.equal(SelectionKeys.command({...event,keyCode:2038,getModifierKeyState:()=>true}),'v');SelectionKeys.reset();
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
test('AI confidence must be a valid probability and invalid timing never produces a removable segment',()=>{
 const {conservativeRanges}=load('model/SmartSkip'),group={slide:slide('a',0),lines:[{id:'n',t:0,end:10,text:'嗯啊'}]},decision={spans:[{ids:['n'],kind:'noise',confidence:99}],emptyPage:true,confidence:99,visual:'blank'};assert.equal(conservativeRanges(group,20,decision,true,false).length,0);assert.equal(conservativeRanges({...group,lines:[{...group.lines[0],end:NaN}]},20,{...decision,confidence:1},true,false).length,0);
});
test('collections put only wholly upcoming folders last and ignore excluded lessons when classifying',()=>{
 const {pendingCollection,orderedCollections}=load('model/CollectionView'),now=course.end;
 const past={course,lessons:[course],excluded:[],whole:false},futureCourse={...course,subId:'f',courseId:'f',start:now+100,end:now+1000,status:'0'},future={course:futureCourse,lessons:[futureCourse],excluded:[],whole:false},mixed={course:{...course,courseId:'m'},lessons:[course,futureCourse],excluded:[],whole:true};
 assert.equal(pendingCollection(future,now),true);assert.equal(pendingCollection(mixed,now),false);assert.equal(pendingCollection({...mixed,excluded:[course.subId]},now),true);assert.equal(pendingCollection({...past,excluded:[course.subId]},now),false);
 assert.deepEqual(Array.from(orderedCollections([future,past,mixed],now),entry=>entry.course.courseId),[course.courseId,'m','f']);assert.equal(pendingCollection(future,now+200),false);
});
test('timestamps stay separated and invalid unmeasured positions never create overlapping placeholder timestamps',()=>{
 const {spacedMarkers,readingMarker}=load('model/TranscriptMarkers');const values=spacedMarkers([{index:1,top:27,bottom:54},{index:0,top:0,bottom:27},{index:2,top:27,bottom:54},{index:3,top:NaN,bottom:NaN},{index:4,top:0,bottom:0}],27);assert.deepEqual(Array.from(values,item=>item.top),[0,27,54]);assert.equal(readingMarker(values,40,200).index,1);assert.equal(readingMarker(values,100,20),undefined);
});
test('question prose overrides UI defaults for whole lesson and explicit page ranges, while ordinary questions keep before-only scope',()=>{
 const {questionScope}=load('model/QuestionScope'),slides=[slide('a',0),slide('b',60),slide('c',120),slide('d',180)];
 assert.deepEqual(JSON.parse(JSON.stringify(questionScope('总结整节课',slides,false,['b']))),{whole:true,selectedIds:[]});assert.deepEqual(Array.from(questionScope('结合第2、4页讲解',slides,false,[]).selectedIds),['b','d']);assert.deepEqual(Array.from(questionScope('第2-3页讲了什么',slides,true,['a']).selectedIds),['b','c']);assert.equal(questionScope('不要结合整节课，解释当前内容',slides,true,[]).whole,false);assert.equal(questionScope('截止目前讲了什么',slides,false,[]).whole,false);assert.equal(questionScope('第100-999999999页',slides,false,[]).selectedIds.length,0);
});
test('clearing selections outside one pane preserves that panes whole selection but dismisses every other editor',()=>{
 const {NativeSelections}=load('model/NativeSelections');let notes=0,ai=0,transcript=0;NativeSelections.bind('note',()=>notes++,'notes');NativeSelections.bind('ai',()=>ai++,'ai');NativeSelections.bind('transcript',()=>transcript++,'transcript');NativeSelections.clearExcept('notes');assert.deepEqual([notes,ai,transcript],[0,1,1]);NativeSelections.clear();assert.deepEqual([notes,ai,transcript],[1,2,2]);
});
test('selected answer references preserve bold, italic, line breaks, code and separately clickable course times through persistence',()=>{
 const {selectedAnswerParts,referenceAtoms,noteAnswerParts}=load('model/NoteFormatting');const parts=[{value:'Heading\n',bold:true,italic:false,code:false,seconds:-1},{value:'explain ',bold:false,italic:true,code:false,seconds:-1},{value:'[01:00]',bold:false,italic:false,code:false,seconds:60,course},{value:'\nformula',bold:false,italic:false,code:true,seconds:-1}];const selected=selectedAnswerParts(parts,2,100);assert.equal(selected[0].value,'ading\n');assert.equal(selected[0].bold,true);const insertion={kind:'summary',formatted:selected,value:selected.map(p=>p.value).join(''),at:20,end:20,sourceId:'',reference:{kind:'summary',courseId:course.subId,pageId:'a',at:20}};const atoms=referenceAtoms(insertion),restored=noteAnswerParts({atoms:JSON.parse(JSON.stringify(atoms))});assert.equal(restored[0].bold,true);assert.equal(restored[1].italic,true);assert.equal(restored[2].seconds,60);assert.equal(restored[2].course.subId,course.subId);assert.equal(restored[3].code,true);assert.equal(restored.map(p=>p.value).join(''),insertion.value);
});
test('AI segment filtering removes breaks within a useful slide without deleting adjacent teaching or their timestamps',()=>{
 const {conservativeRanges,filteredTranscript}=load('model/SmartSkip');const lines=[{id:'teach',t:0,end:20,text:'概念讲解'},{id:'chat',t:30,end:36,text:'中午去食堂吃面'},{id:'noise',t:37,end:42,text:'嗯啊'},{id:'next',t:100,end:110,text:'继续讲课'}];const group={slide:slide('a',0),lines},decision={visual:'slide',emptyPage:false,confidence:1,spans:[{ids:['chat','noise'],kind:'break',confidence:1,reason:'已明确进入休息，内容与课程无关'}]};const ranges=conservativeRanges(group,150,decision,true,false);assert.equal(ranges.length,1);assert.deepEqual([ranges[0].start,ranges[0].end],[30,100]);assert.deepEqual(Array.from(filteredTranscript(lines,ranges),l=>l.id),['teach','next']);assert.equal(conservativeRanges(group,150,{...decision,spans:[{ids:['teach'],kind:'chatter',confidence:1,reason:'wrong'}]},true,false).length,0);
});
test('attendance batch cache reuses additions with current metadata but any removed attendance record invalidates the whole cache',()=>{
 const {attendanceBatch,reusableAttendanceBatch}=load('model/AttendanceBatch');const other={...course,subId:'second'},fresh={...course,title:'updated'},cache=attendanceBatch([course,other],[course]);assert.deepEqual(Array.from(reusableAttendanceBatch([fresh,other,{...course,subId:'new'}],cache),c=>c.title),['updated']);assert.equal(reusableAttendanceBatch([fresh],cache).length,0);assert.equal(reusableAttendanceBatch([fresh],{...cache,schema:99}).length,0);
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
test('tiny AI-confirmed first-page noise joins its silent lead and the next confirmed fragment immediately, without waiting for all pages',()=>{
 const {conservativeRanges,mergedSkipRanges}=load('model/SmartSkip');const first={id:'first',t:18,end:28,text:'对。',timing:'history'},next={id:'next',t:28,end:34,text:'嗯。',timing:'history'},knowledge={id:'lecture',t:212,end:236,text:'我们进入18世纪启蒙运动',timing:'history'};
 const a=conservativeRanges({slide:slide('first',2),lines:[first]},20,{spans:[{ids:['first'],kind:'noise',confidence:.95,reason:'开课前无意义收音'}]},true,false);assert.equal(a.length,1);
 const initial=mergedSkipRanges(a,[first,next,knowledge],true);assert.deepEqual(Array.from(initial,r=>[r.start,r.end]),[[0,20]]);
 const partial=mergedSkipRanges(a.concat([{start:28,end:212,ids:['next'],reason:'无实质讲解',pageId:'second'}]),[first,next,knowledge],true);assert.deepEqual(Array.from(partial,r=>[r.start,r.end]),[[0,212]]);
 const live=mergedSkipRanges(a,[first,next,knowledge],false);assert.equal(live[0].start,18);const retained=mergedSkipRanges(a.concat([{start:28,end:212,ids:['next'],reason:'noise',pageId:'second'}]),[first,{id:'useful',t:21,text:'答案是传播学'},next,knowledge],true);assert.equal(retained.length,2);
});
test('all four study panes cancel their own native and whole selections on blank focus without affecting another pane',()=>{
 const {NativeSelections}=load('model/NativeSelections'),cleared=[];for(const group of ['notes','transcript','ai','summary'])NativeSelections.bind(group,()=>cleared.push(group),group);for(const group of ['notes','transcript','ai','summary']){cleared.length=0;NativeSelections.clearGroup(group);assert.deepEqual(cleared,[group]);}NativeSelections.clear();assert.equal(cleared.length,5);for(const group of ['notes','transcript','ai','summary'])NativeSelections.unbind(group);
});
test('a duplicate mouse/touch down event during touchpad drag never changes the original selection anchor',()=>{
 const {MouseTextRange}=load('model/MouseTextRange'),range=new MouseTextRange();range.begin(10,10,100);range.move(30,10,140);range.begin(30,10,140);assert.deepEqual({...range.move(2,10,80)},{start:2,end:10});range.end();range.begin(50,10,200);assert.deepEqual({...range.move(65,10,250)},{start:50,end:65});range.cancel();
});
test('pressed selection survives duplicate pane clear events; release restores clearing, forced exit always clears',()=>{
 const {NativeSelections}=load('model/NativeSelections'),cleared=[];NativeSelections.bind('editor',()=>cleared.push('editor'),'notes');NativeSelections.bind('whole',()=>cleared.push('whole'),'notes');NativeSelections.bind('other',()=>cleared.push('other'),'summary');NativeSelections.hold('editor',true);NativeSelections.clearGroup('notes');assert.equal(cleared.length,0);NativeSelections.clearExcept('summary');assert.equal(cleared.length,0);NativeSelections.hold('editor',false);NativeSelections.clearGroup('notes');assert.deepEqual(cleared,['editor','whole']);NativeSelections.hold('editor',true);NativeSelections.clear();assert.deepEqual(cleared.slice(2),['editor','whole','other']);NativeSelections.clearGroup('notes');assert.equal(cleared.length,7);for(const id of ['editor','whole','other'])NativeSelections.unbind(id);
});
test('background keyboard commands target only the chosen text group and ignore other panes',()=>{
 const {NativeSelections}=load('model/NativeSelections');let first=0,other=0;NativeSelections.bind('summary',()=>{},'summary',event=>{first++;return event.keyText==='a'});NativeSelections.bind('notes',()=>{},'notes',()=>{other++;return true});assert.equal(NativeSelections.keyGroup('summary',{keyText:'a'}),true);assert.equal(first,1);assert.equal(other,0);assert.equal(NativeSelections.keyGroup('missing',{keyText:'a'}),false);NativeSelections.unbind('summary');NativeSelections.unbind('notes');
});
