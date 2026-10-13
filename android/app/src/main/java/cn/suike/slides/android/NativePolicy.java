package cn.suike.slides.android;

import java.io.File;
import java.io.IOException;
import java.net.URI;
import java.util.Locale;

/** Shared, testable policy for both the Javascript bridge and media interception. */
final class NativePolicy {
    static final String ASSET_HOST = "appassets.androidplatform.net";
    private static final String[] REMOTE_SUFFIXES = {
        "zju.edu.cn", "chinamcloud.com", "chinamcloud.cn", "chinamcache.com"
    };

    static boolean under(File child, File root) throws IOException {
        String value = child.getCanonicalPath(), base = root.getCanonicalPath();
        return value.equals(base) || value.startsWith(base + File.separator);
    }

    static File sandbox(String raw, File files, File cache) throws IOException {
        if (raw == null || raw.indexOf('\0') >= 0 || !new File(raw).isAbsolute())
            throw new IOException("文件路径不在应用目录内");
        File value = new File(raw).getCanonicalFile();
        if (!under(value, files) && !under(value, cache))
            throw new IOException("文件路径不在应用目录内");
        return value;
    }

    static URI https(String raw, boolean media) throws IOException {
        try {
            URI uri = new URI(raw);
            String host = uri.getHost();
            if (!"https".equalsIgnoreCase(uri.getScheme()) || host == null ||
                    uri.getRawUserInfo() != null || uri.getFragment() != null ||
                    (uri.getPort() != -1 && uri.getPort() != 443))
                throw new IOException("仅支持平台允许的 HTTPS 地址");
            host = host.toLowerCase(Locale.ROOT);
            boolean allowed = !media && host.equals("api.deepseek.com");
            for (String suffix : REMOTE_SUFFIXES)
                allowed |= host.equals(suffix) || host.endsWith("." + suffix);
            if (!allowed) throw new IOException("此网络地址不在允许范围内");
            return uri;
        } catch (java.net.URISyntaxException e) {
            throw new IOException("网络地址格式无效");
        }
    }

    static boolean campus(URI uri) {
        String host = uri.getHost();
        return host != null && (host.equalsIgnoreCase("zju.edu.cn") ||
                host.toLowerCase(Locale.ROOT).endsWith(".zju.edu.cn"));
    }
    static URI externalHttps(String raw) throws IOException {
        try {
            URI uri = new URI(raw); String host = uri.getHost();
            if (!"https".equalsIgnoreCase(uri.getScheme()) || host == null || uri.getRawUserInfo() != null ||
                    (uri.getPort() != -1 && uri.getPort() != 443)) throw new IOException("外部链接格式无效");
            host = host.toLowerCase(Locale.ROOT);
            if (!(host.equals("platform.deepseek.com") || host.equals("github.com") || campus(uri)))
                throw new IOException("此链接不在应用支持范围内");
            return uri;
        } catch (java.net.URISyntaxException error) { throw new IOException("外部链接格式无效"); }
    }

    static String origin(URI uri) {
        int port = uri.getPort();
        return uri.getScheme().toLowerCase(Locale.ROOT) + "://" +
                uri.getHost().toLowerCase(Locale.ROOT) + (port == -1 || port == 443 ? "" : ":" + port);
    }

    static boolean credentialHeaderAllowed(String name, URI uri) {
        if (name.equalsIgnoreCase("Cookie")) return campus(uri);
        if (name.equalsIgnoreCase("Authorization")) return campus(uri) || "api.deepseek.com".equalsIgnoreCase(uri.getHost());
        return !name.equalsIgnoreCase("Proxy-Authorization");
    }

    static boolean credentialsMustBeStripped(URI source, URI target) {
        return !origin(source).equals(origin(target));
    }

    static long[] range(String header, long size) throws IOException {
        if (header == null || header.isEmpty()) return new long[] {0, size - 1};
        if (!header.startsWith("bytes=") || header.indexOf(',') >= 0 || size == 0)
            throw new IOException("无效的资源范围");
        String[] parts = header.substring(6).split("-", -1);
        if (parts.length != 2) throw new IOException("无效的资源范围");
        try {
            long start, end;
            if (parts[0].isEmpty()) {
                long suffix = Long.parseLong(parts[1]);
                if (suffix <= 0) throw new NumberFormatException();
                start = Math.max(0, size - suffix); end = size - 1;
            } else {
                start = Long.parseLong(parts[0]);
                end = parts[1].isEmpty() ? size - 1 : Math.min(size - 1, Long.parseLong(parts[1]));
            }
            if (start < 0 || start >= size || end < start) throw new NumberFormatException();
            return new long[] {start, end};
        } catch (NumberFormatException e) { throw new IOException("无效的资源范围"); }
    }
}
