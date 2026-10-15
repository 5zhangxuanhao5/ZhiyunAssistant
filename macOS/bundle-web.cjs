/** Explicit public-resource allowlist. No captures, logs or user files enter .app. */
const fs=require('node:fs'),path=require('node:path');
const from=path.join(__dirname,'web'),to=path.resolve(process.argv[2]||'');
if(!process.argv[2]||!to.startsWith(path.join(__dirname,'build')+path.sep))throw new Error('Bundle destination must be inside this project build directory.');
function copy(dir,relative=''){
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const name=path.join(relative,entry.name),source=path.join(dir,entry.name),target=path.join(to,name);
    if(entry.isSymbolicLink())throw new Error('Symlinks are not allowed in shipped resources: '+name);
    if(entry.isDirectory()){if(relative===''&&entry.name==='models')copy(source,name);else throw new Error('Unexpected resource directory: '+name);continue}
    if(!entry.isFile())throw new Error('Unexpected resource type: '+name);
    if(!/\.(js|css|html)$/.test(name)&&!['icon.png','theme-collage.png','theme-editorial.png','theme-playful.png'].includes(name))throw new Error('Unexpected public resource: '+name);
    if(/\.(js|css|html)$/.test(name)){
      const text=fs.readFileSync(source,'utf8');
      if(/\/Users\/[A-Za-z0-9_.-]+\/|["']sk-[A-Za-z0-9]{20,}["']|["'](?:password|apiKey|cookie)["']\s*:\s*["'][^"']{12,}["']/i.test(text))throw new Error('Potential private value in '+name+'; review before packaging.');
    }
    fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(source,target);
  }
}
fs.mkdirSync(to,{recursive:true});copy(from);console.log('Packaged public web resources only.');
