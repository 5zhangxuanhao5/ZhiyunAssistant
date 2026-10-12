import '../../src/shared/bridge';
import { test, expect, _electron, ElectronApplication, Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
let app: ElectronApplication, page: Page, folder: string;
const start = Math.floor(Date.now()/1000)-86400*2;
const a={subId:'list-a',courseId:'course-a',title:'课程甲',teacher:'测试教师',room:'测试教室',term:'测试学期',start,end:start+3600,status:'6'};
const denied={...a,subId:'list-denied',start:start-86400,end:start-86400+3600};
const b={...a,subId:'list-b',courseId:'course-b',title:'课程乙',start:start-3600,end:start,status:'6'};

test.beforeEach(async()=>{
 folder=fs.mkdtempSync(path.join(os.tmpdir(),'智云助手 列表回归 '));
 app=await _electron.launch({args:[path.resolve('.')],env:{...process.env,ZHIYUN_TEST_DATA:folder}});page=await app.firstWindow();
 await expect(page.locator('body')).toContainText('隐私与数据');
 await app.evaluate(({ipcMain},fixture)=>{
  const {a,b,denied}=fixture,store=new Map<string,any>(),rows=[a,denied,b];
  let tasks:any[]=[{id:'task-a',course:a,state:'running',downloadedBytes:100,totalBytes:1000,progress:.1,message:'正在下载视频'}];
  const saved=Array.from({length:2500},(_,i)=>({course:{...a,subId:'saved-'+i,start:a.start-i*3600,end:a.start-i*3600+3600},options:{slides:true},bytes:1000,missing:[]}));
  let favorite:any[]=[{course:a,whole:false,excluded:[],lessons:[a],complete:true,updatedAt:2},{course:b,whole:true,excluded:[],lessons:[],complete:false,updatedAt:1}];
  (globalThis as any).__listCalls=[];(globalThis as any).__listEnqueued=null;
  ipcMain.removeHandler('zhiyun:call');ipcMain.handle('zhiyun:call',async(event,method,payload:any={})=>{
   (globalThis as any).__listCalls.push({method,payload});
   switch(method){
    case 'session.restore':return{id:'synthetic-list',name:'测试账户',tenantId:112};
    case 'storage.get':return payload.key==='privacy-consent'?true:store.get(payload.key)||null;
    case 'storage.set':store.set(payload.key,payload.value);return null;
    case 'courses.schedule':return rows;
    case 'courses.history':return{courses:rows,complete:true};
    case 'courses.plaza':return rows;
    case 'courses.search':return{list:[a],total:1};
    case 'courses.chapters':{const group=payload.searchCourse||payload.course;if(group.courseId===b.courseId){favorite=favorite.map(entry=>entry.course.courseId===b.courseId?{...entry,lessons:[b],complete:true}:entry);return[b]}return[a,denied,b];}
    case 'courses.permissions':{const states=Object.fromEntries((payload.courses||[]).map((c:any)=>[c.subId,c.subId===denied.subId?'denied':'allowed']));event.sender.send('zhiyun:permissions',{states,confirmed:Object.keys(states)});return states;}
    case 'collection.get':return payload.kind?payload.kind==='favorite'?favorite:[]:{favorite,later:[]};
    case 'download.list':event.sender.send('zhiyun:downloads',{taskUpdates:[{id:'before-list',progress:.3}]});await new Promise(resolve=>setTimeout(resolve,25));return{entries:saved,tasks,concurrency:1};
    case 'download.delete':tasks=[];event.sender.send('zhiyun:downloads',{entries:saved,tasks,concurrency:1});return null;
    case 'download.enqueue':(globalThis as any).__listEnqueued=payload;return null;
    default:return null;
   }
  });
 },{a,b,denied});
 await page.reload({waitUntil:'domcontentloaded'});await expect(page.getByRole('heading',{name:'我的课堂',exact:true})).toBeVisible();
 page.on('dialog',dialog=>void dialog.accept());
});
test.afterEach(async()=>{if(app){const child=app.process();await Promise.race([app.close().catch(()=>{}),new Promise(resolve=>setTimeout(resolve,5000))]);if(child.exitCode===null)child.kill('SIGTERM')}fs.rmSync(folder,{recursive:true,force:true})});

test('attendance batch opens immediately, excludes denied lectures, defaults unselected and persists attendance candidate IDs',async()=>{
 await page.getByRole('button',{name:'批量下载',exact:true}).click();await expect(page.getByRole('heading',{name:'下载课程',exact:true})).toBeVisible();
 await expect(page.locator('.download-group')).toHaveCount(2);await expect(page.locator('.sticky-actions')).toContainText('已选 0 节课');
 await page.locator('.download-group').filter({hasText:'课程甲'}).getByRole('button',{name:'选择课次',exact:true}).click();
 await expect(page.locator('.download-lesson')).toHaveCount(1);await expect(page.locator('.download-lesson')).toContainText('课程甲');
 const cache=await page.evaluate(()=>window.zhiyun.call('storage.get',{key:'my-attendance-batch-v1'}));
 expect(cache.attendanceIds.sort()).toEqual([a.subId,denied.subId,b.subId].sort());expect(cache.allowedIds.sort()).toEqual([a.subId,b.subId].sort());
 await page.getByRole('button',{name:'全选当前列表',exact:true}).click();await page.getByRole('button',{name:'开始下载',exact:true}).click();
 const enqueued=await app.evaluate(()=>(globalThis as any).__listEnqueued);expect(enqueued.courses.map((c:any)=>c.subId)).toEqual([a.subId]);
});
test('one-course and search-result batch refresh remain in their explicit course scope',async()=>{
 await page.getByRole('button',{name:'课程广场',exact:true}).click();await page.getByRole('textbox',{name:'搜索课程或教师'}).fill('课程甲');await page.getByRole('button',{name:'搜索',exact:true}).click();
 await page.getByRole('button',{name:'批量下载',exact:true}).click();await expect(page.locator('.download-group')).toHaveCount(1);await expect(page.locator('.download-group')).toContainText('课程甲');await expect(page.locator('.download-group')).not.toContainText('课程乙');
 await page.getByRole('button',{name:'刷新',exact:true}).click();await expect(page.locator('.download-group')).toHaveCount(1);
 await page.getByRole('button',{name:'返回',exact:true}).click();await page.getByRole('button',{name:'进入课程',exact:true}).click();
 await page.getByRole('button',{name:'批量下载',exact:true}).click();await expect(page.locator('.download-group')).toHaveCount(1);await expect(page.locator('.download-group')).not.toContainText('课程乙');
 await page.getByRole('button',{name:'刷新',exact:true}).click();await expect(page.locator('.download-group')).toHaveCount(1);
 const calls=await app.evaluate(()=>(globalThis as any).__listCalls);expect(calls.filter((call:any)=>call.method==='courses.history')).toHaveLength(0);
});
test('offline initial progress and stale deleted job updates are safe and saved courses stay paginated',async()=>{
 const exceptions:string[]=[];page.on('pageerror',error=>exceptions.push(error.message));
 await page.getByRole('button',{name:'离线课程',exact:true}).click();await expect(page.locator('.download-task')).toHaveCount(1);await expect(page.locator('.course-card')).toHaveCount(80);
 await page.locator('.course-card').first().evaluate(element=>(window as any).__savedRow=element);
 await app.evaluate(({BrowserWindow})=>{BrowserWindow.getAllWindows()[0].webContents.send('zhiyun:downloads',{taskUpdates:[{id:'task-a',course:{subId:'list-a',courseId:'course-a',title:'课程甲',start:1,end:2},state:'running',downloadedBytes:900,totalBytes:1000,message:'正在下载视频'}]})});
 await expect(page.locator('.download-task progress')).toHaveAttribute('value','0.9');expect(await page.locator('.course-card').first().evaluate(element=>(window as any).__savedRow===element)).toBe(true);
 await page.locator('.download-task').getByRole('button',{name:'删除',exact:true}).click();await expect(page.locator('.download-task')).toHaveCount(0);
 await app.evaluate(({BrowserWindow})=>{BrowserWindow.getAllWindows()[0].webContents.send('zhiyun:downloads',{taskUpdates:[{id:'task-a',state:'running',progress:.99}]})});
 await expect(page.locator('.download-task')).toHaveCount(0);await page.getByRole('button',{name:'显示更多离线课程',exact:true}).click();await expect(page.locator('.course-card')).toHaveCount(160);expect(exceptions).toEqual([]);
});
test('incomplete whole-course collections load their catalogue and entering a partial collection shows only selected lectures',async()=>{
 await page.getByRole('button',{name:'课程收藏',exact:true}).click();
 await expect(page.locator('.course-card').filter({hasText:'课程乙'})).toContainText('1 节课');
 await page.locator('.course-card').filter({hasText:'课程甲'}).getByRole('button',{name:'进入课程',exact:true}).click();
 await expect(page.getByRole('heading',{name:'课程甲',exact:true,level:1})).toBeVisible();await expect(page.locator('.course-card')).toHaveCount(1);await expect(page.locator('.course-card')).toContainText('课程甲');
});
