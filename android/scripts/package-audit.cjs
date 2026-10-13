'use strict';
const fs=require('node:fs');const path=require('node:path');const JSZip=require('jszip');
function scanText(text) {
  const findings = [];
  const tests = [
    ['private credential', /sk-[A-Za-z0-9_-]{20,200}/g],
    ['private signing key', /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g],
    ['developer macOS path', /\/(?:Users\/[^/\s"'`]+\/|Applications\/DevEco[^\s"'`]*)/g],
    ['developer Windows home path', /[A-Za-z]:\\\\?Users\\\\?[A-Za-z0-9_\u4e00-\u9fff-]+\\\\?(?:Documents|Desktop|AppData)/g],
    ['embedded session token', /eyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g]
  ];
  for (const [kind, expression] of tests) for (const match of text.matchAll(expression)) findings.push({ kind, offset: match.index });
  return findings;
}
function sensitiveEntry(filename) {
  const name = filename.replace(/\\/g, '/').replace(/^\//, '');
  if (/\.(?:p12|pfx|jks|keystore|pem|key|mobileprovision|hap)$/i.test(name)) return 'signing or credential file';
  if (/(?:^|\/)(?:\.env(?:\.[^/]*)?|build-profile\.json5|local\.properties|last-account\.json|session[^/]*\.json|permissions-v1\.json|offline-v1\.json|download-jobs-v1\.json|notes-[a-f0-9-]+\.json)$/i.test(name)) return 'private local state';
  if (/(?:^|\/)(?:publish-captures|脱敏截图|resource-cache|note-images|saved-images|video-[a-f0-9]+)(?:\/|$)/i.test(name)) return 'user or course resource directory';
  if (/\.(?:png|jpe?g|webp|gif|bmp)$/i.test(name) && !/^(?:assets\/icon\.(?:png|ico)|(?:dist\/renderer|app\/src\/main\/assets|assets)\/icon\.png)$/.test(name) && !name.startsWith('node_modules/')) return 'unexpected course or user image';
  if (/\.(?:map|log)$/i.test(name)) return 'development source map or log';
  return '';
}

async function auditApk(filename){const zip=await JSZip.loadAsync(fs.readFileSync(filename));const findings=[];const required=['assets/app.js','assets/app.css','assets/index.html','assets/image-worker.js','assets/icon.png','classes.dex','AndroidManifest.xml'];for(const entry of required)if(!zip.file(entry))findings.push({file:entry,kind:'required APK resource missing'});for(const [name,item] of Object.entries(zip.files)){if(item.dir)continue;if(/\.(?:jks|keystore|p12|pfx|pem|key|log|map)$/i.test(name))findings.push({file:name,kind:'private or development file'});if(name.startsWith('assets/')){if(/\.(?:json|js|html|css|txt)$/.test(name)){const content=await item.async('string');for(const finding of scanText(content))findings.push({file:name,...finding});}if(/\.(?:png|jpe?g|webp)$/i.test(name)&&name!=='assets/icon.png')findings.push({file:name,kind:'unexpected user image'});}if(name.endsWith('.dex')){const raw=await item.async('nodebuffer');for(const finding of scanText(raw.toString('latin1')))findings.push({file:name,...finding})}}return{apk:path.basename(filename),entries:Object.keys(zip.files).length,findings}}
module.exports={scanText,sensitiveEntry,auditApk};if(require.main===module){auditApk(process.argv[2]).then(report=>{console.log(JSON.stringify(report,null,2));process.exitCode=report.findings.length?1:0}).catch(error=>{console.error(error.message);process.exitCode=1})}
