import {themeFor} from './theme-catalog.js';
// The classroom header: view switch on the left, the real schedule summary on the right.
export function makeClassroomIntro(rows,{el,page,tools=[]}){
 const now=Date.now()/1000,live=rows.filter(c=>c.start<=now&&c.end>now).length,count=el('span',{class:'intro-count',text:String(rows.length)});
 // An empty list explains itself below; the header only summarises real lessons.
 const summary=page==='all'||!rows.length?null:[page==='recent'?'近两周 ':'今天 ',count,' 节课',...(live?[el('span',{class:'intro-live',text:live+' 节进行中'})]:[])];
 return el('section',{class:'classroom-intro','aria-label':'课堂概览'},[
  el('div',{class:'intro-tools'},tools.filter(Boolean)),
  summary?el('div',{class:'intro-copy'},[el('h2',{},summary)]):null,
 ]);
}
export function composeClassroom(wrap,{el}){
 const t=themeFor(document.documentElement.dataset.theme),intro=wrap.querySelector('.classroom-intro');
 wrap.dataset.composition=t.layout;
 const browser=el('section',{class:'classroom-browser','aria-label':'课程列表'});
 for(const child of [...wrap.children])if(child!==intro)browser.append(child);
 wrap.append(browser);
}
