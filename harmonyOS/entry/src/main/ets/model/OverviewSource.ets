import { PageGroup } from './Timeline';
// Only screenshot identity affects overview cells; incoming captions do not rebuild the grid.
export class OverviewSource implements IDataSource {
  private rows: PageGroup[] = [];
  private signature: string = '';
  private listeners: DataChangeListener[] = [];
  totalCount(): number { return this.rows.length; }
  getData(index: number): PageGroup { return this.rows[index]; }
  registerDataChangeListener(listener: DataChangeListener): void { if (!this.listeners.includes(listener)) this.listeners.push(listener); }
  unregisterDataChangeListener(listener: DataChangeListener): void { this.listeners = this.listeners.filter((item: DataChangeListener) => item !== listener); }
  replace(rows: PageGroup[]): void { const signature = rows.map((row: PageGroup) => row.slide.id + ':' + row.slide.t + ':' + row.slide.url).join('|'); if (signature === this.signature) return; this.signature = signature; this.rows = rows.slice(); this.listeners.forEach((listener: DataChangeListener) => listener.onDataReloaded()); }
}
