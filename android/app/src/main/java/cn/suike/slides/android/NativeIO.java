package cn.suike.slides.android;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.webkit.CookieManager;
import android.webkit.MimeTypeMap;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebSettings;
import androidx.core.content.FileProvider;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.Closeable;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URLConnection;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.GZIPInputStream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Privileged services for bundled application code only. The shell must never attach
 * the Javascript interface to a WebView displaying remote sign-in or course pages.
 * Network origins and canonical file paths are checked again at every native entry.
 */
public final class NativeIO implements Closeable {
    public interface Host {
        void respond(String id, Object value, String error);
        void event(String name, Object value);
        CompletableFuture<String> pickImage();
        default CompletableFuture<String> pickImage(String source) { return pickImage(); }
        CompletableFuture<String> exportFile(String path, String name);
        CompletableFuture<Void> login();
        void fullscreen(boolean enabled);
        void openExternal(String url);
    }

    private static final int CHUNK = 32768, MAX_FILE_MESSAGE = 16 * 1024 * 1024;
    private static final long DEFAULT_HTTP_LIMIT = 32L * 1024 * 1024;
    private static final String KEY_ALIAS = "zhiyun-local-secrets-v1";
    private final Activity activity;
    private final WebView webView;
    private final Host host;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final File files, cache, temporary, secrets;
    private final SecureRandom random = new SecureRandom();
    private final ThreadPoolExecutor workers = new ThreadPoolExecutor(4, 4, 30,
            TimeUnit.SECONDS, new ArrayBlockingQueue<>(96), runnable -> {
                Thread thread = new Thread(runnable, "Zhiyun-native"); thread.setDaemon(true); return thread;
            });
    private final ThreadPoolExecutor streamWorkers = new ThreadPoolExecutor(0, 8, 30,
            TimeUnit.SECONDS, new java.util.concurrent.SynchronousQueue<>(), runnable -> {
                Thread thread = new Thread(runnable, "Zhiyun-transfer"); thread.setDaemon(true); return thread;
            });
    private final ThreadPoolExecutor imageWorkers = new ThreadPoolExecutor(0, 1, 30,
            TimeUnit.SECONDS, new ArrayBlockingQueue<>(32), runnable -> {
                Thread thread = new Thread(runnable, "Zhiyun-image"); thread.setDaemon(true); return thread;
            });
    private final ThreadPoolExecutor clipboardWorkers = new ThreadPoolExecutor(0, 1, 30,
            TimeUnit.SECONDS, new ArrayBlockingQueue<>(8), runnable -> {
                Thread thread = new Thread(runnable, "Zhiyun-clipboard"); thread.setDaemon(true); return thread;
            });
    private final AtomicInteger nextFd = new AtomicInteger(100);
    private final Map<Integer, Handle> handles = new ConcurrentHashMap<>();
    private final Map<String, Transfer> transfers = new ConcurrentHashMap<>();
    private final Map<String, Long> queuedCancellations = new ConcurrentHashMap<>();
    private final Map<String, Resource> resources = new ConcurrentHashMap<>();
    private final Map<String, String> resourceUrls = new ConcurrentHashMap<>();
    private final Set<InputStream> resourceStreams = ConcurrentHashMap.newKeySet();
    private final Set<String> cookieOrigins = ConcurrentHashMap.newKeySet();
    private final Set<File> protectedFiles = ConcurrentHashMap.newKeySet();
    private final AtomicBoolean closed = new AtomicBoolean();
    private final Object secretLock = new Object();
    private final NativeSocket sockets;

    public NativeIO(Activity activity, WebView webView, Host host) throws IOException {
        this.activity = activity; this.webView = webView; this.host = host;
        files = new File(activity.getFilesDir(), "workspace").getCanonicalFile();
        cache = new File(activity.getCacheDir(), "workspace").getCanonicalFile();
        temporary = new File(cache, "temp");
        secrets = new File(activity.getFilesDir(), ".secrets").getCanonicalFile();
        makeDirectory(files); makeDirectory(cache); makeDirectory(temporary); makeDirectory(secrets);
        cookieOrigins.add("https://classroom.zju.edu.cn/");
        cookieOrigins.add("https://interactivemeta.cmc.zju.edu.cn/");
        cookieOrigins.add("https://zjuam.zju.edu.cn/");
        CookieManager.getInstance().setAcceptCookie(true);
        sockets = new NativeSocket(this::emit, random);
    }

    public String sync(String method, String payload) {
        try {
            if (closed.get()) throw new IOException("应用服务已关闭");
            if (!(method.startsWith("fs.") && !method.equals("fs.export")) &&
                    !method.equals("cookies.get") && !method.equals("app.paths") &&
                    !method.startsWith("resource.")) throw new IOException("此操作须异步执行");
            return object("value", value(method, json(payload))).toString();
        } catch (Exception error) { return object("error", safeError(error)).toString(); }
    }

    public void post(String id, String method, String payload) {
        if (closed.get()) { respond(id, null, "应用服务已关闭"); return; }
        try {
            JSONObject data = json(payload);
            // Cancellation must not wait behind the download it is cancelling.
            if (method.equals("http.cancel")) {
                String requestId = data.optString("requestId"); Transfer transfer = transfers.get(requestId);
                if (transfer != null) transfer.cancel();
                else if (!requestId.isEmpty() && requestId.length() <= 256) {
                    long now = System.currentTimeMillis();
                    queuedCancellations.entrySet().removeIf(entry -> now - entry.getValue() > 600000);
                    if (queuedCancellations.size() >= 512) queuedCancellations.clear();
                    queuedCancellations.put(requestId, now);
                }
                respond(id, true, null); return;
            }
            if (method.equals("http.ack")) {
                Transfer transfer = transfers.get(data.optString("requestId"));
                if (transfer != null) transfer.ack(data.optInt("sequence", -1));
                respond(id, true, null); return;
            }
            if (method.equals("websocket.close")) {
                sockets.close(data.optString("socketId")); respond(id, true, null); return;
            }
            if (method.equals("picker.image")) {
                main.post(() -> host.pickImage(data.optString("source")).whenComplete((result, error) -> respond(id, result, error == null ? null : safeError(error)))); return;
            }
            if (method.equals("app.login")) {
                main.post(() -> host.login().whenComplete((result, error) -> respond(id, true, error == null ? null : safeError(error)))); return;
            }
            if (method.equals("fs.export") || method.equals("export.share")) {
                File source = path(data.getString("path"));
                if (!source.isFile()) throw new IOException("导出文件不存在");
                protectedFiles.add(source);
                main.post(() -> host.exportFile(source.getPath(), cleanName(data.optString("name", source.getName())))
                        .whenComplete((result, error) -> { protectedFiles.remove(source); respond(id, result, error == null ? null : safeError(error)); })); return;
            }
            if (method.equals("app.fullscreen")) {
                main.post(() -> { host.fullscreen(data.optBoolean("enabled")); respond(id, true, null); }); return;
            }
            if (method.equals("app.cachePolicy")) {
                main.post(() -> {
                    try {
                        webView.getSettings().setCacheMode(data.optBoolean("enabled", true) ? WebSettings.LOAD_DEFAULT : WebSettings.LOAD_NO_CACHE);
                        respond(id, true, null);
                    } catch (Exception error) { respond(id, null, safeError(error)); }
                }); return;
            }
            if (method.equals("app.finish")) {
                main.post(() -> { respond(id, true, null); activity.finish(); }); return;
            }
            if (method.equals("app.exit")) {
                main.post(() -> { respond(id, true, null); activity.moveTaskToBack(true); }); return;
            }
            if (method.equals("app.openExternal")) {
                URI uri = NativePolicy.externalHttps(data.getString("url"));
                main.post(() -> { host.openExternal(uri.toString()); respond(id, true, null); }); return;
            }
            if (method.equals("app.clipboard")) {
                String text = data.optString("text");
                clipboardWorkers.execute(() -> {
                    try {
                        String html = data.optString("html");
                        List<Uri> shared = new ArrayList<>(); Set<File> snapshots = new java.util.HashSet<>();
                        JSONArray images = data.optJSONArray("images");
                        if (images != null) for (int i = 0; i < images.length() && i < 64; i++) {
                            String raw = images.optString(i); File image = resolveResourceLocal(raw);
                            if (image == null && new File(raw).isAbsolute()) image = path(raw);
                            if (image != null && image.isFile()) {
                                File sharedImage = clipboardImage(image); if (!sharedImage.equals(image)) snapshots.add(sharedImage);
                                Uri uri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".files", sharedImage); shared.add(uri);
                                html = html.replace(raw, uri.toString());
                            }
                        }
                        ClipData clip = html.isEmpty() ? ClipData.newPlainText("智云助手", text) : ClipData.newHtmlText("智云助手", text, html);
                        for (Uri uri : shared) clip.addItem(activity.getContentResolver(), new ClipData.Item(uri));
                        pruneClipboard(snapshots);
                        main.post(() -> {
                            try { ClipboardManager clipboard = (ClipboardManager) activity.getSystemService(Context.CLIPBOARD_SERVICE);
                                clipboard.setPrimaryClip(clip); respond(id, true, null);
                            } catch (Exception error) { respond(id, null, safeError(error)); }
                        });
                    } catch (Exception error) { respond(id, null, safeError(error)); }
                }); return;
            }
            if (method.equals("app.clipboardRead")) {
                main.post(() -> {
                    try {
                        ClipboardManager clipboard = (ClipboardManager) activity.getSystemService(Context.CLIPBOARD_SERVICE);
                        ClipData clip = clipboard.getPrimaryClip(); String text = "", html = "";
                        if (clip != null && clip.getItemCount() > 0) {
                            ClipData.Item item = clip.getItemAt(0); CharSequence content = item.coerceToText(activity);
                            text = content == null ? "" : content.toString(); html = item.getHtmlText() == null ? "" : item.getHtmlText();
                        }
                        respond(id, object("text", text, "html", html), null);
                    } catch (Exception error) { respond(id, null, safeError(error)); }
                }); return;
            }
            if (method.equals("http.stream")) {
                startStream(id, data); return;
            }
            ThreadPoolExecutor executor = method.startsWith("image.") ? imageWorkers : workers;
            executor.execute(() -> {
                try { respond(id, value(method, data), null); }
                catch (Exception error) { respond(id, null, safeError(error)); }
            });
        } catch (Exception error) { respond(id, null, safeError(error)); }
    }

    private Object value(String method, JSONObject p) throws Exception {
        switch (method) {
            case "app.campusServices": { try (InputStream input = activity.getAssets().open("CampusServices.json")) { ByteArrayOutputStream out = new ByteArrayOutputStream(); byte[] bytes = new byte[1024]; int count; while ((count = input.read(bytes)) != -1) { if (out.size() + count > 16384) throw new IOException("校内服务配置过大"); out.write(bytes,0,count); } return out.toString("UTF-8"); } catch (java.io.FileNotFoundException absent) { return "{}"; } }
            case "app.paths": return object("root", files.getPath(), "filesDir", files.getPath(),
                    "cacheDir", cache.getPath(), "tempDir", temporary.getPath());
            case "fs.exists": return path(p.getString("path")).exists();
            case "fs.mkdir": {
                File target = path(p.getString("path"));
                if (!(p.optBoolean("recursive") ? target.mkdirs() : target.mkdir()) && !target.isDirectory())
                    throw new IOException("无法创建目录"); return true;
            }
            case "fs.list": {
                String[] list = path(p.getString("path")).list();
                if (list == null) throw new IOException("目录不存在");
                java.util.Arrays.sort(list); return new JSONArray(list);
            }
            case "fs.readText": return new String(readFile(path(p.getString("path")), MAX_FILE_MESSAGE), StandardCharsets.UTF_8);
            case "fs.readBytes": return encode(readFile(path(p.getString("path")), MAX_FILE_MESSAGE));
            case "fs.writeBytes": {
                File target = path(p.getString("path"));
                atomicWrite(target, decode(p.getString("base64"), MAX_FILE_MESSAGE)); return true;
            }
            case "fs.stat": {
                if (p.has("fd")) {
                    Handle h = descriptor(p.getInt("fd"));
                    synchronized (h) { return object("size", h.file.length(), "mtime", h.path.lastModified(), "directory", false); }
                }
                File target = path(p.getString("path"));
                if (!target.exists()) throw new IOException("文件不存在");
                return object("size", target.length(), "mtime", target.lastModified(), "directory", target.isDirectory());
            }
            case "fs.open": {
                File target = path(p.getString("path")); int flags = p.optInt("flags");
                boolean writable = (flags & 3) != 0;
                if (!target.exists() && ((flags & 64) == 0 || !writable)) throw new IOException("文件不存在");
                if (handles.size() >= 128) throw new IOException("打开的文件过多");
                RandomAccessFile raf = new RandomAccessFile(target, writable ? "rw" : "r");
                if (writable && (flags & 512) != 0) raf.setLength(0);
                if (writable && (flags & 1024) != 0) raf.seek(raf.length());
                int fd = nextFd.getAndIncrement(); handles.put(fd, new Handle(raf, target, writable, (flags & 1024) != 0));
                return object("fd", fd);
            }
            case "fs.fdPath": return descriptor(p.getInt("fd")).path.getPath();
            case "fs.close": {
                Handle h = handles.remove(p.getInt("fd"));
                if (h != null) synchronized (h) { h.file.close(); } return true;
            }
            case "fs.write": {
                Handle h = descriptor(p.getInt("fd"));
                byte[] bytes = p.has("base64") ? decode(p.getString("base64"), MAX_FILE_MESSAGE) : p.optString("text").getBytes(StandardCharsets.UTF_8);
                if (!h.writable || bytes.length > MAX_FILE_MESSAGE) throw new IOException("文件不可写或数据过大");
                synchronized (h) { if (h.append) h.file.seek(h.file.length()); h.file.write(bytes); } return bytes.length;
            }
            case "fs.read": {
                Handle h = descriptor(p.getInt("fd")); int size = p.optInt("length", CHUNK);
                if (size < 0 || size > MAX_FILE_MESSAGE) throw new IOException("读取长度无效");
                byte[] bytes = new byte[size]; int read;
                synchronized (h) { read = h.file.read(bytes); }
                return encode(read < 0 ? new byte[0] : java.util.Arrays.copyOf(bytes, read));
            }
            case "fs.truncate": {
                Handle h = descriptor(p.getInt("fd")); long length = p.getLong("length");
                if (!h.writable || length < 0) throw new IOException("无法修改文件长度");
                synchronized (h) { h.file.setLength(length); } return true;
            }
            case "fs.rename": {
                File from = path(p.getString("from")), to = path(p.getString("to"));
                protectRoot(from); protectRoot(to);
                Files.move(from.toPath(), to.toPath(), StandardCopyOption.REPLACE_EXISTING); return true;
            }
            case "fs.remove": {
                File target = path(p.getString("path")); protectRoot(target);
                for (File pending : protectedFiles) if (NativePolicy.under(pending, target))
                    throw new IOException("文件正在导出，请保存完成后再清理");
                if (target.isDirectory() && !p.optBoolean("recursive")) {
                    if (!target.delete() && target.exists()) throw new IOException("目录非空");
                } else removeTree(target); return true;
            }
            case "fs.copy": copy(p.get("from"), p.get("to")); return true;
            case "secret.get": return getSecret(p.getString("alias"));
            case "secret.set": setSecret(p.getString("alias"), p.getString("value")); return true;
            case "secret.remove": {
                synchronized (secretLock) { Files.deleteIfExists(secretFile(p.getString("alias")).toPath()); } return true;
            }
            case "cookies.get": return cookies(p.optString("url", ""));
            case "cookies.set": setCookie(p); return true;
            case "cookies.remove": removeCookie(p); return true;
            case "cookies.flush": CookieManager.getInstance().flush(); return true;
            case "cookies.clear": clearCookies(); return true;
            case "http.request": return request(p);
            case "image.info": return imageInfo(imagePath(p));
            case "image.pixels": return pixels(p);
            case "image.pack": return pack(p);
            case "image.crop": return crop(p);
            case "zip.create": zip(path(p.getString("folder")), path(p.getString("destination"))); return true;
            case "picker.save": {
                File target = new File(temporary, token() + "-" + cleanName(p.optString("name", "导出文件")));
                return new JSONArray().put(target.getPath());
            }
            case "resource.local": return register(path(p.getString("path")), null, p.optString("kind"));
            case "resource.remote": return register(null, NativePolicy.https(p.getString("url"), true), p.optString("kind"));
            case "resource.resolve": {
                Resource resource = resource(p.getString("url"));
                return resource == null ? JSONObject.NULL : resource.local != null ? object("local", resource.local.getPath()) : object("remote", resource.remote.toString());
            }
            case "resource.clear": clearResources(); return true;
            case "app.cacheInfo": return cacheInfo();
            case "app.cacheClear": clearNativeCache(p); return true;
            case "websocket.connect": sockets.connect(p.getString("socketId"), p.getString("url")); return true;
            case "websocket.send": sockets.send(p.getString("socketId"), p.getString("text")); return true;
            default: throw new IOException("未知的本机操作：" + method);
        }
    }

    private static JSONObject json(String raw) throws Exception { return raw == null || raw.isEmpty() ? new JSONObject() : new JSONObject(raw); }
    private File path(String value) throws IOException { return NativePolicy.sandbox(value, files, cache); }
    private void protectRoot(File value) throws IOException {
        if (value.equals(files) || value.equals(cache) || value.equals(temporary)) throw new IOException("无法删除应用根目录");
    }
    private Handle descriptor(int fd) throws IOException {
        Handle handle = handles.get(fd); if (handle == null) throw new IOException("文件句柄已关闭"); return handle;
    }
    private File imagePath(JSONObject p) throws Exception { return p.has("fd") ? descriptor(p.getInt("fd")).path : path(p.getString("path")); }
    private static final class Handle {
        final RandomAccessFile file; final File path; final boolean writable, append;
        Handle(RandomAccessFile file, File path, boolean writable, boolean append) { this.file = file; this.path = path; this.writable = writable; this.append = append; }
    }
    private static void makeDirectory(File folder) throws IOException {
        if (!folder.mkdirs() && !folder.isDirectory()) throw new IOException("无法创建应用目录");
    }
    private void removeTree(File value) throws IOException {
        path(value.getPath());
        if (Files.isSymbolicLink(value.toPath())) { Files.deleteIfExists(value.toPath()); return; }
        if (value.isDirectory()) {
            File[] children = value.listFiles(); if (children == null) throw new IOException("无法读取目录");
            for (File child : children) removeTree(child);
        }
        if (!value.delete() && value.exists()) throw new IOException("文件仍在使用，无法删除");
    }
    private static byte[] readFile(File file, long limit) throws IOException {
        if (!file.isFile()) throw new IOException("文件不存在");
        if (file.length() > limit) throw new IOException("文件过大，请分块读取");
        try (InputStream input = new FileInputStream(file)) { return readAll(input, limit); }
    }
    private static byte[] readAll(InputStream input, long limit) throws IOException {
        ByteArrayOutputStream result = new ByteArrayOutputStream(); byte[] buffer = new byte[CHUNK]; int count;
        while ((count = input.read(buffer)) != -1) {
            if (result.size() + (long) count > limit) throw new IOException("响应超过允许大小"); result.write(buffer, 0, count);
        }
        return result.toByteArray();
    }
    private void atomicWrite(File target, byte[] value) throws IOException {
        makeDirectory(target.getParentFile()); File pending = new File(target.getParentFile(), "." + token() + ".part");
        try {
            try (FileOutputStream output = new FileOutputStream(pending)) { output.write(value); output.getFD().sync(); }
            Files.move(pending.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } finally { pending.delete(); }
    }
    private void copy(Object from, Object to) throws Exception {
        File source = from instanceof Number ? descriptor(((Number) from).intValue()).path : path(String.valueOf(from));
        File destination = to instanceof Number ? descriptor(((Number) to).intValue()).path : path(String.valueOf(to));
        if (source.equals(destination)) throw new IOException("不能将文件复制到自身");
        if (to instanceof Number && !descriptor(((Number) to).intValue()).writable) throw new IOException("目标文件不可写");
        makeDirectory(destination.getParentFile());
        if (to instanceof Number) {
            Handle h = descriptor(((Number) to).intValue());
            synchronized (h) {
                h.file.setLength(0); h.file.seek(0);
                try (InputStream input = new FileInputStream(source)) {
                    byte[] buffer = new byte[CHUNK]; int n; while ((n = input.read(buffer)) != -1) h.file.write(buffer, 0, n);
                }
            }
        } else Files.copy(source.toPath(), destination.toPath(), StandardCopyOption.REPLACE_EXISTING);
    }

    private File secretFile(String alias) throws Exception {
        if (alias.isEmpty() || alias.length() > 256) throw new IOException("安全存储名称无效");
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(alias.getBytes(StandardCharsets.UTF_8));
        StringBuilder name = new StringBuilder(); for (byte part : digest) name.append(String.format(Locale.ROOT, "%02x", part & 255));
        return new File(secrets, name + ".enc");
    }
    private SecretKey secretKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (store.containsAlias(KEY_ALIAS)) return (SecretKey) store.getKey(KEY_ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setKeySize(256)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true).build());
        return generator.generateKey();
    }
    private Object getSecret(String alias) throws Exception {
        synchronized (secretLock) {
            File source = secretFile(alias); if (!source.exists()) return JSONObject.NULL;
            byte[] envelope = readFile(source, 512 * 1024);
            if (envelope.length < 13 || envelope[0] != 1) throw new IOException("安全存储格式无效");
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, secretKey(), new GCMParameterSpec(128, java.util.Arrays.copyOfRange(envelope, 1, 13)));
            cipher.updateAAD(alias.getBytes(StandardCharsets.UTF_8));
            return new String(cipher.doFinal(envelope, 13, envelope.length - 13), StandardCharsets.UTF_8);
        }
    }
    private void setSecret(String alias, String value) throws Exception {
        synchronized (secretLock) {
            byte[] bytes = value.getBytes(StandardCharsets.UTF_8);
            if (bytes.length > 256 * 1024) throw new IOException("安全存储数据过大");
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, secretKey());
            cipher.updateAAD(alias.getBytes(StandardCharsets.UTF_8)); byte[] encrypted = cipher.doFinal(bytes), iv = cipher.getIV();
            byte[] envelope = new byte[1 + iv.length + encrypted.length]; envelope[0] = 1;
            System.arraycopy(iv, 0, envelope, 1, iv.length); System.arraycopy(encrypted, 0, envelope, 1 + iv.length, encrypted.length);
            File target = secretFile(alias), pending = new File(secrets, "." + token() + ".part");
            try {
                try (FileOutputStream output = new FileOutputStream(pending)) { output.write(envelope); output.getFD().sync(); }
                Files.move(pending.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            } finally { pending.delete(); }
        }
    }

    private JSONArray cookies(String address) throws Exception {
        JSONArray result = new JSONArray(); Set<String> origins;
        if (!address.isEmpty()) { URI uri = NativePolicy.https(address, true); origins = Collections.singleton(uri.toString()); }
        else origins = new java.util.HashSet<>(cookieOrigins);
        Set<String> seen = new java.util.HashSet<>();
        for (String origin : origins) {
            URI uri = NativePolicy.https(origin, true); if (!NativePolicy.campus(uri)) continue;
            String value = CookieManager.getInstance().getCookie(origin); if (value == null) continue;
            for (String part : value.split(";")) {
                int separator = part.indexOf('='); if (separator <= 0) continue;
                String name = part.substring(0, separator).trim(), content = part.substring(separator + 1).trim();
                if (seen.add(uri.getHost() + "\0" + name)) result.put(object("name", name, "value", content,
                        "domain", uri.getHost(), "path", "/", "secure", true, "httpOnly", true, "hostOnly", true));
            }
        }
        return result;
    }
    private void setCookie(JSONObject data) throws Exception {
        URI uri = NativePolicy.https(data.getString("url"), true);
        if (!NativePolicy.campus(uri)) throw new IOException("只能保存校园登录会话");
        String name = data.getString("name"), value = data.optString("value"), cookiePath = data.optString("path", "/");
        if (!name.matches("[!#$%&'*+.^_`|~0-9A-Za-z-]+") || value.matches("(?s).*[;\r\n\0].*") ||
                !cookiePath.startsWith("/") || cookiePath.matches("(?s).*[;\r\n\0].*")) throw new IOException("会话格式无效");
        StringBuilder cookie = new StringBuilder(name).append('=').append(value).append("; Path=").append(cookiePath);
        String domain = data.optString("domain", "").replaceFirst("^\\.", "").toLowerCase(Locale.ROOT);
        if (!domain.isEmpty()) {
            if (!(domain.equals("zju.edu.cn") || domain.endsWith(".zju.edu.cn")) ||
                    !(uri.getHost().equalsIgnoreCase(domain) || uri.getHost().toLowerCase(Locale.ROOT).endsWith("." + domain)))
                throw new IOException("会话域名无效");
            cookie.append("; Domain=").append(domain);
        }
        if (data.optBoolean("secure", true)) cookie.append("; Secure");
        if (data.optBoolean("httpOnly")) cookie.append("; HttpOnly");
        if (data.has("expirationDate")) {
            long seconds = data.optLong("expirationDate") - System.currentTimeMillis() / 1000;
            cookie.append("; Max-Age=").append(Math.max(0, seconds));
        }
        String sameSite = data.optString("sameSite", "");
        if (sameSite.equalsIgnoreCase("strict") || sameSite.equalsIgnoreCase("lax") || sameSite.equalsIgnoreCase("none")) cookie.append("; SameSite=").append(sameSite);
        cookieOrigins.add(NativePolicy.origin(uri) + cookiePath);
        CookieManager.getInstance().setCookie(uri.toString(), cookie.toString());
    }
    private void removeCookie(JSONObject data) throws Exception {
        URI uri = NativePolicy.https(data.getString("url"), true);
        if (!NativePolicy.campus(uri)) throw new IOException("只能清理校园登录会话");
        String name = data.getString("name"); if (!name.matches("[!#$%&'*+.^_`|~0-9A-Za-z-]+")) throw new IOException("会话名称无效");
        CookieManager manager = CookieManager.getInstance();
        manager.setCookie(uri.toString(), name + "=; Path=/; Max-Age=0; Secure");
        manager.setCookie(uri.toString(), name + "=; Path=/; Domain=" + uri.getHost() + "; Max-Age=0; Secure");
        manager.setCookie(uri.toString(), name + "=; Path=/; Domain=zju.edu.cn; Max-Age=0; Secure");
    }
    private void clearCookies() throws Exception {
        // This app owns its WebView cookie store. Completion is observed before session logout completes.
        CompletableFuture<Void> done = new CompletableFuture<>();
        main.post(() -> CookieManager.getInstance().removeAllCookies(value -> done.complete(null)));
        done.get(15, TimeUnit.SECONDS); CookieManager.getInstance().flush(); clearResources();
    }

    private JSONObject request(JSONObject data) throws Exception {
        Transfer transfer = new Transfer(); String id = data.optString("requestId", token());
        if (transfers.putIfAbsent(id, transfer) != null) throw new IOException("请求标识重复");
        if (queuedCancellations.remove(id) != null) { transfers.remove(id, transfer); throw new IOException("请求已取消"); }
        try (Connection connection = connect(data, transfer, false)) {
            byte[] bytes = readAll(connection.input, Math.min(DEFAULT_HTTP_LIMIT, limit(data, DEFAULT_HTTP_LIMIT)));
            if (transfer.cancelled.get()) throw new IOException("请求已取消");
            String mime = connection.mime.toLowerCase(Locale.ROOT);
            String expected = data.optString("expectDataType");
            boolean binary = data.optBoolean("binary") || expected.equals("ARRAY_BUFFER") ||
                    (!expected.equals("STRING") && !(mime.startsWith("text/") || mime.contains("json") || mime.contains("xml") || mime.contains("javascript") || mime.contains("mpegurl")));
            String content = binary ? encode(bytes) : new String(bytes, StandardCharsets.UTF_8);
            if (!binary && connection.status >= 200 && connection.status < 300 && NativePolicy.campus(connection.uri))
                sockets.trustMetadata(content);
            return object("status", connection.status, "headers", new JSONObject(connection.headers), "body", content, "base64", binary);
        } finally { transfers.remove(id, transfer); }
    }
    private void startStream(String callbackId, JSONObject data) throws Exception {
        String id = data.getString("requestId"); Transfer transfer = new Transfer();
        if (id.length() > 256 || transfers.putIfAbsent(id, transfer) != null) throw new IOException("请求标识重复");
        try {
            streamWorkers.execute(() -> {
                boolean responseSent = false;
                try (Connection connection = connect(data, transfer, false)) {
                    emit("http.headers", object("requestId", id, "headers", new JSONObject(connection.headers), "status", connection.status));
                    respond(callbackId, connection.status, null); responseSent = true;
                    byte[] buffer = new byte[CHUNK]; long size = 0, maximum = limit(data, 64L * 1024 * 1024 * 1024); int count, sequence = 0;
                    boolean backpressure = data.optBoolean("backpressure");
                    while (!transfer.cancelled.get() && (count = connection.input.read(buffer)) != -1) {
                        size += count; if (size > maximum) throw new IOException("资源超过允许大小");
                        // Only one bridge event waits on the main thread at a time: no unbounded UI queue.
                        if (backpressure) transfer.expect(++sequence);
                        emitBlocking("http.data", object("requestId", id, "sequence", sequence, "base64", Base64.encodeToString(buffer, 0, count, Base64.NO_WRAP)), transfer);
                        if (backpressure && !transfer.acknowledgement.tryAcquire(30, TimeUnit.SECONDS)) throw new IOException("数据写入超时，请暂停后继续下载");
                    }
                    if (transfer.cancelled.get()) throw new IOException("请求已取消");
                    emit("http.end", object("requestId", id));
                } catch (Exception error) {
                    if (!responseSent) respond(callbackId, null, safeError(error));
                    emit("http.error", object("requestId", id, "error", safeError(error)));
                } finally { transfers.remove(id, transfer); }
            });
        } catch (Exception error) { transfers.remove(id, transfer); throw error; }
    }
    private long limit(JSONObject data, long defaultValue) throws IOException {
        long value = data.optLong("maxBytes", defaultValue);
        if (value <= 0 || value > 64L * 1024 * 1024 * 1024) throw new IOException("响应大小限制无效"); return value;
    }
    private Connection connect(JSONObject data, Transfer transfer, boolean media) throws Exception {
        URI uri = NativePolicy.https(data.getString("url"), media);
        String method = data.optString("method", "GET").toUpperCase(Locale.ROOT);
        if (!(method.equals("GET") || method.equals("POST") || method.equals("HEAD") || method.equals("PUT") || method.equals("DELETE") || method.equals("PATCH")))
            throw new IOException("请求方法无效");
        JSONObject supplied = data.optJSONObject("headers"); Map<String, String> headers = new LinkedHashMap<>();
        if (supplied != null) {
            Iterator<String> keys = supplied.keys();
            while (keys.hasNext()) {
                String key = keys.next(), value = supplied.optString(key);
                if (!key.matches("[!#$%&'*+.^_`|~0-9A-Za-z-]+") || value.matches("(?s).*[\r\n\0].*")) throw new IOException("请求头无效");
                if (!key.equalsIgnoreCase("Host") && !key.equalsIgnoreCase("Content-Length") && !key.equalsIgnoreCase("Connection")) headers.put(key, value);
            }
        }
        byte[] body = data.has("bodyBase64") ? decode(data.getString("bodyBase64"), MAX_FILE_MESSAGE) : data.has("body") ? data.optString("body").getBytes(StandardCharsets.UTF_8) : null;
        int timeout = Math.min(180000, Math.max(1000, data.optInt("timeout", 30000)));
        for (int redirect = 0; redirect <= 5; redirect++) {
            if (transfer.cancelled.get() || closed.get()) throw new IOException("请求已取消");
            HttpURLConnection connection = (HttpURLConnection) uri.toURL().openConnection();
            transfer.connection = connection; connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(Math.min(timeout, 20000)); connection.setReadTimeout(timeout);
            connection.setUseCaches(false); connection.setRequestMethod(method);
            connection.setRequestProperty("Accept-Encoding", "identity");
            boolean campus = NativePolicy.campus(uri);
            for (Map.Entry<String, String> entry : headers.entrySet()) {
                // Campus credentials are never forwarded to media CDNs or AI hosts.
                if (!NativePolicy.credentialHeaderAllowed(entry.getKey(), uri)) continue;
                connection.setRequestProperty(entry.getKey(), entry.getValue());
            }
            if (campus && !hasHeader(headers, "Cookie")) {
                String cookie = CookieManager.getInstance().getCookie(uri.toString());
                if (cookie != null) connection.setRequestProperty("Cookie", cookie);
            }
            try {
                if (body != null && !method.equals("GET") && !method.equals("HEAD")) {
                    connection.setDoOutput(true); connection.setFixedLengthStreamingMode(body.length);
                    try (OutputStream output = connection.getOutputStream()) { output.write(body); }
                }
                int status = connection.getResponseCode();
                if (transfer.cancelled.get() || closed.get()) throw new IOException("请求已取消");
                if (campus) {
                    cookieOrigins.add(NativePolicy.origin(uri) + "/");
                    for (Map.Entry<String, List<String>> entry : connection.getHeaderFields().entrySet())
                        if (entry.getKey() != null && entry.getKey().equalsIgnoreCase("Set-Cookie"))
                            for (String cookie : entry.getValue()) CookieManager.getInstance().setCookie(uri.toString(), cookie);
                }
                if (status == 301 || status == 302 || status == 303 || status == 307 || status == 308) {
                    String location = connection.getHeaderField("Location");
                    if (location == null || redirect == 5) throw new IOException("重定向次数过多或地址缺失");
                    URI next = NativePolicy.https(uri.resolve(location).toString(), media);
                    if (NativePolicy.credentialsMustBeStripped(uri, next)) {
                        headers.entrySet().removeIf(entry -> entry.getKey().equalsIgnoreCase("Cookie") || entry.getKey().equalsIgnoreCase("Authorization") || entry.getKey().equalsIgnoreCase("Proxy-Authorization"));
                    }
                    if (status == 303 || ((status == 301 || status == 302) && method.equals("POST"))) { method = "GET"; body = null; }
                    connection.disconnect(); uri = next; continue;
                }
                InputStream input = method.equals("HEAD") ? new ByteArrayInputStream(new byte[0]) :
                        status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                if (input == null) input = new ByteArrayInputStream(new byte[0]);
                Map<String, String> responseHeaders = responseHeaders(connection);
                String encoding = connection.getHeaderField("Content-Encoding");
                if ("gzip".equalsIgnoreCase(encoding)) {
                    input = new GZIPInputStream(input);
                    responseHeaders.remove("content-encoding"); responseHeaders.remove("content-length");
                }
                transfer.input = input;
                return new Connection(connection, input, uri, status, responseHeaders, connection.getContentType());
            } catch (Exception error) { connection.disconnect(); throw error; }
        }
        throw new IOException("无法完成请求");
    }
    private static boolean hasHeader(Map<String, String> map, String key) { for (String value : map.keySet()) if (value.equalsIgnoreCase(key)) return true; return false; }
    private static Map<String, String> responseHeaders(HttpURLConnection connection) {
        Map<String, String> values = new LinkedHashMap<>();
        for (Map.Entry<String, List<String>> entry : connection.getHeaderFields().entrySet()) {
            String name = entry.getKey(); if (name == null || name.equalsIgnoreCase("Set-Cookie")) continue;
            values.put(name.toLowerCase(Locale.ROOT), String.join(", ", entry.getValue()));
        }
        return values;
    }
    private static final class Transfer {
        final AtomicBoolean cancelled = new AtomicBoolean(); volatile HttpURLConnection connection; volatile InputStream input;
        final Semaphore acknowledgement = new Semaphore(0); final AtomicBoolean waiting = new AtomicBoolean(); volatile int sequence;
        void expect(int value) { acknowledgement.drainPermits(); sequence = value; waiting.set(true); }
        void ack(int value) { if (value == sequence && waiting.compareAndSet(true, false)) acknowledgement.release(); }
        void cancel() { cancelled.set(true); acknowledgement.release(); closeQuietly(input); if (connection != null) connection.disconnect(); }
    }
    private static final class Connection implements Closeable {
        final HttpURLConnection connection; final InputStream input; final URI uri; final int status;
        final Map<String, String> headers; final String mime;
        Connection(HttpURLConnection connection, InputStream input, URI uri, int status, Map<String, String> headers, String mime) {
            this.connection = connection; this.input = input; this.uri = uri; this.status = status; this.headers = headers;
            this.mime = mime == null ? "application/octet-stream" : mime;
        }
        @Override public void close() { closeQuietly(input); connection.disconnect(); }
    }

    private JSONObject imageInfo(File file) throws Exception {
        BitmapFactory.Options options = new BitmapFactory.Options(); options.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(file.getPath(), options);
        if (options.outWidth <= 0 || options.outHeight <= 0) throw new IOException("无法读取图片");
        return object("width", options.outWidth, "height", options.outHeight);
    }
    private Bitmap bitmap(File file, int width, int height) throws Exception {
        JSONObject info = imageInfo(file); int originalW = info.getInt("width"), originalH = info.getInt("height");
        if (width <= 0) width = originalW; if (height <= 0) height = originalH;
        if ((long) width * height > 16_000_000L) throw new IOException("图片尺寸过大");
        BitmapFactory.Options options = new BitmapFactory.Options(); options.inPreferredConfig = Bitmap.Config.ARGB_8888;
        options.inSampleSize = 1;
        while (originalW / (options.inSampleSize * 2) >= width && originalH / (options.inSampleSize * 2) >= height) options.inSampleSize *= 2;
        Bitmap decoded = BitmapFactory.decodeFile(file.getPath(), options);
        if (decoded == null) throw new IOException("无法解码图片");
        if (decoded.getWidth() == width && decoded.getHeight() == height) return decoded;
        Bitmap scaled = Bitmap.createScaledBitmap(decoded, width, height, true); decoded.recycle(); return scaled;
    }
    private JSONObject pixels(JSONObject p) throws Exception {
        Bitmap bitmap = bitmap(imagePath(p), p.optInt("width"), p.optInt("height"));
        try {
            int width = bitmap.getWidth(), height = bitmap.getHeight();
            if ((long) width * height * 4 > MAX_FILE_MESSAGE) throw new IOException("图片像素过多，请先缩小");
            int[] argb = new int[width * height]; bitmap.getPixels(argb, 0, width, 0, 0, width, height);
            byte[] rgba = new byte[argb.length * 4];
            for (int i = 0, j = 0; i < argb.length; i++) {
                int pixel = argb[i]; rgba[j++] = (byte) (pixel >> 16); rgba[j++] = (byte) (pixel >> 8); rgba[j++] = (byte) pixel; rgba[j++] = (byte) (pixel >>> 24);
            }
            return object("base64", encode(rgba), "width", width, "height", height, "stride", width * 4);
        } finally { bitmap.recycle(); }
    }
    private String pack(JSONObject p) throws Exception {
        int width = p.getInt("width"), height = p.getInt("height");
        if (width <= 0 || height <= 0 || (long) width * height * 4 > MAX_FILE_MESSAGE) throw new IOException("图片尺寸无效");
        byte[] rgba = decode(p.getString("base64"), MAX_FILE_MESSAGE);
        if (rgba.length != width * height * 4) throw new IOException("图片数据长度不匹配");
        int[] argb = new int[width * height];
        for (int i = 0, j = 0; i < argb.length; i++, j += 4)
            argb[i] = ((rgba[j + 3] & 255) << 24) | ((rgba[j] & 255) << 16) | ((rgba[j + 1] & 255) << 8) | (rgba[j + 2] & 255);
        Bitmap bitmap = Bitmap.createBitmap(argb, width, height, Bitmap.Config.ARGB_8888), cropped = bitmap;
        try {
            JSONObject crop = p.optJSONObject("crop");
            if (crop != null) cropped = cropBitmap(bitmap, crop.getInt("x"), crop.getInt("y"), crop.getInt("width"), crop.getInt("height"));
            String format = p.optString("format", "image/png").toLowerCase(Locale.ROOT);
            Bitmap.CompressFormat encoding = format.contains("jpeg") || format.contains("jpg") ? Bitmap.CompressFormat.JPEG :
                    format.contains("webp") ? Bitmap.CompressFormat.WEBP : Bitmap.CompressFormat.PNG;
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            if (!cropped.compress(encoding, Math.min(100, Math.max(0, p.optInt("quality", 90))), output)) throw new IOException("无法编码图片");
            return encode(output.toByteArray());
        } finally { if (cropped != bitmap) cropped.recycle(); bitmap.recycle(); }
    }
    private String crop(JSONObject p) throws Exception {
        Bitmap bitmap = bitmap(imagePath(p), 0, 0), cropped = bitmap;
        File destination = path(p.getString("destination"));
        try {
            cropped = cropBitmap(bitmap, p.getInt("x"), p.getInt("y"), p.getInt("width"), p.getInt("height"));
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            Bitmap.CompressFormat encoding = destination.getName().matches("(?i).+\\.jpe?g$") ? Bitmap.CompressFormat.JPEG : Bitmap.CompressFormat.PNG;
            if (!cropped.compress(encoding, 94, output)) throw new IOException("无法裁切图片"); atomicWrite(destination, output.toByteArray());
            return destination.getPath();
        } finally { if (cropped != bitmap) cropped.recycle(); bitmap.recycle(); }
    }
    private static Bitmap cropBitmap(Bitmap bitmap, int x, int y, int width, int height) throws IOException {
        if (x < 0 || y < 0 || width <= 0 || height <= 0 || (long) x + width > bitmap.getWidth() || (long) y + height > bitmap.getHeight())
            throw new IOException("图片裁切范围无效"); return Bitmap.createBitmap(bitmap, x, y, width, height);
    }
    private void zip(File folder, File destination) throws Exception {
        if (!folder.isDirectory() || NativePolicy.under(destination, folder)) throw new IOException("打包路径无效");
        makeDirectory(destination.getParentFile()); File pending = new File(destination.getParentFile(), token() + ".zip.part");
        try {
            try (ZipOutputStream output = new ZipOutputStream(new BufferedOutputStream(new FileOutputStream(pending)))) {
                zipFolder(folder, folder, output, new int[] {0});
            }
            Files.move(pending.toPath(), destination.toPath(), StandardCopyOption.REPLACE_EXISTING);
        } finally { pending.delete(); }
    }
    private void zipFolder(File root, File folder, ZipOutputStream output, int[] count) throws Exception {
        File[] children = folder.listFiles(); if (children == null) throw new IOException("无法读取笔记目录");
        java.util.Arrays.sort(children, java.util.Comparator.comparing(File::getName));
        for (File child : children) {
            path(child.getPath()); if (Files.isSymbolicLink(child.toPath())) throw new IOException("不支持打包链接文件");
            if (++count[0] > 20000) throw new IOException("打包文件过多");
            String relative = root.toPath().relativize(child.toPath()).toString().replace(File.separatorChar, '/');
            ZipEntry entry = new ZipEntry(relative + (child.isDirectory() ? "/" : "")); entry.setTime(child.lastModified()); output.putNextEntry(entry);
            if (!child.isDirectory()) try (InputStream input = new FileInputStream(child)) {
                byte[] buffer = new byte[CHUNK]; int n; while ((n = input.read(buffer)) != -1) output.write(buffer, 0, n);
            }
            output.closeEntry(); if (child.isDirectory()) zipFolder(root, child, output, count);
        }
    }

    private static final class Resource {
        final File local; final URI remote; final String kind; final String token;
        Resource(File local, URI remote, String kind, String token) { this.local = local; this.remote = remote; this.kind = kind; this.token = token; }
    }
    private String register(File local, URI remote, String kind) throws IOException {
        String identity = (local == null ? remote.toString() : local.getPath()) + "\0" + kind;
        String existing = resourceUrls.get(identity); if (existing != null && resource(existing) != null) return existing;
        if (resources.size() >= 20000) throw new IOException("课程资源过多，请关闭其他课程后再试");
        String token = token(); Resource value = new Resource(local, remote, kind, token);
        resources.put(token, value);
        String name = local == null ? new File(remote.getPath()).getName() : local.getName();
        String url = "https://" + NativePolicy.ASSET_HOST + "/resource/" + token + "/" + Uri.encode(cleanName(name));
        resourceUrls.put(identity, url); return url;
    }
    private Resource resource(String url) {
        try {
            URI uri = new URI(url);
            if (!"https".equals(uri.getScheme()) || !NativePolicy.ASSET_HOST.equals(uri.getHost()) || uri.getRawUserInfo() != null || uri.getPort() != -1)
                return null;
            String[] parts = uri.getPath().split("/"); return parts.length >= 4 && parts[1].equals("resource") ? resources.get(parts[2]) : null;
        } catch (Exception error) { return null; }
    }
    public File resolveResourceLocal(String url) throws IOException {
        Resource value = resource(url); return value == null || value.local == null ? null : path(value.local.getPath());
    }
    public WebResourceResponse intercept(WebResourceRequest request) {
        return intercept(request.getUrl(), request.getMethod(), request.getRequestHeaders());
    }
    public WebResourceResponse intercept(Uri uri) { return intercept(uri, "GET", Collections.emptyMap()); }
    private WebResourceResponse intercept(Uri uri, String method, Map<String, String> requestHeaders) {
        if (!NativePolicy.ASSET_HOST.equals(uri.getHost()) || !uri.getPath().startsWith("/resource/")) return null;
        Resource value = resource(uri.toString());
        if (value == null) return failure(404, "Not Found", "资源已关闭，请重新进入课程");
        if (!method.equals("GET") && !method.equals("HEAD")) return failure(405, "Method Not Allowed", "不支持此资源操作");
        try {
            if (value.local != null) return localResponse(value, method, requestHeaders);
            return remoteResponse(value, method, requestHeaders);
        } catch (Exception error) { return failure(502, "Bad Gateway", safeError(error)); }
    }
    private WebResourceResponse localResponse(Resource value, String method, Map<String, String> supplied) throws Exception {
        File file = path(value.local.getPath()); if (!file.isFile()) return failure(404, "Not Found", "本地资源不存在");
        String range = header(supplied, "Range"); long size = file.length();
        Map<String, String> headers = resourceHeaders(); headers.put("Accept-Ranges", "bytes");
        String mime = mime(file.getName());
        if (mime.contains("mpegurl") && range == null && !method.equals("HEAD")) {
            String manifest = new String(readFile(file, 4 * 1024 * 1024), StandardCharsets.UTF_8);
            byte[] content = rewriteManifest(manifest, value).getBytes(StandardCharsets.UTF_8);
            headers.put("Content-Length", String.valueOf(content.length));
            return response(mime, 200, "OK", headers, new ByteArrayInputStream(content));
        }
        long[] requested;
        try { requested = NativePolicy.range(range, size); }
        catch (IOException error) { headers.put("Content-Range", "bytes */" + size); return response(mime, 416, "Range Not Satisfiable", headers, new ByteArrayInputStream(new byte[0])); }
        long count = size == 0 ? 0 : requested[1] - requested[0] + 1;
        headers.put("Content-Length", Long.toString(count));
        if (range != null) headers.put("Content-Range", "bytes " + requested[0] + "-" + requested[1] + "/" + size);
        InputStream input;
        if (method.equals("HEAD") || size == 0) input = new ByteArrayInputStream(new byte[0]);
        else {
            RandomAccessFile reader = new RandomAccessFile(file, "r"); reader.seek(requested[0]);
            input = new InputStream() {
                long left = count;
                @Override public int read() throws IOException { if (left <= 0) return -1; int n = reader.read(); if (n >= 0) left--; return n; }
                @Override public int read(byte[] b, int off, int len) throws IOException { if (left <= 0) return -1; int n = reader.read(b, off, (int) Math.min(len, left)); if (n > 0) left -= n; return n; }
                @Override public void close() throws IOException { reader.close(); }
            };
        }
        if (range != null && !method.equals("HEAD")) {
            long prefix = range.startsWith("bytes=-") && requested[0] + count > Integer.MAX_VALUE ? 0 : requested[0];
            input = new WebViewRangeInputStream(input, prefix, count);
        }
        return response(mime, range == null ? 200 : 206, range == null ? "OK" : "Partial Content", headers, tracked(input));
    }
    private WebResourceResponse remoteResponse(Resource value, String method, Map<String, String> supplied) throws Exception {
        JSONObject headers = object("Referer", "https://classroom.zju.edu.cn/");
        String range = header(supplied, "Range");
        if (range != null) {
            if (!range.matches("bytes=(?:[0-9]+-[0-9]*|-[0-9]+)")) return failure(416, "Range Not Satisfiable", "资源范围无效");
            headers.put("Range", range);
        }
        String modified = header(supplied, "If-Range"); if (modified != null && !modified.matches("(?s).*[\r\n].*")) headers.put("If-Range", modified);
        Transfer transfer = new Transfer();
        Connection connection = connect(object("url", value.remote.toString(), "method", method, "headers", headers, "timeout", 30000), transfer, true);
        int status = connection.status;
        if (status < 200 || status >= 300) {
            connection.close(); return failure(status >= 400 && status <= 599 ? status : 502, "Resource Error", "平台资源暂时不可用");
        }
        Map<String, String> responseHeaders = resourceHeaders();
        for (String name : new String[] {"Content-Length", "Content-Range", "Accept-Ranges", "ETag", "Last-Modified"}) {
            String valueHeader = header(connection.headers, name); if (valueHeader != null) responseHeaders.put(name, valueHeader);
        }
        String mime = connection.mime.split(";", 2)[0];
        if (mime.equals("application/octet-stream")) mime = mime(value.remote.getPath());
        boolean hls = mime.contains("mpegurl") || value.remote.getPath().toLowerCase(Locale.ROOT).endsWith(".m3u8");
        if (hls && !method.equals("HEAD") && range == null) {
            try {
                String manifest = new String(readAll(connection.input, 4 * 1024 * 1024), StandardCharsets.UTF_8);
                Resource resolvedBase = new Resource(null, connection.uri, value.kind, value.token);
                byte[] content = rewriteManifest(manifest, resolvedBase).getBytes(StandardCharsets.UTF_8);
                responseHeaders.put("Content-Length", String.valueOf(content.length));
                return response("application/vnd.apple.mpegurl", 200, "OK", responseHeaders, new ByteArrayInputStream(content));
            } finally { connection.close(); }
        }
        InputStream stream = new FilterInputStream(connection.input) {
            @Override public void close() { connection.close(); }
        };
        if (status == 206 && !method.equals("HEAD")) {
            String contentRange = header(connection.headers, "Content-Range");
            Matcher bounds = Pattern.compile("bytes ([0-9]+)-([0-9]+)/(?:[0-9]+|\\*)").matcher(contentRange == null ? "" : contentRange);
            if (!bounds.matches()) { connection.close(); throw new IOException("平台视频范围格式无效"); }
            long start = Long.parseLong(bounds.group(1)), end = Long.parseLong(bounds.group(2));
            if (end < start || end - start == Long.MAX_VALUE) { connection.close(); throw new IOException("平台视频范围无效"); }
            long count = end - start + 1;
            long prefix = range != null && range.startsWith("bytes=-") && end >= Integer.MAX_VALUE ? 0 : start;
            stream = new WebViewRangeInputStream(stream, prefix, count);
        }
        return response(mime, status, status == 206 ? "Partial Content" : "OK", responseHeaders, tracked(stream));
    }
    private static final Pattern MANIFEST_URI = Pattern.compile("URI=\"([^\"]+)\"");
    private String rewriteManifest(String source, Resource base) throws Exception {
        if (!source.trim().startsWith("#EXTM3U")) throw new IOException("播放列表格式无效");
        StringBuilder output = new StringBuilder();
        for (String line : source.split("\\r?\\n", -1)) {
            String trim = line.trim();
            if (!trim.isEmpty() && !trim.startsWith("#")) line = resolveSegment(trim, base);
            else if (trim.startsWith("#")) {
                Matcher match = MANIFEST_URI.matcher(line); StringBuffer modified = new StringBuffer();
                while (match.find()) match.appendReplacement(modified, Matcher.quoteReplacement("URI=\"" + resolveSegment(match.group(1), base) + "\""));
                match.appendTail(modified); line = modified.toString();
            }
            output.append(line).append('\n');
        }
        return output.toString();
    }
    private String resolveSegment(String reference, Resource base) throws Exception {
        URI uri = new URI(reference);
        if (uri.isAbsolute()) {
            if (NativePolicy.ASSET_HOST.equals(uri.getHost()) && resource(reference) != null) return reference;
            return register(null, NativePolicy.https(reference, true), "media");
        }
        if (base.local != null) {
            if (reference.indexOf('?') >= 0 || reference.indexOf('#') >= 0) throw new IOException("离线片段地址无效");
            File segment = path(new File(base.local.getParentFile(), Uri.decode(reference)).getPath());
            return register(segment, null, "media");
        }
        return register(null, NativePolicy.https(base.remote.resolve(uri).toString(), true), "media");
    }
    private InputStream tracked(InputStream input) {
        FilterInputStream tracked = new FilterInputStream(input) {
            private boolean released;
            @Override public void close() throws IOException { if (!released) { released = true; resourceStreams.remove(this); super.close(); } }
        };
        resourceStreams.add(tracked); return tracked;
    }
    private void clearResources() {
        for (InputStream input : new ArrayList<>(resourceStreams)) closeQuietly(input);
        resources.clear(); resourceUrls.clear(); sockets.clearTrusted();
    }
    private Map<String, File> nativeCacheFolders() {
        Map<String, File> directories = new LinkedHashMap<>();
        directories.put("native-files", activity.getCacheDir());
        directories.put("compiled-code", activity.getCodeCacheDir());
        File webRoot = new File(activity.getApplicationInfo().dataDir, "app_webview");
        for (String relative : new String[] {"Default/Cache", "Default/Code Cache", "Default/GPUCache", "Default/Service Worker/CacheStorage", "Default/Service Worker/ScriptCache", "GPUCache", "ShaderCache", "DawnCache", "GrShaderCache"})
            directories.put("webview-" + relative.replace('/', '-').replace(' ', '-'), new File(webRoot, relative));
        return directories;
    }
    private JSONArray cacheInfo() throws IOException {
        JSONArray rows = new JSONArray();
        for (Map.Entry<String, File> entry : nativeCacheFolders().entrySet()) {
            String id = entry.getKey(); String label = id.equals("native-files") ? "相机临时文件与系统缓存" : id.equals("compiled-code") ? "应用运行与脚本编译" : "网页与视频运行缓存";
            long bytes = folderSize(entry.getValue(), new int[] {0}, id.equals("native-files") ? cache : null);
            if (bytes > 0 || id.equals("native-files") || id.equals("compiled-code")) rows.put(object("id", id, "label", label, "bytes", bytes));
        }
        return rows;
    }
    private long folderSize(File folder, int[] count, File excluded) throws IOException {
        if (!folder.exists() || Files.isSymbolicLink(folder.toPath())) return 0;
        if (excluded != null && folder.getCanonicalFile().equals(excluded)) return 0;
        if (++count[0] > 250000) throw new IOException("缓存文件较多，请分项查看");
        if (folder.isFile()) return folder.length();
        File[] children = folder.listFiles(); if (children == null) return 0;
        long size = 0; for (File child : children) size += folderSize(child, count, excluded); return size;
    }
    private void clearNativeCache(JSONObject p) throws Exception {
        JSONArray ids = p.optJSONArray("ids"); Set<String> wanted = null;
        if (ids != null) { wanted = new java.util.HashSet<>(); for (int i = 0; i < ids.length(); i++) wanted.add(ids.optString(i)); }
        boolean web = wanted == null;
        for (Map.Entry<String, File> entry : nativeCacheFolders().entrySet()) {
            if (wanted != null && !wanted.contains(entry.getKey())) continue;
            if (entry.getKey().startsWith("webview-")) web = true;
            eraseCacheFolder(entry.getValue(), entry.getKey().equals("native-files") ? cache : null);
        }
        if (web) main.post(() -> webView.clearCache(true));
        makeDirectory(temporary);
        // Session cookies, notes, offline downloads and resource registrations are retained.
    }
    private void eraseCacheFolder(File folder, File excluded) throws IOException {
        if (!folder.exists()) return;
        if (excluded != null && folder.getCanonicalFile().equals(excluded)) return;
        if (Files.isSymbolicLink(folder.toPath())) { Files.deleteIfExists(folder.toPath()); return; }
        String canonical = folder.getCanonicalPath();
        for (Handle handle : handles.values()) if (handle.path.getCanonicalPath().equals(canonical)) return;
        for (File file : protectedFiles) if (file.getCanonicalPath().equals(canonical)) return;
        for (Resource resource : resources.values()) if (resource.local != null && resource.local.getCanonicalPath().equals(canonical)) return;
        if (folder.isDirectory()) {
            File[] children = folder.listFiles(); if (children != null) for (File child : children) eraseCacheFolder(child, excluded);
        } else if (!folder.delete() && folder.exists()) throw new IOException("部分缓存仍在使用，请稍后清理");
    }
    private static Map<String, String> resourceHeaders() {
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Access-Control-Allow-Origin", "https://" + NativePolicy.ASSET_HOST);
        headers.put("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");
        headers.put("Cache-Control", "no-store"); headers.put("X-Content-Type-Options", "nosniff"); return headers;
    }
    private static String header(Map<String, String> headers, String name) {
        for (Map.Entry<String, String> entry : headers.entrySet()) if (entry.getKey().equalsIgnoreCase(name)) return entry.getValue(); return null;
    }
    private static WebResourceResponse response(String mime, int status, String reason, Map<String, String> headers, InputStream input) {
        return new WebResourceResponse(mime, "utf-8", status, reason, headers, input);
    }
    private static WebResourceResponse failure(int status, String reason, String text) {
        return response("text/plain", status, reason, resourceHeaders(), new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8)));
    }
    private static String mime(String name) {
        String extension = name.contains(".") ? name.substring(name.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT) : "";
        switch (extension) {
            case "m3u8": return "application/vnd.apple.mpegurl";
            case "ts": return "video/mp2t";
            case "m4s": case "mp4": return "video/mp4";
            case "aac": return "audio/aac";
            case "vtt": return "text/vtt";
            default: String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension); return mime == null ? "application/octet-stream" : mime;
        }
    }

    /** Copies only an explicitly user-picked provider URI into the application sandbox. */
    public String importFile(Uri uri) throws IOException {
        if (!("content".equals(uri.getScheme()) || "file".equals(uri.getScheme()))) throw new IOException("图片来源无效");
        File directory = new File(files, "imports"); makeDirectory(directory);
        String extension = ".jpg";
        String mime = activity.getContentResolver().getType(uri);
        if (mime != null) { String value = MimeTypeMap.getSingleton().getExtensionFromMimeType(mime); if (value != null && value.matches("[A-Za-z0-9]+")) extension = "." + value; }
        File target = new File(directory, token() + extension);
        try (InputStream input = activity.getContentResolver().openInputStream(uri); OutputStream output = new FileOutputStream(target)) {
            if (input == null) throw new IOException("无法打开所选图片");
            byte[] buffer = new byte[CHUNK]; long bytes = 0; int count;
            while ((count = input.read(buffer)) != -1) { bytes += count; if (bytes > 80L * 1024 * 1024) throw new IOException("图片文件过大"); output.write(buffer, 0, count); }
        } catch (IOException error) { target.delete(); throw error; }
        return target.getPath();
    }
    /** SAF writes happen after the user has selected the destination document. */
    public void exportToUri(String source, Uri uri) throws IOException {
        File file = path(source);
        if (!"content".equals(uri.getScheme())) throw new IOException("导出目标无效");
        try (InputStream input = new FileInputStream(file); OutputStream output = activity.getContentResolver().openOutputStream(uri, "wt")) {
            if (output == null) throw new IOException("无法写入导出目标");
            byte[] buffer = new byte[CHUNK]; int count; while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
        }
    }
    private File clipboardImage(File image) throws Exception {
        // Persistent note/offline files can be shared directly. Session-only slide files
        // need a bounded snapshot so closing a lesson does not erase pasted images.
        if (!NativePolicy.under(image, cache)) return image;
        File folder = new File(cache, "clipboard-images"); makeDirectory(folder);
        byte[] hash = MessageDigest.getInstance("SHA-256").digest((image.getPath() + "\0" + image.length() + "\0" + image.lastModified()).getBytes(StandardCharsets.UTF_8));
        String name = Base64.encodeToString(hash, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
        File copy = new File(folder, name + ".img");
        if (!copy.isFile()) Files.copy(image.toPath(), copy.toPath(), StandardCopyOption.REPLACE_EXISTING);
        copy.setLastModified(System.currentTimeMillis()); return copy;
    }
    private void pruneClipboard(Set<File> retained) {
        File[] copies = new File(cache, "clipboard-images").listFiles(); if (copies == null) return;
        java.util.Arrays.sort(copies, java.util.Comparator.comparingLong(File::lastModified));
        long bytes = 0; for (File copy : copies) bytes += copy.length();
        for (File copy : copies) {
            if (bytes <= 256L * 1024 * 1024) break;
            if (!retained.contains(copy)) { long size = copy.length(); if (copy.delete()) bytes -= size; }
        }
    }
    private void respond(String id, Object value, String error) { main.post(() -> { if (!closed.get()) host.respond(id, value, error); }); }
    private void emit(String name, Object value) { main.post(() -> { if (!closed.get()) host.event(name, value); }); }
    private void emitBlocking(String name, Object value, Transfer transfer) throws Exception {
        CountDownLatch delivered = new CountDownLatch(1);
        main.post(() -> { try { if (!closed.get() && !transfer.cancelled.get()) host.event(name, value); } finally { delivered.countDown(); } });
        if (!delivered.await(15, TimeUnit.SECONDS)) throw new IOException("应用暂时无法接收数据");
    }
    @Override public void close() {
        if (!closed.compareAndSet(false, true)) return;
        for (Transfer transfer : transfers.values()) transfer.cancel(); transfers.clear(); queuedCancellations.clear(); sockets.closeAll(); clearResources();
        for (Handle handle : handles.values()) closeQuietly(handle.file); handles.clear();
        workers.shutdownNow(); streamWorkers.shutdownNow(); imageWorkers.shutdownNow(); clipboardWorkers.shutdownNow();
    }
    private String token() { byte[] value = new byte[24]; random.nextBytes(value); return Base64.encodeToString(value, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING); }
    private static String cleanName(String name) {
        String clean = name.replaceAll("[\\\\/\\x00-\\x1f]", "_").trim();
        if (clean.isEmpty() || clean.equals(".") || clean.equals("..")) clean = "导出文件";
        return clean.length() > 160 ? clean.substring(0, 160) : clean;
    }
    private static String encode(byte[] bytes) { return Base64.encodeToString(bytes, Base64.NO_WRAP); }
    private static byte[] decode(String value, int limit) throws IOException {
        if (value.length() > ((long) limit + 2) / 3 * 4 + 4) throw new IOException("数据过大");
        try { byte[] bytes = Base64.decode(value, Base64.DEFAULT); if (bytes.length > limit) throw new IOException("数据过大"); return bytes; }
        catch (IllegalArgumentException error) { throw new IOException("编码数据无效"); }
    }
    private static JSONObject object(Object... values) {
        JSONObject object = new JSONObject();
        try { for (int i = 0; i + 1 < values.length; i += 2) object.put(String.valueOf(values[i]), values[i + 1] == null ? JSONObject.NULL : values[i + 1]); }
        catch (Exception ignored) { throw new IllegalArgumentException("Invalid internal JSON"); } return object;
    }
    private static void closeQuietly(Closeable value) { if (value != null) try { value.close(); } catch (IOException ignored) {} }
    private static String safeError(Throwable error) {
        Throwable cause = error; while (cause.getCause() != null && cause.getCause() != cause) cause = cause.getCause();
        if (cause instanceof javax.net.ssl.SSLException) return "安全连接失败，请检查网络与系统时间";
        if (cause instanceof java.net.SocketTimeoutException || cause instanceof java.util.concurrent.TimeoutException) return "连接超时，请稍后重试";
        if (cause instanceof java.net.UnknownHostException) return "当前无法连接网络，可继续使用已下载课程";
        if (cause instanceof java.util.concurrent.RejectedExecutionException) return "后台任务较多，请稍后重试";
        if (cause instanceof IOException) {
            String message = cause.getMessage();
            // Network libraries include signed URLs, hosts and filesystem paths in errors. Never reflect them.
            if (message != null && message.matches("^[\\p{IsHan}，。、：；（）0-9A-Za-z ]{1,120}$")) return message;
        }
        return "操作未完成，请稍后重试";
    }
}
