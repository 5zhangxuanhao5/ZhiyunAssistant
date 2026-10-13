export function cursorStep(value: string, offset: number, right: boolean): number {
  const at = Math.max(0, Math.min(value.length, offset));
  if (right) { if (at >= value.length) return value.length; const code = value.charCodeAt(at); return Math.min(value.length, at + (code >= 0xD800 && code <= 0xDBFF ? 2 : 1)); }
  if (!at) return 0; const code = value.charCodeAt(at - 1); return Math.max(0, at - (code >= 0xDC00 && code <= 0xDFFF ? 2 : 1));
}
export function lineCaret(value: string, offset: number, down: boolean): number {
  const at = Math.max(0, Math.min(value.length, offset)), start = at > 0 ? value.lastIndexOf('\n', at - 1) + 1 : 0;
  const endIndex = value.indexOf('\n', at), end = endIndex < 0 ? value.length : endIndex, column = at - start;
  if (down) { if (end === value.length) return at; const nextEnd = value.indexOf('\n', end + 1); return Math.min(end + 1 + column, nextEnd < 0 ? value.length : nextEnd); }
  if (!start) return at; const previousStart = start > 1 ? value.lastIndexOf('\n', start - 2) + 1 : 0; return Math.min(previousStart + column, start - 1);
}
