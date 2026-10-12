import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cameraSampleTimes, cameraFrame, sameCameraFrames, collapseCameraSources } from '../src/renderer/videoLogic';

function frame(at:number,colors:number[][]=[[255,255,255],[12,18,24]],aspect=16/9){const pixels=new Uint8Array(64*36*4);for(let y=0;y<36;y++)for(let x=0;x<64;x++){const i=(y*64+x)*4,color=colors[Math.floor(x/8)%colors.length];pixels[i]=color[0];pixels[i+1]=color[1];pixels[i+2]=color[2];pixels[i+3]=255;}return cameraFrame(pixels,64,36,aspect,at)}
test('camera probing uses the same two course-relative times and never fabricates a tiny live history window',()=>{
 assert.deepEqual(cameraSampleTimes({start:0,end:600,seekable:true},false),[30,90]);
 assert.deepEqual(cameraSampleTimes({start:400,end:700,seekable:true},true),[676,694]);
 assert.deepEqual(cameraSampleTimes({start:0,end:24,seekable:true},false),[6,16.8]);
 assert.equal(cameraSampleTimes({start:0,end:8,seekable:true},true),undefined);assert.equal(cameraSampleTimes({start:0,end:600,seekable:false},false),undefined);
});
test('two aligned detailed RGB frames confirm duplicate sources, a single frame cannot',()=>{
 const left=[frame(30),frame(90)],right=[frame(30.05),frame(89.98)];assert.equal(sameCameraFrames(left,right),true);assert.equal(sameCameraFrames([left[0]],[right[0]]),false);
});
test('blank, solid-colour and black frames are insufficient evidence to hide any camera',()=>{
 for(const color of [[0,0,0],[255,255,255],[255,0,0]]){const frames=[frame(30,[color]),frame(90,[color])];assert.equal(sameCameraFrames(frames,frames),false)}
});
test('same grayscale brightness with different RGB colours, wrong aspect and wrong timeline stay separate',()=>{
 const red=[frame(30,[[255,0,0],[0,0,0]]),frame(90,[[255,0,0],[0,0,0]])],blue=[frame(30,[[0,0,255],[0,0,0]]),frame(90,[[0,0,255],[0,0,0]])];assert.equal(sameCameraFrames(red,blue),false);
 const left=[frame(30),frame(90)];assert.equal(sameCameraFrames(left,[frame(30,undefined,4/3),frame(90,undefined,4/3)]),false);assert.equal(sameCameraFrames(left,[frame(32),frame(92)]),false);
});
test('small codec noise is tolerated but different content in either sampled scene cannot merge',()=>{
 const left=[frame(30),frame(90)],near=[frame(30,[[253,254,253],[13,19,24]]),frame(90,[[253,254,253],[13,19,24]])];assert.equal(sameCameraFrames(left,near),true);
 assert.equal(sameCameraFrames(left,[frame(30),frame(90,[[200,150,10],[12,18,24]])]),false);
});
test('menu collapse keeps whichever equivalent source is selected without changing its playback identity',()=>{
 const sources=[{id:'a',identity:'url-a'},{id:'b',identity:'url-b'},{id:'c',identity:'url-c'}],groups=[['url-a','url-b']];
 assert.deepEqual(collapseCameraSources(sources,groups,'').map(source=>source.id),['a','c']);
 assert.deepEqual(collapseCameraSources(sources,groups,'b').map(source=>source.id),['b','c']);
 assert.deepEqual(collapseCameraSources(sources,[['expired','url-a']],'').map(source=>source.id),['a','b','c']);
});
