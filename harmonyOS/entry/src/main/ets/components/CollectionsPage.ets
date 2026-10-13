import { Account, Course, copyStringMap, shanghaiDate } from '../model/Timeline';
import { CourseCollections, CollectionEntry } from '../model/CourseCollections';
import { LocalStore } from '../services/LocalStore';
import { Zhiyun, SearchCourse } from '../services/Zhiyun';
import { CollectionActions } from './CollectionActions';
import { pendingCollection, orderedCollections } from '../model/CollectionView';
import { CourseList } from './CourseList';
@Component
export struct CollectionsPage {
  collections: CourseCollections = new CourseCollections();
  @Prop revision: number = 0;
  @Prop now: number = Date.now() / 1000;
  @Prop @Watch('kindChanged') kind: string = 'favourite';
  private kindChanged(): void { this.generation++; this.api.cancel(); this.accessApi.cancel(); this.selectedId = ''; this.courses = []; this.permissions = {}; this.busy = false; this.checking = false; this.status = ''; }
  @Prop @Watch('activityChanged') active: boolean = true;
  @Prop @Watch('goBack') backSequence: number = 0;
  @Prop @Watch('goRoot') rootSequence: number = 0;
  private goRoot(): void { clearTimeout(this.timer); this.visible.clear(); this.checked.clear(); this.kindChanged(); }
  @Prop account: Account;
  store: LocalStore | undefined = undefined;
  onBack: () => void = () => {};
  onEnter: (course: Course) => void = () => {};
  @State selectedId: string = '';
  @State courses: Course[] = [];
  @State permissions: Record<string, string> = {};
  @State busy: boolean = false;
  @State status: string = '';
  private api: Zhiyun = new Zhiyun();
  private accessApi: Zhiyun = new Zhiyun();
  private generation: number = 0;
  private checked: Set<string> = new Set();
  private visible: Set<string> = new Set();
  private checking: boolean = false;
  private timer: number = -1;
  aboutToAppear(): void { this.api.usePermissionStorage(this.store); this.accessApi.usePermissionStorage(this.store); }
  aboutToDisappear(): void { this.generation++; this.api.cancel(); this.accessApi.cancel(); clearTimeout(this.timer); }
  private goBack(): void { if (!this.active) return; if (this.selectedId) { this.generation++; this.api.cancel(); this.accessApi.cancel(); this.selectedId = ''; this.busy = false; this.checking = false; } else this.onBack(); }
  private activityChanged(): void { if (!this.active) { this.generation++; this.api.cancel(); this.accessApi.cancel(); this.busy = false; this.checking = false; } else { this.checked.clear(); this.checkVisible(); } }
  private entries(revision: number): CollectionEntry[] { return orderedCollections(this.collections.entries(this.kind), this.now); }
  private rows(revision: number): Course[] { return this.courses.filter((course: Course) => this.collections.hasLesson(this.kind, course)).sort((a: Course, b: Course) => b.start - a.start); }
  private current(entry: CollectionEntry, revision: number): CollectionEntry { return this.collections.entry(this.kind, entry.course.courseId) || entry; }
  private description(entry: CollectionEntry, revision: number): string { const value = this.current(entry, revision); return value.lessons.filter((lesson: Course) => !value.excluded.includes(lesson.subId)).length + ' 节课'; }
  private confirming: boolean = false;
  private async clearAll(): Promise<void> { if (this.confirming) return; this.confirming = true; const kind = this.kind; try { const choice = await this.getUIContext().getPromptAction().showDialog({ title: kind === 'later' ? '取消全部稍后再看？' : '取消全部收藏？', buttons: [{ text: '保留', color: '#71839A' }, { text: '取消全部', color: '#168BEE' }] }); if (choice.index === 1 && this.kind === kind) this.collections.clear(kind); } finally { this.confirming = false; } }
  private title(): string { return this.kind === 'later' ? '稍后再看' : '课程收藏'; }
  private async open(entry: CollectionEntry): Promise<void> {
    this.api.cancel(); this.accessApi.cancel(); const gen = ++this.generation;
    this.selectedId = entry.course.courseId; this.courses = entry.lessons; this.permissions = this.accessApi.cachedPermissions(this.courses); this.checked.clear(); this.visible.clear(); this.status = ''; this.busy = entry.whole;
    if (!entry.whole) return;
    try {
      const cached = this.store?.loadCatalogue(entry.course.courseId); if (cached?.length) this.courses = cached;
      const hit: SearchCourse = { courseId: entry.course.courseId, title: entry.course.title, teacher: entry.course.teacher, room: entry.course.room, term: entry.course.term, type: '' };
      const rows = await this.api.chapters(hit);
      if (gen !== this.generation) return;
      this.courses = rows; this.collections.catalogue(entry.course, rows, true); this.store?.saveCatalogue(entry.course.courseId, rows);
    } catch (err) { if (gen === this.generation) this.status = '课次读取失败，已显示本机记录，可点刷新重试'; }
    finally { if (gen === this.generation) { this.busy = false; this.checkVisible(); } }
  }
  private markVisible(course: Course, visible: boolean): void { if (visible) this.visible.add(course.subId); else this.visible.delete(course.subId); clearTimeout(this.timer); this.timer = setTimeout(() => this.checkVisible(), 80); }
  private async checkVisible(): Promise<void> {
    if (this.checking || !this.active || !this.selectedId) return;
    const rows = this.rows(this.revision).filter((course: Course) => this.visible.has(course.subId) && !this.checked.has(course.subId)); if (!rows.length) return;
    const gen = this.generation; this.checking = true;
    try { await this.accessApi.permissions(rows, (states: Record<string, string>) => { if (gen !== this.generation) return; const next = copyStringMap(this.permissions); Object.keys(states).forEach((id: string) => next[id] = states[id]); this.permissions = next; }, true); } catch (_) {}
    finally { if (gen === this.generation) { rows.forEach((course: Course) => this.checked.add(course.subId)); this.checking = false; this.checkVisible(); } }
  }
  build() {
    Column({ space: 12 }) {
      Row({ space: 8 }) { Button('‹ ' + (this.selectedId ? this.title() : '我的课堂')).height(32).fontSize(12).fontColor('#168BEE').backgroundColor('#EAF4FF').onClick(() => this.goBack());  Text(this.selectedId ? this.collections.entry(this.kind, this.selectedId)?.course.title || '课次' : this.title()).fontSize(20).fontWeight(FontWeight.Bold).fontColor('#20344D').layoutWeight(1).maxLines(1); if (!this.selectedId) { Button(this.kind === 'later' ? '取消全部再看' : '取消全部收藏').height(32).fontSize(12).fontColor('#AE6B41').backgroundColor('#FFF0E9').enabled(this.entries(this.revision).length > 0).onClick(() => this.clearAll()) } if (this.selectedId) { Button('刷新').height(32).fontSize(12).fontColor('#168BEE').backgroundColor('#EAF4FF').onClick(() => { const entry = this.collections.entry(this.kind, this.selectedId); if (entry) this.open(entry); }) } }.width('100%')
      if (this.status) { Text(this.status).fontSize(12).fontColor('#71839A').width('100%') }
      if (this.selectedId) {
        CourseList({ separateUpcoming: true, now: this.now, collections: this.collections, collectionRevision: this.revision, courses: this.rows(this.revision), permissions: this.permissions, busy: this.busy, emptyText: this.kind === 'later' ? '这门课没有稍后再看的课次' : '这门课没有收藏的课次', onVisible: (course: Course, visible: boolean) => this.markVisible(course, visible), onEnter: (course: Course) => this.onEnter(course) })
      } else {
        List({ space: 10 }) {
          ForEach(this.entries(this.revision), (entry: CollectionEntry, index: number) => {
            if (pendingCollection(entry, this.now) && (index === 0 || !pendingCollection(this.entries(this.revision)[index - 1], this.now))) { ListItem() { Text('尚未开始').fontSize(14).fontWeight(FontWeight.Medium).fontColor('#71839A').padding({ top: 12, bottom: 4 }) } }
            ListItem() {
            Row({ space: 12 }) { Column({ space: 6 }) { Text(entry.course.title).fontSize(18).fontWeight(FontWeight.Medium).fontColor('#20344D').maxLines(2); Text([entry.course.teacher, entry.course.term || ''].filter((value: string) => !!value).join(' · ')).fontSize(12).fontColor('#7C899A').maxLines(2); Text(this.description(entry, this.revision)).fontSize(11).fontColor('#889AAF') }.layoutWeight(1).alignItems(HorizontalAlign.Start).onClick(() => this.open(this.current(entry, this.revision))); CollectionActions({ collections: this.collections, revision: this.revision, course: entry.course, folder: true, folderWhole: this.current(entry, this.revision).whole, known: this.current(entry, this.revision).lessons.filter((lesson: Course) => this.collections.hasLesson(this.kind, lesson)) }); Button('进入课程').height(34).fontSize(12).backgroundColor(Color.Transparent).fontColor('#168BEE').onClick(() => this.open(this.current(entry, this.revision))) }.width('100%').padding(18).backgroundColor('#FFFFFF').borderRadius(14)
          } }, (entry: CollectionEntry) => entry.course.courseId)
          if (!this.entries(this.revision).length) { ListItem() { Text(this.kind === 'later' ? '点课程旁的时钟，加入稍后再看' : '点课程旁的星星，收藏整门课或单节课').fontSize(13).fontColor('#7C899A').padding(24) } }
        }.layoutWeight(1).width('100%').padding({ right: 12, bottom: 20 }).scrollBar(BarState.Auto)
      }
    }.width('100%').height('100%').padding(20)
  }
}
