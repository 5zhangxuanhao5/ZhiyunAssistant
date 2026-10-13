// Generated from shared HarmonyOS sources by sync-harmony-models.cjs.
export function movedOffset(offset, beforeStart, beforeEnd, afterEnd) { return offset < beforeStart ? offset : offset >= beforeEnd ? offset + afterEnd - beforeEnd : beforeStart; }
export function insertionBreaks(text, caret) {
    const before = text.slice(0, Math.max(0, caret)), after = text.slice(Math.max(0, caret));
    const left = before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
    const right = after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
    return [left, right];
}
export function notePlain(note) { return note.atoms.map((atom) => atom.kind === 'image' ? `[课件图片 ${atom.at.toFixed(1)}秒]` : atom.value).join(''); }
export class NotesController {
    constructor() {
        this.receiver = () => { };
    }
    bind(receiver) { this.receiver = receiver; }
    unbind() { this.receiver = () => { }; }
    insert(value) { this.receiver(value); }
}
