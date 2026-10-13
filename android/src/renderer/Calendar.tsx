import React, { useEffect, useRef, useState } from 'react';
import './calendar.css';

export interface CalendarProps {
  value: string;
  onChange: (date: string) => void;
  onClose?: () => void;
  counts?: Readonly<Record<string, number>>;
  title?: string;
  showHeading?: boolean;
  className?: string;
}

export interface MonthCell { date: string; day: number; inMonth: boolean }
const monthPattern = /^(\d{4})-(\d{2})$/;
const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (value: number): string => String(value).padStart(2, '0');
export function validCalendarDate(value: string): boolean {
  const match = datePattern.exec(value);
  if (!match) return false;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 1900 && year <= 9998 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
export function shiftMonth(month: string, amount: number): string {
  const match = monthPattern.exec(month);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12 || !Number.isFinite(amount)) throw new Error('无效的日历月份');
  const absolute = Math.max(1900 * 12, Math.min(9998 * 12 + 11, Number(match[1]) * 12 + Number(match[2]) - 1 + Math.trunc(amount)));
  return Math.floor(absolute / 12) + '-' + pad(absolute % 12 + 1);
}
export function monthCells(month: string): MonthCell[] {
  const match = monthPattern.exec(month);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) throw new Error('无效的日历月份');
  const year = Number(match[1]), index = Number(match[2]) - 1;
  const first = new Date(Date.UTC(year, index, 1)), count = new Date(Date.UTC(year, index + 1, 0)).getUTCDate();
  const offset = (first.getUTCDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, cell) => {
    const day = cell - offset + 1, inMonth = day >= 1 && day <= count;
    return { date: inMonth ? month + '-' + pad(day) : '', day: inMonth ? day : 0, inMonth };
  });
}
function today(): string { return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10); }
interface Swipe { pointer: number; x: number; y: number; cancelled: boolean; horizontal: boolean }

export function Calendar({ value, onChange, onClose, counts = {}, title = '选择日期', showHeading = true, className = '' }: CalendarProps): React.JSX.Element {
  const initial = validCalendarDate(value) ? value : today();
  const [month, setMonth] = useState(initial.slice(0, 7));
  const swipe = useRef<Swipe | null>(null);
  const pointers = useRef(new Set<number>());
  const suppressClickUntil = useRef(0);
  useEffect(() => { if (validCalendarDate(value)) setMonth(value.slice(0, 7)); }, [value]);
  const turn = (amount: number): void => setMonth((current) => shiftMonth(current, amount));
  const cells = monthCells(month);
  const finish = (event: React.PointerEvent<HTMLDivElement>): void => {
    pointers.current.delete(event.pointerId);
    const current = swipe.current;
    if (!current || current.pointer !== event.pointerId) return;
    swipe.current = null;
    if (current.cancelled || !current.horizontal) return;
    const delta = event.clientX - current.x;
    suppressClickUntil.current = Date.now() + 350;
    if (Math.abs(delta) >= 48) turn(delta > 0 ? -1 : 1);
  };
  return <section className={'zy-calendar ' + className} aria-label={title} onKeyDown={(event) => {
    if (event.key === 'Escape' && onClose) { event.preventDefault(); onClose(); }
    if (event.key === 'PageUp' || event.key === 'PageDown') { event.preventDefault(); turn((event.key === 'PageUp' ? -1 : 1) * (event.shiftKey ? 12 : 1)); }
  }}>
    {showHeading && <header className="zy-calendar-heading"><h2>{title}</h2>{onClose && <button type="button" className="zy-calendar-done" onClick={onClose}>完成</button>}</header>}
    <div className="zy-calendar-navigation">
      <button type="button" onClick={() => turn(-12)} aria-label="上一年" title="上一年">«</button>
      <button type="button" onClick={() => turn(-1)} aria-label="上个月" title="上个月">‹</button>
      <strong aria-live="polite">{Number(month.slice(0, 4))} 年 {Number(month.slice(5))} 月</strong>
      <button type="button" onClick={() => turn(1)} aria-label="下个月" title="下个月">›</button>
      <button type="button" onClick={() => turn(12)} aria-label="下一年" title="下一年">»</button>
    </div>
    <div className="zy-calendar-week" aria-hidden="true">{['一', '二', '三', '四', '五', '六', '日'].map((day) => <span key={day}>{day}</span>)}</div>
    <div className="zy-calendar-days" key={month} onPointerDown={(event) => {
      // Suppress only the click synthesized by the preceding swipe. A new
      // pointer press is an intentional action, even if it arrives immediately.
      suppressClickUntil.current = 0;
      if (event.pointerType !== 'touch') return;
      pointers.current.add(event.pointerId);
      if (pointers.current.size > 1) { if (swipe.current) swipe.current.cancelled = true; return; }
      swipe.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, cancelled: false, horizontal: false };
    }} onPointerMove={(event) => {
      const current = swipe.current;
      if (!current || current.pointer !== event.pointerId || current.cancelled) return;
      const dx = event.clientX - current.x, dy = event.clientY - current.y;
      if (!current.horizontal && Math.abs(dy) > 22 && Math.abs(dy) > Math.abs(dx)) { current.cancelled = true; return; }
      if (Math.abs(dx) > 28 && Math.abs(dx) > Math.abs(dy) * 1.35) current.horizontal = true;
      if (current.horizontal) { if (event.cancelable) event.preventDefault(); }
    }} onPointerUp={finish} onPointerCancel={(event) => { pointers.current.delete(event.pointerId); if (swipe.current?.pointer === event.pointerId) swipe.current = null; }} onClickCapture={(event) => {
      if (Date.now() < suppressClickUntil.current) { event.preventDefault(); event.stopPropagation(); }
    }}>
      {cells.map((cell, index) => cell.inMonth ? <button type="button" key={cell.date} aria-label={cell.date + ((counts[cell.date] || 0) > 0 ? '，' + counts[cell.date] + ' 节课' : '')} aria-pressed={value === cell.date} className={'zy-calendar-day' + (value === cell.date ? ' selected' : '') + ((counts[cell.date] || 0) > 0 ? ' has-record' : '')} onClick={() => onChange(cell.date)}>
        <span>{cell.day}</span><i aria-hidden="true" />
      </button> : <span key={'blank-' + index} className="zy-calendar-blank" aria-hidden="true" />)}
    </div>
    <footer className="zy-calendar-footer"><button type="button" onClick={() => { const date = today(); setMonth(date.slice(0, 7)); onChange(date); }}>今天</button><span>{Object.values(counts).some((count) => count > 0) ? '蓝色日期有上课记录，其他日期也可选择' : '可选择任意日期'}</span></footer>
  </section>;
}
export default Calendar;
