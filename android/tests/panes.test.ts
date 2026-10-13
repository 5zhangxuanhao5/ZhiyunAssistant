import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enterAction, applyInsertion, splitOwnBlock, materialForQuestion, summaryEligible, summaryContext, selectAllPhase, prepareNote } from '../src/renderer/panesLogic';
import { courseAnswerParts } from '../src/shared/model/CourseReference';
import { blockText, emptyNoteBlock } from '../src/shared/model/NoteBlocks';
import type { Course, Slide, Transcript } from '../src/shared/model/Timeline';
import type { NoteAtom } from '../src/shared/model/Notes';

const course: Course = { subId:'lesson1',courseId:'course1',title:'测试课程',teacher:'教师',room:'教室',start:1728104400,end:1728108000,status:'ended' };
const atom = (value:string, extra:Partial<NoteAtom> = {}):NoteAtom => ({ id:'a',kind:'text',value,at:10,end:10,sourceId:'',bold:false,italic:false,underline:false,...extra });
const slides: Slide[] = [{id:'s1',t:0,url:'https://classroom.zju.edu.cn/1.png',thumb:'',note:''},{id:'s2',t:60,url:'https://classroom.zju.edu.cn/2.png',thumb:'',note:''},{id:'s3',t:120,url:'https://classroom.zju.edu.cn/3.png',thumb:'',note:''}];
const lines:Transcript[] = [{id:'l3',t:120,end:122,text:'第三页'},{id:'l1',t:5,end:8,text:'第一页'},{id:'l2',t:70,end:75,text:'第二页'}];
test('question Enter sends, Shift+Enter inserts newline, Ctrl does not silently send',()=>{
 assert.equal(enterAction({key:'Enter'},false),'send');
 assert.equal(enterAction({key:'Enter',shiftKey:true},false),'newline');
 assert.equal(enterAction({key:'Enter',ctrlKey:true},false),'none');
});
test('IME confirmation never sends including Windows legacy keyCode229',()=>{
 for (const event of [{key:'Enter',isComposing:true},{key:'Enter',keyCode:229},{key:'x'}]) assert.equal(enterAction(event,false),'none');
 assert.equal(enterAction({key:'Enter'},true),'none');
});
test('reference inserts at remembered cursor and preserves before and after formatted text',()=>{
 const own=emptyNoteBlock(10); own.atoms=[atom('前半',{bold:true}),atom('后半',{italic:true})];
 const result=applyInsertion([own],own.id,2,{kind:'quote',value:'课堂转写',at:30,end:35,sourceId:'l1'},40);
 assert.equal(result.blocks.length,3); assert.equal(blockText(result.blocks[0]),'前半');
 assert.equal(result.blocks[0].atoms[0].bold,true); assert.equal(result.blocks[1].source,'transcript');
 assert.equal(blockText(result.blocks[2]),'后半'); assert.equal(result.blocks[2].atoms[0].italic,true);
 assert.equal(result.activeId,result.blocks[2].id); assert.equal(result.caret,0);
});
test('image inserts between reference blocks without appending to end',()=>{
 const first={id:'q1',source:'transcript',at:10,end:11,sourceId:'l1',atoms:[atom('第一段')]};
 const last={id:'q2',source:'transcript',at:20,end:21,sourceId:'l2',atoms:[atom('第二段')]};
 const result=applyInsertion([first,last],first.id,0,{kind:'image',value:'zhiyun-media://note/photo',at:15,end:15,sourceId:'slide1'},15);
 assert.equal(result.blocks[1].source,'slides'); assert.equal(result.blocks[1].atoms[0].kind,'image');
 assert.equal(result.blocks[result.blocks.length-1].id,'q2');
});
test('AI reference preserves bold/time cross-course link and archival identity',()=>{
 const result=applyInsertion([], '', 0, {kind:'summary',value:'概述',at:15,end:15,sourceId:'',formatted:[{value:'[02:00]',seconds:120,bold:true,italic:false,code:false,course}],reference:{kind:'summary',courseId:course.subId,pageId:'s2',scope:'course',summaryId:'archived',at:60}},15);
 assert.equal(result.blocks[0].source,'summary');
 const value=result.blocks[0].atoms[0];assert.equal(value.bold,true);assert.equal(value.linkAt,120);assert.equal(value.linkCourse?.subId,course.subId);assert.equal(value.reference?.summaryId,'archived');
});
test('Enter splits own block while preserving individual inline format',()=>{
 const own=emptyNoteBlock(10);own.atoms=[atom('甲乙',{bold:true}),atom('丙丁',{italic:true})];
 const split=splitOwnBlock([own],own.id,3,30);
 assert.equal(blockText(split.blocks[0]),'甲乙丙');assert.equal(blockText(split.blocks[1]),'丁');
 assert.equal(split.blocks[1].atoms[0].italic,true);
 assert.equal(split.blocks[0].atoms[1].italic,true);
});
test('question context stops at asking time and sorts transcript in source order',()=>{
 const context=materialForQuestion(course,slides,lines,'目前讲了什么',80,false,[]);
 assert.deepEqual(context.lines.map(l=>l.id),['l1','l2']);
 assert.deepEqual(context.includedPageIds,['s1','s2']);
});
test('explicit whole-course question overrides default context button',()=>{
 const context=materialForQuestion(course,slides,lines,'总结整节课',20,false,[]);
 assert.equal(context.whole,true);assert.deepEqual(context.lines.map(l=>l.id),['l1','l2','l3']);
});
test('explicit page question includes the aligned full lecture for those pages',()=>{
 const context=materialForQuestion(course,slides,lines,'第2页解释一下',20,false,[]);
 assert.deepEqual(context.selectedIds,['s2']);assert.deepEqual(context.lines.map(l=>l.id),['l2']);
});
test('manual slides selection keeps timestamps bound to selected slide ranges',()=>{
 const context=materialForQuestion(course,slides,lines,'解释所选内容',20,false,['s1','s3']);
 assert.deepEqual(context.lines.map(l=>l.id),['l1','l3']);
});
test('live current summary only generates on click; completed past page generates automatically',()=>{
 assert.equal(summaryEligible(true,'s3',slides,false),false);
 assert.equal(summaryEligible(true,'s3',slides,true),true);
 assert.equal(summaryEligible(true,'s2',slides,false),true);
 assert.equal(summaryEligible(false,'s3',slides,false),true);
});
test('double Ctrl+A only escalates same block within selection sequence',()=>{
 assert.equal(selectAllPhase(null,'b1',1000),1);
 assert.equal(selectAllPhase({target:'b1',at:1000},'b1',1500),2);
 assert.equal(selectAllPhase({target:'b1',at:1000},'b2',1500),1);
 assert.equal(selectAllPhase({target:'b1',at:1000},'b1',3000),1);
});
test('multi-timestamps in other lesson citation each resolve to independently clickable link',()=>{
 const refs=courseAnswerParts('参见 2024-10-05 13:00 · 00:10、00:20 和 00:30。',{gaps:[],lessons:[{course,slides,lines,gaps:[]}]});
 assert.deepEqual(refs.filter(part=>part.course).map(part=>part.seconds),[10,20,30]);
});
test('prepared persistent note keeps both block source and source timeline',()=>{
 const block={id:'b',source:'transcript',at:22,end:25,sourceId:'l',atoms:[atom('讲解',{at:22,end:25})]};
 const note=prepareNote({id:'n',title:'课堂笔记',course,atoms:[],anchors:[],savedAt:0,blocks:[block]});
 assert.equal(note.atoms[0].at,22);assert.equal(note.blocks![0].source,'transcript');
});

test('summary previous context does not accidentally force only the current page',()=>{
 const context=summaryContext('before','s2',slides,180);
 assert.deepEqual(context.selectedIds,[]);assert.equal(context.whole,false);assert.ok(context.at<120);assert.ok(context.at>119);
});
test('summary whole scopes include entire lesson while single-page stays explicit',()=>{
 assert.deepEqual(summaryContext('page','s2',slides,180).selectedIds,['s2']);
 for(const scope of ['whole','courseAll']){const context=summaryContext(scope,'s2',slides,180);assert.equal(context.whole,true);assert.deepEqual(context.selectedIds,[]);assert.equal(context.at,180);}
});
test('prior-course summary takes all prior lesson context and avoids future current-lesson speech',()=>{
 const context=summaryContext('course','s1',slides,180);
 assert.deepEqual(context.selectedIds,[]);assert.ok(context.at<60);assert.equal(context.whole,false);
});
