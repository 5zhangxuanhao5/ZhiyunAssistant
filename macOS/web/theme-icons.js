// One semantic icon vocabulary, with geometry and finish selected by the theme.
const paths = {
 crop:'M7 3v14h14M3 7h14v14',
 duplicates:'M8 3h13v13H8Z M3 8v13h13M12 7h5m-5 4h5',
 skip:'m4 5 8 7-8 7Z M16 5v14M21 5v14',
 smartSkip:'M4 6h7m-7 6h5m-5 6h7M17 3l1.5 5L23 10l-4.5 2-1.5 5-1.5-5L11 10l4.5-2Z',
 follow:'M12 3v18m-5-5 5 5 5-5M5 3h14',
 overview:'M3 3h7v7H3Z M14 3h7v7h-7Z M3 14h7v7H3Z M14 14h7v7h-7Z',
 time:'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
 page:'M5 3h10l4 4v14H5Z M14 3v5h5M9 12h6m-6 4h6',
 download:'M12 3v12m-4-4 4 4 4-4M4 17v4h16v-4',
 notes:'M5 3h14v18H5Z M9 7h6m-6 5h6m-6 5h4',
 home:'M3 10.5 12 3l9 7.5V21H3Z M9 21v-7h6v7',
 favourite:'m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z',
 later:'M12 7v5l3 2 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
 offline:'M12 3v12m-4-4 4 4 4-4 M4 16v5h16v-5',
 noteManager:'M5 3h11l3 3v15H5Z M9 10h6m-6 4h6m-6 4h4',
 cache:'M4 7h16v14H4Z M3 3h18v4H3Z M9 11h6',
 plaza:'M3 3h7v7H3Z M14 3h7v7h-7Z M3 14h7v7H3Z M14 14h7v7h-7Z',
 book:'M12 5C8 2 4 3 2 4v15c4-2 7-1 10 1 3-2 6-3 10-1V4c-2-1-6-2-10 1Zm0 0v15',
 themes:'M3 5h8v8H3Z M15 3h6v6h-6Z M15 13h6v8h-6Z M3 17h8v4H3Z',
 calendar:'M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z M7 3v4m10-4v4M3 10h18M7 14h3m4 0h3m-10 3h3',
 previous:'m14.5 6-6 6 6 6', next:'m9.5 6 6 6-6 6',
 previousYear:'m12 6-6 6 6 6m6-12-6 6 6 6', nextYear:'m6 6 6 6-6 6m6-12 6 6-6 6',
 close:'m6 6 12 12M18 6 6 18',
 refresh:'M20 8a8.5 8.5 0 1 0 .2 7M20 3v5h-5',
 back:'M20 12H4m6-6-6 6 6 6',
 export:'M12 15V3m-4 4 4-4 4 4M4 14v7h16v-7',
 layout:'M3 4h18v16H3Z M11 4v16m0-8h10',
 slides:'M3 4h18v15H3Z M7 15l4-5 3 3 2-2 3 4M7 8h.1',
 transcript:'M4 5h16M4 10h12M4 15h16M4 20h9',
 video:'M3 6h12v12H3Z m12 4 6-3v10l-6-3',
 question:'M4 4h16v13H9l-5 4Z M8 9h8m-8 4h5',
 summary:'M5 3h14v18H5Z M9 7h6m-6 5h6m-6 5h4',
 search:'M16 16l5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
 grip:'M6 7h12M6 12h12M6 17h12', check:'m5 12 4 4L19 6',
 alignLeft:'M4 5h16M4 10h11M4 15h16M4 20h11',alignCenter:'M4 5h16M7 10h10M4 15h16M7 20h10',alignRight:'M4 5h16M9 10h11M4 15h16M9 20h11',
 plus:'M12 5v14M5 12h14',minus:'M5 12h14',
 pause:'M8 5v14M16 5v14', play:'m7 4 13 8-13 8Z',
};
const profiles = {
 collage:['paper',1.65,'round'], playful:['soft',1.8,'round'], press:['editorial',1.5,'square'],
 acid:['signal',1.8,'square'], bauhaus:['geometry',2,'square'], candy:['soft',1.9,'round'],
 terminal:['technical',1.35,'square'], swiss:['geometry',2.1,'square'], field:['organic',1.65,'round'],
 film:['editorial',1.5,'round'], workshop:['technical',1.6,'square'], post:['paper',1.5,'round'],
 memphis:['geometry',2,'round'], retro:['pixel',1.4,'square'], glass:['soft',1.3,'round'],
 marginalia:['editorial',1.25,'round'], metro:['signal',2.2,'round'], sketch:['organic',1.9,'round'],
 racing:['signal',2.2,'square'], gallery:['editorial',1.2,'square'],
};
const calendars = {
 paper:'M4 6h16v15H4Z M7 3v6m10-6v6M4 11h16M8 15h2m4 0h2m-8 3h2',
 soft:'M6 5h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3Z M8 3v5m8-5v5M3 11h18m-13 4h2m4 0h2',
 editorial:'M4 5h16v16H4Z M7 2v6m10-6v6M4 10h16m-12 4h3m3 0h2m-8 3h3',
 signal:'M3 6h18v15H3Z M7 3v6m10-6v6M3 11h18M7 15h3v3H7Z m7 0h3v3h-3Z',
 geometry:'M3 6h18v15H3Z M7 3v6m10-6v6M3 11h18M7 15h3m4 0h3m-10 3h3m4 0h3',
 technical:'M3 5h18v16H3Z M7 2v6m10-6v6M3 10h18M8 14v4m4-4v4m4-4v4M6 16h12',
 organic:'M4 6 20 5l1 15-17 1Z M7 3l.5 6m9.5-6v6M4 11l16-1M8 15l3-.2m3-.1 2 .1m-8 3 3-.1',
 pixel:'M5 5h14v2h2v12h-2v2H5v-2H3V7h2Z M7 3v6m10-6v6M3 11h18M7 15h3m4 0h3m-10 3h3',
};
function geometry(name, theme) {
 const [family,width,cap]=profiles[theme]||profiles.collage;
 let d=paths[name]||paths.book;
 if(name==='calendar')d=calendars[family];
 if(['previous','next','previousYear','nextYear'].includes(name)) {
  const right=name.startsWith('next'),double=name.endsWith('Year');
  if(family==='technical'||family==='signal')d=(right?'M4 12h15m-5-6 6 6-6 6':'M20 12H5m5-6-6 6 6 6')+(double?(right?'M22 6v12':'M2 6v12'):'');
  if(family==='pixel')d=(right?'M8 5v3h3v3h3v2h-3v3H8v3':'M16 5v3h-3v3h-3v2h3v3h3v3')+(double?(right?'M19 5v14':'M5 5v14'):'');
  if(family==='organic')d=right?'m9 5 7 6.5L10 19':'m15 5-7 7 6.5 7';
  if(double&&family==='organic')d+=right?'M19 5v14':'M5 5v14';
 }
 return{family,width,cap,d};
}
export function refreshThemeIcons(root=document) {
 const theme=document.documentElement.dataset.theme||'collage';
 root.querySelectorAll('[data-ui-icon]').forEach(node=>{
  if(node.dataset.iconTheme===theme)return;
  const g=geometry(node.dataset.uiIcon,theme);node.dataset.iconTheme=theme;node.dataset.iconFamily=g.family;
  node.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="'+g.width+'" stroke-linecap="'+g.cap+'" stroke-linejoin="'+(g.cap==='round'?'round':'miter')+'" aria-hidden="true"><path d="'+g.d+'"/></svg>';
 });
}
export function makeIcon(name, doc=document) {
 const node=doc.createElement('span');node.className='design-icon ui-icon';node.dataset.uiIcon=name;node.setAttribute('aria-hidden','true');
 const host=doc.createElement('div');host.append(node);refreshThemeIcons(host);return node;
}
const actions={'刷新':'refresh','批量下载':'offline','选择日期':'calendar','返回':'back','返回课堂':'back','导出':'export','下载课程':'offline','布局':'layout','概览':'slides','跳转时间':'later','跳转页数':'book','发送':'export','功能':'layout','打开我的笔记':'noteManager','发现更多课程':'plaza','管理':'layout'};
export function decorateAction(button, label=button.textContent) {
 const name=actions[label]||(/^\d{4}-\d{2}-\d{2}$/.test(label)?"calendar":null);if(name&&!button.querySelector('.ui-icon'))button.prepend(makeIcon(name));return button;
}
