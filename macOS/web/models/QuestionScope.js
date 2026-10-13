// Generated from shared HarmonyOS sources by sync-harmony-models.cjs.
export function questionScope(question, slides, whole, selectedIds) {
    const normalized = question.replace(/\s+/g, '').replace(/[－—～~]/g, '-').replace(/、|，/g, ',');
    const negativeWhole = /(?:不要|不用|无需|不结合|不参考)(?:结合|参考|总结)?(?:整节课|整堂课|全部内容)/.test(normalized);
    if (!negativeWhole && /整节课|整堂课|全课内容|课程全程|(?:这节|本节|这堂|本堂)课(?:的)?(?:全部|所有)内容/.test(normalized))
        return { whole: true, selectedIds: [] };
    const pages = new Set();
    const pattern = /第?([0-9]+(?:-[0-9]+)?(?:,[0-9]+(?:-[0-9]+)?)*)页/g;
    let match;
    while ((match = pattern.exec(normalized)) !== null) {
        for (const item of match[1].split(',')) {
            const values = item.split('-').map((value) => Number(value)), start = values[0], end = values[1] ?? start;
            if (!Number.isInteger(start) || start < 1 || !Number.isInteger(end) || end < start)
                continue;
            for (let page = start; page <= Math.min(end, slides.length); page++)
                pages.add(page);
        }
    }
    const ids = slides.filter((slide, index) => pages.has(index + 1)).map((slide) => slide.id);
    return { whole: negativeWhole ? false : ids.length ? false : whole, selectedIds: ids.length ? ids : selectedIds.slice() };
}
