import {useEffect,useRef,useSyncExternalStore} from 'react';
import {defaultPanes,PaneRect} from '../shared/model/PaneLayout';
export interface Fold {left:number;top:number;right:number;bottom:number;separating:boolean;orientation:string;state:string}
export interface Viewport {width:number;height:number;folds:Fold[];posture?:string;orientation?:string;screen?:string;insets?:{top:number;right:number;bottom:number;left:number}}
let current:Viewport={width:typeof window==='undefined'?400:window.innerWidth,height:typeof window==='undefined'?800:window.innerHeight,folds:[]};
const listeners=new Set<()=>void>();let initialized=false;
const backs=new Map<number,{priority:number;handler:()=>boolean}>();let sequence=0;
export function installAdaptiveEvents(){if(initialized)return;initialized=true;const native=(window as any).androidNative;if(!native)return;native.on('app.viewport',(v:Viewport)=>{if(!v||!(v.width>0&&v.height>0))return;current={...v,folds:Array.isArray(v.folds)?v.folds:[]};document.documentElement.dataset.windowSize=v.width<600?'compact':v.width<840?'medium':'expanded';listeners.forEach(fn=>fn())});native.on('app.back',()=>{for(const item of [...backs.values()].sort((a,b)=>b.priority-a.priority)){if(item.handler())return}void native.call('app.exit',{})});native.on('app.lifecycle',(value:any)=>{if(!value.active){(window as any).__zhiyunFlush?.().catch(()=>{});document.querySelectorAll('video').forEach(video=>video.pause())}});}
export function useViewport(){return useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>current)}
export function useNativeBack(handler:()=>boolean,priority=0){const ref=useRef(handler);ref.current=handler;useEffect(()=>{const id=++sequence;backs.set(id,{priority,handler:()=>ref.current()});return()=>{backs.delete(id)}},[priority]);}
export function foldLayoutSignature(viewport:Viewport):string{return viewport.folds.filter(f=>f.separating).map(f=>[f.orientation,Math.round(f.left),Math.round(f.top),Math.round(f.right),Math.round(f.bottom),f.state].join(':')).join('|')||'flat'}
export function compactCanvasHeight(ids:string[],width:number,height:number):number{return width<600&&ids.length>2?Math.max(height,ids.length*250):height}
/** Project native hinge geometry into the learning canvas, splitting both hinges on multi-fold displays. */
export function adaptivePanes(ids:string[],width:number,height:number,viewport:Viewport,origin={left:0,top:0}):PaneRect[]{
 const folds=viewport.folds.filter(f=>f.separating);
 const vertical=folds.filter(f=>f.orientation.toLowerCase()==='vertical'&&f.left>origin.left&&f.left<origin.left+width).sort((a,b)=>a.left-b.left);
 const horizontal=folds.filter(f=>f.orientation.toLowerCase()==='horizontal'&&f.bottom>=origin.top&&f.top<=origin.top+height).sort((a,b)=>a.top-b.top);
 if(!ids.length)return[];
 if(vertical.length){const zones:Array<{x:number;w:number}>=[];let left=0;for(const f of vertical){const at=Math.max(left,Math.min(width,f.left-origin.left-6));if(at-left>80)zones.push({x:left/width,w:(at-left)/width});left=Math.min(width,Math.max(at+12,f.right-origin.left+6))}if(width-left>80)zones.push({x:left/width,w:(width-left)/width});if(zones.length>1){const bins=zones.map(()=>[] as string[]);const study=ids.filter(id=>['video','slides','transcript'].includes(id));const writing=ids.filter(id=>!study.includes(id));if(zones.length===2){if(writing.length){bins[0].push(...study);bins[1].push(...writing)}else ids.forEach((id,i)=>bins[Math.min(i,zones.length-1)].push(id))}else{study.forEach((id,i)=>bins[Math.min(i===0?0:1,zones.length-1)].push(id));writing.forEach((id,i)=>bins[Math.min(2+i,zones.length-1)].push(id))}let z=0;return bins.flatMap((group,i)=>defaultPanes(group,true).map(r=>({...r,x:zones[i].x,w:zones[i].w,z:z++})))}}
 if(horizontal.length){
  const zones:Array<{y:number;h:number}>=[];let top=0;
  for(const f of horizontal){
   const before=Math.max(0,Math.min(height,f.top-origin.top-6)),after=Math.max(0,Math.min(height,f.bottom-origin.top+6));
   if(before>top)zones.push({y:top/height,h:(before-top)/height});
   top=Math.max(top,after);
  }
  if(top<height)zones.push({y:top/height,h:(height-top)/height});
  if(zones.length){
   const bins=zones.map(()=>[] as string[]);
   const primary=ids.includes('video')?'video':ids.includes('slides')?'slides':ids[0];
   bins[0].push(primary);const remaining=ids.filter(id=>id!==primary);
   if(zones.length===1)bins[0].push(...remaining);
   else if(zones.length===2)bins[1].push(...remaining);
   else{
    const reading:string[]=remaining.filter(id=>id==='slides'||id==='transcript');
    const writing=remaining.filter(id=>!reading.includes(id));
    if(reading.length)bins[1].push(...reading);
    const start=reading.length?2:1;
    writing.forEach((id,i)=>bins[Math.min(start+i,bins.length-1)].push(id));
   }
   let z=0;
   return bins.flatMap((group,i)=>defaultPanes(group,width<600).map(r=>({...r,y:zones[i].y+r.y*zones[i].h,h:r.h*zones[i].h,z:z++})));
  }
 }
 return defaultPanes(ids,width<600);
}
