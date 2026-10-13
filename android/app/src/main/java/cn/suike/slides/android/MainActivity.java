package cn.suike.slides.android;

import android.Manifest;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Point;
import android.graphics.Rect;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.view.View;
import android.view.OrientationEventListener;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.FileProvider;
import androidx.core.content.ContextCompat;
import androidx.core.util.Consumer;
import androidx.window.java.layout.WindowInfoTrackerCallbackAdapter;
import androidx.window.layout.DisplayFeature;
import androidx.window.layout.FoldingFeature;
import androidx.window.layout.WindowInfoTracker;
import androidx.window.layout.WindowLayoutInfo;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.IOException;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.CompletableFuture;

/** Local-only application surface. Remote authentication uses a separate, bridge-free Activity. */
public final class MainActivity extends ComponentActivity implements NativeIO.Host {
    public static final String ORIGIN = "https://appassets.androidplatform.net";
    private FrameLayout root;
    private WebView web;
    private NativeIO io;
    private boolean ready, destroying, nativeFullscreen, downloadsActive, visible;
    private View customVideo;
    private WebChromeClient.CustomViewCallback customVideoCallback;
    private WindowInfoTrackerCallbackAdapter tracker;
    private WindowLayoutInfo layout;
    private final Consumer<WindowLayoutInfo> layoutListener = info -> { layout = info; emitViewport(); };
    private ActivityResultLauncher<Intent> loginLauncher, imageLauncher, cameraLauncher, exportLauncher;
    private CompletableFuture<Void> loginPending;
    private CompletableFuture<String> imagePending, exportPending;
    private Uri cameraUri;
    private File cameraFile;
    private String exportPath;
    private OrientationEventListener rotation;
    private boolean landscapeObserved;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        if (!supportedWebView()) return;
        if (Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
        else getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        loginLauncher = registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
            if (loginPending != null) { CompletableFuture<Void> value = loginPending; loginPending = null;
                if (result.getResultCode() == RESULT_OK) value.complete(null); else value.completeExceptionally(new IOException("已取消登录")); }
        });
        imageLauncher = registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
            if (imagePending == null) return;
            if (result.getResultCode() != RESULT_OK || result.getData() == null || result.getData().getData() == null) finishImage(null, null);
            else importImage(result.getData().getData());
        });
        cameraLauncher = registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
            if (imagePending == null) return;
            if (result.getResultCode() == RESULT_OK && cameraFile != null && cameraFile.length() > 0) importImage(cameraUri);
            else finishImage(null, null);
        });
        exportLauncher = registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
            CompletableFuture<String> pending = exportPending; String source = exportPath;
            exportPending = null; exportPath = null;
            if (pending == null) return;
            if (result.getResultCode() != RESULT_OK || result.getData() == null || result.getData().getData() == null) { pending.completeExceptionally(new IOException("已取消保存")); return; }
            Uri uri = result.getData().getData();
            CompletableFuture.runAsync(() -> { try { io.exportToUri(source, uri); pending.complete(uri.toString()); } catch (Exception error) { pending.completeExceptionally(error); } });
        });
        root = new FrameLayout(this); root.setBackgroundColor(Color.rgb(243,246,250));
        web = createLocalWebView();
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        io = createIO();
        if (io == null) return;
        web.addJavascriptInterface(new Bridge(), "NativeBridge");
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            int left, top, right, bottom;
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets safe = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                left = safe.left; top = safe.top; right = safe.right; bottom = safe.bottom;
            } else { left = insets.getSystemWindowInsetLeft(); top = insets.getSystemWindowInsetTop(); right = insets.getSystemWindowInsetRight(); bottom = insets.getSystemWindowInsetBottom(); }
            root.setPadding(nativeFullscreen ? 0 : left, nativeFullscreen ? 0 : top, nativeFullscreen ? 0 : right, nativeFullscreen ? 0 : bottom);
            web.post(this::emitViewport); return insets;
        });
        tracker = new WindowInfoTrackerCallbackAdapter(WindowInfoTracker.getOrCreate(this));
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                if (customVideo != null) { exitCustomVideo(); return; }
                if (nativeFullscreen) { fullscreen(false); event("app.fullscreen", json("enabled", false)); return; }
                if (!ready) { finish(); return; }
                event("app.back", new JSONObject());
            }
        });
        web.loadUrl(ORIGIN + "/assets/index.html");
        rotation = new OrientationEventListener(this) { @Override public void onOrientationChanged(int angle) {
            if (!nativeFullscreen || getResources().getConfiguration().smallestScreenWidthDp >= 600 || angle == ORIENTATION_UNKNOWN) return;
            if ((angle > 60 && angle < 120) || (angle > 240 && angle < 300)) landscapeObserved = true;
            if (landscapeObserved && (angle < 25 || angle > 335 || (angle > 155 && angle < 205))) { fullscreen(false); event("app.fullscreen",json("enabled",false)); }
        }};
    }

    private boolean supportedWebView() {
        String version = "未安装";
        try {
            android.content.pm.PackageInfo provider = WebView.getCurrentWebViewPackage();
            if (provider != null && provider.versionName != null) { version = provider.versionName; if (Integer.parseInt(version.split("\\.")[0]) >= 100) return true; }
        } catch (RuntimeException ignored) { }
        root = new FrameLayout(this); root.setBackgroundColor(Color.rgb(243,246,250));
        android.widget.LinearLayout content = new android.widget.LinearLayout(this); content.setOrientation(android.widget.LinearLayout.VERTICAL);
        int padding = (int)(24*getResources().getDisplayMetrics().density); content.setPadding(padding,padding,padding,padding);
        android.widget.TextView title = new android.widget.TextView(this); title.setText("请更新系统网页组件"); title.setTextSize(22); title.setTextColor(Color.rgb(35,55,70));
        android.widget.TextView message = new android.widget.TextView(this); message.setText("智云助手需要 Android System WebView 100 或更高版本，当前版本："+version+"。\n\n请在系统应用商店更新系统网页组件，或更新系统后重新打开。更新前不会加载课程页面。"); message.setTextSize(16); message.setTextColor(Color.rgb(63,81,97)); message.setPadding(0,padding,0,padding);
        android.widget.Button back = new android.widget.Button(this); back.setText("返回"); back.setOnClickListener(view -> finish());
        content.addView(title); content.addView(message); content.addView(back); root.addView(content,new FrameLayout.LayoutParams(-1,-2));
        setContentView(root);
        root.setOnApplyWindowInsetsListener((view,insets) -> { if (Build.VERSION.SDK_INT >= 30) { android.graphics.Insets safe = insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout()); view.setPadding(safe.left,safe.top,safe.right,safe.bottom); } else view.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom()); return insets; });
        return false;
    }

    private WebView createLocalWebView() {
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        WebView view = new WebView(this);
        view.addOnLayoutChangeListener((v,l,t,r,b,ol,ot,or,ob) -> emitViewport());
        view.setBackgroundColor(Color.rgb(243,246,250));
        view.setOverScrollMode(View.OVER_SCROLL_NEVER);
        view.setFocusable(true); view.setFocusableInTouchMode(true);
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false); settings.setSupportMultipleWindows(false);
        settings.setMediaPlaybackRequiresUserGesture(true); settings.setBuiltInZoomControls(false);
        settings.setTextZoom(100); settings.setSaveFormData(false);
        settings.setSafeBrowsingEnabled(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(view, false);
        view.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
                // Never navigate privileged code to a user-supplied local export or remote resource.
                Uri uri = request.getUrl();
                return !isAssets(uri) || !"/assets/index.html".equals(uri.getPath());
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!isAssets(uri)) return denied();
                if (uri.getPath() != null && uri.getPath().startsWith("/resource/")) return io == null ? denied() : io.intercept(request);
                String path = uri.getPath();
                if (path == null || !path.startsWith("/assets/")) return denied();
                try {
                    String name = path.substring(8);
                    if (name.isEmpty() || name.contains("..") || name.contains("\\") || name.indexOf('\0') >= 0) return denied();
                    String type = name.endsWith(".html") ? "text/html" : name.endsWith(".js") ? "application/javascript" : name.endsWith(".css") ? "text/css" : name.endsWith(".png") ? "image/png" : name.endsWith(".svg") ? "image/svg+xml" : name.endsWith(".json") ? "application/json" : "application/octet-stream";
                    Map<String,String> headers = new HashMap<>();
                    headers.put("X-Content-Type-Options", "nosniff");
                    headers.put("Cache-Control", "no-cache");
                    headers.put("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' wss://*.zju.edu.cn wss://*.chinamcloud.com wss://*.chinamcloud.cn; worker-src 'self' blob:; object-src 'none'; frame-src 'none'; base-uri 'none'");
                    return new WebResourceResponse(type, "UTF-8", 200, "OK", headers, getAssets().open(name));
                } catch (IOException error) { return new WebResourceResponse("text/plain","UTF-8",404,"Not Found",Collections.emptyMap(),new ByteArrayInputStream(new byte[0])); }
            }
            @Override public void onPageFinished(WebView v, String url) { Uri uri = Uri.parse(url); if (isAssets(uri) && "/assets/index.html".equals(uri.getPath())) { ready = true; emitViewport(); event("app.lifecycle",json("active",visible)); } }
            @Override public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail detail) {
                if (destroying) return true;
                // A renderer crash is recoverable; persisted notes/session are untouched.
                ready = false; stopDownloadsService();
                if (customVideo != null) exitCustomVideo(); else if (nativeFullscreen) fullscreen(false);
                if (io != null) io.close(); root.removeView(v); v.destroy();
                web = createLocalWebView(); root.addView(web,0,new FrameLayout.LayoutParams(-1,-1));
                io = createIO(); if (io == null) return true; web.addJavascriptInterface(new Bridge(),"NativeBridge");
                web.loadUrl(ORIGIN+"/assets/index.html"); Toast.makeText(MainActivity.this,"页面已重新打开，本机保存内容仍保留",Toast.LENGTH_LONG).show(); return true;
            }
        });
        view.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) { request.deny(); }
            @Override public void onShowCustomView(View video, CustomViewCallback callback) {
                if (customVideo != null) { callback.onCustomViewHidden(); return; }
                customVideo = video; customVideoCallback = callback; web.setVisibility(View.GONE);
                root.addView(video,new FrameLayout.LayoutParams(-1,-1)); fullscreen(true);
            }
            @Override public void onHideCustomView() { exitCustomVideo(); }
        });
        view.setDownloadListener((url,agent,disposition,mime,length) -> Toast.makeText(this,"请使用课程下载或导出按钮保存",Toast.LENGTH_SHORT).show());
        return view;
    }
    private static boolean isAssets(Uri uri) { return "https".equals(uri.getScheme()) && "appassets.androidplatform.net".equals(uri.getHost()) && (uri.getPort() == -1 || uri.getPort() == 443); }
    private NativeIO createIO() { try { return new NativeIO(this,web,this); } catch (IOException error) { root.removeAllViews(); android.widget.TextView message = new android.widget.TextView(this); message.setText("本机存储暂时不可用，请检查剩余空间后重新打开智云助手。"); message.setPadding(32,32,32,32); root.addView(message); return null; } }
    private static WebResourceResponse denied() { return new WebResourceResponse("text/plain","UTF-8",403,"Forbidden",Collections.emptyMap(),new ByteArrayInputStream(new byte[0])); }
    private JSONObject json(String key, Object value) { JSONObject obj = new JSONObject(); try { obj.put(key,value); } catch (Exception ignored) {} return obj; }

    private final class Bridge {
        @JavascriptInterface public String sync(String method, String payload) { return io == null ? "{\"error\":\"本机存储不可用\"}" : io.sync(method,payload); }
        @JavascriptInterface public void post(String id, String method, String payload) {
            try {
                JSONObject args = new JSONObject(payload);
                if ("app.downloads".equals(method)) {
                    runOnUiThread(() -> { try {
                        boolean wasActive = downloadsActive; downloadsActive = args.optBoolean("active");
                        if (downloadsActive) {
                            if (Build.VERSION.SDK_INT >= 33 && hasWindowFocus() && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED && !getPreferences(MODE_PRIVATE).getBoolean("notification-requested",false)) {
                                getPreferences(MODE_PRIVATE).edit().putBoolean("notification-requested",true).apply();
                                requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},42);
                            }
                            Intent service = new Intent(MainActivity.this,DownloadService.class).putExtra("count",args.optInt("count",1));
                            if (wasActive) startService(service); else startForegroundService(service);
                        } else stopService(new Intent(MainActivity.this,DownloadService.class));
                        respond(id,null,null);
                    } catch (Exception error) { downloadsActive = false; respond(id,null,"系统暂时不允许后台下载，请保持应用打开后继续"); } }); return;
                }
                if ("app.drag".equals(method)) { CompletableFuture.runAsync(() -> { try {
                    File file = new File(args.getString("path")).getCanonicalFile(), workspace = new File(getFilesDir(),"workspace").getCanonicalFile(), temporary = new File(getCacheDir(),"workspace").getCanonicalFile();
                    if (!(file.toPath().startsWith(workspace.toPath()) || file.toPath().startsWith(temporary.toPath())) || !file.isFile()) throw new IOException("图片不可用");
                    Uri uri = FileProvider.getUriForFile(MainActivity.this,getPackageName()+".files",file);
                    BitmapFactory.Options bounds = new BitmapFactory.Options(); bounds.inJustDecodeBounds = true; BitmapFactory.decodeFile(file.getPath(),bounds);
                    BitmapFactory.Options options = new BitmapFactory.Options(); options.inSampleSize = 1;
                    while (Math.max(bounds.outWidth,bounds.outHeight)/options.inSampleSize > 640) options.inSampleSize *= 2;
                    Bitmap preview = BitmapFactory.decodeFile(file.getPath(),options);
                    if (preview == null) throw new IOException("图片不可用");
                    ClipData clip = ClipData.newUri(getContentResolver(),"课程图片",uri);
                    runOnUiThread(() -> { try { if (destroying || !web.isAttachedToWindow()) { respond(id,false,null); return; } respond(id,web.startDragAndDrop(clip,new View.DragShadowBuilder() {
                        @Override public void onProvideShadowMetrics(Point size,Point touch) { size.set(preview.getWidth(),preview.getHeight()); touch.set(preview.getWidth()/2,preview.getHeight()/2); }
                        @Override public void onDrawShadow(Canvas canvas) { canvas.drawBitmap(preview,0,0,null); }
                    },null,View.DRAG_FLAG_GLOBAL | View.DRAG_FLAG_GLOBAL_URI_READ),null); } catch (Exception error) { respond(id,false,null); } });
                } catch (Exception error) { respond(id,null,error.getMessage()); } }); return; }
                if ("app.exit".equals(method) || "app.finish".equals(method)) { runOnUiThread(() -> { respond(id,null,null); moveTaskToBack(true); }); return; }
                io.post(id,method,payload);
            } catch (Exception error) { respond(id,null,"请求格式不正确"); }
        }
    }
    @Override public void respond(String id,Object value,String error) {
        JSONObject obj = new JSONObject(); try { obj.put("id",id); obj.put("value",value == null ? JSONObject.NULL : value); if (error != null) obj.put("error",error); } catch (Exception ignored) {}
        dispatch("window.__androidReceive",obj);
    }
    @Override public void event(String name,Object value) { JSONObject obj = json("name",name); try { obj.put("value",value == null ? JSONObject.NULL : value); } catch (Exception ignored) {} dispatch("window.__androidEvent",obj); }
    private void dispatch(String receiver,JSONObject obj) { runOnUiThread(() -> { if (!destroying && web != null) web.evaluateJavascript(receiver+"&&"+receiver+"("+obj.toString()+")",null); }); }

    private void emitViewport() {
        if (!ready || web == null || web.getWidth() == 0) return;
        float density = getResources().getDisplayMetrics().density;
        int[] origin = new int[2]; web.getLocationInWindow(origin);
        JSONArray folds = new JSONArray(); String posture = "flat";
        if (layout != null) for (DisplayFeature feature : layout.getDisplayFeatures()) if (feature instanceof FoldingFeature) {
            FoldingFeature fold = (FoldingFeature)feature; Rect r = fold.getBounds();
            JSONObject row = new JSONObject();
            try { row.put("left",(r.left-origin[0])/density); row.put("top",(r.top-origin[1])/density); row.put("right",(r.right-origin[0])/density); row.put("bottom",(r.bottom-origin[1])/density);
                row.put("separating",fold.isSeparating()); row.put("orientation",fold.getOrientation() == FoldingFeature.Orientation.VERTICAL ? "vertical" : "horizontal");
                row.put("state",fold.getState() == FoldingFeature.State.HALF_OPENED ? "half-opened" : "flat"); folds.put(row);
                if (fold.getState() == FoldingFeature.State.HALF_OPENED) posture = fold.getOrientation() == FoldingFeature.Orientation.HORIZONTAL ? "tabletop" : "book";
            } catch (Exception ignored) {}
        }
        JSONObject info = new JSONObject(); try { info.put("width",web.getWidth()/density); info.put("height",web.getHeight()/density); info.put("insets",new JSONObject("{\"top\":0,\"right\":0,\"bottom\":0,\"left\":0}")); info.put("folds",folds); info.put("posture",posture); info.put("density",density); info.put("screen",getResources().getConfiguration().smallestScreenWidthDp < 600 ? "compact" : "expanded"); info.put("orientation",getResources().getConfiguration().orientation == Configuration.ORIENTATION_LANDSCAPE ? "landscape" : "portrait"); } catch (Exception ignored) {}
        event("app.viewport",info);
    }
    @Override public void onConfigurationChanged(Configuration config) { super.onConfigurationChanged(config); if (web != null) web.post(this::emitViewport); }
    @Override protected void onStart() { super.onStart(); visible = true; event("app.lifecycle",json("active",true)); if (tracker != null) tracker.addWindowLayoutInfoListener(this,ContextCompat.getMainExecutor(this),layoutListener); }
    @Override protected void onStop() { visible = false; event("app.lifecycle",json("active",false)); if (tracker != null) tracker.removeWindowLayoutInfoListener(layoutListener); super.onStop(); }
    @Override protected void onResume() { super.onResume(); event("app.lifecycle",json("active",true)); if (web != null) web.onResume(); if (nativeFullscreen && rotation != null && rotation.canDetectOrientation()) rotation.enable(); }
    @Override protected void onPause() { if (rotation != null) rotation.disable(); if (web != null) CookieManager.getInstance().flush(); /* A paused activity may still be visible in Android split screen; stop refresh only in onStop. */ super.onPause(); }
    private void stopDownloadsService() { downloadsActive = false; stopService(new Intent(this,DownloadService.class)); }
    @Override protected void onDestroy() {
        destroying = true; ready = false; stopDownloadsService();
        if (rotation != null) rotation.disable();
        if (customVideo != null) exitCustomVideo(); else if (nativeFullscreen) fullscreen(false);
        failPending();
        if (io != null) io.close();
        if (web != null) { web.removeJavascriptInterface("NativeBridge"); web.destroy(); }
        super.onDestroy();
    }
    private void failPending() { IOException error = new IOException("页面已关闭"); if (loginPending != null) { loginPending.completeExceptionally(error); loginPending = null; } finishImage(null,error); if (exportPending != null) { exportPending.completeExceptionally(error); exportPending = null; exportPath = null; } }

    @Override public CompletableFuture<Void> login() {
        CompletableFuture<Void> result = new CompletableFuture<>(); runOnUiThread(() -> {
            if (loginPending != null) { loginPending.whenComplete((value,error) -> { if (error == null) result.complete(null); else result.completeExceptionally(error); }); return; }
            loginPending = result; loginLauncher.launch(new Intent(this,OfficialLoginActivity.class));
        }); return result;
    }
    @Override public CompletableFuture<String> pickImage() {
        return pickImage("");
    }
    public CompletableFuture<String> pickImage(String source) {
        CompletableFuture<String> result = new CompletableFuture<>(); runOnUiThread(() -> {
            if (imagePending != null) { result.completeExceptionally(new IOException("请先完成当前图片选择")); return; }
            imagePending = result;
            if (source.equals("camera")) launchImageSource(1);
            else if (source.equals("photos") || source.equals("gallery")) launchImageSource(0);
            else new AlertDialog.Builder(this).setTitle("图片").setItems(new String[]{"选择照片","拍照"},(dialog,index) -> launchImageSource(index)).setOnCancelListener(dialog -> finishImage(null,null)).show();
        }); return result;
    }
    private void launchImageSource(int index) {
        if (index == 0) { try { Intent intent = Build.VERSION.SDK_INT >= 33 ? new Intent(MediaStore.ACTION_PICK_IMAGES).setType("image/*") : new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("image/*"); imageLauncher.launch(intent); } catch (Exception error) { finishImage(null,error); } }
        else { try { File folder = new File(getCacheDir(),"camera"); folder.mkdirs(); cameraFile = File.createTempFile("image-",".jpg",folder); cameraUri = FileProvider.getUriForFile(this,getPackageName()+".files",cameraFile);
            Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE).putExtra(MediaStore.EXTRA_OUTPUT,cameraUri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            intent.setClipData(ClipData.newRawUri("照片",cameraUri)); cameraLauncher.launch(intent);
        } catch (Exception error) { finishImage(null,error); } }
    }
    private void importImage(Uri uri) { CompletableFuture.runAsync(() -> { try { String path = io.importFile(uri); runOnUiThread(() -> { if (destroying) new File(path).delete(); else finishImage(path,null); }); } catch (Exception error) { runOnUiThread(() -> finishImage(null,error)); } }); }
    private void finishImage(String path,Exception error) { if (imagePending != null) { if (error == null) imagePending.complete(path); else imagePending.completeExceptionally(error); imagePending = null; } if (cameraFile != null) { cameraFile.delete(); cameraFile = null; cameraUri = null; } }
    @Override public CompletableFuture<String> exportFile(String path,String name) {
        CompletableFuture<String> result = new CompletableFuture<>(); runOnUiThread(() -> {
            if (exportPending != null) { result.completeExceptionally(new IOException("请先完成当前保存")); return; }
            exportPending = result; exportPath = path;
            String mime = name.endsWith(".zip") ? "application/zip" : name.endsWith(".pdf") ? "application/pdf" : name.endsWith(".html") ? "text/html" : name.endsWith(".md") ? "text/markdown" : name.endsWith(".png") ? "image/png" : "application/octet-stream";
            try { exportLauncher.launch(new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(mime).putExtra(Intent.EXTRA_TITLE,name)); } catch (Exception error) { exportPending = null; exportPath = null; result.completeExceptionally(error); }
        }); return result;
    }
    @Override public void openExternal(String url) { runOnUiThread(() -> { Uri uri = Uri.parse(url); if (!"https".equals(uri.getScheme())) return; try { startActivity(new Intent(Intent.ACTION_VIEW,uri)); } catch (Exception error) { Toast.makeText(this,"没有可打开此链接的应用",Toast.LENGTH_SHORT).show(); } }); }
    @Override public void fullscreen(boolean enabled) { runOnUiThread(() -> {
        nativeFullscreen = enabled;
        if (rotation != null) { if (enabled && rotation.canDetectOrientation()) rotation.enable(); else rotation.disable(); }
        if (enabled) landscapeObserved = getResources().getConfiguration().orientation == Configuration.ORIENTATION_LANDSCAPE;
        if (Build.VERSION.SDK_INT >= 30) { if (enabled) { getWindow().getInsetsController().hide(WindowInsets.Type.systemBars()); getWindow().getInsetsController().setSystemBarsBehavior(android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE); } else getWindow().getInsetsController().show(WindowInsets.Type.systemBars()); }
        else getWindow().getDecorView().setSystemUiVisibility(enabled ? View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION : View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        if (enabled) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (getResources().getConfiguration().smallestScreenWidthDp < 600) setRequestedOrientation(enabled ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE : ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
        root.requestApplyInsets(); emitViewport();
    }); }
    private void exitCustomVideo() { if (customVideo == null) return; root.removeView(customVideo); customVideo = null; web.setVisibility(View.VISIBLE); WebChromeClient.CustomViewCallback callback = customVideoCallback; customVideoCallback = null; if (callback != null) callback.onCustomViewHidden(); fullscreen(false); }
}
