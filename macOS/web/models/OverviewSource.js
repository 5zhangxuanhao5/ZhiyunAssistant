// Generated from shared HarmonyOS sources by sync-harmony-models.cjs.
// Only screenshot identity affects overview cells; incoming captions do not rebuild the grid.
export class OverviewSource {
    constructor() {
        this.rows = [];
        this.signature = '';
        this.listeners = [];
    }
    totalCount() { return this.rows.length; }
    getData(index) { return this.rows[index]; }
    registerDataChangeListener(listener) { if (!this.listeners.includes(listener))
        this.listeners.push(listener); }
    unregisterDataChangeListener(listener) { this.listeners = this.listeners.filter((item) => item !== listener); }
    replace(rows) { const signature = rows.map((row) => row.slide.id + ':' + row.slide.t + ':' + row.slide.url).join('|'); if (signature === this.signature)
        return; this.signature = signature; this.rows = rows.slice(); this.listeners.forEach((listener) => listener.onDataReloaded()); }
}
