import Cocoa
import WebKit
import Network
import Security
import CryptoKit
import UniformTypeIdentifiers
import ImageIO
import Vision

func appError(_ message:String, code:Int=1)->NSError { NSError(domain:"智云助手",code:code,userInfo:[NSLocalizedDescriptionKey:message]) }

func digest(_ value: String) -> String { SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined() }
func trusted(_ u: URL) -> Bool {
    guard u.scheme == "https", u.user == nil, u.password == nil, u.port == nil || u.port == 443, let h = u.host?.lowercased() else { return false }
    return ["zju.edu.cn", "chinamcloud.com", "chinamcloud.cn", "chinamcache.com"].contains { h == $0 || h.hasSuffix("." + $0) }
}
// Serial callers suppress UI only for one background operation and restore the
// process policy afterwards. This does not change an item's ACL or signing rule.
func withKeychainInteractionPolicy<T>(allowUI:Bool,get:()throws->Bool,set:(Bool)throws->Void,operation:()throws->T)throws->T{
    if allowUI{return try operation()}
    let prior=try get();defer{if prior{try? set(prior)}};if prior{try set(false)};return try operation()
}
func keychain(_ name:String,_ data:Data?=nil,remove:Bool=false,allowUI:Bool=false,onError:((OSStatus)->Void)?=nil)->Data?{
    do{return try withKeychainInteractionPolicy(allowUI:false,get:{
        var allowed=DarwinBoolean(false);let status=SecKeychainGetUserInteractionAllowed(&allowed);guard status==errSecSuccess else{throw appError("钥匙串策略不可读",code:Int(status))};return allowed.boolValue
    },set:{allowed in
        let status=SecKeychainSetUserInteractionAllowed(allowed);guard status==errSecSuccess else{throw appError("钥匙串交互策略不可设置",code:Int(status))}
    },operation:{
        let query:[String:Any]=[kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:"cn.suike.slides.mac",kSecAttrAccount as String:name]
        if remove{let status=SecItemDelete(query as CFDictionary);if status != errSecSuccess && status != errSecItemNotFound{onError?(status)};return nil}
        if let data=data{
            var status=SecItemUpdate(query as CFDictionary,[kSecValueData as String:data] as CFDictionary)
            if status==errSecItemNotFound{
                var add=query;add[kSecValueData as String]=data;add[kSecAttrAccessible as String]=kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
                add[kSecAttrLabel as String]=(name.hasPrefix("cookies") || name.hasPrefix(persistedSessionCredential)) ? "智云助手 · 智云课堂会话":name.hasPrefix("identity") ? "智云助手 · 账号信息":name.hasPrefix(campusGatewayCredential) ? "智云助手 · 浙大校园网关":name.hasPrefix(campusOCRCredential) ? "智云助手 · 校园课件OCR":"智云助手 · DeepSeek API密钥"
                add[kSecAttrDescription as String]=(name.hasPrefix("cookies") || name.hasPrefix(persistedSessionCredential)) ? "恢复课堂登录会话，不保存校园密码":name.hasPrefix("identity") ? "恢复账号和本机学习入口":"用于课程问答和本页速览"
                status=SecItemAdd(add as CFDictionary,nil)
            }
            guard status==errSecSuccess else{onError?(status);return nil};return data
        }
        var lookup=query;lookup[kSecReturnData as String]=true;lookup[kSecMatchLimit as String]=kSecMatchLimitOne
        var output:CFTypeRef?;let status=SecItemCopyMatching(lookup as CFDictionary,&output)
        guard status==errSecSuccess else{if status != errSecItemNotFound{onError?(status)};return nil};return output as? Data
    })}catch{onError?(OSStatus((error as NSError).code));return nil}
}
// A new ad-hoc build must not update an old build's ACL-protected item. Keep
// secrets in Keychain; this owner-only index contains item names, never values.
final class CredentialSlots {
    typealias Backend=(String,Data?,Bool,@escaping(OSStatus)->Void)->Data?
    private let indexURL:URL,tag:String,backend:Backend
    init(indexURL:URL,tag:String,backend:@escaping Backend){self.indexURL=indexURL;self.tag=tag;self.backend=backend}
    private func index()->[String:String]{guard let data=try? Data(contentsOf:indexURL),data.count<256*1024 else{return [:]};return (try? JSONDecoder().decode([String:String].self,from:data)) ?? [:]}
    private func record(_ logical:String,_ slot:String)throws{
        var rows=index();rows[logical]=slot
        try FileManager.default.createDirectory(at:indexURL.deletingLastPathComponent(),withIntermediateDirectories:true)
        try JSONEncoder().encode(rows).write(to:indexURL,options:.atomic)
        try FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:indexURL.path)
    }
    func access(_ name:String,_ data:Data?,remove:Bool,onError:@escaping(OSStatus)->Void)->Data?{
        let slot=name+"-app-"+tag,previous=index()[name]
        if remove{
            // Tombstone first: an inaccessible legacy item must never reappear.
            do{try record(name,"")}catch{onError(errSecIO);return nil}
            _ = backend(slot,nil,true){onError($0)};return nil
        }
        if let data=data{
            guard let stored=backend(slot,data,false,onError) else{return nil}
            do{try record(name,slot)}catch{onError(errSecIO);return nil};return stored
        }
        if previous==""{return nil}
        var failure:OSStatus?
        var candidates=[slot]
        if let previous=previous,previous.hasPrefix(name+"-app-"),previous != slot{candidates.append(previous)}
        candidates.append(name)
        for candidate in candidates{
            if let stored=backend(candidate,nil,false,{failure=$0}){
                if candidate != slot{
                    // Migration is optional and silent; never replace the source.
                    if backend(slot,stored,false,{_ in}) != nil{try? record(name,slot)}
                }
                return stored
            }
        }
        if let failure=failure{onError(failure)};return nil
    }
}

/// AI service keys must outlive app updates. An ad-hoc rebuild can never silently read a Keychain
/// item another build created: the item's partition rejects it even with an open access list, and
/// this app never prompts. So the campus model gateway key, the campus layout OCR key and each
/// account's personal DeepSeek key live in an owner-only file in the app's data folder; the course
/// session and account identity stay in Keychain. A key an earlier build stored and this build can
/// still read moves into the file once, as does the campus file the previous build wrote.
func fileStoredCredential(_ name:String)->Bool{name==campusGatewayCredential || name==campusOCRCredential || name.hasSuffix("-deepseek")}
final class ServiceKeyStore {
    typealias Legacy=(Data?,Bool)->Data?
    let url:URL,earlier:URL?,bundled:[String:String]
    init(url:URL,earlier:URL?=nil,bundled:[String:String]=[:]){self.url=url;self.earlier=earlier;self.bundled=bundled}
    private func read(_ file:URL)->[String:String]?{guard let data=try? Data(contentsOf:file),data.count<64*1024 else{return nil};return try? JSONDecoder().decode([String:String].self,from:data)}
    private func rows()->[String:String]{
        if let rows=read(url){return rows}
        guard let earlier,let rows=read(earlier) else{return [:]}
        if (try? save(rows)) != nil{try? FileManager.default.removeItem(at:earlier)}
        return rows
    }
    private func save(_ rows:[String:String])throws{
        let fm=FileManager.default,folder=url.deletingLastPathComponent();try fm.createDirectory(at:folder,withIntermediateDirectories:true)
        let data=try JSONEncoder().encode(rows),temp=folder.appendingPathComponent("."+url.lastPathComponent+"."+UUID().uuidString)
        // Owner-only from creation, then an atomic rename: the file is never readable by others.
        let fd=open(temp.path,O_WRONLY|O_CREAT|O_EXCL,0o600);guard fd>=0 else{throw appError("无法保存密钥")}
        let written=data.withUnsafeBytes{bytes in Darwin.write(fd,bytes.baseAddress,bytes.count)==bytes.count};close(fd)
        guard written,rename(temp.path,url.path)==0 else{try? fm.removeItem(at:temp);throw appError("无法保存密钥")}
    }
    func access(_ name:String,_ data:Data?,remove:Bool,onError:@escaping(OSStatus)->Void,legacy:Legacy)->Data?{
        var rows=self.rows()
        if remove{rows.removeValue(forKey:name);do{try save(rows)}catch{onError(errSecIO)};_=legacy(nil,true);return nil}
        if let data=data{
            guard let text=String(data:data,encoding:.utf8) else{onError(errSecParam);return nil}
            rows[name]=text;do{try save(rows)}catch{onError(errSecIO);return nil};return data
        }
        if let text=rows[name]{return Data(text.utf8)}
        if [campusGatewayCredential,campusOCRCredential].contains(name),let text=bundled[name],!text.isEmpty{return Data(text.utf8)}
        guard let stored=legacy(nil,false) else{return nil}
        if let text=String(data:stored,encoding:.utf8){rows[name]=text;try? save(rows)}
        return stored
    }
}

final class KeychainMemoryCache {
    typealias Backend=(String,Data?,Bool,Bool,@escaping(OSStatus)->Void)->Data?
    private let backend:Backend
    private var values=[String:Data](),loaded=Set<String>(),blocked=[String:OSStatus](),failedWrites=[String:Data]()
    init(backend:@escaping Backend){self.backend=backend}
    func requiresAuthorization(_ names:[String])->Bool{names.contains{blocked[$0] != nil}}
    func invalidate(){values.removeAll();loaded.removeAll();blocked.removeAll();failedWrites.removeAll()}
    func access(_ name:String,_ data:Data?=nil,remove:Bool=false,allowUI:Bool=false,onError:((OSStatus)->Void)?=nil)->Data?{
        if !remove,let data=data,loaded.contains(name),values[name]==data,blocked[name]==nil{return data}
        if !remove,data==nil,loaded.contains(name),(!allowUI || blocked[name]==nil){if let error=blocked[name]{onError?(error)};return values[name]}
        if !allowUI,let error=blocked[name]{onError?(error);return nil}
        if !remove,!allowUI,let data=data,failedWrites[name]==data{onError?(errSecInteractionNotAllowed);return nil}
        var failure:OSStatus?;let result=backend(name,data,remove,allowUI){failure=$0}
        if let status=failure{if status==errSecInteractionNotAllowed || status==errSecAuthFailed || status==errSecUserCanceled{blocked[name]=status};onError?(status)}
        if remove{values.removeValue(forKey:name);loaded.insert(name);if failure==nil{blocked.removeValue(forKey:name)};failedWrites.removeValue(forKey:name);return nil}
        if data==nil{loaded.insert(name);values[name]=result;if failure==nil{blocked.removeValue(forKey:name);failedWrites.removeValue(forKey:name)};return result}
        guard let result=result else{failedWrites[name]=data;return nil}
        loaded.insert(name);values[name]=result;blocked.removeValue(forKey:name);failedWrites.removeValue(forKey:name);return result
    }
}
// Cookie rows are deliberately explicit: JSON cannot encode HTTPCookie's Date/URL
// properties directly. Session cookies remain session cookies when restored; keeping
// their encrypted snapshot never treats the account identity as proof of access.
let persistedSessionCredential = "session-cookies-v2"
let campusGatewayCredential = "campus-model-gateway-v1"
let campusGatewayEndpoint = "https://modelgateway.zju.edu.cn/v1/chat/completions"
let campusGatewayModel = "deepseek-v4-flash-780k-local"
let campusOCRCredential = "campus-layout-ocr-v1"
let campusOCREndpoint = "https://mcp.zju.edu.cn/api/protal/proxy/system/layout-parsing"
func bundledCampusCredentials(_ url:URL?)->[String:String]{
    guard let url,let data=try? Data(contentsOf:url),data.count<16384,let value=try? JSONDecoder().decode([String:String].self,from:data),let model=value["modelKey"],let ocr=value["ocrKey"],model.range(of:"^[A-Za-z0-9_-]{16,256}$",options:.regularExpression) != nil,ocr.range(of:"^pk_[A-Za-z0-9_-]{16,256}$",options:.regularExpression) != nil else{return [:]}
    return [campusGatewayCredential:model,campusOCRCredential:ocr]
}
func campusLayoutText(_ data:Data)throws->String{
    guard data.count<32*1024*1024,let body=try JSONSerialization.jsonObject(with:data) as? [String:Any],(body["errorCode"] as? Int ?? -1)==0,let result=body["result"] as? [String:Any],let pages=result["layoutParsingResults"] as? [[String:Any]] else{throw appError("校园OCR未返回有效的识别结果")}
    let text=pages.prefix(12).compactMap{page -> String? in
        if let markdown=page["markdown"] as? [String:Any],let text=markdown["text"] as? String,!text.isEmpty{return text}
        guard let pruned=page["prunedResult"] as? [String:Any],let blocks=pruned["parsing_res_list"] as? [[String:Any]] else{return nil}
        return blocks.sorted{($0["block_order"] as? Int ?? 0)<($1["block_order"] as? Int ?? 0)}.compactMap{$0["block_content"] as? String}.joined(separator:"\n")
    }.joined(separator:"\n\n")
    guard !text.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty else{throw appError("校园OCR未识别出文字或公式")};return String(text.prefix(30000))
}
func logoutMarker(in root:URL)->URL{root.appendingPathComponent("session-logged-out")}
func writeLogoutMarker(in root:URL)throws{
    try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true);try Data("1".utf8).write(to:logoutMarker(in:root),options:.atomic)
}
func removeLogoutMarker(in root:URL)throws{
    let path=logoutMarker(in:root);if FileManager.default.fileExists(atPath:path.path){try FileManager.default.removeItem(at:path)}
}
func trustedCookieDomain(_ domain:String)->Bool {
    guard !domain.isEmpty,domain.range(of:"^[A-Za-z0-9.-]+$",options:.regularExpression) != nil else{return false}
    return URL(string:"https://"+domain.trimmingCharacters(in:CharacterSet(charactersIn:"."))).map(trusted) ?? false
}
func cookieDomainMatches(_ cookie:HTTPCookie,_ host:String)->Bool {
    let domain=cookie.domain.lowercased(),bare=domain.trimmingCharacters(in:CharacterSet(charactersIn:".")),host=host.lowercased()
    return host==bare || (domain.hasPrefix(".") && host.hasSuffix("."+bare))
}
func cookieApplies(_ cookie:HTTPCookie,to url:URL,now:Date=Date())->Bool {
    guard let host=url.host,cookieDomainMatches(cookie,host),!cookie.isSecure || url.scheme=="https",cookie.expiresDate==nil || cookie.expiresDate!>now else{return false}
    return url.path==cookie.path || url.path.hasPrefix(cookie.path.hasSuffix("/") ? cookie.path:cookie.path+"/")
}
func encodedCookies(_ cookies:[HTTPCookie],now:Date=Date())throws->Data {
    let rows=cookies.filter{trustedCookieDomain($0.domain) && ($0.expiresDate==nil || $0.expiresDate!>now)}.sorted{($0.domain,$0.path,$0.name)<($1.domain,$1.path,$1.name)}.prefix(2048).map{cookie -> [String:Any] in
        var row:[String:Any]=["name":cookie.name,"value":cookie.value,"domain":cookie.domain,"path":cookie.path,"secure":cookie.isSecure,"httpOnly":cookie.isHTTPOnly,"sessionOnly":cookie.isSessionOnly,"version":cookie.version]
        if let date=cookie.expiresDate{row["expires"]=date.timeIntervalSince1970}
        if let sameSite=cookie.properties?[HTTPCookiePropertyKey(rawValue:"SameSite")] as? String{row["sameSite"]=sameSite}
        if let ports=cookie.portList{row["ports"]=ports.map{String(describing:$0)}.joined(separator:",")}
        return row
    }
    let data=try JSONSerialization.data(withJSONObject:rows,options:.sortedKeys);guard data.count<=2*1024*1024 else{throw appError("登录会话数据过大")};return data
}
func decodedCookies(_ data:Data,now:Date=Date())->[HTTPCookie] {
    guard data.count<=2*1024*1024,let rows=try? JSONSerialization.jsonObject(with:data) as? [[String:Any]],rows.count<=2048 else{return []}
    return rows.compactMap{row in
        guard let domain=(row["domain"] ?? row["Domain"]) as? String,trustedCookieDomain(domain),let name=(row["name"] ?? row["Name"]) as? String,!name.isEmpty,name.count<=256,!name.contains(where:{"\r\n;=".contains($0)}),let value=(row["value"] ?? row["Value"]) as? String,value.utf8.count<=16384,!value.contains(where:{"\r\n".contains($0)}) else{return nil}
        let path=(row["path"] ?? row["Path"]) as? String ?? "/";guard path.hasPrefix("/"),!path.contains(where:{"\r\n".contains($0)}) else{return nil}
        var properties:[HTTPCookiePropertyKey:Any]=[.name:name,.value:value,.domain:domain,.path:path,.version:row["version"] as? Int ?? 0]
        if row["secure"] as? Bool ?? true{properties[.secure]="TRUE"}
        if row["httpOnly"] as? Bool == true{properties[HTTPCookiePropertyKey(rawValue:"HttpOnly")]="TRUE"}
        if let sameSite=row["sameSite"] as? String,["lax","strict","none"].contains(sameSite.lowercased()){properties[HTTPCookiePropertyKey(rawValue:"SameSite")]=sameSite}
        if let expires=row["expires"] as? Double{guard expires>now.timeIntervalSince1970 else{return nil};properties[.expires]=Date(timeIntervalSince1970:expires)}
        // Foundation treats any Discard property (even "FALSE") as session-only.
        if row["sessionOnly"] as? Bool == true{properties[.discard]="TRUE"}
        if let ports=row["ports"] as? String,ports.range(of:"^[0-9,]+$",options:.regularExpression) != nil{properties[.port]=ports}
        return HTTPCookie(properties:properties)
    }
}
func campusBearer(_ cookies:[HTTPCookie])->String? {
    let target=URL(string:"https://classroom.zju.edu.cn/")!,allowed=cookies.filter{cookieApplies($0,to:target) && $0.name=="_token"}.sorted{$0.path.count>$1.path.count}
    for cookie in allowed {
        var value=cookie.value
        for _ in 0..<2{guard let decoded=value.removingPercentEncoding,decoded != value else{break};value=decoded}
        guard let regex=try? NSRegularExpression(pattern:"s:\\d+:\"_token\";(?:i:\\d+;)?s:\\d+:\"([^\"\\r\\n]+)\""),let match=regex.firstMatch(in:value,range:NSRange(value.startIndex...,in:value)),let range=Range(match.range(at:1),in:value) else{continue}
        return String(value[range])
    }
    return nil
}
func authenticationExpired(_ response:HTTPURLResponse,_ data:Data)->Bool {
    if response.statusCode==403 {
        // An identity endpoint has no per-course access decision. Its denial
        // means the saved login is no longer accepted, even before JWT expiry.
        return response.url?.host=="classroom.zju.edu.cn" && response.url?.path=="/userapi/v1/infosimple"
    }
    if response.statusCode==401{return true}
    guard (200..<400).contains(response.statusCode) else{return false}
    if let row=try? JSONSerialization.jsonObject(with:data) as? [String:Any]{
        var pending=[row],codes=[Int](),depth=0
        while !pending.isEmpty && depth<3{
            var next=[[String:Any]]()
            for item in pending{if let code=item["code"] as? Int ?? Int(item["code"] as? String ?? ""){codes.append(code)};for key in ["result","data"]{if let nested=item[key] as? [String:Any]{next.append(nested)}}}
            pending=next;depth+=1
        }
        if codes.contains(403){return false};if codes.contains(401){return true}
    }
    let type=response.mimeType?.lowercased() ?? "",host=response.url?.host?.lowercased() ?? "",path=response.url?.path.lowercased() ?? ""
    return type.contains("text/html") && (host != "classroom.zju.edu.cn" || path.contains("login") || data.starts(with:Array("<!DOCTYPE".utf8)) || data.starts(with:Array("<!doctype".utf8)))
}
// Only known read-only POST endpoints may be replayed after authentication.
func replayableCourseRead(_ url:URL,body:String)->Bool {
    body.isEmpty || (url.host == "classroom.zju.edu.cn" && url.path == "/courseapi/v2/course/video-and-live-promission-by-user-id")
}
let officialSessionURL=URL(string:"https://tgmedia.cmc.zju.edu.cn?forward=https%3A%2F%2Fclassroom.zju.edu.cn%2F&tenant_code=112")!
func bearerNeedsRenewal(_ bearer:String?,now:Date=Date())->Bool {
    guard let bearer=bearer else{return true};let parts=bearer.split(separator:".",omittingEmptySubsequences:false)
    guard parts.count==3 else{return false};var payload=String(parts[1]).replacingOccurrences(of:"-",with:"+").replacingOccurrences(of:"_",with:"/")
    payload+=String(repeating:"=",count:(4-payload.count%4)%4)
    guard let bytes=Data(base64Encoded:payload),let json=try? JSONSerialization.jsonObject(with:bytes) as? [String:Any],let expiry=json["exp"] as? Double else{return false}
    return expiry<=now.timeIntervalSince1970+30
}
// Ad-hoc app updates have different Keychain partitions. Keep an encrypted,
// owner-only session snapshot independent of the executable signature. No campus
// password is stored. Legacy Keychain snapshots are imported silently once.
final class SessionVault {
    let root:URL
    init(root:URL){self.root=root}
    private var keyURL:URL{root.appendingPathComponent("session-key.bin")}
    private var dataURL:URL{root.appendingPathComponent("session.sealed")}
    private func write(_ data:Data,to url:URL)throws {
        try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
        let temp=root.appendingPathComponent("."+UUID().uuidString+".tmp")
        let fd=open(temp.path,O_WRONLY|O_CREAT|O_EXCL,0o600);guard fd>=0 else{throw appError("无法保存登录会话")}
        defer{close(fd);try? FileManager.default.removeItem(at:temp)}
        let written=data.withUnsafeBytes{bytes in Darwin.write(fd,bytes.baseAddress,bytes.count)==bytes.count}
        guard written,rename(temp.path,url.path)==0 else{throw appError("无法保存登录会话")}
    }
    func read()->Data? {
        guard let key=try? Data(contentsOf:keyURL),key.count==32,let data=try? Data(contentsOf:dataURL),data.count<=3*1024*1024,let box=try? AES.GCM.SealedBox(combined:data) else{return nil}
        return try? AES.GCM.open(box,using:SymmetricKey(data:key))
    }
    func save(_ data:Data)throws {
        guard data.count<=2*1024*1024 else{throw appError("会话数据过大")}
        let bytes:Data
        if let existing=try? Data(contentsOf:keyURL),existing.count==32{bytes=existing}
        else{bytes=SymmetricKey(size:.bits256).withUnsafeBytes{Data($0)};try write(bytes,to:keyURL)}
        let box=try AES.GCM.seal(data,using:SymmetricKey(data:bytes));guard let combined=box.combined else{throw appError("无法保存登录会话")};try write(combined,to:dataURL)
    }
    func remove(){try? FileManager.default.removeItem(at:dataURL);try? FileManager.default.removeItem(at:keyURL)}
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
    let aliases=["deepseek-pro":"deepseek-v4-pro","deepseek-reasoner":"deepseek-v4-pro","deepseek-chat":"deepseek-flash","deepseek-v4-flash":"deepseek-flash","deepseek-v4-flash-vision-exp":"deepseek-flash"]
    let value=aliases[requested] ?? requested
    guard ["deepseek-flash","deepseek-v4-pro"].contains(value) else{return nil}
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
struct PreparedImageDrag {
    let png:Data,image:NSImage,fileName:String
    var tiff:Data?{
        guard let source=CGImageSourceCreateWithData(png as CFData,nil),let cg=CGImageSourceCreateImageAtIndex(source,0,nil),let raster=rasterizedDragImage(cg) else{return nil}
        return NSBitmapImageRep(cgImage:raster).tiffRepresentation
    }
}
func rasterizedDragImage(_ image:CGImage)->CGImage?{
    guard let context=CGContext(data:nil,width:image.width,height:image.height,bitsPerComponent:8,bytesPerRow:0,space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue) else{return nil}
    context.draw(image,in:CGRect(x:0,y:0,width:image.width,height:image.height));return context.makeImage()
}
func dragImageFileName(_ name:String)->String{
    let cleaned=String(name.filter{!"/\\:\r\n".contains($0)}.prefix(128)),stem=(cleaned as NSString).deletingPathExtension.trimmingCharacters(in:.whitespacesAndNewlines)
    return (stem.isEmpty ? "课件":stem)+".png"
}
func preparedImageDrag(_ value:String,name:String)throws->PreparedImageDrag {
    let decoded=try decodedNoteImage(value)
    guard let source=CGImageSourceCreateWithData(decoded.data as CFData,nil),let image=CGImageSourceCreateImageAtIndex(source,0,nil) else{throw appError("无法读取拖动图片")}
    let png:Data
    if decoded.extension=="png"{png=decoded.data}else{
        guard let raster=rasterizedDragImage(image),let data=NSBitmapImageRep(cgImage:raster).representation(using:.png,properties:[:]),data.count<=64*1024*1024 else{throw appError("拖动图片过大")};png=data
    }
    return PreparedImageDrag(png:png,image:NSImage(cgImage:image,size:NSSize(width:image.width,height:image.height)),fileName:dragImageFileName(name))
}
final class ImagePromiseWriter:NSFilePromiseProvider {
    var imageData:PreparedImageDrag?
    override init(){super.init()}
    convenience init(_ image:PreparedImageDrag,delegate:NSFilePromiseProviderDelegate){self.init();imageData=image;fileType=UTType.png.identifier;self.delegate=delegate}
    override func writableTypes(for pasteboard:NSPasteboard)->[NSPasteboard.PasteboardType]{super.writableTypes(for:pasteboard)+[.png,.tiff]}
    override func pasteboardPropertyList(forType type:NSPasteboard.PasteboardType)->Any?{if type == .png{return imageData?.png};if type == .tiff{return imageData?.tiff};return super.pasteboardPropertyList(forType:type)}
}
final class ImageDragSource:NSObject,NSDraggingSource,NSFilePromiseProviderDelegate {
    let image:PreparedImageDrag,id=UUID(),finished:(UUID)->Void
    let promiseQueue:OperationQueue = {let queue=OperationQueue();queue.qualityOfService = .utility;queue.maxConcurrentOperationCount=1;return queue}()
    init(_ image:PreparedImageDrag,finished:@escaping(UUID)->Void){self.image=image;self.finished=finished}
    func draggingSession(_ session:NSDraggingSession,sourceOperationMaskFor context:NSDraggingContext)->NSDragOperation{.copy}
    func ignoreModifierKeys(for session:NSDraggingSession)->Bool{true}
    func draggingSession(_ session:NSDraggingSession,endedAt screenPoint:NSPoint,operation:NSDragOperation){
        // A receiver may request a promised file after the drag has ended. Keep the
        // delegate alive briefly; copying to an editor instead uses PNG/TIFF directly.
        DispatchQueue.main.asyncAfter(deadline:.now()+15){self.finished(self.id)}
    }
    func filePromiseProvider(_ provider:NSFilePromiseProvider,fileNameForType fileType:String)->String{image.fileName}
    func filePromiseProvider(_ provider:NSFilePromiseProvider,writePromiseTo url:URL,completionHandler:@escaping(Error?)->Void){do{try image.png.write(to:url,options:.atomic);completionHandler(nil)}catch{completionHandler(error)}}
    func operationQueue(for provider:NSFilePromiseProvider)->OperationQueue{promiseQueue}
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
// Metadata reads never load weights. Only a submitted AI request may start Ollama.
final class LocalGemmaService {
    private let session:URLSession
    private var ownedServer:Process?
    init(){let config=URLSessionConfiguration.ephemeral;config.connectionProxyDictionary=[:];config.urlCache=nil;config.httpCookieStorage=nil;session=URLSession(configuration:config)}
    static var executable:URL? { ["/Applications/Ollama.app/Contents/Resources/ollama","/opt/homebrew/bin/ollama","/usr/local/bin/ollama"].first{FileManager.default.isExecutableFile(atPath:$0)}.map{URL(fileURLWithPath:$0)} }
    func discover(_ done:@escaping(URL?,[String])->Void){
        func attempt(_ ports:[Int]) {
            guard let port=ports.first else{done(nil,[]);return}
            let base=URL(string:"http://127.0.0.1:\(port)")!;var request=URLRequest(url:base.appendingPathComponent("api/tags"));request.timeoutInterval=2
            session.dataTask(with:request){data,response,_ in
                if let response=response as? HTTPURLResponse,response.statusCode==200,let data=data,let row=try? JSONSerialization.jsonObject(with:data) as? [String:Any],let models=row["models"] as? [[String:Any]] {
                    let names=models.compactMap{$0["name"] as? String}.filter{$0.lowercased().contains("gemma")}.sorted();done(base,names)
                }else{attempt(Array(ports.dropFirst()))}
            }.resume()
        }
        attempt([11439,11434])
    }
    private func otherModelBusy(_ done:@escaping(Bool)->Void){
        // The optional shared coordinator serializes heavyweight runtimes. Do
        // not leave a cancelled Gemma request queued behind another app's job.
        var request=URLRequest(url:URL(string:"http://127.0.0.1:11437/status")!);request.timeoutInterval=1
        session.dataTask(with:request){data,_,_ in
            let row=data.flatMap{try? JSONSerialization.jsonObject(with:$0) as? [String:Any]},http=row?["http"] as? [String:Any],requests=http?["requests"] as? [String:Any]
            done((requests?["active"] as? Int ?? 0)>0)
        }.resume()
    }
    func prepare(model:String?,done:@escaping(URL?,String?,String?)->Void){
        func select(_ base:URL?,_ models:[String]){
            guard let base=base else{done(nil,nil,"本地 Ollama 服务未能启动，请打开 Ollama 后重试");return}
            let selected=(model?.isEmpty==false ? model:nil) ?? models.first(where:{$0=="gemma4:31b-mlx"}) ?? models.first
            guard let selected=selected,models.contains(selected) else{done(nil,nil,"未找到已安装的 Gemma 模型，请先在 Ollama 中安装 Gemma，并在 AI 设置中选择");return}
            if base.port==11439{self.otherModelBusy{busy in if busy{done(nil,nil,"另一个本地模型正在处理任务，请稍后重试。当前对话已保留")}else{done(base,selected,nil)}}}else{done(base,selected,nil)}
        }
        discover{base,models in
            if base != nil{select(base,models);return}
            guard let executable=Self.executable else{done(nil,nil,"尚未安装 Ollama，请先安装本地服务和 Gemma 模型");return}
            DispatchQueue.global(qos:.utility).async{
                let server=Process();server.executableURL=executable;server.arguments=["serve"];server.standardOutput=FileHandle.nullDevice;server.standardError=FileHandle.nullDevice
                do{try server.run();self.ownedServer=server}catch{done(nil,nil,"无法启动本地 Ollama 服务");return}
                func wait(_ remaining:Int){self.discover{base,models in if base != nil || remaining==0{select(base,models)}else{DispatchQueue.global(qos:.utility).asyncAfter(deadline:.now()+0.3){wait(remaining-1)}}}}
                wait(10)
            }
        }
    }
}
func localGemmaRequest(base:URL,model:String,messages:[[String:Any]],tools:[[String:Any]]?=nil)throws->URLRequest{
    guard base.scheme=="http",base.host=="127.0.0.1",[11434,11439].contains(base.port ?? 0),base.path.isEmpty,model.lowercased().contains("gemma") else{throw appError("本地模型地址无效")}
    var toolNames=[String:String]()
    for message in messages{for call in message["tool_calls"] as? [[String:Any]] ?? []{if let id=call["id"] as? String,let fn=call["function"] as? [String:Any],let name=fn["name"] as? String{toolNames[id]=name}}}
    let converted=try messages.map{message -> [String:Any] in
        var row=message
        if let parts=message["content"] as? [[String:Any]] {
            var text=[String](),images=[String]()
            for part in parts {
                if let value=part["text"] as? String{text.append(value)}
                if part["type"] as? String=="image_url",let image=part["image_url"] as? [String:Any],let url=image["url"] as? String{
                    guard url.hasPrefix("data:image/"),let comma=url.firstIndex(of:","),url[..<comma].hasSuffix(";base64") else{throw appError("本地模型只接收本机课件图片")};images.append(String(url[url.index(after:comma)...]))
                }
            }
            row["content"]=text.joined(separator:"\n");if !images.isEmpty{row["images"]=images}
        }
        if let calls=row["tool_calls"] as? [[String:Any]]{row["tool_calls"]=try calls.map{call -> [String:Any] in var result=call;if var function=call["function"] as? [String:Any],let arguments=function["arguments"] as? String{function["arguments"]=try JSONSerialization.jsonObject(with:Data(arguments.utf8));result["function"]=function};return result}}
        if let id=row["tool_call_id"] as? String,let name=toolNames[id]{row["tool_name"]=name};row.removeValue(forKey:"reasoning_content");return row
    }
    var body:[String:Any]=["model":model,"messages":converted,"stream":true,"keep_alive":"5m","think":false,"options":["num_ctx":32768,"num_predict":4096]]
    if let tools=tools,!tools.isEmpty{body["tools"]=tools}
    var request=URLRequest(url:base.appendingPathComponent("api/chat"));request.httpMethod="POST";request.timeoutInterval=600;request.setValue("application/json",forHTTPHeaderField:"Content-Type");request.httpBody=try JSONSerialization.data(withJSONObject:body);return request
}

final class App: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate, NSWindowDelegate, URLSessionTaskDelegate, WKUIDelegate, NSToolbarDelegate, NSMenuItemValidation {
    var window: NSWindow!, web: WKWebView!, login: NSWindow?, loginWeb: WKWebView?
    var listener: NWListener!, origin="", token=UUID().uuidString, account="guest", downloads=[String:Download](), requests=[String:URLSessionDataTask](), cancelledRequests=Set<String>(),pendingRequests=Set<String>()
    let fm=FileManager.default
    #if NATIVE_CONTRACT_TESTS
    let store=WKWebsiteDataStore.nonPersistent()
    #else
    let store=WKWebsiteDataStore.default()
    #endif
    let storageQueue=DispatchQueue(label:"cn.suike.mac.storage",qos:.utility)
    var loggingOut=false, lastWebRecovery=Date.distantPast
    var sessionNeedsResume=false
    private var latestCookieSnapshot:Data?
    private lazy var sessionVault=SessionVault(root:root.appendingPathComponent("Session",isDirectory:true))
    private var sessionProbeActive=false
    private var loginCompletionPending=false,loginVisitedAuthentication=false
    private var cookieRestoreStarted=false,cookieRestoreComplete=false,cookieRestoreCallbacks=[()->Void](),credentialUIAllowed=false
    private var accountGeneration=UUID()
    private var pendingAI=Set<String>(),cancelledAI=Set<String>()
    // Legacy allowUI arguments only bypass a cached failure. Actual Keychain
    // access is ALWAYS noninteractive, including explicit save/recovery routes.
    lazy var credentialCache=KeychainMemoryCache{[unowned self] name,data,remove,allowUI,onError in
        #if NATIVE_CONTRACT_TESTS
        if let operation=self.testKeychainOperation{return operation(name,data,remove,false,onError)}
        if let storage=self.testSessionKeychain{return storage(name,data,remove)}
        #endif
        if fileStoredCredential(name){
            return self.serviceKeys.access(name,data,remove:remove,onError:onError){value,remove in self.credentialSlots.access(name,value,remove:remove,onError:onError)}
        }
        return self.credentialSlots.access(name,data,remove:remove,onError:onError)
    }
    private lazy var serviceKeys=ServiceKeyStore(url:root.appendingPathComponent("service-keys.json"),earlier:root.appendingPathComponent("campus-services.json"),bundled:bundledCampusCredentials(Bundle.main.url(forResource:"CampusServices",withExtension:"json")))
    private lazy var credentialSlots:CredentialSlots={
        let bytes=Bundle.main.executableURL.flatMap{try? Data(contentsOf:$0,options:.mappedIfSafe)} ?? Data("unknown-build".utf8)
        let tag=SHA256.hash(data:bytes).prefix(12).map{String(format:"%02x",$0)}.joined()
        return CredentialSlots(indexURL:root.appendingPathComponent("credential-slots.json"),tag:tag){name,data,remove,onError in
            keychain(name,data,remove:remove,allowUI:false,onError:onError)
        }
    }()
    private var sessionWeb:WKWebView?,sessionCallbacks=[(Bool)->Void](),sessionDeadline:DispatchWorkItem?,sessionLastAttempt=Date.distantPast,sessionGeneration=UUID()
    private var toolbarName="",toolbarLoggedIn=false
    var mainToolbar:NSToolbar?
    private var mouseDragMonitor:Any?,lastMouseDrag:NSEvent?,imageDrags=[UUID:ImageDragSource](),preparedDrags=[String:PreparedImageDrag](),preparedDragOrder=[String](),imagePreparationGeneration=UUID()
    var pendingDownloads=[String:URL](),cancelledDownloads=Set<String>()
    var remoteTransfers=[UUID:RemoteTransfer]()
    private var flushPending=false,flushCallbacks=[()->Void](),closingMainWindow=false,mainWindowFlushed=false,terminationPending=false
    private var flushDeadline:DispatchWorkItem?,flushGeneration=UUID()
    #if NATIVE_CONTRACT_TESTS
    // The isolated WebKit harness exercises the real delegate routing without opening
    // a sheet, accessing accounts, or taking over the user's foreground window.
    var testDialogResponder:((String,String,String?)->String?)?
    var testSkipCookiePersistence=false
    var testSessionBootstrap:((@escaping(Bool)->Void)->Void)?
    var testSessionKeychain:((String,Data?,Bool)->Data?)?
    var testKeychainOperation:KeychainMemoryCache.Backend?
    var testAIRequest:((URLRequest)->Void)?
    #endif
    lazy var root: URL = { let path=fm.urls(for:.applicationSupportDirectory,in:.userDomainMask)[0].appendingPathComponent("智云助手 Mac"); try? fm.createDirectory(at:path,withIntermediateDirectories:true); return path }()
    var queue=DispatchQueue(label:"cn.suike.mac.http",qos:.userInitiated)
    lazy var network: URLSession = { let c=URLSessionConfiguration.ephemeral; c.timeoutIntervalForRequest=20; c.timeoutIntervalForResource=90; c.httpCookieStorage=nil; c.urlCache=nil; return URLSession(configuration:c,delegate:self,delegateQueue:nil) }()
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular); setupMenu()
        let config=WKWebViewConfiguration(); config.userContentController.addUserScript(WKUserScript(source:"window.__zhiyunTheme=\""+selectedTheme+"\";window.__zhiyunMode=\""+selectedMode+"\";",injectionTime:.atDocumentStart,forMainFrameOnly:true));config.websiteDataStore=store; config.userContentController.add(self,name:"native"); config.preferences.javaScriptCanOpenWindowsAutomatically=false
        web=WKWebView(frame:.zero,configuration:config); web.navigationDelegate=self;web.uiDelegate=self
        window=NSWindow(contentRect:NSRect(x:0,y:0,width:1320,height:850),styleMask:[.titled,.closable,.miniaturizable,.resizable],backing:.buffered,defer:false)
        window.isReleasedWhenClosed=false; window.title="智云助手"; window.minSize=NSSize(width:640,height:480); window.contentView=web; window.delegate=self;window.setFrameAutosaveName("StudyMainWindow");if !window.setFrameUsingName("StudyMainWindow"){window.center()};installToolbar();installMouseDragMonitor();window.orderFront(nil)
        applyTheme(selectedTheme,persist:false);applyAppearanceMode(selectedMode,persist:false);startServer();restoreCookies {}
    }
    func installMouseDragMonitor(){
        guard mouseDragMonitor==nil else{return}
        mouseDragMonitor=NSEvent.addLocalMonitorForEvents(matching:[.leftMouseDown,.leftMouseDragged,.leftMouseUp]){[weak self] event in
            guard let self=self,event.window === self.window else{return event}
            if event.type == .leftMouseDragged{self.lastMouseDrag=event}else{self.lastMouseDrag=nil};return event
        }
    }
    func dragImage(_ params:[String:Any])throws{
        guard let view=web,let event=lastMouseDrag,event.window === window,ProcessInfo.processInfo.systemUptime-event.timestamp<0.75,NSEvent.pressedMouseButtons & 1 != 0 else{throw appError("请按住课件图片并拖动")}
        guard let token=params["token"] as? String,let prepared=preparedDrags[token] else{throw appError("图片正在准备，请稍后再拖动")}
        let image=PreparedImageDrag(png:prepared.png,image:prepared.image,fileName:dragImageFileName(params["name"] as? String ?? prepared.fileName))
        let source=ImageDragSource(image){[weak self] id in self?.imageDrags.removeValue(forKey:id)},provider=ImagePromiseWriter(image,delegate:source),item=NSDraggingItem(pasteboardWriter:provider)
        let point=view.convert(event.locationInWindow,from:nil),ratio=min(160/image.image.size.width,120/image.image.size.height,1),size=NSSize(width:image.image.size.width*ratio,height:image.image.size.height*ratio)
        item.setDraggingFrame(NSRect(x:point.x-size.width/2,y:point.y-size.height/2,width:size.width,height:size.height),contents:image.image)
        imageDrags[source.id]=source;let session=view.beginDraggingSession(with:[item],event:event,source:source);session.animatesToStartingPositionsOnCancelOrFail=true
    }
    var themeDefaults = UserDefaults.standard
    var themeBrandLabel:NSTextField?
    /// The brand is one plain label with the theme icon as a text attachment. macOS 26+ draws glass
    /// behind stack and image toolbar views but not behind labels, so it matches the plain actions beside it.
    func brandText(_ image:NSImage?)->NSAttributedString{
        let text=NSMutableAttributedString()
        if let image{let icon=NSTextAttachment();icon.image=image;icon.bounds=NSRect(x:0,y:-5,width:20,height:20);text.append(NSAttributedString(attachment:icon));text.append(NSAttributedString(string:" ",attributes:[.kern:4]))}
        text.append(NSAttributedString(string:"智云助手",attributes:[.font:NSFont.systemFont(ofSize:14,weight:.semibold),.foregroundColor:NSColor.labelColor]))
        return text
    }
    /// Three colour schemes; each works in light and dark appearance.
    let themeIdentifiers=["collage","playful","film"]
    /// Earlier releases offered twenty decorative themes; each maps to the closest colour scheme.
    let legacyThemes=["editorial":"playful","candy":"playful","retro":"playful","gallery":"playful","bauhaus":"film","field":"film","marginalia":"film","racing":"film","press":"collage","acid":"collage","terminal":"collage","swiss":"collage","workshop":"collage","post":"collage","memphis":"collage","glass":"collage","metro":"collage","sketch":"collage"]
    var selectedTheme:String {
        let stored=themeDefaults.string(forKey:"appearanceTheme") ?? "collage",value=legacyThemes[stored] ?? stored
        return themeIdentifiers.contains(value) ? value:"collage"
    }
    let appearanceModes=["system","light","dark"]
    var selectedMode:String {
        let value=themeDefaults.string(forKey:"appearanceMode") ?? "system"
        return appearanceModes.contains(value) ? value:"system"
    }
    /// "system" leaves the window appearance unset so WebKit keeps following macOS light/dark changes.
    func applyAppearanceMode(_ mode:String,persist:Bool=true){
        guard appearanceModes.contains(mode) else{return}
        if persist{themeDefaults.set(mode,forKey:"appearanceMode")}
        window?.appearance = mode=="system" ? nil:NSAppearance(named:mode=="dark" ? .darkAqua:.aqua)
        event("appearanceMode",mode)
    }
    func themeImage(_ theme:String)->NSImage? {
        guard let resources=Bundle.main.resourceURL,themeIdentifiers.contains(theme) else{return nil}
        return NSImage(contentsOf:resources.appendingPathComponent("web/theme-"+theme+".png"))
    }
    func applyTheme(_ theme:String,persist:Bool=true){
        guard themeIdentifiers.contains(theme) else{return}
        if persist{themeDefaults.set(theme,forKey:"appearanceTheme")}
        if let image=themeImage(theme){NSApp.applicationIconImage=image;themeBrandLabel?.attributedStringValue=brandText(image);themeBrandLabel?.sizeToFit()}
        event("appearanceTheme",theme)
    }
    func installToolbar(){
        guard let window=window else{return};let toolbar=NSToolbar(identifier:"StudyToolbar")
        toolbar.delegate=self;toolbar.allowsUserCustomization=false;toolbar.autosavesConfiguration=false;toolbar.displayMode = .iconOnly;toolbar.sizeMode = .small
        mainToolbar=toolbar;window.toolbarStyle = .unifiedCompact;window.titleVisibility = .hidden;window.toolbar=toolbar
    }
    /// The title bar takes the colour at the top of the page, so the window reads as one surface.
    /// Only an opaque #RRGGBB value and a known appearance mode are accepted.
    func applyWindowChrome(_ hex:String,mode:String="system")->Bool{
        guard hex.count==7,hex.hasPrefix("#"),hex.dropFirst().allSatisfy({$0.isHexDigit}),let value=UInt32(hex.dropFirst(),radix:16),appearanceModes.contains(mode),let window=window else{return false}
        let red=CGFloat((value>>16)&255)/255,green=CGFloat((value>>8)&255)/255,blue=CGFloat(value&255)/255
        window.titlebarAppearsTransparent=true;window.titlebarSeparatorStyle = .none
        window.backgroundColor=NSColor(srgbRed:red,green:green,blue:blue,alpha:1)
        window.appearance = mode=="system" ? nil:NSAppearance(named:mode=="dark" ? .darkAqua:.aqua)
        return true
    }
    func toolbarIdentifiers()->[NSToolbarItem.Identifier]{
        var values=[NSToolbarItem.Identifier("brand"),.flexibleSpace]
        if toolbarLoggedIn{if !toolbarName.isEmpty{values.append(NSToolbarItem.Identifier("name"))};values.append(NSToolbarItem.Identifier("home"))}
        values.append(NSToolbarItem.Identifier("agent"));values.append(NSToolbarItem.Identifier("theme"));values.append(NSToolbarItem.Identifier("privacy"));if toolbarLoggedIn{values.append(NSToolbarItem.Identifier("logout"))};return values
    }
    func toolbarAllowedItemIdentifiers(_ toolbar:NSToolbar)->[NSToolbarItem.Identifier]{toolbarIdentifiers()}
    func toolbarDefaultItemIdentifiers(_ toolbar:NSToolbar)->[NSToolbarItem.Identifier]{toolbarIdentifiers()}
    func toolbar(_ toolbar:NSToolbar,itemForItemIdentifier identifier:NSToolbarItem.Identifier,willBeInsertedIntoToolbar flag:Bool)->NSToolbarItem?{
        let key=identifier.rawValue,item=NSToolbarItem(itemIdentifier:identifier)
        if key=="brand" || key=="name" {
            let text=key=="brand" ? "智云助手":toolbarName,label=NSTextField(labelWithString:text)
            label.font=NSFont.systemFont(ofSize:key=="brand" ? 14:12,weight:key=="brand" ? .semibold:.regular);label.textColor=key=="brand" ? .labelColor:.secondaryLabelColor
            label.lineBreakMode = .byTruncatingTail;label.setAccessibilityLabel(key=="brand" ? "智云助手":text);label.sizeToFit();if key=="name"{label.frame.size.width=min(160,label.frame.width)}
            if key=="brand" {label.attributedStringValue=brandText(themeImage(selectedTheme));label.sizeToFit();themeBrandLabel=label}
            item.view=label;item.label=text;return item
        }
        guard ["home","agent","theme","privacy","logout"].contains(key) else{return nil}
        let title=key=="home" ? "我的课堂":key=="agent" ? "应用助手":key=="theme" ? "外观":key=="privacy" ? "隐私":"退出登录",button=NSButton(title:title,target:self,action:#selector(toolbarClicked(_:)))
        button.bezelStyle = .rounded;button.isBordered=false;button.controlSize = .small;button.font = .systemFont(ofSize:12);button.identifier=NSUserInterfaceItemIdentifier(key);button.setAccessibilityLabel(title)
        // Every title-bar action carries one SF Symbol; none are left text-only.
        let symbols=["home":"house","agent":"text.bubble","theme":"paintpalette","privacy":"hand.raised","logout":"rectangle.portrait.and.arrow.right"]
        if let name=symbols[key],let image=NSImage(systemSymbolName:name,accessibilityDescription:nil){button.image=image;button.imagePosition = .imageLeading;button.imageHugsTitle=true;button.symbolConfiguration=NSImage.SymbolConfiguration(pointSize:12,weight:.regular)}
        button.sizeToFit();button.frame.size.width+=6
        item.view=button;item.label=title;item.toolTip=title;return item
    }
    func updateToolbar(name:String,loggedIn:Bool){
        let name=String(name.prefix(128));guard toolbarName != name || toolbarLoggedIn != loggedIn || mainToolbar==nil else{return}
        toolbarName=name;toolbarLoggedIn=loggedIn;if mainToolbar==nil{installToolbar()}
        guard let toolbar=mainToolbar else{return};while !toolbar.items.isEmpty{toolbar.removeItem(at:0)}
        for (index,key) in toolbarIdentifiers().enumerated(){toolbar.insertItem(withItemIdentifier:key,at:index)}
    }
    @objc func toolbarClicked(_ sender:NSButton){guard let action=sender.identifier?.rawValue,["home","agent","theme","privacy","logout"].contains(action) else{return};event("toolbarAction",action)}
    func setupMenu() {
        let menu=NSMenu(); let appItem=NSMenuItem(); menu.addItem(appItem); let am=NSMenu(); appItem.submenu=am
        am.addItem(withTitle:"关于智云助手",action:#selector(about),keyEquivalent:""); am.addItem(.separator()); am.addItem(withTitle:"退出智云助手",action:#selector(NSApplication.terminate(_:)),keyEquivalent:"q")
        let editItem=NSMenuItem(); menu.addItem(editItem); let edit=NSMenu(title:"编辑"); editItem.submenu=edit
        for (title,selector,key) in [("撤销","undo:","z"),("重做","redo:","Z"),("剪切","cut:","x"),("复制","copyContent:","c"),("粘贴","paste:","v"),("全选","selectAll:","a")] { let item=edit.addItem(withTitle:title,action:Selector(selector),keyEquivalent:key);if selector=="copyContent:"{item.target=self} }
        let viewItem=NSMenuItem(); menu.addItem(viewItem); let view=NSMenu(title:"窗口"); viewItem.submenu=view; view.addItem(withTitle:"全屏",action:#selector(NSWindow.toggleFullScreen(_:)),keyEquivalent:"f").keyEquivalentModifierMask=[.command,.control]; NSApp.mainMenu=menu
    }
    func isMainWebResponder(_ owner:NSWindow?,_ responder:NSResponder?)->Bool{
        guard owner === window,let view=responder as? NSView,let web=web else{return false};return view === web || view.isDescendant(of:web)
    }
    @objc func copyContent(_ sender:Any?){
        guard let owner=NSApp.keyWindow,let responder=owner.firstResponder else{return}
        let fallback={if NSApp.keyWindow === owner,owner.firstResponder === responder{_=responder.tryToPerform(#selector(NSText.copy(_:)),with:sender)}}
        guard isMainWebResponder(owner,responder) else{fallback();return}
        web.callAsyncJavaScript("return typeof window.zhiyunCopyImage === 'function' ? !!(await window.zhiyunCopyImage()) : false;",arguments:[:],in:nil,in:.page){result in
            if case .success(let value)=result,value as? Bool==true{return};fallback()
        }
    }
    func validateMenuItem(_ menuItem:NSMenuItem)->Bool{
        guard menuItem.action==#selector(copyContent(_:)) else{return true}
        guard let owner=NSApp.keyWindow,let responder=owner.firstResponder else{return false}
        return isMainWebResponder(owner,responder) || responder.responds(to:#selector(NSText.copy(_:)))
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
    func applicationDidBecomeActive(_ notification: Notification) { if web != nil { event("foreground",[:]) } }
    func applicationDidResignActive(_ notification: Notification) { if web != nil { event("background",[:]) } }
    func applicationWillTerminate(_ notification: Notification) { if let monitor=mouseDragMonitor{NSEvent.removeMonitor(monitor)};sessionWeb?.stopLoading();sessionDeadline?.cancel(); downloads.values.forEach { $0.cancel() }; requests.values.forEach{$0.cancel()}; streams.values.forEach { $0.session.invalidateAndCancel() };ocrOperations.values.forEach{$0.invalidateAndCancel()};remoteTransfers.values.forEach{$0.cancel()}; listener?.cancel() }
    func windowWillClose(_ notification: Notification) { if notification.object as? NSWindow === login { credentialUIAllowed=false;persistCookies();login=nil;loginWeb=nil } }
    func webView(_ view: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy)->Void) {
        guard let u=navigationAction.request.url else { decisionHandler(.cancel); return }
        if view === web { decisionHandler(u.absoluteString.hasPrefix(origin + "/" + token + "/") || u.scheme == "about" ? .allow : .cancel) }
        else {
            if view === loginWeb,let host=u.host,trusted(u){
                if host != "classroom.zju.edu.cn"{loginVisitedAuthentication=true}
                else if loginVisitedAuthentication && !u.path.lowercased().contains("login"){login?.orderOut(nil)}
            }
            decisionHandler(trusted(u) || u.scheme == "about" ? .allow : .cancel)
        }
    }
    func webView(_ view: WKWebView, didFinish navigation: WKNavigation!) {
        if view === sessionWeb {
            let generation=sessionGeneration
            diagnostic("Session navigation "+(view.url?.host ?? "unknown")+" "+(view.url?.path ?? ""))
            guard let url=view.url else{finishSession(false,generation:generation);return}
            if url.host=="classroom.zju.edu.cn",!url.path.lowercased().contains("login") {
                verifyResumedSession(view,generation:generation)
            }else{
                view.evaluateJavaScript("!!document.querySelector('input[type=password]')"){value,_ in if value as? Bool == true,self.sessionWeb === view,self.sessionGeneration==generation{self.finishSession(false,generation:generation)}}
            }
            return
        }
        if view === loginWeb && !loggingOut {
            persistCookies()
            if view.url?.host == "classroom.zju.edu.cn",!((view.url?.path ?? "").lowercased().contains("login")) {
                completeOfficialLoginIfReady(view)
            }
        }
    }
    func verifyResumedSession(_ view:WKWebView,generation:UUID){
        guard sessionWeb === view,sessionGeneration==generation,!sessionProbeActive else{return};sessionProbeActive=true
        let paths=["/userapi/v1/infosimple"]
        func probe(_ index:Int){
            guard self.sessionWeb === view,self.sessionGeneration==generation,!self.loggingOut else{return}
            if index==paths.count{self.store.httpCookieStore.getAllCookies{cookies in self.finishSession(campusBearer(cookies) != nil,generation:generation)};return}
            let url=URL(string:"https://classroom.zju.edu.cn"+paths[index])!
            self.cookieRequest(url){request in
                self.network.dataTask(with:request){data,response,error in DispatchQueue.main.async {
                    guard self.sessionWeb === view,self.sessionGeneration==generation else{return}
                    guard error==nil,let response=response as? HTTPURLResponse,let data=data,(200..<300).contains(response.statusCode),!authenticationExpired(response,data),let json=try? JSONSerialization.jsonObject(with:data) as? [String:Any] else{self.diagnostic("Session service verification failed "+paths[index]);self.finishSession(false,generation:generation);return}
                    let params=json["params"] as? [String:Any],code=json["code"] as? Int
                    guard index != 0 || params?["id"] != nil else{self.finishSession(false,generation:generation);return}
                    guard code==nil || code==0 || code==200 else{self.finishSession(false,generation:generation);return}
                    self.absorbCookies(response){probe(index+1)}
                }}.resume()
            }
        }
        probe(0)
    }
    func completeOfficialLoginIfReady(_ view:WKWebView,attempt:Int=0){
        guard view === loginWeb,!loggingOut,!loginCompletionPending,view.url?.host=="classroom.zju.edu.cn",!(view.url?.path.lowercased().contains("login") ?? true) else{return}
        if loginVisitedAuthentication{login?.orderOut(nil)}
        store.httpCookieStore.getAllCookies{cookies in
            guard view === self.loginWeb,!self.loggingOut,!self.loginCompletionPending else{return}
            if campusBearer(cookies) != nil{
                self.loginCompletionPending=true;self.login?.orderOut(nil);self.event("login",["ready":true])
            }else if attempt<15{
                DispatchQueue.main.asyncAfter(deadline:.now()+0.2){self.completeOfficialLoginIfReady(view,attempt:attempt+1)}
            }else if self.loginVisitedAuthentication{
                self.event("login",["ready":true])
            }
        }
    }
    func webView(_ view:WKWebView,didFail navigation:WKNavigation!,withError error:Error){if view === sessionWeb{diagnostic("Session navigation failed code "+String((error as NSError).code));finishSession(false,generation:sessionGeneration)}}
    func webView(_ view:WKWebView,didFailProvisionalNavigation navigation:WKNavigation!,withError error:Error){if view === sessionWeb{diagnostic("Session provisional navigation failed code "+String((error as NSError).code));finishSession(false,generation:sessionGeneration)}}
    func webViewWebContentProcessDidTerminate(_ view:WKWebView){
        if view === web {
            guard Date().timeIntervalSince(lastWebRecovery)>15 else{event("webRecovery",["ready":false]);return}
            lastWebRecovery=Date();diagnostic("Web content process restarted");view.reload()
        }else if view === loginWeb {view.reload()}else if view === sessionWeb{finishSession(false,generation:sessionGeneration)}
    }
    func webView(_ view:WKWebView,createWebViewWith configuration:WKWebViewConfiguration,for action:WKNavigationAction,windowFeatures:WKWindowFeatures)->WKWebView?{
        // Official authentication occasionally uses target=_blank; keep it inside its
        // existing login window and do not create or activate another application.
        if (view === loginWeb || view === sessionWeb),action.targetFrame == nil,let url=action.request.url,trusted(url){view.load(action.request)}
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
    func absorbCookies(_ response:HTTPURLResponse,done:@escaping()->Void = {}){
        DispatchQueue.main.async{
            guard !self.loggingOut,let url=response.url,trusted(url) else{done();return}
            var headers=[String:String]();for (key,value) in response.allHeaderFields{if let name=key as? String{headers[name]=String(describing:value)}}
            let cookies=HTTPCookie.cookies(withResponseHeaderFields:headers,for:url).filter{trustedCookieDomain($0.domain) && cookieDomainMatches($0,url.host ?? "")}
            guard !cookies.isEmpty else{done();return};self.installCookies(cookies){self.persistCookies();done()}
        }
    }
    func installCookies(_ cookies:[HTTPCookie],done:@escaping()->Void){
        guard !loggingOut else{done();return};let group=DispatchGroup()
        for cookie in cookies{group.enter();if let expires=cookie.expiresDate,expires<=Date(){store.httpCookieStore.delete(cookie){group.leave()}}else{store.httpCookieStore.setCookie(cookie){group.leave()}}}
        group.notify(queue:.main,execute:done)
    }
    func sessionKeychain(_ name:String,_ data:Data?=nil,remove:Bool=false,allowUI:Bool=false,onError:((OSStatus)->Void)?=nil)->Data?{
        dispatchPrecondition(condition:.onQueue(storageQueue))
        return credentialCache.access(name,data,remove:remove,allowUI:allowUI,onError:onError)
    }
    func hasLogoutMarker()->Bool{fm.fileExists(atPath:logoutMarker(in:root).path)}
    func profileIdentityURL()->URL{root.appendingPathComponent("identity-profile.json")}
    func normalizedIdentity(_ text:String)throws->Data{
        guard text.utf8.count<=64*1024,let data=text.data(using:.utf8),let row=try? JSONSerialization.jsonObject(with:data) as? [String:Any],let id=row["id"] as? String,!id.isEmpty,id.utf8.count<=256 else{throw appError("账号资料格式无效")}
        // Profile metadata contains no password, Cookie, bearer or API key.
        let clean:[String:Any]=["id":id,"name":String((row["name"] as? String ?? "同学").prefix(256)),"tenantId":row["tenantId"] as? Int ?? 112,"username":String((row["username"] as? String ?? "").prefix(256))]
        return try JSONSerialization.data(withJSONObject:clean,options:.sortedKeys)
    }
    func storedIdentity()->String{
        guard !hasLogoutMarker() else{return ""}
        if let data=try? Data(contentsOf:profileIdentityURL()),let text=String(data:data,encoding:.utf8),let valid=try? normalizedIdentity(text){return String(data:valid,encoding:.utf8) ?? ""}
        // One silent, read-only migration. A signing change never triggers a password sheet.
        guard let data=sessionKeychain("identity"),let text=String(data:data,encoding:.utf8),let valid=try? normalizedIdentity(text) else{return ""}
        try? saveIdentity(text);return String(data:valid,encoding:.utf8) ?? ""
    }
    func saveIdentity(_ text:String,allowUI:Bool=false)throws{
        let data=try normalizedIdentity(text)
        try fm.createDirectory(at:root,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
        try data.write(to:profileIdentityURL(),options:.atomic);try fm.setAttributes([.posixPermissions:0o600],ofItemAtPath:profileIdentityURL().path)
        try removeLogoutMarker(in:root)
    }
    func clearPreparedImages(){imagePreparationGeneration=UUID();preparedDrags.removeAll();preparedDragOrder.removeAll();lastMouseDrag=nil;event("imageDragCacheCleared",true)}
    func performLogout(_ id:String){
        loggingOut=true;accountGeneration=UUID();credentialUIAllowed=false;cancelledAI.formUnion(pendingAI);finishSession(false,generation:sessionGeneration);sessionNeedsResume=false;clearPreparedImages();updateToolbar(name:"",loggedIn:false)
        for operation in pendingRequests{cancelledRequests.insert(operation)};for operation in pendingDownloads.keys{cancelledDownloads.insert(operation)}
        requests.values.forEach{$0.cancel()};requests.removeAll();downloads.values.forEach{$0.cancel()};streams.values.forEach{$0.session.invalidateAndCancel()};ocrOperations.values.forEach{$0.invalidateAndCancel()};login?.close()
        store.httpCookieStore.getAllCookies{cookies in
            let group=DispatchGroup();for cookie in cookies{group.enter();self.store.httpCookieStore.delete(cookie){group.leave()}}
            group.notify(queue:.main){self.storageQueue.async{
                let error={(status:OSStatus) in self.diagnostic("Session keychain removal failed: "+String(status))}
                _=self.sessionKeychain(persistedSessionCredential,remove:true,onError:error);_=self.sessionKeychain("cookies",remove:true,onError:error);_=self.sessionKeychain("identity",remove:true,onError:error);self.credentialCache.invalidate();self.latestCookieSnapshot=nil;self.sessionVault.remove();try? self.fm.removeItem(at:self.profileIdentityURL())
                DispatchQueue.main.async{self.account="guest";self.reply(id,true)}
            }}
        }
    }
    func restoreCookies(_ done:@escaping()->Void){
        if cookieRestoreComplete{done();return};cookieRestoreCallbacks.append(done);guard !cookieRestoreStarted else{return};cookieRestoreStarted=true
        let finish={self.cookieRestoreComplete=true;let callbacks=self.cookieRestoreCallbacks;self.cookieRestoreCallbacks.removeAll();callbacks.forEach{$0()}}
        store.httpCookieStore.getAllCookies{existing in
            if self.hasLogoutMarker(){let group=DispatchGroup();for cookie in existing{group.enter();self.store.httpCookieStore.delete(cookie){group.leave()}};group.notify(queue:.main){self.sessionNeedsResume=false;finish()};return}
            self.storageQueue.async{
                let current=self.sessionVault.read() ?? self.sessionKeychain(persistedSessionCredential)
                let data=current ?? (self.sessionKeychain("cookies") ?? Data())
                // Existing WebKit cookies win, but restore missing session-only SSO
                // cookies even when a classroom token already exists.
                let saved=decodedCookies(data).filter{candidate in !existing.contains{$0.name==candidate.name && $0.domain==candidate.domain && $0.path==candidate.path}}
                DispatchQueue.main.async{self.installCookies(saved){self.sessionNeedsResume=bearerNeedsRenewal(campusBearer(existing+saved));self.persistCookies{finish()}}}
            }
        }
    }
    func restoreCookies(from data:Data,done:@escaping()->Void){
        let cookies=hasLogoutMarker() ? []:decodedCookies(data);sessionNeedsResume = bearerNeedsRenewal(campusBearer(cookies));installCookies(cookies){self.cookieRestoreComplete=true;done()}
    }
    func persistCookies(_ done:(()->Void)?=nil){
        #if NATIVE_CONTRACT_TESTS
        if testSkipCookiePersistence{done?();return}
        #endif
        guard !loggingOut,!hasLogoutMarker() else{done?();return}
        // WebKit may discard session-only cookies at process exit. Preserve their
        // original attributes in a protected credential, never in a plaintext file.
        let generation=accountGeneration
        store.httpCookieStore.getAllCookies{cookies in
            guard !self.loggingOut,generation==self.accountGeneration,let data=try? encodedCookies(cookies),!cookies.isEmpty else{done?();return}
            self.storageQueue.async{
                guard !self.loggingOut,generation==self.accountGeneration,!self.hasLogoutMarker() else{DispatchQueue.main.async{done?()};return}
                if self.latestCookieSnapshot != data{do{try self.sessionVault.save(data);self.latestCookieSnapshot=data}catch{self.diagnostic("Session snapshot save failed")}}
                DispatchQueue.main.async{done?()}
            }
        }
    }
    func cookieRequest(_ url:URL,body:String="",range:String?=nil,done:@escaping(URLRequest)->Void){
        store.httpCookieStore.getAllCookies{cookies in
            var request=URLRequest(url:url);request.setValue("https://classroom.zju.edu.cn/",forHTTPHeaderField:"Referer");request.setValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15",forHTTPHeaderField:"User-Agent")
            let api=["classroom.zju.edu.cn","interactivemeta.cmc.zju.edu.cn"].contains(url.host ?? "")
            if api{request.setValue("application/json",forHTTPHeaderField:"Accept");if let bearer=campusBearer(cookies){request.setValue("Bearer "+bearer,forHTTPHeaderField:"Authorization")}}
            let allowed=cookies.filter{cookieApplies($0,to:url)}.sorted{$0.path.count>$1.path.count}
            if !allowed.isEmpty{request.setValue(allowed.map{$0.name+"="+$0.value}.joined(separator:"; "),forHTTPHeaderField:"Cookie")}
            if !body.isEmpty{request.httpMethod="POST";request.httpBody=Data(body.utf8);request.setValue("application/json",forHTTPHeaderField:"Content-Type")};if let range=range{request.setValue(range,forHTTPHeaderField:"Range")};done(request)
        }
    }
    // Reuse the university's existing SSO session in an unattached WebKit view.
    // A login form is never filled here; denial and unavailable networks keep the
    // local identity/offline files intact. All callers share one bounded handshake.
    func resumeOfficialSession(force:Bool=false,done:@escaping(Bool)->Void){
        guard !loggingOut,(!hasLogoutMarker() || login != nil) else{done(false);return}
        guard cookieRestoreComplete else{restoreCookies{self.resumeOfficialSession(force:force,done:done)};return}
        if !sessionCallbacks.isEmpty{sessionCallbacks.append(done);return}
        if !force && !sessionNeedsResume{done(true);return}
        if Date().timeIntervalSince(sessionLastAttempt)<15{done(false);return}
        sessionCallbacks.append(done);sessionNeedsResume=false;sessionProbeActive=false;sessionLastAttempt=Date();let generation=UUID();sessionGeneration=generation
        let timeout=DispatchWorkItem{self.finishSession(false,generation:generation)};sessionDeadline=timeout;DispatchQueue.main.asyncAfter(deadline:.now()+10,execute:timeout)
        #if NATIVE_CONTRACT_TESTS
        if let bootstrap=testSessionBootstrap{bootstrap{ready in self.finishSession(ready,generation:generation)};return}
        #endif
        let config=WKWebViewConfiguration();config.websiteDataStore=store;config.preferences.javaScriptCanOpenWindowsAutomatically=false
        let view=WKWebView(frame:NSRect(x:0,y:0,width:800,height:600),configuration:config);view.navigationDelegate=self;view.uiDelegate=self;sessionWeb=view
        view.load(URLRequest(url:officialSessionURL,cachePolicy:.reloadIgnoringLocalCacheData,timeoutInterval:8))
    }
    private func finishSession(_ ready:Bool,generation:UUID){
        guard sessionGeneration==generation,!sessionCallbacks.isEmpty else{return};sessionDeadline?.cancel();sessionDeadline=nil;sessionWeb?.stopLoading();sessionWeb?.navigationDelegate=nil;sessionWeb?.uiDelegate=nil;sessionWeb=nil
        let callbacks=sessionCallbacks;sessionCallbacks.removeAll();sessionNeedsResume = !ready
        if ready{persistCookies()};callbacks.forEach{$0(ready && !loggingOut)}
    }
    func requiresSessionRecovery(_ done:@escaping(Bool)->Void){
        storageQueue.async{let protected=self.sessionVault.read()==nil && self.credentialCache.requiresAuthorization([persistedSessionCredential,"cookies"])
            DispatchQueue.main.async{
                guard protected else{done(false);return}
                // Persistent storage permission is not online course permission. A
                // newly authenticated official WebKit session must remain usable.
                self.store.httpCookieStore.getAllCookies{done(campusBearer($0)==nil)}
            }
        }
    }
    func performCourseRequest(_ id:String,url:URL,body:String,retried:Bool=false){
        pendingRequests.insert(id);cookieRequest(url,body:body){request in
            self.pendingRequests.remove(id);guard !self.loggingOut,self.cancelledRequests.remove(id)==nil else{self.reply(id,nil,"请求已取消");return}
            let task=self.network.dataTask(with:request){data,response,error in DispatchQueue.main.async{
                self.requests.removeValue(forKey:id);if self.cancelledRequests.remove(id) != nil || self.loggingOut{self.reply(id,nil,"请求已取消");return}
                if let error=error{self.diagnostic("API error: "+error.localizedDescription);self.reply(id,nil,userError(error));return}
                guard let data=data,data.count<16*1024*1024,let response=response as? HTTPURLResponse else{self.reply(id,nil,"课程响应异常");return}
                self.pendingRequests.insert(id)
                self.absorbCookies(response){
                    self.pendingRequests.remove(id);guard self.cancelledRequests.remove(id)==nil,!self.loggingOut else{self.reply(id,nil,"请求已取消");return}
                    let bearer=request.value(forHTTPHeaderField:"Authorization").map{String($0.dropFirst(7))}
                    let expired=authenticationExpired(response,data) || (response.statusCode==403 && bearerNeedsRenewal(bearer))
                    if expired && replayableCourseRead(url,body:body) && !retried {
                        self.pendingRequests.insert(id)
                        self.cookieRequest(url){current in
                            let retry: (Bool)->Void = {ready in
                                self.pendingRequests.remove(id);guard self.cancelledRequests.remove(id)==nil,!self.loggingOut else{self.reply(id,nil,"请求已取消");return}
                                if ready{self.performCourseRequest(id,url:url,body:body,retried:true)}else{self.reply(id,["status":401,"text":"{\"code\":401,\"message\":\"在线会话需要重新登录；离线课程仍可查看\"}"])}
                            }
                            // A slower parallel request can return 401 after another
                            // request has already refreshed the token. Reuse that token
                            // rather than treating the handshake cooldown as logout.
                            if let fresh=current.value(forHTTPHeaderField:"Authorization"),fresh != request.value(forHTTPHeaderField:"Authorization"){retry(true)}
                            else{self.resumeOfficialSession(force:true,done:retry)}
                        };return
                    }
                    if url.path.contains("get-week-schedules"),let envelope=try? JSONSerialization.jsonObject(with:data) as? [String:Any]{let result=envelope["result"];let kind=result is [Any] ? "array":result is [String:Any] ? "object":"empty";let keys=(result as? [String:Any])?.keys.sorted().joined(separator:",") ?? "";self.diagnostic("Schedule schema code " + String(describing:envelope["code"] ?? "none") + " result " + kind + " keys " + keys)}
                    self.diagnostic("API "+url.path+" status "+String(response.statusCode));self.reply(id,["status":expired ? 401:response.statusCode,"text":String(data:data,encoding:.utf8) ?? ""])
                }
            }};self.requests[id]=task;task.resume()
        }
    }
    func urlSession(_ session:URLSession,task:URLSessionTask,willPerformHTTPRedirection response:HTTPURLResponse,newRequest request:URLRequest,completionHandler:@escaping(URLRequest?)->Void){
        guard let url=request.url,trusted(url) else{completionHandler(nil);return}
        absorbCookies(response){self.cookieRequest(url,range:request.value(forHTTPHeaderField:"Range")){base in var next=base;next.httpMethod=request.httpMethod;next.httpBody=request.httpBody;if let value=request.value(forHTTPHeaderField:"Content-Type"){next.setValue(value,forHTTPHeaderField:"Content-Type")};completionHandler(next)}}
    }
    func scoped(_ category:String)->URL { root.appendingPathComponent(account).appendingPathComponent(category) }
    func cacheCategory(_ key:String)->String {if key.hasPrefix("vision-"){return "vision"};if key.hasPrefix("summary-"){return "summary"};if key.hasPrefix("chats-"){return "question"};if key.hasPrefix("skip-"){return "skip"};if key.hasPrefix("lesson-") || key.hasPrefix("search-transcript-"){return "timeline"};return "schedule"}
    func cacheSettings()->[String:Bool] {guard let data=try? Data(contentsOf:scoped("data").appendingPathComponent("cache-settings.json")),let value=try? JSONSerialization.jsonObject(with:data) as? [String:Bool] else{return [:]};return value}
    func safeKey(_ key:String)->Bool { !key.isEmpty && key.count<200 && key.range(of:"^[A-Za-z0-9_.-]+$",options:.regularExpression) != nil && !key.contains("..") }
    func diagnostic(_ text:String){let path=root.appendingPathComponent("diagnostics.log");var lines=((try? String(contentsOf:path,encoding:.utf8)) ?? "").components(separatedBy:"\n").suffix(30).map{String($0)};lines.append(text);try? lines.joined(separator:"\n").write(to:path,atomically:true,encoding:.utf8)}
    func reply(_ id:String, _ value:Any?=nil, _ error:String?=nil) { let payload:[String:Any]=["id":id,"value":value ?? NSNull(),"error":error ?? NSNull()]; js("window.native.receive",payload) }
    func event(_ name:String,_ value:Any) { js("window.native.event",["name":name,"value":value]) }
    func js(_ function:String,_ value:Any) { guard let data=try? JSONSerialization.data(withJSONObject:value),let json=String(data:data,encoding:.utf8) else { return }; DispatchQueue.main.async { self.web?.evaluateJavaScript(function+"("+json+")",completionHandler:nil) } }
    func userContentController(_ userContentController:WKUserContentController,didReceive message:WKScriptMessage) {
        guard message.webView === web,message.frameInfo.isMainFrame, message.frameInfo.request.url?.absoluteString.hasPrefix(origin+"/"+token+"/") == true, let args=message.body as? [String:Any], let id=args["id"] as? String, let action=args["action"] as? String else { return }
        let p=args["params"] as? [String:Any] ?? [:]
        switch action {
        case "prepareImageDrag":
            guard let value=p["image"] as? String,value.utf8.count<=45*1024*1024 else{reply(id,nil,"拖动图片无效或过大");return}
            let name=p["name"] as? String ?? "课件.png",owner=account,generation=imagePreparationGeneration
            DispatchQueue.global(qos:.utility).async{do{
                let image=try preparedImageDrag(value,name:name),key=digest(value)
                DispatchQueue.main.async{
                    guard self.account==owner,self.imagePreparationGeneration==generation,!self.loggingOut else{self.reply(id,nil,"图片准备已取消");return}
                    self.preparedDrags[key]=image;self.preparedDragOrder.removeAll{$0==key};self.preparedDragOrder.append(key)
                    func bytes()->Int{self.preparedDrags.values.reduce(0){$0+$1.png.count+Int($1.image.size.width*$1.image.size.height)*4}}
                    while self.preparedDragOrder.count>1 && (self.preparedDragOrder.count>8 || bytes()>64*1024*1024){self.preparedDrags.removeValue(forKey:self.preparedDragOrder.removeFirst())}
                    self.reply(id,["token":key])
                }
            }catch{self.reply(id,nil,userError(error))}}
        case "dragImage": do{try dragImage(p);reply(id,true)}catch{reply(id,nil,userError(error))}
        case "toolbar": updateToolbar(name:p["name"] as? String ?? "",loggedIn:p["loggedIn"] as? Bool == true);reply(id,true)
        case "windowChrome": applyWindowChrome(p["color"] as? String ?? "",mode:p["mode"] as? String ?? "system") ? reply(id,true):reply(id,nil,"颜色无效")
        case "resumeSession": resumeOfficialSession{ready in self.reply(id,["ready":ready])}
        case "request":
            guard let url=URL(string:p["url"] as? String ?? ""),trusted(url),["classroom.zju.edu.cn","interactivemeta.cmc.zju.edu.cn"].contains(url.host ?? "") else{reply(id,nil,"不受支持的课程地址");return}
            pendingRequests.insert(id);restoreCookies{
                self.requiresSessionRecovery{blocked in
                    guard self.cancelledRequests.remove(id)==nil,!self.loggingOut else{self.pendingRequests.remove(id);self.reply(id,nil,"请求已取消");return}
                    if blocked{self.pendingRequests.remove(id);self.reply(id,["status":401,"text":"{\"code\":401,\"message\":\"请恢复保存的登录；本机学习资料仍可使用\"}"]);return}
                    self.resumeOfficialSession{_ in
                        self.pendingRequests.remove(id);guard self.cancelledRequests.remove(id)==nil,!self.loggingOut else{self.reply(id,nil,"请求已取消");return}
                        self.performCourseRequest(id,url:url,body:p["body"] as? String ?? "")
                    }
                }
            }
        case "cancelRequest":
            if let target=p["id"] as? String,pendingRequests.contains(target) || requests[target] != nil{cancelledRequests.insert(target);requests[target]?.cancel()};reply(id,true)
        case "appearanceTheme": reply(id,selectedTheme)
        case "appearanceMode": reply(id,selectedMode)
        case "setAppearanceMode":
            guard let mode=p["mode"] as? String,appearanceModes.contains(mode) else{reply(id,nil,"外观无效");return};applyAppearanceMode(mode);reply(id,mode)
        case "setAppearanceTheme":
            guard let theme=p["theme"] as? String,themeIdentifiers.contains(theme) else{reply(id,nil,"主题无效");return};applyTheme(theme);reply(id,theme)
        case "login":
            loggingOut=false;credentialUIAllowed=false;loginCompletionPending=false;loginVisitedAuthentication=false
            if let login=login { login.makeKeyAndOrderFront(nil); reply(id,true); return }
            let config=WKWebViewConfiguration(); config.websiteDataStore=store
            let view=WKWebView(frame:.zero,configuration:config); view.navigationDelegate=self;view.uiDelegate=self; loginWeb=view
            let w=NSWindow(contentRect:NSRect(x:0,y:0,width:980,height:730),styleMask:[.titled,.closable,.resizable],backing:.buffered,defer:false); w.isReleasedWhenClosed=false; w.title="登录智云课堂 · 浙江大学官方认证"; w.contentView=view; w.delegate=self; w.center(); w.makeKeyAndOrderFront(nil); login=w
            view.load(URLRequest(url:URL(string:"https://classroom.zju.edu.cn/")!)); reply(id,true)
        case "loginDone": login?.orderOut(nil);sessionNeedsResume=false;sessionLastAttempt = .distantPast;persistCookies{self.credentialUIAllowed=false;self.login?.close();self.reply(id,true)}
        case "logout":
            // Persist the explicit intent first. Even a refused Keychain deletion must
            // not resurrect the prior account or cookies on the next launch.
            storageQueue.async{do{try writeLogoutMarker(in:self.root);DispatchQueue.main.async{self.performLogout(id)}}catch{self.reply(id,nil,"无法保存退出状态，请重试")}}
        case "identity":
            let allowUI=credentialUIAllowed
            storageQueue.async{if let text=p["text"] as? String{do{try self.saveIdentity(text,allowUI:allowUI);self.reply(id,true)}catch{self.reply(id,nil,userError(error))}}else{self.reply(id,self.storedIdentity())}}
        case "account": let next=digest(p["id"] as? String ?? "guest");if next != account{accountGeneration=UUID();clearPreparedImages()};account=next;reply(id,true)
        case "read":
            guard let key=p["key"] as? String,safeKey(key) else{reply(id,nil,"文件名无效");return}
            let cached=p["cache"] as? Bool == true,enabled=cacheSettings()[cacheCategory(key)] != false,path=scoped(cached ? "cache":"data").appendingPathComponent(key)
            if cached && !enabled{reply(id,"");return}
            storageQueue.async{guard let size=(try? path.resourceValues(forKeys:[.fileSizeKey]))?.fileSize,size<=32*1024*1024 else{self.reply(id,"");return};self.reply(id,(try? String(contentsOf:path,encoding:.utf8)) ?? "")}
        case "write":
            guard let key=p["key"] as? String,safeKey(key),let text=p["text"] as? String,text.utf8.count<32*1024*1024 else{reply(id,nil,"文件内容无效");return}
            let cached=p["cache"] as? Bool == true,enabled=cacheSettings()[cacheCategory(key)] != false,path=scoped(cached ? "cache":"data").appendingPathComponent(key)
            if cached && !enabled{reply(id,true);return}
            storageQueue.async{do{try self.fm.createDirectory(at:path.deletingLastPathComponent(),withIntermediateDirectories:true);try text.write(to:path,atomically:true,encoding:.utf8);self.reply(id,true)}catch{self.reply(id,nil,userError(error))}}
        case "keychainStatus":
            let name=account+"-deepseek";storageQueue.async{
                let api=self.credentialCache.requiresAuthorization([name])
                DispatchQueue.main.async{self.requiresSessionRecovery{session in self.reply(id,["authorizationRequired":session || api,"sessionAuthorizationRequired":session,"apiAuthorizationRequired":api])}}
            }
        case "authorizeCredentials": authorizeCredentials(id,purpose:p["purpose"] as? String ?? ((p["scope"] as? String)=="secret" ? "api":"session"))
        case "aiStatus":
            let owner=account,generation=accountGeneration
            storageQueue.async{
                let personal=self.sessionKeychain(owner+"-deepseek")?.isEmpty==false,campus=self.sessionKeychain(campusGatewayCredential)?.isEmpty==false,required=self.credentialCache.requiresAuthorization([campusGatewayCredential]),ocr=self.sessionKeychain(campusOCRCredential)?.isEmpty==false
                DispatchQueue.main.async{guard owner==self.account,generation==self.accountGeneration else{self.reply(id,nil,"账号已切换");return};self.reply(id,["personalReady":personal,"campusReady":campus,"campusOCRReady":ocr,"campusAuthorizationRequired":required])}
            }
        case "recognizeSlide":
            guard let data=p["image"] as? String else{reply(id,nil,"缺少课件图片");return}
            DispatchQueue.global(qos:.userInitiated).async{
                do{
                    let image=try decodedNoteImage(data),request=VNRecognizeTextRequest()
                    request.recognitionLevel = .accurate;request.usesLanguageCorrection=true;request.recognitionLanguages=["zh-Hans","en-US"]
                    try VNImageRequestHandler(data:image.data,options:[:]).perform([request])
                    let rows=(request.results ?? []).sorted{a,b in abs(a.boundingBox.midY-b.boundingBox.midY)>0.015 ? a.boundingBox.midY>b.boundingBox.midY:a.boundingBox.minX<b.boundingBox.minX}
                    let text=rows.compactMap{$0.topCandidates(1).first?.string}.joined(separator:"\n")
                    self.reply(id,["text":String(text.prefix(30000)),"method":"local-ocr","limitations":"校内模型不支持直接看图；以下为本机识别的文字，不包含可靠的图形关系分析。"])
                }catch{self.reply(id,nil,"课件文字识别失败，请重试或切换支持图片的个人API")}
            }
        case "campusOCR": startCampusOCR(id,p)
        case "campusGateway", "campusOCRKey":
            guard let key=p["key"] as? String,key.count>=16,key.count<=256,key.range(of:"^[A-Za-z0-9_-]+$",options:.regularExpression) != nil else{reply(id,nil,"校园网关密钥格式无效");return}
            let credential=action=="campusOCRKey" ? campusOCRCredential:campusGatewayCredential
            storageQueue.async{guard self.sessionKeychain(credential,Data(key.utf8),allowUI:true) != nil else{self.reply(id,nil,"无法保存校园服务密钥");return};self.reply(id,["ready":true])}
        case "secret":
            let name=account+"-deepseek",owner=account,generation=accountGeneration
            storageQueue.async{
                if p["remove"] as? Bool == true{var failure:OSStatus?;_=self.sessionKeychain(name,remove:true,allowUI:true,onError:{failure=$0});if failure != nil{self.reply(id,nil,"无法移除密钥，请稍后重试")}else{self.reply(id,true)}}
                else if let text=p["text"] as? String{guard self.sessionKeychain(name,Data(text.utf8),allowUI:true) != nil else{self.reply(id,nil,"无法保存密钥，请稍后重试");return};self.reply(id,true)}
                else{let text=String(data:self.sessionKeychain(name) ?? Data(),encoding:.utf8) ?? "";DispatchQueue.main.async{guard owner==self.account,generation==self.accountGeneration,!self.loggingOut else{self.reply(id,nil,"请求已取消");return};self.reply(id,text)}}
            }
        case "cache":
            let cache=scoped("cache"),images=scoped("images"),settingsFile=scoped("data").appendingPathComponent("cache-settings.json"),known=["schedule","timeline","vision","summary","question","skip","images"]
            var settings=cacheSettings()
            if let category=p["category"] as? String,let enabled=p["enabled"] as? Bool {
                guard known.contains(category) else{reply(id,nil,"缓存分类无效");return};settings[category]=enabled;let value=settings
                storageQueue.async{do{try self.fm.createDirectory(at:settingsFile.deletingLastPathComponent(),withIntermediateDirectories:true);try JSONSerialization.data(withJSONObject:value).write(to:settingsFile,options:.atomic);self.reply(id,true)}catch{self.reply(id,nil,userError(error))}};return
            }
            if p["clear"] as? Bool == true {
                let category=p["category"] as? String,keys=p["keys"] as? [String]
                if let category=category,!known.contains(category){reply(id,nil,"缓存分类无效");return}
                if category==nil || category=="images"{clearPreparedImages()}
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
                    }catch{self.reply(id,nil,userError(error))}
                }
            }else {
                let value=settings;storageQueue.async{var entries=[String:[[String:Any]]]();for category in known{entries[category]=[]}
                    for (category,folder) in [("cache",cache),("images",images)]{for path in (try? self.fm.contentsOfDirectory(at:folder,includingPropertiesForKeys:[.fileSizeKey])) ?? []{let key=path.lastPathComponent,name=category=="images" ? "images":self.cacheCategory(key),size=(try? path.resourceValues(forKeys:[.fileSizeKey]).fileSize) ?? 0;entries[name,default:[]].append(["key":key,"bytes":size])}}
                    self.reply(id,["entries":entries,"settings":value])
                }
            }
        case "resourceSize":
            guard let url=URL(string:p["url"] as? String ?? ""),trusted(url) else{reply(id,nil,"资源地址不支持");return}
            cookieRequest(url){request in var request=request;request.httpMethod="HEAD";self.network.dataTask(with:request){_,response,error in if let error=error{self.reply(id,nil,userError(error))}else if let response=response as? HTTPURLResponse,(200..<300).contains(response.statusCode){self.absorbCookies(response);self.reply(id,max(0,response.expectedContentLength))}else{self.reply(id,0)}}.resume()}
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
                        let job=Download(request,destination:path,event:{bytes,total in self.event("download",["id":id,"bytes":bytes,"total":total])},finish:{result in DispatchQueue.main.async{self.downloads.removeValue(forKey:id);self.cancelledDownloads.remove(id);switch result{case .success(let name):self.reply(id,["name":name,"size":(try? path.resourceValues(forKeys:[.fileSizeKey]).fileSize) ?? 0]);case .failure(let error):self.reply(id,nil,userError(error))}}});self.downloads[id]=job
                    }
                }
            }
        case "writeOffline":
            guard let key=p["lesson"] as? String,safeKey(key),let name=p["name"] as? String,safeKey(name),let text=p["text"] as? String,text.utf8.count<32*1024*1024 else{reply(id,nil,"下载参数无效");return}
            let path=scoped("offline").appendingPathComponent(key).appendingPathComponent(name);storageQueue.async{do{try self.fm.createDirectory(at:path.deletingLastPathComponent(),withIntermediateDirectories:true);try text.write(to:path,atomically:true,encoding:.utf8);self.reply(id,true)}catch{self.reply(id,nil,userError(error))}}
        case "deleteOffline":
            guard let key=p["lesson"] as? String,safeKey(key) else{reply(id,nil,"课程标识无效");return}
            let folder=scoped("offline").appendingPathComponent(key)
            for (operation,path) in pendingDownloads where path.deletingLastPathComponent()==folder{cancelledDownloads.insert(operation)}
            for (operation,job) in downloads where job.destination.deletingLastPathComponent()==folder{cancelledDownloads.insert(operation);job.cancel()}
            // Pending cookie/file checks belong to the bridge request as well. Front-end
            // pause/delete invalidates its generation; never allow active commits afterward.
            storageQueue.async{do{if self.fm.fileExists(atPath:folder.path){try self.fm.removeItem(at:folder)};self.reply(id,true)}catch{self.reply(id,nil,userError(error))}}
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
            storageQueue.async{do{self.reply(id,try storeNoteImage(value,in:folder))}catch{self.reply(id,nil,userError(error))}}
        case "export":
            guard let text=p["text"] as? String,text.utf8.count<=128*1024*1024,let name=p["name"] as? String,!name.isEmpty else{reply(id,nil,"导出内容无效");return}
            let panel=NSSavePanel();panel.nameFieldStringValue=(name as NSString).lastPathComponent;panel.beginSheetModal(for:window){result in guard result == .OK,let path=panel.url else{self.reply(id,false);return};self.storageQueue.async{do{try text.write(to:path,atomically:true,encoding:.utf8);self.reply(id,true)}catch{self.reply(id,nil,userError(error))}}}
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
                }catch{self.reply(id,nil,userError(error))}
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
                    }catch{self.reply(id,nil,userError(error))}
                }
            }
        case "localAIStatus":
            localGemma.discover{base,models in self.reply(id,["localReady":base != nil || LocalGemmaService.executable != nil,"localModels":models,"runningService":base != nil,"idleMinutes":5])}
        case "ai": startAI(id,p)
        case "cancelAI": if let key=p["id"] as? String { if pendingAI.contains(key){cancelledAI.insert(key)};streams[key]?.session.invalidateAndCancel();ocrOperations[key]?.invalidateAndCancel() };reply(id,true)
        default: reply(id,nil,"未知操作")
        }
    }
    func authorizeCredentials(_ id:String,purpose:String){
        guard ["session","api","campus","campusOCR"].contains(purpose) else{reply(id,nil,"恢复目标无效");return};let owner=account,generation=accountGeneration
        storageQueue.async{
            if purpose != "session"{
                let name=purpose=="campus" ? campusGatewayCredential:purpose=="campusOCR" ? campusOCRCredential:owner+"-deepseek",data=self.sessionKeychain(name,allowUI:true),required=self.credentialCache.requiresAuthorization([name])
                DispatchQueue.main.async{guard owner==self.account,generation==self.accountGeneration,!self.loggingOut else{self.reply(id,nil,"请求已取消");return};self.reply(id,["ready":data?.isEmpty==false,"authorizationRequired":required])};return
            }
            DispatchQueue.main.async{
                guard owner==self.account,generation==self.accountGeneration,!self.loggingOut else{self.reply(id,nil,"请求已取消");return}
                self.storageQueue.async{
                    let data=self.hasLogoutMarker() ? nil:(self.sessionVault.read() ?? self.sessionKeychain(persistedSessionCredential,allowUI:true))
                    DispatchQueue.main.async{
                        guard owner==self.account,generation==self.accountGeneration,!self.loggingOut else{self.reply(id,nil,"请求已取消");return}
                        let resume={self.resumeOfficialSession(force:true){ready in
                            guard owner==self.account,generation==self.accountGeneration,!self.loggingOut else{self.reply(id,nil,"请求已取消");return}
                            self.reply(id,["ready":ready,"authorizationRequired":false,"officialLoginRequired":!ready])
                        }}
                        if let data=data,!data.isEmpty{
                            self.restoreCookies(from:data){
                                resume()
                            }
                        }else{resume()}
                    }
                }
            }
        }
    }
    func startAI(_ id:String,_ params:[String:Any]){
        guard let messages=params["messages"] as? [[String:Any]],messages.count<(params["purpose"] as? String=="agent" ? 300:100) else{reply(id,nil,"问答内容无效");return}
        let provider=params["provider"] as? String ?? "auto"
        guard ["auto","personal","campus","local"].contains(provider) else{reply(id,nil,"AI来源无效");return}
        let owner=account,generation=accountGeneration;pendingAI.insert(id)
        if provider=="local" {
            event("aiStatus",["id":id,"message":"正在准备本地 Gemma…"])
            localGemma.prepare(model:params["localModel"] as? String){base,model,error in DispatchQueue.main.async {
                self.pendingAI.remove(id);guard !self.loggingOut,owner==self.account,generation==self.accountGeneration,self.cancelledAI.remove(id)==nil else{self.reply(id,nil,"请求已取消");return}
                guard let base=base,let model=model else{self.reply(id,nil,error ?? "本地模型不可用");return}
                do {
                    let request=try localGemmaRequest(base:base,model:model,messages:messages,tools:params["tools"] as? [[String:Any]])
                    #if NATIVE_CONTRACT_TESTS
                    if let probe=self.testAIRequest{probe(request);self.reply(id,["answer":"synthetic","calls":[]]);return}
                    #endif
                    let stream=AIStream(request,event:{text in self.event("ai",["id":id,"delta":text])},done:{value,error in DispatchQueue.main.async{self.streams.removeValue(forKey:id);self.reply(id,value,error.map{"本地 Gemma："+$0})}});self.streams[id]=stream
                }catch{self.reply(id,nil,userError(error))}
            }}
            return
        }
        storageQueue.async{
            let personal=provider=="campus" ? "":String(data:self.sessionKeychain(owner+"-deepseek") ?? Data(),encoding:.utf8) ?? ""
            let campus=provider=="campus" || provider=="auto" && personal.isEmpty
            let name=campus ? campusGatewayCredential:owner+"-deepseek",key=campus ? String(data:self.sessionKeychain(name) ?? Data(),encoding:.utf8) ?? "":personal,required=self.credentialCache.requiresAuthorization([name])
            DispatchQueue.main.async{
                self.pendingAI.remove(id);guard !self.loggingOut,owner==self.account,generation==self.accountGeneration,self.cancelledAI.remove(id)==nil else{self.reply(id,nil,"请求已取消");return}
                guard !key.isEmpty else{self.reply(id,nil,required ? "旧版本密钥无法静默读取，请在API设置中重新配置":campus ? "本机尚未预置校园网关密钥，可在API设置中接入个人API":"请先设置 DeepSeek API 密钥");return}
                var options=params;options["provider"]=campus ? "campus":"personal"
                self.startAIWithKey(id,params:options,messages:messages,key:key)
            }
        }
    }
    var ocrOperations=[String:URLSession]()
    func startCampusOCR(_ id:String,_ params:[String:Any]){
        guard let image=params["image"] as? String,let decoded=try? decodedNoteImage(image) else{reply(id,nil,"OCR图片无效");return}
        let owner=account,generation=accountGeneration;pendingAI.insert(id)
        storageQueue.async{
            let key=String(data:self.sessionKeychain(campusOCRCredential) ?? Data(),encoding:.utf8) ?? ""
            DispatchQueue.main.async{
                self.pendingAI.remove(id);guard owner==self.account,generation==self.accountGeneration,self.cancelledAI.remove(id)==nil,!self.loggingOut else{self.reply(id,nil,"OCR已取消");return}
                guard !key.isEmpty else{self.reply(id,nil,"本机校园OCR尚未配置或旧密钥无法静默读取，请在应用内重新配置");return}
                var request=URLRequest(url:URL(string:campusOCREndpoint)!);request.httpMethod="POST";request.setValue("Bearer "+key,forHTTPHeaderField:"Authorization");request.setValue("application/json",forHTTPHeaderField:"Content-Type");request.httpBody=try? JSONSerialization.data(withJSONObject:["file":decoded.data.base64EncodedString(),"fileType":1])
                let config=URLSessionConfiguration.ephemeral;config.httpCookieStorage=nil;config.urlCache=nil;config.timeoutIntervalForRequest=25;config.timeoutIntervalForResource=45
                let session=URLSession(configuration:config);self.ocrOperations[id]=session
                session.dataTask(with:request){data,response,error in
                    session.finishTasksAndInvalidate()
                    let text:Result<String,Error>=Result{guard error==nil,(response as? HTTPURLResponse)?.statusCode==200,let data=data else{throw appError("校园OCR暂时不可用，将尝试本机识别")};return try campusLayoutText(data)}
                    DispatchQueue.main.async{self.ocrOperations.removeValue(forKey:id);guard owner==self.account,generation==self.accountGeneration,!self.loggingOut else{self.reply(id,nil,"账号已切换");return};switch text{case .success(let text):self.reply(id,["text":text,"method":"campus-layout-ocr"]);case .failure(let error):self.reply(id,nil,userError(error))}}
                }.resume()
            }
        }
    }
    private func startAIWithKey(_ id:String,params:[String:Any],messages:[[String:Any]],key:String){
        let hasImages=messages.contains{message in (message["content"] as? [[String:Any]])?.contains{part in part["type"] as? String=="image_url"} == true}
        let campus=params["provider"] as? String=="campus"
        guard let model=campus ? campusGatewayModel:resolvedDeepSeekModel(params["model"] as? String ?? "deepseek-flash",hasImages:hasImages) else{reply(id,nil,"模型不支持");return}
        var req=URLRequest(url:URL(string:campus ? campusGatewayEndpoint:"https://api.deepseek.com/chat/completions")!); req.httpMethod="POST"; req.setValue("Bearer "+key,forHTTPHeaderField:"Authorization"); req.setValue("application/json",forHTTPHeaderField:"Content-Type"); let agent=params["purpose"] as? String=="agent"
        let effort=params["reasoning_effort"] as? String ?? "high"
        guard ["low","high","max"].contains(effort) else{reply(id,nil,"思考强度无效");return}
        var body:[String:Any]=["model":model,"messages":messages,"stream":true,"max_tokens":agent ? (campus ? 8192:16384):4096,"stream_options":["include_usage":true]]
        if !campus{body["thinking"]=["type":agent ? "enabled":"disabled"];if agent{body["reasoning_effort"]=effort}};if let tools=params["tools"] as? [[String:Any]],tools.count<=4 {body["tools"]=tools};req.httpBody=try? JSONSerialization.data(withJSONObject:body)
        #if NATIVE_CONTRACT_TESTS
        if let probe=testAIRequest{probe(req);reply(id,["answer":"synthetic","calls":[]]);return}
        #endif
        let stream=AIStream(req,event:{ value in self.event("ai",["id":id,"delta":value]) },done:{ value,error in DispatchQueue.main.async { self.streams.removeValue(forKey:id); self.reply(id,value,error.map{campus ? "校园网关："+$0+"。仅在浙大内网环境下可用":$0}) } }); streams[id]=stream
    }
    var streams=[String:AIStream]()
    private let localGemma=LocalGemmaService()
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
                case .failed(let error):DispatchQueue.main.async{self.serverFailure(userError(error))}
                default:break
                }
            }
            listener.newConnectionHandler={connection in connection.start(queue:self.queue);self.read(connection,Data())};listener.start(queue:queue)
        }catch{serverFailure(userError(error))}
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
        self.response=response
        let mime=response.mimeType?.lowercased() ?? "application/octet-stream",ext=response.url?.pathExtension.lowercased() ?? ""
        playlist=ext=="m3u8" || mime.contains("mpegurl");image=mime.hasPrefix("image/") || ["png","jpg","jpeg","webp","gif"].contains(ext);buffering = !head && (playlist || image)
        if buffering,response.expectedContentLength>(playlist ? 8*1024*1024:24*1024*1024){abort(413);completionHandler(.cancel);return}
        if !buffering {
            var headers=[String:String]();for name in ["Content-Range","Accept-Ranges"]{if let value=response.value(forHTTPHeaderField:name){headers[name]=value}}
            sentHeaders=true;connection.send(content:app.responseHeader(status:response.statusCode,type:mime,length:response.expectedContentLength>=0 ? response.expectedContentLength:nil,headers:headers),completion:.contentProcessed{error in if error != nil{self.cancel()}})
        }
        app.absorbCookies(response){completionHandler(.allow)}
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
        guard let url=request.url,trusted(url) else{completionHandler(nil);return};app.absorbCookies(response){self.app.cookieRequest(url,range:request.value(forHTTPHeaderField:"Range")){base in var next=base;next.httpMethod=request.httpMethod;completionHandler(next)}}
    }
}
// Status-specific messages never echo response bodies or authentication material.
/// Network failures read as short Chinese reasons instead of the system's English sentence.
func userError(_ error:Error)->String {
    let native = error as NSError
    if native.domain == NSURLErrorDomain {
        switch URLError.Code(rawValue:native.code) {
        case .timedOut:return "网络请求超时，请稍后重试"
        case .notConnectedToInternet:return "当前没有网络连接，请连接网络后重试"
        case .networkConnectionLost:return "网络连接中断，请重试"
        case .cannotFindHost,.dnsLookupFailed:return "无法解析服务器地址，请检查网络"
        case .cannotConnectToHost:return "无法连接服务器，请稍后重试"
        case .cancelled:return "请求已取消"
        case .secureConnectionFailed,.serverCertificateHasBadDate,.serverCertificateUntrusted,.serverCertificateHasUnknownRoot,.serverCertificateNotYetValid,.clientCertificateRejected,.clientCertificateRequired:return "安全连接校验失败，请检查系统时间或网络"
        case .badURL,.unsupportedURL:return "资源地址不受支持"
        case .badServerResponse,.cannotDecodeRawData,.cannotDecodeContentData,.cannotParseResponse:return "服务器响应异常，请稍后重试"
        default:return "网络请求失败，请检查网络后重试"
        }
    }
    return native.localizedDescription
}
func aiNetworkFailure(_ error:Error)->String { userError(error).trimmingCharacters(in:CharacterSet(charactersIn:"。. ")) }

func aiHTTPFailure(_ status:Int)->String? {
    switch status {
    case 200:return nil
    case 401:return "身份验证未通过，请在 AI 设置中重新保存所选服务的密钥（401）"
    case 403:return "所选服务未授予访问权限（403），请核对账号或网关接入范围"
    case 402:return "所选服务额度不足（402），请检查该服务的可用额度"
    case 404:return "所选服务或模型不可用（404），请检查服务配置"
    case 429:return "请求过于频繁或服务配额已达上限（429），请稍后重试"
    case 500...599:return "AI 服务暂时异常（\(status)），请稍后重试"
    default:return "AI 服务请求未完成（\(status)）"
    }
}
final class AIStream:NSObject,URLSessionDataDelegate {
    var session:URLSession!,buffer=Data(),status=0,answer="",reasoning="",serviceError:String?,finishReason:String?,calls=[Int:[String:Any]](),usage=[String:Any]();let event:(String)->Void,done:([String:Any],String?)->Void
    init(_ request:URLRequest,start:Bool=true,event:@escaping(String)->Void,done:@escaping([String:Any],String?)->Void) {self.event=event;self.done=done;super.init();let c=URLSessionConfiguration.ephemeral;c.timeoutIntervalForRequest=request.url?.host=="127.0.0.1" ? 600:120;c.httpCookieStorage=nil;if request.url?.host=="127.0.0.1"{c.connectionProxyDictionary=[:]};session=URLSession(configuration:c,delegate:self,delegateQueue:nil);if start{session.dataTask(with:request).resume()}}
    func urlSession(_ session:URLSession,dataTask:URLSessionDataTask,didReceive response:URLResponse,completionHandler:@escaping(URLSession.ResponseDisposition)->Void){status=(response as? HTTPURLResponse)?.statusCode ?? 0;completionHandler(.allow)}
    func consume(_ data:Data) {
        buffer.append(data)
        while let range=buffer.range(of:Data([10])) {
            let line=String(data:buffer[..<range.lowerBound],encoding:.utf8) ?? "";buffer.removeSubrange(..<range.upperBound)
            if line.hasPrefix("{"),let bytes=line.data(using:.utf8),let row=try? JSONSerialization.jsonObject(with:bytes) as? [String:Any] {
                if let error=row["error"] as? String{serviceError=error}
                if let message=row["message"] as? [String:Any] {
                    if let content=message["content"] as? String{answer+=content;event(content)}
                    if let thinking=message["thinking"] as? String{reasoning+=thinking}
                    if let tools=message["tool_calls"] as? [[String:Any]]{for tool in tools{guard var function=tool["function"] as? [String:Any] else{continue};if let arguments=function["arguments"],!(arguments is String){function["arguments"]=String(data:(try? JSONSerialization.data(withJSONObject:arguments)) ?? Data("{}".utf8),encoding:.utf8) ?? "{}"};let i=calls.count;calls[i]=["id":tool["id"] as? String ?? "local-call-\(i)","type":"function","function":function]}}
                }
                if row["done"] as? Bool==true{finishReason=row["done_reason"] as? String ?? "stop";usage=["prompt_tokens":row["prompt_eval_count"] as? Int ?? 0,"completion_tokens":row["eval_count"] as? Int ?? 0]}
                continue
            }
            guard line.hasPrefix("data:"),let value=line.dropFirst(5).trimmingCharacters(in:.whitespacesAndNewlines).data(using:.utf8),let row=try? JSONSerialization.jsonObject(with:value) as? [String:Any] else{continue}
            if let u=row["usage"] as? [String:Any]{usage=u}
            guard let choices=row["choices"] as? [[String:Any]],let first=choices.first else{continue}
            if let reason=first["finish_reason"] as? String{finishReason=reason}
            guard let delta=first["delta"] as? [String:Any] else{continue}
            // Required by DeepSeek on subsequent tool turns; never sent to the visible UI.
            if let text=delta["reasoning_content"] as? String{reasoning+=text}
            if let text=delta["content"] as? String{answer+=text;event(text)}
            if let tools=delta["tool_calls"] as? [[String:Any]]{for t in tools{
                let i=t["index"] as? Int ?? 0;var c=calls[i] ?? ["id":"","type":"function","function":["name":"","arguments":""]]
                if let id=t["id"] as? String{c["id"]=id}
                if let f=t["function"] as? [String:Any]{var fn=c["function"] as? [String:String] ?? [:];for k in ["name","arguments"]{if let v=f[k] as? String{fn[k]=(fn[k] ?? "")+v}};c["function"]=fn};calls[i]=c
            }}
        }
    }
    func result()->[String:Any]{var value:[String:Any]=["answer":answer,"calls":calls.keys.sorted().compactMap{calls[$0]},"usage":usage,"reasoning_content":reasoning];if let reason=finishReason{value["finish_reason"]=reason};return value}
    func urlSession(_ session:URLSession,dataTask:URLSessionDataTask,didReceive data:Data){consume(data)}
    func urlSession(_ session:URLSession,task:URLSessionTask,didCompleteWithError error:Error?){if !buffer.isEmpty{consume(Data([10]))};done(result(),error.map(aiNetworkFailure) ?? serviceError ?? aiHTTPFailure(status));session.finishTasksAndInvalidate()}
}

let application=NSApplication.shared
let delegate=App();application.delegate=delegate;application.run()
