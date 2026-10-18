import {themeFor,themeIcon} from './theme-catalog.js';
// The classroom header states the real day and schedule; the theme only lends its voice.
export function makeClassroomIntro(rows,{el,button,go,page}){
 const t=themeFor(document.documentElement.dataset.theme);
 const now=new Date(),zone={timeZone:'Asia/Shanghai'},stamp=new Intl.DateTimeFormat('zh-CN',{month:'long',day:'numeric',...zone}).format(now)+' '+new Intl.DateTimeFormat('zh-CN',{weekday:'long',...zone}).format(now);
 const count=rows.length,number=el('span',{class:'intro-count',text:String(count)});
 const headline=!count?[page==='all'?'正在整理上课记录':page==='recent'?'近两周没有课程':'今天没有课']:page==='all'?['共 ',number,' 条上课记录']:page==='recent'?['近两周有 ',number,' 节课']:['今天有 ',number,' 节课'];
 return el('section',{class:'classroom-intro','aria-label':'课堂概览'},[
  el('div',{class:'intro-art','aria-hidden':'true'},[el('img',{class:'theme-icon',src:themeIcon(t.id),alt:''})]),
  el('div',{class:'intro-copy'},[
   el('span',{class:'intro-eyebrow',text:stamp}),el('h2',{},headline),el('p',{text:t.subtitle}),
  ]),
  el('div',{class:'intro-index'},[el('strong',{text:String(count).padStart(2,'0')}),el('span',{text:page==='all'?'上课记录':'当前课表'})]),
  el('div',{class:'intro-actions'},[button('打开我的笔记',()=>go('noteManager'),'intro-notes'),button('发现更多课程',()=>go('plaza'),'intro-explore')]),
 ]);
}
export function composeClassroom(wrap,{el}){
 const t=themeFor(document.documentElement.dataset.theme),intro=wrap.querySelector('.classroom-intro');
 wrap.dataset.composition=t.layout;
 const browser=el('section',{class:'classroom-browser','aria-label':'课程列表'});
 for(const child of [...wrap.children])if(child!==intro)browser.append(child);
 wrap.append(browser);
 const cards=browser.querySelectorAll('.course-card');cards.forEach((card,i)=>{card.dataset.ordinal=String(i+1).padStart(2,'0');});
}
