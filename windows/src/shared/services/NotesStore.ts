import { noteOpenedAt, noteExportCourse, noteExportDate, noteExportName, notePictureName, uniqueExportName } from '../model/NoteExport';
import { Zhiyun } from './Zhiyun';
import { safeFilename, lessonLabel } from '../model/StudyFolders';
import { common } from '../../desktop/compat';
import { fileIo as fs, fileUri, picker } from '../../desktop/compat';
import { util } from '../../desktop/compat';
import { zlib } from '../../desktop/compat';
import { LocalStore, key } from './LocalStore';
import { LessonNote, NoteAtom } from '../model/Notes';
import { noteAtomHtml, noteAtomMarkdown } from '../model/NoteFormatting';
import { Account, Course, stamp, shanghaiDate, clockTime } from '../model/Timeline';
function escaped(value: string): string { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function referenceLabel(kind: string): string { return kind === 'question' ? '课程问答' : kind === 'summary' ? '本页速览' : '转写引用'; }
export class NotesStore {
  private store: LocalStore;
  constructor(store: LocalStore) { this.store = store; }
  private legacyName(course: Course): string { return 'notes-' + key(course.subId) + '.json'; }
  private noteName(course: Course, id: string): string { return 'notes-' + key(course.subId) + '-' + key(id) + '.json'; }
  private normalized(note: LessonNote): LessonNote { if (!note.id) note.id = 'default'; if (!note.title) note.title = '课堂笔记'; if (!Array.isArray(note.anchors)) note.anchors = []; note.atoms = note.atoms.filter(atom => atom && typeof atom.value === 'string' && typeof atom.kind === 'string'); if (note.blocks) note.blocks = note.blocks.filter(block => block && Array.isArray(block.atoms)).map(block => ({ ...block, atoms: block.atoms.filter(atom => atom && typeof atom.value === 'string' && typeof atom.kind === 'string') })); return note; }
  load(course: Course, id: string = 'default'): LessonNote {
    try { const saved = JSON.parse(this.store.readJson(this.noteName(course, id))) as LessonNote; if (saved?.atoms) return this.normalized(saved); } catch (_) {}
    if (id === 'default') try { const saved = JSON.parse(this.store.readJson(this.legacyName(course))) as LessonNote; if (saved?.atoms) return this.normalized(saved); } catch (_) {}
    return { id, title: id === 'default' ? '课堂笔记' : '新建笔记', course, atoms: [], anchors: [], savedAt: 0 };
  }
  create(course: Course, title: string): LessonNote { return { id: 'note-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7), title, course, atoms: [], anchors: [], savedAt: Date.now(), openedAt: Date.now() }; }
  listFor(course: Course): LessonNote[] {
    const notes: LessonNote[] = [];
    this.files().forEach((name: string) => { try { const raw = JSON.parse(this.store.readJson(name)) as LessonNote; if (raw?.course?.subId === course.subId && Array.isArray(raw.atoms)) { const note = this.normalized(raw), index = notes.findIndex((entry: LessonNote) => entry.id === note.id); if (index < 0) notes.push(note); else if (note.savedAt > notes[index].savedAt) notes[index] = note; } } catch (_) {} });
    if (!notes.some((n: LessonNote) => n.id === 'default')) {
      try { const legacy = JSON.parse(this.store.readJson(this.legacyName(course))) as LessonNote; if (legacy?.atoms?.length) notes.push(this.normalized(legacy)); } catch (_) {}
    }
    return notes.sort((a: LessonNote, b: LessonNote) => noteOpenedAt(b) - noteOpenedAt(a));
  }
  private files(): string[] { return fs.listFileSync(this.store.dataFolder).filter((name: string) => /^notes-[a-f0-9]+(?:-[a-f0-9]+)?\.json$/.test(name)); }
  list(): LessonNote[] {
    const notes: LessonNote[] = [];
    this.files().forEach((name: string) => { try { const raw = JSON.parse(this.store.readJson(name)) as LessonNote; if (raw?.course?.subId && Array.isArray(raw.atoms)) { const note = this.normalized(raw), index = notes.findIndex((entry: LessonNote) => entry.course.subId === note.course.subId && entry.id === note.id); if (index < 0) notes.push(note); else if (note.savedAt > notes[index].savedAt) notes[index] = note; } } catch (_) {} });
    return notes.sort((a: LessonNote, b: LessonNote) => noteOpenedAt(b) - noteOpenedAt(a));
  }
  save(note: LessonNote): void {
    this.normalized(note); note.savedAt = Date.now(); this.store.saveJson(this.noteName(note.course, note.id!), JSON.stringify(note));
    if (note.id === 'default') try { const legacy = this.store.dataFolder + '/' + this.legacyName(note.course); if (fs.accessSync(legacy)) fs.unlinkSync(legacy); } catch (_) {}
  }
  opened(course: Course, id: string): LessonNote { const note = this.load(course, id); note.openedAt = Date.now(); if (note.savedAt || note.atoms.length) this.store.saveJson(this.noteName(course, id), JSON.stringify(note)); return note; }
  delete(note: LessonNote): void {
    if (!note.id || note.id === 'default') this.store.deleteJson(this.legacyName(note.course));
    this.store.deleteJson(this.noteName(note.course, note.id || 'default'));
  }
  rename(note: LessonNote, title: string): void { note.namedByUser = true; note.title = title.trim().slice(0, 100) || '课堂笔记'; this.save(note); }
  picture(uri: string): string {
    const directory = this.store.dataFolder + '/note-images'; if (!fs.accessSync(directory)) fs.mkdirSync(directory, true);
    const source = uri.startsWith('file://') ? new fileUri.FileUri(uri).path : uri;
    if (source.startsWith(directory + '/')) return fileUri.getUriFromPath(source);
    const filename = directory + '/' + key(uri) + '.img';
    if (!fs.accessSync(filename)) {
      const file = fs.openSync(source, fs.OpenMode.READ_ONLY); try { fs.copyFileSync(file.fd, filename); } finally { fs.closeSync(file); }
    }
    return fileUri.getUriFromPath(filename);
  }
  pictureData(data: ArrayBuffer): string {
    const directory = this.store.dataFolder + '/note-images'; if (!fs.accessSync(directory)) fs.mkdirSync(directory, true);
    const filename = directory + '/device-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7) + '.jpg';
    const file = fs.openSync(filename, fs.OpenMode.CREATE | fs.OpenMode.WRITE_ONLY | fs.OpenMode.TRUNC);
    try { fs.writeSync(file.fd, data); } finally { fs.closeSync(file); }
    return fileUri.getUriFromPath(filename);
  }
  private imageData(uri: string): string { try { const file = fs.openSync(uri, fs.OpenMode.READ_ONLY); try { const size = fs.statSync(file.fd).size; if (size > 30 * 1024 * 1024) return ''; const data = new ArrayBuffer(size); fs.readSync(file.fd, data); const bytes = new Uint8Array(data); const mime = bytes[0] === 0x89 && bytes[1] === 0x50 ? 'image/png' : bytes[0] === 0xFF && bytes[1] === 0xD8 ? 'image/jpeg' : bytes[0] === 0x52 && bytes[8] === 0x57 ? 'image/webp' : bytes[0] === 0x47 && bytes[1] === 0x49 ? 'image/gif' : 'application/octet-stream'; return 'data:' + mime + ';base64,' + new util.Base64Helper().encodeToStringSync(bytes); } finally { fs.closeSync(file); } } catch (_) { return ''; } }
  private html(note: LessonNote): string {
    let offset = 0;
    return `<h1>${escaped(note.course.title)}</h1><h2>${escaped(note.title || '课堂笔记')}</h2><p>${shanghaiDate(note.course.start)} ${clockTime(note.course.start)}</p>` + note.atoms.map((atom: NoteAtom, index: number) => {
      const anchors = note.anchors.filter((a) => a.offset >= offset && a.offset < offset + (atom.kind === 'text' ? atom.value.length : 1)); offset += atom.kind === 'text' ? atom.value.length : 1;
      const label = `<small class="time">${stamp(atom.at)}</small>`;
      if (atom.kind === 'image') return `<figure>${label}<img src="${this.imageData(atom.value)}"></figure>`;
      if (['quote', 'question', 'summary'].includes(atom.kind)) return (note.atoms[index - 1]?.kind === atom.kind ? '' : `<blockquote>${label}<small>${referenceLabel(atom.kind)}</small> `) + noteAtomHtml(atom) + (note.atoms[index + 1]?.kind === atom.kind ? '' : '</blockquote>');
      let value = escaped(atom.value).replace(/\n/g, '<br>'); if (atom.bold) value = '<b>' + value + '</b>'; if (atom.italic) value = '<i>' + value + '</i>'; if (atom.underline) value = '<u>' + value + '</u>'; if (atom.strikethrough) value = '<s>' + value + '</s>';
      return (anchors.length ? label : '') + value;
    }).join('');
  }
  private textFile(note: LessonNote): string { return note.course.title + ' · ' + (note.title || '课堂笔记') + '\n' + lessonLabel(note.course) + '\n\n' + note.atoms.map((a: NoteAtom) => a.kind === 'image' ? `\n[${stamp(a.at)} 图片]\n` : ['quote', 'question', 'summary'].includes(a.kind) ? `\n[${stamp(a.at)} ${referenceLabel(a.kind)}] ${a.value}\n` : a.value).join(''); }
  private document(note: LessonNote): string { return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{max-width:900px;margin:24px auto;padding:20px;font:16px/1.8 system-ui;color:#20344d}img{display:block;max-width:100%;height:auto}blockquote{margin:12px 0;padding:12px 18px;background:#f1f7fe;border-left:4px solid #168bee}.time{color:#168bee;margin-right:12px}figure{margin:12px 0}</style><body>' + this.html(note) + '</body></html>'; }
  private markdown(note: LessonNote, directory: string, exportName: string): string {
    let picture = 0;
    return '# ' + note.course.title + '\n\n## ' + (note.title || '课堂笔记') + '\n\n' + lessonLabel(note.course) + '\n\n' + note.atoms.map((a: NoteAtom, index: number) => {
      if (a.kind === 'image') {
        const data = this.imageData(a.value), extension = data.startsWith('data:image/jpeg') ? 'jpg' : data.startsWith('data:image/webp') ? 'webp' : data.startsWith('data:image/gif') ? 'gif' : 'png';
        const images = directory + '/images'; if (!fs.accessSync(images)) fs.mkdirSync(images, true);
        const name = notePictureName(exportName, ++picture, extension), file = fs.openSync(a.value, fs.OpenMode.READ_ONLY);
        try { fs.copyFileSync(file.fd, images + '/' + name); } finally { fs.closeSync(file); }
        return `\n\n![图片 ${stamp(a.at)}](images/${encodeURIComponent(name)})\n\n`;
      }
      if (['quote', 'question', 'summary'].includes(a.kind)) return (note.atoms[index - 1]?.kind === a.kind ? '' : `\n\n> [${stamp(a.at)} ${referenceLabel(a.kind)}] `) + noteAtomMarkdown(a).replace(/\n/g, '\n> ') + (note.atoms[index + 1]?.kind === a.kind ? '' : '\n\n');
      let value = a.value; if (a.bold) value = '**' + value + '**'; if (a.italic) value = '*' + value + '*'; if (a.underline) value = '<u>' + value + '</u>'; if (a.strikethrough) value = '~~' + value + '~~'; return value;
    }).join('');
  }
  private writeFile(path: string, text: string): void { const file = fs.openSync(path, fs.OpenMode.CREATE | fs.OpenMode.TRUNC | fs.OpenMode.WRITE_ONLY); try { fs.writeSync(file.fd, text); } finally { fs.closeSync(file); } }
  async export(notes: LessonNote[], format: string, context: common.UIAbilityContext, bundle: boolean = false, account?: Account): Promise<{data: Uint8Array; filename: string; extension: string}> {
    if (!notes.length) throw new Error('没有可导出的笔记');
    if (!['html', 'txt', 'md'].includes(format)) throw new Error('请选择有效的导出格式');
    if (account && notes.some((note: LessonNote) => !note.course.term || /[，,]/.test(note.course.term))) {
      const api = new Zhiyun();
      try { await api.annotateTerms(account, notes.map((note: LessonNote) => note.course), this.store); } catch (_) {} finally { api.cancel(); }
    }
    const packed = bundle || notes.length > 1 || format === 'md', suffix = packed ? 'zip' : format;
    const filename = notes.length === 1 && !bundle ? safeFilename(notes[0].title || '课堂笔记') : '课堂笔记_' + shanghaiDate(Date.now() / 1000) + '_' + notes.length + '篇';
    const folder = context.cacheDir + '/notes-export-' + Date.now(), temporary = folder + '.' + suffix;
    try {
      if (packed) {
        fs.mkdirSync(folder, true);
        const names = new Map<string, Set<string>>();
        for (const note of notes) {
          const directory = folder + '/' + noteExportCourse(note) + '/' + noteExportDate(note); if (!fs.accessSync(directory)) fs.mkdirSync(directory, true);
          let used = names.get(directory); if (!used) { used = new Set<string>(); names.set(directory, used); }
          const name = uniqueExportName(noteExportName(note), used);
          this.writeFile(directory + '/' + name + '.' + format, format === 'html' ? this.document(note) : format === 'txt' ? this.textFile(note) : this.markdown(note, directory, name));
        }
        await zlib.compressFile(folder, temporary, {});
      } else this.writeFile(temporary, format === 'html' ? this.document(notes[0]) : this.textFile(notes[0]));
      const file = fs.openSync(temporary, fs.OpenMode.READ_ONLY); try { const size = fs.statSync(file.fd).size; if (size > 512 * 1024 * 1024) throw new Error('导出包过大，请分批导出'); const data = new ArrayBuffer(size); fs.readSync(file.fd, data); return { data: new Uint8Array(data), filename: filename + '.' + suffix, extension: suffix }; } finally { fs.closeSync(file); }
    } finally { try { if (fs.accessSync(temporary)) fs.unlinkSync(temporary); } catch (_) {} try { if (fs.accessSync(folder)) fs.rmdirSync(folder); } catch (_) {} }
  }
}
