export function selectedAnswerParts(parts, start, end) {
    let offset = 0;
    const selected = [];
    parts.forEach((part) => { const left = Math.max(0, start - offset), right = Math.min(part.value.length, end - offset); if (right > left)
        selected.push({ value: part.value.slice(left, right), seconds: part.seconds, course: part.course, bold: part.bold, italic: part.italic, code: part.code }); offset += part.value.length; });
    return selected;
}
export function referenceAtoms(value) {
    const parts = value.formatted?.length ? value.formatted : [{ value: value.value, seconds: -1, bold: false, italic: false, code: false }];
    return parts.map((part, index) => { return { id: 'reference-' + Date.now() + '-' + index, kind: value.kind, value: part.value, at: value.at, end: value.end, sourceId: value.sourceId, bold: part.bold, italic: part.italic, underline: false, code: part.code, linkAt: part.seconds >= 0 ? part.seconds : undefined, linkCourse: part.course, reference: value.reference }; });
}
export function noteAnswerParts(block) { return block.atoms.map((atom) => { return { value: atom.value, seconds: atom.linkAt ?? -1, course: atom.linkCourse, bold: atom.bold, italic: atom.italic, code: atom.code === true }; }); }
export function noteAtomHtml(atom) {
    let text = atom.value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '<br>');
    if (atom.code)
        text = '<code>' + text + '</code>';
    if (atom.bold)
        text = '<b>' + text + '</b>';
    if (atom.italic)
        text = '<i>' + text + '</i>';
    if (atom.underline)
        text = '<u>' + text + '</u>';
    if (atom.strikethrough)
        text = '<s>' + text + '</s>';
    return text;
}
export function noteAtomMarkdown(atom) {
    let value = atom.value;
    if (atom.code)
        value = '<code>' + value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</code>';
    if (atom.bold)
        value = '**' + value + '**';
    if (atom.italic)
        value = '*' + value + '*';
    if (atom.underline)
        value = '<u>' + value + '</u>';
    if (atom.strikethrough)
        value = '~~' + value + '~~';
    return value;
}
