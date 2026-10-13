import { ReturnAction } from './ReturnAction';
import { SummaryCache } from '../services/SummaryCache';
import { answerParts } from '../model/AiStream';
import { AxisPaging } from '../model/AxisPaging';
import { SummaryView, SummaryViewController } from '../model/SummaryView';
import { pointerSelection } from '../model/PointerInput';
import { AnswerText } from './AnswerText';
import { NoteContentReference, NoteInsertion } from '../model/Notes';
import { DropdownLabel } from './DropdownLabel';
import { STUDY_TITLE_SIZE, STUDY_TITLE_COLOR, STUDY_SURFACE, STUDY_RADIUS, STUDY_RETURN_SCROLL_SPACE } from '../model/StudyStyle';
import { ApiKeySetup } from './ApiKeySetup';
import { AiClient } from '../services/AiClient';
import { LocalStore, key } from '../services/LocalStore';
import { PriorCourseContext, PriorLesson, priorMaterial } from '../model/CourseContext';
import { CourseContextLoader } from '../services/CourseContextLoader';
import { Snapshot } from '../services/LocalStore';
import { Course, Slide, Transcript, stamp } from '../model/Timeline';
import { CourseAnswerPart, courseAnswerParts, estimatedTextTokens } from '../model/CourseReference';
import { PageSummaryRecord, summaryDue } from '../model/SummaryPolicy';
@Component
export struct PageSummary {
  @Prop returnVisible: boolean = false;
  onReturn: () => void = () => {};
  onDismissReturn: () => void = () => {};
  @Prop @Watch('refresh') active: boolean = false;
  @Prop @Watch('refresh') opened: boolean = false;
  @Prop @Watch('refresh') live: boolean = false;
  controller: SummaryViewController = new SummaryViewController();
  @Prop @Watch('restoreView') restoredView: SummaryView | undefined = undefined;
  private appliedView: SummaryView | undefined = undefined;
  private scroller: Scroller = new Scroller();
  private restoreScrollTimer: number = -1;
  private viewReader: () => SummaryView = () => this.captureView();
  private summaryCache: SummaryCache | undefined = undefined;
  private readingScope: string = '';
  private readingPage: string = '';
  private readingRecord: string = '';
  private readingOffset: number = 0;
  private readingTimer: number = -1;
  private restoringScroll: boolean = false;
  @State pinnedResult: PageSummaryRecord | undefined = undefined;
  @State referenceMissing: boolean = false;
  @Prop notesOpen: boolean = false;
  @Prop @Watch('referenceChanged') requestedReference: NoteContentReference | undefined = undefined;
  @Prop @Watch('referenceChanged') referenceSequence: number = 0;
  onInsert: (value: NoteInsertion) => void = () => {};
  @Prop @Watch('availabilityChanged') followingLive: boolean = false;
  @State requestedId: string = '';
  @Prop @Watch('refresh') slides: Slide[] = [];
  @Prop @Watch('refresh') lines: Transcript[] = [];
  @Prop @Watch('refresh') imageRevision: number = 0;
  @Prop @Watch('pageChanged') currentId: string = '';
  @Prop @Watch('courseChanged') courseId: string = '';
  store: LocalStore | undefined = undefined;
  contextTime: () => number = () => Number.POSITIVE_INFINITY;
  offline: boolean = false;
  savedLessons: () => Snapshot[] = () => [];
  private contextLoader: CourseContextLoader = new CourseContextLoader();
  private prior: PriorCourseContext | undefined = undefined;
  @State priorNotice: string = '';
  private priorRevision: string = '';
  private fingerprintSource: PriorCourseContext | undefined = undefined;
  private fingerprintRevision: number = -1;
  private fingerprint: string = '';
  onClose: () => void = () => {};
  onConfigure: () => void = () => {};
  onEditingFocus: (focused: boolean) => void = () => {};
  private axisPaging: AxisPaging = new AxisPaging();
  private selectingUntil: number = 0;
  onSelecting: (active: boolean) => void = () => {};
  @State draggingText: boolean = false;
  @State selectingText: boolean = false;
  private fingerDownAt: number = 0;
  onTurn: (direction: number) => void = () => {};
  @State allPages: boolean = false;
  @State scope: string = 'page';
  onCourseJump: (course: Course, at: number) => void = () => {};
  onJump: (at: number) => void = () => {};
  @State results: Record<string, PageSummaryRecord> = {};
  @State streaming: string = '';
  @State workingId: string = '';
  @State status: string = '';
  @State configured: boolean = false;
  private previousActive: boolean = false;
  @State checkingApi: boolean = false;
  @State configurationChecked: boolean = false;
  private ai: AiClient = new AiClient();
  private epoch: number = 0;
  private running: boolean = false;
  private timer: number = -1;
  private dueAt: number = 0;
  private failures: Map<string, boolean> = new Map();
  aboutToAppear(): void { this.controller.bind(this.viewReader); this.bindCache(); this.scope = this.summaryCache?.lastScope() || 'page'; this.restore(); this.restoreView(); this.refresh(); this.referenceChanged(); }
  aboutToDisappear(): void { this.saveReading(); clearTimeout(this.readingTimer); this.controller.unbind(this.viewReader); clearTimeout(this.restoreScrollTimer); clearTimeout(this.referenceTimer); this.cancel(); this.onEditingFocus(false); }
  private cancel(): void { this.epoch++; this.ai.cancel(); this.contextLoader.cancel(); clearTimeout(this.timer); this.timer = -1; this.dueAt = 0; this.running = false; this.workingId = ''; this.streaming = ''; }
  private courseChanged(): void { this.saveReading(); this.cancel(); this.bindCache(); this.scope = this.summaryCache?.lastScope() || 'page'; this.pinnedResult = undefined; this.referenceMissing = false; this.readingPage = ''; this.readingRecord = ''; this.failures.clear(); this.prior = undefined; this.priorNotice = ''; this.requestedId = ''; this.appliedView = undefined; this.restore(); this.restoreView(); this.refresh(); }
  private captureView(): SummaryView { let scroll = 0; try { scroll = this.scroller.currentOffset().yOffset; } catch (_) {} return { courseId: this.courseId, pageId: this.currentId, scope: this.scope, allPages: this.allPages, scroll: this.restoringScroll ? this.readingOffset : scroll, pinnedResult: this.pinnedResult, results: this.results, prior: this.prior, priorNotice: this.priorNotice, priorRevision: this.priorRevision }; }
  private restoreView(): void {
    const view = this.restoredView; if (!view || view.courseId !== this.courseId || view === this.appliedView) return;
    this.appliedView = view; this.cancel(); this.scope = view.scope; this.allPages = view.allPages;
    this.results = view.results; this.prior = view.prior; this.priorNotice = view.priorNotice; this.priorRevision = view.priorRevision;
    this.pinnedResult = view.pinnedResult || view.results[view.pageId]; this.referenceMissing = false; this.syncReading(view.scroll);
  }
  private restore(): void { if (this.summaryCache) { this.results = this.summaryCache.latest(this.scope); return; } try { this.results = JSON.parse(this.store?.readFeature('summary', 'summary-' + this.scope + '.json') || '{}') as Record<string, PageSummaryRecord>; } catch (_) { this.results = {}; } }
  private pageLines(slide: Slide): Transcript[] { const i = this.slides.findIndex((s: Slide) => s.id === slide.id), end = this.slides[i + 1]?.t ?? Number.POSITIVE_INFINITY; return this.lines.filter((l: Transcript) => l.t >= slide.t && l.t < end); }
  private cutoff(slide: Slide): number { const i = this.slides.findIndex((s: Slide) => s.id === slide.id), lines = this.pageLines(slide); const end = Math.max(slide.t, this.slides[i + 1]?.t !== undefined ? this.slides[i + 1].t - 0.001 : lines[lines.length - 1]?.end || slide.t); return this.scope === 'course' ? Math.max(0, Math.min(end, this.contextTime())) : end; }
  private priorKey(): string {
    if (!this.crossScope() || !this.prior) return '';
    if (this.fingerprintSource !== this.prior || this.fingerprintRevision !== this.imageRevision) {
      this.fingerprintSource = this.prior; this.fingerprintRevision = this.imageRevision;
      this.fingerprint = key(priorMaterial(this.prior) + '|' + this.prior.lessons.map((lesson) => lesson.slides.map((slide: Slide) => slide.url + ':' + (this.store?.imageVersion(slide.url) || '')).join('|')).join('|'));
    }
    return this.fingerprint;
  }
  private eligibleResult(slide: Slide, priorKey: string): PageSummaryRecord | undefined { if (this.pinnedResult && slide.id === this.currentId) return this.pinnedResult; const result = this.results[slide.id]; return this.scope === 'course' && result?.contextAt !== undefined && result.contextAt > this.cutoff(slide) ? undefined : result; }
  private signature(slide: Slide, priorKey: string = this.priorKey()): string { const i = this.slides.findIndex((s: Slide) => s.id === slide.id), end = this.slides[i + 1]?.t ?? Number.POSITIVE_INFINITY; const context = (this.scope === 'whole' || this.scope === 'courseAll') ? this.lines : (this.scope === 'before' || this.scope === 'course') ? this.lines.filter((l: Transcript) => l.t < end && (this.scope !== 'course' || l.t <= this.cutoff(slide))) : this.pageLines(slide); return key(this.scope + '|' + priorKey + '|' + slide.url + '|' + (this.store?.imageVersion(slide.url) || '') + '|' + context.map((l: Transcript) => l.id + ':' + l.text).join('|')); }
  private schedule(delay: number): void { clearTimeout(this.timer); this.dueAt = Date.now() + delay; this.timer = setTimeout(() => { this.timer = -1; this.dueAt = 0; this.next(); }, delay); }
  private checkApi(): void { if (this.checkingApi) return; this.checkingApi = true; AiClient.savedKey().then((secret: string) => { this.configurationChecked = true; this.configured = !!secret; if (this.active && this.configured) this.schedule(500); }).finally(() => this.checkingApi = false); }
  private refresh(): void {
    this.syncReading();
    if (!this.active || !this.opened) { this.previousActive = false; if (!this.opened) { this.allPages = false; this.prior = undefined; this.priorNotice = ''; } this.cancel(); return; }
    if (!this.previousActive) { this.previousActive = true; this.checkApi(); }
    if (!this.configured) return;
    if (this.running) return;
    if (this.timer < 0 || this.dueAt > Date.now() + 500) this.schedule(500);
  }
  private async next(): Promise<void> {
    if (!this.active || this.running || !this.store) return;
    const needsMaterial = this.slides.some((slide: Slide) => !(this.referenceMissing && slide.id === this.currentId && this.requestedId !== slide.id) && (this.allPages || slide.id === this.currentId || this.results[slide.id]?.completed === false) && summaryDue(this.live, this.slides.findIndex((page: Slide) => page.id === slide.id) < this.slides.length - 1, this.requestedId === slide.id, this.eligibleResult(slide, ''), '', Date.now()));
    if (this.crossScope() && needsMaterial) {
      const revisions = this.store.cache.revision('slides') + ':' + this.store.cache.revision('transcript');
      if (!this.prior || this.priorRevision !== revisions) {
        const gen = this.epoch, store = this.store, course = store.activeCourse;
        if (!course) { this.status = '请先进入一节课程'; return; }
        this.running = true; this.status = this.scope === 'courseAll' ? '正在整理整门课内容' : '正在整理之前的内容';
        try {
          const prior = await this.contextLoader.load(course, store, this.offline, this.savedLessons(), (status: string) => { if (gen === this.epoch) this.status = status; }, this.scope === 'courseAll');
          if (gen !== this.epoch || !this.active) return;
          this.prior = prior; this.priorRevision = revisions;
          const gaps = prior.gaps.length + prior.lessons.filter((lesson) => lesson.gaps.length > 0).length;
          this.priorNotice = '已整理 ' + prior.lessons.filter((lesson) => lesson.lines.length || lesson.slides.length).length + ' 节关联内容' + (gaps ? ' · 有材料缺口，回答会注明' : '') + ' · 图片另计，关联文本约 ' + estimatedTextTokens(priorMaterial(prior)) + ' Token（估算，图片另计）';
          this.status = '';
        } catch (err) { if (gen === this.epoch) { this.status = (err as Error).message; this.schedule(45000); } return; }
        finally { if (gen === this.epoch) this.running = false; }
      }
    }
    const priorKey = this.priorKey();
    const current = this.slides.find((s: Slide) => s.id === this.currentId);
    const ordered = current ? [current].concat(this.slides.filter((s: Slide) => s.id !== current.id)) : this.slides;
    // Finish an already-requested live page after the teacher changes slides,
    // without generating any pages the user has never requested or viewed.
    const eligible = this.allPages ? ordered : ordered.filter((s: Slide) => s.id === this.currentId || this.requestedId === s.id || this.results[s.id]?.completed === false && (!this.live || this.slides.findIndex((page: Slide) => page.id === s.id) < this.slides.length - 1));
    const slide = eligible.find((s: Slide) => !(this.referenceMissing && s.id === this.currentId && this.requestedId !== s.id) && this.failures.get(s.id) !== (!this.live || this.slides.findIndex((page: Slide) => page.id === s.id) < this.slides.length - 1) && summaryDue(this.live, this.slides.findIndex((page: Slide) => page.id === s.id) < this.slides.length - 1, this.requestedId === s.id, this.eligibleResult(s, priorKey), this.signature(s, priorKey), Date.now()));
    if (!slide) { this.schedule(45000); return; }
    const cacheRevision = this.store.cache.revision('summary');
    const gen = this.epoch, signature = this.signature(slide, priorKey), store = this.store, summaryCache = this.summaryCache, scope = this.scope;
    const i = this.slides.findIndex((s: Slide) => s.id === slide.id), pageLines = this.pageLines(slide);
    const completed = !this.live || i < this.slides.length - 1;
    const contextSlides = (this.scope === 'whole' || this.scope === 'courseAll') ? this.slides : (this.scope === 'before' || this.scope === 'course') ? this.slides.slice(0, i + 1) : [slide];
    const at = this.cutoff(slide);
    const contextLines = (this.scope === 'whole' || this.scope === 'courseAll') ? this.lines : (this.scope === 'before' || this.scope === 'course') ? this.lines.filter((l: Transcript) => l.t <= at) : pageLines;
    this.running = true; this.workingId = slide.id; this.streaming = ''; this.status = '正在概括';
    try {
      const credential = await AiClient.savedKey(); if (gen !== this.epoch || !this.active) return; this.configured = !!credential; if (!this.configured) return;
      const answer = await this.ai.ask(store, contextSlides, contextLines, '帮助学生用最短时间理解当前页。概括这一页的关键知识、老师在此页讲了什么；没有转写时只依据课件，不虚构老师讲解。能从所给上下文看出时，自然说明它与前文的联系及在本课中的作用。不要描述页面左侧右侧、排版或机械列出新增点。用自然简洁的中文，约100—180字，有必要才列要点；引用讲解时间用[mm:ss]。' + (this.scope === 'page' ? '当前只给出这一页的证据，不推测其他页。' : this.scope === 'courseAll' ? '结合这门课已提供的所有课次，包括本节之前和之后的内容，简要说明当前页在整门课中的作用。区分提问时点已经讲过的知识和之后才讲的知识；跨课引用必须带日期、开课时间及课内时间。' : this.scope === 'course' ? '把同一门课所有前序课次与本节课截至本页的内容作为背景，解释本页与已讲知识的联系；不使用本节课后面的内容，也不重述整门课。历史课次引用使用日期和课内时间，不能混成本节课的时间链接。' : this.scope === 'before' ? '以本页之前的内容为背景，不重述全部前文。' : '联系整课脉络；直播未结束时只依据现有内容。'), at, (this.scope === 'whole' || this.scope === 'courseAll'), store.readJson('ai-model.txt') || 'deepseek-flash', [], (status: string) => { if (gen === this.epoch) this.status = status; }, 'always', slide.id, (answer: string) => { if (gen === this.epoch) this.streaming = answer; }, [], this.crossScope() ? this.prior : undefined);
      if (gen !== this.epoch) return;
      const results: Record<string, PageSummaryRecord> = {}; Object.keys(this.results).forEach((id: string) => results[id] = this.results[id]); const record: PageSummaryRecord = { answer, signature, savedAt: Date.now(), completed, contextAt: this.crossScope() ? at : undefined, priorKey: this.crossScope() ? priorKey : undefined, references: this.crossScope() ? this.prior?.lessons.map((lesson) => lesson.course) : undefined }; results[slide.id] = summaryCache ? summaryCache.save(scope, slide.id, record, this.results, cacheRevision) : record; this.results = results; this.syncReading();
      if (this.requestedId === slide.id) this.requestedId = '';
      if (!summaryCache) store.saveFeature('summary', 'summary-' + scope + '.json', JSON.stringify(results), cacheRevision); this.status = '';
    } catch (err) { if (gen === this.epoch) { this.status = (err as Error).message; this.failures.set(slide.id, completed); } }
    finally { if (gen === this.epoch) { this.running = false; this.workingId = ''; this.streaming = ''; if (this.active && this.configured) this.schedule(500); } }
  }
  private crossScope(): boolean { return this.scope === 'course' || this.scope === 'courseAll'; }
  private availabilityChanged(): void { if (this.followingLive && (this.scope === 'whole' || this.scope === 'courseAll')) this.changeScope(this.scope === 'whole' ? 'before' : 'course'); else this.refresh(); }
  private scopeCost(scope: string): string {
    const slide = this.slides.find((page: Slide) => page.id === this.currentId), index = this.slides.findIndex((page: Slide) => page.id === this.currentId), end = this.slides[index + 1]?.t ?? Number.POSITIVE_INFINITY;
    const lines = scope === 'whole' || scope === 'courseAll' ? this.lines : scope === 'page' ? (slide ? this.pageLines(slide) : []) : this.lines.filter((line: Transcript) => line.t < end && (scope !== 'course' || line.t <= this.contextTime()));
    let text = lines.map((line: Transcript) => stamp(line.t) + ' ' + line.text).join('\n');
    if (scope === 'course' || scope === 'courseAll') {
      if (!this.prior || !!this.prior.wholeCourse !== (scope === 'courseAll')) return scope === 'courseAll' ? '范围最大，加载后估算' : '跨课内容，加载后估算';
      text += priorMaterial(this.prior);
    }
    return '文本约 ' + (estimatedTextTokens(text) + 1000) + ' Token';
  }
  private scopeMenu(): MenuElement[] {
    const options: MenuElement[] = [{ value: '本页内容 · ' + this.scopeCost('page'), action: () => this.changeScope('page') }, { value: '联系前文 · ' + this.scopeCost('before'), action: () => this.changeScope('before') }];
    if (!this.followingLive) options.push({ value: '整课脉络 · ' + this.scopeCost('whole'), action: () => this.changeScope('whole') });
    options.push({ value: '结合整门课之前的内容 · ' + this.scopeCost('course'), action: () => this.changeScope('course') });
    if (!this.followingLive) options.push({ value: '结合整门课 · ' + this.scopeCost('courseAll'), action: () => this.changeScope('courseAll') });
    return options;
  }
  private changeScope(scope: string): void { this.saveReading(); this.pinnedResult = undefined; this.referenceMissing = false; this.cancel(); this.scope = scope; this.prior = undefined; this.priorNotice = ''; this.failures.clear(); this.restore(); this.refresh(); }
  private requestCurrent(): void { this.saveReading(); this.bindCache(); this.pinnedResult = undefined; this.referenceMissing = false; if (this.running && this.workingId !== this.currentId) this.cancel(); this.failures.delete(this.currentId); this.requestedId = this.currentId; this.configured = true; clearTimeout(this.timer); this.timer = -1; this.dueAt = 0; this.next(); }
  @State referenceHighlighted: boolean = false;
  private referenceTimer: number = -1;
  private referenceChanged(): void {
    const ref = this.requestedReference; if (ref?.kind !== 'summary' || ref.courseId !== this.courseId) return;
    if (ref.scope && ref.scope !== this.scope) this.changeScope(ref.scope);
    this.saveReading(); this.pinnedResult = ref.summaryId && ref.pageId ? this.summaryCache?.record(this.scope, ref.pageId, ref.summaryId) : undefined;
    this.referenceMissing = !!ref.summaryId && !this.pinnedResult;
    if (this.referenceMissing) this.status = '原速览记录已清理，笔记中的引用文字仍保留'; else this.status = '';
    this.syncReading(); clearTimeout(this.referenceTimer); this.referenceHighlighted = true; this.referenceTimer = setTimeout(() => this.referenceHighlighted = false, 2000);
  }
  private currentResult(): PageSummaryRecord | undefined { return this.pinnedResult || this.results[this.currentId]; }
  private answer(): string { if (this.referenceMissing) return ''; if (this.pinnedResult) return this.pinnedResult.answer; if (this.workingId === this.currentId) return this.streaming; const slide = this.slides.find((page: Slide) => page.id === this.currentId); return slide ? this.eligibleResult(slide, this.priorKey())?.answer || '' : ''; }
  private answerContext(): PriorCourseContext | undefined {
    const references = this.currentResult()?.references;
    return references ? { lessons: references.map((course: Course): PriorLesson => { return { course, slides: [], lines: [], gaps: [] }; }), gaps: [], wholeCourse: this.scope === 'courseAll' } : this.prior;
  }
  private bindCache(): void { const course = this.store?.activeCourse; this.summaryCache = this.store && course?.subId === this.courseId ? new SummaryCache(this.store, course) : undefined; }
  private saveReading(): void { clearTimeout(this.readingTimer); if (this.readingPage) this.summaryCache?.savePosition(this.readingScope, this.readingPage, this.readingRecord, this.readingOffset); }
  private syncReading(offset?: number): void {
    const id = this.currentResult()?.id || '', samePage = this.readingScope === this.scope && this.readingPage === this.currentId;
    if (offset === undefined && samePage && this.readingRecord === id) return;
    this.saveReading(); this.readingScope = this.scope; this.readingPage = this.currentId; this.readingRecord = id;
    this.readingOffset = offset ?? (samePage && !this.pinnedResult ? this.readingOffset : this.summaryCache?.position(this.scope, this.currentId, id) || 0);
    const courseId = this.courseId, pageId = this.currentId, scope = this.scope, record = id;
    clearTimeout(this.restoreScrollTimer); this.restoringScroll = true;
    this.restoreScrollTimer = setTimeout(() => { if (this.courseId === courseId && this.currentId === pageId && this.scope === scope && this.readingRecord === record) { try { this.scroller.scrollTo({ xOffset: 0, yOffset: this.readingOffset, animation: false }); } catch (_) {} this.restoringScroll = false; } }, 100);
  }
  private readingScrolled(): void {
    if (this.restoringScroll) return; try { this.readingOffset = this.scroller.currentOffset().yOffset; } catch (_) { return; }
    clearTimeout(this.readingTimer); this.readingTimer = setTimeout(() => this.saveReading(), 200);
  }
  private pageChanged(): void { this.saveReading(); this.pinnedResult = undefined; this.referenceMissing = false; this.status = ''; this.syncReading(); this.refresh(); }
  private insertSummary(value: NoteInsertion): void {
    const shown = value.sourceText || this.answer(), current = this.currentResult();
    let record = current;
    if (!record || answerParts(record.answer).map((part) => part.value).join('') !== shown) record = { answer: shown, signature: 'quoted', savedAt: Date.now(), completed: false, references: this.answerContext()?.lessons.map((lesson) => lesson.course) };
    if (this.summaryCache) record = this.summaryCache.archive(this.scope, this.currentId, record);
    this.saveReading(); if (record.id) this.summaryCache?.savePosition(this.scope, this.currentId, record.id, this.readingOffset);
    this.onInsert({ formatted: value.formatted, kind: value.kind, value: value.value, at: value.at, end: value.end, sourceId: value.sourceId, reference: { kind: 'summary', courseId: this.courseId, pageId: this.currentId, scope: this.scope, summaryId: record.id, at: value.at } });
  }

  @Builder
  private summaryTools() {
      Scroll() { Row({ space: 6 }) {
        if (this.answer() && (!this.live || this.currentId !== this.slides[this.slides.length - 1]?.id)) { Button('重新生成').height(30).fontSize(11).fontColor('#168BEE').backgroundColor('#EAF4FF').enabled(!this.running).onClick(() => this.requestCurrent()) }
        Button(this.allPages ? '✓ 所有页面速览' : '所有页面速览').height(30).fontSize(11).fontColor('#168BEE').backgroundColor(this.allPages ? '#DDEEFF' : '#EAF4FF').onClick(() => { this.allPages = !this.allPages; if (!this.allPages && this.workingId !== this.currentId) this.cancel(); this.refresh(); })
        Button() { DropdownLabel({ label: this.scope === 'page' ? '本页内容' : this.scope === 'before' ? '联系前文' : this.scope === 'course' ? '结合整门课之前的内容' : this.scope === 'courseAll' ? '结合整门课' : '整课脉络', labelSize: 11 }) }.padding(0).height(30).fontSize(11).fontColor('#168BEE').backgroundColor('#EAF4FF').bindMenu(this.scopeMenu())
      } }.height(32).layoutWeight(1).align(Alignment.End).scrollable(ScrollDirection.Horizontal).scrollBar(BarState.Off)
  }
  build() {
    Column({ space: 10 }) {
      Row({ space: 8 }) {
        Text('本页速览').fontSize(STUDY_TITLE_SIZE).fontWeight(FontWeight.Medium).fontColor(STUDY_TITLE_COLOR)
        if (this.configured) { this.summaryTools() } else { Blank().layoutWeight(1) }
      }.width('100%')
      if (!this.configured) {
        if (this.configurationChecked) { ApiKeySetup({ onEditingFocus: this.onEditingFocus, onEnabled: () => { this.configured = true; this.refresh(); } }).layoutWeight(1).width('100%') }
        else { Blank().layoutWeight(1) }
      } else {
      Text('第 ' + (this.slides.findIndex((s: Slide) => s.id === this.currentId) + 1) + ' 页 · ' + stamp(this.slides.find((s: Slide) => s.id === this.currentId)?.t || 0)).fontSize(12).fontColor('#889AAF').width('100%')
      if (this.live && this.currentId === this.slides[this.slides.length - 1]?.id) { Button('以本页现有转写与课件生成回答').fontSize(12).height(36).width('100%').fontColor('#168BEE').backgroundColor('#EAF4FF').enabled(this.workingId !== this.currentId).onClick(() => this.requestCurrent()) }
      Stack({ alignContent: Alignment.Bottom }) {
      Scroll(this.scroller) {
        Column() {
        AnswerText({ onDragging: (active: boolean) => { this.draggingText = active; this.onSelecting(active); }, onInteract: this.onDismissReturn, selectionGroup: 'summary', onPointer: this.onDismissReturn, onSelecting: (active: boolean) => { this.selectingText = active; if (active) this.selectingUntil = Date.now() + 500; }, parts: courseAnswerParts(this.answer(), this.answerContext()), notesOpen: this.notesOpen, reference: { kind: 'summary', courseId: this.courseId, pageId: this.currentId, scope: this.scope, summaryId: this.currentResult()?.id, at: this.slides.find((page: Slide) => page.id === this.currentId)?.t || 0 }, onJump: (at: number, course?: Course) => { if (course) this.onCourseJump(course, at); else this.onJump(at); }, onInsert: (value: NoteInsertion) => this.insertSummary(value) }).width('100%').backgroundColor(this.referenceHighlighted ? '#DDEEFF' : Color.Transparent).borderRadius(6)
        }.width('100%').padding({ bottom: this.returnVisible ? STUDY_RETURN_SCROLL_SPACE : 0 })
      }.onScroll(() => this.readingScrolled()).height('100%').width('100%').align(Alignment.TopStart).scrollable(ScrollDirection.Vertical).enableScrollInteraction(!this.draggingText)
      if (this.returnVisible) { ReturnAction({ owner: 'summary', onReturn: this.onReturn }).zIndex(2) }
      }.layoutWeight(1).width('100%')
      if (this.crossScope() && this.priorNotice) { Text(this.priorNotice).fontSize(11).fontColor('#71839A').width('100%') }
      if (this.status) { Text(this.status).fontSize(12).fontColor('#71839A').width('100%') }
      if (!this.status && !this.answer()) { Text(this.live && this.currentId === this.slides[this.slides.length - 1]?.id ? '这一页讲解结束后自动生成，也可现在生成' : '等待这一页课程内容').fontSize(13).fontColor('#889AAF') }
      }
    }.onTouch((event: TouchEvent) => { if (event.type === TouchType.Down) this.fingerDownAt = Date.now(); else if (event.type === TouchType.Up || event.type === TouchType.Cancel) this.fingerDownAt = 0; }).onAxisEvent((event: AxisEvent) => { if (this.draggingText) return; const direction = this.axisPaging.move(event.getHorizontalAxisValue(), event.getVerticalAxisValue(), event.action); if (direction && !this.selectingText && Date.now() >= this.selectingUntil) this.onTurn(direction); }).onGestureJudgeBegin((info: GestureInfo, event: BaseGestureEvent) => (this.draggingText || (pointerSelection(event.source, event.sourceTool) || this.selectingText || Date.now() < this.selectingUntil || this.fingerDownAt > 0 && Date.now() - this.fingerDownAt > 300) && !info.isSystemGesture) && info.type === GestureControl.GestureType.PAN_GESTURE ? GestureJudgeResult.REJECT : GestureJudgeResult.CONTINUE).parallelGesture(PanGesture({ direction: PanDirection.Horizontal, distance: 24 }).onActionEnd((event: GestureEvent) => { if (!this.selectingText && Date.now() >= this.selectingUntil && Math.abs(event.offsetX) > 50 && Math.abs(event.offsetX) > Math.abs(event.offsetY) * 1.5) this.onTurn(event.offsetX > 0 ? -1 : 1); })).padding(12).width('100%').height('100%').backgroundColor(STUDY_SURFACE).borderRadius(STUDY_RADIUS)
  }
}
