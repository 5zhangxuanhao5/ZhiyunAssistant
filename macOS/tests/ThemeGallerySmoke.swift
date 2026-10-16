import Cocoa
import WebKit
import CryptoKit
@main struct ThemeGallerySmoke {
 static func main(){do{try run()}catch{fputs(error.localizedDescription+"\n",stderr);exit(1)}}
 static func evaluate(_ view:WKWebView,_ js:String)throws->Any?{try smokeEvaluate(view,js)}
 static func waitJS(_ view:WKWebView,_ js:String,seconds:Double=20)throws{do{try smokeWait({(try? evaluate(view,js)) as? Bool == true},seconds:seconds)}catch{let state=(try? evaluate(view,"JSON.stringify({title:document.querySelector('#pageTitle')?.textContent,errors:window.__smoke?.errors,status:document.querySelector('#selectedTheme')?.textContent,messages:window.__actualThemeMessages})")) as? String ?? "none";throw appError("Theme wait failed: "+js+" state: "+state)}}
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
  var records=[[String:Any]](),hashes=Set<String>()
  let beforeRequests=(try evaluate(view,"window.__smoke.requests.length")) as? Int ?? -1
  for id in app.themeIdentifiers{
   app.applyTheme(id);try waitJS(view,"document.documentElement.dataset.theme==='"+id+"' && [...document.querySelectorAll('.theme-icon')].every(n=>n.complete&&n.naturalWidth>0)")
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
  for id in app.themeIdentifiers{
   app.applyTheme(id);try waitJS(view,"document.documentElement.dataset.theme==='"+id+"'")
   guard try evaluate(view,"window.__themeLiveNodes.every(n=>n.isConnected)&&window.__themeEditor===document.querySelector('.notes-editor')") as? Bool==true else{throw appError("Theme replaced live study nodes: "+id)}
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
  let manifest:[String:Any]=["status":"passed","themes":records,"themeCount":records.count,"compactWidth":640,"captureViewport":[1200,820],"source":"Actual production index.html and modules rendered by macOS WKWebView with synthetic course data","pickerChoicesVerified":20,"preservedStudyNodeChecks":20,"themePageInMainWindow":true,"twoClickSelectionReturnsToStudy":true,"datePickerOnlyInDateMode":true,"dateGroupingThemeChecks":20,"batchDateVisibilityThemeChecks":20,"unexpectedCourseRequests":afterRequests-beforeRequests,"foregroundWindows":false]
  try JSONSerialization.data(withJSONObject:manifest,options:[.prettyPrinted,.sortedKeys]).write(to:temporary.appendingPathComponent("theme-validation.json"))
  window.contentView=nil;window.close();server.listener.cancel();print("Twenty themes, real screenshots, picker selection and live study preservation passed")
 }
}
