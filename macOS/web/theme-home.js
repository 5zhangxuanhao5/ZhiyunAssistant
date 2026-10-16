import {themeFor,themeIcon} from './theme-catalog.js';
export function makeClassroomIntro(rows,{el,button,go,page}){
 const t=themeFor(document.documentElement.dataset.theme);
 const headlines={press:'学习，\n也要有\n自己的\n观点。'};
 const stamp=new Intl.DateTimeFormat('zh-CN',{month:'long',day:'numeric',weekday:'long',timeZone:'Asia/Shanghai'}).format(new Date());
 return el('section',{class:'classroom-intro','aria-label':'课堂概览'},[
  el('div',{class:'intro-copy'},[
   el('span',{class:'intro-eyebrow',text:t.eyebrow}),el('h2',{text:headlines[t.id]||t.title}),el('p',{text:t.subtitle}),
   el('div',{class:'intro-actions'},[button('打开我的笔记',()=>go('noteManager'),'intro-notes'),button('发现更多课程',()=>go('plaza'),'intro-explore')]),
   el('span',{class:'intro-date',text:stamp}),
  ]),
  el('div',{class:'intro-art','aria-hidden':'true'},[el('span',{class:'paper-back'}),el('span',{class:'orbit orbit-one'}),el('span',{class:'orbit orbit-two'}),el('img',{class:'theme-icon',src:themeIcon(t.id),alt:''}),el('span',{class:'paper-label',text:t.eyebrow.split('/')[0]})]),
  el('div',{class:'intro-index'},[el('strong',{text:String(rows.length).padStart(2,'0')}),el('span',{text:page==='all'?'上课记录':'当前课表'})]),
 ]);
}
export function composeClassroom(wrap,{el,button,go}){
 const t=themeFor(document.documentElement.dataset.theme),intro=wrap.querySelector('.classroom-intro');
 wrap.dataset.composition=t.layout;
 const browser=el('section',{class:'classroom-browser','aria-label':'课程列表'});
 for(const child of [...wrap.children])if(child!==intro)browser.append(child);
 wrap.append(browser);
 if(intro && ['bauhaus','book','metro'].includes(t.layout)){
  wrap.append(el('aside',{class:'classroom-side-note'},[
   el('span',{class:'side-note-label',text:t.name}),el('div',{class:'side-note-art','aria-hidden':'true'}),el('h3',{text:({bauhaus:'形式，\n跟随理解。',marginalia:'读完之后，\n在页边写下\n自己的话。',metro:'一条笔记，\n连接不同课堂\n的想法。'})[t.id]||t.quote}),
   button('打开笔记',()=>go('noteManager'),'side-note-action'),
  ]));
 }
 const cards=browser.querySelectorAll('.course-card');cards.forEach((card,i)=>{card.dataset.ordinal=String(i+1).padStart(2,'0');});
}
