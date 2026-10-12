import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Course, Slide, Transcript } from '../shared/model/Timeline';
import { stamp } from '../shared/model/Timeline';
import type { NoteContentReference, NoteInsertion } from '../shared/model/Notes';
import type { PageSummaryRecord } from '../shared/model/SummaryPolicy';
import { AnswerContent, ApiSettings, useAiConfiguration, AiResult, AiStreamEvent, selectElementText } from './AiPane';
import { bridge, ipc, errorMessage, summaryRecordKey, summaryEligible, summaryContext } from './panesLogic';
import './panes.css';

export interface SummaryPaneProps {
  course: Course; slides: Slide[]; lines: Transcript[]; currentTime: number; currentPageId: string; notesOpen?: boolean; followingLive?: boolean;
  onSeek: (at: number, course?: Course) => void; onInsert?: (value: NoteInsertion) => void; onTurn?: (direction: number) => void;
  requestedReference?: NoteContentReference; returnVisible?: boolean; onReturn?: () => void; onDismissReturn?: () => void; onNotice?: (value: string) => void;
}
interface SummaryData { records?: Record<string, PageSummaryRecord>; positions?: Record<string, number>; scope?: string; archived?: PageSummaryRecord }
const scopes = [ { id: 'page', label: '本页内容', cost: '仅本页讲解与课件，用量较少' }, { id: 'before', label: '联系前文', cost: '加入本节前文，用量中等' }, { id: 'whole', label: '整课脉络', cost: '加入整节课，用量较多' }, { id: 'course', label: '结合整门课之前的内容', cost: '加入前序课次，用量高' }, { id: 'courseAll', label: '结合整门课', cost: '加入整门课的可用材料，用量最高' } ];
export function SummaryPane(props: SummaryPaneProps) {
  const { course, slides, lines, currentPageId, currentTime, onSeek, onInsert, notesOpen, requestedReference } = props;
  const configuration = useAiConfiguration(), live = course.status === 'live' || Date.now() / 1000 >= course.start && Date.now() / 1000 < course.end;
  const [scope, setScope] = useState('page'), [allPages, setAllPages] = useState(false), [records, setRecords] = useState<Record<string, PageSummaryRecord>>({}), [positions, setPositions] = useState<Record<string, number>>({}), [loaded, setLoaded] = useState(false);
  const [working, setWorking] = useState(''), [streaming, setStreaming] = useState(''), [status, setStatus] = useState(''), [error, setError] = useState(''), [pinned, setPinned] = useState<PageSummaryRecord>(), [highlight, setHighlight] = useState(false), [referenceLoading, setReferenceLoading] = useState(false);
  const request = useRef(''), epoch = useRef(0), loadEpoch = useRef(0), failed = useRef(new Set<string>()), scroll = useRef<HTMLDivElement>(null), positionTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), recordsRef = useRef(records), positionsRef = useRef(positions), selectedPage = useRef(currentPageId), selectedScope = useRef(scope), workingRef = useRef(''), queueTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), lastWheel = useRef(0), touch = useRef<{ x: number; y: number } | undefined>(undefined), currentRecordRef = useRef<PageSummaryRecord | undefined>(undefined), referenceTarget = useRef<{scope: string; pageId: string} | undefined>(undefined);
  recordsRef.current = records; positionsRef.current = positions; selectedPage.current = currentPageId; selectedScope.current = scope; workingRef.current = working;
  const currentSlide = slides.find(slide => slide.id === currentPageId), key = summaryRecordKey(scope, currentPageId), record = pinned || records[key]; currentRecordRef.current = record;
  const cancel = useCallback(() => { const id = request.current; request.current = ''; epoch.current++; if (id) void ipc('ai.cancel', { requestId: id }).catch(() => {}); workingRef.current = ''; setWorking(''); setStreaming(''); setStatus(''); }, []);
  const savePosition = useCallback(() => { const pageId = selectedPage.current, currentScope = selectedScope.current, value = currentRecordRef.current; if (!pageId || !value?.id || !scroll.current) return; const position = scroll.current.scrollTop, positionKey = summaryRecordKey(currentScope, pageId) + ':' + value.id; positionsRef.current = { ...positionsRef.current, [positionKey]: position }; void ipc('summary.save', { course, pageId, scope: currentScope, position, recordId: value.id }).catch(() => {}); }, [course]);
  useEffect(() => {
    const generation = ++loadEpoch.current; setLoaded(false); setRecords({}); setPositions({}); setPinned(undefined); setAllPages(false); failed.current.clear();
    void ipc<SummaryData>('summary.get', { course }).then(value => { if (generation !== loadEpoch.current) return; setRecords(value.records || {}); setPositions(value.positions || {}); if (scopes.some(item => item.id === value.scope)) setScope(value.scope!); setLoaded(true); }).catch(err => { if (generation === loadEpoch.current) { setError(errorMessage(err)); setLoaded(true); } });
    return () => { ++loadEpoch.current; savePosition(); clearTimeout(positionTimer.current); clearTimeout(queueTimer.current); const id = request.current; request.current = ''; epoch.current++; if (id) void ipc('ai.cancel', { requestId: id }).catch(() => {}); };
  }, [course.subId]);
  useEffect(() => {
    if (!requestedReference || requestedReference.kind !== 'summary' || requestedReference.courseId !== course.subId) return;
    cancel(); const generation = epoch.current; setReferenceLoading(true);
    referenceTarget.current = { scope: requestedReference.scope || 'page', pageId: requestedReference.pageId || currentPageId };
    void ipc<SummaryData>('summary.get', { course, pageId: requestedReference.pageId, scope: requestedReference.scope, recordId: requestedReference.summaryId }).then(value => {
      if (generation !== epoch.current) return;
      const found = value.archived || Object.values(value.records || {}).find(item => item.id === requestedReference.summaryId);
      if (!found) { setError('相关缓存已被清理'); return; }
      setScope(requestedReference.scope || 'page'); setPinned(found); setHighlight(true); setTimeout(() => setHighlight(false), 2000);
    }).catch(err => setError(errorMessage(err))).finally(() => { if (generation === epoch.current) setReferenceLoading(false); });
  }, [requestedReference, course.subId]);
  useEffect(() => { const target = referenceTarget.current; if (!target || target.pageId !== currentPageId || target.scope !== scope) { setPinned(undefined); referenceTarget.current = undefined; } failed.current.delete(key); }, [currentPageId, scope]);
  useLayoutEffect(() => {
    const element = scroll.current, recordId = record?.id; if (!element) return;
    const positionKey = key + ':' + (recordId || '');
    element.scrollTop = positionsRef.current[positionKey] || 0;
    return () => { if (recordId) { const position = element.scrollTop; positionsRef.current[positionKey] = position; void ipc('summary.save', { course, pageId: currentPageId, scope, position, recordId }).catch(() => {}); } };
  }, [key, record?.id]);

  useEffect(() => {
    const flush = (event: Event) => {
      const value = currentRecordRef.current; if (!value?.id || !scroll.current) return;
      const task = ipc('summary.save', { course, pageId: selectedPage.current, scope: selectedScope.current, position: scroll.current.scrollTop, recordId: value.id });
      if (event instanceof CustomEvent && event.detail?.tasks) event.detail.tasks.push(task); else void task.catch(() => {});
    };
    window.addEventListener('zhiyun-flush', flush); window.addEventListener('pagehide', flush);
    return () => { window.removeEventListener('zhiyun-flush', flush); window.removeEventListener('pagehide', flush); };
  }, [course.subId]);
  useEffect(() => {
    let stop = () => {}; try { stop = bridge().on('ai.stream', (event: AiStreamEvent) => { if (event.requestId !== request.current) return; if (event.status !== undefined) setStatus(event.status); if (event.text !== undefined) { setStreaming(event.text); setStatus(''); } if (event.error) setError(event.error); }); } catch (err) { setError(errorMessage(err)); } return stop;
  }, []);
  const generate = useCallback(async (pageId: string, manual = false) => {
    if (workingRef.current || !configuration.settings.configured || !loaded || !slides.length) return;
    if (!summaryEligible(live, pageId, slides, manual)) return;
    const page = slides.find(item => item.id === pageId); if (!page) return; const context = summaryContext(scope, pageId, slides, currentTime), at = context.at;
    const generation = ++epoch.current, id = crypto.randomUUID(), recordKey = summaryRecordKey(scope, pageId), completed = !live || pageId !== slides[slides.length - 1]?.id;
    request.current = id; workingRef.current = pageId; setWorking(pageId); setStreaming(''); setStatus('正在整理本页内容'); setError('');
    try {
      const result = await ipc<AiResult | string>('ai.start', { requestId: id, kind: 'summary', course, slides, lines, at, currentId: pageId, selectedIds: context.selectedIds, whole: context.whole, scope, pageId, manual, model: configuration.settings.model, completed, question: '在最短时间内概括这一页讲了什么、老师解释了什么，以及与课程前后内容的关系。省去画面方位和机械的新增点描述；所有引用时间分别列出可独立点击的时间点。' });
      if (generation !== epoch.current || request.current !== id) return;
      const answer = typeof result === 'string' ? result : result.answer;
      const value: PageSummaryRecord = typeof result !== 'string' && result.record ? result.record : { id: crypto.randomUUID(), answer, signature: typeof result === 'string' ? '' : result.signature || '', savedAt: Date.now(), completed, contextAt: at, references: typeof result === 'string' ? undefined : result.references };
      await ipc('summary.save', { course, pageId, scope, record: value });
      if (generation !== epoch.current) return; const next = { ...recordsRef.current, [recordKey]: value }; recordsRef.current = next; setRecords(next); failed.current.delete(recordKey); if (pageId === selectedPage.current) setPinned(undefined);
    } catch (err) { if (generation === epoch.current) { failed.current.add(recordKey); setError(errorMessage(err)); } }
    finally { if (generation === epoch.current) { request.current = ''; workingRef.current = ''; setWorking(''); setStreaming(''); setStatus(''); } }
  }, [configuration.settings.configured, configuration.settings.model, loaded, slides, lines, live, scope, course, currentTime]);
  useEffect(() => {
    clearTimeout(queueTimer.current); if (!loaded || !configuration.settings.configured || working || pinned || referenceLoading) return;
    const candidates = allPages ? [currentPageId, ...slides.filter(slide => slide.id !== currentPageId).map(slide => slide.id)] : [currentPageId];
    const next = candidates.find(id => { const saved = records[summaryRecordKey(scope, id)], eligible = summaryEligible(live, id, slides, false); return eligible && !failed.current.has(summaryRecordKey(scope, id)) && (!saved || live && saved.completed !== true); });
    if (next) queueTimer.current = setTimeout(() => { void generate(next); }, 120);
    return () => clearTimeout(queueTimer.current);
  }, [loaded, configuration.settings.configured, currentPageId, slides, scope, records, allPages, working, pinned, referenceLoading, generate]);
  const changeScope = (value: string) => { savePosition(); cancel(); setScope(value); failed.current.clear(); setPinned(undefined); referenceTarget.current = undefined; setError(''); };
  const turn = (direction: number) => { if (window.getSelection()?.toString()) return; savePosition(); props.onTurn?.(direction); props.onDismissReturn?.(); };
  useEffect(() => { if (live && props.followingLive && ['whole', 'courseAll'].includes(scope)) changeScope('before'); }, [live, props.followingLive, scope]);
  const showing = working === currentPageId ? streaming : record?.answer || '';
  return <section data-study-pane="summary" data-native-selection="true" className="study-pane summary-pane" tabIndex={0} onPointerDown={event => { if (!(event.target as HTMLElement).closest('input,textarea,select,button,a,[contenteditable="true"],[data-select-content],[data-select-block],[data-select-all],[data-selection-gap]')) event.currentTarget.focus({ preventScroll: true }); }} aria-label="本页速览" onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a' && !(event.target as HTMLElement).closest('input,textarea,select')) { event.preventDefault(); event.stopPropagation(); selectElementText(scroll.current?.querySelector('.answer-content') || null); } }}>
    <header className="pane-title"><h2>本页速览</h2>{configuration.settings.configured && <div className="pane-title-tools"><button aria-pressed={allPages} onClick={() => { setAllPages(!allPages); if (allPages && working && working !== currentPageId) cancel(); }}>{allPages ? '✓ ' : ''}所有页面速览</button><select aria-label="速览范围" value={scope} onChange={event => changeScope(event.target.value)}>{scopes.filter(item => !(live && props.followingLive && ['whole', 'courseAll'].includes(item.id))).map(item => <option value={item.id} key={item.id}>{item.label}</option>)}</select></div>}</header>
    {!configuration.checked ? <p className="pane-muted">正在读取设置…</p> : !configuration.settings.configured ? <ApiSettings configured={false} onDone={() => { void configuration.refresh(); }} onRefresh={configuration.refresh} /> : <>
      <div className="summary-page-meta"><span>第 {Math.max(1, slides.findIndex(slide => slide.id === currentPageId) + 1)} 页 · {stamp(currentSlide?.t || 0)}</span><span className="ai-generated">AI 生成</span>{record && <button disabled={!!working} onClick={() => { void generate(currentPageId, true); }}>重新生成</button>}</div>
      <div className="summary-content-wrap"><div ref={scroll} tabIndex={0} className={'pane-scroll summary-body ' + (props.returnVisible ? 'return-padding' : '')} onScroll={() => { clearTimeout(positionTimer.current); positionTimer.current = setTimeout(savePosition, 400); }} onPointerDown={event => { props.onDismissReturn?.(); if (event.pointerType === 'touch') touch.current = { x: event.clientX, y: event.clientY }; if (event.target === event.currentTarget) { event.currentTarget.focus({ preventScroll: true }); window.getSelection()?.removeAllRanges(); } }} onPointerUp={event => { const start = touch.current; touch.current = undefined; if (!start || event.pointerType !== 'touch' || window.getSelection()?.toString()) return; const x = event.clientX - start.x, y = event.clientY - start.y; if (Math.abs(x) > 70 && Math.abs(x) > Math.abs(y) * 1.7) turn(x > 0 ? -1 : 1); }} onWheel={event => { if (Math.abs(event.deltaX) <= Math.abs(event.deltaY) * 1.8 || Math.abs(event.deltaX) < 35 || Date.now() - lastWheel.current < 450 || window.getSelection()?.toString()) return; lastWheel.current = Date.now(); turn(event.deltaX > 0 ? 1 : -1); }}>
        <AnswerContent answer={showing} references={record?.references} onSeek={onSeek} notesOpen={notesOpen} highlight={highlight} onInteraction={props.onDismissReturn} at={currentSlide?.t || 0} reference={{ kind: 'summary', courseId: course.subId, pageId: currentPageId, scope, summaryId: record?.id, at: currentSlide?.t || 0 }} onInsert={value => { if (!record?.id) { props.onNotice?.('本页生成完成后即可插入笔记'); return; } onInsert?.(value); }} />
        {!showing && !working && <p className="pane-muted">{live && currentPageId === slides[slides.length - 1]?.id ? '这一页讲解结束后自动生成，也可以现在生成。' : !slides.length ? '本节课暂无课件，无法生成本页速览。' : '正在准备本页内容…'}</p>}
      </div>{props.returnVisible && <button className="floating-return" onClick={props.onReturn}>回到刚刚</button>}</div>
      {live && currentPageId === slides[slides.length - 1]?.id && <button disabled={!!working} onClick={() => { void generate(currentPageId, true); }}>以本页现有转写与课件生成回答</button>}
      <footer className="summary-footer"><span>{status || scopes.find(item => item.id === scope)?.cost}</span>{working && <button onClick={cancel}>停止</button>}</footer>
    </>}
    {(error || configuration.error) && <p className="pane-error" role="alert">{error || configuration.error}</p>}
  </section>;
}
export default SummaryPane;
