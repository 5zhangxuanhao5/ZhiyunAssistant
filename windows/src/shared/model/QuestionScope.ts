import { Slide } from './Timeline';
export type QuestionViewingMode = 'reading' | 'playback';
export interface QuestionScope { whole: boolean; selectedIds: string[]; currentPageOnly?: boolean }
export function questionAllowsFuture(scope: QuestionScope, viewingMode: QuestionViewingMode = 'playback'): boolean {
  return scope.whole || scope.selectedIds.length > 0 && (!scope.currentPageOnly || viewingMode === 'reading');
}
export function questionScope(question: string, slides: Slide[], whole: boolean, selectedIds: string[], currentPageId: string = ''): QuestionScope {
  const normalized = question.replace(/\s+/g, '').replace(/[－—～~]/g, '-').replace(/、|，/g, ',');
  const negativeWhole = /(?:不要|不用|无需|不结合|不参考)(?:结合|参考|总结)?(?:整节课|整堂课|全部内容)/.test(normalized);
  if (!negativeWhole && /整节课|整堂课|全课内容|课程全程|(?:这节|本节|这堂|本堂)课(?:的)?(?:全部|所有)内容/.test(normalized)) return { whole: true, selectedIds: [] };
  const pages = new Set<number>();
  const pattern = /第?([0-9]+(?:-[0-9]+)?(?:,[0-9]+(?:-[0-9]+)?)*)页/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(normalized)) !== null) {
    for (const item of match[1].split(',')) { const values = item.split('-').map((value: string) => Number(value)), start = values[0], end = values[1] ?? start; if (!Number.isInteger(start) || start < 1 || !Number.isInteger(end) || end < start) continue; for (let page = start; page <= Math.min(end, slides.length); page++) pages.add(page); }
  }
  const currentPage = slides.find((slide: Slide) => slide.id === currentPageId);
  const pageWords = '(?:(?:这(?:一)?|本|当前(?:这(?:一)?)?|此)页|这张PPT|当前PPT|(?:this|current)(?:slide|page))';
  if (currentPage && new RegExp('(?:截至|截止).*' + pageWords + '|' + pageWords + '(?:为止|之前|以前)', 'i').test(normalized)) return { whole: false, selectedIds: [] };
  const asksCurrent = !!currentPage && new RegExp(pageWords, 'i').test(normalized)
    && !new RegExp('(?:不要|不用|无需|不结合|不参考|忽略|不只|不只是|不仅|不仅仅)(?:是|看|结合|参考)?' + pageWords, 'i').test(normalized);
  const ids = slides.filter((slide: Slide, index: number) => pages.has(index + 1) || pages.size > 0 && asksCurrent && slide.id === currentPageId).map((slide: Slide) => slide.id);
  // Relative page wording selects just the displayed page, but it does not
  // authorize future video narration as an explicit numbered-page request does.
  if (!ids.length && asksCurrent) return { whole: false, selectedIds: [currentPageId], currentPageOnly: true };
  return { whole: negativeWhole ? false : ids.length ? false : whole, selectedIds: ids.length ? ids : selectedIds.slice() };
}
