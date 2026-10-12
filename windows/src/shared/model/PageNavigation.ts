import { spreadStart } from './Timeline';

export function lastPageStart(total: number, capacity: number): number {
  return total > capacity ? spreadStart(total - 1, capacity) : 0;
}
export function dragPageOffset(index: number, total: number, capacity: number, step: number, fingerOffset: number): number {
  const limit = capacity * 3 * step;
  return Math.max(-Math.min(limit, (lastPageStart(total, capacity) - index) * step), Math.min(Math.min(limit, index * step), fingerOffset * 2));
}
export function releasedPage(index: number, total: number, capacity: number, step: number, offset: number, velocity: number): number {
  let distance = Math.round(-offset / Math.max(1, step));
  if (distance === 0 && Math.abs(offset) > 12 && Math.abs(velocity) > 500) distance = offset < 0 ? 1 : -1;
  return Math.max(0, Math.min(lastPageStart(total, capacity), index + distance));
}
export function courseSeconds(value: string): number {
  const parts = value.trim().replace(/：/g, ':').split(':');
  if (parts.length < 2 || parts.length > 3 || parts.some((p: string) => !/^\d{1,3}$/.test(p))) return -1;
  const numbers = parts.map((p: string) => Number(p));
  if (numbers[numbers.length - 1] >= 60 || (numbers.length === 3 && numbers[1] >= 60)) return -1;
  return numbers.length === 3 ? numbers[0] * 3600 + numbers[1] * 60 + numbers[2] : numbers[0] * 60 + numbers[1];
}
