export class AxisPaging {
  private distance: number = 0;
  private turned: boolean = false;
  private last: number = 0;
  move(horizontal: number, vertical: number, action: number, now: number = Date.now()): number {
    if (action === 1 || now - this.last > 180) { this.distance = 0; this.turned = false; }
    this.last = now;
    let turn = 0;
    if (Math.abs(horizontal) >= Math.abs(vertical)) this.distance += horizontal;
    if (!this.turned && Math.abs(this.distance) >= 32) { turn = this.distance > 0 ? -1 : 1; this.turned = true; }
    if (action === 3 || action === 4) { this.distance = 0; this.turned = false; }
    return turn;
  }
}
