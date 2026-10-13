// Generated from shared HarmonyOS sources by sync-harmony-models.cjs.
export function summaryDue(live, finished, manual, cached, signature, now) {
    if (live && !finished && !manual)
        return false;
    if (manual || !cached || (finished || !live) && cached.completed !== true)
        return true;
    return false;
}
