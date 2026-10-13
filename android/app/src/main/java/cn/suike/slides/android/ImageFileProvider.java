package cn.suike.slides.android;

import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import androidx.core.content.FileProvider;

/** Course cache names can end in .img; recipients still need the real image MIME type. */
public final class ImageFileProvider extends FileProvider {
    @Override public String getType(Uri uri) {
        String normal = super.getType(uri);
        if (!"application/octet-stream".equals(normal)) return normal;
        try (ParcelFileDescriptor descriptor = super.openFile(uri,"r")) {
            if (descriptor == null) return normal;
            BitmapFactory.Options options = new BitmapFactory.Options(); options.inJustDecodeBounds = true;
            BitmapFactory.decodeFileDescriptor(descriptor.getFileDescriptor(),null,options);
            if (options.outMimeType != null && options.outMimeType.startsWith("image/")) return options.outMimeType;
        } catch (Exception ignored) { }
        return normal;
    }
}
