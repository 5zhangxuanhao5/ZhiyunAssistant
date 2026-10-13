import { PageGroup, Transcript } from './Timeline';
export interface SkipSpan { ids: string[]; kind: string; confidence: number; reason: string }
export interface SkipDecision { spans: SkipSpan[]; emptyPage: boolean; confidence: number; visual: string }
export interface SkipRange { start: number; end: number; ids: string[]; reason: string; pageId: string }
export function fillerOnly(value: string): boolean { return !!value.trim() && !value.replace(/[嗯啊呃唔唉诶欸噢哦呀哎嗐哈\s，。！？、,.!?…～~]+/g, ''); }
export function conservativeRanges(group: PageGroup, end: number, decision: SkipDecision, complete: boolean, historyMissing: boolean): SkipRange[] {
  if (group.lines.some((line: Transcript) => !Number.isFinite(line.t) || line.end !== undefined && !Number.isFinite(line.end)) || !complete || historyMissing || !Number.isFinite(end) || end <= group.slide.t || !decision || !Array.isArray(decision.spans)) return [];
  const visualEmpty = ['blank', 'desktop'].includes(decision.visual);
  if (decision.emptyPage === true && Number.isFinite(decision.confidence) && decision.confidence >= 0.95 && decision.confidence <= 1 && visualEmpty && (end - group.slide.t >= 3) && group.lines.every((line: Transcript) => fillerOnly(line.text))) return [{ start: group.slide.t, end, ids: group.lines.map((line: Transcript) => line.id), reason: '无课程讲解', pageId: group.slide.id }];
  const result: SkipRange[] = [], used = new Set<string>();
  decision.spans.forEach((span: SkipSpan) => {
    if (!span || !['noise', 'break', 'chatter'].includes(span.kind) || !Number.isFinite(span.confidence) || span.confidence < 0.95 || span.confidence > 1 || !Array.isArray(span.ids) || !span.ids.length) return;
    const ids = new Set(span.ids); if (ids.size !== span.ids.length || span.ids.some((id: string) => typeof id !== 'string' || used.has(id))) return;
    const lines = group.lines.filter((line: Transcript) => ids.has(line.id)); if (lines.length !== ids.size) return;
    const index = group.lines.findIndex((line: Transcript) => line.id === lines[0].id);
    if (!group.lines.slice(index, index + lines.length).every((line: Transcript) => ids.has(line.id))) return;
    // A short answer or an example can be useful. Never remove it as mere noise.
    if (/口误复读|重复(?:上[一句]|讲解|问话)|强调|复述/.test(span.reason || '')) return;
    if (!span.reason?.trim() && !lines.every((line: Transcript) => fillerOnly(line.text))) return;
    if (lines.some((line: Transcript) => /作业|考试|定义|公式|概念|案例|例如|举例|总结|下节课|下次课|思考|讨论|提问|回答|所以|因此/.test(line.text))) return;
    const start = lines[0].t, next = group.lines[index + lines.length]?.t ?? end;
    const finish = Math.min(end, next);
    if (start < group.slide.t || finish - start < 0.5 || finish > end) return;
    lines.forEach((line: Transcript) => used.add(line.id)); result.push({ start, end: finish, ids: lines.map((line: Transcript) => line.id), reason: span.kind === 'chatter' ? '非课堂闲聊' : span.kind === 'break' ? '课间休息' : '无实质讲解', pageId: group.slide.id });
  }); return result.sort((a: SkipRange, b: SkipRange) => a.start - b.start);
}
export function filteredTranscript(lines: Transcript[], ranges: SkipRange[]): Transcript[] { const ids = new Set(ranges.flatMap((range: SkipRange) => range.ids)); return lines.filter((line: Transcript) => !ids.has(line.id)); }
export function automaticSkip(at: number, end: number, ranges: SkipRange[]): SkipRange | undefined { if (!Number.isFinite(at) || !Number.isFinite(end) || end <= 0) return undefined; return ranges.find((range: SkipRange) => at >= range.start && at < range.end - 0.25 && range.end <= end && range.end - range.start >= 3); }

// Silence before the first transcript is known only after a successful history
// fetch. Never infer it from late-join live captions, failed history or no captions.
export function untranscribedBoundaries(lines: Transcript[], end: number, complete: boolean, missing: boolean): SkipRange[] {
  if (!complete || missing || !Number.isFinite(end) || end <= 0 || !lines.length || lines.some((line: Transcript) => !Number.isFinite(line.t) || line.t < 0 || line.t > end || line.timing === 'received' || line.timing === 'source')) return [];
  const ordered = lines.slice().sort((a: Transcript, b: Transcript) => a.t - b.t), first = ordered[0], last = ordered[ordered.length - 1], ranges: SkipRange[] = [];
  if (first.t >= 30) ranges.push({ start: 0, end: first.t, ids: [], reason: '开课前无转写片段', pageId: 'boundary-start' });
  // Do not invent the end of a sentence when the server supplied only its start.
  if (Number.isFinite(last.end) && last.end! > last.t && end - last.end! >= 30) ranges.push({ start: last.end!, end, ids: [], reason: '末尾无转写片段', pageId: 'boundary-end' });
  return ranges;
}
export function mergedSkipRanges(ranges: SkipRange[], evidence?: Transcript[], completeHistory: boolean = false): SkipRange[] {
  const ordered = ranges.filter((range: SkipRange) => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start).slice().sort((a: SkipRange, b: SkipRange) => a.start - b.start), result: SkipRange[] = [];
  const confirmed = new Set(ordered.flatMap((range: SkipRange) => range.ids));
  if (completeHistory && evidence?.length && evidence.every((line: Transcript) => Number.isFinite(line.t) && line.t >= 0 && line.timing !== 'received' && line.timing !== 'source')) {
    const first = evidence.reduce((a: Transcript, item: Transcript): Transcript => item.t < a.t ? item : a), firstRange = ordered[0];
    if (firstRange && confirmed.has(first.id) && firstRange.start <= first.t && firstRange.start > 0) ordered.unshift({ start: 0, end: firstRange.start, ids: [], reason: '开课前无实质讲解', pageId: firstRange.pageId });
  }
  ordered.forEach((range: SkipRange) => { const previous = result[result.length - 1]; if (previous && (range.start <= previous.end + 0.01 || evidence !== undefined && range.start - previous.end <= 10 && !evidence.some((line: Transcript) => !confirmed.has(line.id) && line.t < range.start && (line.t >= previous.end || (line.end || line.t) > previous.end)))) { previous.end = Math.max(previous.end, range.end); previous.ids = Array.from(new Set(previous.ids.concat(range.ids))); if (previous.reason !== range.reason) previous.reason = '无效讲解片段'; } else result.push({ start: range.start, end: range.end, ids: range.ids.slice(), reason: range.reason, pageId: range.pageId }); });
  return result;
}
