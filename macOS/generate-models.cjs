const fs=require('fs'),path=require('path');
const compiler='/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/ets/build-tools/ets-loader/node_modules/typescript/lib/typescript.js';
if(!fs.existsSync(compiler)||!fs.existsSync(path.resolve(__dirname,'../SuikeHarmony/entry/src/main/ets/services/Zhiyun.ets'))){console.log('Using checked-in generated classroom modules');process.exit(0)}
const ts=require(compiler);
const from=path.resolve(__dirname,'../SuikeHarmony/entry/src/main/ets'),to=path.join(__dirname,'web/models');
for(const name of ['Timeline','CaptionTime','Media','SlideSimilarity','BlackBorders','CourseCollections','SmartSkip','QuestionScope','CourseReference','AiStream','AiUsage','CourseContext','SlideGrid','TranscriptPlayback','NoteFormatting']){
 let s=fs.readFileSync(path.join(from,'model',name+'.ets'),'utf8').replace(/import \{ url \} from '@kit.ArkTS';/, 'const url = { URL };');
 let out=ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2021,module:ts.ModuleKind.ES2020}}).outputText.replace(/from '(\.\/[^']+)'/g,"from '$1.js'");fs.writeFileSync(path.join(to,name+'.js'),out);
}
let source=fs.readFileSync(path.join(from,'services/Zhiyun.ets'),'utf8');
const start=source.indexOf('  private async request('),end=source.indexOf('  async account()',start);
source=source.slice(0,start)+`  private async request(path: string, post: string = '', origin: string = ORIGIN): Promise<string> {
    const result = await window.native.call('request', {url:origin+path,body:post});
    if(result.status===403) throw new AccessDenied('当前账号没有这节课的访问权限');
    if(result.status===401) throw new Error('登录失效，请重新登录');
    if(result.status!==200) throw new Error('智云暂时无法访问（'+result.status+'）');
    if(!result.text.trim().startsWith('{')) throw new Error('请先登录智云课堂');
    return result.text;
  }
`+source.slice(end);
source=source.replace(/^import .*from '@kit.*;$/gm,'').replace(/import \{ LocalStore \}[^\n]*\n/,'').replace(/import \{ SessionStore \}[^\n]*\n/,'');
let out=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2021,module:ts.ModuleKind.ES2020}}).outputText.replace(/from '\.\.\/model\/([^']+)'/g,"from './$1.js'");fs.writeFileSync(path.join(to,'Zhiyun.js'),out);
fs.copyFileSync(path.resolve(__dirname,'../智云助手图标.png'),path.join(__dirname,'web/icon.png'));
console.log('Shared classroom API and models generated');
