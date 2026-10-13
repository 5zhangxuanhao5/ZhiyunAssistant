export class SlideSpreadSource implements IDataSource {
  private count: number = 0;
  private signature: string = '';
  private listeners: DataChangeListener[] = [];
  totalCount(): number { return this.count; }
  getData(index: number): number { return index; }
  registerDataChangeListener(listener: DataChangeListener): void { if (!this.listeners.includes(listener)) this.listeners.push(listener); }
  unregisterDataChangeListener(listener: DataChangeListener): void { this.listeners = this.listeners.filter((item: DataChangeListener) => item !== listener); }
  replace(count: number, signature: string): void { if (count === this.count && signature === this.signature) return; this.count = count; this.signature = signature; this.listeners.forEach((listener: DataChangeListener) => listener.onDataReloaded()); }
}
