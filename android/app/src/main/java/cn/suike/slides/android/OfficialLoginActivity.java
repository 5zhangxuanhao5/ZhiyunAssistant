package cn.suike.slides.android;

import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Credentials are entered on the real Zhejiang University page; there is never a JS interface here. */
public final class OfficialLoginActivity extends ComponentActivity {
    private WebView login;
    private final ExecutorService verifier = Executors.newSingleThreadExecutor();
    private volatile boolean checking, closed;
    private long lastCheck;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private boolean visible;
    private final Runnable loginProbe = new Runnable() { @Override public void run() {
        if (!visible || closed) return;
        if (login != null && "classroom.zju.edu.cn".equals(Uri.parse(login.getUrl() == null ? "" : login.getUrl()).getHost())) verifySession();
        ui.postDelayed(this,1500);
    }};
    private static final String CLASSROOM = "https://classroom.zju.edu.cn";
    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        if (Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
        LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setBackgroundColor(Color.rgb(243,246,250));
        Button back = new Button(this); back.setText("返回智云助手"); back.setAllCaps(false); back.setOnClickListener(v -> finish());
        root.addView(back,new LinearLayout.LayoutParams(-1,(int)(48*getResources().getDisplayMetrics().density)));
        login = new WebView(this);
        WebSettings settings = login.getSettings(); settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(false); settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false); settings.setJavaScriptCanOpenWindowsAutomatically(false); settings.setSaveFormData(false);
        settings.setTextZoom(100); settings.setBuiltInZoomControls(false); settings.setMediaPlaybackRequiresUserGesture(true);
        CookieManager.getInstance().setAcceptCookie(true); CookieManager.getInstance().setAcceptThirdPartyCookies(login,false);
        login.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request) {
                Uri uri = request.getUrl(); String host = uri.getHost();
                return !("https".equals(uri.getScheme()) && host != null && (host.equals("zju.edu.cn") || host.endsWith(".zju.edu.cn")));
            }
            @Override public void onPageFinished(WebView view,String url) {
                Uri uri = Uri.parse(url);
                // Navigating to a login page is not proof of an authenticated classroom session.
                if ("classroom.zju.edu.cn".equals(uri.getHost())) verifySession();
            }
        });
        root.addView(login,new LinearLayout.LayoutParams(-1,0,1)); setContentView(root);
        root.setOnApplyWindowInsetsListener((v,insets) -> {
            if (Build.VERSION.SDK_INT >= 30) { android.graphics.Insets safe = insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout()|WindowInsets.Type.ime()); v.setPadding(safe.left,safe.top,safe.right,safe.bottom); }
            else v.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());
            return insets;
        });
        getOnBackPressedDispatcher().addCallback(this,new OnBackPressedCallback(true) { @Override public void handleOnBackPressed() { if (login.canGoBack()) login.goBack(); else finish(); } });
        login.loadUrl(CLASSROOM+"/");
    }
    private void verifySession() {
        if (closed || checking || System.currentTimeMillis()-lastCheck < 700) return;
        String cookie = CookieManager.getInstance().getCookie(CLASSROOM);
        if (cookie == null || cookie.isEmpty()) return;
        checking = true; lastCheck = System.currentTimeMillis();
        verifier.execute(() -> {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection)new URL(CLASSROOM+"/userapi/v1/infosimple").openConnection();
                connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(12000); connection.setReadTimeout(12000);
                connection.setRequestProperty("Cookie",cookie); connection.setRequestProperty("Accept","application/json"); connection.setRequestProperty("Referer",CLASSROOM+"/");
                Matcher tokenCookie = Pattern.compile("(?:^|;\\s*)_token=([^;]*)").matcher(cookie);
                if (tokenCookie.find()) { String decoded = URLDecoder.decode(tokenCookie.group(1),StandardCharsets.UTF_8.name()); Matcher token = Pattern.compile("\\{i:\\d+;s:\\d+:\"_token\";i:\\d+;s:\\d+:\"(.+?)\";\\}").matcher(decoded); if (token.find()) connection.setRequestProperty("Authorization","Bearer "+token.group(1)); }
                if (connection.getResponseCode() != 200) return;
                ByteArrayOutputStream data = new ByteArrayOutputStream();
                try (InputStream stream = connection.getInputStream()) { byte[] buffer = new byte[4096]; int n; while ((n=stream.read(buffer)) != -1) { if (data.size()+n > 512*1024) return; data.write(buffer,0,n); } }
                JSONObject value = new JSONObject(data.toString(StandardCharsets.UTF_8.name())).optJSONObject("params");
                if (value == null || value.optString("id","").isEmpty() || "0".equals(value.optString("id"))) return;
                runOnUiThread(() -> { if (!closed) { CookieManager.getInstance().flush(); setResult(RESULT_OK); finish(); } });
            } catch (Exception ignored) { /* A failed probe never discards a saved session or credentials. */ }
            finally { checking = false; if (connection != null) connection.disconnect(); }
        });
    }
    @Override protected void onResume() { super.onResume(); visible = true; ui.postDelayed(loginProbe,750); }
    @Override protected void onPause() { visible = false; ui.removeCallbacks(loginProbe); CookieManager.getInstance().flush(); super.onPause(); }
    @Override protected void onDestroy() { closed = true; ui.removeCallbacks(loginProbe); verifier.shutdownNow(); if (login != null) { login.stopLoading(); login.destroy(); } super.onDestroy(); }
}
