import Cocoa
import WebKit
import Network
import AVFoundation

func smokeWait(_ condition:()->Bool,seconds:Double=20)throws{
    let deadline=Date().addingTimeInterval(seconds)
    while !condition(),Date()<deadline{RunLoop.current.run(until:Date().addingTimeInterval(0.01))}
    guard condition() else{throw appError("WebKit app smoke test timed out")}
}
func smokeEvaluate(_ view:WKWebView,_ source:String)throws->Any?{
    var finished=false,result:Any?,failure:Error?
    view.evaluateJavaScript(source){value,error in result=value;failure=error;finished=true}
    try smokeWait({finished});if let failure=failure{throw failure};return result
}
func createSmokeVideo(_ path:URL)throws{
    let writer=try AVAssetWriter(outputURL:path,fileType:.mp4)
    let input=AVAssetWriterInput(mediaType:.video,outputSettings:[AVVideoCodecKey:AVVideoCodecType.h264,AVVideoWidthKey:320,AVVideoHeightKey:180])
    let adaptor=AVAssetWriterInputPixelBufferAdaptor(assetWriterInput:input,sourcePixelBufferAttributes:[kCVPixelBufferPixelFormatTypeKey as String:kCVPixelFormatType_32ARGB,kCVPixelBufferWidthKey as String:320,kCVPixelBufferHeightKey as String:180])
    writer.add(input);guard writer.startWriting() else{throw writer.error ?? appError("Synthetic video writer failed")};writer.startSession(atSourceTime:.zero)
    for (index,time) in [0,15,30,59].enumerated(){
        try smokeWait({input.isReadyForMoreMediaData || writer.status == .failed});if writer.status == .failed{throw writer.error ?? appError("Synthetic video encoding failed")}
        var output:CVPixelBuffer?;guard CVPixelBufferCreate(kCFAllocatorDefault,320,180,kCVPixelFormatType_32ARGB,nil,&output)==kCVReturnSuccess,let buffer=output else{throw appError("Synthetic video frame allocation failed")}
        CVPixelBufferLockBaseAddress(buffer,[]);if let data=CVPixelBufferGetBaseAddress(buffer){let count=CVPixelBufferGetBytesPerRow(buffer)*180;memset(data,Int32(80+index*30),count)};CVPixelBufferUnlockBaseAddress(buffer,[])
        guard adaptor.append(buffer,withPresentationTime:CMTime(seconds:Double(time),preferredTimescale:600)) else{throw writer.error ?? appError("Synthetic video append failed")}
    }
    input.markAsFinished();writer.finishWriting{};try smokeWait({writer.status == .completed || writer.status == .failed});if writer.status != .completed{throw writer.error ?? appError("Synthetic video finish failed")}
}
final class SmokeServer {
    let app:App,root:URL,video:URL,bridge:String
    let queue=DispatchQueue(label:"cn.suike.mac.webkit-smoke")
    var listener:NWListener!,origin=""
    init(app:App,root:URL,video:URL,bridge:String){self.app=app;self.root=root;self.video=video;self.bridge=bridge}
    func start(_ ready:@escaping()->Void)throws{
        let parameters=NWParameters.tcp;parameters.requiredLocalEndpoint = .hostPort(host:"127.0.0.1",port:.any);listener=try NWListener(using:parameters)
        listener.stateUpdateHandler={state in if case .ready=state,let port=self.listener.port{self.origin="http://127.0.0.1:"+String(port.rawValue);DispatchQueue.main.async(execute:ready)}}
        listener.newConnectionHandler={connection in connection.start(queue:self.queue);self.read(connection,Data())};listener.start(queue:queue)
    }
    func read(_ connection:NWConnection,_ previous:Data){connection.receive(minimumIncompleteLength:1,maximumLength:65536){data,_,complete,error in var total=previous;if let data=data{total.append(data)};if total.count>65536{connection.cancel();return};if let text=String(data:total,encoding:.utf8),text.contains("\r\n\r\n"){self.serve(connection,text)}else if !complete && error==nil{self.read(connection,total)}else{connection.cancel()}}}
    func serve(_ connection:NWConnection,_ request:String){
        let lines=request.components(separatedBy:"\r\n"),parts=lines[0].components(separatedBy:" ")
        guard parts.count>1,["GET","HEAD"].contains(parts[0]),let address=URL(string:origin+parts[1]),address.path.hasPrefix("/fixture/") else{app.send(connection,status:403);return}
        let head=parts[0]=="HEAD",relative=String(address.path.dropFirst("/fixture/".count))
        if relative=="bridge.js"{app.send(connection,type:"application/javascript",data:Data(bridge.utf8),head:head);return}
        if relative=="note-assets/"+String(repeating:"a",count:64)+".png",let data=Data(base64Encoded:"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1kAAAAASUVORK5CYII="){app.send(connection,type:"image/png",data:data,head:head);return}
        if relative=="remote"{
            let requested=URLComponents(url:address,resolvingAgainstBaseURL:false)?.queryItems?.first(where:{$0.name=="url"})?.value ?? ""
            if requested.hasSuffix("/smoke/video.mp4"),let size=(try? video.resourceValues(forKeys:[.fileSizeKey]))?.fileSize{let range=lines.first(where:{$0.lowercased().hasPrefix("range:")}).map{String($0.dropFirst(6)).trimmingCharacters(in:.whitespaces)};app.streamFile(connection,path:video,type:"video/mp4",size:size,range:range,headers:[:],head:head);return}
            guard requested.contains("/smoke/slide") else{app.send(connection,status:403);return}
            let label=requested.contains("slide1") ? "Introduction":requested.contains("slide2") ? "Concept":"Example",color=requested.contains("slide1") ? "#eaf4ff":requested.contains("slide2") ? "#eaf5ed":"#fff5d9"
            let svg="<svg xmlns='http://www.w3.org/2000/svg' width='960' height='540'><rect width='960' height='540' fill='\(color)'/><rect x='64' y='80' width='620' height='48' fill='#168bee'/><text x='64' y='225' font-size='56' fill='#152e49'>\(label)</text><text x='64' y='300' font-size='28' fill='#405770'>Synthetic local test material</text></svg>"
            app.send(connection,type:"image/svg+xml",data:Data(svg.utf8),head:head);return
        }
        guard !relative.contains(".."),!relative.hasPrefix("/"),let data=try? Data(contentsOf:root.appendingPathComponent(relative)) else{app.send(connection,status:404);return}
        let ext=(relative as NSString).pathExtension,types=["html":"text/html; charset=utf-8","js":"application/javascript","css":"text/css","png":"image/png","svg":"image/svg+xml"]
        let headers=ext=="html" ? ["Content-Security-Policy":"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'"] : [:]
        app.send(connection,type:types[ext] ?? "application/octet-stream",data:data,headers:headers,head:head)
    }
}
@main struct WebKitAppSmoke {
    static func mockBridge(course:[String:Any],requireAuthorization:Bool=false)->String{
        let json=String(data:try! JSONSerialization.data(withJSONObject:course),encoding:.utf8)!
        let requires=requireAuthorization ? "true":"false"
        return #"""
        (()=>{
          const course=\#(json), listeners=new Map(), files=new Map(), operations=new Map(),authorizationScenario=\#(requires);let sequence=0,sessionAuthorizationRequired=authorizationScenario,apiAuthorizationRequired=authorizationScenario,secret=authorizationScenario?'sk-synthetic-saved-only-key-123456':'';
          window.__smoke={errors:[],requests:[],calls:[],store:files,aiCalls:0,status:'loading',checks:[],clipboard:null,confirms:[],authorizationScenario,authorizations:[],secretWrites:0};const originalConfirm=window.confirm;window.confirm=(message)=>{const value=originalConfirm(message);window.__smoke.confirms.push({message,value});return value};const originalPrompt=window.prompt;window.prompt=(...args)=>{const value=originalPrompt(...args);window.__smoke.lastPrompt=value;return value};
          window.addEventListener('error',e=>{if(e.message)window.__smoke.errors.push(e.message)});
          window.addEventListener('unhandledrejection',e=>window.__smoke.errors.push(String(e.reason?.stack||e.reason)));
          const seed=(k,v)=>files.set(k,JSON.stringify(v));
          seed('courses.json',[course]);seed('history.json',{courses:[course],complete:true});
          seed('prefs.json',{panes:['slides','transcript','video','notes','question','summary'],crop:true,duplicates:false,skip:false,count:2,locked:false,commonOrder:['transcript','crop','duplicates','skip','follow','overview','time','page','video','notes','question','summary']});
          const raw={...course,id:course.subId,sub_id:course.subId,course_id:course.courseId,course_title:course.title,start_at:course.start,end_at:course.end,course_begin:course.start,course_over:course.end,sub_status:3,teacher_name:course.teacher,realname:course.teacher,room_name:course.room,term_name:course.term};
          const fakeSlides=[0,20,40].map((t,i)=>({id:'slide'+(i+1),created_sec:t,content:JSON.stringify({pptimgurl:'https://classroom.zju.edu.cn/smoke/slide'+(i+1)+'.svg',content:['Introduction','Concept','Example'][i]})}));
          const caption=[{BeginSec:0,EndSec:18,Text:'This is the synthetic introduction.'},{BeginSec:21,EndSec:38,Text:'The second page explains the core concept.'},{BeginSec:42,EndSec:59,Text:'The third page gives an example.'}];
          function response(url,body){const u=new URL(url);window.__smoke.requests.push(u.pathname);
            if(!['classroom.zju.edu.cn','interactivemeta.cmc.zju.edu.cn'].includes(u.hostname))throw new Error('Unexpected network host in fixture: '+u.hostname);
            const p=u.pathname;
            if(p==='/userapi/v1/infosimple')return{params:{id:'synthetic-account',realname:'本机测试',tenant_id:112,account:'synthetic'}};
            if(p.includes('/schedule/get-week-schedules'))return{code:0,result:{list:[{course:[raw]}]}};
            if(p.includes('video-and-live-promission-by-user-id'))return{code:200,data:{[course.subId]:{live:true,video:true}}};
            if(p.includes('get-sub-info'))return{code:0,data:{...raw,content:{}}};
            if(p.includes('/schedule/search-ppt'))return{code:0,list:fakeSlides,total:fakeSlides.length};
            if(p.includes('search-trans-result'))return{code:0,list:[{all_content:caption}]};
            if(p.includes('search-live-course-list'))return{code:0,list:[{...raw,content:{save_playback:{contents:'https://classroom.zju.edu.cn/smoke/video.mp4'}}}]};
            if(p.includes('/course/catalogue'))return{result:{data:[raw]}};
            if(p.includes('get-term-years'))return{result:{data:{'2026':{'1':{begin_date:'2026-01-01',end_date:'2099-12-31',term_name:'2026-2027秋'}}}}};
            if(p==='/pptnote/v1/searchlist')return{code:0,total:{total:1,list:[{id:course.courseId,title:course.title,realname:course.teacher,room_name:course.room,term_name:course.term}]}};
            throw new Error('Unmocked course endpoint: '+p);
          }
          window.native={
            call(action,params={}){const id='fixture-'+(++sequence);window.__smoke.calls.push(action);const promise=new Promise((resolve,reject)=>queueMicrotask(()=>{try{let value=true;
              switch(action){
                case'identity':value=params.text!==undefined?true:sessionAuthorizationRequired?'':JSON.stringify({id:'synthetic-account',name:'本机测试',tenantId:112,username:'synthetic'});break;
                case'keychainStatus':value={authorizationRequired:sessionAuthorizationRequired||apiAuthorizationRequired,sessionAuthorizationRequired,apiAuthorizationRequired};break;
                case'authorizeCredentials':window.__smoke.authorizations.push(params.purpose);if(params.purpose==='api')apiAuthorizationRequired=false;else sessionAuthorizationRequired=false;value={ready:true,authorizationRequired:false};break;
                case'account':case'loginDone':case'cancelRequest':case'cancelDownload':case'cancelAI':case'logout':break;
                case'toolbar':window.fixtureToolbar={...params};break;
                case'read':value=files.get(params.key)||'';break;
                case'write':files.set(params.key,params.text);break;
                case'secret':if(params.remove)secret='';else if(params.text!==undefined){secret=params.text;apiAuthorizationRequired=false;window.__smoke.secretWrites++}value=apiAuthorizationRequired?'':secret;break;
                case'request':value={status:200,text:JSON.stringify(response(params.url,params.body))};break;
                case'ai':window.__smoke.aiCalls++;value={answer:'**Synthetic course explanation**\n\nThe concept at 00:21 follows the introduction.',calls:[],usage:{prompt_tokens:32,prompt_cache_hit_tokens:16,completion_tokens:12}};queueMicrotask(()=>window.native.event({name:'ai',value:{id,delta:value.answer}}));break;
                case'saveNoteImage':if(!params.data?.startsWith('data:image/png;base64,'))throw new Error('Unmocked fixture image format');value='note-assets/'+'a'.repeat(64)+'.png';break;
                case'copy':window.__smoke.clipboard=params;break;
                case'prepareImageDrag':if(!params.image?.startsWith('data:image/png;base64,'))throw new Error('Drag preparation needs actual PNG bytes');window.__smoke.preparedImage=params;value={token:'fixture-prepared-image'};break;
                case'dragImage':if(params.token!=='fixture-prepared-image'||params.image!==undefined)throw new Error('Drag needs a prepared token without image transfer');window.__smoke.draggedImage=params;break;
                case'clipboard':value=window.__smoke.clipboard?.text||'';break;
                case'cache':if(params.clear){for(const key of files.keys())if(/^(lesson-|summary-|chats-|vision-|skip-|courses|history)/.test(key))files.delete(key);value=true}else if(params.category){seed('cache-settings.json',{[params.category]:params.enabled})}else value={entries:Object.fromEntries(['schedule','timeline','vision','summary','question','skip','images'].map(k=>[k,[{key:k+'-fixture.json',bytes:128}]])),settings:{}};break;
                case'resourceSize':value=1024;break;
                case'saveResource':value={name:params.name,size:1024};break;
                case'writeOffline':files.set(params.lesson+'/'+params.name,params.text);break;
                case'deleteOffline':case'export':case'exportBundle':break;
                case'pickImage':value='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1kAAAAASUVORK5CYII=';break;
                default:throw new Error('Unmocked native bridge action: '+action);
              }resolve(value);
            }catch(error){window.__smoke.errors.push(error.message);reject(error)}}));promise.id=id;return promise},
            event({name,value}){for(const fn of listeners.get(name)||[])fn(value)},on(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);return()=>listeners.get(name).delete(fn)}
          };
        })();
        """#
    }
    static let runner = #"""
    window.__smoke.status='running';window.__smoke.run=(async()=>{
      const q=s=>document.querySelector(s), qa=s=>[...document.querySelectorAll(s)],sleep=t=>new Promise(r=>setTimeout(r,t));
      async function until(fn,label,timeout=10000){const end=performance.now()+timeout;while(!fn()&&performance.now()<end)await sleep(20);if(!fn())throw new Error('Timed out: '+label)}
      function assert(value,label){if(!value)throw new Error(label);window.__smoke.checks.push(label)}
      function click(text,root=document){const b=[...root.querySelectorAll('button')].find(n=>n.textContent.trim().replace(/^✓\s*/,'')===text);if(!b)throw new Error('Missing button: '+text);b.click();return b}
      const modal=()=>q('#modal');
      if(window.__smoke.authorizationScenario){await until(()=>qa('.welcome button').some(button=>button.textContent==='恢复登录'),'explicit saved-session recovery');assert(window.__smoke.requests.length===0&&window.__smoke.authorizations.length===0,'protected login does not probe guest APIs or automatically request keychain authorization');click('恢复登录',q('.welcome'));await until(()=>window.fixtureToolbar?.loggedIn,'restored native toolbar');assert(window.__smoke.authorizations.length===1&&window.__smoke.authorizations[0]==='session','saved login restored by one explicit session authorization')}
      await until(()=>q('#pageTitle')?.textContent==='我的课堂','initial classroom');
      await until(()=>window.fixtureToolbar?.name==='本机测试'&&window.fixtureToolbar.loggedIn,'synthetic native toolbar identity');assert(window.fixtureToolbar.name==='本机测试'&&window.fixtureToolbar.loggedIn,'synthetic identity synchronized to native toolbar');assert(!q('#appHeader')&&!q('#identity')&&!q('#myClassHome'),'browser header does not reserve a duplicate native title bar');
      click('近两周');await until(()=>q('.course-card'),'recent course card');
      const card=q('.course-card'),star=card.querySelector('[title="收藏"]'),later=card.querySelector('[title="稍后再看"]');star.click();later.click();await sleep(30);
      assert(star.getAttribute('aria-pressed')==='true'&&later.classList.contains('active'),'lesson collection buttons persist selected state');const confirmations=window.__smoke.confirms.length;star.click();await until(()=>star.getAttribute('aria-pressed')==='false','cancel same-card favourite');assert(window.__smoke.confirms.length===confirmations+1,'cancelling same-card favourite asks once');star.click();await until(()=>star.getAttribute('aria-pressed')==='true','restore favourite');
      click('课程收藏',q('#navigation'));await until(()=>q('#pageTitle').textContent==='课程收藏','collection navigation');assert(q('.course-card'),'favourite collection renders course');
      window.native.event({name:'toolbarAction',value:'home'});await until(()=>q('#pageTitle').textContent==='我的课堂','native toolbar returns classroom');click('近两周');click('进入学习');
      await until(()=>qa('#stage > .pane').length===6,'all six study panes');
      assert(qa('#stage > .pane').every(n=>n.clientWidth>0&&n.clientHeight>0),'six panes have measurable layout');
      for(const width of [640,1320]){window.__smoke.resizeWidth=width;await until(()=>innerWidth===width,'background window resizes to '+width);await sleep(50);const tools=q('#studyTools'),controls=[...tools.children].filter(n=>getComputedStyle(n).display!=='none');assert(controls.length>5,'study tools retained at '+width);const centers=controls.map(n=>{const r=n.getBoundingClientRect();return r.top+r.height/2});assert(Math.max(...centers)-Math.min(...centers)<3&&tools.scrollHeight<=tools.clientHeight+1,'study tools stay aligned in one horizontal row at '+width)}
      await until(()=>q('#slidesBody img')&&q('#transcriptBody').textContent.includes('synthetic'),'slide and transcript content');
      await until(()=>q('#slidesBody img')?.naturalWidth>0,'rendered slide bitmap');assert(q('#slidesBody img').naturalWidth>0,'slide image decoded and mounted');
      await until(()=>q('#videoBody video')?.readyState>=1,'stable screenshot test player');q('#videoBody video').pause();await sleep(40);
      const slideImage=q('#slidesBody .slide-image');
      assert(q('.slide-page-meta').textContent.match(/^第 1 页\s+00:00$/)&&!q('.slide-card .slide-meta'),'page number and time share navigation row with spacing');
      slideImage.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0,pointerType:'mouse',pointerId:51,clientX:40,clientY:30}));getSelection().removeAllRanges();window.__smoke.clipboard=null;
      const directCopy=new KeyboardEvent('keydown',{key:'c',code:'KeyC',metaKey:true,bubbles:true,cancelable:true});slideImage.dispatchEvent(directCopy);await until(()=>window.__smoke.clipboard?.image?.startsWith('data:image/png;base64,'),'direct screenshot PNG copy');assert(directCopy.defaultPrevented&&!window.__smoke.clipboard.html.includes('http')&&window.__smoke.clipboard.text==='','focused screenshot Command C copies raster bytes rather than URL');
      window.__smoke.clipboard=null;document.dispatchEvent(new ClipboardEvent('copy',{bubbles:true,cancelable:true}));await until(()=>window.__smoke.clipboard?.image,'native DOM copy image');assert(window.__smoke.clipboard.image.startsWith('data:image/png;base64,'),'native copy event copies focused screenshot without a text range');
      assert(await window.zhiyunCopyImage(),'awaitable native Edit menu hook handles screenshot');await until(()=>window.__smoke.preparedImage?.image?.startsWith('data:image/png;base64,'),'cached native drag image');
      const transfer=new DataTransfer();transfer.setData('text/uri-list',slideImage.src);const dragStart=new DragEvent('dragstart',{bubbles:true,cancelable:true,clientX:40,clientY:30,dataTransfer:transfer});slideImage.dispatchEvent(dragStart);await until(()=>window.__smoke.draggedImage?.token,'prepared drag dispatch');assert(dragStart.defaultPrevented&&window.__smoke.draggedImage.token==='fixture-prepared-image'&&window.__smoke.draggedImage.image===undefined,'image drag dispatches ready native token immediately');assert(transfer.files.length===1&&transfer.files[0].type==='image/png'&&!transfer.getData('text/uri-list')&&transfer.getData('text/html').includes('data:image/png;base64,'),'drag data contains PNG file and image HTML without URL');
      const initialPageLabels=q('.slide-header-meta').textContent,initialTranscript=q('#transcriptBody').textContent,initialVideoTime=q('#videoBody video').currentTime;q('#slidesBody .slide-image').dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true}));await until(()=>q('.slide-full-image'),'full screenshot preview');const previewBody=q('#modalBody');previewBody.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',code:'ArrowRight',bubbles:true,cancelable:true}));assert(q('.slide-full-image').dataset.page==='1','full screenshot right arrow browses next page');assert(q('#modalToolbar').parentElement===q('#modalClose').parentElement&&q('#modalClose').textContent==='返回','preview back and paging controls share one header');
      window.__smoke.clipboard=null;previewBody.dispatchEvent(new KeyboardEvent('keydown',{key:'c',code:'KeyC',metaKey:true,bubbles:true,cancelable:true}));await until(()=>window.__smoke.clipboard?.html?.includes('第 2 页课件'),'preview copy current screenshot');assert(window.__smoke.clipboard.image.startsWith('data:image/png;base64,'),'full screenshot Command C copies current raster page');click('回到最新',q('#modalToolbar'));await until(()=>q('.slide-full-image').dataset.page==='2','preview latest page');assert(q('.slide-header-meta').textContent===initialPageLabels&&q('#transcriptBody').textContent===initialTranscript&&q('#videoBody video').currentTime===initialVideoTime,'preview latest browses without changing lesson slide or transcript position');q('#modalClose').click();assert(q('#modalToolbar').parentElement===q('.modal-shell'),'preview toolbar restored on return');
      await until(()=>q('#videoBody video')?.readyState>=1,'synthetic video metadata');const movie=q('#videoBody video');assert(movie.duration>=59,'real local MP4 metadata loaded');const beforePlayback=movie.currentTime;await movie.play();await until(()=>movie.currentTime>beforePlayback+.15,'video playback advances');assert(movie.currentTime>beforePlayback+.15,'real local video playback advances');movie.pause();assert(movie.paused,'video pause retains player');movie.currentTime=15;await until(()=>Math.abs(movie.currentTime-15)<.2,'video seeks');assert(Math.abs(movie.currentTime-15)<.2,'local video seeking works');const videoPane=q('[data-pane=video]');videoPane.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerType:'mouse',pointerId:8}));videoPane.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'ArrowRight',code:'ArrowRight'}));await until(()=>Math.abs(movie.currentTime-30)<.2,'focused video right arrow');assert(Math.abs(movie.currentTime-30)<.2,'focused video keyboard skips 15 seconds');const originalVideoRect=videoPane.getBoundingClientRect(),originalVideoZ=videoPane.style.zIndex;click('全屏',videoPane);await until(()=>videoPane.classList.contains('video-fullscreen'),'video full window');await sleep(30);const fullVideoRect=videoPane.getBoundingClientRect();assert(Math.abs(fullVideoRect.left)<1&&Math.abs(fullVideoRect.top)<1&&Math.abs(fullVideoRect.width-innerWidth)<1&&Math.abs(fullVideoRect.height-innerHeight)<1,'video fullscreen covers actual document viewport');click('全屏',videoPane);await until(()=>!videoPane.classList.contains('video-fullscreen'),'exit video fullscreen');await sleep(30);const restoredVideoRect=videoPane.getBoundingClientRect();assert(Math.abs(restoredVideoRect.left-originalVideoRect.left)<1&&Math.abs(restoredVideoRect.top-originalVideoRect.top)<1&&Math.abs(restoredVideoRect.width-originalVideoRect.width)<1&&Math.abs(restoredVideoRect.height-originalVideoRect.height)<1&&videoPane.style.zIndex===originalVideoZ,'exiting fullscreen restores pane bounds and layer');
      click('重命名',q('[data-pane=notes]'));await until(()=>q('[data-pane=notes] select')?.selectedOptions[0]?.textContent==='重命名测试','native prompt renames note');
      click('新建',q('[data-pane=notes]'));await sleep(50);assert(q('[data-pane=notes] select').options.length===2,'multiple notes created');
      const body=q('.note-body');body.focus();body.textContent='Before After';body.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:'Before After'}));
      const range=document.createRange();range.setStart(body.firstChild,7);range.collapse(true);getSelection().removeAllRanges();getSelection().addRange(range);document.dispatchEvent(new Event('selectionchange'));
      click('图片',q('[data-pane=notes]'));await until(()=>q('.note-block[data-source=image]'),'insert image at saved caret');
      const noteBlocks=qa('.notes-editor > .note-block');assert(noteBlocks.length===3&&noteBlocks[0].textContent.includes('Before')&&noteBlocks[1].dataset.source==='image'&&noteBlocks[2].textContent.includes('After'),'reference splits note at caret rather than appending');
      const afterBody=noteBlocks[2].querySelector('.note-body');afterBody.focus();const formatRange=document.createRange();formatRange.selectNodeContents(afterBody);getSelection().removeAllRanges();getSelection().addRange(formatRange);document.dispatchEvent(new Event('selectionchange'));click('B',q('[data-pane=notes]'));await until(()=>[...afterBody.querySelectorAll('*')].some(n=>Number(getComputedStyle(n).fontWeight)>=600),'native editing bold');assert([...afterBody.querySelectorAll('*')].some(n=>Number(getComputedStyle(n).fontWeight)>=600),'note formatting applies to native text selection');
      const freshCaret=document.createRange();freshCaret.selectNodeContents(afterBody);freshCaret.collapse(false);getSelection().removeAllRanges();getSelection().addRange(freshCaret);document.dispatchEvent(new Event('selectionchange'));afterBody.dispatchEvent(new KeyboardEvent('keydown',{key:'a',code:'KeyA',metaKey:true,bubbles:true,cancelable:true}));assert(getSelection().toString().trim()==='After','first Command A selects focused note block');afterBody.dispatchEvent(new KeyboardEvent('keydown',{key:'a',code:'KeyA',metaKey:true,bubbles:true,cancelable:true}));assert(q('.notes-editor.note-whole-selected'),'second Command A selects all note blocks');afterBody.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0,pointerType:'mouse',pointerId:9}));await until(()=>q('.note-copy-menu'),'whole note copy menu');window.__smoke.clipboard=null;click('复制',q('.note-copy-menu'));await until(()=>window.__smoke.clipboard?.html?.includes('<img'),'note clipboard rich image');assert(window.__smoke.clipboard.html.includes('<img')&&window.__smoke.clipboard.html.includes('Before'),'whole-note clipboard includes image and text');q('#stage').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerType:'mouse',pointerId:10}));assert(!q('.notes-editor.note-whole-selected')&&!getSelection().toString(),'outside pointer clears note selection');
      click('布局',q('#topActions'));await until(()=>q('.parity-layout-board'),'layout editor');
      click('横向排列',modal());await sleep(30);const widths=qa('#stage > .pane').map(n=>n.offsetWidth);assert(Math.max(...widths)-Math.min(...widths)<3,'layout preset updates actual panes');
      const preview=q('.parity-layout-item'),previewId=preview.dataset.pane,actual=q('#stage > [data-pane="'+previewId+'"]');preview.setPointerCapture=()=>{};preview.hasPointerCapture=()=>false;
      const initialLeft=actual.offsetLeft,handle=preview.querySelector('.handle'),hb=handle.getBoundingClientRect();handle.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0,pointerType:'mouse',pointerId:11,clientX:hb.left+10,clientY:hb.top+5}));preview.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,button:0,pointerType:'mouse',pointerId:11,clientX:hb.left+70,clientY:hb.top+25}));preview.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0,pointerType:'mouse',pointerId:11}));assert(actual.offsetLeft>initialLeft,'layout dragging updates rendered pane position');
      const widthBefore=actual.offsetWidth,edge=preview.querySelector('.edge.e'),eb=edge.getBoundingClientRect();edge.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0,pointerType:'mouse',pointerId:12,clientX:eb.left+2,clientY:eb.top+10}));preview.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,button:0,pointerType:'mouse',pointerId:12,clientX:eb.left+62,clientY:eb.top+10}));preview.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0,pointerType:'mouse',pointerId:12}));assert(actual.offsetWidth>widthBefore,'edge resizing updates rendered pane width');
      click('保存布局',modal());await until(()=>window.__smoke.store.has('layouts.json'),'saved layout file');assert(Object.keys(JSON.parse(window.__smoke.store.get('layouts.json'))).length>0,'saved layout keyed by panes and window size');
      click('锁定布局',modal());await until(()=>qa('#stage > .pane').every(n=>n.classList.contains('layout-locked')),'locking panes');assert(qa('#stage > .pane').every(n=>n.classList.contains('layout-locked')),'locking protects actual pane bounds');
      click('解锁布局',modal());await until(()=>qa('#stage > .pane').every(n=>!n.classList.contains('layout-locked')),'unlocking panes');assert(qa('#stage > .pane').every(n=>!n.classList.contains('layout-locked')),'unlock restores editing');
      q('#modalClose').click();click('布局',q('#topActions'));click('概览',q('#studyTools'));await until(()=>q('#modalTitle').textContent==='课程概览','overview closes layout editor');assert(!q('.parity-layout-board'),'modal replacement removes layout');
      await until(()=>qa('.overview-item').length===3,'overview slide count');const before=q('.overview-grid').style.getPropertyValue('--cols');click('＋',q('#modalToolbar'));await until(()=>q('.overview-grid').style.getPropertyValue('--cols')!==before,'overview zoom');assert(q('.overview-grid').style.getPropertyValue('--cols')!==before,'overview zoom updates grid');q('#modalClose').click();
      click('跳转时间',q('#studyTools'));await until(()=>q('#modalTitle').textContent.includes('时间'),'time chooser');const wheels=qa('#modalBody .time-wheels input[type=number]');assert(wheels.length===3&&wheels.map(n=>n.getAttribute('aria-label')).join(',')==='时,分,秒','time chooser renders three labelled numeric wheels');const secondsBefore=Number(wheels[2].value);wheels[2].dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:-20}));assert(Number(wheels[2].value)===Math.min(59,secondsBefore+1),'mouse wheel increments time choice');wheels.forEach(n=>{n.value='9999';n.dispatchEvent(new Event('input',{bubbles:true}))});assert(q('#modalBody h3').textContent==='05:00'&&wheels.every(n=>Number(n.value)<=Number(n.max))&&Number(wheels[0].value)*3600+Number(wheels[1].value)*60+Number(wheels[2].value)===300,'time jump clamps selection to synthetic course duration');q('#modalClose').click();
      click('跳转页数',q('#studyTools'));await until(()=>q('#modalTitle').textContent.includes('页'),'page chooser');assert(qa('#modalBody button').length>0||qa('#modalBody input').length>0,'page chooser controls');q('#modalClose').click();
      const question=q('[data-pane=question]');if(window.__smoke.authorizationScenario){await until(()=>qa('#questionBody button').some(button=>button.textContent==='恢复已保存的密钥'),'explicit saved API recovery');assert(!q('#questionBody input[type=password]'),'protected saved API is not mistaken for a missing key');const noteEditor=q('.notes-editor'),player=q('#videoBody video'),requestCount=window.__smoke.requests.length;click('恢复已保存的密钥',question);await until(()=>q('#questionBody').textContent.includes('Shift＋Enter')&&!q('.question-options').hidden,'recovered API conversation');assert(q('.notes-editor')===noteEditor&&q('#videoBody video')===player&&q('#stage'),'API authorization preserves the existing study panes and note editor');assert(window.__smoke.requests.length===requestCount&&window.__smoke.secretWrites===0,'API recovery does not reboot the course or overwrite the saved key');assert(window.__smoke.authorizations.filter(value=>value==='api').length===1,'saved API restored by one explicit API authorization')};click('API设置',question);await until(()=>q('#questionBody input[type=password]'),'API settings');const key=q('#questionBody input');key.value='sk-synthetic-local-only-key-123456';click(window.__smoke.authorizationScenario?'保存新密钥':'保存密钥',question);await until(()=>q('#questionBody').textContent.includes('Enter'),'saved API opens conversation');
      const input=q('#questionInput');input.focus();input.value='First line';const callsBeforeNewline=window.__smoke.aiCalls,newline=new KeyboardEvent('keydown',{key:'Enter',code:'Enter',shiftKey:true,bubbles:true,cancelable:true});input.dispatchEvent(newline);assert(window.__smoke.aiCalls===callsBeforeNewline&&!newline.defaultPrevented&&input.value==='First line'&&!q('#questionBody .question'),'Shift Enter preserves native newline without sending');
      input.value='Synthetic course question';input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true}));await until(()=>q('#questionBody .answer')?.textContent.includes('Synthetic course explanation'),'Enter sends question and streams answer');
      assert(q('#questionBody .question').textContent==='Synthetic course question','question retained with its answer');assert(qa('#questionBody .answer span').some(n=>Number(getComputedStyle(n).fontWeight)>=600),'AI Markdown bold formatted in actual WebKit');
      click('API设置',question);await until(()=>q('#questionBody input[type=password]'),'open configured API settings');click('返回对话',question);await until(()=>q('#questionBody .conversation'),'API settings return');assert(q('#questionBody .conversation'),'return from API settings keeps conversation');
      click('选课件',question);await until(()=>q('#modalTitle').textContent==='选择问答课件','page question selection');click('选择',q('#modalToolbar'));await sleep(25);const item=q('.overview-item'),selectionBody=q('#modalBody');selectionBody.setPointerCapture=()=>{};selectionBody.hasPointerCapture=()=>false;const itemBox=item.getBoundingClientRect();item.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerType:'mouse',pointerId:47,button:0,buttons:1,clientX:itemBox.left+20,clientY:itemBox.top+20}));document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerType:'mouse',pointerId:47,button:0}));assert(q('.overview-item.selected'),'explicit pointer selection chooses slide');click('选择',q('#modalToolbar'));await until(()=>!q('.overview-item.selected'),'selection disabled');assert(!q('.overview-item.selected'),'leaving selection clears previous choices');q('#modalClose').click();
      click('返回',q('#topActions'));await until(()=>q('#pageTitle').textContent==='我的课堂','study back to prior route');click('缓存设置',q('#navigation'));await until(()=>qa('.cache-row').length===7,'cache category list');assert(qa('.cache-row').every(n=>n.textContent.includes('查看详情')&&n.textContent.includes('清理')),'cache controls present for every category');
      click('清理全部缓存',q('#topActions'));await sleep(100);assert(window.__smoke.calls.includes('cache'),'native cache request issued');
      assert(window.__smoke.errors.length===0,'no page errors or unhandled rejections');window.__smoke.status='passed';
    })().catch(error=>{window.__smoke.failure=String(error.message)+'\n'+String(error.stack||'');window.__smoke.status='failed'});void 0;
    """#
    static func main(){do{try run()}catch{fputs(error.localizedDescription+"\n",stderr);exit(1)}}
    static func run()throws{
        guard CommandLine.arguments.count==3 else{throw appError("Usage: webkit-smoke <checked-in web directory> <temporary directory>")}
        let webRoot=URL(fileURLWithPath:CommandLine.arguments[1]),temporary=URL(fileURLWithPath:CommandLine.arguments[2]),video=temporary.appendingPathComponent("synthetic.mp4")
        guard FileManager.default.fileExists(atPath:webRoot.appendingPathComponent("app.js").path) else{throw appError("Missing app.js")};try createSmokeVideo(video)
        let application=NSApplication.shared;application.setActivationPolicy(.prohibited)
        let app=App(),config=WKWebViewConfiguration();app.testSkipCookiePersistence=true;app.root=temporary.appendingPathComponent("isolated-profile");config.websiteDataStore=app.store;config.mediaTypesRequiringUserActionForPlayback=[]
        let view=WKWebView(frame:NSRect(x:0,y:0,width:1400,height:950),configuration:config);view.uiDelegate=app;view.navigationDelegate=app
        let window=NSWindow(contentRect:view.frame,styleMask:[.titled],backing:.buffered,defer:false);window.contentView=view;window.isReleasedWhenClosed=false;app.window=window;app.web=view;app.token="fixture"
        app.testDialogResponder={kind,message,_ in fputs("Native fixture dialog: "+kind+" "+message+"\n",stderr);return kind=="confirm" ? "true":kind=="prompt" ? "重命名测试":nil}
        let start=Int(Date().timeIntervalSince1970)-900
        let course:[String:Any]=["courseId":"synthetic-course","subId":"synthetic-lesson","title":"合成本机测试课","teacher":"合成教师","room":"测试教室","term":"2026—2027学年 · 秋季学期","start":start,"end":start+300,"status":"3"]
        let server=SmokeServer(app:app,root:webRoot,video:video,bridge:mockBridge(course:course,requireAuthorization:true));var listening=false
        try server.start{app.origin=server.origin;view.load(URLRequest(url:URL(string:server.origin+"/fixture/index.html")!));listening=true}
        try smokeWait({listening});try smokeWait({!view.isLoading});_ = try smokeEvaluate(view,runner)
        let deadline=Date().addingTimeInterval(75);var state="running"
        while state=="running",Date()<deadline{RunLoop.current.run(until:Date().addingTimeInterval(0.05));if let requested=try smokeEvaluate(view,"window.__smoke?.resizeWidth || 0") as? NSNumber,requested.intValue>0,abs(view.bounds.width-CGFloat(requested.intValue))>0.5{let size=NSSize(width:CGFloat(requested.intValue),height:950);window.setContentSize(size);view.setFrameSize(size)};state=(try smokeEvaluate(view,"window.__smoke?.status || 'running'")) as? String ?? "running"}
        let report=try smokeEvaluate(view,"JSON.stringify({status:window.__smoke?.status,failure:window.__smoke?.failure,checks:window.__smoke?.checks,errors:window.__smoke?.errors,requestCount:window.__smoke?.requests.length,noteOptions:window.__smoke?.status==='failed'?[...document.querySelectorAll('[data-pane=notes] select option')].map(n=>n.textContent):undefined,study:window.__smoke?.status==='failed'?{slides:document.querySelector('#slidesBody')?.textContent,transcript:document.querySelector('#transcriptBody')?.textContent,toast:document.querySelector('#toast')?.textContent,requests:window.__smoke?.requests}:undefined})") as? String ?? "No report"
        print(report);server.listener.cancel();window.contentView=nil;view.uiDelegate=nil;view.navigationDelegate=nil;window.close()
        guard state=="passed" else{throw appError("WebKit app smoke test failed: "+report)}
    }
}
