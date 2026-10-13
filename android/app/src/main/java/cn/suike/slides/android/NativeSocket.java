package cn.suike.slides.android;

import android.util.Base64;
import org.json.JSONObject;
import org.json.JSONArray;
import org.json.JSONTokener;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.Closeable;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.function.BiConsumer;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.net.ssl.SSLParameters;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;

/** Small RFC6455 client used exclusively for official classroom ASR streams. */
final class NativeSocket {
    private static final int MAX_MESSAGE = 2 * 1024 * 1024;
    private final BiConsumer<String, Object> events;
    private final SecureRandom random;
    private final Map<String, Channel> channels = new ConcurrentHashMap<>();
    private final Map<String, Boolean> trusted = Collections.synchronizedMap(new LinkedHashMap<>());
    private final ThreadPoolExecutor readers = new ThreadPoolExecutor(0, 4, 30, TimeUnit.SECONDS,
            new java.util.concurrent.SynchronousQueue<>(), task -> {
                Thread thread = new Thread(task, "Zhiyun-ASR"); thread.setDaemon(true); return thread;
            });

    NativeSocket(BiConsumer<String, Object> events, SecureRandom random) { this.events = events; this.random = random; }

    /** Called only on successful native HTTPS responses from an official ZJU origin. */
    void trustMetadata(String json) {
        if (json.length() > 16 * 1024 * 1024) return;
        try { discover(new JSONTokener(json).nextValue(), 0, new int[] {0}); } catch (Exception ignored) {}
    }
    private void discover(Object data, int depth, int[] visited) {
        if (depth > 12 || ++visited[0] > 20000) return;
        if (data instanceof JSONObject) {
            JSONObject object = (JSONObject) data;
            for (java.util.Iterator<String> keys = object.keys(); keys.hasNext();) {
                String key = keys.next(); Object value = object.opt(key);
                if (key.equals("trans_socket_url") && value instanceof String) trustAddress((String) value);
                else if ((key.equals("sub_content") || key.equals("content")) && value instanceof String) {
                    try { discover(new JSONTokener((String) value).nextValue(), depth + 1, visited); } catch (Exception ignored) {}
                } else if (value instanceof JSONObject || value instanceof JSONArray) discover(value, depth + 1, visited);
            }
        } else if (data instanceof JSONArray) {
            JSONArray array = (JSONArray) data; for (int i = 0; i < array.length(); i++) discover(array.opt(i), depth + 1, visited);
        }
    }
    private void trustAddress(String address) {
        if (address.length() > 4096) return;
        try {
            URI value = new URI(address.startsWith("//") ? "https:" + address : address);
            String scheme = value.getScheme() == null ? "" : value.getScheme().toLowerCase(Locale.ROOT);
            if (!(scheme.equals("https") || scheme.equals("http") || scheme.equals("wss") || scheme.equals("ws")) ||
                    value.getHost() == null || value.getRawUserInfo() != null || value.getFragment() != null || !safeHost(value.getHost())) return;
            String path = value.getRawPath() == null ? "" : value.getRawPath();
            if (!path.endsWith("/glue/ws")) path = path.replaceAll("/$", "") + "/glue/ws";
            String socketScheme = scheme.equals("https") || scheme.equals("wss") ? "wss" : "ws";
            URI endpoint = new URI(socketScheme + "://" + value.getRawAuthority() + path + (value.getRawQuery() == null ? "" : "?" + value.getRawQuery()));
            synchronized (trusted) {
                trusted.remove(endpoint.toString());
                if (trusted.size() >= 128) trusted.remove(trusted.keySet().iterator().next());
                trusted.put(endpoint.toString(), true);
            }
        } catch (Exception ignored) {}
    }

    void connect(String id, String raw) throws Exception {
        if (id.isEmpty() || id.length() > 256 || channels.size() >= 4) throw new IOException("实时连接数量过多");
        URI uri = new URI(raw);
        String scheme = uri.getScheme(); boolean secure = "wss".equalsIgnoreCase(scheme);
        if (!(secure || "ws".equalsIgnoreCase(scheme)) || uri.getHost() == null || uri.getRawUserInfo() != null ||
                uri.getFragment() != null || !"/glue/ws".equals(uri.getPath()) && !uri.getPath().endsWith("/glue/ws") || !safeHost(uri.getHost()))
            throw new IOException("实时转写地址无效");
        boolean official = false;
        if (secure) {
            try { NativePolicy.https("https://" + uri.getRawAuthority() + uri.getRawPath() + (uri.getRawQuery() == null ? "" : "?" + uri.getRawQuery()), true); official = true; }
            catch (IOException ignored) {}
        }
        if (!official && !trusted.containsKey(uri.toString())) throw new IOException("实时转写地址未由官方课程提供");
        Channel channel = new Channel(id, uri, secure);
        if (channels.putIfAbsent(id, channel) != null) throw new IOException("实时连接标识重复");
        try { readers.execute(() -> channel.run()); }
        catch (Exception error) { channels.remove(id, channel); throw error; }
    }

    void send(String id, String text) throws IOException {
        Channel channel = channels.get(id); if (channel == null) throw new IOException("实时连接尚未建立");
        channel.frame(1, text.getBytes(StandardCharsets.UTF_8));
    }
    void close(String id) { Channel channel = channels.remove(id); if (channel != null) channel.close(); }
    void clearTrusted() { trusted.clear(); for (String id : new ArrayList<>(channels.keySet())) close(id); }
    void closeAll() { clearTrusted(); readers.shutdownNow(); }

    private static boolean safeHost(String host) {
        String lower = host.toLowerCase(Locale.ROOT);
        return !lower.equals("localhost") && !lower.endsWith(".localhost") && !lower.equals("::1") &&
                !lower.equals("0.0.0.0") && !lower.startsWith("127.") && !lower.startsWith("169.254.") &&
                !lower.startsWith("fe80:") && !lower.equals(NativePolicy.ASSET_HOST);
    }
    private void event(String type, String id, String data, boolean binary, String error) {
        JSONObject value = new JSONObject();
        try { value.put("socketId", id); if (data != null) { value.put("data", data); value.put("base64", binary); } if (error != null) value.put("error", error); }
        catch (Exception ignored) {} events.accept("websocket." + type, value);
    }

    private final class Channel implements Closeable {
        final String id; final URI uri; final boolean secure;
        volatile boolean stopped; volatile Socket socket; InputStream input; OutputStream output;
        Channel(String id, URI uri, boolean secure) { this.id = id; this.uri = uri; this.secure = secure; }
        void run() {
            try {
                handshake(); if (stopped) return;
                event("open", id, null, false, null); frames();
            } catch (Exception error) {
                if (!stopped) event("error", id, null, false, "实时转写连接中断，历史转写继续同步");
            } finally { close(); channels.remove(id, this); event("close", id, null, false, null); }
        }
        void handshake() throws Exception {
            int port = uri.getPort() == -1 ? secure ? 443 : 80 : uri.getPort();
            if (port <= 0 || port > 65535) throw new IOException("实时转写端口无效");
            Socket transport = new Socket(); socket = transport;
            transport.connect(new InetSocketAddress(uri.getHost(), port), 15000); transport.setSoTimeout(60000);
            if (secure) {
                SSLSocket tls = (SSLSocket) ((SSLSocketFactory) SSLSocketFactory.getDefault()).createSocket(transport, uri.getHost(), port, true);
                SSLParameters parameters = tls.getSSLParameters(); parameters.setEndpointIdentificationAlgorithm("HTTPS");
                tls.setSSLParameters(parameters); socket = tls; tls.startHandshake();
            }
            if (stopped) throw new IOException("连接已取消");
            input = new BufferedInputStream(socket.getInputStream()); output = socket.getOutputStream();
            byte[] nonce = new byte[16]; random.nextBytes(nonce); String key = Base64.encodeToString(nonce, Base64.NO_WRAP);
            String path = uri.getRawPath() + (uri.getRawQuery() == null ? "" : "?" + uri.getRawQuery());
            if (path.indexOf('\r') >= 0 || path.indexOf('\n') >= 0) throw new IOException("实时地址无效");
            String host = uri.getHost() + (uri.getPort() == -1 ? "" : ":" + port);
            String request = "GET " + path + " HTTP/1.1\r\nHost: " + host + "\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
                    "Sec-WebSocket-Key: " + key + "\r\nSec-WebSocket-Version: 13\r\nOrigin: https://classroom.zju.edu.cn\r\n\r\n";
            output.write(request.getBytes(StandardCharsets.US_ASCII)); output.flush();
            String status = line(); if (!status.matches("HTTP/1\\.[01] 101(?: .*)?")) throw new IOException("实时服务未接受连接");
            Map<String, String> headers = new java.util.HashMap<>(); int bytes = status.length();
            while (true) {
                String value = line(); bytes += value.length(); if (bytes > 32768) throw new IOException("响应头过大");
                if (value.isEmpty()) break;
                int colon = value.indexOf(':'); if (colon > 0) headers.put(value.substring(0, colon).toLowerCase(Locale.ROOT), value.substring(colon + 1).trim());
            }
            String accept = Base64.encodeToString(MessageDigest.getInstance("SHA-1").digest((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").getBytes(StandardCharsets.US_ASCII)), Base64.NO_WRAP);
            if (!accept.equals(headers.get("sec-websocket-accept")) || !"websocket".equalsIgnoreCase(headers.get("upgrade")) ||
                    !headers.getOrDefault("connection", "").toLowerCase(Locale.ROOT).contains("upgrade") || headers.containsKey("sec-websocket-extensions"))
                throw new IOException("实时服务协议校验失败");
        }
        String line() throws IOException {
            ByteArrayOutputStream result = new ByteArrayOutputStream(); int previous = -1;
            while (result.size() < 8192) {
                int current = input.read(); if (current < 0) throw new IOException("实时服务响应中断");
                if (previous == '\r' && current == '\n') {
                    byte[] value = result.toByteArray(); return new String(value, 0, value.length - 1, StandardCharsets.US_ASCII);
                }
                result.write(current); previous = current;
            }
            throw new IOException("实时服务响应头过大");
        }
        void frames() throws Exception {
            ByteArrayOutputStream fragment = null; int fragmentType = 0;
            while (!stopped) {
                int first = input.read(); if (first < 0) return; int second = byteValue();
                boolean fin = (first & 128) != 0; int opcode = first & 15;
                if ((first & 112) != 0 || (second & 128) != 0) throw new IOException("实时帧协议无效");
                long length = second & 127;
                if (length == 126) length = ((long) byteValue() << 8) | byteValue();
                else if (length == 127) { length = 0; for (int i = 0; i < 8; i++) length = (length << 8) | byteValue(); }
                if (length < 0 || length > MAX_MESSAGE || (opcode >= 8 && (!fin || length > 125))) throw new IOException("实时帧长度无效");
                byte[] bytes = new byte[(int) length]; exact(bytes);
                if (opcode == 8) { frame(8, bytes); return; }
                if (opcode == 9) { frame(10, bytes); continue; }
                if (opcode == 10) continue;
                if (opcode == 1 || opcode == 2) {
                    if (fragment != null) throw new IOException("实时分片顺序无效");
                    if (fin) event("message", id, opcode == 1 ? new String(bytes, StandardCharsets.UTF_8) : Base64.encodeToString(bytes, Base64.NO_WRAP), opcode == 2, null);
                    else { fragment = new ByteArrayOutputStream(); fragment.write(bytes); fragmentType = opcode; }
                } else if (opcode == 0 && fragment != null) {
                    if (fragment.size() + bytes.length > MAX_MESSAGE) throw new IOException("实时消息过大"); fragment.write(bytes);
                    if (fin) {
                        byte[] full = fragment.toByteArray(); event("message", id, fragmentType == 1 ? new String(full, StandardCharsets.UTF_8) : Base64.encodeToString(full, Base64.NO_WRAP), fragmentType == 2, null);
                        fragment = null;
                    }
                } else throw new IOException("实时帧类型无效");
            }
        }
        int byteValue() throws IOException { int value = input.read(); if (value < 0) throw new IOException("实时消息中断"); return value; }
        void exact(byte[] bytes) throws IOException { int offset = 0; while (offset < bytes.length) { int n = input.read(bytes, offset, bytes.length - offset); if (n < 0) throw new IOException("实时消息中断"); offset += n; } }
        synchronized void frame(int type, byte[] bytes) throws IOException {
            if (bytes.length > MAX_MESSAGE || output == null || stopped) throw new IOException("实时连接尚未就绪");
            ByteArrayOutputStream encoded = new ByteArrayOutputStream(bytes.length + 14); encoded.write(128 | type);
            if (bytes.length < 126) encoded.write(128 | bytes.length);
            else if (bytes.length <= 65535) { encoded.write(128 | 126); encoded.write(bytes.length >> 8); encoded.write(bytes.length); }
            else { encoded.write(128 | 127); for (int i = 7; i >= 0; i--) encoded.write((int) ((long) bytes.length >> (i * 8))); }
            byte[] mask = new byte[4]; random.nextBytes(mask); encoded.write(mask);
            for (int i = 0; i < bytes.length; i++) encoded.write(bytes[i] ^ mask[i % 4]);
            output.write(encoded.toByteArray()); output.flush();
        }
        @Override public void close() { stopped = true; Socket value = socket; if (value != null) try { value.close(); } catch (IOException ignored) {} }
    }
}
