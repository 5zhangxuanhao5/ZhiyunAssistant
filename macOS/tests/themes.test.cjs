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
