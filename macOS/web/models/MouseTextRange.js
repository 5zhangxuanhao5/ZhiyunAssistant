// Generated from shared HarmonyOS sources by sync-harmony-models.cjs.
export class MouseTextRange {
    constructor() {
        this.anchor = -1;
        this.x = 0;
        this.y = 0;
        this.selected = undefined;
    }
    begin(at, x, y) { if (this.anchor >= 0)
        return; this.anchor = at; this.x = x; this.y = y; this.selected = undefined; }
    move(at, x, y) { if (this.anchor < 0 || Math.hypot(x - this.x, y - this.y) <= 4)
        return undefined; this.selected = { start: Math.min(this.anchor, at), end: Math.max(this.anchor, at) }; return this.selected; }
    end() { this.anchor = -1; return this.selected; }
    cancel() { this.anchor = -1; this.selected = undefined; }
}
