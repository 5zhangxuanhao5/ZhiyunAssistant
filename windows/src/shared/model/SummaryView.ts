import { PriorCourseContext } from './CourseContext';
import { PageSummaryRecord } from './SummaryPolicy';
export interface SummaryView {
  courseId: string; pageId: string; scope: string; allPages: boolean; scroll: number;
  pinnedResult?: PageSummaryRecord; results: Record<string, PageSummaryRecord>; prior?: PriorCourseContext; priorNotice: string; priorRevision: string;
}
export class SummaryViewController {
  private reader: (() => SummaryView) | undefined = undefined;
  bind(reader: () => SummaryView): void { this.reader = reader; }
  unbind(reader?: () => SummaryView): void { if (!reader || reader === this.reader) this.reader = undefined; }
  capture(): SummaryView | undefined { return this.reader?.(); }
}
