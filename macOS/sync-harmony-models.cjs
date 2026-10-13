/** Developer-only synchronization. Release builds validate the resulting .js files. */
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const from=path.resolve(process.argv[2]||path.join(__dirname,'../SuikeHarmony/entry/src/main/ets'));
const to=path.join(__dirname,'web/models');
if(!fs.existsSync(path.join(from,'services/Zhiyun.ets')))throw new Error('Harmony sources are absent. Pass the ets source directory to this optional developer script.');
const names=new Set([
  'Timeline','CaptionTime','Media','SlideSimilarity','BlackBorders','CourseCollections','SmartSkip',
  'QuestionScope','CourseReference','AiStream','AiUsage','CourseContext','SlideGrid','TranscriptPlayback','NoteFormatting',
  'PanePreferences','PaneLayout','PageNavigation','SearchFacets','StudyNavigation','PermissionRecord','AttendanceBatch',
  'LearningProgress','SummaryPolicy','SummaryView','CourseSections','StudyFolders','CollectionView',
  'NoteBlocks','NoteCursor','Notes','NoteExport','OverviewSource','SlideSpreadSource','TranscriptMarkers',
  'TranscriptRender','VideoFingerprint','DownloadBytes','AxisPaging','SelectionBrush','MouseTextRange','ImageAccent',
]);
function sourceFor(name){const filename=path.join(from,'model',name+'.ets');if(!fs.existsSync(filename))throw new Error('Missing shared model '+name);return fs.readFileSync(filename,'utf8')}
function prepare(source){return source.replace(/import \{ url \} from '@kit.ArkTS';/, 'const url = { URL };')}
function transpile(source,name){
  const result=ts.transpileModule(prepare(source),{fileName:name+'.ts',reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2021,module:ts.ModuleKind.ES2020,importsNotUsedAsValues:ts.ImportsNotUsedAsValues.Remove}});
  const errors=result.diagnostics?.filter(d=>d.category===ts.DiagnosticCategory.Error)||[];
  if(errors.length)throw new Error('Cannot generate '+name+': '+ts.flattenDiagnosticMessageText(errors[0].messageText,' '));
  const output=result.outputText.replace(/from(['"])?\s+(['"])(\.\.?\/[^'"]+)\2/g,(all,_unused,quote,spec)=>'from '+quote+spec.replace(/^\.\.\/model\//,'./').replace(/\.js$/,'')+'.js'+quote);
  if(/from ['"]@kit\./.test(output))throw new Error('Model '+name+' still needs a Harmony runtime');
  return '// Generated from shared HarmonyOS sources by sync-harmony-models.cjs.\n'+output;
}
const queue=[...names],outputs=new Map();
while(queue.length){const name=queue.shift();if(outputs.has(name))continue;const output=transpile(sourceFor(name),name);for(const match of output.matchAll(/from ['"]\.\/([^'"]+)\.js['"]/g))if(!outputs.has(match[1]))queue.push(match[1]);outputs.set(name,output)}
let api=fs.readFileSync(path.join(from,'services/Zhiyun.ets'),'utf8');
const start=api.indexOf('  private async request('),end=api.indexOf('  async account()',start);
if(start<0||end<0)throw new Error('Harmony API request adapter changed; review it before syncing.');
api=api.slice(0,start)+`  private async request(path: string, post: string = '', origin: string = ORIGIN): Promise<string> {
    const generation = this.stopped;
    const task = window.native.call('request', { url: origin + path, body: post });
    const handle = { destroy: () => {
      if (task.id) window.native.call('cancelRequest', { id: task.id }).catch(() => {});
    } };
    this.pending.add(handle);
    try {
      const result = await task;
      if (generation !== this.stopped) throw new Error('已取消');
      if (result.status === 403) throw new AccessDenied('当前账号没有这节课的访问权限');
      if (result.status === 401) throw new Error('登录失效，请重新登录');
      if (result.status !== 200) throw new Error('智云暂时无法访问（' + result.status + '）');
      if (!result.text.trim().startsWith('{')) throw new Error('请先登录智云课堂');
      return result.text;
    } finally {
      this.pending.delete(handle);
    }
  }
`+api.slice(end);
api=api.replace(/^import .*from '@kit.*;$/gm,'').replace(/import \{ LocalStore \}[^\n]*\n/,'').replace(/import \{ SessionStore \}[^\n]*\n/,'');
api=api.replace(/Set<http.HttpRequest>/g,'Set<{ destroy: () => void }>').replace(/\(r: http.HttpRequest\)/g,'(r: { destroy: () => void })');
const apiOutput=transpile(api,'Zhiyun');
for(const match of apiOutput.matchAll(/from ['"]\.\/([^'"]+)\.js['"]/g))if(!outputs.has(match[1]))throw new Error('API requires another shared model: '+match[1]);
outputs.set('Zhiyun',apiOutput);fs.mkdirSync(to,{recursive:true});
for(const [name,output] of outputs)fs.writeFileSync(path.join(to,name+'.js'),output);
console.log('Synchronized '+outputs.size+' pure classroom modules. Mac UI and icon assets were not touched.');
