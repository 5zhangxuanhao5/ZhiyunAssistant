import { ReturnAction } from './ReturnAction';
import { questionScope } from '../model/QuestionScope';
import { NativeSelections } from '../model/NativeSelections';
import { SelectionKeys } from '../model/SelectionKeys';
import { pasteboard } from '@kit.BasicServicesKit';
import { CourseAnswerPart, courseAnswerParts } from '../model/CourseReference';
import { AnswerText } from './AnswerText';
import { NoteInsertion, NoteContentReference } from '../model/Notes';
import { DropdownLabel } from './DropdownLabel';
import { STUDY_TITLE_SIZE, STUDY_TITLE_COLOR, STUDY_SURFACE, STUDY_RADIUS, STUDY_RETURN_SCROLL_SPACE } from '../model/StudyStyle';
import { physicalDigit } from '../model/KeyboardInput';
import { ApiKeySetup } from './ApiKeySetup';
import { ChatStore, ChatSession } from '../services/ChatStore';
import { KeyCode } from '@kit.InputKit';
import { AnswerPart, answerParts, shouldSubmitOnEnter } from '../model/AiStream';
import { common } from '@kit.AbilityKit';
import { AiClient, ChatTurn } from '../services/AiClient';
import { LocalStore } from '../services/LocalStore';
import { Slide, Transcript, stamp } from '../model/Timeline';
export interface AiContext { slides: Slide[]; lines: Transcript[]; at: number; currentId?: string; selectedIds?: string[] }
@Component
export struct AiPanel {
  @Prop returnVisible: boolean = false;
  onReturn: () => void = () => {};
  onDismissReturn: () => void = () => {};
  @Prop notesOpen: boolean = false;
  @Prop @Watch('referenceChanged') requestedReference: NoteContentReference | undefined = undefined;
  @Prop @Watch('referenceChanged') referenceSequence: number = 0;
  onInsert: (value: NoteInsertion) => void = () => {};
  @Prop selectedCount: number = 0;
  onSelectPages: () => void = () => {};
  @Prop @Watch('courseChanged') courseId: string = '';
  @Prop @Watch('activityChanged') active: boolean = false;
  store: LocalStore | undefined = undefined;
  context: (whole: boolean) => Promise<AiContext> = async () => { return { slides: [], lines: [], at: 0 }; };
  onEditingFocus: (focused: boolean) => void = () => {};
  onClose: () => void = () => {};
  onJump: (seconds: number) => void = () => {};
  @State configured: boolean = false;
  @State settings: boolean = false;
  @State keyInput: string = '';
  @State models: string[] = ['deepseek-flash', 'deepseek-v4-pro'];
  @State model: string = 'deepseek-flash';
  @State question: string = '';
  @State questionWidth: number = 320;
  @State whole: boolean = false;
  @State mode: string = 'auto';
  @State replacing: boolean = false;
  @State sessions: ChatSession[] = [];
  @State sessionId: string = '';
  @State historyOpen: boolean = false;
  @State returnTurn: number = -1;
  onSelecting: (active: boolean) => void = () => {};
  @State draggingAnswer: boolean = false;
  @State selectingAnswer: boolean = false;
  private jumpAnswer(index: number, at: number): void { this.onJump(at); this.returnTurn = index; }
  @State turnSelection: number = -1;
  @State turnSelectionRevision: number = 0;
  private clearTextSelection(): void { this.conversationSelection = 0; this.turnSelection = -1; }
  private questionFocused(): void { this.clearTextSelection(); this.onEditingFocus(true); }
  private questionTouched(event: TouchEvent): void { if (event.type === TouchType.Down) this.onDismissReturn(); event.stopPropagation(); }
  private selectionOwner: string = 'chat-whole-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  private turnHeader(index: number): string { return stamp(this.turns[index].at) + ' · ' + (this.turns[index].whole ? '整节课' : this.turns[index].expanded ? '指定资料' : '此刻之前') + '\n\n'; }
  private turnParts(index: number): CourseAnswerPart[] { const parts: CourseAnswerPart[] = [{ value: this.turnHeader(index), seconds: -1, bold: false, italic: false, code: false }, { value: this.turns[index].question + '\n\n', seconds: -1, bold: true, italic: false, code: false }]; return parts.concat(courseAnswerParts(this.turns[index].complete ? this.turns[index].answer : this.streamingText(this.turns[index].answer), undefined)); }
  private selectTurn(index: number): boolean { if (this.turnSelection === index) { this.conversationSelection++; return true; } this.conversationSelection = 0; this.turnSelection = index; this.turnSelectionRevision++; return true; }
  private copyTurn(index: number): boolean { if (this.copyConversation()) return true; if (this.turnSelection !== index) return false; const turn = this.turns[index]; pasteboard.getSystemPasteboard().setData(pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, turn.question + '\n' + answerParts(turn.answer).map((part: AnswerPart) => part.value).join(''))).catch(() => this.error = '复制未完成，请重试'); return true; }
  @State conversationSelection: number = 0;
  private conversationText(): string { return this.turns.map((turn: ChatTurn) => stamp(turn.at) + ' · ' + turn.question + '\n' + answerParts(turn.answer).map((part: AnswerPart) => part.value).join('')).join('\n\n'); }
  private selectConversation(already: boolean): boolean { if (!already) return false; this.conversationSelection++; return true; }
  private copyConversation(): boolean { if (!this.conversationSelection) return false; pasteboard.getSystemPasteboard().setData(pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, this.conversationText())).catch(() => this.error = '复制未完成，请重试'); return true; }
  private savedAt: number = 0;
  private chats: ChatStore | undefined = undefined;
  @State turns: ChatTurn[] = [];
  @State busy: boolean = false;
  @State progress: string = '';
  @State error: string = '';
  private ai: AiClient = new AiClient();
  private epoch: number = 0;
  private configurationEpoch: number = 0;
  private suppressSubmitUntil: number = 0;
  private questionController: TextAreaController = new TextAreaController();
  private selectionStart: number = 0;
  private selectionEnd: number = 0;
  private controlDown: boolean = false;
  private shiftDown: boolean = false;
  private scroller: Scroller = new Scroller();
  aboutToAppear(): void { NativeSelections.bind(this.selectionOwner, () => this.clearTextSelection(), 'ai'); this.restoreChats(); this.referenceChanged(); this.initialize(); }
  aboutToDisappear(): void { NativeSelections.unbind(this.selectionOwner); this.configurationEpoch++; clearTimeout(this.referenceTimer); this.cancel(); this.keyInput = ''; this.onEditingFocus(false); }
  private courseChanged(): void { this.cancel(); this.restoreChats(); this.question = ''; this.error = ''; }
  private activityChanged(): void { if (!this.active) { this.cancel(); this.keyInput = ''; } else { this.referenceChanged(); if (!this.configured) this.initialize(); } }
  private cancel(): void { this.persistChat(); this.epoch++; this.ai.cancel(); this.busy = false; this.progress = ''; }
  private restoreChats(): void {
    this.conversationSelection = 0; this.turnSelection = -1; this.chats = this.store ? new ChatStore(this.store) : undefined; this.sessions = this.chats?.list() || [];
    const current = this.sessions[0]; this.sessionId = current?.id || ''; this.turns = current?.turns || []; this.historyOpen = false;
  }
  private persistChat(): void {
    if (!this.store || !this.turns.length) return;
    const repository = this.chats; if (!repository) return; if (!this.sessionId) this.sessionId = repository.create().id;
    this.savedAt = Date.now(); repository.save({ id: this.sessionId, title: this.turns[0].question.slice(0, 36), turns: this.turns.slice(), savedAt: this.savedAt }); this.sessions = repository.list();
  }
  private newChat(): void { this.cancel(); this.sessionId = this.chats?.create().id || ''; this.turns = []; this.question = ''; this.error = ''; this.historyOpen = false; }
  private selectChat(session: ChatSession): void { this.cancel(); this.sessionId = session.id; this.turns = session.turns.slice(); this.question = ''; this.historyOpen = false; this.error = ''; }
  @State referencedTurn: number = -1;
  private referenceTimer: number = -1;
  private referenceChanged(): void { const ref = this.requestedReference; if (!ref || ref.kind !== 'question' || ref.courseId !== this.courseId) return; const session = this.chats?.list().find((item: ChatSession) => item.id === ref.sessionId); if (session) { this.selectChat(session); this.settings = false; const turn = Math.max(0, Math.min(this.turns.length - 1, ref.turn || 0)); const epoch = this.epoch; clearTimeout(this.referenceTimer); this.referencedTurn = turn; this.referenceTimer = setTimeout(() => this.referencedTurn = -1, 2000); setTimeout(() => { if (epoch !== this.epoch || !this.active) return; try { const node = this.getUIContext().getComponentUtils().getRectangleById('answer-turn-' + turn); if (node?.localOffset?.y >= 0) this.scroller.scrollTo({ xOffset: 0, yOffset: this.scroller.currentOffset().yOffset + node.localOffset.y }); } catch (_) {} }, 64); } else this.error = '原问答记录已清理，笔记中的引用仍保留'; }
  private async initialize(): Promise<void> {
    const gen = ++this.configurationEpoch, store = this.store;
    const secret = await AiClient.savedKey(); if (gen !== this.configurationEpoch || store !== this.store) return; this.configured = !!secret;
    try { const stored = this.store?.readJson('ai-model.txt'); if (stored) this.model = stored; } catch (_) {}
    if (secret) try { const models = await this.ai.models(secret); if (gen === this.configurationEpoch && store === this.store && models.length) { this.models = models; if (!models.includes(this.model)) this.model = models[0]; } } catch (_) {}
  }
  private async saveKey(): Promise<void> {
    this.busy = true; this.error = '';
    const gen = ++this.epoch;
    try {
      const models = await this.ai.models(this.keyInput.trim());
      if (gen !== this.epoch) return;
      await AiClient.saveKey(this.keyInput); this.keyInput = ''; this.configured = true; this.settings = false; this.replacing = false;
      if (models.length) { this.models = models; if (!models.includes(this.model)) this.model = models[0]; }
    } catch (err) { if (gen === this.epoch) this.error = (err as Error).message; }
    finally { if (gen === this.epoch) this.busy = false; }
  }
  private async ask(): Promise<void> {
    if (this.busy || !this.store || !this.question.trim()) return;
    const question = this.question.trim(), requested = questionScope(question, [], this.whole, []), whole = requested.whole, mode = this.mode, gen = ++this.epoch;
    const history = this.turns.slice();
    this.busy = true; this.error = ''; this.progress = '正在读取课程内容';
    try {
      const context = await this.context(whole);
      if (gen !== this.epoch) return;
      if (!context.slides.length && !context.lines.length) throw new Error('当前还没有可用的课程内容');
      const index = this.turns.length; this.question = '';
      const effectiveScope = questionScope(question, context.slides, whole, context.selectedIds || []); let usedWhole = effectiveScope.whole, expanded = usedWhole || context.slides.some((slide: Slide) => effectiveScope.selectedIds.includes(slide.id) && slide.t > context.at);
      this.turns = this.turns.concat([{ question, answer: '', at: context.at, whole: usedWhole, expanded, mode, complete: false }]);
      const render = (answer: string, complete: boolean = false): void => { if (gen !== this.epoch) return; this.turns = this.turns.slice(0, index).concat([{ question, answer, at: context.at, whole: usedWhole, expanded, mode, complete }]); if (complete || Date.now() - this.savedAt > 1200) this.persistChat(); };
      let target = '', shown = '', streamFinished = false;
      const reveal = setInterval((): void => {
        if (gen !== this.epoch) { clearInterval(reveal); return; }
        if (shown.length < target.length) {
          const count = Math.max(1, Math.ceil((target.length - shown.length) / 28));
          let end = Math.min(target.length, shown.length + count);
          if (end < target.length && target.charCodeAt(end - 1) >= 0xD800 && target.charCodeAt(end - 1) <= 0xDBFF) end++;
          shown = target.slice(0, end); render(shown);
        } else if (streamFinished) clearInterval(reveal);
      }, 16);
      let answer = '';
      try { answer = await this.ai.ask(this.store, context.slides, context.lines, question, context.at, whole, this.model, history, (message: string) => { if (gen === this.epoch) this.progress = message; }, mode, context.currentId || '', (value: string): void => { if (shown && !value.startsWith(shown)) shown = ''; target = value; if (!shown && value) { shown = Array.from(value).slice(0, 1).join(''); render(shown); this.progress = ''; } }, context.selectedIds || [], undefined, async () => this.context(true), (used: boolean, wider: boolean) => { usedWhole = used; expanded = wider; });
        target = answer;
        while (shown.length < target.length && gen === this.epoch) await new Promise<void>((resolve) => setTimeout(resolve, 16));
      } finally { streamFinished = true; clearInterval(reveal); }
      if (gen !== this.epoch) return;
      render(answer, true);
      setTimeout((): void => { if (gen === this.epoch) this.scroller.scrollEdge(Edge.Bottom); }, 32);
    } catch (err) { if (gen === this.epoch) this.error = (err as Error).message; }
    finally { if (gen === this.epoch) { this.busy = false; this.progress = ''; } }
  }
  private times(answer: string): string[] { return Array.from(new Set(answer.match(/\[\d{1,3}:\d{2}(?::\d{2})?\]/g) || [])); }
  private jump(value: string): void { const nums = value.replace(/[\[\]]/g, '').split(':').map((n: string) => Number(n)); this.onJump(nums.reduce((t: number, n: number) => t * 60 + n, 0)); }
  private questionKey(event: KeyEvent): boolean {
    SelectionKeys.update(event);
    if (event.keyCode === KeyCode.KEYCODE_SHIFT_LEFT || event.keyCode === KeyCode.KEYCODE_SHIFT_RIGHT) { this.shiftDown = event.type === KeyType.Down; return false; }
    if (event.keyCode === KeyCode.KEYCODE_CTRL_LEFT || event.keyCode === KeyCode.KEYCODE_CTRL_RIGHT) { this.controlDown = event.type === KeyType.Down; return false; }
    const shortcut = SelectionKeys.command(event);
    if (shortcut === 'a') { this.questionController.setTextSelection(0, this.question.length); this.selectionStart = 0; this.selectionEnd = this.question.length; return true; }
    if (shortcut === 'c') { const range = this.questionController.getSelection(); if (range && (range.end ?? 0) > (range.start ?? 0)) pasteboard.getSystemPasteboard().setData(pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, this.question.slice(range.start, range.end))).catch(() => {}); return true; }
    if (shortcut === 'v') { this.pasteQuestion(); return true; }
    const digit = physicalDigit(event.keyCode, this.shiftDown || this.controlDown || !!event.getModifierKeyState?.(['Ctrl']) || !!event.getModifierKeyState?.(['Alt']) || !!event.getModifierKeyState?.(['Shift']), event.keyText);
    if (digit) {
      if (event.type === KeyType.Down) {
        this.questionController.clearPreviewText(); const range = this.questionController.getSelection();
        const start = Math.max(0, Math.min(this.question.length, range?.start ?? this.selectionStart)), end = Math.max(start, Math.min(this.question.length, range?.end ?? this.selectionEnd));
        const next = this.question.slice(0, start) + digit + this.question.slice(end);
        if (end > start) this.questionController.deleteText({ start, end });
        this.questionController.addText(digit, { offset: start }); this.question = next; this.selectionStart = this.selectionEnd = start + 1; this.questionController.caretPosition(start + 1);
      }
      return true;
    }
    const enter = event.keyCode === KeyCode.KEYCODE_ENTER || event.keyCode === KeyCode.KEYCODE_NUMPAD_ENTER || event.keyText === 'Enter' || event.keyText === 'NumpadEnter';
    if (!enter) return false;
    const shift = this.shiftDown || !!event.getModifierKeyState?.(['Shift']);
    if (event.type === KeyType.Down) {
      this.suppressSubmitUntil = Date.now() + 400;
      if (shouldSubmitOnEnter(shift)) setTimeout(() => { if (!this.busy) this.ask(); }, 0);
      else {
        this.questionController.clearPreviewText();
        const range = this.questionController.getSelection();
        const start = Math.max(0, Math.min(this.question.length, range?.start ?? this.selectionStart));
        const end = Math.max(start, Math.min(this.question.length, range?.end ?? this.selectionEnd));
        const next = this.question.slice(0, start) + '\n' + this.question.slice(end);
        if (end > start) this.questionController.deleteText({ start, end });
        this.questionController.addText('\n', { offset: start });
        this.question = next;
        this.selectionStart = this.selectionEnd = start + 1;
        this.questionController.caretPosition(start + 1);
      }
    }
    return true;
  }
  private async pasteQuestion(): Promise<void> {
    const courseId = this.courseId, session = this.sessionId, previous = this.question;
    try { const data = await pasteboard.getSystemPasteboard().getData(), value = data.getPrimaryText(); if (!value || !this.active || courseId !== this.courseId || session !== this.sessionId || previous !== this.question) return;
      const range = this.questionController.getSelection(), start = Math.max(0, range?.start ?? this.selectionStart), end = Math.max(start, range?.end ?? this.selectionEnd);
      this.questionController.clearPreviewText(); if (end > start) this.questionController.deleteText({ start, end }); this.questionController.addText(value, { offset: start }); this.question = previous.slice(0, start) + value + previous.slice(end); this.selectionStart = this.selectionEnd = start + value.length; this.questionController.caretPosition(start + value.length);
    } catch (_) { this.error = '无法读取剪贴板，请重试'; }
  }
  private questionHeight(): number { const columns = Math.max(8, Math.floor((this.questionWidth - 20) / 14)); const lines = this.question.split('\n').reduce((count: number, line: string) => count + Math.max(1, Math.ceil(line.length / columns)), 0); return Math.min(140, 20 * lines + 14); }
  private questionSubmit(): void { if (Date.now() >= this.suppressSubmitUntil) this.ask(); }
  private streamingText(answer: string): string {
    return answerParts(answer).map((part: AnswerPart) => part.value).join('').replace(/\*{1,2}|_{1,2}|`+/g, '');
  }
  build() {
    Column({ space: 10 }) {
      Row({ space: 8 }) {
        Text('课程问答').fontSize(STUDY_TITLE_SIZE).fontWeight(FontWeight.Medium).fontColor(STUDY_TITLE_COLOR)
        Scroll() {
          Row({ space: 6 }) {
            if (this.configured && !this.settings) {
            Button('新对话').height(30).fontSize(11).backgroundColor('#EAF4FF').fontColor('#168BEE').onClick(() => this.newChat())
            Button('历史').height(30).fontSize(11).backgroundColor(this.historyOpen ? '#DDEEFF' : '#EAF4FF').fontColor('#168BEE').onClick(() => { this.persistChat(); this.historyOpen = !this.historyOpen; })
            Button() { DropdownLabel({ label: this.model + '', labelSize: 10 }) }.padding(0).fontSize(10).height(30).backgroundColor('#EAF4FF').fontColor('#168BEE').bindMenu(this.models.map((model: string): MenuElement => { return { value: model, action: () => { this.model = model; this.store?.saveJson('ai-model.txt', model); } }; }))
            Button(this.selectedCount ? '课件 ' + this.selectedCount + ' 页' : '选课件').fontSize(11).height(30).backgroundColor('#EAF4FF').fontColor('#168BEE').onClick(() => this.onSelectPages())
            Button(this.whole ? '✓ 整节课' : '整节课').fontSize(11).height(30).backgroundColor(this.whole ? '#DDEEFF' : '#EAF4FF').fontColor('#168BEE').onClick(() => this.whole = !this.whole)
            Button() { DropdownLabel({ label: this.mode === 'auto' ? '自动' : this.mode === 'always' ? '结合课件' : '只看转写', labelSize: 11 }) }.padding(0).fontSize(11).height(30).backgroundColor(this.mode === 'auto' ? '#EAF4FF' : '#DDEEFF').fontColor('#168BEE').bindMenu([
              { value: '自动判断', action: () => this.mode = 'auto' },
              { value: '强制结合课件作答', action: () => this.mode = 'always' },
              { value: '强制不结合课件', action: () => this.mode = 'never' }
            ])
            }
            if (this.configured && !this.settings) { Button('API设置').height(30).fontSize(12).backgroundColor('#EAF4FF').fontColor('#168BEE').onClick(() => { this.replacing = false; this.settings = true; }) }
          }.height(32)
        }.layoutWeight(1).height(32).align(Alignment.End).scrollable(ScrollDirection.Horizontal).scrollBar(BarState.Off)
      }.width('100%')
      if (this.configured && this.settings && !this.replacing) {
        Column({ space: 18 }) {
          Text('API 已连接').fontSize(20).fontColor('#20344D')
          Text('密钥已加密保存在本机').fontSize(13).fontColor('#71839A')
          Text(AiClient.usage(this.store).prompt > 0 ? '已记录输入 ' + AiClient.usage(this.store).prompt + ' token · 缓存命中 ' + Math.round(AiClient.usage(this.store).hit / AiClient.usage(this.store).prompt * 100) + '%' : '使用记录将在请求完成后更新').fontSize(12).fontColor('#71839A')
          Button('删除 API 密钥').height(38).fontColor('#B44747').backgroundColor('#FCEEEE').onClick(() => { this.cancel(); AiClient.clearKey().then(() => { this.configured = false; this.settings = false; }).catch(() => this.error = '删除失败，请重试'); })
          Button('更换 API 密钥').height(38).fontColor('#168BEE').backgroundColor('#EAF4FF').onClick(() => this.replacing = true)
          Button('返回对话').height(38).backgroundColor('#168BEE').fontColor('#FFFFFF').onClick(() => { this.replacing = false; this.settings = false; })
        }.layoutWeight(1).width('100%').justifyContent(FlexAlign.Center)
      } else if (!this.configured || this.settings) {
        if (this.configured) { Button('返回对话').height(32).fontSize(12).fontColor('#168BEE').backgroundColor('#EAF4FF').onClick(() => { this.replacing = false; this.settings = false; }) }
        ApiKeySetup({ onEditingFocus: this.onEditingFocus, onEnabled: () => { this.configured = true; this.settings = false; this.replacing = false; this.initialize(); } }).layoutWeight(1).width('100%')
      } else if (this.historyOpen) {
        Text('本节课的对话').fontSize(13).fontColor('#71839A').width('100%')
        List({ space: 10 }) { ForEach(this.sessions, (session: ChatSession) => { ListItem() { Row({ space: 8 }) { Column({ space: 6 }) { Text(session.title).fontSize(14).fontColor('#20344D'); Text(session.turns.length + ' 次提问').fontSize(11).fontColor('#71839A') }.layoutWeight(1).alignItems(HorizontalAlign.Start).onClick(() => this.selectChat(session)); Button('打开').height(30).fontSize(11).backgroundColor('#EAF4FF').fontColor('#168BEE').onClick(() => this.selectChat(session)); Button('删除').height(30).fontSize(11).backgroundColor('#FCEEEE').fontColor('#B44747').onClick(() => { if (this.store) { this.chats?.delete(session.id); this.sessions = this.chats?.list() || []; if (this.sessionId === session.id) { this.sessionId = ''; this.turns = []; } } }) }.padding(12).width('100%').backgroundColor('#FFFFFF').borderRadius(12) } }, (session: ChatSession) => session.id) }.width('100%').layoutWeight(1)
      } else {
        Stack({ alignContent: Alignment.Bottom }) {
          Column() {
        Scroll(this.scroller) {
          Column({ space: 14 }) {
            if (!this.turns.length) { Text('根据老师的讲解提问，需要时查阅相关课件').fontSize(13).fontColor('#8A9CB0').width('100%').padding({ top: 30 }) }
            ForEach(this.turns.map((turn: ChatTurn, index: number) => index), (index: number) => {
              Column({ space: 8 }) {
                AnswerText({ onDragging: (active: boolean) => { this.draggingAnswer = active; this.onSelecting(active); }, onSelecting: (active: boolean) => this.selectingAnswer = active, onInteract: this.onDismissReturn, selectionGroup: 'ai', onPointer: () => this.clearTextSelection(), selectionOffset: this.conversationSelection ? 0 : this.turnHeader(index).length, selectionRequest: this.conversationSelection || (this.turnSelection === index ? this.turnSelectionRevision : 0), onSelectAll: () => this.selectTurn(index), onCopyAll: () => this.copyTurn(index), parts: this.turnParts(index), notesOpen: this.notesOpen, reference: { kind: 'question', courseId: this.courseId, sessionId: this.sessionId, turn: index, at: this.turns[index].at }, onJump: (at: number) => this.jumpAnswer(index, at), onInsert: (value: NoteInsertion) => { this.persistChat(); this.onInsert({ formatted: value.formatted, kind: value.kind, value: value.value, at: value.at, end: value.end, sourceId: value.sourceId, reference: { kind: 'question', courseId: this.courseId, sessionId: this.sessionId, turn: index, at: this.turns[index].at } }); } }).width('100%')
              }.id('answer-turn-' + index).width('100%').padding(14).backgroundColor(this.referencedTurn === index ? '#DDEEFF' : '#FFFFFF').borderRadius(12)
              Text(' ').height(10).width('100%').focusable(true).focusOnTouch(true).bindMenu(this.conversationSelection ? [{ value: '复制', action: () => this.copyConversation() }] : []).onKeyEvent((event: KeyEvent): boolean => { const key = SelectionKeys.command(event); if (key === 'a') { this.conversationSelection++; return true; } if (key === 'c') return this.copyConversation(); return false; })
            }, (index: number) => String(index))
          }.width('100%').padding({ bottom: this.returnVisible ? STUDY_RETURN_SCROLL_SPACE : 0 })
        }.layoutWeight(1).width('100%').scrollable(ScrollDirection.Vertical).enableScrollInteraction(!this.draggingAnswer).onGestureJudgeBegin((info: GestureInfo, event: BaseGestureEvent) => this.draggingAnswer && info.type === GestureControl.GestureType.PAN_GESTURE ? GestureJudgeResult.REJECT : GestureJudgeResult.CONTINUE)
        if (this.progress) { Row() { Text(this.progress).fontSize(12).fontColor('#168BEE').layoutWeight(1); Button('取消').height(28).fontSize(11).backgroundColor('#EAF4FF').fontColor('#168BEE').onClick(() => this.cancel()) }.width('100%') }
          }.width('100%').height('100%')
          if (this.returnVisible) { ReturnAction({ owner: 'ai', onReturn: this.onReturn }).margin({ bottom: 6 }).zIndex(2) }
        }.layoutWeight(1).width('100%')
        TextArea({ controller: this.questionController, text: this.question, placeholder: '问问这节课…' }).id('ai-question').placeholderFont({ size: 14 }).placeholderColor('#889AAF').height(this.questionHeight()).padding({ top: 7, bottom: 7, left: 10, right: 10 }).fontSize(14).onAreaChange((oldArea: Area, area: Area) => this.questionWidth = Number(area.width)).enterKeyType(EnterKeyType.Send).onSubmit(() => this.questionSubmit()).onFocus(() => this.questionFocused()).onBlur(() => { this.controlDown = false; this.shiftDown = false; this.onEditingFocus(false); }).onChange((value: string) => this.question = value)
          .onTextSelectionChange((start: number, end: number) => { this.selectionStart = start; this.selectionEnd = end; }).focusable(true).focusOnTouch(true).onKeyPreIme((event: KeyEvent): boolean => this.questionKey(event)).onTouch((event: TouchEvent) => this.questionTouched(event)).onMouse((event: MouseEvent) => event.stopPropagation())
        Button('发送').height(38).width('100%').backgroundColor('#168BEE').fontColor('#FFFFFF').enabled(!this.busy && !!this.question.trim()).onClick(() => this.ask())
      }
      if (this.error) { Text(this.error).fontSize(12).fontColor('#AF693C').width('100%') }
    }.padding(12).width('100%').height('100%').backgroundColor(STUDY_SURFACE).borderRadius(STUDY_RADIUS)
  }
}
