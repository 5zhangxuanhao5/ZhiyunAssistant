const test=require('node:test'),assert=require('node:assert/strict');
const {runtime}=require('./runtime-helper.cjs');
test('theme switches preserve editor nodes, content and media and reject unknown IDs',async()=>{
 const r=runtime(),api=await r.load('themes.js'),d=r.win.document;
 const editor=d.createElement('div');editor.contentEditable='true';editor.textContent='尚未保存的课堂笔记';d.body.append(editor);
 const video=d.createElement('video');d.body.append(video);
 const welcome=d.createElement('div');welcome.className='welcome';welcome.innerHTML='<img src="icon.png">';d.body.append(welcome);
 assert.equal(api.applyAppearanceTheme('playful'),'playful');assert.equal(d.documentElement.dataset.theme,'playful');
 assert.equal(welcome.querySelector('img').getAttribute('src'),'theme-playful.png');
 assert.equal(d.querySelector('video'),video);assert.equal(editor.textContent,'尚未保存的课堂笔记');assert.equal(editor.isConnected,true);
 api.applyAppearanceTheme('collage');assert.equal(welcome.querySelector('img').getAttribute('src'),'theme-collage.png');
 assert.equal(api.applyAppearanceTheme('../bad'),'collage');r.win.close();
});
test('restored theme applies before late login screen mounts',async()=>{
 const r=runtime();r.win.__zhiyunTheme='playful';await r.load('themes.js');
 const welcome=r.win.document.createElement('div');welcome.className='welcome';welcome.innerHTML='<img src="icon.png">';r.win.document.body.append(welcome);
 await new Promise(resolve=>setTimeout(resolve,0));assert.equal(welcome.querySelector('img').getAttribute('src'),'theme-playful.png');r.win.close();
});
test('three colour schemes have distinct identifiers, installed icons and light and dark palettes',async()=>{
 const r=runtime(),{THEMES,themeFor,themeIcon}=await r.load('theme-catalog.js'),fs=require('node:fs'),path=require('node:path');
 assert.equal(THEMES.map(t=>t.id).join(),'collage,playful,film');assert.equal(new Set(THEMES.map(t=>t.layout)).size,3);
 for(const t of THEMES){for(const palette of [t,t.dark])for(const key of ['brand','bg','paper','ink','dim','line','tint','second'])assert.match(palette[key],/^#[0-9a-f]{6}$/i,t.id+' '+key);assert.ok(fs.existsSync(path.join(__dirname,'../web',themeIcon(t.id))));assert.ok(fs.existsSync(path.join(__dirname,'../web/theme-previews',t.id+'.png')));assert.equal(themeFor(t.id).name,t.name);}
 assert.equal(themeFor('editorial').id,'playful');assert.equal(themeFor('../invalid').id,'collage');r.win.close();
});
test('retired theme identifiers map to the closest colour scheme',async()=>{
 const r=runtime(),{themeFor}=await r.load('theme-catalog.js');
 for(const [old,now] of [['swiss','collage'],['terminal','collage'],['glass','collage'],['candy','playful'],['retro','playful'],['gallery','playful'],['field','film'],['marginalia','film'],['racing','film']])assert.equal(themeFor(old).id,now,old);r.win.close();
});
test('appearance mode switches palettes in place and follows the system when asked',async()=>{
 const r=runtime();let dark=false;const listeners=new Set();r.win.matchMedia=()=>({get matches(){return dark},addEventListener:(_,fn)=>listeners.add(fn)});r.win.__zhiyunMode='system';
 const api=await r.load('themes.js'),root=r.win.document.documentElement,editor=r.win.document.createElement('div');editor.contentEditable='true';r.win.document.body.append(editor);
 assert.equal(root.dataset.mode,'light');assert.equal(root.style.getPropertyValue('--theme-bg'),'#f4f5f7');
 dark=true;listeners.forEach(fn=>fn());assert.equal(root.dataset.mode,'dark');assert.equal(root.style.getPropertyValue('--theme-bg'),'#15171b');
 assert.equal(api.applyAppearanceMode('light'),'light');assert.equal(root.dataset.mode,'light');assert.equal(root.dataset.appearance,'light');
 assert.equal(api.applyAppearanceMode('dark'),'dark');api.applyAppearanceTheme('film');assert.equal(root.style.getPropertyValue('--theme-paper'),'#24201c');
 assert.equal(api.applyAppearanceMode('neon'),'dark');assert.equal(editor.isConnected,true);
 const chrome=r.calls.filter(([a])=>a==='windowChrome').at(-1)[1];assert.match(chrome.color,/^#[0-9a-f]{6}$/);assert.equal(chrome.mode,'dark');r.win.close();
});
test('thumbnail selection waits for native confirmation and supports every colour scheme',async()=>{
 const r=runtime(),d=r.win.document;d.body.innerHTML='<div id="selectedTheme"></div><main id="themeGrid"></main>';
 const selected=[];const {mountThemePicker}=await r.load('theme-picker.js');
 const picker=mountThemePicker(d,async theme=>{selected.push(theme);return theme});
 const buttons=[...d.querySelectorAll('.theme-choice')];assert.equal(buttons.length,3);
 assert.equal(buttons.filter(b=>b.getAttribute('aria-pressed')==='true').length,1);
 for(const b of buttons){b.click();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(selected.at(-1),b.dataset.theme);assert.equal(b.getAttribute('aria-pressed'),'true');assert.equal(buttons.filter(n=>n.getAttribute('aria-pressed')==='true').length,1);assert.match(b.querySelector('img').getAttribute('src'),/^theme-previews\/[a-z]+\.png$/);}
 r.win.close();
});
test('switching every theme rebuilds only the actual homepage and does not refetch or replace live study editors',async t=>{
 const r=runtime(),listeners=new Map(),original=r.win.native.on.bind(r.win.native);r.win.native.on=(name,fn)=>{if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(fn);return original(name,fn)};
 const app=(await r.load('app.js')).testing,{THEMES}=await r.load('theme-catalog.js');app.setup();t.after(()=>{app.cleanup();r.win.close()});
 await app.go('recent');await new Promise(resolve=>setTimeout(resolve,25));const before=r.calls.filter(([a])=>a==='request').length;
 for(const theme of THEMES){for(const fn of listeners.get('appearanceTheme'))fn(theme.id);assert.equal(r.win.document.documentElement.dataset.theme,theme.id);assert.equal(r.win.document.querySelector('.classroom-page').dataset.composition,theme.layout);assert.equal(r.win.document.querySelectorAll('.classroom-page .course-card').length,1);assert.equal(app.state().page,'recent');}
 await new Promise(resolve=>setTimeout(resolve,10));assert.equal(r.calls.filter(([a])=>a==='request').length,before);
 await app.enter(r.current);app.togglePane('notes');const editor=r.win.document.querySelector('.notes-editor'),panes=[...r.win.document.querySelectorAll('#stage .pane')];assert.ok(editor);
 for(const theme of THEMES){for(const fn of listeners.get('appearanceTheme'))fn(theme.id);assert.equal(r.win.document.querySelector('.notes-editor'),editor);assert.ok(panes.every(p=>p.isConnected));assert.equal(app.state().page,'study');}
});

test('theme page is a normal in-window route and vectors replace calendar and collection glyphs',async t=>{const r=runtime({extraTestingNames:['calendar']}),app=(await r.load('app.js')).testing;app.setup();t.after(()=>{app.cleanup();r.win.close()});await app.go('themes');assert.equal(app.state().page,'themes');assert.equal(r.win.document.querySelectorAll('.theme-choice').length,3);assert.equal(r.win.document.querySelectorAll('.appearance-modes [role=radio]').length,3);assert.equal(r.calls.some(([a])=>a==='login'),false);await app.back();app.calendar([r.current],()=>{});for(const label of ['上一年','上个月','下个月','下一年']){const n=r.win.document.querySelector('[aria-label="'+label+'"]');assert.ok(n?.querySelector('svg'));assert.ok(!/[‹›≪≫]/.test(n.textContent))}assert.equal(r.win.document.querySelector('.calendar-grid .week').textContent,'一');const {applyAppearanceTheme}=await r.load('themes.js');const icon=r.win.document.querySelector('[data-ui-icon=previous]'),before=icon.innerHTML;applyAppearanceTheme('playful');assert.notEqual(icon.innerHTML,before);assert.equal(icon.dataset.iconTheme,'playful');await new Promise(resolve=>setTimeout(resolve,30))});

test('signed-out theme route exposes a return path and restores the login page',async t=>{const r=runtime(),app=(await r.load('app.js')).testing;t.after(()=>{app.cleanup();r.win.close()});await app.go('themes');assert.equal(r.win.document.body.dataset.page,'themes');assert.equal(r.win.document.querySelectorAll('.theme-choice').length,3);await app.back();assert.ok(r.win.document.querySelector('.welcome'));assert.notEqual(r.win.document.body.dataset.page,'themes');await new Promise(resolve=>setTimeout(resolve,15))});

test('two clicks on one theme confirm only after native selection succeeds and return once',async t=>{const r=runtime(),d=r.win.document;d.body.innerHTML='<div id="selectedTheme"></div><div id="themeGrid"></div>';t.after(()=>r.win.close());const{mountThemePicker}=await r.load('theme-picker.js');let resolve,requests=0,returns=0;const waiting=new Promise(done=>resolve=done);mountThemePicker(d,()=>{requests++;return waiting},'collage',()=>returns++);const card=d.querySelector('.theme-choice[data-theme=film]');card.click();card.click();await Promise.resolve();assert.equal(returns,0);resolve('film');await new Promise(done=>setTimeout(done,0));assert.equal(requests,1);assert.equal(returns,1);assert.equal(card.getAttribute('aria-pressed'),'true')});
test('different preview choices and failed confirmations never exit the theme page',async t=>{const r=runtime(),d=r.win.document;d.body.innerHTML='<div id="selectedTheme"></div><div id="themeGrid"></div>';t.after(()=>r.win.close());const{mountThemePicker}=await r.load('theme-picker.js');let returns=0;mountThemePicker(d,async()=>{throw new Error('暂时无法切换')},'collage',()=>returns++);d.querySelector('.theme-choice[data-theme=film]').click();d.querySelector('.theme-choice[data-theme=playful]').click();d.querySelector('.theme-choice[data-theme=playful]').click();await new Promise(done=>setTimeout(done,0));assert.equal(returns,0);assert.match(d.querySelector('#selectedTheme').textContent,/暂时无法切换/)});
