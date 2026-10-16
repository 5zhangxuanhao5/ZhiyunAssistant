const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
async function fixture(html='',extra={}) {
  const dom=new JSDOM('<!doctype html><div id="notes"></div><button id="elsewhere">Elsewhere</button>',{url:'http://127.0.0.1:5000/token/index.html',pretendToBeVisual:true});
  const context=vm.createContext({console,Date,Math,Number,String,Object,Array,TypeError,Error,document:dom.window.document});
  const module=new vm.SourceTextModule(fs.readFileSync(path.join(__dirname,'../web/parity-notes.js'),'utf8'),{context});await module.link(()=>new vm.SourceTextModule(fs.readFileSync(path.join(__dirname,'../web/theme-icons.js'),'utf8'),{context}));await module.evaluate();
  const changes=[],links=[],times=[],opts={note:{id:'n',html},clock:()=>125,onChange:h=>changes.push(h),onNavigate:b=>links.push(b),onTimeLink:n=>times.push(n),...extra};
  const editor=new module.namespace.NoteEditor(dom.window.document.querySelector('#notes'),opts);
  dom.window.HTMLElement.prototype.scrollIntoView=()=>{};
  const choose=(body,start,end=start)=>{body.focus();const node=body.firstChild||body,range=dom.window.document.createRange();range.setStart(node,start);range.setEnd(node,end);const selection=dom.window.getSelection();selection.removeAllRanges();selection.addRange(range);editor.rememberSelection();return range};
  return{dom,win:dom.window,doc:dom.window.document,editor,changes,links,times,choose,module:module.namespace};
}
test('legacy text, formatted references and image notes migrate without losing timeline metadata',async()=>{
  const f=await fixture('<div><b>Before</b></div><figure data-source="summary" data-t="80" data-ref="page|course"><figcaption>本页速览 · 1:20</figcaption><div class="rich-text"><strong>Summary</strong> <a href="#" data-time-seconds="36">0:36</a></div></figure><div>After</div>');
  assert.equal(f.editor.blocks().length,3);assert.deepEqual(Array.from(f.editor.blocks(),n=>n.dataset.source),['mine','summary','mine']);assert.ok(f.editor.getHTML().includes('<strong>Summary</strong>'));assert.ok(f.editor.getHTML().includes('data-time-seconds="36"'));assert.equal(f.editor.blocks()[1].dataset.ref,'page|course');assert.ok(!f.editor.getHTML().includes('contenteditable'));assert.ok(!f.editor.getHTML().includes('note-remove'));f.editor.destroy();
});
test('inserting a reference into a text caret preserves both halves and focuses the suffix',async()=>{
  const f=await fixture('<div>abcdef</div>');const body=f.doc.querySelector('.note-body');f.choose(body,3);
  f.editor.insertReference({source:'transcript',label:'课堂转写',t:15,value:'Teacher sentence'});
  assert.deepEqual(Array.from(f.editor.blocks(),n=>n.dataset.source),['mine','transcript','mine']);assert.deepEqual(Array.from(f.doc.querySelectorAll('.note-body'),n=>n.textContent),['abc','def']);assert.equal(f.win.getSelection().anchorNode.closest?.('.note-body')||f.win.getSelection().anchorNode.parentElement,f.doc.querySelectorAll('.note-body')[1]);assert.equal(f.win.getSelection().anchorOffset,0);f.editor.destroy();
});
test('leaving the editor to select a transcript retains the original insertion location',async()=>{
  const f=await fixture('<div>left-right</div>');const body=f.doc.querySelector('.note-body');f.choose(body,5);
  const outside=f.doc.querySelector('#elsewhere'),range=f.doc.createRange();range.selectNodeContents(outside);f.win.getSelection().removeAllRanges();f.win.getSelection().addRange(range);f.doc.dispatchEvent(new f.win.Event('selectionchange'));
  f.editor.insertReference({source:'summary',t:30,value:'<b>Rich</b> <a href="#" data-time-seconds="12">0:12</a>',html:true,ref:'page1|whole'});
  assert.equal(f.editor.blocks()[0].querySelector('.note-body').textContent,'left-');assert.equal(f.editor.blocks()[2].querySelector('.note-body').textContent,'right');assert.ok(f.editor.getHTML().includes('<b>Rich</b>'));f.editor.destroy();
});
test('insert at the gap between two quotations creates an editable block exactly there',async()=>{
  const f=await fixture('<figure data-source="transcript" data-t="1"><figcaption>转写</figcaption><div>A</div></figure><figure data-source="slide" data-t="2"><figcaption>课件</figcaption><img src="data:image/png;base64,YQ==" alt="Slide"></figure>');
  const second=f.editor.blocks()[1],gap=[...f.doc.querySelectorAll('.note-gap')].find(n=>n.dataset.before===second.dataset.blockId);gap.click();const active=f.doc.activeElement;active.textContent='between';active.dispatchEvent(new f.win.InputEvent('input',{bubbles:true,inputType:'insertText',data:'between'}));
  assert.deepEqual(Array.from(f.editor.blocks(),n=>n.dataset.source),['transcript','mine','slide']);assert.equal(f.editor.blocks()[1].querySelector('.note-body').textContent,'between');assert.equal(f.editor.blocks()[1].dataset.t,'125');f.editor.destroy();
});
test('blank positioning blocks are removed on blur without deleting references',async()=>{
  const f=await fixture('<figure data-source="transcript" data-t="1"><figcaption>转写</figcaption><div>A</div></figure><figure data-source="summary" data-t="2"><figcaption>速览</figcaption><div>B</div></figure>');
  const gap=f.doc.querySelectorAll('.note-gap')[1];gap.click();assert.equal(f.editor.blocks().length,3);f.doc.querySelector('#elsewhere').focus();await new Promise(r=>setTimeout(r,5));assert.equal(f.editor.blocks().length,2);assert.ok(!f.editor.getHTML().includes('data-source="mine"'));f.editor.destroy();
});
test('IME Enter is never intercepted and composition is saved only after commitment',async()=>{
  const f=await fixture();const body=f.doc.querySelector('.note-body');f.choose(body,0);body.dispatchEvent(new f.win.CompositionEvent('compositionstart',{bubbles:true}));
  const event=new f.win.KeyboardEvent('keydown',{key:'Enter',keyCode:229,isComposing:true,bubbles:true,cancelable:true});body.dispatchEvent(event);assert.equal(event.defaultPrevented,false);
  const before=new f.win.InputEvent('beforeinput',{inputType:'insertParagraph',isComposing:true,bubbles:true,cancelable:true});body.dispatchEvent(before);assert.equal(before.defaultPrevented,false);assert.equal(f.editor.blocks().length,1);body.textContent='英文';body.dispatchEvent(new f.win.InputEvent('input',{bubbles:true,isComposing:true}));assert.equal(f.changes.length,0);body.dispatchEvent(new f.win.CompositionEvent('compositionend',{bubbles:true}));assert.equal(f.changes.length,1);assert.ok(f.editor.getHTML().includes('英文'));f.editor.destroy();
});
test('a committed newline splits own notes without losing formatted suffix',async()=>{
  const f=await fixture('<div>ab<b>cd</b></div>');const body=f.doc.querySelector('.note-body');f.choose(body,1);
  const event=new f.win.InputEvent('beforeinput',{inputType:'insertParagraph',bubbles:true,cancelable:true});body.dispatchEvent(event);assert.equal(event.defaultPrevented,true);assert.equal(f.editor.blocks().length,2);assert.equal(f.doc.querySelectorAll('.note-body')[0].textContent,'a');assert.equal(f.doc.querySelectorAll('.note-body')[1].innerHTML,'b<b>cd</b>');f.editor.destroy();
});
test('numbers and arrow selections remain native instead of being consumed by pane shortcuts',async()=>{
  const f=await fixture('<div>0123456789</div>');const body=f.doc.querySelector('.note-body');f.choose(body,3);
  for(const key of ['4','ArrowUp','ArrowDown','ArrowLeft']){const event=new f.win.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,shiftKey:key==='ArrowLeft'});body.dispatchEvent(event);assert.equal(event.defaultPrevented,false)}f.editor.destroy();
});
test('first Cmd A selects the block and second selects the whole note including images',async()=>{
  const f=await fixture('<div>Typing</div><figure data-source="slide" data-t="6"><figcaption>课件</figcaption><img src="data:image/png;base64,YQ==" alt="Slide"></figure>');const body=f.doc.querySelector('.note-body');f.choose(body,1);
  const select=()=>body.dispatchEvent(new f.win.KeyboardEvent('keydown',{key:'a',metaKey:true,bubbles:true,cancelable:true}));select();assert.equal(f.win.getSelection().toString(),'Typing');assert.equal(f.editor.wholeSelected,false);select();assert.equal(f.editor.wholeSelected,true);assert.ok(f.editor.selectionPayload().html.includes('data:image/png;base64,YQ=='));assert.ok(f.editor.selectionPayload().text.includes('[Slide]'));assert.ok(!f.editor.selectionPayload().text.includes('×'));f.doc.querySelector('#elsewhere').dispatchEvent(new f.win.MouseEvent('pointerdown',{bubbles:true}));assert.equal(f.editor.wholeSelected,false);assert.equal(f.win.getSelection().rangeCount,0);f.editor.destroy();
});
test('whole-note clipboard retains rich text and images while excluding editing buttons',async()=>{
  const f=await fixture('<div><b>Own note</b></div><figure data-source="question" data-t="9"><figcaption>课程问答</figcaption><div><i>Answer</i></div></figure>');f.editor.selectAll();const values={};const event=new f.win.Event('copy',{bubbles:true,cancelable:true});Object.defineProperty(event,'clipboardData',{value:{setData(type,value){values[type]=value}}});f.editor.element.dispatchEvent(event);assert.equal(event.defaultPrevented,true);assert.ok(values['text/html'].includes('<b>Own note</b>'));assert.ok(values['text/html'].includes('<i>Answer</i>'));assert.ok(!values['text/html'].includes('note-gap'));assert.ok(!values['text/plain'].includes('×'));f.editor.destroy();
});
test('source header and embedded timeline link navigate independently; delete never navigates',async()=>{
  const f=await fixture('<figure data-source="question" data-t="9" data-ref="chat:1"><figcaption>课程问答</figcaption><div><a href="#" data-time-seconds="30">0:30</a></div></figure>');f.doc.querySelector('.note-source-name').click();assert.equal(f.links.length,1);f.doc.querySelector('[data-time-seconds]').click();assert.equal(f.times.length,1);assert.equal(f.links.length,1);f.doc.querySelector('.note-remove').click();assert.equal(f.links.length,1);assert.equal(f.editor.blocks()[0].dataset.source,'mine');f.editor.destroy();
});
test('same note refresh leaves live DOM, caret and unsaved IME content intact',async()=>{
  const f=await fixture('<div>Stable</div>');const body=f.doc.querySelector('.note-body');f.choose(body,3);f.editor.setNote({id:'n',html:'Stale stored text'});assert.equal(f.doc.querySelector('.note-body'),body);assert.equal(f.win.getSelection().anchorOffset,3);assert.equal(body.textContent,'Stable');f.editor.setNote({id:'another',html:'<div>Other note</div>'});assert.notEqual(f.doc.querySelector('.note-body'),body);assert.equal(f.doc.querySelector('.note-body').textContent,'Other note');f.editor.destroy();
});
test('only the six pale source colors can be stored and settings remain scrollable',async()=>{
  const f=await fixture('<div>A</div>');const values=f.editor.setPalette({mine:'#FCECF2',transcript:'red'});assert.equal(values.mine,'#FCECF2');assert.equal(values.transcript,'#EAF4FF');const settings=f.editor.createPaletteControls();assert.equal(settings.querySelectorAll('.note-color-row').length,6);assert.equal(settings.querySelectorAll('button').length,36);assert.equal(f.doc.querySelector('figure').style.getPropertyValue('--note-color'),'#FCECF2');f.editor.destroy();
});
test('untrusted rich paste drops scripts, external images, handlers and CSS URLs',async()=>{
  const f=await fixture('<div>safe</div>');const clean=f.module.sanitizeNoteHTML(f.doc,'<script>evil()</script><b onclick="evil()">Bold</b><img src="https://evil.test/a"><a href="javascript:evil()">Text</a><div style="background:url(https://evil.test);font-weight:bold">Note</div>');assert.ok(!clean.includes('script'));assert.ok(!clean.includes('onclick'));assert.ok(!clean.includes('evil.test'));assert.ok(!clean.includes('javascript:'));assert.ok(clean.includes('font-weight:bold'));assert.ok(clean.includes('<b>Bold</b>'));f.editor.destroy();
});
test('plain multi-line paste produces separate editable source blocks at the caret',async()=>{
  const f=await fixture('<div>StartEnd</div>');const body=f.doc.querySelector('.note-body');f.choose(body,5);const event=new f.win.Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(event,'clipboardData',{value:{getData(type){return type==='text/plain'?'One\nTwo':''}}});body.dispatchEvent(event);assert.equal(event.defaultPrevented,true);assert.deepEqual(Array.from(f.doc.querySelectorAll('.note-body'),n=>n.textContent),['StartOne','TwoEnd']);f.editor.destroy();
});
test('inserting from a selected reference stays before the following block rather than appending',async()=>{
  const f=await fixture('<figure data-source="transcript" data-t="1"><figcaption>转写</figcaption><div>A</div></figure><figure data-source="summary" data-t="2"><figcaption>速览</figcaption><div>B</div></figure>');const body=f.doc.querySelector('.note-reference-content');f.choose(body,0,1);f.editor.insertReference({source:'image',t:3,value:'data:image/png;base64,YQ==',label:'Picture'});assert.deepEqual(Array.from(f.editor.blocks(),n=>n.dataset.source),['transcript','image','mine','summary']);f.editor.destroy();
});
test('editing an existing note keeps its original timestamp instead of retiming every first keystroke',async()=>{
  const f=await fixture('<figure data-source="mine" data-t="42"><figcaption>我的笔记</figcaption><div class="note-body">Earlier</div></figure>');const body=f.doc.querySelector('.note-body');body.textContent+=' note';body.dispatchEvent(new f.win.InputEvent('input',{bubbles:true}));assert.equal(body.parentElement.dataset.t,'42');f.editor.destroy();
});
test('whole-note delete clears the former native block selection and leaves one usable caret',async()=>{
  const f=await fixture('<div>First</div><div>Second</div>');const body=f.doc.querySelector('.note-body');f.choose(body,0,5);f.editor.selectAll();const event=new f.win.KeyboardEvent('keydown',{key:'Backspace',bubbles:true,cancelable:true});body.dispatchEvent(event);assert.equal(event.defaultPrevented,true);assert.equal(f.editor.blocks().length,1);assert.equal(f.editor.getHTML(),'');assert.equal(f.editor.wholeSelected,false);assert.equal(f.doc.activeElement.className,'note-body');f.editor.destroy();
});
