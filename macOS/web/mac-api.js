import { Zhiyun } from "./models/Zhiyun.js";
import { shanghaiDate } from "./models/Timeline.js";

const keyOf = (row) => String(row.courseId) + ":" + String(row.subId);
const scopeOf = (account) =>
  String(account?.id || "") + ":" + String(account?.tenantId || "");
const dateValid = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || "");
const rowValid = (row) =>
  row &&
  row.courseId != null &&
  row.subId != null &&
  Number.isFinite(row.start) &&
  Number.isFinite(row.end) &&
  row.end > row.start;
const copied = (row) => ({ ...row });

/** Reconcile only date windows whose official request actually succeeded.
 * The newest request for an overlapping date governs it; a failed newer request
 * makes that date unverified, so an older empty response cannot delete the cache.
 * A per-run tombstone set prevents deleted rows reappearing in later progress
 * snapshots emitted by the shared model's internal Map.
 */
export function reconcileVerifiedCourses(
  courses,
  snapshots,
  { now = Date.now() / 1000, tombstones = new Set() } = {},
) {
  const source = new Map(
    (courses || []).filter(rowValid).map((row) => [keyOf(row), copied(row)]),
  );
  const ordered = (snapshots || [])
    .filter(
      (snapshot) =>
        snapshot && dateValid(snapshot.start) && dateValid(snapshot.end),
    )
    .map((snapshot) => {
      const rows = Array.isArray(snapshot.rows) ? snapshot.rows : [];
      return {
        ...snapshot,
        rows,
        keys:
          typeof snapshot.keys?.has === "function"
            ? snapshot.keys
            : new Set(rows.filter(rowValid).map(keyOf)),
        authoritative: snapshot.authoritative ?? snapshot.ok,
        sequence: snapshot.sequence || 0,
      };
    })
    .sort((a, b) => a.sequence - b.sequence);
  const governing = (date) => {
    let last = null;
    for (const snapshot of ordered)
      if (snapshot.start <= date && snapshot.end >= date) last = snapshot;
    return last;
  };
  const actual = new Map();
  for (const snapshot of ordered) {
    if (!snapshot.ok) continue;
    for (const row of snapshot.rows)
      if (rowValid(row) && row.end <= now) actual.set(keyOf(row), copied(row));
  }
  for (const [key, row] of actual) {
    source.set(key, row);
    tombstones.delete(key);
  }
  for (const [key, row] of source) {
    const date = shanghaiDate(row.start),
      snapshot = governing(date);
    if (snapshot?.ok && snapshot.authoritative && !snapshot.keys.has(key))
      tombstones.add(key);
    // A newer failed window is uncertainty, not evidence that the course vanished.
    if (snapshot && !snapshot.ok) tombstones.delete(key);
  }
  return [...source]
    .filter(([key]) => !tombstones.has(key))
    .map(([, row]) => row)
    .sort(
      (a, b) =>
        b.start - a.start || String(a.subId).localeCompare(String(b.subId)),
    );
}

/** Normalize successful empty windows without treating unknown payloads as
 * evidence for deleting local records. Error envelopes always fail closed. */
export function normalizeScheduleEnvelope(data) {
  if(!data || typeof data!=='object')throw new Error("课表服务暂时不可用，本机记录已保留");
  const result=data.result??data.data;
  // Some official endpoints nest their service status beside the list.
  // Never let an error carrying list:[] authorize deleting cached courses.
  const codes=[data.code,result?.code,result?.data?.code].filter(code=>code!=null).map(Number);
  if(codes.includes(401))throw new Error("课程会话未恢复，请恢复登录后重试");
  if(codes.some(code=>![0,200].includes(code)))throw new Error("课表服务暂时不可用，本机记录已保留");
  const list=result?.list??result?.data?.list;
  if(Array.isArray(list))return{days:list,authoritative:true};
  // Some successful no-class responses contain [] or an empty object rather
  // than list:[]. They are readable but cannot authorize cache removal.
  if(codes.length){
    if(result==null || (Array.isArray(result)&&result.length===0) || (typeof result==='object'&&!Array.isArray(result)&&Object.keys(result).length===0) || (typeof result==='object'&&('list' in result)&&result.list==null))return{days:[],authoritative:false};
  }
  throw new Error("课表数据格式暂时无法识别，本机记录已保留");
}

/** Mac adapter; shared endpoint, permission and parsing implementations stay intact. */
export class MacZhiyun extends Zhiyun {
  async request(path, body = "", origin = undefined) {
    const text = await super.request(path, body, origin);
    if (path.startsWith("/courseapi/v2/schedule/get-week-schedules")) {
      const data=JSON.parse(text),normalized=normalizeScheduleEnvelope(data);
      return JSON.stringify({...data,result:{list:normalized.days},__macScheduleAuthoritative:normalized.authoritative});
    }
    return text;
  }
  constructor({
    maxSnapshots = 256,
    maxRecords = 12000,
    clock = () => Date.now() / 1000,
  } = {}) {
    super();
    this.maxSnapshots = Math.max(
      1,
      Math.min(512, Math.round(maxSnapshots) || 256),
    );
    this.maxRecords = Math.max(
      1,
      Math.min(50000, Math.round(maxRecords) || 12000),
    );
    this.clock = clock;
    this.scheduleScope = "";
    this.scheduleRevision = 0;
    this.scheduleSequence = 0;
    this.scheduleSnapshots = new Map();
    this.historyRuns = new Set();
  }
  /** Explicit logout cleanup is available; automatic rebinding also clears records. */
  reset(account = null) {
    super.cancel();
    this.scheduleScope = account ? scopeOf(account) : "";
    this.scheduleRevision++;
    this.scheduleSequence = 0;
    this.scheduleSnapshots.clear();
    this.historyRuns.clear();
    this.historyTerms = undefined;
  }
  ensureScheduleScope(account) {
    const scope = scopeOf(account);
    if (scope !== this.scheduleScope) this.reset(account);
    return this.scheduleRevision;
  }
  get verifiedSchedules() {
    return [...this.scheduleSnapshots.values()].map((snapshot) => ({
      ...snapshot,
      rows: snapshot.rows.map(copied),
      keys: new Set(snapshot.keys),
    }));
  }
  recordSchedule(start, end, rows, ok, sequence, revision, verified=true) {
    if (
      revision !== this.scheduleRevision ||
      !dateValid(start) ||
      !dateValid(end) ||
      end < start
    )
      return;
    const retained = rows.filter(rowValid),
      authoritative = verified && retained.length <= this.maxRecords;
    const snapshot = {
      start,
      end,
      rows: retained.slice(0, this.maxRecords).map(copied),
      keys: new Set(retained.slice(0, this.maxRecords).map(keyOf)),
      ok,
      authoritative: ok && authoritative,
      sequence,
    };
    const key = start + "|" + end,
      current = this.scheduleSnapshots.get(key);
    if (!current || current.sequence <= sequence)
      this.scheduleSnapshots.set(key, snapshot);
    for (const run of this.historyRuns)
      if (run.revision === revision) {
        const old = run.snapshots.get(key);
        if (!old || old.sequence <= sequence) run.snapshots.set(key, snapshot);
      }
    const ordered = [...this.scheduleSnapshots].sort(
      (a, b) => a[1].sequence - b[1].sequence,
    );
    let count = ordered.reduce(
      (total, [, item]) => total + item.rows.length,
      0,
    );
    while (
      ordered.length > this.maxSnapshots ||
      (count > this.maxRecords && ordered.length > 1)
    ) {
      const [key, old] = ordered.shift();
      this.scheduleSnapshots.delete(key);
      count -= old.rows.length;
    }
  }
  async schedules(account, start, end) {
    const revision = this.ensureScheduleScope(account),
      sequence = ++this.scheduleSequence;
    try {
      const path=`/courseapi/v2/schedule/get-week-schedules?user_id=${encodeURIComponent(account.id)}&tenant_id=${account.tenantId}&start_at=${start}&end_at=${end}`;
      const data=JSON.parse(await this.request(path)),rows=[];
      for(const day of data.result.list){
        const items=day?.course??day?.courses??day?.list??[];
        if(!Array.isArray(items))throw new Error("课表课程格式暂时无法识别，本机记录已保留");
        for(const c of items){
          const begin=this.epochSeconds(c.start_at),finish=this.epochSeconds(c.end_at),sub=c.sub_id||c.class_id||c.id;
          if(sub&&c.course_id&&begin>0&&finish>begin)rows.push({subId:String(sub),courseId:String(c.course_id),title:c.course_title||c.title||'未命名课程',term:this.termLabel(c.term_name||''),teacher:c.teacher_name||c.lecturer_name||'',room:c.room_name||'',status:String(c.status||c.sub_status||c.status_label||''),start:begin,end:finish});
        }
      }
      rows.sort((a,b)=>a.start-b.start);
      if(revision!==this.scheduleRevision)throw new Error("账号已更换，原课表同步已取消");
      this.recordSchedule(start,end,rows,true,sequence,revision,data.__macScheduleAuthoritative!==false);
      return rows;
    } catch (error) {
      this.recordSchedule(start, end, [], false, sequence, revision);
      throw error;
    }
  }
  mergeCurrentSchedules(fresh,cached=[]) {
    const start=shanghaiDate(this.clock()-14*86400),end=shanghaiDate(this.clock()+86400);
    const candidates=[...cached,...fresh].filter(row=>rowValid(row)&&shanghaiDate(row.start)>=start&&shanghaiDate(row.start)<=end);
    return reconcileVerifiedCourses(candidates,this.verifiedSchedules,{now:Infinity}).sort((a,b)=>a.start-b.start);
  }
  /** Call super for all official history paging; normalize both progress and final states. */
  async attendanceHistory(account, progress = () => {}, initial) {
    const revision = this.ensureScheduleScope(account),
      scope = this.scheduleScope;
    const belongs = !initial?.scheduleOwner || initial.scheduleOwner === scope;
    const startState = belongs ? initial : { courses: [], complete: false };
    const run = {
      revision,
      snapshots: new Map(this.scheduleSnapshots),
      tombstones: new Set(),
    };
    this.historyRuns.add(run);
    const clean = (state) => ({
      ...state,
      scheduleOwner: scope,
      courses: reconcileVerifiedCourses(
        state?.courses || [],
        [...run.snapshots.values()],
        { now: this.clock(), tombstones: run.tombstones },
      ),
    });
    try {
      const result = await super.attendanceHistory(
        account,
        (done, limit, state) => {
          if (revision === this.scheduleRevision)
            progress(done, limit, clean(state));
        },
        startState,
      );
      if (revision !== this.scheduleRevision)
        throw new Error("账号已更换，原课程记录同步已取消");
      return clean(result);
    } finally {
      this.historyRuns.delete(run);
    }
  }
}
