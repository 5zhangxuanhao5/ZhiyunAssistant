/** DOM selection owns mouse/touchpad drags. Study paging must only own genuine touch. */
export type StudyTextPane = 'transcript' | 'summary' | 'ai' | 'notes';
export interface RichClipboardPayload { text: string; html: string; images: string[] }
export interface SelectionState { pane: string; whole: boolean; selecting: boolean }
export interface StudySelectionOptions {
  writeClipboard?: (value: RichClipboardPayload) => Promise<void> | void;
  onState?: (state: SelectionState) => void;
  onSelecting?: (pane: string, held: boolean) => void;
  onSelectionTap?: (payload: RichClipboardPayload, point: { x: number; y: number }) => void;
  onCopyError?: (error: Error) => void;
}
export interface InstalledStudySelections { dispose: () => void; clear: () => void; copy: () => Promise<boolean>; state: () => SelectionState }
type KeyboardLike = { key?: string; keyCode?: number; isComposing?: boolean; shiftKey?: boolean };
export function isComposingInput(event: KeyboardLike, composing = false): boolean { return composing || event.isComposing === true || event.keyCode === 229 || event.key === 'Process'; }
export function shouldSendMessage(event: KeyboardLike, composing = false): boolean { return event.key === 'Enter' && !event.shiftKey && !isComposingInput(event, composing); }
export function isNativePointerSelection(event: Pick<PointerEvent, 'pointerType'>): boolean { return event.pointerType === 'mouse' || event.pointerType === 'pen' || !event.pointerType; }
export function normalizedWheel(event: Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode'>, pageHeight = 800): { x: number; y: number } { const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pageHeight : 1; return { x: event.deltaX * unit, y: event.deltaY * unit }; }
export function canTouchPage(event: PointerEvent, container: Element): boolean {
  if (event.pointerType !== 'touch' || !event.isPrimary || event.button > 0) return false;
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('input,textarea,[contenteditable="true"],button,a,[data-no-paging]')) return false;
  const selection = container.ownerDocument.getSelection();
  return !selection || selection.isCollapsed || !selection.anchorNode || !container.contains(selection.anchorNode);
}
function elementTarget(target: EventTarget | null): Element | null { return target instanceof Element ? target : target instanceof Node ? target.parentElement : null; }
function nativeInput(target: Element | null): boolean { return !!target?.closest('input,textarea,select'); }
function editable(target: Element | null): boolean { return nativeInput(target) || !!target?.closest('[contenteditable="true"]'); }
function nativeOwned(pane: Element | null): boolean { return !!pane && (pane.matches('[data-native-selection="true"]') || !!pane.querySelector('[data-native-selection="true"]')); }
function selectionWithin(root: Element, selection: Selection | null): boolean { return !!selection && !selection.isCollapsed && !!selection.anchorNode && !!selection.focusNode && root.contains(selection.anchorNode) && root.contains(selection.focusNode); }
function rangeAt(selection: Selection | null, x: number, y: number): boolean {
  if (!selection || selection.isCollapsed) return false;
  for (let i = 0; i < selection.rangeCount; i++) for (const rect of Array.from(selection.getRangeAt(i).getClientRects())) if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return true;
  return false;
}
function cleanFragment(fragment: DocumentFragment): DocumentFragment {
  fragment.querySelectorAll('script,style,iframe,object,embed,button,input,textarea,select,[data-copy-exclude]').forEach((element) => element.remove());
  fragment.querySelectorAll('*').forEach((element) => {
    for (const attribute of Array.from(element.attributes)) if (/^on/i.test(attribute.name) || attribute.name === 'contenteditable' || attribute.name === 'id' || attribute.name === 'tabindex') element.removeAttribute(attribute.name);
    if (element instanceof HTMLAnchorElement && /^javascript:/i.test(element.getAttribute('href') || '')) element.removeAttribute('href');
  });
  return fragment;
}
function fragmentText(element: Element): string {
  let text = '';
  const blocks = new Set(['ARTICLE', 'DIV', 'SECTION', 'P', 'LI', 'UL', 'OL', 'H1', 'H2', 'H3', 'BLOCKQUOTE', 'TR']);
  const newline = (): void => { if (text && !text.endsWith('\n')) text += '\n'; };
  const visit = (node: Node): void => {
    if (node.nodeType === 3) { text += node.textContent || ''; return; }
    if (!(node instanceof Element)) return;
    if (node.tagName === 'BR') { text += '\n'; return; }
    const block = blocks.has(node.tagName); if (block) newline();
    node.childNodes.forEach(visit); if (block) newline();
  };
  element.childNodes.forEach(visit); return text.replace(/\n+$/g, '');
}
export function clipboardSelection(selection: Selection | null, pane: Element): RichClipboardPayload | null {
  if (!selectionWithin(pane, selection)) return null;
  const document = pane.ownerDocument, output = document.createElement('div'), images: string[] = [];
  for (let i = 0; i < selection!.rangeCount; i++) output.append(cleanFragment(selection!.getRangeAt(i).cloneContents()));
  output.querySelectorAll('img').forEach((image) => {
    const source = image.currentSrc || image.src;
    if (source && !/^javascript:/i.test(source)) { image.src = source; if (!images.includes(source)) images.push(source); }
    else image.remove();
  });
  // Chromium can paint a document range across distinct editing hosts while
  // Selection.toString is empty. The cloned range remains the source of truth.
  const kind = pane.closest('[data-study-pane]')?.getAttribute('data-study-pane');
  // Programmatic ranges may still contain user-select:none timestamps. Use the
  // cleaned fragment for transcript copying, rather than relying on visual CSS.
  const selected = kind === 'transcript' ? fragmentText(output) : selection!.toString() || fragmentText(output);
  const text = kind === 'transcript' ? selected.replace(/\s+/g, ' ').trim() : selected;
  return { text, html: output.innerHTML, images };
}
function selectElement(element: Element): void { const selection = element.ownerDocument.getSelection(), range = element.ownerDocument.createRange(); range.selectNodeContents(element); selection?.removeAllRanges(); selection?.addRange(range); }
async function browserWrite(payload: RichClipboardPayload): Promise<void> {
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([payload.text], { type: 'text/plain' }), 'text/html': new Blob([payload.html], { type: 'text/html' }) })]);
  } else if (navigator.clipboard?.writeText && !payload.images.length) await navigator.clipboard.writeText(payload.text);
  else throw new Error('无法写入剪贴板，请使用系统复制菜单');
}

/**
 * Mark panes with data-study-pane. Optional data-select-block groups each AI turn/note block.
 * data-select-content excludes titles/timestamps; data-select-all encloses all selectable blocks.
 * data-selection-gap marks body gaps where one Ctrl+A selects the entire note/conversation.
 * Other blank toolbar space only focuses the pane; Ctrl+A remains inactive there for AI/notes.
 */
export function installStudySelections(root: HTMLElement, options: StudySelectionOptions = {}): InstalledStudySelections {
  const document = root.ownerDocument, window = document.defaultView!;
  let pane: HTMLElement | null = null, block: HTMLElement | null = null, whole = false, gap = false, composing = false, pressed = false, selectLevel = 0;
  let wholeElement: HTMLElement | null = null, activePointer = -1, lastSelecting = '', lastHeld = false, lastState = '', disposed = false;
  const state = (): SelectionState => ({ pane: pane?.dataset.studyPane || '', whole, selecting: pressed || !!pane && selectionWithin(pane, document.getSelection()) });
  const publish = (): void => {
    if (disposed) return;
    const current = state(), identity = current.pane + ':' + current.whole + ':' + current.selecting;
    if (identity !== lastState) { lastState = identity; options.onState?.(current); }
    if (lastSelecting !== current.pane || lastHeld !== current.selecting) {
      if (lastSelecting && lastSelecting !== current.pane) options.onSelecting?.(lastSelecting, false);
      lastSelecting = current.pane; lastHeld = current.selecting;
      if (current.pane) options.onSelecting?.(current.pane, current.selecting);
    }
  };
  const clear = (): void => { wholeElement?.removeAttribute('data-whole-selected'); wholeElement = null; whole = false; pressed = false; activePointer = -1; selectLevel = 0; document.getSelection()?.removeAllRanges(); publish(); };
  const allContent = (): HTMLElement | null => pane?.querySelector<HTMLElement>('[data-select-all]') || pane;
  const blockContent = (): HTMLElement | null => block?.querySelector<HTMLElement>('[data-select-content]') || block;
  const payload = (): RichClipboardPayload | null => pane ? clipboardSelection(document.getSelection(), pane) : null;
  const copy = async (): Promise<boolean> => {
    const value = payload(); if (!value) return false;
    try { await (options.writeClipboard ? options.writeClipboard(value) : browserWrite(value)); return true; }
    catch (error) { options.onCopyError?.(error instanceof Error ? error : new Error(String(error))); return false; }
  };
  const pointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    const target = elementTarget(event.target), nextPane = target?.closest<HTMLElement>('[data-study-pane]') || null;
    if (nextPane && !root.contains(nextPane)) return;
    // A repeated synthesized mouse/touch down must not reset a drag's native anchor.
    if (pressed && activePointer === event.pointerId) return;
    if (nativeOwned(nextPane)) {
      // The editor owns its range/caret, escalation and copy. Observe the hold only;
      // clearing it here before its handler runs would move a rich editor's caret.
      wholeElement?.removeAttribute('data-whole-selected'); wholeElement = null; whole = false; selectLevel = 0;
      pane = nextPane; block = null; gap = false;
      pressed = isNativePointerSelection(event) && !nativeInput(target); activePointer = pressed ? event.pointerId : -1;
      publish(); return;
    }
    const insideSelected = !!pane && nextPane === pane && (whole && !!wholeElement?.contains(target) || rangeAt(document.getSelection(), event.clientX, event.clientY));
    if (insideSelected && whole && options.onSelectionTap && !target?.closest('button,a,input,textarea')) {
      const value = payload(); if (value) { event.preventDefault(); event.stopPropagation(); options.onSelectionTap(value, { x: event.clientX, y: event.clientY }); return; }
    }
    if (!insideSelected && (whole || !!pane && selectionWithin(pane, document.getSelection()))) clear();
    selectLevel = 0; pane = nextPane; block = target?.closest<HTMLElement>('[data-select-block]') || null;
    if (block && !pane?.contains(block)) block = null;
    gap = !!target?.closest('[data-selection-gap]');
    if (!pane) { clear(); return; }
    if (!nativeInput(target) && !target?.closest('[contenteditable="true"]') && (target === pane || !!target?.closest('[data-pane-focus]'))) {
      if (!pane.hasAttribute('tabindex')) pane.tabIndex = -1;
      pane.focus({ preventScroll: true });
    }
    if (isNativePointerSelection(event) && !!target?.closest('[data-select-content]') && !nativeInput(target)) { pressed = true; activePointer = event.pointerId; }
    publish();
  };
  const pointerUp = (event: PointerEvent): void => { if (!pressed || activePointer !== event.pointerId) return; pressed = false; activePointer = -1; publish(); };
  const outsidePointerDown = (event: PointerEvent): void => {
    const target = elementTarget(event.target);
    if (event.button !== 0 || !target || root.contains(target)) return;
    // The study toolbar and modal dialogs are siblings of the canvas. Clicking
    // them must dismiss the canvas range just like clicking another pane.
    if (whole || pressed || !!pane && selectionWithin(pane, document.getSelection())) clear();
    pane = null; block = null; gap = false; publish();
  };
  const focusIn = (event: FocusEvent): void => {
    const target = elementTarget(event.target), next = target?.closest<HTMLElement>('[data-study-pane]') || null;
    if (!next || !root.contains(next)) return;
    if (next !== pane) { clear(); pane = next; block = target?.closest<HTMLElement>('[data-select-block]') || null; gap = false; }
    publish();
  };
  const keyDown = (event: KeyboardEvent): void => {
    if (isComposingInput(event, composing)) return;
    if (event.key === 'Escape' && state().selecting) { clear(); return; }
    const target = elementTarget(event.target);
    if (!(event.ctrlKey || event.metaKey) || event.altKey || !pane || !root.contains(pane) || nativeInput(target) || nativeOwned(pane)) return;
    const key = event.key.toLowerCase();
    if (key === 'a') {
      const kind = pane.dataset.studyPane;
      if (kind !== 'transcript' && kind !== 'summary' && !block && !gap) return;
      const targetContent = kind === 'transcript' || kind === 'summary' ? pane.querySelector<HTMLElement>('[data-select-content]') || allContent() : whole || gap ? allContent() : blockContent();
      if (!targetContent) return;
      event.preventDefault(); event.stopPropagation();
      wholeElement?.removeAttribute('data-whole-selected');
      whole = (kind === 'ai' || kind === 'notes') && (gap || selectLevel > 0);
      // A first Ctrl+A always selects the focused block; the second extends to all blocks.
      const chosen = whole && (kind === 'ai' || kind === 'notes') ? allContent()! : targetContent;
      if (whole) {
        // Chromium restricts a focused editing host's painted range to that host.
        // Release its caret before selecting a document containing several editors.
        if (!pane.hasAttribute('tabindex')) pane.tabIndex = -1;
        pane.focus({ preventScroll: true });
      }
      selectElement(chosen); selectLevel++; wholeElement = whole ? chosen : null; wholeElement?.setAttribute('data-whole-selected', 'true'); publish();
    } else if (key === 'c' && options.writeClipboard && selectionWithin(pane, document.getSelection()) && !editable(target)) { event.preventDefault(); void copy(); }
    // Ctrl+V is intentionally owned by the browser/editor; never emulate text keystrokes.
  };
  const copied = (event: ClipboardEvent): void => {
    if (nativeInput(elementTarget(event.target)) || nativeOwned(pane)) return;
    const value = payload(); if (!value || !event.clipboardData) return;
    event.clipboardData.setData('text/plain', value.text); event.clipboardData.setData('text/html', value.html); event.preventDefault();
    if (options.writeClipboard) void copy();
  };
  const selectionChanged = (): void => { if (whole && !selectionWithin(pane!, document.getSelection())) { wholeElement?.removeAttribute('data-whole-selected'); wholeElement = null; whole = false; } publish(); };
  const compositionStart = (): void => { composing = true; }, compositionEnd = (): void => { composing = false; };
  const lostWindow = (): void => { pressed = false; activePointer = -1; if (lastSelecting) options.onSelecting?.(lastSelecting, false); lastHeld = false; };
  root.addEventListener('pointerdown', pointerDown, true); document.addEventListener('pointerdown', outsidePointerDown, true); window.addEventListener('pointerup', pointerUp, true); window.addEventListener('pointercancel', pointerUp, true);
  root.addEventListener('focusin', focusIn); root.addEventListener('keydown', keyDown, true); root.addEventListener('copy', copied); document.addEventListener('selectionchange', selectionChanged);
  root.addEventListener('compositionstart', compositionStart); root.addEventListener('compositionend', compositionEnd); window.addEventListener('blur', lostWindow); window.addEventListener('focus', publish);
  return { clear, copy, state, dispose: () => {
    clear(); disposed = true;
    root.removeEventListener('pointerdown', pointerDown, true); document.removeEventListener('pointerdown', outsidePointerDown, true); window.removeEventListener('pointerup', pointerUp, true); window.removeEventListener('pointercancel', pointerUp, true);
    root.removeEventListener('focusin', focusIn); root.removeEventListener('keydown', keyDown, true); root.removeEventListener('copy', copied); document.removeEventListener('selectionchange', selectionChanged);
    root.removeEventListener('compositionstart', compositionStart); root.removeEventListener('compositionend', compositionEnd); window.removeEventListener('blur', lostWindow); window.removeEventListener('focus', publish);
  } };
}
