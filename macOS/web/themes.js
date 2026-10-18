import {refreshThemeIcons} from './theme-icons.js';
import {themeFor,themeIcon} from './theme-catalog.js';
// Keep the palette while giving small controls and secondary copy readable contrast.
function rgb(hex){return hex.slice(1).match(/../g).map(n=>parseInt(n,16));}
function luminance(color){return rgb(color).map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4}).reduce((v,n,i)=>v+n*[.2126,.7152,.0722][i],0);}
function contrast(a,b){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
function readable(color,background,ink){const a=rgb(color),b=rgb(ink);for(let step=0;step<=20;step++){const mix='#'+a.map((n,i)=>Math.round(n+(b[i]-n)*step/20).toString(16).padStart(2,'0')).join('');if(contrast(mix,background)>=4.5)return mix;}return ink;}
const tokens=['brand','bg','paper','ink','dim','line','tint','second'];
export function applyAppearanceTheme(value){
 const theme=themeFor(value),root=document.documentElement;
 // Colours switch at once: hover transitions must not animate (or, in a hidden window, freeze) the old theme.
 root.dataset.themeSwitching='';
 root.dataset.theme=theme.id;root.dataset.themeLayout=theme.layout;root.dataset.themeNav=theme.nav;
 for(const key of tokens)root.style.setProperty('--theme-'+key,theme[key]);
 const dim=readable(theme.dim,theme.paper,theme.ink),accent=readable(theme.brand,theme.tint,theme.ink),action=readable(theme.brand,'#ffffff',theme.ink);
 root.style.setProperty('--theme-dim',dim);root.style.setProperty('--accent-text',accent);root.style.setProperty('--action-bg',action);
 root.style.setProperty('--theme-radius',theme.radius+'px');
 // Preserve existing player/editor nodes and selections while updating presentation.
 root.style.setProperty('--blue',theme.brand);root.style.setProperty('--bg',theme.bg);root.style.setProperty('--paper',theme.paper);root.style.setProperty('--ink',theme.ink);root.style.setProperty('--muted',dim);root.style.setProperty('--line',theme.line);root.style.setProperty('--soft',theme.tint);
 document.querySelectorAll('.welcome img,.theme-icon').forEach(img=>img.setAttribute('src',themeIcon(theme.id)));
 refreshThemeIcons();
 void document.body?.offsetHeight;delete root.dataset.themeSwitching;
 return theme.id;
}
// The native title bar adopts the colour at the top of the page (navigation bar or window canvas).
let chrome='';
function opaque(css,under){const m=/rgba?\(([^)]+)\)/.exec(css||'');if(!m)return under;const [r,g,b,a=1]=m[1].split(/[\s,\/]+/).filter(Boolean).map(Number),base=rgb(under);return'#'+[r,g,b].map((n,i)=>Math.round(n*a+base[i]*(1-a)).toString(16).padStart(2,'0')).join('');}
export function syncWindowChrome(){
 const root=document.documentElement,theme=themeFor(root.dataset.theme),nav=document.getElementById('navigation'),body=document.body;
 const top=body&&nav&&body.classList.contains('logged-in')&&!body.classList.contains('study-mode')&&root.dataset.themeNav==='top'?nav:document.querySelector('main');
 const color=top?opaque(window.getComputedStyle(top).backgroundColor,theme.bg):theme.bg;
 if(color===chrome)return;chrome=color;Promise.resolve(window.native.call('windowChrome',{color})).catch(()=>{chrome='';});
}
applyAppearanceTheme(window.__zhiyunTheme);
window.native.on('appearanceTheme',value=>{applyAppearanceTheme(value);syncWindowChrome();});
new window.MutationObserver(records=>{if(!records.some(r=>r.addedNodes.length))return;const src=themeIcon(document.documentElement.dataset.theme);document.querySelectorAll('.welcome img,.theme-icon').forEach(img=>{if(img.getAttribute('src')!==src)img.setAttribute('src',src);});}).observe(document.body,{childList:true,subtree:true});
