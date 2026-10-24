const test=require('node:test'),assert=require('node:assert/strict');
const {runtime}=require('./runtime-helper.cjs');
async function fixture(t){const r=runtime({extraTestingNames:['regroup','overview','renderOverview','seek','updateSessionRecovery','noteSessionInactive','resumeAfterIdle']});const app=(await r.load('app.js')).testing;app.setup();await app.enter(r.current);t.after(async()=>{app.closeModal();app.cleanup();await new Promise(resolve=>setTimeout(resolve,40));r.win.close()});return{r,app,doc:r.win.document};}
test('overview activation preserves the exact selected ID when pages share a timestamp',async t=>{
 const{app,doc}=await fixture(t);const slides=[{id:'a',t:0,url:'https://cmc.zju.edu.cn/a.png'},{id:'b',t:60,url:'https://cmc.zju.edu.cn/b.png'},{id:'c',t:60,url:'https://cmc.zju.edu.cn/c.png'},{id:'d',t:120,url:'https://cmc.zju.edu.cn/d.png'}];
 app.put({slides,index:0,prefs:{duplicates:false,skip:false}});app.regroup();app.overview(false);doc.querySelector('.overview-item[data-id="b"]').click();assert.equal(app.state().groups[app.state().index].slide.id,'b');assert.equal(app.state().at,60);assert.equal(doc.querySelector('#modal').hidden,true);
});
test('overview uses lazy original images and keeps their DOM nodes while changing columns',async t=>{
 const{app,doc}=await fixture(t);app.put({slides:[{id:'original',t:0,url:'https://cmc.zju.edu.cn/original.png',thumb:'https://cmc.zju.edu.cn/thumb.jpg'}],prefs:{duplicates:false,skip:false}});
 app.regroup();app.overview(false);
 const image=doc.querySelector('.overview-item img');assert.match(decodeURIComponent(image.src),/original\.png/);assert.equal(image.getAttribute('loading'),'lazy');assert.equal(image.getAttribute('decoding'),'async');
 [...doc.querySelectorAll('#modalToolbar button')].find(b=>b.textContent==='＋').click();assert.equal(doc.querySelector('.overview-item img'),image);
 image.dispatchEvent(new doc.defaultView.Event('error'));assert.match(decodeURIComponent(image.src),/thumb\.jpg/);app.renderOverview();assert.match(decodeURIComponent(image.src),/thumb\.jpg/);
});
test('a previous expired response cannot permanently lock subsequent successful requests',async t=>{
 const{r,app,doc}=await fixture(t);app.updateSessionRecovery(true);const result=await app.api.request('/userapi/v1/infosimple');assert.match(result,/fixture/);assert.equal(doc.querySelector('[data-session-recovery]'),null);assert.equal(r.calls.some(([name])=>name==='logout'),false);
});
test('idle restoration refreshes online data while preserving the lesson and live note editor',async t=>{
 const{r,app,doc}=await fixture(t);app.togglePane('notes');const editor=app.state().notesEditor,stage=doc.querySelector('#stage');editor.insertFragment('Preserve this note',true);app.put({at:75,index:1});
 app.noteSessionInactive(1000);const before=r.calls.length;await app.resumeAfterIdle(122000);
 assert.equal(app.state().page,'study');assert.equal(app.state().at,75);assert.equal(app.state().notesEditor,editor);assert.equal(doc.querySelector('#stage'),stage);assert.ok(r.calls.slice(before).some(([action])=>action==='request'));assert.equal(r.calls.slice(before).some(([action])=>['logout','login','authorizeCredentials'].includes(action)),false);
 const requests=r.calls.filter(([action])=>action==='request').length;await app.resumeAfterIdle(122100);assert.equal(r.calls.filter(([action])=>action==='request').length,requests);
});
test('brief window switches and local-only pages do not create idle network traffic',async t=>{
 const{r,app}=await fixture(t);app.noteSessionInactive(1000);const before=r.calls.length;await app.resumeAfterIdle(4000);assert.equal(r.calls.length,before);await app.go('offline');app.noteSessionInactive(1000);const local=r.calls.length;await app.resumeAfterIdle(200000);assert.equal(r.calls.length,local);
});
test('network loss after idle keeps the identity, lesson and note editor',async t=>{
 const{r,app}=await fixture(t);app.togglePane('notes');const editor=app.state().notesEditor;app.api.account=async()=>{throw Error('Offline')};app.noteSessionInactive(1000);await app.resumeAfterIdle(122000);assert.equal(app.state().page,'study');assert.equal(app.state().notesEditor,editor);assert.equal(r.calls.some(([action])=>action==='logout'),false);
});

test('video updates do not replace an explicitly chosen page with its same-time neighbour',async t=>{
 const{r,app,doc}=await fixture(t);app.put({slides:[{id:'a',t:0,url:'https://cmc.zju.edu.cn/a.png'},{id:'b',t:60,url:'https://cmc.zju.edu.cn/b.png'},{id:'c',t:60,url:'https://cmc.zju.edu.cn/c.png'},{id:'d',t:120,url:'https://cmc.zju.edu.cn/d.png'}],prefs:{duplicates:false,skip:false}});app.regroup();app.togglePane('video');app.overview(false);doc.querySelector('[data-id="b"]').click();
 const video=doc.querySelector('video');video.dispatchEvent(new r.win.Event('timeupdate'));assert.equal(app.state().groups[app.state().index].slide.id,'b');video.currentTime=121;video.dispatchEvent(new r.win.Event('timeupdate'));assert.equal(app.state().groups[app.state().index].slide.id,'d');
});

test('official no-class schedule envelope is readable without removing cached history',async()=>{
 const r=runtime();try{const {normalizeScheduleEnvelope}=await r.load('mac-api.js');const value=normalizeScheduleEnvelope({result:{code:400,msg:'课表为空'}});assert.equal(value.days.length,0);assert.equal(value.authoritative,false);assert.throws(()=>normalizeScheduleEnvelope({result:{code:400,msg:'服务错误'}}));assert.throws(()=>normalizeScheduleEnvelope({code:401,result:{code:400,msg:'课表为空'}}));}finally{r.win.close();}
});
