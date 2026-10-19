const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {provision}=require('./campus-services.cjs');
test('only the two school credentials are injected; no personal profile or environment value is included',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zhiyun-campus-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const out=path.join(dir,'CampusServices.json');
 assert.equal(provision(out,{}),false);assert.equal(fs.existsSync(out),false);
 assert.throws(()=>provision(out,{ZJU_CAMPUS_MODEL_API_KEY:'fixture-campus-model-123456789'}));
 assert.equal(provision(out,{ZJU_CAMPUS_MODEL_API_KEY:'fixture-campus-model-123456789',ZJU_CAMPUS_OCR_API_KEY:'pk_fixture_campus_ocr_123456789',DEEPSEEK_API_KEY:'private-personal-fixture',HOME:'/private/profile'}),true);
 const row=JSON.parse(fs.readFileSync(out));assert.deepEqual(Object.keys(row).sort(),['modelKey','ocrKey','validUntil']);assert.equal(row.validUntil,'2026-11-01');assert.ok(!fs.readFileSync(out,'utf8').includes('personal'));assert.equal(fs.statSync(out).mode&0o777,0o600);
 assert.equal(provision(out,{}),false);assert.equal(fs.existsSync(out),false,'an unprovisioned build removes stale defaults');
});
