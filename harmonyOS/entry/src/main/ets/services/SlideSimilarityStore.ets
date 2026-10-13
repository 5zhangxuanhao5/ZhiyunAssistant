import { image } from '@kit.ImageKit';
import { taskpool } from '@kit.ArkTS';
import { fileIo as fs, fileUri } from '@kit.CoreFileKit';
import { screenshotsEqual } from '../model/SlideSimilarity';
interface ScreenshotPixels { bytes: ArrayBuffer; width: number; height: number; stride: number }
@Concurrent
function compareScreenshotPixels(a: ArrayBuffer, b: ArrayBuffer, width: number, height: number, strideA: number, strideB: number): boolean {
  return screenshotsEqual(new Uint8Array(a), new Uint8Array(b), width, height, strideA, strideB);
}
export class SlideSimilarityStore {
  private results: Map<string, boolean> = new Map();
  private async read(uri: string): Promise<ScreenshotPixels | undefined> {
    let file: fs.File | undefined, source: image.ImageSource | undefined, pixels: image.PixelMap | undefined;
    try {
      file = fs.openSync(uri.startsWith('file://') ? new fileUri.FileUri(uri).path : uri, fs.OpenMode.READ_ONLY);
      source = image.createImageSource(file.fd); const original = await source.getImageInfo();
      if (original.size.width * original.size.height > 4000000) return undefined;
      pixels = await source.createPixelMap({ desiredPixelFormat: image.PixelMapFormat.RGBA_8888 });
      const bytes = new ArrayBuffer(pixels.getPixelBytesNumber()); await pixels.readPixelsToBuffer(bytes); const info = await pixels.getImageInfo();
      return { bytes, width: info.size.width, height: info.size.height, stride: pixels.getBytesNumberPerRow() };
    } catch (_) { return undefined; }
    finally { try { if (pixels) await pixels.release(); } catch (_) {} try { if (source) await source.release(); } catch (_) {} try { if (file) fs.closeSync(file); } catch (_) {} }
  }
  async same(first: string, second: string): Promise<boolean> {
    try {
      const pathA = first.startsWith('file://') ? new fileUri.FileUri(first).path : first, pathB = second.startsWith('file://') ? new fileUri.FileUri(second).path : second;
      const statA = fs.statSync(pathA), statB = fs.statSync(pathB);
      const key = first + ':' + statA.size + ':' + statA.mtime + '|' + second + ':' + statB.size + ':' + statB.mtime;
      if (this.results.has(key)) return this.results.get(key) === true;
      const a = await this.read(first), b = await this.read(second);
      if (!a || !b || a.width !== b.width || a.height !== b.height) return false;
      const same = await taskpool.execute(compareScreenshotPixels, a.bytes, b.bytes, a.width, a.height, a.stride, b.stride) as boolean;
      if (this.results.size > 1000) this.results.clear(); this.results.set(key, same); return same;
    } catch (_) { return false; }
  }
}
