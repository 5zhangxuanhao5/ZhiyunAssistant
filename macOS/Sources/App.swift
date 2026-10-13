import Cocoa
import WebKit
import Network
import Security
import CryptoKit
import UniformTypeIdentifiers
import ImageIO

func appError(_ message:String, code:Int=1)->NSError { NSError(domain:"智云助手",code:code,userInfo:[NSLocalizedDescriptionKey:message]) }

func digest(_ value: String) -> String { SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined() }
func trusted(_ u: URL) -> Bool {
    guard u.scheme == "https", u.user == nil, u.password == nil, u.port == nil || u.port == 443, let h = u.host?.lowercased() else { return false }
    return ["zju.edu.cn", "chinamcloud.com", "chinamcloud.cn", "chinamcache.com"].contains { h == $0 || h.hasSuffix("." + $0) }
}
func keychain(_ name: String, _ data: Data? = nil, remove: Bool = false) -> Data? {
    let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "cn.suike.slides.mac", kSecAttrAccount as String: name]
    if remove { SecItemDelete(query as CFDictionary); return nil }
    if let data = data {
        let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound { var add = query; add[kSecValueData as String] = data; add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly; SecItemAdd(add as CFDictionary, nil) }; return data
    }
    var q = query; q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
    var output: CFTypeRef?; return SecItemCopyMatching(q as CFDictionary, &output) == errSecSuccess ? output as? Data : nil
}
func requestedByteRange(_ value:String?,size:Int)throws->(start:Int,end:Int,partial:Bool){
    guard size>=0 else{throw appError("文件大小无效")};guard let value=value else{return (0,max(0,size-1),false)}
    guard value.hasPrefix("bytes="),!value.contains(","),size>0 else{throw appError("请求范围无效",code:416)}
    let bounds=value.dropFirst(6).split(separator:"-",omittingEmptySubsequences:false);guard bounds.count==2 else{throw appError("请求范围无效",code:416)}
    if bounds[0].isEmpty,let suffix=Int(bounds[1]),suffix>0{return (max(0,size-suffix),size-1,true)}
    guard let first=Int(bounds[0]),first>=0,first<size else{throw appError("请求范围无效",code:416)}
    if bounds[1].isEmpty{return (first,size-1,true)}
    guard let last=Int(bounds[1]),last>=first else{throw appError("请求范围无效",code:416)};return (first,min(last,size-1),true)
}
func proxyResourceURL(_ address:String,origin:String,token:String)->String?{
    guard let url=URL(string:address),trusted(url),let encoded=url.absoluteString.addingPercentEncoding(withAllowedCharacters:.urlQueryAllowed.subtracting(CharacterSet(charactersIn:"&+?#%"))) else{return nil};return origin+"/"+token+"/remote?url="+encoded
}
func rewritePlaylist(_ text:String,base:URL,proxy:(String)->String?)->String{
    func address(_ raw:String)->String{guard let next=URL(string:raw,relativeTo:base)?.absoluteURL,let rewritten=proxy(next.absoluteString) else{return raw};return rewritten}
    let expression=try? NSRegularExpression(pattern:"URI=\"([^\"]+)\"")
    return text.components(separatedBy:"\n").map{line -> String in let trimmed=line.trimmingCharacters(in:.whitespacesAndNewlines);if !trimmed.isEmpty && !trimmed.hasPrefix("#"){return address(trimmed)};var output=line;for match in expression?.matches(in:line,range:NSRange(line.startIndex...,in:line)).reversed() ?? []{if let range=Range(match.range(at:1),in:output){output.replaceSubrange(range,with:address(String(output[range])))}};return output}.joined(separator:"\n")
}
func resolvedDeepSeekModel(_ requested:String,hasImages:Bool)->String?{
    let value=requested=="deepseek-pro" ? "deepseek-v4-pro":requested
    guard ["deepseek-flash","deepseek-v4-pro","deepseek-chat","deepseek-reasoner"].contains(value) else{return nil}
    return hasImages ? "deepseek-flash":value
}
func noteAssetRelativePath(_ value:String)->String?{
    value.range(of:"^note-assets/[a-f0-9]{64}\\.(png|jpg|webp|gif|avif)$",options:.regularExpression)==nil ? nil:value
}
func decodedNoteImage(_ value:String)throws->(data:Data,extension:String){
    guard value.utf8.count<=45*1024*1024,let comma=value.firstIndex(of:",") else{throw appError("图片过大，请使用32MB以内的图片")}
    let header=String(value[..<comma]).lowercased(),types=["data:image/png;base64":"png","data:image/jpeg;base64":"jpg","data:image/jpg;base64":"jpg","data:image/webp;base64":"webp","data:image/gif;base64":"gif","data:image/avif;base64":"avif"]
    guard let expected=types[header],let data=Data(base64Encoded:String(value[value.index(after:comma)...])),!data.isEmpty,data.count<=32*1024*1024,let source=CGImageSourceCreateWithData(data as CFData,nil),let type=CGImageSourceGetType(source),let properties=CGImageSourceCopyPropertiesAtIndex(source,0,nil) as? [String:Any],let width=properties[kCGImagePropertyPixelWidth as String] as? Int,let height=properties[kCGImagePropertyPixelHeight as String] as? Int,width>0,height>0,width<=32768,height<=32768,width*height<=32*1024*1024 else{throw appError("图片格式不受支持或尺寸过大")}
    let identifier=type as String,actual=identifier==UTType.png.identifier ? "png":identifier==UTType.jpeg.identifier ? "jpg":identifier==UTType.gif.identifier ? "gif":identifier.contains("webp") ? "webp":identifier.contains("avif") ? "avif":""
    guard actual==expected else{throw appError("图片内容与格式不一致")};return (data,actual)
}
func storeNoteImage(_ value:String,in dataFolder:URL)throws->String{
    let image=try decodedNoteImage(value),hash=SHA256.hash(data:image.data).map{String(format:"%02x",$0)}.joined(),relative="note-assets/"+hash+"."+image.extension,path=dataFolder.appendingPathComponent(relative)
    try FileManager.default.createDirectory(at:path.deletingLastPathComponent(),withIntermediateDirectories:true)
    if (try? path.resourceValues(forKeys:[.fileSizeKey]).fileSize) != image.data.count{try image.data.write(to:path,options:.atomic)}
    return relative
}
func noteAssetURL(_ relative:String,in dataFolder:URL)throws->URL{
    guard let safe=noteAssetRelativePath(relative) else{throw appError("笔记图片地址无效")};return dataFolder.appendingPathComponent(safe)
}
final class Download: NSObject, URLSessionDownloadDelegate {
    let destination: URL, event: (Int64,Int64)->Void, finish: (Result<String,Error>)->Void
    private let lock=NSLock()
    private var cancelled=false, completed=false
    private var task: URLSessionDownloadTask?, session: URLSession!
    func cancel(){lock.lock();cancelled=true;let current=task;lock.unlock();current?.cancel()}
    private func complete(_ result:Result<String,Error>){lock.lock();guard !completed else{lock.unlock();return};completed=true;lock.unlock();finish(result)}
    init(_ request: URLRequest, destination: URL, event: @escaping (Int64,Int64)->Void, finish: @escaping (Result<String,Error>)->Void) {
        self.destination=destination; self.event=event; self.finish=finish; super.init()
        let config=URLSessionConfiguration.ephemeral; config.timeoutIntervalForRequest=30; config.timeoutIntervalForResource=7200;config.httpCookieStorage=nil;config.urlCache=nil
        session=URLSession(configuration:config,delegate:self,delegateQueue:nil); task=session.downloadTask(with:request); task?.resume()
    }
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {lock.lock();let active = !cancelled && !completed;lock.unlock();if active{event(totalBytesWritten,totalBytesExpectedToWrite)}}
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        // Cancellation and committing a completed file share a lock: deleting a lesson cannot
        // race with a late completion and recreate resources after deletion.
        lock.lock();guard !cancelled else{lock.unlock();complete(.failure(appError("已暂停",code:NSUserCancelledError)));return}
        guard let response=downloadTask.response as? HTTPURLResponse,(200..<300).contains(response.statusCode) else{lock.unlock();complete(.failure(appError("资源不可访问或登录已失效")));return}
        let ext=destination.pathExtension.lowercased(),mime=response.mimeType?.lowercased() ?? ""
        guard !(["mp4","ts","m4s","key","jpg","jpeg","png","webp"].contains(ext) && mime.contains("text/html")) else{lock.unlock();complete(.failure(appError("服务器返回登录页面，未保存为课程资源")));return}
        let result:Result<String,Error>
        do {
            try FileManager.default.createDirectory(at:destination.deletingLastPathComponent(),withIntermediateDirectories:true)
            if FileManager.default.fileExists(atPath:destination.path){_ = try FileManager.default.replaceItemAt(destination,withItemAt:location)}else{try FileManager.default.moveItem(at:location,to:destination)}
            result = .success(destination.lastPathComponent)
        }catch{result = .failure(error)}
        lock.unlock();complete(result)
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {if let error=error{complete(.failure(error))};session.finishTasksAndInvalidate()}
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?)->Void) {
        guard let target=request.url,trusted(target) else{completionHandler(nil);return};var next=request
        if target.host != response.url?.host {next.setValue(nil,forHTTPHeaderField:"Cookie");next.setValue(nil,forHTTPHeaderField:"Authorization")}
        completionHandler(next)
    }
}
final class App: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate, NSWindowDelegate, URLSessionTaskDelegate, WKUIDelegate {
    var window: NSWindow!, web: WKWebView!, login: NSWindow?, loginWeb: WKWebView?
    var listener: NWListener!, origin="", token=UUID().uuidString, account="guest", downloads=[String:Download](), requests=[String:URLSessionDataTask](), cancelledRequests=Set<String>(),pendingRequests=Set<String>()
    let fm=FileManager.default, store=WKWebsiteDataStore.nonPersistent()
    let storageQueue=DispatchQueue(label:"cn.suike.mac.storage",qos:.utility)
    var loggingOut=false, lastWebRecovery=Date.distantPast
    var pendingDownloads=[String:URL](),cancelledDownloads=Set<String>()
    var remoteTransfers=[UUID:RemoteTransfer]()
    private var flushPending=false,flushCallbacks=[()->Void](),closingMainWindow=false,mainWindowFlushed=false,terminationPending=false
    private var flushDeadline:DispatchWorkItem?,flushGeneration=UUID()
    #if NATIVE_CONTRACT_TESTS
    // The isolated WebKit harness exercises the real delegate routing without opening
    // a sheet, accessing accounts, or taking over the user's foreground window.
    var testDialogResponder:((String,String,String?)->String?)?
    var testSkipCookiePersistence=false
    #endif
    lazy var root: URL = { let path=fm.urls(for:.applicationSupportDirectory,in:.userDomainMask)[0].appendingPathComponent("智云助手 Mac"); try? fm.createDirectory(at:path,withIntermediateDirectories:true); return path }()
    var queue=DispatchQueue(label:"cn.suike.mac.http",qos:.userInitiated)
    lazy var network: URLSession = { let c=URLSessionConfiguration.ephemeral; c.timeoutIntervalForRequest=20; c.timeoutIntervalForResource=90; c.httpCookieStorage=nil; c.urlCache=nil; return URLSession(configuration:c,delegate:self,delegateQueue:nil) }()
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular); setupMenu()
        let config=WKWebViewConfiguration(); config.websiteDataStore=store; config.userContentController.add(self,name:"native"); config.preferences.javaScriptCanOpenWindowsAutomatically=false
        web=WKWebView(frame:.zero,configuration:config); web.navigationDelegate=self;web.uiDelegate=self
        window=NSWindow(contentRect:NSRect(x:0,y:0,width:1320,height:850),styleMask:[.titled,.closable,.miniaturizable,.resizable],backing:.buffered,defer:false)
        window.isReleasedWhenClosed=false; window.title="智云助手"; window.minSize=NSSize(width:640,height:480); window.contentView=web; window.delegate=self;window.setFrameAutosaveName("StudyMainWindow");if !window.setFrameUsingName("StudyMainWindow"){window.center()};window.orderFront(nil)
        restoreCookies { self.startServer() }
    }
    func setupMenu() {
        let menu=NSMenu(); let appItem=NSMenuItem(); menu.addItem(appItem); let am=NSMenu(); appItem.submenu=am
        am.addItem(withTitle:"关于智云助手",action:#selector(about),keyEquivalent:""); am.addItem(.separator()); am.addItem(withTitle:"退出智云助手",action:#selector(NSApplication.terminate(_:)),keyEquivalent:"q")
        let editItem=NSMenuItem(); menu.addItem(editItem); let edit=NSMenu(title:"编辑"); editItem.submenu=edit
        for (title,selector,key) in [("撤销","undo:","z"),("重做","redo:","Z"),("剪切","cut:","x"),("复制","copy:","c"),("粘贴","paste:","v"),("全选","selectAll:","a")] { edit.addItem(withTitle:title,action:Selector(selector),keyEquivalent:key) }
        let viewItem=NSMenuItem(); menu.addItem(viewItem); let view=NSMenu(title:"窗口"); viewItem.submenu=view; view.addItem(withTitle:"全屏",action:#selector(NSWindow.toggleFullScreen(_:)),keyEquivalent:"f").keyEquivalentModifierMask=[.command,.control]; NSApp.mainMenu=menu
    }
    @objc func about() { NSApp.orderFrontStandardAboutPanel(options:[.applicationName:"智云助手",.applicationVersion:(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.0"),.credits:NSAttributedString(string:"独立课程学习工具。在线资源以校园账号权限为准。")]) }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender:NSApplication)->Bool{true}
    func applicationShouldTerminate(_ sender:NSApplication)->NSApplication.TerminateReply{
        if mainWindowFlushed{return .terminateNow}
        if !terminationPending{terminationPending=true;flushBeforeClosing{sender.reply(toApplicationShouldTerminate:true)}}
        return .terminateLater
    }
    func windowShouldClose(_ sender:NSWindow)->Bool{
        guard sender === window else{return true};if mainWindowFlushed{return true};if closingMainWindow{return false}
        closingMainWindow=true;flushBeforeClosing{self.mainWindowFlushed=true;sender.close()};return false
    }
    func flushBeforeClosing(_ done:@escaping()->Void){
        flushCallbacks.append(done);guard !flushPending else{return};flushPending=true;let generation=UUID();flushGeneration=generation
        let complete={
            guard self.flushPending,self.flushGeneration==generation else{return};self.flushPending=false;self.flushDeadline?.cancel();self.flushDeadline=nil
            let callbacks=self.flushCallbacks;self.flushCallbacks.removeAll();callbacks.forEach{$0()}
        }
        let deadline=DispatchWorkItem(block:complete);flushDeadline=deadline;DispatchQueue.main.asyncAfter(deadline:.now()+2,execute:deadline)
        let storageDone={self.storageQueue.async{DispatchQueue.main.async(execute:complete)}}
        let scriptDone={
            #if NATIVE_CONTRACT_TESTS
            if self.testSkipCookiePersistence{storageDone();return}
            #endif
            self.persistCookies{storageDone()}
        }
        guard let view=web else{DispatchQueue.main.async(execute:scriptDone);return}
        view.callAsyncJavaScript("if (typeof window.zhiyunFlush === 'function') { await window.zhiyunFlush(); } return true;",arguments:[:],in:nil,in:.page){_ in scriptDone()}
    }
    func applicationWillTerminate(_ notification: Notification) { downloads.values.forEach { $0.cancel() }; requests.values.forEach{$0.cancel()}; streams.values.forEach { $0.session.invalidateAndCancel() };remoteTransfers.values.forEach{$0.cancel()}; listener?.cancel() }
    func windowWillClose(_ notification: Notification) { if notification.object as? NSWindow === login { persistCookies(); login=nil; loginWeb=nil } }
    func webView(_ view: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy)->Void) {
        guard let u=navigationAction.request.url else { decisionHandler(.cancel); return }
        if view === web { decisionHandler(u.absoluteString.hasPrefix(origin + "/" + token + "/") || u.scheme == "about" ? .allow : .cancel) }
        else { decisionHandler(trusted(u) || u.scheme == "about" ? .allow : .cancel) }
    }
    func webView(_ view: WKWebView, didFinish navigation: WKNavigation!) {
        if view === loginWeb && !loggingOut { persistCookies(); if view.url?.host == "classroom.zju.edu.cn", !((view.url?.path ?? "").contains("login")) { DispatchQueue.main.asyncAfter(deadline:.now()+0.3) { self.event("login",["ready":true]) } } }
    }
    func webViewWebContentProcessDidTerminate(_ view:WKWebView){
        if view === web {
            guard Date().timeIntervalSince(lastWebRecovery)>15 else{event("webRecovery",["ready":false]);return}
            lastWebRecovery=Date();diagnostic("Web content process restarted");view.reload()
        }else if view === loginWeb {view.reload()}
    }
    func webView(_ view:WKWebView,createWebViewWith configuration:WKWebViewConfiguration,for action:WKNavigationAction,windowFeatures:WKWindowFeatures)->WKWebView?{
        // Official authentication occasionally uses target=_blank; keep it inside its
        // existing login window and do not create or activate another application.
        if view === loginWeb,action.targetFrame == nil,let url=action.request.url,trusted(url){view.load(action.request)}
        return nil
    }
    private func dialogWindow(_ view:WKWebView,_ frame:WKFrameInfo)->NSWindow?{
        guard let url=frame.request.url else{return nil}
        if view === web,url.absoluteString.hasPrefix(origin+"/"+token+"/"){return window}
        if view === loginWeb,trusted(url){return login}
        return nil
    }
    func webView(_ view:WKWebView,runJavaScriptAlertPanelWithMessage message:String,initiatedByFrame frame:WKFrameInfo,completionHandler:@escaping()->Void){
        guard let owner=dialogWindow(view,frame) else{completionHandler();return}
        #if NATIVE_CONTRACT_TESTS
        if let responder=testDialogResponder{_=responder("alert",message,nil);completionHandler();return}
        #endif
        let alert=NSAlert();alert.messageText="智云助手";alert.informativeText=message;alert.addButton(withTitle:"确定");alert.beginSheetModal(for:owner){_ in completionHandler()}
    }
    func webView(_ view:WKWebView,runJavaScriptConfirmPanelWithMessage message:String,initiatedByFrame frame:WKFrameInfo,completionHandler:@escaping(Bool)->Void){
        guard let owner=dialogWindow(view,frame) else{completionHandler(false);return}
        #if NATIVE_CONTRACT_TESTS
        if let responder=testDialogResponder{completionHandler(responder("confirm",message,nil)=="true");return}
        #endif
        let alert=NSAlert();alert.messageText="智云助手";alert.informativeText=message;alert.addButton(withTitle:"确定");alert.addButton(withTitle:"取消");alert.beginSheetModal(for:owner){response in completionHandler(response == .alertFirstButtonReturn)}
    }
    func webView(_ view:WKWebView,runJavaScriptTextInputPanelWithPrompt prompt:String,defaultText:String?,initiatedByFrame frame:WKFrameInfo,completionHandler:@escaping(String?)->Void){
        guard let owner=dialogWindow(view,frame) else{completionHandler(nil);return}
        #if NATIVE_CONTRACT_TESTS
        if let responder=testDialogResponder{completionHandler(responder("prompt",prompt,defaultText));return}
        #endif
        let alert=NSAlert();alert.messageText="智云助手";alert.informativeText=prompt;alert.addButton(withTitle:"确定");alert.addButton(withTitle:"取消")
        let input:NSTextField=(prompt.contains("密码") || prompt.contains("密钥")) ? NSSecureTextField(frame:NSRect(x:0,y:0,width:360,height:26)) : NSTextField(frame:NSRect(x:0,y:0,width:360,height:26));input.stringValue=defaultText ?? "";alert.accessoryView=input;alert.window.initialFirstResponder=input
        alert.beginSheetModal(for:owner){response in completionHandler(response == .alertFirstButtonReturn ? input.stringValue:nil)}
    }
    func absorbCookies(_ response:HTTPURLResponse){
        guard !loggingOut,let url=response.url,trusted(url) else{return}
        var headers=[String:String]();for(key,value) in response.allHeaderFields{if let name=key as? String{headers[name]=String(describing:value)}}
        let cookies=HTTPCookie.cookies(withResponseHeaderFields:headers,for:url)
        guard !cookies.isEmpty else{return};DispatchQueue.main.async{guard !self.loggingOut else{return};let group=DispatchGroup();for cookie in cookies{group.enter();self.store.httpCookieStore.setCookie(cookie){group.leave()}};group.notify(queue:.main){self.persistCookies()}}
    }
    func restoreCookies(_ done:@escaping()->Void) {
        guard let data=keychain("cookies"), let rows=try? JSONSerialization.jsonObject(with:data) as? [[String:Any]] else { done(); return }
        let group=DispatchGroup()
        for row in rows { guard let host=(row["domain"] ?? row["Domain"]) as? String,let url=URL(string:"https://"+host.trimmingCharacters(in:CharacterSet(charactersIn:"."))),trusted(url) else {continue}; var p:[HTTPCookiePropertyKey:Any]=[.name:row["name"] ?? row["Name"] ?? "",.value:row["value"] ?? row["Value"] ?? "",.domain:host,.path:row["path"] ?? row["Path"] ?? "/",.secure:"TRUE"]
            if let expires=row["expires"] as? Double { if expires<Date().timeIntervalSince1970 {continue};p[.expires]=Date(timeIntervalSince1970:expires) }
            if let c=HTTPCookie(properties:p) { group.enter();store.httpCookieStore.setCookie(c){group.leave()} }
        }; group.notify(queue:.main,execute:done)
    }
    func persistCookies(_ done:(()->Void)?=nil){
        guard !loggingOut else{done?();return}
        store.httpCookieStore.getAllCookies{cookies in
            guard !self.loggingOut else{done?();return}
            let rows=cookies.filter{$0.domain=="zju.edu.cn" || $0.domain.hasSuffix(".zju.edu.cn")}.map{cookie -> [String:Any] in var row:[String:Any]=["name":cookie.name,"value":cookie.value,"domain":cookie.domain,"path":cookie.path];if let expires=cookie.expiresDate{row["expires"]=expires.timeIntervalSince1970};return row}
            guard let data=try? JSONSerialization.data(withJSONObject:rows) else{done?();return}
            self.storageQueue.async{if !self.loggingOut{_=keychain("cookies",data)};DispatchQueue.main.async{done?()}}
        }
    }
    func cookieRequest(_ url:URL, body:String="", range:String?=nil, done:@escaping(URLRequest)->Void) {
        store.httpCookieStore.getAllCookies { cookies in
            var req=URLRequest(url:url); req.setValue("https://classroom.zju.edu.cn/",forHTTPHeaderField:"Referer"); req.setValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15",forHTTPHeaderField:"User-Agent")
            let allowed=cookies.filter { c in let d=c.domain.trimmingCharacters(in:CharacterSet(charactersIn:".")); return (url.host == d || url.host?.hasSuffix("."+d) == true) && (url.path == c.path || url.path.hasPrefix(c.path.hasSuffix("/") ? c.path:c.path+"/")) && (!c.isSecure || url.scheme == "https") && (c.expiresDate == nil || c.expiresDate! > Date()) }
            if !allowed.isEmpty { req.setValue(allowed.sorted{$0.path.count>$1.path.count}.map { $0.name+"="+$0.value }.joined(separator:"; "),forHTTPHeaderField:"Cookie") }
            if url.host == "classroom.zju.edu.cn", let value=allowed.first(where:{$0.name == "_token"})?.value.removingPercentEncoding, let regex=try? NSRegularExpression(pattern:"\\{i:\\d+;s:\\d+:\"_token\";i:\\d+;s:\\d+:\"(.+?)\";\\}"), let match=regex.firstMatch(in:value,range:NSRange(value.startIndex...,in:value)), let r=Range(match.range(at:1),in:value) { req.setValue("Bearer "+value[r],forHTTPHeaderField:"Authorization") }
            if !body.isEmpty { req.httpMethod="POST"; req.httpBody=Data(body.utf8); req.setValue("application/json",forHTTPHeaderField:"Content-Type") }; if let range=range { req.setValue(range,forHTTPHeaderField:"Range") }; done(req)
        }
    }
    func urlSession(_ session:URLSession,task:URLSessionTask,willPerformHTTPRedirection response:HTTPURLResponse,newRequest request:URLRequest,completionHandler:@escaping(URLRequest?)->Void){
        guard let url=request.url,trusted(url) else{completionHandler(nil);return};absorbCookies(response)
        DispatchQueue.main.async{self.cookieRequest(url,range:request.value(forHTTPHeaderField:"Range")){base in var next=base;next.httpMethod=request.httpMethod;next.httpBody=request.httpBody;if let value=request.value(forHTTPHeaderField:"Content-Type"){next.setValue(value,forHTTPHeaderField:"Content-Type")};completionHandler(next)}}
    }
    func scoped(_ category:String)->URL { root.appendingPathComponent(account).appendingPathComponent(category) }
    func cacheCategory(_ key:String)->String {if key.hasPrefix("vision-"){return "vision"};if key.hasPrefix("summary-"){return "summary"};if key.hasPrefix("chats-"){return "question"};if key.hasPrefix("skip-"){return "skip"};if key.hasPrefix("lesson-"){return "timeline"};return "schedule"}
    func cacheSettings()->[String:Bool] {guard let data=try? Data(contentsOf:scoped("data").appendingPathComponent("cache-settings.json")),let value=try? JSONSerialization.jsonObject(with:data) as? [String:Bool] else{return [:]};return value}
    func safeKey(_ key:String)->Bool { !key.isEmpty && key.count<200 && key.range(of:"^[A-Za-z0-9_.-]+$",options:.regularExpression) != nil && !key.contains("..") }
    func diagnostic(_ text:String){let path=root.appendingPathComponent("diagnostics.log");var lines=((try? String(contentsOf:path,encoding:.utf8)) ?? "").components(separatedBy:"\n").suffix(30).map{String($0)};lines.append(text);try? lines.joined(separator:"\n").write(to:path,atomically:true,encoding:.utf8)}
    func reply(_ id:String, _ value:Any?=nil, _ error:String?=nil) { let payload:[String:Any]=["id":id,"value":value ?? NSNull(),"error":error ?? NSNull()]; js("window.native.receive",payload) }
    func event(_ name:String,_ value:Any) { js("window.native.event",["name":name,"value":value]) }
    func js(_ function:String,_ value:Any) { guard let data=try? JSONSerialization.data(withJSONObject:value),let json=String(data:data,encoding:.utf8) else { return }; DispatchQueue.main.async { self.web?.evaluateJavaScript(function+"("+json+")",completionHandler:nil) } }
    func userContentController(_ userContentController:WKUserContentController,didReceive message:WKScriptMessage) {
        guard message.frameInfo.isMainFrame, message.frameInfo.request.url?.absoluteString.hasPrefix(origin+"/"+token+"/") == true, let args=message.body as? [String:Any], let id=args["id"] as? String, let action=args["action"] as? String else { return }
        let p=args["params"] as? [String:Any] ?? [:]
        switch action {
        case "request":
            guard let url=URL(string:p["url"] as? String ?? ""), trusted(url), ["classroom.zju.edu.cn","interactivemeta.cmc.zju.edu.cn"].contains(url.host ?? "") else { reply(id,nil,"不受支持的课程地址"); return }
            pendingRequests.insert(id);cookieRequest(url,body:p["body"] as? String ?? ""){req in
                self.pendingRequests.remove(id);guard self.cancelledRequests.remove(id) == nil else{self.reply(id,nil,"请求已取消");return}
                let task=self.network.dataTask(with:req){data,response,error in
                    DispatchQueue.main.async{self.requests.removeValue(forKey:id);if self.cancelledRequests.remove(id) != nil{self.reply(id,nil,"请求已取消");return};if let error=error{self.diagnostic("API error: "+error.localizedDescription);self.reply(id,nil,error.localizedDescription);return};guard let data=data,data.count<16*1024*1024,let response=response as? HTTPURLResponse else{self.reply(id,nil,"课程响应异常");return};self.absorbCookies(response);self.diagnostic("API "+url.path+" status "+String(response.statusCode));self.reply(id,["status":response.statusCode,"text":String(data:data,encoding:.utf8) ?? ""])}
                };self.requests[id]=task;task.resume()
            }
        case "cancelRequest":
            if let target=p["id"] as? String,pendingRequests.contains(target) || requests[target] != nil{cancelledRequests.insert(target);requests[target]?.cancel()};reply(id,true)
        case "login":
            loggingOut=false
            if let login=login { login.makeKeyAndOrderFront(nil); reply(id,true); return }
            let config=WKWebViewConfiguration(); config.websiteDataStore=store
            let view=WKWebView(frame:.zero,configuration:config); view.navigationDelegate=self;view.uiDelegate=self; loginWeb=view
            let w=NSWindow(contentRect:NSRect(x:0,y:0,width:980,height:730),styleMask:[.titled,.closable,.resizable],backing:.buffered,defer:false); w.isReleasedWhenClosed=false; w.title="登录智云课堂 · 浙江大学官方认证"; w.contentView=view; w.delegate=self; w.center(); w.makeKeyAndOrderFront(nil); login=w
            view.load(URLRequest(url:URL(string:"https://classroom.zju.edu.cn/")!)); reply(id,true)
        case "loginDone": persistCookies(); login?.close(); reply(id,true)
        case "logout":
            loggingOut=true;for operation in pendingRequests{cancelledRequests.insert(operation)};for operation in pendingDownloads.keys{cancelledDownloads.insert(operation)};requests.values.forEach{$0.cancel()};requests.removeAll();downloads.values.forEach{$0.cancel()};streams.values.forEach{$0.session.invalidateAndCancel()};login?.close()
            store.httpCookieStore.getAllCookies{cookies in let group=DispatchGroup();for cookie in cookies{group.enter();self.store.httpCookieStore.delete(cookie){group.leave()}};group.notify(queue:.main){self.storageQueue.async{_=keychain("cookies",remove:true);_=keychain("identity",remove:true);DispatchQueue.main.async{self.account="guest";self.reply(id,true)}}}}
        case "identity":
            if let text=p["text"] as? String { _=keychain("identity",Data(text.utf8)); reply(id,true) } else { reply(id,String(data:keychain("identity") ?? Data(),encoding:.utf8) ?? "") }
        case "account": account=digest(p["id"] as? String ?? "guest"); reply(id,true)
        case "read":
            guard let key=p["key"] as? String,safeKey(key) else{reply(id,nil,"文件名无效");return}
            let cached=p["cache"] as? Bool == true,enabled=cacheSettings()[cacheCategory(key)] != false,path=scoped(cached ? "cache":"data").appendingPathComponent(key)
            if cached && !enabled{reply(id,"");return}
            storageQueue.async{guard let size=(try? path.resourceValues(forKeys:[.fileSizeKey]))?.fileSize,size<=32*1024*1024 else{self.reply(id,"");return};self.reply(id,(try? String(contentsOf:path,encoding:.utf8)) ?? "")}
        case "write":
            guard let key=p["key"] as? String,safeKey(key),let text=p["text"] as? String,text.utf8.count<32*1024*1024 else{reply(id,nil,"文件内容无效");return}
            let cached=p["cache"] as? Bool == true,enabled=cacheSettings()[cacheCategory(key)] != false,path=scoped(cached ? "cache":"data").appendingPathComponent(key)
            if cached && !enabled{reply(id,true);return}
            storageQueue.async{do{try self.fm.createDirectory(at:path.deletingLastPathComponent(),withIntermediateDirectories:true);try text.write(to:path,atomically:true,encoding:.utf8);self.reply(id,true)}catch{self.reply(id,nil,error.localizedDescription)}}
        case "secret":
            let name=account+"-deepseek";if p["remove"] as? Bool == true{_=keychain(name,remove:true);reply(id,true)}else if let text=p["text"] as? String{_=keychain(name,Data(text.utf8));reply(id,true)}else{reply(id,String(data:keychain(name) ?? Data(),encoding:.utf8) ?? "")}
        case "cache":
            let cache=scoped("cache"),images=scoped("images"),settingsFile=scoped("data").appendingPathComponent("cache-settings.json"),known=["schedule","timeline","vision","summary","question","skip","images"]
            var settings=cacheSettings()
            if let category=p["category"] as? String,let enabled=p["enabled"] as? Bool {
                guard known.contains(category) else{reply(id,nil,"缓存分类无效");return};settings[category]=enabled;let value=settings
                storageQueue.async{do{try self.fm.createDirectory(at:settingsFile.deletingLastPathComponent(),withIntermediateDirectories:true);try JSONSerialization.data(withJSONObject:value).write(to:settingsFile,options:.atomic);self.reply(id,true)}catch{self.reply(id,nil,error.localizedDescription)}};return
            }
            if p["clear"] as? Bool == true {
                let category=p["category"] as? String,keys=p["keys"] as? [String]
                if let category=category,!known.contains(category){reply(id,nil,"缓存分类无效");return}
                storageQueue.async{
                    do{
                        if let category=category,let keys=keys {
                            for key in keys where self.safeKey(key){let path=category=="images" ? images.appendingPathComponent(key):cache.appendingPathComponent(key);if category=="images" || self.cacheCategory(key)==category{if self.fm.fileExists(atPath:path.path){try self.fm.removeItem(at:path)}}}
                        }else if let category=category {
                            if category=="images"{if self.fm.fileExists(atPath:images.path){try self.fm.removeItem(at:images)}}else{for path in (try? self.fm.contentsOfDirectory(at:cache,includingPropertiesForKeys:nil)) ?? [] where self.cacheCategory(path.lastPathComponent)==category{try self.fm.removeItem(at:path)}}
                        }else {
                            for path in [cache,images,self.root.appendingPathComponent("diagnostics.log")]{if self.fm.fileExists(atPath:path.path){try self.fm.removeItem(at:path)}}
                        }
                        if category==nil{DispatchQueue.main.async{self.store.removeData(ofTypes:[WKWebsiteDataTypeDiskCache,WKWebsiteDataTypeMemoryCache],modifiedSince:.distantPast){self.reply(id,true)}}}else{self.reply(id,true)}
                    }catch{self.reply(id,nil,error.localizedDescription)}
                }
            }else {
                let value=settings;storageQueue.async{var entries=[String:[[String:Any]]]();for category in known{entries[category]=[]}
                    for (category,folder) in [("cache",cache),("images",images)]{for path in (try? self.fm.contentsOfDirectory(at:folder,includingPropertiesForKeys:[.fileSizeKey])) ?? []{let key=path.lastPathComponent,name=category=="images" ? "images":self.cacheCategory(key),size=(try? path.resourceValues(forKeys:[.fileSizeKey]).fileSize) ?? 0;entries[name,default:[]].append(["key":key,"bytes":size])}}
                    self.reply(id,["entries":entries,"settings":value])
                }
            }
        case "resourceSize":
            guard let url=URL(string:p["url"] as? String ?? ""),trusted(url) else{reply(id,nil,"资源地址不支持");return}
            cookieRequest(url){request in var request=request;request.httpMethod="HEAD";self.network.dataTask(with:request){_,response,error in if let error=error{self.reply(id,nil,error.localizedDescription)}else if let response=response as? HTTPURLResponse,(200..<300).contains(response.statusCode){self.absorbCookies(response);self.reply(id,max(0,response.expectedContentLength))}else{self.reply(id,0)}}.resume()}
        case "saveResource":
            guard let key=p["lesson"] as? String,safeKey(key),let name=p["name"] as? String,safeKey(name),let url=URL(string:p["url"] as? String ?? ""),trusted(url) else{reply(id,nil,"下载参数无效");return}
            let path=scoped("offline").appendingPathComponent(key).appendingPathComponent(name);pendingDownloads[id]=path
            storageQueue.async{
                let existing=(try? path.resourceValues(forKeys:[.fileSizeKey]).fileSize) ?? 0
                DispatchQueue.main.async{
                    guard self.pendingDownloads[id] != nil,self.cancelledDownloads.remove(id)==nil else{self.pendingDownloads.removeValue(forKey:id);self.reply(id,nil,"已暂停");return}
                    if existing>0{self.pendingDownloads.removeValue(forKey:id);self.reply(id,["name":name,"size":existing]);return}
                    self.cookieRequest(url){request in
                        self.pendingDownloads.removeValue(forKey:id);guard self.cancelledDownloads.remove(id)==nil else{self.reply(id,nil,"已暂停");return}
                        let job=Download(request,destination:path,event:{bytes,total in self.event("download",["id":id,"bytes":bytes,"total":total])},finish:{result in DispatchQueue.main.async{self.downloads.removeValue(forKey:id);self.cancelledDownloads.remove(id);switch result{case .success(let name):self.reply(id,["name":name,"size":(try? path.resourceValues(forKeys:[.fileSizeKey]).fileSize) ?? 0]);case .failure(let error):self.reply(id,nil,error.localizedDescription)}}});self.downloads[id]=job
                    }
                }
            }
        case "writeOffline":
            guard let key=p["lesson"] as? String,safeKey(key),let name=p["name"] as? String,safeKey(name),let text=p["text"] as? String,text.utf8.count<32*1024*1024 else{reply(id,nil,"下载参数无效");return}
            let path=scoped("offline").appendingPathComponent(key).appendingPathComponent(name);storageQueue.async{do{try self.fm.createDirectory(at:path.deletingLastPathComponent(),withIntermediateDirectories:true);try text.write(to:path,atomically:true,encoding:.utf8);self.reply(id,true)}catch{self.reply(id,nil,error.localizedDescription)}}
        case "deleteOffline":
            guard let key=p["lesson"] as? String,safeKey(key) else{reply(id,nil,"课程标识无效");return}
            let folder=scoped("offline").appendingPathComponent(key)
            for (operation,path) in pendingDownloads where path.deletingLastPathComponent()==folder{cancelledDownloads.insert(operation)}
            for (operation,job) in downloads where job.destination.deletingLastPathComponent()==folder{cancelledDownloads.insert(operation);job.cancel()}
            // Pending cookie/file checks belong to the bridge request as well. Front-end
            // pause/delete invalidates its generation; never allow active commits afterward.
            storageQueue.async{do{if self.fm.fileExists(atPath:folder.path){try self.fm.removeItem(at:folder)};self.reply(id,true)}catch{self.reply(id,nil,error.localizedDescription)}}
        case "cancelDownload":
            if let operation=p["id"] as? String,pendingDownloads[operation] != nil || downloads[operation] != nil{cancelledDownloads.insert(operation);downloads[operation]?.cancel()};reply(id,true)
        case "pickImage":
            let panel=NSOpenPanel();panel.allowedContentTypes=[.image];panel.allowsMultipleSelection=false;panel.canChooseDirectories=false
            panel.beginSheetModal(for:window){response in guard response == .OK,let file=panel.url else{self.reply(id,false);return}
                self.storageQueue.async{guard let size=(try? file.resourceValues(forKeys:[.fileSizeKey]))?.fileSize,size<=20*1024*1024,let source=CGImageSourceCreateWithURL(file as CFURL,nil),let image=CGImageSourceCreateThumbnailAtIndex(source,0,[kCGImageSourceCreateThumbnailFromImageAlways:true,kCGImageSourceThumbnailMaxPixelSize:2560,kCGImageSourceCreateThumbnailWithTransform:true] as CFDictionary) else{self.reply(id,nil,"未能读取图片，请选择20MB以内的图片");return}
                    let width=image.width,height=image.height
                    guard let context=CGContext(data:nil,width:width,height:height,bitsPerComponent:8,bytesPerRow:0,space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGImageAlphaInfo.noneSkipLast.rawValue) else{self.reply(id,nil,"图片处理失败");return}
                    context.setFillColor(NSColor.white.cgColor);context.fill(CGRect(x:0,y:0,width:width,height:height));context.draw(image,in:CGRect(x:0,y:0,width:width,height:height));guard let flattened=context.makeImage(),let data=NSBitmapImageRep(cgImage:flattened).representation(using:.jpeg,properties:[.compressionFactor:0.9]),data.count<=20*1024*1024 else{self.reply(id,nil,"图片处理后过大，请选择较小的图片");return};self.reply(id,"data:image/jpeg;base64,"+data.base64EncodedString())
                }
            }
        case "saveNoteImage":
            guard let value=p["data"] as? String else{reply(id,nil,"图片内容无效");return};let folder=scoped("data")
            storageQueue.async{do{self.reply(id,try storeNoteImage(value,in:folder))}catch{self.reply(id,nil,error.localizedDescription)}}
        case "export":
            guard let text=p["text"] as? String,text.utf8.count<=128*1024*1024,let name=p["name"] as? String,!name.isEmpty else{reply(id,nil,"导出内容无效");return}
            let panel=NSSavePanel();panel.nameFieldStringValue=(name as NSString).lastPathComponent;panel.beginSheetModal(for:window){result in guard result == .OK,let path=panel.url else{self.reply(id,false);return};self.storageQueue.async{do{try text.write(to:path,atomically:true,encoding:.utf8);self.reply(id,true)}catch{self.reply(id,nil,error.localizedDescription)}}}
        case "copy":
            guard let text=p["text"] as? String else{reply(id,nil,"复制内容无效");return};let html=p["html"] as? String,image=p["image"] as? String,folder=scoped("data")
            storageQueue.async{
                do{
                    guard text.utf8.count<=32*1024*1024,(html?.utf8.count ?? 0)<=128*1024*1024 else{throw appError("复制内容过大，请分批复制")}
                    var imageData:Data?,imageType:NSPasteboard.PasteboardType?
                    if let image=image,!image.isEmpty {
                        let data:Data
                        if image.hasPrefix("data:image/"){data=try decodedNoteImage(image).data}else{let path=try noteAssetURL(image,in:folder);guard let size=(try? path.resourceValues(forKeys:[.fileSizeKey]))?.fileSize,size<=32*1024*1024,let saved=try? Data(contentsOf:path) else{throw appError("笔记图片不存在，请重新插入")};data=saved}
                        if data.starts(with:[0x89,0x50,0x4e,0x47]){imageData=data;imageType = .png}else{guard let source=CGImageSourceCreateWithData(data as CFData,nil),let image=CGImageSourceCreateImageAtIndex(source,0,nil),let tiff=NSBitmapImageRep(cgImage:image).representation(using:.tiff,properties:[:]) else{throw appError("无法复制这张图片")};imageData=tiff;imageType = .tiff}
                    }
                    DispatchQueue.main.async{let board=NSPasteboard.general;board.clearContents();board.setString(text,forType:.string);if let html=html{board.setString(html,forType:.html)};if let data=imageData,let type=imageType{board.setData(data,forType:type)};self.reply(id,true)}
                }catch{self.reply(id,nil,error.localizedDescription)}
            }
        case "clipboard":
            reply(id,NSPasteboard.general.string(forType:.string) ?? "")
        case "exportBundle":
            guard let files=p["files"] as? [[String:String]],files.count<=5000,!files.isEmpty else {reply(id,nil,"导出内容无效");return}
            let panel=NSSavePanel();panel.nameFieldStringValue=p["name"] as? String ?? "课堂笔记.zip";panel.allowedContentTypes=[.zip];panel.beginSheetModal(for:window){ result in
                guard result == .OK,let output=panel.url else {self.reply(id,false);return};DispatchQueue.global(qos:.userInitiated).async {
                    let folder=self.fm.temporaryDirectory.appendingPathComponent("zhiyun-export-"+UUID().uuidString);defer{try? self.fm.removeItem(at:folder)}
                    do {var size=0;for file in files {guard let name=file["path"],!name.hasPrefix("/"),!name.contains("\\"),!name.components(separatedBy:"/").contains("..") else {throw NSError(domain:"导出",code:1,userInfo:[NSLocalizedDescriptionKey:"导出文件名无效"])};let data=file["base64"].flatMap{Data(base64Encoded:$0)} ?? Data((file["text"] ?? "").utf8);size+=data.count;guard size<512*1024*1024 else {throw NSError(domain:"导出",code:2,userInfo:[NSLocalizedDescriptionKey:"本次导出超过512MB，请分批导出"])};let path=folder.appendingPathComponent(name);try self.fm.createDirectory(at:path.deletingLastPathComponent(),withIntermediateDirectories:true);try data.write(to:path)}
                        let process=Process();process.executableURL=URL(fileURLWithPath:"/usr/bin/ditto");process.arguments=["-c","-k",folder.path,output.path];try process.run();process.waitUntilExit();if process.terminationStatus==0{self.reply(id,true)}else{self.reply(id,nil,"笔记打包失败")}
                    }catch{self.reply(id,nil,error.localizedDescription)}
                }
            }
        case "ai": startAI(id,p)
        case "cancelAI": if let key=p["id"] as? String { streams[key]?.session.invalidateAndCancel() }; reply(id,true)
        default: reply(id,nil,"未知操作")
        }
    }
    func startAI(_ id:String,_ params:[String:Any]) {
        guard let key=String(data:keychain(account+"-deepseek") ?? Data(),encoding:.utf8),!key.isEmpty, let messages=params["messages"] as? [[String:Any]],messages.count<100 else { reply(id,nil,"请先设置 DeepSeek API 密钥"); return }
        let hasImages=messages.contains{message in (message["content"] as? [[String:Any]])?.contains{part in part["type"] as? String=="image_url"} == true}
        guard let model=resolvedDeepSeekModel(params["model"] as? String ?? "deepseek-flash",hasImages:hasImages) else{reply(id,nil,"模型不支持");return}
        var req=URLRequest(url:URL(string:"https://api.deepseek.com/chat/completions")!); req.httpMethod="POST"; req.setValue("Bearer "+key,forHTTPHeaderField:"Authorization"); req.setValue("application/json",forHTTPHeaderField:"Content-Type"); var body:[String:Any]=["model":model,"messages":messages,"stream":true,"max_tokens":4096,"thinking":["type":"disabled"],"stream_options":["include_usage":true]];if let tools=params["tools"] as? [[String:Any]],tools.count<=4 {body["tools"]=tools};req.httpBody=try? JSONSerialization.data(withJSONObject:body)
        let stream=AIStream(req,event:{ value in self.event("ai",["id":id,"delta":value]) },done:{ value,error in DispatchQueue.main.async { self.streams.removeValue(forKey:id); self.reply(id,value,error) } }); streams[id]=stream
    }
    var streams=[String:AIStream]()
    func serverFailure(_ message:String){
        let alert=NSAlert();alert.messageText="无法启动本机服务";alert.informativeText=message;alert.addButton(withTitle:"退出")
        alert.beginSheetModal(for:window){_ in NSApp.terminate(nil)}
    }
    func startServer(){
        do{
            let parameters=NWParameters.tcp;parameters.requiredLocalEndpoint = .hostPort(host:"127.0.0.1",port:.any);listener=try NWListener(using:parameters)
            listener.stateUpdateHandler={state in
                switch state {
                case .ready:
                    guard let port=self.listener.port else{DispatchQueue.main.async{self.serverFailure("未能分配本机端口")};return}
                    DispatchQueue.main.async{self.origin="http://127.0.0.1:"+String(port.rawValue);self.web.load(URLRequest(url:URL(string:self.origin+"/"+self.token+"/index.html")!))}
                case .failed(let error):DispatchQueue.main.async{self.serverFailure(error.localizedDescription)}
                default:break
                }
            }
            listener.newConnectionHandler={connection in connection.start(queue:self.queue);self.read(connection,Data())};listener.start(queue:queue)
        }catch{serverFailure(error.localizedDescription)}
    }
    func read(_ connection:NWConnection,_ previous:Data) {
        connection.receive(minimumIncompleteLength:1,maximumLength:65536) { data,_,complete,error in var total=previous; if let data=data { total.append(data) }; if total.count>65536 { connection.cancel();return }; if let text=String(data:total,encoding:.utf8),text.contains("\r\n\r\n") { self.serve(connection,text) } else if !complete && error == nil { self.read(connection,total) } else { connection.cancel() } }
    }
    func responseHeader(status:Int,type:String,length:Int64?,headers:[String:String]=[:])->Data {
        let reason=[200:"OK",206:"Partial Content",400:"Bad Request",403:"Forbidden",404:"Not Found",413:"Content Too Large",416:"Range Not Satisfiable",502:"Bad Gateway"][status] ?? "Response"
        var text="HTTP/1.1 \(status) \(reason)\r\nContent-Type: \(type)\r\nConnection: close\r\nX-Content-Type-Options: nosniff\r\n"
        if let length=length{ text+="Content-Length: \(length)\r\n" }
        for (key,value) in headers where !value.contains("\r") && !value.contains("\n"){text+=key+": "+value+"\r\n"};text+="\r\n";return Data(text.utf8)
    }
    func send(_ c:NWConnection,status:Int=200,type:String="application/octet-stream",data:Data=Data(),headers:[String:String]=[:],head:Bool=false,length:Int64?=nil){
        var bytes=responseHeader(status:status,type:type,length:length ?? Int64(data.count),headers:headers);if !head{bytes.append(data)};c.send(content:bytes,completion:.contentProcessed{_ in c.cancel()})
    }
    func streamFile(_ c:NWConnection,path:URL,type:String,size:Int,range:String?,headers:[String:String],head:Bool){
        let selection:(start:Int,end:Int,partial:Bool)
        do{selection=try requestedByteRange(range,size:size)}catch{send(c,status:416,headers:["Content-Range":"bytes */\(size)"]);return}
        let start=selection.start,end=selection.end,status=selection.partial ? 206:200;var extra=headers
        if selection.partial{extra["Content-Range"]="bytes \(start)-\(end)/\(size)"}
        extra["Accept-Ranges"]="bytes";let length=size==0 ? 0:end-start+1
        if head{send(c,status:status,type:type,headers:extra,head:true,length:Int64(length));return}
        guard let handle=try? FileHandle(forReadingFrom:path) else{send(c,status:404);return}
        do{try handle.seek(toOffset:UInt64(start))}catch{try? handle.close();send(c,status:502);return}
        c.send(content:responseHeader(status:status,type:type,length:Int64(length),headers:extra),completion:.contentProcessed{error in
            guard error==nil else{try? handle.close();c.cancel();return}
            self.sendFileChunk(c,handle:handle,remaining:length)
        })
    }
    func sendFileChunk(_ c:NWConnection,handle:FileHandle,remaining:Int){
        guard remaining>0,let bytes=try? handle.read(upToCount:min(128*1024,remaining)),!bytes.isEmpty else{try? handle.close();c.cancel();return}
        c.send(content:bytes,completion:.contentProcessed{error in if error != nil{try? handle.close();c.cancel();return};self.sendFileChunk(c,handle:handle,remaining:remaining-bytes.count)})
    }
    func proxied(_ address:String)->String?{proxyResourceURL(address,origin:origin,token:token)}
    func playlist(_ text:String,base:URL)->String{rewritePlaylist(text,base:base,proxy:proxied)}
    func serve(_ c:NWConnection,_ text:String){
        let lines=text.components(separatedBy:"\r\n"),parts=lines[0].components(separatedBy:" ")
        guard parts.count>=2,["GET","HEAD"].contains(parts[0]),let url=URL(string:"http://127.0.0.1"+parts[1]),url.path.hasPrefix("/"+token+"/") else{send(c,status:403);return}
        let head=parts[0]=="HEAD",rel=String(url.path.dropFirst(token.count+2)),items=URLComponents(url:url,resolvingAgainstBaseURL:false)?.queryItems ?? []
        let range=lines.first(where:{$0.lowercased().hasPrefix("range:")}).map{String($0.dropFirst(6)).trimmingCharacters(in:.whitespaces)}
        if rel=="remote" {
            guard let address=items.first(where:{$0.name=="url"})?.value,let target=URL(string:address),trusted(target) else{send(c,status:403);return}
            if let range=range,range.range(of:"^bytes=(?:[0-9]+-[0-9]*|-[0-9]+)$",options:.regularExpression)==nil{send(c,status:416);return}
            DispatchQueue.main.async{
                let cached=self.scoped("images").appendingPathComponent(digest(address)),cacheImages=self.cacheSettings()["images"] != false
                self.storageQueue.async{
                    if cacheImages,let size=(try? cached.resourceValues(forKeys:[.fileSizeKey]))?.fileSize,size>0,size<=24*1024*1024,let data=try? Data(contentsOf:cached){self.send(c,type:imageContentType(data),data:data,head:head);return}
                    DispatchQueue.main.async{self.cookieRequest(target,range:range){request in
                        var request=request;if head{request.httpMethod="HEAD"}
                        let id=UUID(),transfer=RemoteTransfer(request,connection:c,app:self,cacheImage:cacheImages ? cached:nil,head:head,done:{DispatchQueue.main.async{self.remoteTransfers.removeValue(forKey:id)}})
                        self.remoteTransfers[id]=transfer;transfer.start()
                    }}
                }
            };return
        }
        let path:URL
        if rel.hasPrefix("note-assets/"){
            guard let relative=noteAssetRelativePath(rel) else{send(c,status:403);return};path=scoped("data").appendingPathComponent(relative)
        }else if rel.hasPrefix("offline/"){
            let tail=String(rel.dropFirst(8));guard !tail.isEmpty,!tail.contains(".."),tail.split(separator:"/").allSatisfy({safeKey(String($0))}) else{send(c,status:403);return};path=scoped("offline").appendingPathComponent(tail)
        }else{guard !rel.contains(".."),!rel.hasPrefix("/"),let resources=Bundle.main.resourceURL else{send(c,status:403);return};path=resources.appendingPathComponent("web").appendingPathComponent(rel)}
        guard let size=(try? path.resourceValues(forKeys:[.fileSizeKey]))?.fileSize else{send(c,status:404);return}
        let ext=path.pathExtension.lowercased(),types=["html":"text/html; charset=utf-8","js":"application/javascript","css":"text/css","png":"image/png","jpg":"image/jpeg","jpeg":"image/jpeg","webp":"image/webp","gif":"image/gif","avif":"image/avif","svg":"image/svg+xml","json":"application/json","m3u8":"application/vnd.apple.mpegurl","ts":"video/mp2t","mp4":"video/mp4","m4s":"video/iso.segment","aac":"audio/aac","vtt":"text/vtt","wasm":"application/wasm"]
        var headers=[String:String]();if ext=="html"{headers["Content-Security-Policy"]="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' wss: ws:; object-src 'none'; base-uri 'none'"}
        streamFile(c,path:path,type:types[ext] ?? "application/octet-stream",size:size,range:range,headers:headers,head:head)
    }

}
func imageContentType(_ data:Data)->String{
    if data.starts(with:[0x89,0x50,0x4e,0x47]){return "image/png"};if data.starts(with:[0xff,0xd8]){return "image/jpeg"};if data.starts(with:Array("RIFF".utf8)){return "image/webp"};if data.starts(with:Array("GIF8".utf8)){return "image/gif"};return "application/octet-stream"
}
final class RemoteTransfer:NSObject,URLSessionDataDelegate {
    let connection:NWConnection,app:App,cacheImage:URL?,head:Bool,done:()->Void
    var session:URLSession!,task:URLSessionDataTask!,response:HTTPURLResponse?,buffer=Data(),buffering=false,playlist=false,image=false,sentHeaders=false
    private let lock=NSLock();private var closed=false
    init(_ request:URLRequest,connection:NWConnection,app:App,cacheImage:URL?,head:Bool,done:@escaping()->Void){
        self.connection=connection;self.app=app;self.cacheImage=cacheImage;self.head=head;self.done=done;super.init()
        let config=URLSessionConfiguration.ephemeral;config.timeoutIntervalForRequest=30;config.timeoutIntervalForResource=7200;config.httpCookieStorage=nil;config.urlCache=nil
        session=URLSession(configuration:config,delegate:self,delegateQueue:nil);task=session.dataTask(with:request)
    }
    func start(){task.resume()}
    func cancel(){task.cancel();session.invalidateAndCancel();connection.cancel();finish()}
    private func finish(){lock.lock();guard !closed else{lock.unlock();return};closed=true;lock.unlock();done()}
    private func abort(_ status:Int){app.send(connection,status:status);task.cancel();buffer.removeAll();finish()}
    func urlSession(_ session:URLSession,dataTask:URLSessionDataTask,didReceive response:URLResponse,completionHandler:@escaping(URLSession.ResponseDisposition)->Void){
        guard let response=response as? HTTPURLResponse else{abort(502);completionHandler(.cancel);return}
        self.response=response;app.absorbCookies(response)
        let mime=response.mimeType?.lowercased() ?? "application/octet-stream",ext=response.url?.pathExtension.lowercased() ?? ""
        playlist=ext=="m3u8" || mime.contains("mpegurl");image=mime.hasPrefix("image/") || ["png","jpg","jpeg","webp","gif"].contains(ext);buffering = !head && (playlist || image)
        if buffering,response.expectedContentLength>(playlist ? 8*1024*1024:24*1024*1024){abort(413);completionHandler(.cancel);return}
        if !buffering {
            var headers=[String:String]();for name in ["Content-Range","Accept-Ranges"]{if let value=response.value(forHTTPHeaderField:name){headers[name]=value}}
            sentHeaders=true;connection.send(content:app.responseHeader(status:response.statusCode,type:mime,length:response.expectedContentLength>=0 ? response.expectedContentLength:nil,headers:headers),completion:.contentProcessed{error in if error != nil{self.cancel()}})
        }
        completionHandler(.allow)
    }
    func urlSession(_ session:URLSession,dataTask:URLSessionDataTask,didReceive data:Data){
        if buffering {guard buffer.count+data.count<=(playlist ? 8*1024*1024:24*1024*1024) else{abort(413);return};buffer.append(data);return}
        guard !head else{return};dataTask.suspend();connection.send(content:data,completion:.contentProcessed{error in if error != nil{self.cancel()}else{self.lock.lock();let active = !self.closed;self.lock.unlock();if active{dataTask.resume()}}})
    }
    func urlSession(_ session:URLSession,task:URLSessionTask,didCompleteWithError error:Error?){
        lock.lock();let alreadyClosed=closed;lock.unlock();if alreadyClosed{session.finishTasksAndInvalidate();return}
        if buffering,let response=response,error==nil {
            var body=buffer,type=response.mimeType ?? "application/octet-stream"
            if playlist,let text=String(data:body,encoding:.utf8),text.trimmingCharacters(in:.whitespacesAndNewlines).hasPrefix("#EXTM3U"),let base=response.url{body=Data(app.playlist(text,base:base).utf8);type="application/vnd.apple.mpegurl"}
            else if image,response.statusCode==200,let path=cacheImage,body.count>0{let value=body;app.storageQueue.async{try? self.app.fm.createDirectory(at:path.deletingLastPathComponent(),withIntermediateDirectories:true);try? value.write(to:path,options:.atomic)}}
            app.send(connection,status:response.statusCode,type:type,data:body)
        }else if !sentHeaders,error != nil{app.send(connection,status:502)}else{connection.send(content:nil,completion:.contentProcessed{_ in self.connection.cancel()})}
        buffer.removeAll();session.finishTasksAndInvalidate();finish()
    }
    func urlSession(_ session:URLSession,task:URLSessionTask,willPerformHTTPRedirection response:HTTPURLResponse,newRequest request:URLRequest,completionHandler:@escaping(URLRequest?)->Void){
        guard let url=request.url,trusted(url) else{completionHandler(nil);return};app.absorbCookies(response);DispatchQueue.main.async{self.app.cookieRequest(url,range:request.value(forHTTPHeaderField:"Range")){base in var next=base;next.httpMethod=request.httpMethod;completionHandler(next)}}
    }
}
final class AIStream:NSObject,URLSessionDataDelegate {
    var session:URLSession!,buffer=Data(),status=0,answer="",calls=[Int:[String:Any]](),usage=[String:Any]();let event:(String)->Void,done:([String:Any],String?)->Void
    init(_ request:URLRequest,event:@escaping(String)->Void,done:@escaping([String:Any],String?)->Void) {self.event=event;self.done=done;super.init();let c=URLSessionConfiguration.ephemeral;c.timeoutIntervalForRequest=120;session=URLSession(configuration:c,delegate:self,delegateQueue:nil);session.dataTask(with:request).resume()}
    func urlSession(_ session:URLSession,dataTask:URLSessionDataTask,didReceive response:URLResponse,completionHandler:@escaping(URLSession.ResponseDisposition)->Void){status=(response as? HTTPURLResponse)?.statusCode ?? 0;completionHandler(.allow)}
    func urlSession(_ session:URLSession,dataTask:URLSessionDataTask,didReceive data:Data) {
        buffer.append(data);while let range=buffer.range(of:Data([10])) {let line=String(data:buffer[..<range.lowerBound],encoding:.utf8) ?? "";buffer.removeSubrange(..<range.upperBound);guard line.hasPrefix("data: "),let value=line.dropFirst(6).data(using:.utf8),let row=try? JSONSerialization.jsonObject(with:value) as? [String:Any] else {continue};if let u=row["usage"] as? [String:Any] {usage=u};guard let choices=row["choices"] as? [[String:Any]],let delta=choices.first?["delta"] as? [String:Any] else {continue};if let text=delta["content"] as? String {answer+=text;event(text)};if let tools=delta["tool_calls"] as? [[String:Any]] {for t in tools {let i=t["index"] as? Int ?? 0;var c=calls[i] ?? ["id":"","type":"function","function":["name":"","arguments":""]];if let id=t["id"] as? String {c["id"]=id};if let f=t["function"] as? [String:Any] {var fn=c["function"] as? [String:String] ?? [:];for k in ["name","arguments"] {if let v=f[k] as? String {fn[k]=(fn[k] ?? "")+v}};c["function"]=fn};calls[i]=c}}
        }
    }
    func urlSession(_ session:URLSession,task:URLSessionTask,didCompleteWithError error:Error?) {done(["answer":answer,"calls":calls.keys.sorted().compactMap{calls[$0]},"usage":usage],error?.localizedDescription ?? (status==200 ? nil:"AI 服务返回 \(status)，请检查密钥、余额或模型"));session.finishTasksAndInvalidate()}
}
let application=NSApplication.shared
let delegate=App();application.delegate=delegate;application.run()
