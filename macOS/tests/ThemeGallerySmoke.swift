import Cocoa
import WebKit
import CryptoKit
@main struct ThemeGallerySmoke {
 static func main(){do{try run()}catch{fputs(error.localizedDescription+"\n",stderr);exit(1)}}
 static func evaluate(_ view:WKWebView,_ js:String)throws->Any?{try smokeEvaluate(view,js)}
 static func waitJS(_ view:WKWebView,_ js:String,seconds:Double=20)throws{do{try smokeWait({(try? evaluate(view,js)) as? Bool == true},seconds:seconds)}catch{let state=(try? evaluate(view,"JSON.stringify({title:document.querySelector('#pageTitle')?.textContent,errors:window.__smoke?.errors,status:document.querySelector('#selectedTheme')?.textContent,messages:window.__actualThemeMessages})")) as? String ?? "none";throw appError("Theme wait failed: "+js+" state: "+state)}}
 static func capture(_ view:WKWebView,_ path:URL,rect:CGRect?=nil,width:CGFloat=600)throws{
  var captured=false,png:Data?,failure:Error?;let options=WKSnapshotConfiguration();options.afterScreenUpdates=true
  // Full snapshots avoid WebKit's partial-rect scroll-layer offset. Crop pixels afterwards.
  options.snapshotWidth=NSNumber(value:Double(rect==nil ? width:view.bounds.width))
  view.takeSnapshot(with:options){image,error in
   if let image=image,let tiff=image.tiffRepresentation,let bitmap=NSBitmapImageRep(data:tiff){
    if let rect=rect,let cg=bitmap.cgImage{
     let scale=CGFloat(cg.width)/view.bounds.width
     if let crop=cg.cropping(to:CGRect(x:rect.minX*scale,y:rect.minY*scale,width:rect.width*scale,height:rect.height*scale)){png=NSBitmapImageRep(cgImage:crop).representation(using:.png,properties:[:])}
    }else{png=bitmap.representation(using:.png,properties:[:])}
   }else{failure=error};captured=true
  }
  try smokeWait({captured});if let error=failure{throw error};guard let png=png else{throw appError("Review capture unavailable")};try png.write(to:path)
 }
 static func run()throws{
  guard CommandLine.arguments.count==4 else{throw appError("Usage: theme-gallery <web-root> <isolated-test-folder> <screenshot-folder>")}
  let root=URL(fileURLWithPath:CommandLine.arguments[1]),temporary=URL(fileURLWithPath:CommandLine.arguments[2]),output=URL(fileURLWithPath:CommandLine.arguments[3])
  try FileManager.default.createDirectory(at:output,withIntermediateDirectories:true)
  let application=NSApplication.shared;application.setActivationPolicy(.prohibited)
  let app=App();app.testSkipCookiePersistence=true;app.root=temporary.appendingPathComponent("isolated-profile")
  let suite="theme-gallery-test-"+UUID().uuidString;app.themeDefaults=UserDefaults(suiteName:suite)!
  defer{app.themeDefaults.removePersistentDomain(forName:suite)}
  let config=WKWebViewConfiguration();config.websiteDataStore=app.store;config.mediaTypesRequiringUserActionForPlayback=[];config.userContentController.add(app,name:"native")
  let view=WKWebView(frame:NSRect(x:0,y:0,width:1200,height:820),configuration:config);view.navigationDelegate=app;view.uiDelegate=app
  let window=NSWindow(contentRect:view.frame,styleMask:[.titled],backing:.buffered,defer:false);window.contentView=view;window.isReleasedWhenClosed=false;app.window=window;app.web=view;app.token="fixture"
  let start=Int(Date().timeIntervalSince1970)-7200
  let course:[String:Any]=["courseId":"synthetic-design","subId":"synthetic-design-lesson","title":"设计心理学","teacher":"演示教师","room":"演示教室","term":"2026—2027学年 · 秋季学期","start":start,"end":start+3600,"status":"3"]
  var bridge=WebKitAppSmoke.mockBridge(course:course)
  bridge=bridge.replacingOccurrences(of:"seed('courses.json',[course]);",with:"seed('courses.json',[course,{...course,courseId:'synthetic-visual',subId:'synthetic-visual-lesson',title:'视觉文化导论',start:course.start+3600,end:course.end+3600}]);")
  bridge=bridge.replacingOccurrences(of:"course:[raw]",with:"course:[raw,{...raw,id:'synthetic-visual-lesson',sub_id:'synthetic-visual-lesson',course_id:'synthetic-visual',title:'视觉文化导论',course_title:'视觉文化导论',start_at:course.start+3600,end_at:course.end+3600,course_begin:course.start+3600,course_over:course.end+3600}]")
  bridge += """
  (()=>{const mocked=window.native.call,waiting=new Map();let seq=0;window.__actualThemeMessages=[];window.native.receive=({id,value,error})=>{const task=waiting.get(id);if(!task)return;waiting.delete(id);error?task.reject(new Error(error)):task.resolve(value)};window.native.call=(action,params={})=>{if(action!=='setAppearanceTheme')return mocked(action,params);const id='actual-theme-'+(++seq);window.__actualThemeMessages.push({action,params,id});return new Promise((resolve,reject)=>{waiting.set(id,{resolve,reject});window.webkit.messageHandlers.native.postMessage({id,action,params})})}})();
  """
  let server=SmokeServer(app:app,root:root,video:temporary.appendingPathComponent("unused.mp4"),bridge:bridge);var ready=false
  try server.start{app.origin=server.origin;view.load(URLRequest(url:URL(string:server.origin+"/fixture/index.html")!));ready=true}
  try smokeWait({ready});try waitJS(view,"document.querySelectorAll('.classroom-page .course-card').length===2 && !!window.__smoke")
  RunLoop.current.run(until:Date().addingTimeInterval(0.3))
  _=try evaluate(view,"void import('./theme-icons.js').then(({iconNames,makeIcon})=>{const host=document.createElement('div');host.id='icon-geometry-review';host.style.cssText='position:fixed;left:-10000px;top:0;display:flex';for(const name of iconNames)host.append(makeIcon(name));document.body.append(host);window.__iconReviewReady=true})")
  try waitJS(view,"window.__iconReviewReady===true")
  let review=temporary.appendingPathComponent("ui-review")
  for folder in ["agent","settings","study"]{try FileManager.default.createDirectory(at:review.appendingPathComponent(folder),withIntermediateDirectories:true)}
  var records=[[String:Any]](),hashes=Set<String>()
  let beforeRequests=(try evaluate(view,"window.__smoke.requests.length")) as? Int ?? -1
  for id in app.themeIdentifiers{
   app.applyTheme(id);try waitJS(view,"document.documentElement.dataset.theme==='"+id+"' && [...document.querySelectorAll('.theme-icon')].every(n=>n.complete&&n.naturalWidth>0)")
   let iconFailures=try evaluate(view,"JSON.stringify([...document.querySelectorAll('#icon-geometry-review .ui-icon')].flatMap(n=>{const p=n.querySelector('path'),b=p.getBBox(),pad=Number(n.querySelector('svg').getAttribute('stroke-width'))/2;return b.x-pad<-.01||b.y-pad<-.01||b.x+b.width+pad>24.01||b.y+b.height+pad>24.01?[{name:n.dataset.uiIcon,x:b.x,y:b.y,width:b.width,height:b.height,pad}]:[]}))") as! String
   guard iconFailures=="[]" else{throw appError("Icon geometry escapes viewBox: "+id+" "+iconFailures)}
   var decoded=false,decodeFailure:Error?
   view.callAsyncJavaScript("await Promise.all([...document.querySelectorAll('.theme-icon')].map(n=>n.decode()));return true",arguments:[:],in:nil,in:.page){result in if case .failure(let e)=result{decodeFailure=e};decoded=true}
   try smokeWait({decoded});if let error=decodeFailure{throw error}
   RunLoop.current.run(until:Date().addingTimeInterval(0.45))
   let info=try evaluate(view,"JSON.stringify({theme:document.documentElement.dataset.theme,composition:document.querySelector('.classroom-page').dataset.composition,cards:document.querySelectorAll('.classroom-page .course-card').length,bodyOverflow:document.documentElement.scrollWidth>innerWidth+1,css:getComputedStyle(document.querySelector('.classroom-intro')).backgroundColor})") as! String
   let metrics=try JSONSerialization.jsonObject(with:Data(info.utf8)) as! [String:Any];guard metrics["bodyOverflow"] as? Bool == false else{throw appError("Theme overflow: "+id)}
   var done=false,result:Data?,failure:Error?
   let snapshot=WKSnapshotConfiguration();snapshot.afterScreenUpdates=true;snapshot.snapshotWidth=600
   view.takeSnapshot(with:snapshot){image,error in if let image=image,let tiff=image.tiffRepresentation,let bitmap=NSBitmapImageRep(data:tiff){result=bitmap.representation(using:.png,properties:[:])}else{failure=error};done=true}
   try smokeWait({done});if let error=failure{throw error};guard let data=result else{throw appError("No screenshot: "+id)}
   let hash=SHA256.hash(data:data).map{String(format:"%02x",$0)}.joined();guard hashes.insert(hash).inserted else{throw appError("Duplicate theme screenshot: "+id)}
   try data.write(to:output.appendingPathComponent(id+".png"));records.append(["id":id,"sha256":hash,"bytes":data.count,"metrics":metrics]);print("Captured actual homepage: "+id)
   app.event("toolbarAction","agent")
   try waitJS(view,"!!document.querySelector('.global-agent:not([hidden]) .agent-empty')")
   guard try evaluate(view,"!document.querySelector('.agent-suggestion') && !window.__smoke.aiCalls") as? Bool==true else{throw appError("Empty assistant must not show fixed suggestions or make model requests")}
   let assistantRectText=try evaluate(view,"JSON.stringify((()=>{const r=document.querySelector('.global-agent').getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})())") as! String
   let assistantRect=try JSONSerialization.jsonObject(with:Data(assistantRectText.utf8)) as! [String:Double]
   let rect=CGRect(x:assistantRect["x"]!,y:assistantRect["y"]!,width:assistantRect["width"]!,height:assistantRect["height"]!)
   guard try evaluate(view,"(()=>{const log=document.querySelector('.agent-log'),last=document.querySelector('.agent-empty-detail');return last.getBoundingClientRect().bottom<=log.getBoundingClientRect().bottom})()") as? Bool==true else{throw appError("Assistant welcome clipped behind composer: "+id)}
   try capture(view,review.appendingPathComponent("agent/"+id+".png"),rect:rect,width:390)
   _=try evaluate(view,"document.querySelector('.agent-head button[title=设置]').click();void 0")
   try waitJS(view,"document.querySelector('.global-agent')?.dataset.view==='settings' && !!document.querySelector('.agent-settings-group')")
   guard try evaluate(view,"(()=>{const log=document.querySelector('.agent-log'),root=document.querySelector('.global-agent');return log.scrollWidth<=log.clientWidth+1 && root.scrollTop===0 && root.querySelector('.agent-head').getBoundingClientRect().top>=root.getBoundingClientRect().top && [...root.querySelectorAll('input,select')].filter(n=>n.getClientRects().length>0).every(n=>{const r=n.getBoundingClientRect(),b=root.getBoundingClientRect();return r.left>=b.left&&r.right<=b.right}) && ![...root.querySelectorAll('button')].some(n=>n.textContent.includes('恢复')&&n.textContent.includes('密钥'))})()") as? Bool==true else{let detail=try evaluate(view,"JSON.stringify((()=>{const r=document.querySelector('.global-agent'),l=r.querySelector('.agent-log'),h=r.querySelector('.agent-head');return{scroll:r.scrollTop,rootTop:r.getBoundingClientRect().top,headTop:h.getBoundingClientRect().top,logWidth:l.clientWidth,logScrollWidth:l.scrollWidth,inputs:[...r.querySelectorAll('input,select')].map(n=>({hidden:!n.getClientRects().length,x:n.getBoundingClientRect().x,right:n.getBoundingClientRect().right}))}})())") as? String ?? "";throw appError("Settings control overflow or interactive credential recovery entry: "+id+" "+detail)}
   if id=="collage"{
    try capture(view,review.appendingPathComponent("settings-full.png"),width:1200)
    let geometry=try evaluate(view,"JSON.stringify((()=>{const r=document.querySelector('.global-agent'),h=r.querySelector('.agent-head'),l=r.querySelector('.agent-log');const box=n=>{const b=n.getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height,display:getComputedStyle(n).display,position:getComputedStyle(n).position}};return{root:box(r),head:box(h),log:box(l),rootScroll:r.scrollTop,bodyScroll:document.scrollingElement.scrollTop,viewport:{width:innerWidth,height:innerHeight}}})())") as! String
    try Data(geometry.utf8).write(to:review.appendingPathComponent("geometry.json"))
   }
   try capture(view,review.appendingPathComponent("settings/"+id+".png"),rect:rect,width:390)
   _=try evaluate(view,"document.querySelector('.agent-settings-footer button').click();document.querySelector('.agent-head button[title=收起]').click();void 0")
   try waitJS(view,"document.querySelector('.global-agent').hidden")
   window.setContentSize(NSSize(width:640,height:820));view.setFrameSize(NSSize(width:640,height:820));RunLoop.current.run(until:Date().addingTimeInterval(0.05))
   let compact=try evaluate(view,"document.documentElement.scrollWidth<=innerWidth+1 && [...document.querySelectorAll('.classroom-page .course-card h3')].every(n=>n.getBoundingClientRect().right<=innerWidth+1)") as? Bool
   guard compact==true else{throw appError("Compact theme overflow: "+id)}
   window.setContentSize(NSSize(width:1200,height:820));view.setFrameSize(NSSize(width:1200,height:820))
  }
  let afterRequests=(try evaluate(view,"window.__smoke.requests.length")) as? Int ?? -2
  guard beforeRequests==afterRequests else{throw appError("Changing appearance unexpectedly requested course resources")}
  _=try evaluate(view,"document.querySelector('.course-card .primary').click();void 0")
  try waitJS(view,"!!document.querySelector('#stage .parity-pane') && !!document.querySelector('.notes-editor')")
  _=try evaluate(view,"window.__themeLiveNodes=[...document.querySelectorAll('#stage .parity-pane')];window.__themeEditor=document.querySelector('.notes-editor');void 0")
  app.event("toolbarAction","agent");try waitJS(view,"!!document.querySelector('.global-agent:not([hidden])')")
  for id in app.themeIdentifiers{
   app.applyTheme(id);try waitJS(view,"document.documentElement.dataset.theme==='"+id+"'")
   guard try evaluate(view,"window.__themeLiveNodes.every(n=>n.isConnected)&&window.__themeEditor===document.querySelector('.notes-editor')") as? Bool==true else{throw appError("Theme replaced live study nodes: "+id)}
   let matching=try evaluate(view,"(()=>{const agent=document.querySelector('.global-agent'),pane=document.querySelector('.parity-pane[data-pane=transcript]'),a=getComputedStyle(agent),p=getComputedStyle(pane),title=getComputedStyle(agent.querySelector('.pane-title')),pt=getComputedStyle(pane.querySelector('.pane-title'));return agent.parentElement===document.body && Number(a.zIndex)>1000 && a.borderRadius===p.borderRadius && title.fontSize===pt.fontSize && getComputedStyle(agent.querySelector('.agent-head')).backgroundColor===getComputedStyle(pane.querySelector('.pane-header')).backgroundColor})()") as? Bool
   guard matching==true else{throw appError("Floating assistant and pane surfaces differ: "+id)}
   try capture(view,review.appendingPathComponent("study/"+id+".png"),width:1200)
  }
  // The native toolbar dispatches a route event to the existing main WebView.
  app.event("toolbarAction","theme");let picker=view
  try waitJS(picker,"document.querySelectorAll('.theme-choice').length===20")
  // Loading all actual previews is intentional here, independent of lazy display.
  _=try evaluate(picker,"document.querySelectorAll('.theme-choice img').forEach(n=>n.loading='eager');void 0")
  try waitJS(picker,"[...document.querySelectorAll('.theme-choice img')].every(n=>n.complete&&n.naturalWidth>100)")
  guard try evaluate(picker,"[...document.querySelectorAll('.theme-choice img')].every(n=>{const r=n.getBoundingClientRect();return Math.abs(r.height-r.width*820/1200)<2})") as? Bool==true else{throw appError("Picker previews must show the entire homepage at its captured aspect ratio")}
  guard try evaluate(picker,"[...document.querySelectorAll('.theme-choice')].every(n=>n.getBoundingClientRect().height>=n.querySelector('img').getBoundingClientRect().height+50)") as? Bool==true else{throw appError("Theme choice must show the whole image and its caption, without inheriting the global button height")}
  for id in app.themeIdentifiers{
   _=try evaluate(picker,"document.querySelector('.theme-choice[data-theme=\""+id+"\"]').click();void 0")
   try waitJS(picker,"document.querySelector('.theme-choice[data-theme=\""+id+"\"]').getAttribute('aria-pressed')==='true'")
   guard app.selectedTheme==id else{throw appError("Picker did not persist theme: "+id)}
   guard try evaluate(view,"document.documentElement.dataset.theme==='"+id+"' && document.querySelectorAll('.theme-choice').length===20") as? Bool==true else{throw appError("Picker did not update live main view: "+id)}
  }
  var pickerCaptured=false,pickerPNG:Data?
  let pickerSnapshot=WKSnapshotConfiguration();pickerSnapshot.afterScreenUpdates=true;pickerSnapshot.snapshotWidth=510
  picker.takeSnapshot(with:pickerSnapshot){image,_ in if let image=image,let tiff=image.tiffRepresentation,let bitmap=NSBitmapImageRep(data:tiff){pickerPNG=bitmap.representation(using:.png,properties:[:])};pickerCaptured=true}
  try smokeWait({pickerCaptured});if let png=pickerPNG{try png.write(to:temporary.appendingPathComponent("theme-picker-validated.png"))}
  guard !window.isVisible else{throw appError("Theme validation unexpectedly displayed a window")}
  _=try evaluate(view,"document.querySelector('.theme-choice[data-theme=film]').click();void 0")
  try waitJS(view,"document.querySelector('.theme-choice[data-theme=film]').getAttribute('aria-pressed')==='true'")
  _=try evaluate(view,"document.querySelector('.theme-choice[data-theme=film]').click();void 0")
  try waitJS(view,"!!document.querySelector('#stage .parity-pane') && !!document.querySelector('.notes-editor')")
  _=try evaluate(view,"[...document.querySelectorAll('#navigation button')].find(n=>n.textContent==='我的课堂').click();void 0")
  try waitJS(view,"!!document.querySelector('.classroom-page')")
  _=try evaluate(view,"[...document.querySelectorAll('.toolbar button')].find(n=>n.textContent==='所有课程').click();void 0")
  try waitJS(view,"[...document.querySelectorAll('button')].some(n=>n.textContent==='按日期')")
  guard try evaluate(view,"![...document.querySelectorAll('#content button')].some(n=>n.textContent==='选择日期')") as? Bool==true else{throw appError("Course grouping must not expose the date picker")}
  for id in app.themeIdentifiers {
   app.applyTheme(id)
   _=try evaluate(view,"[...document.querySelectorAll('#content button')].find(n=>n.textContent==='按日期').click();void 0")
   try waitJS(view,"[...document.querySelectorAll('#content button')].some(n=>n.textContent==='选择日期'&&n.getBoundingClientRect().width>0)")
   _=try evaluate(view,"[...document.querySelectorAll('#content button')].find(n=>n.textContent==='按课程').click();void 0")
   try waitJS(view,"![...document.querySelectorAll('#content button')].some(n=>n.textContent==='选择日期')")
  }
  _=try evaluate(view,"[...document.querySelectorAll('#content button')].find(n=>n.textContent==='按日期').click();void 0")
  try waitJS(view,"[...document.querySelectorAll('button')].some(n=>n.textContent==='选择日期')")
  _=try evaluate(view,"[...document.querySelectorAll('button')].find(n=>n.textContent==='选择日期').click();void 0")
  try waitJS(view,"document.querySelectorAll('.calendar-head svg').length===4")
  let calendars=temporary.appendingPathComponent("theme-calendars");try FileManager.default.createDirectory(at:calendars,withIntermediateDirectories:true)
  for id in app.themeIdentifiers{
   app.applyTheme(id);try waitJS(view,"document.documentElement.dataset.theme==='"+id+"' && [...document.querySelectorAll('.calendar-head [data-ui-icon]')].every(n=>n.dataset.iconTheme==='"+id+"')")
   RunLoop.current.run(until:Date().addingTimeInterval(0.1))
   var captured=false,png:Data?;let options=WKSnapshotConfiguration();options.afterScreenUpdates=true;options.snapshotWidth=600
   view.takeSnapshot(with:options){image,_ in if let data=image?.tiffRepresentation,let bitmap=NSBitmapImageRep(data:data){png=bitmap.representation(using:.png,properties:[:])};captured=true}
   try smokeWait({captured});guard let data=png else{throw appError("Calendar snapshot unavailable")};try data.write(to:calendars.appendingPathComponent(id+".png"))
  }
  _=try evaluate(view,"document.querySelector('#modalClose').click();[...document.querySelectorAll('#topActions button')].find(n=>n.textContent==='批量下载')?.click();void 0")
  try waitJS(view,"document.querySelector('#modalTitle').textContent==='批量下载'")
  for id in app.themeIdentifiers {
   app.applyTheme(id)
   try waitJS(view,"[...document.querySelectorAll('#modalToolbar button')].some(n=>n.textContent==='选择日期'&&getComputedStyle(n).display==='none')")
   _=try evaluate(view,"[...document.querySelectorAll('#modalToolbar button')].find(n=>n.textContent==='按日期').click();void 0")
   try waitJS(view,"[...document.querySelectorAll('#modalToolbar button')].some(n=>n.textContent==='选择日期'&&getComputedStyle(n).display!=='none')")
   _=try evaluate(view,"[...document.querySelectorAll('#modalToolbar button')].find(n=>n.textContent==='按课程').click();void 0")
  }
  let errors=try evaluate(view,"window.__smoke.errors") as? [String] ?? [];guard errors.isEmpty else{throw appError("Page errors: "+errors.joined(separator:"; "))}
  let manifest:[String:Any]=["status":"passed","themes":records,"themeCount":records.count,"compactWidth":640,"captureViewport":[1200,820],"source":"Actual production index.html and modules rendered by macOS WKWebView with synthetic course data","pickerChoicesVerified":20,"preservedStudyNodeChecks":20,"themePageInMainWindow":true,"twoClickSelectionReturnsToStudy":true,"datePickerOnlyInDateMode":true,"dateGroupingThemeChecks":20,"batchDateVisibilityThemeChecks":20,"unexpectedCourseRequests":afterRequests-beforeRequests,"foregroundWindows":false,"assistantThemesReviewed":20,"assistantSettingsThemesReviewed":20,"studyThemesReviewed":20]
  try JSONSerialization.data(withJSONObject:manifest,options:[.prettyPrinted,.sortedKeys]).write(to:temporary.appendingPathComponent("theme-validation.json"))
  window.contentView=nil;window.close();server.listener.cancel();print("Twenty themes, real screenshots, picker selection and live study preservation passed")
 }
}
