// Generated from shared HarmonyOS sources by sync-harmony-models.cjs.
export function brushRange(ids, initial, anchor, target, add) {
    const chosen = new Set(initial), left = Math.max(0, Math.min(anchor, target)), right = Math.min(ids.length - 1, Math.max(anchor, target));
    for (let i = left; i <= right; i++) {
        if (add)
            chosen.add(ids[i]);
        else
            chosen.delete(ids[i]);
    }
    return ids.filter((id) => chosen.has(id));
}
