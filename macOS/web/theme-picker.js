import {makeIcon} from './theme-icons.js';
import {THEMES,themeFor} from './theme-catalog.js';
export function mountThemePicker(doc=document,choose=theme=>window.native.call('setAppearanceTheme',{theme}),initial=document.documentElement.dataset.theme,onConfirm=()=>{}){
 const grid=doc.getElementById('themeGrid'),status=doc.getElementById('selectedTheme');
 const buttons=[];let lastClicked=null,confirming=false,revision=0;const pending=new Map();
 function preview(theme){if(pending.has(theme))return pending.get(theme);const request=++revision;const operation=Promise.resolve().then(()=>choose(theme)).then(value=>{if(typeof value==='string'&&request===revision)selected(value);return value}).finally(()=>pending.delete(theme));pending.set(theme,operation);return operation;}
 async function chooseCard(theme){const confirm=lastClicked===theme;lastClicked=theme;if(confirming)return;try{if(confirm)confirming=true;const chosen=await preview(theme);if(confirm&&chosen===theme)await onConfirm(theme)}catch(error){status.textContent=error.message||'主题切换失败，请重试'}finally{confirming=false}}
 for(const theme of THEMES){
  const button=doc.createElement('button');button.type='button';button.className='theme-choice';button.dataset.theme=theme.id;button.setAttribute('aria-label',theme.name);button.setAttribute('aria-pressed','false');
  const image=doc.createElement('img');image.src='theme-previews/'+theme.id+'.png';image.alt=theme.name+' · 实际首页预览';image.width=1200;image.height=820;image.loading='lazy';
  const info=doc.createElement('span');info.className='choice-info';const copy=doc.createElement('span');const name=doc.createElement('span');name.className='choice-name';name.textContent=theme.name;const tag=doc.createElement('span');tag.className='choice-tag';tag.textContent=theme.tag;copy.append(name,tag);
  const mark=doc.createElement('span');mark.className='selected-mark';mark.append(makeIcon('check',doc));mark.setAttribute('aria-hidden','true');info.append(copy,mark);button.append(image,info);
  // The native callback is authoritative; failed/cancelled delivery does not mark a theme selected.
  button.addEventListener('click',()=>{void chooseCard(theme.id)});grid.append(button);buttons.push(button);
 }
 function selected(value){const theme=themeFor(value);buttons.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.theme===theme.id)));status.textContent='当前 · '+theme.name;return theme.id;}
 selected(initial||window.__zhiyunTheme);return{selected,buttons};
}
