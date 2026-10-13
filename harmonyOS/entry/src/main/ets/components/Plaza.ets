import { CourseCollections, CollectionCourse } from '../model/CourseCollections';
import { CollectionActions } from './CollectionActions';
import { DateCalendar } from './DateCalendar';
import { PhysicalInput } from '../services/PhysicalInput';
import { DropdownLabel } from './DropdownLabel';
import { SearchFilters, matchingSearchRows, searchFacetOptions } from '../model/SearchFacets';
import { LocalStore } from '../services/LocalStore';
import { Account, Course, copyStringMap, phase, shanghaiDate, clockTime } from '../model/Timeline';
import { CourseList } from './CourseList';
import { Zhiyun, SearchCourse, aggregatePermissions } from '../services/Zhiyun';

@Component
export struct Plaza {
  collections: CourseCollections = new CourseCollections();
  @Prop collectionRevision: number = 0;
  @State chapterCourse: CollectionCourse | undefined = undefined;
  private queryInput: PhysicalInput = new PhysicalInput();
  @State calendarOpen: boolean = false;
  private visibleHits: Set<string> = new Set();
  private visibleLessons: Set<string> = new Set();
  private checkedLessons: Set<string> = new Set();
  private checkedHits: Set<string> = new Set();
  private checkingAll: boolean = false;
  private visibleTimer: number = -1;
  private markVisible(id: string, visible: boolean, hit: boolean): void { const ids = hit ? this.visibleHits : this.visibleLessons; if (visible) ids.add(id); else ids.delete(id); clearTimeout(this.visibleTimer); this.visibleTimer = setTimeout(() => this.classify(this.generation), 80); }
  private pendingHits(): SearchCourse[] { return this.filteredHits().filter((hit: SearchCourse) => (this.checkingAll || this.visibleHits.has(hit.courseId)) && !this.checkedHits.has(hit.courseId)); }
  private pendingLessons(): Course[] { return this.courses.filter((course: Course) => (this.checkingAll || this.visibleLessons.has(course.subId)) && !this.checkedLessons.has(course.subId)); }


  @Prop account: Account;
  @Prop @Watch('refreshScope') refreshSequence: number = 0;
  onDiscovered: (courses: Course[], checking: boolean) => void = () => {};
  private verifiedLessons: Set<string> = new Set();
  private classificationGeneration: number = -1;
  private refreshScope(): void { this.api.cancel(); this.verifiedLessons.clear(); this.checkedHits.clear(); this.checkedLessons.clear(); this.classify(++this.generation); }
  private scopeRows(): Course[] { const rows = this.searching && !this.chapterTitle ? this.filteredHits().reduce((all: Course[], hit: SearchCourse): Course[] => all.concat(this.chapters.get(hit.courseId) || []), []) : this.courses; const unique = new Map<string, Course>(); rows.forEach((course: Course) => unique.set(course.subId, course)); return Array.from(unique.values()); }
  private permittedScope(): Course[] { const rows = this.scopeRows(), states = this.api.cachedPermissions(rows); return rows.filter((course: Course) => course.start <= Date.now() / 1000 && this.verifiedLessons.has(course.subId) && states[course.subId] === 'allowed'); }
  private publishScope(): void { this.onDiscovered(this.permittedScope(), this.checking || this.busy); }
  @Prop @Watch('navigateBack') backSequence: number = 0;
  @Prop @Watch('activityChanged') active: boolean = true;
  store: LocalStore | undefined = undefined;
  onEnter: (course: Course) => void = () => {};
  onDownload: (courses: Course[]) => void = () => {};
  onBack: () => void = () => {};
  @State query: string = '';
  @State teacherSearch: boolean = false;
  @State searching: boolean = false;
  @State liveOnly: boolean = false;
  @State date: string = shanghaiDate(Date.now() / 1000);
  @State courses: Course[] = [];
  @State searchByTeacher: boolean = false;
  @State filterCounterpart: string = '';
  @State filterRoom: string = '';
  @State filterTerm: string = '';
  @State preparingDownload: boolean = false;
  @State hits: SearchCourse[] = [];
  @State chapterTitle: string = '';
  @State total: number = 0;
  @State page: number = 1;
  @State busy: boolean = false;
  @State error: string = '';
  @State permissions: Record<string, string> = {};
  @State hitPermissions: Record<string, string> = {};
  @State checking: boolean = false;
  @StorageLink('foreground') @Watch('visibilityChanged') foreground: boolean = true;
  private chapters: Map<string, Course[]> = new Map();
  private api: Zhiyun = new Zhiyun();
  private generation: number = 0;
  aboutToAppear(): void { this.api.usePermissionStorage(this.store); if (this.active) this.load(); }
  aboutToDisappear(): void { clearTimeout(this.visibleTimer); this.generation++; this.api.cancel(); }
  private navigateBack(): void {
    if (!this.active) return;
    if (this.calendarOpen) { this.calendarOpen = false; return; }
    if (this.chapterTitle) {
      this.generation++; this.api.cancel(); this.chapterTitle = ''; this.courses = []; this.busy = false; this.error = ''; this.classify(this.generation);
    } else if (this.searching) { this.query = ''; this.load(); }
    else this.onBack();
  }
  private activityChanged(): void {
    if (!this.active) { this.generation++; this.api.cancel(); this.busy = false; this.checking = false; }
    else if (this.foreground) { this.verifiedLessons.clear(); this.checkedHits.clear(); this.checkedLessons.clear(); this.classify(++this.generation); }
  }
  private visibilityChanged(): void {
    if (!this.foreground) { this.generation++; this.api.cancel(); this.busy = false; this.checking = false; }
    else if (this.active) { this.verifiedLessons.clear(); this.checkedHits.clear(); this.checkedLessons.clear(); this.classify(++this.generation); }
  }
  private async classify(gen: number, force: boolean = true): Promise<void> {
    if (gen !== this.generation || !this.active || !this.foreground || this.classificationGeneration === gen) return;
    this.classificationGeneration = gen; this.checking = true; this.publishScope();
    if (this.searching && !this.chapterTitle) {
      const initial = copyStringMap(this.hitPermissions);
      this.hits.forEach((hit: SearchCourse) => {
        const courses = this.chapters.get(hit.courseId) || this.store?.loadCatalogue(hit.courseId);
        if (courses) { this.chapters.set(hit.courseId, courses); const states = this.api.cachedPermissions(courses);
          initial[hit.courseId] = aggregatePermissions(courses.map((c: Course) => states[c.subId] || 'unknown')); }
      });
      this.hitPermissions = initial;
      const pending = this.pendingHits(); let cursor = 0;
      const worker = async (): Promise<void> => {
        while (cursor < pending.length && gen === this.generation && this.active && this.foreground) {
          const hit = pending[cursor++];
          if (!this.checkingAll && !this.visibleHits.has(hit.courseId)) continue;
          try {
            let courses = this.chapters.get(hit.courseId) || this.store?.loadCatalogue(hit.courseId);
            if (!courses?.length) {
              courses = await this.api.chapters(hit, false); this.chapters.set(hit.courseId, courses);
            }
            if (gen !== this.generation) return;
            const catalogue = courses || [];
            const rows = catalogue.filter((course: Course) => !this.verifiedLessons.has(course.subId));
            const permissions = await this.api.permissions(rows, (states: Record<string, string>, confirmed?: string[]) => {
              if (gen !== this.generation) return;
              (confirmed || []).forEach((id: string) => this.verifiedLessons.add(id));
              const all = this.api.cachedPermissions(catalogue); Object.keys(states).forEach((id: string) => all[id] = states[id]);
              const next = copyStringMap(this.hitPermissions); next[hit.courseId] = aggregatePermissions(catalogue.map((course: Course) => all[course.subId] || 'unknown')); this.hitPermissions = next; this.publishScope();
            }, force);
            if (gen !== this.generation) return;
            const next = copyStringMap(this.hitPermissions);
            const cachedStates = this.api.cachedPermissions(catalogue);
            next[hit.courseId] = aggregatePermissions(catalogue.map((c: Course) => permissions[c.subId] || cachedStates[c.subId] || 'unknown'));
            this.hitPermissions = next; this.checkedHits.add(hit.courseId);
          } catch (_) { if (gen === this.generation) this.checkedHits.add(hit.courseId); }
        }
      };
      await Promise.all([worker(), worker()]);
    } else {
      this.permissions = this.api.cachedPermissions(this.courses);
      const rows = this.pendingLessons();
      await this.api.permissions(rows, (states: Record<string, string>, confirmed?: string[]) => {
        if (gen === this.generation) { const next = copyStringMap(this.permissions); Object.keys(states).forEach((id: string) => next[id] = states[id]); this.permissions = next; (confirmed || []).forEach((id: string) => this.verifiedLessons.add(id)); this.publishScope(); }
      }, force);
      if (gen === this.generation) rows.forEach((course: Course) => this.checkedLessons.add(course.subId));
    }
    if (this.classificationGeneration === gen) this.classificationGeneration = -1;
    if (gen === this.generation) { this.checking = false; this.publishScope(); if (this.searching && !this.chapterTitle ? this.pendingHits().length > 0 : this.pendingLessons().length > 0) this.classify(gen, force); }
  }
  private hitsIn(state: string): SearchCourse[] { return this.filteredHits().filter((h: SearchCourse) => (this.hitPermissions[h.courseId] || 'unknown') === state); }
  private filters(): SearchFilters { return { counterpart: this.filterCounterpart, room: this.filterRoom, term: this.filterTerm }; }
  private filteredHits(): SearchCourse[] { return matchingSearchRows(this.hits, this.filters(), this.searchByTeacher); }
  private setFilter(field: string, value: string): void { if (field === 'counterpart') this.filterCounterpart = value; else if (field === 'room') this.filterRoom = value; else this.filterTerm = value; clearTimeout(this.visibleTimer); this.visibleTimer = setTimeout(() => this.classify(this.generation), 80); }
  private filterMenu(field: string): MenuElement[] { const label = field === 'counterpart' ? this.searchByTeacher ? '课程' : '教师' : field === 'room' ? '教室' : '学期'; const initial: MenuElement[] = [{ value: '全部' + label, action: () => this.setFilter(field, '') }]; return initial.concat(searchFacetOptions(this.hits, this.filters(), this.searchByTeacher, field).map((value: string): MenuElement => { return { value, action: () => this.setFilter(field, value) }; })); }
  private downloadScope(): void {
    this.checkingAll = true; this.error = ''; this.onDownload(this.permittedScope()); this.publishScope();
    if (!this.checking && !this.busy) this.classify(this.generation);
  }
  private sectionTitle(state: string): string { return state === 'allowed' ? '可访问' : state === 'denied' ? '需申请权限' : '待确认'; }
  private async load(more: boolean = false, force: boolean = false): Promise<void> {
    const gen = ++this.generation;
    this.api.cancel(); this.verifiedLessons.clear(); this.checkedHits.clear(); this.checkedLessons.clear(); this.visibleHits.clear(); this.visibleLessons.clear(); this.checkingAll = false; this.busy = true; this.checking = false; this.error = ''; this.chapterTitle = '';
    this.searching = !!this.query.trim();
    if (!more) { this.filterCounterpart = ''; this.filterRoom = ''; this.filterTerm = ''; this.searchByTeacher = this.teacherSearch; this.page = 1; this.hits = []; this.courses = []; this.permissions = {}; this.hitPermissions = {}; }
    try {
      if (this.searching) {
        const result = await this.api.searchCourses(this.account, this.searchByTeacher ? '' : this.query, this.searchByTeacher ? this.query : '', this.page);
        if (gen !== this.generation) return;
        this.hits = more ? this.hits.concat(result.list) : result.list; this.total = result.total; this.classify(gen);
        while (this.page * 20 < this.total && gen === this.generation && this.page < 500) {
          const pages = [this.page + 1]; if ((this.page + 1) * 20 < this.total) pages.push(this.page + 2);
          const results = await Promise.all(pages.map((page: number) => this.api.searchCourses(this.account, this.searchByTeacher ? '' : this.query, this.searchByTeacher ? this.query : '', page)));
          if (gen !== this.generation) return; this.page = pages[pages.length - 1];
          const unique = new Map<string, SearchCourse>(); this.hits.concat(results.reduce((rows: SearchCourse[], item): SearchCourse[] => rows.concat(item.list), [])).forEach((hit: SearchCourse) => unique.set(hit.courseId, hit)); this.hits = Array.from(unique.values());
          if (results.every((item) => !item.list.length)) break;
        }
      } else {
        const cached = this.store?.loadPlaza(this.date, this.liveOnly);
        if (cached?.length) {
          this.courses = cached; this.permissions = this.api.cachedPermissions(cached); this.busy = false;
        }
        const courses = await this.api.plaza(this.account, this.date, this.liveOnly);
        if (gen !== this.generation) return;
        this.courses = courses;
        try { this.store?.savePlaza(this.date, this.liveOnly, courses); } catch (_) {}
      }
      if (gen === this.generation) { this.busy = false; await this.classify(gen, true); }
    } catch (err) { if (gen === this.generation) this.error = (err as Error).message; }
    finally { if (gen === this.generation) this.busy = false; }
  }
  private async open(hit: SearchCourse): Promise<void> {
    const gen = ++this.generation;
    this.api.cancel(); this.verifiedLessons.clear(); this.checkedHits.clear(); this.checkedLessons.clear(); this.visibleHits.clear(); this.visibleLessons.clear(); this.checkingAll = false; this.busy = true; this.checking = false; this.error = ''; this.chapterTitle = hit.title; this.chapterCourse = hit as CollectionCourse; this.permissions = {};
    this.courses = [];
    try {
      const cached = this.chapters.get(hit.courseId) || this.store?.loadCatalogue(hit.courseId);
      const list = cached?.length && cached.every((course: Course) => course.end > course.start) ? cached : await this.api.chapters(hit);
      this.chapters.set(hit.courseId, list); this.collections.catalogue(hit as CollectionCourse, list, true);
      try { this.store?.saveCatalogue(hit.courseId, list); } catch (_) {}
      if (gen === this.generation) { const now = Date.now() / 1000; this.courses = list.slice().sort((a: Course, b: Course) => (a.start > now ? 1 : 0) - (b.start > now ? 1 : 0) || (a.start > now ? a.start - b.start : b.start - a.start)); this.busy = false; await this.classify(gen); }
    }
    catch (err) { if (gen === this.generation) this.error = (err as Error).message; }
    finally { if (gen === this.generation) this.busy = false; }
  }
  private chooseSearchMode(teacher: boolean): void { this.teacherSearch = teacher; this.load(); }
  private changeDay(delta: number): void {
    this.date = shanghaiDate(Date.parse(this.date + 'T00:00:00+08:00') / 1000 + delta * 86400); this.load();
  }
  build() {
    if (this.calendarOpen) { DateCalendar({ knownDates: false, selectedDate: this.date, courses: this.courses, onClose: () => this.calendarOpen = false, onSelect: (date: string) => { this.calendarOpen = false; this.date = date; this.load(); } }).layoutWeight(1) } else {
    Column({ space: 12 }) {
      Row() {
        Button('‹ 返回').fontSize(12).height(34).backgroundColor('#EAF4FF').fontColor('#168BEE').onClick(() => this.navigateBack())
        Blank()
        Text('课程广场').fontSize(20).fontWeight(FontWeight.Bold).fontColor('#20344D')
        Blank()
        Button('刷新').fontSize(13).height(34).backgroundColor('#EAF4FF').fontColor('#168BEE').onClick(() => this.load(false, true))
      }.width('100%')
      Row({ space: 8 }) {
        Button() { DropdownLabel({ label: this.teacherSearch ? '教师' : '课程', labelSize: 13 }) }.padding(0).fontSize(13).height(40).backgroundColor('#EAF4FF').fontColor('#168BEE')
          .bindMenu([{ value: '课程', action: () => this.chooseSearchMode(false) }, { value: '教师', action: () => this.chooseSearchMode(true) }])
        TextInput({ controller: this.queryInput.controller, text: this.query, placeholder: this.teacherSearch ? '搜索教师' : '搜索全部课程' }).onKeyPreIme((event: KeyEvent): boolean => this.queryInput.digit(event, this.query, (value: string) => this.query = value)).height(42).layoutWeight(1).backgroundColor('#FFFFFF').onBlur(() => this.queryInput.reset())
          .onChange((value: string) => { this.query = value; }).onSubmit(() => this.load())
        Button('搜索').fontSize(13).height(40).backgroundColor('#168BEE').fontColor('#FFFFFF').onClick(() => this.load())
      }.width('100%')
      if (this.chapterTitle) {
        Row() {
          Button('‹ 搜索结果').fontSize(12).height(32).fontColor('#168BEE').backgroundColor('#EAF4FF').onClick(() => this.navigateBack())
          if (this.busy || this.checking) { LoadingProgress().height(18).width(18).color('#168BEE') }
          Text(this.chapterTitle).fontSize(16).fontWeight(FontWeight.Medium).layoutWeight(1).margin({ left: 12 }).maxLines(1)
          if (this.chapterCourse) { CollectionActions({ collections: this.collections, revision: this.collectionRevision, course: this.chapterCourse, known: this.courses }) }
          Button('批量下载').fontSize(12).height(32).backgroundColor('#EAF4FF').fontColor('#168BEE').onClick(() => this.downloadScope())
        }.width('100%')
      } else if (!this.searching) {
        Row({ space: 8 }) {
          Button('‹').height(32).width(34).fontColor('#168BEE').backgroundColor('#EAF4FF').onClick(() => this.changeDay(-1))
          Button('▦ ' + this.date).height(36).layoutWeight(1).fontSize(13).fontColor('#20344D').backgroundColor('#FFFFFF').onClick(() => this.calendarOpen = true)
          Button('›').height(32).width(34).fontColor('#168BEE').backgroundColor('#EAF4FF').onClick(() => this.changeDay(1))

        }.width('100%')
      }
      if (!this.searching && !this.chapterTitle) { Row({ space: 6 }) {
        Text(String(this.courses.length) + ' 节').fontSize(12).fontColor('#71839A')
        if (this.busy || this.checking) { LoadingProgress().height(18).width(18).color('#168BEE') }
        if (!this.chapterTitle) {
          Button(this.liveOnly ? '全部' : '✓ 全部').height(32).fontSize(12).fontColor(this.liveOnly ? '#168BEE' : '#FFFFFF').backgroundColor(this.liveOnly ? '#EAF4FF' : '#168BEE').onClick(() => { if (this.liveOnly) { this.liveOnly = false; this.load(); } })
          Button(this.liveOnly ? '✓ 直播中' : '直播中').height(32).fontSize(12).fontColor(this.liveOnly ? '#FFFFFF' : '#168BEE').backgroundColor(this.liveOnly ? '#168BEE' : '#EAF4FF').onClick(() => { if (!this.liveOnly) { this.liveOnly = true; this.load(); } })
        }
        Blank(); Button('批量下载').fontSize(12).height(32).backgroundColor('#EAF4FF').fontColor('#168BEE').onClick(() => this.downloadScope())
      }.width('100%') }
      if (this.searching && !this.chapterTitle) {
        Row({ space: 6 }) {
          Text(String(this.filteredHits().length) + ' 门').fontSize(12).fontColor('#71839A')
          if (this.busy || this.checking) { LoadingProgress().height(18).width(18).color('#168BEE') }
          Scroll() { Row({ space: 6 }) {
            Button() { DropdownLabel({ label: (this.filterCounterpart || (this.searchByTeacher ? '课程' : '教师')) + '', labelSize: 12 }) }.padding(0).height(32).fontSize(12).backgroundColor('#EAF4FF').fontColor('#168BEE').bindMenu(this.filterMenu('counterpart'))
            Button() { DropdownLabel({ label: (this.filterRoom || '教室') + '', labelSize: 12 }) }.padding(0).height(32).fontSize(12).backgroundColor('#EAF4FF').fontColor('#168BEE').bindMenu(this.filterMenu('room'))
            Button() { DropdownLabel({ label: (this.filterTerm || '学期') + '', labelSize: 12 }) }.padding(0).height(32).fontSize(12).backgroundColor('#EAF4FF').fontColor('#168BEE').bindMenu(this.filterMenu('term'))
          } }.layoutWeight(1).height(34).align(Alignment.Start).scrollable(ScrollDirection.Horizontal).scrollBar(BarState.Off)
          Button('批量下载').height(32).fontSize(12).backgroundColor('#EAF4FF').fontColor('#168BEE').onClick(() => this.downloadScope())
        }.width('100%')
      }

      if (this.error) { Text(this.error).fontSize(13).fontColor('#A15430').width('100%') }
      if (this.searching && !this.chapterTitle) {
        List({ space: 10 }) {
          ForEach(['allowed', 'denied', 'unknown'], (state: string) => {
            if (this.hitsIn(state).length) {
              ListItem() { Text(`${this.sectionTitle(state)} · ${this.hitsIn(state).length}`).fontSize(14).fontWeight(FontWeight.Medium).fontColor(state === 'allowed' ? '#168BEE' : '#7C899A').padding({ top: 10, bottom: 3 }) }
              ForEach(this.hitsIn(state), (hit: SearchCourse) => {
                ListItem() {
                  Row({ space: 14 }) {
                    Column({ space: 8 }) {
                      Text(hit.title).fontSize(18).fontWeight(FontWeight.Medium).fontColor('#20344D').maxLines(2)
                      Text(`${hit.teacher}  ${hit.room}`).fontSize(12).fontColor('#7C899A')
                      if (hit.term) { Text(hit.term).fontSize(11).fontColor('#889AAF') }
                    }.layoutWeight(1).alignItems(HorizontalAlign.Start)
                    Row({ space: 4 }) {
                    CollectionActions({ collections: this.collections, revision: this.collectionRevision, course: hit, known: this.chapters.get(hit.courseId) || [] })
                    Button('课次 ›').height(36).fontSize(12).fontColor('#168BEE').backgroundColor('#EAF4FF').onClick(() => this.open(hit))
                    }.alignItems(VerticalAlign.Center)
                  }.width('100%').padding(20).backgroundColor('#FFFFFF').borderRadius(14)
                }.onVisibleAreaChange([0.1], (visible: boolean) => this.markVisible(hit.courseId, visible, true))
              }, (hit: SearchCourse, i: number) => `${state}:${hit.courseId}:${i}`)
            }
          }, (state: string) => state)
          if (this.page * 20 < this.total && !this.busy && !this.checking) {
            ListItem() { Button('加载更多').fontSize(13).fontColor('#168BEE').backgroundColor('#EAF4FF').onClick(() => { this.page++; this.load(true); }) }
          }
          if (!this.hits.length && !this.busy && !this.error) { ListItem() { Text('没有找到课程').fontSize(14).fontColor('#7C899A').padding(24) } }
        }.layoutWeight(1).width('100%').scrollBar(BarState.Auto)
      } else {
        CourseList({ collections: this.collections, collectionRevision: this.collectionRevision, onVisible: (course: Course, visible: boolean) => this.markVisible(course.subId, visible, false), courses: this.courses, permissions: this.permissions, busy: this.busy || this.checking, emptyText: this.error ? '' : this.chapterTitle ? '暂无可用课次' : '当天暂无课程', onEnter: (c: Course) => { this.onEnter(c); } })
      }
    }.width('100%').layoutWeight(1).padding({ left: 20, right: 20, bottom: 14 })
  }
  }
}
