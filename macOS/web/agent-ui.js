import { AgentRunner } from './agent-runtime.js';
import { makeIcon } from './theme-icons.js';
import { CAMPUS_NOTICE, CAMPUS_LIMITS } from './ai-connection.js';
const create = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
export class GlobalAssistant {
  constructor(options) {
    this.options = options; this.history = []; this.loadedOwner = null; this.generation = 0;
    this.mode = 'floating'; this.messages = []; this.savedGeometry = null;
    this.runner = new AgentRunner({ ...options, emit: event => this.event(event) });
  }
  mount() {
    if (this.root) return;
    const root = this.root = create('section', 'global-agent'); root.dataset.globalAgent = ''; root.setAttribute('aria-label', '应用助手');
    root.setAttribute('role', 'region'); root.hidden = true;
    const head = create('header', 'agent-head'); this.dragHandle = head;
    const title = create('strong', '', '应用助手'); title.prepend(makeIcon('question'));
    this.status = create('span', 'agent-status', '随时为你操作');
    head.append(title, this.status, this.action('设置', () => this.settings()), this.action('收起', () => this.hide(), 'minimise'));
    const tools = create('div', 'agent-tools');
    this.dockButton = this.action('收为功能区', () => this.setMode(this.mode === 'pane' ? 'floating' : 'pane'));
    tools.append(this.action('新对话', () => this.newConversation()), this.action('历史', () => this.showHistory()), this.dockButton);
    this.log = create('div', 'agent-log'); this.log.setAttribute('aria-label', '对话与操作记录');
    // Streaming has a single live status rather than announcing every token.
    this.status.setAttribute('role', 'status'); this.status.setAttribute('aria-live', 'polite');
    this.composer = create('div', 'agent-composer');
    this.input = create('textarea'); this.input.placeholder = '说说你想做什么…'; this.input.rows = 1; this.input.setAttribute('aria-label', '给应用助手的指令');
    this.sendButton = this.action('发送', () => this.submit(), 'primary'); this.stopButton = this.action('停止', () => this.stop()); this.stopButton.hidden = true;
    this.composer.append(this.input, this.sendButton, this.stopButton);
    const hint = create('div', 'agent-footnote', 'Enter 发送 · Shift＋Enter 换行');
    this.serviceNote = create('details', 'agent-service-note'); this.serviceNote.append(create('summary', '', '校内 AI · 使用局限'), create('p', '', CAMPUS_NOTICE + '。' + CAMPUS_LIMITS)); this.serviceNote.hidden = true;
    root.append(head, tools, this.serviceNote, this.log, this.composer, hint);
    this.input.addEventListener('input', () => { this.input.style.height = '38px'; this.input.style.height = Math.min(130, this.input.scrollHeight) + 'px'; });
    this.input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); this.submit(); } });
    root.addEventListener('keydown', e => e.stopPropagation());
    this.bubble = this.action('应用助手', () => this.show(), 'agent-bubble'); this.bubble.dataset.globalAgent = ''; this.bubble.hidden = true; this.bubble.prepend(makeIcon('question'));
    document.body.append(root, this.bubble);
    head.addEventListener('pointerdown', e => {
      if (e.button !== 0 || this.mode === 'pane' || e.target.closest('button')) return;
      e.preventDefault(); head.setPointerCapture(e.pointerId);
      const box = root.getBoundingClientRect(), startX = e.clientX, startY = e.clientY;
      const move = p => { root.style.left = Math.max(0, Math.min(window.innerWidth - 100, box.left + p.clientX - startX)) + 'px'; root.style.top = Math.max(0, Math.min(window.innerHeight - 60, box.top + p.clientY - startY)) + 'px'; root.style.right = 'auto'; root.style.bottom = 'auto'; };
      const end = () => { head.removeEventListener('pointermove', move); head.removeEventListener('pointerup', end); head.removeEventListener('pointercancel', end); this.rememberGeometry(); };
      head.addEventListener('pointermove', move); head.addEventListener('pointerup', end); head.addEventListener('pointercancel', end);
    });
    this.resizeObserver = new ResizeObserver(() => this.rememberGeometry()); this.resizeObserver.observe(root);
    window.addEventListener('resize', () => this.clamp());
    this.empty();
  }
  action(label, fn, cls = '') { const n = create('button', cls, label); n.type = 'button'; n.title = label; n.addEventListener('click', e => { e.stopPropagation(); Promise.resolve().then(fn).catch(error => this.notice(error.message)); }); return n; }
  async ensureOwner() {
    const owner = this.options.owner(); if (this.loadedOwner === owner) return;
    this.reset(); this.loadedOwner = owner; const generation = this.generation;
    const stored = await this.options.read('chats-agent.json', true);
    if (generation !== this.generation || owner !== this.options.owner()) return;
    this.messages = Array.isArray(stored?.conversations) ? stored.conversations.filter(c => c && typeof c.id === 'string' && Array.isArray(c.turns)).slice(-20) : [];
    const current = this.messages.find(c => c.id === stored?.current) || this.messages.at(-1);
    this.currentId = current?.id || 'agent-' + Date.now(); this.history = (current?.turns || []).filter(t => ['user', 'assistant'].includes(t.role) && typeof t.content === 'string').slice(-100);
    const display = await this.options.read('agent-display.json');
    if (generation !== this.generation || owner !== this.options.owner()) return;
    this.savedGeometry = display?.geometry; this.preferredMode = display?.mode === 'pane' ? 'pane' : 'floating';
    this.renderHistory(); this.clamp();
  }
  async show() {
    this.mount(); await this.ensureOwner(); const generation = this.generation; await this.options.ready(); if (generation !== this.generation) return; this.updateServiceNote(); this.root.hidden = false; this.bubble.hidden = true;
    if (this.preferredMode === 'pane' && this.options.canDock()) await this.setMode('pane');
    else if (this.mode !== 'pane') this.options.detach(this.root);
    this.clamp(); this.input.focus({ preventScroll: true });
  }
  hide() { if (!this.root) return; this.options.undock(); this.mode = 'floating'; this.root.dataset.mode = 'floating'; document.body.append(this.root); this.root.hidden = true; this.bubble.hidden = false; }
  toggle() { return !this.root || this.root.hidden ? this.show() : this.hide(); }
  async setMode(mode) {
    this.mount(); if (mode === 'pane' && !this.options.canDock()) { this.notice('进入学习后可以收为功能区'); return; }
    this.root.hidden = false; this.bubble.hidden = true; this.preferredMode = mode; this.mode = mode; this.root.dataset.mode = mode;
    if (mode === 'pane') this.options.dock(this.root); else { this.options.undock(); this.options.detach(this.root); this.clamp(); }
    this.dockButton.textContent = mode === 'pane' ? '浮动显示' : '收为功能区';
    await this.persistDisplay();
  }
  routeChanged() {
    if (!this.root || this.root.hidden) return;
    if (this.preferredMode === 'pane' && this.options.canDock()) { this.mode = 'pane'; this.root.dataset.mode = 'pane'; this.options.dock(this.root); this.dockButton.textContent = '浮动显示'; }
  }
  leavePane() {
    if (!this.root || this.mode !== 'pane') return;
    document.body.append(this.root); this.mode = 'floating'; this.root.dataset.mode = 'floating'; this.dockButton.textContent = '收为功能区'; this.clamp();
  }
  clamp() {
    if (!this.root || this.mode === 'pane') return;
    const geo = this.savedGeometry || {}, width = Math.max(300, Math.min(window.innerWidth - 24, Number(geo.width) || 390)), height = Math.max(250, Math.min(window.innerHeight - 24, Number(geo.height) || 540));
    Object.assign(this.root.style, { width: width + 'px', height: height + 'px', left: Math.max(8, Math.min(window.innerWidth - width - 8, Number(geo.left) || window.innerWidth - width - 24)) + 'px', top: Math.max(8, Math.min(window.innerHeight - height - 8, Number(geo.top) || 72)) + 'px', right: 'auto', bottom: 'auto' });
  }
  rememberGeometry() {
    if (!this.root || this.root.hidden || this.mode === 'pane') return;
    const box = this.root.getBoundingClientRect(); if (!box.width) return;
    this.savedGeometry = { left: box.left, top: box.top, width: box.width, height: box.height };
    clearTimeout(this.geometryTimer); this.geometryTimer = setTimeout(() => this.persistDisplay().catch(() => {}), 250);
  }
  persistDisplay() { return this.options.write('agent-display.json', { mode: this.preferredMode || 'floating', geometry: this.savedGeometry }); }
  empty() { this.log.replaceChildren(create('div', 'agent-empty', '把事情交给我')); this.log.append(create('p', 'agent-empty-detail', '例如：打开最近一节课，显示视频和笔记；把这一段整理成笔记；下载今天的课件。')); }
  renderHistory() { if (!this.history.length) return this.empty(); this.log.replaceChildren(); for (const turn of this.history) this.addTurn(turn.role, turn.content); this.scroll(); }
  addTurn(role, text = '') { if (this.log.querySelector('.agent-empty')) this.log.replaceChildren(); const n = create('div', 'agent-turn ' + role); n.append(create('span', 'agent-speaker', role === 'user' ? '你' : '应用助手'), create('div', 'agent-message', text)); this.log.append(n); const message = n.querySelector('.agent-message'); if (role === 'assistant') this.format(message, text); return message; }
  format(node, text) {
    node.replaceChildren();
    // Text-only Markdown: no model-produced HTML, links, images or event handlers.
    const pattern = /(\*\*([^*]+)\*\*|`([^`]+)`)/g; let at = 0, match;
    while ((match = pattern.exec(text))) { node.append(document.createTextNode(text.slice(at, match.index))); node.append(create(match[2] ? 'strong' : 'code', '', match[2] || match[3])); at = pattern.lastIndex; }
    node.append(document.createTextNode(text.slice(at)));
  }
  scroll() { this.log.scrollTop = this.log.scrollHeight; }
  notice(text) { if (!this.log) this.mount(); this.log.append(create('div', 'agent-notice', text)); this.scroll(); }
  event(event) {
    if (event.type === 'delta') { if (!this.reply) this.reply = this.addTurn('assistant'); this.reply.textContent += event.text; this.scheduleScroll(); }
    else if (event.type === 'step') {
      this.reply = null; const schema = this.options.registry.actions.get(event.action);
      this.step = create('div', 'agent-step', (schema?.description.split('。')[0] || ({ app_state: '读取应用状态', app_actions: '查询可用操作', app_interface: '查看当前界面' })[event.action] || event.action) + '…'); this.log.append(this.step); this.status.textContent = '正在操作'; this.scroll();
    } else if (event.type === 'result' && this.step) { this.step.textContent = (event.ok ? '✓ ' : '未完成 · ') + this.step.textContent.replace(/…$/, '') + (event.error ? '：' + event.error : ''); this.step.dataset.ok = String(event.ok); }
    else if (event.type === 'done') { if (!this.reply && event.text) this.reply = this.addTurn('assistant', event.text); else if (this.reply) this.format(this.reply, event.text); this.status.textContent = '已完成'; }
  }
  scheduleScroll() { if (this.scrollFrame) return; this.scrollFrame = window.requestAnimationFrame(() => { this.scrollFrame = 0; if (this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 160) this.scroll(); }); }
  async submit() {
    if (this.submitting || this.runner.running || !this.input.value.trim()) return;
    this.submitting = true;
    try {
      await this.ensureOwner(); const generation = this.generation, owner = this.options.owner();
      const ready = await this.options.ready();
      if (generation !== this.generation || owner !== this.options.owner()) return;
      if (!ready) { this.notice('当前 AI 服务尚未就绪，请在设置中选择校内网关或个人 API。'); await this.settings(); return; }
      return await this.performSubmission();
    } finally { this.submitting = false; }
  }
  async performSubmission() {
    const text = this.input.value.trim(), history = this.history.slice(), generation = this.generation;
    this.input.value = ''; this.input.style.height = '38px'; this.addTurn('user', text); this.history.push({ role: 'user', content: text }); this.reply = null;
    this.busy(true); this.status.textContent = '正在思考'; this.scroll();
    try { const answer = await this.runner.run(text, history); if (generation === this.generation) this.history.push({ role: 'assistant', content: answer }); }
    catch (error) { if (generation === this.generation) { this.notice(error.message); this.history.push({ role: 'assistant', content: '任务未完成：' + error.message }); this.status.textContent = '未完成'; } }
    finally { if (generation === this.generation) { this.busy(false); await this.persist(); } }
  }
  busy(value) { this.sendButton.hidden = value; this.stopButton.hidden = !value; this.input.readOnly = value; }
  updateServiceNote() {
    const campus = this.options.providerDescription().includes('校内'); this.serviceNote.hidden = !campus;
    if (campus && !this.showedCampusLimits) { this.serviceNote.open = true; this.showedCampusLimits = true; }
  }
  stop() { this.runner.stop(); this.generation++; this.busy(false); this.status.textContent = '已停止'; this.notice('已停止后续操作；已完成的操作会保留。'); this.history.push({ role: 'assistant', content: '用户停止了任务，已完成的操作保留。' }); this.persist().catch(() => {}); }
  async persist() {
    if (this.loadedOwner !== this.options.owner()) return;
    const entry = { id: this.currentId, updatedAt: Date.now(), turns: this.history.slice(-100) };
    this.messages = this.messages.filter(c => c.id !== entry.id).concat(entry).slice(-20);
    return this.options.write('chats-agent.json', { current: this.currentId, conversations: this.messages }, true);
  }
  async newConversation() { if (this.runner.running) this.stop(); await this.persist(); this.currentId = 'agent-' + Date.now(); this.history = []; this.reply = null; this.empty(); this.status.textContent = '随时为你操作'; await this.persist(); }
  showHistory() {
    if (this.runner.running) { this.notice('请先停止当前任务'); return; }
    this.log.replaceChildren(create('h3', '', '历史对话'));
    for (const c of [...this.messages].reverse()) this.log.append(this.action(c.turns.find(t => t.role === 'user')?.content.slice(0, 45) || '新对话', async () => { await this.persist(); this.currentId = c.id; this.history = c.turns.slice(); this.renderHistory(); }));
    this.log.append(this.action('返回对话', () => this.renderHistory()));
  }
  async settings() {
    if (this.runner.running) { this.notice('请先停止当前任务再修改设置'); return; }
    const generation = this.generation, ready = await this.options.ready(); if (generation !== this.generation) return; const personalReady = !!this.options.providerStatus()?.personalReady;
    this.log.replaceChildren(create('h3', '', 'AI设置'), create('p', 'agent-notice', '与课程问答、本页速览共用 AI 来源。只有你发起任务时，指令、所需页面状态与课程资料才会发送到所选服务。密钥保存在 macOS 钥匙串。'));
    const source = create('select'); source.setAttribute('aria-label', 'AI服务来源');
    for (const [value, text] of [['auto', '自动 · 优先个人 API'], ['campus', '浙大校内网关'], ['personal', '个人 DeepSeek API']]) { const option = create('option', '', text); option.value = value; source.append(option); }
    source.value = this.options.provider();
    const sourceHint = create('p', 'agent-notice', this.options.providerDescription() + '。' + (this.options.providerDescription().includes('校内') ? CAMPUS_LIMITS : ''));
    source.onchange = () => this.options.setProvider(source.value).then(() => { this.updateServiceNote(); sourceHint.textContent = this.options.providerDescription() + (this.options.providerDescription().includes('校内') ? '。' + CAMPUS_LIMITS : ''); }).catch(error => this.notice(error.message));
    this.log.append(source, sourceHint);
    const model = create('select'); model.setAttribute('aria-label', '助手模型');
    for (const [value, text] of [['deepseek-flash', 'DeepSeek Flash'], ['deepseek-v4-pro', 'DeepSeek Pro']]) { const option = create('option', '', text); option.value = value; model.append(option); }
    model.value = this.options.model(); model.onchange = () => this.options.setModel(model.value); this.log.append(create('p', 'agent-notice', '个人 API 模型（校内网关使用固定模型）'), model);
    const password = create('input'); password.type = 'password'; password.placeholder = personalReady ? '新 API 密钥（不修改可留空）' : 'DeepSeek API 密钥'; password.autocomplete = 'off';
    this.log.append(create('h4', '', '个人 DeepSeek API'), password, this.action(personalReady ? '更换个人密钥' : '保存个人密钥', async () => { const key = password.value.trim(); if (!/^sk-[A-Za-z0-9_-]{16,200}$/.test(key)) throw new Error('请输入有效的 API 密钥'); await this.options.setKey(key); password.value = ''; this.renderHistory(); this.notice('已改用个人 API'); }));
    const advanced = create('details', 'agent-gateway-config'), heading = create('summary', '', '本机校园网关配置');
    const campus = create('input'); campus.type = 'password'; campus.autocomplete = 'off'; campus.placeholder = '校园网关密钥'; campus.setAttribute('aria-label', '校园网关密钥');
    advanced.append(heading, create('p', 'agent-notice', '仅在浙大内网环境下可用。这里的密钥只预置在本机，不包含在公开安装包和源码中。'), campus, this.action('保存到本机钥匙串', async () => { const key = campus.value.trim(); if (!/^[A-Za-z0-9_-]{16,256}$/.test(key)) throw new Error('校园网关密钥格式无效'); await this.options.setCampusKey(key); campus.value = ''; await this.options.setProvider('auto'); this.renderHistory(); this.notice('校园网关已在本机预置。仅在浙大内网环境下可用。'); }));
    const ocr = create('input'); ocr.type = 'password'; ocr.autocomplete = 'off'; ocr.placeholder = '校园 OCR 密钥'; ocr.setAttribute('aria-label', '校园 OCR 密钥');
    advanced.append(create('p', 'agent-notice', '校园 OCR 用于识别课件的文字、公式与版面；不可用时尝试本机文字识别。'), ocr, this.action('保存 OCR 密钥', async () => { const key = ocr.value.trim(); if (!/^[A-Za-z0-9_-]{16,256}$/.test(key)) throw new Error('OCR 密钥格式无效'); await this.options.setCampusOCRKey(key); ocr.value = ''; this.renderHistory(); this.notice('校园 OCR 已在本机预置'); }));
    this.log.append(advanced, this.action('返回对话', () => this.renderHistory()));
  }
  reset() {
    this.runner.stop(); this.generation++; clearTimeout(this.geometryTimer); this.history = []; this.messages = []; this.currentId = 'agent-' + Date.now(); this.loadedOwner = null; this.savedGeometry = null; this.preferredMode = 'floating';
    if (this.root) { this.leavePane(); this.options.undock(); this.root.hidden = true; this.bubble.hidden = true; this.busy(false); this.empty(); }
  }
}
