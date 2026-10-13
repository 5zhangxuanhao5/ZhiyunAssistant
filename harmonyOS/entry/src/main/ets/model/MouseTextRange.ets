export interface MouseRange { start: number; end: number }
export class MouseTextRange {
  private anchor: number = -1;
  private x: number = 0;
  private y: number = 0;
  private selected: MouseRange | undefined = undefined;
  begin(at: number, x: number, y: number): void { if (this.anchor >= 0) return; this.anchor = at; this.x = x; this.y = y; this.selected = undefined; }
  move(at: number, x: number, y: number): MouseRange | undefined { if (this.anchor < 0 || Math.hypot(x - this.x, y - this.y) <= 4) return undefined; this.selected = { start: Math.min(this.anchor, at), end: Math.max(this.anchor, at) }; return this.selected; }
  end(): MouseRange | undefined { this.anchor = -1; return this.selected; }
  cancel(): void { this.anchor = -1; this.selected = undefined; }
}
