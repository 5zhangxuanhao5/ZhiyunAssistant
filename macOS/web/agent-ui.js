import { AgentRunner } from './agent-runtime.js';
import { userMessage } from './user-errors.js';
import { makeIcon } from './theme-icons.js';
import { themeFor } from './theme-catalog.js';
import { FloatingPaneController, floatingPaneBounds } from './parity-interactions.js';
const create = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const clip = (value, max = 40) => { const text = String(value ?? '').replace(/\s+/g, ' ').trim(); return text.length > max ? text.slice(0, max - 1) + '…' : text; };
const clock = seconds => { const s = Math.max(0, Math.round(Number(seconds) || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
// Two conversations started within the same millisecond must not share an id.
let conversationSerial = 0;
const conversationId = () => 'agent-' + Date.now() + '-' + (++conversationSerial);
const duration = ms => { const s = Math.max(0, ms / 1000); return s < 60 ? (s < 10 ? s.toFixed(1) : Math.round(s)) + ' 秒' : Math.floor(s / 60) + ' 分 ' + Math.round(s % 60) + ' 秒'; };

// What each registered operation is called in the activity timeline.
const STEP_LABELS = {
  app_state: '查看当前状态', app_actions: '查找可用操作', app_interface: '读取界面',
  navigate: '打开页面', back: '返回上一级', refresh_courses: '刷新课表', list_lessons: '查找课次', search_courses: '搜索课程广场',
  course_lessons: '读取课程的课次', list_courses: '汇总课程', read_material: '读取课程资料', search_material: '查找课程内容', open_lesson: '进入课程', read_lesson: '读取课堂转写',
  read_slides: '识别课件', ui: '操作界面', notes_edit: '编辑笔记', seek: '跳转时间', slide_page: '切换课件页', follow_current: '回到最新进度', set_pane: '调整功能区',
  set_study_option: '修改学习选项', show_learning_tool: '打开学习工具', video_control: '控制视频', set_collection: '更新收藏',
  notes_list: '读取笔记', note_create: '新建笔记', note_write: '写入笔记', note_rename: '重命名笔记', note_insert_slide: '插入课件到笔记',
  note_export: '导出笔记', download_lesson: '下载课程', download_control: '管理下载', download_queue: '查看下载队列', set_theme: '切换主题',
  interface_action: '操作界面', layout: '调整布局', set_ai_provider: '切换 AI 来源', assistant_history: '整理助手对话', cache_clear: '清理缓存', collection_clear: '清空收藏', notes_index: '查找笔记', notes_read: '读取笔记', close_dialog: '关闭弹层', wait_for: '等待加载',
  set_common_features: '调整常用功能', note_open: '打开笔记', note_delete: '删除笔记', note_format: '设置笔记格式', note_palette: '设置笔记颜色',
  note_insert_transcript: '插入转写到笔记', ai_content: '读取 AI 结果', summary_control: '本页速览', note_insert_ai: '插入 AI 内容到笔记',
  ai_settings: '课程问答', copy_slide: '复制课件图片', cache_settings: '缓存设置', open_batch_download: '打开批量下载', privacy: '查看隐私说明', logout: '退出登录',
};
const PAGES = { home: '我的课堂', today: '今日课表', recent: '近两周', all: '所有课程', favourite: '课程收藏', later: '稍后再看', offline: '离线课程', noteManager: '笔记管理', themes: '主题', cache: '缓存设置', plaza: '课程广场' };
const PANES = { slides: '课件', transcript: '课堂转写', video: '课堂视频', notes: '课堂笔记', question: '课程问答', summary: '本页速览', agent: '应用助手' };
const WORDS = {
  crop: '去黑边', duplicates: '合并重复课件', skip: '跳过无转写', count: '课件页数', overview: '概览', settings: '学习设置', layout: '布局', time: '跳转时间', page: '跳转页数', download: '本节下载',
  play: '播放', pause: '暂停', fullscreen: '全屏', exit_fullscreen: '退出全屏', read: '读取', adjust: '调整', save: '保存', lock: '锁定', unlock: '解锁', auto: '自动排列', rows: '按行', columns: '按列',
  video: '视频', history: '历史课表', summary: '速览', question: '问答', downloads: '下载', click: '点击', fill: '填写', select: '选择', focus: '聚焦', scroll: '滚动',
  resume: '继续', retry: '重试', first: '提前', last: '延后', preserve: '保存可用内容', delete: '删除', scope: '范围', all: '全部页面', generate: '生成',
  favourite: '收藏', later: '稍后再看', insert: '插入', append: '追加', replace: '替换', campus: '校内网关', personal: '个人 API',
};

export class GlobalAssistant {
  constructor(options) {
    this.options = options; this.history = []; this.loadedOwner = null; this.generation = 0;
    this.mode = 'floating'; this.messages = []; this.savedGeometry = null;
    this.runner = new AgentRunner({ ...options, emit: event => this.event(event) });
  }
  mount() {
    if (this.root) return;
    const root = this.root = create('section', 'global-agent'); root.dataset.globalAgent = ''; root.setAttribute('aria-label', '应用助手');
    root.setAttribute('role', 'region'); root.hidden = true; root.dataset.view = 'chat'; root.dataset.state = 'idle';
    const head = this.head = create('header', 'agent-head pane-header'), grip = this.dragHandle = create('span', 'agent-handle'); head.append(grip);
    const title = create('strong', 'pane-title', '应用助手'); title.prepend(makeIcon('agent'));
    this.status = create('span', 'agent-status', '随时为你操作');
    // Streaming has a single live status rather than announcing every token.
    this.status.setAttribute('role', 'status'); this.status.setAttribute('aria-live', 'polite');
    const identity = create('div', 'agent-identity'); identity.append(title, this.status);
    const tools = this.tools = create('div', 'agent-tools');
    this.dockButton = this.action('收为功能区', () => this.setMode(this.mode === 'pane' ? 'floating' : 'pane'), 'agent-tool');
    tools.append(this.action('新对话', () => this.newConversation(), 'agent-tool'), this.action('历史', () => this.showHistory(), 'agent-tool'), this.dockButton,
      this.action('设置', () => this.settings(), 'agent-tool'), this.action('收起', () => this.hide(), 'agent-tool minimise'));
    head.append(identity, tools);
    this.log = create('div', 'agent-log'); this.log.setAttribute('aria-label', '对话与操作记录');
    this.composer = create('div', 'agent-composer');
    this.input = create('textarea'); this.input.placeholder = '说说你想做什么…'; this.input.rows = 1; this.input.setAttribute('aria-label', '给应用助手的指令');
    this.sendButton = this.action('发送', () => this.submit(), 'primary agent-send'); this.stopButton = this.action('停止', () => this.stop(), 'agent-stop'); this.stopButton.hidden = true;
    const bar = create('div', 'agent-composer-bar');
    bar.append(create('span', 'agent-footnote', 'Enter 发送 · Shift + Enter 换行'), this.sendButton, this.stopButton);
    this.composer.append(this.input, bar);
    this.composer.addEventListener('pointerdown', event => { if (event.target === this.composer || event.target === bar) { event.preventDefault(); this.input.focus({ preventScroll: true }); } });
    root.append(head, this.log, this.composer);
    this.input.addEventListener('input', () => this.fitInput());
    this.input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); this.submit(); }
      else if (event.key === 'Escape' && this.runner.running && !event.isComposing) { event.preventDefault(); this.stop(); }
    });
    root.addEventListener('keydown', e => e.stopPropagation());
    // Only the log scrolls; WebKit focus/anchoring must not scroll the outer window.
    root.addEventListener('scroll', () => { if (root.scrollTop || root.scrollLeft) { root.scrollTop = 0; root.scrollLeft = 0; } }, { passive: true });
    this.bubble = this.action('应用助手', () => this.show(), 'agent-bubble'); this.bubble.dataset.globalAgent = ''; this.bubble.hidden = true;
    document.body.append(root, this.bubble);
    this.floatingControl = new FloatingPaneController({ root, handle: grip, enabled: () => this.mode !== 'pane' && !root.hidden, onChange: () => this.rememberGeometry() });
    this.resizeObserver = new ResizeObserver(() => this.rememberGeometry()); this.resizeObserver.observe(root);
    window.addEventListener('resize', () => { this.clamp(); this.rememberGeometry(); });
    this.empty();
  }
  fitInput() { this.input.style.height = 'auto'; this.input.style.height = Math.min(140, Math.max(22, this.input.scrollHeight)) + 'px'; }
  labelAction(node, label) {
    const icons = { '清空记录': 'trash', '删除这段对话': 'close', '设置': 'settings', '收起': 'minus', '新对话': 'plus', '历史': 'history', '收为功能区': 'layout', '浮动显示': 'expand', '发送': 'send', '停止': 'stop', '应用助手': 'agent', '返回对话': 'back', '完成': 'check', '保存个人密钥': 'key', '更换个人密钥': 'key', '保存到本机': 'check', '保存 OCR 密钥': 'check' };
    node.replaceChildren(); if (icons[label]) node.append(makeIcon(icons[label]));
    node.append(create('span', 'agent-action-label', label)); node.title = label; node.setAttribute('aria-label', label);
  }
  action(label, fn, cls = '') { const n = create('button', cls); n.type = 'button'; this.labelAction(n, label); n.addEventListener('click', e => { e.stopPropagation(); Promise.resolve().then(fn).catch(error => this.notice(error.message, 'error')); }); return n; }
  async ensureOwner() {
    const owner = this.options.owner(); if (this.loadedOwner === owner) return;
    this.reset(); this.loadedOwner = owner; const generation = this.generation;
    const stored = await this.options.read('chats-agent.json', true);
    if (generation !== this.generation || owner !== this.options.owner()) return;
    this.messages = Array.isArray(stored?.conversations) ? stored.conversations.filter(c => c && typeof c.id === 'string' && Array.isArray(c.turns)).slice(-20) : [];
    const current = this.messages.find(c => c.id === stored?.current) || this.messages.at(-1);
    this.currentId = current?.id || conversationId(); this.history = (current?.turns || []).filter(t => ['user', 'assistant'].includes(t.role) && typeof t.content === 'string').slice(-100);
    const display = await this.options.read('agent-display.json');
    if (generation !== this.generation || owner !== this.options.owner()) return;
    this.savedGeometry = display?.geometry; this.preferredMode = display?.mode === 'pane' ? 'pane' : 'floating';
    this.renderHistory(); this.clamp();
  }
  async show() {
    this.mount(); await this.ensureOwner(); const generation = this.generation; await this.options.ready(); if (generation !== this.generation) return; this.root.hidden = false; this.seen();
    if (this.preferredMode === 'pane' && this.options.canDock()) await this.setMode('pane');
    else if (this.mode !== 'pane') this.options.detach(this.root);
    this.clamp(); this.input.focus({ preventScroll: true });
  }
  hide() { if (!this.root) return; this.floatingControl?.clear(); this.options.undock(); this.mode = 'floating'; this.root.dataset.mode = 'floating'; document.body.append(this.root); this.root.hidden = true; this.updateBubble(); }
  // Minimised, the assistant stays out of the way: it only surfaces while a task runs or its result is unread.
  updateBubble() {
    if (!this.bubble) return;
    const away = !this.root || this.root.hidden, running = this.runner.running, steps = this.progress?.steps.length || 0;
    this.bubble.hidden = !(away && (running || this.unseen));
    if (this.bubble.hidden) return;
    const text = running ? '正在执行' + (steps ? ' · ' + steps + ' 步' : '') : this.unseen === 'failed' ? '任务未完成 · 查看' : '已完成 · 查看结果';
    this.bubble.dataset.state = running ? 'running' : this.unseen;
    this.bubble.replaceChildren(running ? create('span', 'agent-spinner') : makeIcon(this.unseen === 'failed' ? 'close' : 'check'), create('span', 'agent-action-label', text));
    this.bubble.title = '应用助手 · ' + text; this.bubble.setAttribute('aria-label', '应用助手 · ' + text);
  }
  seen() { this.unseen = ''; if (this.bubble) this.bubble.hidden = true; }
  toggle() { return !this.root || this.root.hidden ? this.show() : this.hide(); }
  async setMode(mode) {
    this.mount(); if (mode === 'pane' && !this.options.canDock()) { this.notice('进入学习后可以收为功能区'); return; }
    this.floatingControl?.clear(); this.root.hidden = false; this.seen(); this.preferredMode = mode; this.mode = mode; this.root.dataset.mode = mode;
    if (mode === 'pane') this.options.dock(this.root); else { this.options.undock(); this.options.detach(this.root); this.clamp(); }
    this.labelAction(this.dockButton, mode === 'pane' ? '浮动显示' : '收为功能区');
    await this.persistDisplay();
  }
  routeChanged() {
    if (!this.root || this.root.hidden) return;
    if (this.preferredMode === 'pane' && this.options.canDock()) { this.floatingControl?.clear(); this.mode = 'pane'; this.root.dataset.mode = 'pane'; this.options.dock(this.root); this.labelAction(this.dockButton, '浮动显示'); }
  }
  leavePane() {
    if (!this.root || this.mode !== 'pane') return;
    document.body.append(this.root); this.mode = 'floating'; this.root.dataset.mode = 'floating'; this.labelAction(this.dockButton, '收为功能区'); this.clamp();
  }
  clamp() {
    if (!this.root || this.mode === 'pane') return;
    const geo = this.savedGeometry || {}, width = Number(geo.width) || 400, height = Number(geo.height) || 560;
    const rect = floatingPaneBounds({ width, height, left: Number.isFinite(geo.left) ? geo.left : window.innerWidth - width - 20, top: Number.isFinite(geo.top) ? geo.top : 64 }, window.innerWidth, window.innerHeight);
    this.floatingControl.apply(rect);
  }
  rememberGeometry() {
    if (!this.root || this.root.hidden || this.mode === 'pane') return;
    const box = this.root.getBoundingClientRect(); if (!box.width) return;
    this.savedGeometry = { left: box.left, top: box.top, width: box.width, height: box.height };
    clearTimeout(this.geometryTimer); this.geometryTimer = setTimeout(() => this.persistDisplay().catch(() => {}), 250);
  }
  persistDisplay() { return this.options.write('agent-display.json', { mode: this.preferredMode || 'floating', geometry: this.savedGeometry }); }

  /* ---------- Conversation ---------- */
  empty() {
    this.root.dataset.view = 'chat'; this.turn = null;
    const welcome = create('div', 'agent-welcome'), mark = create('div', 'agent-welcome-mark'); mark.append(makeIcon('agent'));
    welcome.append(mark, create('div', 'agent-empty', '有什么可以帮你？'), create('p', 'agent-empty-detail', '我可以直接操作这个应用：查找并打开课程、整理笔记、调整布局、下载资料。说出你想做的事就好。'));
    this.log.replaceChildren(welcome);
  }
  renderHistory() { this.root.dataset.view = 'chat'; this.turn = null; if (!this.history.length) return this.empty(); this.log.replaceChildren(); for (const turn of this.history) this.addTurn(turn.role, turn.content, turn.activity); this.turn = null; this.scroll(); }
  clearWelcome() { if (this.log.querySelector('.agent-welcome') || this.root.dataset.view !== 'chat') { this.log.replaceChildren(); this.root.dataset.view = 'chat'; } }
  addTurn(role, text = '', activity = null) {
    this.clearWelcome();
    const n = create('div', 'agent-turn ' + role), message = create('div', 'agent-message');
    if (role === 'assistant') {
      if (activity?.steps?.length) n.append(this.makeProgress(activity.steps, activity.status || '已完成', activity.ms).node);
      this.format(message, text);
    } else message.textContent = text;
    n.append(message); this.log.append(n);
    if (role === 'assistant') this.turn = n;
    return message;
  }
  // Text-only Markdown: paragraphs, lists, headings, bold and code. No model HTML, links or images.
  format(node, text) {
    node.replaceChildren(); node.classList.remove('streaming');
    const inline = (parent, value) => {
      const pattern = /(\*\*([^*]+)\*\*|`([^`]+)`)/g; let at = 0, match;
      while ((match = pattern.exec(value))) { parent.append(document.createTextNode(value.slice(at, match.index))); parent.append(create(match[2] ? 'strong' : 'code', '', match[2] || match[3])); at = pattern.lastIndex; }
      parent.append(document.createTextNode(value.slice(at)));
    };
    let list = null, paragraph = null;
    for (const raw of String(text).replace(/\r\n?/g, '\n').split('\n')) {
      const line = raw.trimEnd(), bullet = /^\s*[-*•]\s+(.*)$/.exec(line), ordered = /^\s*(\d{1,3})[.)、]\s+(.*)$/.exec(line), heading = /^\s*#{1,4}\s+(.*)$/.exec(line);
      if (!line.trim()) { list = null; paragraph = null; continue; }
      if (bullet || ordered) {
        const tag = bullet ? 'UL' : 'OL';
        if (!list || list.tagName !== tag) { list = create(tag.toLowerCase()); if (ordered && ordered[1] !== '1') list.start = Number(ordered[1]); node.append(list); }
        paragraph = null; const item = create('li'); inline(item, bullet ? bullet[1] : ordered[2]); list.append(item); continue;
      }
      list = null;
      if (heading) { paragraph = null; const h = create('p', 'agent-heading'); inline(h, heading[1]); node.append(h); continue; }
      if (paragraph) paragraph.append(document.createTextNode('\n')); else { paragraph = create('p'); node.append(paragraph); }
      inline(paragraph, line);
    }
  }
  scroll() { this.log.scrollTop = this.log.scrollHeight; }
  notice(text, kind = '') {
    text = userMessage(text);
    if (!this.log) this.mount();
    if (this.root.dataset.view === 'chat') this.clearWelcome();
    const n = create('div', 'agent-notice' + (kind ? ' ' + kind : '')); if (kind === 'error') n.append(makeIcon('close')); else if (kind === 'info') n.append(makeIcon('info')); n.append(create('span', '', text));
    this.log.append(n); this.scroll(); return n;
  }

  /* ---------- Activity: one live status line, expandable steps ---------- */
  makeProgress(steps = [], status = '', ms = 0) {
    const node = create('details', 'agent-progress'), summary = create('summary'), mark = create('span', 'agent-progress-mark'), label = create('span', 'agent-progress-label'),
      meta = create('span', 'agent-progress-meta'), chevron = create('span', 'agent-progress-chevron'), items = create('div', 'agent-progress-items');
    mark.setAttribute('aria-hidden', 'true'); chevron.setAttribute('aria-hidden', 'true'); chevron.append(makeIcon('next'));
    summary.append(mark, label, meta, chevron); node.append(summary, items);
    const progress = { node, summary, mark, label, meta, items, steps: [], started: Date.now() };
    for (const step of steps.slice(-120)) {
      const safe = { label: clip(step.label || '操作', 100), detail: clip(step.detail, 60), result: clip(step.result, 40), ok: step.ok !== false, error: (step.error ? userMessage(step.error) : '').slice(0, 200), ms: Number(step.ms) || 0 };
      progress.steps.push(safe); items.append(this.stepRow(safe));
    }
    if (status) this.settle(progress, status, ms); else { node.dataset.state = 'running'; label.textContent = '正在理解任务…'; mark.append(create('span', 'agent-spinner')); }
    return progress;
  }
  stepRow(step, running = false) {
    const row = create('div', 'agent-step'), mark = create('span', 'agent-step-mark'), body = create('span', 'agent-step-body');
    body.append(create('span', 'agent-step-label', step.label));
    if (step.detail) body.append(create('span', 'agent-step-detail', step.detail));
    row.append(mark, body);
    if (running) { row.dataset.state = 'running'; mark.append(create('span', 'agent-spinner')); return row; }
    row.dataset.ok = String(step.ok !== false); mark.append(makeIcon(step.ok !== false ? 'check' : 'close'));
    const tail = create('span', 'agent-step-tail'); if (step.result) tail.append(create('span', 'agent-step-result', step.result)); if (step.ms >= 1000) tail.append(create('span', 'agent-step-time', duration(step.ms)));
    if (tail.childNodes.length) row.append(tail);
    if (step.error) row.append(create('span', 'agent-step-error', step.error));
    return row;
  }
  settle(progress, status, ms = 0) {
    const failures = progress.steps.filter(s => !s.ok).length, state = status === '已完成' ? 'done' : status === '已停止' ? 'stopped' : 'failed';
    progress.node.dataset.state = state; progress.node.open = false;
    progress.mark.replaceChildren(makeIcon(state === 'done' ? 'check' : state === 'stopped' ? 'stop' : 'close'));
    progress.label.textContent = status;
    progress.meta.textContent = [progress.steps.length + ' 步', failures ? failures + ' 项未成功' : '', ms >= 1000 ? duration(ms) : ''].filter(Boolean).join(' · ');
  }
  live(text) { if (this.progress) this.progress.label.textContent = clip(text, 80) || '正在处理…'; }
  tick() { if (!this.progress || this.progress.node.dataset.state !== 'running') return; const n = this.progress.steps.length; this.progress.meta.textContent = (n ? n + ' 步 · ' : '') + duration(Date.now() - this.progress.started).replace(/\.\d/, ''); }
  startProgress() {
    this.clearWelcome(); this.stopClock();
    this.turn = create('div', 'agent-turn assistant'); this.progress = this.makeProgress(); this.turn.append(this.progress.node); this.log.append(this.turn);
    this.draft = ''; this.reply = null; this.tick(); this.clockTimer = setInterval(() => this.tick(), 1000);
  }
  stopClock() { clearInterval(this.clockTimer); this.clockTimer = 0; }
  finishProgress(status = '已完成') {
    this.stopClock(); if (!this.progress) return; const p = this.progress;
    // A step interrupted by stop or failure is shown as not completed.
    if (this.currentStep) { const step = this.currentStep; step.ok = false; step.ms = Date.now() - (step.started || Date.now()); delete step.started; this.stepNode?.replaceWith(this.stepRow(step)); this.currentStep = null; this.stepNode = null; }
    p.ms = Date.now() - p.started; this.settle(p, status, p.ms); if (!p.steps.length) p.node.remove();
  }
  activity(status = '已完成') { return this.progress?.steps.length ? { status, ms: this.progress.ms || Date.now() - this.progress.started, steps: this.progress.steps.map(({ label, detail, result, ok, error, ms }) => ({ label, detail, result, ok, error, ms })) } : undefined; }
  stepLabel(action) {
    const schema = this.options.registry?.actions.get(action);
    return STEP_LABELS[action] || (schema?.description.split('。')[0] || '执行操作').slice(0, 36);
  }
  stepDetail(action, args) {
    if (!args || typeof args !== 'object') return '';
    try {
      const title = key => typeof key === 'string' ? clip(this.options.describeKey?.(key) || '', 30) : '';
      switch (action) {
        case 'app_actions': return args.search ? '“' + clip(args.search, 20) + '”' : Array.isArray(args.names) ? clip(args.names.map(n => STEP_LABELS[n] || n).join('、'), 30) : '';
        case 'navigate': return PAGES[args.page] || '';
        case 'list_lessons': case 'list_courses': case 'search_courses': return [args.query && '“' + clip(args.query, 18) + '”', args.date].filter(Boolean).join(' · ');
        case 'open_lesson': return [title(args.key), Number.isFinite(args.at) ? clock(args.at) : ''].filter(Boolean).join(' · ');
        case 'read_material': case 'download_lesson': case 'course_lessons': return title(args.key) || '';
        case 'search_material': return ['“' + clip(args.query, 18) + '”', args.course ? clip(args.course, 12) : title(args.key)].filter(Boolean).join(' · ');
        case 'set_collection': return [title(args.key), WORDS[args.kind], args.selected === false ? '取消' : ''].filter(Boolean).join(' · ');
        case 'read_lesson': return Number.isFinite(args.from) ? clock(args.from) + (Number.isFinite(args.to) && args.to < 1e9 ? '–' + clock(args.to) : ' 起') : '';
        case 'seek': return clock(args.seconds);
        case 'slide_page': case 'note_insert_slide': return '第 ' + args.page + ' 页';
        case 'read_slides': return Array.isArray(args.pages) ? '第 ' + args.pages.join('、') + ' 页' : '';
        case 'set_pane': return (PANES[args.pane] || '') + (args.open === false ? ' · 关闭' : ' · 打开');
        case 'set_study_option': return [WORDS[args.option], args.option === 'count' ? args.value + ' 页' : args.value ? '开' : '关'].filter(Boolean).join(' · ');
        case 'show_learning_tool': return WORDS[args.tool] || '';
        case 'video_control': return args.command === 'speed' ? args.rate + '×' : WORDS[args.command] || '';
        case 'note_create': case 'note_rename': return clip(args.name, 24);
        case 'note_write': return (WORDS[args.mode] || '插入') + ' ' + String(args.text || '').length + ' 字';
        case 'note_insert_transcript': return clock(args.from) + '–' + clock(args.to);
        case 'layout': case 'download_control': case 'summary_control': return WORDS[args.command] || '';
        case 'wait_for': return WORDS[args.condition] || '';
        case 'assistant_history': return { list: '查看', clear: '全部清空', delete: '删除一段' }[args.command] || '';
        case 'cache_clear': return args.category === 'all' ? '全部' : ({ schedule: '课表', timeline: '时间线', vision: '课件识别', summary: '速览', question: 'AI 对话', skip: '无效片段', images: '课件图片' })[args.category] || '';
        case 'collection_clear': return WORDS[args.kind] || '';
        case 'notes_read': return title(args.key) || '';
        case 'notes_edit': return [title(args.key), { append: '追加', create: '新建', replace: '替换', rename: '改名' }[args.mode], args.text ? String(args.text).length + ' 字' : args.name ? clip(args.name, 16) : ''].filter(Boolean).join(' · ');
        case 'ui': return [WORDS[args.operation] || '', '“' + clip(args.label, 18) + '”'].filter(Boolean).join(' ');
        case 'interface_action': return WORDS[args.operation] || '';
        case 'set_theme': return [args.theme ? themeFor(args.theme).name : '', { system: '跟随系统', light: '浅色', dark: '深色' }[args.mode] || ''].filter(Boolean).join(' · ') || (args.list ? '查看全部' : '');
        case 'set_ai_provider': return WORDS[args.provider] || (args.provider === 'auto' ? '自动' : '');
        default: return '';
      }
    } catch { return ''; }
  }
  stepResult(action, output) {
    if (!output || typeof output !== 'object') return '';
    const count = (n, unit) => Number.isFinite(n) ? n + ' ' + unit : '';
    switch (action) {
      case 'app_actions': return count(output.total, '项');
      case 'app_interface': return count(output.controls?.length, '个控件');
      case 'list_lessons': case 'course_lessons': return count(output.total, '节');
      case 'list_courses': case 'search_courses': return count(output.total, '门');
      case 'read_lesson': case 'read_material': return count(output.lines?.length, '句');
      case 'search_material': return output.found ? output.lessons.length + ' 节 · ' + output.found + ' 处' : output.next != null ? '暂未找到' : '未找到';
      case 'read_slides': return Array.isArray(output) ? count(output.length, '页') : '';
      case 'notes_list': case 'notes_read': return Array.isArray(output) ? count(output.length, '篇') : '';
      case 'notes_index': return Array.isArray(output) ? count(output.length, '节') : '';
      case 'assistant_history': return output.cleared ? '已清空' : Array.isArray(output.conversations) ? count(output.conversations.length, '段') : output.deleted ? '已删除' : '';
      case 'cache_clear': case 'collection_clear': return '已清理';
      case 'download_queue': return count(output.total, '项');
      case 'wait_for': return output.ready ? '已就绪' : '仍在加载';
      default: return '';
    }
  }
  event(event) {
    if (event.type === 'turn') {
      if (!this.progress) this.startProgress();
      this.draft = ''; if (this.progress.steps.length) this.live('正在思考下一步…');
    } else if (event.type === 'delta') {
      if (!this.progress) this.startProgress();
      this.draft = (this.draft || '') + event.text;
      // Text written between actions is the model talking to itself, so it never reaches the log.
      // Only a direct answer (no action taken yet) streams; anything else waits for the final reply.
      if (this.progress.steps.length) { if (this.draft.length > 120) this.live('正在整理回答…'); return; }
      if (!this.reply && (this.draft.length > 80 || /\n/.test(this.draft.trim()))) { this.reply = this.ensureMessage(); this.reply.classList.add('streaming'); this.live('正在回复…'); }
      if (this.reply) this.renderDraft(); else if (this.draft.trim()) this.live('正在思考…');
    } else if (event.type === 'step') {
      // A reply that turned out to be a preface to an action is withdrawn.
      if (this.reply) { window.cancelAnimationFrame(this.draftFrame); this.draftFrame = 0; this.reply.remove(); this.reply = null; }
      this.draft = ''; if (!this.progress) this.startProgress();
      const label = this.stepLabel(event.action), detail = this.stepDetail(event.action, event.args);
      this.currentStep = { label, detail: clip(detail, 60), started: Date.now() }; this.progress.steps.push(this.currentStep);
      this.stepNode = this.stepRow(this.currentStep, true); this.progress.items.append(this.stepNode);
      if (this.progress.node.open) this.progress.items.scrollTop = this.progress.items.scrollHeight;
      this.live(label + (detail ? ' · ' + detail : '')); this.status.textContent = '正在执行'; this.tick(); this.updateBubble();
    } else if (event.type === 'retry') {
      // The first attempt of this round is discarded; anything it streamed is withdrawn.
      if (this.reply) { window.cancelAnimationFrame(this.draftFrame); this.draftFrame = 0; this.reply.remove(); this.reply = null; }
      this.draft = ''; if (!this.progress) this.startProgress(); this.live('网络较慢，正在重试…');
    } else if (event.type === 'result' && this.currentStep) {
      const step = this.currentStep; Object.assign(step, { ok: event.ok !== false, error: clip(event.error ? userMessage(event.error) : '', 200), result: event.ok === false ? '' : clip(this.stepResult(event.action, event.output), 40), ms: Date.now() - step.started });
      delete step.started; this.stepNode?.replaceWith(this.stepRow(step)); this.stepNode = null; this.currentStep = null;
    } else if (event.type === 'done') {
      window.cancelAnimationFrame(this.draftFrame); this.draftFrame = 0; this.finishProgress();
      if (event.text) { const arrived = !this.reply; if (!this.reply) this.reply = this.ensureMessage(); this.format(this.reply, event.text); if (arrived) this.reply.classList.add('arrived'); }
      this.status.textContent = '已完成'; this.scheduleScroll();
    }
  }
  // Streamed answers are formatted once per frame so Markdown never shows as raw symbols.
  renderDraft() {
    if (this.draftFrame) return;
    this.draftFrame = window.requestAnimationFrame(() => { this.draftFrame = 0; if (!this.reply?.isConnected) return; this.format(this.reply, this.draft); this.reply.classList.add('streaming'); this.scheduleScroll(); });
  }
  ensureMessage() { if (!this.turn) { this.clearWelcome(); this.turn = create('div', 'agent-turn assistant'); this.log.append(this.turn); } const message = create('div', 'agent-message'); this.turn.append(message); return message; }
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
    if (this.root.dataset.view !== 'chat') this.renderHistory();
    this.input.value = ''; this.fitInput(); this.runningTurn = this.addTurn('user', text).parentElement; this.history.push({ role: 'user', content: text }); this.reply = null;
    this.progress = null; this.startProgress(); this.busy(true); this.status.textContent = '正在处理'; this.scroll();
    try { const answer = await this.runner.run(text, history); if (generation === this.generation) this.history.push({ role: 'assistant', content: answer, activity: this.activity() }); }
    catch (error) { if (generation === this.generation) { this.finishProgress('未完成'); this.notice(error.message, 'error'); this.history.push({ role: 'assistant', content: '任务未完成：' + userMessage(error) + this.completedSteps(), activity: this.activity('未完成') }); this.status.textContent = '未完成'; } }
    finally { if (generation === this.generation) { if (this.root.hidden) this.unseen = this.status.textContent === '未完成' ? 'failed' : 'done'; this.busy(false); await this.persist(); } }
  }
  // Written into the conversation so that “继续” resumes instead of repeating what already succeeded.
  completedSteps() { const done = (this.progress?.steps || []).filter(s => s.ok && !/^(查看当前状态|查找可用操作|读取界面)$/.test(s.label)); return done.length ? '。已完成的操作：' + done.map(s => s.label + (s.detail ? '（' + s.detail + '）' : '')).join('、') : '。尚未完成任何操作'; }
  busy(value) { this.sendButton.hidden = value; this.stopButton.hidden = !value; this.input.readOnly = value; this.root.dataset.state = value ? 'running' : 'idle'; this.updateBubble(); }
  stop() { this.finishProgress('已停止'); this.runner.stop(); this.generation++; this.busy(false); this.status.textContent = '已停止'; this.notice('已停止后续操作；已完成的操作会保留。'); this.history.push({ role: 'assistant', content: '用户停止了任务' + this.completedSteps(), activity: this.activity('已停止') }); this.persist().catch(() => {}); }
  async persist() {
    if (this.loadedOwner !== this.options.owner()) return;
    // A conversation exists in history only once something was said in it.
    const entry = { id: this.currentId, updatedAt: Date.now(), turns: this.history.slice(-100) };
    this.messages = this.messages.filter(c => c.id !== entry.id && c.turns.length).concat(entry.turns.length ? [entry] : []).slice(-20);
    return this.options.write('chats-agent.json', { current: this.currentId, conversations: this.messages }, true);
  }
  async newConversation() { if (this.runner.running) this.stop(); await this.persist(); this.currentId = conversationId(); this.history = []; this.reply = null; this.progress = null; this.empty(); this.status.textContent = '随时为你操作'; await this.persist(); this.input.focus({ preventScroll: true }); }
  subhead(title) {
    const bar = create('div', 'agent-subhead'); bar.append(this.action('返回对话', () => this.renderHistory(), 'agent-back'), create('h3', '', title)); return bar;
  }
  showHistory() {
    if (this.runner.running) { this.notice('请先停止当前任务'); return; }
    this.root.dataset.view = 'history';
    const head = this.subhead('历史对话');
    if (this.messages.length) head.append(this.action('清空记录', () => this.clearHistory(), 'agent-clear'));
    this.log.replaceChildren(head);
    const list = create('div', 'agent-history');
    const when = time => { if (!time) return ''; const d = new Date(time); return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
    for (const c of [...this.messages].reverse()) {
      const first = c.turns.find(t => t.role === 'user')?.content || '新对话', last = [...c.turns].reverse().find(t => t.role === 'assistant')?.content || '';
      const item = create('div', 'agent-history-item'), open = create('button', 'agent-history-open'); open.type = 'button';
      open.append(create('span', 'agent-history-title', clip(first, 80)), create('span', 'agent-history-preview', clip(last.replace(/[*`#>-]/g, ''), 90)), create('span', 'agent-history-meta', [Math.ceil(c.turns.length / 2) + ' 轮', when(c.updatedAt)].filter(Boolean).join(' · ')));
      if (c.id === this.currentId) item.dataset.current = 'true';
      open.addEventListener('click', e => { e.stopPropagation(); Promise.resolve().then(async () => { await this.persist(); this.currentId = c.id; this.history = c.turns.slice(); this.renderHistory(); }).catch(error => this.notice(error.message, 'error')); });
      item.append(open, this.action('删除这段对话', () => this.deleteConversation(c.id), 'agent-history-delete'));
      list.append(item);
    }
    if (!list.children.length) list.append(create('p', 'agent-history-empty', '还没有历史对话'));
    this.log.append(list); this.log.scrollTop = 0;
  }
  async deleteConversation(id, { ask = true } = {}) {
    const c = this.messages.find(m => m.id === id); if (!c) return false;
    if (ask && !confirm('删除这段对话？此操作不能撤销。')) return false;
    this.messages = this.messages.filter(m => m.id !== id);
    if (id === this.currentId && !this.runner.running) { this.currentId = conversationId(); this.history = []; }
    await this.options.write('chats-agent.json', { current: this.currentId, conversations: this.messages }, true);
    if (this.root?.dataset.view === 'history') this.showHistory(); return true;
  }
  // Clears every saved conversation without leaving the current view. A task that is
  // running keeps only its own request so its result still has somewhere to land.
  async clearHistory({ ask = true } = {}) {
    if (ask && !confirm('清空全部应用助手对话？此操作不能撤销。')) return false;
    const running = this.runner.running && this.runningTurn?.isConnected;
    this.messages = []; this.currentId = conversationId();
    if (running) {
      this.history = this.history.slice(-1);
      while (this.log.firstChild && this.log.firstChild !== this.runningTurn) this.log.firstChild.remove();
    } else { this.history = []; this.reply = null; this.progress = null; if (this.root) { this.empty(); this.status.textContent = '随时为你操作'; } }
    await this.options.write('chats-agent.json', { current: this.currentId, conversations: [] }, true);
    return true;
  }
  listConversations() { return [...this.messages].reverse().map(c => ({ id: c.id, title: clip(c.turns.find(t => t.role === 'user')?.content || '新对话', 60), turns: c.turns.length, updatedAt: c.updatedAt })); }
  async settings() {
    if (this.runner.running) { this.notice('请先停止当前任务再修改设置'); return; }
    const generation = this.generation; await this.options.ready(); if (generation !== this.generation) return;
    const status = this.options.providerStatus() || {}, personalReady = !!status.personalReady;
    this.root.dataset.view = 'settings';
    const intro = create('div', 'agent-settings-intro'); intro.append(create('p', '', '应用助手、课程问答与本页速览共用这些设置。'));
    this.log.replaceChildren(this.subhead('AI 设置'), intro);
    const field = (name, control, help = '') => {
      const item = create('label', 'agent-field'); item.append(create('span', 'agent-field-label', name), control);
      if (help) item.append(create('span', 'agent-field-help', help)); return item;
    };
    const section = title => { const n = create('section', 'agent-settings-group'); n.append(create('h4', '', title)); return n; };
    const connection = section('连接与模型'), source = create('select'); source.setAttribute('aria-label', 'AI服务来源');
    for (const [value, text] of [['auto', '自动 · 优先个人 API'], ['campus', '浙大校内网关'], ['personal', '个人 DeepSeek API'], ['local', '本地 Gemma']]) { const option = create('option', '', text); option.value = value; source.append(option); }
    source.value = this.options.provider();
    const sourceHint = create('p', 'agent-provider-hint');
    const describe = () => { const description = this.options.providerDescription(); sourceHint.textContent = description + (description.includes('校内') ? '。课件先经 OCR 转为文字，图示关系可能遗漏。' : ''); }; describe();
    source.onchange = () => this.options.setProvider(source.value).then(() => { describe(); modelField.hidden = ['campus','local'].includes(source.value) || (source.value === 'auto' && !personalReady); effortField.hidden = modelField.hidden; }).catch(error => this.notice(error.message, 'error'));
    const model = create('select'); model.setAttribute('aria-label', '助手模型');
    for (const [value, text] of [['deepseek-flash', 'DeepSeek Flash'], ['deepseek-v4-pro', 'DeepSeek Pro']]) { const option = create('option', '', text); option.value = value; model.append(option); }
    model.value = this.options.model(); model.onchange = () => this.options.setModel(model.value);
    const modelField = field('个人 API 模型', model, '个人 API 的应用助手支持思考模式；校内网关使用学校指定模型。'); modelField.hidden = ['campus','local'].includes(source.value) || (source.value === 'auto' && !personalReady);
    const effort = create('select'); effort.setAttribute('aria-label', '助手思考强度'); for (const [value, label] of [['low', '快捷'], ['high', '均衡'], ['max', '深入']]) { const option = create('option', '', label); option.value = value; effort.append(option); } effort.value = this.options.effort?.() || 'high'; effort.onchange = () => this.options.setEffort?.(effort.value); const effortField = field('思考强度', effort, '均衡适合日常操作；深入适合复杂任务，耗时和用量可能增加。'); effortField.hidden = modelField.hidden; source.addEventListener('change', () => { effortField.hidden = modelField.hidden; });
    connection.append(field('服务来源', source), sourceHint, modelField, effortField); this.log.append(connection);
    const credentials = section('个人 DeepSeek API'), badge = create('span', 'agent-config-badge', personalReady ? '已配置' : '未配置'); badge.dataset.ready = String(personalReady); credentials.querySelector('h4').append(badge);
    const password = create('input'); password.type = 'password'; password.placeholder = personalReady ? '输入新密钥以更换' : 'sk-…'; password.autocomplete = 'off'; password.setAttribute('aria-label', 'DeepSeek API 密钥');
    credentials.append(field('API 密钥', password, '密钥仅保存在本机，输入后即可使用。'), this.action(personalReady ? '更换个人密钥' : '保存个人密钥', async () => { const key = password.value.trim(); if (!/^sk-[A-Za-z0-9_-]{16,200}$/.test(key)) throw new Error('请输入有效的 API 密钥'); await this.options.setKey(key); password.value = ''; this.renderHistory(); this.notice('已改用个人 API'); }, 'primary'));
    this.log.append(credentials);
    const advanced = create('details', 'agent-gateway-config'), heading = create('summary', '', '本机校园服务');
    const campus = create('input'); campus.type = 'password'; campus.autocomplete = 'off'; campus.placeholder = status.campusReady ? '已配置 · 输入新密钥以更换' : '校园网关密钥'; campus.setAttribute('aria-label', '校园网关密钥');
    advanced.append(heading, create('p', 'agent-notice', '这是校内 AI，需要连接浙江大学校园网，效果可能不佳。想获得更佳效果，请在 API 设置中添加自己的 DeepSeek API。校内课件通过 OCR 提取文字，图示关系、公式或表格可能识别不完整。校内服务使用期限截至 2026 年 11 月 1 日，到期后可配置个人 DeepSeek API。'), field('模型网关密钥', campus), this.action('保存到本机', async () => { const key = campus.value.trim(); if (!/^[A-Za-z0-9_-]{16,256}$/.test(key)) throw new Error('校园网关密钥格式无效'); await this.options.setCampusKey(key); campus.value = ''; this.renderHistory(); this.notice('校园网关已在本机预置。仅在浙大内网环境下可用。'); }));
    const ocr = create('input'); ocr.type = 'password'; ocr.autocomplete = 'off'; ocr.placeholder = status.campusOCRReady ? '已配置 · 输入新密钥以更换' : '校园 OCR 密钥'; ocr.setAttribute('aria-label', '校园 OCR 密钥');
    advanced.append(field('课件 OCR 密钥', ocr, '识别文字、公式与版面；图表关系、模糊内容可能识别不完整。'), this.action('保存 OCR 密钥', async () => { const key = ocr.value.trim(); if (!/^[A-Za-z0-9_-]{16,256}$/.test(key)) throw new Error('OCR 密钥格式无效'); await this.options.setCampusOCRKey(key); ocr.value = ''; this.renderHistory(); this.notice('校园 OCR 已在本机预置'); }));
    const footer = create('div', 'agent-settings-footer'); footer.append(this.action('完成', () => this.renderHistory(), 'primary'));
    this.log.append(advanced, create('p', 'agent-privacy-note', '只在你发起任务时，向所选服务发送完成任务所需的资料。'), footer); this.log.scrollTop = 0; this.root.scrollTop = 0;
  }
  reset() {
    this.floatingControl?.clear(); this.runner.stop(); this.stopClock(); this.generation++; clearTimeout(this.geometryTimer); this.history = []; this.messages = []; this.currentId = conversationId(); this.loadedOwner = null; this.savedGeometry = null; this.progress = null; this.reply = null; this.turn = null; this.preferredMode = 'floating';
    if (this.root) { this.leavePane(); this.options.undock(); this.root.hidden = true; this.busy(false); this.seen(); this.empty(); }
  }
}
