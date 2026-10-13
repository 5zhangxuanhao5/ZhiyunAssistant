// Generated from shared HarmonyOS sources by sync-harmony-models.cjs.
// A short compression fringe may separate the black margin from the bright slide.
export function blackBorderRegion(pixels, width, height, stride = width * 4) {
    if (width < 32 || height < 32 || stride < width * 4 || pixels.length < stride * height)
        return undefined;
    const dark = (x, y) => {
        const i = y * stride + x * 4;
        return pixels[i] <= 42 && pixels[i + 1] <= 42 && pixels[i + 2] <= 42 && pixels[i + 3] >= 240;
    };
    const bright = (x, y) => {
        const i = y * stride + x * 4;
        return pixels[i] + pixels[i + 1] + pixels[i + 2] > 210 && pixels[i + 3] >= 240;
    };
    const blackColumn = (x) => {
        let exceptions = 0;
        for (let y = 0; y < height; y++)
            if (!dark(x, y) && ++exceptions > Math.floor(height * 0.003))
                return false;
        return true;
    };
    const blackRow = (y) => {
        let exceptions = 0;
        for (let x = 0; x < width; x++)
            if (!dark(x, y) && ++exceptions > Math.floor(width * 0.003))
                return false;
        return true;
    };
    let left = 0, right = 0, top = 0, bottom = 0;
    const maxX = Math.floor(width * 0.4), maxY = Math.floor(height * 0.4);
    while (left < maxX && blackColumn(left))
        left++;
    while (right < maxX && blackColumn(width - right - 1))
        right++;
    while (top < maxY && blackRow(top))
        top++;
    while (bottom < maxY && blackRow(height - bottom - 1))
        bottom++;
    if (left === maxX || left < 2)
        left = 0;
    if (right === maxX || right < 2)
        right = 0;
    if (top === maxY || top < 2)
        top = 0;
    if (bottom === maxY || bottom < 2)
        bottom = 0;
    const brightColumn = (x) => {
        let count = 0;
        for (let y = top; y < height - bottom; y++)
            if (bright(x, y))
                count++;
        return count / (height - top - bottom) >= 0.55;
    };
    const brightRow = (y) => {
        let count = 0;
        for (let x = left; x < width - right; x++)
            if (bright(x, y))
                count++;
        return count / (width - left - right) >= 0.55;
    };
    // JPEG edges can contain 1-4 grey pixels. Validate just inside each edge,
    // independently, then include that fringe in the crop instead of rejecting a side.
    const innerColumn = (edge, direction) => {
        for (let d = 0; d < 5; d++)
            if (brightColumn(edge + direction * d))
                return d;
        return -1;
    };
    const innerRow = (edge, direction) => {
        for (let d = 0; d < 5; d++)
            if (brightRow(edge + direction * d))
                return d;
        return -1;
    };
    const dl = left ? innerColumn(left, 1) : -1;
    const dr = right ? innerColumn(width - right - 1, -1) : -1;
    const dt = top ? innerRow(top, 1) : -1;
    const db = bottom ? innerRow(height - bottom - 1, -1) : -1;
    left = dl >= 0 ? left + dl : 0;
    right = dr >= 0 ? right + dr : 0;
    top = dt >= 0 ? top + dt : 0;
    bottom = db >= 0 ? bottom + db : 0;
    if (!left && !right && !top && !bottom)
        return undefined;
    // Sparse lettering on a black-background slide can look like the first bright
    // row after a margin. Require substantial bright slide area before cropping.
    let brightCount = 0, sampleCount = 0;
    const step = Math.max(1, Math.floor(Math.min(width, height) / 180));
    for (let y = top; y < height - bottom; y += step)
        for (let x = left; x < width - right; x += step) {
            sampleCount++;
            if (bright(x, y))
                brightCount++;
        }
    if (!sampleCount || brightCount / sampleCount < 0.3)
        return undefined;
    return { x: left, y: top, width: width - left - right, height: height - top - bottom };
}
