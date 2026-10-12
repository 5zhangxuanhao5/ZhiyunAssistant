import { Course, Slide, Transcript } from '../model/Timeline';
import { PriorCourseContext, PriorLesson, priorLessons, lessonLabel } from '../model/CourseContext';
import { LocalStore, Snapshot } from './LocalStore';
import { Zhiyun, AccessDenied } from './Zhiyun';
export class CourseContextLoader {
  private api: Zhiyun = new Zhiyun();
  private epoch: number = 0;
  cancel(): void { this.epoch++; this.api.cancel(); }
  async load(current: Course, store: LocalStore, offline: boolean, downloads: Snapshot[], progress: (value: string) => void, includeLater: boolean = false): Promise<PriorCourseContext> {
    const gen = this.epoch, result: PriorCourseContext = { lessons: [], gaps: [], wholeCourse: includeLater };
    const valid = (): void => { if (gen !== this.epoch) throw new Error('已取消'); };
    this.api.usePermissionStorage(store);
    let rows = store.loadCatalogue(current.courseId) || [];
    if (!offline) {
      progress(includeLater ? '正在读取整门课的课次' : '正在读取这门课的前序课次');
      try {
        rows = await this.api.chapters({ courseId: current.courseId, title: current.title, teacher: current.teacher, room: current.room, term: current.term, type: '' });
        valid(); store.saveCatalogue(current.courseId, rows);
      } catch (err) {
        valid(); if (err instanceof AccessDenied) throw err;
        result.gaps.push('课次目录暂未刷新，仅使用已记录的课次，可能有遗漏');
      }
    } else { result.gaps.push('离线模式仅使用已缓存或下载的相关课次内容，无法确认课次目录是否完整'); }
    const known = rows.concat(downloads.map((snapshot: Snapshot) => snapshot.course));
    if (offline) known.push(...store.cache.list('slides').concat(store.cache.list('transcript')).map((entry) => entry.course));
    const earlier = priorLessons(known, current, includeLater), confirmed = new Set<string>();
    let permissions: Record<string, string> = {};
    if (!offline && earlier.length) { permissions = await this.api.permissions(earlier, (_states: Record<string, string>, ids?: string[]) => { (ids || []).forEach((id: string) => confirmed.add(id)); }, true); valid(); }
    const slideRevision = store.cache.revision('slides'), transcriptRevision = store.cache.revision('transcript');
    let cursor = 0, done = 0;
    const worker = async (): Promise<void> => {
      while (cursor < earlier.length) {
        valid(); const course = earlier[cursor++];
        const lesson: PriorLesson = { course, slides: [], lines: [], gaps: [] };
        result.lessons.push(lesson);
        if (!offline && (!confirmed.has(course.subId) || permissions[course.subId] !== 'allowed')) {
          lesson.gaps.push(permissions[course.subId] === 'denied' && confirmed.has(course.subId) ? '没有访问权限，未读取此课次' : '权限暂未确认，未读取此课次');
        } else {
          const downloaded = downloads.find((snapshot: Snapshot) => snapshot.course.subId === course.subId && snapshot.course.courseId === course.courseId);
          const readSlides = async (): Promise<void> => {
            let cached: Snapshot | undefined; try { cached = JSON.parse(store.cache.read('slides', course, 'timeline.json')) as Snapshot; } catch (_) {}
            if (cached?.course?.courseId !== course.courseId || cached?.course?.subId !== course.subId) cached = undefined;
            lesson.slides = cached?.slides || downloaded?.slides || [];
            if (offline || (cached && Date.now() - cached.savedAt < 3600000)) return;
            try { const slides = await this.api.slides(course); valid(); lesson.slides = slides; store.cache.save('slides', course, 'timeline.json', JSON.stringify({ course, slides, lines: [], savedAt: Date.now() } as Snapshot), slideRevision); }
            catch (err) { valid(); if (err instanceof AccessDenied) throw err; lesson.gaps.push('课件暂未刷新' + (lesson.slides.length ? '，使用已保存版本' : '，没有可用版本')); }
          };
          const readLines = async (): Promise<void> => {
            let cached: Snapshot | undefined; try { cached = JSON.parse(store.cache.read('transcript', course, 'timeline.json')) as Snapshot; } catch (_) {}
            if (cached?.course?.courseId !== course.courseId || cached?.course?.subId !== course.subId) cached = undefined;
            lesson.lines = cached?.lines || downloaded?.lines || [];
            if (offline || (cached && Date.now() - cached.savedAt < 3600000)) return;
            try { const lines = await this.api.transcripts(course); valid(); lesson.lines = lines; store.cache.save('transcript', course, 'timeline.json', JSON.stringify({ course, slides: [], lines, savedAt: Date.now() } as Snapshot), transcriptRevision); }
            catch (err) { valid(); if (err instanceof AccessDenied) throw err; lesson.gaps.push('转写暂未刷新' + (lesson.lines.length ? '，使用已保存版本' : '，没有可用版本')); }
          };
          // Sequential inside one lesson: a denial must not trigger another resource request.
          try { await readSlides(); await readLines(); }
          catch (err) { valid(); if (!(err instanceof AccessDenied)) throw err as Error; lesson.slides = []; lesson.lines = []; lesson.gaps = ['平台拒绝访问，未使用此课次材料']; }
          if (!lesson.lines.length) lesson.gaps.push('没有可用转写，不能确认老师的完整讲解');
          else if (lesson.lines.some((line: Transcript) => line.timing === 'source' || line.timing === 'received') && !lesson.lines.some((line: Transcript) => line.timing === 'history')) lesson.gaps.push('只有已接收的实时转写，进入前或断开期间可能缺失');
          if (!lesson.slides.length) lesson.gaps.push('没有可用课件');
        }
        valid(); progress(`正在整理课次内容 ${++done}/${earlier.length}`);
      }
    };
    await Promise.all([worker(), worker()]); valid();
    result.lessons.sort((a: PriorLesson, b: PriorLesson) => a.course.start - b.course.start || a.course.subId.localeCompare(b.course.subId));
    if (!earlier.length) result.gaps.push(includeLater ? '当前目录未找到其他已开课课次' : '当前目录未找到更早的课次');
    return result;
  }
}
