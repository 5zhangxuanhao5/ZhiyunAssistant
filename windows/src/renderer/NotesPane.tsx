import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { Course } from '../shared/model/Timeline';
import { stamp } from '../shared/model/Timeline';
import type { LessonNote, NoteAtom, NoteContentReference, NoteInsertion } from '../shared/model/Notes';
import type { NoteBlock, NotePalette } from '../shared/model/NoteBlocks';
import { blockText, blockTitle, emptyNoteBlock, noteBlocks, noteColors, validNotePalette, updateNoteBlock, sliceNoteAtoms } from '../shared/model/NoteBlocks';
import { noteAnswerParts, noteAtomHtml } from '../shared/model/NoteFormatting';
import { AnswerContent, selectElementText } from './AiPane';
import { ipc, errorMessage, newNote, prepareNote, applyInsertion, cleanedBlocks, selectAllPhase } from './panesLogic';
import './panes.css';

export interface NotesPaneProps {
  course: Course; currentTime: number; insertion?: { sequence: number; value: NoteInsertion }; requestedNoteId?: string;
  onSeek: (at: number, course?: Course) => void; onOpenReference?: (reference: NoteContentReference) => void; onNotice?: (value: string) => void;
  returnVisible?: boolean; onReturn?: () => void;
}
interface EditorHandle { element: () => HTMLDivElement | null; caret: () => number; focus: (offset: number) => void; snapshot: () => NoteAtom[] }
function elementCaret(element: HTMLElement): number {
  const selection = window.getSelection(); if (!selection?.rangeCount || !element.contains(selection.anchorNode)) return element.textContent?.length || 0;
  const range = selection.getRangeAt(0).cloneRange(), before = range.cloneRange(); before.selectNodeContents(element); before.setEnd(range.startContainer, range.startOffset); return before.toString().length;
}
function focusCaret(element: HTMLElement, offset: number) {
  element.focus({ preventScroll: true }); const selection = window.getSelection(), range = document.createRange(), walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT); let remaining = Math.max(0, offset), node = walker.nextNode();
  while (node) { const length = node.textContent?.length || 0; if (remaining <= length) { range.setStart(node, remaining); range.collapse(true); selection?.removeAllRanges(); selection?.addRange(range); return; } remaining -= length; node = walker.nextNode(); }
  range.selectNodeContents(element); range.collapse(false); selection?.removeAllRanges(); selection?.addRange(range);
}
export function editorAtoms(element: HTMLElement, at: number): NoteAtom[] {
  const atoms: NoteAtom[] = [];
  type Format = { bold: boolean; italic: boolean; underline: boolean; strikethrough: boolean; code: boolean };
  const append = (text: string, format: Format) => { if (!text) return; const last = atoms[atoms.length - 1]; if (last && ['bold', 'italic', 'underline', 'strikethrough', 'code'].every(key => last[key as keyof Format] === format[key as keyof Format])) last.value += text; else atoms.push({ id: crypto.randomUUID(), kind: 'text', value: text, at, end: at, sourceId: '', ...format }); };
  const walk = (node: Node, inherited: Format) => {
    if (node.nodeType === Node.TEXT_NODE) { append(node.textContent || '', inherited); return; }
    if (!(node instanceof HTMLElement)) return;
    const tag = node.tagName.toLowerCase(); if (['script', 'style', 'iframe', 'object', 'img'].includes(tag)) return;
    if (tag === 'br') { append('\n', inherited); return; }
    const format = { bold: inherited.bold || ['b', 'strong'].includes(tag) || Number(node.style.fontWeight) >= 600, italic: inherited.italic || ['i', 'em'].includes(tag) || node.style.fontStyle === 'italic', underline: inherited.underline || tag === 'u' || node.style.textDecoration.includes('underline'), strikethrough: inherited.strikethrough || ['s', 'del', 'strike'].includes(tag) || node.style.textDecoration.includes('line-through'), code: inherited.code || tag === 'code' };
    if (['div', 'p'].includes(tag) && atoms.length && !atoms[atoms.length - 1].value.endsWith('\n')) append('\n', inherited);
    node.childNodes.forEach(child => walk(child, format));
  };
  element.childNodes.forEach(node => walk(node, { bold: false, italic: false, underline: false, strikethrough: false, code: false }));
  return atoms;
}
function splitFormattedBlock(blocks: NoteBlock[], activeId: string, caret: number, at: number) {
  const index = blocks.findIndex(block => block.id === activeId), block = blocks[index]; if (!block || block.source !== 'notes') return { blocks, activeId, caret };
  const length = blockText(block).length, bounded = Math.max(0, Math.min(length, caret)), next = emptyNoteBlock(at); next.atoms = sliceNoteAtoms(block.atoms, bounded, length);
  const result = blocks.slice(); result.splice(index, 1, { ...block, atoms: sliceNoteAtoms(block.atoms, 0, bounded) }, next); return { blocks: result, activeId: next.id, caret: 0 };
}

const EditableNote = forwardRef<EditorHandle, { block: NoteBlock; onChange: (atoms: NoteAtom[]) => void; onActive: (id: string, caret: number) => void; onSplit: (id: string, caret: number) => void; onBlur: () => void; onAll: (id: string, element: HTMLDivElement) => boolean }>(function EditableNote({ block, onChange, onActive, onSplit, onBlur, onAll }, ref) {
  const element = useRef<HTMLDivElement>(null), composing = useRef(false), composedAt = useRef(0), rendered = useRef(''), emitted = useRef('');
  const snapshot = () => element.current ? editorAtoms(element.current, block.at).map(atom => ({ ...atom, paragraphAlign: element.current!.style.textAlign || block.atoms[0]?.paragraphAlign || 'left' })) : block.atoms;
  useImperativeHandle(ref, () => ({ element: () => element.current, caret: () => element.current ? elementCaret(element.current) : 0, focus: (offset) => { if (element.current) focusCaret(element.current, offset); }, snapshot }));
  useLayoutEffect(() => {
    const html = block.atoms.map(noteAtomHtml).join(''); if (!element.current || html === rendered.current || html === emitted.current) { rendered.current = html; return; }
    const focused = element.current.contains(document.activeElement), caret = focused ? elementCaret(element.current) : 0; element.current.innerHTML = html; rendered.current = html; if (focused) focusCaret(element.current, caret);
  }, [block.atoms]);
  const changed = () => { const atoms = snapshot(); emitted.current = atoms.map(noteAtomHtml).join(''); rendered.current = emitted.current; onChange(atoms); if (element.current && window.getSelection()?.anchorNode && element.current.contains(window.getSelection()!.anchorNode)) onActive(block.id, elementCaret(element.current)); };
  return <div ref={element} data-note-editor={block.id} data-select-content="true" className="note-editor native-selectable" contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label="我的笔记" data-placeholder="记下笔记…" spellCheck={false}
    style={{ textAlign: ((block as NoteBlock & { paragraphAlign?: string }).paragraphAlign || block.atoms[0]?.paragraphAlign || 'left') as React.CSSProperties['textAlign'] }}
    onInput={changed} onFocus={() => { if (element.current) onActive(block.id, elementCaret(element.current)); }} onSelect={() => { if (element.current) onActive(block.id, elementCaret(element.current)); }} onPointerUp={() => { if (element.current) onActive(block.id, elementCaret(element.current)); }}
    onBlur={() => { if (!composing.current) changed(); onBlur(); }} onCompositionStart={() => composing.current = true} onCompositionEnd={() => { composing.current = false; composedAt.current = performance.now(); changed(); }}
    onKeyDown={event => {
      event.stopPropagation();
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { if (element.current && onAll(block.id, element.current)) event.preventDefault(); return; }
      if (event.key === 'Enter' && !composing.current && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229 && performance.now() - composedAt.current > 35) { event.preventDefault(); changed(); onSplit(block.id, element.current ? elementCaret(element.current) : 0); }
    }}
    onPaste={event => { event.stopPropagation(); event.preventDefault(); const text = event.clipboardData.getData('text/plain'); document.execCommand('insertText', false, text); changed(); }}
  />;
});

export function NotesPane(props: NotesPaneProps) {
  const { course, currentTime, insertion, requestedNoteId, onSeek, onOpenReference } = props;
  const [notes, setNotes] = useState<LessonNote[]>([]), [note, setNote] = useState<LessonNote>(), [active, setActive] = useState(''), [palette, setPalette] = useState<NotePalette>(validNotePalette());
  const [manage, setManage] = useState(false), [colors, setColors] = useState(false), [format, setFormat] = useState('md'), [busy, setBusy] = useState(false), [error, setError] = useState(''), [allSelected, setAllSelected] = useState(false), [capture, setCapture] = useState(false), [captureStatus, setCaptureStatus] = useState('');
  const body = useRef<HTMLDivElement>(null), editors = useRef(new Map<string, EditorHandle>()), noteRef = useRef(note), activeRef = useRef(''), caretRef = useRef(0), saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), saves = useRef<Promise<unknown>>(Promise.resolve()), generation = useRef(0), lastInsertion = useRef(-1), previousA = useRef<{ target: string; at: number } | null>(null), camera = useRef<HTMLVideoElement>(null), stream = useRef<MediaStream | undefined>(undefined), range = useRef<Range | undefined>(undefined), lastFocus = useRef('');
  noteRef.current = note; activeRef.current = active;
  const pendingCaret = useRef<{ noteId?: string; blockId: string; offset: number } | undefined>(undefined);
  const persist = useCallback((value: LessonNote, immediate = false) => {
    clearTimeout(saveTimer.current); const save = () => { const prepared = prepareNote(value); saves.current = saves.current.catch(() => {}).then(() => ipc('notes.save', { note: prepared })); void saves.current.catch(err => setError(errorMessage(err))); setNotes(previous => { const found = previous.findIndex(item => item.id === prepared.id), next = previous.slice(); if (found < 0) next.unshift(prepared); else next[found] = prepared; return next; }); }; if (immediate) save(); else saveTimer.current = setTimeout(save, 350);
  }, []);
  const change = useCallback((blocks: NoteBlock[], nextActive = activeRef.current, nextCaret?: number) => {
    const previous = noteRef.current; if (!previous) return; const next = { ...previous, blocks, savedAt: Date.now() }; if (nextCaret !== undefined) { caretRef.current = nextCaret; pendingCaret.current = { noteId: next.id, blockId: nextActive, offset: nextCaret }; } noteRef.current = next; setNote(next); if (nextActive !== activeRef.current) { activeRef.current = nextActive; setActive(nextActive); } persist(next);
  }, [persist]);
  useLayoutEffect(() => {
    const pending = pendingCaret.current; if (!pending || pending.noteId !== note?.id) return;
    const editor = editors.current.get(pending.blockId); if (!editor) return;
    pendingCaret.current = undefined; editor.focus(pending.offset); editor.element()?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }, [note]);
  const open = useCallback((value: LessonNote) => {
    if (noteRef.current?.savedAt) persist(noteRef.current, true); pendingCaret.current = undefined; const normalized = { ...value, openedAt: Date.now(), blocks: noteBlocks(value) }; noteRef.current = normalized; setNote(normalized); setActive(''); activeRef.current = ''; setManage(false); setAllSelected(false); range.current = undefined; setError(''); if (normalized.savedAt) persist(normalized, true);
  }, [persist]);
  useEffect(() => {
    const epoch = ++generation.current; setNote(undefined); setNotes([]); setAllSelected(false); lastInsertion.current = -1;
    void Promise.all([ipc<LessonNote[]>('notes.list', { course }), ipc<NotePalette>('storage.get', { key: 'note-palette' })]).then(([items, savedPalette]) => { if (epoch !== generation.current) return; setPalette(validNotePalette(savedPalette)); setNotes(items); const found = items.find(item => item.id === requestedNoteId) || items[0]; open(found || newNote(course)); }).catch(err => { if (epoch === generation.current) { setError(errorMessage(err)); open(newNote(course)); } });
    return () => { ++generation.current; clearTimeout(saveTimer.current); const latest = noteRef.current; if (latest?.course.subId === course.subId && latest.savedAt && ((latest.blocks?.length || 0) > 0 || latest.namedByUser)) persist(latest, true); stream.current?.getTracks().forEach(track => track.stop()); };
  }, [course.subId]);
  useEffect(() => {
    const flush = (event?: Event) => {
      const latest = noteRef.current;
      if (latest && (latest.namedByUser || latest.blocks?.some(block => block.atoms.some(atom => atom.kind === 'image' || !!atom.value.trim())))) {
        persist({ ...latest, blocks: snapshotBlocks() }, true);
      }
      const task = saves.current;
      if (event instanceof CustomEvent && event.detail?.tasks) event.detail.tasks.push(task); else void task.catch(() => {});
    };
    window.addEventListener('zhiyun-flush', flush); window.addEventListener('pagehide', flush);
    return () => { window.removeEventListener('zhiyun-flush', flush); window.removeEventListener('pagehide', flush); };
  }, [course.subId, persist]);
  useEffect(() => { if (!requestedNoteId || noteRef.current?.id === requestedNoteId) return; const found = notes.find(item => item.id === requestedNoteId); if (found) open(found); }, [requestedNoteId, notes]);
  const remember = (id: string, caret: number) => { setActive(id); activeRef.current = id; caretRef.current = caret; lastFocus.current = id; const selection = window.getSelection(); if (selection?.rangeCount) range.current = selection.getRangeAt(0).cloneRange(); };
  const snapshotBlocks = (): NoteBlock[] => (noteRef.current?.blocks || []).map(block => { const editor = editors.current.get(block.id); return editor && block.source === 'notes' ? updateNoteBlock(block, editor.snapshot(), currentTime) : block; });
  const insert = useCallback((value: NoteInsertion) => {
    let current = noteRef.current; if (!current) { current = newNote(course); noteRef.current = current; setNote(current); }
    const blocks = snapshotBlocks(), activeId = activeRef.current || blocks[blocks.length - 1]?.id || ''; const editor = editors.current.get(activeId), element = editor?.element(), selection = window.getSelection(), caret = element && selection?.anchorNode && element.contains(selection.anchorNode) ? editor!.caret() : caretRef.current;
    const result = applyInsertion(blocks, activeId, caret, value, currentTime); change(result.blocks, result.activeId, result.caret); setAllSelected(false);
  }, [course, currentTime, change]);
  useEffect(() => { if (!insertion || insertion.sequence === lastInsertion.current || !note) return; lastInsertion.current = insertion.sequence; insert(insertion.value); }, [insertion, note?.id, insert]);
  const addOwn = (index: number) => { const blocks = snapshotBlocks(), next = emptyNoteBlock(currentTime); blocks.splice(Math.max(0, index), 0, next); change(cleanedBlocks(blocks, next.id), next.id, 0); setAllSelected(false); };
  const split = (id: string, caret: number) => { const result = splitFormattedBlock(snapshotBlocks(), id, caret, currentTime); change(result.blocks, result.activeId, 0); };
  const newOne = () => { const latest = noteRef.current; if (latest) persist(latest, true); const count = notes.length + 1; if (notes.length === 1 && !notes[0].namedByUser) { const first = { ...notes[0], title: '课堂笔记1' }; persist(first, true); } open(newNote(course, count > 1 ? '课堂笔记' + count : '课堂笔记')); };
  const rename = (value: LessonNote) => { const title = window.prompt('重命名笔记', value.title || '课堂笔记'); if (title === null) return; const next = { ...value, title: title.trim().slice(0, 100) || '课堂笔记', namedByUser: true }; if (noteRef.current?.id === value.id) { setNote(next); noteRef.current = next; } persist(next, true); };
  const remove = async (value: LessonNote) => { if (!window.confirm('删除“' + (value.title || '课堂笔记') + '”？')) return; try { await saves.current.catch(() => {}); await ipc('notes.delete', { course, id: value.id }); const next = notes.filter(item => item.id !== value.id); setNotes(next); if (noteRef.current?.id === value.id) { noteRef.current = undefined; open(next[0] || newNote(course)); } } catch (err) { setError(errorMessage(err)); } };
  const exportNote = async (values: LessonNote[]) => { if (!values.length || busy) return; setBusy(true); setError(''); try { const latest = noteRef.current; const selected = values.map(value => latest && latest.id === value.id ? prepareNote(latest) : prepareNote(value)); if (latest) persist(latest, true); await saves.current; await ipc('notes.export', { notes: selected, format, bundle: selected.length > 1 }); } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); } };
  const pickImage = async () => { try { const result = await ipc<{ uri: string } | string>('notes.pickImage'); const uri = typeof result === 'string' ? result : result?.uri; if (uri) insert({ kind: 'image', value: uri, at: currentTime, end: currentTime, sourceId: '' }); } catch (err) { setError(errorMessage(err)); } };
  const captureImage = async () => { if (capture) { stream.current?.getTracks().forEach(track => track.stop()); stream.current = undefined; setCapture(false); return; } setCapture(true); setCaptureStatus('正在打开摄像头…'); try { const media = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }); stream.current = media; requestAnimationFrame(() => { if (camera.current) { camera.current.srcObject = media; void camera.current.play(); } }); setCaptureStatus(''); } catch (err) { setCapture(false); setError('摄像头不可用：' + errorMessage(err)); } };
  const takePhoto = async () => { const video = camera.current; if (!video?.videoWidth) return; const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight; canvas.getContext('2d')?.drawImage(video, 0, 0); try { const result = await ipc<{ uri: string }>('notes.saveImage', { data: canvas.toDataURL('image/jpeg', .9) }); insert({ kind: 'image', value: result.uri, at: currentTime, end: currentTime, sourceId: '' }); await captureImage(); } catch (err) { setError(errorMessage(err)); } };
  const formatText = (command: string) => { const editor = editors.current.get(activeRef.current)?.element(); if (!editor) { props.onNotice?.('先在自己的笔记文字中放置光标或选中文字'); return; } if (range.current) { const selection = window.getSelection(); selection?.removeAllRanges(); try { selection?.addRange(range.current); } catch {} } editor.focus({ preventScroll: true }); document.execCommand(command, false); const blocks = snapshotBlocks(); change(blocks); };
  const align = (value: string) => { const id = activeRef.current, blocks = snapshotBlocks().map(block => block.id === id && block.source === 'notes' ? { ...block, paragraphAlign: value, atoms: block.atoms.map(atom => ({ ...atom, paragraphAlign: value })) } : block); change(blocks); };
  const all = (id: string, element: HTMLDivElement) => { const targetBlock = noteRef.current?.blocks?.find(block => block.id === id); const now = Date.now(), phase = targetBlock?.source === 'notes' && !blockText(targetBlock).trim() ? 2 : selectAllPhase(previousA.current, id, now); previousA.current = { target: id, at: now }; if (phase === 1) { setAllSelected(false); selectElementText(element); } else { window.getSelection()?.removeAllRanges(); setAllSelected(true); selectElementText(body.current); } return true; };
  const copyAll = async () => { const latest = noteRef.current; if (!latest) return; const blocks = snapshotBlocks(), text = blocks.map(block => block.atoms.map(atom => atom.kind === 'image' ? '[图片 ' + stamp(atom.at) + ']' : atom.value).join('')).join('\n\n'), html = blocks.map(block => '<section style="margin:12px 0">' + block.atoms.map(atom => atom.kind === 'image' ? '<img src="' + atom.value.replace(/["<>]/g, '') + '" style="max-width:100%">' : noteAtomHtml(atom)).join('') + '</section>').join(''), images = blocks.flatMap(block => block.atoms.filter(atom => atom.kind === 'image').map(atom => atom.value)); try { await ipc('clipboard.write', { text, html, images }); } catch (err) { setError(errorMessage(err)); } };
  const keyDown = (event: React.KeyboardEvent) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase(), target = event.target as HTMLElement; if (target.closest('input,textarea,[contenteditable="true"]')) return;
    if (key === 'a' && target.closest('.notes-body')) { event.preventDefault(); event.stopPropagation(); const block = target.closest('[data-note-block]'); if (block) all(block.getAttribute('data-note-block')!, block.querySelector('.note-reference-content') as HTMLDivElement || block as HTMLDivElement); else { window.getSelection()?.removeAllRanges(); setAllSelected(true); selectElementText(body.current); } }
    if (key === 'c' && allSelected) { event.preventDefault(); event.stopPropagation(); void copyAll(); }
  };
  const clearSelection = (event: React.PointerEvent) => { const target = event.target as HTMLElement; if (!allSelected || target.closest('.whole-selection-menu')) return; if (!target.closest('.notes-body')) { setAllSelected(false); window.getSelection()?.removeAllRanges(); return; } if (target.closest('.notes-body') && !target.closest('.note-block') && !target.closest('.note-gap')) { setAllSelected(false); window.getSelection()?.removeAllRanges(); } };
  useEffect(() => {
    if (!allSelected) return;
    const clear = (event: PointerEvent) => { const element = event.target as HTMLElement; if (!element.closest('.notes-pane')) { setAllSelected(false); window.getSelection()?.removeAllRanges(); } };
    document.addEventListener('pointerdown', clear, true); return () => document.removeEventListener('pointerdown', clear, true);
  }, [allSelected]);
  const jumpBlock = async (block: NoteBlock) => {
    const reference = block.atoms.find(atom => atom.reference)?.reference;
    if (!reference || !['question', 'summary'].includes(reference.kind)) { onSeek(block.at); return; }
    const currentNote = noteRef.current?.id, requestGeneration = generation.current;
    try {
      let available = false;
      if (reference.kind === 'question') {
        const sessions = await ipc<{ id: string; turns: unknown[] }[]>('ai.chatSessions', { course });
        const original = sessions.find(session => session.id === reference.sessionId);
        available = !!original?.turns?.[reference.turn || 0];
      } else {
        const source = await ipc<{ archived?: { id?: string; answer?: string }; records?: Record<string, { id?: string; answer?: string }> }>('summary.get', { course, scope: reference.scope, pageId: reference.pageId, recordId: reference.summaryId });
        const original = source.archived || Object.values(source.records || {}).find(record => record.id === reference.summaryId);
        available = typeof original?.answer === 'string' && !!original.answer.trim();
      }
      if (requestGeneration !== generation.current || currentNote !== noteRef.current?.id) return;
      if (!available) { setError('相关缓存已被清理'); props.onNotice?.('相关缓存已被清理'); return; }
      onOpenReference?.(reference);
    } catch (err) { if (requestGeneration === generation.current) setError(errorMessage(err)); }
  };
  if (!note) return <section className="study-pane notes-pane"><header className="pane-title"><h2>课堂笔记</h2></header><p className="pane-muted">正在读取笔记…</p></section>;
  return <section data-study-pane="notes" data-native-selection="true" className="study-pane notes-pane" aria-label="课堂笔记" tabIndex={0} onKeyDown={keyDown} onPointerDown={event => { clearSelection(event); if (!(event.target as HTMLElement).closest('input,textarea,select,button,a,[contenteditable="true"],[data-select-content],[data-select-block],[data-select-all],[data-selection-gap]')) event.currentTarget.focus({ preventScroll: true }); }}>
    <header className="pane-title"><h2>课堂笔记</h2><div className="pane-title-tools"><select aria-label="当前笔记" value={note.id} onChange={event => { const value = notes.find(item => item.id === event.target.value); if (value) open(value); }}><option value={note.id}>{note.title || '课堂笔记'}</option>{notes.filter(item => item.id !== note.id).map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select><button onClick={newOne}>新建</button><button aria-pressed={manage} onClick={() => setManage(!manage)}>管理</button><button aria-pressed={colors} onClick={() => setColors(!colors)}>颜色</button></div></header>
    <div className="note-format-row"><div className="note-format-left"><button title="加粗" aria-label="加粗" onPointerDown={event => event.preventDefault()} onClick={() => formatText('bold')}><b>B</b></button><button title="斜体" aria-label="斜体" onPointerDown={event => event.preventDefault()} onClick={() => formatText('italic')}><i>I</i></button><button title="下划线" aria-label="下划线" onPointerDown={event => event.preventDefault()} onClick={() => formatText('underline')}><u>U</u></button><button title="删除线" aria-label="删除线" onPointerDown={event => event.preventDefault()} onClick={() => formatText('strikeThrough')}><s>S</s></button><button onPointerDown={event => event.preventDefault()} onClick={() => { void pickImage(); }}>图片</button><button onPointerDown={event => event.preventDefault()} onClick={() => { void captureImage(); }}>拍照</button></div><div className="note-alignment"><button title="左对齐" aria-label="左对齐" onPointerDown={event => event.preventDefault()} onClick={() => align('left')}>☰</button><button title="居中" aria-label="居中" onPointerDown={event => event.preventDefault()} onClick={() => align('center')}>≡</button><button title="右对齐" aria-label="右对齐" onPointerDown={event => event.preventDefault()} onClick={() => align('right')}>☰</button></div></div>
    {manage && <div className="notes-management pane-scroll"><div className="pane-actions"><button onClick={() => rename(note)}>重命名</button><select aria-label="笔记导出格式" value={format} onChange={event => setFormat(event.target.value)}><option value="md">Markdown</option><option value="html">网页</option><option value="txt">纯文本</option></select><button disabled={busy} onClick={() => { void exportNote([note]); }}>导出当前</button><button disabled={busy || !notes.length} onClick={() => { void exportNote(notes); }}>打包导出</button></div>{notes.map(item => <article key={item.id}><button className="history-open" onClick={() => open(item)}>{item.title || '课堂笔记'}</button><button onClick={() => rename(item)}>重命名</button><button className="danger" onClick={() => { void remove(item); }}>删除</button></article>)}</div>}
    {colors && <div className="note-colors pane-scroll">{(['notes', 'transcript', 'slides', 'image', 'question', 'summary'] as const).map(source => <div key={source}><span>{blockTitle(source)}</span><div className="swatches">{noteColors.map(color => <button key={color} style={{ background: color }} aria-label={blockTitle(source) + '颜色 ' + color} aria-pressed={palette[source] === color} onClick={() => { const next = { ...palette, [source]: color }; setPalette(next); void ipc('storage.set', { key: 'note-palette', value: next }); }}>{palette[source] === color ? '✓' : ''}</button>)}</div></div>)}</div>}
    {capture && <div className="note-camera"><video ref={camera} muted autoPlay playsInline /><span>{captureStatus}</span><div className="pane-actions"><button onClick={() => { void takePhoto(); }}>拍摄并插入</button><button onClick={() => { void captureImage(); }}>取消</button></div></div>}
    <div ref={body} data-select-all="true" className={'pane-scroll notes-body ' + (allSelected ? 'notes-whole-selected' : '')} tabIndex={0} onCopy={event => { if (allSelected) { event.preventDefault(); event.stopPropagation(); void copyAll(); } }} onPointerDown={event => { if (event.target === event.currentTarget) { event.currentTarget.focus({ preventScroll: true }); window.getSelection()?.removeAllRanges(); setAllSelected(false); } }} onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }} onDrop={async event => { if (!event.dataTransfer.files.length) return; event.preventDefault(); for (const file of Array.from(event.dataTransfer.files)) { if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type) || file.size > 30 * 1024 * 1024) { setError('请选择 30 MB 以内的图片'); continue; } const reader = new FileReader(); reader.onload = () => { void ipc<{ uri: string }>('notes.saveImage', { data: reader.result }).then(value => insert({ kind: 'image', value: value.uri, at: currentTime, end: currentTime, sourceId: '' })).catch(err => setError(errorMessage(err))); }; reader.readAsDataURL(file); } }}>
      <div className="note-gap" data-selection-gap="true" tabIndex={0} onClick={() => addOwn(0)} title="在这里记笔记" />
      {(note.blocks || []).map((block, index) => <React.Fragment key={block.id}><article className="note-block" data-note-block={block.id} data-select-block="true" style={{ backgroundColor: palette[block.source as keyof NotePalette] || palette.notes }} tabIndex={0} onPointerDown={() => { if (block.source !== 'notes') { setActive(block.id); activeRef.current = block.id; caretRef.current = blockText(block).length; } }}>
        <div className="note-block-heading" onClick={() => jumpBlock(block)}><button type="button" className="note-source-time" onClick={event => { event.stopPropagation(); jumpBlock(block); }}>{blockTitle(block.source)} · {stamp(block.at)}</button><button className="note-remove" aria-label="删除此内容" title="删除此内容" onClick={event => { event.stopPropagation(); change((noteRef.current?.blocks || []).filter(item => item.id !== block.id)); }}>×</button></div>
        {block.source === 'notes' ? <EditableNote ref={value => { if (value) editors.current.set(block.id, value); else editors.current.delete(block.id); }} block={block} onChange={atoms => change((noteRef.current?.blocks || []).map(item => item.id === block.id ? updateNoteBlock(item, atoms, currentTime) : item))} onActive={remember} onSplit={split} onAll={all} onBlur={() => { const id = block.id; setTimeout(() => { if (document.activeElement?.closest('[data-note-editor="' + id + '"]')) return; const cleaned = cleanedBlocks(noteRef.current?.blocks || [], activeRef.current === id && !blockText(block).trim() ? '' : activeRef.current); if (cleaned.length !== noteRef.current?.blocks?.length) change(cleaned); }, 80); }} /> : block.atoms[0]?.kind === 'image' ? <img className="note-image" src={block.atoms[0].value} alt={blockTitle(block.source) + ' ' + stamp(block.at)} draggable onClick={() => jumpBlock(block)} /> : <div className="note-reference-content"><AnswerContent parts={noteAnswerParts(block)} onSeek={onSeek} /></div>}
      </article><div className="note-gap" data-selection-gap="true" tabIndex={0} title="在这里记笔记" onClick={() => addOwn(index + 1)} /></React.Fragment>)}
      {!note.blocks?.length && <button className="empty-note" onClick={() => addOwn(0)}>记下笔记…</button>}
      {allSelected && <div className="whole-selection-menu"><button onPointerDown={event => event.preventDefault()} onClick={() => { void copyAll(); }}>复制</button><button onClick={() => { setAllSelected(false); window.getSelection()?.removeAllRanges(); }}>取消全选</button></div>}
    </div>
    <footer className="note-footer"><button onClick={() => { if (!noteRef.current?.blocks?.length || noteRef.current.blocks[noteRef.current.blocks.length - 1]?.source !== 'notes') addOwn(noteRef.current?.blocks?.length || 0); else { const last = noteRef.current.blocks[noteRef.current.blocks.length - 1]; requestAnimationFrame(() => editors.current.get(last.id)?.focus(blockText(last).length)); } body.current?.scrollTo({ top: body.current.scrollHeight, behavior: 'smooth' }); }}>末尾</button>{props.returnVisible && <button onClick={props.onReturn}>回到刚刚</button>}</footer>
    {error && <p className="pane-error" role="alert">{error}</p>}
  </section>;
}
export default NotesPane;
