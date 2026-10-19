// Build-time injection only. Never reads developer profiles or personal API keys.
const fs=require('node:fs'),path=require('node:path');
function provision(output,env=process.env){
 const modelKey=(env.ZJU_CAMPUS_MODEL_API_KEY||'').trim(),ocrKey=(env.ZJU_CAMPUS_OCR_API_KEY||'').trim();
 if(!modelKey&&!ocrKey){fs.rmSync(output,{force:true});return false;}
 if(!/^[A-Za-z0-9_-]{16,256}$/.test(modelKey)||!/^pk_[A-Za-z0-9_-]{16,256}$/.test(ocrKey))throw Error('Campus build requires both valid school service credentials; no values are logged.');
 fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify({modelKey,ocrKey,validUntil:'2026-11-01'}),{mode:0o600});return true;
}
module.exports={provision};
if(require.main===module){try{const output=process.argv[2];if(!output)throw Error('An output path is required');console.log(provision(output)?'School DS and OCR provisioned (valid through 2026-11-01).':'No school credentials supplied; personal API mode retained.');}catch(error){console.error(error.message);process.exitCode=1;}}
