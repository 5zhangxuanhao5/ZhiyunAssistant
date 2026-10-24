const test=require('node:test');const assert=require('node:assert/strict');const {runtime}=require('./runtime-helper.cjs');
test('selecting local Gemma only reads metadata; inference keeps its own model and history path',async()=>{
 const r=runtime();try{const {AIConnection}=await r.load('ai-connection.js');const prefs={aiProvider:'local'},calls=[];
 const c=new AIConnection({call:async action=>{calls.push(action);if(action==='aiStatus')return{personalReady:true,campusReady:true};if(action==='localAIStatus')return{localReady:true,localModels:['gemma4:31b-mlx']};throw Error('unexpected inference');}},()=>prefs);
 assert.equal(await c.refresh(),true);assert.equal(c.effective(),'local');assert.deepEqual(calls,['aiStatus','localAIStatus']);assert.equal(c.request().localModel,'gemma4:31b-mlx');assert.match(c.description(),/5 分钟/);
 prefs.aiProvider='personal';assert.equal(c.effective(),'personal');assert.equal(c.request().localModel,undefined);
 }finally{r.win.close();}
});
