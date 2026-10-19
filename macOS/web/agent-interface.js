// A fresh observed node is required for each UI action. Never expose the native bridge,
// selectors, URLs, password fields, credential dialogs or arbitrary code to a model.
const protectedNode = node => !!node.closest('[data-global-agent],.api-form,.welcome,#loginForm') || node.matches('input[type=password],input[autocomplete*=password]') || /密码|密钥|验证码/.test(node.getAttribute('placeholder') || '');
const visible = node => node.isConnected && !node.closest('[hidden],[aria-hidden=true]') && node.ownerDocument.defaultView.getComputedStyle(node).display !== 'none' && node.ownerDocument.defaultView.getComputedStyle(node).visibility !== 'hidden';
const CONTROLS = 'button,input,textarea,select,summary,a.time-link,[role=button],[contenteditable=true]';
// The name a person would use for a control: its accessible name, tooltip, placeholder, label or text.
const nameOf = node => String(node.getAttribute('aria-label') || node.getAttribute('title') || node.getAttribute('placeholder') || (['INPUT', 'SELECT', 'TEXTAREA'].includes(node.tagName) ? node.closest('label')?.textContent || node.id : node.textContent) || '').replace(/\s+/g, ' ').trim();
const SCOPES = { toolbar: '#topbar', nav: '#navigation', modal: '#modal', page: '#content' };
export class AgentInterface {
  constructor(doc) { this.doc = doc; this.revision = 0; this.nodes = new Map(); }
  snapshot({offset=0,limit=100}={}) {
    this.nodes.clear(); const revision = ++this.revision;
    const controls = [];
    const modal = this.doc.querySelector('#modal'), surface = modal && !modal.hidden ? modal : this.doc;
    for (const node of surface.querySelectorAll('button,input,textarea,select,summary,a.time-link,[role=button],[contenteditable=true],.pane-content,#content,#modalBody')) {
      if (!visible(node) || protectedNode(node) || node.disabled) continue;
      const id = `${revision}:${controls.length + 1}`, label = node.getAttribute('aria-label') || node.getAttribute('title') || node.getAttribute('placeholder') || (node.tagName === 'SELECT' ? node.selectedOptions?.[0]?.textContent : node.textContent) || node.id || node.className;
      this.nodes.set(id, { node, label, fingerprint: this.fingerprint(node) });
      controls.push({ id, label: String(label).trim().slice(0, 150), type: node.type || node.tagName.toLowerCase(), pane: node.closest('[data-pane]')?.dataset.pane || '', ...(node.tagName === 'SELECT' ? { options: [...node.options].map(o => ({ value: o.value, label: o.textContent })) } : {}), ...(['INPUT', 'TEXTAREA'].includes(node.tagName) ? { value: node.value.slice(0, 500) } : {}), ...(node.type === 'checkbox' ? { checked: node.checked } : {}) });
      if (controls.length >= 1000) break;
    }
    const text = [];
    const root = !this.doc.querySelector('#modal')?.hidden ? this.doc.querySelector('#modalBody') : this.doc.querySelector('#content');
    if (root) { const walker = this.doc.createTreeWalker(root, 4); let item; while ((item = walker.nextNode()) && text.join('').length < 10000) if (!protectedNode(item.parentElement) && visible(item.parentElement) && item.textContent.trim()) text.push(item.textContent.trim()); }
    offset=Math.max(0,Math.floor(Number(offset)||0));limit=Math.max(1,Math.min(150,Math.floor(Number(limit)||100)));
    return { revision, total:controls.length, offset, next:offset+limit<controls.length?offset+limit:null, title: this.doc.querySelector('#pageTitle')?.textContent, text: text.join('\n'), controls:controls.slice(offset,offset+limit) };
  }
  fingerprint(node) { return JSON.stringify([node.getAttribute('aria-label'), node.getAttribute('title'), node.type, node.tagName === 'BUTTON' ? node.textContent : null, node.closest('[data-pane]')?.dataset.pane]); }
  async interact({ id, operation, value = '', amount = 0 }) {
    const observed = this.nodes.get(id), node = observed?.node;
    if (!node || !visible(node) || protectedNode(node) || node.disabled || this.fingerprint(node) !== observed.fingerprint) throw new Error('界面已变化，请重新读取 app_interface');
    await this.operate(node, operation, value, amount);
    return { ok: true, message: '已操作，请读取状态确认结果' };
  }
  // One step for the model: find a visible control by the name shown on screen and operate it,
  // then report what the page shows now. Same exclusions as snapshots (no passwords, keys or the assistant).
  async act({ operation, label, value = '', amount = 0, within = '', nth = 0 }) {
    const name = String(label || '').replace(/\s+/g, ' ').trim(); if (!name) throw new Error('请提供控件名称');
    const modal = this.doc.querySelector('#modal'), open = modal && !modal.hidden;
    const scope = within ? this.doc.querySelector(SCOPES[within] || '[data-pane="' + CSS.escape(within) + '"]') : open ? modal : this.doc;
    if (!scope) throw new Error('当前界面没有这个范围：' + within);
    const all = [...scope.querySelectorAll(CONTROLS)].filter(n => visible(n) && !protectedNode(n) && !n.disabled && nameOf(n));
    let matches = all.filter(n => nameOf(n) === name);
    if (!matches.length) matches = all.filter(n => nameOf(n).includes(name));
    if (!matches.length) throw new Error('当前界面没有“' + name + '”。可操作的有：' + [...new Set(all.map(nameOf))].slice(0, 60).map(t => t.slice(0, 24)).join('、'));
    if (matches.length > 1 && !nth) throw new Error('有 ' + matches.length + ' 个“' + name + '”：' + matches.slice(0, 8).map((n, i) => (i + 1) + '. ' + nameOf(n).slice(0, 30) + (n.closest('[data-pane]') ? '（' + n.closest('[data-pane]').dataset.pane + '）' : '')).join('；') + '。请用 nth 或 within 指定');
    const node = matches[Math.max(1, Math.floor(nth) || 1) - 1]; if (!node) throw new Error('序号超出范围');
    await this.operate(node, operation, value, amount);
    return this.summary();
  }
  summary() {
    const modal = this.doc.querySelector('#modal'), open = modal && !modal.hidden, root = open ? this.doc.querySelector('#modalBody') : this.doc.querySelector('#content');
    return { ok: true, page: this.doc.querySelector('#pageTitle')?.textContent || '', dialog: open ? this.doc.querySelector('#modalTitle')?.textContent || '' : null, text: String(root?.innerText ?? root?.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 900) };
  }
  async operate(node, operation, value = '', amount = 0) {
    if (operation === 'click') {
      if (!node.matches('button,summary,a.time-link,[role=button],input[type=checkbox],input[type=radio]')) throw new Error('该控件不可点击');
      node.click();
    } else if (operation === 'fill') {
      if (!node.matches('input:not([type=file]):not([type=password]):not([type=checkbox]):not([type=radio]),textarea') || node.readOnly) throw new Error('该位置不可填写，请用笔记专用操作');
      node.value = value;
      node.dispatchEvent(new node.ownerDocument.defaultView.Event('input', { bubbles: true }));
      node.dispatchEvent(new node.ownerDocument.defaultView.Event('change', { bubbles: true }));
    } else if (operation === 'select') {
      // The option may be named by its value or by the text a person sees.
      const option = node.tagName === 'SELECT' && ([...node.options].find(o => o.value === value && !o.disabled) || [...node.options].find(o => o.textContent.trim() === String(value).trim() && !o.disabled));
      if (!option) throw new Error('选项不存在' + (node.tagName === 'SELECT' ? '，可选：' + [...node.options].map(o => o.textContent.trim()).join('、') : ''));
      node.value = option.value; node.dispatchEvent(new node.ownerDocument.defaultView.Event('change', { bubbles: true }));
    } else if(operation==='focus') {
      node.focus({preventScroll:true});
    } else if (operation === 'scroll') {
      node.scrollTop += amount; node.dispatchEvent(new node.ownerDocument.defaultView.Event('scroll'));
    } else throw new Error('不支持的界面操作');
    this.nodes.clear(); // A write consumes the observation; the model must read back.
    await new Promise(resolve => setTimeout(resolve, 90));
  }
}
