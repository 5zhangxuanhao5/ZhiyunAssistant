import { Course, PageGroup, Transcript } from '../model/Timeline';
import { SkipDecision, SkipRange, conservativeRanges, untranscribedBoundaries, mergedSkipRanges } from '../model/SmartSkip';
import { AiClient } from './AiClient';
import { LocalStore, key } from './LocalStore';
export interface SkipProgress { completed: number; total: number; failed: number; running: boolean }
interface SkipRecord { signature: string; ranges: SkipRange[]; decision: SkipDecision }
interface SkipJob { group: PageGroup; end: number; signature: string }
export class SmartSkipService {
  private client: AiClient = new AiClient();
  private store: LocalStore | undefined = undefined;
  private course: Course | undefined = undefined;
  private boundaries: SkipRange[] = [];
  private allLines: Transcript[] = [];
  private completeHistory: boolean = false;
  private jobs: SkipJob[] = [];
  private records: Map<string, SkipRecord> = new Map();
  private failed: Set<string> = new Set();
  private epoch: number = 0;
  private running: boolean = false;
  private revision: number = -1;
  private timer: any = -1;
  private current: string = '';
  private notify: (ranges: SkipRange[], message: string) => void = () => {};
  private progress: (value: SkipProgress) => void = () => {};
  private publish(): void { const completed = this.jobs.filter((job: SkipJob) => this.records.has(job.signature) || this.failed.has(job.signature)).length; this.notify(this.ranges(), this.failed.size ? '部分片段尚未确认，保留原内容' : completed < this.jobs.length ? '正在识别可跳过片段' : ''); this.progress({ completed, total: this.jobs.length, failed: this.jobs.filter((job: SkipJob) => this.failed.has(job.signature)).length, running: completed < this.jobs.length }); }
  cancel(): void { this.epoch++; this.client.cancel(); clearTimeout(this.timer); this.running = false; this.current = ''; this.jobs = []; this.boundaries = []; this.allLines = []; this.completeHistory = false; this.failed.clear(); }
  private signature(group: PageGroup, end: number): string { return key('v3|' + group.slide.url + '|' + this.store?.imageVersion(group.slide.url) + '|' + end + '|' + JSON.stringify(group.lines)); }
  private ranges(): SkipRange[] { return mergedSkipRanges(this.boundaries.concat(this.jobs.flatMap((job: SkipJob) => this.records.get(job.signature)?.ranges || [])), this.allLines, this.completeHistory);  }
  update(store: LocalStore, course: Course, groups: PageGroup[], end: number, live: boolean, missing: boolean, selected: number, notify: (ranges: SkipRange[], message: string) => void, progress: (value: SkipProgress) => void = () => {}, allLines?: Transcript[]): void {
    const revision = store.cache.revision('smartSkip');
    if (store !== this.store || course.subId !== this.course?.subId || revision !== this.revision) { this.cancel(); this.store = store; this.course = course; this.revision = revision; this.records.clear(); this.failed.clear(); }
    this.notify = notify; this.progress = progress; this.completeHistory = !live && !missing; this.allLines = (allLines || groups.flatMap((group: PageGroup) => group.lines)).slice().sort((a: Transcript, b: Transcript) => a.t - b.t); this.boundaries = untranscribedBoundaries(this.allLines, end, !live, missing);
    const received = groups.flatMap((group: PageGroup) => group.lines).filter((line) => line.timing === 'received' || line.timing === 'source');
    const earliest = received.length ? Math.min(...received.map((line) => line.t)) : Infinity;
    this.jobs = groups.map((group: PageGroup, index: number): SkipJob => { return { group, end: groups[index + 1]?.slide.t ?? end, signature: this.signature(group, groups[index + 1]?.slide.t ?? end) }; }).filter((job: SkipJob, index: number) => job.end > job.group.slide.t && (!live || index < groups.length - 1) && !(live && (missing || !groups.some((item: PageGroup) => item.lines.some((line) => line.timing === 'history'))) && job.group.slide.t < earliest));
    for (const job of this.jobs) {
      if (this.records.has(job.signature)) continue;
      try { const saved = JSON.parse(store.cache.read('smartSkip', course, 'page-' + job.signature + '.json')) as SkipRecord; if (saved.signature === job.signature) this.records.set(job.signature, { signature: job.signature, decision: saved.decision, ranges: conservativeRanges(job.group, job.end, saved.decision, true, false) }); } catch (_) {}
    }
    // Work on the viewed page first, then remaining pages in chronological order.
    const viewed = groups[selected]?.slide.id, at = this.jobs.findIndex((job: SkipJob) => job.group.slide.id === viewed);
    if (at > 0) this.jobs = [this.jobs[at]].concat(this.jobs.slice(0, at), this.jobs.slice(at + 1));
    this.publish(); if (!this.running) this.next();
  }
  private async next(): Promise<void> {
    const job = this.jobs.find((item: SkipJob) => !this.records.has(item.signature) && !this.failed.has(item.signature)), store = this.store, course = this.course;
    if (!job || !store || !course || this.running) return;
    const gen = this.epoch, revision = this.revision; this.running = true; this.current = job.signature; this.publish();
    try {
      const decision = await this.client.classifySkip(store, course, job.group, job.end, this.allLines);
      if (gen !== this.epoch || revision !== store.cache.revision('smartSkip')) return;
      // Image reading may populate the image cache; use the resulting version, not a missing-image key.
      const signature = this.signature(job.group, job.end), record: SkipRecord = { signature, decision, ranges: conservativeRanges(job.group, job.end, decision, true, false) };
      this.records.set(signature, record); this.records.set(job.signature, record);
      store.cache.save('smartSkip', course, 'page-' + signature + '.json', JSON.stringify(record), revision);
      this.publish();
    } catch (err) { if (gen === this.epoch) { this.failed.add(job.signature); this.publish(); } }
    finally { if (gen === this.epoch) { this.running = false; this.current = ''; this.timer = setTimeout(() => this.next(), 800); } }
  }
}
