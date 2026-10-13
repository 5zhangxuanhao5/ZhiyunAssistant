import { PageGroup, spreadStart, pageHasContent } from './Timeline';
export function navigationGroups(groups: PageGroup[], index: number, skip: boolean): PageGroup[] {
  if (!skip || !groups.some((g: PageGroup) => pageHasContent(g))) return groups;
  const current = groups[index]?.slide.id;
  return groups.filter((g: PageGroup) => pageHasContent(g) || g.slide.id === current);
}
export function displayedGroups(groups: PageGroup[], index: number, capacity: number, skip: boolean, manual: boolean): PageGroup[] {
  const pages = navigationGroups(groups, index, skip && manual);
  const start = pages.findIndex((g: PageGroup) => g.slide.id === groups[index]?.slide.id);
  return pages.slice(Math.max(0, start), Math.max(0, start) + capacity);
}
export function manualPage(groups: PageGroup[], index: number, capacity: number, direction: number, skip: boolean): number {
  const last = Math.max(0, groups.length - 1), step = Math.max(1, capacity);
  if (!skip || !groups.some((g: PageGroup) => pageHasContent(g))) return Math.max(0, Math.min(spreadStart(last, step), index + direction * step));
  const pages = navigationGroups(groups, index, true);
  const position = pages.findIndex((g: PageGroup) => g.slide.id === groups[index]?.slide.id);
  const target = Math.max(0, Math.min(pages.length - 1, position + direction * step));
  return groups.findIndex((g: PageGroup) => g.slide.id === pages[target].slide.id);
}
export function gesturePage(groups: PageGroup[], target: number, origin: number, skip: boolean): number {
  if (!skip || !groups.some((g: PageGroup) => pageHasContent(g)) || (groups[target] && pageHasContent(groups[target]))) return target;
  const direction = target >= origin ? 1 : -1;
  for (let i = target; i >= 0 && i < groups.length; i += direction) if (pageHasContent(groups[i])) return i;
  return origin;
}
