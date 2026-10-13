// Generated from shared HarmonyOS sources by sync-harmony-models.cjs.
// Compare only neighbouring captures. A small Gaussian filter removes JPEG
// ringing while 16-pixel tiles retain local changes in words, numbers and diagrams.
function smoothScreenshot(source, width, height, stride) {
    const sampledWidth = Math.ceil(width / 2), sampledHeight = Math.ceil(height / 2);
    const horizontal = new Uint16Array(sampledWidth * height * 3), output = new Uint8Array(sampledWidth * sampledHeight * 3);
    for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x += 2) {
            const row = y * stride, left2 = row + (x > 1 ? x - 2 : 0) * 4, left1 = row + (x > 0 ? x - 1 : 0) * 4, middle = row + x * 4, right1 = row + (x + 1 < width ? x + 1 : width - 1) * 4, right2 = row + (x + 2 < width ? x + 2 : width - 1) * 4, target = (y * sampledWidth + (x >>> 1)) * 3;
            for (let c = 0; c < 3; c++)
                horizontal[target + c] = source[left2 + c] + source[left1 + c] * 4 + source[middle + c] * 6 + source[right1 + c] * 4 + source[right2 + c];
        }
    for (let y = 0; y < height; y += 2)
        for (let x = 0; x < sampledWidth; x++) {
            const top2 = ((y > 1 ? y - 2 : 0) * sampledWidth + x) * 3, top1 = ((y > 0 ? y - 1 : 0) * sampledWidth + x) * 3, middle = (y * sampledWidth + x) * 3, target = ((y >>> 1) * sampledWidth + x) * 3, bottom1 = ((y + 1 < height ? y + 1 : height - 1) * sampledWidth + x) * 3, bottom2 = ((y + 2 < height ? y + 2 : height - 1) * sampledWidth + x) * 3;
            for (let c = 0; c < 3; c++)
                output[target + c] = (horizontal[top2 + c] + horizontal[top1 + c] * 4 + horizontal[middle + c] * 6 + horizontal[bottom1 + c] * 4 + horizontal[bottom2 + c] + 128) >>> 8;
        }
    return output;
}
export function screenshotsEqual(a, b, width, height, strideA, strideB) {
    if (width < 64 || height < 64 || a.length < strideA * height || b.length < strideB * height)
        return false;
    for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++)
            if (a[y * strideA + x * 4 + 3] !== b[y * strideB + x * 4 + 3])
                return false;
    let rough = 0, samples = 0;
    for (let y = 0; y < height; y += 8)
        for (let x = 0; x < width; x += 8) {
            const ia = y * strideA + x * 4, ib = y * strideB + x * 4;
            rough += Math.abs(a[ia] - b[ib]) + Math.abs(a[ia + 1] - b[ib + 1]) + Math.abs(a[ia + 2] - b[ib + 2]);
            samples++;
        }
    if (rough / (samples * 3) > 12)
        return false;
    const first = smoothScreenshot(a, width, height, strideA), second = smoothScreenshot(b, width, height, strideB);
    const pixelsWide = Math.ceil(width / 2), pixelsHigh = Math.ceil(height / 2);
    const cols = Math.ceil(pixelsWide / 8), tileSum = new Array(cols * Math.ceil(pixelsHigh / 8)).fill(0), tileCount = new Array(tileSum.length).fill(0), tileStrong = new Array(tileSum.length).fill(0);
    const strongMask = new Uint8Array(pixelsWide * pixelsHigh), columnRuns = new Uint8Array(pixelsWide);
    let total = 0, strong = 0, rowRun = 0;
    for (let y = 0; y < pixelsHigh; y++)
        for (let x = 0; x < pixelsWide; x++) {
            const i = (y * pixelsWide + x) * 3, red = Math.abs(first[i] - second[i]), green = Math.abs(first[i + 1] - second[i + 1]), blue = Math.abs(first[i + 2] - second[i + 2]);
            const difference = (red + green + blue) / 3, tile = (y >>> 3) * cols + (x >>> 3);
            total += difference;
            tileSum[tile] += difference;
            tileCount[tile]++;
            if (x === 0)
                rowRun = 0;
            if (Math.max(red, green, blue) > 24) {
                strong++;
                tileStrong[tile]++;
                rowRun++;
                columnRuns[x]++;
                strongMask[y * pixelsWide + x] = 1;
                if (tileStrong[tile] > 3 || rowRun >= 4 || columnRuns[x] >= 4 || (x > 0 && y > 0 && strongMask[y * pixelsWide + x - 1] && strongMask[(y - 1) * pixelsWide + x] && strongMask[(y - 1) * pixelsWide + x - 1]))
                    return false;
            }
            else {
                rowRun = 0;
                columnRuns[x] = 0;
            }
        }
    return total / (pixelsWide * pixelsHigh) <= 3 && strong / (pixelsWide * pixelsHigh) <= 0.0008 && tileSum.every((sum, i) => sum / tileCount[i] <= 8);
}
