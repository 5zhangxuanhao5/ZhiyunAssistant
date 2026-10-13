import Cocoa
import WebKit
import Network

@main struct NativeContractTests {
    static var checks=0
    static func check(_ condition:Bool,_ name:String){precondition(condition,name);checks+=1}
    static func rejects(_ value:String,size:Int=100){do{_ = try requestedByteRange(value,size:size);fatalError("accepted invalid range: "+value)}catch{checks+=1}}
    static func waitUntil(_ condition:()->Bool,seconds:Double=15)throws{
        let deadline=Date().addingTimeInterval(seconds)
        while !condition(),Date()<deadline{RunLoop.current.run(until:Date().addingTimeInterval(0.01))}
        guard condition() else{throw appError("WebKit delegate smoke test timed out")}
    }
    static func main()throws{
        let full=try requestedByteRange(nil,size:100);check(full.start==0 && full.end==99 && !full.partial,"full file")
        let empty=try requestedByteRange(nil,size:0);check(empty.start==0 && !empty.partial,"empty file")
        let bounded=try requestedByteRange("bytes=10-29",size:100);check(bounded.start==10 && bounded.end==29 && bounded.partial,"bounded byte range")
        let open=try requestedByteRange("bytes=90-",size:100);check(open.start==90 && open.end==99,"open-ended byte range")
        let suffix=try requestedByteRange("bytes=-15",size:100);check(suffix.start==85 && suffix.end==99,"suffix byte range")
        let clipped=try requestedByteRange("bytes=20-999",size:100);check(clipped.start==20 && clipped.end==99,"range end clips to file size")
        let largeSuffix=try requestedByteRange("bytes=-999",size:100);check(largeSuffix.start==0 && largeSuffix.end==99,"oversized suffix")
        rejects("bytes=100-");rejects("bytes=80-70");rejects("bytes=-0");rejects("bytes=0-1,3-4");rejects("garbage");rejects("bytes=0-",size:0)
        check(trusted(URL(string:"https://cmc.zju.edu.cn/video.mp4")!),"official course host")
        check(!trusted(URL(string:"https://zju.edu.cn.attacker.example/video.mp4")!),"lookalike domain rejected")
        check(!trusted(URL(string:"https://name:password@cmc.zju.edu.cn/video.mp4")!),"credential URL rejected")
        let address=URL(string:"https://resource.cmc.zju.edu.cn/a%2Fb.ts?token=x%2By&name=%E4%B8%AD%E6%96%87")!.absoluteString
        let proxied=proxyResourceURL(address,origin:"http://127.0.0.1:9876",token:"fixture")!
        check(URLComponents(string:proxied)!.queryItems!.first!.value==address,"signed URL percent encoding preserved")
        let input="#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"key.key?token=x%2By\"\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXTINF:6,\npart%2F1.ts\n#EXT-X-ENDLIST"
        let playlist=rewritePlaylist(input,base:URL(string:"https://cmc.zju.edu.cn/course/index.m3u8")!){proxyResourceURL($0,origin:"http://127.0.0.1:9876",token:"fixture")}
        check(playlist.contains("#EXTINF:6,") && playlist.contains("#EXT-X-ENDLIST"),"manifest timing metadata retained")
        let targets=playlist.components(separatedBy:"\n").compactMap{line -> String? in
            if line.hasPrefix("http:"){return URLComponents(string:line)?.queryItems?.first?.value}
            if let first=line.range(of:"URI=\""),let last=line[first.upperBound...].firstIndex(of:"\""){return URLComponents(string:String(line[first.upperBound..<last]))?.queryItems?.first?.value}
            return nil
        }
        check(targets.contains("https://cmc.zju.edu.cn/course/key.key?token=x%2By"),"HLS encryption key URL retained")
        check(targets.contains("https://cmc.zju.edu.cn/course/init.mp4"),"HLS init section rewritten")
        check(targets.contains("https://cmc.zju.edu.cn/course/part%2F1.ts"),"HLS segment escaped path retained")
        check(resolvedDeepSeekModel("deepseek-v4-pro",hasImages:false)=="deepseek-v4-pro","official Pro model name")
        check(resolvedDeepSeekModel("deepseek-pro",hasImages:false)=="deepseek-v4-pro","legacy Pro preference migrates")
        check(resolvedDeepSeekModel("deepseek-v4-pro",hasImages:true)=="deepseek-flash","image requests use vision-capable Flash")
        check(resolvedDeepSeekModel("unknown",hasImages:false)==nil,"unknown models rejected")
        // Real WKWebView, real App WKUIDelegate methods, isolated nonpersistent data
        // store and hidden window. No account/keychain reads or external requests.
        let application=NSApplication.shared;application.setActivationPolicy(.prohibited)
        let app=App();app.testSkipCookiePersistence=true;let isolated=FileManager.default.temporaryDirectory.appendingPathComponent("zhiyun-native-profile-"+UUID().uuidString);app.root=isolated;defer{try? FileManager.default.removeItem(at:isolated)};app.origin="http://127.0.0.1:9876";app.token="fixture"
        let config=WKWebViewConfiguration();config.websiteDataStore=app.store;config.userContentController.add(app,name:"native")
        let view=WKWebView(frame:NSRect(x:0,y:0,width:600,height:400),configuration:config);view.uiDelegate=app;view.navigationDelegate=app
        let window=NSWindow(contentRect:view.frame,styleMask:[.titled],backing:.buffered,defer:false);window.contentView=view;window.isReleasedWhenClosed=false;app.window=window;app.web=view
        var observed=[String]();app.testDialogResponder={kind,message,defaultText in observed.append(kind);if kind=="confirm"{return message=="cancel-confirm" ? "false":"true"};if kind=="prompt"{return message=="cancel-prompt" ? nil:"renamed-note"};return nil}
        view.loadHTMLString("<!doctype html><meta charset=utf-8><p>Isolated native contract fixture</p>",baseURL:URL(string:"http://127.0.0.1:9876/fixture/dialogs.html"))
        try waitUntil({!view.isLoading})
        var completed=false,result:Any?,failure:Error?
        view.evaluateJavaScript("(()=>{alert('notice');const yes=confirm('accept-confirm');const no=confirm('cancel-confirm');const name=prompt('rename-note','old-note');const cancelled=prompt('cancel-prompt','old-note');return JSON.stringify({yes,no,name,cancelled})})()"){value,error in result=value;failure=error;completed=true}
        try waitUntil({completed});if let failure=failure{throw failure}
        guard let result=result as? String,let data=result.data(using:.utf8),let row=try JSONSerialization.jsonObject(with:data) as? [String:Any] else{throw appError("WebKit dialog fixture returned an invalid result")}
        check(row["yes"] as? Bool==true,"WebKit confirm accepts")
        check(row["no"] as? Bool==false,"WebKit confirm cancels")
        check(row["name"] as? String=="renamed-note","WebKit prompt returns entered text")
        check(row["cancelled"] is NSNull,"WebKit prompt cancellation returns null")
        check(observed==["alert","confirm","confirm","prompt","prompt"],"all real WebKit dialogs route through App delegate")
        let fixturePNG="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1kAAAAASUVORK5CYII="
        check(noteAssetRelativePath("note-assets/"+String(repeating:"a",count:64)+".png") != nil,"stable attachment path accepted")
        check(noteAssetRelativePath("note-assets/../private.png")==nil,"attachment traversal rejected")
        check(noteAssetRelativePath("note-assets/"+String(repeating:"A",count:64)+".png")==nil,"attachment hash is canonical lowercase")
        check(noteAssetRelativePath("note-assets/"+String(repeating:"a",count:64)+".html")==nil,"non-image attachment types rejected")
        var configuredBridge=false
        view.evaluateJavaScript("window.native={receive:payload=>{const next=window.bridgePending.get(payload.id);if(next){window.bridgePending.delete(payload.id);payload.error?next.reject(new Error(payload.error)):next.resolve(payload.value)}},event:()=>{}};window.bridgePending=new Map();window.bridgeSequence=0;window.callBridge=(action,params={})=>new Promise((resolve,reject)=>{const id='contract-'+(++window.bridgeSequence);window.bridgePending.set(id,{resolve,reject});window.webkit.messageHandlers.native.postMessage({id,action,params})});void 0"){_,_ in configuredBridge=true};try waitUntil({configuredBridge})
        var imagePath:String?,savedImage=false,imageFailure:Error?
        view.callAsyncJavaScript("return await window.callBridge('saveNoteImage',{data:image});",arguments:["image":fixturePNG],in:nil,in:.page){result in switch result{case .success(let value):imagePath=value as? String;case .failure(let error):imageFailure=error};savedImage=true};try waitUntil({savedImage});if let imageFailure=imageFailure{throw imageFailure}
        guard let imagePath=imagePath else{throw appError("Native image bridge did not return a path")};check(noteAssetRelativePath(imagePath) != nil,"actual native bridge stores a stable note asset")
        let asset=try noteAssetURL(imagePath,in:app.scoped("data")),expected=try decodedNoteImage(fixturePNG).data
        check(try Data(contentsOf:asset)==expected,"course screenshot bytes remain unchanged")
        var repeated=false,duplicatePath:String?;view.callAsyncJavaScript("return await window.callBridge('saveNoteImage',{data:image});",arguments:["image":fixturePNG],in:nil,in:.page){result in if case .success(let value)=result{duplicatePath=value as? String};repeated=true};try waitUntil({repeated});check(duplicatePath==imagePath,"note assets deduplicate by image content")
        var cleared=false;view.callAsyncJavaScript("return await window.callBridge('cache',{clear:true});",arguments:[:],in:nil,in:.page){_ in cleared=true};try waitUntil({cleared});check(FileManager.default.fileExists(atPath:asset.path),"ordinary cache clear preserves persistent note attachments")
        let parameters=NWParameters.tcp;parameters.requiredLocalEndpoint = .hostPort(host:"127.0.0.1",port:.any);let listener=try NWListener(using:parameters),networkQueue=DispatchQueue(label:"cn.suike.native-contract.http");var port:UInt16?
        listener.stateUpdateHandler={state in if case .ready=state{port=listener.port?.rawValue}};listener.newConnectionHandler={connection in connection.start(queue:networkQueue);app.read(connection,Data())};listener.start(queue:networkQueue);try waitUntil({port != nil});defer{listener.cancel()}
        let transport=URLSessionConfiguration.ephemeral;transport.httpCookieStorage=nil;transport.urlCache=nil;let session=URLSession(configuration:transport);defer{session.invalidateAndCancel()}
        var fetched=false,fetchedData:Data?,httpStatus=0;session.dataTask(with:URL(string:"http://127.0.0.1:"+String(port!)+"/fixture/"+imagePath)!){data,response,_ in fetchedData=data;httpStatus=(response as? HTTPURLResponse)?.statusCode ?? 0;fetched=true}.resume();try waitUntil({fetched});check(httpStatus==200 && fetchedData==expected,"real loopback attachment route serves stored bytes")
        app.account="isolated-other";fetched=false;httpStatus=0
        session.dataTask(with:URL(string:"http://127.0.0.1:"+String(port!)+"/fixture/"+imagePath)!){_,response,_ in httpStatus=(response as? HTTPURLResponse)?.statusCode ?? 0;fetched=true}.resume();try waitUntil({fetched});check(httpStatus==404,"attachment route stays isolated to the current account");app.account="guest"
        var configured=false
        view.evaluateJavaScript("window.flushCalls=0;window.zhiyunFlush=()=>new Promise(resolve=>setTimeout(()=>{window.flushCalls++;resolve(true)},30));"){_,_ in configured=true}
        try waitUntil({configured});var completedFlushes=0,storageDrained=false
        app.storageQueue.async{Thread.sleep(forTimeInterval:0.04);storageDrained=true}
        app.flushBeforeClosing{completedFlushes+=1};app.flushBeforeClosing{completedFlushes+=1}
        try waitUntil({completedFlushes==2});check(storageDrained,"close flush waits for queued storage writes")
        var flushCount:Any?,readCount=false;view.evaluateJavaScript("window.flushCalls"){value,_ in flushCount=value;readCount=true};try waitUntil({readCount});check(flushCount as? Int==1,"simultaneous close requests share one JavaScript flush")
        configured=false;view.evaluateJavaScript("window.zhiyunFlush=()=>{window.heldFlush=new Promise(resolve=>{window.resolveFlush=resolve});return window.heldFlush};void 0"){_,_ in configured=true};try waitUntil({configured});var timeoutFinished=false;let closingBegan=Date();app.flushBeforeClosing{timeoutFinished=true};try waitUntil({timeoutFinished},seconds:3)
        let elapsed=Date().timeIntervalSince(closingBegan);check(elapsed>=1.8 && elapsed<3,"unresponsive JavaScript close flush has bounded timeout")
        window.contentView=nil;view.uiDelegate=nil;view.navigationDelegate=nil;window.close()
        print("Native bridge contract checks passed: \(checks)")
    }
}
