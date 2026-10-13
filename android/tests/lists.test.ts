import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Course } from '../src/shared/model/Timeline';
import { stableCourseIds, mergePermissionStates, permittedRows, scopedBatchRows, mergeDownloadEvent, groupedOffline } from '../src/renderer/listLogic';
import { attendanceBatch, reusableAttendanceBatch } from '../src/shared/model/AttendanceBatch';
import { orderedCollections } from '../src/shared/model/CollectionView';

const course: Course = { subId:'a',courseId:'course-a',title:'同名课程',teacher:'教师',room:'教室',start:100,end:200,status:'6' };
const b = { ...course, subId:'b',courseId:'course-b',start:300,end:400 };
test('permission request keys ignore display ordering and repeated lecture records',()=>{
 assert.equal(stableCourseIds([b,course,course]),stableCourseIds([course,b]));
});
test('incremental concurrent permission events merge only the current scope instead of replacing other courses',()=>{
 let state=mergePermissionStates({}, {a:'allowed',foreign:'allowed'}, [course,b]);
 state=mergePermissionStates(state,{b:'denied'},[course,b]);
 assert.deepEqual(state,{a:'allowed',b:'denied'});
 assert.deepEqual(mergePermissionStates(state,{a:'unknown'},[b]),{b:'denied'});
});
test('batch candidates never include denied, unknown or unchecked permissions',()=>{
 const c={...course,subId:'c'},d={...course,subId:'d'};
 assert.deepEqual(permittedRows([course,b,c,d],{a:'allowed',b:'denied',c:'unknown'}).map(row=>row.subId),['a']);
});
test('batch search and one-course refresh cannot leak attendance or a different course',()=>{
 assert.deepEqual(scopedBatchRows([b,course,course],'course',[course]).map(row=>row.subId),['a']);
 assert.deepEqual(scopedBatchRows([b,course],'search',[b]).map(row=>row.subId),['b']);
 assert.equal(scopedBatchRows([b,course],'search',[]).length,0);
 assert.equal(scopedBatchRows([course,b],'plaza').length,2);
});
test('attendance batch reuses confirmed candidates on additions but invalidates all reused candidates after any record removal',()=>{
 const cache=attendanceBatch([course,b],[course]),future={...b,subId:'future',end:2000};
 assert.deepEqual(scopedBatchRows([course,b,future],'attendance',[],1000).map(row=>row.subId),['a','b']);
 assert.deepEqual(reusableAttendanceBatch([course,b,{...b,subId:'new'}],cache).map(row=>row.subId),['a']);
 assert.equal(reusableAttendanceBatch([course],cache).length,0);
});
test('early download progress tolerates uninitialized tasks and never restores unknown or deleted jobs',()=>{
 const first=mergeDownloadEvent({entries:[],jobs:[]},{taskUpdates:[{id:'gone',state:'running'}]});
 assert.deepEqual(first.tasks,[]);
 const full=mergeDownloadEvent(first,{tasks:[{id:'active',state:'running',progress:0}]});
 const update=mergeDownloadEvent(full,{taskUpdates:[{id:'active',progress:.7},{id:'deleted',progress:.8}]});
 assert.deepEqual(update.tasks,[{id:'active',progress:.7}]);
 const deleted=mergeDownloadEvent(update,{tasks:[]});
 assert.deepEqual(mergeDownloadEvent(deleted,{taskUpdates:[{id:'active',progress:.9}]}).tasks,[]);
});
test('a progress-only event preserves a 2500-course saved array and every unaffected task object',()=>{
 const entries=Array.from({length:2500},(_,index)=>({course:{...course,subId:'saved-'+index,start:index}}));
 const unchanged={id:'unchanged',progress:.1},changed={id:'active',progress:.1},next={id:'active',progress:.8};
 const state=mergeDownloadEvent({entries,tasks:[unchanged,changed]}, {taskUpdates:[next]});
 assert.equal(state.entries,entries);assert.equal(state.tasks[0],unchanged);assert.equal(state.tasks[1],next);
});
test('same-titled offline courses retain separate folders and chronological date groups',()=>{
 const groups=groupedOffline([{course},{course:b}],'course');
 assert.deepEqual(groups.map(group=>group.key),['course-b','course-a']);assert.equal(groups[0].items.length,1);
 const dateGroups=groupedOffline([{course},{course:b}],'date');assert.equal(dateGroups.length,1);assert.deepEqual(dateGroups[0].items.map(entry=>entry.course.subId),['b','a']);
});
test('collection classification excludes deselected past lessons before moving future-only courses to the back',()=>{
 const past={course,whole:false,excluded:[],lessons:[course],complete:true,updatedAt:1};
 const future={course:b,whole:true,excluded:['a'],lessons:[course,{...b,start:900,end:1000}],complete:true,updatedAt:2};
 assert.deepEqual(orderedCollections([future,past],500).map(entry=>entry.course.courseId),['course-a','course-b']);
});
