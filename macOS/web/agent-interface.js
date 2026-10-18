// A fresh observed node is required for each UI action. Never expose the native bridge,
// selectors, URLs, password fields, credential dialogs or arbitrary code to a model.
const protectedNode = node => !!node.closest('[data-global-agent],.api-form,.welcome,#loginForm') || node.matches('input[type=password],input[autocomplete*=password]') || /密码|密钥|验证码/.test(node.getAttribute('placeholder') || '');
const visible = node => node.isConnected && !node.closest('[hidden],[aria-hidden=true]') && node.ownerDocument.defaultView.getComputedStyle(node).display !== 'none' && node.ownerDocument.defaultView.getComputedStyle(node).visibility !== 'hidden';
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
    if (operation === 'click') {
      if (!node.matches('button,summary,a.time-link,[role=button],input[type=checkbox],input[type=radio]')) throw new Error('该控件不可点击');
      node.click();
    } else if (operation === 'fill') {
      if (!node.matches('input:not([type=file]):not([type=password]):not([type=checkbox]):not([type=radio]),textarea') || node.readOnly) throw new Error('该位置不可填写，请用笔记专用操作');
      node.value = value;
      node.dispatchEvent(new node.ownerDocument.defaultView.Event('input', { bubbles: true }));
      node.dispatchEvent(new node.ownerDocument.defaultView.Event('change', { bubbles: true }));
    } else if (operation === 'select') {
      if (node.tagName !== 'SELECT' || ![...node.options].some(o => o.value === value && !o.disabled)) throw new Error('选项不存在');
      node.value = value; node.dispatchEvent(new node.ownerDocument.defaultView.Event('change', { bubbles: true }));
    } else if(operation==='focus') {
      node.focus({preventScroll:true});
    } else if (operation === 'scroll') {
      node.scrollTop += amount; node.dispatchEvent(new node.ownerDocument.defaultView.Event('scroll'));
    } else throw new Error('不支持的界面操作');
    this.nodes.clear(); // A write consumes the observation; the model must read back.
    await new Promise(resolve => setTimeout(resolve, 90));
    return { ok: true, message: '已操作，请读取状态确认结果' };
  }
}
