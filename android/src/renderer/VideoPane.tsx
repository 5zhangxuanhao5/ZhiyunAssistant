import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle, useCallback, useMemo } from 'react';
import Hls from 'hls.js';
import { api, Course } from '../shared/bridge';
import { stamp } from '../shared/model/Timeline';
import { mediaIdentity } from '../shared/model/Media';
import { VideoBounds, CameraFrame, courseVideoBounds, courseSeekTarget, timelineAnchor, replayAvailable, boundedRate, draggedVideoTarget, playbackHlsConfig, cameraSampleTimes, sameCameraFrames, collapseCameraSources } from './videoLogic';
import { probeCamera } from './CameraProbe';
export interface VideoHandle { seek:(at:number)=>void; jump:(at:number)=>boolean; time:()=>number; toggle:()=>void; isPlaying:()=>boolean; canSeek:()=>boolean; setRate:(value:number)=>void }
interface VideoProps { course:Course; sources:any[]; sourcesReady?:boolean; initialAt:number; offline:boolean; fullscreen:boolean; autoplay?:boolean; onFullscreen:(value:boolean)=>void; onTime:(at:number)=>void; onBounds?:(bounds:VideoBounds)=>void; onNotice:(message:string)=>void; onClick:()=>void; onCurrent:()=>void }
interface VideoPointer { id:number; x:number; y:number; time:number; dragged:boolean }
export const VideoPane = forwardRef<VideoHandle, VideoProps>(function VideoPane(props, ref) {
 const element=useRef<HTMLVideoElement>(null),hls=useRef<Hls|undefined>(undefined),offset=useRef(0);
 const [sourceId,setSource]=useState(''),[error,setError]=useState(''),[playing,setPlaying]=useState(false),[time,setTime]=useState(props.initialAt);
 const [bounds,setBounds]=useState<VideoBounds>({start:0,end:0,seekable:false}),[rate,setRate]=useState(1),[speedOpen,setSpeedOpen]=useState(false),[visible,setVisible]=useState(true);
 const [replay,setReplay]=useState(false),[gesture,setGesture]=useState(''),[dragging,setDragging]=useState<number|null>(null),[reload,setReload]=useState(0);
 const [cameraGroups,setCameraGroups]=useState<string[][]>([]);const compared=useRef(new Map<string,string[][]>());
 const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),gestureTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),pointer=useRef<VideoPointer|undefined>(undefined);
 const consumedClick=useRef(0),speedRef=useRef(1),position=useRef(props.initialAt),pendingSeek=useRef<number|undefined>(props.initialAt),explicitTarget=useRef<number|undefined>(undefined),firstSource=useRef(true),sourceGeneration=useRef(0),sourceRef=useRef<any>(undefined);
 const currentProps=useRef(props),replayRef=useRef(replay),boundsRef=useRef(bounds),ready=useRef(false),recovering=useRef(0),firstMetadata=useRef(true);
 currentProps.current=props;replayRef.current=replay;speedRef.current=rate;boundsRef.current=bounds;
 // Never infer duplicate cameras from labels. Start with official URL identity;
 // paused tiny-frame probes can later confirm different URLs show the same view.
 const allSources=useMemo(()=>{const seen=new Set<string>();return props.sources.filter(source=>{if(!source?.url)return false;const identity=mediaIdentity(String(source.url));if(seen.has(identity))return false;seen.add(identity);return true}).map(source=>({...source,id:String(source.id||mediaIdentity(String(source.url))),identity:mediaIdentity(String(source.url))}))},[props.sources]);
 const liveSources=allSources.filter(source=>source.live),recordedSources=allSources.filter(source=>!source.live),liveCourse=liveSources.length>0;
 const rawSources=liveCourse?(replay?(recordedSources.length?recordedSources:liveSources):liveSources):recordedSources;
 const sources=collapseCameraSources(rawSources,cameraGroups,sourceId);
 const source=sources.find(value=>value.id===sourceId)||sources[0];sourceRef.current=source;
 const liveCourseRef=useRef(liveCourse);liveCourseRef.current=liveCourse;
 const progressAllowed=!liveCourse||replay,usableReplay=replayAvailable(recordedSources.length,bounds);
 const boundsNow=useCallback(()=>{const video=element.current;if(!video)return boundsRef.current;const ranges=Array.from({length:video.seekable.length},(_,index)=>({start:video.seekable.start(index),end:video.seekable.end(index)}));return courseVideoBounds(ranges,video.duration,offset.current)},[]);
 const publish=useCallback(()=>{const video=element.current;if(!video)return;const next=boundsNow();const previous=boundsRef.current;boundsRef.current=next;setBounds(old=>old.start===next.start&&old.end===next.end&&old.seekable===next.seekable?old:next);if(previous.start!==next.start||previous.end!==next.end||previous.seekable!==next.seekable)currentProps.current.onBounds?.(next);if(!ready.current)return;const at=Math.max(0,video.currentTime+offset.current);position.current=at;setTime(old=>Math.abs(old-at)<0.04?old:at);currentProps.current.onTime(at)},[boundsNow]);
 const seek=useCallback((seconds:number)=>{if(!Number.isFinite(seconds)||liveCourseRef.current&&!replayRef.current)return;const video=element.current;if(!video)return;const target=courseSeekTarget(seconds,boundsNow(),!!sourceRef.current?.live);if(target===undefined||video.readyState===0){pendingSeek.current=Math.max(0,seconds);return}const videoTime=Math.max(0,target-offset.current);if(sourceRef.current?.live&&hls.current&&replayRef.current){hls.current.stopLoad();video.currentTime=videoTime;hls.current.startLoad(videoTime)}else video.currentTime=videoTime;pendingSeek.current=undefined;explicitTarget.current=undefined;publish()},[boundsNow,publish]);
 const wake=useCallback(()=>{setVisible(true);clearTimeout(timer.current);if(currentProps.current.fullscreen&&element.current&&!element.current.paused&&!speedOpen&&dragging===null)timer.current=setTimeout(()=>setVisible(false),3000)},[speedOpen,dragging]);
 const toggle=useCallback(()=>{const video=element.current;if(!video)return;if(video.paused)void video.play().catch(()=>setError('无法开始播放，请重试'));else video.pause();wake()},[wake]);
 const changeRate=useCallback((value:number)=>{const next=liveCourseRef.current&&!replayRef.current?1:boundedRate(value);speedRef.current=next;setRate(next);if(element.current)try{element.current.playbackRate=next}catch{currentProps.current.onNotice('当前系统不支持此倍速，请选择其他速度')}},[]);
 const goLive=useCallback(()=>{const video=element.current;if(!video)return;const next=boundsNow();if(next.seekable&&next.end>next.start)video.currentTime=Math.max(0,next.end-Math.min(.3,(next.end-next.start)/4)-offset.current);else if(hls.current&&Number.isFinite(hls.current.liveSyncPosition))video.currentTime=hls.current.liveSyncPosition!;changeRate(1);pendingSeek.current=undefined;explicitTarget.current=undefined;publish()},[boundsNow,changeRate,publish]);
 const jump=useCallback((seconds:number):boolean=>{
  if(!Number.isFinite(seconds))return false;
  if(liveCourseRef.current&&!replayRef.current){
   if(!replayAvailable(recordedSources.length,boundsNow())){currentProps.current.onNotice('平台暂未提供可回看的直播范围');return false;}
   // Explicit transcript/note/time references may enter history. Ordinary seek
   // remains mode-limited, so keyboard and automatic skipping cannot do this.
   const target=Math.max(0,seconds);explicitTarget.current=target;pendingSeek.current=target;position.current=target;
   replayRef.current=true;setReplay(true);setSource('');setSpeedOpen(false);
   if(!recordedSources.length)seek(target);
   wake();return true;
  }
  seek(seconds);return true;
 },[recordedSources.length,boundsNow,seek,wake]);
 useImperativeHandle(ref,()=>({seek,jump,time:()=>position.current,toggle,isPlaying:()=>!!element.current&&!element.current.paused&&!element.current.ended,canSeek:()=>(!liveCourseRef.current||replayRef.current)&&boundsNow().seekable,setRate:changeRate}),[seek,jump,toggle,boundsNow,changeRate]);
 const sourceIdentity=source?String(source.id)+'|'+source.url+'|'+!!source.live:'';
 const cameraPoolKey=rawSources.map(item=>item.identity+'|'+item.url).join('\n'),cameraReady=!!cameraSampleTimes(bounds,!!source?.live);
 useEffect(()=>{
  if(!playing||!cameraReady||rawSources.length<2)return;
  const previous=compared.current.get(cameraPoolKey);if(previous&&!source?.live){setCameraGroups(previous);return;}
  const controller=new AbortController(),points=cameraSampleTimes(boundsNow(),!!source?.live);if(!points)return;
  const ordered=[source,...rawSources.filter(item=>item.id!==source?.id)].filter(Boolean).slice(0,8);
  const run=async()=>{const samples:Array<{identities:string[];frames:CameraFrame[]}>=[];let complete=true;
   for(const item of ordered){if(controller.signal.aborted)return;const frames=await probeCamera(item,currentProps.current.course,points,controller.signal,value=>api('video.resolve',{source:value,course:currentProps.current.course}));if(controller.signal.aborted)return;
    if(!frames){complete=false;continue;}const same=samples.find(sample=>sameCameraFrames(sample.frames,frames));if(same)same.identities.push(item.identity);else samples.push({identities:[item.identity],frames});
    setCameraGroups(samples.filter(sample=>sample.identities.length>1).map(sample=>sample.identities.slice()));
   }
   if(complete&&!source?.live&&!controller.signal.aborted)compared.current.set(cameraPoolKey,samples.filter(sample=>sample.identities.length>1).map(sample=>sample.identities.slice()));
  };void run();return()=>controller.abort();
 },[playing,cameraReady,cameraPoolKey,sourceIdentity,boundsNow]);
 useEffect(()=>{
  const video=element.current,generation=++sourceGeneration.current;if(!video||!source)return;
  let active=true;ready.current=false;recovering.current=0;setError('');setDragging(null);setGesture('');
  // Preserve lesson-local time across cameras, signed-URL refreshes and retries.
  pendingSeek.current=explicitTarget.current??(firstSource.current?currentProps.current.initialAt:position.current);firstSource.current=false;
  const setup=async()=>{try{
   const resolved=await api<any>('video.resolve',{source,course:currentProps.current.course});if(!active||generation!==sourceGeneration.current)return;
   offset.current=Number.isFinite(resolved.offset)?resolved.offset:Number.isFinite(source.offset)?source.offset:0;
   hls.current?.destroy();hls.current=undefined;video.pause();video.removeAttribute('src');video.load();
   const address=String(resolved.url||''),isHls=!!source.hls||/\.m3u8(?:\?|$)/i.test(address);
   if(isHls&&Hls.isSupported()){
    const player=new Hls({...playbackHlsConfig(!!source.live),backBufferLength:90,maxBufferSize:48*1024*1024,maxMaxBufferLength:60});hls.current=player;
    player.on(Hls.Events.LEVEL_LOADED,(_event,data)=>{if(!active||generation!==sourceGeneration.current)return;const anchor=timelineAnchor(data.details.fragments,currentProps.current.course.start,!!source.live,data.details.edge,Date.now()/1000);if(anchor!==undefined)offset.current=anchor;publish()});
    player.on(Hls.Events.ERROR,(_event,data)=>{if(!active||generation!==sourceGeneration.current||!data.fatal)return;const status=data.response?.code;if(status===401||status===403){setError('平台拒绝此视频的访问，请重新确认课程权限');return}if(data.type===Hls.ErrorTypes.MEDIA_ERROR&&recovering.current++<1)player.recoverMediaError();else if(data.type===Hls.ErrorTypes.NETWORK_ERROR)setError('视频暂时无法加载，请检查网络后重试');else setError('此视频编码暂不支持，请选择其他可用机位')});
    player.attachMedia(video);player.loadSource(address);
   }else video.src=address;
   video.playbackRate=liveCourseRef.current&&!replayRef.current?1:speedRef.current;
  }catch(failure:any){if(active&&generation===sourceGeneration.current)setError(failure.message||'视频加载失败')}};
  void setup();
  return()=>{active=false;ready.current=false;hls.current?.destroy();hls.current=undefined;video.pause();video.removeAttribute('src');video.load()};
 },[sourceIdentity,reload,publish]);
 useEffect(()=>{wake();return()=>clearTimeout(timer.current)},[props.fullscreen,playing,wake]);
 useEffect(()=>()=>{clearTimeout(timer.current);clearTimeout(gestureTimer.current)},[]);
 const metadata=()=>{ready.current=true;if(firstMetadata.current){pendingSeek.current=explicitTarget.current??currentProps.current.initialAt;firstMetadata.current=false}if(liveCourseRef.current&&!replayRef.current)goLive();else if(pendingSeek.current!==undefined)seek(pendingSeek.current);changeRate(speedRef.current);publish();if(currentProps.current.autoplay!==false)void element.current?.play().catch(()=>currentProps.current.onNotice('点击播放继续'))};
 const enterReplay=()=>{if(!replay&&!replayAvailable(recordedSources.length,boundsNow())){props.onNotice('平台暂未提供可回看的直播范围');return}explicitTarget.current=undefined;position.current=element.current?Math.max(0,element.current.currentTime+offset.current):time;const next=!replay;replayRef.current=next;setReplay(next);setSource('');setSpeedOpen(false);if(!next){changeRate(1);if(sourceRef.current?.live)goLive();props.onCurrent()}else pendingSeek.current=position.current;wake()};
 const changeSource=(id:string)=>{position.current=element.current?Math.max(0,element.current.currentTime+offset.current):time;setSource(id);wake()};
 const progressMin=Math.max(0,bounds.start),progressMax=Math.max(progressMin+.1,bounds.end),displayed=dragging??time;
 return <section className={'video-pane '+(props.fullscreen?'video-is-fullscreen':'')} onPointerDown={props.onClick} onPointerMove={wake} onKeyDown={event=>{
  if((event.target as HTMLElement).closest('input,textarea,select')||event.ctrlKey||event.metaKey||event.altKey)return;
  if(event.key==='['||event.key===']'){event.preventDefault();event.stopPropagation();changeRate(speedRef.current+(event.key === ']' ? 0.1 : -0.1));}
 }}>
  <header className={'pane-title '+(props.fullscreen?'fullscreen-title '+(visible?'':'controls-hidden'):'')}><h2>视频</h2><span className="header-spacer"/>
   {sources.length>1&&<select aria-label="视频机位" value={source?.id||''} onChange={event=>changeSource(event.target.value)}>{sources.map((item,index)=><option key={item.id||index} value={item.id}>{item.title||item.label||(item.live?'教师直播':'课程录像')}</option>)}</select>}
   {liveCourse&&<button onClick={enterReplay} title={!usableReplay&&!replay?'平台暂未提供直播历史范围':undefined}>{replay?'回到最新':'回放'}</button>}
   <button onClick={()=>{props.onFullscreen(!props.fullscreen);wake()}}>{props.fullscreen?'退出全屏':'全屏'}</button>
  </header>
  <div className="video-picture" onDoubleClick={event=>{event.stopPropagation();toggle()}} onClick={event=>{if(Date.now()<consumedClick.current){event.preventDefault();event.stopPropagation();return}wake();props.onCurrent()}} onPointerDown={event=>{if(event.button!==0||pointer.current)return;pointer.current={id:event.pointerId,x:event.clientX,y:event.clientY,time:Math.max(0,(element.current?.currentTime||0)+offset.current),dragged:false};event.currentTarget.setPointerCapture(event.pointerId)}} onPointerMove={event=>{const start=pointer.current;if(!start||start.id!==event.pointerId)return;const dx=event.clientX-start.x,dy=event.clientY-start.y;if(!start.dragged&&Math.abs(dx)>12&&Math.abs(dx)>Math.abs(dy)*1.35)start.dragged=true;if(!start.dragged||!progressAllowed)return;const target=draggedVideoTarget(start.time,dx,event.currentTarget.clientWidth,boundsNow(),!!source?.live);if(target!==undefined){const delta=Math.round(target-start.time);setGesture((delta>=0?'+':'−')+Math.abs(delta)+' 秒')}if(event.cancelable)event.preventDefault()}} onPointerUp={event=>{const start=pointer.current;if(!start||start.id!==event.pointerId)return;pointer.current=undefined;if(start.dragged){consumedClick.current=Date.now()+350;if(progressAllowed){const target=draggedVideoTarget(start.time,event.clientX-start.x,event.currentTarget.clientWidth,boundsNow(),!!source?.live);if(target!==undefined)seek(target)}clearTimeout(gestureTimer.current);gestureTimer.current=setTimeout(()=>setGesture(''),650)}wake()}} onPointerCancel={()=>{pointer.current=undefined;consumedClick.current=Date.now()+350;setGesture('')}}>
   <video ref={element} playsInline preload="metadata" onLoadedMetadata={metadata} onProgress={()=>{if(ready.current&&pendingSeek.current!==undefined)seek(pendingSeek.current);publish()}} onDurationChange={publish} onSeeked={publish} onTimeUpdate={publish} onPlay={()=>{setPlaying(true);wake()}} onPause={()=>{setPlaying(false);setVisible(true);publish()}} onError={()=>setError('视频无法加载，请重试或选择其他可用机位')}/>
   {gesture&&<span className="video-gesture">{gesture}</span>}{error&&<div className="video-error">{error}<button onClick={()=>{position.current=element.current?Math.max(0,element.current.currentTime+offset.current):time;setReload(value=>value+1)}}>重试</button></div>}
   {!sources.length&&!error&&<p className="video-empty">{allSources.length?'此时段没有可用机位':props.sourcesReady?'平台未提供可用视频':'正在获取视频…'}</p>}
  </div>
  <footer className={'video-controls '+(props.fullscreen?'overlay-controls ':'')+(visible?'':'controls-hidden')}>
   <button aria-label={playing?'暂停':'播放'} className="play-button" onClick={toggle}>{playing?<svg viewBox="0 0 24 24"><path d="M7 5v14M17 5v14"/></svg>:<svg viewBox="0 0 24 24"><path d="M8 5l12 7-12 7z"/></svg>}</button><time>{stamp(displayed)}</time>
   {progressAllowed?<input className="video-progress" aria-label="播放进度" type="range" min={progressMin} max={progressMax} step={.1} disabled={!bounds.seekable} value={Math.max(progressMin,Math.min(progressMax,displayed))} onChange={event=>setDragging(Number(event.target.value))} onPointerUp={()=>{if(dragging!==null)seek(dragging);setDragging(null);wake()}} onPointerCancel={()=>setDragging(null)} onKeyUp={()=>{if(dragging!==null)seek(dragging);setDragging(null)}}/>:<span className="live-label">直播</span>}{progressAllowed&&<time>{stamp(bounds.end)}</time>}<span className="header-spacer"/>
   {progressAllowed&&<div className="speed-control"><button onClick={()=>{setSpeedOpen(!speedOpen);wake()}}>{rate.toFixed(rate%1?2:0)}×</button>{speedOpen&&<div className="speed-popover"><span>{rate.toFixed(2)}×</span><input aria-label="播放速度" type="range" min={.1} max={16} step={.01} value={rate} onChange={event=>changeRate(Number(event.target.value))}/><button onClick={()=>{changeRate(1);setSpeedOpen(false)}}>正常</button></div>}</div>}
   <input aria-label="音量" className="volume" type="range" min={0} max={1} step={.05} defaultValue={1} onChange={event=>{if(element.current)element.current.volume=Number(event.target.value)}}/>
  </footer>
 </section>;
});

