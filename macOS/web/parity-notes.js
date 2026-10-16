import {makeIcon} from "./theme-icons.js";
/**
 * The Harmony note-block editing model, backed by native WebKit editing on Mac.
 * Keep one instance mounted for a note: live captions and media updates must not
 * replace this DOM. The host owns note storage, image picking and navigation.
 */
export const NOTE_COLORS = ['#EAF4FF', '#FFF5D9', '#FCECF2', '#EAF5ED', '#FFF0E4', '#F1EDFA'];
export const DEFAULT_NOTE_PALETTE = {mine:'#FFF5D9',transcript:'#EAF4FF',slide:'#EAF5ED',image:'#FCECF2',question:'#F1EDFA',summary:'#FFF0E4'};
const TITLES = {mine:'我的笔记',transcript:'课堂转写',slide:'课件',image:'图片',question:'课程问答',summary:'本页速览'};
const sourceKey = source => source === 'notes' ? 'mine' : source === 'slides' ? 'slide' : Object.hasOwn(TITLES,source) ? source : 'mine';
export const isNoteAssetPath = value => /^note-assets\/[a-f0-9]{64}\.(?:png|jpg|webp|gif|avif)$/.test(String(value||''));
const makeId = () => 'block-'+Date.now()+'-'+Math.random().toString(36).slice(2,9);
const meaningful = node => !!node.textContent.replace(/[\u200B\uFEFF\s]/g,'') || !!node.querySelector('img');
const stamp = raw => {const t=Math.max(0,Math.floor(Number(raw)||0));return(t>=3600?Math.floor(t/3600)+':':'')+String(Math.floor(t/60)%60).padStart(t>=3600?2:1,'0')+':'+String(t%60).padStart(2,'0')};

export function validNotePalette(value={}) {
  return Object.fromEntries(Object.entries(DEFAULT_NOTE_PALETTE).map(([source,color])=>[source,NOTE_COLORS.includes(value[source] || value[source==='mine'?'notes':source==='slide'?'slides':source]) ? value[source] || value[source==='mine'?'notes':'slides'] : color]));
}

/** Sanitizes imported notes and external rich-text paste, retaining timeline data. */
export function sanitizeNoteHTML(doc,html,origin=doc.defaultView?.location.origin||'') {
  const template=doc.createElement('template');template.innerHTML=String(html||'');
  template.content.querySelectorAll('script,iframe,object,embed,style,link,meta,form,input,textarea,select,svg,math').forEach(n=>n.remove());
  template.content.querySelectorAll('*').forEach(node=>{
    for(const attr of [...node.attributes]) {
      const name=attr.name.toLowerCase(),value=attr.value;
      if(name.startsWith('on')||['srcdoc','contenteditable','autofocus','id'].includes(name)||(name==='href'&&!value.startsWith('#'))||(name==='src'&&node.tagName!=='IMG'))node.removeAttribute(attr.name);
      if(name==='style') {
        const allowed=['font-weight','font-style','text-decoration','text-align','white-space'];
        const safe=allowed.map(key=>{const v=node.style.getPropertyValue(key);return v && !/[();]|url|expression|javascript/i.test(v) ? key+':'+v : ''}).filter(Boolean).join(';');
        if(safe)node.setAttribute('style',safe);else node.removeAttribute('style');
      }
    }
    if(node.tagName==='IMG') {
      const src=node.getAttribute('src')||'';
      const local=src.startsWith('/')&&!src.startsWith('//') || origin&&src.startsWith(origin+'/');
      if(!/^data:image\/(png|jpeg|webp|gif|avif);base64,[\w+/=\s]+$/i.test(src)&&!isNoteAssetPath(src)&&!local)node.remove();
    }
    if(node.tagName==='BUTTON'&&!node.hasAttribute('data-time-seconds'))node.replaceWith(...node.childNodes);
  });
  return template.innerHTML;
}

export class NoteEditor {
  constructor(container,{note=null,clock=()=>0,onChange=()=>{},onNavigate=()=>{},onTimeLink=()=>{},onFocus=()=>{},onPaletteChange=()=>{},onCopy=null,palette={},placeholder='记下笔记…'}={}) {
    if(!container?.ownerDocument)throw new TypeError('NoteEditor needs a DOM container');
    this.container=container;this.doc=container.ownerDocument;this.win=this.doc.defaultView;
    this.options={clock,onChange,onNavigate,onTimeLink,onFocus,onPaletteChange,onCopy,placeholder};
    this.palette=validNotePalette(palette);this.range=null;this.activeId='';this.noteId='';this.composing=false;this.destroyed=false;this.wholeSelected=false;this.lastAll=0;this.lastBlock='';this.beforeWhole=null;this.listeners=[];
    this.element=this.doc.createElement('div');this.element.className='notes-editor parity-notes';this.element.tabIndex=-1;this.element.setAttribute('role','group');this.element.setAttribute('aria-label','课堂笔记正文');
    container.replaceChildren(this.element);
    this.listen(this.doc,'selectionchange',()=>this.rememberSelection());
    this.listen(this.doc,'pointerdown',event=>{if(this.wholeSelected&&!this.element.contains(event.target)&&!event.target.closest?.('.note-copy-menu'))this.clearSelection()},true);
    this.listen(this.element,'focusin',event=>{this.options.onFocus();const block=event.target.closest?.('.note-block');if(block)this.activeId=block.dataset.blockId});
    this.listen(this.element,'focusout',()=>this.win.setTimeout(()=>{if(!this.composing)this.cleanEmptyBlocks()},0));
    this.listen(this.element,'pointerdown',event=>{
      this.options.onFocus();
      if(!this.wholeSelected){this.lastAll=0;this.lastBlock='';return}
      if(event.target.closest?.('.note-body,.note-reference-content')){event.preventDefault();this.showCopyMenu()}else this.clearSelection();
    });
    this.listen(this.element,'input',event=>this.didInput(event));
    this.listen(this.element,'beforeinput',event=>{
      if(this.composing||event.isComposing)return;
      if(this.wholeSelected&&event.inputType==='insertText'&&typeof event.data==='string'){event.preventDefault();this.insertFragment(event.data,false);return}
      if(event.inputType==='insertParagraph'||event.inputType==='insertLineBreak'){event.preventDefault();this.splitAtCaret()}
    });
    this.listen(this.element,'compositionstart',()=>{this.composing=true;this.clearWholeStyle()});
    this.listen(this.element,'compositionend',()=>{this.composing=false;this.rememberSelection();this.commit()});
    this.listen(this.element,'keydown',event=>this.handleKey(event));
    this.listen(this.element,'copy',event=>this.copyEvent(event));
    this.listen(this.element,'cut',event=>{if(this.wholeSelected){this.copyEvent(event);this.element.replaceChildren(this.makeBlock('mine'));this.refreshGaps();this.focusEnd();this.commit()}});
    this.listen(this.element,'paste',event=>this.pasteEvent(event));
    this.listen(this.element,'click',event=>this.click(event));
    this.setNote(note||{id:'',html:''});
  }
  listen(target,type,fn,options){target.addEventListener(type,fn,options);this.listeners.push(()=>target.removeEventListener(type,fn,options))}
  setNote(note,{force=false}={}) {
    const id=String(note?.id||'');
    if(!force&&this.noteId===id&&this.loaded)return; // Media ticks cannot replace an active caret.
    this.noteId=id;this.loaded=true;this.range=null;this.activeId='';this.composing=false;this.clearSelection();
    const temp=this.doc.createElement('div');temp.innerHTML=sanitizeNoteHTML(this.doc,note?.html||'');
    const blocks=[];let pending=this.doc.createElement('div');
    const flush=()=>{if(meaningful(pending)){blocks.push(this.makeBlock('mine',{t:0,html:pending.innerHTML}));pending=this.doc.createElement('div')}};
    for(const child of [...temp.childNodes]) {
      if(child.nodeType===1&&child.tagName==='FIGURE') {
        flush();const source=sourceKey(child.dataset.source),header=child.querySelector('figcaption');
        const own=child.querySelector('.note-body');
        const body=child.querySelector('.note-reference-content,.rich-text');
        const contents=own?.innerHTML || body?.innerHTML || [...child.childNodes].filter(n=>n!==header).map(n=>n.outerHTML??n.textContent).join('');
        const label=child.dataset.label || header?.textContent.replace(/\s*·\s*\d[\d:]*\s*$/,'').trim() || TITLES[source];
        blocks.push(this.makeBlock(source,{id:child.dataset.blockId,t:Number(child.dataset.t)||0,end:Number(child.dataset.end)||Number(child.dataset.t)||0,ref:child.dataset.ref||'',label,html:contents,align:own?.style.textAlign||''}));
      } else if(child.nodeType===1&&['DIV','P'].includes(child.tagName)) {
        flush();if(meaningful(child))blocks.push(this.makeBlock('mine',{t:0,html:child.innerHTML,align:child.style.textAlign}));
      } else pending.append(child);
    }
    flush();if(!blocks.length)blocks.push(this.makeBlock('mine'));
    this.element.replaceChildren(...blocks);this.refreshGaps();this.applyPalette();
  }
  makeBlock(source,{id=makeId(),t=this.options.clock(),end=t,ref='',label=TITLES[sourceKey(source)],html='',value='',align=''}={}) {
    source=sourceKey(source);const figure=this.doc.createElement('figure');figure.className='note-block';
    Object.assign(figure.dataset,{blockId:id,source,t:String(Math.max(0,Number(t)||0)),end:String(Math.max(0,Number(end)||0)),ref:String(ref||''),label:String(label||TITLES[source])});
    const header=this.doc.createElement('figcaption');header.className='note-block-header';header.tabIndex=0;header.setAttribute('role','button');header.setAttribute('aria-label','返回'+figure.dataset.label+'的来源');
    const name=this.doc.createElement('span');name.className='note-source-name';name.textContent=figure.dataset.label;
    const time=this.doc.createElement('time');time.className='note-block-time';time.textContent=stamp(figure.dataset.t);time.dataset.noteUi='true';
    const remove=this.doc.createElement('button');remove.type='button';remove.className='note-remove';remove.append(makeIcon('close',this.doc));remove.title='删除这个笔记框';remove.setAttribute('aria-label','删除'+figure.dataset.label);remove.dataset.noteUi='true';
    header.append(name,time,remove);figure.append(header);
    const body=this.doc.createElement('div');body.className=source==='mine'?'note-body':'note-reference-content rich-text';
    if(source==='mine'){body.contentEditable='true';body.setAttribute('contenteditable','true');body.setAttribute('role','textbox');body.setAttribute('aria-label','我的笔记');body.setAttribute('aria-multiline','true');body.dataset.placeholder=this.options.placeholder;body.spellcheck=false;body.style.textAlign=align||'left'}
    if(html)body.innerHTML=sanitizeNoteHTML(this.doc,html);else body.textContent=value;
    figure.append(body);if(source==='mine'&&meaningful(body))figure.dataset.written='true';figure.style.setProperty('--note-color',this.palette[source]);return figure;
  }
  blocks(){return[...this.element.children].filter(n=>n.classList.contains('note-block'))}
  refreshGaps(){
    this.element.querySelectorAll(':scope > .note-gap').forEach(n=>n.remove());
    const blocks=this.blocks();
    for(let i=0;i<=blocks.length;i++) {
      const gap=this.doc.createElement('button');gap.type='button';gap.className='note-gap';gap.setAttribute('aria-label',i===blocks.length?'在末尾写笔记':'在这里写笔记');gap.title='在这里写笔记';gap.dataset.before=blocks[i]?.dataset.blockId||'';gap.dataset.noteUi='true';
      const hint=this.doc.createElement('span');hint.textContent='＋ 记笔记';gap.append(hint);
      if(blocks[i])this.element.insertBefore(gap,blocks[i]);else this.element.append(gap);
    }
  }
  applyPalette(){for(const block of this.blocks())block.style.setProperty('--note-color',this.palette[sourceKey(block.dataset.source)])}
  setPalette(value){this.palette=validNotePalette(value);this.applyPalette();this.options.onPaletteChange({...this.palette});return{...this.palette}}
  createPaletteControls(){
    const settings=this.doc.createElement('div');settings.className='note-color-settings';
    for(const [source,title] of Object.entries(TITLES)) {
      const row=this.doc.createElement('div');row.className='note-color-row';const label=this.doc.createElement('span');label.textContent=title;row.append(label);
      for(const color of NOTE_COLORS){const b=this.doc.createElement('button');b.type='button';b.className='note-color-swatch';b.style.backgroundColor=color;b.title=title+'颜色 '+color;b.setAttribute('aria-label',b.title);b.setAttribute('aria-pressed',String(this.palette[source]===color));b.onclick=()=>{this.setPalette({...this.palette,[source]:color});row.querySelectorAll('button').forEach(n=>n.setAttribute('aria-pressed',String(n===b)))};row.append(b)}
      settings.append(row);
    }
    return settings;
  }
  getHTML(){
    const copy=this.element.cloneNode(true);copy.querySelectorAll('[data-note-ui],.note-gap,.note-copy-menu').forEach(n=>n.remove());
    for(const block of [...copy.children]) {
      if(block.dataset.source==='mine'&&!meaningful(block.querySelector('.note-body')))block.remove();
      block.removeAttribute('style');block.classList.remove('note-whole-selected');
    }
    copy.querySelectorAll('[contenteditable],[tabindex],[role],[aria-label],[aria-multiline],[data-placeholder], [spellcheck]').forEach(n=>['contenteditable','tabindex','role','aria-label','aria-multiline','data-placeholder','spellcheck'].forEach(attr=>n.removeAttribute(attr)));
    return copy.innerHTML;
  }
  rememberSelection(){
    const selection=this.win.getSelection();if(!selection?.rangeCount)return false;
    const range=selection.getRangeAt(0);
    if(!this.element.contains(range.startContainer)||!this.element.contains(range.endContainer))return false;
    this.range=range.cloneRange();const parent=range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement;
    const block=parent?.closest('.note-block');if(block)this.activeId=block.dataset.blockId;
    return true;
  }
  restoreSelection(){
    let range=this.range;
    if(!range||!this.element.contains(range.startContainer)||!this.element.contains(range.endContainer)) {
      const block=this.blocks().find(n=>n.dataset.blockId===this.activeId&&n.dataset.source==='mine') || this.blocks().filter(n=>n.dataset.source==='mine').at(-1);
      const target=block?.querySelector('.note-body') || this.addOwnBlock(null);
      range=this.doc.createRange();range.selectNodeContents(target);range.collapse(false);
    }
    const body=(range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement)?.closest('.note-body');
    (body||this.element).focus({preventScroll:true});const selection=this.win.getSelection();selection.removeAllRanges();selection.addRange(range);this.range=range.cloneRange();return range;
  }
  caret(body,end=false){
    body.focus({preventScroll:true});const range=this.doc.createRange();range.selectNodeContents(body);range.collapse(!end);const selection=this.win.getSelection();selection.removeAllRanges();selection.addRange(range);this.range=range.cloneRange();this.activeId=body.closest('.note-block')?.dataset.blockId||'';
  }
  addOwnBlock(before,html='',t=this.options.clock()) {
    const block=this.makeBlock('mine',{t,html});if(before)this.element.insertBefore(block,before);else this.element.append(block);this.refreshGaps();return block.querySelector('.note-body');
  }
  cleanEmptyBlocks(){
    if(this.destroyed||this.composing)return;const active=this.doc.activeElement?.closest?.('.note-block');let changed=false;
    for(const block of this.blocks())if(block.dataset.source==='mine'&&!meaningful(block.querySelector('.note-body'))&&block!==active){block.remove();changed=true}
    if(!this.blocks().length){this.element.append(this.makeBlock('mine'));changed=true}
    if(changed){this.refreshGaps();this.commit()}
  }
  insertionPlace(){
    let range=this.restoreSelection();const parent=range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement;
    const body=parent?.closest('.note-body'),block=parent?.closest('.note-block');
    if(body&&body.contains(range.endContainer))return{range,body,block};
    // A gap or a selected noneditable quote inserts next to that block, never at
    // the end of a different note. Whole-note replacement is handled explicitly.
    if(this.wholeSelected){this.element.replaceChildren(this.makeBlock('mine'));this.refreshGaps();this.clearWholeStyle()}
    const list=this.blocks(),following=block?list[list.indexOf(block)+1]:null;
    const own=this.addOwnBlock(following||null);
    this.caret(own);range=this.range.cloneRange();return{range,body:own,block:own.parentElement};
  }
  insertReference({source='transcript',label=TITLES[sourceKey(source)],t=this.options.clock(),end=t,value='',html=false,ref='',id}={}) {
    const normalized=sourceKey(source);if(normalized==='mine')throw new TypeError('Use native editing for own note text');
    let content;
    if(normalized==='slide'||normalized==='image') {
      const image=this.doc.createElement('img');image.src=String(value);image.alt=String(label);content=sanitizeNoteHTML(this.doc,image.outerHTML);if(!content)throw new Error('图片格式不受支持，请重新选择图片');
    } else content=html?sanitizeNoteHTML(this.doc,value):null;
    const figure=this.makeBlock(normalized,{id,t,end,ref,label,...(content!==null?{html:content}:{value:String(value)})});
    const{range,body,block}=this.insertionPlace();range.deleteContents();const tail=this.doc.createRange();tail.setStart(range.startContainer,range.startOffset);tail.setEnd(body,body.childNodes.length);const suffix=tail.extractContents();
    const after=this.makeBlock('mine',{t:meaningful(suffix)?Number(block.dataset.t):t});after.querySelector('.note-body').append(suffix);
    const before=meaningful(body);block.after(figure,after);if(!before)block.remove();
    this.refreshGaps();this.caret(after.querySelector('.note-body'));this.cleanEmptyBlocks();this.commit();return figure;
  }
  splitAtCaret(){
    const{range,body,block}=this.insertionPlace();range.deleteContents();const tail=this.doc.createRange();tail.setStart(range.startContainer,range.startOffset);tail.setEnd(body,body.childNodes.length);const contents=tail.extractContents();
    const next=this.makeBlock('mine',{t:this.options.clock()});next.querySelector('.note-body').append(contents);block.after(next);this.refreshGaps();this.caret(next.querySelector('.note-body'));this.commit();
  }
  didInput(event){
    this.clearWholeStyle();this.lastAll=0;this.lastBlock='';const block=event.target.closest?.('.note-block');
    if(block&&block.dataset.source==='mine'&&!block.dataset.written&&meaningful(block.querySelector('.note-body'))){block.dataset.t=String(Math.max(0,Number(this.options.clock())||0));block.dataset.end=block.dataset.t;block.dataset.written='true';block.querySelector('time').textContent=stamp(block.dataset.t)}
    this.rememberSelection();if(!this.composing)this.commit();
  }
  commit(){if(!this.destroyed&&!this.composing)this.options.onChange(this.getHTML())}
  execFormat(command){
    this.restoreSelection();const range=this.range,body=(range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement)?.closest('.note-body');
    if(!body)return false;
    const align={justifyLeft:'left',justifyCenter:'center',justifyRight:'right'}[command];
    if(align){body.style.textAlign=align;this.commit();return true}
    const supported=['bold','italic','underline','strikeThrough','insertText'];if(!supported.includes(command))return false;
    const result=this.doc.execCommand?.(command,false,null);this.rememberSelection();this.commit();return !!result;
  }
  handleKey(event){
    if(this.composing||event.isComposing||event.keyCode===229)return;
    const command=event.ctrlKey||event.metaKey,key=event.key.toLowerCase();
    if(command&&key==='a') {
      const body=event.target.closest?.('.note-body'),block=event.target.closest?.('.note-block');
      if(!block&&!body)return;
      event.preventDefault();event.stopPropagation();
      const selected=this.win.getSelection(),content=body||block.querySelector('.note-reference-content');
      const fullBlock=selected?.rangeCount&&!selected.isCollapsed&&content.contains(selected.anchorNode)&&content.contains(selected.focusNode)&&selected.toString()===content.textContent;
      const whole=this.wholeSelected||fullBlock||this.lastBlock===block.dataset.blockId&&Date.now()-this.lastAll<1500;
      this.lastAll=Date.now();this.lastBlock=block.dataset.blockId;
      if(whole)this.selectAll();else{const range=this.doc.createRange();range.selectNodeContents(body||block.querySelector('.note-reference-content'));const selection=this.win.getSelection();selection.removeAllRanges();selection.addRange(range);this.range=range.cloneRange()}
      return;
    }
    if(command&&['b','i','u'].includes(key)){event.preventDefault();event.stopPropagation();this.execFormat({b:'bold',i:'italic',u:'underline'}[key]);return}
    if(event.key==='Escape'){this.clearSelection();return}
    if(this.wholeSelected&&['Backspace','Delete'].includes(event.key)){event.preventDefault();event.stopPropagation();this.element.replaceChildren(this.makeBlock('mine'));this.refreshGaps();this.clearWholeStyle();this.range=null;this.focusEnd();this.commit();return}
    if((event.key==='Enter'||event.key===' ')&&event.target.classList.contains('note-block-header')){event.preventDefault();this.options.onNavigate(event.target.closest('.note-block'));return}
    if(event.key==='Tab'&&!command){event.preventDefault();this.insertFragment('    ',false);return}
    // WebKit handles numeric keys, arrow selection and IME Enter natively. Only
    // a committed insertParagraph beforeinput creates a new timestamped block.
    if(['ArrowLeft','ArrowRight'].includes(event.key)&&!command&&!event.shiftKey) {
      const selection=this.win.getSelection(),body=event.target.closest?.('.note-body');
      if(!body||!selection?.isCollapsed)return;const range=selection.getRangeAt(0),probe=this.doc.createRange();probe.selectNodeContents(body);probe.setEnd(range.startContainer,range.startOffset);
      const offset=probe.toString().length,length=body.textContent.length,left=event.key==='ArrowLeft';
      if(left&&offset===0||!left&&offset===length){const own=this.blocks().filter(n=>n.dataset.source==='mine'),index=own.indexOf(body.parentElement),next=own[index+(left?-1:1)];if(next){event.preventDefault();this.caret(next.querySelector('.note-body'),left)}}
    }
  }
  insertFragment(value,html=false){
    const{range,body}=this.insertionPlace();range.deleteContents();const fragment=this.doc.createDocumentFragment();
    if(html){const temp=this.doc.createElement('template');temp.innerHTML=sanitizeNoteHTML(this.doc,value);fragment.append(temp.content)}else fragment.append(this.doc.createTextNode(value));
    const end=fragment.lastChild;range.insertNode(fragment);if(end){range.setStartAfter(end);range.collapse(true);const selection=this.win.getSelection();selection.removeAllRanges();selection.addRange(range);this.range=range.cloneRange()}body.focus({preventScroll:true});this.didInput({target:body});
  }
  pasteEvent(event){
    if(this.composing||!event.clipboardData)return;
    const html=event.clipboardData.getData('text/html'),text=event.clipboardData.getData('text/plain');if(!html&&!text)return;
    event.preventDefault();
    if(html){this.insertFragment(html,true);return}
    const pieces=text.replace(/\r\n?/g,'\n').split('\n');pieces.forEach((part,i)=>{if(i)this.splitAtCaret();if(part)this.insertFragment(part,false)});
  }
  click(event){
    const target=event.target.closest?.('button,[data-time-seconds],.note-block-header');
    if(!target)return;
    if(target.classList.contains('note-remove')){event.preventDefault();event.stopPropagation();const block=target.closest('.note-block');block.remove();this.range=null;this.cleanEmptyBlocks();this.refreshGaps();this.commit();return}
    if(target.classList.contains('note-gap')){event.preventDefault();const before=this.blocks().find(n=>n.dataset.blockId===target.dataset.before)||null;const body=this.addOwnBlock(before);this.caret(body);this.commit();return}
    if(target.hasAttribute('data-time-seconds')){event.preventDefault();event.stopPropagation();this.options.onTimeLink(target);return}
    if(target.classList.contains('note-block-header')){event.preventDefault();this.options.onNavigate(target.closest('.note-block'))}
  }
  selectAll(){
    this.beforeWhole=this.range?.cloneRange()||null;this.clearWholeStyle();this.wholeSelected=true;this.element.classList.add('note-whole-selected');const range=this.doc.createRange();range.selectNodeContents(this.element);const selection=this.win.getSelection();selection.removeAllRanges();selection.addRange(range);this.range=range.cloneRange();
  }
  clearWholeStyle(){this.wholeSelected=false;this.element.classList.remove('note-whole-selected');this.element.querySelector('.note-copy-menu')?.remove()}
  clearSelection(){const previous=this.wholeSelected?this.beforeWhole:null;this.clearWholeStyle();if(previous&&this.element.contains(previous.startContainer))this.range=previous;this.beforeWhole=null;this.lastAll=0;this.lastBlock='';const selection=this.win.getSelection();if(selection?.rangeCount&&this.element.contains(selection.anchorNode))selection.removeAllRanges()}
  selection(){return this.win.getSelection()}
  selectionPayload(){
    const selection=this.win.getSelection();if(!selection?.rangeCount||!this.element.contains(selection.anchorNode))return{html:'',text:''};
    const temp=this.doc.createElement('div');if(this.wholeSelected)temp.innerHTML=this.getHTML();else temp.append(selection.getRangeAt(0).cloneContents());
    temp.querySelectorAll('[data-note-ui],.note-gap,.note-copy-menu,.note-remove').forEach(n=>n.remove());
    temp.querySelectorAll('[contenteditable]').forEach(n=>n.removeAttribute('contenteditable'));
    const text=plainNoteHTML(this.doc,temp.innerHTML),image=[...temp.querySelectorAll('img')].map(n=>n.getAttribute('src')).find(src=>src?.startsWith('data:image/')||isNoteAssetPath(src));return{html:temp.innerHTML,text,...(image?{image}:{})};
  }
  copyEvent(event){
    const payload=this.selectionPayload();if(!payload.html&&!payload.text)return;
    event.preventDefault();event.clipboardData?.setData('text/plain',payload.text);
    if(this.options.onCopy){Promise.resolve(this.options.onCopy(payload)).catch(()=>{});return}
    event.clipboardData?.setData('text/html',payload.html);
  }
  showCopyMenu(){
    this.element.querySelector('.note-copy-menu')?.remove();const menu=this.doc.createElement('div');menu.className='note-copy-menu';menu.dataset.noteUi='true';const copy=this.doc.createElement('button');copy.type='button';copy.textContent='复制';copy.onpointerdown=e=>e.preventDefault();copy.onclick=()=>{if(this.options.onCopy)Promise.resolve(this.options.onCopy(this.selectionPayload())).catch(()=>{});else this.doc.execCommand?.('copy');menu.remove()};menu.append(copy);this.element.append(menu);
  }
  focusEnd(){let body=this.blocks().at(-1)?.querySelector('.note-body');if(!body)body=this.addOwnBlock(null);this.caret(body,true);body.scrollIntoView?.({block:'nearest'})}
  destroy(){this.commit();this.destroyed=true;for(const cleanup of this.listeners)cleanup();this.listeners=[];this.range=null}
}

export function plainNoteHTML(doc,html){
  const node=doc.createElement('div');node.innerHTML=sanitizeNoteHTML(doc,html);node.querySelectorAll('[data-note-ui],.note-gap,.note-remove').forEach(n=>n.remove());
  node.querySelectorAll('img').forEach(img=>img.replaceWith(doc.createTextNode('['+(img.alt||'图片')+']')));
  node.querySelectorAll('br').forEach(br=>br.replaceWith(doc.createTextNode('\n')));
  node.querySelectorAll('figure,p,li,div.note-body,div.note-reference-content').forEach(n=>n.append(doc.createTextNode('\n')));
  return node.textContent.replace(/\n{3,}/g,'\n\n').trim();
}
