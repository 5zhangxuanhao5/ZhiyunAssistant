import '../../src/shared/bridge';
import { test, expect, _electron, ElectronApplication, Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
let app:ElectronApplication,page:Page,folder:string;
const course={subId:'camera-test',courseId:'camera-course',title:'合成机位测试',teacher:'测试数据',room:'测试环境',start:100,end:124,status:'6'};
test.afterEach(async()=>{if(app){const child=app.process();await Promise.race([app.close().catch(()=>{}),new Promise(resolve=>setTimeout(resolve,5000))]);if(child.exitCode===null)child.kill('SIGTERM')}if(folder)fs.rmSync(folder,{recursive:true,force:true})});
async function start(slow=false,hls=false,selection=false){
 folder=fs.mkdtempSync(path.join(os.tmpdir(),'智云助手 机位比较 '));app=await _electron.launch({args:[path.resolve('.')],env:{...process.env,ZHIYUN_TEST_DATA:folder}});page=await app.firstWindow();await expect(page.locator('body')).toContainText('隐私与数据');
 await app.evaluate(({ipcMain,protocol,net},fixture)=>{
  const {course,first,different,slow,hls,files,selection}=fixture,store=new Map<string,any>(),sources=(slow?['a','b','bad']:['a','b','different']).map(id=>({id,title:'合成机位 '+id,url:'https://cmc.zju.edu.cn/synthetic-camera-'+id+(hls&&id!=='different'?'.m3u8':'.mp4'),hls:hls&&id!=='different',live:false,offset:0}));
  (globalThis as any).__cameraResolves=[];protocol.unhandle('zhiyun-resource');protocol.handle('zhiyun-resource',async request=>{
   const segments=new URL(request.url).pathname.split('/'),id=segments[2],name=segments[3],file=hls&&id!=='different'?files[name]:id==='different'?different:first;if(!file)return new Response(null,{status:404});const reply=await net.fetch(file),bytes=Buffer.from(await reply.arrayBuffer());
   const headers=new Headers({'Content-Type':name?.endsWith('.m3u8')?'application/vnd.apple.mpegurl':name?.endsWith('.ts')?'video/mp2t':'video/mp4','Access-Control-Allow-Origin':'zhiyun://app','Accept-Ranges':'bytes','Cache-Control':'no-store'}),range=request.headers.get('range');
   if(range){const match=/^bytes=(\d+)-(\d*)$/.exec(range);if(!match)return new Response(null,{status:416});const begin=Number(match[1]),end=match[2]?Math.min(bytes.length-1,Number(match[2])):bytes.length-1;headers.set('Content-Range',`bytes ${begin}-${end}/${bytes.length}`);headers.set('Content-Length',String(end-begin+1));return new Response(bytes.subarray(begin,end+1),{status:206,headers})}
   headers.set('Content-Length',String(bytes.length));return new Response(bytes,{headers});
  });
  ipcMain.removeHandler('zhiyun:call');ipcMain.handle('zhiyun:call',async(_event,method,payload:any={})=>{
   switch(method){case'session.restore':return{id:'camera-account',name:'测试账户',tenantId:112};case'storage.get':return payload.key==='privacy-consent'?true:payload.key==='pane-preferences'?{regular:{slides:false,transcript:false,video:true,notes:false,ai:false,summary:false},missing:{}}:store.get(payload.key)||null;case'storage.set':store.set(payload.key,payload.value);return null;case'courses.schedule':case'courses.chapters':return[course];case'courses.permissions':return{[course.subId]:'allowed'};case'collection.get':return{favorite:[],later:[]};case'lesson.open':return{course,slides:[],lines:[],sources,live:false};case'video.sources':return sources;case'video.resolve':{const id=payload.source.id;(globalThis as any).__cameraResolves.push(id);if(slow&&id==='b')await new Promise(resolve=>setTimeout(resolve,1400));if(selection&&id==='b')await new Promise(resolve=>setTimeout(resolve,600));if(id==='bad')throw Error('合成不可用机位');return{...payload.source,url:'zhiyun-resource://asset/camera/'+id+'/'+(hls&&id!=='different'?'index.m3u8':'frame.mp4'),offset:0}}case'progress.get':return null;default:return null}
  });
 },{course,first:pathToFileURL(path.resolve('tests/fixtures/media/test-pattern.mp4')).href,different:pathToFileURL(path.resolve('tests/fixtures/media/test-pattern-different.mp4')).href,slow,hls,selection,files:Object.fromEntries(fs.readdirSync('tests/fixtures/media/hls').map(name=>[name,pathToFileURL(path.resolve('tests/fixtures/media/hls',name)).href]))});
 await page.reload();await page.getByRole('button',{name:'进入学习',exact:true}).click();await expect.poll(()=>page.locator('video').evaluate((video:HTMLVideoElement)=>video.readyState>=3&&!video.paused)).toBe(true);
}
test('different URLs with matching two decoded RGB frames collapse while a truly different camera and the selected player remain',async()=>{
 await start(false,false,true);const select=page.getByRole('combobox',{name:'视频机位',exact:true});await select.selectOption('b');
 await expect.poll(()=>page.locator('video').evaluate((video:HTMLVideoElement)=>video.currentSrc.endsWith('/b/frame.mp4')&&!video.paused)).toBe(true);
 const before=await page.locator('video').evaluate((video:HTMLVideoElement)=>video.currentTime);
 await expect(select.locator('option')).toHaveCount(2,{timeout:18000});await expect(select).toHaveValue('b');expect(await select.locator('option').evaluateAll(options=>options.map(option=>(option as HTMLOptionElement).value))).toEqual(['b','different']);
 const state=await page.locator('video').evaluate((video:HTMLVideoElement)=>({at:video.currentTime,source:video.currentSrc,paused:video.paused}));expect(state.source.endsWith('/b/frame.mp4')).toBe(true);expect(state.paused).toBe(false);expect(state.at).toBeLessThan(before+5);await expect(page.locator('.video-error')).toHaveCount(0);
});
test('pausing cancels unfinished camera probes and an unverified failed camera is retained',async()=>{
 await start(true);await expect.poll(()=>app.evaluate(()=>(globalThis as any).__cameraResolves.includes('b'))).toBe(true);await page.getByRole('button',{name:'暂停',exact:true}).click();
 await page.waitForTimeout(1700);const resolved=await app.evaluate(()=>(globalThis as any).__cameraResolves as string[]);expect(resolved.includes('bad')).toBe(false);await expect(page.getByRole('combobox',{name:'视频机位',exact:true}).locator('option')).toHaveCount(3);await expect(page.locator('.video-error')).toHaveCount(0);
});

test('HLS camera comparison decodes separate playlists at matching course times and keeps distinct MP4 content',async()=>{
 await start(false,true);await expect(page.getByRole('combobox',{name:'视频机位',exact:true}).locator('option')).toHaveCount(2,{timeout:18000});
 expect(await page.getByRole('combobox',{name:'视频机位',exact:true}).locator('option').evaluateAll(options=>options.map(option=>(option as HTMLOptionElement).value))).toEqual(['a','different']);
 await expect(page.locator('.video-error')).toHaveCount(0);await expect.poll(()=>page.locator('video').evaluate((video:HTMLVideoElement)=>video.currentTime)).toBeGreaterThan(.5);
});
