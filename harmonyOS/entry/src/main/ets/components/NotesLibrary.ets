import { PhysicalInput } from '../services/PhysicalInput';
import { recentNoteFolders } from '../model/NoteExport';
import { Account } from '../model/Timeline';
import { common } from '@kit.AbilityKit';
import { shanghaiDate } from '../model/Timeline';
import { LocalStore } from '../services/LocalStore';
import { NotesStore } from '../services/NotesStore';
import { LessonNote } from '../model/Notes';
import { Course } from '../model/Timeline';
import { CourseFolder, studyFolders, lessonLabel, selectedUnion } from '../model/StudyFolders';
@Component
export struct NotesLibrary {
  private renameInput: PhysicalInput = new PhysicalInput();

  @Prop account: Account | undefined = undefined;
  @Prop @Watch('systemBack') backSequence: number = 0;
  store: LocalStore | undefined = undefined;
  onOpen: (note: LessonNote) => void = () => {};
  onClose: () => void = () => {};
  @State notes: LessonNote[] = [];
  @State selected: string[] = [];
  @State folderId: string = '';
  @State lessonId: string = '';
  @State message: string = '';
  @State renameId: string = '';
  @State renameText: string = '';
  aboutToAppear(): void { this.refresh(); }
  private refresh(): void { if (this.store) this.notes = new NotesStore(this.store).list(); }
  private systemBack(): void { if (this.backSequence > 0) this.back(); }
  private back(): void { if (this.renameId) this.renameId = ''; else if (this.lessonId) this.lessonId = ''; else if (this.folderId) this.folderId = ''; else this.onClose(); }
  private folders(): CourseFolder[] { return recentNoteFolders(this.notes); }
  private lessons(): Course[] { return this.folders().find((folder: CourseFolder) => folder.id === this.folderId)?.lessons || []; }
  private noteKey(note: LessonNote): string { return note.course.subId + ':' + (note.id || 'default'); }
  private scoped(): LessonNote[] { return this.notes.filter((note: LessonNote) => this.lessonId ? note.course.subId === this.lessonId : this.folderId ? (note.course.courseId || note.course.title) === this.folderId : true); }
  private ids(notes: LessonNote[]): string[] { return notes.map((note: LessonNote) => this.noteKey(note)); }
  private toggle(notes: LessonNote[], checked: boolean): void { this.selected = selectedUnion(this.selected, this.ids(notes), checked); }
  private checked(notes: LessonNote[]): boolean { return notes.length > 0 && notes.every((note: LessonNote) => this.selected.includes(this.noteKey(note))); }
  private async export(format: string): Promise<void> { if (!this.store) return; try { await new NotesStore(this.store).export(this.notes.filter((note: LessonNote) => this.selected.includes(this.noteKey(note))), format, this.getUIContext().getHostContext() as common.UIAbilityContext, true, this.account); this.message = ''; } catch (err) { this.message = (err as Error).message; } }
  private deleteSelected(): void { if (!this.store || !this.selected.length) return; const repository = new NotesStore(this.store); this.notes.filter((note: LessonNote) => this.selected.includes(this.noteKey(note))).forEach((note: LessonNote) => repository.delete(note)); this.refresh(); this.selected = []; if (!this.scoped().length) { this.lessonId = ''; if (!this.lessons().length) this.folderId = ''; } }
  private rename(): void { const note = this.notes.find((entry: LessonNote) => this.noteKey(entry) === this.renameId); if (note && this.store) new NotesStore(this.store).rename(note, this.renameText); this.renameId = ''; this.refresh(); }
  build() {
    Column({ space: 12 }) {
      Row({ space: 8 }) { Button('返回').height(32).fontSize(12).fontColor('#168BEE').backgroundColor('#EAF4FF').onClick(() => this.back()); Text('笔记管理').fontSize(22).fontWeight(FontWeight.Bold).fontColor('#20344D').layoutWeight(1) }.width('100%')
      if (this.folderId) { Text((this.folders().find((folder: CourseFolder) => folder.id === this.folderId)?.title || '') + (this.lessonId ? ' · ' + lessonLabel(this.notes.find((note: LessonNote) => note.course.subId === this.lessonId)!.course) : '')).fontSize(13).fontColor('#71839A').width('100%').maxLines(2) }
      Row({ space: 8 }) { Button('全选').height(32).fontSize(12).fontColor('#168BEE').backgroundColor('#EAF4FF').onClick(() => this.toggle(this.scoped(), true)); Text('已选 ' + this.selected.length).fontSize(12).fontColor('#71839A').layoutWeight(1); Button('删除').height(32).fontSize(12).enabled(this.selected.length > 0).fontColor('#B44747').backgroundColor('#FCEEEE').onClick(() => this.deleteSelected()); Button('导出').height(32).fontSize(12).enabled(this.selected.length > 0).fontColor('#FFFFFF').backgroundColor('#168BEE').bindMenu([{ value: 'HTML（每篇独立，打包 ZIP）', action: () => this.export('html') }, { value: 'Markdown（含图片，打包 ZIP）', action: () => this.export('md') }, { value: '纯文本（每篇独立，打包 ZIP）', action: () => this.export('txt') }]) }.width('100%')
      List({ space: 10 }) {
        if (!this.folderId) {
          ForEach(this.folders(), (folder: CourseFolder) => { ListItem() { Row({ space: 10 }) { Checkbox().select(this.checked(this.notes.filter((note: LessonNote) => (note.course.courseId || note.course.title) === folder.id))).onChange((checked: boolean) => this.toggle(this.notes.filter((note: LessonNote) => (note.course.courseId || note.course.title) === folder.id), checked)); Column({ space: 6 }) { Text(folder.title).fontSize(16).fontColor('#20344D'); Text(folder.lessons.length + ' 次上课').fontSize(12).fontColor('#71839A') }.alignItems(HorizontalAlign.Start).layoutWeight(1).onClick(() => this.folderId = folder.id); Button('进入 ›').height(32).fontSize(12).fontColor('#168BEE').backgroundColor(Color.Transparent).onClick(() => this.folderId = folder.id) }.width('100%').padding(14).backgroundColor('#FFFFFF').borderRadius(12) } }, (folder: CourseFolder) => folder.id)
        } else if (!this.lessonId) {
          ForEach(this.lessons(), (lesson: Course) => { ListItem() { Row({ space: 10 }) { Checkbox().select(this.checked(this.notes.filter((note: LessonNote) => note.course.subId === lesson.subId))).onChange((checked: boolean) => this.toggle(this.notes.filter((note: LessonNote) => note.course.subId === lesson.subId), checked)); Column({ space: 6 }) { Text(lessonLabel(lesson)).fontSize(16).fontColor('#20344D'); Text(this.notes.filter((note: LessonNote) => note.course.subId === lesson.subId).length + ' 篇笔记').fontSize(12).fontColor('#71839A') }.alignItems(HorizontalAlign.Start).layoutWeight(1).onClick(() => this.lessonId = lesson.subId); Button('进入 ›').height(32).fontSize(12).fontColor('#168BEE').backgroundColor(Color.Transparent).onClick(() => this.lessonId = lesson.subId) }.width('100%').padding(14).backgroundColor('#FFFFFF').borderRadius(12) } }, (lesson: Course) => lesson.subId)
        } else {
          ForEach(this.scoped(), (note: LessonNote) => { ListItem() { Row({ space: 10 }) { Checkbox().select(this.selected.includes(this.noteKey(note))).onChange((checked: boolean) => this.toggle([note], checked)); Column({ space: 6 }) { Text(note.course.title + '_' + shanghaiDate(note.course.start) + '_' + (note.title || '课堂笔记')).fontSize(16).fontColor('#20344D'); Text(note.atoms.length + ' 项内容').fontSize(12).fontColor('#71839A') }.alignItems(HorizontalAlign.Start).layoutWeight(1); Button('打开笔记').height(32).fontSize(12).fontColor('#168BEE').backgroundColor('#EAF4FF').onClick(() => this.onOpen(note)); Button('重命名').height(32).fontSize(12).fontColor('#168BEE').backgroundColor('#EAF4FF').onClick(() => { this.renameId = this.noteKey(note); this.renameText = note.title || '课堂笔记'; }) }.width('100%').padding(14).backgroundColor('#FFFFFF').borderRadius(12) } }, (note: LessonNote) => this.noteKey(note) + ':' + note.title + ':' + note.savedAt)
        }
      }.layoutWeight(1).width('100%')
      if (this.renameId) { TextInput({ controller: this.renameInput.controller, text: this.renameText, placeholder: '笔记名称' }).onKeyPreIme((event: KeyEvent): boolean => this.renameInput.digit(event, this.renameText, (value: string) => this.renameText = value)).height(42).onChange((value: string) => this.renameText = value).onBlur(() => this.renameInput.reset()); Row({ space: 8 }) { Button('取消').height(32).onClick(() => this.renameId = ''); Button('保存名称').height(32).fontColor('#FFFFFF').backgroundColor('#168BEE').onClick(() => this.rename()) }.width('100%') }
      if (!this.notes.length) { Text('还没有课堂笔记').fontColor('#71839A') }
      if (this.message) { Text(this.message).fontSize(12).fontColor('#AE6B41') }
    }.padding(16).width('100%').height('100%').backgroundColor('#F1F3F5')
  }
}
