/** A reading location belongs to a transcript sentence, not to a page or scroll percentage. */
export interface TranscriptReadingAnchor {
  id: string;
  t: number;
  offset: number;
  browsing: boolean;
  clickedId?: string;
  sequence?: number;
}

export function visibleTranscriptAnchor(root: HTMLElement, browsing: boolean, clickedId?: string): TranscriptReadingAnchor | undefined {
  const viewport = root.getBoundingClientRect();
  for (const column of root.querySelectorAll<HTMLElement>('.transcript-column')) {
    const lines = column.querySelectorAll<HTMLElement>('.transcript-line');
    // Sentences within each column are vertically ordered. Avoid measuring an entire
    // lesson of thousands of sentences when only the first visible one is needed.
    let low = 0, high = lines.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (lines[middle].getBoundingClientRect().bottom <= viewport.top) low = middle + 1;
      else high = middle;
    }
    const line = lines[low];
    if (!line || !line.dataset.lineId) continue;
    const box = line.getBoundingClientRect();
    if (box.top >= viewport.bottom || box.bottom <= viewport.top) continue;
    return { id: line.dataset.lineId, t: Number(line.dataset.time) || 0, offset: box.top - viewport.top, browsing, clickedId };
  }
  return undefined;
}

export function transcriptAnchorElement(root: HTMLElement, id: string): HTMLElement | null {
  // CSS.escape prevents a platform sentence ID from becoming a selector expression.
  return root.querySelector<HTMLElement>(`[data-line-id="${CSS.escape(id)}"]`);
}

export function restoreTranscriptAnchor(root: HTMLElement, anchor: TranscriptReadingAnchor): boolean {
  const line = transcriptAnchorElement(root, anchor.id);
  if (!line) return false;
  const distance = line.getBoundingClientRect().top - root.getBoundingClientRect().top - anchor.offset;
  root.scrollTop = Math.max(0, root.scrollTop + distance);
  return true;
}
