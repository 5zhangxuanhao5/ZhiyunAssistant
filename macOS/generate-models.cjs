/** Validate checked-in browser modules. A public Mac build never needs DevEco. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'web');
function filesAt(directory){return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?filesAt(path.join(directory,entry.name)):entry.isFile()&&entry.name.endsWith('.js')?[path.join(directory,entry.name)]:[])}
async function validate(){
  if(typeof vm.SourceTextModule!=='function')throw new Error('Run npm run verify, or pass --experimental-vm-modules to Node.');
  const modules=new Map(),context=vm.createContext({});
  for(const filename of filesAt(root)){const source=fs.readFileSync(filename,'utf8');modules.set(filename,new vm.SourceTextModule(source,{context,identifier:filename}))}
  const resolve=(specifier,referencing)=>{
    if(!specifier.startsWith('./')&&!specifier.startsWith('../'))throw new Error('Browser module uses a non-local import: '+specifier);
    if(!specifier.endsWith('.js'))throw new Error('Browser import needs .js extension: '+specifier);
    const file=path.resolve(path.dirname(referencing.identifier),specifier);
    if(!file.startsWith(root+path.sep))throw new Error('Import escapes the public web bundle: '+specifier);
    const module=modules.get(file);if(!module)throw new Error('Missing checked-in module: '+path.relative(root,file));return module;
  };
  for(const module of modules.values())if(module.status==='unlinked')await module.link(resolve);
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  for(const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)){
    const ref=match[1];if(/^(https?:|data:)/.test(ref))continue;const file=path.resolve(root,ref);
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file))throw new Error('Missing web asset: '+ref);
  }
  console.log('Verified '+modules.size+' checked-in browser modules and index assets; no HarmonyOS SDK required.');
}
validate().catch(error=>{console.error(error.message);process.exitCode=1});
