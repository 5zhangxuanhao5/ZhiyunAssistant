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

/** Mac adapter; shared endpoint, permission and parsing implementations stay intact. */
export class MacZhiyun extends Zhiyun {
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
  recordSchedule(start, end, rows, ok, sequence, revision) {
    if (
      revision !== this.scheduleRevision ||
      !dateValid(start) ||
      !dateValid(end) ||
      end < start
    )
      return;
    const retained = rows.filter(rowValid),
      authoritative = retained.length <= this.maxRecords;
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
      const rows = await super.schedules(account, start, end);
      if (revision !== this.scheduleRevision)
        throw new Error("账号已更换，原课表同步已取消");
      this.recordSchedule(start, end, rows, true, sequence, revision);
      return rows;
    } catch (error) {
      this.recordSchedule(start, end, [], false, sequence, revision);
      throw error;
    }
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
