import { PhysicalInput } from '../services/PhysicalInput';
import { Account, Course, shanghaiDate, clockTime, copyStringMap } from '../model/Timeline';
import { CourseSection, CalendarCell, calendarMonthGrid, courseSections, shiftCalendarMonth, scopeSelected, toggleScopedSelection } from '../model/CourseSections';
import { LocalStore } from '../services/LocalStore';
import { HistoryState, Zhiyun } from '../services/Zhiyun';
import { DownloadOptions } from '../services/OfflineLibrary';

@Component
export struct DownloadSheet {
  private searchInput: PhysicalInput = new PhysicalInput();

  @Prop @Watch('goBack') backSequence: number = 0;
  @Prop @Watch('discoveriesChanged') discoveries: Course[] = [];
  @Prop discovering: boolean = false;
  onRefreshScope: () => void = () => {};
  @State newLessons: number = 0;
  private discoveriesChanged(): void { const existing = new Set(this.available.map((course: Course) => course.subId)); this.newLessons = this.discoveries.filter((course: Course) => !existing.has(course.subId)).length; }
  private applyDiscoveries(): void { const next = copyStringMap(this.accessStates); this.discoveries.forEach((course: Course) => { next[course.subId] = 'allowed'; this.verified.add(course.subId); }); this.accessStates = next; this.mergeAvailable(this.discoveries); this.discoveriesChanged(); }
  @Prop scoped: boolean = false;
  @Prop fullPage: boolean = false;
  @Prop courses: Course[] = [];
  @Prop account: Account | undefined = undefined;
  store: LocalStore | undefined = undefined;
  @State accessStates: Record<string, string> = {};
  @State checkingAccess: boolean = false;
  private verified: Set<string> = new Set();
  private accessTimer: number = -1;
  private accessTask: Promise<void> | undefined = undefined;
  @State available: Course[] = [];
  @State byCourse: boolean = false;
  @State selectedCourseId: string = '';
  @State selectedDate: string = '';
  @State calendarMonth: string = '';
  @State calendarOpen: boolean = false;
  @State searchText: string = '';
  @State loading: boolean = false;
  @State historyProgress: string = '';
  @State notice: string = '';
  @State historyComplete: boolean = false;
  private api: Zhiyun = new Zhiyun();
  private epoch: number = 0;
  private disposed: boolean = false;
  private lifetime: number = 0;
  private continueTimer: number = -1;
  private cataloguesLoading: Set<string> = new Set();
  onClose: () => void = () => {};
  onDownload: (courses: Course[], options: DownloadOptions) => void = () => {};
  @State video: boolean = true;
  @State slides: boolean = true;
  @State transcript: boolean = true;
  @State chosen: string[] = [];
  @State sheetHeight: number = 800;
  @State catalogueBusy: string[] = [];
  aboutToAppear(): void {
    this.disposed = false; this.lifetime++; this.verified.clear(); this.api.usePermissionStorage(this.store);
    this.available = this.courses.filter((course: Course) => course.start <= Date.now() / 1000);
    this.accessStates = this.api.cachedPermissions(this.available); if (this.scoped) { const states = copyStringMap(this.accessStates); this.available.forEach((course: Course) => { states[course.subId] = 'allowed'; this.verified.add(course.subId); }); this.accessStates = states; } else this.refreshAccess();
    this.chosen = [];
    this.calendarMonth = this.courses.length ? shanghaiDate(this.courses.slice().sort((a: Course, b: Course) => b.start - a.start)[0].start).slice(0, 7) : shanghaiDate(Date.now() / 1000).slice(0, 7);
    if (this.scoped) { this.byCourse = true; this.historyComplete = true; this.discoveriesChanged(); return; }
    const cache = this.store?.loadAttendanceHistoryState();
    if (cache) {
      this.mergeAvailable(cache.courses);
      this.historyComplete = cache.complete;
      this.calendarMonth = this.available.length ? shanghaiDate(this.available[0].start).slice(0, 7) : this.calendarMonth;
    }
    if (!this.available.length) this.historyComplete = false;
    if (this.account && !this.historyComplete) this.loadHistory();
  }
  aboutToDisappear(): void { this.disposed = true; clearTimeout(this.noticeTimer); clearTimeout(this.continueTimer); clearTimeout(this.accessTimer); this.lifetime++; this.epoch++; this.api.cancel(); }
  private goBack(): void { if (this.backSequence <= 0) return; if (this.calendarOpen) this.calendarOpen = false; else if (this.selectedCourseId) this.selectedCourseId = ''; else this.onClose(); }
  private selected(section: CourseSection): boolean { return scopeSelected(this.chosen, section.courses); }
  private toggleSection(section: CourseSection): void {
    this.chosen = toggleScopedSelection(this.chosen, section.courses);
  }
  private mergeAvailable(courses: Course[]): void {
    const map = new Map<string, Course>();
    this.available.concat(courses.filter((course: Course) => course.start <= Date.now() / 1000)).forEach((item: Course) => map.set(item.subId, item));
    const next = Array.from(map.values()).sort((a: Course, b: Course) => b.start - a.start);
    if (JSON.stringify(next) !== JSON.stringify(this.available)) { this.available = next; clearTimeout(this.accessTimer); this.accessTimer = setTimeout(() => this.refreshAccess(), 100); }
  }
  private async refreshAccess(force: boolean = false): Promise<void> {
    if (this.disposed) return;
    if (this.accessTask) { await this.accessTask; if (this.available.some((course: Course) => !this.verified.has(course.subId))) await this.refreshAccess(); return; }
    if (force) this.verified.clear(); const rows = this.available.filter((course: Course) => !this.verified.has(course.subId)); if (!rows.length) return;
    const gen = this.lifetime; this.checkingAccess = true;
    const task = this.api.permissions(rows, (states: Record<string, string>) => { if (gen !== this.lifetime) return; const next = copyStringMap(this.accessStates); Object.keys(states).forEach((id: string) => next[id] = states[id]); this.accessStates = next; }, true).then(() => { if (gen === this.lifetime) rows.forEach((course: Course) => this.verified.add(course.subId)); }).catch(() => { if (gen === this.lifetime) rows.forEach((course: Course) => this.verified.add(course.subId)); });
    this.accessTask = task; await task; this.accessTask = undefined; if (gen === this.lifetime) { this.checkingAccess = false; if (this.available.some((course: Course) => !this.verified.has(course.subId))) await this.refreshAccess(); }
  }
  private permitted(): Course[] { return this.available.filter((course: Course) => this.accessStates[course.subId] === 'allowed'); }
  private async loadHistory(force: boolean = false): Promise<void> {
    if (this.scoped || this.loading || this.historyComplete && !force || !this.account) return;
    if (force) this.refreshAccess(true);
    this.loading = true; this.notice = ''; this.historyProgress = '正在读取上课记录…'; const gen = ++this.epoch;
    try {
      const cached = this.store?.loadAttendanceHistoryState();
      if (force) {
        const rows = await this.api.courses(this.account);
        if (gen !== this.epoch) return;
        this.mergeAvailable(rows.filter((course: Course) => course.end < Date.now() / 1000));
        this.store?.saveAttendanceHistory(this.available, cached?.cursor || '', 0, cached?.complete || false);
        this.historyComplete = cached?.complete || false; this.showUpdatedNotice();
        return;
      }
      let initial: HistoryState = { courses: this.available.slice(), cursor: cached?.cursor || shanghaiDate(Date.now() / 1000), emptyWindows: 0, complete: false };
      let weeksRead = 0;
      while (gen === this.epoch) {
        const result = await this.api.attendanceHistory(this.account, (done: number, total: number, state?: HistoryState) => {
          if (gen !== this.epoch) return;
          if (state) {
            this.mergeAvailable(state.courses);
            if (done % 3 === 0 || state.complete) this.store?.saveAttendanceHistory(this.available, state.cursor, 0, state.complete);
          }
          this.historyProgress = `正在补充历史课次 · 已读取 ${weeksRead + done} 周`;
        }, initial);
        if (gen !== this.epoch) return;
        this.mergeAvailable(result.courses); this.historyComplete = result.complete;
        this.store?.saveAttendanceHistory(this.available, result.cursor, 0, result.complete);
        weeksRead += result.windowsDone;
        if (result.failed) { this.notice = '部分课表暂时无法读取，进度已保存，可点“继续读取”重试'; break; }
        if (result.complete) { this.notice = this.available.length ? '历史课次已更新' : '课表中暂时没有已上过的课程'; break; }
        initial = { courses: this.available.slice(), cursor: result.cursor, emptyWindows: 0, complete: false };
        await new Promise<void>((resolve) => setTimeout(resolve, 120));
      }
    } catch (_) { if (gen === this.epoch) this.notice = '上课记录读取失败，已保留同步进度，可稍后重试'; }
    finally { if (gen === this.epoch) { this.loading = false; this.historyProgress = ''; } }
  }
  private async openCourse(courseId: string): Promise<void> { this.selectedCourseId = courseId; await this.ensureCourse(courseId); }
  private async ensureCourse(courseId: string): Promise<void> {
    if (this.scoped) return;
    const course = this.available.find((item: Course) => item.courseId === courseId);
    if (!course || this.cataloguesLoading.has(courseId)) return;
    const cached = this.store?.loadCatalogue(courseId);
    if (cached) { this.mergeAvailable(cached.filter((item: Course) => item.end < Date.now() / 1000)); await this.refreshAccess(); return; }
    const gen = this.lifetime;
    this.cataloguesLoading.add(courseId); this.catalogueBusy = this.catalogueBusy.concat([courseId]);
    try {
      const rows = await this.api.chapters({ courseId, title: course.title, teacher: course.teacher, room: course.room, type: '' });
      if (gen !== this.lifetime) return;
      this.store?.saveCatalogue(courseId, rows);
      this.mergeAvailable(rows.filter((item: Course) => item.end < Date.now() / 1000));
      await this.refreshAccess();
      const state = this.store?.loadAttendanceHistoryState();
      this.store?.saveAttendanceHistory(this.available, state?.cursor || '', 0, state?.complete || false);
    } catch (_) { if (gen === this.lifetime) this.notice = '本课程目录暂时无法读取，已显示缓存课次'; }
    finally { this.cataloguesLoading.delete(courseId); this.catalogueBusy = this.catalogueBusy.filter((id: string) => id !== courseId); }
  }
  private async setMode(course: boolean): Promise<void> {
    this.byCourse = course; this.selectedCourseId = ''; this.selectedDate = ''; this.calendarOpen = false;
    await this.loadHistory();
  }
  private toggle(id: string): void { this.chosen = this.chosen.includes(id) ? this.chosen.filter((s: string) => s !== id) : this.chosen.concat([id]); }
  private selectedCount(courseId: string): number { return this.available.filter((c: Course) => c.courseId === courseId && this.chosen.includes(c.subId)).length; }
  private dateCount(section: CourseSection): number { return new Set(section.courses.map((c: Course) => shanghaiDate(c.start))).size; }
  private courseTitle(courseId: string): string { return this.available.find((c: Course) => c.courseId === courseId)?.title || '课程'; }
  private async toggleCourse(courseId: string): Promise<void> {
    if (this.cataloguesLoading.has(courseId)) return;
    const existing = this.permitted().filter((course: Course) => course.courseId === courseId);
    if (scopeSelected(this.chosen, existing)) { this.chosen = toggleScopedSelection(this.chosen, existing); return; }
    const gen = this.lifetime;
    await this.ensureCourse(courseId);
    if (gen !== this.lifetime) return;
    const ids = this.permitted().filter((course: Course) => course.courseId === courseId).map((course: Course) => course.subId);
    this.chosen = Array.from(new Set(this.chosen.concat(ids)));
  }
  private selectionScope(): Course[] {
    if (this.byCourse && !this.selectedCourseId) return this.filteredSections(true).reduce((rows: Course[], section: CourseSection): Course[] => rows.concat(section.courses), []);
    return this.filteredCourses();
  }
  private noticeTimer: number = -1;
  private showUpdatedNotice(): void { clearTimeout(this.noticeTimer); this.notice = '课表已更新'; const gen = this.epoch; this.noticeTimer = setTimeout(() => { if (!this.disposed && gen === this.epoch && this.notice === '课表已更新') this.notice = ''; }, 2000); }
  private calendarDayHeight(): number { return Math.max(28, Math.min(52, (this.sheetHeight - 208) / 6)); }
  private calendarRows(): string { const h = this.calendarDayHeight() + 'vp'; return '28vp ' + h + ' ' + h + ' ' + h + ' ' + h + ' ' + h + ' ' + h; }

  private monthTitle(): string { return this.calendarMonth.replace('-', '年') + '月'; }
  private shiftMonth(amount: number): void {
    this.calendarMonth = shiftCalendarMonth(this.calendarMonth, amount);
  }
  private calendarCells(): CalendarCell[] { return calendarMonthGrid(this.calendarMonth, this.permitted()); }
  private dateEmptyMessage(): string {
    if (this.byCourse || !this.selectedDate || this.filteredCourses().length) return '';
    return this.discovering || this.checkingAccess || this.loading ? '当天暂无已确认可下载的课程，正在后台检查，可稍后刷新' : '当天暂无可下载的课程，可选择其他日期';
  }
  private filteredCourses(): Course[] {
    if (this.byCourse && this.selectedCourseId) return this.permitted().filter((c: Course) => c.courseId === this.selectedCourseId);
    if (!this.byCourse && this.selectedDate) return this.permitted().filter((c: Course) => shanghaiDate(c.start) === this.selectedDate);
    return this.permitted();
  }
  private filteredSections(byCourse: boolean): CourseSection[] {
    let sections = courseSections(this.filteredCourses(), byCourse);
    if (byCourse && !this.selectedCourseId && this.searchText.trim()) {
      const query = this.searchText.trim().toLowerCase();
      sections = sections.filter((section: CourseSection) => section.title.toLowerCase().includes(query) || section.courses[0]?.teacher.toLowerCase().includes(query));
    }
    return sections;
  }
  @Builder
  private lessonRow(c: Course) {
    Row({ space: 12 }) {
      Text(this.chosen.includes(c.subId) ? '✓' : '○').fontSize(20).fontColor('#168BEE')
      Column({ space: 4 }) {
        Text(c.title).fontSize(15).fontColor('#20344D').maxLines(2)
        Text(`${shanghaiDate(c.start)} ${clockTime(c.start)} · ${c.teacher}`).fontSize(11).fontColor('#7C899A')
      }.layoutWeight(1).alignItems(HorizontalAlign.Start)
    }.padding(12).width('100%').backgroundColor(this.chosen.includes(c.subId) ? '#EAF4FF' : '#FFFFFF').borderRadius(10).onClick(() => this.toggle(c.subId))
  }
  @Builder
  private calendarPanel() {
    Column({ space: 12 }) {
      Row({ space: 8 }) {
        Button('«').accessibilityText('上一年').width(32).height(32).backgroundColor('#F1F3F5').fontColor('#168BEE').onClick(() => this.shiftMonth(-12))
        Button('‹').accessibilityText('上个月').width(32).height(32).backgroundColor('#F1F3F5').fontColor('#168BEE').onClick(() => this.shiftMonth(-1))
        Text(this.monthTitle()).fontSize(16).fontWeight(FontWeight.Medium).fontColor('#20344D').layoutWeight(1).textAlign(TextAlign.Center)
        Button('›').width(36).height(32).backgroundColor('#F1F3F5').fontColor('#168BEE').onClick(() => this.shiftMonth(1))
        Button('»').accessibilityText('下一年').width(32).height(32).backgroundColor('#F1F3F5').fontColor('#168BEE').onClick(() => this.shiftMonth(12))
        Button('取消').height(30).fontSize(12).backgroundColor(Color.Transparent).fontColor('#168BEE').onClick(() => this.calendarOpen = false)
      }.width('100%')
      Row() {
        ForEach(['一', '二', '三', '四', '五', '六', '日'], (label: string) => { Text(label).layoutWeight(1).height(28).fontSize(12).fontColor('#8A9CB0').textAlign(TextAlign.Center) }, (label: string) => label)
      }.width('100%')
      Column({ space: 4 }) {
        ForEach([0, 1, 2, 3, 4, 5], (week: number) => {
          Row({ space: 4 }) {
            ForEach(this.calendarCells().slice(week * 7, week * 7 + 7), (cell: CalendarCell) => {
              Button({ type: ButtonType.Normal }) {
                Column({ space: 2 }) {
                  Text(cell.day).fontSize(15).fontWeight(cell.count ? FontWeight.Medium : FontWeight.Normal).fontColor(cell.count ? '#168BEE' : cell.inMonth ? '#68778B' : '#CAD1DA')
                  Text(cell.count ? String(cell.count) + '节' : ' ').fontSize(9).fontColor('#168BEE')
                }.width('100%').justifyContent(FlexAlign.Center)
              }.layoutWeight(1).height(this.calendarDayHeight()).padding(0).backgroundColor(this.selectedDate === cell.date ? '#DDEEFF' : Color.Transparent).borderRadius(10).enabled(cell.inMonth)
                .onClick(() => { this.selectedDate = cell.date; this.calendarOpen = false; })
            }, (cell: CalendarCell) => cell.key)
          }.width('100%')
        }, (week: number) => String(week))
      }.width('100%')
      Text('所有日期均可选择 · 蓝色日期已有可下载课程').fontSize(11).fontColor('#7C899A').width('100%')
    }.padding(14).width('100%').backgroundColor('#FFFFFF').borderRadius(12)
      .parallelGesture(PanGesture({ direction: PanDirection.Horizontal, distance: 12 }).onActionEnd((event: GestureEvent) => { if (Math.abs(event.offsetX) >= 30) this.shiftMonth(event.offsetX < 0 ? 1 : -1); }))
  }
  build() {
    Column({ space: 12 }) {
      Row() {
        Text('下载课程').fontSize(22).fontWeight(FontWeight.Bold).fontColor('#20344D')
        Blank()
        Button(this.fullPage ? '返回' : '关闭').height(30).fontSize(12).fontColor('#168BEE').backgroundColor('#F1F3F5').onClick(() => this.onClose())
      }.width('100%')
      if (this.calendarOpen) { this.calendarPanel() } else {
      Row({ space: 8 }) {
        Button(this.video ? '✓ 视频' : '视频').height(32).fontSize(13).fontColor('#168BEE').backgroundColor(this.video ? '#DDEEFF' : '#EAF4FF').onClick(() => this.video = !this.video)
        Button(this.slides ? '✓ 课件' : '课件').height(32).fontSize(13).fontColor('#168BEE').backgroundColor(this.slides ? '#DDEEFF' : '#EAF4FF').onClick(() => this.slides = !this.slides)
        Button(this.transcript ? '✓ 转写' : '转写').height(32).fontSize(13).fontColor('#168BEE').backgroundColor(this.transcript ? '#DDEEFF' : '#EAF4FF').onClick(() => this.transcript = !this.transcript)
      }.width('100%')
      Row({ space: 8 }) {
        Button('▦ 按日期').height(32).fontSize(13).fontColor('#168BEE').backgroundColor(!this.byCourse ? '#DDEEFF' : '#EAF4FF').onClick(() => this.setMode(false))
        Button('按课程').height(32).fontSize(13).fontColor('#168BEE').backgroundColor(this.byCourse ? '#DDEEFF' : '#EAF4FF').onClick(() => this.setMode(true))
        if (this.scoped) {
          if (!this.newLessons) { Blank() }
          if (this.discovering) { LoadingProgress().width(18).height(18).color('#168BEE') }
          if (this.newLessons > 0) { Button('新增 ' + this.newLessons + ' 节 · 更新').layoutWeight(1).height(30).fontSize(10).fontColor('#168BEE').backgroundColor(Color.Transparent).onClick(() => this.applyDiscoveries()) }
          Button('刷新').height(30).fontSize(12).fontColor('#168BEE').backgroundColor('#EAF4FF').onClick(() => { this.applyDiscoveries(); this.onRefreshScope(); })
        }
        if (this.loading) { LoadingProgress().width(20).height(20).color('#168BEE') }
        if (this.historyProgress) { Text(this.historyProgress).fontSize(11).fontColor('#71839A').layoutWeight(1) }
        else if (!this.historyComplete && this.account) { Button('继续读取').height(28).fontSize(11).fontColor('#168BEE').backgroundColor('#F1F3F5').onClick(() => this.loadHistory()) }
        else if (this.historyComplete && this.account && !this.scoped) { Button('刷新课表').height(28).fontSize(11).fontColor('#168BEE').backgroundColor('#F1F3F5').onClick(() => this.loadHistory(true)) }
      }.width('100%')
      if (this.scoped && !this.permitted().length) { Text(this.discovering ? '暂无已确认可下载的课程，正在后台确认权限' : '当前范围内没有可下载的有权限课程').fontSize(13).fontColor('#71839A').width('100%') }
      if (this.checkingAccess) { Text('正在确认可下载课次…').fontSize(12).fontColor('#71839A').width('100%') }
      if (this.notice) { Text(this.notice).fontSize(12).fontColor('#AE6B41').width('100%') }
      if (this.byCourse && !this.selectedCourseId) {
        TextInput({ controller: this.searchInput.controller, text: this.searchText, placeholder: '搜索已上过的课程' }).onKeyPreIme((event: KeyEvent): boolean => this.searchInput.digit(event, this.searchText, (value: string) => this.searchText = value)).height(40).backgroundColor('#FFFFFF').onChange((value: string) => this.searchText = value).onBlur(() => this.searchInput.reset())
      }
      if (this.byCourse && this.selectedCourseId) {
        Row({ space: 8 }) {
          Button('‹ 课程').height(30).fontSize(12).fontColor('#168BEE').backgroundColor('#F1F3F5').onClick(() => this.selectedCourseId = '')
          Text(this.courseTitle(this.selectedCourseId)).fontSize(14).fontWeight(FontWeight.Medium).fontColor('#294765').layoutWeight(1).maxLines(1)

        }.width('100%')
      } else if (this.byCourse) { Text('按最近上课时间排序 · 选择课程后可查看各日期课次').fontSize(12).fontColor('#71839A').width('100%') }
      else {
        Row({ space: 8 }) {
          Button('▦ ' + (this.selectedDate || '跳转日期')).height(30).fontSize(12).fontColor('#168BEE').backgroundColor('#F1F3F5').onClick(() => this.calendarOpen = !this.calendarOpen)
          if (this.selectedDate) { Button('显示全部日期').height(30).fontSize(12).fontColor('#168BEE').backgroundColor(Color.Transparent).onClick(() => this.selectedDate = '') }
          Blank()
          Text('按最近上课时间排序').fontSize(11).fontColor('#7C899A')
        }.width('100%')
      }
      if (this.dateEmptyMessage()) { Text(this.dateEmptyMessage()).fontSize(13).fontColor('#71839A').width('100%') }
      Column({ space: 8 }) {
        Row() {
          Text(`已选 ${this.chosen.length} 节`).fontSize(12).fontColor('#7C899A')
          Blank()
          Button(scopeSelected(this.chosen, this.selectionScope()) ? '取消全选' : '全选').height(28).fontSize(12).fontColor('#168BEE').backgroundColor(Color.Transparent).onClick(() => this.chosen = toggleScopedSelection(this.chosen, this.selectionScope()))
        }.width('100%')
        List({ space: 8 }) {
          if (!this.byCourse) {
            ForEach(this.filteredSections(false), (section: CourseSection) => {
              ListItem() {
                Row() {
                  Text(section.title).fontSize(15).fontWeight(FontWeight.Medium).fontColor('#294765').layoutWeight(1)
                  Button(this.selected(section) ? '取消全选' : '全选').height(28).fontSize(12).fontColor('#168BEE').backgroundColor(Color.Transparent).onClick(() => this.toggleSection(section))
                }.width('100%').padding({ top: 10, bottom: 4 })
              }
              ForEach(section.courses, (c: Course) => { ListItem() { this.lessonRow(c) } }, (c: Course) => c.subId)
            }, (section: CourseSection) => section.id)
          } else if (!this.selectedCourseId) {
            ForEach(this.filteredSections(true), (section: CourseSection) => {
              ListItem() {
                Row({ space: 12 }) {
                  Column({ space: 4 }) { Text(section.title).fontSize(15).fontWeight(FontWeight.Medium).fontColor('#20344D').maxLines(2); Text(`${this.dateCount(section)} 个日期 · 已选 ${this.selectedCount(section.id)} 节`).fontSize(11).fontColor('#7C899A') }.layoutWeight(1).alignItems(HorizontalAlign.Start).onClick(() => this.openCourse(section.id))
                  Button(this.catalogueBusy.includes(section.id) ? '读取中' : this.selected(section) ? '取消全选' : '全选').height(30).fontSize(12).fontColor('#168BEE').backgroundColor('#F1F3F5').enabled(!this.catalogueBusy.includes(section.id)).onClick(() => this.toggleCourse(section.id))
                  Text('›').fontSize(22).fontColor('#168BEE').onClick(() => this.openCourse(section.id))
                }.width('100%').padding(14).backgroundColor('#FFFFFF').borderRadius(10)
              }
            }, (section: CourseSection) => section.id)
          } else {
            ForEach(this.filteredCourses().slice().sort((a: Course, b: Course) => b.start - a.start), (c: Course) => { ListItem() { this.lessonRow(c) } }, (c: Course) => c.subId)
          }
        }.id('download-course-list').width('100%').layoutWeight(1)
      }.width('100%').layoutWeight(1)
      Text('下载可暂停，稍后可在离线课程中继续。').fontSize(11).fontColor('#7C899A').width('100%')
      Button(`下载 ${this.chosen.length} 节课程`).height(42).width('100%').fontSize(15).fontColor('#FFFFFF').backgroundColor('#168BEE').enabled(this.chosen.length > 0 && (this.video || this.slides || this.transcript))
        .onClick(() => { this.onDownload(this.permitted().filter((c: Course) => this.chosen.includes(c.subId)), { video: this.video, slides: this.slides, transcript: this.transcript }); this.onClose(); })
      }
    }.id('batch-download-content').width('100%').height('100%').padding(20).backgroundColor('#F4F7FB').onAreaChange((oldArea: Area, area: Area) => this.sheetHeight = Number(area.height))
  }
}
