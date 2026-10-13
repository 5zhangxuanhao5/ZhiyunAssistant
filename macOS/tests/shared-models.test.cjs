const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const directory=path.resolve(__dirname,'../web/models');
async function models(native){const context=vm.createContext({window:{native},console,URL,Date,Math,JSON,Number,Promise,Map,Set,Array,Object,Error}),modules=new Map();async function load(file){const name=path.resolve(directory,file);if(modules.has(name))return modules.get(name);const module=new vm.SourceTextModule(fs.readFileSync(name,'utf8'),{identifier:name,context});modules.set(name,module);await module.link((specifier,referencing)=>load(path.relative(directory,path.resolve(path.dirname(referencing.identifier),specifier))));return module}return async name=>{const module=await load(name+'.js');await module.evaluate();return module.namespace}}
function requests(){const calls=[],resolvers=[];return{calls,resolvers,native:{call(action,params){calls.push({action,params});if(action!=='request')return Promise.resolve(true);let resolve;const task=new Promise(r=>resolve=r);task.id='request-'+calls.length;resolvers.push(resolve);return task}}}}
const course={subId:'fixture-lesson',courseId:'fixture-course',start:100,end:200,status:6};
test('API cancellation forwards the native request ID and rejects a late generation result',async()=>{
  const f=requests(),load=await models(f.native),{Zhiyun}=await load('Zhiyun'),api=new Zhiyun();const pending=api.request('/userapi/v1/infosimple');assert.equal(api.pending.size,1);api.cancel();assert.equal(api.pending.size,0);assert.deepEqual(JSON.parse(JSON.stringify(f.calls[1])),{action:'cancelRequest',params:{id:'request-1'}});f.resolvers[0]({status:200,text:'{"params":{"id":"late"}}'});await assert.rejects(pending,/已取消/);assert.equal(api.pending.size,0);
});
test('successful and failed requests always release the tracked native handle',async()=>{
  const f=requests(),load=await models(f.native),{Zhiyun,AccessDenied}=await load('Zhiyun'),api=new Zhiyun();let pending=api.request('/authorized');f.resolvers[0]({status:200,text:'{"code":0}'});assert.equal(await pending,'{"code":0}');assert.equal(api.pending.size,0);pending=api.request('/denied');f.resolvers[1]({status:403,text:''});await assert.rejects(pending,AccessDenied);assert.equal(api.pending.size,0);assert.ok(!f.calls.some(c=>c.action==='cancelRequest'));
});
test('canceled permission scan never caches stale permissions or emits an allowed result',async()=>{
  const f=requests(),load=await models(f.native),{Zhiyun}=await load('Zhiyun'),api=new Zhiyun(),seen=[];const pending=api.permissions([course],states=>seen.push({...states}),true);api.cancel();f.resolvers[0]({status:200,text:'{"code":200,"data":{"fixture-lesson":{"video":1,"live":1}}}'});const result=await pending;assert.equal(result[course.subId],'unknown');assert.ok(seen.every(s=>s[course.subId]==='unknown'));assert.equal(api.permissionCache.size,0);assert.equal(api.permissionInflight.size,0);assert.equal(api.permissionActive,0);
});
test('missing-resource pane choices never overwrite normal course preferences',async()=>{
  const load=await models({call:()=>Promise.resolve(true)}),m=await load('PanePreferences'),normal={...m.defaultPaneChoices(),video:true},prefs={regular:normal,missing:{}};const missing=m.chosenPanes(prefs,['slides']);assert.equal(missing.slides,false);const updated=m.rememberPaneChoices(prefs,{...missing,notes:true},['slides']);assert.equal(updated.regular.slides,true);assert.equal(updated.regular.notes,false);assert.equal(m.chosenPanes(updated,['slides']).notes,true);assert.equal(m.chosenPanes(updated,[]).notes,false);
});
test('attendance cache displays old allowed rows only while the attendance snapshot is a subset',async()=>{
  const load=await models({call:()=>Promise.resolve(true)}),m=await load('AttendanceBatch'),c={...course,subId:'old'},added={...course,subId:'new'},cache=m.attendanceBatch([c],[c]);assert.equal(m.reusableAttendanceBatch([c,added],cache)[0].subId,'old');assert.equal(m.reusableAttendanceBatch([added],cache).length,0);
});
test('page-only layout can choose two-by-two instead of wasting four thin columns',async()=>{
  const load=await models({call:()=>Promise.resolve(true)}),m=await load('SlideGrid'),grid=m.slideGridLayout(1200,800,4,16/9);assert.equal(grid.columns,2);assert.equal(grid.rows,2);
});
