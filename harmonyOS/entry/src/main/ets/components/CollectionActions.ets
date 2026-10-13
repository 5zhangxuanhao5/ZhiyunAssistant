import { Course } from '../model/Timeline';
import { CourseCollections, CollectionCourse } from '../model/CourseCollections';
@Component
export struct CollectionActions {
  collections: CourseCollections = new CourseCollections();
  @Prop revision: number = 0;
  @Prop course: CollectionCourse;
  @Prop lesson: boolean = false;
  @Prop folder: boolean = false;
  @Prop folderWhole: boolean = false;
  known: Course[] = [];
  private selected(kind: string, revision: number): boolean { return this.folder ? this.collections.hasSelection(kind, this.course.courseId) : this.lesson ? this.collections.hasLesson(kind, this.course as Course) : this.collections.hasCourse(kind, this.course.courseId); }
  private confirming: boolean = false;
  private async toggle(kind: string): Promise<void> {
    if (this.confirming) return;
    const selected = this.selected(kind, this.revision), id = this.course.courseId, subId = this.lesson ? (this.course as Course).subId : '';
    if (selected) {
      this.confirming = true;
      try { const choice = await this.getUIContext().getPromptAction().showDialog({ title: kind === 'later' ? '取消稍后再看？' : '取消收藏？', message: this.lesson ? this.course.title : '取消当前选择的课次', buttons: [{ text: '保留', color: '#71839A' }, { text: '取消', color: '#168BEE' }] }); if (choice.index !== 1 || this.course.courseId !== id || this.lesson && (this.course as Course).subId !== subId || !this.selected(kind, this.revision)) return; }
      catch (_) { return; }
      finally { this.confirming = false; }
    }
    if (this.folder) this.collections.toggleSelection(kind, this.course, this.known, this.folderWhole); else if (this.lesson) this.collections.toggleLesson(kind, this.course as Course); else this.collections.toggleCourse(kind, this.course, this.known);
  }

  build() {
    Row({ space: 2 }) {
      Button() { Text(this.selected('favourite', this.revision) ? '★' : '☆').fontSize(24).fontColor('#168BEE').textAlign(TextAlign.Center) }.id((this.lesson ? 'lesson-' : 'course-') + 'favourite-' + (this.lesson ? (this.course as Course).subId : this.course.courseId)).width(34).height(34).padding(0).backgroundColor(Color.Transparent).accessibilityText(this.selected('favourite', this.revision) ? '取消收藏' : '收藏').onClick((event: ClickEvent) => { this.toggle('favourite'); })
      Button() { Image(this.selected('later', this.revision) ? $r('app.media.watch_later_filled') : $r('app.media.watch_later_outline')).width(22).height(22).draggable(false) }.id((this.lesson ? 'lesson-' : 'course-') + 'later-' + (this.lesson ? (this.course as Course).subId : this.course.courseId)).width(34).height(34).padding(0).backgroundColor(Color.Transparent).accessibilityText(this.selected('later', this.revision) ? '取消稍后再看' : '稍后再看').onClick((event: ClickEvent) => { this.toggle('later'); })
    }.height(34).width(70)
  }
}
