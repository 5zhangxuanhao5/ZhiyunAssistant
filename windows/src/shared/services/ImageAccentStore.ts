import { image } from '../../desktop/compat';
import { fileIo as fs, fileUri } from '../../desktop/compat';
import { imageAccent } from '../model/ImageAccent';
const colors: Map<string, string> = new Map();
const pending: Map<string, Promise<string>> = new Map();
export class ImageAccentStore {
  static async color(uri: string): Promise<string> {
    const saved = colors.get(uri); if (saved) return saved;
    const task = pending.get(uri); if (task) return task;
    const read = ImageAccentStore.read(uri); pending.set(uri, read);
    try { const color = await read; if (colors.size >= 256) colors.clear(); colors.set(uri, color); return color; } finally { pending.delete(uri); }
  }
  private static async read(uri: string): Promise<string> {
    let file: fs.File | undefined, source: image.ImageSource | undefined, pixels: image.PixelMap | undefined;
    try {
      file = fs.openSync(uri.startsWith('file://') ? new fileUri.FileUri(uri).path : uri, fs.OpenMode.READ_ONLY);
      source = image.createImageSource(file.fd);
      pixels = await source.createPixelMap({ desiredSize: { width: 32, height: 32 }, desiredPixelFormat: image.PixelMapFormat.RGBA_8888 });
      const buffer = new ArrayBuffer(pixels.getPixelBytesNumber()); await pixels.readPixelsToBuffer(buffer); const info = await pixels.getImageInfo();
      return imageAccent(new Uint8Array(buffer), info.size.width, info.size.height, pixels.getBytesNumberPerRow());
    } catch (_) { return '#7C3AED'; } finally { try { if (pixels) await pixels.release(); } catch (_) {} try { if (source) await source.release(); } catch (_) {} try { if (file) fs.closeSync(file); } catch (_) {} }
  }
}
