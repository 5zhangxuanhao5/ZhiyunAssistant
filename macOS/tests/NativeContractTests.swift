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
    static func waitUntil(_ condition:()->Bool,seconds:Double=15,line:Int = #line)throws{
        let deadline=Date().addingTimeInterval(seconds)
        while !condition(),Date()<deadline{RunLoop.current.run(until:Date().addingTimeInterval(0.01))}
        guard condition() else{throw appError("WebKit delegate smoke test timed out at line \(line), after \(checks) checks")}
    }
    static func secureCookieFixture()->HTTPCookie{HTTPCookie(properties:[.name:"canonical-secure",.value:"fixture",.domain:".zju.edu.cn",.path:"/",.secure:"TRUE"])!}
    static func plainCookieFixture()->HTTPCookie{HTTPCookie(properties:[.name:"canonical-plain",.value:"fixture",.domain:"classroom.zju.edu.cn",.path:"/"])!}
    static func coldProcess(_ mode:String,root:URL)throws{
        NSApplication.shared.setActivationPolicy(.prohibited)
        let app=App();app.root=root
        let credential=root.appendingPathComponent("synthetic-credential.bin")
        app.testKeychainOperation={name,data,remove,allowUI,onError in
            guard name==persistedSessionCredential else{return nil}
            if remove{try? FileManager.default.removeItem(at:credential);return nil}
            if let data=data{try? data.write(to:credential,options:.atomic);return data}
            return try? Data(contentsOf:credential)
        }
        if mode=="--cold-session-seed"{
            try app.saveIdentity("{\"id\":\"separate-process-fixture\",\"name\":\"Synthetic\"}")
            let cookie=HTTPCookie(properties:[.name:"_token",.value:"{i:0;s:6:\"_token\";i:1;s:18:\"cold-process-token\";}",.domain:"classroom.zju.edu.cn",.path:"/",.secure:"TRUE",HTTPCookiePropertyKey(rawValue:"HttpOnly"):"TRUE"])!
            var done=false;app.installCookies([cookie]){app.persistCookies{done=true}};try waitUntil({done})
            guard FileManager.default.fileExists(atPath:credential.path) else{throw appError("Cold seed did not persist")}
        }else{
            if mode=="--cold-session-logout"{try writeLogoutMarker(in:root)}
            var done=false;app.restoreCookies{done=true};try waitUntil({done});done=false
            var request:URLRequest?;app.cookieRequest(URL(string:"https://classroom.zju.edu.cn/courseapi/cold-test")!){request=$0;done=true};try waitUntil({done})
            let bearer=request?.value(forHTTPHeaderField:"Authorization")
            if mode=="--cold-session-restore"{
                guard bearer=="Bearer cold-process-token",!app.sessionNeedsResume else{throw appError("Cold process did not restore session")}
                var identity="";app.storageQueue.sync{identity=app.storedIdentity()};guard identity.contains("separate-process-fixture") else{throw appError("Cold profile missing")}
            }else{guard bearer==nil else{throw appError("Logout marker was ignored")}}
        }
    }
    static func main()throws{
        if CommandLine.arguments.count==3,CommandLine.arguments[1].hasPrefix("--cold-session-"){try coldProcess(CommandLine.arguments[1],root:URL(fileURLWithPath:CommandLine.arguments[2],isDirectory:true));return}
        for (code,expected) in [(URLError.timedOut,"网络请求超时，请稍后重试"),(.notConnectedToInternet,"当前没有网络连接，请连接网络后重试"),(.networkConnectionLost,"网络连接中断，请重试"),(.cannotFindHost,"无法解析服务器地址，请检查网络"),(.cancelled,"请求已取消"),(.serverCertificateUntrusted,"安全连接校验失败，请检查系统时间或网络")] {
            let error=NSError(domain:NSURLErrorDomain,code:code.rawValue,userInfo:[NSLocalizedDescriptionKey:"English failure with a private URL"])
            check(userError(error)==expected,"URLSession errors have Chinese user messages without URLs or system English")
        }
        check(userError(appError("当前账号没有这节课的访问权限"))=="当前账号没有这节课的访问权限","application permission errors keep their original meaning")
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
        for alias in ["deepseek-chat","deepseek-v4-flash","deepseek-v4-flash-vision-exp"]{check(resolvedDeepSeekModel(alias,hasImages:false)=="deepseek-flash","retired Flash/chat alias migrates to current Flash")}
        check(resolvedDeepSeekModel("deepseek-reasoner",hasImages:false)=="deepseek-v4-pro","legacy reasoning choice migrates to current Pro")
        check(resolvedDeepSeekModel("deepseek-v4-pro",hasImages:true)=="deepseek-flash","image requests use vision-capable Flash")
        check(resolvedDeepSeekModel("unknown",hasImages:false)==nil,"unknown models rejected")
        check(aiHTTPFailure(200)==nil,"successful AI response has no failure")
        check(aiHTTPFailure(401)?.contains("身份验证") == true && aiHTTPFailure(401)?.contains("额度") == false,"401 identifies authentication without blaming model or balance")
        check(aiHTTPFailure(403)?.contains("访问权限") == true,"403 identifies service permission")
        check(aiHTTPFailure(402)?.contains("额度不足") == true,"402 identifies service quota")
        check(aiHTTPFailure(429)?.contains("429") == true && aiHTTPFailure(503)?.contains("暂时异常") == true,"rate limit and transient server errors remain distinguishable")
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
        let slotFolder=FileManager.default.temporaryDirectory.appendingPathComponent("zhiyun-credential-slots-"+UUID().uuidString)
        defer{try? FileManager.default.removeItem(at:slotFolder)}
        let slotIndex=slotFolder.appendingPathComponent("index.json")
        var slotValues=["campus":Data("legacy-protected".utf8)],slotRequests=[String](),slotFailures=[OSStatus](),denyOld=true
        let slotBackend:CredentialSlots.Backend={name,data,remove,onError in
            slotRequests.append(name)
            if name=="campus" && denyOld{onError(errSecInteractionNotAllowed);return nil}
            if remove{slotValues.removeValue(forKey:name);return nil}
            if let data=data{slotValues[name]=data};return slotValues[name]
        }
        let slots=CredentialSlots(indexURL:slotIndex,tag:"build-A",backend:slotBackend)
        check(slots.access("campus",nil,remove:false,onError:{slotFailures.append($0)})==nil && slotFailures==[errSecInteractionNotAllowed],"blocked legacy slot returns error without access escalation")
        slotRequests.removeAll();let syntheticSlotSecret=Data("synthetic-private-value".utf8)
        check(slots.access("campus",syntheticSlotSecret,remove:false,onError:{slotFailures.append($0)})==syntheticSlotSecret && slotRequests==["campus-app-build-A"],"reconfiguration writes only a new owned slot, never protected legacy item")
        let indexText=try String(contentsOf:slotIndex,encoding:.utf8)
        let indexMode=(try FileManager.default.attributesOfItem(atPath:slotIndex.path))[.posixPermissions] as? Int
        check(!indexText.contains("synthetic-private-value") && indexText.contains("campus-app-build-A") && indexMode==0o600,"slot index has owner-only names and no credential values")
        let nextSlots=CredentialSlots(indexURL:slotIndex,tag:"build-B",backend:slotBackend)
        check(nextSlots.access("campus",nil,remove:false,onError:{slotFailures.append($0)})==syntheticSlotSecret && slotValues["campus-app-build-B"]==syntheticSlotSecret,"readable previous slot migrates silently to next build")
        _ = nextSlots.access("campus",nil,remove:true,onError:{slotFailures.append($0)});denyOld=false;slotRequests.removeAll()
        check(nextSlots.access("campus",nil,remove:false,onError:{slotFailures.append($0)})==nil && slotRequests.isEmpty,"explicit delete tombstone prevents legacy secret resurrection")
        // AI service keys live in an owner-only file, so a rebuilt app reads them without Keychain.
        check(fileStoredCredential(campusGatewayCredential) && fileStoredCredential(campusOCRCredential) && fileStoredCredential("account-deepseek") && !fileStoredCredential("cookies") && !fileStoredCredential("identity"),"AI service keys use the file store; the course session stays in Keychain")
        let keyFile=slotFolder.appendingPathComponent("service-keys.json"),campusSecret=Data("campus-synthetic-gateway-key".utf8),personalSecret=Data("personal-synthetic-deepseek-key".utf8)
        var legacyCalls=0,legacyValue:Data?=Data("campus-key-from-readable-older-build".utf8),keyFailures=[OSStatus]()
        let legacy:ServiceKeyStore.Legacy={value,remove in legacyCalls+=1;if remove{legacyValue=nil;return nil};return value ?? legacyValue}
        let firstBuild=ServiceKeyStore(url:keyFile)
        check(firstBuild.access(campusGatewayCredential,nil,remove:false,onError:{keyFailures.append($0)},legacy:legacy)==legacyValue && legacyCalls==1,"a readable older key moves into the file once")
        check(firstBuild.access(campusGatewayCredential,campusSecret,remove:false,onError:{keyFailures.append($0)},legacy:legacy)==campusSecret && firstBuild.access("account-deepseek",personalSecret,remove:false,onError:{keyFailures.append($0)},legacy:legacy)==personalSecret,"campus and personal keys are saved")
        let keyMode=(try FileManager.default.attributesOfItem(atPath:keyFile.path))[.posixPermissions] as? Int
        check(keyMode==0o600 && keyFailures.isEmpty,"service key file is owner-only")
        legacyCalls=0;let rebuilt=ServiceKeyStore(url:keyFile)
        check(rebuilt.access(campusGatewayCredential,nil,remove:false,onError:{keyFailures.append($0)},legacy:legacy)==campusSecret && rebuilt.access("account-deepseek",nil,remove:false,onError:{keyFailures.append($0)},legacy:legacy)==personalSecret && legacyCalls==0,"a rebuilt app reads campus and personal keys without touching Keychain")
        _ = rebuilt.access("account-deepseek",nil,remove:true,onError:{keyFailures.append($0)},legacy:legacy)
        let keysAfterRemoval=try String(contentsOf:keyFile,encoding:.utf8)
        check(rebuilt.access("account-deepseek",nil,remove:false,onError:{keyFailures.append($0)},legacy:legacy)==nil && !keysAfterRemoval.contains("personal-synthetic") && keysAfterRemoval.contains("campus-synthetic"),"removing one key clears it and keeps the others")
        // The previous build kept the two campus keys in campus-services.json; they carry over once.
        let earlierFolder=slotFolder.appendingPathComponent("earlier"),earlierFile=earlierFolder.appendingPathComponent("campus-services.json")
        try FileManager.default.createDirectory(at:earlierFolder,withIntermediateDirectories:true);try JSONEncoder().encode([campusOCRCredential:"campus-synthetic-ocr-key"]).write(to:earlierFile)
        let upgraded=ServiceKeyStore(url:earlierFolder.appendingPathComponent("service-keys.json"),earlier:earlierFile)
        check(upgraded.access(campusOCRCredential,nil,remove:false,onError:{keyFailures.append($0)},legacy:{_,_ in nil})==Data("campus-synthetic-ocr-key".utf8) && !FileManager.default.fileExists(atPath:earlierFile.path),"campus keys saved by the previous build carry over to the general file")
        let bundleFixture=slotFolder.appendingPathComponent("CampusServices.json")
        try JSONEncoder().encode(["modelKey":"fixture-campus-model-123456789", "ocrKey":"pk_fixture_campus_ocr_123456789", "personalDeepSeek":"must-never-import-this"]).write(to:bundleFixture)
        let defaults=bundledCampusCredentials(bundleFixture)
        check(defaults.count==2 && defaults[campusGatewayCredential]=="fixture-campus-model-123456789" && defaults["account-deepseek"]==nil,"only the two campus defaults are loaded; personal fields are excluded")
        var bundledLegacyCalls=0
        let freshKeys=ServiceKeyStore(url:slotFolder.appendingPathComponent("fresh-services.json"),bundled:defaults)
        check(freshKeys.access(campusGatewayCredential,nil,remove:false,onError:{_ in},legacy:{_,_ in bundledLegacyCalls+=1;return nil})==Data("fixture-campus-model-123456789".utf8) && bundledLegacyCalls==0,"a clean install can use bundled campus services without a keychain request")
        check(!FileManager.default.fileExists(atPath:freshKeys.url.path),"using defaults does not manufacture a user profile")
        _=freshKeys.access(campusGatewayCredential,Data("manual-campus-override".utf8),remove:false,onError:{_ in},legacy:{_,_ in nil})
        check(freshKeys.access(campusGatewayCredential,nil,remove:false,onError:{_ in},legacy:{_,_ in nil})==Data("manual-campus-override".utf8),"a manual local campus key takes priority")
        check(bundledCampusCredentials(nil).isEmpty,"plain source builds keep personal API mode when no campus resource is present")
        // Real WKWebView, real App WKUIDelegate methods, isolated nonpersistent data
        // store and hidden window. No account/keychain reads or external requests.
        let application=NSApplication.shared;application.setActivationPolicy(.prohibited)
        let app=App();app.testSkipCookiePersistence=true;app.testSessionKeychain={_,_,_ in nil};let isolated=FileManager.default.temporaryDirectory.appendingPathComponent("zhiyun-native-profile-"+UUID().uuidString);app.root=isolated;defer{try? FileManager.default.removeItem(at:isolated)};app.origin="http://127.0.0.1:9876";app.token="fixture"
        check(app.cacheCategory("search-transcript-fixture.json")=="timeline","background search transcripts obey the visible timeline cache settings and cleanup")
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
        check(loggedItems==["brand","NSToolbarFlexibleSpaceItem","name","home","agent","theme","privacy","logout"],"signed-in native title bar contains identity, theme and account actions")
        // macOS 26+ puts glass behind stack and image toolbar views but not behind labels or borderless buttons.
        let brandView=app.mainToolbar!.items.first?.view as? NSTextField
        check(brandView != nil && brandView!.attributedStringValue.string.contains("智云助手") && app.mainToolbar!.items.compactMap{$0.view}.allSatisfy{$0 is NSTextField || ($0 as? NSButton)?.isBordered==false},"title bar brand is a plain label, matching the borderless actions without glass")
        check((app.mainToolbar!.items.first(where:{$0.itemIdentifier.rawValue=="name"})?.view as? NSTextField)?.stringValue=="测试姓名","native title bar displays synced user name")
        for key in ["home","theme","privacy","logout"]{(app.mainToolbar!.items.first(where:{$0.itemIdentifier.rawValue==key})!.view as! NSButton).performClick(nil)}
        var toolbarValues:String?,readToolbar=false;view.callAsyncJavaScript("await new Promise(resolve=>setTimeout(resolve,80));return JSON.stringify(window.toolbarEvents.map(event=>event.value));",arguments:[:],in:nil,in:.page){result in if case .success(let value)=result{toolbarValues=value as? String};readToolbar=true};try waitUntil({readToolbar});check(toolbarValues=="[\"home\",\"theme\",\"privacy\",\"logout\"]","real native toolbar buttons emit string action contract")
        app.updateToolbar(name:"",loggedIn:false);check(app.mainToolbar!.items.map{$0.itemIdentifier.rawValue}==["brand","NSToolbarFlexibleSpaceItem","agent","theme","privacy"],"signed-out title bar offers theme and privacy")
        check(["agent","theme","privacy"].allSatisfy{key in (app.mainToolbar!.items.first(where:{$0.itemIdentifier.rawValue==key})?.view as? NSButton)?.image != nil},"every title bar action has a symbol")
        check(app.applyWindowChrome("#15171b",mode:"dark") && window.titlebarAppearsTransparent && window.appearance?.name == .darkAqua,"dark appearance chrome keeps title bar controls legible")
        check(app.applyWindowChrome("#F4F5F7",mode:"light") && window.appearance?.name == .aqua,"light appearance chrome uses light controls")
        check(app.applyWindowChrome("#F4F5F7",mode:"system") && window.appearance==nil,"system appearance leaves the window following macOS")
        check(!app.applyWindowChrome("red") && !app.applyWindowChrome("#12345g") && !app.applyWindowChrome("#1234567") && !app.applyWindowChrome("#ffffff",mode:"neon"),"window chrome accepts only opaque hex colours and known modes")
        check(!window.isVisible,"toolbar synchronization preserves hidden window")
        let themeSuite="zhiyun-theme-test-"+UUID().uuidString
        // Use a suite separate from the installed app; switching never touches user preferences.
        let isolatedThemeDefaults=UserDefaults(suiteName:themeSuite)!
        app.themeDefaults=isolatedThemeDefaults
        check(app.selectedTheme=="collage","new theme defaults to bright collage")
        app.applyTheme("playful")
        check(app.selectedTheme=="playful","theme selection persisted in native preferences")
        let restartedThemeApp=App();restartedThemeApp.themeDefaults=UserDefaults(suiteName:themeSuite)!
        check(restartedThemeApp.selectedTheme=="playful","new app instance restores selected theme")
        app.applyTheme("invalid-theme")
        check(app.selectedTheme=="playful","unknown theme cannot alter selection")
        app.applyTheme("collage")
        check(app.selectedTheme=="collage","theme can switch back without reloading web view")
        check(app.themeIdentifiers==["collage","playful","film"],"three stable native colour scheme identifiers")
        for (old,now) in [("swiss","collage"),("terminal","collage"),("candy","playful"),("gallery","playful"),("field","film"),("racing","film")]{isolatedThemeDefaults.set(old,forKey:"appearanceTheme");check(app.selectedTheme==now,"retired theme "+old+" maps to "+now)}
        check(app.selectedMode=="system","appearance follows the system by default")
        app.applyAppearanceMode("dark");check(app.selectedMode=="dark" && window.appearance?.name == .darkAqua,"dark appearance persists and applies to the window")
        app.applyAppearanceMode("neon");check(app.selectedMode=="dark","unknown appearance cannot alter selection")
        app.applyAppearanceMode("system");check(app.selectedMode=="system" && window.appearance==nil,"system appearance clears the window override")
        for theme in app.themeIdentifiers{app.applyTheme(theme);check(app.selectedTheme==theme,"native theme persists "+theme)}
        isolatedThemeDefaults.set("editorial",forKey:"appearanceTheme");check(app.selectedTheme=="playful","legacy editorial preference migrates to playground")
        isolatedThemeDefaults.removePersistentDomain(forName:themeSuite)

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
        var handshakes=0,resumed=0;restored.sessionNeedsResume=true;restored.testSessionBootstrap={done in handshakes+=1;DispatchQueue.main.asyncAfter(deadline:.now()+0.02){done(true)}};restored.resumeOfficialSession{if $0{resumed+=1}};restored.resumeOfficialSession{if $0{resumed+=1}};try waitUntil({resumed==2});check(handshakes==1,"concurrent cold-session requests share one official handshake")
        check(restored.account=="guest","session restore never manufactures an account identity")
        // A brand new App and empty WK store restore the credential persisted by the
        // previous instance. No shared in-process cookie jar or user Keychain is used.
        var durableCredentials=[String:Data](),durableWrites=0
        let durableBackend:KeychainMemoryCache.Backend={name,data,remove,allowUI,onError in
            check(!allowUI,"ordinary session persistence never prompts")
            if remove{durableCredentials.removeValue(forKey:name);return nil}
            if let data=data{durableWrites+=1;durableCredentials[name]=data;return data}
            return durableCredentials[name]
        }
        let firstLaunch=App();firstLaunch.root=isolated.appendingPathComponent("durable-profile");firstLaunch.testKeychainOperation=durableBackend
        try firstLaunch.saveIdentity("{\"id\":\"cold-fixture\",\"name\":\"Fixture\"}")
        var savedSession=false
        firstLaunch.installCookies([bearerCookie,secureCookie]){firstLaunch.persistCookies{savedSession=true}}
        try waitUntil({savedSession});check(durableCredentials[persistedSessionCredential] != nil,"session-only cookies are durably stored before completion")
        savedSession=false;firstLaunch.persistCookies{savedSession=true};try waitUntil({savedSession});check(durableWrites==1,"identical cookie snapshot is written once")
        let nextLaunch=App();nextLaunch.root=firstLaunch.root;nextLaunch.testKeychainOperation=durableBackend
        var coldReady=false;nextLaunch.restoreCookies{coldReady=true};try waitUntil({coldReady})
        var coldRequest:URLRequest?;coldReady=false;nextLaunch.cookieRequest(URL(string:"https://classroom.zju.edu.cn/courseapi/cold-test")!){coldRequest=$0;coldReady=true};try waitUntil({coldReady})
        check(coldRequest?.value(forHTTPHeaderField:"Authorization")=="Bearer synthetic-jwt","new process restores bearer without another official login")
        check(!nextLaunch.sessionNeedsResume,"valid saved bearer avoids unnecessary startup authentication roundtrip")
        var coldIdentity="";nextLaunch.storageQueue.sync{coldIdentity=nextLaunch.storedIdentity()};check(coldIdentity.contains("cold-fixture"),"new process restores matching local profile")
        try writeLogoutMarker(in:nextLaunch.root)
        let signedOut=App();signedOut.root=nextLaunch.root;signedOut.testKeychainOperation=durableBackend
        coldReady=false;signedOut.restoreCookies{coldReady=true};try waitUntil({coldReady});coldReady=false;signedOut.cookieRequest(URL(string:"https://classroom.zju.edu.cn/")!){coldRequest=$0;coldReady=true};try waitUntil({coldReady})
        check(coldRequest?.value(forHTTPHeaderField:"Authorization")==nil,"explicit logout prevents durable snapshot resurrection")
        let processProfile=isolated.appendingPathComponent("separate-process-profile")
        for mode in ["--cold-session-seed","--cold-session-restore","--cold-session-logout"]{
            let child=Process();child.executableURL=URL(fileURLWithPath:CommandLine.arguments[0]);child.arguments=[mode,processProfile.path];child.standardOutput=FileHandle.nullDevice;child.standardError=FileHandle.nullDevice;try child.run()
            try waitUntil({!child.isRunning},seconds:30);check(child.terminationStatus==0,"separate process "+mode+" passes")
        }


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
            try waitUntil({finished},seconds:action=="recognizeSlide" ? 60:15);if let error=error{throw error};return value
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
        check(bridgeCookieWrites==0,"Set-Cookie persistence stays in WebKit and never rewrites legacy session Keychain items")
        app.testSkipCookiePersistence=true
        app.storageQueue.sync{app.credentialCache.invalidate()};var silentDenied=0,interactiveAttempts=0,ownedSecret:Data?,unexpectedCredentialReads=0
        app.testKeychainOperation={name,data,remove,allowUI,onError in
            if allowUI{interactiveAttempts+=1}
            guard name.hasSuffix("-deepseek") else{unexpectedCredentialReads+=1;onError(errSecInteractionNotAllowed);return nil}
            if let data=data{ownedSecret=data;return data}
            if let saved=ownedSecret{return saved}
            silentDenied+=1;onError(errSecInteractionNotAllowed);return nil
        }
        for _ in 0..<3{check(try bridgeCall("secret") as? String=="","silently blocked API secret stays unavailable without UI")}
        let blockedStatus=try bridgeCall("keychainStatus") as! [String:Any];check(blockedStatus["apiAuthorizationRequired"] as? Bool==true && silentDenied==1,"blocked old secret is negatively cached")
        let blockedRecovery=try bridgeCall("authorizeCredentials",["purpose":"api"]) as! [String:Any]
        check(blockedRecovery["ready"] as? Bool==false && interactiveAttempts==0,"legacy recovery bridge cannot enable Keychain interaction")
        _ = try bridgeCall("secret");check(silentDenied==2 && interactiveAttempts==0,"failed legacy recovery remains silent and does not loop")
        _ = try bridgeCall("secret",["text":"sk-synthetic-reconfigured-key-123456"])
        check(try bridgeCall("secret") as? String=="sk-synthetic-reconfigured-key-123456" && unexpectedCredentialReads==0,"in-app reconfiguration saves a usable key without touching session credentials")
        check(interactiveAttempts==0,"all credential routes suppress interactive backend access including writes")
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
        do{try markerApp.storageQueue.sync{try markerApp.saveIdentity("invalid identity")};fatalError("invalid identity accepted")}catch{check(markerApp.hasLogoutMarker(),"invalid profile save cannot clear explicit logout")}
        let readsBeforeProfile=credentialReads
        try markerApp.storageQueue.sync{try markerApp.saveIdentity("{\"id\":\"new-fixture\",\"password\":\"excluded\",\"token\":\"excluded\"}")}
        check(!markerApp.hasLogoutMarker() && markerApp.storageQueue.sync{markerApp.storedIdentity()}.contains("new-fixture") && credentialReads==readsBeforeProfile,"profile metadata restores local account without accessing Keychain")
        let profile=try String(contentsOf:markerApp.profileIdentityURL(),encoding:.utf8),mode=(try FileManager.default.attributesOfItem(atPath:markerApp.profileIdentityURL().path))[.posixPermissions] as? Int
        check(!profile.contains("password") && !profile.contains("token") && mode==0o600,"profile cache excludes credentials and is owner-readable only")
        var interactiveSessionAccess=0;app.testKeychainOperation={_,_,_,allowUI,onError in if allowUI{interactiveSessionAccess+=1};onError(errSecInteractionNotAllowed);return nil}
        app.sessionNeedsResume=false;app.testSessionBootstrap={done in done(false)}
        let sessionRecovery=try bridgeCall("authorizeCredentials",["purpose":"session"]) as! [String:Any]
        check(sessionRecovery["authorizationRequired"] as? Bool==false && interactiveSessionAccess==0,"explicit session recovery also forbids interactive credential reads")
        let impossible=isolated.appendingPathComponent("not-a-directory");try Data("blocked".utf8).write(to:impossible)
        do{try writeLogoutMarker(in:impossible);fatalError("marker write accepted invalid directory")}catch{checks+=1}
        // Actual loopback service and hidden WK page render while a synthetic
        // credential read is deliberately blocked. No real keychain is touched.
        let bundleResources=Bundle.main.resourceURL!;guard bundleResources.path.contains("zhiyun-native-contract.") else{throw appError("Native test bundle is not an isolated directory")}
        let fixtureWeb=bundleResources.appendingPathComponent("web");try FileManager.default.createDirectory(at:fixtureWeb,withIntermediateDirectories:true);try Data("<!doctype html><meta charset=utf-8><body>Preparing classroom</body>".utf8).write(to:fixtureWeb.appendingPathComponent("index.html"))
        let bootApp=App();bootApp.root=isolated.appendingPathComponent("visible-before-credentials");bootApp.testSkipCookiePersistence=true
        let bootConfig=WKWebViewConfiguration();bootConfig.websiteDataStore=bootApp.store;bootApp.web=WKWebView(frame:NSRect(x:0,y:0,width:500,height:300),configuration:bootConfig);bootApp.web.navigationDelegate=bootApp
        let credentialLatch=DispatchSemaphore(value:0);var bootReadStarted=false,bootReads=0,bootRestored=0
        bootApp.testKeychainOperation={name,data,remove,allowUI,onError in bootReads+=1;bootReadStarted=true;if bootReads==1{_ = credentialLatch.wait(timeout:.now()+10)};return nil}
        bootApp.startServer();bootApp.restoreCookies{bootRestored+=1};bootApp.restoreCookies{bootRestored+=1}
        try waitUntil({bootReadStarted && !bootApp.web.isLoading && bootApp.web.url != nil})
        var renderedText:String?,rendered=false;bootApp.web.evaluateJavaScript("document.body.textContent"){value,_ in renderedText=value as? String;rendered=true};try waitUntil({rendered})
        check(renderedText=="Preparing classroom" && bootRestored==0,"startup WebKit interface loads before credential approval finishes")
        credentialLatch.signal();try waitUntil({bootRestored==2});check(bootReads==2,"startup current and legacy cookie reads are each singleflight for concurrent callers")
        bootApp.listener.cancel();bootApp.web.navigationDelegate=nil;bootApp.web.stopLoading()
        var providerKeys=[campusGatewayCredential:Data("campus-synthetic-key".utf8)],aiRequests=[URLRequest]()
        app.storageQueue.sync{app.credentialCache.invalidate()}
        app.testKeychainOperation={name,data,remove,allowUI,onError in if remove{providerKeys.removeValue(forKey:name);return nil};if let data=data{providerKeys[name]=data};return providerKeys[name]}
        app.testAIRequest={aiRequests.append($0)}
        let gatewayStatus=try bridgeCall("aiStatus") as! [String:Any]
        check(gatewayStatus["campusReady"] as? Bool==true && gatewayStatus["personalReady"] as? Bool==false,"gateway status reports readiness without revealing credentials")
        let aiMessage:[[String:Any]]=[["role":"user","content":"Synthetic connection test"]]
        _ = try bridgeCall("ai",["messages":aiMessage]);check(aiRequests.last?.url?.absoluteString==campusGatewayEndpoint,"missing personal key defaults to fixed campus gateway")
        let gatewayBody=try JSONSerialization.jsonObject(with:aiRequests.last!.httpBody!) as! [String:Any]
        check(gatewayBody["model"] as? String==campusGatewayModel && gatewayBody["thinking"]==nil,"campus gateway uses its exact model without unsupported thinking option")
        check(aiRequests.last?.value(forHTTPHeaderField:"Authorization")=="Bearer campus-synthetic-key","gateway uses its separate protected credential")
        providerKeys[app.account+"-deepseek"]=Data("personal-synthetic-key".utf8);app.storageQueue.sync{app.credentialCache.invalidate()}
        _ = try bridgeCall("ai",["messages":aiMessage]);check(aiRequests.last?.url?.host=="api.deepseek.com","auto prefers configured personal API")
        _ = try bridgeCall("ai",["messages":aiMessage,"provider":"campus"]);check(aiRequests.last?.url?.host=="modelgateway.zju.edu.cn","explicit campus selection overrides personal API")
        do{_ = try bridgeCall("ai",["messages":aiMessage,"provider":"https://untrusted.example"]);fatalError("arbitrary AI endpoint accepted")}catch{check(aiRequests.count==3,"unregistered AI endpoint never starts network access")}
        _ = try bridgeCall("ai",["messages":aiMessage,"provider":"personal","purpose":"agent","reasoning_effort":"high"])
        let agentBody=try JSONSerialization.jsonObject(with:aiRequests.last!.httpBody!) as! [String:Any]
        check((agentBody["thinking"] as? [String:String])?["type"]=="enabled" && agentBody["reasoning_effort"] as? String=="high","personal agent enables documented thinking and effort")
        check(agentBody["max_tokens"] as? Int==16384,"agent has room for reasoning and complete tool arguments")
        _ = try bridgeCall("ai",["messages":aiMessage,"provider":"campus","purpose":"agent","reasoning_effort":"high"])
        let campusAgentBody=try JSONSerialization.jsonObject(with:aiRequests.last!.httpBody!) as! [String:Any]
        check(campusAgentBody["thinking"]==nil && campusAgentBody["reasoning_effort"]==nil && campusAgentBody["model"] as? String==campusGatewayModel,"local gateway keeps its own protocol without unsupported personal parameters")
        let countBeforeInvalid=aiRequests.count
        do{_ = try bridgeCall("ai",["messages":aiMessage,"purpose":"agent","reasoning_effort":"arbitrary"]);fatalError("invalid reasoning effort accepted")}catch{check(aiRequests.count==countBeforeInvalid,"invalid effort is rejected before external request")}
        let longerTask=Array(repeating:["role":"user","content":"synthetic step"],count:105)
        _ = try bridgeCall("ai",["messages":longerTask,"provider":"personal","purpose":"agent"])
        check((try JSONSerialization.jsonObject(with:aiRequests.last!.httpBody!) as! [String:Any])["messages"] is [[String:Any]],"long valid agent tool history is accepted beyond ordinary chat limit")
        var visibleDeltas=[String]()
        let stream=AIStream(URLRequest(url:URL(string:"https://synthetic.invalid")!),start:false,event:{visibleDeltas.append($0)},done:{_,_ in})
        let reasoningRows=["data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"private reasoning\"}}]}\r\n","data:{\"choices\":[{\"delta\":{\"content\":\"Visible result\",\"tool_calls\":[{\"index\":0,\"id\":\"test-call\",\"function\":{\"name\":\"app_do\",\"arguments\":\"{}\"}}]},\"finish_reason\":\"tool_calls\"}]}\n"]
        for row in reasoningRows{let bytes=Data(row.utf8);stream.consume(bytes.prefix(7));stream.consume(bytes.dropFirst(7))}
        let streamResult=stream.result()
        check(streamResult["reasoning_content"] as? String=="private reasoning" && visibleDeltas==["Visible result"],"SSE preserves reasoning across fragmented CRLF chunks without revealing it to UI")
        check(streamResult["finish_reason"] as? String=="tool_calls" && (streamResult["calls"] as? [[String:Any]])?.count==1,"SSE keeps finish reason and tool calls for a complete agent round")
        stream.session.invalidateAndCancel()
        _ = try bridgeCall("campusGateway",["key":"synthetic-campus-provision-12345"]);check(providerKeys[campusGatewayCredential]==Data("synthetic-campus-provision-12345".utf8),"local campus provisioning saves only to credential backend")
        let structuredOCR: [String:Any] = ["errorCode":0,"result":["layoutParsingResults":[["markdown":["text":"# Formula\n$x=2$"],"outputImages":["layout":"discarded-image-bytes"]]]]]
        check(try campusLayoutText(JSONSerialization.data(withJSONObject:structuredOCR))=="# Formula\n$x=2$","layout OCR preserves Markdown and formula while excluding image payloads")
        do{_ = try campusLayoutText(Data("{\"errorCode\":1}".utf8));fatalError("OCR error accepted")}catch{checks+=1}
        let ocrImage=NSImage(size:NSSize(width:700,height:160));ocrImage.lockFocus();NSColor.white.setFill();NSRect(x:0,y:0,width:700,height:160).fill();NSAttributedString(string:"SYNTHETIC 42",attributes:[.font:NSFont.systemFont(ofSize:50),.foregroundColor:NSColor.black]).draw(at:NSPoint(x:30,y:50));ocrImage.unlockFocus()
        let ocrPNG=NSBitmapImageRep(data:ocrImage.tiffRepresentation!)!.representation(using:.png,properties:[:])!
        let ocrResult=try bridgeCall("recognizeSlide",["image":"data:image/png;base64,"+ocrPNG.base64EncodedString()]) as! [String:Any]
        check((ocrResult["text"] as? String)?.contains("SYNTHETIC")==true && ocrResult["method"] as? String=="local-ocr","native on-device OCR reads synthetic slide without multimodal API")
        app.testAIRequest=nil
        window.contentView=nil;view.uiDelegate=nil;view.navigationDelegate=nil;window.close()
        print("Native bridge contract checks passed: \(checks)")
    }
}
