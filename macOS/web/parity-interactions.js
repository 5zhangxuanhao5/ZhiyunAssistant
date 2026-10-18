/** HarmonyOS interaction parity for the local Mac client.
 * Importable without a DOM: exported geometry/selection functions are pure.
 * DOM controllers never fetch course content, persist account data or activate a window.
 */
export const PANE_IDS = Object.freeze(['video', 'slides', 'transcript', 'notes', 'question', 'summary', 'agent']);
export const RESIZE_EDGES = Object.freeze(['n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se']);
export const RETURN_SCROLL_SPACE = 44;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));
const idsOf = ids => [...new Set(ids || [])].filter(id => PANE_IDS.includes(id));
const copyRects = rects => rects.map(rect => ({ ...rect }));

export function normalizePane(value) {
  const w = clamp(value.w, .12, 1), h = clamp(value.h, .12, 1);
  return { id: value.id, x: clamp(value.x, .04 - w, .96), y: clamp(value.y, 0, .96), w, h, z: clamp(value.z, 0, 100) };
}
export function validPanes(raw, ids = PANE_IDS) {
  const seen = new Set(), accepted = idsOf(ids);
  return (Array.isArray(raw) ? raw : []).filter(r => r && accepted.includes(r.id) && !seen.has(r.id) && ['x', 'y', 'w', 'h', 'z'].every(k => Number.isFinite(r[k])) && !!seen.add(r.id)).map(normalizePane);
}
/** Layouts only match the identical functional combination and rounded CSS pixel size. */
export function layoutKey(ids, width, height) { return idsOf(ids).sort().join('+') + '@' + Math.round(width) + 'x' + Math.round(height); }
export function matchingLayout(raw, ids) {
  const active = idsOf(ids), rects = validPanes(raw, active);
  return rects.length === active.length && active.every(id => rects.some(r => r.id === id)) ? rects : [];
}
export function defaultPanes(ids, narrow = false, preset = 'auto') {
  ids = idsOf(ids);
  if (!ids.length) return [];
  if (narrow || preset === 'rows') return ids.map((id, i) => ({ id, x: 0, y: i / ids.length, w: 1, h: 1 / ids.length, z: i }));
  if (preset === 'columns') return ids.map((id, i) => ({ id, x: i / ids.length, y: 0, w: 1 / ids.length, h: 1, z: i }));
  if (ids.length === 1) return [{ id: ids[0], x: 0, y: 0, w: 1, h: 1, z: 0 }];
  if (ids.length === 2 && ids.includes('slides') && ids.includes('transcript')) return [
    { id: 'slides', x: 0, y: 0, w: 1, h: .62, z: 0 }, { id: 'transcript', x: 0, y: .62, w: 1, h: .38, z: 1 }
  ];
  const dock = ids.filter(id => ['notes', 'question', 'summary', 'agent'].includes(id)), study = ids.filter(id => !dock.includes(id));
  const width = dock.length && study.length ? .62 : 1, output = [];
  if (study.includes('video')) {
    const rest = study.filter(id => id !== 'video');
    output.push({ id: 'video', x: 0, y: 0, w: width, h: rest.length ? .55 : 1, z: 0 });
    rest.forEach((id, i) => output.push({ id, x: i * width / rest.length, y: .55, w: width / rest.length, h: .45, z: i + 1 }));
  } else study.forEach((id, i) => output.push({ id, x: i * width / study.length, y: 0, w: width / study.length, h: 1, z: i }));
  dock.forEach((id, i) => output.push({ id, x: study.length ? width : 0, y: i / dock.length, w: study.length ? 1 - width : 1, h: 1 / dock.length, z: i + 3 }));
  return output;
}
/** Resize keeps the opposite edge fixed, including when a minimum size is reached. */
export function resizePane(value, dx, dy, edge) {
  if (edge === 'move') return normalizePane({ ...value, x: value.x + dx, y: value.y + dy });
  let left = value.x, top = value.y, right = value.x + value.w, bottom = value.y + value.h;
  if (edge.includes('w')) left = clamp(left + dx, right - 1, right - .12);
  if (edge.includes('e')) right = clamp(right + dx, left + .12, left + 1);
  if (edge.includes('n')) top = clamp(top + dy, Math.max(0, bottom - 1), bottom - .12);
  if (edge.includes('s')) bottom = clamp(bottom + dy, top + .12, top + 1);
  return normalizePane({ ...value, x: left, y: top, w: right - left, h: bottom - top });
}
export function recoverPane(rect) { rect = normalizePane(rect); return { ...rect, x: clamp(rect.x, 0, 1 - rect.w), y: clamp(rect.y, 0, 1 - rect.h) }; }
export function reorderPanes(rects, id, action) {
  const ordered = copyRects(rects).sort((a, b) => a.z - b.z), index = ordered.findIndex(r => r.id === id);
  if (index < 0) return ordered;
  const target = action === 'top' ? ordered.length - 1 : action === 'bottom' ? 0 : clamp(index + (action === 'up' ? 1 : -1), 0, ordered.length - 1);
  ordered.splice(target, 0, ordered.splice(index, 1)[0]);
  return ordered.map((r, z) => ({ ...r, z }));
}
export function panePixels(rect, width, height, gap = 8) { return { x: rect.x * width + gap / 2, y: rect.y * height + gap / 2, w: Math.max(1, rect.w * width - gap), h: Math.max(1, rect.h * height - gap), z: rect.z }; }
/** A partly offscreen pane keeps its drag bar in the still visible part. */
export function visibleHandle(rect, width, gap = 8) {
  const frame = Math.max(1, rect.w * width - gap), x = rect.x * width + gap / 2, left = Math.max(0, -x), right = Math.min(frame, width - x);
  const w = Math.max(16, Math.min(56, right - left - 8));
  return { left: Math.max(left + 4, Math.min(right - w - 4, (frame - w) / 2)), width: w };
}
export function brushRange(ids, initial, anchor, index, adding = true) {
  const next = new Set(initial), lo = Math.max(0, Math.min(anchor, index)), hi = Math.min(ids.length - 1, Math.max(anchor, index));
  if (anchor < 0 || index < 0) return [...next];
  for (let i = lo; i <= hi; i++) adding ? next.add(ids[i]) : next.delete(ids[i]);
  return [...next];
}
/** Choose rows/columns by the real PPT ratio, rather than always making 4 columns. */
export function slideGridShape(count, width, height, aspect = 16 / 9, gap = 12, caption = 28) {
  count = clamp(Math.round(count), 1, 8); let best = { columns: 1, rows: count, area: -1 };
  for (let columns = 1; columns <= count; columns++) {
    const rows = Math.ceil(count / columns), w = (width - gap * (columns - 1)) / columns, h = (height - gap * (rows - 1)) / rows - caption;
    const imageW = Math.max(0, Math.min(w, h * aspect)), area = imageW * imageW / aspect;
    if (area > best.area) best = { columns, rows, area };
  }
  return best;
}

const isEditable = target => !!target?.closest?.('input,textarea,select,[contenteditable=true]');
const isControl = target => !!target?.closest?.('button,a,input,textarea,select,[contenteditable=true],[role=button]');
const containsNode = (root, node) => !!node && (node === root || root.contains(node.nodeType === 1 ? node : node.parentNode));
export function textSelectionHeld(root) {
  const selection = root?.ownerDocument?.getSelection?.();
  return !!(root?.dataset?.selectionHeld === 'true' || selection && !selection.isCollapsed && (containsNode(root, selection.anchorNode) || containsNode(root, selection.focusNode)));
}
export function captureScrollAnchor(root, selector = '[data-line], [data-turn], [data-note-block]') {
  if (!root) return null; const top = root.getBoundingClientRect().top;
  const node = [...root.querySelectorAll(selector)].find(n => n.getBoundingClientRect().bottom > top + 1);
  return { key: node?.dataset.line || node?.dataset.turn || node?.dataset.noteBlock, offset: node ? node.getBoundingClientRect().top - top : 0, scroll: root.scrollTop };
}
export function restoreScrollAnchor(root, anchor, selector = '[data-line], [data-turn], [data-note-block]') {
  if (!root || !anchor) return;
  const node = [...root.querySelectorAll(selector)].find(n => (n.dataset.line || n.dataset.turn || n.dataset.noteBlock) === anchor.key);
  root.scrollTop = node ? root.scrollTop + node.getBoundingClientRect().top - root.getBoundingClientRect().top - anchor.offset : anchor.scroll;
}
function listen(target, type, listener, options, disposers) { target.addEventListener(type, listener, options); disposers.push(() => target.removeEventListener(type, listener, options)); }
function element(doc, tag, cls, text) { const node = doc.createElement(tag); if (cls) node.className = cls; if (text != null) node.textContent = text; return node; }

/** Pixel geometry for the global floating pane; keep its top bar reachable. */
export function floatingPaneBounds(value, width, height) {
  const maxW=Math.max(1,width-16),maxH=Math.max(1,height-16),w=clamp(value.width,Math.min(300,maxW),maxW),h=clamp(value.height,Math.min(250,maxH),maxH);
  return {left:clamp(value.left,40-w,width-40),top:clamp(value.top,0,Math.max(0,height-40)),width:w,height:h};
}
export function resizeFloatingPane(rect, dx, dy, edge, width, height) {
  if(edge==='move')return floatingPaneBounds({...rect,left:rect.left+dx,top:rect.top+dy},width,height);
  let left=rect.left,top=rect.top,right=left+rect.width,bottom=top+rect.height;
  const maxW=Math.max(1,width-16),maxH=Math.max(1,height-16),minW=Math.min(300,maxW),minH=Math.min(250,maxH);
  if(edge.includes('w'))left=clamp(left+dx,right-maxW,right-minW);
  if(edge.includes('e'))right=clamp(right+dx,left+minW,left+maxW);
  if(edge.includes('n'))top=clamp(top+dy,Math.max(0,bottom-maxH),bottom-minH);
  if(edge.includes('s'))bottom=clamp(bottom+dy,top+minH,top+maxH);
  return floatingPaneBounds({left,top,width:right-left,height:bottom-top},width,height);
}
/** Same activation contract as study panes: grip first, then any edge or corner. */
export class FloatingPaneController {
  constructor({root,handle,enabled=()=>true,onChange=()=>{}}) {
    Object.assign(this,{root,handle,enabled,onChange});this.selected=false;this.drag=null;this.frame=0;this.disposers=[];
    const doc=root.ownerDocument;this.win=doc.defaultView;
    handle.setAttribute('role','button');handle.setAttribute('aria-label','调整应用助手');handle.setAttribute('aria-pressed','false');handle.tabIndex=0;
    for(const edge of RESIZE_EDGES){const n=element(doc,'div','agent-edge '+edge);n.dataset.agentEdge=edge;n.setAttribute('aria-hidden','true');root.append(n);}
    listen(root,'pointerdown',e=>{
      if(!this.enabled()||e.button!==0)return;
      const grip=handle.contains(e.target),edge=e.target.closest?.('[data-agent-edge]')?.dataset.agentEdge;
      if(!grip&&!edge){this.select(false);return;}
      if(edge&&!this.selected)return;
      e.preventDefault();e.stopPropagation();this.select(true);const box=root.getBoundingClientRect();
      this.drag={pointer:e.pointerId,edge:edge||'move',x:e.clientX,y:e.clientY,rect:{left:box.left,top:box.top,width:box.width,height:box.height}};
      root.classList.add('dragging');root.setPointerCapture?.(e.pointerId);
    },true,this.disposers);
    listen(root,'pointermove',e=>{if(!this.drag||e.pointerId!==this.drag.pointer)return;e.preventDefault();this.latest={x:e.clientX,y:e.clientY};if(!this.frame)this.frame=this.win.requestAnimationFrame(()=>this.commit());},false,this.disposers);
    const end=e=>{if(!this.drag||e.pointerId!==this.drag.pointer)return;if(e.type==='pointerup')this.latest={x:e.clientX,y:e.clientY};this.finish();};
    listen(root,'pointerup',end,false,this.disposers);listen(root,'pointercancel',end,false,this.disposers);listen(root,'lostpointercapture',end,false,this.disposers);
    listen(doc,'pointerdown',e=>{if(!root.contains(e.target))this.select(false);},true,this.disposers);
    listen(handle,'keydown',e=>{if(!this.enabled())return;if(e.key==='Enter'||e.key===' '){e.preventDefault();this.select(true);}else if(e.key==='Escape'){e.preventDefault();this.select(false);}},false,this.disposers);
  }
  select(value){this.selected=!!value&&this.enabled();this.root.classList.toggle('selected',this.selected);this.handle.setAttribute('aria-pressed',String(this.selected));}
  apply(rect){Object.assign(this.root.style,{left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',height:rect.height+'px',right:'auto',bottom:'auto'});this.placeHandle(rect);}
  placeHandle(rect){const w=this.win.innerWidth,visibleLeft=Math.max(0,-rect.left),visibleRight=Math.min(rect.width,w-rect.left),bar=Math.min(56,Math.max(24,visibleRight-visibleLeft-8));this.handle.style.width=bar+'px';this.handle.style.left=clamp((rect.width-bar)/2,visibleLeft+4,visibleRight-bar-4)+'px';}
  commit(){if(this.frame)this.win.cancelAnimationFrame(this.frame);this.frame=0;if(!this.drag||!this.latest)return;this.apply(resizeFloatingPane(this.drag.rect,this.latest.x-this.drag.x,this.latest.y-this.drag.y,this.drag.edge,this.win.innerWidth,this.win.innerHeight));}
  finish(){if(!this.drag)return;this.commit();const pointer=this.drag.pointer;this.drag=null;this.latest=null;this.root.classList.remove('dragging');if(this.root.hasPointerCapture?.(pointer))this.root.releasePointerCapture(pointer);this.onChange();}
  clear(){this.finish();this.select(false);}
  dispose(){this.clear();this.disposers.forEach(f=>f());}
}

/**
 * Use one controller per study stage. getPanes/getIds can return the current app maps.
 * callbacks: onFocus(id), onLayout(rects), onContentResize(), onSave(allSaved),
 * onLock(locked), onToast(text). Normalized saved format is {key:[PaneRect,...]}.
 * Legacy pixel object layouts are deliberately ignored; they do not meet exact-size semantics.
 */
export class PaneLayoutController {
  constructor(options) {
    this.options = options; this.stage = options.stage; this.rects = []; this.key = ''; this.selected = ''; this.locked = !!options.locked;
    this.temporary = new Map(); this.bindings = new Map(); this.disposeListeners = []; this.editor = null; this.drag = null; this.frame = 0;
    this.stage.classList.add('parity-stage');
    listen(this.stage, 'pointerdown', e => { if (e.target === this.stage) this.select(''); }, false, this.disposeListeners);
    this.observer = new ResizeObserver(() => this.refresh()); this.observer.observe(this.stage);
    this.refresh();
  }
  ids() { return idsOf(this.options.getIds?.() || []); }
  panes() { return this.options.getPanes?.() || {}; }
  size() { return { width: Math.max(1, this.stage.clientWidth), height: Math.max(1, this.stage.clientHeight) }; }
  saved() { return this.options.getSavedLayouts?.() || this.options.saved || {}; }
  refresh({ reset = false, preset = 'auto', preserve = false } = {}) {
    const ids = this.ids(), { width, height } = this.size(), key = layoutKey(ids, width, height);
    if (reset || key !== this.key) {
      if (this.key && this.rects.length) { this.temporary.set(this.key, copyRects(this.rects)); if (this.temporary.size > 48) this.temporary.delete(this.temporary.keys().next().value); }
      const saved = !reset && matchingLayout(this.saved()[key], ids), temporary = !reset && matchingLayout(this.temporary.get(key), ids);
      const retained = preserve && !reset && matchingLayout(this.rects, ids);
      this.rects = retained?.length ? copyRects(retained) : saved?.length ? saved : temporary?.length ? temporary : defaultPanes(ids, width < 640, preset);
      this.key = key; this.selected = '';
    }
    for (const [id, binding] of this.bindings) if (!ids.includes(id) || this.panes()[id] !== binding.node) this.unregister(id);
    for (const id of ids) { const node = this.panes()[id]; if (node && !this.bindings.has(id)) this.register(id, node); }
    this.apply();
  }
  register(id, node) {
    if (this.bindings.has(id)) this.unregister(id);
    const disposers = []; node.classList.add('parity-pane'); node.tabIndex = -1;
    const handle = node.querySelector('.handle') || node.insertBefore(element(node.ownerDocument, 'div', 'handle'), node.firstChild);
    handle.setAttribute('role', 'button'); handle.setAttribute('aria-label', '调整' + (this.options.names?.[id] || id)); handle.tabIndex = 0;
    for (const edge of RESIZE_EDGES) if (!node.querySelector('[data-edge="' + edge + '"]')) {
      const n = element(node.ownerDocument, 'div', 'edge ' + edge); n.dataset.edge = edge; node.append(n);
    }
    // Capture replaces legacy drag handlers without interfering with native text selection.
    listen(node, 'pointerdown', e => {
      const edge = e.target.closest?.('.edge')?.dataset.edge, isHandle = !!e.target.closest?.('.handle');
      if (edge || isHandle) { e.stopImmediatePropagation(); if (this.locked || edge && this.selected !== id) return; this.beginDrag(e, id, edge || 'move', node, false); return; }
      this.activate(id, e); this.select('');
    }, true, disposers);
    listen(node, 'keydown', e => {
      if (e.target !== handle || this.locked) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); this.select(this.selected === id ? '' : id); this.activate(id); }
      if (this.selected === id && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault(); e.stopPropagation(); const size = this.size(), step = e.shiftKey ? 10 : 2;
        this.change(resizePane(this.rects.find(r => r.id === id), (e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0) / size.width, (e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0) / size.height, 'move'));
      }
    }, false, disposers);
    this.bindings.set(id, { node, disposers }); this.apply();
  }
  unregister(id) { this.bindings.get(id)?.disposers.forEach(f => f()); this.bindings.delete(id); }
  activate(id, event) {
    this.options.onFocus?.(id);
    this.rects = reorderPanes(this.rects, id, 'top');
    // Programmatic focus is only for blank chrome; text can keep its native range/caret.
    if (event && !isControl(event.target) && !event.target.closest?.('.caption-line,.rich-text,.notes-editor,.conversation,[data-selectable-text]')) this.panes()[id]?.focus({ preventScroll: true });
    this.apply();
  }
  select(id) { this.selected = this.locked ? '' : id; this.apply(); }
  change(rect) { this.rects = this.rects.map(r => r.id === rect.id ? normalizePane(rect) : r); this.temporary.set(this.key, copyRects(this.rects)); this.apply(); this.options.onLayout?.(copyRects(this.rects)); }
  apply() {
    const size = this.size();
    for (const rect of this.rects) {
      const node = this.panes()[rect.id]; if (!node) continue;
      const r = panePixels(rect, size.width, size.height), bar = visibleHandle(rect, size.width);
      Object.assign(node.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px', zIndex: String(rect.z + 1) });
      node.classList.toggle('selected', this.selected === rect.id && !this.locked); node.classList.toggle('layout-locked', this.locked);
      const handle = node.querySelector('.handle'); if (handle) Object.assign(handle.style, { left: bar.left + 'px', width: bar.width + 'px' });
    }
    this.drawEditor();
  }
  beginDrag(e, id, edge, source, preview) {
    if (e.button !== 0 || this.locked) return; e.preventDefault(); this.activate(id); this.select(id);
    const original = this.rects.find(r => r.id === id); if (!original) return; const start = { ...original };
    const box = preview ? this.editor.board : this.stage, size = { width: box.clientWidth, height: box.clientHeight }, from = { x: e.clientX, y: e.clientY };
    source.setPointerCapture?.(e.pointerId); source.classList.add('dragging'); this.drag?.();
    let latest = e, done = false;
    const commit = () => { this.frame = 0; this.change(resizePane(start, (latest.clientX - from.x) / Math.max(1, size.width), (latest.clientY - from.y) / Math.max(1, size.height), edge)); };
    const move = event => { if (event.pointerId !== e.pointerId) return; latest = event; if (!this.frame) this.frame = requestAnimationFrame(commit); };
    const end = event => {
      if (event && event.pointerId !== e.pointerId || done) return; done = true;
      if (this.frame) { cancelAnimationFrame(this.frame); commit(); }
      source.removeEventListener('pointermove', move); source.removeEventListener('pointerup', end); source.removeEventListener('pointercancel', end); source.removeEventListener('lostpointercapture', end);
      source.classList.remove('dragging'); if (source.hasPointerCapture?.(e.pointerId)) source.releasePointerCapture(e.pointerId);
      this.drag = null; this.options.onContentResize?.();
    };
    source.addEventListener('pointermove', move); source.addEventListener('pointerup', end); source.addEventListener('pointercancel', end); source.addEventListener('lostpointercapture', end); this.drag = () => end();
  }
  async saveCurrent() {
    const next = { ...this.saved(), [this.key]: copyRects(this.rects) }; this.options.saved = next;
    await this.options.onSave?.(next); this.options.onToast?.('布局已保存，仅用于相同功能区与窗口尺寸'); return next;
  }
  setLocked(value) { this.locked = !!value; this.select(''); this.options.onLock?.(this.locked); this.drawEditor(); }
  preset(kind = 'auto') { if (this.locked) return; const size = this.size(); this.rects = defaultPanes(this.ids(), size.width < 640, kind); this.temporary.set(this.key, copyRects(this.rects)); this.apply(); this.options.onContentResize?.(); }
  layer(action) { if (!this.selected || this.locked) return; this.rects = reorderPanes(this.rects, this.selected, action); this.apply(); }
  recoverSelected() { const rect = this.rects.find(r => r.id === this.selected); if (rect && !this.locked) this.change(recoverPane(rect)); }
  /** App calls its own openModal first, then this; any other modal calls closeEditor. */
  renderEditor({ body, toolbar, onClose } = {}) {
    this.closeEditor(); const doc = body.ownerDocument, wrap = element(doc, 'div', 'parity-layout-editor'), info = element(doc, 'p', 'hint', '点击顶部横条选中，拖动横条移动、四边及四角缩放。未保存只用于本次学习。');
    const board = element(doc, 'div', 'parity-layout-board'); board.tabIndex = -1;
    const control = (label, fn, cls = '') => { const button = element(doc, 'button', cls, label); button.type = 'button'; button.onclick = fn; return button; };
    const top = element(doc, 'div', 'parity-layout-toolbar'), lock = control(this.locked ? '解锁布局' : '锁定布局', () => this.setLocked(!this.locked));
    top.append(lock, control('保存布局', () => this.saveCurrent().catch(error => this.options.onToast?.(error.message)), 'primary'), control('完成', () => { this.closeEditor(); onClose?.(); }, 'primary'));
    if (toolbar) toolbar.append(top); else wrap.append(top);
    wrap.append(info, board);
    const presets = element(doc, 'div', 'parity-layout-toolbar');
    for (const [kind, text] of [['auto', '自动排布'], ['columns', '横向排列'], ['rows', '纵向排列']]) presets.append(control(text, () => this.preset(kind)));
    presets.append(control('移回窗口', () => this.recoverSelected())); wrap.append(presets);
    const layer = element(doc, 'div', 'parity-layout-toolbar'), select = element(doc, 'select');
    const option = (text, value) => { const node = element(doc, 'option', '', text); node.value = value; return node; };
    select.append(option('选择功能区', '')); for (const id of this.ids()) select.append(option(this.options.names?.[id] || id, id));
    select.onchange = () => this.select(select.value); layer.append(select, element(doc, 'span', 'right'));
    for (const [action, text] of [['bottom', '置底'], ['down', '下移'], ['up', '上移'], ['top', '置顶']]) layer.append(control(text, () => this.layer(action)));
    wrap.append(layer); body.replaceChildren(wrap);
    board.onpointerdown = event => { if (event.target === board) this.select(''); };
    this.editor = { wrap, board, lock, select, presets, layer, items: new Map(), observer: new ResizeObserver(() => this.drawEditor()) }; this.editor.observer.observe(board); this.drawEditor();
  }
  drawEditor() {
    if (!this.editor) return; const { board, items, lock, select, presets, layer } = this.editor, width = board.clientWidth || 600, height = board.clientHeight || 320;
    lock.textContent = this.locked ? '解锁布局' : '锁定布局'; select.value = this.selected;
    for (const button of presets.querySelectorAll('button')) button.disabled = this.locked;
    for (const button of layer.querySelectorAll('button')) button.disabled = this.locked || !this.selected;
    for (const [id, item] of items) if (!this.ids().includes(id)) { item.remove(); items.delete(id); }
    for (const rect of this.rects) {
      let item = items.get(rect.id);
      if (!item) {
        const doc = board.ownerDocument; item = element(doc, 'section', 'parity-layout-item'); item.dataset.pane = rect.id;
        const handle = element(doc, 'div', 'handle'); item.append(handle, element(doc, 'span', 'parity-preview-title', this.options.names?.[rect.id] || rect.id));
        for (const edge of RESIZE_EDGES) { const n = element(doc, 'div', 'edge ' + edge); n.dataset.edge = edge; item.append(n); }
        item.onpointerdown = e => { const edge = e.target.closest('.edge')?.dataset.edge, bar = e.target.closest('.handle'); e.stopPropagation(); if (bar || edge) this.beginDrag(e, rect.id, edge || 'move', item, true); else { this.activate(rect.id); this.select(''); } };
        board.append(item); items.set(rect.id, item);
      }
      const r = panePixels(rect, width, height), handle = visibleHandle(rect, width);
      Object.assign(item.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px', zIndex: String(rect.z + 1) });
      item.classList.toggle('selected', this.selected === rect.id && !this.locked); Object.assign(item.querySelector('.handle').style, { left: handle.left + 'px', width: handle.width + 'px' });
    }
  }
  closeEditor() { if (!this.editor) return; this.editor.observer.disconnect(); this.editor = null; this.drag?.(); }
  dispose() { this.closeEditor(); this.drag?.(); this.observer.disconnect(); this.disposeListeners.forEach(f => f()); for (const id of this.bindings.keys()) this.unregister(id); }
}

/** Two-finger trackpad wheel flips pages. Mouse press/drag remains native text selection. */
export function attachPageGestures(node, { onPage, onBrowse, enabled = () => true, selectionRoot = node, threshold = 80 } = {}) {
  const disposers = [], doc = node.ownerDocument; node.classList.add('parity-page-gestures'); let sum = 0, last = 0, timer = 0, touch = null, suppressedUntil = 0;
  listen(node, 'wheel', e => {
    if (!enabled() || e.ctrlKey || e.metaKey || textSelectionHeld(selectionRoot)) return;
    if (Math.abs(e.deltaY) >= Math.abs(e.deltaX) / 1.15) { if (Math.abs(e.deltaY) > 2) onBrowse?.('vertical'); return; }
    if (Math.abs(e.deltaX) < 2) return;
    e.preventDefault(); const now = performance.now(); if (now - last > 180) sum = 0; last = now; sum += e.deltaX;
    clearTimeout(timer); timer = setTimeout(() => sum = 0, 180);
    if (Math.abs(sum) >= threshold) { const direction = sum > 0 ? 1 : -1; sum = 0; onPage?.(direction, 1); }
  }, { passive: false }, disposers);
  listen(node, 'pointerdown', e => { if (e.pointerType !== 'touch' || !enabled() || isEditable(e.target)) return; touch = { id: e.pointerId, x: e.clientX, y: e.clientY, width: node.clientWidth, swiping: false }; }, false, disposers);
  listen(node, 'pointermove', e => { if (!touch || e.pointerId !== touch.id) return; const dx = e.clientX - touch.x, dy = e.clientY - touch.y; if (Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx) * 1.2) { touch = null; onBrowse?.('vertical'); return; } if (Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy) * 1.2) { touch.swiping = true; e.preventDefault(); } }, { passive: false }, disposers);
  listen(node, 'pointerup', e => { if (!touch || e.pointerId !== touch.id) return; const before = touch; touch = null; const dx = e.clientX - before.x; if (!before.swiping || Math.abs(dx) < 35 || textSelectionHeld(selectionRoot)) return; suppressedUntil = performance.now() + 350; onPage?.(dx < 0 ? 1 : -1, Math.max(1, Math.round(Math.abs(dx) * 2 / Math.max(100, before.width)))); }, false, disposers);
  listen(node, 'pointercancel', () => touch = null, false, disposers);
  listen(node, 'click', e => { if (performance.now() < suppressedUntil) { e.preventDefault(); e.stopImmediatePropagation(); } }, true, disposers);
  return () => { clearTimeout(timer); disposers.forEach(f => f()); node.classList.remove('parity-page-gestures'); };
}

/** Keeps live renderers from replacing nodes during a native mouse/trackpad selection. */
export function observeTextSelection(root, { onHeld, onRelease, onFocus, onInsert, paneId = '', insertLabel = '插入到当前笔记' } = {}) {
  const doc = root.ownerDocument, disposers = []; let pressed = false, held = false, insert = null, releaseFrame = 0;
  const selected = () => { const s = doc.getSelection(); return s && !s.isCollapsed && (containsNode(root, s.anchorNode) || containsNode(root, s.focusNode)) ? s : null; };
  const report = () => { const next = pressed || !!selected(); root.dataset.selectionHeld = String(next); if (next !== held) { const old = held; held = next; onHeld?.(held); if (releaseFrame) cancelAnimationFrame(releaseFrame); if (old && !held) releaseFrame = requestAnimationFrame(() => { releaseFrame = 0; if (!held) onRelease?.(); }); } if (!selected()) { insert?.remove(); insert = null; } };
  listen(root, 'pointerdown', e => { onFocus?.(paneId); if (e.button === 0 && e.pointerType !== 'touch' && !isControl(e.target)) pressed = true; report(); }, false, disposers);
  listen(doc, 'pointerup', () => { pressed = false; report(); const s = selected(); if (!s || !onInsert) return; const range = s.getRangeAt(0).cloneRange(); insert?.remove(); insert = element(doc, 'button', 'parity-selection-insert selection-insert', insertLabel); insert.type = 'button';
    // Use the range rectangle; do not use the pointer's last position (it may be outside).
    const rectangles = [...range.getClientRects()].filter(r => r.width && r.height), box = rectangles.at(-1) || range.getBoundingClientRect();
    const viewport = { w: doc.documentElement.clientWidth, h: doc.documentElement.clientHeight }; insert.style.left = clamp(box.left + box.width / 2, 96, viewport.w - 96) + 'px'; insert.style.top = clamp(box.bottom + 8, 8, viewport.h - 44) + 'px';
    insert.onpointerdown = e => e.preventDefault(); insert.onclick = e => { e.stopPropagation(); const fragment = range.cloneContents(), wrap = element(doc, 'div'); wrap.append(fragment); onInsert({ pane: paneId, text: range.toString(), html: wrap.innerHTML, range }); insert.remove(); insert = null; }; doc.body.append(insert);
  }, false, disposers);
  listen(doc, 'pointercancel', () => { pressed = false; report(); }, false, disposers);
  listen(doc, 'selectionchange', report, false, disposers);
  listen(doc, 'pointerdown', e => { if (!root.contains(e.target) && !e.target.closest('.selection-insert') && selected()) doc.getSelection().removeAllRanges(); }, false, disposers);
  return { held: () => held, clear() { const s = selected(); if (s) s.removeAllRanges(); pressed = false; report(); }, dispose() { disposers.forEach(f => f()); if (releaseFrame) cancelAnimationFrame(releaseFrame); insert?.remove(); delete root.dataset.selectionHeld; } };
}

/** A stable floating return button: reserve tail space without inserting a white toolbar. */
export class FloatingReturn {
  constructor({ pane, body, footer = null, onReturn, text = '回到刚刚' }) {
    this.pane = pane; this.body = body; this.footer = footer; this.button = element(pane.ownerDocument, 'button', 'return-floating parity-return', text); this.button.type = 'button';
    this.button.onclick = e => { e.stopPropagation(); onReturn?.(); }; (footer || pane).append(this.button); this.show(false);
  }
  show(visible) { this.button.hidden = !visible; this.body.classList.toggle('parity-has-return', visible); this.body.style.setProperty('--return-space', RETURN_SCROLL_SPACE + 'px'); }
  dispose() { this.button.remove(); this.body.classList.remove('parity-has-return'); }
}

/**
 * Persistent overview rail; selection brush and native scroll/zoom cannot conflict.
 * Call refresh after replacing grid items, and dispose before another modal opens.
 * getItems: [{id,node}]; getSelected/setSelected: IDs; getColumns/setColumns: 1..8.
 */
export function attachOverviewGestures(body, { getItems, getSelected, setSelected, isSelectionMode = () => false, getColumns, setColumns, onActivate } = {}) {
  const doc = body.ownerDocument, disposers = [], wrapper = element(doc, 'div', 'parity-overview-shell'), rail = element(doc, 'div', 'parity-overview-rail'), thumb = element(doc, 'div', 'parity-overview-thumb');
  body.before(wrapper); wrapper.append(body, rail); rail.append(thumb); body.classList.add('parity-overview-scroll'); rail.setAttribute('role', 'scrollbar'); rail.setAttribute('aria-label', '课件概览滚动'); rail.tabIndex = 0;
  let drag = null, pinchColumns = 4, zoomAt = 0, suppressedUntil = 0, pending = 0, disposed = false;
  const items = () => getItems?.() || [...body.querySelectorAll('.overview-item')].map(node => ({ id: node.dataset.id, node }));
  const active = target => items().find(item => item.node === target?.closest?.('.overview-item') || item.node.contains(target));
  const extent = () => Math.max(0, body.scrollHeight - body.clientHeight);
  const renderRail = () => { pending = 0; const h = rail.clientHeight, total = body.scrollHeight, thumbH = clamp(h * body.clientHeight / Math.max(1, total), Math.min(44, h), h); thumb.style.height = thumbH + 'px'; thumb.style.top = extent() ? body.scrollTop / extent() * (h - thumbH) + 'px' : '0px'; rail.setAttribute('aria-valuenow', String(Math.round(body.scrollTop))); rail.setAttribute('aria-valuemax', String(Math.round(extent()))); };
  const refresh = () => { if (disposed) return; wrapper.classList.toggle('selection-mode', isSelectionMode()); body.style.touchAction = isSelectionMode() ? 'none' : 'pan-y'; items().forEach(({ id, node }) => node.classList.toggle('selected', getSelected?.().includes(id))); if (!pending) pending = requestAnimationFrame(renderRail); };
  const zoom = scale => { if (isSelectionMode()) return; const next = clamp(Math.round(pinchColumns / Math.max(.3, scale)), 1, 8); if (next !== getColumns?.() && performance.now() - zoomAt >= 120) { zoomAt = performance.now(); setColumns?.(next); refresh(); } };
  const scrollRail = y => { const b = rail.getBoundingClientRect(), travel = b.height - thumb.offsetHeight; body.scrollTop = clamp((y - b.top - (drag?.grab || thumb.offsetHeight / 2)) / Math.max(1, travel), 0, 1) * extent(); refresh(); };
  listen(rail, 'pointerdown', e => { if (e.button !== 0) return; e.preventDefault(); e.stopPropagation(); const box = thumb.getBoundingClientRect(); drag = { kind: 'rail', id: e.pointerId, grab: e.clientY >= box.top && e.clientY <= box.bottom ? e.clientY - box.top : box.height / 2 }; rail.setPointerCapture(e.pointerId); scrollRail(e.clientY); }, false, disposers);
  listen(rail, 'keydown', e => { if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'].includes(e.key)) { e.preventDefault(); body.scrollTop = e.key === 'Home' ? 0 : e.key === 'End' ? extent() : body.scrollTop + (e.key.includes('Down') ? 1 : -1) * (e.key.startsWith('Page') ? body.clientHeight * .8 : 50); refresh(); } }, false, disposers);
  listen(body, 'pointerdown', e => {
    if (!isSelectionMode() || e.button !== 0 || isControl(e.target)) return; const item = active(e.target); e.preventDefault(); e.stopImmediatePropagation(); suppressedUntil = performance.now() + 350;
    if (item) { const ordered = items(), ids = ordered.map(i => i.id), initial = [...(getSelected?.() || [])], anchor = ids.indexOf(item.id); drag = { kind: 'brush', id: e.pointerId, ids, initial, anchor, adding: !initial.includes(item.id) }; setSelected?.(brushRange(ids, initial, anchor, anchor, drag.adding)); refresh(); }
    else drag = { kind: 'blank', id: e.pointerId, y: e.clientY, scroll: body.scrollTop };
    body.setPointerCapture?.(e.pointerId);
  }, true, disposers);
  listen(doc, 'pointermove', e => { if (!drag || drag.id !== e.pointerId) return; e.preventDefault(); if (drag.kind === 'rail') scrollRail(e.clientY); else if (drag.kind === 'blank') { body.scrollTop = drag.scroll + drag.y - e.clientY; refresh(); } else { const hit = active(doc.elementFromPoint(e.clientX, e.clientY)); if (hit) { setSelected?.(brushRange(drag.ids, drag.initial, drag.anchor, drag.ids.indexOf(hit.id), drag.adding)); refresh(); } } }, { passive: false }, disposers);
  const end = e => { if (!drag || e.pointerId !== drag.id) return; suppressedUntil = performance.now() + 300; const source = drag.kind === 'rail' ? rail : body; if (source.hasPointerCapture?.(e.pointerId)) source.releasePointerCapture(e.pointerId); drag = null; refresh(); };
  listen(doc, 'pointerup', end, false, disposers); listen(doc, 'pointercancel', end, false, disposers);
  listen(body, 'click', e => { const item = active(e.target); if (!item) return; if (isSelectionMode() || performance.now() < suppressedUntil) { e.preventDefault(); e.stopImmediatePropagation(); return; } if (onActivate) { e.preventDefault(); e.stopImmediatePropagation(); onActivate(item.id); } }, true, disposers);
  listen(body, 'wheel', e => { if (isSelectionMode()) { e.preventDefault(); return; } if (e.ctrlKey || e.metaKey) { e.preventDefault(); pinchColumns = getColumns?.() || 4; const next = clamp(pinchColumns + (e.deltaY > 0 ? 1 : -1), 1, 8); if (performance.now() - zoomAt > 120) { zoomAt = performance.now(); setColumns?.(next); refresh(); } } }, { passive: false }, disposers);
  listen(body, 'gesturestart', e => { if (isSelectionMode()) { e.preventDefault(); return; } e.preventDefault(); pinchColumns = getColumns?.() || 4; suppressedUntil = performance.now() + 500; zoomAt = 0; }, { passive: false }, disposers);
  listen(body, 'gesturechange', e => { e.preventDefault(); zoom(e.scale); suppressedUntil = performance.now() + 350; }, { passive: false }, disposers);
  listen(body, 'gestureend', e => { e.preventDefault(); zoomAt = 0; zoom(e.scale); suppressedUntil = performance.now() + 350; }, { passive: false }, disposers);
  listen(body, 'scroll', refresh, { passive: true }, disposers);
  const observer = new ResizeObserver(refresh); observer.observe(body); refresh();
  return { refresh, selectionChanged() { drag = null; if (!isSelectionMode()) setSelected?.([]); refresh(); }, dispose() { disposed = true; observer.disconnect(); disposers.forEach(f => f()); if (pending) cancelAnimationFrame(pending); body.classList.remove('parity-overview-scroll'); body.style.touchAction = ''; wrapper.before(body); wrapper.remove(); } };
}
