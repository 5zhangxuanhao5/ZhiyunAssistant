import {refreshThemeIcons} from './theme-icons.js';
import {themeFor,themeIcon} from './theme-catalog.js';
const tokens=['brand','bg','paper','ink','dim','line','tint','second'];
export function applyAppearanceTheme(value){
 const theme=themeFor(value),root=document.documentElement;
 root.dataset.theme=theme.id;root.dataset.themeLayout=theme.layout;root.dataset.themeNav=theme.nav;
 for(const key of tokens)root.style.setProperty('--theme-'+key,theme[key]);
 root.style.setProperty('--theme-radius',theme.radius+'px');
 // Preserve existing player/editor nodes and selections while updating presentation.
 root.style.setProperty('--blue',theme.brand);root.style.setProperty('--bg',theme.bg);root.style.setProperty('--paper',theme.paper);root.style.setProperty('--ink',theme.ink);root.style.setProperty('--muted',theme.dim);root.style.setProperty('--line',theme.line);root.style.setProperty('--soft',theme.tint);
 document.querySelectorAll('.welcome img,.theme-icon').forEach(img=>img.setAttribute('src',themeIcon(theme.id)));
 refreshThemeIcons();
 return theme.id;
}
applyAppearanceTheme(window.__zhiyunTheme);
window.native.on('appearanceTheme',applyAppearanceTheme);
new window.MutationObserver(records=>{if(!records.some(r=>r.addedNodes.length))return;const src=themeIcon(document.documentElement.dataset.theme);document.querySelectorAll('.welcome img,.theme-icon').forEach(img=>{if(img.getAttribute('src')!==src)img.setAttribute('src',src);});}).observe(document.body,{childList:true,subtree:true});
