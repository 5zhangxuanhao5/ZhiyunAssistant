import { CourseCollections } from '../model/CourseCollections';
import { CollectionActions } from './CollectionActions';
import { PhysicalInput } from '../services/PhysicalInput';
import { Account, Course, shanghaiDate, clockTime, copyStringMap, phase } from '../model/Timeline';
import { courseSections, CourseSection } from '../model/CourseSections';
import { LocalStore } from '../services/LocalStore';
import { Zhiyun, HistoryState } from '../services/Zhiyun';
import { DateCalendar } from './DateCalendar';
import { AttendanceBatchCache, attendanceBatch, reusableAttendanceBatch } from '../model/AttendanceBatch';
@Component
export struct MyCourses {
  collections: CourseCollections = new CourseCollections();
  @Prop collectionRevision: number = 0;
  @Prop account: Account;
  @Prop @Watch('seedChanged') currentCourses: Course[] = [];
  @Prop @Watch('activityChanged') active: boolean = true;
  @Prop @Watch('goBack') backSequence: number = 0;
  @Prop @Watch('refreshScope') refreshSequence: number = 0;
  onDiscovered: (courses: Course[], checking: boolean) => void = () => {};
  store: LocalStore | undefined = undefined;
  onBack: () => void = () => {};
  onEnter: (course: Course) => void = () => {};
  onDownload: (courses: Course[]) => void = () => {};
  @State courses: Course[] = [];
  @State permissions: Record<string, string> = {};
  @State byCourse: boolean = true;
  @State selectedCourse: string = '';
  @State selectedDate: string = '';
  @State calendarOpen: boolean = false;
  @State query: string = '';
  @State loading: boolean = false;
  @State status: string = '';
  @State checking: boolean = false;
  private input: PhysicalInput = new PhysicalInput();
  private api: Zhiyun = new Zhiyun();
  private accessApi: Zhiyun = new Zhiyun();
  private generation: number = 0;
  private disposed: boolean = false;
  private checked: Set<string> = new Set();
  private verified: Set<string> = new Set();
  private checkingAll: boolean = false;
  private accessGeneration: number = 0;
  private visible: Set<string> = new Set();
  private permissionTimer: number = -1;
  aboutToAppear(): void { this.disposed = false; this.api.usePermissionStorage(this.store); this.accessApi.usePermissionStorage(this.store); const cache = this.store?.loadMyAttendance(); this.merge(cache?.courses || []); this.seedChanged(); if (this.active) this.load(); }
  aboutToDisappear(): void { this.disposed = true; this.generation++; this.accessGeneration++; this.api.cancel(); this.accessApi.cancel(); clearTimeout(this.permissionTimer); }
  private seedChanged(): void { this.merge(this.currentCourses); }
  private merge(rows: Course[]): void { const map = new Map<string, Course>(); this.courses.concat(rows).filter((course: Course) => course.start <= Date.now() / 1000).forEach((course: Course) => map.set(course.subId, course)); this.courses = Array.from(map.values()).sort((a: Course, b: Course) => b.start - a.start); const states = copyStringMap(this.permissions); const cached = this.accessApi.cachedPermissions(this.courses); Object.keys(cached).forEach((id: string) => { if (!this.checked.has(id)) states[id] = cached[id]; }); this.permissions = states; if (this.checkingAll) { this.publishScope(); clearTimeout(this.permissionTimer); this.permissionTimer = setTimeout(() => this.checkVisible(), 80); } }
  private activityChanged(): void { if (!this.active) { this.generation++; this.accessGeneration++; this.api.cancel(); this.accessApi.cancel(); this.loading = false; this.checking = false; } else { this.checked.clear(); this.verified.clear(); this.seedChanged(); this.load(); this.checkVisible(); } }
  private refreshScope(): void { if (!this.active || this.disposed) return; this.accessGeneration++; this.accessApi.cancel(); this.checking = false; this.checked.clear(); this.verified.clear(); this.publishScope(); this.checkVisible(); }
  private cachedBatchIds: Set<string> = new Set();
  private reuseBatch(): void { this.cachedBatchIds.clear(); let cache: AttendanceBatchCache | undefined; try { cache = JSON.parse(this.store?.readJson('my-attendance-batch-v1.json') || '') as AttendanceBatchCache; } catch (_) {} const states = copyStringMap(this.permissions); reusableAttendanceBatch(this.courses, cache).forEach((course: Course) => { if (!this.checked.has(course.subId) && !this.verified.has(course.subId)) { this.cachedBatchIds.add(course.subId); states[course.subId] = 'allowed'; } }); this.permissions = states; }
  private permittedScope(): Course[] { return this.scope().filter((course: Course) => (this.verified.has(course.subId) || this.cachedBatchIds.has(course.subId)) && this.permissions[course.subId] === 'allowed'); }
  private publishScope(): void { if (this.checkingAll && !this.loading && !this.checking && this.courses.every((course: Course) => this.checked.has(course.subId))) this.store?.saveJson('my-attendance-batch-v1.json', JSON.stringify(attendanceBatch(this.courses, this.courses.filter((course: Course) => this.verified.has(course.subId) && this.permissions[course.subId] === 'allowed')))); this.onDiscovered(this.permittedScope(), this.loading || this.checking || this.checkingAll && this.scope().some((course: Course) => !this.checked.has(course.subId))); }
  @Prop @Watch('resetRoot') homeSequence: number = 0;
  private resetRoot(): void { this.selectedCourse = ''; this.selectedDate = ''; this.calendarOpen = false; }
  private goBack(): void { if (!this.active) return; if (this.calendarOpen) this.calendarOpen = false; else if (this.selectedCourse) this.selectedCourse = ''; else if (this.selectedDate) this.selectedDate = ''; else this.onBack(); }
  private async load(force: boolean = false): Promise<void> {
    if (this.loading || !this.active || this.disposed) return;
    const gen = this.generation; this.loading = true; this.status = '正在读取上课记录';
    try {
      const cached = this.store?.loadMyAttendance();
      if (force || cached?.complete) { const recent = await this.api.courses(this.account); if (gen !== this.generation) return; this.replaceRecent(recent); }
      let state: HistoryState = { courses: this.courses.slice(), cursor: cached?.cursor || shanghaiDate(Date.now() / 1000), emptyWindows: 0, complete: cached?.complete || false };
      let weeks = 0;
      while (!state.complete && gen === this.generation) {
        const result = await this.api.attendanceHistory(this.account, (done: number, total: number, progress?: HistoryState) => {
          if (gen !== this.generation || !progress) return;
          this.merge(progress.courses); this.store?.saveMyAttendance(this.courses, progress.cursor, progress.complete);
          this.status = '正在补充上课记录 · 已读取 ' + (weeks + done) + ' 周';
        }, state);
        if (gen !== this.generation) return;
        this.merge(result.courses); this.store?.saveMyAttendance(this.courses, result.cursor, result.complete); weeks += result.windowsDone;
        if (result.failed) { this.status = '部分记录暂时无法读取，进度已保存，可点刷新重试'; return; }
        state = { courses: this.courses.slice(), cursor: result.cursor, emptyWindows: 0, complete: result.complete };
      }
      try { await this.api.annotateTerms(this.account, this.courses, this.store); if (gen !== this.generation) return; this.courses = this.courses.slice(); } catch (_) {}
      if (state.complete) this.store?.saveMyAttendance(this.courses, state.cursor, true);
      this.status = '';
    } catch (_) { if (gen === this.generation) this.status = '上课记录读取失败，已保留已加载的课程'; }
    finally { if (gen === this.generation) { this.loading = false; if (this.checkingAll) this.publishScope(); } }
  }
  private replaceRecent(rows: Course[]): void { const cutoff = shanghaiDate(Date.now() / 1000 - 14 * 86400), ids = new Set(rows.map((course: Course) => course.subId)); this.courses = this.courses.filter((course: Course) => shanghaiDate(course.start) < cutoff || ids.has(course.subId)); this.merge(rows); if (this.cachedBatchIds.size) this.reuseBatch(); }
  private scope(): Course[] { return this.courses.filter((course: Course) => (!this.selectedCourse || course.courseId === this.selectedCourse) && (!this.selectedDate || shanghaiDate(course.start) === this.selectedDate) && (!this.query.trim() || (course.title + course.teacher + (course.term || '')).toLowerCase().includes(this.query.trim().toLowerCase()))); }
  private sections(): CourseSection[] { return courseSections(this.scope(), this.byCourse); }
  private currentSection(section: CourseSection): CourseSection { return this.sections().find((value: CourseSection) => value.id === section.id) || section; }
  private markVisible(id: string, visible: boolean): void { if (visible) this.visible.add(id); else this.visible.delete(id); clearTimeout(this.permissionTimer); this.permissionTimer = setTimeout(() => this.checkVisible(), 80); }
  private async checkVisible(): Promise<void> {
    if (this.checking || !this.active || this.disposed) return;
    const rows = this.scope().filter((course: Course) => (this.checkingAll || this.visible.has(course.subId)) && !this.checked.has(course.subId)); if (!rows.length) { this.publishScope(); return; }
    this.checking = true; const gen = this.generation, accessGen = this.accessGeneration; this.publishScope();
    try { await this.accessApi.permissions(rows, (states: Record<string, string>, confirmed?: string[]) => { if (gen !== this.generation || accessGen !== this.accessGeneration) return; const next = copyStringMap(this.permissions); Object.keys(states).forEach((id: string) => next[id] = states[id]); this.permissions = next; (confirmed || []).forEach((id: string) => { this.cachedBatchIds.delete(id); this.verified.add(id); }); this.publishScope(); }, true); }
    catch (_) {}
    finally { if (gen === this.generation && accessGen === this.accessGeneration) { rows.forEach((course: Course) => this.checked.add(course.subId)); this.checking = false; this.publishScope(); this.checkVisible(); } }
  }
  private enter(course: Course): void { const state = this.permissions[course.subId] || 'unknown'; if (state === 'allowed') this.onEnter(course); else this.getUIContext().getPromptAction().showToast({ message: state === 'denied' ? '当前账号需要申请访问权限' : '正在确认访问权限，请稍等', duration: 1800 }); }
  private download(): void { this.reuseBatch(); this.checkingAll = true; this.onDownload(this.permittedScope()); this.publishScope(); this.checkVisible(); }
  @Builder
  private lessonRow(course: Course) {
    Row({ space: 12 }) {
      Column({ space: 6 }) { Text(course.title).fontSize(17).fontWeight(FontWeight.Medium).fontColor('#20344D').maxLines(2); Text(shanghaiDate(course.start) + ' ' + clockTime(course.start) + '–' + clockTime(course.end)).fontSize(12).fontColor('#7C899A'); Text(course.teacher + '  ' + course.room).fontSize(12).fontColor('#7C899A') }.layoutWeight(1).alignItems(HorizontalAlign.Start)
      Row({ space: 4 }) { CollectionActions({ collections: this.collections, revision: this.collectionRevision, course, lesson: true })
      Button(this.permissions[course.subId] === 'denied' ? '需申请' : this.permissions[course.subId] === 'allowed' ? '进入学习' : '确认中').height(36).fontSize(12).fontColor('#168BEE').backgroundColor('#EAF4FF').onClick(() => this.enter(course))
      }.alignItems(VerticalAlign.Center)
    }.width('100%').padding(16).backgroundColor('#FFFFFF').borderRadius(14)
  }
  build() {
    if (this.calendarOpen) { DateCalendar({ courses: this.courses, selectedDate: this.selectedDate || shanghaiDate(Date.now() / 1000), onClose: () => this.calendarOpen = false, onSelect: (date: string) => { this.selectedDate = date; this.calendarOpen = false; } }).layoutWeight(1) } else {
      Column({ space: 12 }) {
        Row({ space: 8 }) { Button(this.selectedCourse ? '‹ 所有课程' : '‹ 我的课堂').height(32).fontSize(12).backgroundColor('#EAF4FF').fontColor('#168BEE').onClick(() => this.goBack()); Text(this.selectedCourse ? this.courses.find((course: Course) => course.courseId === this.selectedCourse)?.title || '课次' : '所有课程').fontSize(20).fontWeight(FontWeight.Bold).fontColor('#20344D').maxLines(1).layoutWeight(1); Button('刷新').height(32).fontSize(12).backgroundColor('#EAF4FF').fontColor('#168BEE').onClick(() => { this.refreshScope(); this.load(true); }) }.width('100%')
        Row({ space: 8 }) { Button('按课程').height(32).fontSize(12).backgroundColor(this.byCourse ? '#DDEEFF' : '#EAF4FF').fontColor('#168BEE').onClick(() => { this.byCourse = true; this.selectedDate = ''; this.selectedCourse = ''; }); Button('按日期').height(32).fontSize(12).backgroundColor(this.byCourse ? '#EAF4FF' : '#DDEEFF').fontColor('#168BEE').onClick(() => { this.byCourse = false; this.selectedDate = ''; this.selectedCourse = ''; }); Blank(); Button('批量下载').height(32).fontSize(12).backgroundColor('#EAF4FF').fontColor('#168BEE').onClick(() => this.download()) }.width('100%')
        TextInput({ text: this.query, controller: this.input.controller, placeholder: '搜索我的课程或教师' }).height(40).backgroundColor('#FFFFFF').onChange((value: string) => this.query = value).onKeyPreIme((event: KeyEvent): boolean => this.input.digit(event, this.query, (value: string) => this.query = value)).onBlur(() => this.input.reset())
        if (!this.byCourse) { Row({ space: 8 }) { Button('▦ ' + (this.selectedDate || '选择日期')).height(30).fontSize(12).fontColor('#168BEE').backgroundColor('#EAF4FF').onClick(() => this.calendarOpen = true); if (this.selectedDate) { Button('全部日期').height(30).fontSize(12).fontColor('#168BEE').backgroundColor(Color.Transparent).onClick(() => this.selectedDate = '') } Blank(); Text(this.scope().length + ' 节上课记录').fontSize(12).fontColor('#71839A') }.width('100%') }
        Row({ space: 8 }) { if (this.byCourse) { Text(this.scope().length + ' 节上课记录').fontSize(12).fontColor('#71839A') } if (this.loading || this.checking) { LoadingProgress().width(18).height(18).color('#168BEE') } if (this.status) { Text(this.status).fontSize(11).fontColor('#71839A').layoutWeight(1) } if (this.selectedCourse && this.scope().length) { Blank(); CollectionActions({ collections: this.collections, revision: this.collectionRevision, course: this.scope()[0], known: this.scope() }) } }.width('100%')
        List({ space: 10 }) {
          if (this.byCourse && !this.selectedCourse) {
            ForEach(this.sections(), (section: CourseSection) => { ListItem() {
              Row({ space: 12 }) { Column({ space: 6 }) { Text(section.title).fontSize(18).fontWeight(FontWeight.Medium).fontColor('#20344D').maxLines(2); Text([this.currentSection(section).courses[0]?.teacher || '', this.currentSection(section).courses[0]?.term || ''].filter((value: string) => !!value).join(' · ')).fontSize(12).fontColor('#7C899A').maxLines(2); Text(this.currentSection(section).courses.length + ' 节 · 最近 ' + shanghaiDate(this.currentSection(section).courses[0].start)).fontSize(11).fontColor('#889AAF') }.layoutWeight(1).alignItems(HorizontalAlign.Start).onClick(() => { this.selectedCourse = section.id; this.visible.clear(); }); CollectionActions({ collections: this.collections, revision: this.collectionRevision, course: section.courses[0], known: this.currentSection(section).courses }); Button('进入课程').height(36).fontSize(12).fontColor('#168BEE').backgroundColor(Color.Transparent).onClick(() => { this.selectedCourse = section.id; this.visible.clear(); }) }.width('100%').padding(18).backgroundColor('#FFFFFF').borderRadius(14)
            } }, (section: CourseSection) => section.id)
          } else if (this.byCourse) {
            ForEach(this.scope(), (course: Course) => { ListItem() { this.lessonRow(course) }.onVisibleAreaChange([0.1], (visible: boolean) => this.markVisible(course.subId, visible)) }, (course: Course) => course.subId)
          } else {
            ForEach(this.sections(), (section: CourseSection) => { ListItem() { Text(section.title).fontSize(15).fontWeight(FontWeight.Medium).fontColor('#526B83').padding({ top: 8, bottom: 4 }) }; ForEach(section.courses, (course: Course) => { ListItem() { this.lessonRow(course) }.onVisibleAreaChange([0.1], (visible: boolean) => this.markVisible(course.subId, visible)) }, (course: Course) => course.subId) }, (section: CourseSection) => section.id)
          }
          if (!this.scope().length && !this.loading) { ListItem() { Text(this.query || this.selectedDate ? '没有符合条件的上课记录' : '暂未找到你的上课记录').fontSize(13).fontColor('#7C899A').padding(20) } }
        }.layoutWeight(1).width('100%').padding({ right: 12, bottom: 20 }).scrollBar(BarState.Auto)
      }.width('100%').height('100%').padding(20)
    }
  }
}
