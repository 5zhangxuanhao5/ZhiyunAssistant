// Generated from shared HarmonyOS sources by sync-harmony-models.cjs.
export class SlideSpreadSource {
    constructor() {
        this.count = 0;
        this.signature = '';
        this.listeners = [];
    }
    totalCount() { return this.count; }
    getData(index) { return index; }
    registerDataChangeListener(listener) { if (!this.listeners.includes(listener))
        this.listeners.push(listener); }
    unregisterDataChangeListener(listener) { this.listeners = this.listeners.filter((item) => item !== listener); }
    replace(count, signature) { if (count === this.count && signature === this.signature)
        return; this.count = count; this.signature = signature; this.listeners.forEach((listener) => listener.onDataReloaded()); }
}
