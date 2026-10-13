import { pasteboard } from '@kit.BasicServicesKit';
import { image } from '@kit.ImageKit';
import { fileUri } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { NoteBlock, blockText } from '../model/NoteBlocks';
import { noteAtomHtml } from '../model/NoteFormatting';
function escapeText(value: string): string { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
export class NoteClipboard {
  private static busy: boolean = false;
  static async copy(blocks: NoteBlock[]): Promise<void> {
    if (NoteClipboard.busy) return; NoteClipboard.busy = true;
    let decodedBytes = 0, encodedBytes = 0;
    const pixels: image.PixelMap[] = [], html: string[] = [];
    try {
      const data = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, blocks.filter((block: NoteBlock) => !['slides', 'image'].includes(block.source)).map((block: NoteBlock) => blockText(block)).join('\n'));
      for (const block of blocks) {
        if (!['slides', 'image'].includes(block.source)) { html.push('<p>' + block.atoms.map(noteAtomHtml).join('') + '</p>'); continue; }
        const uri = block.atoms[0]?.value; if (!uri) continue;
        const source = image.createImageSource(new fileUri.FileUri(uri).path); let packer: image.ImagePacker | undefined;
        try {
          const info = await source.getImageInfo(), scale = Math.min(1, Math.sqrt(16000000 / Math.max(1, info.size.width * info.size.height)));
          decodedBytes += Math.round(info.size.width * scale) * Math.round(info.size.height * scale) * 4;
          if (decodedBytes > 96 * 1024 * 1024) throw new Error('所选图片过多，请分段复制或导出笔记');
          const pixel = await source.createPixelMap({ desiredSize: { width: Math.max(1, Math.round(info.size.width * scale)), height: Math.max(1, Math.round(info.size.height * scale)) } }); pixels.push(pixel);
          data.addRecord(pasteboard.MIMETYPE_PIXELMAP, pixel); packer = image.createImagePacker();
          const bytes = await packer.packToData(pixel, { format: 'image/png', quality: 100 });
          encodedBytes += bytes.byteLength; if (encodedBytes > 32 * 1024 * 1024) throw new Error('所选图片过多，请分段复制或导出笔记');
          html.push('<p><img src="data:image/png;base64,' + new util.Base64Helper().encodeToStringSync(new Uint8Array(bytes)) + '"></p>');
        } finally { if (packer) await packer.release(); await source.release(); }
      }
      data.addRecord(pasteboard.MIMETYPE_TEXT_HTML, html.join('')); await pasteboard.getSystemPasteboard().setData(data);
    } finally { NoteClipboard.busy = false; for (const pixel of pixels) try { await pixel.release(); } catch (_) {} }
  }
}
