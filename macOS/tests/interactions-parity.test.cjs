const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { JSDOM } = require('jsdom');
const moduleSource = fs.readFileSync(path.join(__dirname, '../web/parity-interactions.js'), 'utf8');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fixture(t, html = '') {
  const dom = new JSDOM('<!doctype html><div id="stage"></div><div id="modal"><div id="tools"></div><div id="body">' + html + '</div></div><button id="outside">外部</button>', { pretendToBeVisual: true });
  const win = dom.window, doc = win.document, timers = new Set(); let now = 1000;
  const timer = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; }, cancel = id => { clearTimeout(id); timers.delete(id); };
  Object.defineProperty(win.HTMLElement.prototype, 'clientWidth', { get() { return this.id === 'stage' ? this.fixtureWidth || 1000 : parseFloat(this.style.width) || 640; } }); Object.defineProperty(win.HTMLElement.prototype, 'clientHeight', { get() { return this.id === 'stage' ? 600 : parseFloat(this.style.height) || 320; } });
  win.HTMLElement.prototype.setPointerCapture = function(id) { this.capture = id; }; win.HTMLElement.prototype.hasPointerCapture = function(id) { return this.capture === id; }; win.HTMLElement.prototype.releasePointerCapture = function() { this.capture = null; };
  win.Range.prototype.getClientRects = () => [{ left: 20, top: 20, right: 120, bottom: 40, width: 100, height: 20 }]; win.Range.prototype.getBoundingClientRect = () => ({ left: 20, top: 20, right: 120, bottom: 40, width: 100, height: 20 });
  const context = vm.createContext({ console, Date, Math, Number, String, Object, Array, Set, Map, Error, document: doc, window: win, performance: { now: () => now }, ResizeObserver: class { observe() {} disconnect() {} }, requestAnimationFrame: fn => timer(fn, 0), cancelAnimationFrame: cancel, setTimeout: timer, clearTimeout: cancel });
  const module = new vm.SourceTextModule(moduleSource, { context }); await module.link(() => {}); await module.evaluate(); const api = module.namespace;
  t.after(() => { for (const id of timers) cancel(id); dom.window.close(); });
  const pointer = (node, type, { x = 0, y = 0, id = 1, pointerType = 'mouse', button = 0 } = {}) => { const event = new win.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button, buttons: type === 'pointerup' ? 0 : 1 }); Object.defineProperties(event, { pointerId: { value: id }, pointerType: { value: pointerType } }); node.dispatchEvent(event); return event; };
  const select = node => { const range = doc.createRange(); range.selectNodeContents(node); win.getSelection().removeAllRanges(); win.getSelection().addRange(range); doc.dispatchEvent(new win.Event('selectionchange')); return range; };
  return { api, win, doc, pointer, select, advance(ms) { now += ms; } };
}
const initial = { id: 'notes', x: .2, y: .1, w: .4, h: .5, z: 3 };

test('all eight resize directions preserve the opposite edge at minimum size', async t => {
  const { api } = await fixture(t); for (const edge of api.RESIZE_EDGES) { const r = api.resizePane(initial, edge.includes('w') ? 3 : -3, edge.includes('n') ? 3 : -3, edge); if (edge.includes('w')) assert.ok(Math.abs(r.x + r.w - initial.x - initial.w) < 1e-8); if (edge.includes('n')) assert.ok(Math.abs(r.y + r.h - initial.y - initial.h) < 1e-8); if (edge.includes('e')) assert.equal(r.x, initial.x); if (edge.includes('s')) assert.equal(r.y, initial.y); assert.ok(r.w >= .12 && r.h >= .12); }
});

test('panes retain offscreen geometry and a reachable bar while the top stays visible', async t => { const { api } = await fixture(t); const r = api.resizePane(initial, -.7, -5, 'move'); assert.equal(r.y, 0); assert.equal(r.w, .4); assert.ok(r.x < 0); const bar = api.visibleHandle(r, 1000), left = r.x * 1000 + 4 + bar.left; assert.ok(left >= 0); assert.ok(left + bar.width <= 1000); const restored = api.recoverPane(r); assert.ok(restored.x >= 0); });

test('saved layouts match exact dimensions and the identical active combination', async t => { const { api } = await fixture(t); assert.equal(api.layoutKey(['notes', 'slides'], 1000, 600), api.layoutKey(['slides', 'notes'], 1000, 600)); assert.notEqual(api.layoutKey(['notes', 'slides'], 1000, 600), api.layoutKey(['notes', 'slides'], 1001, 600)); assert.equal(api.matchingLayout([initial], ['slides', 'notes']).length, 0); assert.equal(api.matchingLayout([initial, { ...initial, x: NaN }], ['notes']).length, 1); });

test('default arrangements keep the slide spread, give pictures a full-height column with more panes, and maximize four-PPT area', async t => { const { api } = await fixture(t), pair = api.defaultPanes(['slides', 'transcript']), six = api.defaultPanes(['video', 'slides', 'transcript', 'notes', 'question', 'summary']), three = api.defaultPanes(['slides', 'transcript', 'notes']), square = api.defaultPanes(['slides', 'transcript', 'notes'], false, 'auto', 1.1); assert.equal(pair[1].y, .62); assert.deepEqual([three[0].id, three[0].w, three[0].h, three[1].x].join(), 'slides,0.6,1,0.6'); assert.equal(square[0].h, .56); assert.equal(six.length, 6); const video = six.find(r => r.id === 'video'), slides = six.find(r => r.id === 'slides'), notes = six.find(r => r.id === 'notes'), question = six.find(r => r.id === 'question'); assert.equal(video.x, 0); assert.equal(video.y, 0); assert.equal(slides.y, .5); assert.ok(notes.h > question.h); assert.ok(six.every(r => r.x + r.w <= 1.000001 && r.y + r.h <= 1.000001)); assert.equal(api.slideGridShape(4, 1400, 850, 16 / 9).columns, 2); assert.equal(api.slideGridShape(4, 1400, 850, 16 / 9).rows, 2); });

test('brush ranges include intervening pages and preserve the original selection', async t => { const { api } = await fixture(t); assert.deepEqual(Array.from(api.brushRange(['a', 'b', 'c', 'd'], ['d'], 0, 2)), ['d', 'a', 'b', 'c']); assert.deepEqual(Array.from(api.brushRange(['a', 'b', 'c', 'd'], ['a', 'b', 'c', 'd'], 2, 2, false)), ['a', 'b', 'd']); });

test('ordinary pane clicks focus and raise without selecting resize, bar clicks select', async t => {
  const f = await fixture(t), stage = f.doc.querySelector('#stage'), panes = {}, focused = [], ids = ['slides', 'transcript'];
  for (const id of ids) { const node = f.doc.createElement('section'); node.className = 'pane'; node.innerHTML = '<div class="handle"></div><div class="pane-content"><span>正文</span></div>'; stage.append(node); panes[id] = node; }
  const control = new f.api.PaneLayoutController({ stage, getIds: () => ids, getPanes: () => panes, onFocus: id => focused.push(id) }); t.after(() => control.dispose());
  f.pointer(panes.slides.querySelector('.handle'), 'pointerdown'); f.pointer(panes.slides, 'pointerup'); assert.equal(control.selected, 'slides');
  f.pointer(panes.transcript.querySelector('.pane-content'), 'pointerdown'); assert.equal(control.selected, ''); assert.equal(focused.at(-1), 'transcript'); assert.ok(Number(panes.transcript.style.zIndex) > Number(panes.slides.style.zIndex)); assert.equal(f.doc.activeElement, panes.transcript);
});

test('locked layout prevents geometry edits but its editor can unlock and save', async t => {
  const f = await fixture(t), stage = f.doc.querySelector('#stage'), pane = f.doc.createElement('section'); pane.className = 'pane'; stage.append(pane); let saved = {}, calls = 0;
  const control = new f.api.PaneLayoutController({ stage, getIds: () => ['notes'], getPanes: () => ({ notes: pane }), locked: true, getSavedLayouts: () => saved, onSave: value => { saved = value; calls++; } }); t.after(() => control.dispose()); const x = pane.style.left;
  f.pointer(pane.querySelector('.handle'), 'pointerdown'); f.pointer(pane, 'pointermove', { x: 100 }); f.pointer(pane, 'pointerup', { x: 100 }); assert.equal(pane.style.left, x); assert.equal(control.selected, '');
  control.renderEditor({ body: f.doc.querySelector('#body'), toolbar: f.doc.querySelector('#tools') }); const unlock = [...f.doc.querySelectorAll('button')].find(b => b.textContent === '解锁布局'); unlock.click(); assert.equal(control.locked, false); await control.saveCurrent(); assert.equal(calls, 1); assert.equal(saved[control.key].length, 1); control.closeEditor();
});

test('horizontal trackpad axis flips pages while vertical browsing remains native', async t => { const f = await fixture(t, '<div id="text">正文</div>'), node = f.doc.querySelector('#text'), moves = [], browse = []; const dispose = f.api.attachPageGestures(node, { onPage: (d, n) => moves.push([d, n]), onBrowse: value => browse.push(value) }); t.after(dispose); const horizontal = new f.win.WheelEvent('wheel', { deltaX: 100, deltaY: 0, bubbles: true, cancelable: true }); node.dispatchEvent(horizontal); assert.equal(horizontal.defaultPrevented, true); assert.deepEqual(moves, [[1, 1]]); const vertical = new f.win.WheelEvent('wheel', { deltaX: 2, deltaY: 80, cancelable: true }); node.dispatchEvent(vertical); assert.equal(vertical.defaultPrevented, false); assert.deepEqual(browse, ['vertical']); });

test('mouse press-drag and native selection never turn transcript pages', async t => { const f = await fixture(t, '<div id="text"><span>完整的课堂文字</span></div>'), node = f.doc.querySelector('#text'); let moves = 0; const selection = f.api.observeTextSelection(node), dispose = f.api.attachPageGestures(node, { onPage: () => moves++ }); t.after(() => { dispose(); selection.dispose(); }); f.pointer(node.querySelector('span'), 'pointerdown'); f.pointer(node, 'pointermove', { x: 240 }); f.pointer(node, 'pointerup', { x: 240 }); assert.equal(moves, 0); f.select(node.querySelector('span')); const event = new f.win.WheelEvent('wheel', { deltaX: 120, deltaY: 0, cancelable: true }); node.dispatchEvent(event); assert.equal(event.defaultPrevented, false); assert.equal(moves, 0); assert.equal(f.win.getSelection().toString(), '完整的课堂文字'); });

test('selection insertion preserves formatting and selection clears outside the pane', async t => { const f = await fixture(t, '<div id="text"><strong>有格式的引用</strong></div>'), node = f.doc.querySelector('#text'), inserted = []; const selection = f.api.observeTextSelection(node, { paneId: 'summary', onInsert: value => inserted.push(value) }); t.after(() => selection.dispose()); f.select(node); f.pointer(node, 'pointerup'); const insert = f.doc.querySelector('.selection-insert'); assert.ok(insert); insert.click(); assert.equal(inserted[0].text, '有格式的引用'); assert.match(inserted[0].html, /<strong>/); f.pointer(f.doc.querySelector('#outside'), 'pointerdown'); assert.equal(f.win.getSelection().rangeCount, 0); });

test('floating return reserves scroll tail without changing text DOM or adding toolbar', async t => { const f = await fixture(t, '<div id="pane"><div id="text">最后一句话</div><div id="footer"></div></div>'), pane = f.doc.querySelector('#pane'), body = f.doc.querySelector('#text'); let returned = 0; const button = new f.api.FloatingReturn({ pane, body, footer: f.doc.querySelector('#footer'), onReturn: () => returned++ }); t.after(() => button.dispose()); button.show(true); assert.equal(body.textContent, '最后一句话'); assert.equal(body.style.getPropertyValue('--return-space'), '44px'); assert.ok(body.classList.contains('parity-has-return')); button.button.click(); assert.equal(returned, 1); button.show(false); assert.equal(button.button.hidden, true); assert.ok(!body.classList.contains('parity-has-return')); });

test('overview keeps the rail in place, brushes ranges, and disables zoom in selection mode', async t => {
  const f = await fixture(t, '<div class="overview-grid">' + ['a', 'b', 'c', 'd'].map(id => '<div class="overview-item" data-id="' + id + '">' + id + '</div>').join('') + '</div>'), body = f.doc.querySelector('#body'); let selected = [], choosing = false, columns = 4;
  Object.defineProperty(body, 'scrollHeight', { get: () => 1200 }); const item = id => body.querySelector('[data-id="' + id + '"]'); f.doc.elementFromPoint = x => item(x >= 200 ? 'd' : 'a');
  const control = f.api.attachOverviewGestures(body, { getSelected: () => selected, setSelected: ids => selected = Array.from(ids), isSelectionMode: () => choosing, getColumns: () => columns, setColumns: n => columns = n }); t.after(() => control.dispose()); const rail = f.doc.querySelector('.parity-overview-rail'); assert.ok(rail);
  choosing = true; control.selectionChanged(); f.pointer(item('a'), 'pointerdown'); f.pointer(f.doc, 'pointermove', { x: 300, y: 50 }); f.pointer(f.doc, 'pointerup', { x: 300, y: 50 }); assert.deepEqual(selected, ['a', 'b', 'c', 'd']);
  body.dispatchEvent(new f.win.WheelEvent('wheel', { deltaY: 100, ctrlKey: true, cancelable: true })); assert.equal(columns, 4); choosing = false; control.selectionChanged(); assert.deepEqual(selected, []); assert.equal(f.doc.querySelector('.parity-overview-rail'), rail);
  f.advance(500); body.dispatchEvent(new f.win.WheelEvent('wheel', { deltaY: 100, ctrlKey: true, cancelable: true })); assert.equal(columns, 5);
});

test('theme reflow retains custom arrangement and live note nodes at a new stage size', async t => {
  const f=await fixture(t),stage=f.doc.querySelector('#stage'),panes={};
  for(const id of ['slides','notes']){const node=f.doc.createElement('section');node.className='pane';node.innerHTML='<div class="pane-content"><div contenteditable="true">未保存的内容</div></div>';stage.append(node);panes[id]=node;}
  const control=new f.api.PaneLayoutController({stage,getIds:()=>['slides','notes'],getPanes:()=>panes});t.after(()=>control.dispose());
  control.change({id:'notes',x:.58,y:.15,w:.4,h:.7,z:5});
  const original=JSON.stringify(control.rects),editor=panes.notes.querySelector('[contenteditable]');
  stage.fixtureWidth=900;control.refresh({preserve:true});
  assert.equal(JSON.stringify(control.rects),original);
  assert.equal(panes.notes.querySelector('[contenteditable]'),editor);assert.equal(editor.textContent,'未保存的内容');
  assert.equal(control.key,'notes+slides@900x600');
});


test('one horizontal gesture plus a long momentum tail turns exactly once, the next gesture turns again',async t=>{
 const f=await fixture(t,'<div id="text">正文</div>'),node=f.doc.querySelector('#text'),turns=[];
 const dispose=f.api.attachPageGestures(node,{onPage:(d,n)=>turns.push([d,n])});t.after(dispose);
 for(const delta of [35,55,110,80,50,30,15,5,2]){f.advance(30);node.dispatchEvent(new f.win.WheelEvent('wheel',{deltaX:delta,cancelable:true}));}
 assert.deepEqual(turns,[[1,1]]);f.advance(300);node.dispatchEvent(new f.win.WheelEvent('wheel',{deltaX:-100,cancelable:true}));assert.deepEqual(turns,[[1,1],[-1,1]]);
});
test('overview scroll/press movement is never activated as a new page click',async t=>{
 const f=await fixture(t,'<div class="overview-item" data-id="a">A</div><div class="overview-item" data-id="b">B</div>'),body=f.doc.querySelector('#body'),activated=[];
 const control=f.api.attachOverviewGestures(body,{onActivate:id=>activated.push(id)});t.after(()=>control.dispose());const a=body.querySelector('[data-id="a"]'),b=body.querySelector('[data-id="b"]');
 f.pointer(a,'pointerdown');body.scrollTop=80;f.pointer(f.doc,'pointermove',{y:80});f.pointer(a,'pointerup',{y:80});a.click();assert.deepEqual(activated,[]);
 f.pointer(a,'pointerdown');f.pointer(b,'pointerup');b.click();assert.deepEqual(activated,[]);
 f.pointer(a,'pointerdown');f.pointer(a,'pointerup');a.click();assert.deepEqual(activated,['a']);
});
