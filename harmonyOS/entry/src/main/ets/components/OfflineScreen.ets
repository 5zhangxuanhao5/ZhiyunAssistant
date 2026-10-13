import { OfflineRows, OfflineRow, offlineRows } from '../model/OfflineRows';
import { DropdownLabel } from './DropdownLabel';
import { downloadSize } from '../model/DownloadBytes';
import { CourseCollections } from '../model/CourseCollections';
import { CollectionActions } from './CollectionActions';
import { OfflineCourse, DownloadJob } from '../services/OfflineLibrary';
import { CourseSection, courseSections } from '../model/CourseSections';
import { Course, shanghaiDate, clockTime } from '../model/Timeline';
@Component
export struct OfflineScreen {
  collections: CourseCollections = new CourseCollections();
  @Prop collectionRevision: number = 0;
  @Prop @Watch('updateRows') entries: OfflineCourse[] = [];
  @Prop @Watch('updateJobs') jobs: DownloadJob[] = [];
  @State @Watch('updateRows') byCourse: boolean = false;
  @State managing: boolean = false;
  @State selected: string[] = [];
  onDeleteMany: (subIds: string[]) => void = () => {};
  private data: OfflineRows = new OfflineRows();
  aboutToAppear(): void { this.updateRows(); }
  private updateJobs(): void { if (!this.data.updateJobs(this.jobs)) this.updateRows(); }
  private updateRows(): void { this.data.update(offlineRows(this.entries, this.jobs, this.byCourse)); }
  private allIds(): string[] { return Array.from(new Set(this.entries.map((entry: OfflineCourse) => entry.course.subId).concat(this.jobs.map((job: DownloadJob) => job.course.subId)))); }
  private toggle(id: string): void { this.selected = this.selected.includes(id) ? this.selected.filter((value: string) => value !== id) : this.selected.concat([id]); }
  private selectId(id: string, checked: boolean): void { const exists = this.selected.includes(id); if (checked && !exists) this.selected = this.selected.concat([id]); else if (!checked && exists) this.selected = this.selected.filter((value: string) => value !== id); }
  private selectSection(section: CourseSection): void { const ids = section.courses.map((course: Course) => course.subId); this.selected = ids.every((id: string) => this.selected.includes(id)) ? this.selected.filter((id: string) => !ids.includes(id)) : Array.from(new Set(this.selected.concat(ids))); }
  private sections(): CourseSection[] { return courseSections(this.entries.map((e: OfflineCourse) => e.course).concat(this.jobs.filter((j: DownloadJob) => j.state !== 'done' && j.state !== 'saved').map((j: DownloadJob) => j.course)), this.byCourse); }
  private queuePosition(job: DownloadJob): number { return this.jobs.filter((item: DownloadJob) => item.state === 'queued' || item.state === 'paused').findIndex((item: DownloadJob) => item.id === job.id) + 1; }
  private currentJob(job: DownloadJob): DownloadJob { return this.jobs.find((item: DownloadJob) => item.id === job.id) || job; }
  private currentEntry(entry: OfflineCourse): OfflineCourse { return this.entries.find((item: OfflineCourse) => item.course.subId === entry.course.subId) || entry; }
  onClose: () => void = () => {};
  onOpen: (entry: OfflineCourse) => void = () => {};
  @Prop concurrency: number = 1;
  onConcurrency: (count: number) => void = () => {};
  onPauseJob: (id: string) => void = () => {};
  onResumeJob: (id: string) => void = () => {};
  onMoveJob: (id: string, direction: number) => void = () => {};
  onPause: () => void = () => {};
  onResume: () => void = () => {};
  onSaveAvailable: (subId: string) => void = () => {};
  private retryFor(subId: string): DownloadJob | undefined { return this.jobs.find((job: DownloadJob) => job.course.subId === subId); }
  onRetry: (job: DownloadJob) => void = () => {};
  onDeleteJob: (subId: string) => void = () => {};
  onDelete: (entry: OfflineCourse) => void = () => {};
  @Builder
  private jobActions(job: DownloadJob) {
    Row({ space: 6 }) {
      if (!this.managing) { CollectionActions({ collections: this.collections, revision: this.collectionRevision, course: job.course, lesson: true }) }
      if (['running', 'queued'].includes(job.state)) { Button('暂停本节').height(28).fontSize(11).fontColor('#168BEE').backgroundColor('#EAF4FF').onClick(() => this.onPauseJob(job.course.subId)) }
      if (job.state === 'paused') { Button('继续本节').height(28).fontSize(11).fontColor('#168BEE').backgroundColor('#EAF4FF').onClick(() => this.onResumeJob(job.course.subId)) }
      if (['queued', 'paused'].includes(job.state)) {
        Button('提前下载').height(28).fontSize(11).fontColor('#168BEE').backgroundColor('#EAF4FF').onClick(() => this.onMoveJob(job.course.subId, -1))
        Button('延后下载').height(28).fontSize(11).fontColor('#168BEE').backgroundColor('#EAF4FF').onClick(() => this.onMoveJob(job.course.subId, 1))
      }
      if (job.state === 'error') {
        if (this.entries.some((entry: OfflineCourse) => entry.course.subId === job.course.subId)) { Button('保存可用内容').height(28).fontSize(11).fontColor('#168BEE').backgroundColor('#EAF4FF').onClick(() => this.onSaveAvailable(job.course.subId)) }
        Button('重试').id('retry-' + job.course.subId).height(28).fontSize(11).fontColor('#168BEE').backgroundColor('#EAF4FF').onClick(() => this.onRetry(job))
      }
      Button('删除').height(28).fontSize(11).fontColor('#AE6B41').backgroundColor('#FFF0E9').onClick(() => this.onDeleteJob(job.course.subId))
    }.height(32)
  }
  @Builder
  private jobCard(job: DownloadJob, queue: number) {
    Column({ space: 6 }) {
      Row({ space: 8 }) {
        if (this.managing) { Checkbox().select(this.selected.includes(job.course.subId)).onChange((checked: boolean) => this.selectId(job.course.subId, checked)) }
        Column({ space: 4 }) { Text(job.course.title).fontSize(15).fontColor('#20344D').maxLines(2); Text(shanghaiDate(job.course.start) + ' ' + clockTime(job.course.start)).fontSize(11).fontColor('#7C899A') }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        Scroll() { this.jobActions(job) }.constraintSize({ maxWidth: this.screenWidth < 600 ? this.screenWidth * 0.55 : 560 }).height(32).scrollable(ScrollDirection.Horizontal).scrollBar(BarState.Off)
      }.width('100%')
      Row({ space: 8 }) {
        if (job.state === 'running') { LoadingProgress().width(16).height(16).color('#168BEE') }
        Text(job.state === 'queued' ? '等待下载 · 第 ' + queue + ' 位' : job.message).fontSize(12).fontColor(job.state === 'error' ? '#AE6B41' : '#71839A').layoutWeight(1).maxLines(2)
        Text(job.downloadedBytes !== undefined ? downloadSize(job.downloadedBytes || 0) + (job.unknownSizes ? ' · 总大小待确认' : ' / ' + downloadSize(job.totalBytes || 0) + ' · ' + Math.round(job.progress * 100) + '%') : Math.round(job.progress * 100) + '%').fontSize(11).fontColor('#168BEE')
      }.width('100%')
      if (!job.unknownSizes) { Progress({ value: job.progress * 100, total: 100, type: ProgressType.Linear }).width('100%').color('#168BEE') }
    }.alignItems(HorizontalAlign.Start).width('100%').padding(14).backgroundColor('#FFFFFF').borderRadius(12)
  }
  @State screenWidth: number = 800;
  @Builder
  private entryCard(entry: OfflineCourse) {
    Column({ space: 6 }) {
      Row({ space: 8 }) {
        if (this.managing) { Checkbox().select(this.selected.includes(entry.course.subId)).onChange((checked: boolean) => this.selectId(entry.course.subId, checked)) }
        Column({ space: 4 }) {
          Text(entry.course.title).fontSize(16).fontWeight(FontWeight.Medium).fontColor('#20344D').maxLines(2)
          Text(shanghaiDate(entry.course.start) + ' ' + clockTime(entry.course.start)).fontSize(11).fontColor('#7C899A')
          Text([entry.options.video ? '视频' : '', entry.options.slides ? '课件' : '', entry.options.transcript ? '转写' : ''].filter((value: string) => !!value).join(' · ') + (entry.partial ? ' · 视频片段' : '')).fontSize(12).fontColor('#168BEE')
        }.alignItems(HorizontalAlign.Start).layoutWeight(1).onClick(() => { if (!this.managing) this.onOpen(entry); })
        Scroll() { Row({ space: 4 }) {
          if (!this.managing) { CollectionActions({ collections: this.collections, revision: this.collectionRevision, course: entry.course, lesson: true }) }
          Button('进入学习').height(32).fontSize(12).fontColor('#FFFFFF').backgroundColor('#168BEE').onClick(() => this.onOpen(entry))
          Button('删除').height(30).fontSize(11).fontColor('#AE6B41').backgroundColor('#FFF0E9').onClick(() => this.onDelete(entry))
        } }.height(34).constraintSize({ maxWidth: this.screenWidth < 600 ? this.screenWidth * 0.55 : 250 }).scrollable(ScrollDirection.Horizontal).scrollBar(BarState.Off)
      }.width('100%')
      if (entry.incomplete) { Row({ space: 6 }) { Text((entry.missing?.length ? entry.missing! : ['缺失详情暂未记录，可重试确认']).join('；')).fontSize(11).fontColor('#AE6B41').layoutWeight(1); if (this.retryFor(entry.course.subId)?.state === 'saved') { Button('重试缺失内容').height(30).fontSize(11).fontColor('#168BEE').backgroundColor('#EAF4FF').onClick(() => { const job = this.retryFor(entry.course.subId); if (job) this.onRetry(job); }) } }.width('100%') }
    }.width('100%').padding(14).backgroundColor('#FFFFFF').borderRadius(12)
  }
  build() {
    Column({ space: 12 }) {
      Row({ space: 8 }) {
        Button('返回').height(32).fontSize(12).fontColor('#168BEE').backgroundColor('#EAF4FF').onClick(() => this.onClose())
        Text('离线课程').fontSize(20).fontWeight(FontWeight.Bold).fontColor('#20344D')
        Scroll() { Row({ space: 6 }) {
          Button('按日期').height(32).fontSize(12).fontColor('#168BEE').backgroundColor(!this.byCourse ? '#DDEEFF' : '#EAF4FF').onClick(() => this.byCourse = false)
          Button('按课程').height(32).fontSize(12).fontColor('#168BEE').backgroundColor(this.byCourse ? '#DDEEFF' : '#EAF4FF').onClick(() => this.byCourse = true)
          if (this.jobs.some((job: DownloadJob) => !['done', 'saved'].includes(job.state))) {
            Button() { DropdownLabel({ label: '同时下载 ' + this.concurrency + ' 节', labelSize: 11 }) }.padding(0).height(32).backgroundColor('#EAF4FF').bindMenu([1, 2, 3, 4].map((count: number): MenuElement => { return { value: count + ' 节', action: () => this.onConcurrency(count) }; }))
            Button('全部暂停').height(32).fontSize(11).fontColor('#168BEE').backgroundColor('#EAF4FF').onClick(() => this.onPause())
            Button('全部继续').height(32).fontSize(11).fontColor('#168BEE').backgroundColor('#EAF4FF').onClick(() => this.onResume())
          }
        } }.layoutWeight(1).height(34).scrollable(ScrollDirection.Horizontal).scrollBar(BarState.Off)
        Button(this.managing ? '完成' : '管理').height(32).fontSize(12).fontColor('#168BEE').backgroundColor('#EAF4FF').onClick(() => { this.managing = !this.managing; this.selected = []; })
      }.width('100%')
      if (this.managing) { Row({ space: 8 }) {
        Button(this.selected.length === this.allIds().length ? '取消全选' : '全选').height(30).fontSize(12).backgroundColor('#EAF4FF').fontColor('#168BEE').onClick(() => this.selected = this.selected.length === this.allIds().length ? [] : this.allIds())
        Text('已选 ' + this.selected.length + ' 节').fontSize(12).fontColor('#71839A').layoutWeight(1)
        Button('删除所选').height(30).fontSize(12).backgroundColor('#FCEEEE').fontColor('#B44747').enabled(this.selected.length > 0).onClick(() => { this.onDeleteMany(this.selected.slice()); this.selected = []; })
      }.width('100%') }
      List({ space: 10 }) {
        LazyForEach(this.data, (row: OfflineRow) => { ListItem() {
          if (row.kind === 'section' && row.section) { Row() { Text(row.section.title).fontSize(16).fontWeight(FontWeight.Medium).fontColor('#294765').layoutWeight(1); if (this.byCourse && !this.managing) { CollectionActions({ collections: this.collections, revision: this.collectionRevision, course: row.section.courses[0], known: row.section.courses }) } if (this.managing) { Button('选择整组').height(28).fontSize(11).backgroundColor('#EAF4FF').fontColor('#168BEE').onClick(() => this.selectSection(row.section!)) } }.width('100%').padding({ top: 8, bottom: 4 }) }
          else if (row.job) { this.jobCard(row.job, row.queue || 0) }
          else if (row.entry) { this.entryCard(row.entry) }
        } }, (row: OfflineRow) => row.id + ':' + (row.revision || 0))
        if (!this.entries.length && !this.jobs.length) { ListItem() { Text('还没有下载课程').fontSize(14).fontColor('#7C899A').padding(20) } }
      }.layoutWeight(1).width('100%').cachedCount(3)
    }.width('100%').height('100%').padding(16).onAreaChange((oldArea: Area, area: Area) => this.screenWidth = Number(area.width))
  }
}
