// Generated from shared HarmonyOS sources by sync-harmony-models.cjs.
export function slideGridLayout(width, height, count, ratio = 16 / 9, gap = 12) {
    count = Math.max(1, Math.floor(count));
    ratio = Math.max(0.2, Math.min(5, ratio));
    let best = { columns: count, rows: 1, width: 0, height: 0 }, score = -1;
    for (let columns = 1; columns <= count; columns++) {
        const rows = Math.ceil(count / columns), w = Math.max(1, (width - gap * (columns - 1)) / columns), h = Math.max(1, (height - gap * (rows - 1)) / rows), imageHeight = Math.min(Math.max(1, h - 42), Math.max(1, w - 20) / ratio), area = imageHeight * imageHeight * ratio * count;
        if (area > score) {
            score = area;
            best = { columns, rows, width: w, height: h };
        }
    }
    return best;
}
