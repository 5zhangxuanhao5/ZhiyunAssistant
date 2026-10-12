import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Course, Slide, Transcript } from '../shared/model/Timeline';
import type { PageSummaryRecord } from '../shared/model/SummaryPolicy';
import { stamp } from '../shared/model/Timeline';
import type { NoteContentReference, NoteInsertion } from '../shared/model/Notes';
import { CourseAnswerPart, courseAnswerParts } from '../shared/model/CourseReference';
import { selectedAnswerParts } from '../shared/model/NoteFormatting';
import { bridge, ipc, errorMessage, enterAction, materialForQuestion, selectAllPhase } from './panesLogic';
import './panes.css';

export interface AiTurn { question: string; answer: string; at: number; whole?: boolean; expanded?: boolean; mode?: string; complete?: boolean; references?: Course[] }
export interface ChatSession { id: string; title: string; turns: AiTurn[]; savedAt: number; scroll?: number }
export interface AiSettings { configured: boolean; model: string; models: string[] }
export interface AiStreamEvent { requestId: string; text?: string; status?: string; done?: boolean; error?: string }
export interface AiResult { record?: PageSummaryRecord; answer: string; references?: Course[]; completed?: boolean; signature?: string }
export interface AiPaneProps {
  course: Course; slides: Slide[]; lines: Transcript[]; currentTime: number; currentPageId?: string; notesOpen?: boolean;
  onSeek: (at: number, course?: Course) => void; onInsert?: (value: NoteInsertion) => void;
  onChooseSlides?: () => void; selectedSlideIds?: string[]; requestedReference?: NoteContentReference;
  returnVisible?: boolean; onReturn?: () => void; onDismissReturn?: () => void;
  onNotice?: (value: string) => void;
}

export function useAiConfiguration() {
  const [settings, setSettings] = useState<AiSettings>({ configured: false, model: '', models: [] });
  const [checked, setChecked] = useState(false), [error, setError] = useState('');
  const refresh = useCallback(async () => { try { const value = await ipc<AiSettings>('ai.settings'); setSettings({ configured: !!value.configured, model: value.model || value.models?.[0] || '', models: value.models || [] }); setError(''); } catch (err) { setError(errorMessage(err)); } finally { setChecked(true); } }, []);
  useEffect(() => { void refresh(); let stop: () => void = () => {}; try { stop = bridge().on('ai.settings', () => { void refresh(); }); } catch {} return stop; }, [refresh]);
  return { settings, setSettings, checked, refresh, error };
}

export function ApiSettings({ configured, onDone, onRefresh }: { configured: boolean; onDone: () => void; onRefresh: () => Promise<void> }) {
  const [changing, setChanging] = useState(!configured), [key, setKey] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const save = async () => { if (!key.trim() || busy) return; setBusy(true); setError(''); try { await ipc('ai.saveKey', { key: key.trim() }); setKey(''); await onRefresh(); onDone(); } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); } };
  const remove = async () => { if (!window.confirm('删除本机保存的 API 密钥？课程笔记和问答记录会保留。')) return; try { await ipc('ai.deleteKey'); await onRefresh(); setChanging(true); } catch (err) { setError(errorMessage(err)); } };
  useEffect(() => { if (changing) input.current?.focus(); }, [changing]);
  return <section className="api-setup" aria-label="API 设置">
    <h3>{configured ? 'API 设置' : '启用 AI 辅助学习'}</h3>
    <p>从 DeepSeek 开放平台获取 API 密钥。密钥加密保存在本机，服务费用由你的 DeepSeek 账户承担。</p>
    <button type="button" className="text-link" onClick={() => { void ipc('app.external', { url: 'https://platform.deepseek.com/' }); }}>打开 DeepSeek 开放平台 ↗</button>
    {changing ? <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <label htmlFor="deepseek-key">API 密钥</label>
      <input ref={input} id="deepseek-key" type="password" autoComplete="off" spellCheck={false} value={key} placeholder="粘贴 API 密钥" onChange={event => setKey(event.target.value)} onKeyDown={event => event.stopPropagation()} />
      <div className="pane-actions"><button className="primary" disabled={!key.trim() || busy} type="submit">{busy ? '正在验证…' : '保存并启用'}</button>{configured && <button type="button" disabled={busy} onClick={() => { setKey(''); setChanging(false); }}>取消</button>}</div>
    </form> : <div className="pane-actions"><button onClick={() => setChanging(true)}>更换密钥</button><button className="danger" onClick={() => { void remove(); }}>删除密钥</button></div>}
    {configured && <button type="button" onClick={onDone}>返回对话</button>}
    {error && <p className="pane-error" role="alert">{error}</p>}
  </section>;
}

function referenceContext(references?: Course[]) { return references?.length ? { gaps: [], lessons: references.map(course => ({ course, slides: [], lines: [], gaps: [] })) } : undefined; }
export function answerContentParts(answer: string, references?: Course[]): CourseAnswerPart[] { return courseAnswerParts(answer, referenceContext(references)); }
function selectionOffsets(root: HTMLElement): { start: number; end: number } | undefined {
  const selection = window.getSelection(); if (!selection?.rangeCount || selection.isCollapsed) return;
  const range = selection.getRangeAt(0); if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return;
  const before = document.createRange(); before.selectNodeContents(root); before.setEnd(range.startContainer, range.startOffset);
  return { start: before.toString().length, end: before.toString().length + range.toString().length };
}
export function selectElementText(root: HTMLElement | null) { if (!root) return; const selection = window.getSelection(), range = document.createRange(); range.selectNodeContents(root); selection?.removeAllRanges(); selection?.addRange(range); }

export interface AnswerContentProps { answer?: string; parts?: CourseAnswerPart[]; references?: Course[]; onSeek: (at: number, course?: Course) => void; notesOpen?: boolean; onInsert?: (value: NoteInsertion) => void; reference?: NoteContentReference; at?: number; highlight?: boolean; selectionClass?: string; onInteraction?: () => void }
export function AnswerContent({ answer = '', parts: incoming, references, onSeek, notesOpen, onInsert, reference, at = 0, highlight, selectionClass, onInteraction }: AnswerContentProps) {
  const parts = incoming || answerContentParts(answer, references), root = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<{ start: number; end: number; x: number; y: number }>();
  useEffect(() => { const changed = () => { if (!root.current || !notesOpen) { setSelection(undefined); return; } const offset = selectionOffsets(root.current); if (!offset) { setSelection(undefined); return; } const rectangle = window.getSelection()!.getRangeAt(0).getBoundingClientRect(), box = root.current.getBoundingClientRect(); setSelection({ ...offset, x: Math.max(0, Math.min(box.width - 130, rectangle.left - box.left)), y: Math.max(0, rectangle.bottom - box.top) }); }; document.addEventListener('selectionchange', changed); return () => document.removeEventListener('selectionchange', changed); }, [notesOpen]);
  const insert = () => { if (!selection || !onInsert) return; const formatted = selectedAnswerParts(parts, selection.start, selection.end); onInsert({ kind: reference?.kind === 'summary' ? 'summary' : 'question', value: formatted.map(part => part.value).join(''), formatted, at: reference?.at ?? at, end: reference?.at ?? at, sourceId: '', reference }); window.getSelection()?.removeAllRanges(); setSelection(undefined); };
  return <div className={'answer-container ' + (selectionClass || '')}>
    <div ref={root} data-select-content="true" className={'answer-content native-selectable ' + (highlight ? 'reference-highlight' : '')} onPointerDown={onInteraction}>
      {parts.map((part, index) => { const style = { fontWeight: part.bold ? 650 : undefined, fontStyle: part.italic ? 'italic' : undefined }; return part.seconds >= 0 ? <a key={index} role="link" tabIndex={0} className="time-link" style={style} href="#" onClick={event => { event.preventDefault(); event.stopPropagation(); if (!window.getSelection()?.toString()) onSeek(part.seconds, part.course); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); onSeek(part.seconds, part.course); } }}>{part.value}</a> : part.code ? <code style={style} key={index}>{part.value}</code> : <span style={style} key={index}>{part.value}</span>; })}
    </div>
    {selection && notesOpen && <button type="button" className="selection-insert" style={{ left: selection.x, top: selection.y + 6 }} onPointerDown={event => event.preventDefault()} onClick={insert}>插入到笔记</button>}
  </div>;
}

export function AiPane(props: AiPaneProps) {
  const { course, slides, lines, currentTime, currentPageId, notesOpen, onSeek, onInsert, selectedSlideIds = [], requestedReference } = props;
  const configuration = useAiConfiguration();
  const [apiOpen, setApiOpen] = useState(false), [historyOpen, setHistoryOpen] = useState(false), [sessions, setSessions] = useState<ChatSession[]>([]), [sessionId, setSessionId] = useState(''), [turns, setTurns] = useState<AiTurn[]>([]);
  const [question, setQuestion] = useState(''), [whole, setWhole] = useState(false), [mode, setMode] = useState('auto'), [busy, setBusy] = useState(false), [status, setStatus] = useState(''), [error, setError] = useState(''), [highlighted, setHighlighted] = useState(-1);
  const request = useRef(''), session = useRef<ChatSession | undefined>(undefined), composing = useRef(false), scroll = useRef<HTMLDivElement>(null), input = useRef<HTMLTextAreaElement>(null), courseRef = useRef(course.subId), generation = useRef(0), target = useRef(-1), priorA = useRef<{ target: string; at: number } | null>(null), turnsRef = useRef(turns), scrollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), mounted = useRef(true), pendingSave = useRef<Promise<unknown>>(Promise.resolve()), followAnswer = useRef(true);
  turnsRef.current = turns;
  const persist = useCallback((next: AiTurn[], id = session.current?.id) => { if (!id) return; const value: ChatSession = { id, title: next[0]?.question.slice(0, 36) || '新对话', turns: next, savedAt: Date.now(), scroll: scroll.current?.scrollTop || 0 }; session.current = value; pendingSave.current = pendingSave.current.catch(() => {}).then(() => ipc('ai.saveChat', { course, session: value })); void pendingSave.current.catch(err => { if (mounted.current) setError(errorMessage(err)); }); }, [course]);
  const cancel = useCallback(() => { const id = request.current; request.current = ''; generation.current++; if (id) void ipc('ai.cancel', { requestId: id }).catch(() => {}); if (session.current?.id && turnsRef.current.length) persist(turnsRef.current); setBusy(false); setStatus(''); }, [persist]);
  const openSession = useCallback((item: ChatSession) => { cancel(); session.current = item; setSessionId(item.id); setTurns(item.turns || []); setQuestion(''); setHistoryOpen(false); setError(''); setApiOpen(false); requestAnimationFrame(() => { if (scroll.current) scroll.current.scrollTop = item.scroll || 0; }); }, [cancel]);
  useEffect(() => {
    mounted.current = true; const epoch = ++generation.current; courseRef.current = course.subId; setTurns([]); setSessions([]); session.current = undefined; setSessionId(''); setError('');
    void ipc<ChatSession[]>('ai.chatSessions', { course }).then(items => { if (epoch !== generation.current) return; setSessions(items); if (items.length) openSession(items[0]); }).catch(err => { if (epoch === generation.current) setError(errorMessage(err)); });
    return () => { if (session.current?.id && turnsRef.current.length) persist(turnsRef.current); mounted.current = false; const id = request.current; request.current = ''; generation.current++; clearTimeout(scrollTimer.current); if (id) void ipc('ai.cancel', { requestId: id }).catch(() => {}); };
  }, [course.subId]);
  useEffect(() => {
    const flush = (event: Event) => {
      if (session.current?.id && turnsRef.current.length) persist(turnsRef.current);
      if (event instanceof CustomEvent && event.detail?.tasks) event.detail.tasks.push(pendingSave.current); else void pendingSave.current.catch(() => {});
    };
    window.addEventListener('zhiyun-flush', flush); window.addEventListener('pagehide', flush);
    return () => { window.removeEventListener('zhiyun-flush', flush); window.removeEventListener('pagehide', flush); };
  }, [persist]);
  useEffect(() => { if (!requestedReference || requestedReference.kind !== 'question' || requestedReference.courseId !== course.subId) return; void ipc<ChatSession[]>('ai.chatSessions', { course }).then(items => { const found = items.find(item => item.id === requestedReference.sessionId); if (!found) { setError('相关缓存已被清理'); return; } openSession(found); const index = Math.max(0, Math.min(found.turns.length - 1, requestedReference.turn || 0)); setHighlighted(index); requestAnimationFrame(() => scroll.current?.querySelector(`[data-turn="${index}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'instant' })); setTimeout(() => setHighlighted(-1), 2000); }).catch(err => setError(errorMessage(err))); }, [requestedReference, course.subId, openSession]);
  useEffect(() => {
    let stop = () => {};
    try { stop = bridge().on('ai.stream', (event: AiStreamEvent) => { if (event.requestId !== request.current) return; if (event.status !== undefined) setStatus(event.status); if (event.text !== undefined) { setStatus(''); setTurns(previous => { const next = previous.map((turn, index) => index === target.current ? { ...turn, answer: event.text! } : turn); turnsRef.current = next; return next; }); } if (event.error) setError(event.error); }); } catch (err) { setError(errorMessage(err)); }
    return stop;
  }, []);
  useLayoutEffect(() => { const textarea = input.current; if (textarea) { textarea.style.height = 'auto'; textarea.style.height = Math.max(36, Math.min(160, textarea.scrollHeight)) + 'px'; } }, [question]);
  useLayoutEffect(() => {
    const element = scroll.current;
    if (busy && followAnswer.current && element && !window.getSelection()?.toString()) element.scrollTop = element.scrollHeight;
  }, [turns[turns.length - 1]?.answer, busy]);
  const ask = async () => {
    if (!question.trim() || busy || !configuration.settings.configured) return;
    if (!slides.length && !lines.length) { setError('当前还没有可用的课程内容'); return; }
    const text = question.trim(), epoch = ++generation.current, id = crypto.randomUUID(), at = currentTime, prior = turnsRef.current.slice(), currentSession = session.current?.id || crypto.randomUUID();
    request.current = id; target.current = prior.length; followAnswer.current = true; session.current = session.current || { id: currentSession, title: text.slice(0, 36), turns: [], savedAt: Date.now() }; setSessionId(currentSession);
    const context = materialForQuestion(course, slides, lines, text, at, whole, selectedSlideIds);
    const next = [...prior, { question: text, answer: '', at, whole: context.whole, mode, complete: false }]; setTurns(next); turnsRef.current = next; setQuestion(''); setBusy(true); setError(''); setStatus('正在读取课程内容'); persist(next, currentSession);
    requestAnimationFrame(() => scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: 'smooth' }));
    try {
      const result = await ipc<AiResult | string>('ai.start', { requestId: id, kind: 'question', ...context, lines, question: text, model: configuration.settings.model, mode, history: prior, currentId: currentPageId });
      if (epoch !== generation.current || request.current !== id) return;
      const answer = typeof result === 'string' ? result : result.answer;
      setTurns(previous => { const final = previous.map((turn, index) => index === target.current ? { ...turn, answer, complete: true, references: typeof result === 'string' ? undefined : result.references } : turn); turnsRef.current = final; persist(final, currentSession); return final; });
      const items = await ipc<ChatSession[]>('ai.chatSessions', { course }); if (epoch === generation.current) setSessions(items);
    } catch (err) { if (epoch === generation.current) { setError(errorMessage(err)); persist(turnsRef.current, currentSession); } }
    finally { if (epoch === generation.current) { request.current = ''; setBusy(false); setStatus(''); } }
  };
  const newChat = () => { persist(turnsRef.current); cancel(); const value: ChatSession = { id: crypto.randomUUID(), title: '新对话', turns: [], savedAt: Date.now() }; session.current = value; setSessionId(value.id); setTurns([]); setQuestion(''); setHistoryOpen(false); setError(''); input.current?.focus(); };
  const deleteChat = async (item: ChatSession) => { if (!window.confirm('删除这次对话？引用它的笔记会保留，但无法再定位原问答。')) return; try { await ipc('ai.deleteChat', { course, id: item.id }); setSessions(previous => previous.filter(entry => entry.id !== item.id)); if (sessionId === item.id) newChat(); } catch (err) { setError(errorMessage(err)); } };
  const chatKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'a') return;
    const element = event.target as HTMLElement; if (element.closest('textarea,input')) return; const body = element.closest('[data-turn-body]') || (document.activeElement as HTMLElement)?.closest('[data-turn-body]');
    const index = body?.getAttribute('data-turn-body'); if (index === null || index === undefined) { if (element === scroll.current || element.closest('.conversation-gap')) { event.preventDefault(); event.stopPropagation(); selectElementText(scroll.current?.querySelector('.turn-list') || null); } return; }
    event.preventDefault(); event.stopPropagation(); const now = Date.now(), phase = selectAllPhase(priorA.current, 'turn-' + index, now); priorA.current = { target: 'turn-' + index, at: now }; selectElementText(phase === 2 ? scroll.current?.querySelector('.turn-list') || null : body as HTMLElement);
  };
  const selectCopy = (event: React.ClipboardEvent) => { const selection = window.getSelection(); if (!selection?.toString()) return; event.clipboardData.setData('text/plain', selection.toString()); event.preventDefault(); event.stopPropagation(); };
  return <section data-study-pane="ai" data-native-selection="true" className="study-pane ai-pane" tabIndex={0} onPointerDown={event => { if (!(event.target as HTMLElement).closest('input,textarea,select,button,a,[contenteditable="true"],[data-select-content],[data-select-block],[data-select-all],[data-selection-gap]')) event.currentTarget.focus({ preventScroll: true }); }} onKeyDown={chatKey} aria-label="课程问答">
    <header className="pane-title"><h2>课程问答</h2><div className="pane-title-tools">{configuration.settings.configured && !apiOpen && <><button onClick={newChat}>新对话</button><button aria-pressed={historyOpen} onClick={() => { persist(turnsRef.current); void ipc<ChatSession[]>('ai.chatSessions', { course }).then(setSessions).catch(err => setError(errorMessage(err))); setHistoryOpen(!historyOpen); }}>历史</button><select aria-label="问答模型" value={configuration.settings.model} onChange={event => { const model = event.target.value; configuration.setSettings(previous => ({ ...previous, model })); void ipc('storage.set', { key: 'ai-model.txt', value: model }); }}>{configuration.settings.models.map(model => <option key={model}>{model}</option>)}</select></>} {!apiOpen && configuration.settings.configured && <button onClick={() => setApiOpen(true)}>API 设置</button>}</div></header>
    {!configuration.checked ? <p className="pane-muted">正在读取设置…</p> : !configuration.settings.configured || apiOpen ? <ApiSettings configured={configuration.settings.configured} onDone={() => setApiOpen(false)} onRefresh={configuration.refresh} /> : historyOpen ? <div className="pane-scroll history-list">{sessions.length ? sessions.map(item => <article key={item.id}><button className="history-open" onClick={() => openSession(item)}><strong>{item.title}</strong><small>{item.turns.length} 次提问 · {new Date(item.savedAt).toLocaleDateString()}</small></button><button className="danger" onClick={() => { void deleteChat(item); }}>删除</button></article>) : <p className="pane-muted">这节课还没有历史对话</p>}</div> : <>
      <div className="ai-options"><label><input type="checkbox" checked={whole} onChange={event => setWhole(event.target.checked)} />结合整节课</label><select aria-label="课件使用方式" value={mode} onChange={event => setMode(event.target.value)}><option value="auto">按需参考课件</option><option value="always">结合课件作答</option><option value="never">不结合课件</option></select><button onClick={props.onChooseSlides} disabled={!slides.length}>选择课件{selectedSlideIds.length ? ' · ' + selectedSlideIds.length : ''}</button></div>
      <div className="ai-conversation-wrap"><div className={'pane-scroll ai-conversation ' + (props.returnVisible ? 'return-padding' : '')} ref={scroll} tabIndex={0} onCopy={selectCopy} onScroll={() => { const element = scroll.current; if (element) followAnswer.current = element.scrollHeight - element.scrollTop - element.clientHeight < 64; clearTimeout(scrollTimer.current); scrollTimer.current = setTimeout(() => { if (session.current) persist(turnsRef.current); }, 500); }} onPointerDown={event => { if (event.target === event.currentTarget) { event.currentTarget.focus({ preventScroll: true }); window.getSelection()?.removeAllRanges(); } props.onDismissReturn?.(); }}>
      <div className="turn-list" data-select-all="true">{turns.length ? turns.map((turn, index) => <article data-turn={index} key={index} className={'chat-turn ' + (highlighted === index ? 'reference-highlight' : '')}>
        <div className="chat-turn-meta"><span>{stamp(turn.at)}{turn.whole ? ' · 整节课' : ''}</span><span className="ai-generated">AI 生成</span></div>
        <div className="chat-turn-body native-selectable" data-turn-body={index} data-select-block="true" tabIndex={0} onPointerDown={() => props.onDismissReturn?.()}>
          <div className="chat-question">{turn.question}</div>
          <AnswerContent answer={turn.answer} references={turn.references} onSeek={onSeek} notesOpen={notesOpen} onInsert={onInsert} at={turn.at} reference={{ kind: 'question', courseId: course.subId, sessionId, turn: index, at: turn.at }} />
          {!turn.answer && busy && index === target.current && <p className="pane-muted">{status || '正在回答…'}</p>}
        </div><div className="conversation-gap" data-selection-gap="true" tabIndex={0} />
      </article>) : <p className="pane-muted ai-empty">可以问本节课的内容，也可以选择课件后提问。</p>}</div>
      </div>{props.returnVisible && <button className="floating-return" onClick={props.onReturn}>回到刚刚</button>}</div>
      {status && <div className="pane-status" role="status">{status}</div>}
      <form className="ai-input-row" onSubmit={event => { event.preventDefault(); void ask(); }}>
        <textarea ref={input} aria-label="问问这节课" placeholder="问问这节课…" value={question} rows={1} onChange={event => setQuestion(event.target.value)} onCompositionStart={() => composing.current = true} onCompositionEnd={() => composing.current = false} onKeyDown={event => { event.stopPropagation(); const action = enterAction({ ...event, isComposing: event.nativeEvent.isComposing, keyCode: event.nativeEvent.keyCode }, composing.current); if (action === 'send') { event.preventDefault(); void ask(); } }} />
        {busy ? <button type="button" onClick={cancel}>停止</button> : <button className="primary" type="submit" disabled={!question.trim()}>发送</button>}
      </form><p className="input-hint">Enter 发送 · Shift＋Enter 换行</p>
    </>}
    {(error || configuration.error) && <p className="pane-error" role="alert">{error || configuration.error}</p>}
  </section>;
}
export default AiPane;
