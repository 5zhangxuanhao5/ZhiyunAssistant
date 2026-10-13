// Official classrooms use relative seconds, Unix seconds/milliseconds or China-local date strings.
export function captionSeconds(value: number | string | undefined, courseStart: number): number {
  if (value === undefined || value === null || String(value).trim() === '') return Number.NaN;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    if (numeric >= 1e11) return numeric / 1000 - courseStart;
    if (numeric >= 1e9) return numeric - courseStart;
    return numeric;
  }
  const date = String(value).trim().replace(' ', 'T');
  return Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(date) ? date : date + '+08:00') / 1000 - courseStart;
}
