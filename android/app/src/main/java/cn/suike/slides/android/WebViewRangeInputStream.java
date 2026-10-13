package cn.suike.slides.android;

import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Arrays;

/**
 * Android WebView seeks the returned InputStream according to the request Range,
 * even when shouldInterceptRequest supplies an already-ranged HTTP 206 body.
 * Model the skipped prefix virtually; seeking it costs no memory or network IO.
 * After WebView's seek, exactly the requested payload is exposed.
 */
final class WebViewRangeInputStream extends FilterInputStream {
    private long prefix, remaining;
    WebViewRangeInputStream(InputStream input, long start, long length) {
        super(input);
        if (start < 0 || length < 0) throw new IllegalArgumentException("Invalid range");
        prefix = start; remaining = length;
    }
    @Override public long skip(long count) throws IOException {
        if (count <= 0) return 0;
        // Chromium's C++ InputStream::Skip currently narrows Java's long result
        // to int. Return positive int-sized steps; its 64-bit seek loop repeats.
        count = Math.min(count, Integer.MAX_VALUE);
        long virtual = Math.min(count, prefix); prefix -= virtual;
        long real = Math.min(count - virtual, remaining), skipped = real == 0 ? 0 : super.skip(real);
        remaining -= skipped; return virtual + skipped;
    }
    @Override public int available() {
        long size = prefix > Long.MAX_VALUE - remaining ? Long.MAX_VALUE : prefix + remaining;
        // Chromium verifies bounds with int32 available(). Saturating a >2 GiB
        // stream would incorrectly reject a valid 64-bit Range start. Zero means
        // unknown here; native Range validation and response headers retain size.
        return size > Integer.MAX_VALUE ? 0 : (int) size;
    }
    @Override public int read() throws IOException {
        if (prefix > 0) { prefix--; return 0; }
        if (remaining <= 0) return -1;
        int value = super.read(); if (value >= 0) remaining--; else remaining = 0; return value;
    }
    @Override public int read(byte[] buffer, int offset, int length) throws IOException {
        if (offset < 0 || length < 0 || offset > buffer.length - length) throw new IndexOutOfBoundsException();
        if (length == 0) return 0;
        if (prefix > 0) {
            int virtual = (int) Math.min(prefix, length); Arrays.fill(buffer, offset, offset + virtual, (byte) 0);
            prefix -= virtual; return virtual;
        }
        if (remaining <= 0) return -1;
        int count = super.read(buffer, offset, (int) Math.min(length, remaining));
        if (count >= 0) remaining -= count; else remaining = 0; return count;
    }
}
