import Cocoa
import WebKit
import Network

// The production URLSession delegate is tested against synthetic official URLs.
// URLProtocol answers locally and never forwards anything to the network.
final class SyntheticCourseProtocol:URLProtocol {
    static var responses=[String:[(Int,String,[String:String])]](),hits=[String:Int](),observed=[URLRequest]()
    override class func canInit(with request:URLRequest)->Bool{request.url?.host=="classroom.zju.edu.cn"}
    override class func canonicalRequest(for request:URLRequest)->URLRequest{request}
    override func startLoading(){
        let path=request.url!.path;Self.hits[path,default:0]+=1;Self.observed.append(request)
        guard var rows=Self.responses[path],!rows.isEmpty else{client?.urlProtocol(self,didFailWithError:appError("Unexpected synthetic API request"));return}
        let row=rows.removeFirst();Self.responses[path]=rows
        let response=HTTPURLResponse(url:request.url!,statusCode:row.0,httpVersion:"HTTP/1.1",headerFields:row.2)!
        client?.urlProtocol(self,didReceive:response,cacheStoragePolicy:.notAllowed);client?.urlProtocol(self,didLoad:Data(row.1.utf8));client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading(){}
}

@main struct NativeContractTests {
    static var checks=0
    static func check(_ condition:Bool,_ name:String){precondition(condition,name);checks+=1}
    static func rejects(_ value:String,size:Int=100){do{_ = try requestedByteRange(value,size:size);fatalError("accepted invalid range: "+value)}catch{checks+=1}}
    static func waitUntil(_ condition:()->Bool,seconds:Double=15)throws{
        let deadline=Date().addingTimeInterval(seconds)
        while !condition(),Date()<deadline{RunLoop.current.run(until:Date().addingTimeInterval(0.01))}
        guard condition() else{throw appError("WebKit delegate smoke test timed out")}
    }
    static func secureCookieFixture()->HTTPCookie{HTTPCookie(properties:[.name:"canonical-secure",.value:"fixture",.domain:".zju.edu.cn",.path:"/",.secure:"TRUE"])!}
    static func plainCookieFixture()->HTTPCookie{HTTPCookie(properties:[.name:"canonical-plain",.value:"fixture",.domain:"classroom.zju.edu.cn",.path:"/"])!}
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
        var interactionAllowed=true,changes=[Bool]()
        let policyValue=try withKeychainInteractionPolicy(allowUI:false,get:{interactionAllowed},set:{interactionAllowed=$0;changes.append($0)},operation:{check(!interactionAllowed,"background keychain operation suppresses interaction");return 42})
        check(policyValue==42 && interactionAllowed && changes==[false,true],"successful keychain operation restores interaction policy")
        changes.removeAll();do{_ = try withKeychainInteractionPolicy(allowUI:false,get:{interactionAllowed},set:{interactionAllowed=$0;changes.append($0)},operation:{()throws->Int in throw appError("synthetic failure")});fatalError("throwing keychain fixture did not throw")}catch{check(interactionAllowed && changes==[false,true],"throwing keychain operation restores interaction policy")}
        interactionAllowed=false;changes.removeAll();_ = try withKeychainInteractionPolicy(allowUI:false,get:{interactionAllowed},set:{interactionAllowed=$0;changes.append($0)},operation:{true});check(!interactionAllowed && changes.isEmpty,"background access preserves a pre-existing disabled policy")
        interactionAllowed=true;changes.removeAll();_ = try withKeychainInteractionPolicy(allowUI:true,get:{interactionAllowed},set:{interactionAllowed=$0;changes.append($0)},operation:{check(interactionAllowed,"explicit authorization allows normal system interaction");return true});check(changes.isEmpty,"explicit authorization does not alter keychain policy")
        var unsafeOperationRan=false
        do{_ = try withKeychainInteractionPolicy(allowUI:false,get:{throw appError("failed get")},set:{_ in},operation:{unsafeOperationRan=true;return true});fatalError("failed policy get accepted")}catch{check(!unsafeOperationRan,"failed interaction-policy lookup fails closed before keychain access")}
        interactionAllowed=true
        do{_ = try withKeychainInteractionPolicy(allowUI:false,get:{interactionAllowed},set:{value in interactionAllowed=value;if !value{throw appError("failed set")}},operation:{unsafeOperationRan=true;return true});fatalError("failed policy set accepted")}catch{check(!unsafeOperationRan && interactionAllowed,"failed policy update skips keychain access and restores previous policy")}
        var memory=["cookies":Data("saved-cookies".utf8),"identity":Data("saved-identity".utf8),"account-deepseek":Data("synthetic-api-key".utf8)],readCounts=[String:Int](),writeCounts=[String:Int](),allOnStorageQueue=true
        let cacheQueue=DispatchQueue(label:"cn.suike.native-contract.keychain-cache"),queueIdentity=DispatchSpecificKey<Bool>();cacheQueue.setSpecific(key:queueIdentity,value:true)
        let memoryCache=KeychainMemoryCache{ name,data,remove,allowUI,onError in
            allOnStorageQueue = allOnStorageQueue && DispatchQueue.getSpecific(key:queueIdentity)==true
            if remove{memory.removeValue(forKey:name);return nil};if let data=data{writeCounts[name,default:0]+=1;memory[name]=data;return data};readCounts[name,default:0]+=1;return memory[name]
        }
        cacheQueue.sync{
            for _ in 0..<10{_ = memoryCache.access("cookies");_ = memoryCache.access("identity");_ = memoryCache.access("account-deepseek")}
            for _ in 0..<10{_ = memoryCache.access("cookies",Data("saved-cookies".utf8));_ = memoryCache.access("identity",Data("saved-identity".utf8))}
        }
        check(readCounts==["cookies":1,"identity":1,"account-deepseek":1],"boot and repeated AI reads reuse one in-memory read per credential")
        check(writeCounts.isEmpty && allOnStorageQueue,"unchanged credentials avoid keychain writes and all operations remain serial")
        cacheQueue.sync{for _ in 0..<10{_ = memoryCache.access("cookies",Data("changed-cookies".utf8))}};check(writeCounts["cookies"]==1,"changed cookie snapshot is written once, then reused")
        var deniedReads=0,deniedWrites=0,authorizedReads=0
        let deniedCache=KeychainMemoryCache{name,data,remove,allowUI,onError in
            if data != nil{deniedWrites+=1}else if allowUI{authorizedReads+=1}else{deniedReads+=1}
            if !allowUI{onError(errSecInteractionNotAllowed);return nil};return Data("authorized-synthetic-data".utf8)
        }
        for _ in 0..<10{_ = deniedCache.access("blocked");_ = deniedCache.access("blocked",Data("new-bytes".utf8))}
        check(deniedReads==1 && deniedWrites==0 && deniedCache.requiresAuthorization(["blocked"]),"denied background read is negatively cached without prompting or repeated writes")
        _ = deniedCache.access("blocked",allowUI:true);for _ in 0..<10{_ = deniedCache.access("blocked")};check(authorizedReads==1 && deniedReads==1 && !deniedCache.requiresAuthorization(["blocked"]),"one explicit recovery unlocks future reads without repeated authorization")
        check(try encodedCookies([secureCookieFixture(),plainCookieFixture()])==encodedCookies([plainCookieFixture(),secureCookieFixture()]),"canonical cookie bytes do not change when WK cookie order changes")
        // Real WKWebView, real App WKUIDelegate methods, isolated nonpersistent data
        // store and hidden window. No account/keychain reads or external requests.
        let application=NSApplication.shared;application.setActivationPolicy(.prohibited)
        let app=App();app.testSkipCookiePersistence=true;app.testSessionKeychain={_,_,_ in nil};let isolated=FileManager.default.temporaryDirectory.appendingPathComponent("zhiyun-native-profile-"+UUID().uuidString);app.root=isolated;defer{try? FileManager.default.removeItem(at:isolated)};app.origin="http://127.0.0.1:9876";app.token="fixture"
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
        view.evaluateJavaScript("window.native={receive:payload=>{const next=window.bridgePending.get(payload.id);if(next){window.bridgePending.delete(payload.id);payload.error?next.reject(new Error(payload.error)):next.resolve(payload.value)}},event:payload=>window.toolbarEvents.push(payload)};window.toolbarEvents=[];window.bridgePending=new Map();window.bridgeSequence=0;window.callBridge=(action,params={})=>new Promise((resolve,reject)=>{const id='contract-'+(++window.bridgeSequence);window.bridgePending.set(id,{resolve,reject});window.webkit.messageHandlers.native.postMessage({id,action,params})});void 0"){_,_ in configuredBridge=true};try waitUntil({configuredBridge})
        // Actual native toolbar appears in the title bar, independently of HTML.
        var toolbarSynced=false;view.callAsyncJavaScript("return await window.callBridge('toolbar',{name:'测试姓名',loggedIn:true});",arguments:[:],in:nil,in:.page){_ in toolbarSynced=true};try waitUntil({toolbarSynced})
        let loggedItems=app.mainToolbar!.items.map{$0.itemIdentifier.rawValue}
        check(loggedItems==["brand","NSToolbarFlexibleSpaceItem","name","home","privacy","logout"],"signed-in native title bar contains identity and three actions")
        check((app.mainToolbar!.items.first(where:{$0.itemIdentifier.rawValue=="name"})?.view as? NSTextField)?.stringValue=="测试姓名","native title bar displays synced user name")
        for key in ["home","privacy","logout"]{(app.mainToolbar!.items.first(where:{$0.itemIdentifier.rawValue==key})!.view as! NSButton).performClick(nil)}
        var toolbarValues:String?,readToolbar=false;view.callAsyncJavaScript("await new Promise(resolve=>setTimeout(resolve,80));return JSON.stringify(window.toolbarEvents.map(event=>event.value));",arguments:[:],in:nil,in:.page){result in if case .success(let value)=result{toolbarValues=value as? String};readToolbar=true};try waitUntil({readToolbar});check(toolbarValues=="[\"home\",\"privacy\",\"logout\"]","real native toolbar buttons emit string action contract")
        app.updateToolbar(name:"",loggedIn:false);check(app.mainToolbar!.items.map{$0.itemIdentifier.rawValue}==["brand","NSToolbarFlexibleSpaceItem","privacy"],"signed-out title bar only offers privacy")
        check(!window.isVisible,"toolbar synchronization preserves hidden window")
        // Complete Cookie -> WK store -> encrypted snapshot rows -> new WK store
        // roundtrip, with no real profile, keychain, university or API call.
        let fixtureExpiry=Date().addingTimeInterval(3600),httpOnly=HTTPCookiePropertyKey(rawValue:"HttpOnly"),sameSite=HTTPCookiePropertyKey(rawValue:"SameSite")
        let secureCookie=HTTPCookie(properties:[.name:"secure-fixture",.value:"secure",.domain:".zju.edu.cn",.path:"/",.secure:"TRUE",httpOnly:"TRUE",sameSite:"Strict",.expires:fixtureExpiry])!
        let plainCookie=HTTPCookie(properties:[.name:"plain-fixture",.value:"plain",.domain:"classroom.zju.edu.cn",.path:"/"])!
        let pathCookie=HTTPCookie(properties:[.name:"path-fixture",.value:"path",.domain:"classroom.zju.edu.cn",.path:"/courseapi"])!
        let bearerCookie=HTTPCookie(properties:[.name:"_token",.value:"{i:0;s:6:\"_token\";i:1;s:13:\"synthetic-jwt\";}",.domain:"classroom.zju.edu.cn",.path:"/",.secure:"TRUE",httpOnly:"TRUE"])!
        let cloudCookie=HTTPCookie(properties:[.name:"cloud-fixture",.value:"cloud",.domain:".chinamcloud.com",.path:"/",.secure:"TRUE",httpOnly:"TRUE"])!
        var cookiesInstalled=false;app.installCookies([secureCookie,plainCookie,pathCookie,bearerCookie,cloudCookie]){cookiesInstalled=true};try waitUntil({cookiesInstalled})
        var originalCookies=[HTTPCookie](),readCookies=false;app.store.httpCookieStore.getAllCookies{originalCookies=$0;readCookies=true};try waitUntil({readCookies})
        let snapshot=try encodedCookies(originalCookies),restored=App();restored.testSkipCookiePersistence=true;restored.root=isolated.appendingPathComponent("restored")
        var restoredDone=false;restored.restoreCookies(from:snapshot){restoredDone=true};try waitUntil({restoredDone});var restoredCookies=[HTTPCookie]();readCookies=false;restored.store.httpCookieStore.getAllCookies{restoredCookies=$0;readCookies=true};try waitUntil({readCookies})
        let restoredSecure=restoredCookies.first{$0.name=="secure-fixture"}!,restoredPlain=restoredCookies.first{$0.name=="plain-fixture"}!
        check(restoredSecure.isSecure && restoredSecure.isHTTPOnly,"WK Cookie roundtrip retains Secure and HttpOnly")
        check(restoredSecure.expiresDate != nil && abs(restoredSecure.expiresDate!.timeIntervalSince(fixtureExpiry))<2,"WK Cookie roundtrip retains expiry")
        check(!restoredPlain.isSecure && restoredPlain.isSessionOnly && !restoredPlain.isHTTPOnly,"WK Cookie roundtrip retains nonsecure session metadata")
        check(restoredCookies.contains{$0.name=="cloud-fixture"},"trusted cloud session cookies survive restart")
        let decoded=decodedCookies(try encodedCookies([secureCookie]));check(decoded.first?.properties?[sameSite] as? String=="strict","cookie serialization retains SameSite")
        let expired=HTTPCookie(properties:[.name:"expired",.value:"old",.domain:"classroom.zju.edu.cn",.path:"/",.expires:Date().addingTimeInterval(-30)])!,foreign=HTTPCookie(properties:[.name:"foreign",.value:"test",.domain:"attacker.example",.path:"/"])!
        check(decodedCookies(try encodedCookies([expired,foreign])).isEmpty,"expired and unrelated cookies are excluded")
        var requestReady=false,restoredRequest:URLRequest?;restored.cookieRequest(URL(string:"https://classroom.zju.edu.cn/courseapi/test")!){restoredRequest=$0;requestReady=true};try waitUntil({requestReady})
        check(restoredRequest?.value(forHTTPHeaderField:"Authorization")=="Bearer synthetic-jwt","restored cookie yields fresh official Bearer header")
        check(restoredRequest?.value(forHTTPHeaderField:"Accept")=="application/json","API requests explicitly accept JSON")
        check(restoredRequest?.value(forHTTPHeaderField:"Cookie")?.hasPrefix("path-fixture=path;")==true,"longest matching cookie path is sent first")
        requestReady=false;restored.cookieRequest(URL(string:"https://interactivemeta.cmc.zju.edu.cn/asr/test")!){restoredRequest=$0;requestReady=true};try waitUntil({requestReady});check(restoredRequest?.value(forHTTPHeaderField:"Authorization")=="Bearer synthetic-jwt","trusted realtime-transcription origin receives campus Bearer")
        check(restoredRequest?.value(forHTTPHeaderField:"Cookie")?.contains("plain-fixture")==false,"host-only cookie does not leak to sibling hosts")
        requestReady=false;restored.cookieRequest(URL(string:"https://media.chinamcloud.com/video.mp4")!){restoredRequest=$0;requestReady=true};try waitUntil({requestReady});check(restoredRequest?.value(forHTTPHeaderField:"Authorization")==nil,"media CDN never receives campus Bearer")
        let cookieResponse=HTTPURLResponse(url:URL(string:"https://classroom.zju.edu.cn/")!,statusCode:200,httpVersion:"HTTP/1.1",headerFields:["Set-Cookie":"just-written=ready; Path=/; Secure; HttpOnly"])!
        requestReady=false;restored.absorbCookies(cookieResponse){restored.cookieRequest(URL(string:"https://classroom.zju.edu.cn/courseapi/test")!){restoredRequest=$0;requestReady=true}};try waitUntil({requestReady});check(restoredRequest?.value(forHTTPHeaderField:"Cookie")?.contains("just-written=ready")==true,"Set-Cookie is installed before dependent API request")
        var handshakes=0,resumed=0;restored.testSessionBootstrap={done in handshakes+=1;DispatchQueue.main.asyncAfter(deadline:.now()+0.02){done(true)}};restored.resumeOfficialSession{if $0{resumed+=1}};restored.resumeOfficialSession{if $0{resumed+=1}};try waitUntil({resumed==2});check(handshakes==1,"concurrent cold-session requests share one official handshake")
        check(restored.account=="guest","session restore never manufactures an account identity")
        let loginResponse=HTTPURLResponse(url:URL(string:"https://classroom.zju.edu.cn/login")!,statusCode:200,httpVersion:"HTTP/1.1",headerFields:["Content-Type":"text/html"])!
        let forbidden=HTTPURLResponse(url:URL(string:"https://classroom.zju.edu.cn/courseapi/test")!,statusCode:403,httpVersion:"HTTP/1.1",headerFields:[:])!
        check(authenticationExpired(loginResponse,Data("<!doctype html>".utf8)),"HTML login page is recognized as expired session")
        check(!authenticationExpired(forbidden,Data("{\"code\":401}".utf8)),"explicit course denial never triggers automatic retry")
        let unavailable=HTTPURLResponse(url:URL(string:"https://classroom.zju.edu.cn/courseapi/test")!,statusCode:502,httpVersion:"HTTP/1.1",headerFields:["Content-Type":"text/html"])!
        check(!authenticationExpired(unavailable,Data("<!doctype html>gateway unavailable".utf8)),"server HTML errors are not misidentified as authentication failures")
        let apiConfiguration=URLSessionConfiguration.ephemeral;apiConfiguration.httpCookieStorage=nil;apiConfiguration.urlCache=nil;apiConfiguration.protocolClasses=[SyntheticCourseProtocol.self]
        app.network=URLSession(configuration:apiConfiguration,delegate:app,delegateQueue:nil);defer{app.network.invalidateAndCancel()}
        SyntheticCourseProtocol.responses=[
            "/contract-401":[(401,"{\"code\":401}",["Content-Type":"application/json","Set-Cookie":"response-cookie=ready; Path=/; Secure; HttpOnly"]),(200,"{\"code\":200,\"data\":\"success\"}",["Content-Type":"application/json"])],
            "/contract-403":[(403,"{\"code\":403}",["Content-Type":"application/json"])],
            "/contract-post":[(401,"{\"code\":401}",["Content-Type":"application/json"])],
            "/contract-502":[(502,"<!doctype html>gateway unavailable",["Content-Type":"text/html"])]
        ]
        var retryHandshakes=0,cookieReadyBeforeRetry=false
        app.testSessionBootstrap={done in retryHandshakes+=1;app.store.httpCookieStore.getAllCookies{cookies in
            cookieReadyBeforeRetry=cookies.contains{$0.name=="response-cookie" && $0.value=="ready"}
            let fresh=HTTPCookie(properties:[.name:"_token",.value:"{i:0;s:6:\"_token\";i:1;s:13:\"refreshed-jwt\";}",.domain:"classroom.zju.edu.cn",.path:"/",.secure:"TRUE",httpOnly:"TRUE"])!
            app.installCookies([fresh]){done(true)}
        }}
        func bridgeCall(_ action:String,_ params:[String:Any]=[:])throws->Any?{
            var finished=false,value:Any?,error:Error?
            view.callAsyncJavaScript("return await window.callBridge(action,params);",arguments:["action":action,"params":params],in:nil,in:.page){result in switch result{case .success(let output):value=output;case .failure(let failure):error=failure};finished=true}
            try waitUntil({finished});if let error=error{throw error};return value
        }
        let retryResult=try bridgeCall("request",["url":"https://classroom.zju.edu.cn/contract-401"]) as! [String:Any]
        check(retryResult["status"] as? Int==200 && SyntheticCourseProtocol.hits["/contract-401"]==2 && retryHandshakes==1,"safe GET retries once after official session refresh")
        check(cookieReadyBeforeRetry,"authentication refresh sees response cookie before retrying")
        let replayed=SyntheticCourseProtocol.observed.filter{$0.url?.path=="/contract-401"}.last!
        check(replayed.value(forHTTPHeaderField:"Authorization")=="Bearer refreshed-jwt","retried GET uses renewed campus token")
        let denialResult=try bridgeCall("request",["url":"https://classroom.zju.edu.cn/contract-403"]) as! [String:Any]
        check(denialResult["status"] as? Int==403 && SyntheticCourseProtocol.hits["/contract-403"]==1 && retryHandshakes==1,"explicit permission denial is returned without refresh or replay")
        let postResult=try bridgeCall("request",["url":"https://classroom.zju.edu.cn/contract-post","body":"{}"] ) as! [String:Any]
        check(postResult["status"] as? Int==401 && SyntheticCourseProtocol.hits["/contract-post"]==1 && retryHandshakes==1,"POST authentication failures never replay mutations")
        let serverResult=try bridgeCall("request",["url":"https://classroom.zju.edu.cn/contract-502"]) as! [String:Any]
        check(serverResult["status"] as? Int==502 && SyntheticCourseProtocol.hits["/contract-502"]==1 && retryHandshakes==1,"upstream outage preserves status and does not trigger SSO")
        var bridgeSecretReads=0,bridgeCookieWrites=0,bridgeKeychainOnBackground=true
        app.testKeychainOperation={name,data,remove,allowUI,onError in
            bridgeKeychainOnBackground = bridgeKeychainOnBackground && !Thread.isMainThread
            if data != nil{if name=="cookies"{bridgeCookieWrites+=1};return data};if name.hasSuffix("-deepseek"){bridgeSecretReads+=1;return Data("synthetic-test-key".utf8)};return nil
        }
        for _ in 0..<5{check(try bridgeCall("secret") as? String=="synthetic-test-key","actual native secret bridge returns cached key")}
        for _ in 0..<3{do{_ = try bridgeCall("ai",["model":"deliberately-invalid-model","messages":[]]);fatalError("invalid AI model accepted")}catch{check(app.streams.isEmpty,"invalid-model AI cache test never starts external network")}}
        check(bridgeSecretReads==1 && bridgeKeychainOnBackground,"secret and AI native routes share one background keychain read")
        app.testSkipCookiePersistence=false
        let noCookieResponse=HTTPURLResponse(url:URL(string:"https://classroom.zju.edu.cn/ordinary-api")!,statusCode:200,httpVersion:"HTTP/1.1",headerFields:["Content-Type":"application/json"])!
        for _ in 0..<3{var completed=false;app.absorbCookies(noCookieResponse){completed=true};try waitUntil({completed})};app.storageQueue.sync{}
        check(bridgeCookieWrites==0,"ordinary responses without Set-Cookie never trigger credential persistence")
        let unchangedCookieResponse=HTTPURLResponse(url:URL(string:"https://classroom.zju.edu.cn/ordinary-api")!,statusCode:200,httpVersion:"HTTP/1.1",headerFields:["Content-Type":"application/json","Set-Cookie":"stable-snapshot=ready; Path=/; Secure; HttpOnly"])!
        for _ in 0..<3{var completed=false;app.absorbCookies(unchangedCookieResponse){completed=true};try waitUntil({completed})};app.storageQueue.sync{}
        check(bridgeCookieWrites==1,"identical repeated Set-Cookie responses persist only one canonical snapshot")
        app.testSkipCookiePersistence=true
        app.storageQueue.sync{app.credentialCache.invalidate()};var silentDenied=0,interactiveAttempts=0,declineAuthorization=true,unexpectedCredentialReads=0
        app.testKeychainOperation={name,data,remove,allowUI,onError in
            guard name.hasSuffix("-deepseek") else{unexpectedCredentialReads+=1;onError(errSecInteractionNotAllowed);return nil}
            if !allowUI{silentDenied+=1;onError(errSecInteractionNotAllowed);return nil}
            interactiveAttempts+=1;if declineAuthorization{onError(errSecUserCanceled);return nil};return Data("restored-synthetic-key".utf8)
        }
        for _ in 0..<3{check(try bridgeCall("secret") as? String=="","silently blocked API secret stays unavailable without UI")}
        let blockedStatus=try bridgeCall("keychainStatus") as! [String:Any];check(blockedStatus["apiAuthorizationRequired"] as? Bool==true && silentDenied==1,"native status reports blocked saved API key after one silent attempt")
        let cancelledRecovery=try bridgeCall("authorizeCredentials",["purpose":"api"]) as! [String:Any]
        check(cancelledRecovery["ready"] as? Bool==false && cancelledRecovery["authorizationRequired"] as? Bool==true && interactiveAttempts==1,"cancelled explicit API recovery remains blocked")
        _ = try bridgeCall("secret");check(silentDenied==1 && interactiveAttempts==1,"cancelled authorization is not immediately retried by passive reads")
        declineAuthorization=false;let acceptedRecovery=try bridgeCall("authorizeCredentials",["purpose":"api"]) as! [String:Any]
        check(acceptedRecovery["ready"] as? Bool==true && acceptedRecovery["authorizationRequired"] as? Bool==false && unexpectedCredentialReads==0,"explicit API recovery reads only current API key, never restores course cookies")
        check(try bridgeCall("secret") as? String=="restored-synthetic-key" && silentDenied==1 && interactiveAttempts==2,"restored API key remains reusable in RAM without new prompts")
        var guardedCookieReads=0
        app.storageQueue.sync{app.credentialCache.invalidate()};app.testKeychainOperation={name,data,remove,allowUI,onError in if name=="cookies"{guardedCookieReads+=1;onError(errSecInteractionNotAllowed)};return nil}
        app.storageQueue.sync{_ = app.sessionKeychain("cookies")}
        var jarCleared=false;app.store.httpCookieStore.getAllCookies{cookies in let group=DispatchGroup();for cookie in cookies{group.enter();app.store.httpCookieStore.delete(cookie){group.leave()}};group.notify(queue:.main){jarCleared=true}};try waitUntil({jarCleared})
        SyntheticCourseProtocol.responses["/contract-protected"]=[(200,"{\"code\":200}",["Content-Type":"application/json"])]
        let protectedResult=try bridgeCall("request",["url":"https://classroom.zju.edu.cn/contract-protected"]) as! [String:Any]
        check(protectedResult["status"] as? Int==401 && SyntheticCourseProtocol.hits["/contract-protected"]==nil && guardedCookieReads==1,"protected startup cookies with empty Jar block guest requests without SSO or repeated reads")
        let newLoginCookie=HTTPCookie(properties:[.name:"_token",.value:"{i:0;s:6:\"_token\";i:1;s:13:\"new-login-jwt\";}",.domain:"classroom.zju.edu.cn",.path:"/",.secure:"TRUE",httpOnly:"TRUE"])!
        var newJar=false;app.installCookies([newLoginCookie]){newJar=true};try waitUntil({newJar})
        let newLoginResult=try bridgeCall("request",["url":"https://classroom.zju.edu.cn/contract-protected"]) as! [String:Any]
        check(newLoginResult["status"] as? Int==200 && SyntheticCourseProtocol.hits["/contract-protected"]==1 && guardedCookieReads==1 && SyntheticCourseProtocol.observed.last?.value(forHTTPHeaderField:"Authorization")=="Bearer new-login-jwt","fresh official login Jar is usable despite blocked persistent cookie storage")
        app.setupMenu();let editMenu=NSApp.mainMenu!.items[1].submenu!,copyItem=editMenu.items.first{$0.keyEquivalent=="c"}!
        check(copyItem.target === app && copyItem.action==#selector(App.copyContent(_:)),"Cmd-C menu targets real native image-aware copy dispatcher")
        check(app.isMainWebResponder(window,view),"native copy dispatcher recognizes main WebKit responder")
        let unrelated=NSWindow(contentRect:view.frame,styleMask:[.titled],backing:.buffered,defer:false);unrelated.isReleasedWhenClosed=false;defer{unrelated.close()};check(!app.isMainWebResponder(unrelated,view),"native copy dispatcher never intercepts another window")
        let drag=try preparedImageDrag(fixturePNG,name:"第3页课件.jpg"),dragSource=ImageDragSource(drag){_ in},writer=ImagePromiseWriter(drag,delegate:dragSource)
        check(drag.fileName=="第3页课件.png" && drag.png.starts(with:[0x89,0x50,0x4e,0x47]),"dragged file uses real PNG bytes and matching filename")
        let board=NSPasteboard.withUniqueName();defer{board.releaseGlobally()}
        check(writer.writableTypes(for:board).contains(.png) && writer.writableTypes(for:board).contains(.tiff),"native image drag provides interoperable PNG and TIFF flavors")
        check(writer.pasteboardPropertyList(forType:.png) as? Data==drag.png,"native image drag carries image bytes rather than a local URL")
        check((writer.pasteboardPropertyList(forType:.tiff) as? Data)?.isEmpty==false,"native image drag lazily provides actual TIFF bytes")
        let nativePrepared=try bridgeCall("prepareImageDrag",["image":fixturePNG,"name":"第3页课件.png"]) as! [String:Any];check((nativePrepared["token"] as? String)?.count==64,"native image preparation returns a ready content token")
        let promised=isolated.appendingPathComponent("promised.png");try FileManager.default.createDirectory(at:isolated,withIntermediateDirectories:true);var promisedDone=false,promisedFailure:Error?;dragSource.filePromiseProvider(writer,writePromiseTo:promised){promisedFailure=$0;promisedDone=true};try waitUntil({promisedDone});if let promisedFailure=promisedFailure{throw promisedFailure};check(try Data(contentsOf:promised)==drag.png,"Finder file promise writes the exact PNG image")
        do{try app.dragImage(["image":fixturePNG]);fatalError("programmatic drag accepted without a real pressed mouse")}catch{checks+=1}
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
        let markerProfile=isolated.appendingPathComponent("explicit-logout"),markerApp=App();markerApp.root=markerProfile;markerApp.testSkipCookiePersistence=true
        var credentialReads=0,syntheticIdentity=Data("{\"id\":\"offline-fixture\"}".utf8),allowIdentityWrite=false
        markerApp.testSessionKeychain={name,data,remove in
            if remove{return nil};if let data=data{if allowIdentityWrite{syntheticIdentity=data;return data};return nil}
            credentialReads+=1;return name=="identity" ? syntheticIdentity:snapshot
        }
        try writeLogoutMarker(in:markerProfile);check(markerApp.hasLogoutMarker(),"explicit logout is persisted before clearing credentials")
        check(markerApp.storageQueue.sync{markerApp.storedIdentity()}.isEmpty && credentialReads==0,"logout marker blocks stale identity without accessing keychain")
        var markerRestore=false;markerApp.restoreCookies{markerRestore=true};try waitUntil({markerRestore});var blockedCookies=[HTTPCookie]();readCookies=false;markerApp.store.httpCookieStore.getAllCookies{blockedCookies=$0;readCookies=true};try waitUntil({readCookies});check(blockedCookies.isEmpty && credentialReads==0,"logout marker prevents restoring stale cookie snapshot")
        do{try markerApp.storageQueue.sync{try markerApp.saveIdentity("{\"id\":\"new-fixture\"}")};fatalError("failed keychain write accepted")}catch{check(markerApp.hasLogoutMarker(),"failed identity save cannot clear explicit logout")}
        allowIdentityWrite=true;try markerApp.storageQueue.sync{try markerApp.saveIdentity("{\"id\":\"new-fixture\"}",allowUI:true)};check(!markerApp.hasLogoutMarker() && markerApp.storageQueue.sync{markerApp.storedIdentity()}.contains("new-fixture"),"successful fresh identity save clears explicit logout marker")
        let impossible=isolated.appendingPathComponent("not-a-directory");try Data("blocked".utf8).write(to:impossible)
        do{try writeLogoutMarker(in:impossible);fatalError("marker write accepted invalid directory")}catch{checks+=1}
        // Actual loopback service and hidden WK page render while a synthetic
        // credential read is deliberately blocked. No real keychain is touched.
        let bundleResources=Bundle.main.resourceURL!;guard bundleResources.path.contains("zhiyun-native-contract.") else{throw appError("Native test bundle is not an isolated directory")}
        let fixtureWeb=bundleResources.appendingPathComponent("web");try FileManager.default.createDirectory(at:fixtureWeb,withIntermediateDirectories:true);try Data("<!doctype html><meta charset=utf-8><body>Preparing classroom</body>".utf8).write(to:fixtureWeb.appendingPathComponent("index.html"))
        let bootApp=App();bootApp.root=isolated.appendingPathComponent("visible-before-credentials");bootApp.testSkipCookiePersistence=true
        let bootConfig=WKWebViewConfiguration();bootConfig.websiteDataStore=bootApp.store;bootApp.web=WKWebView(frame:NSRect(x:0,y:0,width:500,height:300),configuration:bootConfig);bootApp.web.navigationDelegate=bootApp
        let credentialLatch=DispatchSemaphore(value:0);var bootReadStarted=false,bootReads=0,bootRestored=0
        bootApp.testKeychainOperation={name,data,remove,allowUI,onError in bootReads+=1;bootReadStarted=true;_ = credentialLatch.wait(timeout:.now()+10);return nil}
        bootApp.startServer();bootApp.restoreCookies{bootRestored+=1};bootApp.restoreCookies{bootRestored+=1}
        try waitUntil({bootReadStarted && !bootApp.web.isLoading && bootApp.web.url != nil})
        var renderedText:String?,rendered=false;bootApp.web.evaluateJavaScript("document.body.textContent"){value,_ in renderedText=value as? String;rendered=true};try waitUntil({rendered})
        check(renderedText=="Preparing classroom" && bootRestored==0,"startup WebKit interface loads before credential approval finishes")
        credentialLatch.signal();try waitUntil({bootRestored==2});check(bootReads==1,"startup cookie restoration is singleflight for concurrent callers")
        bootApp.listener.cancel();bootApp.web.navigationDelegate=nil;bootApp.web.stopLoading()
        window.contentView=nil;view.uiDelegate=nil;view.navigationDelegate=nil;window.close()
        print("Native bridge contract checks passed: \(checks)")
    }
}
