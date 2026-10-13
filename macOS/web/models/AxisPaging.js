// Generated from shared HarmonyOS sources by sync-harmony-models.cjs.
export class AxisPaging {
    constructor() {
        this.distance = 0;
        this.turned = false;
        this.last = 0;
    }
    move(horizontal, vertical, action, now = Date.now()) {
        if (action === 1 || now - this.last > 180) {
            this.distance = 0;
            this.turned = false;
        }
        this.last = now;
        let turn = 0;
        if (Math.abs(horizontal) >= Math.abs(vertical))
            this.distance += horizontal;
        if (!this.turned && Math.abs(this.distance) >= 32) {
            turn = this.distance > 0 ? -1 : 1;
            this.turned = true;
        }
        if (action === 3 || action === 4) {
            this.distance = 0;
            this.turned = false;
        }
        return turn;
    }
}
