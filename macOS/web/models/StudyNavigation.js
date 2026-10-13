// Generated from shared HarmonyOS sources by sync-harmony-models.cjs.
import { spreadStart, pageHasContent } from './Timeline.js';
export function navigationGroups(groups, index, skip) {
    if (!skip || !groups.some((g) => pageHasContent(g)))
        return groups;
    const current = groups[index]?.slide.id;
    return groups.filter((g) => pageHasContent(g) || g.slide.id === current);
}
export function displayedGroups(groups, index, capacity, skip, manual) {
    const pages = navigationGroups(groups, index, skip && manual);
    const start = pages.findIndex((g) => g.slide.id === groups[index]?.slide.id);
    return pages.slice(Math.max(0, start), Math.max(0, start) + capacity);
}
export function manualPage(groups, index, capacity, direction, skip) {
    const last = Math.max(0, groups.length - 1), step = Math.max(1, capacity);
    if (!skip || !groups.some((g) => pageHasContent(g)))
        return Math.max(0, Math.min(spreadStart(last, step), index + direction * step));
    const pages = navigationGroups(groups, index, true);
    const position = pages.findIndex((g) => g.slide.id === groups[index]?.slide.id);
    const target = Math.max(0, Math.min(pages.length - 1, position + direction * step));
    return groups.findIndex((g) => g.slide.id === pages[target].slide.id);
}
export function gesturePage(groups, target, origin, skip) {
    if (!skip || !groups.some((g) => pageHasContent(g)) || (groups[target] && pageHasContent(groups[target])))
        return target;
    const direction = target >= origin ? 1 : -1;
    for (let i = target; i >= 0 && i < groups.length; i += direction)
        if (pageHasContent(groups[i]))
            return i;
    return origin;
}
