// Generated from shared HarmonyOS sources by sync-harmony-models.cjs.
export class SummaryViewController {
    constructor() {
        this.reader = undefined;
    }
    bind(reader) { this.reader = reader; }
    unbind(reader) { if (!reader || reader === this.reader)
        this.reader = undefined; }
    capture() { return this.reader?.(); }
}
