'use strict';
// The public source contains the generated, platform-adapted modules. Validate
// that self-contained graph; do not depend on a private HarmonyOS checkout/SDK.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'web');
const names=['Timeline','CaptionTime','Media','SlideSimilarity','BlackBorders','CourseCollections','SmartSkip','QuestionScope','CourseReference','AiStream','AiUsage','CourseContext','SlideGrid','TranscriptPlayback','NoteFormatting','Zhiyun'];
function required(filename){const stat=fs.statSync(filename);if(!stat.isFile()||stat.size===0)throw Error('Missing or empty bundled source: '+path.relative(__dirname,filename));}
async function verify(){
 if(typeof vm.SourceTextModule!=='function')throw Error('Run with node --experimental-vm-modules generate-models.cjs');
 for(const name of ['index.html','app.css','app.js','bridge.js','icon.png',...names.map(name=>'models/'+name+'.js')])required(path.join(root,name));
 const modules=new Map();
 function load(filename){const canonical=path.resolve(filename);if(!canonical.startsWith(root+path.sep))throw Error('Module import escapes the bundled web directory');if(modules.has(canonical))return modules.get(canonical);required(canonical);const source=fs.readFileSync(canonical,'utf8');const module=new vm.SourceTextModule(source,{identifier:canonical});modules.set(canonical,module);return module;}
 function resolve(specifier,from){if(!specifier.startsWith('./')&&!specifier.startsWith('../'))throw Error('External module dependency is not bundled: '+specifier);if(specifier.includes('?')||specifier.includes('#'))throw Error('Module suffix must be resolved explicitly: '+specifier);return load(path.resolve(path.dirname(from.identifier),specifier));}
 // Link without executing application boot/native calls. Linking verifies named
 // exports too, rather than accepting a file whose imported bindings are missing.
 const entries=['app.js','bridge.js',...names.map(name=>'models/'+name+'.js')];
 for(const name of entries){const module=load(path.join(root,name));if(module.status==='unlinked')await module.link(resolve);}
 console.log('Verified '+names.length+' bundled classroom models and all local module imports; no HarmonyOS SDK or compiler required.');
}
verify().catch(error=>{console.error('Bundled model verification failed: '+error.message);process.exitCode=1});
