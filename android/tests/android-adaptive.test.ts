import test from 'node:test';import assert from 'node:assert/strict';
import {adaptivePanes,compactCanvasHeight,foldLayoutSignature} from '../src/renderer/androidAdaptive';
const ids=['video','slides','transcript','notes','ai','summary'];
test('outer screen scrolls tall stacks rather than crushing six feature panes',()=>{assert.equal(compactCanvasHeight(ids,360,650),1500);assert.equal(compactCanvasHeight(ids,900,650),650);assert.equal(compactCanvasHeight(['slides','transcript'],360,650),650)});
test('one vertical separating hinge preserves roles on either side',()=>{const viewport={width:900,height:800,folds:[{left:450,right:450,top:0,bottom:800,separating:true,orientation:'vertical',state:'HALF_OPENED'}]};const panes=adaptivePanes(ids,900,700,viewport);assert.equal(panes.length,6);for(const r of panes){const left=r.x*900,right=(r.x+r.w)*900;assert.ok(right<=444.01||left>=455.99)}assert.ok(panes.find(r=>r.id==='video')!.x<panes.find(r=>r.id==='notes')!.x)});
test('two hinges create three regions without obscuring feature content',()=>{const folds=[400,800].map(x=>({left:x,right:x+4,top:0,bottom:800,separating:true,orientation:'vertical',state:'HALF_OPENED'}));const panes=adaptivePanes(ids,1200,700,{width:1200,height:800,folds});assert.equal(panes.length,ids.length);assert.equal(new Set(panes.map(r=>r.id)).size,ids.length);for(const p of panes)for(const f of folds)assert.ok((p.x+p.w)*1200<=f.left-6+.01||p.x*1200>=f.right+6-.01)});
test('tabletop video is above fold and reading is below',()=>{const v={width:850,height:900,folds:[{left:0,right:850,top:460,bottom:464,separating:true,orientation:'horizontal',state:'HALF_OPENED'}]};const panes=adaptivePanes(ids,850,800,v,{left:0,top:100});const video=panes.find(r=>r.id==='video')!;assert.ok((video.y+video.h)*800<360);for(const p of panes.filter(r=>r.id!=='video'))assert.ok(p.y*800>364)});
test('flat fold is not an unnecessary gutter; layout identity includes real posture',()=>{const v={width:900,height:800,folds:[{left:450,right:450,top:0,bottom:800,separating:false,orientation:'vertical',state:'FLAT'}]};assert.equal(foldLayoutSignature(v),'flat');assert.equal(adaptivePanes(['slides'],900,700,v)[0].w,1)});
test('canvas origin clips fold geometry after toolbar, not windoworigin',()=>{const v={width:900,height:800,folds:[{left:454,right:458,top:0,bottom:800,separating:true,orientation:'vertical',state:'HALF_OPENED'}]};const panes=adaptivePanes(['slides','transcript'],884,650,v,{left:8,top:100});const a=panes[0],b=panes[1];assert.ok((a.x+a.w)*884<=440.01);assert.ok(b.x*884>=455.99)});
test('two horizontal hinges keep every feature in a safe region, including the second hinge',()=>{
 const origin={left:0,top:100},height=1350;
 const folds=[1020,540].map(top=>({left:0,right:950,top,bottom:top+8,separating:true,orientation:'horizontal',state:'HALF_OPENED'}));
 const panes=adaptivePanes(ids,950,height,{width:950,height:1450,folds},origin);
 assert.equal(panes.length,ids.length);assert.equal(new Set(panes.map(p=>p.id)).size,ids.length);
 for(const p of panes){assert.ok(p.y>=0&&p.h>0&&p.y+p.h<=1.00001);for(const f of folds){const top=p.y*height+origin.top,bottom=(p.y+p.h)*height+origin.top;assert.ok(bottom<=f.top-6+.01||top>=f.bottom+6-.01,`${p.id} crosses hinge at ${f.top}`)}}
 assert.ok((panes.find(p=>p.id==='video')!.y+panes.find(p=>p.id==='video')!.h)*height+origin.top<=534.01);
 for(const id of ['slides','transcript']){const pane=panes.find(p=>p.id===id)!;assert.ok(pane.y*height+origin.top>=553.99);assert.ok((pane.y+pane.h)*height+origin.top<=1014.01)}
 for(const id of ['notes','ai','summary'])assert.ok(panes.find(p=>p.id===id)!.y*height+origin.top>=1033.99);
});
test('horizontal double hinges also protect narrow layouts and zero-width creases',()=>{
 const folds=[400,800].map(top=>({left:0,right:440,top,bottom:top,separating:true,orientation:'horizontal',state:'HALF_OPENED'}));
 const panes=adaptivePanes(ids,440,1200,{width:440,height:1200,folds});
 assert.equal(panes.length,ids.length);
 for(const p of panes)for(const f of folds)assert.ok((p.y+p.h)*1200<=f.top-6+.01||p.y*1200>=f.bottom+6-.01);
});
test('tabletop video stays above a single hinge even when video is the only feature',()=>{
 const fold={left:0,right:850,top:460,bottom:464,separating:true,orientation:'horizontal',state:'HALF_OPENED'};
 const [video]=adaptivePanes(['video'],850,800,{width:850,height:900,folds:[fold]},{left:0,top:100});
 assert.equal(video.id,'video');assert.equal(video.y,0);assert.ok(video.h*800+100<=454.01);
});
test('tools-only horizontal multi-fold layout fills successive regions without duplicate panes',()=>{
 const folds=[400,800].map(top=>({left:0,right:950,top,bottom:top+4,separating:true,orientation:'horizontal',state:'HALF_OPENED'}));
 const panes=adaptivePanes(['notes','ai','summary'],950,1200,{width:950,height:1200,folds});
 assert.deepEqual(panes.map(p=>p.id),['notes','ai','summary']);assert.deepEqual(panes.map(p=>p.z),[0,1,2]);
 assert.ok(panes[0].y===0&&panes[1].y*1200>=409.99&&panes[2].y*1200>=809.99);
});
test('horizontal hinge overlapping the canvas top is clipped rather than drawn through',()=>{
 const fold={left:0,right:850,top:95,bottom:108,separating:true,orientation:'horizontal',state:'HALF_OPENED'};
 const panes=adaptivePanes(['video','transcript'],850,700,{width:850,height:800,folds:[fold]},{left:0,top:100});
 assert.equal(panes.length,2);for(const p of panes)assert.ok(p.y*700+100>=113.99);
});
