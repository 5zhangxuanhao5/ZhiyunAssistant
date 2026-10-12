import Cocoa
import WebKit
import Network
import Security
import CryptoKit
import UniformTypeIdentifiers

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
final class Download: NSObject, URLSessionDownloadDelegate {
    let destination: URL, event: (Int64,Int64)->Void, finish: (Result<String,Error>)->Void
    var task: URLSessionDownloadTask?, session: URLSession!
    var cancelled=false
    func cancel(){cancelled=true;task?.cancel()}
    init(_ request: URLRequest, destination: URL, event: @escaping (Int64,Int64)->Void, finish: @escaping (Result<String,Error>)->Void) {
        self.destination=destination; self.event=event; self.finish=finish; super.init()
        let config=URLSessionConfiguration.ephemeral; config.timeoutIntervalForRequest=30; config.timeoutIntervalForResource=7200
        session=URLSession(configuration:config,delegate:self,delegateQueue:nil); task=session.downloadTask(with:request); task?.resume()
    }
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) { event(totalBytesWritten,totalBytesExpectedToWrite) }
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        guard !cancelled else {finish(.failure(NSError(domain:"下载",code:2,userInfo:[NSLocalizedDescriptionKey:"已暂停"])));return};guard let response=downloadTask.response as? HTTPURLResponse, (200..<300).contains(response.statusCode) else { finish(.failure(NSError(domain:"下载",code:1,userInfo:[NSLocalizedDescriptionKey:"资源不可访问或登录已失效"]))); return }
        do { try FileManager.default.createDirectory(at:destination.deletingLastPathComponent(),withIntermediateDirectories:true); if FileManager.default.fileExists(atPath:destination.path) { try FileManager.default.removeItem(at:destination) }; try FileManager.default.moveItem(at:location,to:destination); finish(.success(destination.lastPathComponent)) } catch { finish(.failure(error)) }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) { if let error=error { finish(.failure(error)) }; session.finishTasksAndInvalidate() }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?)->Void) { completionHandler(request.url.map(trusted) == true ? request : nil) }
}
final class App: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate, NSWindowDelegate, URLSessionTaskDelegate {
    var window: NSWindow!, web: WKWebView!, login: NSWindow?, loginWeb: WKWebView?
    var listener: NWListener!, origin="", token=UUID().uuidString, account="guest", downloads=[String:Download](), aiTasks=[String:URLSessionDataTask]()
    let fm=FileManager.default, store=WKWebsiteDataStore.nonPersistent()
    lazy var root: URL = { let path=fm.urls(for:.applicationSupportDirectory,in:.userDomainMask)[0].appendingPathComponent("智云助手 Mac"); try? fm.createDirectory(at:path,withIntermediateDirectories:true); return path }()
    var queue=DispatchQueue(label:"cn.suike.mac.http",qos:.userInitiated)
    lazy var network: URLSession = { let c=URLSessionConfiguration.ephemeral; c.timeoutIntervalForRequest=20; c.timeoutIntervalForResource=90; c.httpCookieStorage=nil; c.urlCache=nil; return URLSession(configuration:c,delegate:self,delegateQueue:nil) }()
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular); setupMenu()
        let config=WKWebViewConfiguration(); config.websiteDataStore=store; config.userContentController.add(self,name:"native"); config.preferences.javaScriptCanOpenWindowsAutomatically=false
        web=WKWebView(frame:.zero,configuration:config); web.navigationDelegate=self
        window=NSWindow(contentRect:NSRect(x:0,y:0,width:1320,height:850),styleMask:[.titled,.closable,.miniaturizable,.resizable],backing:.buffered,defer:false)
        window.isReleasedWhenClosed=false; window.title="智云助手"; window.minSize=NSSize(width:780,height:560); window.contentView=web; window.delegate=self; window.center(); window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps:true)
        restoreCookies { self.startServer() }
    }
    func setupMenu() {
        let menu=NSMenu(); let appItem=NSMenuItem(); menu.addItem(appItem); let am=NSMenu(); appItem.submenu=am
        am.addItem(withTitle:"关于智云助手",action:#selector(about),keyEquivalent:""); am.addItem(.separator()); am.addItem(withTitle:"退出智云助手",action:#selector(NSApplication.terminate(_:)),keyEquivalent:"q")
        let editItem=NSMenuItem(); menu.addItem(editItem); let edit=NSMenu(title:"编辑"); editItem.submenu=edit
        for (title,selector,key) in [("撤销","undo:","z"),("重做","redo:","Z"),("剪切","cut:","x"),("复制","copy:","c"),("粘贴","paste:","v"),("全选","selectAll:","a")] { edit.addItem(withTitle:title,action:Selector(selector),keyEquivalent:key) }
        let viewItem=NSMenuItem(); menu.addItem(viewItem); let view=NSMenu(title:"窗口"); viewItem.submenu=view; view.addItem(withTitle:"全屏",action:#selector(NSWindow.toggleFullScreen(_:)),keyEquivalent:"f").keyEquivalentModifierMask=[.command,.control]; NSApp.mainMenu=menu
    }
    @objc func about() { NSApp.orderFrontStandardAboutPanel(options:[.applicationName:"智云助手",.applicationVersion:"1.0.0 Mac 首版",.credits:NSAttributedString(string:"独立课程学习工具。在线资源以校园账号权限为准。")]) }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication)->Bool { true }
    func applicationWillTerminate(_ notification: Notification) { downloads.values.forEach { $0.cancel() }; streams.values.forEach { $0.session.invalidateAndCancel() }; listener?.cancel() }
    func windowWillClose(_ notification: Notification) { if notification.object as? NSWindow === login { persistCookies(); login=nil; loginWeb=nil } }
    func webView(_ view: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy)->Void) {
        guard let u=navigationAction.request.url else { decisionHandler(.cancel); return }
        if view === web { decisionHandler(u.absoluteString.hasPrefix(origin + "/" + token + "/") || u.scheme == "about" ? .allow : .cancel) }
        else { decisionHandler(trusted(u) || u.scheme == "about" ? .allow : .cancel) }
    }
    func webView(_ view: WKWebView, didFinish navigation: WKNavigation!) {
        if view === loginWeb { persistCookies(); if view.url?.host == "classroom.zju.edu.cn", !((view.url?.path ?? "").contains("login")) { DispatchQueue.main.asyncAfter(deadline:.now()+0.3) { self.event("login",["ready":true]) } } }
    }
    func restoreCookies(_ done:@escaping()->Void) {
        guard let data=keychain("cookies"), let rows=try? JSONSerialization.jsonObject(with:data) as? [[String:Any]] else { done(); return }
        let group=DispatchGroup()
        for row in rows { guard let host=(row["domain"] ?? row["Domain"]) as? String,let url=URL(string:"https://"+host.trimmingCharacters(in:CharacterSet(charactersIn:"."))),trusted(url) else {continue}; var p:[HTTPCookiePropertyKey:Any]=[.name:row["name"] ?? row["Name"] ?? "",.value:row["value"] ?? row["Value"] ?? "",.domain:host,.path:row["path"] ?? row["Path"] ?? "/",.secure:"TRUE"]
            if let expires=row["expires"] as? Double { if expires<Date().timeIntervalSince1970 {continue};p[.expires]=Date(timeIntervalSince1970:expires) }
            if let c=HTTPCookie(properties:p) { group.enter();store.httpCookieStore.setCookie(c){group.leave()} }
        }; group.notify(queue:.main,execute:done)
    }
    func persistCookies() { store.httpCookieStore.getAllCookies { cookies in let rows=cookies.filter { $0.domain == "zju.edu.cn" || $0.domain.hasSuffix(".zju.edu.cn") }.map { c -> [String:Any] in var row:[String:Any]=["name":c.name,"value":c.value,"domain":c.domain,"path":c.path]; if let expires=c.expiresDate {row["expires"]=expires.timeIntervalSince1970};return row };if let data=try? JSONSerialization.data(withJSONObject:rows) {_=keychain("cookies",data)} } }
    func cookieRequest(_ url:URL, body:String="", range:String?=nil, done:@escaping(URLRequest)->Void) {
        store.httpCookieStore.getAllCookies { cookies in
            var req=URLRequest(url:url); req.setValue("https://classroom.zju.edu.cn/",forHTTPHeaderField:"Referer"); req.setValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15",forHTTPHeaderField:"User-Agent")
            let allowed=cookies.filter { c in let d=c.domain.trimmingCharacters(in:CharacterSet(charactersIn:".")); return (url.host == d || url.host?.hasSuffix("."+d) == true) && url.path.hasPrefix(c.path) && (c.expiresDate == nil || c.expiresDate! > Date()) }
            if !allowed.isEmpty { req.setValue(allowed.map { $0.name+"="+$0.value }.joined(separator:"; "),forHTTPHeaderField:"Cookie") }
            if url.host == "classroom.zju.edu.cn", let value=allowed.first(where:{$0.name == "_token"})?.value.removingPercentEncoding, let regex=try? NSRegularExpression(pattern:"\\{i:\\d+;s:\\d+:\"_token\";i:\\d+;s:\\d+:\"(.+?)\";\\}"), let match=regex.firstMatch(in:value,range:NSRange(value.startIndex...,in:value)), let r=Range(match.range(at:1),in:value) { req.setValue("Bearer "+value[r],forHTTPHeaderField:"Authorization") }
            if !body.isEmpty { req.httpMethod="POST"; req.httpBody=Data(body.utf8); req.setValue("application/json",forHTTPHeaderField:"Content-Type") }; if let range=range { req.setValue(range,forHTTPHeaderField:"Range") }; done(req)
        }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping(URLRequest?)->Void) { completionHandler(request.url.map(trusted) == true ? request : nil) }
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
            cookieRequest(url,body:p["body"] as? String ?? "") { req in self.network.dataTask(with:req){ data,res,error in if let error=error { DispatchQueue.main.async{self.diagnostic("API error: "+error.localizedDescription)}; self.reply(id,nil,error.localizedDescription); return }; guard let data=data,data.count<16*1024*1024, let res=res as? HTTPURLResponse else { self.reply(id,nil,"课程响应异常"); return }; DispatchQueue.main.async{self.diagnostic("API "+url.path+" status "+String(res.statusCode))}; self.reply(id,["status":res.statusCode,"text":String(data:data,encoding:.utf8) ?? ""]) }.resume() }
        case "login":
            if let login=login { login.makeKeyAndOrderFront(nil); reply(id,true); return }
            let config=WKWebViewConfiguration(); config.websiteDataStore=store
            let view=WKWebView(frame:.zero,configuration:config); view.navigationDelegate=self; loginWeb=view
            let w=NSWindow(contentRect:NSRect(x:0,y:0,width:980,height:730),styleMask:[.titled,.closable,.resizable],backing:.buffered,defer:false); w.isReleasedWhenClosed=false; w.title="登录智云课堂 · 浙江大学官方认证"; w.contentView=view; w.delegate=self; w.center(); w.makeKeyAndOrderFront(nil); login=w
            view.load(URLRequest(url:URL(string:"https://classroom.zju.edu.cn/")!)); reply(id,true)
        case "loginDone": persistCookies(); login?.close(); reply(id,true)
        case "logout":
            _=keychain("cookies",remove:true); _=keychain("identity",remove:true); store.httpCookieStore.getAllCookies { cookies in cookies.forEach { self.store.httpCookieStore.delete($0) }; self.account="guest"; self.reply(id,true) }
        case "identity":
            if let text=p["text"] as? String { _=keychain("identity",Data(text.utf8)); reply(id,true) } else { reply(id,String(data:keychain("identity") ?? Data(),encoding:.utf8) ?? "") }
        case "account": account=digest(p["id"] as? String ?? "guest"); reply(id,true)
        case "read":
            guard let k=p["key"] as? String,safeKey(k) else { reply(id,nil,"文件名无效"); return }; if p["cache"] as? Bool == true && cacheSettings()[cacheCategory(k)] == false {reply(id,"");return};let path=scoped(p["cache"] as? Bool == true ? "cache":"data").appendingPathComponent(k); reply(id,(try? String(contentsOf:path,encoding:.utf8)) ?? "")
        case "write":
            guard let k=p["key"] as? String,safeKey(k),let text=p["text"] as? String,text.utf8.count<32*1024*1024 else { reply(id,nil,"文件内容无效"); return }; if p["cache"] as? Bool == true && cacheSettings()[cacheCategory(k)] == false {reply(id,true);return};let path=scoped(p["cache"] as? Bool == true ? "cache":"data").appendingPathComponent(k)
            do { try fm.createDirectory(at:path.deletingLastPathComponent(),withIntermediateDirectories:true); try text.write(to:path,atomically:true,encoding:.utf8); reply(id,true) } catch { reply(id,nil,error.localizedDescription) }
        case "secret":
            let name=account+"-deepseek"; if p["remove"] as? Bool == true { _=keychain(name,remove:true); reply(id,true) } else if let text=p["text"] as? String { _=keychain(name,Data(text.utf8)); reply(id,true) } else { reply(id,String(data:keychain(name) ?? Data(),encoding:.utf8) ?? "") }
        case "cache":
            let cache=scoped("cache"),images=scoped("images");var settings=cacheSettings()
            if let category=p["category"] as? String,let enabled=p["enabled"] as? Bool {settings[category]=enabled;try? JSONSerialization.data(withJSONObject:settings).write(to:scoped("data").appendingPathComponent("cache-settings.json"),options:.atomic);reply(id,true);return}
            if p["clear"] as? Bool == true {
                if let category=p["category"] as? String,let keys=p["keys"] as? [String] {for k in keys where safeKey(k) {if category=="images" {try? fm.removeItem(at:images.appendingPathComponent(k))}else if cacheCategory(k)==category {try? fm.removeItem(at:cache.appendingPathComponent(k))}}}
                else if let category=p["category"] as? String {if category=="images" {try? fm.removeItem(at:images)}else{for path in (try? fm.contentsOfDirectory(at:cache,includingPropertiesForKeys:nil)) ?? [] where cacheCategory(path.lastPathComponent)==category {try? fm.removeItem(at:path)}}}
                else {try? fm.removeItem(at:cache);try? fm.removeItem(at:images);try? fm.removeItem(at:root.appendingPathComponent("diagnostics.log"));store.removeData(ofTypes:[WKWebsiteDataTypeDiskCache,WKWebsiteDataTypeMemoryCache],modifiedSince:.distantPast){}}
                reply(id,true)
            } else {
                var entries=[String:[[String:Any]]]();for c in ["schedule","timeline","vision","summary","question","skip","images"]{entries[c]=[]}
                for (category,dir) in [("cache",cache),("images",images)] {for path in (try? fm.contentsOfDirectory(at:dir,includingPropertiesForKeys:[.fileSizeKey])) ?? [] {let k=path.lastPathComponent,c=category=="images" ? "images":cacheCategory(k);let n=(try? path.resourceValues(forKeys:[.fileSizeKey]).fileSize) ?? 0;entries[c,default:[]].append(["key":k,"bytes":n])}}
                reply(id,["entries":entries,"settings":settings])
            }
        case "resourceSize":
            guard let url=URL(string:p["url"] as? String ?? ""),trusted(url) else {reply(id,nil,"资源地址不支持");return};cookieRequest(url){request in var request=request;request.httpMethod="HEAD";self.network.dataTask(with:request){_,response,_ in self.reply(id,max(0,response?.expectedContentLength ?? 0))}.resume()}
        case "saveResource":
            guard let key=p["lesson"] as? String,safeKey(key),let name=p["name"] as? String,safeKey(name),let url=URL(string:p["url"] as? String ?? ""),trusted(url) else { reply(id,nil,"下载参数无效"); return }
            let path=scoped("offline").appendingPathComponent(key).appendingPathComponent(name)
            if fm.fileExists(atPath:path.path),let n=try? path.resourceValues(forKeys:[.fileSizeKey]).fileSize,n>0 { reply(id,["name":name,"size":n]); return }
            cookieRequest(url) { req in var job:Download?; job=Download(req,destination:path,event:{ n,total in self.event("download",["id":id,"bytes":n,"total":total]) },finish:{ result in DispatchQueue.main.async { self.downloads.removeValue(forKey:id); switch result { case .success(let name): self.reply(id,["name":name,"size":(try? path.resourceValues(forKeys:[.fileSizeKey]).fileSize) ?? 0]); case .failure(let e):self.reply(id,nil,e.localizedDescription) } } }); self.downloads[id]=job }
        case "writeOffline":
            guard let key=p["lesson"] as? String,safeKey(key),let name=p["name"] as? String,safeKey(name),let text=p["text"] as? String else { reply(id,nil,"下载参数无效"); return }; let path=scoped("offline").appendingPathComponent(key).appendingPathComponent(name); do { try fm.createDirectory(at:path.deletingLastPathComponent(),withIntermediateDirectories:true); try text.write(to:path,atomically:true,encoding:.utf8); reply(id,true) } catch { reply(id,nil,error.localizedDescription) }
        case "deleteOffline":
            guard let key=p["lesson"] as? String,safeKey(key) else { reply(id,nil,"课程标识无效"); return }; let folder=scoped("offline").appendingPathComponent(key);downloads.values.filter{$0.destination.deletingLastPathComponent()==folder}.forEach{$0.cancel()};try? fm.removeItem(at:folder); reply(id,true)
        case "cancelDownload": if let key=p["id"] as? String { downloads[key]?.cancel() }; reply(id,true)
        case "pickImage":
            let panel=NSOpenPanel(); panel.allowedContentTypes=[.image]; panel.beginSheetModal(for:window){ response in guard response == .OK,let file=panel.url,let data=try? Data(contentsOf:file),data.count<20*1024*1024,let img=NSImage(data:data),let tiff=img.tiffRepresentation,let rep=NSBitmapImageRep(data:tiff),let png=rep.representation(using:.png,properties:[:]) else { self.reply(id,nil,"未选择图片或图片超过20MB"); return }; self.reply(id,"data:image/png;base64,"+png.base64EncodedString()) }
        case "export":
            guard let text=p["text"] as? String,let name=p["name"] as? String else { reply(id,nil,"导出内容无效"); return }; let panel=NSSavePanel(); panel.nameFieldStringValue=name; panel.beginSheetModal(for:window){ result in guard result == .OK,let path=panel.url else { self.reply(id,false); return }; do { try text.write(to:path,atomically:true,encoding:.utf8); self.reply(id,true) } catch { self.reply(id,nil,error.localizedDescription) } }
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
        let model=params["model"] as? String ?? "deepseek-flash"; guard ["deepseek-flash","deepseek-pro","deepseek-chat","deepseek-reasoner"].contains(model) else { reply(id,nil,"模型不支持"); return }
        var req=URLRequest(url:URL(string:"https://api.deepseek.com/chat/completions")!); req.httpMethod="POST"; req.setValue("Bearer "+key,forHTTPHeaderField:"Authorization"); req.setValue("application/json",forHTTPHeaderField:"Content-Type"); var body:[String:Any]=["model":model,"messages":messages,"stream":true,"max_tokens":4096,"thinking":["type":"disabled"],"stream_options":["include_usage":true]];if let tools=params["tools"] as? [[String:Any]],tools.count<=4 {body["tools"]=tools};req.httpBody=try? JSONSerialization.data(withJSONObject:body)
        let stream=AIStream(req,event:{ value in self.event("ai",["id":id,"delta":value]) },done:{ value,error in DispatchQueue.main.async { self.streams.removeValue(forKey:id); self.reply(id,value,error) } }); streams[id]=stream
    }
    var streams=[String:AIStream]()
    func startServer() {
        do { let p=NWParameters.tcp; p.requiredLocalEndpoint = .hostPort(host:"127.0.0.1",port:.any); listener=try NWListener(using:p); listener.stateUpdateHandler={ state in if case .ready=state { DispatchQueue.main.async { self.origin="http://127.0.0.1:"+String(self.listener.port!.rawValue); self.web.load(URLRequest(url:URL(string:self.origin+"/"+self.token+"/index.html")!)) } } }; listener.newConnectionHandler={ c in c.start(queue:self.queue); self.read(c,Data()) }; listener.start(queue:queue) } catch { let alert=NSAlert(); alert.messageText="无法启动本机服务"; alert.informativeText=error.localizedDescription; alert.runModal(); NSApp.terminate(nil) }
    }
    func read(_ connection:NWConnection,_ previous:Data) {
        connection.receive(minimumIncompleteLength:1,maximumLength:65536) { data,_,complete,error in var total=previous; if let data=data { total.append(data) }; if total.count>65536 { connection.cancel();return }; if let text=String(data:total,encoding:.utf8),text.contains("\r\n\r\n") { self.serve(connection,text) } else if !complete && error == nil { self.read(connection,total) } else { connection.cancel() } }
    }
    func send(_ c:NWConnection,status:Int=200,type:String="application/octet-stream",data:Data=Data(),headers:[String:String]=[:],head:Bool=false) {
        var text="HTTP/1.1 \(status) OK\r\nContent-Type: \(type)\r\nContent-Length: \(data.count)\r\nConnection: close\r\nX-Content-Type-Options: nosniff\r\n"; for (k,v) in headers { text+=k+": "+v+"\r\n" }; text+="\r\n"; var bytes=Data(text.utf8); if !head { bytes.append(data) }; c.send(content:bytes,completion:.contentProcessed {_ in c.cancel()})
    }
    func serve(_ c:NWConnection,_ text:String) {
        let lines=text.components(separatedBy:"\r\n"),parts=lines[0].components(separatedBy:" "); guard parts.count>=2,["GET","HEAD"].contains(parts[0]),let url=URL(string:"http://127.0.0.1"+parts[1]),url.path.hasPrefix("/"+token+"/") else { send(c,status:403);return }; let head=parts[0]=="HEAD",rel=String(url.path.dropFirst(token.count+2)); let q=URLComponents(url:url,resolvingAgainstBaseURL:false)?.queryItems ?? []
        if rel=="remote",let address=q.first(where:{$0.name=="url"})?.value,let target=URL(string:address),trusted(target) {
            var range=lines.first(where:{$0.lowercased().hasPrefix("range:")}).map { String($0.dropFirst(6)).trimmingCharacters(in:.whitespaces) }
            if let current=range,let regex=try? NSRegularExpression(pattern:"bytes=(\\d+)-(\\d*)"),let m=regex.firstMatch(in:current,range:NSRange(current.startIndex...,in:current)),let r=Range(m.range(at:1),in:current),let start=Int(current[r]),let er=Range(m.range(at:2),in:current) {let end=min(Int(current[er]) ?? (start+2097151),start+2097151);range="bytes=\(start)-\(end)"}

            let cached=self.scoped("images").appendingPathComponent(digest(address)); let image=["png","jpg","jpeg","webp"].contains(target.pathExtension.lowercased())
            if image,self.cacheSettings()["images"] != false,let data=try? Data(contentsOf:cached) { self.send(c,type:"image/"+(target.pathExtension.lowercased()=="jpg" ? "jpeg":target.pathExtension.lowercased()),data:data,head:head); return }
            DispatchQueue.main.async { self.cookieRequest(target,range:range ?? (target.pathExtension.lowercased() == "mp4" ? "bytes=0-2097151":nil)) { request in self.network.dataTask(with:request){ data,response,error in guard let data=data,let r=response as? HTTPURLResponse,error==nil else { self.send(c,status:502);return }; if data.count>64*1024*1024 { self.send(c,status:413);return }
                var body=data; var type=r.mimeType ?? "application/octet-stream"
                if (200..<300).contains(r.statusCode), let s=String(data:data,encoding:.utf8),s.trimmingCharacters(in:.whitespacesAndNewlines).hasPrefix("#EXTM3U") {
                    func proxy(_ raw:String)->String { guard let next=URL(string:raw,relativeTo:r.url ?? target)?.absoluteURL,trusted(next),let enc=next.absoluteString.addingPercentEncoding(withAllowedCharacters:.urlQueryAllowed.subtracting(CharacterSet(charactersIn:"&+?#"))) else {return raw};return self.origin+"/"+self.token+"/remote?url="+enc }
                    let output=s.components(separatedBy:"\n").map { line -> String in if !line.isEmpty && !line.hasPrefix("#") { return proxy(line.trimmingCharacters(in:.whitespacesAndNewlines)) }; guard let regex=try? NSRegularExpression(pattern:"URI=\"([^\"]+)\"") else {return line}; var line=line; for match in regex.matches(in:line,range:NSRange(line.startIndex...,in:line)).reversed() { if let r=Range(match.range(at:1),in:line) { line.replaceSubrange(r,with:proxy(String(line[r]))) } }; return line }.joined(separator:"\n"); body=Data(output.utf8); type="application/vnd.apple.mpegurl"
                } else if image,r.statusCode==200,self.cacheSettings()["images"] != false { try? self.fm.createDirectory(at:cached.deletingLastPathComponent(),withIntermediateDirectories:true); try? data.write(to:cached,options:.atomic) }
                var headers=["Accept-Ranges":"bytes"]; if let cr=r.value(forHTTPHeaderField:"Content-Range") { headers["Content-Range"]=cr }; self.send(c,status:r.statusCode,type:type,data:body,headers:headers,head:head)
            }.resume() } }; return
        }
        let path:URL
        if rel.hasPrefix("offline/") { let tail=String(rel.dropFirst(8)); guard !tail.contains(".."),tail.split(separator:"/").allSatisfy({safeKey(String($0))}) else {send(c,status:403);return}; path=scoped("offline").appendingPathComponent(tail) }
        else { guard !rel.contains(".."),!rel.hasPrefix("/"), let resources=Bundle.main.resourceURL else {send(c,status:403);return}; path=resources.appendingPathComponent("web").appendingPathComponent(rel) }
        guard let size=(try? path.resourceValues(forKeys:[.fileSizeKey]))?.fileSize else {send(c,status:404);return}
        let ext=path.pathExtension.lowercased(),types=["html":"text/html; charset=utf-8","js":"application/javascript","css":"text/css","png":"image/png","svg":"image/svg+xml","json":"application/json","m3u8":"application/vnd.apple.mpegurl","ts":"video/mp2t","mp4":"video/mp4","m4s":"video/iso.segment"]
        var extra=[String:String]();if ext=="html" {extra["Content-Security-Policy"]="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' wss: ws:; object-src 'none'; base-uri 'none'"}
        let range=lines.first(where:{$0.lowercased().hasPrefix("range:")}) ?? (ext=="mp4" && size>8388608 ? "Range: bytes=0-8388607":"")
        if !range.isEmpty,let regex=try? NSRegularExpression(pattern:"bytes=(\\d+)-(\\d*)"),let m=regex.firstMatch(in:range,range:NSRange(range.startIndex...,in:range)),let r=Range(m.range(at:1),in:range),let start=Int(range[r]),start<size,let handle=try? FileHandle(forReadingFrom:path) {
            defer{try? handle.close()};let er=Range(m.range(at:2),in:range)!;let end=min(Int(range[er]) ?? (size-1),size-1,start+8388607);guard end>=start else {send(c,status:416);return};try? handle.seek(toOffset:UInt64(start));let data=(try? handle.read(upToCount:end-start+1)) ?? Data();extra["Content-Range"]="bytes \(start)-\(start+data.count-1)/\(size)";extra["Accept-Ranges"]="bytes";send(c,status:206,type:types[ext] ?? "application/octet-stream",data:data,headers:extra,head:head)
        }else{guard size<64*1024*1024,let data=try? Data(contentsOf:path) else {send(c,status:413);return};send(c,type:types[ext] ?? "application/octet-stream",data:data,headers:extra,head:head)}

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
