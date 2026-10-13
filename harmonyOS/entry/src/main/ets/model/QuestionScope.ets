import { Slide } from './Timeline';
export interface QuestionScope { whole: boolean; selectedIds: string[] }
export function questionScope(question: string, slides: Slide[], whole: boolean, selectedIds: string[]): QuestionScope {
  const normalized = question.replace(/\s+/g, '').replace(/[－—～~]/g, '-').replace(/、|，/g, ',');
  const negativeWhole = /(?:不要|不用|无需|不结合|不参考)(?:结合|参考|总结)?(?:整节课|整堂课|全部内容)/.test(normalized);
  if (!negativeWhole && /整节课|整堂课|全课内容|课程全程|(?:这节|本节|这堂|本堂)课(?:的)?(?:全部|所有)内容/.test(normalized)) return { whole: true, selectedIds: [] };
  const pages = new Set<number>();
  const pattern = /第?([0-9]+(?:-[0-9]+)?(?:,[0-9]+(?:-[0-9]+)?)*)页/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(normalized)) !== null) {
    for (const item of match[1].split(',')) { const values = item.split('-').map((value: string) => Number(value)), start = values[0], end = values[1] ?? start; if (!Number.isInteger(start) || start < 1 || !Number.isInteger(end) || end < start) continue; for (let page = start; page <= Math.min(end, slides.length); page++) pages.add(page); }
  }
  const ids = slides.filter((slide: Slide, index: number) => pages.has(index + 1)).map((slide: Slide) => slide.id);
  return { whole: negativeWhole ? false : ids.length ? false : whole, selectedIds: ids.length ? ids : selectedIds.slice() };
}
