import {refreshThemeIcons} from './theme-icons.js';
import {themeFor,themeIcon,APPEARANCE_MODES} from './theme-catalog.js';
// Keep the palette while giving small controls and secondary copy readable contrast.
function rgb(hex){return hex.slice(1).match(/../g).map(n=>parseInt(n,16));}
function luminance(color){return rgb(color).map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4}).reduce((v,n,i)=>v+n*[.2126,.7152,.0722][i],0);}
function contrast(a,b){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
function readable(color,background,toward){const a=rgb(color),b=rgb(toward);for(let step=0;step<=20;step++){const mix='#'+a.map((n,i)=>Math.round(n+(b[i]-n)*step/20).toString(16).padStart(2,'0')).join('');if(contrast(mix,background)>=4.5)return mix;}return toward;}
const tokens=['brand','bg','paper','ink','dim','line','tint','second'];
const modes=APPEARANCE_MODES.map(([value])=>value);
let mode=modes.includes(window.__zhiyunMode)?window.__zhiyunMode:'system';
const scheme=window.matchMedia?.('(prefers-color-scheme: dark)');
export function appearanceMode(){return mode;}
export function prefersDark(){return mode==='dark'||(mode==='system'&&!!scheme?.matches);}
export function applyAppearanceTheme(value){
 const theme=themeFor(value),root=document.documentElement,dark=prefersDark(),palette=dark?{...theme,...theme.dark}:theme;
 // Colours switch at once: hover transitions must not animate (or, in a hidden window, freeze) the old theme.
 root.dataset.themeSwitching='';
 root.dataset.theme=theme.id;root.dataset.themeLayout=theme.layout;root.dataset.themeNav=theme.nav;root.dataset.mode=dark?'dark':'light';root.dataset.appearance=mode;root.dataset.font=theme.font;
 for(const key of tokens)root.style.setProperty('--theme-'+key,palette[key]);
 const dim=readable(palette.dim,palette.paper,palette.ink),accent=readable(palette.brand,palette.tint,palette.ink),action=readable(palette.brand,'#ffffff','#000000');
 root.style.setProperty('--theme-dim',dim);root.style.setProperty('--accent-text',accent);root.style.setProperty('--action-bg',action);
 root.style.setProperty('--theme-radius',theme.radius+'px');
 // Preserve existing player/editor nodes and selections while updating presentation.
 root.style.setProperty('--blue',palette.brand);root.style.setProperty('--bg',palette.bg);root.style.setProperty('--paper',palette.paper);root.style.setProperty('--ink',palette.ink);root.style.setProperty('--muted',dim);root.style.setProperty('--line',palette.line);root.style.setProperty('--soft',palette.tint);
 document.querySelectorAll('.welcome img,.theme-icon').forEach(img=>img.setAttribute('src',themeIcon(theme.id)));
 refreshThemeIcons();
 void document.body?.offsetHeight;delete root.dataset.themeSwitching;
 return theme.id;
}
// The native title bar adopts the window canvas (behind the sidebar and content sheet) and the chosen appearance.
let chrome='';
function opaque(css,under){const m=/rgba?\(([^)]+)\)/.exec(css||'');if(!m)return under;const [r,g,b,a=1]=m[1].split(/[\s,\/]+/).filter(Boolean).map(Number),base=rgb(under);return'#'+[r,g,b].map((n,i)=>Math.round(n*a+base[i]*(1-a)).toString(16).padStart(2,'0')).join('');}
export function syncWindowChrome(){
 const root=document.documentElement,theme=themeFor(root.dataset.theme),canvas=prefersDark()?theme.dark.bg:theme.bg,top=document.getElementById('app');
 const color=top?opaque(window.getComputedStyle(top).backgroundColor,canvas):canvas,key=color+mode;
 if(key===chrome)return;chrome=key;Promise.resolve(window.native.call('windowChrome',{color,mode})).catch(()=>{chrome='';});
}
export function applyAppearanceMode(value){
 if(!modes.includes(value))return mode;
 mode=value;applyAppearanceTheme(document.documentElement.dataset.theme);syncWindowChrome();return mode;
}
applyAppearanceTheme(window.__zhiyunTheme);
window.native.on('appearanceTheme',value=>{applyAppearanceTheme(value);syncWindowChrome();});
window.native.on('appearanceMode',applyAppearanceMode);
// Following macOS: re-render immediately when the system switches between light and dark.
scheme?.addEventListener?.('change',()=>{if(mode==='system'){applyAppearanceTheme(document.documentElement.dataset.theme);syncWindowChrome();}});
new window.MutationObserver(records=>{if(!records.some(r=>r.addedNodes.length))return;const src=themeIcon(document.documentElement.dataset.theme);document.querySelectorAll('.welcome img,.theme-icon').forEach(img=>{if(img.getAttribute('src')!==src)img.setAttribute('src',src);});}).observe(document.body,{childList:true,subtree:true});
