import type { Account, Course, Slide, Transcript } from './model/Timeline';
import type { LessonNote, NoteInsertion } from './model/Notes';
export type { Account, Course, Slide, Transcript, LessonNote, NoteInsertion };
export interface LessonData {course: Course; slides: Slide[]; lines: Transcript[]; sources?: {id?:string;title?:string;label?:string;url:string;live?:boolean}[]; live?:boolean; historyStatus?:string; offline?:boolean; missing?:string[]}
export interface DesktopBridge { call<T=any>(method:string, payload?:any):Promise<T>; on(event:string, listener:(data:any)=>void):()=>void }
declare global {interface Window { zhiyun: DesktopBridge }}
export const api = <T=any>(method:string, payload?:any):Promise<T>=>window.zhiyun.call<T>(method,payload);
