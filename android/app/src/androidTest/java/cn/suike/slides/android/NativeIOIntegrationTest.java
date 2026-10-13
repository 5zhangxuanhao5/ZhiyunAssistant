package cn.suike.slides.android;

import android.net.Uri;
import android.util.Base64;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.JavascriptInterface;
import androidx.core.content.FileProvider;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Collections;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.Assert.*;

/** Uses throwaway paths only; it never reads, clears, or exports the user's course data. */
@RunWith(AndroidJUnit4.class)
public class NativeIOIntegrationTest {
    private static final class TestHost implements NativeIO.Host {
        MainActivity activity; WebView view;
        final Map<String, CompletableFuture<Object>> responses = new ConcurrentHashMap<>();
        @Override public void respond(String id, Object value, String error) {
            CompletableFuture<Object> result = responses.remove(id); if (result == null) return;
            if (error == null) result.complete(value); else result.completeExceptionally(new IllegalStateException(error));
        }
        @Override public void event(String name, Object value) {}
        @Override public CompletableFuture<String> pickImage() { return CompletableFuture.completedFuture(null); }
        @Override public CompletableFuture<String> exportFile(String path, String name) { return CompletableFuture.completedFuture(null); }
        @Override public CompletableFuture<Void> login() { return CompletableFuture.completedFuture(null); }
        @Override public void fullscreen(boolean enabled) {}
        @Override public void openExternal(String url) {}
        Object call(NativeIO io, String method, JSONObject payload) throws Exception {
            String id = UUID.randomUUID().toString(); CompletableFuture<Object> response = new CompletableFuture<>();
            responses.put(id, response); io.post(id, method, payload.toString()); return response.get(15, TimeUnit.SECONDS);
        }
    }
    private interface TestBody { void run(NativeIO io, TestHost host, File folder) throws Exception; }
    private void test(TestBody body) throws Exception {
        AtomicReference<NativeIO> nativeIo = new AtomicReference<>(); TestHost host = new TestHost();
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> { try { host.activity=activity;host.view=new WebView(activity);nativeIo.set(new NativeIO(activity,host.view,host)); } catch (Exception error) { throw new RuntimeException(error); } });
            NativeIO io = nativeIo.get(); JSONObject paths = new JSONObject(io.sync("app.paths", "{}")).getJSONObject("value");
            File folder = new File(paths.getString("cacheDir"), "native-test-" + UUID.randomUUID());
            io.sync("fs.mkdir", new JSONObject().put("path", folder.getPath()).put("recursive", true).toString());
            try { body.run(io, host, folder); }
            finally { io.sync("fs.remove", new JSONObject().put("path", folder.getPath()).put("recursive", true).toString()); io.close();scenario.onActivity(activity -> host.view.destroy()); }
        }
    }
    @Test public void localVideoRangesAndRevocation() throws Exception {
        test((io, host, folder) -> {
            File source = new File(folder, "sample.mp4"); byte[] bytes = new byte[100]; for (int i = 0; i < 100; i++) bytes[i] = (byte) i;
            io.sync("fs.writeBytes", new JSONObject().put("path", source.getPath()).put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP)).toString());
            String url = new JSONObject(io.sync("resource.local", new JSONObject().put("path", source.getPath()).toString())).getString("value");
            WebResourceResponse response = io.intercept(request(url, "bytes=12-19"));
            assertEquals(206, response.getStatusCode()); assertEquals("bytes 12-19/100", response.getResponseHeaders().get("Content-Range"));
            assertEquals(20,response.getData().available());assertEquals(12,response.getData().skip(12));
            assertArrayEquals(new byte[] {12,13,14,15,16,17,18,19}, read(response.getData()));
            response = io.intercept(request(url, "bytes=-3"));assertEquals(100,response.getData().available());assertEquals(97,response.getData().skip(97));assertArrayEquals(new byte[] {97,98,99}, read(response.getData()));
            response = io.intercept(request(url, "bytes=100-")); assertEquals(416, response.getStatusCode());
            io.sync("resource.clear", "{}"); assertEquals(404, io.intercept(Uri.parse(url)).getStatusCode());
        });
    }
    public static final class RangeResult {
        final CompletableFuture<String> result;RangeResult(CompletableFuture<String> result){this.result=result;}
        @JavascriptInterface public void done(String value){result.complete(value);}
    }
    @Test public void actualWebViewNonzeroRangeReturnsExactBytes() throws Exception {
        test((io,host,folder)->{
            File source=new File(folder,"bytes.mp4");byte[] bytes=new byte[100];for(int i=0;i<bytes.length;i++)bytes[i]=(byte)i;Files.write(source.toPath(),bytes);
            String url=new JSONObject(io.sync("resource.local",new JSONObject().put("path",source.getPath()).toString())).getString("value");
            File large=new File(folder,"sparse-four-gib.mp4");long largeStart=3_221_225_472L,total=4_294_967_396L;
            try(RandomAccessFile sparse=new RandomAccessFile(large,"rw")){
                sparse.setLength(total);sparse.seek(largeStart);for(int i=0;i<24;i++)sparse.write(i+10);
                sparse.seek(total-5);for(int i=0;i<5;i++)sparse.write(i+95);
            }
            String largeUrl=new JSONObject(io.sync("resource.local",new JSONObject().put("path",large.getPath()).toString())).getString("value");
            CompletableFuture<String> result=new CompletableFuture<>();
            String requests="[["+JSONObject.quote(url)+",'bytes=32-55'],["+JSONObject.quote(url)+",'bytes=-5'],["+JSONObject.quote(largeUrl)+",'bytes="+largeStart+"-"+(largeStart+23)+"'],["+JSONObject.quote(largeUrl)+",'bytes=-5']]";
            String html="<html><body><script>(async()=>{try{const values=[];for(const [url,range] of "+requests+"){const r=await fetch(url,{headers:{Range:range}});values.push({status:r.status,data:Array.from(new Uint8Array(await r.arrayBuffer()))});}RangeProbe.done(JSON.stringify(values));}catch(e){RangeProbe.done(JSON.stringify({error:String(e)}));}})();</script></body></html>";
            host.activity.runOnUiThread(()->{
                host.view.getSettings().setJavaScriptEnabled(true);host.view.addJavascriptInterface(new RangeResult(result),"RangeProbe");
                host.view.setWebViewClient(new WebViewClient(){@Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){return io.intercept(request);}});
                host.view.loadDataWithBaseURL("https://appassets.androidplatform.net/",html,"text/html","utf-8",null);
            });
            org.json.JSONArray received=new org.json.JSONArray(result.get(20,TimeUnit.SECONDS));
            JSONObject explicit=received.getJSONObject(0),suffix=received.getJSONObject(1);assertEquals(206,explicit.getInt("status"));assertEquals(24,explicit.getJSONArray("data").length());
            for(int i=0;i<24;i++)assertEquals(32+i,explicit.getJSONArray("data").getInt(i));
            assertEquals(5,suffix.getJSONArray("data").length());for(int i=0;i<5;i++)assertEquals(95+i,suffix.getJSONArray("data").getInt(i));
            JSONObject largeExplicit=received.getJSONObject(2),largeSuffix=received.getJSONObject(3);
            assertEquals(206,largeExplicit.getInt("status"));assertEquals(24,largeExplicit.getJSONArray("data").length());
            for(int i=0;i<24;i++)assertEquals(10+i,largeExplicit.getJSONArray("data").getInt(i));
            assertEquals(5,largeSuffix.getJSONArray("data").length());for(int i=0;i<5;i++)assertEquals(95+i,largeSuffix.getJSONArray("data").getInt(i));
        });
    }
    @Test public void hlsKeepsEverySegmentWithinNativeRegistry() throws Exception {
        test((io, host, folder) -> {
            File segment = new File(folder, "a.ts"), manifest = new File(folder, "video.m3u8");
            Files.write(segment.toPath(), new byte[] {1,2,3,4});
            Files.write(manifest.toPath(), "#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\na.ts\n#EXT-X-ENDLIST\n".getBytes(StandardCharsets.UTF_8));
            String url = new JSONObject(io.sync("resource.local", new JSONObject().put("path", manifest.getPath()).toString())).getString("value");
            String hls = new String(read(io.intercept(Uri.parse(url)).getData()), StandardCharsets.UTF_8);
            String link = null; for (String line : hls.split("\n")) if (line.startsWith("https://")) link = line;
            assertNotNull(link); assertTrue(link.startsWith("https://appassets.androidplatform.net/resource/"));
            assertArrayEquals(new byte[] {1,2,3,4}, read(io.intercept(Uri.parse(link)).getData()));
            assertFalse(hls.contains(folder.getPath()));
        });
    }
    @Test public void aesSecretsAreNotReachableThroughFileBridge() throws Exception {
        test((io, host, folder) -> {
            String alias = "native-integration-" + UUID.randomUUID(); String marker = "not-a-real-credential-" + UUID.randomUUID();
            try {
                host.call(io, "secret.set", new JSONObject().put("alias", alias).put("value", marker));
                assertEquals(marker, host.call(io, "secret.get", new JSONObject().put("alias", alias)));
                JSONObject rejected = new JSONObject(io.sync("fs.readText", new JSONObject().put("path", folder.getParentFile().getParentFile().getPath() + "/../files/.secrets").toString()));
                assertTrue(rejected.has("error"));
                String root = new JSONObject(io.sync("app.paths", "{}")).getJSONObject("value").getString("filesDir");
                File secureFolder = new File(new File(root).getParentFile(), ".secrets");
                File[] files = secureFolder.listFiles(); assertNotNull(files);
                for (File file : files) assertFalse(new String(Files.readAllBytes(file.toPath()), StandardCharsets.ISO_8859_1).contains(marker));
            } finally { host.call(io, "secret.remove", new JSONObject().put("alias", alias)); }
        });
    }
    @Test public void rawPixelColorsAndCropArePreserved() throws Exception {
        test((io, host, folder) -> {
            byte[] rgba = new byte[] {(byte)255,0,0,(byte)255, 0,(byte)255,0,(byte)255, 0,0,(byte)255,(byte)255, (byte)255,(byte)255,(byte)255,(byte)255};
            String packed = String.valueOf(host.call(io, "image.pack", new JSONObject().put("base64", Base64.encodeToString(rgba, Base64.NO_WRAP)).put("width",2).put("height",2).put("format","image/png")));
            File source = new File(folder,"colors.img"), cropped = new File(folder,"cropped.png");
            io.sync("fs.writeBytes",new JSONObject().put("path",source.getPath()).put("base64",packed).toString());
            android.content.Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
            Uri shared = FileProvider.getUriForFile(context,context.getPackageName()+".files",source);
            assertEquals("image/png", context.getContentResolver().getType(shared));
            JSONObject pixels = (JSONObject) host.call(io,"image.pixels",new JSONObject().put("path",source.getPath()));
            assertArrayEquals(rgba,Base64.decode(pixels.getString("base64"),Base64.DEFAULT));
            host.call(io,"image.crop",new JSONObject().put("path",source.getPath()).put("x",1).put("y",0).put("width",1).put("height",1).put("destination",cropped.getPath()));
            pixels = (JSONObject) host.call(io,"image.pixels",new JSONObject().put("path",cropped.getPath()));
            assertArrayEquals(new byte[] {0,(byte)255,0,(byte)255},Base64.decode(pixels.getString("base64"),Base64.DEFAULT));
        });
    }
    @Test public void unapprovedOriginsAndTraversalCannotBeRegistered() throws Exception {
        test((io, host, folder) -> {
            for (String url : new String[] {"http://classroom.zju.edu.cn/video.mp4","https://classroom.zju.edu.cn.evil.example/video.mp4","https://127.0.0.1/video.mp4","https://api.deepseek.com/video.mp4"})
                assertTrue(new JSONObject(io.sync("resource.remote",new JSONObject().put("url",url).toString())).has("error"));
            assertTrue(new JSONObject(io.sync("fs.exists",new JSONObject().put("path","/system/build.prop").toString())).has("error"));
        });
    }
    private static byte[] read(InputStream input) throws Exception { try (InputStream stream=input) { ByteArrayOutputStream result=new ByteArrayOutputStream();byte[] buffer=new byte[1024];int n;while((n=stream.read(buffer))!=-1)result.write(buffer,0,n);return result.toByteArray(); } }
    private static WebResourceRequest request(String url,String range) {
        return new WebResourceRequest() {
            @Override public Uri getUrl(){return Uri.parse(url);} @Override public boolean isForMainFrame(){return false;}
            @Override public boolean isRedirect(){return false;} @Override public boolean hasGesture(){return false;}
            @Override public String getMethod(){return "GET";} @Override public Map<String,String> getRequestHeaders(){return Collections.singletonMap("Range",range);}
        };
    }
}
